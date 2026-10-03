/**
 * Bottom tab bar with a prominent centre "Add" button. A tap opens the add
 * sheet (expense, income, transfer, EMI, payment method); a long press goes
 * straight to Add Expense, which is still the most common thing to record.
 */
import type { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { elevation } from '@/theme/tokens';
import { haptic } from './ui/controls';
import { Icon, Text } from './ui/primitives';
import { TAB_BAR_HEIGHT } from './ui/layout';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, [string, string]> = {
  index: ['home-outline', 'home'],
  transactions: ['list-outline', 'list'],
  reports: ['pie-chart-outline', 'pie-chart'],
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
        style={styles.item}
      >
        <Icon
          name={focused ? filled : outline}
          size={23}
          color={focused ? colors.text : colors.textTertiary}
        />
        <Text
          variant="caption"
          style={{ color: focused ? colors.text : colors.textTertiary, fontSize: 10 }}
          numberOfLines={1}
        >
          {label}
        </Text>
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
        style={({ pressed }) => [
          styles.add,
          {
            backgroundColor: pressed ? colors.brandPressed : colors.brand,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
          elevation.floating,
        ]}
      >
        <Icon name="add" size={30} color={colors.onBrand} />
      </Pressable>
    </View>
  );

  // Home, Transactions, [+], Reports, Goals, More
  const ordered = [...items.slice(0, 2), addButton, ...items.slice(2)];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom, borderTopColor: colors.border }]}>
      {Platform.OS === 'ios' ? (
        <BlurView
          tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          intensity={100}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} />
      )}
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
  row: { flexDirection: 'row', height: TAB_BAR_HEIGHT, alignItems: 'center' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  add: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
  },
});
