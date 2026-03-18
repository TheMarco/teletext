import { describe, it, expect } from 'vitest';
import {
  encodeSextant,
  decodeSextant,
  pixelsToSextants,
  rgbaToGrayscale,
  applyThreshold,
  nearestPaletteColor,
  findDominantColors,
  buildImportMutations,
  applyImportToSubpage,
} from '../../src/import/index.js';
import { createEmptySubpage } from '../../src/model/factories.js';
import { tokenDisplayWidth } from '../../src/model/factories.js';

describe('encodeSextant', () => {
  it('encodes all-zero to 0x20 (space)', () => {
    expect(encodeSextant({ bits: [0, 0, 0, 0, 0, 0] })).toBe(0x20);
  });

  it('encodes bit 0 only to 0x21', () => {
    expect(encodeSextant({ bits: [1, 0, 0, 0, 0, 0] })).toBe(0x21);
  });

  it('encodes all bits set to 0x7F', () => {
    expect(encodeSextant({ bits: [1, 1, 1, 1, 1, 1] })).toBe(0x7F);
  });

  it('encodes bit 5 only to 0x60 | 0x20 → bit5 in high range', () => {
    const code = encodeSextant({ bits: [0, 0, 0, 0, 0, 1] });
    expect(code).toBe(0x60 + 0x00); // bits = 0x20, high range
    // Actually bits = 100000 = 32 = 0x20, so 0x60 + 0 = 0x60
    expect(code).toBe(0x60);
  });
});

describe('decodeSextant', () => {
  it('round-trips through encode/decode', () => {
    for (let bits = 0; bits < 64; bits++) {
      const cell = {
        bits: [
          (bits >> 0) & 1,
          (bits >> 1) & 1,
          (bits >> 2) & 1,
          (bits >> 3) & 1,
          (bits >> 4) & 1,
          (bits >> 5) & 1,
        ] as [number, number, number, number, number, number],
      };
      const encoded = encodeSextant(cell);
      const decoded = decodeSextant(encoded);
      expect(decoded.bits).toEqual(cell.bits);
    }
  });
});

describe('pixelsToSextants', () => {
  it('converts a 2x3 pixel block to one sextant', () => {
    // 2 wide × 3 tall, all white
    const pixels = new Uint8Array([255, 255, 255, 255, 255, 255]);
    const grid = pixelsToSextants(pixels, 2, 3, 128);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(1);
    expect(grid[0][0].bits).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('converts a 4x6 pixel block to a 2x2 grid', () => {
    const pixels = new Uint8Array(4 * 6).fill(255);
    const grid = pixelsToSextants(pixels, 4, 6, 128);
    expect(grid).toHaveLength(2);
    expect(grid[0]).toHaveLength(2);
  });

  it('thresholds correctly', () => {
    // 2x3 image: top-left pixel = 200 (above), top-right = 50 (below)
    const pixels = new Uint8Array([200, 50, 200, 50, 200, 50]);
    const grid = pixelsToSextants(pixels, 2, 3, 128);
    expect(grid[0][0].bits).toEqual([1, 0, 1, 0, 1, 0]);
  });
});

describe('rgbaToGrayscale', () => {
  it('converts white RGBA to 255 gray', () => {
    const rgba = new Uint8Array([255, 255, 255, 255]);
    const gray = rgbaToGrayscale(rgba, 1, 1);
    expect(gray[0]).toBe(255);
  });

  it('converts black RGBA to 0 gray', () => {
    const rgba = new Uint8Array([0, 0, 0, 255]);
    const gray = rgbaToGrayscale(rgba, 1, 1);
    expect(gray[0]).toBe(0);
  });

  it('uses perceptual weights', () => {
    // Pure green should be brighter than pure red or blue
    const green = rgbaToGrayscale(new Uint8Array([0, 255, 0, 255]), 1, 1)[0];
    const red = rgbaToGrayscale(new Uint8Array([255, 0, 0, 255]), 1, 1)[0];
    const blue = rgbaToGrayscale(new Uint8Array([0, 0, 255, 255]), 1, 1)[0];
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
  });
});

describe('applyThreshold', () => {
  it('binarizes grayscale data', () => {
    const gray = new Uint8Array([0, 64, 128, 200, 255]);
    const binary = applyThreshold(gray, 128);
    expect(Array.from(binary)).toEqual([0, 0, 255, 255, 255]);
  });
});

describe('nearestPaletteColor', () => {
  it('maps pure colors correctly', () => {
    expect(nearestPaletteColor(0, 0, 0)).toBe(0);       // BLACK
    expect(nearestPaletteColor(255, 0, 0)).toBe(1);     // RED
    expect(nearestPaletteColor(0, 255, 0)).toBe(2);     // GREEN
    expect(nearestPaletteColor(255, 255, 0)).toBe(3);   // YELLOW
    expect(nearestPaletteColor(0, 0, 255)).toBe(4);     // BLUE
    expect(nearestPaletteColor(255, 0, 255)).toBe(5);   // MAGENTA
    expect(nearestPaletteColor(0, 255, 255)).toBe(6);   // CYAN
    expect(nearestPaletteColor(255, 255, 255)).toBe(7); // WHITE
  });
});

describe('findDominantColors', () => {
  it('finds bg=black fg=white for a mostly black image with white spots', () => {
    // 4 pixels: 3 black, 1 white
    const data = new Uint8Array([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    const { fg, bg } = findDominantColors(data, 4, 1);
    expect(bg).toBe(0); // BLACK
    expect(fg).toBe(7); // WHITE
  });
});

describe('buildImportMutations + applyImportToSubpage', () => {
  it('places sextant data into page rows', () => {
    // 2x3 all-white → 1 sextant cell → 1 row with 1 mosaic byte
    const sextants = [[{ bits: [1, 1, 1, 1, 1, 1] as [number, number, number, number, number, number] }]];
    const result = buildImportMutations(sextants, {
      region: { x: 0, y: 2, width: 1, height: 1 },
      fgColor: 2, // green
      contiguous: true,
      eraseFirst: false,
    });

    expect(result.rowMutations).toHaveLength(1);
    expect(result.rowMutations[0].rowIndex).toBe(2);

    // Apply to a subpage
    const sp = createEmptySubpage(0);
    const updated = applyImportToSubpage(sp, result);

    // Row 2 should have graphics control + mosaic
    const tokens = updated.rows[2].tokens;
    const hasControl = tokens.some(t => t.kind === 'control');
    const hasMosaic = tokens.some(t => t.kind === 'mosaic');
    expect(hasControl).toBe(true);
    expect(hasMosaic).toBe(true);
  });

  it('imported result is editable (tokens, not opaque bitmap)', () => {
    const sextants = [[
      { bits: [1, 0, 1, 0, 1, 0] as [number, number, number, number, number, number] },
      { bits: [0, 1, 0, 1, 0, 1] as [number, number, number, number, number, number] },
    ]];
    const result = buildImportMutations(sextants, {
      region: { x: 5, y: 10, width: 2, height: 1 },
      fgColor: 1,
      contiguous: true,
      eraseFirst: false,
    });

    const sp = createEmptySubpage(0);
    const updated = applyImportToSubpage(sp, result);

    // Each token is a concrete mosaic/control/fill — no opaque objects
    for (const token of updated.rows[10].tokens) {
      expect(['char', 'mosaic', 'control', 'fill', 'comment']).toContain(token.kind);
    }
  });

  it('full pipeline: grayscale → threshold → sextants → placement', () => {
    // Small 4x6 white-on-black image (RGBA)
    const rgba = new Uint8Array(4 * 6 * 4);
    // Top-left 2x3 block = white
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 4 + x) * 4;
        rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 255;
      }
    }

    // Convert (use already-imported functions)
    const gray = rgbaToGrayscale(rgba, 4, 6);
    const binary = applyThreshold(gray, 128);
    const sextants = pixelsToSextants(binary, 4, 6, 128);

    expect(sextants).toHaveLength(2);
    expect(sextants[0]).toHaveLength(2);
    // Top-left cell should be all-white
    expect(sextants[0][0].bits).toEqual([1, 1, 1, 1, 1, 1]);
    // Top-right cell should be all-black
    expect(sextants[0][1].bits).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
