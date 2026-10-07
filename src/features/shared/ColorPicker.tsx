import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { haptic } from '@/components/ui/controls';
import { GradientFill } from '@/components/ui/gradient';
import { Icon, Row, Text } from '@/components/ui/primitives';
import { useTheme } from '@/theme/ThemeProvider';
import { BUD_SWATCHES, continuous, radius, spacing } from '@/theme/tokens';

/** Every colour a payment method or category can have: each swatch's standard and deeper shade. */
export const SWATCHES = BUD_SWATCHES.flatMap((s) => [s.base, s.deep]);

/**
 * BUD colour picker. Large swatches from the BUD palette (the logo's greens
 * and silver, ink, and earthy companions), a shade row for the chosen hue,
 * and a live preview. Whatever is picked here is exactly what is saved and
 * shown everywhere — nothing substitutes another colour later.
 */
export function ColorPicker({
  value,
  onChange,
  previewLabel,
}: {
  value: string | null;
  onChange: (c: string) => void;
  /** Text on the preview card (e.g. the payment method's name). */
  previewLabel?: string;
}) {
  const { colors } = useTheme();
  const current =
    BUD_SWATCHES.find((s) => [s.base, s.deep].some((c) => c.toLowerCase() === (value ?? '').toLowerCase())) ??
    null;
  const [hue, setHue] = useState(current?.name ?? null);
  const active = BUD_SWATCHES.find((s) => s.name === (current?.name ?? hue)) ?? null;

  const pick = (c: string) => {
    haptic.selection();
    onChange(c);
  };

  return (
    <View style={{ gap: spacing.lg }}>
      {/* Preview */}
      <View
        style={{
          height: 64,
          borderRadius: radius.lg,
          ...continuous,
          overflow: 'hidden',
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
          backgroundColor: colors.fill,
        }}
        accessibilityLabel={value ? `Selected colour ${active?.name ?? value}` : 'No colour selected'}
      >
        {value ? <GradientFill colors={[value, active?.deep ?? value]} sheen /> : null}
        <Row justify="space-between">
          <Text variant="bodyStrong" style={{ color: value ? colors.heroText : colors.textSecondary }}>
            {previewLabel || (value ? (active?.name ?? 'Custom') : 'Pick a colour')}
          </Text>
          {value ? <Icon name="checkmark-circle" size={20} color={colors.heroText} /> : null}
        </Row>
      </View>

      {/* Swatches */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {BUD_SWATCHES.map((s) => {
          const selected = current?.name === s.name;
          return (
            <Pressable
              key={s.name}
              onPress={() => {
                setHue(s.name);
                pick(s.base);
              }}
              accessibilityRole="radio"
              accessibilityLabel={s.name}
              accessibilityState={{ selected }}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                borderRadius: 24,
                padding: 3,
                borderWidth: 2.5,
                borderColor: selected ? s.base : 'transparent',
                transform: [{ scale: pressed ? 0.9 : 1 }],
              })}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GradientFill colors={[s.base, s.deep]} />
                {selected ? <Icon name="checkmark" size={18} color={colors.heroText} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Shades of the chosen hue */}
      {active ? (
        <Row gap={spacing.sm}>
          {(
            [
              ['Standard', active.base],
              ['Deeper', active.deep],
            ] as const
          ).map(([label, c]) => {
            const selected = (value ?? '').toLowerCase() === c.toLowerCase();
            return (
              <Pressable
                key={label}
                onPress={() => pick(c)}
                accessibilityRole="radio"
                accessibilityLabel={`${active.name}, ${label.toLowerCase()}`}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  ...continuous,
                  backgroundColor: selected ? active.light : colors.surface,
                  borderWidth: selected ? 1.5 : 0,
                  borderColor: c,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: c }} />
                <Text variant="subhead" style={{ color: selected ? c : colors.text }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      ) : null}
    </View>
  );
}

export const ICON_CHOICES = [
  'fast-food-outline',
  'restaurant-outline',
  'cafe-outline',
  'basket-outline',
  'cart-outline',
  'bag-handle-outline',
  'shirt-outline',
  'car-outline',
  'bus-outline',
  'train-outline',
  'airplane-outline',
  'bicycle-outline',
  'home-outline',
  'flash-outline',
  'water-outline',
  'wifi-outline',
  'phone-portrait-outline',
  'tv-outline',
  'film-outline',
  'game-controller-outline',
  'musical-notes-outline',
  'book-outline',
  'school-outline',
  'medkit-outline',
  'fitness-outline',
  'barbell-outline',
  'paw-outline',
  'gift-outline',
  'heart-outline',
  'sparkles-outline',
  'briefcase-outline',
  'cash-outline',
  'card-outline',
  'wallet-outline',
  'trending-up-outline',
  'shield-checkmark-outline',
  'construct-outline',
  'leaf-outline',
  'laptop-outline',
  'receipt-outline',
  'repeat-outline',
  'ellipsis-horizontal-circle-outline',
];

export function IconPicker({
  value,
  color,
  onChange,
}: {
  value: string | null;
  color: string | null;
  onChange: (i: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {ICON_CHOICES.map((i) => {
        const selected = value === i;
        return (
          <Pressable
            key={i}
            onPress={() => onChange(i)}
            accessibilityRole="button"
            accessibilityLabel={i.replace(/-outline$/, '').replace(/-/g, ' ')}
            accessibilityState={{ selected }}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? `${color ?? colors.brand}26` : colors.surfaceMuted,
              borderWidth: selected ? 2 : 0,
              borderColor: color ?? colors.brand,
            }}
          >
            <Icon name={i} size={20} color={selected ? (color ?? colors.brand) : colors.textSecondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];
