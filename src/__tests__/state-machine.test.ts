import { describe, it, expect } from 'vitest';
import {
  processRow,
  processPage,
  createDefaultRowState,
  Color,
  CharsetMode,
  MosaicType,
  ALPHA_RED,
  ALPHA_GREEN,
  ALPHA_CYAN,
  ALPHA_WHITE,
  MOSAIC_RED,
  MOSAIC_GREEN,
  MOSAIC_YELLOW,
  FLASH,
  STEADY,
  NORMAL_HEIGHT,
  DOUBLE_HEIGHT,
  CONCEAL,
  CONTIGUOUS_MOSAIC,
  SEPARATED_MOSAIC,
  BLACK_BACKGROUND,
  NEW_BACKGROUND,
  HOLD_MOSAIC,
  RELEASE_MOSAIC,
  START_BOX,
  END_BOX,
  ESC,
} from '../state-machine/index.js';

/** Helper: build a 40-byte row, filling remainder with spaces. */
function row(...bytes: number[]): number[] {
  const r = new Array(40).fill(0x20);
  for (let i = 0; i < bytes.length; i++) r[i] = bytes[i];
  return r;
}

describe('Default row state', () => {
  it('matches ETSI EN 300 706 defaults', () => {
    const s = createDefaultRowState();
    expect(s.fgColor).toBe(Color.WHITE);
    expect(s.bgColor).toBe(Color.BLACK);
    expect(s.charsetMode).toBe(CharsetMode.TEXT);
    expect(s.mosaicType).toBe(MosaicType.CONTIGUOUS);
    expect(s.holdGraphics).toBe(false);
    expect(s.heldMosaic).toBeNull();
    expect(s.doubleHeight).toBe(false);
    expect(s.flash).toBe(false);
    expect(s.conceal).toBe(false);
  });
});

describe('Foreground color control codes', () => {
  it('alpha color is set-after: control position uses old color', () => {
    // Col 0 = ALPHA_RED, Col 1 = 'A' (0x41)
    const cells = processRow(row(ALPHA_RED, 0x41));
    // Col 0: control code position — should still be WHITE (default)
    expect(cells[0].fgColor).toBe(Color.WHITE);
    // Col 1: RED takes effect
    expect(cells[1].fgColor).toBe(Color.RED);
    expect(cells[1].char).toBe(0x41);
  });

  it('multiple color changes in sequence', () => {
    const cells = processRow(row(ALPHA_RED, 0x41, ALPHA_GREEN, 0x42));
    expect(cells[1].fgColor).toBe(Color.RED);
    expect(cells[3].fgColor).toBe(Color.GREEN);
  });

  it('alpha color switches to text mode', () => {
    // Start in graphics mode, then alpha color should switch back
    const cells = processRow(row(MOSAIC_RED, 0x21, ALPHA_GREEN, 0x41));
    expect(cells[1].charsetMode).toBe(CharsetMode.GRAPHICS);
    expect(cells[3].charsetMode).toBe(CharsetMode.TEXT);
  });
});

describe('Mosaic (graphics) color control codes', () => {
  it('mosaic color switches to graphics mode', () => {
    const cells = processRow(row(MOSAIC_RED, 0x21));
    expect(cells[1].charsetMode).toBe(CharsetMode.GRAPHICS);
    expect(cells[1].fgColor).toBe(Color.RED);
  });

  it('mosaic characters update held mosaic', () => {
    const cells = processRow(row(MOSAIC_GREEN, 0x3F));
    expect(cells[1].char).toBe(0x3F);
    expect(cells[1].charsetMode).toBe(CharsetMode.GRAPHICS);
  });

  it('0x40-0x5F remain alpha even in graphics mode', () => {
    const cells = processRow(row(MOSAIC_RED, 0x41));
    expect(cells[1].charsetMode).toBe(CharsetMode.TEXT);
    expect(cells[1].char).toBe(0x41);
  });
});

describe('Flash / Steady', () => {
  it('flash activates after control code', () => {
    const cells = processRow(row(FLASH, 0x41));
    expect(cells[0].flash).toBe(false); // set-after
    expect(cells[1].flash).toBe(true);
  });

  it('steady cancels flash', () => {
    const cells = processRow(row(FLASH, 0x41, STEADY, 0x42));
    expect(cells[1].flash).toBe(true);
    expect(cells[3].flash).toBe(false);
  });
});

describe('Double Height', () => {
  it('set-after: takes effect from next position', () => {
    const cells = processRow(row(DOUBLE_HEIGHT, 0x41));
    expect(cells[0].doubleHeight).toBe(false);
    expect(cells[1].doubleHeight).toBe(true);
  });

  it('normal height cancels double height', () => {
    const cells = processRow(row(DOUBLE_HEIGHT, 0x41, NORMAL_HEIGHT, 0x42));
    expect(cells[1].doubleHeight).toBe(true);
    expect(cells[3].doubleHeight).toBe(false);
  });
});

describe('Conceal', () => {
  it('conceal is set-after', () => {
    const cells = processRow(row(CONCEAL, 0x41));
    expect(cells[0].conceal).toBe(false);
    expect(cells[1].conceal).toBe(true);
  });

  it('alpha color clears conceal', () => {
    const cells = processRow(row(CONCEAL, 0x41, ALPHA_RED, 0x42));
    expect(cells[1].conceal).toBe(true);
    expect(cells[3].conceal).toBe(false);
  });
});

describe('Background control', () => {
  it('black background sets bg to black', () => {
    // First set new background (fg=white → bg=white), then black bg
    const cells = processRow(row(NEW_BACKGROUND, 0x41, BLACK_BACKGROUND, 0x42));
    expect(cells[1].bgColor).toBe(Color.WHITE);
    expect(cells[3].bgColor).toBe(Color.BLACK);
  });

  it('new background sets bg to current fg color', () => {
    const cells = processRow(row(ALPHA_RED, NEW_BACKGROUND, 0x41));
    // Col 0: bg still BLACK (set-after for ALPHA_RED)
    // Col 1: NEW_BACKGROUND set-after — bg still BLACK at this position
    // Col 2: bg = RED (new bg applied)
    expect(cells[2].bgColor).toBe(Color.RED);
  });
});

describe('Hold / Release Mosaic', () => {
  it('held mosaic appears at control code positions', () => {
    // Enter graphics, render a mosaic char, enable hold, then a color change
    // should show the held mosaic instead of a space
    const cells = processRow(row(
      MOSAIC_RED,    // col 0: switch to graphics
      0x3F,          // col 1: mosaic char (held)
      HOLD_MOSAIC,   // col 2: hold ON (set-at)
      MOSAIC_GREEN,  // col 3: color change — should show held 0x3F
      0x21,          // col 4: new mosaic char
    ));
    expect(cells[2].char).toBe(0x3F); // held mosaic at hold position
    expect(cells[3].char).toBe(0x3F); // held mosaic at color change
    expect(cells[4].char).toBe(0x21); // normal render
  });

  it('release mosaic shows held char at release position then clears', () => {
    const cells = processRow(row(
      MOSAIC_RED,     // col 0
      0x3F,           // col 1: mosaic (held)
      HOLD_MOSAIC,    // col 2: hold ON
      RELEASE_MOSAIC, // col 3: release — show held, then release
      MOSAIC_GREEN,   // col 4: no hold — should show space
    ));
    expect(cells[3].char).toBe(0x3F); // held char shown at release pos
    expect(cells[4].char).toBe(0x20); // space — no more hold
  });

  it('without hold, control codes produce spaces', () => {
    const cells = processRow(row(ALPHA_RED, 0x41));
    expect(cells[0].char).toBe(0x20); // space at control code pos
  });
});

describe('Separated / Contiguous mosaic', () => {
  it('separated mosaic mode is tracked', () => {
    const cells = processRow(row(MOSAIC_RED, SEPARATED_MOSAIC, 0x3F));
    expect(cells[2].mosaicType).toBe(MosaicType.SEPARATED);
  });

  it('contiguous restores default mosaic type', () => {
    const cells = processRow(row(
      MOSAIC_RED, SEPARATED_MOSAIC, 0x3F, CONTIGUOUS_MOSAIC, 0x3F,
    ));
    expect(cells[2].mosaicType).toBe(MosaicType.SEPARATED);
    expect(cells[4].mosaicType).toBe(MosaicType.CONTIGUOUS);
  });
});

describe('ESC switch', () => {
  it('toggles escSwitch state', () => {
    // We can't directly observe escSwitch from Cell, but we can verify
    // no crash and the code runs through the ESC path.
    const cells = processRow(row(ESC, 0x41));
    expect(cells[1].char).toBe(0x41);
  });
});

describe('Box control codes', () => {
  it('start/end box are spacing codes that produce spaces', () => {
    const cells = processRow(row(START_BOX, 0x41, END_BOX, 0x42));
    expect(cells[0].char).toBe(0x20);
    expect(cells[1].char).toBe(0x41);
    expect(cells[2].char).toBe(0x20);
    expect(cells[3].char).toBe(0x42);
  });
});

describe('Parity stripping', () => {
  it('strips bit 7 from input bytes', () => {
    // 0xC1 = 0x41 with parity bit set
    const cells = processRow(row(0xC1));
    expect(cells[0].char).toBe(0x41);
  });
});

describe('processPage', () => {
  it('returns 24 rows of 40 cells', () => {
    const pageData: number[][] = [];
    for (let r = 0; r < 24; r++) {
      pageData.push(new Array(40).fill(0x20));
    }
    const grid = processPage(pageData);
    expect(grid.length).toBe(24);
    expect(grid[0].length).toBe(40);
  });

  it('marks double-height bottom rows', () => {
    const pageData: number[][] = [];
    for (let r = 0; r < 24; r++) {
      pageData.push(new Array(40).fill(0x20));
    }
    // Row 2: double height at col 0, then 'A'
    pageData[2][0] = DOUBLE_HEIGHT;
    pageData[2][1] = 0x41;

    const grid = processPage(pageData);
    expect(grid[2][1].doubleHeight).toBe(true);
    expect(grid[2][1].doubleHeightBottom).toBe(false);
    expect(grid[3][1].doubleHeight).toBe(true);
    expect(grid[3][1].doubleHeightBottom).toBe(true);
  });

  it('each row resets state independently', () => {
    const pageData: number[][] = [];
    for (let r = 0; r < 24; r++) {
      pageData.push(new Array(40).fill(0x20));
    }
    // Row 0: set red
    pageData[0][0] = ALPHA_RED;
    pageData[0][1] = 0x41;

    const grid = processPage(pageData);
    // Row 0 col 1 should be red
    expect(grid[0][1].fgColor).toBe(Color.RED);
    // Row 1 col 0 should be white (default)
    expect(grid[1][0].fgColor).toBe(Color.WHITE);
  });
});
