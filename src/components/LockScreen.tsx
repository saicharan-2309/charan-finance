/**
 * The lock screen: the violet gradient with the brand mark, then either the
 * glass passcode keypad (app passcode on), a Face ID button (Face ID only),
 * or both — the keypad's bottom-left key offers Face ID again.
 *
 * Wrong codes shake the dots; after five, entry pauses with a live countdown.
 * "Forgot passcode?" signs out on this device after confirming — signing back
 * in with the account password is the way back in.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { attemptsBeforeLockout, formatWait } from '@/lib/passcode';
import type { VerifyResult } from '@/services/app-passcode';
import { lightPalette, spacing } from '@/theme/tokens';
import { BrandMark } from './BrandMark';
import { PasscodePad } from './PasscodePad';
import { haptic } from './ui/controls';
import { Glass } from './ui/glass';
import { GradientFill } from './ui/gradient';
import { Icon, Text } from './ui/primitives';

const P = lightPalette; // the lock screen always sits on the violet gradient

export function LockScreen({
  biometryLabel,
  passcode,
  onBiometrics,
  onPasscode,
  onForgot,
}: {
  /** "Face ID" / "Touch ID" / "Passcode" when Face ID is on; null when it's off. */
  biometryLabel: string | null;
  /** The app passcode is on. */
  passcode: boolean;
  onBiometrics: () => void;
  onPasscode: (code: string) => Promise<VerifyResult>;
  onForgot: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [shake, setShake] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);

  const waiting = lockedUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  const bioIcon =
    biometryLabel === 'Face ID'
      ? 'scan-outline'
      : biometryLabel === 'Touch ID'
        ? 'finger-print-outline'
        : 'keypad-outline';
  const bioName = biometryLabel === 'Passcode' ? 'iPhone passcode' : biometryLabel;

  const submit = async (entered: string) => {
    setChecking(true);
    try {
      const r = await onPasscode(entered);
      if (r.ok) {
        haptic.success();
        return;
      }
      haptic.error();
      setShake((s) => s + 1);
      setCode('');
      const left = attemptsBeforeLockout(r.lockout.failures);
      setLockedUntil(r.lockout.lockedUntil);
      setNow(Date.now());
      setMessage(
        r.lockout.lockedUntil > Date.now()
          ? null
          : left <= 2
            ? `Wrong passcode · ${left} ${left === 1 ? 'try' : 'tries'} before a pause`
            : 'Wrong passcode',
      );
    } finally {
      setChecking(false);
    }
  };

  const forgot = () =>
    Alert.alert(
      'Forgot your app passcode?',
      'You’ll be signed out on this iPhone and the app passcode will be removed. Sign back in with your account email and password, then set a new passcode in Security. Your data stays safe on the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void onForgot() },
      ],
    );

  return (
    <View
      accessibilityViewIsModal
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: insets.top + spacing.huge,
        paddingBottom: insets.bottom + spacing.xl,
        paddingHorizontal: spacing.xxl,
      }}
    >
      <View style={StyleSheet.absoluteFill}>
        <GradientFill colors={P.heroGradient} sheen />
      </View>

      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <BrandMark size={64} />
        <Text variant="title" align="center" style={{ color: P.heroText }}>
          {passcode ? 'Enter passcode' : 'BUD is locked'}
        </Text>
        <Text variant="callout" align="center" style={{ color: P.heroMuted, minHeight: 21 }}>
          {waiting
            ? `Too many attempts. Try again in ${formatWait(Math.ceil((lockedUntil - now) / 1000))}.`
            : (message ?? (passcode ? 'Your BUD passcode' : `Unlock with ${bioName}`))}
        </Text>
      </View>

      {passcode ? (
        <PasscodePad
          value={code}
          onChange={setCode}
          onComplete={(c) => void submit(c)}
          shakeKey={shake}
          disabled={waiting || checking}
          onColor
          biometryIcon={biometryLabel ? bioIcon : undefined}
          onBiometry={biometryLabel ? onBiometrics : undefined}
        />
      ) : (
        <Pressable
          onPress={onBiometrics}
          accessibilityRole="button"
          accessibilityLabel={`Unlock with ${bioName}`}
          style={({ pressed }) => ({ alignSelf: 'stretch', transform: [{ scale: pressed ? 0.97 : 1 }] })}
        >
          <Glass
            interactive
            variant="clear"
            forceScheme="dark"
            style={{
              height: 58,
              borderRadius: 29,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
            }}
          >
            <Icon name={bioIcon} size={22} color={P.heroText} />
            <Text variant="bodyStrong" style={{ color: P.heroText }}>
              Unlock with {bioName}
            </Text>
          </Glass>
        </Pressable>
      )}

      {passcode ? (
        <Pressable onPress={forgot} hitSlop={12} accessibilityRole="button">
          <Text variant="subhead" style={{ color: P.heroText }}>
            Forgot passcode?
          </Text>
        </Pressable>
      ) : (
        <View />
      )}
    </View>
  );
}
