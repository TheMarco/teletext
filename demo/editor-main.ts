/**
 * Teletext Studio — user-friendly editor.
 * No teletext jargon. Users paint, type, pick colors.
 * The editor auto-manages control codes under the hood.
 */

import { createVisualGrid, defaultVisualCell, defaultRowMeta, type VisualCell, type VisualRow, type VisualGrid, type RowMeta } from '../src/editor/visualTypes.js';
import { compileVisualRow, decompileToVisualRow } from '../src/editor/smartRowCompiler.js';
import { BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/render-buffer/render-buffer.js';
import { createTimingState, advanceTiming } from '../src/timing-engine/timing-engine.js';
import { compileRow } from '../src/compile/index.js';
import { createCRTOverlay } from '../src/crt/shaderOverlay.js';
import { getG0Glyph } from '../src/glyph-system/font-g0.js';
import { importT42, exportServiceToT42 } from '../src/tti/index.js';
import { createEmptyPage } from '../src/model/factories.js';
import { rgbaToGrayscale, applyThreshold, pixelsToSextants, fitToRegion, buildFullColorRowTokens } from '../src/import/index.js';
import type { TeletextRow } from '../src/model/types.js';

// ─── State ──────────────────────────────────────────────────────

let vgrid = createVisualGrid();
let grid = vgrid.rows; // alias for convenience
let rowMeta = vgrid.rowMeta;
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
// activeMosaic removed — paint mode now works per sub-block
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

// ─── Tool selection ─────────────────────────────────────────────

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTool = (btn as HTMLElement).dataset.tool as typeof activeTool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    toolLabel.textContent = (btn as HTMLElement).textContent?.trim() || activeTool;
    // Clear selection when switching away from select tool
    if (activeTool !== 'select') selection = null;
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
      // Paint mosaic: set individual sextant sub-block
      if (isRightClick) {
        // Clear this sub-block
        let bits = mosaicBits(cell);
        bits &= ~(1 << (sy * 2 + sx));
        cell.char = bits === 0 ? 0x20 : bitsToMosaic(bits);
        cell.mosaic = bits > 0;
        cell.fg = bits > 0 ? cell.fg : activeFg;
        cell.bg = activeBg;
      } else {
        // Keep existing bits, add the new sub-block, change color
        let bits = cell.mosaic ? mosaicBits(cell) : 0;
        bits |= (1 << (sy * 2 + sx));
        cell.char = bitsToMosaic(bits);
        cell.mosaic = true;
        cell.fg = activeFg;
        cell.bg = activeBg;
      }
      break;

    case 'fill': {
      // Flood fill recolor: change fg/bg of all connected same-colored cells
      // Matches on fg + bg + whether cell has visible content (non-space)
      const tFg = cell.fg, tBg = cell.bg;
      const tHasContent = cell.char !== 0x20 || cell.mosaic;
      if (tFg === activeFg && tBg === activeBg) break;
      const vis = new Set<string>();
      const stk: [number, number][] = [[row, col]];
      while (stk.length > 0) {
        const [r, c] = stk.pop()!;
        const k = `${r},${c}`;
        if (vis.has(k) || r < 0 || r >= 24 || c < 0 || c >= 40) continue;
        const t = grid[r][c];
        const hasContent = t.char !== 0x20 || t.mosaic;
        if (t.fg !== tFg || t.bg !== tBg || hasContent !== tHasContent) continue;
        vis.add(k);
        grid[r][c] = { ...t, fg: activeFg, bg: activeBg };
        stk.push([r-1,c],[r+1,c],[r,c-1],[r,c+1]);
      }
      break;
    }

    case 'erase':
      // Erase to black space — use default state colors so no control codes are needed
      grid[row][col] = { char: 0x20, fg: 7, bg: 0, mosaic: false, contiguous: true };
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

// ─── Keyboard ───────────────────────────────────────────────────

// Batch undo: only push undo state when typing starts, not on every keystroke
let typingUndoPushed = false;
function ensureTypingUndo() {
  if (!typingUndoPushed) { pushUndo(); typingUndoPushed = true; }
}
// Reset typing batch after a pause
let typingTimer: number | null = null;
function resetTypingBatch() {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => { typingUndoPushed = false; }, 1000);
}

function updateCursorDisplay() {
  cursorLabel.textContent = `${cursorRow}, ${cursorCol}`;
}

document.addEventListener('keydown', (e) => {
  // Ignore if focus is in an input/select
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  // ─── Global shortcuts (always active) ───
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); doRedo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); doUndo(); return; }

  // Escape clears selection
  if (e.key === 'Escape') { selection = null; return; }

  // Delete selection
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection && activeTool === 'select') {
    e.preventDefault();
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

  // ─── Navigation (all tools) ───
  if (e.key === 'ArrowRight') { e.preventDefault(); cursorCol = Math.min(39, cursorCol + 1); updateCursorDisplay(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); cursorCol = Math.max(0, cursorCol - 1); updateCursorDisplay(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); cursorRow = Math.min(23, cursorRow + 1); updateCursorDisplay(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); cursorRow = Math.max(0, cursorRow - 1); updateCursorDisplay(); return; }

  // ─── Text tool input ───
  if (activeTool === 'text' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'Enter') {
      e.preventDefault();
      typingUndoPushed = false; // new line = new undo batch
      cursorRow = Math.min(23, cursorRow + 1);
      cursorCol = 0;
      updateCursorDisplay();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (cursorCol > 0) {
        cursorCol--;
        ensureTypingUndo(); resetTypingBatch();
        grid[cursorRow][cursorCol] = { char: 0x20, fg: activeFg, bg: activeBg, mosaic: false, contiguous: true };
        updateCursorDisplay();
      }
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      ensureTypingUndo(); resetTypingBatch();
      grid[cursorRow][cursorCol] = { char: 0x20, fg: activeFg, bg: activeBg, mosaic: false, contiguous: true };
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      cursorCol = Math.min(39, cursorCol + 4 - (cursorCol % 4));
      updateCursorDisplay();
      return;
    }
    // Printable character — e.key already reflects shift state
    if (e.key.length === 1) {
      const code = e.key.charCodeAt(0);
      if (code >= 0x20 && code <= 0x7E) {
        e.preventDefault();
        ensureTypingUndo(); resetTypingBatch();
        grid[cursorRow][cursorCol] = { char: code, fg: activeFg, bg: activeBg, mosaic: false, contiguous: true };
        cursorCol = Math.min(39, cursorCol + 1);
        updateCursorDisplay();
        return;
      }
    }
  }

  // ─── Color shortcuts (NOT in text mode — text mode types normally) ───
  if (activeTool !== 'text' && !e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '8') {
    const idx = parseInt(e.key) - 1;
    if (e.shiftKey) { activeBg = idx; bgLabel.textContent = COLOR_NAMES[idx]; }
    else { activeFg = idx; fgLabel.textContent = COLOR_NAMES[idx]; }
    refreshColorPickers();
    return;
  }

  // ─── Paint tool: space places mosaic block ───
  if (activeTool === 'paint' && e.key === ' ') {
    e.preventDefault();
    pushUndo();
    grid[cursorRow][cursorCol] = { char: 0x7F, fg: activeFg, bg: activeBg, mosaic: true, contiguous: true }; // full block
    cursorCol = Math.min(39, cursorCol + 1);
    updateCursorDisplay();
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

// ─── Double Height ──────────────────────────────────────────────

document.getElementById('btnDoubleHeight')!.onclick = () => {
  pushUndo();
  rowMeta[cursorRow].doubleHeight = !rowMeta[cursorRow].doubleHeight;
  const btn = document.getElementById('btnDoubleHeight')!;
  if (rowMeta[cursorRow].doubleHeight) {
    btn.classList.add('active');
    // The row below becomes the bottom half — clear it
    if (cursorRow < 23) {
      rowMeta[cursorRow + 1].doubleHeight = false;
    }
    showFeedback(`Row ${cursorRow}: double height ON`);
  } else {
    btn.classList.remove('active');
    showFeedback(`Row ${cursorRow}: double height OFF`);
  }
};

// ─── Pages / Subpages ───────────────────────────────────────────

// Multi-page support: store pages as an array of grids
let pages: { grid: VisualRow[]; id: number; subgrids: VisualRow[][]; subMetas: RowMeta[][]; activeSubpage: number; fastext: [string,string,string,string] }[] = [
  { grid, id: 0x100, subgrids: [grid], subMetas: [rowMeta], activeSubpage: 0, fastext: ['','','',''] },
];
let activePageIdx = 0;

function formatPn(id: number): string {
  return 'P' + id.toString(16).toUpperCase().padStart(3, '0');
}

function updatePageList() {
  // Sort pages by id
  const sortedIndices = pages.map((_, i) => i).sort((a, b) => pages[a].id - pages[b].id);

  const list = document.getElementById('pageList')!;
  list.innerHTML = '';
  sortedIndices.forEach(i => {
    const p = pages[i];
    const li = document.createElement('li');
    li.textContent = formatPn(p.id);
    if (i === activePageIdx) li.classList.add('active');

    // Single click: switch to page
    li.onclick = () => { switchToPage(i); };

    // Double click: rename page number
    li.ondblclick = (e) => {
      e.stopPropagation();
      const input = prompt(`Rename ${formatPn(p.id)} to (hex, e.g. 100-8FF):`, p.id.toString(16).toUpperCase());
      if (!input) return;
      const newId = parseInt(input, 16);
      if (isNaN(newId) || newId < 0x100 || newId > 0x8FF) {
        alert('Invalid page number. Must be 100-8FF (hex).');
        return;
      }
      if (pages.some((other, idx) => idx !== i && other.id === newId)) {
        alert(`Page ${formatPn(newId)} already exists.`);
        return;
      }
      p.id = newId;
      updatePageList();
      showFeedback(`Renamed to ${formatPn(newId)}`);
    };

    list.appendChild(li);
  });
  (document.getElementById('pageLabel') as HTMLElement).textContent = formatPn(pages[activePageIdx].id);
}

function promptPageNumber(defaultId: number): number | null {
  const input = prompt(`Page number (hex, 100-8FF):`, defaultId.toString(16).toUpperCase());
  if (!input) return null;
  const id = parseInt(input, 16);
  if (isNaN(id) || id < 0x100 || id > 0x8FF) {
    alert('Invalid page number. Must be 100-8FF (hex).');
    return null;
  }
  if (pages.some(p => p.id === id)) {
    alert(`Page ${formatPn(id)} already exists.`);
    return null;
  }
  return id;
}

function switchToPage(idx: number) {
  saveCurrentPage();
  activePageIdx = idx;
  const p = pages[idx];
  grid = p.subgrids[p.activeSubpage];
  rowMeta = p.subMetas[p.activeSubpage] ?? Array.from({length:24}, () => defaultRowMeta());
  p.grid = grid;
  updatePageList();
  updateSubLabel();
  loadFastext();
  showFeedback(`Switched to P${p.id.toString(16).toUpperCase()}`);
}

function nextPageId(): number {
  const maxId = Math.max(...pages.map(p => p.id));
  return maxId + 1;
}

function saveCurrentPage() {
  pages[activePageIdx].grid = grid;
  pages[activePageIdx].subgrids[pages[activePageIdx].activeSubpage] = grid;
  pages[activePageIdx].subMetas[pages[activePageIdx].activeSubpage] = rowMeta;
}

// ─── Page: Insert Before ────────────────────────────────────────
document.getElementById('btnInsertBefore')!.onclick = () => {
  const suggest = Math.max(0x100, pages[activePageIdx].id - 1);
  const newId = promptPageNumber(suggest);
  if (newId === null) return;
  saveCurrentPage();
  const vg = createVisualGrid();
  pages.splice(activePageIdx, 0, { grid: vg.rows, id: newId, subgrids: [vg.rows], subMetas: [vg.rowMeta], activeSubpage: 0 });
  grid = vg.rows; rowMeta = vg.rowMeta;
  updatePageList();
  showFeedback(`Inserted ${formatPn(newId)}`);
};

// ─── Page: Insert After ─────────────────────────────────────────
document.getElementById('btnInsertAfter')!.onclick = () => {
  const suggest = pages[activePageIdx].id + 1;
  const newId = promptPageNumber(Math.min(0x8FF, suggest));
  if (newId === null) return;
  saveCurrentPage();
  const vg = createVisualGrid();
  pages.splice(activePageIdx + 1, 0, { grid: vg.rows, id: newId, subgrids: [vg.rows], subMetas: [vg.rowMeta], activeSubpage: 0 });
  activePageIdx++;
  grid = vg.rows; rowMeta = vg.rowMeta;
  updatePageList();
  showFeedback(`Inserted ${formatPn(newId)}`);
};

// ─── Page: Duplicate ────────────────────────────────────────────
document.getElementById('btnDupPage')!.onclick = () => {
  const suggest = pages[activePageIdx].id + 1;
  const newId = promptPageNumber(Math.min(0x8FF, suggest));
  if (newId === null) return;
  saveCurrentPage();
  const dupGrid = JSON.parse(JSON.stringify(grid)) as VisualRow[];
  const dupMeta = JSON.parse(JSON.stringify(rowMeta)) as RowMeta[];
  const dupSubgrids = pages[activePageIdx].subgrids.map((sg: VisualRow[]) => JSON.parse(JSON.stringify(sg)));
  const dupSubMetas = pages[activePageIdx].subMetas.map((sm: RowMeta[]) => JSON.parse(JSON.stringify(sm)));
  pages.splice(activePageIdx + 1, 0, { grid: dupGrid, id: newId, subgrids: dupSubgrids, subMetas: dupSubMetas, activeSubpage: 0 });
  activePageIdx++;
  grid = dupGrid;
  updatePageList();
  showFeedback(`Duplicated as ${formatPn(newId)}`);
};

// ─── Page: Delete ───────────────────────────────────────────────
document.getElementById('btnDelPage')!.onclick = () => {
  if (pages.length <= 1) { showFeedback('Cannot delete last page'); return; }
  pushUndo();
  pages.splice(activePageIdx, 1);
  activePageIdx = Math.min(activePageIdx, pages.length - 1);
  grid = pages[activePageIdx].subgrids[pages[activePageIdx].activeSubpage];
  updatePageList();
  updateSubLabel();
  showFeedback('Page deleted');
};

// ─── Subpage management ─────────────────────────────────────────

function updateSubLabel() {
  const p = pages[activePageIdx];
  (document.getElementById('subLabel') as HTMLElement).textContent = `${p.activeSubpage + 1}/${p.subgrids.length}`;
}

document.getElementById('btnPrevSub')!.onclick = () => {
  const p = pages[activePageIdx];
  if (p.activeSubpage <= 0) return;
  saveCurrentPage();
  p.activeSubpage--;
  grid = p.subgrids[p.activeSubpage];
  rowMeta = p.subMetas[p.activeSubpage] ?? Array.from({length:24}, () => defaultRowMeta());
  p.grid = grid;
  updateSubLabel();
  showFeedback(`Subpage ${p.activeSubpage + 1}/${p.subgrids.length}`);
};

document.getElementById('btnNextSub')!.onclick = () => {
  const p = pages[activePageIdx];
  if (p.activeSubpage >= p.subgrids.length - 1) return;
  saveCurrentPage();
  p.activeSubpage++;
  grid = p.subgrids[p.activeSubpage];
  rowMeta = p.subMetas[p.activeSubpage] ?? Array.from({length:24}, () => defaultRowMeta());
  p.grid = grid;
  updateSubLabel();
  showFeedback(`Subpage ${p.activeSubpage + 1}/${p.subgrids.length}`);
};

document.getElementById('btnAddSub')!.onclick = () => {
  const p = pages[activePageIdx];
  saveCurrentPage();
  const vg = createVisualGrid();
  p.subgrids.splice(p.activeSubpage + 1, 0, vg.rows);
  p.subMetas.splice(p.activeSubpage + 1, 0, vg.rowMeta);
  p.activeSubpage++;
  grid = vg.rows; rowMeta = vg.rowMeta;
  p.grid = grid;
  updateSubLabel();
  showFeedback(`Added subpage ${p.activeSubpage + 1}/${p.subgrids.length}`);
};

document.getElementById('btnDupSub')!.onclick = () => {
  const p = pages[activePageIdx];
  saveCurrentPage();
  const dupSub = JSON.parse(JSON.stringify(grid)) as VisualRow[];
  p.subgrids.splice(p.activeSubpage + 1, 0, dupSub);
  p.activeSubpage++;
  grid = dupSub;
  p.grid = grid;
  updateSubLabel();
  showFeedback(`Duplicated subpage ${p.activeSubpage + 1}/${p.subgrids.length}`);
};

document.getElementById('btnDelSub')!.onclick = () => {
  const p = pages[activePageIdx];
  if (p.subgrids.length <= 1) { showFeedback('Cannot delete last subpage'); return; }
  pushUndo();
  p.subgrids.splice(p.activeSubpage, 1);
  p.activeSubpage = Math.min(p.activeSubpage, p.subgrids.length - 1);
  grid = p.subgrids[p.activeSubpage];
  p.grid = grid;
  updateSubLabel();
  showFeedback('Subpage deleted');
};

// ─── Help ───────────────────────────────────────────────────────

document.getElementById('btnHelp')!.onclick = () => {
  alert(
    'Teletext Studio — Quick Help\n\n' +
    'TOOLS:\n' +
    '• Text: Click to place cursor, then type\n' +
    '• Paint Blocks: Click sub-blocks (2×3 per cell)\n' +
    '  Left-click = fill, Right-click = erase\n' +
    '• Fill Color: Click cell to recolor it\n' +
    '• Eraser: Click cell to clear it\n' +
    '• Pick Color: Click cell to grab its colors\n' +
    '• Select/Move: Drag to select, click inside to move\n\n' +
    'COLORS:\n' +
    '• Click palette swatches for FG/BG\n' +
    '• Keys 1-8: select FG color (non-text tools)\n' +
    '• Shift+1-8: select BG color (non-text tools)\n\n' +
    'SHORTCUTS:\n' +
    '• Ctrl+Z / Ctrl+Shift+Z: Undo / Redo\n' +
    '• Arrow keys: Move cursor\n' +
    '• Delete: Clear selection or cell\n' +
    '• Escape: Clear selection\n' +
    '• Tab: 4-space tab stop (text mode)\n\n' +
    'IMPORT/EXPORT:\n' +
    '• Import Image: Convert bitmap to mosaic art\n' +
    '• Import TTI/T42: Load teletext files\n' +
    '• Export: Download as .tti file\n' +
    '• CRT: Toggle CRT shader overlay'
  );
};

// ─── Fastext links ──────────────────────────────────────────────

const ftInputs = ['ftRed', 'ftGreen', 'ftYellow', 'ftCyan'].map(id => document.getElementById(id) as HTMLInputElement);

function loadFastext() {
  const ft = pages[activePageIdx].fastext;
  ftInputs.forEach((inp, i) => inp.value = ft[i]);
}

function saveFastext() {
  const ft = pages[activePageIdx].fastext;
  ftInputs.forEach((inp, i) => ft[i] = inp.value.trim());
}

ftInputs.forEach(inp => inp.addEventListener('change', saveFastext));

updatePageList();
updateSubLabel();
loadFastext();

// ─── Export ─────────────────────────────────────────────────────

document.getElementById('btnExport')!.onclick = () => {
  // Build a service from all pages
  const svc = { id: 'export', title: 'Teletext', pages: [] as any[], defaultLanguageSubset: 'english' as const };
  saveCurrentPage();
  for (const p of pages) {
    const page = createEmptyPage(p.id);
    page.subpages = [];
    for (let s = 0; s < p.subgrids.length; s++) {
      const sub = { ...page.subpages[0] ?? { subcode: s, rows: [], languageSubset: 'english' as const, pageFlags: { erasePage: true, newsflash: false, subtitle: false, suppressHeader: false, updateIndicator: false, interruptedSequence: false, inhibitDisplay: false } } };
      sub.subcode = s;
      sub.rows = [];
      for (let r = 0; r < 24; r++) {
        const result = compileVisualRow(p.subgrids[s][r]);
        sub.rows.push({ index: r, tokens: result.tokens });
      }
      page.subpages.push(sub);
    }
    svc.pages.push(page);
  }
  const t42 = exportServiceToT42(svc as any);
  const blob = new Blob([t42], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'teletext.t42'; a.click();
  URL.revokeObjectURL(url);
  showFeedback(`Exported ${pages.length} page(s) as .t42`);
};

// ─── Import T42 ─────────────────────────────────────────────────

document.getElementById('btnImportT42')!.onclick = () => (document.getElementById('fileT42') as HTMLInputElement).click();
(document.getElementById('fileT42') as HTMLInputElement).onchange = function() {
  const file = (this as HTMLInputElement).files?.[0];
  if (!file) return;
  (this as HTMLInputElement).value = '';
  file.arrayBuffer().then(buf => {
    const result = importT42(new Uint8Array(buf));
    if (result.pages.length === 0) { showFeedback('No pages found'); return; }
    pushUndo();

    // Import ALL pages from the T42 file
    pages = result.pages.map(p => {
      const subgrids: VisualRow[][] = [];
      const subMetas: RowMeta[][] = [];
      for (const sp of p.subpages) {
        const vRows: VisualRow[] = [];
        const meta: RowMeta[] = [];
        for (let r = 0; r < 24; r++) {
          const compiled = compileRow(sp.rows[r]);
          vRows.push(decompileToVisualRow(Array.from(compiled.bytes40)));
          meta.push(defaultRowMeta());
        }
        subgrids.push(vRows);
        subMetas.push(meta);
      }
      return { grid: subgrids[0], id: p.pageNumber, subgrids, subMetas, activeSubpage: 0, fastext: ['','','',''] as [string,string,string,string] };
    });
    activePageIdx = 0;
    grid = pages[0].subgrids[0];
    rowMeta = pages[0].subMetas[0];
    updatePageList();
    updateSubLabel();
    showFeedback(`Imported ${result.pages.length} page(s) from T42`);
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

// Color palette RGB values
const PALETTE: [number, number, number][] = [
  [0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

function compileAndRender() {
  // Direct render: paint the visual grid as colored pixels. No teletext compiler.
  const cellW = 12, cellH = 10; // pixels per cell (matches teletext resolution)
  const imgW = 40 * cellW, imgH = 24 * cellH; // 480×240
  const data = new Uint8ClampedArray(imgW * imgH * 4);

  for (let r = 0; r < 24; r++) {
    // Double-height bottom half: copy top row's content stretched
    const isBottomHalf = r > 0 && rowMeta[r - 1]?.doubleHeight;
    const sourceRow = isBottomHalf ? grid[r - 1] : grid[r];
    const isDoubleTop = rowMeta[r]?.doubleHeight && !isBottomHalf;

    for (let c = 0; c < 40; c++) {
      const cell = sourceRow[c];
      const fg = PALETTE[cell.fg] ?? PALETTE[7];
      const bg = PALETTE[cell.bg] ?? PALETTE[0];

      if (cell.mosaic) {
        // Render mosaic: 2×3 sub-blocks within the 12×10 cell
        let bits: number;
        const ch = cell.char;
        if (ch >= 0x20 && ch <= 0x3F) bits = ch - 0x20;
        else if (ch >= 0x60 && ch <= 0x7F) bits = (ch - 0x60) | 0x20;
        else bits = 0;

        const blockH = [3, 4, 3]; // row heights for 10px
        let py = 0;
        for (let br = 0; br < 3; br++) {
          const bh = blockH[br];
          for (let dy = 0; dy < bh; dy++) {
            for (let bc = 0; bc < 2; bc++) {
              const bitIdx = br * 2 + bc;
              const filled = (bits >> bitIdx) & 1;
              const color = filled ? fg : bg;
              const bw = bc === 0 ? 6 : 6;
              for (let dx = 0; dx < bw; dx++) {
                let srcY = py + dy;
                if (isDoubleTop) srcY = Math.floor(srcY / 2);
                else if (isBottomHalf) srcY = Math.floor(srcY / 2) + 5;
                if (srcY >= cellH) srcY = cellH - 1;
                // Use original py+dy for output position
                const ox = c * cellW + bc * 6 + dx;
                const oy = r * cellH + (isDoubleTop || isBottomHalf ? dy : dy); // always use actual row
                const oi = (( r * cellH + py + dy) * imgW + ox) * 4;
                data[oi] = color[0]; data[oi+1] = color[1]; data[oi+2] = color[2]; data[oi+3] = 255;
              }
            }
          }
          py += bh;
        }
      } else {
        // Render text character using the G0 font
        const glyph = getG0Glyph(cell.char);
        for (let y = 0; y < cellH; y++) {
          let glyphY = y;
          if (isDoubleTop) glyphY = Math.floor(y / 2);
          else if (isBottomHalf) glyphY = Math.floor(y / 2) + 5;
          if (glyphY >= cellH) glyphY = cellH - 1;

          for (let x = 0; x < cellW; x++) {
            const pixel = glyph[glyphY * cellW + x];
            const color = pixel ? fg : bg;
            const oi = ((r * cellH + y) * imgW + c * cellW + x) * 4;
            data[oi] = color[0]; data[oi+1] = color[1]; data[oi+2] = color[2]; data[oi+3] = 255;
          }
        }
      }
    }
  }

  const imageData = ctx.createImageData(imgW, imgH);
  imageData.data.set(data);

  const offscreen = new OffscreenCanvas(imgW, imgH);
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

  const cw = canvas.width / 40;
  const ch = canvas.height / 24;

  // Selection rectangle
  if (selection) {
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      selection.c1 * cw, selection.r1 * ch,
      (selection.c2 - selection.c1 + 1) * cw,
      (selection.r2 - selection.r1 + 1) * ch,
    );
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, canvas.width, selection.r1 * ch);
    ctx.fillRect(0, (selection.r2 + 1) * ch, canvas.width, canvas.height);
    ctx.fillRect(0, selection.r1 * ch, selection.c1 * cw, (selection.r2 - selection.r1 + 1) * ch);
    ctx.fillRect((selection.c2 + 1) * cw, selection.r1 * ch, canvas.width, (selection.r2 - selection.r1 + 1) * ch);
  }

  // Cursor
  ctx.strokeStyle = activeTool === 'paint' ? '#0f0' : activeTool === 'select' ? '#0ff' : '#ff0';
  ctx.lineWidth = 2;
  ctx.strokeRect(cursorCol * cw, cursorRow * ch, cw, ch);
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
