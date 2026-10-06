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
import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

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
