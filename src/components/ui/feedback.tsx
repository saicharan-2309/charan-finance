/**
 * Loading, empty, error and progress components plus the toast system.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  useAnimatedValue,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { describeError } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { elevation, motion, radius, spacing } from '@/theme/tokens';
import { Button } from './controls';
import { Icon, Text, type TextProps } from './primitives';

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
export function Skeleton({
  width = '100%',
  height = 16,
  rounded = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const opacity = useAnimatedValue(0.55);
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.skeleton, opacity }, style]}
    />
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ gap: spacing.lg }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Skeleton width={40} height={40} rounded={14} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="35%" height={12} />
          </View>
          <Skeleton width={70} height={16} />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty / Error states
// ---------------------------------------------------------------------------
export function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
  compact,
}: {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: compact ? spacing.xl : spacing.huge,
        paddingHorizontal: spacing.xl,
        gap: spacing.md,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 22,
          backgroundColor: colors.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={28} tone="brand" />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" tone="secondary" align="center" style={{ maxWidth: 320 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} size="md" style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const info = describeError(error);
  return (
    <EmptyState
      compact={compact}
      icon={info.code === 'network' ? 'cloud-offline-outline' : 'alert-circle-outline'}
      title={info.code === 'network' ? "Can't connect right now" : "Couldn't load this"}
      message={info.message}
      actionLabel={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}

/** Standard loading / error / content switch for a React Query result. */
export function QueryState<T>({
  query,
  loading,
  children,
  compact,
}: {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  loading?: ReactNode;
  children: (data: T) => ReactNode;
  compact?: boolean;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact={compact} />;
  return <>{loading ?? <SkeletonList />}</>;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
export function ProgressBar({
  progress,
  color,
  height = 8,
  marker,
}: {
  /** 0–1 (values above 1 render full). */
  progress: number;
  color?: string;
  height?: number;
  /** Optional 0–1 tick mark (e.g. time elapsed in the period). */
  marker?: number;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const anim = useAnimatedValue(0);
  const clamped = Math.max(0, Math.min(progress, 1));
  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamped,
      duration: reduced ? 0 : motion.slow,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [anim, clamped, reduced]);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      style={{ height, borderRadius: height, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}
    >
      <Animated.View
        style={{
          height,
          borderRadius: height,
          backgroundColor: color ?? colors.brand,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
      {marker !== undefined ? (
        <View
          style={{
            position: 'absolute',
            left: `${Math.max(0, Math.min(marker, 1)) * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            backgroundColor: colors.text,
            opacity: 0.35,
          }}
        />
      ) : null}
    </View>
  );
}

export function ProgressRing({
  progress,
  size = 64,
  stroke = 7,
  color,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(progress, 1));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.surfaceMuted}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? colors.brand}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Animated money number (count-up on change)
// ---------------------------------------------------------------------------
export function AnimatedMoney({
  minor,
  currency,
  compact,
  ...textProps
}: { minor: number; currency: string; compact?: boolean } & Omit<TextProps, 'children'>) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(minor);
  const fromRef = useRef(minor);
  useEffect(() => {
    const from = fromRef.current;
    if (reduced || from === minor) {
      fromRef.current = minor;
      setDisplay(minor);
      return;
    }
    const start = Date.now();
    const duration = 550;
    let frame = 0;
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      // Rounded to whole minor units at every frame; only the final frame matters for accuracy.
      setDisplay(t === 1 ? minor : Math.round(from + (minor - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = minor;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [minor, reduced]);
  const text = formatMoney(display, currency, { decimals: 'never', compact });
  return (
    <Text accessibilityLabel={formatMoney(minor, currency).replace('−', 'minus ')} {...textProps}>
      {text}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<{ show: (message: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone });
    AccessibilityInfo.announceForAccessibility(message);
    timer.current = setTimeout(() => setToast(null), tone === 'error' ? 4500 : 2600);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDismiss={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useAnimatedValue(0);
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
  }, [anim]);
  const icon =
    toast.tone === 'success'
      ? 'checkmark-circle'
      : toast.tone === 'error'
        ? 'alert-circle'
        : 'information-circle';
  const tint =
    toast.tone === 'success' ? colors.positive : toast.tone === 'error' ? colors.negative : colors.info;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + spacing.sm,
        left: spacing.lg,
        right: spacing.lg,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
      }}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          padding: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: colors.border,
          ...elevation.floating,
        }}
      >
        <Icon name={icon} size={20} color={tint} />
        <Text variant="subhead" style={{ flex: 1 }}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
