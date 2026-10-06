/**
 * An open arc gauge (270°): how much of a limit is used. The used part is
 * drawn in the warm gauge gradient with a knob at its end; the rest is a
 * recessed track. Past the limit the arc fills and turns the negative colour,
 * and the caption says "over" — colour never carries that alone.
 */
import { useId, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

const SWEEP = 270;
const START = 135; // degrees, measured clockwise from 3 o'clock

function point(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const s = point(cx, cy, r, from);
  const e = point(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export function Gauge({
  progress,
  size = 220,
  stroke = 14,
  children,
  accessibilityLabel,
}: {
  /** Fraction of the limit used; above 1 means over. */
  progress: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const id = `gauge${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const over = progress > 1;
  const p = Math.max(0, Math.min(progress, 1));
  const c = size / 2;
  const r = (size - stroke) / 2 - 6; // room for the knob
  const end = START + SWEEP * p;
  const knob = point(c, c, r, end);
  // The arc is open at the bottom, so the gauge needs less height than width.
  const height = c + r * Math.sin((45 * Math.PI) / 180) + stroke / 2 + 8;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      style={{ width: size, height, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.gaugeGradient[0]} />
            <Stop offset="1" stopColor={colors.gaugeGradient[1]} />
          </LinearGradient>
        </Defs>
        <Path
          d={arc(c, c, r, START, START + SWEEP)}
          stroke={colors.fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
        {p > 0.001 ? (
          <Path
            d={arc(c, c, r, START, Math.max(end, START + 0.5))}
            stroke={over ? colors.negative : `url(#${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
        <Circle
          cx={knob.x}
          cy={knob.y}
          r={stroke / 2 + 4}
          fill={colors.surface}
          stroke={over ? colors.negative : colors.gaugeGradient[1]}
          strokeWidth={4}
        />
      </Svg>
      <View style={{ alignItems: 'center', paddingTop: 8 }}>{children}</View>
    </View>
  );
}
