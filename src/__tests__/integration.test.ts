import { describe, it, expect } from 'vitest';
import {
  processPage,
  Color,
  CharsetMode,
  MosaicType,
  ALPHA_RED,
  ALPHA_GREEN,
  ALPHA_YELLOW,
  ALPHA_CYAN,
  ALPHA_WHITE,
  MOSAIC_RED,
  MOSAIC_GREEN,
  FLASH,
  STEADY,
  DOUBLE_HEIGHT,
  NORMAL_HEIGHT,
  CONCEAL,
  HOLD_MOSAIC,
  RELEASE_MOSAIC,
  NEW_BACKGROUND,
  BLACK_BACKGROUND,
  SEPARATED_MOSAIC,
} from '../state-machine/index.js';
import {
  renderToBuffer,
  renderGridToBuffer,
  resolveGrid,
  BUFFER_WIDTH,
  BUFFER_HEIGHT,
} from '../render-buffer/index.js';
import { GlyphCache, CELL_WIDTH, CELL_HEIGHT } from '../glyph-system/index.js';

function blankPage(): number[][] {
  const page: number[][] = [];
  for (let r = 0; r < 24; r++) page.push(new Array(40).fill(0x20));
  return page;
}

function textAt(r: number[], col: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    r[col + i] = text.charCodeAt(i);
  }
}

/**
 * Sample a pixel from rendered output at a given cell and offset within the cell.
 * Returns [R, G, B, A].
 */
function samplePixel(
  data: Uint8ClampedArray,
  row: number, col: number,
  cx: number, cy: number,
): [number, number, number, number] {
  const x = col * CELL_WIDTH + cx;
  const y = row * CELL_HEIGHT + cy;
  const idx = (y * BUFFER_WIDTH + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
}

/**
 * Check if a cell has any foreground pixels in the rendered output.
 */
function cellHasForeground(
  data: Uint8ClampedArray,
  row: number, col: number,
  bgColor: [number, number, number] = [0, 0, 0],
): boolean {
  for (let cy = 0; cy < CELL_HEIGHT; cy++) {
    for (let cx = 0; cx < CELL_WIDTH; cx++) {
      const [r, g, b] = samplePixel(data, row, col, cx, cy);
      if (r !== bgColor[0] || g !== bgColor[1] || b !== bgColor[2]) {
        return true;
      }
    }
  }
  return false;
}

describe('Integration: full pipeline state-machine → resolve → render', () => {
  it('processes a page with mixed features end-to-end', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;
    textAt(page[0], 1, 'Hello');
    page[1][0] = MOSAIC_GREEN;
    page[1][1] = 0x3F;
    page[2][0] = DOUBLE_HEIGHT;
    page[2][1] = ALPHA_YELLOW;
    textAt(page[2], 2, 'Big');

    const grid = processPage(page);
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);
    const result = renderGridToBuffer(resolved, true, false, cache);

    // Basic checks
    expect(result.width).toBe(BUFFER_WIDTH);
    expect(result.height).toBe(BUFFER_HEIGHT);

    // Row 0 col 1 should have red foreground pixels
    expect(cellHasForeground(result.data, 0, 1)).toBe(true);

    // Row 1 col 1 should have green mosaic pixels
    const [r, g, b] = samplePixel(result.data, 1, 1, 0, 0);
    expect(g).toBe(255); // green foreground
    expect(r).toBe(0);
    expect(b).toBe(0);
  });
});

describe('Integration: double height full pipeline', () => {
  it('double height top row has visible characters', () => {
    const page = blankPage();
    page[4][0] = DOUBLE_HEIGHT;
    textAt(page[4], 1, 'TEST');

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Top row cells should have visible foreground
    expect(cellHasForeground(result.data, 4, 1)).toBe(true);
    expect(cellHasForeground(result.data, 4, 2)).toBe(true);
  });

  it('double height bottom row has visible characters', () => {
    const page = blankPage();
    page[4][0] = DOUBLE_HEIGHT;
    textAt(page[4], 1, 'TEST');

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Bottom row should also have visible pixels (bottom half of glyphs)
    expect(cellHasForeground(result.data, 5, 1)).toBe(true);
  });

  it('double height renders different halves on top vs bottom', () => {
    const page = blankPage();
    page[4][0] = DOUBLE_HEIGHT;
    page[4][1] = ALPHA_WHITE;
    page[4][2] = 0x41; // 'A'

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Collect pixel data for top and bottom rows of the same cell
    const topPixels: number[] = [];
    const botPixels: number[] = [];
    for (let cy = 0; cy < CELL_HEIGHT; cy++) {
      for (let cx = 0; cx < CELL_WIDTH; cx++) {
        topPixels.push(samplePixel(result.data, 4, 2, cx, cy)[0]);
        botPixels.push(samplePixel(result.data, 5, 2, cx, cy)[0]);
      }
    }

    // Top and bottom should be different (different halves of the glyph)
    const topStr = topPixels.join(',');
    const botStr = botPixels.join(',');
    expect(topStr).not.toBe(botStr);
  });
});

describe('Integration: flash full pipeline', () => {
  it('flashing cell alternates between visible and hidden', () => {
    const page = blankPage();
    page[0][0] = FLASH;
    page[0][1] = 0x41; // 'A'

    const grid = processPage(page);
    const onResult = renderToBuffer(grid, true);   // flash ON
    const offResult = renderToBuffer(grid, false);  // flash OFF

    const visibleOn = cellHasForeground(onResult.data, 0, 1);
    const visibleOff = cellHasForeground(offResult.data, 0, 1);

    expect(visibleOn).toBe(true);
    expect(visibleOff).toBe(false);
  });

  it('steady cell is always visible regardless of flash phase', () => {
    const page = blankPage();
    page[0][0] = FLASH;
    page[0][1] = 0x41;
    page[0][2] = STEADY;
    page[0][3] = 0x42;

    const grid = processPage(page);
    const offResult = renderToBuffer(grid, false);

    // 'A' (col 1) should be hidden, 'B' (col 3) should be visible
    expect(cellHasForeground(offResult.data, 0, 1)).toBe(false);
    expect(cellHasForeground(offResult.data, 0, 3)).toBe(true);
  });
});

describe('Integration: conceal + reveal full pipeline', () => {
  it('concealed text is invisible without reveal', () => {
    const page = blankPage();
    page[0][0] = CONCEAL;
    textAt(page[0], 1, 'SECRET');

    const grid = processPage(page);
    const hidden = renderToBuffer(grid, true, false);
    const shown = renderToBuffer(grid, true, true);

    // All chars should be invisible when concealed
    for (let col = 1; col <= 6; col++) {
      expect(cellHasForeground(hidden.data, 0, col)).toBe(false);
    }
    // All chars should be visible when revealed
    for (let col = 1; col <= 6; col++) {
      expect(cellHasForeground(shown.data, 0, col)).toBe(true);
    }
  });
});

describe('Integration: background colors in pixels', () => {
  it('new background changes pixel background color', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;
    page[0][1] = NEW_BACKGROUND;
    page[0][2] = 0x20; // space — should show red background

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Space cell at col 2 should be all red (bg = red, no fg pixels)
    const [r, g, b] = samplePixel(result.data, 0, 2, 5, 5);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

describe('Integration: mosaic rendering accuracy', () => {
  it('contiguous mosaic fills correct blocks', () => {
    const page = blankPage();
    page[0][0] = MOSAIC_GREEN;
    page[0][1] = 0x21; // bit 0 only = top-left block

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Top-left of the cell should be green (filled)
    const [r1, g1] = samplePixel(result.data, 0, 1, 0, 0);
    expect(g1).toBe(255);

    // Top-right should be black (not filled)
    const [r2, g2] = samplePixel(result.data, 0, 1, CELL_WIDTH - 1, 0);
    expect(g2).toBe(0);
  });

  it('separated mosaic has gaps between blocks', () => {
    const page = blankPage();
    page[0][0] = MOSAIC_GREEN;
    page[0][1] = SEPARATED_MOSAIC;
    page[0][2] = 0x7F; // all blocks filled

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Center of a block should be filled (avoid gap edges)
    // Top-left block interior: x=2, y=1 (inside 1px gap border)
    const [, g1] = samplePixel(result.data, 0, 2, 2, 1);
    expect(g1).toBe(255);

    // Edge pixel (separation gap) should be background
    // Top-left corner (0,0) is in the gap
    const [, g2] = samplePixel(result.data, 0, 2, 0, 0);
    expect(g2).toBe(0);
  });
});

describe('Integration: resolve pipeline produces correct glyphIds', () => {
  it('space resolves to glyphId 0', () => {
    const page = blankPage();
    const grid = processPage(page);
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);

    expect(resolved[0][0].glyphId).toBe(0); // space = G0_BASE + (0x20 - 0x20)
  });

  it('mosaic char resolves to G1 glyph range', () => {
    const page = blankPage();
    page[0][0] = MOSAIC_RED;
    page[0][1] = 0x3F;

    const grid = processPage(page);
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);

    const expectedId = cache.resolveG1(0x3F, false);
    expect(resolved[0][1].glyphId).toBe(expectedId);
    expect(expectedId).toBeGreaterThanOrEqual(96); // G1 range
  });

  it('separated mosaic resolves to different ID than contiguous', () => {
    const page = blankPage();
    page[0][0] = MOSAIC_RED;
    page[0][1] = 0x3F; // contiguous (default)
    page[1][0] = MOSAIC_RED;
    page[1][1] = SEPARATED_MOSAIC;
    page[1][2] = 0x3F; // separated

    const grid = processPage(page);
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);

    expect(resolved[0][1].glyphId).not.toBe(resolved[1][2].glyphId);
  });
});
