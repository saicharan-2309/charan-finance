/**
 * Design tokens. One source of truth for colour, type, spacing, radius and
 * elevation. Components read these through `useTheme()` — never hard-code.
 *
 * Identity — "rupee ink on note paper"
 *   * Surfaces are cool, faintly green-grey note paper with white cards, not
 *     the cream of every other "calm" app.
 *   * Text and the hero are a deep indigo ink, the colour of the print on an
 *     Indian banknote. Actions are a clear indigo.
 *   * Categories and charts take their hues from the banknotes themselves:
 *     ₹50 blue, ₹200 marigold, ₹100 lavender, ₹20 olive, ₹2000 magenta,
 *     ₹10 chocolate, plus a teal. ₹500 stone grey is kept for "Other".
 *   * Display type is Bricolage Grotesque — a grotesque with some ink-trap
 *     character — used for big money figures and screen titles only. Body
 *     copy and every number in a list stay in the system face, whose tabular
 *     figures line columns of amounts up exactly.
 *
 * Colour never carries meaning alone: money always has a sign or a label, and
 * chart series are always named.
 *
 * Contrast (WCAG, checked): light text 16.6:1, secondary 6.3:1, brand 8.2:1,
 * positive 5.5:1, negative 5.7:1, warning 5.6:1 on white; all ≥ 4.8:1 on the
 * paper background. Dark: text 14.8:1, secondary 7.6:1, every status colour
 * ≥ 6.7:1. `textTertiary` (3.7:1 light) is only for captions that repeat
 * information shown nearby.
 */
import { Platform, type TextStyle } from 'react-native';

export interface Palette {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
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
  /** The ink-indigo hero panel and the text on it. */
  hero: string;
  heroText: string;
  heroMuted: string;
  heroTrack: string;
  /** Marigold — "today" on the hero's pace track, and auto-captured badges. */
  highlight: string;
}

export const lightPalette: Palette = {
  background: '#F1F3EE',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F6F7F3',
  border: '#E3E6DF',
  borderStrong: '#CDD2C8',
  text: '#161D36',
  textSecondary: '#5A6072',
  textTertiary: '#7E8494',
  textInverse: '#FFFFFF',
  brand: '#3442B0',
  brandPressed: '#28349A',
  brandSoft: '#E9EBFA',
  onBrand: '#FFFFFF',
  positive: '#19784F',
  positiveSoft: '#E3F2EA',
  negative: '#B83A31',
  negativeSoft: '#F9E6E4',
  warning: '#8F5E08',
  warningSoft: '#FBF0DA',
  info: '#1F6FA8',
  infoSoft: '#E2EFF8',
  overlay: 'rgba(22, 29, 54, 0.42)',
  skeleton: '#E8EBE4',
  chartGrid: '#ECEEE8',
  transfer: '#5D6577',
  hero: '#18213F',
  heroText: '#F4F5F0',
  heroMuted: '#A9B0C8',
  heroTrack: '#2A3459',
  highlight: '#F2B441',
};

export const darkPalette: Palette = {
  background: '#0E1322',
  surface: '#161C2E',
  surfaceElevated: '#1C2338',
  surfaceMuted: '#1A2033',
  border: '#252D45',
  borderStrong: '#343E5C',
  text: '#EEF0EA',
  textSecondary: '#A6ADC2',
  textTertiary: '#7C849C',
  textInverse: '#0E1322',
  brand: '#8F9BFF',
  brandPressed: '#7884F0',
  brandSoft: '#20264A',
  onBrand: '#0E1322',
  positive: '#5CC896',
  positiveSoft: '#13291F',
  negative: '#F08A80',
  negativeSoft: '#2D1A1B',
  warning: '#E4B25A',
  warningSoft: '#2A2214',
  info: '#6FB3E6',
  infoSoft: '#142536',
  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: '#1F263A',
  chartGrid: '#222A40',
  transfer: '#A7AEC0',
  hero: '#1F2848',
  heroText: '#F4F5F0',
  heroMuted: '#A9B0C8',
  heroTrack: '#323D66',
  highlight: '#F2B441',
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
 * roundest, cards less so, controls and rows tighter still.
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

/** Font family names registered in the root layout (see `FONT_ASSETS`). */
export const fonts = {
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
  displayMedium: 'BricolageGrotesque_600SemiBold',
} as const;

const system = Platform.select({ ios: 'System', default: undefined });
const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

/**
 * A deliberately wide hierarchy: a headline figure is more than twice the size
 * of the label under it, so the eye lands on the number first. Custom-font
 * styles leave fontWeight unset — the weight is in the family name, and a
 * synthetic bold on top would smear it.
 */
export const typography = {
  display: {
    fontFamily: fonts.displayHeavy,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.4,
  },
  largeTitle: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  headline: { fontFamily: fonts.displayMedium, fontSize: 19, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontFamily: system, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily: system, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontFamily: system, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  subhead: { fontFamily: system, fontSize: 14, lineHeight: 19, fontWeight: '500' },
  footnote: { fontFamily: system, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontFamily: system, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  /** Small section label — sentence case, set apart by weight, not capitals. */
  overline: { fontFamily: system, fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: 0 },
  amount: { fontFamily: system, fontSize: 16, lineHeight: 22, fontWeight: '600', fontVariant: tabular },
  amountLarge: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/** Lift comes from contrast with the paper background, not heavy shadow. */
export const elevation = {
  card: Platform.select({
    ios: {
      shadowColor: '#161D36',
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
    },
    default: { elevation: 1 },
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#161D36',
      shadowOpacity: 0.16,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
    default: { elevation: 6 },
  }),
};

export const motion = {
  fast: 160,
  normal: 240,
  slow: 420,
} as const;

/**
 * Categorical chart colours from the banknote inks, assigned in fixed order
 * (never cycled past the end — extra series fold into "Other", in stone grey).
 *
 * Validated on the real surfaces (#FFFFFF light, #161C2E dark) with the
 * data-viz palette checks: OKLCH lightness band, chroma ≥ 0.10, adjacent-pair
 * separation under simulated protanopia/deuteranopia (worst ΔE 11.1 dark),
 * normal-vision separation ≥ 15 ΔE, and ≥ 3:1 contrast against the surface —
 * all passing in both modes. The order is what makes the CVD check pass:
 * magenta never sits next to teal, olive never next to chocolate.
 */
export const chartColorsLight = [
  '#1F86C7', // ₹50 blue
  '#C07F0A', // ₹200 marigold
  '#7A5CCB', // ₹100 lavender
  '#5E9424', // ₹20 olive
  '#C03587', // ₹2000 magenta
  '#A2541F', // ₹10 chocolate
  '#0A8F80', // teal
];
export const chartColorsDark = [
  '#3B8FC9',
  '#B8822A',
  '#8C74D6',
  '#6E9F37',
  '#CF4D99',
  '#B86E3A',
  '#1E9E8E',
];
/** ₹500 stone — "Other" and anything folded. */
export const chartOther = { light: '#8A9097', dark: '#7C849C' } as const;
