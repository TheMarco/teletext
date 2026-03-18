/**
 * Bitmap → page placement.
 * Per 07_BITMAP_IMPORT_PIPELINE.md.
 *
 * Converts sextant-encoded data into page model mutations.
 */

import type { TeletextSubpage, TeletextToken } from '../model/types.js';
import type { SextantCell } from './sextantEncode.js';
import { encodeSextant } from './sextantEncode.js';

export interface ImportRegion {
  x: number; // start column
  y: number; // start row
  width: number; // columns
  height: number; // rows
}

export interface ImportOptions {
  region: ImportRegion;
  fgColor: number; // 0x01-0x07 (alpha color control code for graphics)
  contiguous: boolean;
  eraseFirst: boolean;
}

export interface ImportResult {
  placedRegion: ImportRegion;
  rowMutations: Array<{ rowIndex: number; tokens: TeletextToken[] }>;
  diagnostics: string[];
}

/**
 * Convert a sextant grid into page row mutations.
 *
 * The sextant grid is placed at the specified region.
 * Each row gets a leading graphics color control code,
 * followed by mosaic bytes.
 */
export function buildImportMutations(
  sextants: SextantCell[][],
  options: ImportOptions,
): ImportResult {
  const { region, fgColor, contiguous, eraseFirst } = options;
  const diagnostics: string[] = [];
  const rowMutations: Array<{ rowIndex: number; tokens: TeletextToken[] }> = [];

  // Graphics mode control code = 0x10 + color (mosaic colors)
  const graphicsCode = 0x10 + (fgColor & 0x07);

  for (let sy = 0; sy < sextants.length && (region.y + sy) < 24; sy++) {
    const rowIndex = region.y + sy;
    const sextantRow = sextants[sy];
    const tokens: TeletextToken[] = [];

    // Fill before the region
    if (region.x > 0) {
      tokens.push({ kind: 'fill', count: region.x, codepoint7: 0x20 });
    }

    // Leading graphics color code (takes 1 column)
    tokens.push({ kind: 'control', codepoint7: graphicsCode });

    // Mosaic bytes
    for (let sx = 0; sx < sextantRow.length && (region.x + 1 + sx) < 40; sx++) {
      const code = encodeSextant(sextantRow[sx]);
      tokens.push({ kind: 'mosaic', codepoint7: code, contiguous });
    }

    // Fill remainder
    const usedCols = region.x + 1 + sextantRow.length;
    if (usedCols < 40) {
      tokens.push({ kind: 'fill', count: 40 - usedCols, codepoint7: 0x20 });
    }

    rowMutations.push({ rowIndex, tokens });
  }

  if (sextants.length > 24 - region.y) {
    diagnostics.push(`Image truncated: ${sextants.length} rows exceeds available space`);
  }

  return {
    placedRegion: {
      ...region,
      height: Math.min(sextants.length, 24 - region.y),
    },
    rowMutations,
    diagnostics,
  };
}

/**
 * Apply import mutations to a subpage.
 */
export function applyImportToSubpage(
  subpage: TeletextSubpage,
  result: ImportResult,
): TeletextSubpage {
  const sp = structuredClone(subpage);
  for (const mut of result.rowMutations) {
    if (mut.rowIndex >= 0 && mut.rowIndex < 24) {
      sp.rows[mut.rowIndex] = { index: mut.rowIndex, tokens: mut.tokens };
    }
  }
  return sp;
}
