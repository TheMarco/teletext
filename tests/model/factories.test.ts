import { describe, it, expect } from 'vitest';
import {
  createEmptyService,
  createEmptyPage,
  createEmptySubpage,
  createEmptyRow,
  charToken,
  mosaicToken,
  controlToken,
  fillToken,
  textTokens,
  tokenDisplayWidth,
  normalizeRowTo40Columns,
  clonePage,
  stripEditorMetadata,
  resolveRowToDisplayBytes,
} from '../../src/model/factories.js';
import type { TeletextRow } from '../../src/model/types.js';

describe('createEmptyService', () => {
  it('creates a service with defaults', () => {
    const svc = createEmptyService();
    expect(svc.id).toBeTruthy();
    expect(svc.title).toBe('Untitled Service');
    expect(svc.pages).toHaveLength(0);
    expect(svc.defaultLanguageSubset).toBe('english');
  });

  it('accepts custom id and title', () => {
    const svc = createEmptyService('svc-1', 'BBC One');
    expect(svc.id).toBe('svc-1');
    expect(svc.title).toBe('BBC One');
  });
});

describe('createEmptyPage', () => {
  it('creates a page with one blank subpage', () => {
    const page = createEmptyPage(0x100);
    expect(page.pageNumber).toBe(0x100);
    expect(page.subpages).toHaveLength(1);
    expect(page.subpages[0].rows).toHaveLength(24);
    expect(page.fastext).toBeNull();
  });
});

describe('createEmptySubpage', () => {
  it('creates 24 rows of spaces', () => {
    const sp = createEmptySubpage(0);
    expect(sp.subcode).toBe(0);
    expect(sp.rows).toHaveLength(24);
    expect(sp.languageSubset).toBe('english');
    expect(sp.pageFlags.erasePage).toBe(true);
  });

  it('rows have sequential indices 0-23', () => {
    const sp = createEmptySubpage(0);
    for (let i = 0; i < 24; i++) {
      expect(sp.rows[i].index).toBe(i);
    }
  });
});

describe('createEmptyRow', () => {
  it('creates a row with a single fill token of 40 spaces', () => {
    const row = createEmptyRow(5);
    expect(row.index).toBe(5);
    expect(row.tokens).toHaveLength(1);
    expect(row.tokens[0].kind).toBe('fill');
    if (row.tokens[0].kind === 'fill') {
      expect(row.tokens[0].count).toBe(40);
      expect(row.tokens[0].codepoint7).toBe(0x20);
    }
  });
});

describe('Token factory helpers', () => {
  it('charToken creates a char token', () => {
    const t = charToken(0x41);
    expect(t).toEqual({ kind: 'char', codepoint7: 0x41 });
  });

  it('mosaicToken creates a mosaic token', () => {
    const t = mosaicToken(0x3F, false);
    expect(t).toEqual({ kind: 'mosaic', codepoint7: 0x3F, contiguous: false });
  });

  it('controlToken creates a control token', () => {
    const t = controlToken(0x07);
    expect(t).toEqual({ kind: 'control', codepoint7: 0x07 });
  });

  it('fillToken creates a fill token', () => {
    const t = fillToken(10, 0x20);
    expect(t).toEqual({ kind: 'fill', count: 10, codepoint7: 0x20 });
  });

  it('textTokens creates char tokens from string', () => {
    const tokens = textTokens('Hi');
    expect(tokens).toEqual([
      { kind: 'char', codepoint7: 0x48 },
      { kind: 'char', codepoint7: 0x69 },
    ]);
  });
});

describe('tokenDisplayWidth', () => {
  it('counts char/mosaic/control as 1 each', () => {
    expect(tokenDisplayWidth([
      charToken(0x41),
      controlToken(0x01),
      mosaicToken(0x3F),
    ])).toBe(3);
  });

  it('counts fill by its count', () => {
    expect(tokenDisplayWidth([fillToken(40)])).toBe(40);
  });

  it('ignores comments', () => {
    expect(tokenDisplayWidth([
      charToken(0x41),
      { kind: 'comment', text: 'note' },
      charToken(0x42),
    ])).toBe(2);
  });

  it('counts mixed tokens correctly', () => {
    expect(tokenDisplayWidth([
      controlToken(0x01),
      fillToken(5),
      charToken(0x41),
      { kind: 'comment', text: '' },
    ])).toBe(7);
  });
});

describe('normalizeRowTo40Columns', () => {
  it('returns row as-is if already 40 columns', () => {
    const row: TeletextRow = { index: 0, tokens: [fillToken(40)] };
    const result = normalizeRowTo40Columns(row);
    expect(tokenDisplayWidth(result.tokens)).toBe(40);
  });

  it('pads short rows with space fill', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [charToken(0x41), charToken(0x42)], // width=2
    };
    const result = normalizeRowTo40Columns(row);
    expect(tokenDisplayWidth(result.tokens)).toBe(40);
    expect(result.tokens.length).toBe(3); // 2 chars + 1 fill
  });

  it('truncates long rows to 40', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [fillToken(50)], // width=50
    };
    const result = normalizeRowTo40Columns(row);
    expect(tokenDisplayWidth(result.tokens)).toBe(40);
  });

  it('preserves comments during truncation', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [
        fillToken(45),
        { kind: 'comment', text: 'keep me' },
      ],
    };
    const result = normalizeRowTo40Columns(row);
    expect(tokenDisplayWidth(result.tokens)).toBe(40);
    expect(result.tokens.some(t => t.kind === 'comment')).toBe(true);
  });

  it('preserves row index', () => {
    const row: TeletextRow = { index: 15, tokens: [fillToken(10)] };
    const result = normalizeRowTo40Columns(row);
    expect(result.index).toBe(15);
  });
});

describe('clonePage', () => {
  it('creates a deep independent copy', () => {
    const page = createEmptyPage(0x100);
    const clone = clonePage(page);
    expect(clone).toEqual(page);
    expect(clone).not.toBe(page);
    expect(clone.subpages[0]).not.toBe(page.subpages[0]);
  });
});

describe('stripEditorMetadata', () => {
  it('removes editorMeta from subpages', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].editorMeta = {
      guides: [{ id: 'g1', x: 0, y: 0, width: 10, height: 5 }],
    };
    const stripped = stripEditorMetadata(page);
    expect(stripped.subpages[0].editorMeta).toBeUndefined();
  });

  it('removes comment tokens from rows', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].rows[0].tokens = [
      charToken(0x41),
      { kind: 'comment', text: 'note' },
      fillToken(39),
    ];
    const stripped = stripEditorMetadata(page);
    const commentTokens = stripped.subpages[0].rows[0].tokens.filter(
      t => t.kind === 'comment',
    );
    expect(commentTokens).toHaveLength(0);
  });

  it('does not modify the original page', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].editorMeta = { guides: [] };
    stripEditorMetadata(page);
    expect(page.subpages[0].editorMeta).toBeDefined();
  });
});

describe('resolveRowToDisplayBytes', () => {
  it('converts a fill row to 40 spaces', () => {
    const row = createEmptyRow(0);
    const bytes = resolveRowToDisplayBytes(row);
    expect(bytes.length).toBe(40);
    for (let i = 0; i < 40; i++) expect(bytes[i]).toBe(0x20);
  });

  it('converts mixed tokens to bytes', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [
        controlToken(0x07), // white
        charToken(0x41),    // 'A'
        fillToken(38),
      ],
    };
    const bytes = resolveRowToDisplayBytes(row);
    expect(bytes[0]).toBe(0x07);
    expect(bytes[1]).toBe(0x41);
    expect(bytes[2]).toBe(0x20);
  });

  it('pads short rows', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [charToken(0x41)],
    };
    const bytes = resolveRowToDisplayBytes(row);
    expect(bytes.length).toBe(40);
    expect(bytes[0]).toBe(0x41);
    expect(bytes[1]).toBe(0x20);
  });

  it('ignores comment tokens', () => {
    const row: TeletextRow = {
      index: 0,
      tokens: [
        charToken(0x41),
        { kind: 'comment', text: 'skip' },
        charToken(0x42),
        fillToken(38),
      ],
    };
    const bytes = resolveRowToDisplayBytes(row);
    expect(bytes[0]).toBe(0x41);
    expect(bytes[1]).toBe(0x42);
  });
});
