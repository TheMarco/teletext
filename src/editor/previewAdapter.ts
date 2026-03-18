/**
 * Preview adapter: bridges the editor page model to the existing CRT renderer.
 *
 * Compiles the active subpage into raw 24×40 byte arrays that the
 * existing state machine + render buffer can consume directly.
 */

import type { TeletextSubpage } from '../model/types.js';
import { compileRow } from '../compile/rowCompiler.js';
import { processPage } from '../state-machine/state-machine.js';
import { renderToBuffer } from '../render-buffer/render-buffer.js';
import type { RenderResult } from '../render-buffer/render-buffer.js';
import type { PageGrid } from '../state-machine/types.js';

/**
 * Convert a subpage to raw 24×40 byte arrays for the renderer.
 */
export function subpageToRawRows(subpage: TeletextSubpage): number[][] {
  const rows: number[][] = [];
  for (const row of subpage.rows) {
    const compiled = compileRow(row);
    rows.push(Array.from(compiled.bytes40));
  }
  return rows;
}

/**
 * Convert a subpage to the renderer's cell grid (PageGrid).
 */
export function subpageToGrid(subpage: TeletextSubpage): PageGrid {
  const rawRows = subpageToRawRows(subpage);
  return processPage(rawRows);
}

/**
 * Render a subpage to an RGBA pixel buffer using the existing CRT renderer.
 */
export function renderSubpage(
  subpage: TeletextSubpage,
  flashPhase: boolean = true,
  reveal: boolean = false,
): RenderResult {
  const rawRows = subpageToRawRows(subpage);
  const grid = processPage(rawRows);
  return renderToBuffer(grid, flashPhase, reveal);
}

/**
 * Quick check: compile and render without errors.
 * Returns diagnostics if any compilation issues found.
 */
export function previewCheck(subpage: TeletextSubpage): {
  result: RenderResult;
  compiledBytes: number[][];
} {
  const rawRows = subpageToRawRows(subpage);
  const grid = processPage(rawRows);
  const result = renderToBuffer(grid, true, false);
  return { result, compiledBytes: rawRows };
}
