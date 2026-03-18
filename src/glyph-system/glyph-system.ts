/**
 * Glyph system for Teletext rendering.
 *
 * Per ETSI EN 300 706:
 * - G0: Latin alphanumeric character set (ASCII-like)
 * - G1: Mosaic graphics (2x3 block grid per cell)
 *
 * Each glyph is a pixel bitmap. Standard teletext character cells
 * are 12 pixels wide × 10 pixels tall (Level 1).
 */

import { getG0Glyph } from './font-g0.js';

export const CELL_WIDTH = 12;
export const CELL_HEIGHT = 10;

// Mosaic block dimensions within a cell
// 2 columns × 3 rows = 6 blocks per mosaic character
const MOSAIC_COLS = 2;
const MOSAIC_ROWS = 3;
const MOSAIC_BLOCK_W = CELL_WIDTH / MOSAIC_COLS;   // 6
const MOSAIC_BLOCK_H = CELL_HEIGHT / MOSAIC_ROWS;  // ~3.33, use floor

/**
 * A rendered glyph as a pixel bitmap.
 * Pixels are stored row-major: pixels[y * width + x].
 * Value is 1 (foreground) or 0 (background).
 */
export interface Glyph {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * Render a G1 mosaic character to a glyph bitmap.
 *
 * Per ETSI EN 300 706 Section 13.2:
 * Mosaic characters 0x20-0x3F and 0x60-0x7F encode a 2×3 block pattern.
 * The 6 bits map to blocks:
 *   [bit0 bit1]   top row
 *   [bit2 bit3]   middle row
 *   [bit4 bit5]   bottom row
 *
 * Bits are taken from the character code minus 0x20 (for 0x20-0x3F)
 * or minus 0x40 (for 0x60-0x7F, where bit 5 is set in the original).
 */
export function renderMosaic(charCode: number, separated: boolean): Glyph {
  // Extract 6-bit block pattern
  let bits: number;
  if (charCode >= 0x20 && charCode <= 0x3F) {
    bits = charCode - 0x20;
  } else if (charCode >= 0x60 && charCode <= 0x7F) {
    // 0x60-0x7F: bit5 of char maps to bit5 of mosaic, rest from low bits
    bits = (charCode - 0x60) | 0x20;
  } else {
    // Not a mosaic character — return blank
    bits = 0;
  }

  const pixels = new Uint8Array(CELL_WIDTH * CELL_HEIGHT);

  // Row heights: divide 10 pixels into 3 rows → 3, 4, 3
  const rowHeights = [3, 4, 3];
  const colWidths = [MOSAIC_BLOCK_W, CELL_WIDTH - MOSAIC_BLOCK_W]; // 6, 6

  // Separation gap in pixels (1 pixel on each edge)
  const sepGap = separated ? 1 : 0;

  let py = 0;
  for (let br = 0; br < MOSAIC_ROWS; br++) {
    const bh = rowHeights[br];
    for (let dy = 0; dy < bh; dy++) {
      let px = 0;
      for (let bc = 0; bc < MOSAIC_COLS; bc++) {
        const bw = colWidths[bc];
        const bitIndex = br * 2 + bc;
        const filled = (bits >> bitIndex) & 1;

        for (let dx = 0; dx < bw; dx++) {
          if (filled) {
            // In separated mode, leave a gap at edges
            const atEdgeX = separated && (dx < sepGap || dx >= bw - sepGap);
            const atEdgeY = separated && (dy < sepGap || dy >= bh - sepGap);
            pixels[(py + dy) * CELL_WIDTH + (px + dx)] = (atEdgeX || atEdgeY) ? 0 : 1;
          }
          // else: already 0
        }
        px += bw;
      }
    }
    py += bh;
  }

  return { width: CELL_WIDTH, height: CELL_HEIGHT, pixels };
}

/**
 * Render a G0 (text) character to a glyph bitmap.
 * Uses the embedded 6×10 bitmap font, doubled horizontally to 12×10.
 */
export function renderG0(charCode: number): Glyph {
  const pixels = getG0Glyph(charCode);
  return { width: CELL_WIDTH, height: CELL_HEIGHT, pixels };
}
