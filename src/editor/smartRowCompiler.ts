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
const DOUBLE_HEIGHT = 0x0D;
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

export function compileVisualRow(visual: VisualRow, doubleHeight: boolean = false): VisualCompileResult {
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
  const slotContent: Array<{ type: 'control'; code: number } | { type: 'cell'; idx: number }> = [];

  // If double-height, insert the control code at slot 0
  if (doubleHeight) {
    slotContent.push({ type: 'control', code: DOUBLE_HEIGHT });
    for (let i = 1; i < 40; i++) {
      slotContent.push({ type: 'cell', idx: i });
    }
  } else {
    for (let i = 0; i < 40; i++) {
      slotContent.push({ type: 'cell', idx: i });
    }
  }

  // Apply transitions: place control codes in slots before each transition.
  // Prefer existing empty space cells. When no space is available, sacrifice
  // cells at the transition point — this is standard teletext behavior where
  // every color/mode change costs one display position.
  const state2 = defaultState();
  for (let i = 0; i < 40; i++) {
    const cell = visual[i];
    if (needsTransition(state2, cell)) {
      const s = { ...state2 };
      const codes = transitionCodes(s, cell);

      if (codes.length > 0) {
        // Find space cells before position i to place codes into
        // Search backwards from i-1 for empty slots
        const availableSlots: number[] = [];
        for (let j = i - 1; j >= 0 && availableSlots.length < codes.length; j--) {
          const slot = slotContent[j];
          if (slot.type === 'cell') {
            const c = visual[slot.idx];
            // Only use genuinely empty cells (space, not mosaic, same bg as default or same bg)
            if (c.char === 0x20 && !c.mosaic) {
              availableSlots.unshift(j); // prepend to keep order
            } else {
              break; // stop at first non-space — don't jump over content
            }
          } else {
            break; // stop at existing control code
          }
        }

        if (availableSlots.length >= codes.length) {
          // Place codes in the available space slots
          for (let j = 0; j < codes.length; j++) {
            slotContent[availableSlots[j]] = { type: 'control', code: codes[j] };
          }
          Object.assign(state2, s);
        } else {
          // Not enough empty space — sacrifice cells at position i onward
          // for the control codes. In teletext, every color/mode change
          // requires a display position for the control code byte.
          const sacrificeCount = Math.min(codes.length, 40 - i);
          for (let j = 0; j < sacrificeCount; j++) {
            slotContent[i + j] = { type: 'control', code: codes[j] };
          }
          Object.assign(state2, s);
        }
      }
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
