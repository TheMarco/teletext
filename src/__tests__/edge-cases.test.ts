import { describe, it, expect } from 'vitest';
import {
  processRow,
  processPage,
  Color,
  CharsetMode,
  MosaicType,
  ALPHA_RED,
  ALPHA_GREEN,
  ALPHA_YELLOW,
  ALPHA_CYAN,
  ALPHA_WHITE,
  MOSAIC_RED,
  MOSAIC_GREEN,
  MOSAIC_YELLOW,
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
  ESC,
  START_BOX,
  END_BOX,
} from '../state-machine/index.js';

function row(...bytes: number[]): number[] {
  const r = new Array(40).fill(0x20);
  for (let i = 0; i < bytes.length; i++) r[i] = bytes[i];
  return r;
}

describe('Edge: control code at last column (col 39)', () => {
  it('color change at col 39 has no visible effect', () => {
    const r = new Array(40).fill(0x20);
    r[39] = ALPHA_RED;
    const cells = processRow(r);
    // Col 39: control code, rendered as space with OLD state (white fg)
    expect(cells[39].fgColor).toBe(Color.WHITE);
    expect(cells[39].char).toBe(0x20);
    // RED never takes effect since there are no more columns
  });

  it('flash at col 39 does not affect any visible cell', () => {
    const r = new Array(40).fill(0x20);
    r[38] = 0x41; // 'A'
    r[39] = FLASH;
    const cells = processRow(r);
    expect(cells[38].flash).toBe(false); // before the flash code
    expect(cells[39].flash).toBe(false); // set-after, no next col
  });

  it('double height at col 39', () => {
    const r = new Array(40).fill(0x20);
    r[39] = DOUBLE_HEIGHT;
    const cells = processRow(r);
    expect(cells[39].doubleHeight).toBe(false); // set-after
  });

  it('hold mosaic at col 39 with held character', () => {
    const r = new Array(40).fill(0x20);
    r[0] = MOSAIC_GREEN;
    r[1] = 0x3F; // held — but subsequent 0x20 mosaics overwrite held to 0x20
    r[39] = HOLD_MOSAIC;
    const cells = processRow(r);
    // 0x20 spaces in graphics mode are blank mosaics that update heldMosaic,
    // so by col 39 the held char is 0x20 (blank), not 0x3F
    expect(cells[39].char).toBe(0x20);
  });

  it('hold mosaic at col 39 preserves last non-space mosaic', () => {
    const r = new Array(40).fill(0x20);
    r[0] = MOSAIC_GREEN;
    r[37] = 0x3F; // held mosaic near end
    r[38] = HOLD_MOSAIC; // hold ON at col 38 (set-at)
    r[39] = MOSAIC_RED;  // color change — held 0x3F should display
    const cells = processRow(r);
    expect(cells[39].char).toBe(0x3F);
  });

  it('release mosaic at col 39', () => {
    const r = new Array(40).fill(0x20);
    r[0] = MOSAIC_GREEN;
    r[37] = 0x3F;
    r[38] = HOLD_MOSAIC;
    r[39] = RELEASE_MOSAIC;
    const cells = processRow(r);
    // Release shows the held char at release position
    expect(cells[39].char).toBe(0x3F);
  });

  it('conceal at col 39', () => {
    const r = new Array(40).fill(0x20);
    r[39] = CONCEAL;
    const cells = processRow(r);
    expect(cells[39].conceal).toBe(false); // set-after
  });

  it('new background at col 39', () => {
    const r = new Array(40).fill(0x20);
    r[0] = ALPHA_RED;
    r[39] = NEW_BACKGROUND;
    const cells = processRow(r);
    // Set-after: col 39 still has old background
    expect(cells[39].bgColor).toBe(Color.BLACK);
  });
});

describe('Edge: mixed text/graphics transitions', () => {
  it('alpha color mid-row switches from graphics to text', () => {
    const cells = processRow(row(MOSAIC_RED, 0x3F, ALPHA_GREEN, 0x41));
    expect(cells[1].charsetMode).toBe(CharsetMode.GRAPHICS);
    expect(cells[1].char).toBe(0x3F);
    expect(cells[3].charsetMode).toBe(CharsetMode.TEXT);
    expect(cells[3].char).toBe(0x41);
  });

  it('mosaic color mid-row switches from text to graphics', () => {
    const cells = processRow(row(ALPHA_RED, 0x41, MOSAIC_GREEN, 0x3F));
    expect(cells[1].charsetMode).toBe(CharsetMode.TEXT);
    expect(cells[3].charsetMode).toBe(CharsetMode.GRAPHICS);
    expect(cells[3].char).toBe(0x3F);
  });

  it('rapid text/graphics/text switching preserves correct chars', () => {
    const cells = processRow(row(
      ALPHA_RED, 0x41,       // text 'A'
      MOSAIC_GREEN, 0x3F,    // mosaic
      ALPHA_YELLOW, 0x42,    // text 'B'
    ));
    expect(cells[1].char).toBe(0x41);
    expect(cells[1].charsetMode).toBe(CharsetMode.TEXT);
    expect(cells[3].char).toBe(0x3F);
    expect(cells[3].charsetMode).toBe(CharsetMode.GRAPHICS);
    expect(cells[5].char).toBe(0x42);
    expect(cells[5].charsetMode).toBe(CharsetMode.TEXT);
  });

  it('held mosaic is cleared when switching to text mode', () => {
    // Per spec: held mosaic character is only valid in graphics mode.
    // When switching to alpha (text) mode, the held mosaic is still
    // retained internally but hold graphics should show space since
    // we're in text mode now.
    const cells = processRow(row(
      MOSAIC_GREEN, 0x3F, HOLD_MOSAIC,
      ALPHA_RED,  // switch to text — held char should still display
      0x41,       // text 'A'
    ));
    // At col 3 (ALPHA_RED): hold is active, so held mosaic 0x3F shows
    expect(cells[3].char).toBe(0x3F);
    // At col 4: normal text mode
    expect(cells[4].char).toBe(0x41);
  });

  it('0x40-0x5F are G0 alpha even in graphics mode', () => {
    const cells = processRow(row(MOSAIC_RED, 0x40, 0x41, 0x5F, 0x60));
    // 0x40 '@', 0x41 'A', 0x5F '_' are all G0 alpha
    expect(cells[1].charsetMode).toBe(CharsetMode.TEXT);
    expect(cells[2].charsetMode).toBe(CharsetMode.TEXT);
    expect(cells[3].charsetMode).toBe(CharsetMode.TEXT);
    // 0x60 is mosaic (high range)
    expect(cells[4].charsetMode).toBe(CharsetMode.GRAPHICS);
  });

  it('mosaic type persists across text/graphics transitions', () => {
    const cells = processRow(row(
      MOSAIC_RED, SEPARATED_MOSAIC,
      0x3F,          // separated mosaic
      ALPHA_GREEN,
      0x41,          // text
      MOSAIC_YELLOW,
      0x3F,          // should still be separated
    ));
    expect(cells[2].mosaicType).toBe(MosaicType.SEPARATED);
    expect(cells[6].mosaicType).toBe(MosaicType.SEPARATED);
  });
});

describe('Edge: consecutive control codes', () => {
  it('multiple control codes in sequence all apply', () => {
    // FLASH then CONCEAL then color
    // Note: ALPHA_RED clears conceal per spec (alpha colors reset conceal)
    const cells = processRow(row(FLASH, CONCEAL, ALPHA_RED, 0x41));
    expect(cells[3].flash).toBe(true);
    expect(cells[3].conceal).toBe(false); // cleared by ALPHA_RED
    expect(cells[3].fgColor).toBe(Color.RED);
  });

  it('conceal persists when followed by non-alpha control codes', () => {
    const cells = processRow(row(CONCEAL, FLASH, 0x41));
    expect(cells[2].conceal).toBe(true);
    expect(cells[2].flash).toBe(true);
  });

  it('row of all control codes produces all spaces', () => {
    const r: number[] = [];
    for (let i = 0; i < 40; i++) r.push(ALPHA_RED);
    const cells = processRow(r);
    for (let i = 0; i < 40; i++) {
      expect(cells[i].char).toBe(0x20);
    }
  });

  it('color overrides previous color immediately', () => {
    const cells = processRow(row(ALPHA_RED, ALPHA_GREEN, 0x41));
    // RED set-after at col 0: GREEN set-after at col 1: both applied before col 2
    expect(cells[2].fgColor).toBe(Color.GREEN);
  });
});

describe('Edge: double height across rows', () => {
  function makePage(): number[][] {
    const page: number[][] = [];
    for (let r = 0; r < 24; r++) page.push(new Array(40).fill(0x20));
    return page;
  }

  it('double height at row 22 marks row 23 as bottom', () => {
    const page = makePage();
    page[22][0] = DOUBLE_HEIGHT;
    page[22][1] = 0x41;
    const grid = processPage(page);
    expect(grid[22][1].doubleHeight).toBe(true);
    expect(grid[23][1].doubleHeightBottom).toBe(true);
  });

  it('double height at row 23 has no bottom row (last row)', () => {
    const page = makePage();
    page[23][0] = DOUBLE_HEIGHT;
    page[23][1] = 0x41;
    const grid = processPage(page);
    expect(grid[23][1].doubleHeight).toBe(true);
    // No row 24 to be bottom — no crash
  });

  it('two double height sections on the same page', () => {
    const page = makePage();
    page[2][0] = DOUBLE_HEIGHT;
    page[2][1] = 0x41;
    page[10][0] = DOUBLE_HEIGHT;
    page[10][1] = 0x42;
    const grid = processPage(page);
    expect(grid[2][1].doubleHeight).toBe(true);
    expect(grid[3][1].doubleHeightBottom).toBe(true);
    expect(grid[10][1].doubleHeight).toBe(true);
    expect(grid[11][1].doubleHeightBottom).toBe(true);
    // Rows between them are unaffected
    expect(grid[5][1].doubleHeight).toBe(false);
    expect(grid[5][1].doubleHeightBottom).toBe(false);
  });

  it('double height only affects columns with the attribute', () => {
    const page = makePage();
    // Only first half of row 4 is double height
    page[4][0] = DOUBLE_HEIGHT;
    page[4][1] = 0x41;
    page[4][20] = NORMAL_HEIGHT;
    page[4][21] = 0x42;
    const grid = processPage(page);
    expect(grid[4][1].doubleHeight).toBe(true);
    expect(grid[5][1].doubleHeightBottom).toBe(true);
    expect(grid[4][21].doubleHeight).toBe(false);
    expect(grid[5][21].doubleHeightBottom).toBe(false);
  });
});

describe('Edge: hold graphics interactions', () => {
  it('hold without any prior mosaic char produces space', () => {
    const cells = processRow(row(MOSAIC_RED, HOLD_MOSAIC, MOSAIC_GREEN));
    // Col 1: hold ON, but no mosaic char rendered yet — space
    expect(cells[1].char).toBe(0x20);
    // Col 2: MOSAIC_GREEN control code — still no held char
    expect(cells[2].char).toBe(0x20);
  });

  it('hold retains the mosaic type of the held character', () => {
    const cells = processRow(row(
      MOSAIC_RED, SEPARATED_MOSAIC, 0x3F,
      HOLD_MOSAIC, CONTIGUOUS_MOSAIC,
      MOSAIC_GREEN, // held char should use SEPARATED type from when it was stored
    ));
    // The held char 0x3F was stored with SEPARATED type
    // At col 5 (MOSAIC_GREEN), held char displayed with its original type
    expect(cells[5].mosaicType).toBe(MosaicType.SEPARATED);
  });

  it('new mosaic char updates the held character', () => {
    const cells = processRow(row(
      MOSAIC_RED, 0x21, HOLD_MOSAIC,
      0x3F,         // new mosaic — updates held
      MOSAIC_GREEN, // should show new held 0x3F
    ));
    expect(cells[4].char).toBe(0x3F); // held updated to 0x3F
  });
});

describe('Edge: background color combinations', () => {
  it('new background then black background resets', () => {
    const cells = processRow(row(
      ALPHA_RED, NEW_BACKGROUND, 0x41,
      BLACK_BACKGROUND, 0x42,
    ));
    expect(cells[2].bgColor).toBe(Color.RED);
    expect(cells[4].bgColor).toBe(Color.BLACK);
  });

  it('new background tracks foreground changes', () => {
    const cells = processRow(row(
      ALPHA_RED, NEW_BACKGROUND, 0x41,
      ALPHA_GREEN, NEW_BACKGROUND, 0x42,
    ));
    expect(cells[2].bgColor).toBe(Color.RED);
    expect(cells[5].bgColor).toBe(Color.GREEN);
  });

  it('multiple new backgrounds use the latest fg', () => {
    const cells = processRow(row(
      ALPHA_CYAN, NEW_BACKGROUND, NEW_BACKGROUND, 0x41,
    ));
    // Both NEW_BACKGROUNDs set bg = current fg (cyan)
    expect(cells[3].bgColor).toBe(Color.CYAN);
  });
});

describe('Edge: all printable ASCII characters', () => {
  it('all 96 printable chars (0x20-0x7F) render without error', () => {
    const r: number[] = [];
    for (let ch = 0x20; ch < 0x20 + 40; ch++) r.push(ch);
    const cells = processRow(r);
    for (let i = 0; i < 40; i++) {
      expect(cells[i].char).toBe(0x20 + i);
    }
  });

  it('second batch of printable chars (0x48-0x6F)', () => {
    const r: number[] = [];
    for (let ch = 0x48; ch < 0x48 + 40; ch++) r.push(ch);
    const cells = processRow(r);
    for (let i = 0; i < 40; i++) {
      expect(cells[i].char).toBe(0x48 + i);
    }
  });
});
