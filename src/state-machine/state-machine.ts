import {
  type Cell,
  type PageGrid,
  type RowState,
  CharsetMode,
  Color,
  MosaicType,
} from './types.js';
import {
  isControlCode,
  isAlphaColor,
  isMosaicColor,
  ALPHA_BLACK,
  FLASH,
  STEADY,
  END_BOX,
  START_BOX,
  NORMAL_HEIGHT,
  DOUBLE_HEIGHT,
  MOSAIC_BLACK,
  CONCEAL,
  CONTIGUOUS_MOSAIC,
  SEPARATED_MOSAIC,
  ESC,
  BLACK_BACKGROUND,
  NEW_BACKGROUND,
  HOLD_MOSAIC,
  RELEASE_MOSAIC,
} from './control-codes.js';

const ROWS = 24;
const COLS = 40;

/**
 * Create the default row state per ETSI EN 300 706 Section 12.2.
 */
export function createDefaultRowState(): RowState {
  return {
    fgColor: Color.WHITE,
    bgColor: Color.BLACK,
    charsetMode: CharsetMode.TEXT,
    mosaicType: MosaicType.CONTIGUOUS,
    holdGraphics: false,
    heldMosaic: null,
    heldMosaicType: MosaicType.CONTIGUOUS,
    doubleHeight: false,
    flash: false,
    conceal: false,
    escSwitch: false,
  };
}

/**
 * Create an empty cell with default attributes.
 */
function createEmptyCell(): Cell {
  return {
    char: 0x20, // space
    fgColor: Color.WHITE,
    bgColor: Color.BLACK,
    charsetMode: CharsetMode.TEXT,
    mosaicType: MosaicType.CONTIGUOUS,
    doubleHeight: false,
    doubleHeightBottom: false,
    flash: false,
    conceal: false,
  };
}

/**
 * Apply a "set-after" control code to the row state.
 *
 * Per ETSI EN 300 706 Section 12.2:
 * - Spacing attributes are "set-after": the control code position itself
 *   uses the OLD state, and the new attribute takes effect from the NEXT
 *   character position onward.
 * - However, Hold Mosaic and Release Mosaic are "set-at": they take
 *   effect at the current position.
 *
 * This function mutates the state for the NEXT position. The caller is
 * responsible for emitting the cell at the current position BEFORE calling
 * this for set-after codes, or AFTER calling this for set-at codes.
 */
export function applySetAfterControlCode(state: RowState, code: number): void {
  if (isAlphaColor(code)) {
    // Alpha color: set foreground, switch to text mode, clear conceal
    state.fgColor = (code - ALPHA_BLACK) as Color;
    state.charsetMode = CharsetMode.TEXT;
    state.conceal = false;
  } else if (isMosaicColor(code)) {
    // Mosaic color: set foreground, switch to graphics mode
    state.fgColor = (code - MOSAIC_BLACK) as Color;
    state.charsetMode = CharsetMode.GRAPHICS;
    state.conceal = false;
  } else {
    switch (code) {
      case FLASH:
        state.flash = true;
        break;
      case STEADY:
        state.flash = false;
        break;
      case END_BOX:
      case START_BOX:
        // Box control — at Level 1, these act as spacing codes with no
        // further effect on the row state.
        break;
      case NORMAL_HEIGHT:
        state.doubleHeight = false;
        break;
      case DOUBLE_HEIGHT:
        state.doubleHeight = true;
        break;
      case CONCEAL:
        state.conceal = true;
        break;
      case CONTIGUOUS_MOSAIC:
        state.mosaicType = MosaicType.CONTIGUOUS;
        break;
      case SEPARATED_MOSAIC:
        state.mosaicType = MosaicType.SEPARATED;
        break;
      case ESC:
        // Toggle between G0/G2 character sets — not fully modelled here
        // but we track the flag for completeness.
        state.escSwitch = !state.escSwitch;
        break;
      case BLACK_BACKGROUND:
        state.bgColor = Color.BLACK;
        break;
      case NEW_BACKGROUND:
        // Set background to current foreground color.
        state.bgColor = state.fgColor;
        break;
      case HOLD_MOSAIC:
        // Set-at: takes effect immediately
        state.holdGraphics = true;
        break;
      case RELEASE_MOSAIC:
        // Set-at: takes effect immediately (but see emission logic)
        state.holdGraphics = false;
        break;
    }
  }
}

/**
 * Determine what character to display at a control code position.
 *
 * Per ETSI EN 300 706 Section 12.2:
 * - If Hold Mosaic is active AND we have a held character, display it.
 * - Otherwise display a space (0x20).
 */
function controlCodeDisplayChar(state: RowState): { char: number; mode: CharsetMode; mosType: MosaicType } {
  if (state.holdGraphics && state.heldMosaic !== null) {
    return { char: state.heldMosaic, mode: CharsetMode.GRAPHICS, mosType: state.heldMosaicType };
  }
  return { char: 0x20, mode: state.charsetMode, mosType: state.mosaicType };
}

/**
 * Emit a cell from the current state and the given display info.
 */
function emitCell(
  state: RowState,
  char: number,
  charsetMode: CharsetMode,
  mosaicType: MosaicType,
): Cell {
  return {
    char,
    fgColor: state.fgColor,
    bgColor: state.bgColor,
    charsetMode,
    mosaicType,
    doubleHeight: state.doubleHeight,
    doubleHeightBottom: false, // set in post-processing
    flash: state.flash,
    conceal: state.conceal,
  };
}

/**
 * Process a single row of 40 bytes through the state machine.
 * Returns an array of 40 Cells.
 */
export function processRow(rowData: Uint8Array | number[]): Cell[] {
  const state = createDefaultRowState();
  const cells: Cell[] = new Array(COLS);

  for (let col = 0; col < COLS; col++) {
    const byte = rowData[col] & 0x7F; // strip parity bit

    if (isControlCode(byte)) {
      // Per ETSI EN 300 706 Section 12.2, spacing attributes are
      // "set-after". The character at the control code position is
      // rendered using the state BEFORE the control code takes effect.
      //
      // Exception: Hold Mosaic (0x1E) is "set-at" — it takes effect
      // at this position, so a held character can appear here.
      // Release Mosaic (0x1F) is also "set-at" but the held character
      // is still displayed at the Release position using the old hold
      // state (the spec says release takes effect at the current position
      // but the held mosaic is still shown).

      if (byte === HOLD_MOSAIC) {
        // Hold is set-at: activate before emitting
        state.holdGraphics = true;
        const display = controlCodeDisplayChar(state);
        cells[col] = emitCell(state, display.char, display.mode, display.mosType);
        // Don't call applySetAfterControlCode again for HOLD_MOSAIC
        // since we already set it.
      } else if (byte === RELEASE_MOSAIC) {
        // Release is set-at but we emit the held character first,
        // then release. The held char appears at this position.
        const display = controlCodeDisplayChar(state);
        cells[col] = emitCell(state, display.char, display.mode, display.mosType);
        state.holdGraphics = false;
      } else {
        // Standard set-after: emit with OLD state, then apply.
        const display = controlCodeDisplayChar(state);
        cells[col] = emitCell(state, display.char, display.mode, display.mosType);
        applySetAfterControlCode(state, byte);
      }
    } else {
      // Printable character (0x20-0x7F)
      if (state.charsetMode === CharsetMode.GRAPHICS && byte >= 0x20 && byte < 0x80) {
        // In graphics mode, characters 0x20-0x3F and 0x60-0x7F are
        // mosaic characters. 0x40-0x5F are still G0 alpha characters.
        if ((byte >= 0x20 && byte <= 0x3F) || (byte >= 0x60 && byte <= 0x7F)) {
          // Mosaic character — update held mosaic
          state.heldMosaic = byte;
          state.heldMosaicType = state.mosaicType;
          cells[col] = emitCell(state, byte, CharsetMode.GRAPHICS, state.mosaicType);
        } else {
          // 0x40-0x5F: still alpha even in graphics mode
          cells[col] = emitCell(state, byte, CharsetMode.TEXT, state.mosaicType);
        }
      } else {
        cells[col] = emitCell(state, byte, state.charsetMode, state.mosaicType);
      }
    }
  }

  return cells;
}

/**
 * Process a full 24x40 page through the state machine.
 *
 * Handles double-height by marking bottom rows. Per ETSI EN 300 706,
 * the row following a double-height row displays the bottom half of
 * the double-height characters. If the bottom row itself has no
 * double-height attribute set, it is blanked.
 */
export function processPage(pageData: Uint8Array[] | number[][]): PageGrid {
  const grid: PageGrid = new Array(ROWS);

  // First pass: process each row independently
  for (let row = 0; row < ROWS; row++) {
    grid[row] = processRow(pageData[row]);
  }

  // Second pass: mark double-height bottom rows
  for (let row = 0; row < ROWS - 1; row++) {
    const hasDoubleHeight = grid[row].some(cell => cell.doubleHeight);
    if (hasDoubleHeight) {
      // The next row is the bottom half
      for (let col = 0; col < COLS; col++) {
        if (grid[row][col].doubleHeight) {
          grid[row + 1][col] = {
            ...grid[row][col],
            doubleHeight: true,
            doubleHeightBottom: true,
          };
        }
      }
      row++; // skip the bottom row so it doesn't cascade
    }
  }

  return grid;
}
