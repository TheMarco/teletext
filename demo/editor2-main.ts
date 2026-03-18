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
import type { TeletextRow } from '../src/model/types.js';

// ─── State ──────────────────────────────────────────────────────

let grid = createVisualGrid();
let cursorRow = 0, cursorCol = 0;
let activeTool: 'text' | 'paint' | 'fill' | 'erase' | 'picker' = 'text';
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
const MOSAIC_EXAMPLES = [0x20, 0x21, 0x22, 0x23, 0x24, 0x28, 0x30, 0x3F, 0x60, 0x61, 0x62, 0x64, 0x68, 0x70, 0x7E, 0x7F];
MOSAIC_EXAMPLES.forEach(code => {
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
  div.onclick = () => { activeMosaic = code; showFeedback('Mosaic block selected'); };
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
      // Paint mosaic: set the sextant bit
      if (isRightClick) {
        // Erase sextant bit
        let bits = mosaicBits(cell);
        bits &= ~(1 << (sy * 2 + sx));
        cell.char = bitsToMosaic(bits);
        cell.mosaic = true;
        cell.fg = activeFg;
        cell.bg = activeBg;
      } else {
        // Set sextant bit
        let bits = mosaicBits(cell);
        bits |= (1 << (sy * 2 + sx));
        cell.char = bitsToMosaic(bits);
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
  if (activeTool !== 'text') pushUndo();
  isDragging = true;
  const { row, col, sx, sy } = canvasToCell(e);
  applyTool(row, col, sx, sy, e.button === 2);
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const { row, col, sx, sy } = canvasToCell(e);
  applyTool(row, col, sx, sy, e.buttons === 2);
});

window.addEventListener('mouseup', () => isDragging = false);
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

document.getElementById('btnExport')!.onclick = () => {
  // Compile all rows and export as TTI
  const { exportPageToTti } = require('../src/tti/ttiExporter.js');
  // ... TODO: proper export
  showFeedback('Export not yet wired');
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

  // Cursor
  const cellW = canvas.width / 40;
  const cellH = canvas.height / 24;
  ctx.strokeStyle = activeTool === 'paint' ? '#0f0' : '#ff0';
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
