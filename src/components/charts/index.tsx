/**
 * Lightweight SVG charts (react-native-svg). Design rules:
 *  - thin marks: 2px lines, bars with 4px rounded data-ends anchored to the
 *    baseline and 2px gaps between adjacent bars / donut segments;
 *  - recessive grid and axes; values and labels use text tokens, never the
 *    series colour;
 *  - every chart is touchable: tap/drag shows the exact value (tooltip), and a
 *    legend accompanies any multi-series chart, so identity is never colour-only;
 *  - one y-axis only.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Pressable, View, type LayoutChangeEvent } from 'react-native';

import { useAnimatedValue } from '@/lib/animation';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { useReducedMotion } from '../ui/feedback';
import { Text } from '../ui/primitives';

function useWidth(initial = 0): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

/** Fades/scales a chart in once on mount (native driver, cheap). */
function Reveal({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const a = useAnimatedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    Animated.timing(a, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [a, reduced]);
  return (
    <Animated.View
      style={{
        opacity: a,
        transform: [{ scaleY: a.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Rect path with only the top corners rounded (data-end), flat on the baseline. */
function topRoundedBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export interface Series {
  name: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
export function Legend({ series }: { series: Series[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }} accessibilityRole="summary">
      {series.map((s) => (
        <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} />
          <Text variant="caption" tone="secondary">
            {s.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bar chart (grouped)
// ---------------------------------------------------------------------------
export interface BarDatum {
  label: string;
  /** One value per series, in minor units. */
  values: number[];
}

export function BarChart({
  data,
  series,
  currency,
  height = 180,
  onSelect,
  initialSelected,
}: {
  data: BarDatum[];
  series: Series[];
  currency: string;
  height?: number;
  onSelect?: (index: number) => void;
  initialSelected?: number;
}) {
  const { colors } = useTheme();
  const [width, onLayout] = useWidth();
  const [selected, setSelected] = useState<number | null>(initialSelected ?? null);
  const axisW = 44;
  const labelH = 20;
  const plotH = height - labelH;
  const plotW = Math.max(width - axisW, 0);
  const max = niceMax(Math.max(1, ...data.flatMap((d) => d.values)));
  const groupW = data.length ? plotW / data.length : 0;
  const nSeries = series.length;
  const innerPad = Math.max(groupW * 0.22, 4);
  const barW = Math.max(Math.min((groupW - innerPad - (nSeries - 1) * 2) / nSeries, 22), 2);
  const groupContent = barW * nSeries + (nSeries - 1) * 2;
  const step = data.length > 8 ? Math.ceil(data.length / 6) : 1;

  const sel = selected !== null && data[selected] ? data[selected] : null;

  return (
    <View>
      <View style={{ minHeight: 40, marginBottom: spacing.sm }}>
        {sel ? (
          <View>
            <Text variant="caption" tone="secondary">
              {sel.label}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
              {series.map((s, i) => (
                <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color }} />
                  <Text variant="subhead">
                    {s.name} {formatMoney(sel.values[i] ?? 0, currency, { decimals: 'never' })}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <Legend series={series} />
        )}
      </View>
      <View
        onLayout={onLayout}
        style={{ height }}
        accessibilityLabel={`Bar chart: ${series.map((s) => s.name).join(' and ')}`}
      >
        {width > 0 ? (
          <Reveal>
            <Svg width={width} height={height}>
              {[0, 0.5, 1].map((t) => (
                <Line
                  key={t}
                  x1={axisW}
                  x2={width}
                  y1={plotH * (1 - t)}
                  y2={plotH * (1 - t)}
                  stroke={colors.chartGrid}
                  strokeWidth={1}
                />
              ))}
              {data.map((d, i) => {
                const gx = axisW + i * groupW + (groupW - groupContent) / 2;
                const dim = selected !== null && selected !== i;
                return (
                  <G key={`${d.label}-${i}`} opacity={dim ? 0.35 : 1}>
                    {d.values.map((v, si) => {
                      const h = (Math.max(v, 0) / max) * plotH;
                      return (
                        <Path
                          key={si}
                          d={topRoundedBar(gx + si * (barW + 2), plotH - h, barW, h, 4)}
                          fill={series[si]?.color ?? colors.textSecondary}
                        />
                      );
                    })}
                  </G>
                );
              })}
            </Svg>
            {/* Axis labels as native Text for crisp, scalable type. */}
            <View style={{ position: 'absolute', left: 0, top: -7 }} pointerEvents="none">
              <Text variant="caption" tone="tertiary">
                {formatMoney(max, currency, { compact: true, decimals: 'never' })}
              </Text>
            </View>
            <View style={{ position: 'absolute', left: 0, top: plotH / 2 - 7 }} pointerEvents="none">
              <Text variant="caption" tone="tertiary">
                {formatMoney(max / 2, currency, { compact: true, decimals: 'never' })}
              </Text>
            </View>
            <View
              style={{ position: 'absolute', left: axisW, right: 0, top: plotH + 4, flexDirection: 'row' }}
              pointerEvents="none"
            >
              {data.map((d, i) => (
                <View key={i} style={{ width: groupW, alignItems: 'center' }}>
                  {i % step === 0 ? (
                    <Text variant="caption" tone={selected === i ? 'primary' : 'tertiary'} numberOfLines={1}>
                      {d.label}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
            {/* Hit targets: full column height, wider than the bars. */}
            <View
              style={{ position: 'absolute', left: axisW, top: 0, right: 0, bottom: 0, flexDirection: 'row' }}
            >
              {data.map((d, i) => (
                <Pressable
                  key={i}
                  style={{ width: groupW, height: '100%' }}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.label}: ${series.map((s, si) => `${s.name} ${formatMoney(d.values[si] ?? 0, currency)}`).join(', ')}`}
                  onPress={() => {
                    setSelected((cur) => (cur === i ? null : i));
                    onSelect?.(i);
                  }}
                />
              ))}
            </View>
          </Reveal>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Line / area chart with crosshair
// ---------------------------------------------------------------------------
export interface LinePoint {
  label: string;
  value: number;
}

export function LineChart({
  points,
  color,
  currency,
  height = 170,
  title,
  formatLabel,
}: {
  points: LinePoint[];
  color?: string;
  currency: string;
  height?: number;
  title?: string;
  formatLabel?: (p: LinePoint) => string;
}) {
  const { colors } = useTheme();
  const stroke = color ?? colors.brand;
  const [width, onLayout] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const pad = 8;
  const values = points.map((p) => p.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(1, ...values);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.05;
  const max = rawMax + span * 0.08;
  const x = (i: number) =>
    points.length <= 1 ? width / 2 : pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);

  const { line, area } = useMemo(() => {
    if (width === 0 || points.length === 0) return { line: '', area: '' };
    const l = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');
    const a = `${l} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
    return { line: l, area: a };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, height, min, max]);

  const pickIndex = (locX: number) => {
    if (points.length === 0 || width === 0) return;
    const i = Math.round(((locX - pad) / Math.max(width - pad * 2, 1)) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: (e) => pickIndex(e.nativeEvent.locationX),
        onPanResponderMove: (e) => pickIndex(e.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, width],
  );

  const shown = active !== null ? points[active] : points[points.length - 1];
  const zeroY = min < 0 && max > 0 ? y(0) : null;

  return (
    <View>
      <View style={{ marginBottom: spacing.sm, minHeight: 36 }}>
        {title ? (
          <Text variant="caption" tone="secondary">
            {title}
          </Text>
        ) : null}
        {shown ? (
          <Text variant="subhead">
            {formatLabel ? formatLabel(shown) : shown.label}:{' '}
            {formatMoney(shown.value, currency, { decimals: 'never' })}
          </Text>
        ) : null}
      </View>
      <View
        onLayout={onLayout}
        style={{ height }}
        {...responder.panHandlers}
        accessibilityRole="image"
        accessibilityLabel={
          points.length
            ? `Trend from ${points[0].label} (${formatMoney(points[0].value, currency)}) to ${points[points.length - 1].label} (${formatMoney(points[points.length - 1].value, currency)})`
            : 'No data'
        }
      >
        {width > 0 && points.length > 0 ? (
          <Reveal>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
                  <Stop offset="1" stopColor={stroke} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {[0.25, 0.5, 0.75].map((t) => (
                <Line
                  key={t}
                  x1={0}
                  x2={width}
                  y1={height * t}
                  y2={height * t}
                  stroke={colors.chartGrid}
                  strokeWidth={1}
                />
              ))}
              {zeroY !== null ? (
                <Line
                  x1={0}
                  x2={width}
                  y1={zeroY}
                  y2={zeroY}
                  stroke={colors.borderStrong}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              ) : null}
              <Path d={area} fill="url(#area)" />
              <Path
                d={line}
                stroke={stroke}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {active !== null ? (
                <G>
                  <Line
                    x1={x(active)}
                    x2={x(active)}
                    y1={0}
                    y2={height}
                    stroke={colors.textTertiary}
                    strokeWidth={1}
                  />
                  <Circle
                    cx={x(active)}
                    cy={y(points[active].value)}
                    r={6}
                    fill={stroke}
                    stroke={colors.surface}
                    strokeWidth={2}
                  />
                </G>
              ) : (
                <Circle
                  cx={x(points.length - 1)}
                  cy={y(points[points.length - 1].value)}
                  r={5}
                  fill={stroke}
                  stroke={colors.surface}
                  strokeWidth={2}
                />
              )}
            </Svg>
          </Reveal>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------
export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  size = 168,
  thickness = 22,
  center,
  selectedKey,
  onSelect,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const { colors } = useTheme();
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 2 : 0; // 2px surface gap between segments
  let offset = 0;

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole="image"
      accessibilityLabel={`Breakdown: ${segments.map((s) => `${s.label} ${total ? Math.round((s.value / total) * 100) : 0}%`).join(', ')}`}
    >
      <Reveal>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.surfaceMuted}
            strokeWidth={thickness}
            fill="none"
          />
          {total > 0
            ? segments.map((s) => {
                const len = (Math.max(s.value, 0) / total) * c;
                const dash = Math.max(len - gap, 0.5);
                const el = (
                  <Circle
                    key={s.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={s.color}
                    strokeWidth={selectedKey === s.key ? thickness + 4 : thickness}
                    opacity={selectedKey && selectedKey !== s.key ? 0.35 : 1}
                    fill="none"
                    strokeDasharray={`${dash} ${c - dash}`}
                    strokeDashoffset={-offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    onPress={onSelect ? () => onSelect(s.key) : undefined}
                  />
                );
                offset += len;
                return el;
              })
            : null}
        </Svg>
      </Reveal>
      <View
        style={{ position: 'absolute', alignItems: 'center', paddingHorizontal: thickness + 6 }}
        pointerEvents="none"
      >
        {center}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (no axes; used inside cards)
// ---------------------------------------------------------------------------
export function Sparkline({
  values,
  color,
  width = 96,
  height = 32,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const { colors } = useTheme();
  if (values.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(2 + (1 - (v - min) / span) * (height - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <Svg width={width} height={height} accessibilityElementsHidden>
      <Path
        d={d}
        stroke={color ?? colors.brand}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Horizontal share bar list item (category/merchant breakdown rows). */
export function ShareBar({ fraction, color }: { fraction: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 6,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceMuted,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.max(0, Math.min(fraction, 1)) * 100}%`,
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
