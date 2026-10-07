import { useId } from 'react';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

/**
 * The BUD mark, redrawn from the logo artwork: a deep-green squircle tile
 * lit from the top-left (sage → green → forest), carrying the brushed-silver
 * "BD" monogram. Colours are the ones sampled from the logo (see tokens.ts);
 * they're fixed here because the mark is the same in light and dark mode.
 */
const TILE = ['#B6CBB5', '#537565', '#356057', '#163631'] as const;
const SILVER = ['#F1F6F3', '#B9D0C8', '#86A9A1'] as const;

export function BrandMark({ size = 48 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="BUD">
      <Defs>
        <LinearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={TILE[0]} />
          <Stop offset="0.28" stopColor={TILE[1]} />
          <Stop offset="0.6" stopColor={TILE[2]} />
          <Stop offset="1" stopColor={TILE[3]} />
        </LinearGradient>
        <RadialGradient id={`g${id}`} cx="0.15" cy="0.05" r="0.7">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`s${id}`} x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0" stopColor={SILVER[0]} />
          <Stop offset="0.5" stopColor={SILVER[1]} />
          <Stop offset="1" stopColor={SILVER[2]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="1024" height="1024" rx="232" fill={`url(#t${id})`} />
      <Rect x="0" y="0" width="1024" height="1024" rx="232" fill={`url(#g${id})`} />
      <SvgText
        x="512"
        y="676"
        textAnchor="middle"
        fontSize="520"
        fontWeight="800"
        letterSpacing="-60"
        fill={`url(#s${id})`}
      >
        BD
      </SvgText>
    </Svg>
  );
}
