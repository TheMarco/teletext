/**
 * ANSI terminal renderer for Teletext pages.
 *
 * Converts a PageGrid (state machine output) into a string of ANSI escape
 * sequences + Unicode characters suitable for display in a modern terminal.
 *
 * Mosaic characters use the Unicode "Symbols for Legacy Computing" block
 * (U+1FB00–U+1FB3B) which provides all 64 sextant (2×3 block) patterns.
 *
 * Requirements:
 * - Terminal with Unicode 13.0+ font support (iTerm2, WezTerm, Kitty,
 *   Windows Terminal, Ghostty, etc.)
 * - 256-color or truecolor support (for exact palette matching)
 */

import type { PageGrid, Cell } from '../state-machine/types.js';
import { CharsetMode, Color, MosaicType } from '../state-machine/types.js';

const ROWS = 24;
const COLS = 40;

/**
 * ANSI SGR color codes for foreground (30-37) and background (40-47).
 * Maps Color enum (0-7) to standard ANSI color indices.
 */
const ANSI_FG: readonly number[] = [30, 31, 32, 33, 34, 35, 36, 37];
const ANSI_BG: readonly number[] = [40, 41, 42, 43, 44, 45, 46, 47];

/**
 * Build the sextant lookup table.
 *
 * Both Teletext and Unicode sextants use the same row-major bit ordering:
 *   bit 0 = top-left, bit 1 = top-right
 *   bit 2 = mid-left, bit 3 = mid-right
 *   bit 4 = bot-left, bit 5 = bot-right
 *
 * Unicode U+1FB00–U+1FB3B covers 60 of the 62 non-trivial patterns.
 * Two patterns already exist as Block Elements and are skipped:
 *   Pattern 21 (0b010101) = left column  → U+258C LEFT HALF BLOCK
 *   Pattern 42 (0b101010) = right column → U+2590 RIGHT HALF BLOCK
 * Additionally:
 *   Pattern 0  (empty) → U+0020 SPACE
 *   Pattern 63 (full)  → U+2588 FULL BLOCK
 */
function buildSextantTable(): string[] {
  const table: string[] = new Array(64);

  for (let bits = 0; bits < 64; bits++) {
    if (bits === 0) {
      table[0] = ' ';
    } else if (bits === 21) {
      table[21] = '\u258C'; // ▌ LEFT HALF BLOCK
    } else if (bits === 42) {
      table[42] = '\u2590'; // ▐ RIGHT HALF BLOCK
    } else if (bits === 63) {
      table[63] = '\u2588'; // █ FULL BLOCK
    } else {
      // Offset into U+1FB00 range, adjusted for the two gaps
      let offset = bits - 1;
      if (bits > 21) offset--;
      if (bits > 42) offset--;
      table[bits] = String.fromCodePoint(0x1FB00 + offset);
    }
  }

  return table;
}

const SEXTANT_TABLE = buildSextantTable();

/**
 * Extract the 6-bit mosaic pattern from a character code.
 * Same logic as glyph-system's renderMosaic.
 */
function mosaicBits(charCode: number): number {
  if (charCode >= 0x20 && charCode <= 0x3F) {
    return charCode - 0x20;
  } else if (charCode >= 0x60 && charCode <= 0x7F) {
    return (charCode - 0x60) | 0x20;
  }
  return 0;
}

/**
 * Convert a G0 character code to the corresponding printable character.
 * Teletext G0 maps 0x20-0x7F to a Latin character set that is mostly ASCII.
 */
function g0Char(charCode: number): string {
  if (charCode >= 0x20 && charCode <= 0x7E) {
    return String.fromCharCode(charCode);
  }
  // 0x7F = DEL, render as space
  return ' ';
}

/**
 * Options for ANSI rendering.
 */
export interface AnsiRenderOptions {
  /** If true, flashing cells are visible. Default: true. */
  flashPhase?: boolean;
  /** If true, concealed cells are revealed. Default: false. */
  reveal?: boolean;
  /** If true, use truecolor (24-bit) SGR sequences. Default: false (use standard 8-color). */
  truecolor?: boolean;
  /** If true, approximate separated mosaics by dimming. Default: false. */
  separatedDim?: boolean;
}

/**
 * Teletext color palette — standard 3-bit RGB (for truecolor mode).
 */
const PALETTE: readonly [number, number, number][] = [
  [0x00, 0x00, 0x00], // BLACK
  [0xFF, 0x00, 0x00], // RED
  [0x00, 0xFF, 0x00], // GREEN
  [0xFF, 0xFF, 0x00], // YELLOW
  [0x00, 0x00, 0xFF], // BLUE
  [0xFF, 0x00, 0xFF], // MAGENTA
  [0x00, 0xFF, 0xFF], // CYAN
  [0xFF, 0xFF, 0xFF], // WHITE
];

/**
 * Render a full Teletext PageGrid to an ANSI-escaped string.
 *
 * The output is a sequence of lines (joined by \n) that can be written
 * directly to a terminal. Each line is 40 characters wide with ANSI SGR
 * sequences for color.
 *
 * @param grid - The 24×40 PageGrid from the state machine
 * @param options - Rendering options
 * @returns A string with ANSI escape sequences
 */
export function renderToAnsi(grid: PageGrid, options: AnsiRenderOptions = {}): string {
  const {
    flashPhase = true,
    reveal = false,
    truecolor = false,
    separatedDim = false,
  } = options;

  const lines: string[] = [];

  for (let row = 0; row < ROWS; row++) {
    let line = '';
    let prevFg: Color | -1 = -1;
    let prevBg: Color | -1 = -1;

    // Note: DECDHL (ESC#3/ESC#4) is not used — it doubles width too,
    // but teletext double-height is height-only. No terminal escape exists
    // for double-height-without-double-width. The state machine already
    // emits two rows for double-height text, so content is correct.

    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];

      // Determine visibility
      const flashHidden = cell.flash && !flashPhase;
      const concealHidden = cell.conceal && !reveal;
      const hidden = flashHidden || concealHidden;

      const fg = cell.fgColor;
      const bg = cell.bgColor;

      // Emit SGR only when colors change
      if (fg !== prevFg || bg !== prevBg) {
        if (truecolor) {
          const [fr, fg2, fb] = PALETTE[fg];
          const [br, bg2, bb] = PALETTE[bg];
          line += `\x1b[38;2;${fr};${fg2};${fb};48;2;${br};${bg2};${bb}m`;
        } else {
          line += `\x1b[${ANSI_FG[fg]};${ANSI_BG[bg]}m`;
        }
        prevFg = fg;
        prevBg = bg;
      }

      if (hidden) {
        line += ' ';
        continue;
      }

      // Resolve character
      if (cell.charsetMode === CharsetMode.GRAPHICS) {
        const isMosaic =
          (cell.char >= 0x20 && cell.char <= 0x3F) ||
          (cell.char >= 0x60 && cell.char <= 0x7F);

        if (isMosaic) {
          const bits = mosaicBits(cell.char);
          line += SEXTANT_TABLE[bits];
        } else {
          // 0x40-0x5F in graphics mode: render as G0
          line += g0Char(cell.char);
        }
      } else {
        line += g0Char(cell.char);
      }
    }

    // Reset at end of line
    line += '\x1b[0m';
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Render a PageGrid to ANSI and write directly to a writable stream.
 * Useful for piping to stdout without building the full string.
 */
export function renderToAnsiStream(
  grid: PageGrid,
  stream: { write(s: string): void },
  options: AnsiRenderOptions = {},
): void {
  const output = renderToAnsi(grid, options);
  stream.write(output);
  stream.write('\n');
}

/**
 * Render with a border and page header, suitable for interactive display.
 */
export function renderToAnsiFramed(
  grid: PageGrid,
  pageNumber?: string,
  options: AnsiRenderOptions = {},
): string {
  const content = renderToAnsi(grid, options);
  const lines: string[] = [];

  // Top border
  const header = pageNumber ? ` P${pageNumber} ` : '';
  const borderTop = '┌' + '─'.repeat(40) + '┐';
  if (header) {
    const pos = Math.floor((40 - header.length) / 2);
    lines.push(
      '┌' +
      '─'.repeat(pos) +
      header +
      '─'.repeat(40 - pos - header.length) +
      '┐'
    );
  } else {
    lines.push(borderTop);
  }

  // Content rows (no side borders — simplifies double-height handling)
  for (const row of content.split('\n')) {
    lines.push(row + '\x1b[0m');
  }

  // Bottom border
  lines.push('└' + '─'.repeat(40) + '┘');

  return lines.join('\n');
}
