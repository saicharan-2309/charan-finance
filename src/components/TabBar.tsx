/**
 * BUD's tab bar, in the iOS 26 style: a floating glass capsule with the four
 * destinations, and Add as its own round glass-edged button to the right —
 * the same height as the capsule and aligned to it, so there is nothing to
 * look off-centre (Add used to sit in the middle of five slots, which read as
 * slightly off between labelled icons).
 *
 *   ( Home · Activity · Friends · Reports )  ( + )
 *
 * Goals and More are still tabs (deep links keep working) but live on Home
 * and behind your avatar, which keeps the bar uncluttered.
 *
 * The selected tab sits on a soft lens that springs between slots; its icon
 * fills and its label turns brand blue. The capsule is real Liquid Glass on
 * iOS 26 and a system blur elsewhere. Tap Add for the add sheet; long-press it
 * to add an expense straight away.
 */
import type { Tabs } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { router } from 'expo-router';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAnimatedValue, useReducedMotion } from '@/lib/animation';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, springs } from '@/theme/tokens';
import { haptic } from './ui/controls';
import { Glass } from './ui/glass';
import { GradientFill } from './ui/gradient';
import { Icon, Text } from './ui/primitives';
import { TAB_BAR_HEIGHT } from './ui/layout';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** The bar's order. */
const SHOWN: { name: string; label: string; icon: [string, string] }[] = [
  { name: 'index', label: 'Home', icon: ['home-outline', 'home'] },
  { name: 'transactions', label: 'Activity', icon: ['swap-vertical-outline', 'swap-vertical'] },
  { name: 'friends', label: 'Friends', icon: ['people-outline', 'people'] },
  { name: 'reports', label: 'Reports', icon: ['pie-chart-outline', 'pie-chart'] },
];
const INSET = 6;
const GAP = 10;

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, scheme, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const x = useAnimatedValue(0);
  const slot = width > 0 ? (width - INSET * 2) / SHOWN.length : 0;

  const current = state.routes[state.index]?.name;
  const lensSlot = SHOWN.findIndex((s) => s.name === current);

  useEffect(() => {
    if (!slot || lensSlot < 0) return;
    if (reduced) x.setValue(lensSlot * slot);
    else Animated.spring(x, { toValue: lensSlot * slot, useNativeDriver: true, ...springs.snappy }).start();
  }, [lensSlot, slot, reduced, x]);

  const tab = (s: (typeof SHOWN)[number]) => {
    const route = state.routes.find((r) => r.name === s.name);
    if (!route) return <View key={s.name} style={styles.item} />;
    const focused = current === s.name;
    const label = descriptors[route.key]?.options.title ?? s.label;
    const tint = focused ? colors.brand : colors.textSecondary;
    return (
      <Pressable
        key={s.name}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            haptic.selection();
            navigation.navigate(route.name, route.params);
          }
        }}
        style={({ pressed }) => [styles.item, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
      >
        <Icon name={focused ? s.icon[1] : s.icon[0]} size={22} color={tint} />
        <Text
          variant="caption"
          style={{ color: tint, fontSize: 10, lineHeight: 12, fontWeight: focused ? '700' : '500' }}
        >
          {s.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: Math.max(insets.bottom - 10, 10) }]}>
      {/* The four destinations */}
      <View style={[styles.shadow, { flex: 1 }, scheme === 'light' ? elevation.floating : null]}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.capsule}>
          <Glass style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.edge, { borderColor: colors.chromeStroke }]}
          />
          {slot && lensSlot >= 0 ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: INSET,
                bottom: INSET,
                left: INSET,
                width: slot,
                borderRadius: radius.pill,
                backgroundColor: colors.brandSoft,
                transform: [{ translateX: x }],
              }}
            />
          ) : null}
          <View style={styles.row}>{SHOWN.map(tab)}</View>
        </View>
      </View>

      {/* Add — its own button, the same height as the bar */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add"
        accessibilityHint="Add an expense, money in, a transfer or a split bill. Long press to add an expense straight away."
        onPress={() => {
          haptic.light();
          router.push('/add');
        }}
        onLongPress={() => {
          haptic.light();
          router.push('/transaction/new');
        }}
        style={({ pressed }) => [
          styles.add,
          elevation.hero(colors.hero),
          { transform: [{ scale: pressed ? 0.92 : 1 }] },
        ]}
      >
        <View style={styles.addInner}>
          <GradientFill colors={colors.heroGradient} sheen />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.addEdge, { borderColor: colors.heroTrack }]}
          />
          <Icon name="add" size={30} color={colors.heroText} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  shadow: { borderRadius: radius.pill },
  capsule: { height: TAB_BAR_HEIGHT, borderRadius: radius.pill, overflow: 'hidden' },
  edge: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', flex: 1, paddingHorizontal: INSET, alignItems: 'center' },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: TAB_BAR_HEIGHT - INSET * 2,
  },
  add: { width: TAB_BAR_HEIGHT, height: TAB_BAR_HEIGHT, borderRadius: TAB_BAR_HEIGHT / 2 },
  addInner: {
    flex: 1,
    borderRadius: TAB_BAR_HEIGHT / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEdge: {
    borderRadius: TAB_BAR_HEIGHT / 2,
    borderWidth: 1,
  },
});
