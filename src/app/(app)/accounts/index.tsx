import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useCurrency } from '@/hooks/data';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, computeNetWorth, isLiability } from '@/lib/accounts';
import { formatMoney } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { spacing } from '@/theme/tokens';
import type { Account } from '@/types/domain';

export default function AccountsScreen() {
  const q = useAccounts();
  const currency = useCurrency();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/accounts/edit')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add account"
            >
              <Text variant="bodyStrong" tone="brand">
                Add
              </Text>
            </Pressable>
          ),
        }}
      />
      <QueryState query={q}>
        {(accounts) => {
          if (accounts.length === 0) {
            return (
              <EmptyState
                icon="wallet-outline"
                title="No accounts yet"
                message="Add bank accounts, cash, cards, wallets and investments."
                actionLabel="Add account"
                onAction={() => router.push('/accounts/edit')}
              />
            );
          }
          const active = accounts.filter((a) => a.isActive);
          const nw = computeNetWorth(active, currency);
          const assets = active.filter((a) => !isLiability(a.type));
          const liabilities = active.filter((a) => isLiability(a.type));
          const archived = accounts.filter((a) => !a.isActive);
          return (
            <>
              <Card
                variant="muted"
                style={{ marginBottom: spacing.xxl }}
                onPress={() => router.push('/net-worth')}
              >
                <Text variant="caption" tone="secondary">
                  Net worth
                </Text>
                <MoneyText minor={nw.netWorth} currency={currency} variant="amountLarge" />
                <Text variant="footnote" tone="secondary">
                  Assets {formatMoney(nw.assets, currency, { decimals: 'never' })} · Liabilities{' '}
                  {formatMoney(nw.liabilities, currency, { decimals: 'never' })}
                </Text>
                {nw.excludedCurrencies.length ? (
                  <Text variant="caption" tone="tertiary" style={{ marginTop: 4 }}>
                    Excludes accounts in {nw.excludedCurrencies.join(', ')}.
                  </Text>
                ) : null}
              </Card>
              <AccountGroup title="Assets" accounts={assets} />
              <AccountGroup title="Liabilities" accounts={liabilities} />
              <AccountGroup title="Archived" accounts={archived} muted />
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function AccountGroup({ title, accounts, muted }: { title: string; accounts: Account[]; muted?: boolean }) {
  if (accounts.length === 0) return null;
  return (
    <Section title={title}>
      <Card style={{ paddingVertical: spacing.xs, opacity: muted ? 0.7 : 1 }}>
        {accounts.map((a, i) => (
          <View key={a.id}>
            {i > 0 ? <Divider inset={56} /> : null}
            <Pressable
              onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })}
              accessibilityRole="button"
            >
              <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                <IconBadge icon={a.icon ?? ACCOUNT_TYPE_ICONS[a.type]} color={a.color} size={42} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text variant="footnote" tone="secondary" numberOfLines={1}>
                    {[
                      ACCOUNT_TYPE_LABELS[a.type],
                      a.last4 ? `••${a.last4}` : null,
                      a.currency !== 'INR' ? a.currency : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <MoneyText
                    minor={isLiability(a.type) ? Math.abs(a.currentBalance) : a.currentBalance}
                    currency={a.currency}
                    colorBySign={!isLiability(a.type) && a.currentBalance < 0}
                  />
                  {isLiability(a.type) ? (
                    <Text variant="caption" tone="secondary">
                      {a.currentBalance < 0 ? 'owed' : a.currentBalance > 0 ? 'in credit' : 'settled'}
                    </Text>
                  ) : null}
                </View>
              </Row>
            </Pressable>
          </View>
        ))}
      </Card>
    </Section>
  );
}
