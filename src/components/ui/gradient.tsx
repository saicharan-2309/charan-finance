/**
 * Gradient fills drawn with react-native-svg (already bundled in Expo Go), so
 * no extra native module is needed. A fill sits behind its parent's content:
 * give the parent `overflow: 'hidden'` and a border radius.
 */
import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/** SVG ids are document-global on web, so each fill needs its own. */
function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
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
  const end =
    angle === 'diagonal'
      ? { x2: '1', y2: '1' }
      : angle === 'vertical'
        ? { x2: '0', y2: '1' }
        : { x2: '1', y2: '0' };
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
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
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      {sheen ? <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${sheenId})`} /> : null}
    </Svg>
  );
}

/**
 * Two faint concentric rings in a corner — the quiet "guilloché" detail of a
 * banknote or a premium card. Decoration only; hidden from assistive tech.
 */
export function CardRings({ color = '#FFFFFF', opacity = 0.08 }: { color?: string; opacity?: number }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx="100%" cy="0" r="120" stroke={color} strokeOpacity={opacity} strokeWidth={28} fill="none" />
      <Circle
        cx="100%"
        cy="0"
        r="190"
        stroke={color}
        strokeOpacity={opacity * 0.6}
        strokeWidth={16}
        fill="none"
      />
    </Svg>
  );
}
