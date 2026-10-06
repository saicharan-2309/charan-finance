/**
 * Design tokens. One source of truth for colour, type, spacing, radius and
 * elevation. Components read these through `useTheme()` — never hard-code.
 *
 * Identity — "violet glass"
 *   * Apple-grade restraint: a cool, faintly lavender grey canvas with white
 *     cards that float on soft, wide, low shadows (no borders in light mode).
 *     In dark mode the canvas goes near-black and cards lift by tone alone.
 *   * One accent: an iris violet. It colours actions, the selected tab and the
 *     Home hero, which is a violet gradient card — the one rich surface on the
 *     screen. Everything else stays neutral so the numbers lead.
 *   * A warm coral → amber gauge is the single secondary accent, used only for
 *     progress against a limit (budget gauges, "today" on the pace track).
 *   * Type is the system face — San Francisco on iPhone — everywhere. Big money
 *     figures are SF heavy with tight tracking; every number in a list uses
 *     tabular figures so columns of amounts line up.
 *   * Corners are continuous (squircle) on iOS, and radius follows hierarchy:
 *     hero roundest, then cards, then controls.
 *   * Categories and charts keep the validated banknote-ink palette below.
 *
 * Colour never carries meaning alone: money always has a sign or a label, and
 * chart series are always named.
 *
 * Contrast (WCAG, checked): light text 18.1:1,
 * secondary 5.6:1, brand 6.7:1, positive 5.5:1, negative 5.4:1, warning 5.6:1
 * on white; all ≥ 4.8:1 on the canvas. Dark: text 16.1:1, secondary 7.1:1,
 * brand 6.8:1, every status colour ≥ 7.3:1 on the dark card. White on the hero
 * gradient ≥ 5.9:1 at its lightest stop; hero secondary text ≥ 4.6:1. Chart
 * colours keep ≥ 4.3:1 on the dark card.
 * `textTertiary` (3.3:1 light) is only for captions that repeat information
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
  /** The Home hero: a violet gradient card, and the text on it. */
  hero: string;
  heroGradient: readonly [string, string, string];
  heroText: string;
  heroMuted: string;
  heroTrack: string;
  /** Credit cards in the accounts strip are drawn as a graphite card. */
  cardGradient: readonly [string, string];
  /** The warm gauge (coral → amber): progress against a limit. */
  gaugeGradient: readonly [string, string];
  /** The weekly income/expense chart. Always shown with a legend. */
  income: string;
  expense: string;
  /** Payment-method cards in the Home carousel, assigned in order (white text ≥ 4.5:1 at the dark stop, ≥ 3:1 large text at the light stop). */
  accountGradients: readonly (readonly [string, string])[];
  /** Category tiles under "Expenses" — every tile is named, colour is decoration. */
  tileGradients: readonly (readonly [string, string])[];
  /** Amber — "today" on the hero's pace track, and auto-captured badges. */
  highlight: string;
  /** Colour of the soft, wide card shadow (light mode only). */
  shadow: string;
  /** Floating chrome (tab bar): its hairline edge, and its fill where no blur exists. */
  chromeStroke: string;
  chromeFill: string;
}

const ACCOUNT_GRADIENTS = [
  ['#6A4BE8', '#4A30C8'], // violet
  ['#D93D4A', '#B42A42'], // coral
  ['#2F6BE0', '#1F49B8'], // blue
  ['#0C8076', '#0A6A62'], // teal
  ['#8E44C8', '#6B2FA6'], // purple
  ['#3A3A4C', '#1E1E28'], // graphite
] as const;

const TILE_GRADIENTS = [
  ['#2F6BE0', '#1F49B8'], // blue
  ['#4338CA', '#2E2694'], // indigo
  ['#8E44C8', '#6B2FA6'], // purple
  ['#C2337E', '#9A2266'], // magenta
  ['#0C8076', '#0A6A62'], // teal
  ['#B35F0F', '#8E480A'], // amber
] as const;

export const lightPalette: Palette = {
  background: '#F3F3F8',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F0F0F5',
  fill: '#E7E7EE',
  border: '#E7E7EF',
  borderStrong: '#D3D3DE',
  text: '#15151E',
  textSecondary: '#666676',
  textTertiary: '#8C8C9B',
  textInverse: '#FFFFFF',
  brand: '#5B3FD9',
  brandPressed: '#4B31C2',
  brandSoft: '#EEEBFD',
  onBrand: '#FFFFFF',
  positive: '#19784F',
  positiveSoft: '#E3F3EA',
  negative: '#BF3A30',
  negativeSoft: '#FBE8E6',
  warning: '#8F5E08',
  warningSoft: '#FBF0DA',
  info: '#1F6FA8',
  infoSoft: '#E4EFF8',
  overlay: 'rgba(21, 21, 30, 0.4)',
  skeleton: '#E9E9F0',
  chartGrid: '#EEEEF3',
  transfer: '#626275',
  hero: '#4E33D8',
  heroGradient: ['#6046E8', '#4E33D8', '#3B22B0'],
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255, 255, 255, 0.84)',
  heroTrack: 'rgba(255, 255, 255, 0.2)',
  cardGradient: ['#34344A', '#15151E'],
  gaugeGradient: ['#FF9A3C', '#F2554B'],
  income: '#3D63E0',
  expense: '#E5484D',
  accountGradients: ACCOUNT_GRADIENTS,
  tileGradients: TILE_GRADIENTS,
  highlight: '#FFC14D',
  shadow: '#2B2266',
  chromeStroke: 'rgba(255, 255, 255, 0.7)',
  chromeFill: 'rgba(255, 255, 255, 0.82)',
};

export const darkPalette: Palette = {
  background: '#0A0A0F',
  surface: '#18181F',
  surfaceElevated: '#202029',
  surfaceMuted: '#22222B',
  fill: '#2B2B35',
  border: '#2A2A35',
  borderStrong: '#3A3A47',
  text: '#F4F4F7',
  textSecondary: '#A3A3B2',
  textTertiary: '#767684',
  textInverse: '#0A0A0F',
  brand: '#A193FF',
  brandPressed: '#8E7EF5',
  brandSoft: '#25203F',
  onBrand: '#0A0A0F',
  positive: '#5CC896',
  positiveSoft: '#132A20',
  negative: '#F38A80',
  negativeSoft: '#2E1A1B',
  warning: '#E6B45C',
  warningSoft: '#2A2214',
  info: '#6FB3E6',
  infoSoft: '#132535',
  overlay: 'rgba(0, 0, 0, 0.62)',
  skeleton: '#202029',
  chartGrid: '#25252F',
  transfer: '#A7A7B6',
  hero: '#4A31D0',
  heroGradient: ['#5A3FE3', '#4A31D0', '#2E1A96'],
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255, 255, 255, 0.84)',
  heroTrack: 'rgba(255, 255, 255, 0.18)',
  cardGradient: ['#3A3A4C', '#1E1E28'],
  gaugeGradient: ['#FFA24A', '#F6625A'],
  income: '#7B9BFF',
  expense: '#FF7A7E',
  accountGradients: ACCOUNT_GRADIENTS,
  tileGradients: TILE_GRADIENTS,
  highlight: '#FFC14D',
  shadow: '#000000',
  chromeStroke: 'rgba(255, 255, 255, 0.08)',
  chromeFill: 'rgba(32, 32, 41, 0.82)',
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
 * Categorical chart colours from the banknote inks, assigned in fixed order
 * (never cycled past the end — extra series fold into "Other", in stone grey).
 *
 * Validated on white (light) and a dark card with the data-viz palette checks:
 * OKLCH lightness band, chroma ≥ 0.10, adjacent-pair separation under
 * simulated protanopia/deuteranopia (worst ΔE 11.1 dark), normal-vision
 * separation ≥ 15 ΔE, and ≥ 3:1 contrast against the surface — all passing in
 * both modes. The order is what makes the CVD check pass: magenta never sits
 * next to teal, olive never next to chocolate.
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
export const chartColorsDark = ['#3B8FC9', '#B8822A', '#8C74D6', '#6E9F37', '#CF4D99', '#B86E3A', '#1E9E8E'];
/** ₹500 stone — "Other" and anything folded. */
export const chartOther = { light: '#8A9097', dark: '#7C849C' } as const;
