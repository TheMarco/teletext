/**
 * Smart row compiler: converts a VisualRow into TeletextTokens.
 *
 * Cell i always maps to screen column i (1:1).
 * When a color/mode change is needed, control codes are placed at
 * the cells immediately BEFORE the transition. Those cells' content
 * is sacrificed (shown as spaces).
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
 * Compute control codes to transition from current state to desired cell.
 */
function transitionCodes(state: RowState, cell: VisualCell): number[] {
  const codes: number[] = [];

  // Background change
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

  // Foreground color and/or mode change
  if (state.fg !== cell.fg || state.mosaic !== cell.mosaic) {
    codes.push(cell.mosaic ? MOSAIC_BASE + cell.fg : ALPHA_BASE + cell.fg);
    state.fg = cell.fg;
    state.mosaic = cell.mosaic;
  }

  // Contiguous/separated
  if (cell.mosaic && state.contiguous !== cell.contiguous) {
    codes.push(cell.contiguous ? CONTIGUOUS : SEPARATED);
    state.contiguous = cell.contiguous;
  }

  return codes;
}

/**
 * Check if a cell needs any state transition from the current state.
 */
function needsTransition(state: RowState, cell: VisualCell): boolean {
  const isBlankSpace = cell.char === 0x20 && !cell.mosaic;
  if (isBlankSpace) {
    return state.bg !== cell.bg;
  }
  return state.fg !== cell.fg ||
         state.mosaic !== cell.mosaic ||
         state.bg !== cell.bg ||
         (cell.mosaic && state.contiguous !== cell.contiguous);
}

export function compileVisualRow(visual: VisualRow): VisualCompileResult {
  // Phase 1: figure out where transitions happen and how many codes each needs
  const state1 = defaultState();
  const transitionsNeeded: number[] = new Array(40).fill(0); // codes needed before cell i

  for (let i = 0; i < 40; i++) {
    const cell = visual[i];
    if (needsTransition(state1, cell)) {
      const s = { ...state1 };
      const codes = transitionCodes(s, cell);
      transitionsNeeded[i] = codes.length;
      Object.assign(state1, s);
    }
  }

  // Phase 2: build the 40-token output
  // For each transition at cell i that needs N codes, place N control codes
  // at positions (i-N) through (i-1). Mark those slots.
  const slotContent: Array<{ type: 'control'; code: number } | { type: 'cell'; idx: number }> = [];
  for (let i = 0; i < 40; i++) {
    slotContent.push({ type: 'cell', idx: i });
  }

  // Apply transitions: place control codes in preceding slots.
  // If there's no room before the cell (e.g., cell 0), use the cell's own
  // slot and subsequent slots for the codes, pushing content right.
  const state2 = defaultState();
  for (let i = 0; i < 40; i++) {
    const cell = visual[i];
    if (needsTransition(state2, cell)) {
      const s = { ...state2 };
      const codes = transitionCodes(s, cell);

      if (codes.length > 0) {
        // Try to place codes at (i - codes.length) through (i - 1)
        const startPos = i - codes.length;

        if (startPos >= 0) {
          // Normal case: enough room before the cell
          for (let j = 0; j < codes.length; j++) {
            slotContent[startPos + j] = { type: 'control', code: codes[j] };
          }
        } else {
          // Not enough room before — place codes starting at position 0
          // and shift the target cell rightward
          for (let j = 0; j < codes.length && j < 40; j++) {
            slotContent[j] = { type: 'control', code: codes[j] };
          }
          // The cell that needed the transition gets pushed to after the codes
          if (codes.length < 40) {
            slotContent[codes.length] = { type: 'cell', idx: i };
          }
        }
      }
      Object.assign(state2, s);
    }
  }

  // Phase 3: convert slots to tokens
  const tokens: TeletextToken[] = [];
  const cellToCol: number[] = new Array(40).fill(-1);

  for (let i = 0; i < 40; i++) {
    const slot = slotContent[i];
    if (slot.type === 'control') {
      tokens.push({ kind: 'control', codepoint7: slot.code });
    } else {
      const cell = visual[slot.idx];
      cellToCol[slot.idx] = i;
      if (cell.mosaic) {
        tokens.push({ kind: 'mosaic', codepoint7: cell.char, contiguous: cell.contiguous });
      } else {
        tokens.push({ kind: 'char', codepoint7: cell.char });
      }
    }
  }

  const visibleColumns = cellToCol.filter(c => c >= 0).length;
  return { tokens, visibleColumns, cellToCol };
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
