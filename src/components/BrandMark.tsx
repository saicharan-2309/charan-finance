import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { lightPalette } from '@/theme/tokens';

/**
 * Charan Finance mark: a rounded tile with an upward arc that resolves into a
 * dot — growth and a single point of clarity. Same geometry as the app icon.
 * The tile is the hero's violet gradient; the dot is the amber highlight.
 */
export function BrandMark({ size = 48 }: { size?: number }) {
  const id = `brand${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [a, b, c] = lightPalette.heroGradient;
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="Charan Finance">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={a} />
          <Stop offset="0.5" stopColor={b} />
          <Stop offset="1" stopColor={c} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="1024" height="1024" rx="230" fill={`url(#${id})`} />
      <Path
        d="M250 700 C 330 700, 420 640, 480 540 C 540 440, 610 360, 720 330"
        stroke={lightPalette.heroText}
        strokeWidth="92"
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx="744" cy="322" r="70" fill={lightPalette.highlight} />
      <Rect x="250" y="760" width="524" height="34" rx="17" fill={lightPalette.heroText} opacity="0.35" />
    </Svg>
  );
}
