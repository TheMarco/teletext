/**
 * Visual layer types for the user-friendly editor.
 * The user thinks in terms of VisualCells (char + color).
 * The editor silently compiles these into teletext tokens.
 */

export interface VisualCell {
  char: number;       // 0x20-0x7F: character or mosaic byte
  fg: number;         // 0-7: foreground color
  bg: number;         // 0-7: background color
  mosaic: boolean;    // true = mosaic graphics, false = text
  contiguous: boolean;
}

export type VisualRow = VisualCell[];

export function defaultVisualCell(): VisualCell {
  return { char: 0x20, fg: 7, bg: 0, mosaic: false, contiguous: true };
}

export function createVisualGrid(): VisualRow[] {
  const grid: VisualRow[] = [];
  for (let r = 0; r < 24; r++) {
    const row: VisualRow = [];
    for (let c = 0; c < 40; c++) {
      row.push(defaultVisualCell());
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Result of compiling a VisualRow into tokens.
 */
export interface VisualCompileResult {
  tokens: import('../model/types.js').TeletextToken[];
  /** How many visual cells fit (40 minus control code overhead) */
  visibleColumns: number;
  /** Maps visual cell index → actual column in 40-byte output */
  cellToCol: number[];
}
