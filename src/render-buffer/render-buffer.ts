import type { PageGrid, Cell } from '../state-machine/types.js';
import { CharsetMode, Color, MosaicType } from '../state-machine/types.js';
import { GlyphCache, CELL_WIDTH, CELL_HEIGHT } from '../glyph-system/index.js';
import type { Glyph } from '../glyph-system/index.js';

const ROWS = 24;
const COLS = 40;

/**
 * Full pixel buffer dimensions.
 */
export const BUFFER_WIDTH = COLS * CELL_WIDTH;   // 480
export const BUFFER_HEIGHT = ROWS * CELL_HEIGHT; // 240

/**
 * A resolved render cell per RENDER_BUFFER.md spec.
 * This is the final resolved state — the renderer does NOT interpret
 * control codes. It only needs glyphId + colors + visibility flags.
 */
export interface RenderCell {
  glyphId: number;
  fg: Color;
  bg: Color;
  flash: boolean;
  conceal: boolean;
  doubleHeight: boolean;
  doubleHeightBottom: boolean;
}

/**
 * Resolved render grid: 24 rows × 40 columns.
 */
export type RenderGrid = RenderCell[][];

/**
 * RGBA pixel buffer for the rendered page.
 */
export interface RenderResult {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, length = width * height * 4
}

/**
 * Teletext color palette — standard 3-bit RGB.
 */
const PALETTE: [number, number, number][] = [
  [0x00, 0x00, 0x00], // BLACK
  [0xFF, 0x00, 0x00], // RED
  [0x00, 0xFF, 0x00], // GREEN
  [0xFF, 0xFF, 0x00], // YELLOW
  [0x00, 0x00, 0xFF], // BLUE
  [0xFF, 0x00, 0xFF], // MAGENTA
  [0x00, 0xFF, 0xFF], // CYAN
  [0xFF, 0xFF, 0xFF], // WHITE
];

// Default shared glyph cache instance
let defaultCache: GlyphCache | null = null;

function getDefaultCache(): GlyphCache {
  if (!defaultCache) defaultCache = new GlyphCache();
  return defaultCache;
}

/**
 * Resolve a state machine Cell to a RenderCell with a glyphId.
 *
 * This is the resolution step that converts raw char codes + charset mode
 * into a resolved glyph ID via the glyph cache.
 */
function resolveCell(cell: Cell, cache: GlyphCache): RenderCell {
  let glyphId: number;

  if (cell.charsetMode === CharsetMode.GRAPHICS) {
    const isMosaic =
      (cell.char >= 0x20 && cell.char <= 0x3F) ||
      (cell.char >= 0x60 && cell.char <= 0x7F);
    if (isMosaic) {
      glyphId = cache.resolveG1(cell.char, cell.mosaicType === MosaicType.SEPARATED);
    } else {
      // 0x40-0x5F in graphics mode: still G0 alpha
      glyphId = cache.resolveG0(cell.char);
    }
  } else {
    glyphId = cache.resolveG0(cell.char);
  }

  return {
    glyphId,
    fg: cell.fgColor,
    bg: cell.bgColor,
    flash: cell.flash,
    conceal: cell.conceal,
    doubleHeight: cell.doubleHeight,
    doubleHeightBottom: cell.doubleHeightBottom,
  };
}

/**
 * Resolve a full PageGrid (state machine output) into a RenderGrid.
 *
 * Per RENDER_BUFFER.md: "Buffer represents final resolved state."
 * The renderer must NOT interpret control codes — all resolution
 * happens here.
 */
export function resolveGrid(grid: PageGrid, cache?: GlyphCache): RenderGrid {
  const c = cache ?? getDefaultCache();
  const resolved: RenderGrid = new Array(ROWS);

  for (let row = 0; row < ROWS; row++) {
    resolved[row] = new Array(COLS);
    for (let col = 0; col < COLS; col++) {
      resolved[row][col] = resolveCell(grid[row][col], c);
    }
  }

  return resolved;
}

/**
 * Render a resolved RenderGrid to an RGBA pixel buffer.
 *
 * This is the pixel renderer — it takes the fully resolved render buffer
 * and produces pixels. It does NOT interpret control codes or character
 * sets; it only maps glyphIds to pixel data via the glyph cache.
 *
 * @param renderGrid - The resolved 24x40 RenderGrid
 * @param flashPhase - If true, flashing cells are visible; if false, hidden
 * @param reveal - If true, concealed cells are shown
 * @param cache - Optional glyph cache (uses default if omitted)
 */
export function renderGridToBuffer(
  renderGrid: RenderGrid,
  flashPhase: boolean = true,
  reveal: boolean = false,
  cache?: GlyphCache,
): RenderResult {
  const c = cache ?? getDefaultCache();
  const data = new Uint8ClampedArray(BUFFER_WIDTH * BUFFER_HEIGHT * 4);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = renderGrid[row][col];
      renderCellToPixels(data, row, col, cell, flashPhase, reveal, c);
    }
  }

  return { width: BUFFER_WIDTH, height: BUFFER_HEIGHT, data };
}

/**
 * Convenience: resolve + render in one call.
 * Takes a PageGrid (state machine output) directly.
 */
export function renderToBuffer(
  grid: PageGrid,
  flashPhase: boolean = true,
  reveal: boolean = false,
  cache?: GlyphCache,
): RenderResult {
  const c = cache ?? getDefaultCache();
  const renderGrid = resolveGrid(grid, c);
  return renderGridToBuffer(renderGrid, flashPhase, reveal, c);
}

function renderCellToPixels(
  data: Uint8ClampedArray,
  row: number,
  col: number,
  cell: RenderCell,
  flashPhase: boolean,
  reveal: boolean,
  cache: GlyphCache,
): void {
  const fg = PALETTE[cell.fg];
  const bg = PALETTE[cell.bg];

  // Determine if cell content is visible
  const flashHidden = cell.flash && !flashPhase;
  const concealHidden = cell.conceal && !reveal;
  const hidden = flashHidden || concealHidden;

  // Look up the pre-rendered glyph by ID
  const glyph = hidden ? null : cache.getGlyph(cell.glyphId);

  const baseX = col * CELL_WIDTH;
  const baseY = row * CELL_HEIGHT;

  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      let pixel = 0;

      if (glyph) {
        let glyphY = y;
        if (cell.doubleHeight && !cell.doubleHeightBottom) {
          // Top half: sample from top half of glyph (stretch 2x)
          glyphY = Math.floor(y / 2);
        } else if (cell.doubleHeightBottom) {
          // Bottom half: sample from bottom half of glyph (stretch 2x)
          glyphY = Math.floor(y / 2) + Math.floor(CELL_HEIGHT / 2);
          if (glyphY >= CELL_HEIGHT) glyphY = CELL_HEIGHT - 1;
        }

        pixel = glyph.pixels[glyphY * CELL_WIDTH + x];
      }

      const color = pixel ? fg : bg;
      const idx = ((baseY + y) * BUFFER_WIDTH + (baseX + x)) * 4;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
      data[idx + 3] = 255;
    }
  }
}
