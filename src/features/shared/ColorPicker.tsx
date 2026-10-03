import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/primitives';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

/**
 * Muted swatches, the same family the default categories use: soft coral,
 * rose, lavender, indigo, blues, teals, greens, amber and warm grey. Chosen
 * to read as a quiet accent behind an icon rather than a block of colour.
 */
export const SWATCHES = [
  '#D97757',
  '#C97A86',
  '#A97BB5',
  '#7C77C6',
  '#5B87C4',
  '#4A8DA8',
  '#4F9690',
  '#4F9A6A',
  '#52977F',
  '#C09A5B',
  '#B8923F',
  '#8C8782',
];

export function ColorPicker({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {SWATCHES.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          accessibilityRole="button"
          accessibilityLabel={`Colour ${c}`}
          accessibilityState={{ selected: value === c }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: c,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: value === c ? 3 : 0,
            borderColor: colors.background,
          }}
        >
          {value === c ? <Icon name="checkmark" size={18} color="#FFFFFF" /> : null}
        </Pressable>
      ))}
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
