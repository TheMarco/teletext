import { describe, it, expect } from 'vitest';
import { GlyphCache, CELL_WIDTH, CELL_HEIGHT } from '../glyph-system/index.js';

describe('GlyphCache', () => {
  it('pre-renders all base glyphs on construction', () => {
    const cache = new GlyphCache();
    // G0: 96 (0x20-0x7F) + G1 cont low: 32 + G1 cont hi: 32
    // + G1 sep low: 32 + G1 sep hi: 32 = 224
    expect(cache.size).toBe(224);
  });

  it('resolves G0 ASCII characters to sequential IDs', () => {
    const cache = new GlyphCache();
    expect(cache.resolveG0(0x20)).toBe(0);  // space
    expect(cache.resolveG0(0x41)).toBe(33); // 'A' = 0x41 - 0x20
    expect(cache.resolveG0(0x7F)).toBe(95); // DEL
  });

  it('resolves G1 contiguous mosaic characters', () => {
    const cache = new GlyphCache();
    const id = cache.resolveG1(0x3F, false); // contiguous, low range
    expect(id).toBe(96 + (0x3F - 0x20));    // 127
  });

  it('resolves G1 separated mosaic characters', () => {
    const cache = new GlyphCache();
    const idSep = cache.resolveG1(0x3F, true);
    const idCont = cache.resolveG1(0x3F, false);
    expect(idSep).not.toBe(idCont); // different IDs for separated vs contiguous
  });

  it('resolves G1 high range (0x60-0x7F)', () => {
    const cache = new GlyphCache();
    const idCont = cache.resolveG1(0x7F, false);
    const idSep = cache.resolveG1(0x7F, true);
    expect(idCont).toBe(128 + (0x7F - 0x60)); // 159
    expect(idSep).toBe(192 + (0x7F - 0x60));  // 223
  });

  it('getGlyph returns a glyph with correct dimensions', () => {
    const cache = new GlyphCache();
    const glyph = cache.getGlyph(cache.resolveG0(0x41));
    expect(glyph.width).toBe(CELL_WIDTH);
    expect(glyph.height).toBe(CELL_HEIGHT);
    expect(glyph.pixels.length).toBe(CELL_WIDTH * CELL_HEIGHT);
  });

  it('getGlyph returns blank for out-of-range ID', () => {
    const cache = new GlyphCache();
    const glyph = cache.getGlyph(99999);
    // Falls back to glyph 0 (space)
    const sum = glyph.pixels.reduce((a, b) => a + b, 0);
    expect(sum).toBe(0); // blank
  });

  it('defaults to english national subset', () => {
    const cache = new GlyphCache();
    expect(cache.getNationalSubset()).toBe('english');
  });

  it('national subset does not change base G0 IDs for english', () => {
    const cache = new GlyphCache();
    // English has no remapping — all chars map to base G0
    expect(cache.resolveG0(0x23)).toBe(0x23 - 0x20); // '#' = ID 3
  });

  it('national subset allocates new IDs for variant characters', () => {
    const cache = new GlyphCache();
    const baseSize = cache.size;
    cache.setNationalSubset('french');
    // '#' (0x23) maps to 'é' in French — should get a new glyph ID
    const id = cache.resolveG0(0x23);
    expect(id).toBeGreaterThanOrEqual(baseSize);
    expect(cache.size).toBe(baseSize + 1);
  });

  it('non-remapped chars still use base G0 IDs in national mode', () => {
    const cache = new GlyphCache();
    cache.setNationalSubset('french');
    // 'A' (0x41) is not remapped in French
    expect(cache.resolveG0(0x41)).toBe(0x41 - 0x20);
  });
});
