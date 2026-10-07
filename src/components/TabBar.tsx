/**
 * BUD's tab bar: a floating glass capsule, inset from the screen edges and
 * lifted above the home indicator. Four destinations and the Add button sit
 * in five equal slots, so Add is exactly centred by construction (it used to
 * be the third of six slots, which put it left of centre).
 *
 *   Home · Activity · [ + ] · Friends · Reports
 *
 * Goals and More are still tabs (deep links keep working) but live on Home
 * and behind your avatar, which keeps the bar uncluttered.
 *
 * The selected tab sits on a soft lens that springs between slots. The
 * capsule is real Liquid Glass on iOS 26 and a system blur elsewhere.
 * Tap Add for the add sheet; long-press it to add an expense straight away.
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

/** The bar's order; the Add button goes between the second and third. */
const SHOWN: { name: string; label: string; icon: [string, string] }[] = [
  { name: 'index', label: 'Home', icon: ['home-outline', 'home'] },
  { name: 'transactions', label: 'Activity', icon: ['swap-vertical-outline', 'swap-vertical'] },
  { name: 'friends', label: 'Friends', icon: ['people-outline', 'people'] },
  { name: 'reports', label: 'Reports', icon: ['pie-chart-outline', 'pie-chart'] },
];
const SLOTS = 5;
const ADD_SLOT = 2;
const INSET = 5;

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, scheme, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const x = useAnimatedValue(0);
  const slot = width > 0 ? (width - INSET * 2) / SLOTS : 0;

  const current = state.routes[state.index]?.name;
  const shownIndex = SHOWN.findIndex((s) => s.name === current);
  const slotOf = (i: number) => (i < ADD_SLOT ? i : i + 1);
  const lensSlot = shownIndex >= 0 ? slotOf(shownIndex) : -1;

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
        <Icon name={focused ? s.icon[1] : s.icon[0]} size={23} color={tint} />
        <Text
          variant="caption"
          style={{ color: tint, fontSize: 10, lineHeight: 12, fontWeight: focused ? '700' : '500' }}
        >
          {s.label}
        </Text>
      </Pressable>
    );
  };

  const add = (
    <View key="add" style={styles.item}>
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
          { transform: [{ scale: pressed ? 0.9 : 1 }] },
        ]}
      >
        <View style={styles.addInner}>
          <GradientFill colors={colors.heroGradient} sheen />
          <Icon name="add" size={30} color={colors.heroText} />
        </View>
      </Pressable>
    </View>
  );

  const items = [...SHOWN.slice(0, ADD_SLOT).map(tab), add, ...SHOWN.slice(ADD_SLOT).map(tab)];

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: Math.max(insets.bottom - 10, 10) }]}>
      <View style={[styles.shadow, scheme === 'light' ? elevation.floating : null]}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.capsule}>
          <Glass style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />
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
          <View style={styles.row}>{items}</View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 14, right: 14 },
  shadow: { borderRadius: radius.pill },
  capsule: { height: TAB_BAR_HEIGHT, borderRadius: radius.pill, overflow: 'hidden' },
  row: { flexDirection: 'row', flex: 1, paddingHorizontal: INSET, alignItems: 'center' },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: TAB_BAR_HEIGHT - INSET * 2,
  },
  add: { width: 50, height: 50, borderRadius: 25 },
  addInner: { flex: 1, borderRadius: 25, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
