import { Image } from 'expo-image';
import { View } from 'react-native';

/**
 * The official BUD logo, exactly as supplied (assets/images/bud-logo-original.png,
 * resized to bud-logo.png for the app). It is shown whole and square — never
 * redrawn, recoloured or cropped. Only the logo's own rounded tile corners are
 * followed, so its off-white margin doesn't show as a square in dark mode.
 */
const LOGO = require('../../assets/images/bud-logo.png');

export function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="BUD — Stay on Track"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2,
        borderCurve: 'continuous',
        overflow: 'hidden',
      }}
    >
      <Image source={LOGO} style={{ width: size, height: size }} contentFit="contain" />
    </View>
  );
}
