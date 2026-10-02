/**
 * Design tokens. One source of truth for colour, type, spacing, radius and
 * elevation. Components read these through `useTheme()` — never hard-code.
 *
 * Identity: warm, calm neutrals with a deep saffron ("marigold") brand accent.
 * Money semantics use green/red but are always paired with a sign or label,
 * never colour alone.
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
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F6F5F3',
  border: '#ECEAE6',
  borderStrong: '#D9D6D0',
  text: '#1C1B19',
  textSecondary: '#6B6862',
  textTertiary: '#9A968F',
  textInverse: '#FFFFFF',
  brand: '#C2410C',
  brandPressed: '#9A3412',
  brandSoft: '#FFF1E8',
  onBrand: '#FFFFFF',
  positive: '#15803D',
  positiveSoft: '#E8F6EC',
  negative: '#C62828',
  negativeSoft: '#FDECEC',
  warning: '#B45309',
  warningSoft: '#FEF3E2',
  info: '#1D4ED8',
  infoSoft: '#EAF0FE',
  overlay: 'rgba(20, 18, 16, 0.45)',
  skeleton: '#EFEDE9',
  chartGrid: '#EFEDE9',
  transfer: '#5B6472',
};

export const darkPalette: Palette = {
  background: '#0C0C0D',
  surface: '#161617',
  surfaceElevated: '#1D1D1F',
  surfaceMuted: '#1A1A1C',
  border: '#28282B',
  borderStrong: '#3A3A3E',
  text: '#F4F3F1',
  textSecondary: '#A9A6A0',
  textTertiary: '#77746F',
  textInverse: '#141414',
  brand: '#F97316',
  brandPressed: '#EA580C',
  brandSoft: '#2A1A10',
  onBrand: '#141414',
  positive: '#4ADE80',
  positiveSoft: '#12261A',
  negative: '#F87171',
  negativeSoft: '#2C1515',
  warning: '#FBBF24',
  warningSoft: '#2B2210',
  info: '#93B4FD',
  infoSoft: '#141E33',
  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: '#232325',
  chartGrid: '#232325',
  transfer: '#A0A8B6',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
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
    fontWeight: '700',
    letterSpacing: 0.8,
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

export const elevation = {
  card: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    default: { elevation: 2 },
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    default: { elevation: 8 },
  }),
};

export const motion = {
  fast: 160,
  normal: 240,
  slow: 420,
} as const;

/**
 * Categorical chart colours, assigned in fixed order (never cycled past the
 * end — extra series fold into "Other"). Validated with the dataviz palette
 * checker: lightness band, chroma, CVD separation ≥ 12 ΔE and normal-vision
 * separation ≥ 21 ΔE on both surfaces. Slot 7 sits just under 3:1 contrast on
 * white, so charts always pair colour with visible labels.
 */
export const chartColorsLight = [
  '#EA580C',
  '#2563EB',
  '#16A34A',
  '#9333EA',
  '#DC2626',
  '#0D9488',
  '#CA8A04',
  '#DB2777',
];
export const chartColorsDark = [
  '#EA580C',
  '#3B82F6',
  '#16A34A',
  '#A855F7',
  '#EF4444',
  '#0D9488',
  '#B7791F',
  '#DB2777',
];
