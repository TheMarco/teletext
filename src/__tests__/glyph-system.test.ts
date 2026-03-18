import { describe, it, expect } from 'vitest';
import { renderMosaic, renderG0, CELL_WIDTH, CELL_HEIGHT } from '../glyph-system/index.js';

describe('renderMosaic', () => {
  it('returns correct dimensions', () => {
    const glyph = renderMosaic(0x20, false);
    expect(glyph.width).toBe(CELL_WIDTH);
    expect(glyph.height).toBe(CELL_HEIGHT);
    expect(glyph.pixels.length).toBe(CELL_WIDTH * CELL_HEIGHT);
  });

  it('0x20 (space) produces all-zero pixels', () => {
    const glyph = renderMosaic(0x20, false);
    const sum = glyph.pixels.reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  it('0x3F fills 5 of 6 blocks (bits 0-4 set)', () => {
    // 0x3F - 0x20 = 0x1F = 0b011111 — bit 5 (bottom-right) is 0
    const glyph = renderMosaic(0x3F, false);
    const sum = glyph.pixels.reduce((a, b) => a + b, 0);
    // 5 blocks: TL(18) + TR(18) + ML(24) + MR(24) + BL(18) = 102
    expect(sum).toBe(102);
  });

  it('0x7F (all bits in high range) fills all blocks', () => {
    const glyph = renderMosaic(0x7F, false);
    const sum = glyph.pixels.reduce((a, b) => a + b, 0);
    expect(sum).toBe(CELL_WIDTH * CELL_HEIGHT);
  });

  it('separated mode produces fewer filled pixels than contiguous', () => {
    const contiguous = renderMosaic(0x3F, false);
    const separated = renderMosaic(0x3F, true);
    const sumC = contiguous.pixels.reduce((a, b) => a + b, 0);
    const sumS = separated.pixels.reduce((a, b) => a + b, 0);
    expect(sumS).toBeLessThan(sumC);
  });

  it('bit 0 fills top-left block only', () => {
    // 0x21 = 0x20 + 1 → bit 0 set
    const glyph = renderMosaic(0x21, false);
    // Top-left block: x=[0..5], y=[0..2]
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 6; x++) {
        expect(glyph.pixels[y * CELL_WIDTH + x]).toBe(1);
      }
    }
    // Top-right block should be empty
    for (let y = 0; y < 3; y++) {
      for (let x = 6; x < 12; x++) {
        expect(glyph.pixels[y * CELL_WIDTH + x]).toBe(0);
      }
    }
  });
});

describe('renderG0', () => {
  it('space (0x20) produces blank glyph', () => {
    const glyph = renderG0(0x20);
    const sum = glyph.pixels.reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  it('printable character produces non-blank glyph', () => {
    const glyph = renderG0(0x41); // 'A'
    const sum = glyph.pixels.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('returns correct dimensions', () => {
    const glyph = renderG0(0x41);
    expect(glyph.width).toBe(CELL_WIDTH);
    expect(glyph.height).toBe(CELL_HEIGHT);
  });
});
