/**
 * Smart row compiler: converts a VisualRow (40 cells with desired colors)
 * into an optimal TeletextToken stream with control codes auto-inserted.
 *
 * The user never sees control codes. This compiler figures out where to
 * put them to achieve the desired visual result.
 */

import type { TeletextToken } from '../model/types.js';
import type { VisualRow, VisualCell, VisualCompileResult } from './visualTypes.js';

// Control code constants
const ALPHA_BASE = 0x00;    // 0x00-0x07 = alpha colors (text mode)
const MOSAIC_BASE = 0x10;   // 0x10-0x17 = mosaic colors (graphics mode)
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
 * Compute the control codes needed to transition from `state` to match `cell`.
 * Returns array of control code bytes to insert BEFORE the cell.
 * Mutates `state` to reflect the new state after codes are applied.
 */
function transitionCodes(state: RowState, cell: VisualCell): number[] {
  const codes: number[] = [];

  // Skip empty/space cells that match default — no codes needed
  const needsFg = state.fg !== cell.fg;
  const needsMode = state.mosaic !== cell.mosaic;
  const needsBg = state.bg !== cell.bg;
  const needsContiguous = cell.mosaic && state.contiguous !== cell.contiguous;

  // Background change (most expensive — handle first)
  if (needsBg) {
    if (cell.bg === 0) {
      // Black background — just one code
      codes.push(BLACK_BG);
      state.bg = 0;
    } else {
      // NEW_BACKGROUND sets bg = current fg
      // Strategy: set fg to desired bg color, then NEW_BG, then set fg to actual desired fg
      if (state.fg === cell.bg && !needsMode && !needsFg) {
        // Lucky: fg already matches desired bg
        codes.push(NEW_BG);
        state.bg = cell.bg;
      } else {
        // Set fg to bg color temporarily
        const tempCode = cell.mosaic ? MOSAIC_BASE + cell.bg : ALPHA_BASE + cell.bg;
        codes.push(tempCode);
        state.fg = cell.bg;
        state.mosaic = cell.mosaic;
        codes.push(NEW_BG);
        state.bg = cell.bg;
        // Now we need to fix fg to actual desired fg (handled below)
      }
    }
  }

  // Foreground color and/or mode change
  if (state.fg !== cell.fg || state.mosaic !== cell.mosaic) {
    const colorCode = cell.mosaic
      ? MOSAIC_BASE + cell.fg
      : ALPHA_BASE + cell.fg;
    codes.push(colorCode);
    state.fg = cell.fg;
    state.mosaic = cell.mosaic;
  }

  // Contiguous/separated mosaic
  if (needsContiguous) {
    codes.push(cell.contiguous ? CONTIGUOUS : SEPARATED);
    state.contiguous = cell.contiguous;
  }

  return codes;
}

/**
 * Compile a VisualRow into TeletextTokens with auto-inserted control codes.
 *
 * Algorithm:
 * 1. Walk cells left-to-right, compute needed control codes at each transition
 * 2. Pack codes + visible characters into 40 columns, truncating from right
 * 3. Optimize: skip redundant transitions for spaces matching bg
 */
export function compileVisualRow(visual: VisualRow): VisualCompileResult {
  const tokens: TeletextToken[] = [];
  const cellToCol: number[] = new Array(40).fill(-1);
  let col = 0;
  const state = defaultState();

  for (let i = 0; i < 40 && col < 40; i++) {
    const cell = visual[i];

    // Optimization: if this cell is a space and its fg doesn't matter
    // (space looks the same regardless of fg), only transition for bg changes
    const isSpace = cell.char === 0x20 && !cell.mosaic;
    const needsTransition = isSpace
      ? state.bg !== cell.bg  // spaces only care about background
      : (state.fg !== cell.fg || state.mosaic !== cell.mosaic || state.bg !== cell.bg ||
         (cell.mosaic && state.contiguous !== cell.contiguous));

    if (needsTransition && !isSpace) {
      const codes = transitionCodes(state, cell);
      for (const code of codes) {
        if (col >= 40) break;
        tokens.push({ kind: 'control', codepoint7: code });
        col++;
      }
    } else if (needsTransition && isSpace && state.bg !== cell.bg) {
      // Space with different bg — need bg transition
      if (cell.bg === 0) {
        if (col < 40) { tokens.push({ kind: 'control', codepoint7: BLACK_BG }); state.bg = 0; col++; }
      } else if (state.fg === cell.bg) {
        if (col < 40) { tokens.push({ kind: 'control', codepoint7: NEW_BG }); state.bg = cell.bg; col++; }
      }
      // If bg change requires 3 codes for a space, skip it — not worth it
    }

    // Emit the visible character
    if (col < 40) {
      cellToCol[i] = col;
      if (cell.mosaic) {
        tokens.push({ kind: 'mosaic', codepoint7: cell.char, contiguous: cell.contiguous });
      } else {
        tokens.push({ kind: 'char', codepoint7: cell.char });
      }
      col++;
    }
  }

  // Pad to 40
  while (col < 40) {
    tokens.push({ kind: 'char', codepoint7: 0x20 });
    col++;
  }

  const visibleColumns = cellToCol.filter(c => c >= 0).length;
  return { tokens, visibleColumns, cellToCol };
}

/**
 * Decompile a rendered row back to VisualCells by running the state machine.
 * Used to import existing pages into the visual editor.
 */
export function decompileToVisualRow(bytes: Uint8Array | number[]): VisualRow {
  const row: VisualRow = [];
  let fg = 7, bg = 0, mosaic = false, contiguous = true;

  for (let i = 0; i < 40; i++) {
    const b = typeof bytes[i] === 'number' ? bytes[i] : 0x20;

    if (b >= 0x00 && b <= 0x07) {
      // Alpha color — switch to text, set fg
      fg = b; mosaic = false;
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else if (b >= 0x10 && b <= 0x17) {
      // Mosaic color — switch to graphics, set fg
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
      // Other control codes — show as space
      row.push({ char: 0x20, fg, bg, mosaic, contiguous });
    } else {
      // Visible character
      row.push({ char: b, fg, bg, mosaic, contiguous });
    }
  }

  return row;
}
