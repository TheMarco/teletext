/**
 * Factory functions for creating page model objects.
 * Per 02_PAGE_MODEL_AND_SERVICE_BUNDLE.md required APIs.
 */

import type {
  TeletextService,
  TeletextPage,
  TeletextSubpage,
  TeletextRow,
  TeletextToken,
  PageNumber,
  PageServiceFlags,
  PageControlFlags,
  NationalSubset,
  CharToken,
  MosaicToken,
  ControlToken,
  FillToken,
} from './types.js';

const ROWS_PER_PAGE = 24;
const COLS_PER_ROW = 40;

// ─── Service ────────────────────────────────────────────────────

export function createEmptyService(
  id?: string,
  title?: string,
): TeletextService {
  return {
    id: id ?? crypto.randomUUID(),
    title: title ?? 'Untitled Service',
    pages: [],
    defaultLanguageSubset: 'english',
  };
}

// ─── Page ───────────────────────────────────────────────────────

export function createEmptyPage(pageNumber: PageNumber): TeletextPage {
  return {
    pageNumber,
    subpages: [createEmptySubpage(0)],
    serviceFlags: createDefaultServiceFlags(),
    fastext: null,
  };
}

export function createDefaultServiceFlags(): PageServiceFlags {
  return {
    serialMagazine: false,
  };
}

// ─── Subpage ────────────────────────────────────────────────────

export function createEmptySubpage(
  subcode: number = 0,
  languageSubset: NationalSubset = 'english',
): TeletextSubpage {
  const rows: TeletextRow[] = [];
  for (let i = 0; i < ROWS_PER_PAGE; i++) {
    rows.push(createEmptyRow(i));
  }
  return {
    subcode,
    rows,
    languageSubset,
    pageFlags: createDefaultPageFlags(),
  };
}

export function createDefaultPageFlags(): PageControlFlags {
  return {
    erasePage: true,
    newsflash: false,
    subtitle: false,
    suppressHeader: false,
    updateIndicator: false,
    interruptedSequence: false,
    inhibitDisplay: false,
  };
}

// ─── Row ────────────────────────────────────────────────────────

export function createEmptyRow(index: number): TeletextRow {
  return {
    index,
    tokens: [{ kind: 'fill', count: COLS_PER_ROW, codepoint7: 0x20 }],
  };
}

// ─── Token helpers ──────────────────────────────────────────────

export function charToken(codepoint7: number): CharToken {
  return { kind: 'char', codepoint7 };
}

export function mosaicToken(codepoint7: number, contiguous = true): MosaicToken {
  return { kind: 'mosaic', codepoint7, contiguous };
}

export function controlToken(codepoint7: number): ControlToken {
  return { kind: 'control', codepoint7 };
}

export function fillToken(count: number, codepoint7 = 0x20): FillToken {
  return { kind: 'fill', count, codepoint7 };
}

export function textTokens(text: string): CharToken[] {
  return Array.from(text).map(ch => charToken(ch.charCodeAt(0)));
}

// ─── Row normalization ──────────────────────────────────────────

/**
 * Count the display width of a token stream.
 * Control tokens and char/mosaic tokens each occupy 1 column.
 * Fill tokens occupy their count. Comment tokens occupy 0.
 */
export function tokenDisplayWidth(tokens: TeletextToken[]): number {
  let width = 0;
  for (const token of tokens) {
    switch (token.kind) {
      case 'char':
      case 'mosaic':
      case 'control':
        width += 1;
        break;
      case 'fill':
        width += token.count;
        break;
      case 'comment':
        // zero width — editor only
        break;
    }
  }
  return width;
}

/**
 * Normalize a row's token stream to exactly 40 columns.
 *
 * - If < 40: pad with space fill tokens
 * - If > 40: truncate from the end
 * - Comments are preserved but don't count toward width
 */
export function normalizeRowTo40Columns(row: TeletextRow): TeletextRow {
  const width = tokenDisplayWidth(row.tokens);

  if (width === COLS_PER_ROW) {
    return row;
  }

  if (width < COLS_PER_ROW) {
    // Pad with spaces
    const padding = COLS_PER_ROW - width;
    return {
      index: row.index,
      tokens: [...row.tokens, fillToken(padding)],
    };
  }

  // Truncate to 40 columns
  const truncated: TeletextToken[] = [];
  let remaining = COLS_PER_ROW;

  for (const token of row.tokens) {
    if (remaining <= 0) {
      // Keep comments even after truncation
      if (token.kind === 'comment') {
        truncated.push(token);
      }
      continue;
    }

    switch (token.kind) {
      case 'char':
      case 'mosaic':
      case 'control':
        truncated.push(token);
        remaining -= 1;
        break;
      case 'fill':
        if (token.count <= remaining) {
          truncated.push(token);
          remaining -= token.count;
        } else {
          truncated.push(fillToken(remaining, token.codepoint7));
          remaining = 0;
        }
        break;
      case 'comment':
        truncated.push(token);
        break;
    }
  }

  return { index: row.index, tokens: truncated };
}

// ─── Deep clone ─────────────────────────────────────────────────

export function clonePage(page: TeletextPage): TeletextPage {
  return structuredClone(page);
}

export function cloneSubpage(subpage: TeletextSubpage): TeletextSubpage {
  return structuredClone(subpage);
}

// ─── Strip editor metadata ─────────────────────────────────────

/**
 * Return a page copy with all editor metadata removed.
 * This is what enters compilation — no editor state in output.
 */
export function stripEditorMetadata(page: TeletextPage): TeletextPage {
  return {
    ...page,
    subpages: page.subpages.map(sp => {
      const { editorMeta, ...rest } = sp;
      return {
        ...rest,
        rows: rest.rows.map(row => ({
          index: row.index,
          tokens: row.tokens.filter(t => t.kind !== 'comment'),
        })),
      };
    }),
  };
}

// ─── Row to display bytes (preview/debug only) ─────────────────

/**
 * Resolve a token stream into a flat 40-byte array for preview/debug.
 * NOT for compilation — use the compiler for that.
 */
export function resolveRowToDisplayBytes(row: TeletextRow): Uint8Array {
  const normalized = normalizeRowTo40Columns(row);
  const bytes = new Uint8Array(COLS_PER_ROW);
  let col = 0;

  for (const token of normalized.tokens) {
    switch (token.kind) {
      case 'char':
      case 'mosaic':
      case 'control':
        if (col < COLS_PER_ROW) bytes[col++] = token.codepoint7;
        break;
      case 'fill':
        for (let i = 0; i < token.count && col < COLS_PER_ROW; i++) {
          bytes[col++] = token.codepoint7;
        }
        break;
      case 'comment':
        break;
    }
  }

  return bytes;
}
