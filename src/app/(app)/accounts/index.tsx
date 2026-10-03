/**
 * Accounts & Payment Methods — everything money moves through, grouped by
 * kind. Credit cards show what is used and what is still available; bank,
 * cash and wallet accounts show their balance.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useCurrency } from '@/hooks/data';
import { computeNetWorth } from '@/lib/accounts';
import { formatMoney } from '@/lib/money';
import {
  accountVisual,
  balanceDisplay,
  cardStanding,
  GROUP_LABELS,
  groupAccounts,
  providerByKey,
} from '@/lib/payment-methods';
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
          title: 'Accounts & methods',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/accounts/edit')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add payment method"
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
                title="No payment methods yet"
                message="Add bank accounts, cards, cash, UPI apps and investments. You can record expenses from any of them."
                actionLabel="Add payment method"
                onAction={() => router.push('/accounts/edit')}
              />
            );
          }
          const active = accounts.filter((a) => a.isActive);
          const nw = computeNetWorth(active, currency);
          const archived = accounts.filter((a) => !a.isActive);
          return (
            <>
              <Card
                variant="muted"
                style={{ marginBottom: spacing.xxl }}
                onPress={() => router.push('/net-worth')}
                accessibilityLabel="Net worth"
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

              {groupAccounts(active).map(({ group, items }) => (
                <Section key={group} title={GROUP_LABELS[group]}>
                  <MethodList accounts={items} />
                </Section>
              ))}

              {archived.length ? (
                <Section title="Archived">
                  <MethodList accounts={archived} muted />
                </Section>
              ) : null}

              <Pressable
                onPress={() => router.push('/accounts/edit')}
                accessibilityRole="button"
                style={{ paddingVertical: spacing.md }}
              >
                <Row gap={spacing.md}>
                  <IconBadge icon="add" size={40} />
                  <Text variant="bodyStrong" tone="brand">
                    Add account or payment method
                  </Text>
                </Row>
              </Pressable>
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function MethodList({ accounts, muted }: { accounts: Account[]; muted?: boolean }) {
  return (
    <Card padded={false} style={{ paddingHorizontal: spacing.lg, opacity: muted ? 0.65 : 1 }}>
      {accounts.map((a, i) => (
        <View key={a.id}>
          {i > 0 ? <Divider inset={54} /> : null}
          <MethodRow account={a} />
        </View>
      ))}
    </Card>
  );
}

function MethodRow({ account: a }: { account: Account }) {
  const visual = accountVisual(a);
  const display = balanceDisplay(a);
  const card = a.type === 'credit_card' ? cardStanding(a) : null;
  const provider = providerByKey(a.provider);
  const issuer = provider?.label ?? a.institution;
  const subtitle = [issuer && issuer !== a.name ? issuer : null, a.last4 ? `•••• ${a.last4}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${a.name}, ${formatMoney(display.amount, a.currency)} ${display.caption ?? ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
        <IconBadge icon={visual.icon} color={visual.color} size={42} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {a.name}
          </Text>
          {subtitle ? (
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText
            minor={display.amount}
            currency={a.currency}
            colorBySign={!card && display.caption === null && a.currentBalance < 0}
            options={{ decimals: 'never' }}
          />
          {card && card.available !== null ? (
            <Text variant="caption" tone="secondary">
              {display.caption} · {formatMoney(card.available, a.currency, { decimals: 'never' })} left
            </Text>
          ) : display.caption ? (
            <Text variant="caption" tone="secondary">
              {display.caption}
            </Text>
          ) : null}
        </View>
      </Row>
    </Pressable>
  );
}
