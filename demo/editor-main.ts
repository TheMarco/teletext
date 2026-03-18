/**
 * Teletext Studio — user-friendly editor.
 * No teletext jargon. Users paint, type, pick colors.
 * The editor auto-manages control codes under the hood.
 */

import { createVisualGrid, defaultVisualCell, type VisualCell, type VisualRow } from '../src/editor/visualTypes.js';
import { compileVisualRow, decompileToVisualRow } from '../src/editor/smartRowCompiler.js';
import { processPage } from '../src/state-machine/state-machine.js';
import { renderToBuffer, BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/render-buffer/render-buffer.js';
import { createTimingState, advanceTiming } from '../src/timing-engine/timing-engine.js';
import { compileRow } from '../src/compile/index.js';
import { createCRTOverlay } from '../src/crt/shaderOverlay.js';
import { importTti, exportPageToTti, importT42 } from '../src/tti/index.js';
import { createEmptyPage } from '../src/model/factories.js';
import { rgbaToGrayscale, applyThreshold, pixelsToSextants, fitToRegion, buildFullColorRowTokens } from '../src/import/index.js';
import type { TeletextRow } from '../src/model/types.js';

// ─── State ──────────────────────────────────────────────────────

let grid = createVisualGrid();
let cursorRow = 0, cursorCol = 0;
let activeTool: 'text' | 'paint' | 'fill' | 'erase' | 'picker' | 'select' = 'text';

// Selection state
let selection: { r1: number; c1: number; r2: number; c2: number } | null = null;
let selDragStart: { row: number; col: number } | null = null;
let selMoving = false;
let selMoveOrigin: { row: number; col: number } | null = null;
let selClipboard: VisualCell[][] | null = null;
let activeFg = 7; // white
let activeBg = 0; // black
let activeChar = 0x20;
let activeMosaic = 0x3F; // full block
let isDragging = false;
let timing = createTimingState();

// Undo system
const undoStack: string[] = [];
const redoStack: string[] = [];
function pushUndo() {
  undoStack.push(JSON.stringify(grid));
  redoStack.length = 0;
  if (undoStack.length > 100) undoStack.shift();
}
function doUndo() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify(grid));
  grid = JSON.parse(undoStack.pop()!);
  showFeedback('Undo');
}
function doRedo() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify(grid));
  grid = JSON.parse(redoStack.pop()!);
  showFeedback('Redo');
}

// ─── DOM ────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const toolLabel = document.getElementById('toolLabel')!;
const cursorLabel = document.getElementById('cursorLabel')!;
const fgLabel = document.getElementById('fgLabel')!;
const bgLabel = document.getElementById('bgLabel')!;
const feedback = document.getElementById('feedback')!;

const COLOR_NAMES = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
const COLOR_CSS = ['#000', '#f00', '#0f0', '#ff0', '#00f', '#f0f', '#0ff', '#fff'];

let feedbackTimer: number | null = null;
function showFeedback(msg: string) {
  feedback.textContent = msg;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => feedback.textContent = '', 2500);
}

// ─── Color pickers ──────────────────────────────────────────────

function buildColorPicker(containerId: string, selected: number, onSelect: (c: number) => void) {
  const container = document.getElementById(containerId)!;
  container.innerHTML = '';
  COLOR_CSS.forEach((css, i) => {
    const div = document.createElement('div');
    div.className = 'color-cell' + (i === selected ? ' selected' : '');
    div.style.background = css === '#000' ? '#1a1a1a' : css;
    if (css === '#000') div.style.border = '2px solid #444';
    div.title = COLOR_NAMES[i];
    div.onclick = () => onSelect(i);
    container.appendChild(div);
  });
}

function refreshColorPickers() {
  buildColorPicker('fgColors', activeFg, (c) => { activeFg = c; refreshColorPickers(); fgLabel.textContent = COLOR_NAMES[c]; });
  buildColorPicker('bgColors', activeBg, (c) => { activeBg = c; refreshColorPickers(); bgLabel.textContent = COLOR_NAMES[c]; });
}
refreshColorPickers();

// ─── Glyph picker ───────────────────────────────────────────────

const glyphGrid = document.getElementById('glyphGrid')!;
for (let ch = 0x20; ch <= 0x7E; ch++) {
  const div = document.createElement('div');
  div.className = 'glyph-cell' + (ch === activeChar ? ' active' : '');
  div.textContent = String.fromCharCode(ch);
  div.title = `0x${ch.toString(16)} ${String.fromCharCode(ch)}`;
  div.onclick = () => {
    activeChar = ch;
    document.querySelectorAll('.glyph-cell').forEach(el => el.classList.remove('active'));
    div.classList.add('active');
  };
  glyphGrid.appendChild(div);
}

// ─── Mosaic block picker ────────────────────────────────────────

const mosaicGrid = document.getElementById('mosaicGrid')!;
// All 64 possible mosaic patterns (6-bit: 2×3 sextant grid)
const ALL_MOSAICS: number[] = [];
for (let bits = 0; bits < 64; bits++) {
  ALL_MOSAICS.push(bits <= 0x1F ? 0x20 + bits : 0x60 + (bits & 0x1F));
}
ALL_MOSAICS.forEach(code => {
  const div = document.createElement('div');
  div.className = 'mosaic-cell';
  div.title = `Mosaic 0x${code.toString(16)}`;
  // Draw the sextant pattern
  const c = document.createElement('canvas');
  c.width = 2; c.height = 3;
  const mctx = c.getContext('2d')!;
  let bits: number;
  if (code >= 0x20 && code <= 0x3F) bits = code - 0x20;
  else if (code >= 0x60 && code <= 0x7F) bits = (code - 0x60) | 0x20;
  else bits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      mctx.fillStyle = ((bits >> (sy * 2 + sx)) & 1) ? '#fff' : '#333';
      mctx.fillRect(sx, sy, 1, 1);
    }
  }
  div.appendChild(c);
  div.onclick = () => {
    activeMosaic = code;
    document.querySelectorAll('.mosaic-cell').forEach(el => el.classList.remove('active'));
    div.classList.add('active');
    showFeedback('Mosaic block selected');
  };
  // Default: select the full block (0x3F)
  if (code === 0x3F) div.classList.add('active');
  mosaicGrid.appendChild(div);
});

// ─── Tool selection ─────────────────────────────────────────────

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTool = (btn as HTMLElement).dataset.tool as typeof activeTool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    toolLabel.textContent = (btn as HTMLElement).textContent?.trim() || activeTool;
  });
});

// ─── Canvas interaction ─────────────────────────────────────────

function canvasToCell(e: MouseEvent): { row: number; col: number; sx: number; sy: number } {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width * BUFFER_WIDTH;
  const py = (e.clientY - rect.top) / rect.height * BUFFER_HEIGHT;
  const col = Math.floor(px / 12);
  const row = Math.floor(py / 10);
  const cellPx = px - col * 12;
  const cellPy = py - row * 10;
  return { row: Math.min(23, Math.max(0, row)), col: Math.min(39, Math.max(0, col)), sx: cellPx < 6 ? 0 : 1, sy: cellPy < 3.33 ? 0 : cellPy < 6.66 ? 1 : 2 };
}

function applyTool(row: number, col: number, sx: number, sy: number, isRightClick: boolean) {
  if (row < 0 || row >= 24 || col < 0 || col >= 40) return;
  const cell = grid[row][col];

  switch (activeTool) {
    case 'text':
      // Text tool: just set cursor position — typing happens on keydown
      cursorRow = row; cursorCol = col;
      break;

    case 'paint':
      // Paint mosaic: stamp the selected mosaic block
      if (isRightClick) {
        // Erase: clear to empty mosaic
        cell.char = 0x20;
        cell.mosaic = true;
        cell.fg = activeFg;
        cell.bg = activeBg;
      } else {
        // Stamp the active mosaic character
        cell.char = activeMosaic;
        cell.mosaic = true;
        cell.fg = activeFg;
        cell.bg = activeBg;
      }
      break;

    case 'fill':
      // Fill: set the cell's colors
      cell.fg = activeFg;
      cell.bg = activeBg;
      break;

    case 'erase':
      grid[row][col] = defaultVisualCell();
      break;

    case 'picker':
      // Pick the clicked cell's colors
      activeFg = cell.fg;
      activeBg = cell.bg;
      refreshColorPickers();
      fgLabel.textContent = COLOR_NAMES[activeFg];
      bgLabel.textContent = COLOR_NAMES[activeBg];
      showFeedback(`Picked ${COLOR_NAMES[cell.fg]} on ${COLOR_NAMES[cell.bg]}`);
      break;

    case 'select':
      // Handled in mousedown/mousemove/mouseup below
      break;
  }

  cursorRow = row; cursorCol = col;
  cursorLabel.textContent = `${row}, ${col}`;
}

function mosaicBits(cell: VisualCell): number {
  if (!cell.mosaic) return 0;
  const ch = cell.char;
  if (ch >= 0x20 && ch <= 0x3F) return ch - 0x20;
  if (ch >= 0x60 && ch <= 0x7F) return (ch - 0x60) | 0x20;
  return 0;
}

function bitsToMosaic(bits: number): number {
  if (bits <= 0x1F) return 0x20 + bits;
  return 0x60 + (bits & 0x1F);
}

canvas.addEventListener('mousedown', (e) => {
  const { row, col, sx, sy } = canvasToCell(e);

  if (activeTool === 'select') {
    // Check if clicking inside existing selection → start move
    if (selection && row >= selection.r1 && row <= selection.r2 && col >= selection.c1 && col <= selection.c2) {
      selMoving = true;
      selMoveOrigin = { row, col };
      // Copy selection content
      selClipboard = [];
      for (let r = selection.r1; r <= selection.r2; r++) {
        const rowCells: VisualCell[] = [];
        for (let c = selection.c1; c <= selection.c2; c++) {
          rowCells.push({ ...grid[r][c] });
        }
        selClipboard.push(rowCells);
      }
      pushUndo();
    } else {
      // Start new selection
      selDragStart = { row, col };
      selection = { r1: row, c1: col, r2: row, c2: col };
      selMoving = false;
    }
    isDragging = true;
    return;
  }

  if (activeTool !== 'text') pushUndo();
  isDragging = true;
  applyTool(row, col, sx, sy, e.button === 2);
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const { row, col, sx, sy } = canvasToCell(e);

  if (activeTool === 'select') {
    if (selMoving && selMoveOrigin && selection && selClipboard) {
      // Move the selection
      const dr = row - selMoveOrigin.row;
      const dc = col - selMoveOrigin.col;
      if (dr === 0 && dc === 0) return;

      // Clear old position
      for (let r = selection.r1; r <= selection.r2; r++) {
        for (let c = selection.c1; c <= selection.c2; c++) {
          if (r >= 0 && r < 24 && c >= 0 && c < 40) grid[r][c] = defaultVisualCell();
        }
      }

      // Move selection bounds
      const h = selection.r2 - selection.r1;
      const w = selection.c2 - selection.c1;
      selection.r1 = Math.max(0, Math.min(23 - h, selection.r1 + dr));
      selection.c1 = Math.max(0, Math.min(39 - w, selection.c1 + dc));
      selection.r2 = selection.r1 + h;
      selection.c2 = selection.c1 + w;

      // Place at new position
      for (let r = 0; r < selClipboard.length; r++) {
        for (let c = 0; c < selClipboard[r].length; c++) {
          const tr = selection.r1 + r;
          const tc = selection.c1 + c;
          if (tr >= 0 && tr < 24 && tc >= 0 && tc < 40) {
            grid[tr][tc] = { ...selClipboard[r][c] };
          }
        }
      }

      selMoveOrigin = { row, col };
    } else if (selDragStart) {
      // Extend selection rectangle
      selection = {
        r1: Math.min(selDragStart.row, row),
        c1: Math.min(selDragStart.col, col),
        r2: Math.max(selDragStart.row, row),
        c2: Math.max(selDragStart.col, col),
      };
    }
    return;
  }

  applyTool(row, col, sx, sy, e.buttons === 2);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  selDragStart = null;
  selMoving = false;
  selMoveOrigin = null;
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  pushUndo();
  isDragging = true;
  const { row, col, sx, sy } = canvasToCell(e);
  applyTool(row, col, sx, sy, true);
});

// ─── Keyboard (text typing) ────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Undo/redo
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); doRedo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); doUndo(); return; }

  // Delete selection
  if (e.key === 'Delete' && selection && activeTool === 'select') {
    pushUndo();
    for (let r = selection.r1; r <= selection.r2; r++) {
      for (let c = selection.c1; c <= selection.c2; c++) {
        if (r >= 0 && r < 24 && c >= 0 && c < 40) grid[r][c] = defaultVisualCell();
      }
    }
    showFeedback('Selection deleted');
    selection = null;
    return;
  }

  // Escape clears selection
  if (e.key === 'Escape') { selection = null; return; }

  // Navigation
  if (e.key === 'ArrowRight') { cursorCol = Math.min(39, cursorCol + 1); cursorLabel.textContent = `${cursorRow}, ${cursorCol}`; return; }
  if (e.key === 'ArrowLeft') { cursorCol = Math.max(0, cursorCol - 1); cursorLabel.textContent = `${cursorRow}, ${cursorCol}`; return; }
  if (e.key === 'ArrowDown') { cursorRow = Math.min(23, cursorRow + 1); cursorLabel.textContent = `${cursorRow}, ${cursorCol}`; return; }
  if (e.key === 'ArrowUp') { cursorRow = Math.max(0, cursorRow - 1); cursorLabel.textContent = `${cursorRow}, ${cursorCol}`; return; }
  if (e.key === 'Enter') { cursorRow = Math.min(23, cursorRow + 1); cursorCol = 0; cursorLabel.textContent = `${cursorRow}, ${cursorCol}`; return; }

  // Color shortcuts: 1-8 fg, shift+1-8 bg
  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '8') {
    const idx = parseInt(e.key) - 1;
    if (e.shiftKey) { activeBg = idx; bgLabel.textContent = COLOR_NAMES[idx]; }
    else { activeFg = idx; fgLabel.textContent = COLOR_NAMES[idx]; }
    refreshColorPickers();
    return;
  }

  // Typing in text mode
  if (activeTool === 'text' && !e.metaKey && !e.ctrlKey) {
    if (e.key === 'Backspace') {
      cursorCol = Math.max(0, cursorCol - 1);
      pushUndo();
      grid[cursorRow][cursorCol] = { char: 0x20, fg: activeFg, bg: activeBg, mosaic: false, contiguous: true };
      cursorLabel.textContent = `${cursorRow}, ${cursorCol}`;
      return;
    }
    if (e.key === 'Delete') {
      pushUndo();
      grid[cursorRow][cursorCol] = { char: 0x20, fg: activeFg, bg: activeBg, mosaic: false, contiguous: true };
      return;
    }
    if (e.key.length === 1 && e.key.charCodeAt(0) >= 0x20 && e.key.charCodeAt(0) <= 0x7E) {
      pushUndo();
      grid[cursorRow][cursorCol] = { char: e.key.charCodeAt(0), fg: activeFg, bg: activeBg, mosaic: false, contiguous: true };
      cursorCol = Math.min(39, cursorCol + 1);
      cursorLabel.textContent = `${cursorRow}, ${cursorCol}`;
      return;
    }
  }

  // Paint mode: space places mosaic block
  if (activeTool === 'paint' && e.key === ' ') {
    pushUndo();
    grid[cursorRow][cursorCol] = { char: activeMosaic, fg: activeFg, bg: activeBg, mosaic: true, contiguous: true };
    cursorCol = Math.min(39, cursorCol + 1);
    return;
  }
});

// ─── Toolbar buttons ────────────────────────────────────────────

document.getElementById('btnUndo')!.onclick = () => doUndo();
document.getElementById('btnRedo')!.onclick = () => doRedo();

let crtOverlay: HTMLCanvasElement | null = null;
document.getElementById('btnCRT')!.onclick = (e) => {
  if (crtOverlay) { crtOverlay.remove(); crtOverlay = null; (e.target as HTMLElement).classList.remove('active'); }
  else { crtOverlay = createCRTOverlay(canvas); (e.target as HTMLElement).classList.add('active'); }
};

// ─── Export ─────────────────────────────────────────────────────

document.getElementById('btnExport')!.onclick = () => {
  const page = createEmptyPage(0x100);
  for (let r = 0; r < 24; r++) {
    const result = compileVisualRow(grid[r]);
    page.subpages[0].rows[r] = { index: r, tokens: result.tokens };
  }
  const tti = exportPageToTti(page);
  const blob = new Blob([tti], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'page.tti'; a.click();
  URL.revokeObjectURL(url);
  showFeedback('Exported as TTI');
};

// ─── Import TTI ─────────────────────────────────────────────────

document.getElementById('btnImportTTI')!.onclick = () => (document.getElementById('fileTTI') as HTMLInputElement).click();
(document.getElementById('fileTTI') as HTMLInputElement).onchange = function() {
  const file = (this as HTMLInputElement).files?.[0];
  if (!file) return;
  (this as HTMLInputElement).value = '';
  file.text().then(text => {
    const svc = importTti(text);
    if (svc.pages.length > 0) {
      const sp = svc.pages[0].subpages[0];
      pushUndo();
      for (let r = 0; r < 24; r++) {
        const compiled = compileRow(sp.rows[r]);
        grid[r] = decompileToVisualRow(Array.from(compiled.bytes40));
      }
      showFeedback(`Imported ${svc.pages.length} page(s)`);
    }
  });
};

// ─── Import T42 ─────────────────────────────────────────────────

document.getElementById('btnImportT42')!.onclick = () => (document.getElementById('fileT42') as HTMLInputElement).click();
(document.getElementById('fileT42') as HTMLInputElement).onchange = function() {
  const file = (this as HTMLInputElement).files?.[0];
  if (!file) return;
  (this as HTMLInputElement).value = '';
  file.arrayBuffer().then(buf => {
    const result = importT42(new Uint8Array(buf));
    if (result.pages.length > 0) {
      const sp = result.pages[0].subpages[0];
      pushUndo();
      for (let r = 0; r < 24; r++) {
        const compiled = compileRow(sp.rows[r]);
        grid[r] = decompileToVisualRow(Array.from(compiled.bytes40));
      }
      showFeedback(`Imported ${result.pages.length} page(s) from T42`);
    }
  });
};

// ─── Import Bitmap ──────────────────────────────────────────────

const bmpDialog = document.getElementById('bmpDialog')!;
const bmpSrcCanvas = document.getElementById('bmpSrc') as HTMLCanvasElement;
const bmpPreviewCanvas = document.getElementById('bmpPreview') as HTMLCanvasElement;
let bmpImage: HTMLImageElement | null = null;

document.getElementById('btnImportBitmap')!.onclick = () => (document.getElementById('fileBitmap') as HTMLInputElement).click();
(document.getElementById('fileBitmap') as HTMLInputElement).onchange = function() {
  const file = (this as HTMLInputElement).files?.[0];
  if (!file) return;
  (this as HTMLInputElement).value = ''; // reset so same file can be re-selected
  bmpImage = new Image();
  bmpImage.onload = () => {
    // Show source preview
    bmpSrcCanvas.width = bmpImage!.width;
    bmpSrcCanvas.height = bmpImage!.height;
    bmpSrcCanvas.getContext('2d')!.drawImage(bmpImage!, 0, 0);
    updateBmpPreview();
    bmpDialog.style.display = 'flex';
  };
  bmpImage.src = URL.createObjectURL(file);
};

function updateBmpPreview() {
  if (!bmpImage) return;
  const maxCols = parseInt((document.getElementById('bmpCols') as HTMLInputElement).value) || 39;
  const maxRows = parseInt((document.getElementById('bmpRows') as HTMLInputElement).value) || 22;
  const dstW = maxCols * 2, dstH = maxRows * 3;
  bmpPreviewCanvas.width = dstW;
  bmpPreviewCanvas.height = dstH;
  const pctx = bmpPreviewCanvas.getContext('2d')!;
  pctx.drawImage(bmpImage, 0, 0, dstW, dstH);
}

['bmpCols', 'bmpRows', 'bmpRow', 'bmpCol', 'bmpBg'].forEach(id => {
  document.getElementById(id)!.addEventListener('change', updateBmpPreview);
  document.getElementById(id)!.addEventListener('input', updateBmpPreview);
});

document.getElementById('bmpCancel')!.onclick = () => { bmpDialog.style.display = 'none'; bmpImage = null; };

document.getElementById('bmpApply')!.onclick = () => {
  if (!bmpImage) return;
  const startRow = parseInt((document.getElementById('bmpRow') as HTMLInputElement).value) || 2;
  const startCol = parseInt((document.getElementById('bmpCol') as HTMLInputElement).value) || 0;
  const maxCols = parseInt((document.getElementById('bmpCols') as HTMLInputElement).value) || 39;
  const maxRows = parseInt((document.getElementById('bmpRows') as HTMLInputElement).value) || 22;
  const bgColor = parseInt((document.getElementById('bmpBg') as HTMLSelectElement).value) || 0;

  pushUndo();
  const dstW = maxCols * 2, dstH = maxRows * 3;
  const tmpCanvas = new OffscreenCanvas(bmpImage.width, bmpImage.height);
  tmpCanvas.getContext('2d')!.drawImage(bmpImage, 0, 0);
  const fitCanvas = new OffscreenCanvas(dstW, dstH);
  fitCanvas.getContext('2d')!.drawImage(tmpCanvas, 0, 0, dstW, dstH);
  const fittedRGBA = new Uint8Array(fitCanvas.getContext('2d')!.getImageData(0, 0, dstW, dstH).data);

  const cellRows = Math.floor(dstH / 3);
  const cellCols = Math.floor(dstW / 2);

  for (let cr = 0; cr < cellRows && (startRow + cr) < 24; cr++) {
    const rowTokens = buildFullColorRowTokens(fittedRGBA, dstW, dstH, cr, cellCols, startCol, bgColor as any, true);
    const compiled = compileRow({ index: startRow + cr, tokens: rowTokens });
    grid[startRow + cr] = decompileToVisualRow(Array.from(compiled.bytes40));
  }

  bmpDialog.style.display = 'none';
  bmpImage = null;
  showFeedback(`Imported as ${cellCols}×${cellRows} mosaic`);
};

// ─── Render ─────────────────────────────────────────────────────

function compileAndRender() {
  // Compile each visual row into tokens, then into raw bytes
  const rawRows: number[][] = [];
  for (let r = 0; r < 24; r++) {
    const result = compileVisualRow(grid[r]);
    const row: TeletextRow = { index: r, tokens: result.tokens };
    const compiled = compileRow(row);
    rawRows.push(Array.from(compiled.bytes40));
  }

  const pageGrid = processPage(rawRows);
  const result = renderToBuffer(pageGrid, timing.flashPhase, false);

  const imageData = ctx.createImageData(BUFFER_WIDTH, BUFFER_HEIGHT);
  imageData.data.set(result.data);

  const offscreen = new OffscreenCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

  const cellW = canvas.width / 40;
  const cellH = canvas.height / 24;

  // Selection rectangle
  if (selection) {
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      selection.c1 * cellW, selection.r1 * cellH,
      (selection.c2 - selection.c1 + 1) * cellW,
      (selection.r2 - selection.r1 + 1) * cellH,
    );
    ctx.setLineDash([]);
    // Dim area outside selection
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, canvas.width, selection.r1 * cellH); // top
    ctx.fillRect(0, (selection.r2 + 1) * cellH, canvas.width, canvas.height); // bottom
    ctx.fillRect(0, selection.r1 * cellH, selection.c1 * cellW, (selection.r2 - selection.r1 + 1) * cellH); // left
    ctx.fillRect((selection.c2 + 1) * cellW, selection.r1 * cellH, canvas.width, (selection.r2 - selection.r1 + 1) * cellH); // right
  }

  // Cursor
  ctx.strokeStyle = activeTool === 'paint' ? '#0f0' : activeTool === 'select' ? '#0ff' : '#ff0';
  ctx.lineWidth = 2;
  ctx.strokeRect(cursorCol * cellW, cursorRow * cellH, cellW, cellH);
}

let lastTime = 0;
function frame(time: number) {
  const delta = lastTime ? time - lastTime : 0;
  lastTime = time;
  timing = advanceTiming(timing, delta);
  compileAndRender();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
