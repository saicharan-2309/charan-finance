/**
 * Passcode entry in the style of the iPhone lock screen: six dots that fill as
 * digits are typed, and a 3 × 4 keypad of round glass keys. A wrong code
 * shakes the dots (and plays the error haptic). The bottom-left key can offer
 * Face ID; the bottom-right key deletes.
 *
 * Used by the lock screen (over the violet gradient, `onColor`) and by the
 * passcode set-up sheet in Security (on the normal background).
 */
import { useEffect, type ReactNode } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';

import { useAnimatedValue, useReducedMotion } from '@/lib/animation';
import { PASSCODE_LENGTH } from '@/lib/passcode';
import { useTheme } from '@/theme/ThemeProvider';
import { lightPalette, spacing } from '@/theme/tokens';
import { haptic } from './ui/controls';
import { Glass } from './ui/glass';
import { Icon, Text } from './ui/primitives';

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
];

export function PasscodePad({
  value,
  onChange,
  onComplete,
  shakeKey = 0,
  disabled = false,
  onColor = false,
  biometryIcon,
  onBiometry,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called once the last digit is typed. */
  onComplete: (code: string) => void;
  /** Change this number to shake the dots (wrong code). */
  shakeKey?: number;
  disabled?: boolean;
  /** Drawn over the violet gradient: white text, glass keys. */
  onColor?: boolean;
  /** Icon for the bottom-left key (e.g. "scan-outline" for Face ID); hidden when absent. */
  biometryIcon?: string;
  onBiometry?: () => void;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const shake = useAnimatedValue(0);
  const ink = onColor ? lightPalette.heroText : colors.text;
  const muted = onColor ? lightPalette.heroMuted : colors.textSecondary;

  useEffect(() => {
    if (!shakeKey || reduced) return;
    shake.setValue(0);
    Animated.timing(shake, {
      toValue: 1,
      duration: 420,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [shakeKey, reduced, shake]);

  const press = (digit: string) => {
    if (disabled || value.length >= PASSCODE_LENGTH) return;
    haptic.selection();
    const next = value + digit;
    onChange(next);
    if (next.length === PASSCODE_LENGTH) onComplete(next);
  };

  const key = (content: ReactNode, onPress: (() => void) | undefined, label: string, glass = true) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }], opacity: disabled ? 0.4 : 1 })}
    >
      {glass ? (
        <Glass
          interactive
          variant={onColor ? 'clear' : 'regular'}
          forceScheme={onColor ? 'dark' : undefined}
          style={{ width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' }}
        >
          {content}
        </Glass>
      ) : (
        <View style={{ width: 78, height: 78, alignItems: 'center', justifyContent: 'center' }}>
          {content}
        </View>
      )}
    </Pressable>
  );

  return (
    <View style={{ alignItems: 'center', gap: spacing.xxxl }}>
      <Animated.View
        accessible
        accessibilityLabel={`${value.length} of ${PASSCODE_LENGTH} digits entered`}
        style={{
          flexDirection: 'row',
          gap: 18,
          transform: [
            {
              translateX: shake.interpolate({
                inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1],
                outputRange: [0, -14, 12, -9, 6, -3, 0],
              }),
            },
          ],
        }}
      >
        {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
          <View
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 1.5,
              borderColor: ink,
              backgroundColor: i < value.length ? ink : 'transparent',
            }}
          />
        ))}
      </Animated.View>

      <View style={{ gap: spacing.lg }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ flexDirection: 'row', gap: 26 }}>
            {KEYS.slice(row * 3, row * 3 + 3).map(([d, letters]) =>
              key(
                <>
                  <Text style={{ color: ink, fontSize: 32, lineHeight: 36, fontWeight: '400' }}>{d}</Text>
                  {/* Always reserve the letter line so every digit sits at the same height. */}
                  <Text style={{ color: muted, fontSize: 10, fontWeight: '700', letterSpacing: 2 }}>
                    {letters || ' '}
                  </Text>
                </>,
                () => press(d),
                d,
              ),
            )}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 26 }}>
          {biometryIcon && onBiometry
            ? key(<Icon name={biometryIcon} size={30} color={ink} />, onBiometry, 'Use Face ID', false)
            : key(null, undefined, 'blank', false)}
          {key(<Text style={{ color: ink, fontSize: 32, lineHeight: 36 }}>0</Text>, () => press('0'), '0')}
          {key(
            <Icon name="backspace-outline" size={28} color={ink} />,
            value.length
              ? () => {
                  haptic.selection();
                  onChange(value.slice(0, -1));
                }
              : undefined,
            'Delete',
            false,
          )}
        </View>
      </View>
    </View>
  );
}
