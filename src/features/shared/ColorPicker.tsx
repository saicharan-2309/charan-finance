import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { haptic } from '@/components/ui/controls';
import { CardSwoosh, GradientFill } from '@/components/ui/gradient';
import { Icon, Row, Text } from '@/components/ui/primitives';
import { useTheme } from '@/theme/ThemeProvider';
import { BUD_SWATCHES, cardGradientFor, continuous, radius, spacing } from '@/theme/tokens';

/** Every colour a payment method or category can have: each swatch's standard and deeper shade. */
export const SWATCHES = BUD_SWATCHES.flatMap((s) => [s.base, s.deep]);

/** The swatch a stored colour belongs to (either shade), if it is one of ours. */
export function swatchFor(value: string | null | undefined) {
  const v = (value ?? '').toLowerCase();
  return BUD_SWATCHES.find((s) => s.base.toLowerCase() === v || s.deep.toLowerCase() === v) ?? null;
}

/**
 * BUD colour picker — compact, in the style of the iOS colour well.
 *
 *   [ mini card in the colour ]  Blue
 *                                ( Standard | Deeper )
 *   ● ● ● ● ● ● ● ● ● ● ●        one scrolling row of the logo palette
 *
 * The preview is drawn with `cardGradientFor`, the same function the Home card
 * carousel uses, so the colour you see here is exactly the one saved and shown
 * everywhere — nothing substitutes another colour later.
 */
export function ColorPicker({
  value,
  onChange,
  previewLabel,
  preview = 'badge',
}: {
  value: string | null;
  onChange: (c: string) => void;
  /** Text on the preview (e.g. the payment method's name). */
  previewLabel?: string;
  /** A mini bank card for payment methods; a round badge for categories and goals. */
  preview?: 'card' | 'badge';
}) {
  const { colors } = useTheme();
  const current = swatchFor(value);
  const [hue, setHue] = useState(current?.name ?? null);
  const active = current ?? BUD_SWATCHES.find((s) => s.name === hue) ?? null;
  const isDeep = !!current && current.deep.toLowerCase() === (value ?? '').toLowerCase();
  const grad = value ? cardGradientFor(value, colors.cardGradient) : null;
  const name = value
    ? active
      ? `${active.name}${isDeep ? ', deeper' : ''}`
      : 'Custom colour'
    : 'No colour yet';

  const pick = (c: string) => {
    haptic.selection();
    onChange(c);
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Row gap={spacing.lg}>
        {/* Preview */}
        <View
          accessibilityLabel={`Selected colour: ${name}`}
          style={{
            width: preview === 'card' ? 104 : 56,
            height: preview === 'card' ? 66 : 56,
            borderRadius: preview === 'card' ? radius.md : 28,
            ...continuous,
            overflow: 'hidden',
            backgroundColor: colors.fill,
            padding: spacing.sm,
            justifyContent: 'space-between',
          }}
        >
          {grad ? <GradientFill colors={grad} sheen /> : null}
          {grad && preview === 'card' ? <CardSwoosh opacity={0.14} /> : null}
          {preview === 'card' ? (
            <>
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: grad ? colors.heroText : colors.textSecondary, fontWeight: '700' }}
              >
                {previewLabel || 'Card'}
              </Text>
              <Text variant="caption" style={{ color: grad ? colors.heroMuted : colors.textTertiary }}>
                •••• 4242
              </Text>
            </>
          ) : null}
        </View>

        <View style={{ flex: 1, gap: spacing.sm }}>
          <Text variant="bodyStrong">{name}</Text>
          {active ? (
            <Row
              style={{
                alignSelf: 'flex-start',
                backgroundColor: colors.fill,
                borderRadius: radius.pill,
                padding: 3,
              }}
            >
              {(
                [
                  ['Standard', active.base],
                  ['Deeper', active.deep],
                ] as const
              ).map(([label, c]) => {
                const on = (value ?? '').toLowerCase() === c.toLowerCase();
                return (
                  <Pressable
                    key={label}
                    onPress={() => pick(c)}
                    accessibilityRole="radio"
                    accessibilityLabel={`${active.name}, ${label.toLowerCase()}`}
                    accessibilityState={{ selected: on }}
                    hitSlop={4}
                    style={{
                      paddingHorizontal: spacing.md,
                      height: 28,
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: on ? colors.surface : 'transparent',
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{
                        fontWeight: on ? '700' : '500',
                        color: on ? colors.text : colors.textSecondary,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          ) : (
            <Text variant="footnote" tone="secondary">
              Pick a colour below.
            </Text>
          )}
        </View>
      </Row>

      {/* One scrolling row of swatches, like the iOS colour well. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
        accessibilityRole="radiogroup"
      >
        {BUD_SWATCHES.map((s) => {
          const selected = current?.name === s.name;
          return (
            <Pressable
              key={s.name}
              onPress={() => {
                setHue(s.name);
                // Keep the chosen depth when moving to another hue.
                pick(isDeep ? s.deep : s.base);
              }}
              accessibilityRole="radio"
              accessibilityLabel={s.name}
              accessibilityState={{ selected }}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                padding: 3,
                borderWidth: 2,
                borderColor: selected ? s.base : 'transparent',
                transform: [{ scale: pressed ? 0.9 : 1 }],
              })}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 16,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GradientFill colors={[s.base, s.deep]} />
                {selected ? <Icon name="checkmark" size={16} color={colors.heroText} /> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
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
