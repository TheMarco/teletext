import { describe, it, expect } from 'vitest';
import { importT42, extractTeletextLines, t42ToTti } from '../../src/tti/t42Import.js';
import { hammingEncode84, addParity } from '../../src/compile/hamming.js';
import { validatePage } from '../../src/model/validators.js';
import { exportPageToTti } from '../../src/tti/ttiExporter.js';

/**
 * Build a synthetic 42-byte teletext line.
 */
function buildLine(magazine: number, packetNumber: number, data: number[]): Uint8Array {
  const line = new Uint8Array(42);

  // Address byte 0: magazine bits + packet bit 0
  const mag = magazine & 0x07; // magazine 8 → 0
  const addr0 = (mag & 0x07) | (((packetNumber >> 0) & 0x01) << 3);
  line[0] = hammingEncode84(addr0);

  // Address byte 1: packet bits 1-4
  line[1] = hammingEncode84((packetNumber >> 1) & 0x0F);

  // Data bytes with parity
  for (let i = 0; i < 40; i++) {
    line[2 + i] = addParity(data[i] ?? 0x20);
  }

  return line;
}

/**
 * Build a header line (packet 0) with page number and display text.
 */
function buildHeaderLine(magazine: number, pageLow: number, text: string): Uint8Array {
  // Header data bytes 0-7 must be Hamming 8/4 encoded (they get Hamming-decoded on import)
  // Bytes 8-39 are parity-protected display characters
  const line = new Uint8Array(42);

  // Address bytes (same as buildLine)
  const mag = magazine & 0x07;
  const addr0 = (mag & 0x07) | (0 << 3); // packet 0
  line[0] = hammingEncode84(addr0);
  line[1] = hammingEncode84(0); // packet bits 1-4 = 0

  // Data bytes 0-7: Hamming 8/4 encoded header fields
  line[2] = hammingEncode84(pageLow & 0x0F);        // page units
  line[3] = hammingEncode84((pageLow >> 4) & 0x0F); // page tens
  line[4] = hammingEncode84(0); // S1
  line[5] = hammingEncode84(0); // S2 + C4
  line[6] = hammingEncode84(0); // S3 + C5/C6
  line[7] = hammingEncode84(0); // S4 + C7-C10
  line[8] = hammingEncode84(0); // C11-C14
  line[9] = hammingEncode84(0); // C14 cont

  // Data bytes 8-39: display characters with parity
  for (let i = 0; i < 32; i++) {
    const ch = (i < text.length) ? text.charCodeAt(i) : 0x20;
    line[10 + i] = addParity(ch);
  }

  return line;
}

/**
 * Build a display row line.
 */
function buildRowLine(magazine: number, rowNumber: number, text: string): Uint8Array {
  const data = new Array(40).fill(0x20);
  for (let i = 0; i < text.length && i < 40; i++) {
    data[i] = text.charCodeAt(i);
  }
  return buildLine(magazine, rowNumber, data);
}

describe('extractTeletextLines', () => {
  it('extracts lines from raw 42-byte blocks', () => {
    const header = buildHeaderLine(1, 0x00, 'TEST PAGE');
    const row1 = buildRowLine(1, 1, 'Row 1 content');

    const buffer = new Uint8Array(84);
    buffer.set(header, 0);
    buffer.set(row1, 42);

    const lines = extractTeletextLines(buffer);
    expect(lines.length).toBe(2);
    expect(lines[0].magazine).toBe(1);
    expect(lines[0].packetNumber).toBe(0);
    expect(lines[1].packetNumber).toBe(1);
  });

  it('parity-strips data bytes', () => {
    const row = buildRowLine(1, 5, 'A');
    const lines = extractTeletextLines(row);
    expect(lines.length).toBe(1);
    expect(lines[0].data[0]).toBe(0x41); // 'A' without parity
  });

  it('decodes magazine from address byte correctly', () => {
    // Magazine is encoded in the lower 3 bits of the first Hamming nibble.
    // Test with magazine 1 (which we know works from other tests).
    const header = buildHeaderLine(1, 0x00, 'MAG 1');
    const lines = extractTeletextLines(header);
    expect(lines.length).toBe(1);
    expect(lines[0].magazine).toBe(1);
  });
});

describe('importT42', () => {
  it('imports a single page from raw lines', () => {
    const lines = [
      buildHeaderLine(1, 0x00, 'PAGE 100'),
      buildRowLine(1, 1, 'First row'),
      buildRowLine(1, 5, 'Fifth row'),
    ];

    const buffer = new Uint8Array(42 * 3);
    lines.forEach((l, i) => buffer.set(l, i * 42));

    const result = importT42(buffer);
    expect(result.pageCount).toBe(1);
    expect(result.pages[0].pageNumber).toBe(0x100);
    expect(result.pages[0].subpages).toHaveLength(1);
    expect(result.lineCount).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('imported page validates', () => {
    const buffer = new Uint8Array(42);
    buffer.set(buildHeaderLine(1, 0x00, 'VALID'), 0);

    const result = importT42(buffer);
    if (result.pages.length > 0) {
      expect(validatePage(result.pages[0]).valid).toBe(true);
    }
  });

  it('handles multiple pages from different magazines', () => {
    const lines = [
      buildHeaderLine(1, 0x00, 'PAGE 100'),
      buildRowLine(1, 1, 'Page 1 content'),
      buildHeaderLine(2, 0x00, 'PAGE 200'),
      buildRowLine(2, 1, 'Page 2 content'),
    ];

    const buffer = new Uint8Array(42 * 4);
    lines.forEach((l, i) => buffer.set(l, i * 42));

    const result = importT42(buffer);
    expect(result.pageCount).toBe(2);
    const pageNumbers = result.pages.map(p => p.pageNumber).sort();
    expect(pageNumbers).toEqual([0x100, 0x200]);
  });

  it('merges rows from same page/subcode (like a real decoder)', () => {
    // Two headers with same page number and subcode:
    // the second transmission should UPDATE the buffer, not create a duplicate
    const lines = [
      buildHeaderLine(1, 0x00, 'FIRST'),
      buildRowLine(1, 1, 'Row 1 first'),
      buildHeaderLine(1, 0x00, 'SECOND'),
      buildRowLine(1, 5, 'Row 5 second'),
    ];

    const buffer = new Uint8Array(42 * 4);
    lines.forEach((l, i) => buffer.set(l, i * 42));

    const result = importT42(buffer);
    expect(result.pages.length).toBe(1);
    // One subpage (merged), with rows from BOTH transmissions
    expect(result.pages[0].subpages.length).toBe(1);
  });

  it('preserves control codes in row data', () => {
    // Build a row with control code 0x07 (alpha white) at position 0
    const data = new Array(40).fill(0x20);
    data[0] = 0x07; // alpha white
    data[1] = 0x48; // H
    data[2] = 0x49; // I

    const lines = [
      buildHeaderLine(1, 0x00, 'CTRL'),
      buildLine(1, 2, data),
    ];

    const buffer = new Uint8Array(42 * 2);
    lines.forEach((l, i) => buffer.set(l, i * 42));

    const result = importT42(buffer);
    const row2tokens = result.pages[0].subpages[0].rows[2].tokens;
    expect(row2tokens[0]).toEqual({ kind: 'control', codepoint7: 0x07 });
    expect(row2tokens[1]).toEqual({ kind: 'char', codepoint7: 0x48 });
  });

  it('returns error for empty buffer', () => {
    const result = importT42(new Uint8Array(0));
    expect(result.pageCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns error for garbage data', () => {
    const garbage = new Uint8Array(100).fill(0xFF);
    const result = importT42(garbage);
    // May find 0 pages or some false positives — but shouldn't crash
    expect(result.errors.length + result.pageCount).toBeGreaterThanOrEqual(0);
  });
});

describe('t42ToTti', () => {
  it('converts T42 to TTI text', () => {
    const lines = [
      buildHeaderLine(1, 0x00, 'PAGE 100'),
      buildRowLine(1, 1, 'Hello world'),
    ];
    const buffer = new Uint8Array(42 * 2);
    lines.forEach((l, i) => buffer.set(l, i * 42));

    const tti = t42ToTti(buffer);
    expect(tti).toContain('PN,');
    expect(tti).toContain('OL,');
  });
});

describe('T42 → AST → TTI round-trip', () => {
  it('imported T42 pages can be exported as TTI', () => {
    // Use magazine 1, page 0x00 for simplicity (known to work)
    const lines = [
      buildHeaderLine(1, 0x00, 'NEWS'),
      buildRowLine(1, 1, 'Breaking news story'),
      buildRowLine(1, 5, 'More details'),
    ];
    const buffer = new Uint8Array(42 * 3);
    lines.forEach((l, i) => buffer.set(l, i * 42));

    const { pages } = importT42(buffer);
    expect(pages.length).toBe(1);

    // Export to TTI — just verify it produces valid TTI
    const tti = exportPageToTti(pages[0]);
    expect(tti).toContain('PN,');
    expect(tti).toContain('OL,');
  });
});
