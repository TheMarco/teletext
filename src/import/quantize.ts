/**
 * Image quantization for Teletext palette.
 * Per 08_MOSAIC_AND_QUANTIZATION.md.
 */

export type TeletextColor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const PALETTE: [number, number, number][] = [
  [0, 0, 0],       // 0 BLACK
  [255, 0, 0],     // 1 RED
  [0, 255, 0],     // 2 GREEN
  [255, 255, 0],   // 3 YELLOW
  [0, 0, 255],     // 4 BLUE
  [255, 0, 255],   // 5 MAGENTA
  [0, 255, 255],   // 6 CYAN
  [255, 255, 255], // 7 WHITE
];

/**
 * Find the nearest Teletext palette color for an RGB pixel.
 */
export function nearestPaletteColor(r: number, g: number, b: number): TeletextColor {
  let bestIndex = 0;
  let bestDist = Infinity;

  for (let i = 0; i < 8; i++) {
    const [pr, pg, pb] = PALETTE[i];
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  return bestIndex as TeletextColor;
}

/**
 * Convert RGBA image data to grayscale.
 */
export function rgbaToGrayscale(data: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

/**
 * Apply a binary threshold to grayscale data.
 */
export function applyThreshold(gray: Uint8Array, threshold: number = 128): Uint8Array {
  const result = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    result[i] = gray[i] >= threshold ? 255 : 0;
  }
  return result;
}

/**
 * Determine the dominant foreground/background color pair for a region.
 */
export function findDominantColors(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { fg: TeletextColor; bg: TeletextColor } {
  const colorCounts = new Array(8).fill(0);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    colorCounts[nearestPaletteColor(r, g, b)]++;
  }

  // Most common = background, second most = foreground
  const sorted = colorCounts
    .map((count, index) => ({ index, count }))
    .sort((a, b) => b.count - a.count);

  return {
    bg: sorted[0].index as TeletextColor,
    fg: sorted[1]?.index as TeletextColor ?? 7,
  };
}
