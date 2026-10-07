/**
 * Bottom tab bar, after the reference: a white glass bar of icons. The active
 * tab is a solid ink glyph, the others are grey outlines; the Add button sits
 * in the middle as a violet gradient square. Labels are not shown, but every
 * tab carries its name for VoiceOver.
 *
 * A tap on Add opens the add sheet (expense, income, transfer, EMI, payment
 * method); a long press goes straight to Add Expense, still the most common
 * thing to record.
 */
import type { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { continuous } from '@/theme/tokens';
import { haptic } from './ui/controls';
import { Glass } from './ui/glass';
import { GradientFill } from './ui/gradient';
import { Icon } from './ui/primitives';
import { TAB_BAR_HEIGHT } from './ui/layout';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, [string, string]> = {
  index: ['home-outline', 'home'],
  transactions: ['card-outline', 'card'],
  reports: ['pulse-outline', 'pulse'],
  goals: ['flag-outline', 'flag'],
  more: ['grid-outline', 'grid'],
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const items = state.routes.map((route, index) => {
    const focused = state.index === index;
    const label = descriptors[route.key]?.options.title ?? route.name;
    const [outline, filled] = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
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
        style={({ pressed }) => [styles.item, { transform: [{ scale: pressed ? 0.88 : 1 }] }]}
      >
        <Icon
          name={focused ? filled : outline}
          size={26}
          color={focused ? colors.text : colors.textTertiary}
        />
      </Pressable>
    );
  });

  const addButton = (
    <View key="add" style={styles.item}>
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
        style={({ pressed }) => [styles.add, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}
      >
        <GradientFill colors={colors.heroGradient} sheen />
        <Icon name="add" size={28} color={colors.heroText} />
      </Pressable>
    </View>
  );

  // Home, Transactions, [+], Reports, Goals, More
  const ordered = [...items.slice(0, 2), addButton, ...items.slice(2)];

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom - 6, 8),
          borderTopColor: scheme === 'dark' ? colors.border : colors.borderStrong,
        },
      ]}
    >
      {/* Glass, so the page blurs through as it scrolls under the bar. */}
      <Glass style={StyleSheet.absoluteFill} />
      <View style={styles.row}>{ordered}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', height: TAB_BAR_HEIGHT, alignItems: 'center', paddingHorizontal: 8 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', height: TAB_BAR_HEIGHT },
  add: {
    width: 48,
    height: 48,
    borderRadius: 16,
    ...continuous,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
