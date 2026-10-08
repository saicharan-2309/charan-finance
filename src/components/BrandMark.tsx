import { Image } from 'expo-image';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * The official BUD logo and wordmark, cut from the supplied artwork
 * (assets/images/bud-logo-original.png) — never redrawn or recoloured.
 *
 * * bud-logo.png: the logo tile itself, with its own rounded corners and a
 *   transparent outside (the artwork's off-white margin and drop shadow are
 *   removed, so the edges are clean on any background).
 * * bud-wordmark.png: the "BUD" lettering from the logo, orange inside the D,
 *   on transparent. In dark mode the letters are light (bud-wordmark-dark.png)
 *   so they stay readable; the orange is unchanged.
 */
const LOGO = require('../../assets/images/bud-logo.png');
const WORDMARK = require('../../assets/images/bud-wordmark.png');
const WORDMARK_DARK = require('../../assets/images/bud-wordmark-dark.png');

/** 512 × 522 — the tile is very slightly taller than wide. */
const LOGO_ASPECT = 522 / 512;
/** 480 × 144. */
const WORDMARK_ASPECT = 144 / 480;

export function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <Image
      source={LOGO}
      style={{ width: size, height: Math.round(size * LOGO_ASPECT) }}
      contentFit="contain"
      accessibilityLabel="BUD — Stay on Track"
      accessible
    />
  );
}

export function BrandWordmark({ height = 24 }: { height?: number }) {
  const { scheme } = useTheme();
  return (
    <Image
      source={scheme === 'dark' ? WORDMARK_DARK : WORDMARK}
      style={{ height, width: Math.round(height / WORDMARK_ASPECT) }}
      contentFit="contain"
      accessibilityLabel="BUD"
      accessible
    />
  );
}
