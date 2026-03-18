import { describe, it, expect } from 'vitest';
import {
  isValidPageNumber,
  isValidSubcode,
  isValidFastextLink,
  validateRow,
  validateSubpage,
  validatePage,
  validateService,
} from '../../src/model/validators.js';
import {
  createEmptyPage,
  createEmptySubpage,
  createEmptyService,
  createEmptyRow,
  charToken,
  controlToken,
  fillToken,
} from '../../src/model/factories.js';

describe('isValidPageNumber', () => {
  it('accepts valid page numbers (0x100-0x8FF)', () => {
    expect(isValidPageNumber(0x100)).toBe(true);
    expect(isValidPageNumber(0x300)).toBe(true);
    expect(isValidPageNumber(0x8FF)).toBe(true);
  });

  it('rejects page number below 0x100', () => {
    expect(isValidPageNumber(0x00)).toBe(false);
    expect(isValidPageNumber(0xFF)).toBe(false);
  });

  it('rejects page number above 0x8FF', () => {
    expect(isValidPageNumber(0x900)).toBe(false);
    expect(isValidPageNumber(0xFFF)).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(isValidPageNumber(256.5)).toBe(false);
    expect(isValidPageNumber(NaN)).toBe(false);
  });

  it('rejects magazine 0 (0x0XX)', () => {
    expect(isValidPageNumber(0x0FF)).toBe(false);
  });
});

describe('isValidSubcode', () => {
  it('accepts 0', () => {
    expect(isValidSubcode(0)).toBe(true);
  });

  it('accepts max subcode 0x3F7F', () => {
    expect(isValidSubcode(0x3F7F)).toBe(true);
  });

  it('rejects negative', () => {
    expect(isValidSubcode(-1)).toBe(false);
  });

  it('rejects above max', () => {
    expect(isValidSubcode(0x3F80)).toBe(false);
  });
});

describe('isValidFastextLink', () => {
  it('accepts null/undefined', () => {
    expect(isValidFastextLink(null)).toBe(true);
    expect(isValidFastextLink(undefined)).toBe(true);
  });

  it('accepts valid page number', () => {
    expect(isValidFastextLink(0x100)).toBe(true);
  });

  it('rejects invalid page number', () => {
    expect(isValidFastextLink(0x00)).toBe(false);
  });
});

describe('validateRow', () => {
  it('valid empty row passes', () => {
    const row = createEmptyRow(0);
    const result = validateRow(row, 'row');
    expect(result.errors).toHaveLength(0);
  });

  it('invalid row index produces error', () => {
    const row = createEmptyRow(25);
    const result = validateRow(row, 'row');
    expect(result.errors.some(e => e.code === 'INVALID_ROW_INDEX')).toBe(true);
  });

  it('row wider than 40 produces warning', () => {
    const row = { index: 0, tokens: [fillToken(45)] };
    const result = validateRow(row, 'row');
    expect(result.warnings.some(w => w.code === 'ROW_TOO_WIDE')).toBe(true);
  });

  it('invalid char codepoint produces error', () => {
    const row = { index: 0, tokens: [charToken(0x00), fillToken(39)] };
    const result = validateRow(row, 'row');
    expect(result.errors.some(e => e.code === 'INVALID_CHAR_CODE')).toBe(true);
  });

  it('invalid control codepoint produces error', () => {
    const row = { index: 0, tokens: [controlToken(0x20), fillToken(39)] };
    const result = validateRow(row, 'row');
    expect(result.errors.some(e => e.code === 'INVALID_CONTROL_CODE')).toBe(true);
  });
});

describe('validateSubpage', () => {
  it('valid empty subpage passes', () => {
    const sp = createEmptySubpage(0);
    const result = validateSubpage(sp);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('invalid subcode fails', () => {
    const sp = createEmptySubpage(-1);
    const result = validateSubpage(sp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_SUBCODE')).toBe(true);
  });

  it('wrong row count fails', () => {
    const sp = createEmptySubpage(0);
    sp.rows = sp.rows.slice(0, 10); // only 10 rows
    const result = validateSubpage(sp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_ROW_COUNT')).toBe(true);
  });

  it('mismatched row indices produce warnings', () => {
    const sp = createEmptySubpage(0);
    sp.rows[5] = { ...sp.rows[5], index: 99 };
    const result = validateSubpage(sp);
    expect(result.warnings.some(w => w.code === 'ROW_INDEX_MISMATCH')).toBe(true);
  });
});

describe('validatePage', () => {
  it('valid empty page passes', () => {
    const page = createEmptyPage(0x100);
    const result = validatePage(page);
    expect(result.valid).toBe(true);
  });

  it('invalid page number fails', () => {
    const page = createEmptyPage(0x000);
    const result = validatePage(page);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_PAGE_NUMBER')).toBe(true);
  });

  it('no subpages fails', () => {
    const page = createEmptyPage(0x100);
    page.subpages = [];
    const result = validatePage(page);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'NO_SUBPAGES')).toBe(true);
  });

  it('duplicate subcodes fail', () => {
    const page = createEmptyPage(0x100);
    page.subpages.push(createEmptySubpage(0)); // duplicate subcode 0
    const result = validatePage(page);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_SUBCODE')).toBe(true);
  });

  it('invalid fastext link fails', () => {
    const page = createEmptyPage(0x100);
    page.fastext = { red: 0x000 }; // invalid page number
    const result = validatePage(page);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_FASTEXT_LINK')).toBe(true);
  });

  it('valid fastext links pass', () => {
    const page = createEmptyPage(0x100);
    page.fastext = { red: 0x200, green: null, yellow: 0x300 };
    const result = validatePage(page);
    expect(result.valid).toBe(true);
  });
});

describe('validateService', () => {
  it('valid empty service passes', () => {
    const svc = createEmptyService('svc-1');
    const result = validateService(svc);
    expect(result.valid).toBe(true);
  });

  it('missing id fails', () => {
    const svc = createEmptyService('', 'Test');
    const result = validateService(svc);
    expect(result.valid).toBe(false);
  });

  it('duplicate page numbers fail', () => {
    const svc = createEmptyService('svc-1');
    svc.pages = [createEmptyPage(0x100), createEmptyPage(0x100)];
    const result = validateService(svc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_PAGE_NUMBER')).toBe(true);
  });

  it('propagates page validation errors', () => {
    const svc = createEmptyService('svc-1');
    svc.pages = [createEmptyPage(0x000)]; // invalid page number
    const result = validateService(svc);
    expect(result.valid).toBe(false);
  });
});

describe('Round-trip: construct → validate → resolve', () => {
  it('programmatically built page validates and resolves', () => {
    const page = createEmptyPage(0x100);
    page.description = 'Test page';
    page.subpages[0].rows[0] = {
      index: 0,
      tokens: [
        controlToken(0x07), // white
        ...Array.from('TELETEXT').map(ch => charToken(ch.charCodeAt(0))),
        fillToken(31),
      ],
    };

    const result = validatePage(page);
    expect(result.valid).toBe(true);
  });
});
