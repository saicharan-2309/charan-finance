/**
 * Design tokens. One source of truth for colour, type, spacing, radius and
 * elevation. Components read these through `useTheme()` — never hard-code.
 *
 * Identity — BUD
 *   Every colour here comes from the BUD logo, sampled from the artwork:
 *     paper      #F6F5F1  the background the logo sits on
 *     sage       #537565  the tile's light edge
 *     green      #356057  the tile's body           → the brand colour
 *     forest     #163631  the tile's deep corner
 *     silver     #86A9A1  the brushed-metal letters → the quiet accent
 *     ink        #17292F  the "BUD" wordmark         → all text
 *   plus one warm accent, copper, for expenses and alerts — the only warm
 *   tone, chosen to sit with the greens rather than fight them.
 *
 *   * A warm paper canvas with white cards that float on soft, green-tinted
 *     shadows; in dark mode a deep green-black canvas, cards lift by tone.
 *   * The Home hero, the Add button and selected states use the logo's tile
 *     gradient (sage → green → forest).
 *   * Type is the system face (San Francisco on iPhone) everywhere; amounts
 *     use tabular figures.
 *   * Continuous (squircle) corners; radius follows hierarchy.
 *
 * Colour never carries meaning alone: money always has a sign or a label, and
 * chart series are always named.
 *
 * Contrast (WCAG, checked): light text 15.1:1, secondary 5.8:1, brand 7.4:1,
 * positive 5.2:1, negative 5.6:1, warning 5.3:1 on white; all ≥ 4.7:1 on the
 * canvas. Dark: text 14.6:1, secondary 7.4:1, brand 8.2:1, every status colour
 * ≥ 7:1 on the dark card. White on the hero ≥ 5.3:1 at its lightest stop.
 * `textTertiary` (3.2:1 light) is only for captions that repeat information
 * shown nearby.
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
  /** Brushed silver from the logo letters — quiet accents, tracks, avatars. */
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
  /** A card with no colour chosen is drawn in ink. */
  cardGradient: readonly [string, string];
  /** Progress against a limit: silver → green. Over the limit turns `negative`. */
  gaugeGradient: readonly [string, string];
  /** Income/expense series. Always shown with a legend. */
  income: string;
  expense: string;
  /** Category tiles under "Expenses" — every tile is named, colour is decoration. */
  tileGradients: readonly (readonly [string, string])[];
  /** Muted gold — the "needs a look" badge. */
  highlight: string;
  /** Colour of the soft, wide card shadow (light mode only). */
  shadow: string;
  /** Floating chrome (tab bar): its hairline edge, and its fill where no blur exists. */
  chromeStroke: string;
  chromeFill: string;
  /** Glass fill where only a CSS blur is available (web preview). */
  glassFill: string;
}

/**
 * The BUD swatch set for payment methods and categories: the logo greens and
 * silver, ink, plus earthy companions (teal, slate, moss, copper, sand, plum).
 * Each has a lighter and deeper shade. White text is ≥ 4.5:1 on every base
 * and deep shade; the light shades are for tinted backgrounds.
 */
export const BUD_SWATCHES = [
  { name: 'Green', base: '#2F5E52', light: '#E3EDE8', deep: '#163631' },
  { name: 'Sage', base: '#4E7363', light: '#E7EFEA', deep: '#2F4D41' },
  { name: 'Mint', base: '#2F7A64', light: '#E1F0EA', deep: '#1D5646' },
  { name: 'Silver', base: '#4F7A73', light: '#E7EFED', deep: '#30524D' },
  { name: 'Teal', base: '#2B6F78', light: '#E1EEF0', deep: '#1A4E55' },
  { name: 'Slate', base: '#3E4F5A', light: '#E6EAED', deep: '#26333B' },
  { name: 'Ink', base: '#17292F', light: '#E3E7E8', deep: '#0C181C' },
  { name: 'Moss', base: '#5E7A3A', light: '#EBF0E2', deep: '#3D5222' },
  { name: 'Copper', base: '#A65F38', light: '#F5E9E1', deep: '#7A4224' },
  { name: 'Sand', base: '#806640', light: '#F1ECE3', deep: '#5A4528' },
  { name: 'Plum', base: '#6E4C67', light: '#EFE8EE', deep: '#4D3348' },
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
  ['#2F7A64', '#1D5646'], // mint
  ['#A65F38', '#7A4224'], // copper
  ['#2B6F78', '#1A4E55'], // teal
  ['#806640', '#5A4528'], // sand
  ['#6E4C67', '#4D3348'], // plum
  ['#3E4F5A', '#26333B'], // slate
] as const;

export const lightPalette: Palette = {
  background: '#F5F4F0',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EFEEE9',
  fill: '#E8E8E2',
  border: '#E6E5DF',
  borderStrong: '#D2D3CB',
  text: '#17292F',
  textSecondary: '#5A6965',
  textTertiary: '#87928F',
  textInverse: '#FFFFFF',
  brand: '#2F5E52',
  brandPressed: '#244A40',
  brandSoft: '#E3EDE8',
  onBrand: '#FFFFFF',
  accent: '#86A9A1',
  positive: '#2A7A55',
  positiveSoft: '#E2F1E8',
  negative: '#B0453B',
  negativeSoft: '#F8E7E3',
  warning: '#8A6512',
  warningSoft: '#F6EEDA',
  info: '#3D6A86',
  infoSoft: '#E5EEF3',
  overlay: 'rgba(23, 41, 47, 0.42)',
  skeleton: '#EAE9E3',
  chartGrid: '#EDECE6',
  transfer: '#5E6B68',
  hero: '#356057',
  heroGradient: ['#4E7363', '#356057', '#163631'],
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255, 255, 255, 0.84)',
  heroTrack: 'rgba(255, 255, 255, 0.18)',
  cardGradient: ['#2A3D44', '#17292F'],
  gaugeGradient: ['#86A9A1', '#2F5E52'],
  income: '#2F7A64',
  expense: '#B4683E',
  tileGradients: TILE_GRADIENTS,
  highlight: '#C9A24E',
  shadow: '#163631',
  chromeStroke: 'rgba(255, 255, 255, 0.7)',
  chromeFill: 'rgba(250, 249, 245, 0.84)',
  glassFill: 'rgba(250, 249, 245, 0.62)',
};

export const darkPalette: Palette = {
  background: '#0C1513',
  surface: '#16211E',
  surfaceElevated: '#1D2A26',
  surfaceMuted: '#1C2724',
  fill: '#24322E',
  border: '#24312D',
  borderStrong: '#34443F',
  text: '#EEF2EF',
  textSecondary: '#A3B1AC',
  textTertiary: '#76847F',
  textInverse: '#0C1513',
  brand: '#8FC1B1',
  brandPressed: '#7AAF9E',
  brandSoft: '#1E3330',
  onBrand: '#0C1513',
  accent: '#86A9A1',
  positive: '#6CCB9E',
  positiveSoft: '#14291F',
  negative: '#F0907F',
  negativeSoft: '#2E1B18',
  warning: '#E3BA62',
  warningSoft: '#2B2414',
  info: '#8FB9D6',
  infoSoft: '#142430',
  overlay: 'rgba(0, 0, 0, 0.62)',
  skeleton: '#1D2A26',
  chartGrid: '#22302B',
  transfer: '#A7B3AF',
  hero: '#2F5A4E',
  heroGradient: ['#46695A', '#2F5A4E', '#12302A'],
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255, 255, 255, 0.84)',
  heroTrack: 'rgba(255, 255, 255, 0.16)',
  cardGradient: ['#2E4249', '#17292F'],
  gaugeGradient: ['#86A9A1', '#8FC1B1'],
  income: '#7CCBB0',
  expense: '#E39A6E',
  tileGradients: TILE_GRADIENTS,
  highlight: '#D9B562',
  shadow: '#000000',
  chromeStroke: 'rgba(255, 255, 255, 0.08)',
  chromeFill: 'rgba(22, 33, 30, 0.84)',
  glassFill: 'rgba(29, 42, 38, 0.6)',
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
 * Categorical chart colours — the BUD earth palette, assigned in fixed order
 * and never cycled past the end (extra series fold into "Other", in stone).
 *
 * Neighbouring colours alternate warm and cool (green, copper, slate blue,
 * ochre, plum, teal, moss), so adjacent segments stay distinct with colour
 * vision deficiency; every colour is ≥ 3:1 against its surface in its mode
 * (light set on white, dark set on the dark card). Legends always name them.
 */
export const chartColorsLight = [
  '#2F7A64', // mint green
  '#B4683E', // copper
  '#4C6E91', // slate blue
  '#A8873A', // ochre
  '#7A5A86', // plum
  '#3E8F96', // teal
  '#6E8F3E', // moss
];
export const chartColorsDark = ['#5FB295', '#D88A5C', '#7E9EC2', '#C9A65A', '#A887B4', '#62B5BB', '#93B562'];
/** Stone — "Other" and anything folded. */
export const chartOther = { light: '#8C938F', dark: '#8F9894' } as const;
