/**
 * Design tokens. One source of truth for colour, type, spacing, radius and
 * elevation. Components read these through `useTheme()` — never hard-code.
 *
 * Identity — BUD
 *   Every colour here comes from the official BUD logo
 *   (assets/images/bud-logo-original.png), sampled from the artwork:
 *     off-white   #FDFEFB  the canvas the logo sits on (lavender / peach glow)
 *     navy        #071645  the "BUD" wordmark, the tile's deep corner → all text
 *     dark blue   #1A3FAC  the B's lower bowl                        → the brand colour
 *     bright blue #1067FE  the swoosh                                → money in
 *     cyan        #51ACFE  the swoosh's light edge                   → quiet accent
 *     coral       #E5445D  the ribbon, and the dot on the D          → spending, alerts
 *     peach       #FE9D72  the ribbon's warm end                     → progress, highlights
 *   Navy and blue carry the identity; coral and peach are the only warm tones
 *   and are used sparingly.
 *
 *   * A cool off-white canvas with white cards that float on soft, navy-tinted
 *     shadows; in dark mode a deep navy canvas, cards lift by tone.
 *   * The Home hero, the Add button and selected states use the logo tile's
 *     gradient (bright blue → dark blue → navy).
 *   * Type is the system face (San Francisco on iPhone) everywhere; amounts
 *     use tabular figures.
 *   * Continuous (squircle) corners; radius follows hierarchy.
 *
 * Colour never carries meaning alone: money always has a sign or a label, and
 * chart series are always named.
 *
 * Contrast is checked by tests/tokens-contrast.test.ts (WCAG): body text,
 * secondary text, brand and every status colour ≥ 4.5:1 on their surface in
 * both modes; white ≥ 4.5:1 on every swatch and on the hero. `textTertiary`
 * (≥ 3:1) is only for captions that repeat information shown nearby.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export interface Palette {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  /** Recessed fill for tracks and control backgrounds (segmented control, switches). */
  fill: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  brand: string;
  brandPressed: string;
  brandSoft: string;
  onBrand: string;
  /** The cyan edge of the logo's swoosh — quiet accents, tracks, avatars. */
  accent: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  overlay: string;
  skeleton: string;
  chartGrid: string;
  /** Neutral transfer colour (not income, not expense). */
  transfer: string;
  /** The Home hero and Add button: the logo's tile gradient, and the text on it. */
  hero: string;
  heroGradient: readonly [string, string, string];
  heroText: string;
  heroMuted: string;
  heroTrack: string;
  /** Up / down figures on the hero card (light tints that read on blue). */
  heroUp: string;
  heroDown: string;
  /** A card with no colour chosen is drawn in ink. */
  cardGradient: readonly [string, string];
  /** Progress against a limit: the logo ribbon, peach → coral. Over the limit turns `negative`. */
  gaugeGradient: readonly [string, string];
  /** Income/expense series. Always shown with a legend. */
  income: string;
  expense: string;
  /** Category tiles under "Expenses" — every tile is named, colour is decoration. */
  tileGradients: readonly (readonly [string, string])[];
  /** Warm peach-amber — the "needs a look" badge. */
  highlight: string;
  /** The logo's orange — the second accent: Add, BUD AI, insights, "safe to spend". */
  warm: string;
  /** The logo's ribbon, orange → coral, behind white glyphs (the Add button). */
  warmGradient: readonly [string, string];
  /** Colour of the soft, wide card shadow (light mode only). */
  shadow: string;
  /** Floating chrome (tab bar): its hairline edge, and its fill where no blur exists. */
  chromeStroke: string;
  chromeFill: string;
  /** Glass fill where only a CSS blur is available (web preview). */
  glassFill: string;
  /**
   * The backdrop: large diffuse radial glows over `background` (a light
   * pastel aurora). x/y are the glow's centre and r its radius, as fractions
   * of the screen; opacity is at the centre, fading to nothing at the edge.
   */
  aurora: readonly { color: string; x: number; y: number; r: number; opacity: number }[];
}

/**
 * The BUD swatch set for payment methods and categories: the logo's blues,
 * navy, cyan, coral and peach, plus a few quiet companions (indigo, rose,
 * slate, gold, graphite). Each has a lighter and deeper shade. White text is
 * ≥ 4.5:1 on every base and deep shade; the light shades are for tinted
 * backgrounds.
 */
export const BUD_SWATCHES = [
  { name: 'Blue', base: '#1260E8', light: '#E3EDFE', deep: '#0B3FA6' },
  { name: 'Royal', base: '#1A3FAC', light: '#E5EAF8', deep: '#0F2672' },
  { name: 'Navy', base: '#0B1A45', light: '#E4E7F0', deep: '#040B24' },
  { name: 'Cyan', base: '#0E76A8', light: '#E0F3FB', deep: '#0A5278' },
  { name: 'Indigo', base: '#4B47C2', light: '#EAE9FA', deep: '#2E2A8A' },
  { name: 'Coral', base: '#D2304E', light: '#FCE6EA', deep: '#9E2138' },
  { name: 'Peach', base: '#BE5228', light: '#FDEDE3', deep: '#8E3A1A' },
  { name: 'Rose', base: '#B4436C', light: '#F8E6EE', deep: '#83284B' },
  { name: 'Slate', base: '#4A5272', light: '#E8EAF0', deep: '#2C3250' },
  { name: 'Gold', base: '#93650F', light: '#F6EDDA', deep: '#6B480A' },
  { name: 'Graphite', base: '#2B2F3A', light: '#E6E7EA', deep: '#15171D' },
] as const;

/** Darkens (negative) or lightens (positive) a #RRGGBB colour by a fraction. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount),
  );
  return (
    '#' +
    ch
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** A card's gradient from its chosen colour: the colour itself into its deep shade. */
export function cardGradientFor(
  color: string | null | undefined,
  fallback: readonly [string, string],
): readonly [string, string] {
  if (!color) return fallback;
  const s = BUD_SWATCHES.find((x) => x.base.toLowerCase() === color.toLowerCase());
  return s ? [s.base, s.deep] : [color, shade(color, -0.35)];
}

const TILE_GRADIENTS = [
  ['#2F7BFF', '#1A3FAC'], // blue
  ['#F0596E', '#C22D4A'], // coral
  ['#2BA8E0', '#1260C8'], // cyan
  ['#F59A6A', '#D9573F'], // peach
  ['#5E5BD6', '#2E2A8A'], // indigo
  ['#2A3A73', '#0B1A45'], // navy
] as const;

export const lightPalette: Palette = {
  background: '#EEF4FF',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F1F5FB',
  fill: '#E8EEF8',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  text: '#172554',
  textSecondary: '#5B6B82',
  textTertiary: '#8391A7',
  textInverse: '#FFFFFF',
  brand: '#2563EB',
  brandPressed: '#1D4ED8',
  brandSoft: '#E3ECFF',
  onBrand: '#FFFFFF',
  accent: '#60A5FA',
  positive: '#047857',
  positiveSoft: '#E0F5EC',
  negative: '#C93338',
  negativeSoft: '#FDE8E8',
  warning: '#8A6512',
  warningSoft: '#F6EEDA',
  info: '#1D4ED8',
  infoSoft: '#E5EDFC',
  overlay: 'rgba(7, 22, 69, 0.42)',
  skeleton: '#E6ECF6',
  chartGrid: '#ECEEF4',
  transfer: '#5B6280',
  hero: '#3448D8',
  heroGradient: ['#2F6BEA', '#3448D8', '#5B3FD6'],
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255, 255, 255, 0.84)',
  heroTrack: 'rgba(255, 255, 255, 0.18)',
  heroUp: '#A7F3D0',
  heroDown: '#FECACA',
  cardGradient: ['#22305E', '#071645'],
  gaugeGradient: ['#FE9D72', '#E5445D'],
  income: '#059669',
  expense: '#E5484D',
  tileGradients: TILE_GRADIENTS,
  highlight: '#F2A65A',
  warm: '#E0612A',
  warmGradient: ['#F06A3A', '#D9364F'],
  shadow: '#3448D8',
  chromeStroke: 'rgba(255, 255, 255, 0.7)',
  chromeFill: 'rgba(255, 255, 255, 0.78)',
  glassFill: 'rgba(255, 255, 255, 0.62)',
  aurora: [
    { color: '#BFDBFE', x: 0.05, y: 0.08, r: 0.75, opacity: 0.7 }, // sky blue, top left
    { color: '#DDD6FE', x: 0.95, y: 0.2, r: 0.7, opacity: 0.65 }, // lavender, top right
    { color: '#FBCFE8', x: 0.9, y: 0.62, r: 0.62, opacity: 0.5 }, // blush pink, right
    { color: '#FED7AA', x: 0.08, y: 0.88, r: 0.62, opacity: 0.45 }, // peach, bottom left
    { color: '#C7D2FE', x: 0.45, y: 0.5, r: 0.55, opacity: 0.35 }, // soft periwinkle, middle
  ],
};

export const darkPalette: Palette = {
  background: '#070B1C',
  surface: '#111733',
  surfaceElevated: '#171E3E',
  surfaceMuted: '#151B38',
  fill: '#1E2647',
  border: '#1E2546',
  borderStrong: '#2E3760',
  text: '#EEF1FB',
  textSecondary: '#A6ADCB',
  textTertiary: '#7880A3',
  textInverse: '#070B1C',
  brand: '#86A8FF',
  brandPressed: '#7193F0',
  brandSoft: '#18244D',
  onBrand: '#070B1C',
  accent: '#5CC3F5',
  positive: '#5FD39A',
  positiveSoft: '#10291E',
  negative: '#FF8A94',
  negativeSoft: '#331726',
  warning: '#E3BA62',
  warningSoft: '#2B2414',
  info: '#86B4FF',
  infoSoft: '#13213F',
  overlay: 'rgba(0, 0, 0, 0.62)',
  skeleton: '#171E3E',
  chartGrid: '#1C2445',
  transfer: '#A3AACB',
  hero: '#1B3A9E',
  heroGradient: ['#2F5FD9', '#2E3FB8', '#4B33B0'],
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255, 255, 255, 0.84)',
  heroTrack: 'rgba(255, 255, 255, 0.16)',
  heroUp: '#A7F3D0',
  heroDown: '#FECACA',
  cardGradient: ['#253262', '#0E1838'],
  gaugeGradient: ['#FEB088', '#FF6B7A'],
  income: '#34D399',
  expense: '#FF7A84',
  tileGradients: TILE_GRADIENTS,
  highlight: '#F2B46A',
  warm: '#FF9A6B',
  warmGradient: ['#F06A3A', '#D9364F'],
  shadow: '#000000',
  chromeStroke: 'rgba(255, 255, 255, 0.09)',
  chromeFill: 'rgba(17, 23, 51, 0.84)',
  glassFill: 'rgba(23, 30, 62, 0.6)',
  aurora: [
    { color: '#1E3A8A', x: 0.05, y: 0.08, r: 0.75, opacity: 0.45 },
    { color: '#4C1D95', x: 0.95, y: 0.22, r: 0.7, opacity: 0.35 },
    { color: '#831843', x: 0.9, y: 0.65, r: 0.6, opacity: 0.22 },
    { color: '#7C2D12', x: 0.08, y: 0.9, r: 0.6, opacity: 0.2 },
  ],
};

/** The 4-point scale, with room to breathe. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
  huge: 52,
} as const;

/** Standard horizontal page gutter. */
export const GUTTER = 20;

/**
 * Radius follows hierarchy rather than one value everywhere: the hero is the
 * roundest, cards less so, controls and rows tighter still. Pair with
 * `continuous` so iOS draws Apple's squircle instead of a circular arc.
 */
export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 30,
  pill: 999,
} as const;

/** Continuous (squircle) corners on iOS; ignored elsewhere. */
export const continuous: ViewStyle = { borderCurve: 'continuous' };

/**
 * Kept for callers that name a family directly. The app now uses the system
 * face throughout, so these resolve to it (weights come from `typography`).
 */
const system = Platform.select({ ios: 'System', default: undefined });
export const fonts = {
  display: system,
  displayHeavy: system,
  displayMedium: system,
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

/**
 * Apple's type ramp (iOS text styles), with a wider gap at the top: a headline
 * figure is more than twice the size of the label under it, so the eye lands
 * on the number first. Large sizes take negative tracking, as SF Display does.
 */
export const typography = {
  display: { fontFamily: system, fontSize: 44, lineHeight: 50, fontWeight: '700', letterSpacing: -1.2 },
  largeTitle: { fontFamily: system, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontFamily: system, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 },
  headline: { fontFamily: system, fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.35 },
  body: { fontFamily: system, fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.2 },
  bodyStrong: { fontFamily: system, fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  callout: { fontFamily: system, fontSize: 16, lineHeight: 21, fontWeight: '400', letterSpacing: -0.15 },
  subhead: { fontFamily: system, fontSize: 15, lineHeight: 20, fontWeight: '500', letterSpacing: -0.1 },
  footnote: { fontFamily: system, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontFamily: system, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  /** Small section label — sentence case, set apart by weight, not capitals. */
  overline: { fontFamily: system, fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: 0 },
  amount: { fontFamily: system, fontSize: 17, lineHeight: 22, fontWeight: '600', fontVariant: tabular },
  amountLarge: { fontFamily: system, fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.7 },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/**
 * Depth comes from soft, wide, low-opacity shadows tinted with the accent —
 * never a hard drop shadow. Dark mode lifts cards by tone instead.
 */
export function elevationFor(shadow: string) {
  return {
    card: Platform.select<ViewStyle>({
      ios: {
        shadowColor: shadow,
        shadowOpacity: 0.07,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
      },
      web: { boxShadow: `0 6px 18px ${shadow}12` } as ViewStyle,
      default: { elevation: 1 },
    }),
    floating: Platform.select<ViewStyle>({
      ios: {
        shadowColor: shadow,
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
      },
      web: { boxShadow: `0 10px 24px ${shadow}2E` } as ViewStyle,
      default: { elevation: 6 },
    }),
    /** The hero card: a coloured glow in its own hue. */
    hero: (color: string) =>
      Platform.select<ViewStyle>({
        ios: {
          shadowColor: color,
          shadowOpacity: 0.35,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 12 },
        },
        web: { boxShadow: `0 12px 28px ${color}59` } as ViewStyle,
        default: { elevation: 8 },
      }),
  };
}

export const elevation = elevationFor(lightPalette.shadow);

export const motion = {
  fast: 160,
  normal: 240,
  slow: 420,
} as const;

/** Apple-like springs for Animated.spring: quick to settle, no wobble. */
export const springs = {
  snappy: { damping: 22, stiffness: 320, mass: 1 },
  smooth: { damping: 26, stiffness: 200, mass: 1 },
} as const;

/**
 * Categorical chart colours — the BUD logo palette, assigned in fixed order
 * and never cycled past the end (extra series fold into "Other", in stone).
 *
 * Neighbouring colours alternate cool and warm (blue, coral, cyan, peach,
 * indigo, raspberry, navy), so adjacent segments stay distinct with colour
 * vision deficiency; every colour is ≥ 3:1 against its surface in its mode
 * (light set on white, dark set on the dark card). Legends always name them.
 */
export const chartColorsLight = [
  '#1260E8', // blue
  '#E5445D', // coral
  '#1590C4', // cyan
  '#D2692C', // peach
  '#5B4FC8', // indigo
  '#B83E78', // raspberry
  '#0B1A45', // navy
];
export const chartColorsDark = ['#5C9BFF', '#FF6B7A', '#4FCBF2', '#FFA868', '#9C8CF5', '#E77FB2', '#B4C3EE'];
/** Stone — "Other" and anything folded. */
export const chartOther = { light: '#8E93A6', dark: '#8A90AA' } as const;
