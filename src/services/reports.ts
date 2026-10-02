/**
 * Server-side aggregations (all computed in PostgreSQL, scoped by RLS).
 */
import type { ISODate } from '@/lib/dates';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  AccountTotal,
  CategoryKind,
  CategoryTotal,
  DashboardData,
  MerchantTotal,
  PeriodSummary,
  SeriesPoint,
} from '@/types/domain';
import {
  mapAccountTotal,
  mapCategoryTotal,
  mapDashboard,
  mapMerchantTotal,
  mapSeries,
  mapSummary,
  type Row,
} from './mappers';
import { toMinor, type Minor } from '@/lib/money';

export async function fetchDashboard(monthStart: ISODate, monthEnd: ISODate): Promise<DashboardData> {
  const data = unwrap(
    await supabase.rpc('get_dashboard', { p_month_start: monthStart, p_month_end: monthEnd }),
  );
  return mapDashboard(data as Row);
}

export async function fetchSummary(start: ISODate, end: ISODate): Promise<PeriodSummary> {
  const rows = unwrap(await supabase.rpc('report_summary', { p_start: start, p_end: end })) as Row[];
  return mapSummary(rows[0]);
}

export async function fetchCategoryBreakdown(
  start: ISODate,
  end: ISODate,
  opts: {
    kind?: CategoryKind;
    parentId?: string | null;
    merchantId?: string | null;
    accountId?: string | null;
  } = {},
): Promise<CategoryTotal[]> {
  const rows = unwrap(
    await supabase.rpc('report_by_category', {
      p_start: start,
      p_end: end,
      p_kind: opts.kind ?? 'expense',
      p_parent_id: opts.parentId ?? null,
      p_merchant_id: opts.merchantId ?? null,
      p_account_id: opts.accountId ?? null,
    }),
  ) as Row[];
  return rows.map(mapCategoryTotal);
}

export async function fetchMerchantBreakdown(
  start: ISODate,
  end: ISODate,
  limit = 50,
  categoryId: string | null = null,
): Promise<MerchantTotal[]> {
  const rows = unwrap(
    await supabase.rpc('report_by_merchant', {
      p_start: start,
      p_end: end,
      p_limit: limit,
      p_category_id: categoryId,
    }),
  ) as Row[];
  return rows.map(mapMerchantTotal);
}

export async function fetchAccountBreakdown(start: ISODate, end: ISODate): Promise<AccountTotal[]> {
  const rows = unwrap(await supabase.rpc('report_by_account', { p_start: start, p_end: end })) as Row[];
  return rows.map(mapAccountTotal);
}

export type Bucket = 'day' | 'week' | 'month';

export async function fetchTimeSeries(
  start: ISODate,
  end: ISODate,
  bucket: Bucket,
  filters: { categoryId?: string | null; merchantId?: string | null; accountId?: string | null } = {},
): Promise<SeriesPoint[]> {
  const rows = unwrap(
    await supabase.rpc('report_time_series', {
      p_start: start,
      p_end: end,
      p_bucket: bucket,
      p_category_id: filters.categoryId ?? null,
      p_merchant_id: filters.merchantId ?? null,
      p_account_id: filters.accountId ?? null,
    }),
  ) as Row[];
  return rows.map(mapSeries);
}

export interface MerchantStats {
  total: Minor;
  count: number;
  average: Minor;
  largest: Minor;
  firstAt: string | null;
  lastAt: string | null;
}

export async function fetchMerchantStats(merchantId: string): Promise<MerchantStats> {
  const rows = unwrap(await supabase.rpc('merchant_stats', { p_merchant_id: merchantId })) as Row[];
  const r = rows[0] ?? {};
  return {
    total: toMinor(r.total),
    count: Number(r.tx_count ?? 0),
    average: toMinor(r.average),
    largest: toMinor(r.largest),
    firstAt: r.first_at ?? null,
    lastAt: r.last_at ?? null,
  };
}

export async function verifyBalances(): Promise<{ consistent: boolean; checked: number }> {
  const rows = unwrap(await supabase.rpc('verify_account_balances')) as Row[];
  return { consistent: rows.every((r) => r.is_consistent), checked: rows.length };
}
