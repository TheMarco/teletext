/**
 * Smart row compiler: converts a VisualRow (40 cells with desired colors)
 * into an optimal TeletextToken stream with control codes auto-inserted.
 *
 * KEY DESIGN: visual cell i ALWAYS maps to screen column i.
 * Control codes overwrite PRECEDING cells (showing as spaces) rather
 * than inserting before cells (which would shift everything right).
 *
 * When a color change is needed at cell i, control codes are placed
 * at cells i-N through i-1. Those cells become spaces. This keeps
 * the 1:1 mapping between visual grid position and screen position.
 */

import type { TeletextToken } from '../model/types.js';
import type { VisualRow, VisualCell, VisualCompileResult } from './visualTypes.js';

const ALPHA_BASE = 0x00;
const MOSAIC_BASE = 0x10;
const BLACK_BG = 0x1C;
const NEW_BG = 0x1D;
const CONTIGUOUS = 0x19;
const SEPARATED = 0x1A;

interface RowState {
  fg: number;
  bg: number;
  mosaic: boolean;
  contiguous: boolean;
}

function defaultState(): RowState {
  return { fg: 7, bg: 0, mosaic: false, contiguous: true };
}

/**
 * Compute control codes needed to transition state to match a cell.
 * Mutates state to reflect the new state after codes.
 */
function transitionCodes(state: RowState, cell: VisualCell): number[] {
  const codes: number[] = [];

  if (state.bg !== cell.bg) {
    if (cell.bg === 0) {
      codes.push(BLACK_BG);
      state.bg = 0;
    } else if (state.fg === cell.bg && state.mosaic === cell.mosaic) {
      codes.push(NEW_BG);
      state.bg = cell.bg;
    } else {
      codes.push(cell.mosaic ? MOSAIC_BASE + cell.bg : ALPHA_BASE + cell.bg);
      state.fg = cell.bg;
      state.mosaic = cell.mosaic;
      codes.push(NEW_BG);
      state.bg = cell.bg;
    }
  }

  if (state.fg !== cell.fg || state.mosaic !== cell.mosaic) {
    codes.push(cell.mosaic ? MOSAIC_BASE + cell.fg : ALPHA_BASE + cell.fg);
    state.fg = cell.fg;
    state.mosaic = cell.mosaic;
  }

  if (cell.mosaic && state.contiguous !== cell.contiguous) {
    codes.push(cell.contiguous ? CONTIGUOUS : SEPARATED);
    state.contiguous = cell.contiguous;
  }

  return codes;
}

/**
 * Compile a VisualRow into TeletextTokens.
 * Cell i always maps to screen column i (1:1).
 */
export function compileVisualRow(visual: VisualRow): VisualCompileResult {
  // Build a 40-element output array: each slot is either a control code or a visible cell
  const output: TeletextToken[] = new Array(40);
  const cellToCol: number[] = new Array(40).fill(-1);

  // First pass: fill all slots with visible cells
  for (let i = 0; i < 40; i++) {
    const cell = visual[i];
    if (cell.mosaic) {
      output[i] = { kind: 'mosaic', codepoint7: cell.char, contiguous: cell.contiguous };
    } else {
      output[i] = { kind: 'char', codepoint7: cell.char };
    }
    cellToCol[i] = i;
  }

  // Second pass: find transitions and place control codes BEFORE each one
  // Control codes overwrite preceding cells (they become spaces)
  const state = defaultState();

  for (let i = 0; i < 40; i++) {
    const cell = visual[i];
    const isSpace = cell.char === 0x20 && !cell.mosaic;

    const needsTransition = isSpace
      ? state.bg !== cell.bg
      : (state.fg !== cell.fg || state.mosaic !== cell.mosaic ||
         state.bg !== cell.bg ||
         (cell.mosaic && state.contiguous !== cell.contiguous));

    if (needsTransition) {
      const stateCopy: RowState = { ...state };
      let codes: number[];

      if (isSpace && state.bg !== cell.bg && cell.bg === 0) {
        codes = [BLACK_BG];
        stateCopy.bg = 0;
      } else if (isSpace && state.bg === cell.bg) {
        codes = [];
      } else {
        codes = transitionCodes(stateCopy, cell);
      }

      if (codes.length > 0) {
        // Place codes at positions (i - codes.length) through (i - 1)
        // These positions get overwritten with control codes
        for (let j = 0; j < codes.length; j++) {
          const pos = i - codes.length + j;
          if (pos >= 0) {
            output[pos] = { kind: 'control', codepoint7: codes[j] };
            cellToCol[pos] = -1; // no longer a visible cell
          }
        }
        Object.assign(state, stateCopy);
      }
    } else {
      // No transition needed — just track state for spaces
      // (spaces don't change fg/mode but we need to keep state consistent)
    }
  }

  const visibleColumns = cellToCol.filter(c => c >= 0).length;
  return { tokens: output, visibleColumns, cellToCol };
}

/**
 * Decompile a rendered row back to VisualCells.
 */
export function decompileToVisualRow(bytes: Uint8Array | number[]): VisualRow {
  const row: VisualRow = [];
  let fg = 7, bg = 0, mosaic = false, contiguous = true;

  for (let i = 0; i < 40; i++) {
    const b = typeof bytes[i] === 'number' ? bytes[i] : 0x20;

    if (b >= 0x00 && b <= 0x07) {
      fg = b; mosaic = false;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b >= 0x10 && b <= 0x17) {
      fg = b - 0x10; mosaic = true;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b === 0x1C) {
      bg = 0;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b === 0x1D) {
      bg = fg;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b === 0x19) {
      contiguous = true;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b === 0x1A) {
      contiguous = false;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b < 0x20) {
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else {
      row.push({ char: b, fg, bg, mosaic, contiguous });
    }
  }

  return row;
}
