import { generateExtraInsights, monthlyCost } from '@/lib/insights';
import type { CategoryTotal } from '@/types/domain';

const cat = (name: string, total: number): CategoryTotal => ({
  categoryId: name,
  name,
  icon: null,
  color: null,
  classification: null,
  total: total as never,
  count: 1,
});

const base = {
  currency: 'INR',
  month: { start: '2026-10-01', end: '2026-10-31' },
  today: '2026-10-11',
  categories: [] as CategoryTotal[],
  previousCategories: [] as CategoryTotal[],
  merchants: [],
  days: [],
  cardSpend: null,
  recurringMonthly: [],
  budget: null,
};

describe('generateExtraInsights', () => {
  it('names the largest category with its real share', () => {
    const out = generateExtraInsights({
      ...base,
      categories: [cat('Food', 600000), cat('Transport', 200000)],
    });
    expect(out.find((i) => i.id === 'largest-category')?.text).toBe(
      "Your largest spending category is Food: ₹6,000, 75% of everything you've spent this month.",
    );
  });

  it('flags a category on pace to rise, from the real numbers', () => {
    // 11 of 31 days gone, ₹5,000 on Food → projected ₹14,091 vs ₹10,000 last month.
    const out = generateExtraInsights({
      ...base,
      categories: [cat('Food', 500000)],
      previousCategories: [cat('Food', 1000000)],
    });
    const i = out.find((x) => x.id.startsWith('cat-pace-up'));
    expect(i?.text).toMatch(/41% more on Food/);
  });

  it('reports the top merchant, the peak day, card trend, recurring and budget', () => {
    const out = generateExtraInsights({
      ...base,
      merchants: [{ name: 'Amazon', total: 320000 as never, count: 3 }],
      days: [
        { date: '2026-10-02', expense: 50000 as never },
        { date: '2026-10-03', expense: 40000 as never },
        { date: '2026-10-04', expense: 300000 as never },
      ],
      cardSpend: { current: 150000 as never, previous: 100000 as never },
      recurringMonthly: [
        { name: 'Rent', monthly: 3200000 as never, subscription: false },
        { name: 'Netflix', monthly: 64900 as never, subscription: true },
      ],
      budget: { amount: 6000000 as never, spent: 5000000 as never },
    });
    const ids = out.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining(['merchant-Amazon', 'peak-day', 'card-spend', 'recurring', 'budget-close']),
    );
    expect(out.find((i) => i.id === 'merchant-Amazon')?.text).toBe(
      'You spent ₹3,200 at Amazon this month, across 3 payments.',
    );
    expect(out.find((i) => i.id === 'card-spend')?.text).toMatch(/50% more on credit cards/);
    expect(out.find((i) => i.id === 'budget-close')?.text).toMatch(/83% of your monthly budget/);
  });

  it('compares spending with the same point last month', () => {
    const out = generateExtraInsights({
      ...base,
      soFar: { current: 1200000 as never, previous: 1000000 as never },
    });
    expect(out.find((i) => i.id === 'vs-last-month')?.text).toBe(
      "You've spent ₹12,000 so far this month — 20% more than by this day last month (₹10,000).",
    );
    // No comparison without a figure from last month.
    expect(
      generateExtraInsights({ ...base, soFar: { current: 5000 as never, previous: 0 as never } }).some(
        (i) => i.id === 'vs-last-month',
      ),
    ).toBe(false);
  });

  it('says nothing when there is no data', () => {
    expect(generateExtraInsights(base)).toEqual([]);
  });
});

describe('monthlyCost', () => {
  it('normalises frequencies', () => {
    expect(monthlyCost(120000 as never, 'yearly')).toBe(10000);
    expect(monthlyCost(10000 as never, 'monthly')).toBe(10000);
  });
});
