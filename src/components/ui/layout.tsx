/**
 * Screen scaffolding: scrollable page with large title, sections, sticky footer.
 */
import type { ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, spacing } from '@/theme/tokens';
import { AuroraBackground } from './gradient';
import { Icon, Text } from './primitives';

export interface ScreenProps {
  children: ReactNode;
  /** Large in-content title (tab roots). Pushed screens use the native header. */
  title?: string;
  /** Small line above the title (e.g. today's date), like Apple's Today views. */
  eyebrow?: string;
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
  /** A bar pinned to the top (below the status bar) that stays put while the page scrolls. */
  topBar?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

export const TAB_BAR_HEIGHT = 64;

export function Screen({
  children,
  title,
  eyebrow,
  subtitle,
  headerRight,
  refreshing = false,
  onRefresh,
  scroll = true,
  safeTop,
  tabBarInset,
  footer,
  topBar,
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
        marginBottom: spacing.xl,
        gap: spacing.md,
      }}
    >
      {/* Title first, then the subtitle beneath it: the name of the thing
          leads, the qualifier follows. */}
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow ? (
          <Text variant="overline" tone="secondary">
            {eyebrow}
          </Text>
        ) : null}
        <Text
          variant="largeTitle"
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subhead" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {headerRight}
    </View>
  ) : null;

  const padding: ViewStyle = {
    paddingHorizontal: GUTTER,
    // With a pinned bar, the bar takes the safe area and the page starts right under it.
    paddingTop: topBar ? spacing.sm : (safeTop ? insets.top : 0) + spacing.md,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AuroraBackground />
      {topBar ? (
        // Content scrolls below this bar, never under it, so it can sit on the aurora.
        <View
          style={{
            paddingTop: (safeTop ? insets.top : 0) + spacing.sm,
            paddingHorizontal: GUTTER,
            paddingBottom: spacing.sm,
            zIndex: 2,
          }}
        >
          {topBar}
        </View>
      ) : null}
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
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.borderStrong,
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
            paddingHorizontal: 2,
          }}
        >
          <Text variant="headline" accessibilityRole="header">
            {title}
          </Text>
          {action && onAction ? (
            <Pressable
              onPress={onAction}
              hitSlop={12}
              accessibilityRole="link"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text variant="subhead" tone="brand">
                {action}
              </Text>
              <Icon name="chevron-forward" size={14} tone="brand" />
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
