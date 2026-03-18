/**
 * Builds a sample teletext page as raw 24x40 byte arrays.
 * This mimics a typical broadcast page with colors, graphics, and text.
 */

import {
  ALPHA_RED,
  ALPHA_GREEN,
  ALPHA_YELLOW,
  ALPHA_CYAN,
  ALPHA_WHITE,
  ALPHA_BLUE,
  ALPHA_MAGENTA,
  MOSAIC_RED,
  MOSAIC_GREEN,
  MOSAIC_YELLOW,
  MOSAIC_BLUE,
  MOSAIC_CYAN,
  MOSAIC_WHITE,
  MOSAIC_MAGENTA,
  DOUBLE_HEIGHT,
  FLASH,
  STEADY,
  NEW_BACKGROUND,
  BLACK_BACKGROUND,
  HOLD_MOSAIC,
  RELEASE_MOSAIC,
  CONCEAL,
  SEPARATED_MOSAIC,
  CONTIGUOUS_MOSAIC,
} from '../src/state-machine/control-codes.js';

function row(...bytes: number[]): number[] {
  const r = new Array(40).fill(0x20);
  for (let i = 0; i < bytes.length; i++) r[i] = bytes[i];
  return r;
}

function textAt(r: number[], col: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    r[col + i] = text.charCodeAt(i);
  }
}

export function buildDemoPage(): number[][] {
  const page: number[][] = [];
  for (let i = 0; i < 24; i++) page.push(new Array(40).fill(0x20));

  // Row 0: Header bar — white on red background
  page[0] = row(ALPHA_RED, NEW_BACKGROUND, ALPHA_WHITE);
  textAt(page[0], 3, 'TELETEXT');
  page[0][12] = ALPHA_YELLOW;
  textAt(page[0], 13, 'System B Demo');
  page[0][27] = ALPHA_CYAN;
  textAt(page[0], 28, 'P100');
  // Fill rest with background
  for (let i = 33; i < 40; i++) page[0][i] = 0x20;

  // Row 1: separator — mosaic graphics bar
  page[1] = row(MOSAIC_CYAN);
  for (let i = 1; i < 40; i++) page[1][i] = 0x3F; // full block low range (5/6 filled)

  // Row 2-3: Double height title
  page[2] = row(DOUBLE_HEIGHT, ALPHA_YELLOW);
  textAt(page[2], 6, 'WELCOME TO TELETEXT');

  // Row 3: bottom half of double height (content overridden by processPage)
  page[3] = row(0x20);

  // Row 5: Color showcase
  page[5] = row(ALPHA_RED);
  textAt(page[5], 1, 'Red');
  page[5][5] = ALPHA_GREEN;
  textAt(page[5], 6, 'Green');
  page[5][12] = ALPHA_YELLOW;
  textAt(page[5], 13, 'Yellow');
  page[5][20] = ALPHA_BLUE;
  textAt(page[5], 21, 'Blue');
  page[5][25] = ALPHA_MAGENTA;
  textAt(page[5], 26, 'Magenta');
  page[5][34] = ALPHA_CYAN;
  textAt(page[5], 35, 'Cyan');

  // Row 7: Mosaic graphics demo — contiguous
  page[7] = row(ALPHA_WHITE);
  textAt(page[7], 1, 'Mosaic:');
  page[7][9] = MOSAIC_GREEN;
  page[7][10] = 0x21; // top-left block
  page[7][11] = 0x22; // top-right block
  page[7][12] = 0x24; // mid-left block
  page[7][13] = 0x28; // mid-right block
  page[7][14] = 0x30; // bottom-left block
  page[7][15] = 0x3F; // 5 blocks
  page[7][17] = MOSAIC_RED;
  page[7][18] = 0x7F; // all 6 blocks
  page[7][19] = 0x7F;
  page[7][20] = 0x7F;
  page[7][22] = MOSAIC_YELLOW;
  page[7][23] = 0x6A; // checkerboard-ish
  page[7][24] = 0x75; // inverse
  page[7][25] = 0x6A;
  page[7][26] = 0x75;

  // Row 8: Separated mosaic
  page[8] = row(ALPHA_WHITE);
  textAt(page[8], 1, 'Seprtd:');
  page[8][9] = MOSAIC_CYAN;
  page[8][10] = SEPARATED_MOSAIC;
  page[8][11] = 0x7F;
  page[8][12] = 0x7F;
  page[8][13] = 0x7F;
  page[8][14] = 0x7F;
  page[8][15] = 0x7F;
  page[8][17] = MOSAIC_MAGENTA;
  page[8][18] = 0x6A;
  page[8][19] = 0x75;
  page[8][20] = 0x6A;
  page[8][21] = 0x75;

  // Row 10: Hold graphics demo
  page[10] = row(ALPHA_WHITE);
  textAt(page[10], 1, 'Hold:');
  page[10][7] = MOSAIC_GREEN;
  page[10][8] = 0x3F; // mosaic char (gets held)
  page[10][9] = HOLD_MOSAIC;
  page[10][10] = MOSAIC_RED;     // held green 0x3F shown here
  page[10][11] = MOSAIC_YELLOW;  // held green 0x3F shown here (now red takes effect, but held is green)
  page[10][12] = 0x3F;           // now rendered as yellow
  page[10][13] = RELEASE_MOSAIC;

  // Row 12: Background color demo
  page[12] = row(ALPHA_CYAN);
  textAt(page[12], 1, 'Bg:');
  page[12][5] = ALPHA_WHITE;
  page[12][6] = NEW_BACKGROUND;  // bg = white (set-after)
  // cols 7+: white on white — can't see. Let's just show blocks instead.
  // Better approach: show colored background bars without text inside
  for (let i = 7; i < 13; i++) page[12][i] = 0x20; // white bg spaces
  page[12][13] = BLACK_BACKGROUND;
  page[12][14] = ALPHA_RED;
  page[12][15] = NEW_BACKGROUND;  // bg = red
  for (let i = 16; i < 22; i++) page[12][i] = 0x20; // red bg spaces
  page[12][22] = BLACK_BACKGROUND;
  page[12][23] = ALPHA_BLUE;
  page[12][24] = NEW_BACKGROUND;  // bg = blue
  for (let i = 25; i < 31; i++) page[12][i] = 0x20; // blue bg spaces
  page[12][31] = BLACK_BACKGROUND;
  page[12][32] = ALPHA_GREEN;
  page[12][33] = NEW_BACKGROUND;  // bg = green
  for (let i = 34; i < 40; i++) page[12][i] = 0x20; // green bg spaces

  // Row 14: Flash demo
  page[14] = row(ALPHA_WHITE);
  textAt(page[14], 1, 'Flash:');
  page[14][8] = ALPHA_YELLOW;
  page[14][9] = FLASH;
  textAt(page[14], 10, 'BLINK');
  page[14][16] = STEADY;
  textAt(page[14], 17, 'steady');

  // Row 16: Conceal demo
  page[16] = row(ALPHA_WHITE);
  textAt(page[16], 1, 'Conceal:');
  page[16][10] = ALPHA_GREEN;
  page[16][11] = CONCEAL;
  textAt(page[16], 12, 'HIDDEN');
  page[16][19] = ALPHA_WHITE;
  textAt(page[16], 20, '(reveal to see)');

  // Row 18-19: Mosaic art — simple house
  page[18] = row(MOSAIC_WHITE);
  page[18][14] = 0x20; page[18][15] = 0x20; page[18][16] = 0x21;
  page[18][17] = 0x32; page[18][18] = 0x34; page[18][19] = 0x22;
  page[18][20] = 0x20; page[18][21] = 0x20;

  page[19] = row(MOSAIC_WHITE);
  page[19][14] = 0x20; page[19][15] = 0x3F; page[19][16] = 0x3F;
  page[19][17] = 0x3F; page[19][18] = 0x3F; page[19][19] = 0x3F;
  page[19][20] = 0x3F; page[19][21] = 0x20;
  // Door
  page[19][17] = MOSAIC_YELLOW;
  page[19][18] = 0x36;

  // Row 22: Footer
  page[22] = row(MOSAIC_RED);
  for (let i = 1; i < 40; i++) page[22][i] = 0x3F;

  page[23] = row(ALPHA_CYAN);
  textAt(page[23], 1, 'ETSI EN 300 706 Level 1');
  page[23][26] = ALPHA_YELLOW;
  textAt(page[23], 27, 'TypeScript');

  return page;
}
