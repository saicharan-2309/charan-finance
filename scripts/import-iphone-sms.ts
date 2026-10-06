/**
 * Import your past bank SMS from an iPhone backup — once, on your PC.
 *
 * iOS doesn't let any app read the Messages inbox, so the Shortcut can only
 * forward texts as they arrive. Your messages *are* in the backup iTunes /
 * Apple Devices makes on Windows (or Finder on a Mac), though. This script
 * reads the Messages database from that backup, keeps only bank alerts (the
 * same parser the server uses, plus a check that the sender is a bank sender
 * ID), and sends just those to your Charan Finance server, oldest first.
 * Personal texts, OTPs and promotions never leave your PC.
 *
 * Usage (from the project folder):
 *   npm run import:sms -- --dry-run            # look first: what would be imported
 *   npm run import:sms                         # import the last 12 months
 *   npm run import:sms -- --since 2026-01-01   # from a date
 *   npm run import:sms -- --backup "D:\Backups\00008110-…"   # a specific backup folder
 *
 * It asks for your sync key (Bank sync screen → "Your Shortcut details" → Key),
 * or pass --key cfsync_… / set CF_SYNC_KEY. The server URL comes from .env.
 *
 * The backup must be UNENCRYPTED: in Apple Devices / iTunes, untick "Encrypt
 * local backup", then "Back up now". (You can turn encryption back on after.)
 */
/* eslint-disable no-console -- a command-line tool: printing is its output */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import initSqlJs from 'sql.js';

import { isBankSender, parseBankSms, type ParsedSms } from '../supabase/functions/_shared/bank-sms';
import {
  appleDateToISO,
  decodeAttributedBody,
  isoToAppleNanos,
  isPlainSqlite,
  plistString,
  SMS_DB_RELATIVE,
} from './sms-backup';

const BATCH = 100;
const ROOT = path.resolve(__dirname, '..');

interface Args {
  dryRun: boolean;
  since: string;
  backup: string | null;
  key: string | null;
  url: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return null;
    const a = argv[i];
    return a.includes('=') ? a.slice(a.indexOf('=') + 1) : (argv[i + 1] ?? null);
  };
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const since = get('since') ?? yearAgo.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) fail(`--since must look like 2026-01-31 (got "${since}")`);
  return {
    dryRun: argv.includes('--dry-run'),
    since,
    backup: get('backup'),
    key: get('key') ?? process.env.CF_SYNC_KEY ?? null,
    url: get('url'),
  };
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Finding the backup
// ---------------------------------------------------------------------------

interface Backup {
  dir: string;
  device: string;
  date: Date;
}

function backupRoots(): string[] {
  const home = os.homedir();
  const roots = [
    // iTunes from apple.com
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Apple Computer', 'MobileSync', 'Backup') : null,
    // iTunes / Apple Devices from the Microsoft Store
    path.join(home, 'Apple', 'MobileSync', 'Backup'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Apple', 'MobileSync', 'Backup') : null,
    // macOS Finder
    path.join(home, 'Library', 'Application Support', 'MobileSync', 'Backup'),
  ];
  return [...new Set(roots.filter((r): r is string => !!r && existsSync(r)))];
}

function describeBackup(dir: string): Backup | null {
  if (!existsSync(path.join(dir, SMS_DB_RELATIVE))) return null;
  const infoPath = path.join(dir, 'Info.plist');
  const info = existsSync(infoPath) ? readFileSync(infoPath, 'utf8') : '';
  const lastBackup = plistString(info, 'Last Backup Date');
  return {
    dir,
    device: plistString(info, 'Device Name') ?? plistString(info, 'Display Name') ?? path.basename(dir),
    date: lastBackup ? new Date(lastBackup) : statSync(dir).mtime,
  };
}

function findBackup(explicit: string | null): Backup {
  if (explicit) {
    const b = describeBackup(path.resolve(explicit));
    if (!b)
      fail(
        `No Messages database in "${explicit}". Point --backup at a backup folder (the one with Info.plist).`,
      );
    return b;
  }
  const found: Backup[] = [];
  for (const root of backupRoots()) {
    for (const name of readdirSync(root)) {
      const b = describeBackup(path.join(root, name));
      if (b) found.push(b);
    }
  }
  if (found.length === 0) {
    fail(
      [
        'No iPhone backup found.',
        'Connect your iPhone, open Apple Devices (or iTunes), choose "Back up all of the data on your iPhone',
        'to this computer", make sure "Encrypt local backup" is OFF, and click "Back up now". Then run this again.',
        `Looked in: ${backupRoots().join(', ') || '(no backup folders exist yet)'}`,
      ].join('\n  '),
    );
  }
  found.sort((a, b) => b.date.getTime() - a.date.getTime());
  if (found.length > 1) {
    console.log('Backups found (using the newest — pass --backup to choose another):');
    for (const b of found) console.log(`  ${b.date.toLocaleString()}  ${b.device}  ${b.dir}`);
  }
  return found[0];
}

// ---------------------------------------------------------------------------
// Reading messages
// ---------------------------------------------------------------------------

interface BankText {
  text: string;
  sender: string;
  received_at: string;
  parsed: ParsedSms;
}

async function readBankTexts(backup: Backup, since: string): Promise<{ scanned: number; bank: BankText[] }> {
  const file = path.join(backup.dir, SMS_DB_RELATIVE);
  const bytes = readFileSync(file);
  if (!isPlainSqlite(bytes.subarray(0, 16))) {
    fail(
      [
        'This backup is encrypted, so its messages can’t be read.',
        'In Apple Devices / iTunes: untick "Encrypt local backup" (it asks for the backup password),',
        'click "Back up now", then run this again. You can turn encryption back on afterwards.',
      ].join('\n  '),
    );
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  const hasAttributed = db
    .exec(`select 1 from pragma_table_info('message') where name = 'attributedBody'`)
    .some((r) => r.values.length > 0);

  // Dates are seconds (old iOS) or nanoseconds (iOS 11+) since 2001.
  const sinceNanos = isoToAppleNanos(`${since}T00:00:00Z`);
  const stmt = db.prepare(
    `select m.text, ${hasAttributed ? 'm.attributedBody' : 'null'} as body_blob, m.date, h.id as sender
       from message m
       left join handle h on h.ROWID = m.handle_id
      where coalesce(m.is_from_me, 0) = 0
        and (case when m.date > 1000000000000 then m.date else m.date * 1000000000 end) >= $since
      order by (case when m.date > 1000000000000 then m.date else m.date * 1000000000 end)`,
  );
  stmt.bind({ $since: sinceNanos });

  let scanned = 0;
  const bank: BankText[] = [];
  while (stmt.step()) {
    scanned++;
    const row = stmt.getAsObject() as {
      text: string | null;
      body_blob: Uint8Array | null;
      date: number;
      sender: string | null;
    };
    const text = (row.text && row.text.trim()) || decodeAttributedBody(row.body_blob) || '';
    const sender = (row.sender ?? '').trim();
    const receivedAt = appleDateToISO(row.date);
    if (!text || !receivedAt || !sender) continue;
    // Only bank sender IDs, and only real money movements / balances.
    if (!isBankSender(sender)) continue;
    const parsed = parseBankSms({ body: text, sender, receivedAt });
    if (parsed.kind !== 'transaction' && parsed.kind !== 'balance') continue;
    if (text.length > 2000) continue;
    bank.push({ text, sender, received_at: receivedAt, parsed });
  }
  stmt.free();
  db.close();
  return { scanned, bank };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function ingestUrl(explicit: string | null): string {
  if (explicit) return explicit;
  let base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? null;
  const envFile = path.join(ROOT, '.env');
  if (!base && existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('EXPO_PUBLIC_SUPABASE_URL='));
    base = line
      ? line
          .slice(line.indexOf('=') + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
      : null;
  }
  if (!base) fail('No server URL. Put EXPO_PUBLIC_SUPABASE_URL in .env, or pass --url.');
  return `${base.replace(/\/$/, '')}/functions/v1/ingest-sms`;
}

async function askKey(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const key = (await rl.question('Sync key (Bank sync → Your Shortcut details → Key): ')).trim();
  rl.close();
  return key;
}

async function send(url: string, key: string, items: BankText[]): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-key': key },
        body: JSON.stringify({
          backfill: true,
          messages: batch.map(({ text, sender, received_at }) => ({ text, sender, received_at })),
        }),
      });
    } catch (err) {
      fail(`Could not reach the server (${(err as Error).message}). Check your internet and try again.`);
    }
    const body = (await res.json().catch(() => ({}))) as {
      summary?: string;
      counts?: Record<string, number>;
    };
    if (!res.ok) {
      fail(
        `${body.summary ?? `Server said ${res.status}`}` +
          (i > 0 ? `\n  ${i} messages were imported before this; running again skips them.` : ''),
      );
    }
    for (const [k, v] of Object.entries(body.counts ?? {})) totals[k] = (totals[k] ?? 0) + v;
    process.stdout.write(`\r  Sent ${Math.min(i + BATCH, items.length)} of ${items.length}…`);
  }
  process.stdout.write('\n');
  return totals;
}

// ---------------------------------------------------------------------------

function groupKey(p: ParsedSms): string {
  if (p.kind === 'ignored') return 'ignored';
  return `${(p.bank ?? 'unknown bank').toUpperCase()} ••${p.last4 ?? '?'}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backup = findBackup(args.backup);
  console.log(`\nReading ${backup.device}'s backup from ${backup.date.toLocaleString()}`);
  console.log(`Messages since ${args.since}…`);

  const { scanned, bank } = await readBankTexts(backup, args.since);
  console.log(`\n${scanned} texts read on this PC, ${bank.length} of them bank transactions or balances.`);
  if (scanned === 0) {
    console.log(
      'No texts in this backup for that period. If "Messages in iCloud" is on, older texts may only be in iCloud —\n' +
        'try an earlier --since, or a fresh backup.',
    );
  }
  if (bank.length === 0) return;

  const groups = new Map<string, { n: number; first: string; last: string }>();
  for (const b of bank) {
    const k = groupKey(b.parsed);
    const g = groups.get(k);
    if (g) {
      g.n++;
      g.last = b.received_at;
    } else groups.set(k, { n: 1, first: b.received_at, last: b.received_at });
  }
  console.log('\nBy account:');
  for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${k.padEnd(20)} ${String(g.n).padStart(5)}   ${g.first.slice(0, 10)} → ${g.last.slice(0, 10)}`,
    );
  }

  if (args.dryRun) {
    console.log('\nDry run — nothing was sent. Run again without --dry-run to import.');
    return;
  }

  const url = ingestUrl(args.url);
  const key = args.key ?? (await askKey());
  if (!/^cfsync_\w{20,}$/.test(key)) fail('That doesn’t look like a sync key (it starts with cfsync_).');

  console.log(`\nSending ${bank.length} bank messages to your server…`);
  const totals = await send(url, key, bank);

  const line = (label: string, n: number | undefined) => (n ? `  ${label.padEnd(36)} ${n}\n` : '');
  console.log(
    '\nDone.\n' +
      line('Added as transactions', (totals.created ?? 0) + (totals.paired ?? 0)) +
      line('Matched to entries you typed', totals.linked) +
      line('Already in the app (skipped)', totals.duplicate) +
      line('Balance messages', totals.balance) +
      line('Waiting for you to add the account', totals.needs_account) +
      line('Card payments to match', totals.awaiting_pair) +
      line('Not bank transactions (dropped)', totals.ignored) +
      line('Could not be recorded', totals.failed),
  );
  if (totals.needs_account || totals.awaiting_pair) {
    console.log(
      'Open the app → Review. Under "Found in your messages" add each account or card in one tap;\n' +
        'all of its messages are filed straight away.',
    );
  }
  console.log('History doesn’t change today’s balances — it fills in your reports and trends.\n');
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
