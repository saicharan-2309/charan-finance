import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

import { Button, SegmentedControl, TextField } from '@/components/ui/controls';
import { Text } from '@/components/ui/primitives';
import { parseAmountInput, sanitizeAmountKeystrokes, type Minor } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * Small modal for entering an amount (reconcile balance, goal contribution).
 * `signOptions` lets the user choose positive/negative explicitly.
 */
export function AmountPrompt({
  visible,
  title,
  message,
  confirmLabel = 'Save',
  initial = '',
  signOptions,
  withNote,
  loading,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  initial?: string;
  signOptions?: [string, string];
  withNote?: boolean;
  loading?: boolean;
  onSubmit: (amount: Minor, note: string | null) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(initial);
  const [negative, setNegative] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const v = parseAmountInput(text);
    if (v === null) return setError('Enter a valid amount.');
    onSubmit((negative ? -v : v) as Minor, note.trim() || null);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        setText(initial);
        setNote('');
        setError(null);
        setNegative(false);
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.overlay, padding: spacing.xl }}
      >
        <Pressable
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        <View
          style={{
            backgroundColor: colors.surfaceElevated,
            borderRadius: radius.xxl,
            padding: spacing.xl,
            gap: spacing.lg,
          }}
        >
          <Text variant="headline">{title}</Text>
          {message ? (
            <Text variant="footnote" tone="secondary">
              {message}
            </Text>
          ) : null}
          {signOptions ? (
            <SegmentedControl
              value={negative ? 'neg' : 'pos'}
              onChange={(v) => setNegative(v === 'neg')}
              options={[
                { value: 'pos', label: signOptions[0] },
                { value: 'neg', label: signOptions[1] },
              ]}
            />
          ) : null}
          <TextField
            value={text}
            onChangeText={(t) => setText(sanitizeAmountKeystrokes(t))}
            keyboardType="decimal-pad"
            autoFocus
            placeholder="0"
            error={error}
          />
          {withNote ? (
            <TextField value={note} onChangeText={setNote} placeholder="Note (optional)" maxLength={200} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} size="md" />
            <Button title={confirmLabel} onPress={submit} loading={loading} style={{ flex: 1 }} size="md" />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
