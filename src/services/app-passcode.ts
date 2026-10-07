/**
 * App passcode storage in the iOS Keychain (expo-secure-store, this device
 * only). Holds a random salt, the stretched hash, the run of wrong attempts
 * and the time entry is locked until — never the passcode itself.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { hashPasscode, lockoutSeconds } from '@/lib/passcode';

const KEYS = {
  hash: 'cf.passcode.hash',
  salt: 'cf.passcode.salt',
  failures: 'cf.passcode.failures',
  lockedUntil: 'cf.passcode.locked-until',
} as const;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const sha256 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hasAppPasscode(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(KEYS.hash, OPTIONS));
}

/** Stores a new passcode (validated by the caller) and clears any lockout. */
export async function saveAppPasscode(code: string): Promise<void> {
  const salt = toHex(Crypto.getRandomBytes(16));
  const hash = await hashPasscode(code, salt, sha256);
  await SecureStore.setItemAsync(KEYS.salt, salt, OPTIONS);
  await SecureStore.setItemAsync(KEYS.hash, hash, OPTIONS);
  await resetFailures();
}

export async function removeAppPasscode(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k, OPTIONS)));
}

export interface LockoutState {
  failures: number;
  /** Epoch ms until which entry is refused; 0 when not locked. */
  lockedUntil: number;
}

export async function readLockout(): Promise<LockoutState> {
  const [f, u] = await Promise.all([
    SecureStore.getItemAsync(KEYS.failures, OPTIONS),
    SecureStore.getItemAsync(KEYS.lockedUntil, OPTIONS),
  ]);
  return { failures: Number(f) || 0, lockedUntil: Number(u) || 0 };
}

async function resetFailures() {
  await SecureStore.setItemAsync(KEYS.failures, '0', OPTIONS);
  await SecureStore.setItemAsync(KEYS.lockedUntil, '0', OPTIONS);
}

export type VerifyResult = { ok: true } | { ok: false; lockout: LockoutState };

/**
 * Checks a passcode. Refuses (without checking) while locked out; a wrong
 * code raises the failure count and, past five, starts the next lockout.
 */
export async function verifyAppPasscode(code: string, now = Date.now()): Promise<VerifyResult> {
  const lock = await readLockout();
  if (lock.lockedUntil > now) return { ok: false, lockout: lock };
  const [salt, stored] = await Promise.all([
    SecureStore.getItemAsync(KEYS.salt, OPTIONS),
    SecureStore.getItemAsync(KEYS.hash, OPTIONS),
  ]);
  if (!salt || !stored) return { ok: false, lockout: lock };
  if ((await hashPasscode(code, salt, sha256)) === stored) {
    await resetFailures();
    return { ok: true };
  }
  const failures = lock.failures + 1;
  const wait = lockoutSeconds(failures);
  const next = { failures, lockedUntil: wait ? now + wait * 1000 : 0 };
  await SecureStore.setItemAsync(KEYS.failures, String(next.failures), OPTIONS);
  await SecureStore.setItemAsync(KEYS.lockedUntil, String(next.lockedUntil), OPTIONS);
  return { ok: false, lockout: next };
}
