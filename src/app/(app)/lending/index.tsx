/**
 * Lent & borrowed: what people owe you and what you owe them — anyone, not
 * only BUD friends. A loan from before BUD never changes your balances; one
 * made now moves the money; none of it is ever spending or income.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { PageHeader, Pill, RoundButton } from '@/components/ui/ref';
import { useIous } from '@/hooks/data';
import { formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { continuous, radius, spacing, typography } from '@/theme/tokens';
import type { Iou } from '@/types/domain';

export default function LendingScreen() {
  const { colors } = useTheme();
  const ious = useIous();
  const [show, setShow] = useState<'open' | 'settled'>('open');
  const money = (v: number, cur = 'INR') => formatMoney(v, cur, { decimals: 'never' });

  return (
    <Screen safeTop>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title="Lent & borrowed"
        left={<RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />}
        right={<RoundButton icon="add" label="Add" onPress={() => router.push('/lending/new')} />}
      />
      <QueryState query={ious}>
        {(list) => {
          if (list.length === 0) {
            return (
              <EmptyState
                icon="swap-horizontal-outline"
                title="Track money you lent or borrowed"
                message="Gave someone money before you used BUD? Add it here — your balances won’t change, and you’ll see what’s still owed. Lending now from an account moves the money, but it’s never counted as spending."
                actionLabel="Add"
                onAction={() => router.push('/lending/new')}
              />
            );
          }
          const open = list.filter((i) => i.outstanding > 0);
          const owedToMe = open.filter((i) => i.direction === 'lent').reduce((s, i) => s + i.outstanding, 0);
          const iOwe = open.filter((i) => i.direction === 'borrowed').reduce((s, i) => s + i.outstanding, 0);
          const shown = show === 'open' ? open : list.filter((i) => i.outstanding === 0);
          const lent = shown.filter((i) => i.direction === 'lent');
          const borrowed = shown.filter((i) => i.direction === 'borrowed');
          return (
            <>
              <Row gap={spacing.md} style={{ marginBottom: spacing.xl }}>
                {(
                  [
                    ['Owed to you', owedToMe, 'positive'],
                    ['You owe', iOwe, 'negative'],
                  ] as const
                ).map(([label, value, tone]) => (
                  <Card key={label} style={{ flex: 1, gap: 2 }}>
                    <Text variant="footnote" tone="secondary">
                      {label}
                    </Text>
                    <Text style={[typography.title, { fontSize: 22 }]} tone={value ? tone : 'primary'}>
                      {money(value)}
                    </Text>
                  </Card>
                ))}
              </Row>
              <Row gap={spacing.sm} style={{ marginBottom: spacing.lg }}>
                <Pill label="Still owed" selected={show === 'open'} onPress={() => setShow('open')} />
                <Pill label="Settled" selected={show === 'settled'} onPress={() => setShow('settled')} />
              </Row>
              {lent.length ? (
                <Section title="They owe you">
                  {lent.map((i) => (
                    <IouRow key={i.id} i={i} />
                  ))}
                </Section>
              ) : null}
              {borrowed.length ? (
                <Section title="You owe">
                  {borrowed.map((i) => (
                    <IouRow key={i.id} i={i} />
                  ))}
                </Section>
              ) : null}
              {!shown.length ? (
                <Text variant="callout" tone="secondary" align="center" style={{ marginTop: spacing.xl }}>
                  {show === 'open' ? 'Nothing is owed right now.' : 'Nothing settled yet.'}
                </Text>
              ) : null}
              <Text variant="footnote" tone="tertiary" style={{ marginTop: spacing.lg }}>
                Loans and repayments are never counted as spending or income. A loan from before BUD doesn’t
                change any balance.
              </Text>
            </>
          );
        }}
      </QueryState>
    </Screen>
  );

  function IouRow({ i }: { i: Iou }) {
    const lent = i.direction === 'lent';
    const pct = i.amount ? Math.round((i.repaid / i.amount) * 100) : 0;
    return (
      <Pressable
        onPress={() => router.push({ pathname: '/lending/[id]', params: { id: i.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${i.person}, ${lent ? 'owes you' : 'you owe'} ${money(i.outstanding, i.currency)}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          marginBottom: spacing.sm,
          borderRadius: radius.xl,
          ...continuous,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <GradientFill colors={colors.heroGradient} />
          <Text variant="bodyStrong" style={{ color: colors.heroText }}>
            {i.person.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Row justify="space-between">
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {i.person}
            </Text>
            <Text
              style={typography.amount}
              tone={i.outstanding === 0 ? 'secondary' : lent ? 'positive' : 'negative'}
            >
              {money(i.outstanding, i.currency)}
            </Text>
          </Row>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {lent ? 'Lent' : 'Borrowed'} {money(i.amount, i.currency)} · {formatShortDate(i.occurredOn)}
            {i.accountId ? '' : ' · before BUD'}
          </Text>
          {i.repaid > 0 ? (
            <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.fill, overflow: 'hidden' }}>
              <View
                style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: colors.positive }}
              />
            </View>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={16} tone="tertiary" />
      </Pressable>
    );
  }
}
