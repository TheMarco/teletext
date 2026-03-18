/**
 * Teletext viewer — standalone page viewer with keypad navigation.
 */

import { processPage } from '../src/state-machine/state-machine.js';
import { renderToBuffer, BUFFER_WIDTH, BUFFER_HEIGHT } from '../src/render-buffer/render-buffer.js';
import { createTimingState, advanceTiming } from '../src/timing-engine/timing-engine.js';
import { createCRTOverlay } from '../src/crt/shaderOverlay.js';
import { buildAICreatedService } from './ai-created-pages.js';
import { compileRow } from '../src/compile/index.js';
import type { TeletextPage, TeletextService } from '../src/model/types.js';

// ─── State ──────────────────────────────────────────────────────

const service = buildAICreatedService();
let currentPageNumber = 0x100;
let currentSubpage = 0;
let reveal = false;
let timing = createTimingState();
let inputBuffer = '';
let inputTimeout: number | null = null;

// ─── DOM ────────────────────────────────────────────────────────

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const pageDisplay = document.getElementById('pageDisplay')!;
const ftRed = document.getElementById('ftRed')!;
const ftGreen = document.getElementById('ftGreen')!;
const ftYellow = document.getElementById('ftYellow')!;
const ftCyan = document.getElementById('ftCyan')!;
const subDisplay = document.getElementById('subDisplay')!;

// ─── CRT shader ─────────────────────────────────────────────────

const crtOverlay = createCRTOverlay(canvas);

// ─── Page lookup ────────────────────────────────────────────────

function getPage(num: number): TeletextPage | undefined {
  return service.pages.find(p => p.pageNumber === num);
}

function navigateTo(pageNum: number) {
  const page = getPage(pageNum);
  if (page) {
    currentPageNumber = pageNum;
    currentSubpage = 0;
    subpageTimer = 0;
    updateFastext(page);
    updateSubDisplay();
  }
  pageDisplay.textContent = 'P' + pageNum.toString(16).toUpperCase().padStart(3, '0');
}

function nextSubpage() {
  const page = getPage(currentPageNumber);
  if (!page || page.subpages.length <= 1) return;
  currentSubpage = (currentSubpage + 1) % page.subpages.length;
  subpageTimer = 0;
  updateSubDisplay();
}

function prevSubpage() {
  const page = getPage(currentPageNumber);
  if (!page || page.subpages.length <= 1) return;
  currentSubpage = (currentSubpage - 1 + page.subpages.length) % page.subpages.length;
  subpageTimer = 0;
  updateSubDisplay();
}

function updateSubDisplay() {
  const page = getPage(currentPageNumber);
  const total = page?.subpages.length ?? 1;
  subDisplay.textContent = `${currentSubpage + 1}/${total}`;
}

function updateFastext(page: TeletextPage) {
  const fl = page.fastext;
  ftRed.textContent = fl?.red ? fl.red.toString(16).toUpperCase() : '---';
  ftGreen.textContent = fl?.green ? fl.green.toString(16).toUpperCase() : '---';
  ftYellow.textContent = fl?.yellow ? fl.yellow.toString(16).toUpperCase() : '---';
  ftCyan.textContent = fl?.cyan ? fl.cyan.toString(16).toUpperCase() : '---';
}

// ─── Input handling ─────────────────────────────────────────────

function handleDigit(d: string) {
  inputBuffer += d;
  pageDisplay.textContent = 'P' + inputBuffer.padEnd(3, '_');

  if (inputBuffer.length >= 3) {
    const num = parseInt(inputBuffer, 16);
    inputBuffer = '';
    if (num >= 0x100 && num <= 0x8FF) {
      navigateTo(num);
    } else {
      pageDisplay.textContent = 'P' + currentPageNumber.toString(16).toUpperCase().padStart(3, '0');
    }
    if (inputTimeout) { clearTimeout(inputTimeout); inputTimeout = null; }
  } else {
    // Auto-clear after 3 seconds of inactivity
    if (inputTimeout) clearTimeout(inputTimeout);
    inputTimeout = window.setTimeout(() => {
      inputBuffer = '';
      pageDisplay.textContent = 'P' + currentPageNumber.toString(16).toUpperCase().padStart(3, '0');
    }, 3000);
  }
}

// Numpad buttons
document.querySelectorAll('.numpad button').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = (btn as HTMLElement).dataset.n!;
    if (n === 'back') {
      inputBuffer = inputBuffer.slice(0, -1);
      if (inputBuffer.length === 0) {
        pageDisplay.textContent = 'P' + currentPageNumber.toString(16).toUpperCase().padStart(3, '0');
      } else {
        pageDisplay.textContent = 'P' + inputBuffer.padEnd(3, '_');
      }
    } else if (n === 'reveal') {
      reveal = !reveal;
    } else {
      handleDigit(n);
    }
  });
});

// Fastext buttons
ftRed.onclick = () => { const p = getPage(currentPageNumber); if (p?.fastext?.red) navigateTo(p.fastext.red); };
ftGreen.onclick = () => { const p = getPage(currentPageNumber); if (p?.fastext?.green) navigateTo(p.fastext.green); };
ftYellow.onclick = () => { const p = getPage(currentPageNumber); if (p?.fastext?.yellow) navigateTo(p.fastext.yellow); };
ftCyan.onclick = () => { const p = getPage(currentPageNumber); if (p?.fastext?.cyan) navigateTo(p.fastext.cyan); };

// Subpage buttons
document.getElementById('btnSubNext')!.onclick = nextSubpage;
document.getElementById('btnSubPrev')!.onclick = prevSubpage;

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'PageDown' || e.key === 'ArrowDown') { nextSubpage(); return; }
  if (e.key === 'PageUp' || e.key === 'ArrowUp') { prevSubpage(); return; }
  if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
  else if (e.key === 'a' || e.key === 'A') handleDigit('a');
  else if (e.key === 'b' || e.key === 'B') handleDigit('b');
  else if (e.key === 'c' || e.key === 'C') handleDigit('c');
  else if (e.key === 'd' || e.key === 'D') handleDigit('d');
  else if (e.key === 'e' || e.key === 'E') handleDigit('e');
  else if (e.key === 'f' || e.key === 'F') handleDigit('f');
  else if (e.key === 'r' || e.key === 'R') reveal = !reveal;
  else if (e.key === 'Backspace') {
    inputBuffer = inputBuffer.slice(0, -1);
    pageDisplay.textContent = inputBuffer.length > 0
      ? 'P' + inputBuffer.padEnd(3, '_')
      : 'P' + currentPageNumber.toString(16).toUpperCase().padStart(3, '0');
  }
});

// ─── Subpage carousel ───────────────────────────────────────────

let subpageTimer = 0;
const SUBPAGE_INTERVAL = 15000; // 15 seconds per subpage

// ─── Render ─────────────────────────────────────────────────────

function render() {
  const page = getPage(currentPageNumber);
  if (!page) {
    // Show "page not found" screen
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Page not available', canvas.width / 2, canvas.height / 2);
    return;
  }

  const subpage = page.subpages[currentSubpage] ?? page.subpages[0];
  if (!subpage) return;

  // Compile rows to raw bytes
  const rawRows: number[][] = [];
  for (const row of subpage.rows) {
    const compiled = compileRow(row);
    rawRows.push(Array.from(compiled.bytes40));
  }

  const grid = processPage(rawRows);
  const result = renderToBuffer(grid, timing.flashPhase, reveal);

  const imageData = ctx.createImageData(BUFFER_WIDTH, BUFFER_HEIGHT);
  imageData.data.set(result.data);

  const offscreen = new OffscreenCanvas(BUFFER_WIDTH, BUFFER_HEIGHT);
  const offCtx = offscreen.getContext('2d')!;
  offCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
}

let lastTime = 0;
function frame(time: number) {
  const delta = lastTime ? time - lastTime : 0;
  lastTime = time;
  timing = advanceTiming(timing, delta);

  // Subpage carousel
  const page = getPage(currentPageNumber);
  if (page && page.subpages.length > 1) {
    subpageTimer += delta;
    const interval = page.defaultCycle?.value ? page.defaultCycle.value * 1000 : SUBPAGE_INTERVAL;
    if (subpageTimer >= interval) {
      subpageTimer = 0;
      currentSubpage = (currentSubpage + 1) % page.subpages.length;
    }
  }

  render();
  requestAnimationFrame(frame);
}

// ─── Init ───────────────────────────────────────────────────────

navigateTo(0x100);
requestAnimationFrame(frame);
