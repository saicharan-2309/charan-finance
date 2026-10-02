import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { LineChart } from '@/components/charts';
import { Button, SegmentedControl } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/feedback';
import { Screen, Section, Stat } from '@/components/ui/layout';
import { Card, Divider, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useAppMutation, useCurrency, useSnapshots } from '@/hooks/data';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, computeNetWorth, isLiability } from '@/lib/accounts';
import { addDaysISO, formatShortDate, todayISO } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { qk } from '@/lib/query';
import { captureNetWorthSnapshot } from '@/services/planning';
import { useTheme } from '@/theme/ThemeProvider';
import type { Account } from '@/types/domain';
import { spacing } from '@/theme/tokens';

type Span = '3m' | '1y' | 'all';

export default function NetWorthScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const accounts = useAccounts();
  const snapshots = useSnapshots();
  const [span, setSpan] = useState<Span>('1y');

  const capture = useAppMutation(captureNetWorthSnapshot, {
    invalidate: [qk.snapshots],
    success: 'Snapshot saved',
    context: 'snapshot',
  });

  const active = (accounts.data ?? []).filter((a) => a.isActive);
  const nw = computeNetWorth(active, currency);
  const points = useMemo(() => {
    const cutoff =
      span === '3m'
        ? addDaysISO(todayISO(), -92)
        : span === '1y'
          ? addDaysISO(todayISO(), -366)
          : '0000-00-00';
    return (snapshots.data ?? []).filter((s) => s.currency === currency && s.snapshotDate >= cutoff);
  }, [snapshots.data, span, currency]);
  const first = points[0];
  const change = first ? nw.netWorth - first.netWorth : 0;

  const included = active.filter((a) => a.includeInNetWorth && a.currency === currency);
  const assets = included.filter((a) => !isLiability(a.type));
  const liabilities = included.filter((a) => isLiability(a.type));

  return (
    <Screen>
      <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xl }}>
        <View>
          <Text variant="overline" tone="secondary">
            Net worth
          </Text>
          {accounts.data ? (
            <MoneyText
              minor={nw.netWorth}
              currency={currency}
              variant="display"
              options={{ decimals: 'never' }}
              colorBySign={nw.netWorth < 0}
            />
          ) : (
            <Skeleton width={180} height={42} />
          )}
          {first ? (
            <Text variant="footnote" tone={change >= 0 ? 'positive' : 'negative'}>
              {change >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(change), currency, { decimals: 'never' })} since{' '}
              {formatShortDate(first.snapshotDate)}
            </Text>
          ) : null}
        </View>
        <Row>
          <Stat label="Assets">
            <MoneyText
              minor={nw.assets}
              currency={currency}
              variant="bodyStrong"
              options={{ decimals: 'never' }}
            />
          </Stat>
          <Stat label="Liabilities">
            <MoneyText
              minor={nw.liabilities}
              currency={currency}
              variant="bodyStrong"
              options={{ decimals: 'never' }}
            />
          </Stat>
        </Row>
        <Text variant="caption" tone="tertiary">
          Assets − Liabilities, from your account balances
          {nw.excludedCurrencies.length ? `; excludes ${nw.excludedCurrencies.join(', ')} accounts` : ''}.
          Investment values are whatever you last entered — update them with “Reconcile” on the account.
        </Text>
      </Card>

      <Section title="Trend">
        <SegmentedControl<Span>
          value={span}
          onChange={setSpan}
          options={[
            { value: '3m', label: '3 months' },
            { value: '1y', label: '1 year' },
            { value: 'all', label: 'All' },
          ]}
          style={{ marginBottom: spacing.md }}
        />
        <Card>
          {points.length > 1 ? (
            <LineChart
              currency={currency}
              color={colors.positive}
              points={points.map((p) => ({ label: formatShortDate(p.snapshotDate), value: p.netWorth }))}
            />
          ) : (
            <Text variant="footnote" tone="secondary">
              A snapshot is saved automatically each day you open the app. Your trend appears once there are
              at least two.
            </Text>
          )}
        </Card>
        <Button
          title="Save snapshot now"
          variant="ghost"
          size="md"
          onPress={() => capture.mutate(undefined)}
          loading={capture.isPending}
        />
      </Section>

      <BalanceList title="Assets" accounts={assets} currency={currency} />
      <BalanceList title="Liabilities" accounts={liabilities} currency={currency} />
    </Screen>
  );
}

function BalanceList({
  title,
  accounts,
  currency,
}: {
  title: string;
  accounts: Account[];
  currency: string;
}) {
  if (!accounts.length) return null;
  return (
    <Section title={title}>
      <Card style={{ paddingVertical: spacing.xs }}>
        {accounts.map((a, i) => (
          <View key={a.id}>
            {i > 0 ? <Divider inset={50} /> : null}
            <Pressable
              onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })}
              accessibilityRole="button"
            >
              <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                <IconBadge icon={a.icon ?? ACCOUNT_TYPE_ICONS[a.type]} color={a.color} size={38} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{a.name}</Text>
                  <Text variant="footnote" tone="secondary">
                    {ACCOUNT_TYPE_LABELS[a.type]}
                  </Text>
                </View>
                <MoneyText
                  minor={isLiability(a.type) ? -a.currentBalance : a.currentBalance}
                  currency={currency}
                  options={{ decimals: 'never' }}
                />
              </Row>
            </Pressable>
          </View>
        ))}
      </Card>
    </Section>
  );
}
