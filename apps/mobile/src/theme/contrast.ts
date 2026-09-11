import colors from './colors';

function normalizeHex(color: string): string | null {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;

  const value = match[1];
  if (value.length === 3) {
    return value
      .split('')
      .map((char) => char + char)
      .join('');
  }

  return value;
}

function relativeLuminance(hex: string) {
  const channels = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4);

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(firstLuminance: number, secondLuminance: number) {
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getContrastTextColor(backgroundColor?: string | null) {
  if (!backgroundColor) return colors.textOnPrimary;

  const hex = normalizeHex(backgroundColor);
  if (!hex) return colors.textPrimary;

  const backgroundLuminance = relativeLuminance(hex);
  const primaryTextHex = normalizeHex(colors.textPrimary)!;
  const onPrimaryTextHex = normalizeHex(colors.textOnPrimary)!;
  const primaryTextContrast = contrastRatio(backgroundLuminance, relativeLuminance(primaryTextHex));
  const onPrimaryTextContrast = contrastRatio(backgroundLuminance, relativeLuminance(onPrimaryTextHex));

  return primaryTextContrast > onPrimaryTextContrast ? colors.textPrimary : colors.textOnPrimary;
}
