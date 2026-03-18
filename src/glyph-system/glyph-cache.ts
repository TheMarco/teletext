import { renderMosaic, renderG0, CELL_WIDTH, CELL_HEIGHT } from './glyph-system.js';
import type { Glyph } from './glyph-system.js';
import { NATIONAL_SUBSETS } from './national-variants.js';
import type { NationalSubsetName } from './national-variants.js';
import { getG0Glyph } from './font-g0.js';
import { getNationalGlyph } from './font-national.js';

/**
 * Glyph cache that pre-renders and assigns numeric IDs to all glyphs.
 *
 * This creates a clean separation per RENDER_BUFFER.md: the render buffer
 * stores resolved glyphIds, and the pixel renderer looks up glyphs by ID.
 *
 * Glyph ID layout:
 *   0         = blank (space)
 *   1-95      = G0 ASCII (0x20-0x7F)
 *   96-159    = G1 mosaic contiguous (0x20-0x3F)
 *   160-191   = G1 mosaic contiguous (0x60-0x7F)
 *   192-255   = G1 mosaic separated (0x20-0x3F)
 *   256-287   = G1 mosaic separated (0x60-0x7F)
 *   288+      = national variant overrides (allocated on demand)
 */

const G0_BASE = 0;           // 0x20 → ID 0, 0x21 → ID 1, ..., 0x7F → ID 95
const G1_CONT_LO = 96;      // 0x20-0x3F contiguous → IDs 96-127
const G1_CONT_HI = 128;     // 0x60-0x7F contiguous → IDs 128-159
const G1_SEP_LO = 160;      // 0x20-0x3F separated → IDs 160-191
const G1_SEP_HI = 192;      // 0x60-0x7F separated → IDs 192-223
const NATIONAL_BASE = 224;   // national variants start here

export class GlyphCache {
  private glyphs: Glyph[] = [];
  private nationalGlyphs = new Map<string, number>(); // "subset:charCode" → glyphId
  private nationalSubset: NationalSubsetName = 'english';

  constructor() {
    this.buildCache();
  }

  /**
   * Set the active national character subset.
   */
  setNationalSubset(name: NationalSubsetName): void {
    this.nationalSubset = name;
  }

  getNationalSubset(): NationalSubsetName {
    return this.nationalSubset;
  }

  /**
   * Resolve a G0 text character to a glyph ID, accounting for national variants.
   */
  resolveG0(charCode: number): number {
    if (charCode < 0x20 || charCode > 0x7F) return G0_BASE; // blank

    // Check for national variant override
    if (this.nationalSubset !== 'english') {
      const subset = NATIONAL_SUBSETS[this.nationalSubset];
      if (subset && charCode in subset) {
        return this.getNationalGlyphId(this.nationalSubset, charCode);
      }
    }

    return G0_BASE + (charCode - 0x20);
  }

  /**
   * Resolve a G1 mosaic character to a glyph ID.
   */
  resolveG1(charCode: number, separated: boolean): number {
    if (charCode >= 0x20 && charCode <= 0x3F) {
      return separated
        ? G1_SEP_LO + (charCode - 0x20)
        : G1_CONT_LO + (charCode - 0x20);
    }
    if (charCode >= 0x60 && charCode <= 0x7F) {
      return separated
        ? G1_SEP_HI + (charCode - 0x60)
        : G1_CONT_HI + (charCode - 0x60);
    }
    // Not a mosaic char — fall back to G0
    return this.resolveG0(charCode);
  }

  /**
   * Get a glyph by its ID.
   */
  getGlyph(id: number): Glyph {
    if (id >= 0 && id < this.glyphs.length) {
      return this.glyphs[id];
    }
    return this.glyphs[0]; // blank fallback
  }

  /**
   * Total number of cached glyphs.
   */
  get size(): number {
    return this.glyphs.length;
  }

  private buildCache(): void {
    // G0 ASCII: 0x20-0x7F → IDs 0-95
    for (let ch = 0x20; ch <= 0x7F; ch++) {
      this.glyphs.push(renderG0(ch));
    }

    // G1 mosaic contiguous low: 0x20-0x3F → IDs 96-127
    for (let ch = 0x20; ch <= 0x3F; ch++) {
      this.glyphs.push(renderMosaic(ch, false));
    }

    // G1 mosaic contiguous high: 0x60-0x7F → IDs 128-159
    for (let ch = 0x60; ch <= 0x7F; ch++) {
      this.glyphs.push(renderMosaic(ch, false));
    }

    // G1 mosaic separated low: 0x20-0x3F → IDs 160-191
    for (let ch = 0x20; ch <= 0x3F; ch++) {
      this.glyphs.push(renderMosaic(ch, true));
    }

    // G1 mosaic separated high: 0x60-0x7F → IDs 192-223
    for (let ch = 0x60; ch <= 0x7F; ch++) {
      this.glyphs.push(renderMosaic(ch, true));
    }
  }

  private getNationalGlyphId(subset: string, charCode: number): number {
    const key = `${subset}:${charCode}`;
    const existing = this.nationalGlyphs.get(key);
    if (existing !== undefined) return existing;

    // Look up the Unicode codepoint for this national variant
    const subsetData = NATIONAL_SUBSETS[subset as NationalSubsetName];
    const unicodeCodepoint = subsetData?.[charCode];

    // Try to get a real national glyph bitmap
    let pixels: Uint8Array | null = null;
    if (unicodeCodepoint !== undefined) {
      pixels = getNationalGlyph(unicodeCodepoint);
    }

    const glyph: Glyph = pixels
      ? { width: CELL_WIDTH, height: CELL_HEIGHT, pixels }
      : renderG0(charCode); // fallback to base G0
    const id = this.glyphs.length;
    this.glyphs.push(glyph);
    this.nationalGlyphs.set(key, id);
    return id;
  }
}
