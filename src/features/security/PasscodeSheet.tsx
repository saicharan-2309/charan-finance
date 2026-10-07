/**
 * Set, change or remove the app passcode, one keypad step at a time:
 *   create: new → confirm
 *   change: current → new → confirm
 *   remove: current
 * The current passcode is checked through the same lockout as the lock
 * screen, so this sheet can't be used to guess it either.
 */
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PasscodePad } from '@/components/PasscodePad';
import { haptic } from '@/components/ui/controls';
import { Text } from '@/components/ui/primitives';
import { formatWait, PASSCODE_PROBLEM_COPY, passcodeProblem } from '@/lib/passcode';
import { useAppLock } from '@/providers/AppLockProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export type PasscodeSheetMode = 'create' | 'change' | 'remove';
type Step = 'current' | 'new' | 'confirm';

const TITLES: Record<Step, string> = {
  current: 'Enter your current passcode',
  new: 'Choose a 6-digit passcode',
  confirm: 'Enter it once more',
};

export function PasscodeSheet({
  mode,
  onClose,
  onDone,
}: {
  mode: PasscodeSheetMode | null;
  onClose: () => void;
  /** Called with a short confirmation once the change is saved. */
  onDone: (message: string) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const lock = useAppLock();
  const [step, setStep] = useState<Step>(mode === 'create' ? 'new' : 'current');
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const reset = (m: PasscodeSheetMode | null) => {
    setStep(m === 'create' ? 'new' : 'current');
    setCode('');
    setFirst('');
    setError(null);
  };

  const fail = (message: string) => {
    haptic.error();
    setShake((s) => s + 1);
    setCode('');
    setError(message);
  };

  const complete = async (entered: string) => {
    setBusy(true);
    try {
      if (step === 'current') {
        const r = await lock.verifyPasscode(entered);
        if (!r.ok) {
          const wait = Math.ceil((r.lockout.lockedUntil - Date.now()) / 1000);
          fail(
            wait > 0
              ? `Too many attempts. Try again in ${formatWait(wait)}.`
              : 'That’s not your current passcode.',
          );
          return;
        }
        if (mode === 'remove') {
          await lock.removePasscode();
          haptic.success();
          onDone('App passcode turned off');
          return;
        }
        setStep('new');
        setCode('');
        setError(null);
        return;
      }
      if (step === 'new') {
        const problem = passcodeProblem(entered);
        if (problem) return fail(PASSCODE_PROBLEM_COPY[problem]);
        setFirst(entered);
        setStep('confirm');
        setCode('');
        setError(null);
        return;
      }
      if (entered !== first) {
        setStep('new');
        setFirst('');
        return fail('Those didn’t match. Choose your passcode again.');
      }
      await lock.savePasscode(entered);
      haptic.success();
      onDone(mode === 'change' ? 'App passcode changed' : 'App passcode is on');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={mode !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onShow={() => reset(mode)}
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
          paddingHorizontal: spacing.xl,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text variant="bodyStrong" tone="brand">
              Cancel
            </Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'space-evenly' }}>
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <Text variant="title" align="center" accessibilityRole="header">
              {mode === 'remove' && step === 'current' ? 'Turn off app passcode' : TITLES[step]}
            </Text>
            <Text
              variant="callout"
              tone={error ? 'negative' : 'secondary'}
              align="center"
              accessibilityLiveRegion="polite"
              style={{ minHeight: 42, maxWidth: 320 }}
            >
              {error ??
                (step === 'new'
                  ? 'You’ll use it to open Charan Finance. It’s separate from your iPhone passcode.'
                  : step === 'confirm'
                    ? 'Type the same six digits again.'
                    : ' ')}
            </Text>
          </View>
          <PasscodePad
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error && v.length === 1) setError(null);
            }}
            onComplete={(c) => void complete(c)}
            shakeKey={shake}
            disabled={busy}
          />
        </View>
      </View>
    </Modal>
  );
}
