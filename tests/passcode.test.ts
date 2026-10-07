import { createHash } from 'node:crypto';

import {
  attemptsBeforeLockout,
  formatWait,
  hashPasscode,
  lockoutSeconds,
  passcodeProblem,
} from '@/lib/passcode';

const sha256 = async (s: string) => createHash('sha256').update(s).digest('hex');

describe('passcodeProblem', () => {
  it('accepts an ordinary six-digit code', () => {
    expect(passcodeProblem('482913')).toBeNull();
    expect(passcodeProblem('120934')).toBeNull();
  });
  it('rejects the wrong length and non-digits', () => {
    expect(passcodeProblem('12345')).toBe('length');
    expect(passcodeProblem('1234567')).toBe('length');
    expect(passcodeProblem('12a456')).toBe('digits');
  });
  it('rejects repeated digits and straight runs', () => {
    expect(passcodeProblem('000000')).toBe('repeated');
    expect(passcodeProblem('777777')).toBe('repeated');
    expect(passcodeProblem('123456')).toBe('sequence');
    expect(passcodeProblem('987654')).toBe('sequence');
  });
});

describe('lockout', () => {
  it('allows five attempts, then escalates and stays at 15 minutes', () => {
    expect([0, 1, 4].map(lockoutSeconds)).toEqual([0, 0, 0]);
    expect([5, 6, 7, 8, 20].map(lockoutSeconds)).toEqual([30, 60, 300, 900, 900]);
  });
  it('counts attempts left before the first lockout', () => {
    expect(attemptsBeforeLockout(0)).toBe(5);
    expect(attemptsBeforeLockout(3)).toBe(2);
    expect(attemptsBeforeLockout(9)).toBe(0);
  });
  it('formats waits', () => {
    expect(formatWait(30)).toBe('30 seconds');
    expect(formatWait(60)).toBe('1 minute');
    expect(formatWait(300)).toBe('5 minutes');
  });
});

describe('hashPasscode', () => {
  it('is deterministic for the same code and salt', async () => {
    expect(await hashPasscode('482913', 'salt', sha256, 10)).toBe(
      await hashPasscode('482913', 'salt', sha256, 10),
    );
  });
  it('depends on the salt and the code, and never contains the code', async () => {
    const a = await hashPasscode('482913', 'salt-a', sha256, 10);
    expect(a).not.toBe(await hashPasscode('482913', 'salt-b', sha256, 10));
    expect(a).not.toBe(await hashPasscode('482914', 'salt-a', sha256, 10));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('482913');
  });
  it('stretches: more rounds give a different hash', async () => {
    expect(await hashPasscode('482913', 's', sha256, 1)).not.toBe(
      await hashPasscode('482913', 's', sha256, 2),
    );
  });
});
