/**
 * Pure helpers for reading the Messages database (sms.db) out of an iPhone
 * backup. Kept separate from the CLI so they can be unit-tested.
 */

/** sms.db's file name inside a backup: SHA-1 of "HomeDomain-Library/SMS/sms.db". */
export const SMS_DB_FILE = '3d0d7e5fb2ce288813306e4d4636395e047a3d28';
export const SMS_DB_RELATIVE = `3d/${SMS_DB_FILE}`;

/** Seconds from the Unix epoch to Apple's (2001-01-01T00:00:00Z). */
const APPLE_EPOCH_OFFSET = 978_307_200;

/**
 * Messages stores dates as time since 2001-01-01 — in seconds on old iOS, in
 * nanoseconds since iOS 11. Anything above 1e12 can only be nanoseconds.
 */
export function appleDateToISO(value: number | bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(n) || n <= 0) return null;
  const seconds = n > 1e12 ? n / 1e9 : n;
  return new Date((seconds + APPLE_EPOCH_OFFSET) * 1000).toISOString();
}

/** Inverse of `appleDateToISO`, in nanoseconds (for WHERE date >= …). */
export function isoToAppleNanos(iso: string): number {
  return (Date.parse(iso) / 1000 - APPLE_EPOCH_OFFSET) * 1e9;
}

const NSSTRING = new TextEncoder().encode('NSString');

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Since iOS 16 many messages leave `message.text` empty and keep the text only
 * in `attributedBody`, an NSAttributedString in Apple's "typedstream" format.
 * The plain text follows the first "NSString" class name: a '+' marker, then
 * its byte length (one byte, or 0x81 + uint16 LE, or 0x82 + uint24 LE), then
 * the UTF-8 bytes.
 */
export function decodeAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length < 16) return null;
  const at = indexOf(blob, NSSTRING);
  if (at < 0) return null;
  let i = at + NSSTRING.length;
  const end = Math.min(blob.length, i + 16);
  while (i < end && blob[i] !== 0x2b) i++;
  if (i >= end) return null;
  i++;
  let len = blob[i++];
  if (len === 0x81) {
    len = blob[i] | (blob[i + 1] << 8);
    i += 2;
  } else if (len === 0x82) {
    len = blob[i] | (blob[i + 1] << 8) | (blob[i + 2] << 16);
    i += 3;
  }
  if (len <= 0 || i + len > blob.length) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(blob.subarray(i, i + len));
}

/** A real SQLite file starts with this header; an encrypted backup's doesn't. */
export function isPlainSqlite(header: Uint8Array): boolean {
  const magic = 'SQLite format 3\u0000';
  if (header.length < magic.length) return false;
  for (let k = 0; k < magic.length; k++) if (header[k] !== magic.charCodeAt(k)) return false;
  return true;
}

/** Reads one string value from an XML plist (Info.plist is XML in iTunes backups). */
export function plistString(xml: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<key>${escaped}</key>\\s*<(?:string|date)>([^<]*)</(?:string|date)>`).exec(xml);
  return m ? m[1].trim() : null;
}
