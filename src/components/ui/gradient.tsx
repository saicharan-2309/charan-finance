/**
 * Gradient fills drawn with react-native-svg (already bundled in Expo Go), so
 * no extra native module is needed. A fill sits behind its parent's content:
 * give the parent `overflow: 'hidden'` and a border radius.
 *
 * The fill measures its own box and draws at exact pixel sizes. An SVG sized
 * "100%" inside an absolutely positioned layer does not reliably resolve to
 * the parent's size on iOS — it left the hero half painted — so percentages
 * are never used for the canvas itself.
 */
import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

/** SVG ids are document-global on web, so each fill needs its own. */
function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

function useBox() {
  const [box, setBox] = useState({ w: 0, h: 0 });
  return [
    box,
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout;
      if (Math.round(width) !== box.w || Math.round(height) !== box.h)
        setBox({ w: Math.round(width), h: Math.round(height) });
    },
  ] as const;
}

export function GradientFill({
  colors,
  angle = 'diagonal',
  sheen = false,
}: {
  colors: readonly string[];
  /** diagonal: top-left → bottom-right; vertical: top → bottom; horizontal: left → right. */
  angle?: 'diagonal' | 'vertical' | 'horizontal';
  /** A soft light bloom in the top-left corner, like light catching a card. */
  sheen?: boolean;
}) {
  const id = useSvgId('g');
  const sheenId = useSvgId('s');
  const [box, onLayout] = useBox();
  const end =
    angle === 'diagonal'
      ? { x2: '1', y2: '1' }
      : angle === 'vertical'
        ? { x2: '0', y2: '1' }
        : { x2: '1', y2: '0' };
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors[Math.floor(colors.length / 2)] }]}
      pointerEvents="none"
      onLayout={onLayout}
    >
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" {...end}>
              {colors.map((c, i) => (
                <Stop key={i} offset={colors.length === 1 ? 0 : i / (colors.length - 1)} stopColor={c} />
              ))}
            </LinearGradient>
            {sheen ? (
              <RadialGradient id={sheenId} cx="0.1" cy="0" r="0.75" fx="0.1" fy="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </RadialGradient>
            ) : null}
          </Defs>
          <Rect x={0} y={0} width={box.w} height={box.h} fill={`url(#${id})`} />
          {sheen ? <Rect x={0} y={0} width={box.w} height={box.h} fill={`url(#${sheenId})`} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * A soft, oversized circle in the top-left of a card — the light "swoosh"
 * of a premium bank card. Decoration only.
 */
export function CardSwoosh({ opacity = 0.1 }: { opacity?: number }) {
  const [box, onLayout] = useBox();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          <Circle
            cx={box.w * 0.08}
            cy={-box.h * 0.35}
            r={box.h * 1.05}
            fill="#FFFFFF"
            fillOpacity={opacity}
          />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * Two faint concentric rings in a corner — the quiet "guilloché" detail of a
 * banknote or a premium card. Decoration only.
 */
export function CardRings({ color = '#FFFFFF', opacity = 0.08 }: { color?: string; opacity?: number }) {
  const [box, onLayout] = useBox();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h}>
          <Circle
            cx={box.w}
            cy={0}
            r={120}
            stroke={color}
            strokeOpacity={opacity}
            strokeWidth={28}
            fill="none"
          />
          <Circle
            cx={box.w}
            cy={0}
            r={190}
            stroke={color}
            strokeOpacity={opacity * 0.6}
            strokeWidth={16}
            fill="none"
          />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * The app's backdrop: a very light pastel aurora — large, diffuse radial glows
 * (sky blue, lavender, blush pink, peach) over the base canvas colour. Drawn
 * at the measured size of the screen, behind content, never interactive.
 * Each glow's position and size are fractions of the screen (`aurora` in
 * tokens.ts); in dark mode they're faint, deep tones over navy.
 */
export function AuroraBackground() {
  const { colors } = useTheme();
  const id = useSvgId('aurora');
  // Sized from the window, not a layout measurement: it's a full-screen
  // backdrop, and the window size is exact from the first frame (a measured
  // box can lag a resize and leave a hard edge). Anything outside the screen's
  // own area is clipped.
  const { width: w, height: h } = useWindowDimensions();
  const size = Math.max(w, h);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, overflow: 'hidden' }]}
    >
      <Svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          {colors.aurora.map((g, i) => (
            <RadialGradient key={i} id={`${id}${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={g.color} stopOpacity={g.opacity} />
              <Stop offset="0.55" stopColor={g.color} stopOpacity={g.opacity * 0.45} />
              <Stop offset="1" stopColor={g.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {colors.aurora.map((g, i) => (
          <Circle key={i} cx={g.x * w} cy={g.y * h} r={g.r * size} fill={`url(#${id}${i})`} />
        ))}
      </Svg>
    </View>
  );
}

/** A full-screen view on the aurora — for screens that don't use <Screen>. */
export function Backdrop({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <AuroraBackground />
      {children}
    </View>
  );
}

/**
 * The soft wave across a balance card, like the reference: two translucent
 * white swells through the lower part of the card.
 */
export function CardWave({ at = 0.52 }: { at?: number }) {
  const [box, onLayout] = useBox();
  const { w, h } = box;
  const y = h * at;
  const wave = (dy: number, amp: number) =>
    `M0 ${y + dy} C ${w * 0.25} ${y + dy - amp}, ${w * 0.45} ${y + dy + amp}, ${w * 0.7} ${y + dy - amp * 0.4} S ${w} ${y + dy - amp}, ${w} ${y + dy - amp} L ${w} ${h} L 0 ${h} Z`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Path d={wave(0, 18)} fill="#FFFFFF" fillOpacity={0.1} />
          <Path d={wave(14, 12)} fill="#FFFFFF" fillOpacity={0.08} />
        </Svg>
      ) : null}
    </View>
  );
}
