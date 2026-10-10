/**
 * The reference design's recurring pieces (Charan's BUD mock-ups, Oct 10):
 *
 *   PageHeader  ‹  Transactions  ⚙      centred title, round glass buttons
 *   Pill        ( All ) ( Income )        navy capsule when selected, white otherwise
 *   RoundButton (🔔•)                      a white glass circle with an optional badge
 *
 * Visual only — every handler is the screen's own.
 */
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { haptic } from './controls';
import { Glass } from './glass';
import { Icon, Row, Text } from './primitives';

export function RoundButton({
  icon,
  label,
  onPress,
  badge,
  size = 40,
  color,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  /** A count, or true for a plain dot. */
  badge?: number | boolean;
  size?: number;
  color?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={typeof badge === 'number' && badge > 0 ? `${label}, ${badge}` : label}
      hitSlop={6}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}
    >
      <Glass
        interactive
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={Math.round(size * 0.5)} color={color ?? colors.text} />
      </Glass>
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: typeof badge === 'number' ? -2 : 6,
            right: typeof badge === 'number' ? -2 : 8,
            minWidth: typeof badge === 'number' ? 16 : 8,
            height: typeof badge === 'number' ? 16 : 8,
            borderRadius: 8,
            paddingHorizontal: typeof badge === 'number' ? 3 : 0,
            backgroundColor: colors.expense,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {typeof badge === 'number' ? (
            <Text variant="caption" style={{ color: colors.heroText, fontSize: 10, lineHeight: 12 }}>
              {badge > 9 ? '9+' : badge}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** Centred title with optional buttons either side, like the reference's screens. */
export function PageHeader({
  title,
  left,
  right,
  style,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ height: 44, justifyContent: 'center', marginBottom: spacing.lg }, style]}>
      <Text
        variant="headline"
        accessibilityRole="header"
        align="center"
        style={{ fontWeight: '700', fontSize: 20 }}
        numberOfLines={1}
      >
        {title}
      </Text>
      {left ? <View style={{ position: 'absolute', left: 0 }}>{left}</View> : null}
      {right ? <View style={{ position: 'absolute', right: 0 }}>{right}</View> : null}
    </View>
  );
}

/** A capsule chip: solid navy when selected, white with a hairline otherwise. */
export function Pill({
  label,
  selected,
  onPress,
  icon,
  trailingIcon,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: string;
  trailingIcon?: string;
  accessibilityLabel?: string;
}) {
  const { colors, scheme } = useTheme();
  const on = !!selected;
  const fg = on ? (scheme === 'dark' ? colors.textInverse : colors.heroText) : colors.text;
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        height: 36,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: on ? colors.text : colors.surface,
        borderWidth: on ? 0 : 1,
        borderColor: colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      <Text variant="subhead" style={{ color: fg, fontWeight: on ? '600' : '500', fontSize: 14 }}>
        {label}
      </Text>
      {trailingIcon ? <Icon name={trailingIcon} size={13} color={fg} /> : null}
    </Pressable>
  );
}

/** A row of pills on a soft track, like "Spending · Income · Savings · Net worth". */
export function PillRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Row gap={spacing.sm} wrap style={style}>
      {children}
    </Row>
  );
}
