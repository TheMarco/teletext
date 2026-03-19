#!/usr/bin/env tsx
/**
 * Interactive Teletext terminal viewer.
 *
 * Renders Teletext pages in the terminal using ANSI + Unicode sextants.
 * Features full-screen display with page input, fastext navigation,
 * subpage cycling, flash animation, and reveal toggle.
 *
 * Usage:
 *   npx tsx scripts/ansi-render.ts <file.t42|file.tti> [page-hex]
 *
 * Controls:
 *   0-9, A-F    Type page number (hex)
 *   Enter       Navigate to typed page
 *   Backspace   Delete last digit
 *   Escape      Clear input
 *   Left/Right  Previous/next subpage
 *   R           Toggle reveal
 *   F1-F4       Fastext: red, green, yellow, cyan
 *   Q / Ctrl-C  Quit
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { processPage } from '../src/state-machine/state-machine.js';
import { compileRow } from '../src/compile/index.js';
import { importT42 } from '../src/tti/index.js';
import { importTti } from '../src/tti/index.js';
import { renderToAnsi, renderToAnsiFramed } from '../src/render-ansi/index.js';
import type { TeletextService, TeletextPage, PageGrid } from '../src/model/types.js';

// ─── File loading ──────────────────────────────────────────────

function usage(): never {
  process.stderr.write(
    'Usage: npx tsx scripts/ansi-render.ts <file.t42|file.tti> [page-hex]\n'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1) usage();

const filePath = resolve(args[0]);
const ext = filePath.toLowerCase();

let service: TeletextService;

if (ext.endsWith('.t42')) {
  const buf = readFileSync(filePath);
  const result = importT42(new Uint8Array(buf));
  service = {
    id: 'cli',
    title: 'CLI Viewer',
    pages: result.pages,
    defaultLanguageSubset: 'english',
  };
} else if (ext.endsWith('.tti')) {
  const text = readFileSync(filePath, 'utf-8');
  service = importTti(text, 'cli', 'CLI Viewer');
} else {
  process.stderr.write('Unsupported file type. Use .t42 or .tti\n');
  process.exit(1);
}

if (service.pages.length === 0) {
  process.stderr.write('No pages found in file.\n');
  process.exit(1);
}

// ─── State ─────────────────────────────────────────────────────

let currentPageNumber = args[1]
  ? parseInt(args[1], 16)
  : service.pages[0].pageNumber;
let currentSubpage = 0;
let reveal = false;
let flashPhase = true;
let inputBuffer = '';
let inputTimeout: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ───────────────────────────────────────────────────

const ESC = '\x1b';
const CSI = `${ESC}[`;

function hideCursor() { process.stdout.write(`${CSI}?25l`); }
function showCursor() { process.stdout.write(`${CSI}?25h`); }
function moveTo(row: number, col: number) { process.stdout.write(`${CSI}${row};${col}H`); }
function clearScreen() { process.stdout.write(`${CSI}2J`); }
function eraseToEOL() { process.stdout.write(`${CSI}K`); }
function resetSGR() { process.stdout.write(`${CSI}0m`); }

function getPage(num: number): TeletextPage | undefined {
  return service.pages.find(p => p.pageNumber === num);
}

function pageHex(num: number): string {
  return num.toString(16).toUpperCase().padStart(3, '0');
}

function compilePageGrid(page: TeletextPage, subIdx: number): PageGrid {
  const subpage = page.subpages[subIdx] ?? page.subpages[0];
  const rawRows: number[][] = [];
  for (const row of subpage.rows) {
    const compiled = compileRow(row);
    rawRows.push(Array.from(compiled.bytes40));
  }
  return processPage(rawRows);
}

// ─── Layout ────────────────────────────────────────────────────

// Calculate frame position (centered horizontally)
const FRAME_W = 40; // 40 content, no side borders
const CONTENT_START_ROW = 2;   // 1-based; row 1 = top header
const STATUS_ROW = CONTENT_START_ROW + 25; // after 24 content rows
const INPUT_ROW = STATUS_ROW + 1;
const FASTEXT_ROW = INPUT_ROW + 1;
const HELP_ROW = FASTEXT_ROW + 1;

function getLeftCol(): number {
  const cols = process.stdout.columns || 80;
  return Math.max(1, Math.floor((cols - FRAME_W) / 2) + 1);
}

// ─── Rendering ─────────────────────────────────────────────────

function renderPage() {
  const left = getLeftCol();
  const page = getPage(currentPageNumber);

  // Top header with page number
  moveTo(CONTENT_START_ROW, left);
  resetSGR();
  const label = ` P${pageHex(currentPageNumber)} `;
  const pos = Math.floor((40 - label.length) / 2);
  process.stdout.write(
    '─'.repeat(pos) + label + '─'.repeat(40 - pos - label.length)
  );

  if (!page) {
    // Page not found — draw empty frame with message
    for (let r = 0; r < 24; r++) {
      moveTo(CONTENT_START_ROW + 1 + r, left);
      if (r === 11) {
        const msg = '   Page not available   ';
        const pad = ' '.repeat((40 - msg.length) / 2);
        process.stdout.write(`${CSI}37;40m${pad}${msg}${pad}${CSI}0m`);
      } else {
        process.stdout.write(`${CSI}40m${' '.repeat(40)}${CSI}0m`);
      }
    }
  } else {
    const grid = compilePageGrid(page, currentSubpage);
    const ansi = renderToAnsi(grid, {
      flashPhase,
      reveal,
      truecolor: true,
    });
    const rows = ansi.split('\n');
    for (let r = 0; r < 24; r++) {
      moveTo(CONTENT_START_ROW + 1 + r, left);
      process.stdout.write((rows[r] ?? `${CSI}40m${' '.repeat(40)}`) + `${CSI}0m`);
    }
  }

  renderStatusBar();
  renderInputBar();
  renderFastextBar();
  renderHelpBar();
}

function renderStatusBar() {
  const left = getLeftCol();
  const page = getPage(currentPageNumber);
  const totalSub = page?.subpages.length ?? 0;
  const subLabel = totalSub > 1 ? `Sub ${currentSubpage + 1}/${totalSub}` : '';
  const revLabel = reveal ? 'REVEAL' : '';
  const pgCount = `${service.pages.length} pages`;

  moveTo(STATUS_ROW, left);
  resetSGR();
  eraseToEOL();
  process.stdout.write(
    `${CSI}90m` + // dim gray
    `${pgCount}${subLabel ? '  ' + subLabel : ''}${revLabel ? '  ' + revLabel : ''}` +
    `${CSI}0m`
  );
}

function renderInputBar() {
  const left = getLeftCol();
  moveTo(INPUT_ROW, left);
  resetSGR();
  eraseToEOL();

  const display = inputBuffer.length > 0
    ? inputBuffer.padEnd(3, '_')
    : '___';

  process.stdout.write(
    `${CSI}1m Page: ${CSI}33mP${display}${CSI}0m` +
    `${CSI}90m  (type 3 hex digits)${CSI}0m`
  );
}

function renderFastextBar() {
  const left = getLeftCol();
  const page = getPage(currentPageNumber);
  const fl = page?.fastext;

  moveTo(FASTEXT_ROW, left);
  resetSGR();
  eraseToEOL();

  const red = fl?.red ? pageHex(fl.red) : '---';
  const green = fl?.green ? pageHex(fl.green) : '---';
  const yellow = fl?.yellow ? pageHex(fl.yellow) : '---';
  const cyan = fl?.cyan ? pageHex(fl.cyan) : '---';

  process.stdout.write(
    ` ${CSI}41;97m F1 ${red} ${CSI}0m` +
    ` ${CSI}42;97m F2 ${green} ${CSI}0m` +
    ` ${CSI}43;30m F3 ${yellow} ${CSI}0m` +
    ` ${CSI}46;30m F4 ${cyan} ${CSI}0m`
  );
}

function renderHelpBar() {
  const left = getLeftCol();
  moveTo(HELP_ROW, left);
  resetSGR();
  eraseToEOL();
  process.stdout.write(
    `${CSI}90m R=reveal  ←→=subpage  Q=quit${CSI}0m`
  );
}

// ─── Navigation ────────────────────────────────────────────────

function navigateTo(num: number) {
  currentPageNumber = num;
  currentSubpage = 0;
  renderPage();
}

function handleDigit(d: string) {
  if (inputTimeout) { clearTimeout(inputTimeout); inputTimeout = null; }

  inputBuffer += d;
  renderInputBar();

  if (inputBuffer.length >= 3) {
    const num = parseInt(inputBuffer, 16);
    inputBuffer = '';
    if (num >= 0x100 && num <= 0x8FF) {
      navigateTo(num);
    } else {
      renderInputBar();
    }
  } else {
    // Auto-clear after 5 seconds
    inputTimeout = setTimeout(() => {
      inputBuffer = '';
      inputTimeout = null;
      renderInputBar();
    }, 5000);
  }
}

function clearInput() {
  if (inputTimeout) { clearTimeout(inputTimeout); inputTimeout = null; }
  inputBuffer = '';
  renderInputBar();
}

function backspace() {
  if (inputBuffer.length > 0) {
    inputBuffer = inputBuffer.slice(0, -1);
    renderInputBar();
  }
}

function nextSubpage() {
  const page = getPage(currentPageNumber);
  if (!page || page.subpages.length <= 1) return;
  currentSubpage = (currentSubpage + 1) % page.subpages.length;
  renderPage();
}

function prevSubpage() {
  const page = getPage(currentPageNumber);
  if (!page || page.subpages.length <= 1) return;
  currentSubpage = (currentSubpage - 1 + page.subpages.length) % page.subpages.length;
  renderPage();
}

function toggleReveal() {
  reveal = !reveal;
  renderPage();
}

function fastextNav(color: 'red' | 'green' | 'yellow' | 'cyan') {
  const page = getPage(currentPageNumber);
  const target = page?.fastext?.[color];
  if (target) navigateTo(target);
}

// ─── Input handling ────────────────────────────────────────────

let flashInterval: ReturnType<typeof setInterval> | null = null;

function cleanup() {
  if (flashInterval) clearInterval(flashInterval);
  if (inputTimeout) clearTimeout(inputTimeout);
  showCursor();
  resetSGR();
  moveTo(HELP_ROW + 2, 1);
  process.stdout.write('\n');
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

function quit() {
  cleanup();
  process.exit(0);
}

// ─── Non-interactive fallback ──────────────────────────────────

if (!process.stdin.isTTY) {
  // One-shot render when not in a TTY (e.g. piped output)
  const page = getPage(currentPageNumber);
  if (!page) {
    process.stderr.write(`Page ${pageHex(currentPageNumber)} not found.\n`);
    process.exit(1);
  }
  for (let si = 0; si < page.subpages.length; si++) {
    const grid = compilePageGrid(page, si);
    const label = page.subpages.length > 1
      ? `${pageHex(page.pageNumber)}/${si + 1}`
      : pageHex(page.pageNumber);
    process.stdout.write(renderToAnsiFramed(grid, label, { truecolor: true }) + '\n');
    if (si < page.subpages.length - 1) process.stdout.write('\n');
  }
  process.exit(0);
}

// ─── Interactive mode ──────────────────────────────────────────

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');

process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('exit', () => { showCursor(); resetSGR(); });

// Handle terminal resize
process.stdout.on('resize', () => {
  clearScreen();
  renderPage();
});

process.stdin.on('data', (data: string) => {
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const code = ch.charCodeAt(0);

    // Escape sequences (arrows, function keys)
    if (ch === ESC && i + 1 < data.length) {
      if (data[i + 1] === '[') {
        // CSI sequence
        const seq = data.slice(i + 2, i + 6);
        if (seq.startsWith('D')) { // Left arrow
          prevSubpage();
          i += 2; continue;
        }
        if (seq.startsWith('C')) { // Right arrow
          nextSubpage();
          i += 2; continue;
        }
        // Function keys: F1=OP or [11~, F2=OQ or [12~, etc.
        if (seq.startsWith('11~') || seq.startsWith('1;') && data[i + 4] === 'P') {
          fastextNav('red');
          i += 4; continue;
        }
        if (seq.startsWith('12~')) {
          fastextNav('green');
          i += 4; continue;
        }
        if (seq.startsWith('13~')) {
          fastextNav('yellow');
          i += 4; continue;
        }
        if (seq.startsWith('14~')) {
          fastextNav('cyan');
          i += 4; continue;
        }
        i += 2; continue; // skip unknown CSI
      }
      if (data[i + 1] === 'O') {
        // SS3 function keys: F1=OP, F2=OQ, F3=OR, F4=OS
        const fk = data[i + 2];
        if (fk === 'P') { fastextNav('red');    i += 2; continue; }
        if (fk === 'Q') { fastextNav('green');  i += 2; continue; }
        if (fk === 'R') { fastextNav('yellow'); i += 2; continue; }
        if (fk === 'S') { fastextNav('cyan');   i += 2; continue; }
        i += 2; continue;
      }
      // Bare escape = clear input
      clearInput();
      continue;
    }

    // Ctrl-C
    if (code === 3) { quit(); return; }

    // Enter
    if (code === 13 || code === 10) {
      if (inputBuffer.length > 0) {
        // Pad short input and navigate
        const padded = inputBuffer.padEnd(3, '0');
        const num = parseInt(padded, 16);
        inputBuffer = '';
        if (num >= 0x100 && num <= 0x8FF) {
          navigateTo(num);
        } else {
          renderInputBar();
        }
      }
      continue;
    }

    // Backspace / Delete
    if (code === 127 || code === 8) { backspace(); continue; }

    // Quit
    if (ch === 'q' || ch === 'Q') { quit(); return; }

    // Reveal
    if (ch === 'r' || ch === 'R') { toggleReveal(); continue; }

    // Hex digits
    if (ch >= '0' && ch <= '9') { handleDigit(ch); continue; }
    if ((ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
      handleDigit(ch.toUpperCase());
      continue;
    }
  }
});

// ─── Initial draw ──────────────────────────────────────────────

flashInterval = setInterval(() => {
  flashPhase = !flashPhase;
  renderPage();
}, 1000);

hideCursor();
clearScreen();
renderPage();
