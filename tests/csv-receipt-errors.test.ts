import { importTemplateCsv, parseCsv, parseImportDate, toCsv, validateImport } from '@/lib/csv';
import { describeError } from '@/lib/errors';
import { parseReceiptText } from '@/lib/receipt-parser';

const accounts = [
  { id: 'bank', name: 'HDFC Bank', isActive: true },
  { id: 'cash', name: 'Cash', isActive: true },
  { id: 'card', name: 'HDFC Credit Card', isActive: true },
  { id: 'old', name: 'Old Wallet', isActive: false },
];
const categories = [
  { id: 'food', name: 'Food', kind: 'expense' as const, parentId: null, isArchived: false },
  { id: 'delivery', name: 'Food Delivery', kind: 'expense' as const, parentId: 'food', isArchived: false },
  { id: 'salary', name: 'Salary', kind: 'income' as const, parentId: null, isArchived: false },
  { id: 'rest', name: 'Restaurants', kind: 'expense' as const, parentId: null, isArchived: false },
];

describe('CSV', () => {
  it('parses quoted fields, escaped quotes, CRLF and BOM', () => {
    const table = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",3\n"multi\nline",,\n');
    expect(table).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', '3'],
      ['multi\nline', '', ''],
    ]);
    expect(() => parseCsv('"open')).toThrow();
  });

  it('writes CSV safely (quotes and formula injection)', () => {
    expect(
      toCsv(
        ['n', 'v'],
        [
          ['=HYPERLINK("x")', '-12.50'],
          ['a,b', null],
        ],
      ),
    ).toBe('n,v\r\n"\'=HYPERLINK(""x"")",-12.50\r\n"a,b",\r\n');
  });

  it('round-trips the import template through validation', () => {
    const result = validateImport(parseCsv(importTemplateCsv()), { accounts, categories });
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]).toMatchObject({
      type: 'expense',
      amount: 45000,
      accountId: 'card',
      categoryId: 'food',
      subcategoryId: 'delivery',
      merchantName: 'Swiggy',
      tags: ['dinner'],
    });
    expect(result.rows[2]).toMatchObject({ type: 'transfer', toAccountId: 'cash', categoryId: null });
  });

  it('reports every invalid row instead of importing partially', () => {
    const csv = [
      'date,type,amount,account,category,to_account',
      '31/02/2026,expense,100,Cash,Food,',
      '2026-09-01,expense,abc,Cash,Food,',
      '2026-09-01,expense,100,Nope,Food,',
      '2026-09-01,expense,100,Cash,Salary,',
      '2026-09-01,transfer,100,Cash,,Cash',
      '2026-09-01,refund,100,Cash,Food,',
      '2026-09-01,expense,100,Old Wallet,Food,',
      '01-09-2026,expense,"1,250.50",cash,food,',
    ].join('\n');
    const result = validateImport(parseCsv(csv), { accounts, categories });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ rowNumber: 9, amount: 125050 });
    const rowsWithErrors = new Set(result.errors.map((e) => e.rowNumber));
    expect([...rowsWithErrors].sort()).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('requires mandatory columns and infers type from sign when no type column', () => {
    expect(
      validateImport(parseCsv('date,amount\n2026-09-01,10'), { accounts, categories }).errors[0].message,
    ).toMatch(/account/);
    const r = validateImport(
      parseCsv('date,amount,account,category\n2026-09-01,-10,Cash,Food\n2026-09-02,500,Cash,Salary'),
      { accounts, categories },
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.type)).toEqual(['expense', 'income']);
  });

  it('parses supported date formats', () => {
    expect(parseImportDate('2026-09-01')).toBe('2026-09-01');
    expect(parseImportDate('1/9/2026')).toBe('2026-09-01');
    expect(parseImportDate('29-02-2026')).toBeNull();
    expect(parseImportDate('Sep 1 2026')).toBeNull();
  });
});

describe('receipt parser', () => {
  const today = new Date(2026, 8, 18);
  const merchants = [{ id: 'm1', name: 'Swiggy', defaultCategoryId: 'food' }];
  const cats = [
    { id: 'rest', name: 'Restaurants', kind: 'expense' as const, parentId: null },
    { id: 'groc', name: 'Groceries', kind: 'expense' as const, parentId: null },
  ];

  it('extracts grand total (not subtotal/tax), date and currency', () => {
    const text = `THE GREEN BOWL CAFE
12 MG Road, Bengaluru 560001
GSTIN 29ABCDE1234F1Z5
Date: 14/09/2026  Time 20:41
Paneer Wrap      1   240.00
Cold Coffee      2   360.00
Sub Total            600.00
CGST 2.5%             15.00
SGST 2.5%             15.00
Grand Total      ₹ 630.00
Thank you!`;
    const s = parseReceiptText(text, merchants, cats, today);
    expect(s.amount).toBe(63000);
    expect(s.date).toBe('2026-09-14');
    expect(s.currency).toBe('INR');
    expect(s.merchantName).toBe('The Green Bowl Cafe');
    expect(s.categoryId).toBe('rest');
    expect(s.confidence.amount).toBeGreaterThan(0.8);
  });

  it('prefers known merchants and their default category', () => {
    const s = parseReceiptText(
      'Order from SWIGGY\n12 Sep 2026\nTotal Paid Rs. 1,249.50',
      merchants,
      cats,
      today,
    );
    expect(s.merchantId).toBe('m1');
    expect(s.categoryId).toBe('food');
    expect(s.amount).toBe(124950);
    expect(s.date).toBe('2026-09-12');
  });

  it('ignores future dates and falls back gracefully', () => {
    const s = parseReceiptText('Shop\n01/01/2030\n12.00\n45.50', [], [], today);
    expect(s.date).toBeNull();
    expect(s.amount).toBe(4550);
    expect(s.confidence.amount).toBeLessThan(0.5);
    const empty = parseReceiptText('', [], [], today);
    expect(empty.amount).toBeNull();
  });
});

describe('error mapping', () => {
  it('maps database codes without leaking raw messages', () => {
    expect(describeError({ message: 'CF409: This transaction was changed elsewhere.' }).message).toMatch(
      /another device/,
    );
    expect(
      describeError({ message: 'duplicate key value violates unique constraint "x"', code: '23505' }).message,
    ).toBe('Something with that name already exists.');
    expect(describeError(new Error('Network request failed'))).toMatchObject({
      retryable: true,
      code: 'network',
    });
    expect(describeError({ message: 'Invalid login credentials', status: 400 }).message).toBe(
      'Incorrect email or password.',
    );
    expect(describeError({ message: 'relation "public.secret" does not exist', code: '42P01' }).message).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
