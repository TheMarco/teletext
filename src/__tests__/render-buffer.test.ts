import { describe, it, expect } from 'vitest';
import { processPage, Color, ALPHA_RED, FLASH, CONCEAL } from '../state-machine/index.js';
import {
  renderToBuffer,
  renderGridToBuffer,
  resolveGrid,
  BUFFER_WIDTH,
  BUFFER_HEIGHT,
} from '../render-buffer/index.js';
import { GlyphCache } from '../glyph-system/index.js';

function blankPage(): number[][] {
  const page: number[][] = [];
  for (let r = 0; r < 24; r++) page.push(new Array(40).fill(0x20));
  return page;
}

describe('resolveGrid', () => {
  it('produces 24×40 RenderCell grid', () => {
    const grid = processPage(blankPage());
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);
    expect(resolved.length).toBe(24);
    expect(resolved[0].length).toBe(40);
  });

  it('resolved cells have glyphId instead of char', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;
    page[0][1] = 0x41; // 'A'

    const grid = processPage(page);
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);

    // Cell at (0,1) should have glyphId for 'A'
    expect(resolved[0][1].glyphId).toBe(cache.resolveG0(0x41));
    expect(resolved[0][1].fg).toBe(Color.RED);
    expect(resolved[0][1].bg).toBe(Color.BLACK);
  });

  it('control code positions resolve to space glyph', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;

    const grid = processPage(page);
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);

    // Control code at col 0 renders as space
    expect(resolved[0][0].glyphId).toBe(cache.resolveG0(0x20));
  });
});

describe('renderGridToBuffer', () => {
  it('produces correct dimensions from resolved grid', () => {
    const grid = processPage(blankPage());
    const cache = new GlyphCache();
    const resolved = resolveGrid(grid, cache);
    const result = renderGridToBuffer(resolved, true, false, cache);
    expect(result.width).toBe(BUFFER_WIDTH);
    expect(result.height).toBe(BUFFER_HEIGHT);
    expect(result.data.length).toBe(BUFFER_WIDTH * BUFFER_HEIGHT * 4);
  });
});

describe('renderToBuffer (convenience)', () => {
  it('produces correct dimensions', () => {
    const grid = processPage(blankPage());
    const result = renderToBuffer(grid);
    expect(result.width).toBe(BUFFER_WIDTH);
    expect(result.height).toBe(BUFFER_HEIGHT);
    expect(result.data.length).toBe(BUFFER_WIDTH * BUFFER_HEIGHT * 4);
  });

  it('blank page renders as all black with full opacity', () => {
    const grid = processPage(blankPage());
    const result = renderToBuffer(grid);
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(0);
      expect(result.data[i + 1]).toBe(0);
      expect(result.data[i + 2]).toBe(0);
      expect(result.data[i + 3]).toBe(255);
    }
  });

  it('flash hidden phase renders as background', () => {
    const page = blankPage();
    page[0][0] = FLASH;
    page[0][1] = 0x41; // 'A' — will be flashing

    const grid = processPage(page);
    const visible = renderToBuffer(grid, true);
    const hidden = renderToBuffer(grid, false);

    // Row 4 of 'A' glyph = 0b111110 (crossbar), doubled to 12px wide
    // Pick x=4 (srcX=2, solidly within the bar), y=4
    const px = 1 * 12 + 4;
    const py = 4;
    const idx = (py * BUFFER_WIDTH + px) * 4;

    // When visible, foreground (white) should appear
    expect(visible.data[idx]).toBe(255);
    // When hidden, should be background (black)
    expect(hidden.data[idx]).toBe(0);
  });

  it('concealed cells are hidden unless reveal=true', () => {
    const page = blankPage();
    page[0][0] = CONCEAL;
    page[0][1] = 0x41;

    const grid = processPage(page);
    const concealed = renderToBuffer(grid, true, false);
    const revealed = renderToBuffer(grid, true, true);

    // Find any foreground pixel in cell (col=1, row=0)
    const cellX = 1 * 12;
    let hasFgConcealed = false;
    let hasFgRevealed = false;
    for (let y = 0; y < 10; y++) {
      for (let x = cellX; x < cellX + 12; x++) {
        const idx = (y * BUFFER_WIDTH + x) * 4;
        if (concealed.data[idx] > 0) hasFgConcealed = true;
        if (revealed.data[idx] > 0) hasFgRevealed = true;
      }
    }
    expect(hasFgConcealed).toBe(false);
    expect(hasFgRevealed).toBe(true);
  });

  it('red foreground renders correct RGB', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;
    page[0][1] = 0x41;

    const grid = processPage(page);
    const result = renderToBuffer(grid);

    // Row 4 of 'A' glyph = crossbar, x=4 within cell
    const px = 1 * 12 + 4;
    const py = 4;
    const idx = (py * BUFFER_WIDTH + px) * 4;

    expect(result.data[idx]).toBe(255);     // R
    expect(result.data[idx + 1]).toBe(0);   // G
    expect(result.data[idx + 2]).toBe(0);   // B
  });
});
