/**
 * Foundational primitives: Text, Icon, Card, Divider, Spacer, MoneyText.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { formatMoney, type FormatOptions } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import {
  continuous,
  radius,
  spacing,
  typography,
  type Palette,
  type TypographyVariant,
} from '@/theme/tokens';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'brand'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'inverse'
  | 'onBrand'
  | 'transfer';

const toneColor = (c: Palette, tone: TextTone) =>
  ({
    primary: c.text,
    secondary: c.textSecondary,
    tertiary: c.textTertiary,
    brand: c.brand,
    positive: c.positive,
    negative: c.negative,
    warning: c.warning,
    inverse: c.textInverse,
    onBrand: c.onBrand,
    transfer: c.transfer,
  })[tone];

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', tone = 'primary', align, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[typography[variant], { color: toneColor(colors, tone), textAlign: align }, style]}
    />
  );
}

// ---------------------------------------------------------------------------
// Icon (Ionicons — names are validated so a typo renders a safe fallback)
// ---------------------------------------------------------------------------
export type IconName = ComponentProps<typeof Ionicons>['name'];

export function iconName(name: string | null | undefined, fallback: IconName = 'ellipse-outline'): IconName {
  return name && name in Ionicons.glyphMap ? (name as IconName) : fallback;
}

export function Icon({
  name,
  size = 20,
  color,
  tone = 'primary',
  style,
}: {
  name: string | null | undefined;
  size?: number;
  color?: string;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Ionicons name={iconName(name)} size={size} color={color ?? toneColor(colors, tone)} style={style} />
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  variant?: 'elevated' | 'outlined' | 'muted';
  onPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
}

export function Card({
  children,
  style,
  padded = true,
  variant = 'outlined',
  onPress,
  accessibilityLabel,
}: CardProps) {
  const { colors, scheme, elevation } = useTheme();
  // No borders: a white card floats on the grey canvas on a soft, wide shadow
  // in light mode, and lifts by tone alone in dark mode. "elevated" floats
  // higher; "muted" sits flat in the canvas.
  const base: ViewStyle = {
    backgroundColor: variant === 'muted' ? colors.surfaceMuted : colors.surface,
    borderRadius: radius.xl,
    ...continuous,
    padding: padded ? spacing.lg : 0,
    ...(scheme === 'light' && variant !== 'muted'
      ? variant === 'elevated'
        ? elevation.floating
        : elevation.card
      : null),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginLeft: inset },
        style,
      ]}
    />
  );
}

export function Spacer({ size = spacing.lg }: { size?: number }) {
  return <View style={{ height: size, width: size }} />;
}

export function Row({
  children,
  gap = spacing.sm,
  align = 'center',
  justify,
  style,
  wrap,
}: {
  children: ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : undefined,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
export interface MoneyTextProps extends Omit<TextProps, 'children'> {
  minor: number;
  currency?: string;
  options?: FormatOptions;
  /** Colour by sign: positive green, negative red. */
  colorBySign?: boolean;
}

export function MoneyText({
  minor,
  currency = 'INR',
  options,
  colorBySign,
  tone,
  variant = 'amount',
  ...rest
}: MoneyTextProps) {
  const t: TextTone = colorBySign
    ? minor > 0
      ? 'positive'
      : minor < 0
        ? 'negative'
        : 'primary'
    : (tone ?? 'primary');
  const text = formatMoney(minor, currency, options);
  return (
    <Text variant={variant} tone={t} accessibilityLabel={text.replace('−', 'minus ')} {...rest}>
      {text}
    </Text>
  );
}

/** Squircle icon badge used for categories, accounts and insights. */
export function IconBadge({
  icon,
  color,
  size = 40,
  iconSize,
}: {
  icon: string | null | undefined;
  color?: string | null;
  size?: number;
  iconSize?: number;
}) {
  const { colors } = useTheme();
  const tint = color ?? colors.textSecondary;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        ...continuous,
        backgroundColor: `${tint}1F`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={iconSize ?? size * 0.5} color={tint} />
    </View>
  );
}
