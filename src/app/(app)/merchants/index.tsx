import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { SegmentedControl, TextField } from '@/components/ui/controls';
import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useCurrency, useMerchants } from '@/hooks/data';
import { rangeForPreset } from '@/lib/dates';
import { qk } from '@/lib/query';
import { fetchMerchantBreakdown } from '@/services/reports';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

type Range = 'this_month' | 'last_3_months' | 'this_year';

export default function MerchantsScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const merchants = useMerchants();
  const [range, setRange] = useState<Range>('last_3_months');
  const [search, setSearch] = useState('');
  const r = rangeForPreset(range);
  const totals = useQuery({
    queryKey: qk.report('merchants', r.start, r.end),
    queryFn: () => fetchMerchantBreakdown(r.start, r.end, 500),
  });

  const rows = useMemo(() => {
    const byId = new Map((totals.data ?? []).map((t) => [t.merchantId, t]));
    const q = search.trim().toLowerCase();
    return (merchants.data ?? [])
      .filter((m) => !m.isArchived && (!q || m.name.toLowerCase().includes(q)))
      .map((m) => ({ m, t: byId.get(m.id) }))
      .sort((a, b) => (b.t?.total ?? 0) - (a.t?.total ?? 0) || a.m.name.localeCompare(b.m.name));
  }, [merchants.data, totals.data, search]);

  return (
    <Screen>
      <SegmentedControl<Range>
        value={range}
        onChange={setRange}
        options={[
          { value: 'this_month', label: 'This month' },
          { value: 'last_3_months', label: '3 months' },
          { value: 'this_year', label: 'This year' },
        ]}
        style={{ marginBottom: spacing.lg }}
      />
      <TextField
        value={search}
        onChangeText={setSearch}
        placeholder="Search merchants"
        leading={<Icon name="search" size={18} tone="tertiary" />}
        clearButtonMode="while-editing"
        containerStyle={{ marginBottom: spacing.lg }}
      />
      <QueryState query={merchants}>
        {() =>
          rows.length === 0 ? (
            <EmptyState
              icon="storefront-outline"
              title="No merchants yet"
              message="Merchants are created automatically when you add expenses."
            />
          ) : (
            <Card style={{ paddingVertical: spacing.xs }}>
              {rows.map(({ m, t }, i) => (
                <View key={m.id}>
                  {i > 0 ? <Divider inset={48} /> : null}
                  <Pressable
                    onPress={() => router.push({ pathname: '/merchants/[id]', params: { id: m.id } })}
                    accessibilityRole="button"
                  >
                    <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 12,
                          backgroundColor: colors.surfaceMuted,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text variant="bodyStrong">{m.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {m.name}
                        </Text>
                        <Text variant="footnote" tone="secondary">
                          {t
                            ? `${t.count} ${t.count === 1 ? 'transaction' : 'transactions'}`
                            : 'No spending in this period'}
                        </Text>
                      </View>
                      {t ? (
                        <MoneyText minor={t.total} currency={currency} options={{ decimals: 'never' }} />
                      ) : null}
                    </Row>
                  </Pressable>
                </View>
              ))}
            </Card>
          )
        }
      </QueryState>
    </Screen>
  );
}
