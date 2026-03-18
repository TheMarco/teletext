/**
 * Full-color teletext import.
 * Per 08_MOSAIC_AND_QUANTIZATION.md.
 *
 * Teletext color constraints:
 * - 8 colors (3-bit RGB)
 * - One foreground color active at a time per row
 * - Changing color costs 1 column (control code cell)
 * - Background defaults to black, changeable with NewBackground
 * - Each cell is a 2×3 binary mosaic: each subcell is either fg or bg
 *
 * Strategy: for each row, find color runs. For each run, determine which
 * palette color best represents the non-black content. Within each cell,
 * classify each subcell as fg (1) or bg (0) by comparing to the run's
 * fg color vs the bg color.
 */

import type { TeletextToken } from '../model/types.js';
import { nearestPaletteColor, type TeletextColor } from './quantize.js';
import { encodeSextant, type SextantCell } from './sextantEncode.js';

const PALETTE_RGB: [number, number, number][] = [
  [0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

// ─── Per-cell color analysis ────────────────────────────────────

interface CellColorInfo {
  /** Dominant non-black color for this cell */
  fgColor: TeletextColor;
  /** Sextant bits when rendered with this fg on black bg */
  bits: [number, number, number, number, number, number];
  /** How many subcells have non-black content */
  fgPixels: number;
}

/**
 * Analyze a single 2×3 cell from RGBA pixel data.
 *
 * OPTIMAL SOLVER: tries every possible fg color (all 7 non-bg colors)
 * and for each, computes the best sextant bits and the total visual error.
 * Picks the fg color + bit pattern that produces the LEAST error.
 *
 * This is much better than the naive "dominant color" approach because
 * it considers how well each color actually represents the 6 sub-pixels
 * when rendered as a binary on/off pattern.
 */
function analyzeCell(
  rgba: Uint8Array | Uint8ClampedArray,
  imgWidth: number,
  cellX: number,
  cellY: number,
  bgColor: TeletextColor,
): CellColorInfo {
  const bgRGB = PALETTE_RGB[bgColor];

  // Sample the 6 subcell pixel colors
  const subcellRGB: [number, number, number][] = [];
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const px = cellX * 2 + sx;
      const py = cellY * 3 + sy;
      const i = (py * imgWidth + px) * 4;
      subcellRGB.push([rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0]);
    }
  }

  // Try every possible fg color and find the one with least total error
  let bestFg: TeletextColor = 7;
  let bestBits: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  let bestError = Infinity;
  let bestFgPixels = 0;

  for (let candidateFg = 0; candidateFg < 8; candidateFg++) {
    if (candidateFg === bgColor) continue; // can't use bg as fg

    const fgRGB = PALETTE_RGB[candidateFg];
    const bits: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
    let totalError = 0;
    let fgCount = 0;

    for (let i = 0; i < 6; i++) {
      const [r, g, b] = subcellRGB[i];
      const distToFg = colorDist(r, g, b, fgRGB[0], fgRGB[1], fgRGB[2]);
      const distToBg = colorDist(r, g, b, bgRGB[0], bgRGB[1], bgRGB[2]);

      if (distToFg < distToBg) {
        // This sub-pixel is closer to fg — turn it ON
        bits[i] = 1;
        totalError += distToFg;
        fgCount++;
      } else {
        // Closer to bg — turn it OFF
        bits[i] = 0;
        totalError += distToBg;
      }
    }

    if (totalError < bestError) {
      bestError = totalError;
      bestFg = candidateFg as TeletextColor;
      bestBits = bits;
      bestFgPixels = fgCount;
    }
  }

  return { fgColor: bestFg, bits: bestBits, fgPixels: bestFgPixels };
}

// ─── Row color planning ─────────────────────────────────────────

export interface RowColorPlan {
  row: number;
  fgColor: TeletextColor;
  bgColor: TeletextColor;
}

export interface ColorRun {
  startCell: number;
  endCell: number; // exclusive
  fgColor: TeletextColor;
}

/**
 * Plan color runs for a row of cells.
 * Groups consecutive cells by their dominant fg color.
 * Only merges single-cell "orphan" runs into neighbors to save control codes.
 * Cells with no fg pixels (all background) inherit the previous run's color.
 */
function planColorRuns(cellInfos: CellColorInfo[]): ColorRun[] {
  if (cellInfos.length === 0) return [];

  // First pass: cells with no fg pixels should inherit neighbor's color
  const effectiveColors = cellInfos.map(c => c.fgColor);
  for (let i = 0; i < effectiveColors.length; i++) {
    if (cellInfos[i].fgPixels === 0) {
      // All background — use previous or next non-empty cell's color
      effectiveColors[i] = i > 0 ? effectiveColors[i - 1] : (effectiveColors[i + 1] ?? 7 as TeletextColor);
    }
  }

  // Group consecutive cells with same effective color
  const rawRuns: ColorRun[] = [];
  let runStart = 0;
  let runColor = effectiveColors[0];

  for (let i = 1; i <= effectiveColors.length; i++) {
    const color = i < effectiveColors.length ? effectiveColors[i] : -1 as TeletextColor;
    if (color !== runColor || i === effectiveColors.length) {
      rawRuns.push({ startCell: runStart, endCell: i, fgColor: runColor });
      runStart = i;
      runColor = color;
    }
  }

  // Merge orphan runs (1 cell) into the larger neighbor — but ONLY if
  // the cell has few fg pixels (so recoloring has low visual cost)
  if (rawRuns.length <= 1) return rawRuns;

  const merged: ColorRun[] = [rawRuns[0]];
  for (let i = 1; i < rawRuns.length; i++) {
    const run = rawRuns[i];
    const prev = merged[merged.length - 1];
    const runLen = run.endCell - run.startCell;

    // Only merge single-cell runs where the cell has ≤2 fg pixels
    if (runLen === 1 && cellInfos[run.startCell].fgPixels <= 2) {
      prev.endCell = run.endCell;
    } else {
      merged.push({ ...run });
    }
  }

  return merged;
}

// ─── Full-color row builder ─────────────────────────────────────

/**
 * Build tokens for a full-color row.
 * Analyzes each cell's dominant color, plans color runs, inserts
 * mosaic color control codes at transitions, and encodes sextant bits
 * against the active fg/bg pair.
 */
export function buildFullColorRowTokens(
  rgba: Uint8Array | Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  cellRow: number,
  numCells: number,
  startCol: number,
  bgColor: TeletextColor,
  contiguous: boolean,
): TeletextToken[] {
  // Analyze all cells in this row
  const cellInfos: CellColorInfo[] = [];
  for (let cx = 0; cx < numCells; cx++) {
    const py = cellRow * 3;
    if (py + 2 < imgHeight && cx * 2 + 1 < imgWidth) {
      cellInfos.push(analyzeCell(rgba, imgWidth, cx, cellRow, bgColor));
    } else {
      cellInfos.push({ fgColor: 7, bits: [0, 0, 0, 0, 0, 0], fgPixels: 0 });
    }
  }

  // Plan color runs
  const runs = planColorRuns(cellInfos);

  // Build token stream
  const tokens: TeletextToken[] = [];

  // Leading space fill
  if (startCol > 0) {
    tokens.push({ kind: 'fill', count: startCol, codepoint7: 0x20 });
  }

  let colsUsed = startCol;

  // Background setup (if not black)
  if (bgColor !== 0 && colsUsed < 38) {
    tokens.push({ kind: 'control', codepoint7: 0x10 + bgColor }); // mosaic color = bg
    tokens.push({ kind: 'control', codepoint7: 0x1D }); // new background
    colsUsed += 2;
  }

  let currentFg: TeletextColor = -1 as any;

  for (const run of runs) {
    // Insert color change if needed
    if (run.fgColor !== currentFg && colsUsed < 39) {
      tokens.push({ kind: 'control', codepoint7: 0x10 + run.fgColor });
      currentFg = run.fgColor;
      colsUsed++;
    }

    for (let ci = run.startCell; ci < run.endCell && colsUsed < 40; ci++) {
      // Use the cell's OWN pre-computed bits if its fg matches the run,
      // otherwise re-encode against the run's actual fg color
      let bits: [number, number, number, number, number, number];

      if (cellInfos[ci].fgColor === run.fgColor || cellInfos[ci].fgPixels === 0) {
        // Cell's own analysis matches — use pre-computed bits
        bits = cellInfos[ci].bits;
      } else {
        // Cell was merged into a different-color run — re-encode
        const fgRGB = PALETTE_RGB[run.fgColor];
        const bgRGB = PALETTE_RGB[bgColor];
        bits = [0, 0, 0, 0, 0, 0];
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const px = ci * 2 + sx;
            const py = cellRow * 3 + sy;
            if (px < imgWidth && py < imgHeight) {
              const idx = (py * imgWidth + px) * 4;
              const r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
              const distFg = colorDist(r, g, b, fgRGB[0], fgRGB[1], fgRGB[2]);
              const distBg = colorDist(r, g, b, bgRGB[0], bgRGB[1], bgRGB[2]);
              bits[sy * 2 + sx] = distFg < distBg ? 1 : 0;
            }
          }
        }
      }

      const cell: SextantCell = { bits };
      tokens.push({ kind: 'mosaic', codepoint7: encodeSextant(cell), contiguous });
      colsUsed++;
    }
  }

  // Pad remainder
  if (colsUsed < 40) {
    tokens.push({ kind: 'fill', count: 40 - colsUsed, codepoint7: 0x20 });
  }

  return tokens;
}

// ─── Legacy exports (kept for compatibility) ────────────────────

export function planRowColors(
  rgba: Uint8Array | Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  cellRows: number,
): RowColorPlan[] {
  const plans: RowColorPlan[] = [];
  const pixelsPerCellRow = 3;
  for (let cr = 0; cr < cellRows; cr++) {
    const y0 = cr * pixelsPerCellRow;
    const y1 = Math.min(y0 + pixelsPerCellRow, imgHeight);
    const colorCounts = new Array(8).fill(0);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < imgWidth; x++) {
        const i = (y * imgWidth + x) * 4;
        colorCounts[nearestPaletteColor(rgba[i], rgba[i + 1], rgba[i + 2])]++;
      }
    }
    const sorted = colorCounts.map((count: number, index: number) => ({ index, count })).sort((a: any, b: any) => b.count - a.count);
    plans.push({ row: cr, bgColor: sorted[0].index as TeletextColor, fgColor: (sorted[1]?.index ?? 7) as TeletextColor });
  }
  return plans;
}

export function buildTwoColorRowTokens(
  sextantRow: SextantCell[],
  plan: RowColorPlan,
  startCol: number,
  contiguous: boolean,
): TeletextToken[] {
  const tokens: TeletextToken[] = [];
  if (startCol > 0) tokens.push({ kind: 'fill', count: startCol, codepoint7: 0x20 });
  if (plan.bgColor !== 0) {
    tokens.push({ kind: 'control', codepoint7: 0x10 + plan.bgColor });
    tokens.push({ kind: 'control', codepoint7: 0x1D });
    tokens.push({ kind: 'control', codepoint7: 0x10 + plan.fgColor });
  } else {
    tokens.push({ kind: 'control', codepoint7: 0x10 + plan.fgColor });
  }
  for (const cell of sextantRow) {
    tokens.push({ kind: 'mosaic', codepoint7: encodeSextant(cell), contiguous });
  }
  const usedCols = startCol + tokens.filter(t => t.kind !== 'fill').length;
  if (usedCols < 40) tokens.push({ kind: 'fill', count: 40 - usedCols, codepoint7: 0x20 });
  return tokens;
}

export function buildOptimizedRowTokens(
  sextantRow: SextantCell[],
  rowPixelsRGBA: Uint8Array | Uint8ClampedArray,
  pixelWidth: number,
  startCol: number,
  contiguous: boolean,
): TeletextToken[] {
  return buildTwoColorRowTokens(sextantRow, { row: 0, fgColor: 7, bgColor: 0 }, startCol, contiguous);
}
