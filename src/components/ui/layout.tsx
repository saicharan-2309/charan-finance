/**
 * Screen scaffolding: scrollable page with large title, sections, sticky footer.
 */
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, spacing } from '@/theme/tokens';
import { Text } from './primitives';

export interface ScreenProps {
  children: ReactNode;
  /** Large in-content title (tab roots). Pushed screens use the native header. */
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pass false for screens that manage their own scrolling (lists). */
  scroll?: boolean;
  /** Adds top safe-area padding (screens without a native header). */
  safeTop?: boolean;
  /** Extra bottom padding to clear the floating tab bar. */
  tabBarInset?: boolean;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

export const TAB_BAR_HEIGHT = 64;

export function Screen({
  children,
  title,
  subtitle,
  headerRight,
  refreshing = false,
  onRefresh,
  scroll = true,
  safeTop,
  tabBarInset,
  footer,
  contentStyle,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = (tabBarInset ? TAB_BAR_HEIGHT + insets.bottom + spacing.lg : insets.bottom) + spacing.xl;

  const header = title ? (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        {subtitle ? (
          <Text variant="subhead" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
        <Text variant="largeTitle" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {headerRight}
    </View>
  ) : null;

  const padding: ViewStyle = {
    paddingHorizontal: GUTTER,
    paddingTop: (safeTop ? insets.top : 0) + spacing.md,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[padding, { paddingBottom: footer ? spacing.xl : bottomPad }, contentStyle]}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.textSecondary}
              />
            ) : undefined
          }
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padding, contentStyle]}>
          {header}
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={{
            paddingHorizontal: GUTTER,
            paddingTop: spacing.md,
            paddingBottom: insets.bottom + spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function Section({
  title,
  action,
  onAction,
  children,
  style,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ marginBottom: spacing.xxl }, style]}>
      {title ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
          }}
        >
          <Text variant="headline" accessibilityRole="header">
            {title}
          </Text>
          {action && onAction ? (
            <Pressable onPress={onAction} hitSlop={10} accessibilityRole="link">
              <Text variant="subhead" tone="brand">
                {action}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Labelled stat used inside cards (e.g. Income / Expenses). */
export function Stat({
  label,
  children,
  align = 'left',
}: {
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <View style={{ gap: 2, alignItems: align === 'right' ? 'flex-end' : 'flex-start', flex: 1 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {children}
    </View>
  );
}
