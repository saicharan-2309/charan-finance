/**
 * Design tokens. One source of truth for colour, type, spacing, radius and
 * elevation. Components read these through `useTheme()` — never hard-code.
 *
 * Identity: a warm, quiet surface — warm whites and soft greys — with a muted
 * clay accent and soft greens, blues, lavenders and ambers used to carry
 * meaning rather than decoration. No gradients, no neon, nothing heavy.
 *
 * Colour never carries meaning alone: money is always paired with a sign or a
 * label, and chart series are always labelled.
 *
 * Every text colour here clears WCAG AA against its own surface (checked:
 * primary 14.9:1, secondary 5.4:1, brand 5.3:1, positive 5.1:1, negative
 * 5.9:1 on light; all ≥ 6.5:1 on dark). `textTertiary` sits at 3.4:1 and is
 * used only for de-emphasised captions that repeat information shown nearby.
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
}

export const lightPalette: Palette = {
  // Warm white page, pure white cards — the card lifts without a heavy border.
  background: '#FBFAF8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F4F2EE',
  border: '#EDEAE4',
  borderStrong: '#DCD8D0',
  text: '#26241F',
  textSecondary: '#6B675F',
  textTertiary: '#8F8A81',
  textInverse: '#FFFFFF',
  // Muted clay — warm and calm, not the saturated orange of a bank app.
  brand: '#A4563A',
  brandPressed: '#8A4730',
  brandSoft: '#F7EDE8',
  onBrand: '#FFFFFF',
  positive: '#3F7A55',
  positiveSoft: '#EBF3ED',
  negative: '#A8453C',
  negativeSoft: '#F8EBEA',
  warning: '#8A6520',
  warningSoft: '#F8F1E3',
  info: '#3A5F9E',
  infoSoft: '#ECF0F8',
  overlay: 'rgba(38, 36, 31, 0.38)',
  skeleton: '#F0EEE9',
  chartGrid: '#F0EEE9',
  transfer: '#5F6670',
};

export const darkPalette: Palette = {
  // Soft charcoal rather than black: calm at night, still clearly dark.
  background: '#131316',
  surface: '#1B1B1F',
  surfaceElevated: '#212126',
  surfaceMuted: '#1F1F24',
  border: '#2B2B31',
  borderStrong: '#3C3C44',
  text: '#F2F0EC',
  textSecondary: '#A8A49C',
  textTertiary: '#7D7974',
  textInverse: '#1C1A18',
  brand: '#E0896A',
  brandPressed: '#C9755A',
  brandSoft: '#2A1E19',
  onBrand: '#1C1A18',
  positive: '#73C08F',
  positiveSoft: '#16241B',
  negative: '#E58A80',
  negativeSoft: '#2A1A18',
  warning: '#D6A861',
  warningSoft: '#262016',
  info: '#8FAFE0',
  infoSoft: '#171E2A',
  overlay: 'rgba(0, 0, 0, 0.55)',
  skeleton: '#242429',
  chartGrid: '#242429',
  transfer: '#A3A8B2',
};

/** Generous by default: the 4-point scale with room to breathe. */
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

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

const fontFamily = Platform.select({ ios: 'System', default: undefined });
const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

/**
 * A deliberately wide hierarchy: a headline figure is more than twice the size
 * of the label under it, so the eye lands on the number first.
 */
export const typography = {
  display: {
    fontFamily,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: tabular,
  },
  largeTitle: { fontFamily, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontFamily, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  headline: { fontFamily, fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontFamily, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontFamily, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  subhead: { fontFamily, fontSize: 14, lineHeight: 19, fontWeight: '500' },
  footnote: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontFamily, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.1 },
  overline: {
    fontFamily,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  amount: { fontFamily, fontSize: 16, lineHeight: 22, fontWeight: '600', fontVariant: tabular },
  amountLarge: {
    fontFamily,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: tabular,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/** Shadows stay soft and low-contrast: a card should lift, not float. */
export const elevation = {
  card: Platform.select({
    ios: {
      shadowColor: '#2A2218',
      shadowOpacity: 0.05,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
    },
    default: { elevation: 1 },
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#2A2218',
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
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
 * Categorical chart colours, assigned in fixed order (never cycled past the
 * end — extra series fold into "Other").
 *
 * These are a step stronger than the muted colours used for category avatars
 * and badges, because a chart segment has to hold its own. Checked with a
 * palette validator on the real surfaces (#FBFAF8 and #FFFFFF light, #17171A
 * dark), not eyeballed: OKLCH lightness band, chroma floor ≥ 0.10,
 * adjacent-pair separation ≥ 8 ΔE under simulated protanopia and
 * deuteranopia, normal-vision separation ≥ 15 ΔE, and WCAG contrast ≥ 3:1
 * against the surface — all passing in both modes.
 *
 * Order matters, and the checks are on *adjacent* slots, which is what the
 * rings and stacks actually need, since neighbouring segments are the ones
 * that touch. Across all pairs, green/teal and indigo/lavender are close,
 * so nothing in the UI asks the reader to match a distant legend swatch to a
 * segment by colour: every series is named next to its own value, category
 * rows carry a labelled bar, and tapping a row opens that category.
 */
export const chartColorsLight = [
  '#C65D3B', // clay
  '#3F6FB5', // soft blue
  '#2F8757', // muted green
  '#8A5EA8', // lavender
  '#0A8468', // teal
  '#B07A1E', // muted amber
  '#5B5FA8', // indigo
  '#C04A6E', // soft rose
];
export const chartColorsDark = [
  '#CE714E',
  '#5A84C2',
  '#369161',
  '#9373BA',
  '#269980',
  '#B8882F',
  '#7479C0',
  '#C8667E',
];
