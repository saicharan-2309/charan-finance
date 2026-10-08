/**
 * WCAG contrast for the BUD palette, so a colour tweak can't quietly make text
 * unreadable. Thresholds: 4.5:1 for text, 3:1 for chart marks and tertiary text.
 */
import {
  BUD_SWATCHES,
  chartColorsDark,
  chartColorsLight,
  darkPalette,
  lightPalette,
  type Palette,
} from '@/theme/tokens';

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const TEXT: (keyof Palette)[] = ['text', 'textSecondary', 'brand', 'positive', 'negative', 'warning', 'info'];

describe.each([
  ['light', lightPalette],
  ['dark', darkPalette],
] as const)('%s palette', (_, p) => {
  it.each(TEXT)('%s is readable on cards and the canvas', (key) => {
    expect(contrast(p[key] as string, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p[key] as string, p.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('tertiary text and transfers stay ≥ 3:1', () => {
    expect(contrast(p.textTertiary, p.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.transfer, p.surface)).toBeGreaterThanOrEqual(3);
  });

  it('white is readable on every hero stop and on the ink card', () => {
    for (const c of [...p.heroGradient, ...p.cardGradient]) {
      expect(contrast('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the logo orange works as an icon colour, and white reads on the Add button', () => {
    expect(contrast(p.warm, p.surface)).toBeGreaterThanOrEqual(3);
    for (const c of p.warmGradient) expect(contrast('#FFFFFF', c)).toBeGreaterThanOrEqual(3);
  });

  it('income and expense marks are ≥ 3:1 on cards', () => {
    expect(contrast(p.income, p.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.expense, p.surface)).toBeGreaterThanOrEqual(3);
  });
});

it('white text is readable on every swatch, base and deep', () => {
  for (const s of BUD_SWATCHES) {
    expect([s.name, contrast('#FFFFFF', s.base) >= 4.5]).toEqual([s.name, true]);
    expect([s.name, contrast('#FFFFFF', s.deep) >= 4.5]).toEqual([s.name, true]);
  }
});

it('chart colours are ≥ 3:1 on their card in each mode', () => {
  for (const c of chartColorsLight) expect([c, contrast(c, lightPalette.surface) >= 3]).toEqual([c, true]);
  for (const c of chartColorsDark) expect([c, contrast(c, darkPalette.surface) >= 3]).toEqual([c, true]);
});

it('no green is left in the identity colours', () => {
  // Hue of the identity colours must sit in blue/navy/cyan or coral/peach, never green (75°–165°).
  const hue = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
      number,
      number,
      number,
    ];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (d === 0) return -1;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const p of [lightPalette, darkPalette]) {
    for (const c of [p.brand, p.accent, p.hero, ...p.heroGradient, p.income, ...p.gaugeGradient]) {
      const h = hue(c);
      expect([c, h >= 75 && h <= 165]).toEqual([c, false]);
    }
  }
  for (const s of BUD_SWATCHES) {
    const h = hue(s.base);
    expect([s.name, h >= 75 && h <= 165]).toEqual([s.name, false]);
  }
});
