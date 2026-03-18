/**
 * Sextant encoder: converts 2x3 pixel blocks into mosaic bytes.
 * Per 08_MOSAIC_AND_QUANTIZATION.md.
 */

export interface SextantCell {
  bits: [number, number, number, number, number, number];
  score?: number;
}

/**
 * Encode a sextant cell (6 binary bits) into a Teletext mosaic byte.
 *
 * Bit layout:
 *   [bit0 bit1]  top row
 *   [bit2 bit3]  middle row
 *   [bit4 bit5]  bottom row
 */
export function encodeSextant(cell: SextantCell): number {
  let bits = 0;
  for (let i = 0; i < 6; i++) {
    if (cell.bits[i]) bits |= (1 << i);
  }

  // Map to character code
  if (bits <= 0x1F) {
    return 0x20 + bits; // 0x20-0x3F
  } else {
    return 0x60 + (bits & 0x1F); // 0x60-0x7F, bit 5 encoded in high range
  }
}

/**
 * Decode a mosaic byte back to sextant bits.
 */
export function decodeSextant(code: number): SextantCell {
  let bits: number;
  if (code >= 0x20 && code <= 0x3F) {
    bits = code - 0x20;
  } else if (code >= 0x60 && code <= 0x7F) {
    bits = (code - 0x60) | 0x20;
  } else {
    bits = 0;
  }

  return {
    bits: [
      (bits >> 0) & 1,
      (bits >> 1) & 1,
      (bits >> 2) & 1,
      (bits >> 3) & 1,
      (bits >> 4) & 1,
      (bits >> 5) & 1,
    ] as [number, number, number, number, number, number],
  };
}

/**
 * Convert image pixel data to sextant cells.
 *
 * @param pixels - Grayscale pixel values (0-255), row-major
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param threshold - Binary threshold (0-255)
 * @returns Grid of sextant cells: [row][col]
 */
export function pixelsToSextants(
  pixels: Uint8Array | number[],
  width: number,
  height: number,
  threshold: number = 128,
): SextantCell[][] {
  // Mosaic resolution: 2 subcells wide × 3 subcells tall per character cell
  // Total teletext graphics resolution: 80×72 subcells (for 40×24 character grid)
  const cellsWide = Math.floor(width / 2);
  const cellsTall = Math.floor(height / 3);

  const grid: SextantCell[][] = [];

  for (let cy = 0; cy < cellsTall; cy++) {
    const row: SextantCell[] = [];
    for (let cx = 0; cx < cellsWide; cx++) {
      const bits: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = cx * 2 + sx;
          const py = cy * 3 + sy;
          if (px < width && py < height) {
            const val = pixels[py * width + px] ?? 0;
            const bitIndex = sy * 2 + sx;
            bits[bitIndex] = val >= threshold ? 1 : 0;
          }
        }
      }

      row.push({ bits });
    }
    grid.push(row);
  }

  return grid;
}
