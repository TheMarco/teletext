import { describe, it, expect } from 'vitest';
import {
  compileRow,
  validateCompiledRow,
  compileSubpage,
  compilePage,
  compileService,
  DiagnosticCollector,
} from '../../src/compile/index.js';
import {
  createEmptyPage,
  createEmptySubpage,
  createEmptyRow,
  createEmptyService,
  charToken,
  controlToken,
  mosaicToken,
  fillToken,
  textTokens,
} from '../../src/model/factories.js';
import type { TeletextRow } from '../../src/model/types.js';

describe('compileRow', () => {
  it('compiles empty row to 40 spaces', () => {
    const row = createEmptyRow(0);
    const result = compileRow(row);
    expect(result.bytes40.length).toBe(40);
    expect(result.bytes40.every(b => b === 0x20)).toBe(true);
  });

  it('compiles char tokens to their codepoints', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [...textTokens('ABC'), fillToken(37)],
    };
    const result = compileRow(row);
    expect(result.bytes40[0]).toBe(0x41);
    expect(result.bytes40[1]).toBe(0x42);
    expect(result.bytes40[2]).toBe(0x43);
  });

  it('compiles control tokens to their codepoints', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [controlToken(0x07), controlToken(0x01), fillToken(38)],
    };
    const result = compileRow(row);
    expect(result.bytes40[0]).toBe(0x07);
    expect(result.bytes40[1]).toBe(0x01);
  });

  it('compiles mosaic tokens to their codepoints', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [mosaicToken(0x3F), fillToken(39)],
    };
    const result = compileRow(row);
    expect(result.bytes40[0]).toBe(0x3F);
  });

  it('expands fill tokens', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [fillToken(5, 0x2D), fillToken(35)],
    };
    const result = compileRow(row);
    for (let i = 0; i < 5; i++) expect(result.bytes40[i]).toBe(0x2D);
    expect(result.bytes40[5]).toBe(0x20);
  });

  it('strips comment tokens', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [
        charToken(0x41),
        { kind: 'comment', text: 'ignored' },
        charToken(0x42),
        fillToken(38),
      ],
    };
    const result = compileRow(row);
    expect(result.bytes40[0]).toBe(0x41);
    expect(result.bytes40[1]).toBe(0x42);
  });

  it('pads short rows with spaces', () => {
    const row: TeletextRow = {
      index: 5,
      tokens: [charToken(0x41)],
    };
    const result = compileRow(row);
    expect(result.rowNumber).toBe(5);
    expect(result.bytes40[0]).toBe(0x41);
    expect(result.bytes40[1]).toBe(0x20);
    expect(result.bytes40[39]).toBe(0x20);
  });

  it('truncates rows exceeding 40 columns with warning', () => {
    const diag = new DiagnosticCollector();
    // Use individual tokens to exceed 40 — fill stops at boundary silently
    const tokens = [];
    for (let i = 0; i < 45; i++) tokens.push(charToken(0x41));
    const row: TeletextRow = { index: 0, tokens };
    const result = compileRow(row, diag);
    expect(result.bytes40.length).toBe(40);
    expect(diag.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('reports error for invalid char code', () => {
    const diag = new DiagnosticCollector();
    const row: TeletextRow = {
      index: 0,
      tokens: [charToken(0x00), fillToken(39)], // 0x00 invalid for char
    };
    compileRow(row, diag);
    expect(diag.hasErrors()).toBe(true);
  });

  it('preserves row number in output', () => {
    const row: TeletextRow = { index: 15, tokens: [fillToken(40)] };
    expect(compileRow(row).rowNumber).toBe(15);
  });
});

describe('validateCompiledRow', () => {
  it('accepts valid 40-byte row', () => {
    const bytes = new Uint8Array(40).fill(0x20);
    expect(validateCompiledRow(bytes)).toBe(true);
  });

  it('rejects wrong-length row', () => {
    const diag = new DiagnosticCollector();
    expect(validateCompiledRow(new Uint8Array(10), diag)).toBe(false);
    expect(diag.hasErrors()).toBe(true);
  });

  it('rejects bytes above 0x7F', () => {
    const diag = new DiagnosticCollector();
    const bytes = new Uint8Array(40).fill(0x20);
    bytes[5] = 0x80;
    expect(validateCompiledRow(bytes, diag)).toBe(false);
  });
});

describe('compileSubpage', () => {
  it('produces header + 23 display packets', () => {
    const sp = createEmptySubpage(0);
    const result = compileSubpage(sp, 0x100);
    expect(result.headerPacket.packetNumber).toBe(0);
    expect(result.displayPackets.length).toBe(23);
    expect(result.pageNumber).toBe(0x100);
    expect(result.subcode).toBe(0);
  });

  it('header packet has correct magazine', () => {
    const sp = createEmptySubpage(0);
    const result = compileSubpage(sp, 0x300);
    expect(result.headerPacket.magazine).toBe(3);
  });

  it('display packets have correct row numbers', () => {
    const sp = createEmptySubpage(0);
    const result = compileSubpage(sp, 0x100);
    for (let i = 0; i < 23; i++) {
      expect(result.displayPackets[i].packetNumber).toBe(i + 1);
    }
  });

  it('includes fastext extension packet when provided', () => {
    const sp = createEmptySubpage(0);
    const fastext = { red: 0x200, green: 0x300 };
    const result = compileSubpage(sp, 0x100, fastext);
    expect(result.extensionPackets.length).toBe(1);
    expect(result.extensionPackets[0].packetNumber).toBe(27);
  });
});

describe('compilePage', () => {
  it('compiles all subpages', () => {
    const page = createEmptyPage(0x100);
    page.subpages.push(createEmptySubpage(1));
    const results = compilePage(page);
    expect(results.length).toBe(2);
    expect(results[0].subcode).toBe(0);
    expect(results[1].subcode).toBe(1);
  });
});

describe('compileService', () => {
  it('compiles all pages in service', () => {
    const svc = createEmptyService('s1');
    svc.pages = [createEmptyPage(0x100), createEmptyPage(0x200)];
    const result = compileService(svc);
    expect(result.pages.length).toBe(2);
  });

  it('collects diagnostics from all pages', () => {
    const svc = createEmptyService('s1');
    const page = createEmptyPage(0x100);
    // Invalid char in row 0
    page.subpages[0].rows[0] = {
      index: 0,
      tokens: [charToken(0x00), fillToken(39)],
    };
    svc.pages = [page];
    const result = compileService(svc);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('Compiler determinism', () => {
  it('same page compiles to identical packets twice', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].rows[5] = {
      index: 5,
      tokens: [controlToken(0x07), ...textTokens('HELLO'), fillToken(34)],
    };
    const r1 = compilePage(page);
    const r2 = compilePage(page);
    expect(r1.length).toBe(r2.length);
    for (let i = 0; i < r1.length; i++) {
      expect(Array.from(r1[i].headerPacket.payload)).toEqual(Array.from(r2[i].headerPacket.payload));
      for (let j = 0; j < r1[i].displayPackets.length; j++) {
        expect(Array.from(r1[i].displayPackets[j].payload)).toEqual(Array.from(r2[i].displayPackets[j].payload));
      }
    }
  });
});

describe('Control-code preservation through compiler', () => {
  it('control codes pass through to compiled bytes unchanged', () => {
    const row: TeletextRow = {
      index: 2,
      tokens: [
        controlToken(0x01), // alpha red
        controlToken(0x08), // flash
        ...textTokens('HI'),
        controlToken(0x09), // steady
        fillToken(35),
      ],
    };
    const result = compileRow(row);
    expect(result.bytes40[0]).toBe(0x01);
    expect(result.bytes40[1]).toBe(0x08);
    expect(result.bytes40[2]).toBe(0x48); // H
    expect(result.bytes40[3]).toBe(0x49); // I
    expect(result.bytes40[4]).toBe(0x09);
  });
});
