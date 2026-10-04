import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Charan Finance mark: a rounded tile with an upward arc that resolves into a
 * dot — growth and a single point of clarity. Same geometry as the app icon.
 * Banknote ink with a single marigold dot, no gradient.
 */
export function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="Charan Finance">
      <Rect x="0" y="0" width="1024" height="1024" rx="230" fill="#18213F" />
      <Path
        d="M250 700 C 330 700, 420 640, 480 540 C 540 440, 610 360, 720 330"
        stroke="#FFFFFF"
        strokeWidth="92"
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx="744" cy="322" r="70" fill="#F2B441" />
      <Rect x="250" y="760" width="524" height="34" rx="17" fill="#FFFFFF" opacity="0.35" />
    </Svg>
  );
}
