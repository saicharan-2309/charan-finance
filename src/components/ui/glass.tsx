/**
 * Glass — Apple's material for controls that float over content.
 *
 *   · iOS 26+: real Liquid Glass (`expo-glass-effect`, included in Expo Go) —
 *     it refracts what is behind it and, when `interactive`, responds to touch
 *     with the system's own press highlight.
 *   · Older iOS: the system chrome blur (`expo-blur`), the material iOS used
 *     before Liquid Glass.
 *   · Web: a CSS backdrop blur; Android and everything else: a translucent
 *     surface.
 *
 * Use it for chrome and controls only (tab bar, segmented controls, chips,
 * round header buttons, keypads, toasts) — never as the background of a
 * content card. Give it a border radius; it clips to it.
 */
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { darkPalette, lightPalette } from '@/theme/tokens';

/** True where the system Liquid Glass material is available (iOS 26+). */
export const LIQUID_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function Glass({
  children,
  style,
  interactive = false,
  tint,
  variant = 'regular',
  forceScheme,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Liquid Glass reacts to touches (buttons, keys, chips). */
  interactive?: boolean;
  /** Optional tint colour mixed into the glass. */
  tint?: string;
  /** "clear" is more transparent — for glass laid over a rich background. */
  variant?: 'regular' | 'clear';
  /** Force the light or dark material (e.g. glass over the violet lock screen). */
  forceScheme?: 'light' | 'dark';
}) {
  const { colors, scheme } = useTheme();
  const mode = forceScheme ?? scheme;

  if (LIQUID_GLASS) {
    return (
      <GlassView
        style={[styles.clip, style]}
        glassEffectStyle={variant}
        isInteractive={interactive}
        tintColor={tint}
        colorScheme={mode}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View
      style={[
        styles.clip,
        { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.chromeStroke },
        Platform.OS === 'web'
          ? ({
              backgroundColor:
                tint ??
                (forceScheme === 'dark'
                  ? darkPalette.glassFill
                  : forceScheme === 'light'
                    ? lightPalette.glassFill
                    : colors.glassFill),
              backdropFilter: 'blur(20px) saturate(180%)',
            } as ViewStyle)
          : Platform.OS !== 'ios'
            ? { backgroundColor: tint ?? colors.chromeFill }
            : null,
        style,
      ]}
    >
      {Platform.OS === 'ios' ? (
        <BlurView
          tint={mode === 'dark' ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
          intensity={variant === 'clear' ? 60 : 90}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {Platform.OS === 'ios' && tint ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
