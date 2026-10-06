import {
  appleDateToISO,
  decodeAttributedBody,
  isoToAppleNanos,
  isPlainSqlite,
  plistString,
} from '../scripts/sms-backup';

/** Builds an attributedBody blob the way iOS's typedstream encoder lays it out. */
function typedstream(text: string): Uint8Array {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const len = bytes.length < 0x80 ? [bytes.length] : [0x81, bytes.length & 0xff, (bytes.length >> 8) & 0xff];
  return new Uint8Array([
    0x04,
    0x0b,
    ...enc.encode('streamtyped'),
    0x81,
    0xe8,
    0x03,
    0x84,
    0x01,
    0x40,
    0x84,
    0x84,
    0x84,
    ...enc.encode('NSAttributedString'),
    0x00,
    0x84,
    0x84,
    ...enc.encode('NSObject'),
    0x00,
    0x85,
    0x92,
    0x84,
    0x84,
    0x84,
    ...enc.encode('NSString'),
    0x01,
    0x94,
    0x84,
    0x01,
    0x2b,
    ...len,
    ...bytes,
    0x86,
    0x84,
    0x02,
  ]);
}

describe('iPhone backup — Messages database', () => {
  it('reads Apple dates in nanoseconds and in seconds', () => {
    // 2026-10-03T04:00:00Z
    expect(appleDateToISO(812_692_800 * 1e9)).toBe('2026-10-03T04:00:00.000Z');
    expect(appleDateToISO(812_692_800)).toBe('2026-10-03T04:00:00.000Z');
    expect(appleDateToISO(0)).toBeNull();
    expect(isoToAppleNanos('2026-10-03T04:00:00Z')).toBe(812_692_800 * 1e9);
  });

  it('pulls the text out of attributedBody (iOS 16+)', () => {
    const sms = 'Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 03/10/26\nRef 627612345678';
    expect(decodeAttributedBody(typedstream(sms))).toBe(sms);
  });

  it('handles long messages with a two-byte length, and Unicode', () => {
    const sms = `INR 2,000.00 credited to A/c XX7890 ₹ — ${'x'.repeat(300)}`;
    expect(decodeAttributedBody(typedstream(sms))).toBe(sms);
  });

  it('returns null for anything that is not a typedstream string', () => {
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody(new Uint8Array(40))).toBeNull();
  });

  it('tells an encrypted backup from a readable one', () => {
    expect(isPlainSqlite(new TextEncoder().encode('SQLite format 3\u0000rest'))).toBe(true);
    expect(
      isPlainSqlite(new Uint8Array([0x8f, 0x12, 0x00, 0x44, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
    ).toBe(false);
  });

  it('reads the device name and backup date from Info.plist', () => {
    const xml = `<?xml version="1.0"?><plist><dict>
      <key>Device Name</key><string>Charan’s iPhone</string>
      <key>Last Backup Date</key><date>2026-10-05T17:20:11Z</date>
    </dict></plist>`;
    expect(plistString(xml, 'Device Name')).toBe('Charan’s iPhone');
    expect(plistString(xml, 'Last Backup Date')).toBe('2026-10-05T17:20:11Z');
    expect(plistString(xml, 'Missing')).toBeNull();
  });
});
