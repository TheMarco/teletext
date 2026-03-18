/**
 * Teletext Editor UI — complete Phase 5 implementation.
 */

import {
  createEditorState, applyCommand, undo as editorUndo, redo as editorRedo,
  setActivePage, setActiveSubpage, getActiveSubpage, getActivePage,
  setCellCommand, plotMosaicCommand, clearRegionCommand,
  duplicateRowCommand, copyRegion, pasteRegionCommand,
  floodFillMosaicCommand, setPageFlagsCommand,
  expandTokens, renderSubpage,
} from '../src/editor/index.js';
import {
  createEmptyService, createEmptyPage, createEmptySubpage,
  charToken, controlToken, mosaicToken, fillToken,
} from '../src/model/factories.js';
import { addPage, removePage, getPageIndex } from '../src/bundle/index.js';
import { importTti, exportPageToTti, exportServiceToTti, importT42 } from '../src/tti/index.js';
import { compileRow } from '../src/compile/index.js';
import { BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/render-buffer/render-buffer.js';
import { createCRTOverlay } from '../src/crt/shaderOverlay.js';
import {
  rgbaToGrayscale, applyThreshold, pixelsToSextants, fitToRegion,
  buildImportMutations, applyImportToSubpage,
  planRowColors, buildTwoColorRowTokens, buildFullColorRowTokens,
} from '../src/import/index.js';
import { createTimingState, advanceTiming } from '../src/timing-engine/timing-engine.js';
import type { EditorState } from '../src/editor/index.js';
import type { TeletextToken } from '../src/model/types.js';

// ─── State ──────────────────────────────────────────────────────

let svc = createEmptyService('editor', 'Editor Session');
svc = addPage(svc, createEmptyPage(0x100));

let state: EditorState = createEditorState(svc);
state = setActivePage(state, 0x100);

let cursorRow = 0;
let cursorCol = 0;
let editMode: 'text' | 'control' | 'mosaic' | 'inspect' = 'text';
let activeColor = 7;
let reveal = false;
let showOverlay = false;
let mosaicContiguous = true;
let timing = createTimingState();
let clipboard: TeletextToken[][] | null = null;
let selStartRow = -1, selStartCol = -1;
let isDragging = false;
let feedbackTimer: number | null = null;

// ─── DOM refs ───────────────────────────────────────────────────

const canvas = document.getElementById('preview') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const pageList = document.getElementById('pageList')!;
const modeBar = document.getElementById('modeBar')!;
const modeLabel = document.getElementById('modeLabel')!;
const cursorPos = document.getElementById('cursorPos')!;
const pageLabel = document.getElementById('pageLabel')!;
const subLabel = document.getElementById('subLabel')!;
const flashLabel = document.getElementById('flashLabel')!;
const mosaicModeLabel = document.getElementById('mosaicMode')!;
const infoPos = document.getElementById('infoPos')!;
const infoToken = document.getElementById('infoToken')!;
const infoHex = document.getElementById('infoHex')!;
const infoChar = document.getElementById('infoChar')!;
const rowBytesEl = document.getElementById('rowBytes')!;
const colorPalette = document.getElementById('colorPalette')!;
const ctrlGrid = document.getElementById('ctrlGrid')!;
const subpageLabel = document.getElementById('subpageLabel')!;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const fileInputT42 = document.getElementById('fileInputT42') as HTMLInputElement;
const modeHint = document.getElementById('modeHint')!;
const actionFeedback = document.getElementById('actionFeedback')!;
const helpOverlay = document.getElementById('helpOverlay')!;

const MODE_HINTS: Record<string, string> = {
  text: 'TEXT MODE — Click to place cursor, then type',
  control: 'CONTROL MODE — Type text or click control codes on the right',
  mosaic: 'MOSAIC MODE — Click & drag to paint, right-click to erase',
  inspect: 'INSPECT MODE — Click cells to examine byte values',
};

const MODE_COLORS: Record<string, string> = {
  text: '#0aa', control: '#a0a', mosaic: '#0a0', inspect: '#aa0',
};

function showFeedback(msg: string) {
  actionFeedback.textContent = msg;
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => { actionFeedback.textContent = ''; }, 3000);
}

// Show help on first visit
if (!localStorage.getItem('teletext-editor-seen')) {
  helpOverlay.classList.add('open');
  localStorage.setItem('teletext-editor-seen', '1');
}
document.getElementById('btnHelp')!.onclick = () => helpOverlay.classList.toggle('open');

// ─── Control code grid ──────────────────────────────────────────

const CONTROL_NAMES: [number, string, string][] = [
  [0x00, 'Blk', '#000'], [0x01, 'Red', '#f00'], [0x02, 'Grn', '#0f0'], [0x03, 'Yel', '#ff0'],
  [0x04, 'Blu', '#00f'], [0x05, 'Mag', '#f0f'], [0x06, 'Cyn', '#0ff'], [0x07, 'Wht', '#fff'],
  [0x08, 'Flsh', ''], [0x09, 'Stdy', ''], [0x0C, 'Nrml', ''], [0x0D, 'DblH', ''],
  [0x10, 'MBlk', '#000'], [0x11, 'MRed', '#f00'], [0x12, 'MGrn', '#0f0'], [0x13, 'MYel', '#ff0'],
  [0x14, 'MBlu', '#00f'], [0x15, 'MMag', '#f0f'], [0x16, 'MCyn', '#0ff'], [0x17, 'MWht', '#fff'],
  [0x18, 'Conc', ''], [0x19, 'CntG', ''], [0x1A, 'SepG', ''], [0x1B, 'ESC', ''],
  [0x1C, 'BkBg', ''], [0x1D, 'NwBg', ''], [0x1E, 'Hold', ''], [0x1F, 'Rels', ''],
];

CONTROL_NAMES.forEach(([code, name, color]) => {
  const btn = document.createElement('div');
  btn.className = 'ctrl-btn' + (color ? ' color-code' : '');
  btn.textContent = name;
  if (color) btn.style.background = color === '#000' ? '#222' : color;
  if (color === '#fff' || color === '#ff0' || color === '#0ff' || color === '#0f0') btn.style.color = '#000';
  btn.title = `Insert 0x${code.toString(16).padStart(2, '0')}`;
  btn.onclick = () => {
    state = applyCommand(state, setCellCommand({ row: cursorRow, col: cursorCol, token: controlToken(code) }));
    cursorCol = Math.min(cursorCol + 1, 39);
    updateInspector();
    render();
  };
  ctrlGrid.appendChild(btn);
});

// ─── Color palette ──────────────────────────────────────────────

const COLORS = ['#000', '#f00', '#0f0', '#ff0', '#00f', '#f0f', '#0ff', '#fff'];
COLORS.forEach((color, i) => {
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch' + (i === activeColor ? ' selected' : '');
  swatch.style.background = color;
  swatch.title = `Color ${i} (key: ${i + 1})`;
  swatch.onclick = () => selectColor(i);
  colorPalette.appendChild(swatch);
});

function selectColor(i: number) {
  activeColor = i;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  colorPalette.children[i]?.classList.add('selected');
}

// ─── Mode switching ─────────────────────────────────────────────

function switchMode(mode: typeof editMode) {
  editMode = mode;
  modeBar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  modeBar.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
  modeLabel.textContent = mode.toUpperCase();
  modeHint.textContent = MODE_HINTS[mode];
  document.documentElement.style.setProperty('--mode-color', MODE_COLORS[mode]);
  showFeedback(`Switched to ${mode} mode`);
}

modeBar.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => switchMode((btn as HTMLElement).dataset.mode as typeof editMode));
});

// ─── Toolbar buttons ────────────────────────────────────────────

document.getElementById('btnUndo')!.onclick = () => { state = editorUndo(state); render(); };
document.getElementById('btnRedo')!.onclick = () => { state = editorRedo(state); render(); };
document.getElementById('btnReveal')!.onclick = () => { reveal = !reveal; render(); };
document.getElementById('btnOverlay')!.onclick = () => { showOverlay = !showOverlay; render(); };

document.getElementById('btnMosaicSep')!.onclick = (e) => {
  mosaicContiguous = !mosaicContiguous;
  (e.target as HTMLButtonElement).textContent = mosaicContiguous ? 'Contig' : 'Separ';
  mosaicModeLabel.textContent = mosaicContiguous ? 'contig' : 'separ';
};

let crtOverlay: HTMLCanvasElement | null = null;
document.getElementById('btnCRT')!.onclick = (e) => {
  if (crtOverlay) {
    crtOverlay.remove();
    crtOverlay = null;
    (e.target as HTMLButtonElement).classList.remove('active');
  } else {
    crtOverlay = createCRTOverlay(canvas);
    if (crtOverlay) (e.target as HTMLButtonElement).classList.add('active');
  }
};

document.getElementById('btnExport')!.onclick = () => {
  const page = getActivePage(state);
  if (!page) return;
  const tti = exportPageToTti(page);
  download(`P${page.pageNumber.toString(16).toUpperCase()}.tti`, tti);
};

document.getElementById('btnImport')!.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  file.text().then(text => {
    const imported = importTti(text, undefined, file.name);
    for (const page of imported.pages) {
      state = { ...state, service: addPage(state.service, page) };
    }
    if (imported.pages.length > 0) state = setActivePage(state, imported.pages[0].pageNumber);
    updatePageList(); updateSubpageNav(); render();
  });
};

document.getElementById('btnImportT42')!.onclick = () => fileInputT42.click();
fileInputT42.onchange = () => {
  const file = fileInputT42.files?.[0];
  if (!file) return;
  file.arrayBuffer().then(buf => {
    const result = importT42(new Uint8Array(buf));
    for (const page of result.pages) state = { ...state, service: addPage(state.service, page) };
    if (result.pages.length > 0) state = setActivePage(state, result.pages[0].pageNumber);
    updatePageList(); updateSubpageNav(); render();
  });
};

// ─── Page management ────────────────────────────────────────────

document.getElementById('btnAddPage')!.onclick = () => {
  const existing = state.service.pages.map(p => p.pageNumber).sort((a, b) => a - b);
  let pn = 0x100;
  while (existing.includes(pn)) pn++;
  state = { ...state, service: addPage(state.service, createEmptyPage(pn)) };
  state = setActivePage(state, pn);
  updatePageList(); updateSubpageNav(); render();
};

document.getElementById('btnDelPage')!.onclick = () => {
  if (!state.activePageNumber || state.service.pages.length <= 1) return;
  const pn = state.activePageNumber;
  state = { ...state, service: removePage(state.service, pn) };
  state = setActivePage(state, state.service.pages[0]?.pageNumber ?? 0x100);
  updatePageList(); updateSubpageNav(); render();
};

// ─── Subpage management ─────────────────────────────────────────

document.getElementById('btnPrevSub')!.onclick = () => {
  if (state.activeSubpageIndex > 0) {
    state = setActiveSubpage(state, state.activeSubpageIndex - 1);
    updateSubpageNav(); render();
  }
};

document.getElementById('btnNextSub')!.onclick = () => {
  const page = getActivePage(state);
  if (page && state.activeSubpageIndex < page.subpages.length - 1) {
    state = setActiveSubpage(state, state.activeSubpageIndex + 1);
    updateSubpageNav(); render();
  }
};

document.getElementById('btnAddSub')!.onclick = () => {
  const page = getActivePage(state);
  if (!page) return;
  const newSub = createEmptySubpage(page.subpages.length);
  const newPages = state.service.pages.map(p => {
    if (p.pageNumber !== state.activePageNumber) return p;
    return { ...p, subpages: [...p.subpages, newSub] };
  });
  state = { ...state, service: { ...state.service, pages: newPages } };
  state = setActiveSubpage(state, page.subpages.length); // select new one
  updateSubpageNav(); updatePageList(); render();
};

document.getElementById('btnDelSub')!.onclick = () => {
  const page = getActivePage(state);
  if (!page || page.subpages.length <= 1) return;
  const idx = state.activeSubpageIndex;
  const newPages = state.service.pages.map(p => {
    if (p.pageNumber !== state.activePageNumber) return p;
    return { ...p, subpages: p.subpages.filter((_, i) => i !== idx) };
  });
  state = { ...state, service: { ...state.service, pages: newPages } };
  state = setActiveSubpage(state, Math.min(idx, page.subpages.length - 2));
  updateSubpageNav(); updatePageList(); render();
};

function updateSubpageNav() {
  const page = getActivePage(state);
  const total = page?.subpages.length ?? 1;
  const current = state.activeSubpageIndex + 1;
  const label = `${current}/${total}`;
  document.getElementById('subpageLabel')!.textContent = label;
  subLabel.textContent = label;
}

// ─── Page settings ──────────────────────────────────────────────

const selLanguage = document.getElementById('selLanguage') as HTMLSelectElement;
const chkNewsflash = document.getElementById('chkNewsflash') as HTMLInputElement;
const chkSubtitle = document.getElementById('chkSubtitle') as HTMLInputElement;
const chkSuppress = document.getElementById('chkSuppress') as HTMLInputElement;

selLanguage.onchange = () => {
  const sp = getActiveSubpage(state);
  if (!sp) return;
  const newPages = state.service.pages.map(p => {
    if (p.pageNumber !== state.activePageNumber) return p;
    const newSubs = [...p.subpages];
    newSubs[state.activeSubpageIndex] = { ...newSubs[state.activeSubpageIndex], languageSubset: selLanguage.value as any };
    return { ...p, subpages: newSubs };
  });
  state = { ...state, service: { ...state.service, pages: newPages } };
};

[chkNewsflash, chkSubtitle, chkSuppress].forEach(chk => {
  chk.onchange = () => {
    state = applyCommand(state, setPageFlagsCommand({
      flags: {
        newsflash: chkNewsflash.checked,
        subtitle: chkSubtitle.checked,
        suppressHeader: chkSuppress.checked,
      },
    }));
  };
});

// ─── Fastext links ──────────────────────────────────────────────

const flRed = document.getElementById('flRed') as HTMLInputElement;
const flGreen = document.getElementById('flGreen') as HTMLInputElement;
const flYellow = document.getElementById('flYellow') as HTMLInputElement;
const flCyan = document.getElementById('flCyan') as HTMLInputElement;

[flRed, flGreen, flYellow, flCyan].forEach((input, i) => {
  input.onchange = () => {
    const page = getActivePage(state);
    if (!page) return;
    const keys = ['red', 'green', 'yellow', 'cyan'] as const;
    const val = parseInt(input.value) || null;
    const fastext = { ...(page.fastext ?? {}), [keys[i]]: val };
    const newPages = state.service.pages.map(p =>
      p.pageNumber === state.activePageNumber ? { ...p, fastext } : p,
    );
    state = { ...state, service: { ...state.service, pages: newPages } };
  };
});

function updateFastextUI() {
  const page = getActivePage(state);
  flRed.value = page?.fastext?.red?.toString() ?? '';
  flGreen.value = page?.fastext?.green?.toString() ?? '';
  flYellow.value = page?.fastext?.yellow?.toString() ?? '';
  flCyan.value = page?.fastext?.cyan?.toString() ?? '';
}

// ─── Page list ──────────────────────────────────────────────────

function formatPageNumber(pn: number): string {
  return 'P' + pn.toString(16).toUpperCase().padStart(3, '0');
}

function updatePageList() {
  const index = getPageIndex(state.service).sort((a, b) => a.pageNumber - b.pageNumber);
  pageList.innerHTML = '';
  for (const entry of index) {
    const li = document.createElement('li');
    const subs = entry.subpageCount > 1 ? ` (${entry.subpageCount})` : '';
    li.textContent = formatPageNumber(entry.pageNumber) + subs;
    if (entry.description) li.title = entry.description;
    if (entry.pageNumber === state.activePageNumber) li.classList.add('active');
    li.onclick = () => {
      state = setActivePage(state, entry.pageNumber);
      updatePageList(); updateSubpageNav(); updatePageSettingsUI(); updateFastextUI(); render();
    };
    pageList.appendChild(li);
  }
  pageLabel.textContent = state.activePageNumber ? formatPageNumber(state.activePageNumber) : '-';
}

function updatePageSettingsUI() {
  const sp = getActiveSubpage(state);
  if (!sp) return;
  selLanguage.value = sp.languageSubset;
  chkNewsflash.checked = sp.pageFlags.newsflash;
  chkSubtitle.checked = sp.pageFlags.subtitle;
  chkSuppress.checked = sp.pageFlags.suppressHeader;
}

// ─── Canvas interaction ─────────────────────────────────────────

function canvasToCell(e: MouseEvent): { row: number; col: number; sx: number; sy: number } {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width * BUFFER_WIDTH;
  const py = (e.clientY - rect.top) / rect.height * BUFFER_HEIGHT;
  const col = Math.floor(px / 12);
  const row = Math.floor(py / 10);
  const cellPx = px - col * 12;
  const cellPy = py - row * 10;
  return { row, col, sx: cellPx < 6 ? 0 : 1, sy: cellPy < 3.33 ? 0 : cellPy < 6.66 ? 1 : 2 };
}

function handleCanvasInput(e: MouseEvent, isErase: boolean) {
  const { row, col, sx, sy } = canvasToCell(e);
  if (row < 0 || row >= 24 || col < 0 || col >= 40) return;
  cursorRow = row; cursorCol = col;

  if (editMode === 'mosaic') {
    // Ensure the row has a mosaic color control code at col 0
    // so the state machine enters graphics mode
    const sp = getActiveSubpage(state);
    if (sp && !isErase) {
      const expanded = expandTokens(sp.rows[row].tokens);
      const hasMosaicCode = expanded.some(t =>
        t.kind === 'control' && 'codepoint7' in t && t.codepoint7 >= 0x10 && t.codepoint7 <= 0x17
      );
      if (!hasMosaicCode) {
        // Insert mosaic color code at col 0 (using active color)
        state = applyCommand(state, setCellCommand({
          row, col: 0, token: controlToken(0x10 + activeColor),
        }));
      }
    }
    state = applyCommand(state, plotMosaicCommand({
      row, col: Math.max(col, 1), // don't overwrite the control code at col 0
      sextantBit: sy * 2 + sx, value: !isErase, contiguous: mosaicContiguous,
    }));
  } else if (editMode === 'control' && !isErase) {
    state = applyCommand(state, setCellCommand({ row, col, token: controlToken(activeColor) }));
    cursorCol = Math.min(cursorCol + 1, 39);
  }

  updateInspector(); render();
}

// Mouse down — start interaction (and drag for mosaic)
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) return; // right-click handled separately
  isDragging = true;
  handleCanvasInput(e, false);
});

// Mouse move — drag painting in mosaic mode
canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  if (editMode === 'mosaic') {
    handleCanvasInput(e, e.buttons === 2);
  }
});

// Mouse up — stop dragging
window.addEventListener('mouseup', () => { isDragging = false; });

// Right-click — erase in mosaic mode
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  handleCanvasInput(e, true);
});

// Right-click drag
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2 && editMode === 'mosaic') {
    isDragging = true;
    handleCanvasInput(e, true);
  }
});

// ─── Keyboard ───────────────────────────────────────────────────

const CONTROL_CODE_NAMES: Record<number, string> = {
  0x00:'AlpBlk',0x01:'AlpRed',0x02:'AlpGrn',0x03:'AlpYel',0x04:'AlpBlu',0x05:'AlpMag',0x06:'AlpCyn',0x07:'AlpWht',
  0x08:'Flash',0x09:'Steady',0x0A:'EndBox',0x0B:'StartBox',0x0C:'NrmHt',0x0D:'DblHt',
  0x10:'MosBlk',0x11:'MosRed',0x12:'MosGrn',0x13:'MosYel',0x14:'MosBlu',0x15:'MosMag',0x16:'MosCyn',0x17:'MosWht',
  0x18:'Conceal',0x19:'ContigG',0x1A:'SeparG',0x1B:'ESC',0x1C:'BlkBg',0x1D:'NewBg',0x1E:'Hold',0x1F:'Release',
};

document.addEventListener('keydown', (e) => {
  // Global shortcuts
  // Help
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { helpOverlay.classList.toggle('open'); return; }
  if (e.key === 'Escape') { helpOverlay.classList.remove('open'); return; }

  // Global shortcuts
  if (e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) { e.preventDefault(); state = editorRedo(state); showFeedback('Redo'); render(); return; }
  if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); state = editorUndo(state); showFeedback('Undo'); render(); return; }
  if (e.key === 'c' && (e.metaKey || e.ctrlKey)) { doCopy(); showFeedback('Row copied'); return; }
  if (e.key === 'v' && (e.metaKey || e.ctrlKey)) { doPaste(); showFeedback('Row pasted'); return; }
  if (e.key === 'r' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reveal = !reveal; showFeedback(reveal ? 'Reveal ON' : 'Reveal OFF'); render(); return; }
  if (e.key === 'o' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); showOverlay = !showOverlay; showFeedback(showOverlay ? 'Overlay ON' : 'Overlay OFF'); render(); return; }

  // Mode switching
  if (e.key === 'F1') { e.preventDefault(); switchMode('text'); return; }
  if (e.key === 'F2') { e.preventDefault(); switchMode('control'); return; }
  if (e.key === 'F3') { e.preventDefault(); switchMode('mosaic'); return; }
  if (e.key === 'F4') { e.preventDefault(); switchMode('inspect'); return; }

  // Arrow keys (all modes)
  if (e.key === 'ArrowRight') { cursorCol = Math.min(cursorCol + 1, 39); updateInspector(); render(); return; }
  if (e.key === 'ArrowLeft') { cursorCol = Math.max(cursorCol - 1, 0); updateInspector(); render(); return; }
  if (e.key === 'ArrowDown') { cursorRow = Math.min(cursorRow + 1, 23); updateInspector(); render(); return; }
  if (e.key === 'ArrowUp') { cursorRow = Math.max(cursorRow - 1, 0); updateInspector(); render(); return; }

  // Color selection: keys 1-8
  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '8') {
    const colorIdx = parseInt(e.key) - 1;
    if (e.shiftKey) {
      // Shift+1-8: insert mosaic color control code at cursor
      state = applyCommand(state, setCellCommand({ row: cursorRow, col: cursorCol, token: controlToken(0x10 + colorIdx) }));
      cursorCol = Math.min(cursorCol + 1, 39);
      showFeedback(`Inserted mosaic ${['black','red','green','yellow','blue','magenta','cyan','white'][colorIdx]}`);
      render();
    } else {
      selectColor(colorIdx);
      // In mosaic mode, also update col 0 of the current row to the new mosaic color
      if (editMode === 'mosaic') {
        const sp = getActiveSubpage(state);
        if (sp) {
          const expanded = expandTokens(sp.rows[cursorRow].tokens);
          // Find and update existing mosaic control code, or insert at col 0
          let foundIdx = -1;
          for (let i = 0; i < expanded.length; i++) {
            const t = expanded[i];
            if (t.kind === 'control' && 'codepoint7' in t && t.codepoint7 >= 0x10 && t.codepoint7 <= 0x17) {
              foundIdx = i;
              break;
            }
          }
          if (foundIdx >= 0) {
            state = applyCommand(state, setCellCommand({
              row: cursorRow, col: foundIdx, token: controlToken(0x10 + colorIdx),
            }));
          } else {
            state = applyCommand(state, setCellCommand({
              row: cursorRow, col: 0, token: controlToken(0x10 + colorIdx),
            }));
          }
          showFeedback(`Row color → ${['black','red','green','yellow','blue','magenta','cyan','white'][colorIdx]}`);
          render();
        }
      }
    }
    return;
  }

  // Quick control code shortcuts
  if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (e.key === 'F5') { e.preventDefault(); insertControl(0x08); return; } // Flash
    if (e.key === 'F6') { e.preventDefault(); insertControl(0x09); return; } // Steady
    if (e.key === 'F7') { e.preventDefault(); insertControl(0x0D); return; } // Double height
    if (e.key === 'F8') { e.preventDefault(); insertControl(0x0C); return; } // Normal height
    if (e.key === 'F9') { e.preventDefault(); insertControl(0x1E); return; } // Hold
    if (e.key === 'F10') { e.preventDefault(); insertControl(0x1F); return; } // Release
    if (e.key === 'F11') { e.preventDefault(); insertControl(0x1D); return; } // New background
    if (e.key === 'F12') { e.preventDefault(); insertControl(0x1C); return; } // Black background
  }

  // Text mode input
  if (editMode === 'text' || editMode === 'control') {
    if (e.key.length === 1 && e.key.charCodeAt(0) >= 0x20 && e.key.charCodeAt(0) <= 0x7E && !e.metaKey && !e.ctrlKey) {
      state = applyCommand(state, setCellCommand({
        row: cursorRow, col: cursorCol, token: charToken(e.key.charCodeAt(0)),
      }));
      cursorCol = Math.min(cursorCol + 1, 39);
      updateInspector(); render();
    } else if (e.key === 'Backspace') {
      cursorCol = Math.max(cursorCol - 1, 0);
      state = applyCommand(state, setCellCommand({ row: cursorRow, col: cursorCol, token: charToken(0x20) }));
      updateInspector(); render();
    } else if (e.key === 'Delete') {
      state = applyCommand(state, setCellCommand({ row: cursorRow, col: cursorCol, token: charToken(0x20) }));
      render();
    } else if (e.key === 'Enter') {
      cursorRow = Math.min(cursorRow + 1, 23); cursorCol = 0;
      updateInspector(); render();
    }
  }

  cursorPos.textContent = `${cursorRow},${cursorCol}`;
});

function insertControl(code: number) {
  state = applyCommand(state, setCellCommand({ row: cursorRow, col: cursorCol, token: controlToken(code) }));
  cursorCol = Math.min(cursorCol + 1, 39);
  updateInspector(); render();
}

// ─── Copy / Paste ───────────────────────────────────────────────

function doCopy() {
  const sp = getActiveSubpage(state);
  if (!sp) return;
  // Copy current row
  clipboard = copyRegion(sp, cursorRow, 0, cursorRow, 39);
}

function doPaste() {
  if (!clipboard) return;
  state = applyCommand(state, pasteRegionCommand({ targetRow: cursorRow, targetCol: 0, clipboard }));
  render();
}

// ─── Inspector ──────────────────────────────────────────────────

function updateInspector() {
  const sp = getActiveSubpage(state);
  if (!sp) return;

  infoPos.textContent = `${cursorRow}, ${cursorCol}`;
  cursorPos.textContent = `${cursorRow},${cursorCol}`;

  const expanded = expandTokens(sp.rows[cursorRow].tokens);
  const token = expanded[cursorCol];
  infoToken.textContent = token.kind;
  const cp = 'codepoint7' in token ? token.codepoint7 : 0;
  infoHex.textContent = `0x${cp.toString(16).padStart(2, '0')}`;

  if (token.kind === 'char' && cp >= 0x20 && cp <= 0x7E) {
    infoChar.textContent = String.fromCharCode(cp);
  } else if (token.kind === 'control') {
    infoChar.textContent = CONTROL_CODE_NAMES[cp] ?? `ctrl ${cp}`;
  } else if (token.kind === 'mosaic') {
    infoChar.textContent = `mosaic b${cp.toString(2).padStart(6, '0')}`;
  } else {
    infoChar.textContent = '-';
  }

  const compiled = compileRow(sp.rows[cursorRow]);
  rowBytesEl.textContent = Array.from(compiled.bytes40).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// ─── Render ─────────────────────────────────────────────────────

function render() {
  const sp = getActiveSubpage(state);
  if (!sp) return;

  const result = renderSubpage(sp, timing.flashPhase, reveal);
  const imageData = ctx.createImageData(BUFFER_WIDTH, BUFFER_HEIGHT);
  imageData.data.set(result.data);

  const offscreen = new OffscreenCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

  const cellW = canvas.width / 40;
  const cellH = canvas.height / 24;

  // Control code overlay
  if (showOverlay) {
    const expanded = sp.rows.map(r => expandTokens(r.tokens));
    ctx.font = `${Math.max(8, cellW * 0.4)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < 24; r++) {
      for (let c = 0; c < 40; c++) {
        const t = expanded[r][c];
        if (t.kind === 'control') {
          ctx.fillStyle = 'rgba(255,0,255,0.4)';
          ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
          ctx.fillStyle = '#fff';
          const name = CONTROL_CODE_NAMES[t.codepoint7]?.substring(0, 3) ?? '??';
          ctx.fillText(name, c * cellW + cellW / 2, r * cellH + cellH / 2);
        }
      }
    }
  }

  // Cursor
  ctx.strokeStyle = editMode === 'mosaic' ? '#0f0' : '#ff0';
  ctx.lineWidth = 2;
  ctx.strokeRect(cursorCol * cellW, cursorRow * cellH, cellW, cellH);
}

let lastTime = 0;
function frame(time: number) {
  const delta = lastTime ? time - lastTime : 0;
  lastTime = time;
  timing = advanceTiming(timing, delta);
  flashLabel.textContent = timing.flashPhase ? 'ON' : 'OFF';
  render();
  requestAnimationFrame(frame);
}

// ─── Bitmap import ──────────────────────────────────────────────

const bitmapModal = document.getElementById('bitmapModal')!;
const fileBitmap = document.getElementById('fileBitmap') as HTMLInputElement;
const bmpSrcCanvas = document.getElementById('bmpSrcCanvas') as HTMLCanvasElement;
const bmpPreviewCanvas = document.getElementById('bmpPreviewCanvas') as HTMLCanvasElement;
let bmpImageData: ImageData | null = null;

document.getElementById('btnBitmapImport')!.onclick = () => fileBitmap.click();

fileBitmap.onchange = () => {
  const file = fileBitmap.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    // Draw source to canvas
    const srcCtx = bmpSrcCanvas.getContext('2d')!;
    bmpSrcCanvas.width = img.width;
    bmpSrcCanvas.height = img.height;
    srcCtx.drawImage(img, 0, 0);
    bmpImageData = srcCtx.getImageData(0, 0, img.width, img.height);

    // Show preview
    updateBitmapPreview();
    bitmapModal.classList.add('open');
  };
  img.src = URL.createObjectURL(file);
};

function updateBitmapPreview() {
  if (!bmpImageData) return;
  const maxCols = parseInt((document.getElementById('bmpMaxCols') as HTMLInputElement).value) || 39;
  const maxRows = parseInt((document.getElementById('bmpMaxRows') as HTMLInputElement).value) || 20;
  const threshold = parseInt((document.getElementById('bmpThreshold') as HTMLInputElement).value) || 128;

  const gray = rgbaToGrayscale(new Uint8Array(bmpImageData.data), bmpImageData.width, bmpImageData.height);
  const fitted = fitToRegion(gray, bmpImageData.width, bmpImageData.height, maxCols, maxRows, 'contain');
  const binary = applyThreshold(fitted.data, threshold);
  const sextants = pixelsToSextants(binary, fitted.width, fitted.height, 128);

  // Draw preview: render sextants as black/white blocks
  const prevCtx = bmpPreviewCanvas.getContext('2d')!;
  const pw = maxCols * 2;
  const ph = maxRows * 3;
  bmpPreviewCanvas.width = pw;
  bmpPreviewCanvas.height = ph;
  prevCtx.fillStyle = '#000';
  prevCtx.fillRect(0, 0, pw, ph);
  prevCtx.fillStyle = '#fff';

  for (let cy = 0; cy < sextants.length; cy++) {
    for (let cx = 0; cx < sextants[cy].length; cx++) {
      const bits = sextants[cy][cx].bits;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          if (bits[sy * 2 + sx]) {
            prevCtx.fillRect(cx * 2 + sx, cy * 3 + sy, 1, 1);
          }
        }
      }
    }
  }
}

// Update preview when settings change
['bmpMaxCols', 'bmpMaxRows', 'bmpThreshold', 'bmpMode', 'bmpFg', 'bmpBg'].forEach(id => {
  document.getElementById(id)!.addEventListener('change', updateBitmapPreview);
  document.getElementById(id)!.addEventListener('input', updateBitmapPreview);
});

document.getElementById('bmpCancel')!.onclick = () => {
  bitmapModal.classList.remove('open');
  bmpImageData = null;
};

document.getElementById('bmpApply')!.onclick = () => {
  if (!bmpImageData) return;
  const sp = getActiveSubpage(state);
  if (!sp) return;

  const mode = (document.getElementById('bmpMode') as HTMLSelectElement).value;
  const startRow = parseInt((document.getElementById('bmpStartRow') as HTMLInputElement).value) || 2;
  const startCol = parseInt((document.getElementById('bmpStartCol') as HTMLInputElement).value) || 0;
  const maxCols = parseInt((document.getElementById('bmpMaxCols') as HTMLInputElement).value) || 39;
  const maxRows = parseInt((document.getElementById('bmpMaxRows') as HTMLInputElement).value) || 20;
  const threshold = parseInt((document.getElementById('bmpThreshold') as HTMLInputElement).value) || 128;
  const fgColor = parseInt((document.getElementById('bmpFg') as HTMLSelectElement).value) || 7;
  const bgColor = parseInt((document.getElementById('bmpBg') as HTMLSelectElement).value) || 0;
  const contig = (document.getElementById('bmpMosaicType') as HTMLSelectElement).value === 'contig';

  const srcRGBA = new Uint8Array(bmpImageData.data);
  const srcW = bmpImageData.width;
  const srcH = bmpImageData.height;

  // Fit the image to the target cell grid (in pixel space: cols*2 × rows*3)
  const dstW = maxCols * 2;
  const dstH = maxRows * 3;

  // Resize source RGBA to fit target
  const fitCanvas = new OffscreenCanvas(dstW, dstH);
  const fitCtx = fitCanvas.getContext('2d')!;
  // Draw from original image data
  const tmpCanvas = new OffscreenCanvas(srcW, srcH);
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.putImageData(bmpImageData, 0, 0);
  fitCtx.drawImage(tmpCanvas, 0, 0, dstW, dstH);
  const fittedRGBA = new Uint8Array(fitCtx.getImageData(0, 0, dstW, dstH).data);

  let updated = structuredClone(sp);

  if (mode === 'fullcolor') {
    // Full color: per-row color run analysis on the RGBA data
    const cellRows = Math.floor(dstH / 3);
    const cellCols = Math.floor(dstW / 2);

    for (let cr = 0; cr < cellRows && (startRow + cr) < 24; cr++) {
      const rowTokens = buildFullColorRowTokens(
        fittedRGBA, dstW, dstH,
        cr, Math.min(cellCols, 40 - startCol - 1), // leave room for at least 1 control code
        startCol,
        bgColor as any,
        contig,
      );
      const rowIdx = startRow + cr;
      updated.rows[rowIdx] = { index: rowIdx, tokens: rowTokens };
    }
  } else if (mode === 'twocolorrow') {
    // Two-color per row: analyze each row band for dominant fg/bg
    const plans = planRowColors(fittedRGBA, dstW, dstH, Math.floor(dstH / 3));
    const gray = rgbaToGrayscale(fittedRGBA, dstW, dstH);
    const binary = applyThreshold(gray, threshold);
    const sextants = pixelsToSextants(binary, dstW, dstH, 128);

    for (let cr = 0; cr < sextants.length && (startRow + cr) < 24; cr++) {
      const rowTokens = buildTwoColorRowTokens(sextants[cr], plans[cr], startCol, contig);
      const rowIdx = startRow + cr;
      updated.rows[rowIdx] = { index: rowIdx, tokens: rowTokens };
    }
  } else {
    // Monochrome: grayscale → threshold → sextants
    const gray = rgbaToGrayscale(fittedRGBA, dstW, dstH);
    const binary = applyThreshold(gray, threshold);
    const sextants = pixelsToSextants(binary, dstW, dstH, 128);

    const result = buildImportMutations(sextants, {
      region: { x: startCol, y: startRow, width: maxCols, height: maxRows },
      fgColor,
      contiguous: contig,
      eraseFirst: false,
    });
    updated = applyImportToSubpage(sp, result);
  }

  // Apply to state
  const newPages = state.service.pages.map(p => {
    if (p.pageNumber !== state.activePageNumber) return p;
    const newSubs = [...p.subpages];
    newSubs[state.activeSubpageIndex] = updated;
    return { ...p, subpages: newSubs };
  });
  state = { ...state, service: { ...state.service, pages: newPages }, undoStack: [], redoStack: [] };

  bitmapModal.classList.remove('open');
  bmpImageData = null;
  render();
};

// ─── Helpers ────────────────────────────────────────────────────

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Init ───────────────────────────────────────────────────────

updatePageList();
updateSubpageNav();
updatePageSettingsUI();
updateFastextUI();
updateInspector();
requestAnimationFrame(frame);
