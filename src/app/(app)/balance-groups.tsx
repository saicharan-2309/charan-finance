/**
 * Balance groups — you decide which payment methods add up together.
 *
 *   TOTAL CASH     Axis Bank + HDFC Bank           → ₹1,73,000
 *   TOTAL CREDIT   HDFC card + ICICI card          → ₹25,000 owed · ₹2,75,000 available
 *
 * A card's limit is never counted as cash. A method can be in any number of
 * groups. Nothing is combined unless you put it in a group.
 */
import { useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Button, TextField } from '@/components/ui/controls';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useAppMutation, useBalanceGroups, useCurrency } from '@/hooks/data';
import { groupHeadline, summariseGroup } from '@/lib/balance-groups';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { formatMoney } from '@/lib/money';
import { accountVisual } from '@/lib/payment-methods';
import { qk } from '@/lib/query';
import { deleteBalanceGroup, saveBalanceGroup } from '@/services/balance-groups';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, typography } from '@/theme/tokens';
import type { BalanceGroup } from '@/types/domain';

export default function BalanceGroupsScreen() {
  const groups = useBalanceGroups();
  const accounts = useAccounts();
  const currency = useCurrency();
  const [editing, setEditing] = useState<BalanceGroup | 'new' | null>(null);
  const all = (accounts.data ?? []).filter((a) => !a.systemKind);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });

  return (
    <Screen footer={<Button title="New group" icon="add" onPress={() => setEditing('new')} />}>
      <Text variant="callout" tone="secondary" style={{ marginBottom: spacing.xl }}>
        Choose which payment methods add up together on Home. A credit card’s limit is never counted as cash —
        cards show what you owe and the credit still available.
      </Text>
      {groups.error && !groups.data ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : groups.data === undefined || accounts.data === undefined ? (
        <SkeletonList rows={3} />
      ) : groups.data.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No groups yet"
          message="Create one, e.g. “Total cash” with your bank accounts."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {groups.data.map((g) => {
            const members = all.filter((a) => g.accountIds.includes(a.id));
            const s = summariseGroup(members, currency);
            const head = groupHeadline(s);
            return (
              <Card
                key={g.id}
                onPress={() => setEditing(g)}
                accessibilityLabel={`${g.name}, ${head.label} ${money(head.amount)}`}
              >
                <Row justify="space-between" align="flex-start">
                  <View style={{ flex: 1 }}>
                    <Text variant="headline">{g.name}</Text>
                    <Text variant="footnote" tone="secondary">
                      {members.length ? members.map((m) => m.name).join(' · ') : 'No payment methods yet'}
                    </Text>
                  </View>
                  <Icon name="create-outline" size={18} tone="tertiary" />
                </Row>
                <Row gap={spacing.xl} style={{ marginTop: spacing.md }}>
                  {s.cashCount ? <Figure label="Cash" value={money(s.cash)} /> : null}
                  {s.cardCount ? (
                    <Figure label="Owed on cards" value={money(s.owed)} tone="negative" />
                  ) : null}
                  {s.cardCount && s.creditLimit ? (
                    <Figure label="Credit available" value={money(s.availableCredit)} tone="positive" />
                  ) : null}
                </Row>
              </Card>
            );
          })}
        </View>
      )}

      <GroupEditor group={editing} accounts={all} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <View>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text style={typography.headline} tone={tone ?? 'primary'}>
        {value}
      </Text>
    </View>
  );
}

function GroupEditor({
  group,
  accounts,
  onClose,
}: {
  group: BalanceGroup | 'new' | null;
  accounts: ReturnType<typeof useAccounts>['data'] & object;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const existing = group && group !== 'new' ? group : null;
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const save = useAppMutation(() => saveBalanceGroup({ id: existing?.id, name, accountIds: picked }), {
    context: 'balance-groups.save',
    invalidate: [qk.balanceGroups],
    success: existing ? 'Group saved' : 'Group created',
    onSuccess: onClose,
  });
  const remove = useAppMutation(() => (existing ? deleteBalanceGroup(existing.id) : Promise.resolve()), {
    context: 'balance-groups.delete',
    invalidate: [qk.balanceGroups],
    success: 'Group deleted',
    onSuccess: onClose,
  });

  return (
    <Modal
      visible={group !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onShow={() => {
        setName(existing?.name ?? '');
        setPicked(existing?.accountIds ?? []);
      }}
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
        }}
      >
        <Row justify="space-between" style={{ marginBottom: spacing.xl }}>
          <Text variant="title">{existing ? 'Edit group' : 'New group'}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text variant="bodyStrong" tone="brand">
              Cancel
            </Text>
          </Pressable>
        </Row>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="Total cash" maxLength={40} />
        <Text variant="subhead" tone="secondary" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
          Payment methods in this group
        </Text>
        {accounts.length === 0 ? (
          <Text variant="footnote" tone="secondary">
            Add a payment method first.
          </Text>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {accounts.map((a, i) => {
              const on = picked.includes(a.id);
              const v = accountVisual(a);
              return (
                <View key={a.id}>
                  {i > 0 ? <Divider inset={48} /> : null}
                  <Pressable
                    onPress={() => setPicked((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={a.name}
                    style={{ paddingVertical: spacing.md }}
                  >
                    <Row gap={spacing.md}>
                      <CategoryAvatar icon={v.icon} color={a.color ?? colors.brand} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text variant="body">{a.name}</Text>
                        <Text variant="footnote" tone="secondary">
                          {ACCOUNT_TYPE_LABELS[a.type]}
                        </Text>
                      </View>
                      <Icon
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={on ? colors.brand : colors.borderStrong}
                      />
                    </Row>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        )}
        <View style={{ flex: 1 }} />
        <View style={{ gap: spacing.sm }}>
          <Button
            title="Save"
            disabled={!name.trim()}
            loading={save.isPending}
            onPress={() => save.mutate(undefined)}
          />
          {existing ? (
            <Button
              title="Delete group"
              variant="ghost"
              onPress={() =>
                Alert.alert(`Delete “${existing.name}”?`, 'Your payment methods aren’t affected.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(undefined) },
                ])
              }
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
