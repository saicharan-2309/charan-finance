import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { ErrorState, SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { pickReceipt } from '@/features/receipts/pickReceipt';
import { signedAmount, transactionTitle } from '@/features/transactions/TransactionRow';
import { useTransaction } from '@/hooks/data';
import { formatShortDate, formatTime } from '@/lib/dates';
import { describeError, logError } from '@/lib/errors';
import { submitDelete } from '@/lib/offline-queue';
import { invalidateFinancialData, qk, queryClient } from '@/lib/query';
import {
  AttachmentError,
  deleteAttachment,
  fetchAttachments,
  prepareReceipt,
  receiptUrl,
  uploadReceipt,
} from '@/services/attachments';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { Attachment } from '@/types/domain';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const tx = useTransaction(id);
  const attachments = useQuery({
    queryKey: qk.attachments(id),
    queryFn: () => fetchAttachments(id),
    enabled: !!id,
  });
  const [busy, setBusy] = useState(false);

  if (!tx.data) {
    return (
      <Screen>
        {tx.error ? (
          <ErrorState error={tx.error} onRetry={() => void tx.refetch()} />
        ) : tx.isPending ? (
          <SkeletonList rows={5} />
        ) : (
          <ErrorState error={new Error('CF207')} />
        )}
      </Screen>
    );
  }
  const t = tx.data;
  const amount = signedAmount(t);

  const confirmDelete = () =>
    Alert.alert('Delete transaction?', 'This updates your account balance and cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const r = await submitDelete(t.id, {
              type: t.type,
              amount: t.amount,
              currency: t.currency,
              title: `Delete: ${transactionTitle(t)}`,
              subtitle: t.accountName,
              occurredAt: t.occurredAt,
            });
            if (r.status === 'saved') await invalidateFinancialData();
            toast.show(
              r.status === 'saved' ? 'Transaction deleted' : 'Deletion will sync when you’re online',
              r.status === 'saved' ? 'success' : 'info',
            );
            router.back();
          } catch (e) {
            toast.show(describeError(e).message, 'error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const addReceipt = async () => {
    const file = await pickReceipt();
    if (!file) return;
    setBusy(true);
    try {
      await uploadReceipt(await prepareReceipt(file), t.id);
      await Promise.all([
        attachments.refetch(),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ]);
      toast.show('Receipt attached');
    } catch (e) {
      logError('upload-receipt', e);
      toast.show(e instanceof AttachmentError ? e.message : describeError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const details: [string, string, string?][] = [
    ['Date', formatShortDate(new Date(t.occurredAt))],
    ['Time', formatTime(t.occurredAt)],
    [t.type === 'transfer' ? 'From' : 'Account', t.accountName],
  ];
  if (t.type === 'transfer') details.push(['To', t.toAccountName ?? '']);
  if (t.categoryName)
    details.push([
      'Category',
      t.subcategoryName ? `${t.categoryName} › ${t.subcategoryName}` : t.categoryName,
    ]);
  if (t.merchantName) details.push(['Merchant', t.merchantName]);
  if (t.tagNames.length) details.push(['Tags', t.tagNames.map((x) => `#${x}`).join('  ')]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: '',
          headerRight:
            t.type === 'adjustment'
              ? undefined
              : () => (
                  <Pressable
                    onPress={() => router.push({ pathname: '/transaction/new', params: { id: t.id } })}
                    hitSlop={10}
                    accessibilityRole="button"
                  >
                    <Text variant="bodyStrong" tone="brand">
                      Edit
                    </Text>
                  </Pressable>
                ),
        }}
      />
      <View style={{ alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxl }}>
        <IconBadge
          icon={
            t.type === 'transfer'
              ? 'swap-horizontal'
              : t.type === 'adjustment'
                ? 'construct-outline'
                : t.categoryIcon
          }
          color={t.type === 'transfer' || t.type === 'adjustment' ? colors.transfer : t.categoryColor}
          size={64}
        />
        <Text variant="headline" align="center">
          {transactionTitle(t)}
        </Text>
        <MoneyText
          minor={amount}
          currency={t.currency}
          variant="display"
          tone={t.type === 'income' ? 'positive' : t.type === 'transfer' ? 'transfer' : 'primary'}
          options={{ signed: t.type === 'income', decimals: 'always' }}
        />
        <Text variant="caption" tone="secondary">
          {t.type === 'transfer'
            ? 'Transfer — not counted as income or expense'
            : t.type === 'adjustment'
              ? 'Balance adjustment — not counted as income or expense'
              : t.type === 'income'
                ? 'Income'
                : 'Expense'}
        </Text>
      </View>

      <Card style={{ paddingVertical: spacing.xs }}>
        {details.map(([label, value], i) => (
          <View key={label}>
            {i > 0 ? <Divider /> : null}
            <Row justify="space-between" style={{ paddingVertical: spacing.md }} gap={spacing.lg}>
              <Text variant="callout" tone="secondary">
                {label}
              </Text>
              <Text variant="callout" style={{ flex: 1, textAlign: 'right' }} selectable>
                {value}
              </Text>
            </Row>
          </View>
        ))}
      </Card>

      {t.notes ? (
        <Card style={{ marginTop: spacing.lg, gap: spacing.xs }}>
          <Text variant="caption" tone="secondary">
            Notes
          </Text>
          <Text variant="body" selectable>
            {t.notes}
          </Text>
        </Card>
      ) : null}

      {t.recurringId ? (
        <Card
          style={{ marginTop: spacing.lg }}
          onPress={() => router.push({ pathname: '/recurring/edit', params: { id: t.recurringId! } })}
        >
          <Row gap={spacing.md}>
            <Icon name="repeat" size={18} tone="secondary" />
            <Text variant="callout" style={{ flex: 1 }}>
              Created from a recurring item
            </Text>
            <Icon name="chevron-forward" size={16} tone="tertiary" />
          </Row>
        </Card>
      ) : null}

      {t.type !== 'transfer' && t.type !== 'adjustment' ? (
        <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
          <Text variant="headline">Receipts</Text>
          <ReceiptStrip attachments={attachments.data ?? []} onChanged={() => void attachments.refetch()} />
          <Button
            title="Attach receipt"
            icon="camera-outline"
            variant="secondary"
            size="md"
            onPress={addReceipt}
            loading={busy}
          />
        </View>
      ) : null}

      <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
        {t.type !== 'adjustment' ? (
          <Button
            title="Duplicate"
            icon="copy-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: '/transaction/new', params: { duplicate: t.id } })}
          />
        ) : null}
        <Button
          title="Delete transaction"
          icon="trash-outline"
          variant="destructive"
          onPress={confirmDelete}
          disabled={busy}
        />
      </View>
    </Screen>
  );
}

function ReceiptStrip({ attachments, onChanged }: { attachments: Attachment[]; onChanged: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const urls = useQuery({
    queryKey: ['receipt-urls', attachments.map((a) => a.id).join(',')],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(attachments.map(async (a) => [a.id, await receiptUrl(a.storagePath)] as const)),
      ),
    enabled: attachments.length > 0,
    staleTime: 4 * 60_000, // signed URLs last 5 minutes
  });
  if (attachments.length === 0) {
    return (
      <Text variant="footnote" tone="secondary">
        No receipts attached.
      </Text>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
      {attachments.map((a) => {
        const url = urls.data?.[a.id];
        return (
          <Pressable
            key={a.id}
            accessibilityRole="imagebutton"
            accessibilityLabel="Open receipt"
            onPress={() => url && void WebBrowser.openBrowserAsync(url)}
            onLongPress={() =>
              Alert.alert('Remove receipt?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteAttachment(a);
                      onChanged();
                    } catch (e) {
                      toast.show(describeError(e).message, 'error');
                    }
                  },
                },
              ])
            }
            style={{
              width: 96,
              height: 128,
              borderRadius: radius.md,
              overflow: 'hidden',
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {a.mimeType === 'application/pdf' ? (
              <Icon name="document-text-outline" size={32} tone="secondary" />
            ) : url ? (
              <Image
                source={{ uri: url }}
                style={{ width: 96, height: 128 }}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <Icon name="image-outline" size={28} tone="tertiary" />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
