/**
 * CSV import with validation and preview. Nothing is written unless every row
 * is valid (or the user explicitly chooses to import only the valid rows after
 * seeing exactly which rows will be skipped and why).
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { ProgressBar, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useCategoryIndex, useCurrency } from '@/hooks/data';
import { importTemplateCsv, parseCsv, validateImport, type ImportResult } from '@/lib/csv';
import { describeError } from '@/lib/errors';
import { invalidateFinancialData } from '@/lib/query';
import { importRows, newImportIds } from '@/services/data-transfer';
import { spacing } from '@/theme/tokens';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function ImportScreen() {
  const toast = useToast();
  const currency = useCurrency();
  const accounts = useAccounts().data ?? [];
  const { index } = useCategoryIndex();
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);

  const choose = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', 'text/plain'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    if ((asset.size ?? 0) > MAX_FILE_BYTES) {
      toast.show('CSV files must be 5 MB or smaller.', 'error');
      return;
    }
    try {
      const text = await new File(asset.uri).text();
      const table = parseCsv(text);
      const r = validateImport(table, { accounts, categories: index.all });
      setFileName(asset.name);
      setResult(r);
      setIds(newImportIds(r.rows.length));
      setProgress(null);
    } catch (e) {
      toast.show(
        e instanceof Error && /CSV/.test(e.message) ? e.message : "That file couldn't be read as CSV.",
        'error',
      );
    }
  };

  const runImport = async () => {
    if (!result) return;
    setImporting(true);
    setProgress({ done: 0, total: result.rows.length });
    const out = await importRows(result.rows, ids, setProgress);
    setImporting(false);
    await invalidateFinancialData();
    if (out.failedAt !== null) {
      Alert.alert(
        'Import stopped',
        `${out.imported} of ${result.rows.length} rows were imported. Row ${out.failedAt} failed: ${describeError(out.error).message}\n\nTap Import again to retry from where it stopped — rows already imported are never duplicated. If the same row fails again, fix it in the file and re-import (skip rows already imported).`,
      );
    } else {
      toast.show(`Imported ${out.imported} transactions`);
      setResult(null);
      setFileName(null);
    }
  };

  const confirmImport = () => {
    if (!result) return;
    if (result.errors.length === 0) return void runImport();
    const skipped = new Set(result.errors.map((e) => e.rowNumber)).size;
    Alert.alert(
      `${skipped} row${skipped > 1 ? 's have' : ' has'} problems`,
      `Only ${result.rows.length} valid row${result.rows.length === 1 ? '' : 's'} will be imported; ${skipped} will be skipped (listed on screen). Fix the file and import again if you need them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Import ${result.rows.length} valid rows`, onPress: () => void runImport() },
      ],
    );
  };

  const shareTemplate = async () => {
    try {
      const f = new File(Paths.cache, 'charan-finance-import-template.csv');
      if (f.exists) f.delete();
      f.create();
      f.write(importTemplateCsv());
      await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch (e) {
      toast.show(describeError(e).message, 'error');
    }
  };

  const income = result?.rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0) ?? 0;
  const expense = result?.rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0) ?? 0;

  return (
    <Screen>
      <Card variant="muted" style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        <Text variant="bodyStrong">How it works</Text>
        <Text variant="footnote" tone="secondary">
          Columns: date, time, type (expense/income/transfer), amount, account, to_account, category,
          subcategory, merchant, notes, tags. Account and category names must match yours. Dates: YYYY-MM-DD
          or DD/MM/YYYY. Without a type column, negative amounts are expenses and positive amounts are income.
        </Text>
        <Button
          title="Get template CSV"
          variant="ghost"
          size="sm"
          icon="download-outline"
          onPress={() => void shareTemplate()}
          style={{ alignSelf: 'flex-start' }}
        />
      </Card>

      <Button
        title={fileName ? 'Choose a different file' : 'Choose CSV file'}
        icon="document-attach-outline"
        variant={fileName ? 'secondary' : 'primary'}
        onPress={() => void choose()}
        disabled={importing}
      />

      {result ? (
        <View style={{ marginTop: spacing.xxl }}>
          <Section title="Preview">
            <Card style={{ gap: spacing.md }}>
              <Text variant="footnote" tone="secondary">
                {fileName}
              </Text>
              <Row justify="space-between">
                <Text>Rows in file</Text>
                <Text variant="bodyStrong">{result.totalRows}</Text>
              </Row>
              <Row justify="space-between">
                <Text>Valid</Text>
                <Text variant="bodyStrong" tone="positive">
                  {result.rows.length}
                </Text>
              </Row>
              <Row justify="space-between">
                <Text>With errors</Text>
                <Text variant="bodyStrong" tone={result.errors.length ? 'negative' : 'primary'}>
                  {new Set(result.errors.map((e) => e.rowNumber)).size}
                </Text>
              </Row>
              <Divider />
              <Row justify="space-between">
                <Text tone="secondary">Income in file</Text>
                <MoneyText minor={income} currency={currency} tone="positive" />
              </Row>
              <Row justify="space-between">
                <Text tone="secondary">Expenses in file</Text>
                <MoneyText minor={expense} currency={currency} />
              </Row>
            </Card>
          </Section>

          {result.errors.length ? (
            <Section title="Problems found">
              <Card style={{ gap: spacing.sm }}>
                {result.errors.slice(0, 50).map((e, i) => (
                  <Row key={i} align="flex-start" gap={spacing.sm}>
                    <Icon name="alert-circle" size={16} tone="negative" />
                    <Text variant="footnote" style={{ flex: 1 }}>
                      {e.rowNumber > 0 ? `Row ${e.rowNumber}: ` : ''}
                      {e.message}
                    </Text>
                  </Row>
                ))}
                {result.errors.length > 50 ? (
                  <Text variant="footnote" tone="secondary">
                    …and {result.errors.length - 50} more.
                  </Text>
                ) : null}
              </Card>
            </Section>
          ) : null}

          {progress ? (
            <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
              <ProgressBar progress={progress.total ? progress.done / progress.total : 0} />
              <Text variant="footnote" tone="secondary">
                {progress.done} of {progress.total} imported
              </Text>
            </View>
          ) : null}

          {result.rows.length ? (
            <Button
              title={
                result.errors.length
                  ? `Import ${result.rows.length} valid rows…`
                  : `Import ${result.rows.length} transactions`
              }
              onPress={confirmImport}
              loading={importing}
            />
          ) : (
            <Text tone="negative">
              No valid rows to import. Fix the problems above and choose the file again.
            </Text>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
