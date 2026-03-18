/**
 * Teletext colors per ETSI EN 300 706.
 */
export const enum Color {
  BLACK   = 0,
  RED     = 1,
  GREEN   = 2,
  YELLOW  = 3,
  BLUE    = 4,
  MAGENTA = 5,
  CYAN    = 6,
  WHITE   = 7,
}

/**
 * Character set mode.
 */
export const enum CharsetMode {
  TEXT     = 0,  // G0 alphanumeric
  GRAPHICS = 1, // G1 mosaic
}

/**
 * Mosaic sub-mode: contiguous vs separated.
 */
export const enum MosaicType {
  CONTIGUOUS = 0,
  SEPARATED  = 1,
}

/**
 * Per-row state that tracks all rendering attributes.
 * Reset at the start of each row per ETSI EN 300 706 Section 12.2.
 */
export interface RowState {
  fgColor: Color;
  bgColor: Color;
  charsetMode: CharsetMode;
  mosaicType: MosaicType;
  holdGraphics: boolean;
  heldMosaic: number | null;
  heldMosaicType: MosaicType;
  doubleHeight: boolean;
  flash: boolean;
  conceal: boolean;
  escSwitch: boolean;
}

/**
 * A rendered cell in the 40x24 grid.
 */
export interface Cell {
  char: number;         // character code to render (7-bit)
  fgColor: Color;
  bgColor: Color;
  charsetMode: CharsetMode;
  mosaicType: MosaicType;
  doubleHeight: boolean;
  doubleHeightBottom: boolean;
  flash: boolean;
  conceal: boolean;
}

/**
 * Full page of rendered cells: 24 rows x 40 columns.
 */
export type PageGrid = Cell[][];
