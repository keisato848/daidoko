import { darkColors, lightColors, type ThemePalette } from '../colors';

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};

const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};

describe('Theme Palette Contrast', () => {
  it('both palettes should have the exact same keys', () => {
    const darkKeys = Object.keys(darkColors).sort();
    const lightKeys = Object.keys(lightColors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  const textColors: (keyof ThemePalette)[] = ['paper', 'paperDim', 'gold', 'goldDim', 'muted'];
  const bgColors: (keyof ThemePalette)[] = ['bg', 'bgCard', 'bgInput'];

  describe('Dark Palette Contrast', () => {
    textColors.forEach((textKey) => {
      bgColors.forEach((bgKey) => {
        it(`${textKey} against ${bgKey} should be >= 4.5:1`, () => {
          const ratio = contrast(darkColors[textKey], darkColors[bgKey]);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      });
    });

    it('starOff against bg should be >= 3:1', () => {
      const ratio = contrast(darkColors.starOff, darkColors.bg);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Light Palette Contrast', () => {
    textColors.forEach((textKey) => {
      bgColors.forEach((bgKey) => {
        it(`${textKey} against ${bgKey} should be >= 4.5:1`, () => {
          const ratio = contrast(lightColors[textKey], lightColors[bgKey]);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      });
    });

    it('starOff against bg should be >= 3:1', () => {
      const ratio = contrast(lightColors.starOff, lightColors.bg);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  });
});
