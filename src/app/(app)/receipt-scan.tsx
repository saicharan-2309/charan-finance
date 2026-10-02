/**
 * Receipt capture → private upload → OCR → SUGGESTION.
 * Nothing is recorded here: the user reviews every field in the transaction
 * form and explicitly saves.
 */
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { EmptyState, useToast } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { pickReceipt } from '@/features/receipts/pickReceipt';
import { useCategoryIndex, useMerchants } from '@/hooks/data';
import { formatShortDate } from '@/lib/dates';
import { describeError, logError } from '@/lib/errors';
import { formatMoney, toDecimalString } from '@/lib/money';
import { parseReceiptText, type ReceiptSuggestion } from '@/lib/receipt-parser';
import {
  AttachmentError,
  deleteAttachment,
  prepareReceipt,
  runReceiptOcr,
  saveOcrResult,
  uploadReceipt,
  type LocalFile,
} from '@/services/attachments';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { Attachment } from '@/types/domain';

type Stage = 'idle' | 'uploading' | 'reading' | 'review';

export default function ReceiptScan() {
  const { colors } = useTheme();
  const toast = useToast();
  const merchants = useMerchants().data ?? [];
  const { index } = useCategoryIndex();
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<LocalFile | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [suggestion, setSuggestion] = useState<ReceiptSuggestion | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);

  const start = async (source?: 'camera' | 'library' | 'files') => {
    const picked = await pickReceipt(source);
    if (!picked) return;
    setFile(picked);
    setStage('uploading');
    try {
      const prepared = await prepareReceipt(picked);
      const att = await uploadReceipt(prepared, null);
      setAttachment(att);
      if (prepared.mimeType === 'application/pdf') {
        setOcrNote('PDF attached. Text recognition works on photos — enter the details on the next screen.');
        setStage('review');
        return;
      }
      setStage('reading');
      const ocr = await runReceiptOcr(att.storagePath);
      if (ocr.status === 'ok') {
        const s = parseReceiptText(
          ocr.text,
          merchants.map((m) => ({ id: m.id, name: m.name, defaultCategoryId: m.defaultCategoryId })),
          index.all.map((c) => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId })),
        );
        setSuggestion(s);
        await saveOcrResult(att.id, {
          merchant: s.merchantName,
          amount: s.amount,
          date: s.date,
          currency: s.currency,
          confidence: s.confidence,
        }).catch(() => undefined);
        if (!s.amount && !s.merchantName)
          setOcrNote("Couldn't read much from this receipt. Please enter the details.");
      } else if (ocr.status === 'not_configured') {
        setOcrNote(
          'Text recognition isn’t set up for this server yet (see README → Receipt OCR). The receipt is saved — enter the details on the next screen.',
        );
      } else {
        setOcrNote(ocr.message);
      }
      setStage('review');
    } catch (e) {
      logError('scan', e);
      toast.show(e instanceof AttachmentError ? e.message : describeError(e).message, 'error');
      setStage('idle');
      setFile(null);
    }
  };

  const discard = async () => {
    if (attachment) await deleteAttachment(attachment).catch(() => undefined);
    router.back();
  };

  const proceed = () => {
    if (!attachment) return;
    router.replace({
      pathname: '/transaction/new',
      params: {
        attachmentId: attachment.id,
        ...(suggestion?.amount ? { amount: toDecimalString(suggestion.amount) } : {}),
        ...(suggestion?.date ? { date: suggestion.date } : {}),
        ...(suggestion?.merchantName ? { merchant: suggestion.merchantName } : {}),
        ...(suggestion?.categoryId ? { categoryId: suggestion.categoryId } : {}),
      },
    });
  };

  if (stage === 'idle') {
    return (
      <Screen>
        <Stack.Screen
          options={{
            headerLeft: () => (
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <Text tone="secondary">Cancel</Text>
              </Pressable>
            ),
          }}
        />
        <EmptyState
          icon="scan-outline"
          title="Scan a receipt"
          message="Take a photo or choose one. We'll read the merchant, amount and date, and you'll confirm everything before it's saved."
        />
        <View style={{ gap: spacing.md }}>
          <Button title="Take photo" icon="camera-outline" onPress={() => void start('camera')} />
          <Button
            title="Choose from library"
            icon="images-outline"
            variant="secondary"
            onPress={() => void start('library')}
          />
          <Button
            title="Attach PDF"
            icon="document-outline"
            variant="ghost"
            onPress={() => void start('files')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        stage === 'review' ? (
          <View style={{ gap: spacing.sm }}>
            <Button title="Review & save transaction" onPress={proceed} />
            <Button title="Discard" variant="ghost" size="md" onPress={() => void discard()} />
          </View>
        ) : undefined
      }
    >
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={() => void discard()} hitSlop={10}>
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />
      {file && file.mimeType !== 'application/pdf' ? (
        <Image
          source={{ uri: file.uri }}
          style={{
            width: '100%',
            height: 280,
            borderRadius: radius.xl,
            backgroundColor: colors.surfaceMuted,
          }}
          contentFit="contain"
        />
      ) : (
        <View
          style={{
            height: 120,
            borderRadius: radius.xl,
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="document-text-outline" size={40} tone="secondary" />
        </View>
      )}

      {stage !== 'review' ? (
        <Row gap={spacing.md} style={{ marginTop: spacing.xl, justifyContent: 'center' }}>
          <ActivityIndicator />
          <Text tone="secondary">{stage === 'uploading' ? 'Uploading securely…' : 'Reading receipt…'}</Text>
        </Row>
      ) : (
        <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
          {suggestion && (suggestion.amount || suggestion.merchantName || suggestion.date) ? (
            <Card style={{ paddingVertical: spacing.xs }}>
              <Field
                label="Merchant"
                value={suggestion.merchantName}
                confidence={suggestion.confidence.merchant}
              />
              <Divider />
              <Field
                label="Amount"
                value={
                  suggestion.amount
                    ? formatMoney(suggestion.amount, suggestion.currency ?? 'INR', { decimals: 'always' })
                    : null
                }
                confidence={suggestion.confidence.amount}
              />
              <Divider />
              <Field
                label="Date"
                value={suggestion.date ? formatShortDate(suggestion.date) : null}
                confidence={suggestion.confidence.date}
              />
              <Divider />
              <Field
                label="Category"
                value={suggestion.categoryId ? (index.byId.get(suggestion.categoryId)?.name ?? null) : null}
                confidence={suggestion.categoryId ? 0.6 : 0}
              />
            </Card>
          ) : null}
          {suggestion?.currency && suggestion.currency !== 'INR' ? (
            <Text variant="footnote" tone="warning">
              This receipt looks like it’s in {suggestion.currency}. Choose an account in that currency, or
              convert the amount yourself.
            </Text>
          ) : null}
          {ocrNote ? (
            <Text variant="footnote" tone="secondary">
              {ocrNote}
            </Text>
          ) : null}
          <Text variant="footnote" tone="secondary">
            These are suggestions. You’ll check and edit every field before anything is saved.
          </Text>
        </View>
      )}
    </Screen>
  );
}

function Field({ label, value, confidence }: { label: string; value: string | null; confidence: number }) {
  const low = value !== null && confidence < 0.6;
  return (
    <Row justify="space-between" style={{ paddingVertical: spacing.md }}>
      <Text variant="callout" tone="secondary">
        {label}
      </Text>
      <Row gap={6}>
        {low ? <Icon name="alert-circle-outline" size={14} tone="warning" /> : null}
        <Text variant="callout" tone={value ? (low ? 'warning' : 'primary') : 'tertiary'}>
          {value ?? 'Not found'}
        </Text>
      </Row>
    </Row>
  );
}
