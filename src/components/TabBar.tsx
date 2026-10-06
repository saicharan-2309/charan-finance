/**
 * Floating tab bar, iOS 26 style: a glass capsule of tabs hovering over the
 * content, with the Add button as its own round control beside it (the way
 * iOS sets a search or compose button apart from the tabs).
 *
 * The capsule is Liquid Glass where the system has it (iOS 26+, also in Expo
 * Go), a system-chrome blur on older iOS, and a solid surface elsewhere. The
 * selected tab sits on a soft lens that springs from tab to tab.
 *
 * A tap on Add opens the add sheet (expense, income, transfer, EMI, payment
 * method); a long press goes straight to Add Expense, still the most common
 * thing to record.
 */
import type { Tabs } from 'expo-router/js-tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAnimatedValue, useReducedMotion } from '@/lib/animation';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, springs } from '@/theme/tokens';
import { haptic } from './ui/controls';
import { GradientFill } from './ui/gradient';
import { Icon, Text } from './ui/primitives';
import { TAB_BAR_HEIGHT } from './ui/layout';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, [string, string]> = {
  index: ['home-outline', 'home'],
  transactions: ['receipt-outline', 'receipt'],
  reports: ['pie-chart-outline', 'pie-chart'],
  goals: ['flag-outline', 'flag'],
  more: ['grid-outline', 'grid'],
};

/** Short labels that fit a compact capsule; the full title is still spoken. */
const SHORT_LABEL: Record<string, string> = { transactions: 'Activity' };

const LIQUID_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/** Space between the capsule's edge and the lens behind the selected tab. */
const INSET = 4;

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, scheme, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const x = useAnimatedValue(0);
  const count = state.routes.length;
  const slot = width > 0 ? (width - INSET * 2) / count : 0;

  useEffect(() => {
    if (!slot) return;
    if (reduced) x.setValue(state.index * slot);
    else
      Animated.spring(x, { toValue: state.index * slot, useNativeDriver: true, ...springs.snappy }).start();
  }, [state.index, slot, reduced, x]);

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const label = descriptors[route.key]?.options.title ?? route.name;
    const [outline, filled] = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
    const tint = focused ? colors.brand : colors.textSecondary;
    return (
      <Pressable
        key={route.key}
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
        style={({ pressed }) => [styles.item, { transform: [{ scale: pressed ? 0.92 : 1 }] }]}
      >
        <Icon name={focused ? filled : outline} size={22} color={tint} />
        <Text
          variant="caption"
          style={{ color: tint, fontSize: 10, lineHeight: 12, fontWeight: focused ? '600' : '500' }}
          numberOfLines={1}
        >
          {SHORT_LABEL[route.name] ?? label}
        </Text>
      </Pressable>
    );
  });

  const lens = slot ? (
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
  ) : null;

  const glassBackground = LIQUID_GLASS ? (
    <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={scheme} />
  ) : Platform.OS === 'ios' ? (
    <BlurView
      tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      intensity={100}
      style={StyleSheet.absoluteFill}
    />
  ) : (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.chromeFill },
        // Browsers can blur what's behind, so the web preview gets real frosted glass too.
        Platform.OS === 'web' ? ({ backdropFilter: 'blur(24px) saturate(180%)' } as object) : null,
      ]}
    />
  );

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: Math.max(insets.bottom - 8, 12) }]}>
      <View style={[styles.capsuleShadow, elevation.floating]}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={[styles.capsule, { borderColor: colors.chromeStroke }]}
        >
          {glassBackground}
          {lens}
          <View style={styles.row}>{items}</View>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add"
        accessibilityHint="Choose expense, income, transfer, EMI or a new payment method. Long press to add an expense straight away."
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
    gap: 10,
  },
  capsuleShadow: { flex: 1, borderRadius: radius.pill },
  capsule: {
    height: TAB_BAR_HEIGHT,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
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
});
