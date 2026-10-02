/**
 * Interactive controls: Button, IconButton, TextField, SegmentedControl, Chip,
 * SwitchRow, ListRow.
 */
import * as Haptics from 'expo-haptics';
import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, typography } from '@/theme/tokens';
import { Icon, Text, type TextTone } from './primitives';

export const haptic = {
  light: () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  success: () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  error: () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  },
  selection: () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  },
};

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg' | 'sm';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'lg',
  style,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useTheme();
  const palette = {
    primary: {
      bg: colors.brand,
      bgPressed: colors.brandPressed,
      fg: 'onBrand' as TextTone,
      border: 'transparent',
    },
    secondary: {
      bg: colors.surfaceMuted,
      bgPressed: colors.border,
      fg: 'primary' as TextTone,
      border: 'transparent',
    },
    ghost: {
      bg: 'transparent',
      bgPressed: colors.surfaceMuted,
      fg: 'brand' as TextTone,
      border: 'transparent',
    },
    destructive: {
      bg: colors.negativeSoft,
      bgPressed: colors.border,
      fg: 'negative' as TextTone,
      border: 'transparent',
    },
  }[variant];
  const height = size === 'lg' ? 54 : size === 'md' ? 46 : 36;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={({ pressed }) => [
        {
          height,
          borderRadius: size === 'sm' ? radius.md : radius.lg,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.xl,
          backgroundColor: pressed ? palette.bgPressed : palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: isDisabled && !loading ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onBrand : colors.text} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} tone={palette.fg} /> : null}
          <Text variant={size === 'sm' ? 'subhead' : 'bodyStrong'} tone={palette.fg} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  size = 40,
  tone = 'primary',
  filled = true,
}: {
  icon: string;
  onPress: () => void;
  label: string;
  size?: number;
  tone?: TextTone;
  filled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled
          ? pressed
            ? colors.border
            : colors.surfaceMuted
          : pressed
            ? colors.surfaceMuted
            : 'transparent',
      })}
    >
      <Icon name={icon} size={size * 0.5} tone={tone} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------
export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  helper?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, helper, leading, trailing, containerStyle, style, editable = true, ...rest },
  ref,
) {
  const { colors } = useTheme();
  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      {label ? (
        <Text variant="subhead" tone="secondary">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: error ? colors.negative : colors.border,
          backgroundColor: editable ? colors.surface : colors.surfaceMuted,
          paddingHorizontal: spacing.lg,
          gap: spacing.sm,
        }}
      >
        {leading}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={label}
          maxFontSizeMultiplier={1.5}
          {...rest}
          style={[typography.body, { flex: 1, color: colors.text, paddingVertical: spacing.md }, style]}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="footnote" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="footnote" tone="tertiary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  style,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, scheme } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 3 },
        style,
      ]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) haptic.selection();
              onChange(o.value);
            }}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: radius.sm + 2,
              alignItems: 'center',
              backgroundColor: selected
                ? scheme === 'dark'
                  ? colors.borderStrong
                  : colors.surface
                : 'transparent',
              ...(selected && scheme === 'light'
                ? {
                    shadowColor: '#000',
                    shadowOpacity: 0.08,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 1 },
                  }
                : null),
            }}
          >
            <Text variant="subhead" tone={selected ? 'primary' : 'secondary'} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------
export function Chip({
  label,
  selected,
  onPress,
  icon,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: string | null;
  color?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.md,
        height: 36,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.text : colors.border,
        backgroundColor: selected ? colors.text : pressed ? colors.surfaceMuted : colors.surface,
      })}
    >
      {icon ? (
        <Icon name={icon} size={16} color={selected ? colors.background : (color ?? colors.textSecondary)} />
      ) : null}
      <Text variant="subhead" style={{ color: selected ? colors.background : colors.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ListRow & SwitchRow
// ---------------------------------------------------------------------------
export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  accessibilityHint?: string;
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  value,
  onPress,
  chevron,
  destructive,
  accessibilityHint,
}: ListRowProps) {
  const { colors } = useTheme();
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        minHeight: 56,
      }}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" tone={destructive ? 'negative' : 'primary'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" tone="secondary" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {(chevron ?? !!onPress) ? <Icon name="chevron-forward" size={18} tone="tertiary" /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
        borderRadius: radius.md,
      })}
    >
      {content}
    </Pressable>
  );
}

export function SwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      chevron={false}
      trailing={
        <Switch
          value={value}
          onValueChange={(v) => {
            haptic.selection();
            onValueChange(v);
          }}
          disabled={disabled}
          trackColor={{ true: colors.brand, false: colors.borderStrong }}
          accessibilityLabel={title}
        />
      }
    />
  );
}
