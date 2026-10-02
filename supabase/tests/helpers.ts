import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

/**
 * Test harness for the SQL layer.
 *
 * Creates a fresh disposable database, applies the Supabase shim plus every
 * migration in order, and exposes helpers that run statements *as* a given
 * user through the real `authenticated` role — so RLS, column privileges and
 * function grants are exercised exactly as PostgREST would exercise them.
 *
 * Requires TEST_DATABASE_URL pointing at a throwaway PostgreSQL 15+ server
 * (default: postgres://postgres:postgres@localhost:5432/postgres).
 * NEVER point this at a real Supabase project.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

const ROOT = path.resolve(__dirname, '..');

export interface TestDb {
  admin: Client;
  dbName: string;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const dbName = `cf_test_${process.pid}_${Date.now()}`;
  const bootstrap = new Client({ connectionString: ADMIN_URL });
  await bootstrap.connect();
  await bootstrap.query(`create database ${dbName}`);
  await bootstrap.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  // Quiet NOTICEs from "if exists" statements.
  await admin.query(`set client_min_messages = warning`);

  await admin.query(readFileSync(path.join(ROOT, 'tests', 'supabase_shim.sql'), 'utf8'));
  const migrations = readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    try {
      await admin.query(readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  return {
    admin,
    dbName,
    close: async () => {
      await admin.end();
      const cleanup = new Client({ connectionString: ADMIN_URL });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${dbName} with (force)`);
      await cleanup.end();
    },
  };
}

export async function createUser(db: TestDb, email: string): Promise<string> {
  const { rows } = await db.admin.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"display_name":"Test"}') returning id`,
    [email],
  );
  return rows[0].id;
}

/**
 * Runs `fn` inside a transaction as the given user (role `authenticated` with
 * JWT claims), or as `anon` when uid is null. Commits on success.
 */
export async function asUser<T>(
  db: TestDb,
  uid: string | null,
  fn: (
    q: <R extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>,
  ) => Promise<T>,
): Promise<T> {
  const c = db.admin;
  await c.query('begin');
  try {
    if (uid) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ]);
      await c.query('set local role authenticated');
    } else {
      await c.query(`select set_config('request.jwt.claims', '', true)`);
      await c.query('set local role anon');
    }
    const result = await fn(async (sql, params) => (await c.query(sql, params)).rows);
    await c.query('commit');
    return result;
  } catch (err) {
    await c.query('rollback');
    throw err;
  }
}

/** Asserts that `promise` rejects with a message matching `pattern`. */
export async function expectError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const msg = (err as Error).message;
    if (!pattern.test(msg)) {
      throw new Error(`Expected error matching ${pattern}, got: ${msg}`);
    }
    return;
  }
  throw new Error(`Expected error matching ${pattern}, but the call succeeded`);
}
