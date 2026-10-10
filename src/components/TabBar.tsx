/**
 * BUD's tab bar, as in the reference design: a floating white glass capsule
 * with five equal slots — Home · Transactions · [ + ] · Insights · More — and
 * the Add button as a raised blue circle in the centre slot (equal slots put
 * it exactly in the middle by construction).
 *
 * The selected tab sits on a soft lens that springs between slots; its icon
 * fills and its label turns blue. The capsule is real Liquid Glass on iOS 26
 * and a system blur elsewhere. Tap Add for the add sheet; long-press it to add
 * an expense straight away. Friends and Goals are still tabs (deep links keep
 * working); they're reached from Home and More.
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

/** The bar's order; Add takes the middle slot. */
const SHOWN: { name: string; label: string; icon: [string, string] }[] = [
  { name: 'index', label: 'Home', icon: ['home-outline', 'home'] },
  { name: 'transactions', label: 'Transactions', icon: ['receipt-outline', 'receipt'] },
  { name: 'reports', label: 'Insights', icon: ['bar-chart-outline', 'bar-chart'] },
  { name: 'more', label: 'More', icon: ['ellipsis-horizontal', 'ellipsis-horizontal'] },
];
const SLOTS = 5;
const ADD_SLOT = 2;
const INSET = 6;
const ADD = 58;

export function TabBar({ state, navigation }: BottomTabBarProps) {
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
    const tint = focused ? colors.brand : colors.textSecondary;
    return (
      <Pressable
        key={s.name}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={s.label}
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
          numberOfLines={1}
          style={{ color: tint, fontSize: 10, lineHeight: 12, fontWeight: focused ? '700' : '500' }}
        >
          {s.label}
        </Text>
      </Pressable>
    );
  };

  const items = [
    ...SHOWN.slice(0, ADD_SLOT).map(tab),
    <View key="add-slot" style={styles.item} />,
    ...SHOWN.slice(ADD_SLOT).map(tab),
  ];

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: Math.max(insets.bottom - 10, 10) }]}>
      <View style={[styles.shadow, scheme === 'light' ? elevation.floating : null]}>
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
          <View style={styles.row}>{items}</View>
        </View>
      </View>

      {/* Add — raised in the centre slot */}
      <View pointerEvents="box-none" style={styles.addWrap}>
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
            { borderColor: colors.surface },
            elevation.hero(colors.hero),
            { transform: [{ scale: pressed ? 0.92 : 1 }] },
          ]}
        >
          <View style={styles.addInner}>
            <GradientFill colors={colors.heroGradient} sheen />
            <Icon name="add" size={30} color={colors.heroText} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 16, right: 16 },
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
  addWrap: { position: 'absolute', left: 0, right: 0, top: -ADD / 2 + 6, alignItems: 'center' },
  add: { width: ADD, height: ADD, borderRadius: ADD / 2, borderWidth: 3 },
  addInner: {
    flex: 1,
    borderRadius: ADD / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
