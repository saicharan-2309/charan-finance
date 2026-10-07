/**
 * App passcode rules — pure logic, unit-tested.
 *
 * The app passcode is a 6-digit code that belongs to Charan Finance (separate
 * from the iPhone passcode). Only a salted, stretched SHA-256 of it is stored,
 * in the iOS Keychain; the code itself is never stored or sent anywhere.
 *
 * A 6-digit code has a million possibilities, so the real protection is the
 * lockout: after five wrong attempts each further mistake locks entry for
 * longer, and the count survives restarting the app.
 */

export const PASSCODE_LENGTH = 6;

/** How many times the salted hash is re-hashed (key stretching). */
export const HASH_ROUNDS = 1000;

/** Wrong attempts allowed before the first lockout. */
export const FREE_ATTEMPTS = 5;

export type PasscodeProblem = 'length' | 'digits' | 'repeated' | 'sequence';

/** Why a new passcode is rejected, or null when it's acceptable. */
export function passcodeProblem(code: string): PasscodeProblem | null {
  if (!/^\d*$/.test(code)) return 'digits';
  if (code.length !== PASSCODE_LENGTH) return 'length';
  if (/^(\d)\1+$/.test(code)) return 'repeated';
  const digits = [...code].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'sequence';
  return null;
}

export const PASSCODE_PROBLEM_COPY: Record<PasscodeProblem, string> = {
  length: `Use ${PASSCODE_LENGTH} digits.`,
  digits: 'Use digits only.',
  repeated: 'Avoid a single repeated digit — it’s the first thing anyone tries.',
  sequence: 'Avoid a straight run like 123456 — it’s too easy to guess.',
};

/**
 * Seconds entry stays locked after `failures` wrong attempts in a row:
 * none for the first five, then 30 s, 1 min, 5 min, and 15 min from then on.
 */
export function lockoutSeconds(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const over = failures - FREE_ATTEMPTS;
  return [30, 60, 300][over] ?? 900;
}

/** Attempts left before the next lockout starts (0 once locking has begun). */
export function attemptsBeforeLockout(failures: number): number {
  return Math.max(FREE_ATTEMPTS - failures, 0);
}

/**
 * Salted, stretched hash: h₀ = H(salt:code), hₙ = H(salt:hₙ₋₁:code).
 * `digest` is SHA-256 returning hex (expo-crypto in the app, node:crypto in tests).
 */
export async function hashPasscode(
  code: string,
  salt: string,
  digest: (input: string) => Promise<string>,
  rounds = HASH_ROUNDS,
): Promise<string> {
  let h = await digest(`${salt}:${code}`);
  for (let i = 1; i < rounds; i++) h = await digest(`${salt}:${h}:${code}`);
  return h;
}

/** Human-readable wait, e.g. "30 seconds", "5 minutes". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}
