/**
 * Balance groups: which payment methods add up together on Home.
 */
import { supabase, unwrap } from '@/lib/supabase';
import type { BalanceGroup } from '@/types/domain';

export async function fetchBalanceGroups(): Promise<BalanceGroup[]> {
  // Starter groups ("Cash", "Credit cards") are created the first time.
  await supabase.rpc('ensure_balance_groups');
  const groups = unwrap(
    await supabase
      .from('balance_groups')
      .select('id, name, kind, sort_order')
      .order('sort_order')
      .order('name'),
  ) as { id: string; name: string; kind: BalanceGroup['kind']; sort_order: number }[];
  const links = unwrap(await supabase.from('balance_group_accounts').select('group_id, account_id')) as {
    group_id: string;
    account_id: string;
  }[];
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    sortOrder: g.sort_order,
    accountIds: links.filter((l) => l.group_id === g.id).map((l) => l.account_id),
  }));
}

export async function saveBalanceGroup(input: {
  id?: string;
  name: string;
  accountIds: string[];
  sortOrder?: number;
}): Promise<string> {
  let id = input.id;
  if (id) {
    unwrap(await supabase.from('balance_groups').update({ name: input.name.trim() }).eq('id', id));
  } else {
    const row = unwrap(
      await supabase
        .from('balance_groups')
        .insert({ name: input.name.trim(), sort_order: input.sortOrder ?? 10 })
        .select('id')
        .single(),
    ) as { id: string };
    id = row.id;
  }
  unwrap(
    await supabase.rpc('set_balance_group_accounts', { p_group_id: id, p_account_ids: input.accountIds }),
  );
  return id;
}

export async function deleteBalanceGroup(id: string): Promise<void> {
  unwrap(await supabase.from('balance_groups').delete().eq('id', id));
}
