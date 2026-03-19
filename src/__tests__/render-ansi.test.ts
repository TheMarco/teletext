import { describe, it, expect } from 'vitest';
import { processPage, Color, ALPHA_RED, ALPHA_GREEN, FLASH, CONCEAL, MOSAIC_GREEN, DOUBLE_HEIGHT } from '../state-machine/index.js';
import { renderToAnsi, renderToAnsiFramed } from '../render-ansi/index.js';

function blankPage(): number[][] {
  const page: number[][] = [];
  for (let r = 0; r < 24; r++) page.push(new Array(40).fill(0x20));
  return page;
}

describe('renderToAnsi', () => {
  it('produces 24 lines', () => {
    const grid = processPage(blankPage());
    const output = renderToAnsi(grid);
    const lines = output.split('\n');
    expect(lines.length).toBe(24);
  });

  it('blank page contains only spaces and color codes', () => {
    const grid = processPage(blankPage());
    const output = renderToAnsi(grid);
    // Strip all ANSI escape sequences
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    // Should be 24 lines of 40 spaces each
    const lines = stripped.split('\n');
    for (const line of lines) {
      expect(line).toBe(' '.repeat(40));
    }
  });

  it('renders G0 text characters', () => {
    const page = blankPage();
    page[1][0] = ALPHA_RED;
    page[1][1] = 0x48; // H
    page[1][2] = 0x49; // I

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = stripped.split('\n');
    // col 0 = control code renders as space, col 1 = H, col 2 = I
    expect(lines[1][0]).toBe(' ');
    expect(lines[1][1]).toBe('H');
    expect(lines[1][2]).toBe('I');
  });

  it('emits correct ANSI foreground color for red text', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;
    page[0][1] = 0x41; // A

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    // Should contain SGR with fg=31 (red) and bg=40 (black)
    expect(output).toContain('\x1b[31;40m');
  });

  it('emits correct ANSI foreground color for green text', () => {
    const page = blankPage();
    page[0][0] = ALPHA_GREEN;

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    expect(output).toContain('\x1b[32;40m');
  });

  it('truecolor mode uses 24-bit sequences', () => {
    const page = blankPage();
    page[0][0] = ALPHA_RED;

    const grid = processPage(page);
    const output = renderToAnsi(grid, { truecolor: true });
    // Red fg = 255;0;0, black bg = 0;0;0
    expect(output).toContain('38;2;255;0;0');
    expect(output).toContain('48;2;0;0;0');
  });

  it('flash hidden phase renders spaces', () => {
    const page = blankPage();
    page[0][0] = FLASH;
    page[0][1] = 0x41; // A

    const grid = processPage(page);
    const visible = renderToAnsi(grid, { flashPhase: true });
    const hidden = renderToAnsi(grid, { flashPhase: false });

    const visStripped = visible.replace(/\x1b\[[0-9;]*m/g, '');
    const hidStripped = hidden.replace(/\x1b\[[0-9;]*m/g, '');

    expect(visStripped.split('\n')[0][1]).toBe('A');
    expect(hidStripped.split('\n')[0][1]).toBe(' ');
  });

  it('concealed cells hidden unless reveal=true', () => {
    const page = blankPage();
    page[0][0] = CONCEAL;
    page[0][1] = 0x41; // A

    const grid = processPage(page);
    const concealed = renderToAnsi(grid, { reveal: false });
    const revealed = renderToAnsi(grid, { reveal: true });

    const conStripped = concealed.replace(/\x1b\[[0-9;]*m/g, '');
    const revStripped = revealed.replace(/\x1b\[[0-9;]*m/g, '');

    expect(conStripped.split('\n')[0][1]).toBe(' ');
    expect(revStripped.split('\n')[0][1]).toBe('A');
  });

  it('renders mosaic characters as Unicode sextants', () => {
    const page = blankPage();
    // Switch to green mosaic mode
    page[1][0] = MOSAIC_GREEN;
    // Full block mosaic: 0x7F = all 6 bits set (pattern 63)
    page[1][1] = 0x7F;
    // Empty mosaic: 0x20 = no bits set (pattern 0)
    page[1][2] = 0x20;

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    const row = stripped.split('\n')[1];

    // Full block → U+2588 (█)
    expect(row[1]).toBe('\u2588');
    // Empty → space
    expect(row[2]).toBe(' ');
  });

  it('renders partial mosaic sextant patterns', () => {
    const page = blankPage();
    page[1][0] = MOSAIC_GREEN;
    // 0x21 = pattern 1 (only top-left set)
    page[1][1] = 0x21;

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    const row = stripped.split('\n')[1];

    // Pattern 1 in Teletext = bit 0 (TL) set
    // In Unicode sextant order: also bit 0 → U+1FB00
    expect(row.codePointAt(1)).toBe(0x1FB00);
  });

  it('maps left-column pattern to LEFT HALF BLOCK', () => {
    const page = blankPage();
    page[1][0] = MOSAIC_GREEN;
    // Pattern 21 = 0b010101 = bits 0,2,4 = TL+ML+BL = left column
    // charCode for pattern 21: 0x20 + 21 = 0x35
    page[1][1] = 0x35;

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    const row = stripped.split('\n')[1];

    // Pattern 21 → U+258C LEFT HALF BLOCK
    expect(row.codePointAt(1)).toBe(0x258C);
  });

  it('maps right-column pattern to RIGHT HALF BLOCK', () => {
    const page = blankPage();
    page[1][0] = MOSAIC_GREEN;
    // Pattern 42 = 0b101010 = bits 1,3,5 = TR+MR+BR = right column
    // charCode: 42 > 31, so it's in the 0x60-0x7F range
    // bits = (charCode - 0x60) | 0x20 = 42
    // (charCode - 0x60) = 42 - 32 = 10, so charCode = 0x6A
    page[1][1] = 0x6A;

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
    const row = stripped.split('\n')[1];

    // Pattern 42 → U+2590 RIGHT HALF BLOCK
    expect(row.codePointAt(1)).toBe(0x2590);
  });

  it('emits DEC double-height sequences', () => {
    const page = blankPage();
    // Row 2: double height "BIG"
    page[2][0] = DOUBLE_HEIGHT;
    page[2][1] = ALPHA_RED;
    page[2][2] = 0x42; // B
    page[2][3] = 0x49; // I
    page[2][4] = 0x47; // G

    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const lines = output.split('\n');

    // Row 2 should start with DECDHL top half
    expect(lines[2]).toContain('\x1b#3');
    // Row 3 should start with DECDHL bottom half
    expect(lines[3]).toContain('\x1b#4');
    // Row 4 (normal) should NOT have DECDHL
    expect(lines[4]).not.toContain('\x1b#');

    // Both rows should contain the same text characters
    const strip = (s: string) => s.replace(/\x1b#[0-9]/g, '').replace(/\x1b\[[0-9;]*m/g, '');
    expect(strip(lines[2]).substring(2, 5)).toBe('BIG');
    expect(strip(lines[3]).substring(2, 5)).toBe('BIG');
  });

  it('each line ends with SGR reset', () => {
    const grid = processPage(blankPage());
    const output = renderToAnsi(grid);
    const lines = output.split('\n');
    for (const line of lines) {
      expect(line.endsWith('\x1b[0m')).toBe(true);
    }
  });

  it('only emits SGR when colors change', () => {
    const page = blankPage();
    // Row 0: default white on black for all 40 cols (no control codes)
    const grid = processPage(page);
    const output = renderToAnsi(grid);
    const row0 = output.split('\n')[0];

    // Count SGR sequences — should be just the initial one + reset
    const sgrs = row0.match(/\x1b\[[0-9;]*m/g) || [];
    expect(sgrs.length).toBe(2); // initial color + reset
  });
});

describe('renderToAnsiFramed', () => {
  it('adds border around content', () => {
    const grid = processPage(blankPage());
    const output = renderToAnsiFramed(grid);
    const lines = output.split('\n');
    // 24 content rows + top border + bottom border = 26
    expect(lines.length).toBe(26);
    expect(lines[0]).toContain('┌');
    expect(lines[25]).toContain('└');
  });

  it('includes page number in header', () => {
    const grid = processPage(blankPage());
    const output = renderToAnsiFramed(grid, '100');
    expect(output.split('\n')[0]).toContain('P100');
  });
});
