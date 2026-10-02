import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { useToast } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Text } from '@/components/ui/primitives';
import { describeError, logError } from '@/lib/errors';
import { exportJson, exportTransactionsCsv } from '@/services/data-transfer';
import { spacing } from '@/theme/tokens';

export default function ExportScreen() {
  const toast = useToast();
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);

  const run = async (kind: 'csv' | 'json') => {
    setBusy(kind);
    try {
      if (kind === 'csv') {
        const n = await exportTransactionsCsv();
        toast.show(`Exported ${n} transactions`);
      } else {
        await exportJson();
      }
    } catch (e) {
      logError('export', e);
      toast.show(describeError(e).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={{ gap: spacing.lg }}>
        <Card style={{ gap: spacing.sm }}>
          <Text variant="headline">Transactions (CSV)</Text>
          <Text variant="footnote" tone="secondary">
            Every transaction with date, type, amount, account, category, merchant, notes and tags. Opens in
            Excel, Numbers or Google Sheets, and can be re-imported.
          </Text>
          <Button
            title="Export CSV"
            icon="share-outline"
            onPress={() => void run('csv')}
            loading={busy === 'csv'}
            disabled={busy !== null}
          />
        </Card>
        <Card style={{ gap: spacing.sm }}>
          <Text variant="headline">Full backup (JSON)</Text>
          <Text variant="footnote" tone="secondary">
            Everything in your account: accounts, categories, merchants, transactions, tags, recurring items,
            budgets, goals and net-worth history. Receipt images are not included.
          </Text>
          <Button
            title="Export JSON"
            icon="share-outline"
            variant="secondary"
            onPress={() => void run('json')}
            loading={busy === 'json'}
            disabled={busy !== null}
          />
        </Card>
        <Text variant="footnote" tone="secondary">
          Exports contain your financial data. Share them only with places you trust.
        </Text>
      </View>
    </Screen>
  );
}
