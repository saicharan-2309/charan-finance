import {
  formatMoney,
  minorToInput,
  parseAmountInput,
  percentOf,
  sanitizeAmountKeystrokes,
  scaleMinor,
  sumMinor,
  toDecimalString,
  toMinor,
} from '@/lib/money';

describe('toMinor / toDecimalString', () => {
  it('converts database values exactly', () => {
    expect(toMinor('1249.10')).toBe(124910);
    expect(toMinor('0.01')).toBe(1);
    expect(toMinor('-5.5')).toBe(-550);
    expect(toMinor(1249.1)).toBe(124910);
    expect(toMinor(0.1 + 0.2)).toBe(30); // float noise from upstream is normalised
    expect(toMinor('84250')).toBe(8425000);
    expect(toMinor(null)).toBe(0);
  });

  it('round-trips to exact decimal strings for the database', () => {
    expect(toDecimalString(124910)).toBe('1249.10');
    expect(toDecimalString(5)).toBe('0.05');
    expect(toDecimalString(-550)).toBe('-5.50');
    expect(toDecimalString(0)).toBe('0.00');
    for (const v of ['0.01', '999999999.99', '123456.78']) expect(toDecimalString(toMinor(v))).toBe(v);
  });

  it('sums without floating point drift', () => {
    const tenths = Array.from({ length: 10 }, () => toMinor('0.10'));
    expect(sumMinor(tenths)).toBe(100);
    expect(toDecimalString(sumMinor([toMinor('0.1'), toMinor('0.2')]))).toBe('0.30');
  });

  it('rejects unsafe magnitudes', () => {
    expect(() => toDecimalString(2 ** 60)).toThrow();
  });
});

describe('parseAmountInput', () => {
  it('accepts typical user input', () => {
    expect(parseAmountInput('1,249')).toBe(124900);
    expect(parseAmountInput('₹ 1,24,999.50')).toBe(12499950);
    expect(parseAmountInput('12.')).toBe(1200);
    expect(parseAmountInput('.5')).toBe(50);
  });
  it('rejects invalid input', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('1.234')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
  });
});

describe('sanitizeAmountKeystrokes', () => {
  it('keeps at most two decimals and one point', () => {
    expect(sanitizeAmountKeystrokes('12.345')).toBe('12.34');
    expect(sanitizeAmountKeystrokes('1.2.3')).toBe('1.23');
    expect(sanitizeAmountKeystrokes('.5')).toBe('0.5');
    expect(sanitizeAmountKeystrokes('007')).toBe('7');
    expect(sanitizeAmountKeystrokes('12a3')).toBe('123');
  });
});

describe('formatMoney', () => {
  it('uses Indian digit grouping for INR', () => {
    expect(formatMoney(toMinor('84250'), 'INR')).toBe('₹84,250');
    expect(formatMoney(toMinor('125000'), 'INR')).toBe('₹1,25,000');
    expect(formatMoney(toMinor('12345678.9'), 'INR')).toBe('₹1,23,45,678.90');
    expect(formatMoney(toMinor('1249'), 'INR', { decimals: 'always' })).toBe('₹1,249.00');
  });
  it('uses western grouping for other currencies', () => {
    expect(formatMoney(toMinor('1234567.5'), 'USD')).toBe('$1,234,567.50');
  });
  it('handles signs', () => {
    expect(formatMoney(-toMinor('62430'), 'INR')).toBe('−₹62,430');
    expect(formatMoney(toMinor('500'), 'INR', { signed: true })).toBe('+₹500');
  });
  it('formats compact values', () => {
    expect(formatMoney(toMinor('125000'), 'INR', { compact: true })).toBe('₹1.25L');
    expect(formatMoney(toMinor('34000000'), 'INR', { compact: true })).toBe('₹3.4Cr');
    expect(formatMoney(toMinor('12500'), 'INR', { compact: true })).toBe('₹12.5K');
    expect(formatMoney(toMinor('950'), 'INR', { compact: true })).toBe('₹950');
    expect(formatMoney(toMinor('2500000'), 'USD', { compact: true })).toBe('$2.5M');
  });
  it('rounds when decimals are hidden', () => {
    expect(formatMoney(toMinor('99.50'), 'INR', { decimals: 'never' })).toBe('₹100');
  });
});

describe('helpers', () => {
  it('computes percentages and scaled projections', () => {
    expect(percentOf(6243000, 12500000)).toBe(49.9);
    expect(percentOf(1, 0)).toBe(0);
    expect(scaleMinor(1000, 31 / 10)).toBe(3100);
    expect(scaleMinor(-15, 0.5)).toBe(-8);
    expect(minorToInput(124900)).toBe('1249');
    expect(minorToInput(124950)).toBe('1249.50');
  });
});
