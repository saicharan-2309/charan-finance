/**
 * Animated category avatar.
 *
 * Every category gets a small visual identity: its icon on a tint of its own
 * colour, with a short motion signature chosen to suit what the icon is —
 * a plate bobs, a car drives, an aeroplane lifts, recurring arrows turn, a
 * heart beats. Vector only (an icon glyph plus transforms), so there are no
 * image assets to download and nothing heavier than a transform per frame.
 *
 * Motion rules:
 *   · it plays once when the avatar appears, and loops gently only while
 *     `active` (the category is selected), so lists stay still
 *   · every transform is tiny — a few degrees or a couple of points
 *   · "Reduce Motion" turns all of it off, leaving the static avatar
 *
 * The colour is used exactly as the design asks: a soft tinted background and
 * a coloured glyph, never a whole coloured card.
 */
import { memo, useEffect } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAnimatedValue } from '@/lib/animation';

import { Icon } from '@/components/ui/primitives';
import { useReducedMotion } from '@/components/ui/feedback';
import { useTheme } from '@/theme/ThemeProvider';

/** How an avatar moves. Picked from the icon, so new categories get one too. */
export type Motion = 'bob' | 'drive' | 'lift' | 'turn' | 'beat' | 'tick' | 'sway' | 'shimmer';

const MOTION_BY_ICON: Record<string, Motion> = {
  'fast-food-outline': 'bob',
  'restaurant-outline': 'bob',
  'basket-outline': 'sway',
  'bag-handle-outline': 'sway',
  'cart-outline': 'drive',
  'car-outline': 'drive',
  'speedometer-outline': 'drive',
  'bus-outline': 'drive',
  'airplane-outline': 'lift',
  'boat-outline': 'sway',
  'repeat-outline': 'turn',
  repeat: 'turn',
  'sync-outline': 'turn',
  'swap-horizontal': 'turn',
  'medkit-outline': 'beat',
  'heart-outline': 'beat',
  'fitness-outline': 'beat',
  'barbell-outline': 'bob',
  'calendar-number-outline': 'tick',
  'calendar-outline': 'tick',
  'receipt-outline': 'tick',
  'film-outline': 'shimmer',
  'sparkles-outline': 'shimmer',
  'gift-outline': 'bob',
  'trending-up-outline': 'lift',
  'flash-outline': 'shimmer',
  'home-outline': 'bob',
  'school-outline': 'bob',
  'shield-checkmark-outline': 'beat',
  'briefcase-outline': 'sway',
  'trophy-outline': 'shimmer',
  'laptop-outline': 'tick',
  'cash-outline': 'bob',
  'pie-chart-outline': 'turn',
};

export function motionFor(icon: string | null | undefined): Motion {
  if (!icon) return 'bob';
  return MOTION_BY_ICON[icon] ?? 'bob';
}

/**
 * Each signature is one 0→1 driver mapped onto a couple of small transforms.
 * `0.5` is the rest position for the ones that go back and forth.
 */
function transformsFor(motion: Motion, a: Animated.Value) {
  const range = (out: [number, number, number]) =>
    a.interpolate({ inputRange: [0, 0.5, 1], outputRange: out });
  switch (motion) {
    case 'drive':
      return [{ translateX: range([-2.5, 0, 2.5]) }, { rotate: rotateRange(a, ['-3deg', '0deg', '3deg']) }];
    case 'lift':
      return [{ translateY: range([1.5, 0, -2.5]) }, { rotate: rotateRange(a, ['2deg', '0deg', '-6deg']) }];
    case 'turn':
      return [{ rotate: rotateRange(a, ['0deg', '180deg', '360deg']) }];
    case 'beat':
      return [{ scale: range([0.94, 1, 1.1]) }];
    case 'tick':
      return [{ rotate: rotateRange(a, ['-4deg', '0deg', '4deg']) }, { translateY: range([0.5, 0, -0.5]) }];
    case 'sway':
      return [{ rotate: rotateRange(a, ['-6deg', '0deg', '6deg']) }];
    case 'shimmer':
      return [{ scale: range([0.95, 1, 1.08]) }, { rotate: rotateRange(a, ['-5deg', '0deg', '5deg']) }];
    case 'bob':
    default:
      return [{ translateY: range([1.5, 0, -2]) }, { scale: range([0.98, 1, 1.04]) }];
  }
}

const rotateRange = (a: Animated.Value, out: [string, string, string]) =>
  a.interpolate({ inputRange: [0, 0.5, 1], outputRange: out });

export interface CategoryAvatarProps {
  icon: string | null | undefined;
  color?: string | null;
  size?: number;
  /** Loops the motion gently — use for the selected category. */
  active?: boolean;
  /** Plays the motion once on mount (a row appearing in a list). */
  animateOnMount?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const CategoryAvatar = memo(function CategoryAvatar({
  icon,
  color,
  size = 42,
  active = false,
  animateOnMount = false,
  style,
}: CategoryAvatarProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const a = useAnimatedValue(0.5);
  const motion = motionFor(icon);
  const tint = color ?? colors.textSecondary;

  useEffect(() => {
    if (reduced) {
      a.setValue(0.5);
      return;
    }
    const spin = motion === 'turn';
    if (active) {
      // A slow there-and-back, or a full rotation for the recurring arrows.
      a.setValue(spin ? 0 : 0.5);
      const loop = Animated.loop(
        spin
          ? Animated.timing(a, {
              toValue: 1,
              duration: 2600,
              easing: Easing.linear,
              useNativeDriver: true,
            })
          : Animated.sequence([
              Animated.timing(a, {
                toValue: 1,
                duration: 900,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(a, {
                toValue: 0,
                duration: 900,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(a, {
                toValue: 0.5,
                duration: 450,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.delay(1200),
            ]),
      );
      loop.start();
      return () => loop.stop();
    }
    if (animateOnMount) {
      a.setValue(motion === 'turn' ? 0.35 : 0.1);
      const once = Animated.spring(a, {
        toValue: motion === 'turn' ? 0.5 : 0.5,
        friction: 6,
        tension: 90,
        useNativeDriver: true,
      });
      once.start();
      return () => once.stop();
    }
    a.setValue(0.5);
    return undefined;
  }, [a, active, animateOnMount, motion, reduced]);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.32,
          borderCurve: 'continuous',
          backgroundColor: `${tint}1F`,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View style={{ transform: transformsFor(motion, a) }}>
        <Icon name={icon} size={size * 0.5} color={tint} />
      </Animated.View>
    </View>
  );
});
