/**
 * Golden test fixtures: known page data for pixel-perfect validation.
 * Each fixture defines a specific scenario with deterministic byte data.
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
  MOSAIC_CYAN,
  FLASH,
  STEADY,
  DOUBLE_HEIGHT,
  NORMAL_HEIGHT,
  CONCEAL,
  HOLD_MOSAIC,
  RELEASE_MOSAIC,
  NEW_BACKGROUND,
  BLACK_BACKGROUND,
  SEPARATED_MOSAIC,
  CONTIGUOUS_MOSAIC,
} from '../../state-machine/control-codes.js';

export interface GoldenFixture {
  name: string;
  description: string;
  page: number[][];
  flashPhase: boolean;
  reveal: boolean;
}

function blankPage(): number[][] {
  const page: number[][] = [];
  for (let r = 0; r < 24; r++) page.push(new Array(40).fill(0x20));
  return page;
}

function textAt(r: number[], col: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    r[col + i] = text.charCodeAt(i);
  }
}

/**
 * Fixture 1: Blank page — all spaces, white on black.
 */
function blankFixture(): GoldenFixture {
  return {
    name: 'blank',
    description: 'Empty page: all spaces, default colors',
    page: blankPage(),
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 2: All foreground colors with text.
 */
function colorsFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = ALPHA_RED;
  textAt(page[0], 1, 'RED');
  page[1][0] = ALPHA_GREEN;
  textAt(page[1], 1, 'GREEN');
  page[2][0] = ALPHA_YELLOW;
  textAt(page[2], 1, 'YELLOW');
  page[3][0] = ALPHA_BLUE;
  textAt(page[3], 1, 'BLUE');
  page[4][0] = ALPHA_MAGENTA;
  textAt(page[4], 1, 'MAGENTA');
  page[5][0] = ALPHA_CYAN;
  textAt(page[5], 1, 'CYAN');
  page[6][0] = ALPHA_WHITE;
  textAt(page[6], 1, 'WHITE');
  return {
    name: 'colors',
    description: 'All 7 foreground colors with text labels',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 3: Mosaic characters — contiguous and separated.
 */
function mosaicFixture(): GoldenFixture {
  const page = blankPage();
  // Row 0: contiguous mosaics — all single-bit patterns
  page[0][0] = MOSAIC_GREEN;
  page[0][1] = 0x21; // bit 0
  page[0][2] = 0x22; // bit 1
  page[0][3] = 0x24; // bit 2
  page[0][4] = 0x28; // bit 3
  page[0][5] = 0x30; // bit 4
  page[0][6] = 0x60; // bit 5 (high range)
  page[0][7] = 0x7F; // all bits

  // Row 1: separated mosaics — same patterns
  page[1][0] = MOSAIC_CYAN;
  page[1][1] = SEPARATED_MOSAIC;
  page[1][2] = 0x21;
  page[1][3] = 0x22;
  page[1][4] = 0x24;
  page[1][5] = 0x28;
  page[1][6] = 0x30;
  page[1][7] = 0x60;
  page[1][8] = 0x7F;

  // Row 2: checkerboard patterns
  page[2][0] = MOSAIC_YELLOW;
  page[2][1] = 0x35; // bits 0,2,4 = diagonal
  page[2][2] = 0x6A; // bits 1,3,5 = inverse diagonal

  return {
    name: 'mosaic',
    description: 'Mosaic characters: contiguous, separated, patterns',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 4: Double height text.
 */
function doubleHeightFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = DOUBLE_HEIGHT;
  page[0][1] = ALPHA_WHITE;
  textAt(page[0], 2, 'ABCDEF');
  // Row 1 will be bottom half
  return {
    name: 'double-height',
    description: 'Double height text with top and bottom halves',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 5: Hold graphics.
 */
function holdGraphicsFixture(): GoldenFixture {
  const page = blankPage();
  // Mosaic char, then hold, then color changes
  page[0][0] = MOSAIC_GREEN;
  page[0][1] = 0x3F;        // mosaic (held)
  page[0][2] = HOLD_MOSAIC;
  page[0][3] = MOSAIC_RED;  // held green shows
  page[0][4] = MOSAIC_YELLOW; // held shows (now red fg)
  page[0][5] = 0x21;        // new mosaic char
  page[0][6] = RELEASE_MOSAIC;
  page[0][7] = MOSAIC_CYAN; // space (no hold)
  return {
    name: 'hold-graphics',
    description: 'Hold graphics behavior across color changes',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 6: Background colors.
 */
function backgroundFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = ALPHA_RED;
  page[0][1] = NEW_BACKGROUND;
  textAt(page[0], 2, 'RBG');
  page[0][6] = BLACK_BACKGROUND;
  textAt(page[0], 7, 'BLK');
  page[1][0] = ALPHA_CYAN;
  page[1][1] = NEW_BACKGROUND;
  // Fill with spaces to show background
  for (let i = 2; i < 20; i++) page[1][i] = 0x20;
  return {
    name: 'background',
    description: 'Background color changes and reset',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 7: Flash OFF phase — flashing text hidden.
 */
function flashOffFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = ALPHA_WHITE;
  page[0][1] = FLASH;
  textAt(page[0], 2, 'BLINK');
  page[0][8] = STEADY;
  textAt(page[0], 9, 'STEADY');
  return {
    name: 'flash-off',
    description: 'Flash OFF phase: flashing text hidden, steady visible',
    page,
    flashPhase: false, // OFF phase
    reveal: false,
  };
}

/**
 * Fixture 8: Flash ON phase — everything visible.
 */
function flashOnFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = ALPHA_WHITE;
  page[0][1] = FLASH;
  textAt(page[0], 2, 'BLINK');
  page[0][8] = STEADY;
  textAt(page[0], 9, 'STEADY');
  return {
    name: 'flash-on',
    description: 'Flash ON phase: everything visible',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 9: Conceal with reveal OFF.
 */
function concealHiddenFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = ALPHA_GREEN;
  page[0][1] = CONCEAL;
  textAt(page[0], 2, 'HIDDEN');
  page[0][9] = ALPHA_WHITE;
  textAt(page[0], 10, 'VISIBLE');
  return {
    name: 'conceal-hidden',
    description: 'Concealed text with reveal OFF',
    page,
    flashPhase: true,
    reveal: false,
  };
}

/**
 * Fixture 10: Conceal with reveal ON.
 */
function concealRevealedFixture(): GoldenFixture {
  const page = blankPage();
  page[0][0] = ALPHA_GREEN;
  page[0][1] = CONCEAL;
  textAt(page[0], 2, 'HIDDEN');
  page[0][9] = ALPHA_WHITE;
  textAt(page[0], 10, 'VISIBLE');
  return {
    name: 'conceal-revealed',
    description: 'Concealed text with reveal ON',
    page,
    flashPhase: true,
    reveal: true,
  };
}

export const GOLDEN_FIXTURES: GoldenFixture[] = [
  blankFixture(),
  colorsFixture(),
  mosaicFixture(),
  doubleHeightFixture(),
  holdGraphicsFixture(),
  backgroundFixture(),
  flashOffFixture(),
  flashOnFixture(),
  concealHiddenFixture(),
  concealRevealedFixture(),
];
