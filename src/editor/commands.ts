/**
 * Editor command system: reversible mutations on the page model.
 * Per 05_EDITOR_PRD.md.
 */

import type {
  TeletextSubpage,
  TeletextRow,
  TeletextToken,
} from '../model/types.js';

export interface EditorCommand {
  type: string;
  apply(subpage: TeletextSubpage): TeletextSubpage;
  undo(subpage: TeletextSubpage): TeletextSubpage;
}

// ─── Set cell ───────────────────────────────────────────────────

export interface SetCellParams {
  row: number;
  col: number;
  token: TeletextToken;
}

export function setCellCommand(params: SetCellParams): EditorCommand {
  let previousToken: TeletextToken | null = null;

  return {
    type: 'setCell',
    apply(subpage) {
      const sp = structuredClone(subpage);
      const { row, col, token } = params;
      const rowData = sp.rows[row];
      if (!rowData) return sp;

      // Expand tokens to individual cells to find the right column
      const expanded = expandTokens(rowData.tokens);
      previousToken = expanded[col] ?? { kind: 'char', codepoint7: 0x20 };
      expanded[col] = token;
      sp.rows[row] = { index: row, tokens: collapseTokens(expanded) };
      return sp;
    },
    undo(subpage) {
      if (!previousToken) return subpage;
      const sp = structuredClone(subpage);
      const expanded = expandTokens(sp.rows[params.row].tokens);
      expanded[params.col] = previousToken;
      sp.rows[params.row] = { index: params.row, tokens: collapseTokens(expanded) };
      return sp;
    },
  };
}

// ─── Clear region ───────────────────────────────────────────────

export interface ClearRegionParams {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function clearRegionCommand(params: ClearRegionParams): EditorCommand {
  let previousState: TeletextRow[] = [];

  return {
    type: 'clearRegion',
    apply(subpage) {
      const sp = structuredClone(subpage);
      previousState = [];
      for (let r = params.startRow; r <= params.endRow && r < 24; r++) {
        previousState.push(structuredClone(sp.rows[r]));
        const expanded = expandTokens(sp.rows[r].tokens);
        const sc = r === params.startRow ? params.startCol : 0;
        const ec = r === params.endRow ? params.endCol : 39;
        for (let c = sc; c <= ec && c < 40; c++) {
          expanded[c] = { kind: 'char', codepoint7: 0x20 };
        }
        sp.rows[r] = { index: r, tokens: collapseTokens(expanded) };
      }
      return sp;
    },
    undo(subpage) {
      const sp = structuredClone(subpage);
      for (let i = 0; i < previousState.length; i++) {
        const r = params.startRow + i;
        sp.rows[r] = previousState[i];
      }
      return sp;
    },
  };
}

// ─── Plot mosaic sextant ────────────────────────────────────────

export interface PlotMosaicParams {
  row: number;
  col: number;
  sextantBit: number; // 0-5
  value: boolean;
  contiguous: boolean;
}

export function plotMosaicCommand(params: PlotMosaicParams): EditorCommand {
  let previousToken: TeletextToken | null = null;

  return {
    type: 'plotMosaic',
    apply(subpage) {
      const sp = structuredClone(subpage);
      const expanded = expandTokens(sp.rows[params.row].tokens);
      previousToken = structuredClone(expanded[params.col]);

      // Get current mosaic byte or start from blank
      let currentBits = 0;
      const current = expanded[params.col];
      if (current.kind === 'mosaic') {
        if (current.codepoint7 >= 0x20 && current.codepoint7 <= 0x3F) {
          currentBits = current.codepoint7 - 0x20;
        } else if (current.codepoint7 >= 0x60 && current.codepoint7 <= 0x7F) {
          currentBits = (current.codepoint7 - 0x60) | 0x20;
        }
      }

      if (params.value) {
        currentBits |= (1 << params.sextantBit);
      } else {
        currentBits &= ~(1 << params.sextantBit);
      }

      // Encode back to mosaic byte
      let code: number;
      if (currentBits <= 0x1F) {
        code = 0x20 + currentBits;
      } else {
        code = 0x60 + (currentBits & 0x1F);
      }

      expanded[params.col] = { kind: 'mosaic', codepoint7: code, contiguous: params.contiguous };
      sp.rows[params.row] = { index: params.row, tokens: collapseTokens(expanded) };
      return sp;
    },
    undo(subpage) {
      if (!previousToken) return subpage;
      const sp = structuredClone(subpage);
      const expanded = expandTokens(sp.rows[params.row].tokens);
      expanded[params.col] = previousToken;
      sp.rows[params.row] = { index: params.row, tokens: collapseTokens(expanded) };
      return sp;
    },
  };
}

// ─── Token expansion/collapse ───────────────────────────────────

/**
 * Expand a token stream into exactly 40 individual tokens.
 */
export function expandTokens(tokens: TeletextToken[]): TeletextToken[] {
  const result: TeletextToken[] = [];

  for (const token of tokens) {
    if (token.kind === 'fill') {
      for (let i = 0; i < token.count; i++) {
        result.push({ kind: 'char', codepoint7: token.codepoint7 });
      }
    } else if (token.kind === 'comment') {
      // skip
    } else {
      result.push(structuredClone(token));
    }
  }

  // Pad to 40
  while (result.length < 40) {
    result.push({ kind: 'char', codepoint7: 0x20 });
  }

  return result.slice(0, 40);
}

/**
 * Collapse individual tokens back into an efficient token stream.
 * Merges consecutive identical char tokens into fill tokens.
 */
export function collapseTokens(tokens: TeletextToken[]): TeletextToken[] {
  if (tokens.length === 0) return [];
  const result: TeletextToken[] = [];
  let i = 0;

  while (i < tokens.length && i < 40) {
    const token = tokens[i];
    if (token.kind === 'char') {
      let count = 1;
      while (
        i + count < tokens.length &&
        i + count < 40 &&
        tokens[i + count].kind === 'char' &&
        (tokens[i + count] as any).codepoint7 === token.codepoint7
      ) {
        count++;
      }
      if (count >= 3) {
        result.push({ kind: 'fill', count, codepoint7: token.codepoint7 });
      } else {
        for (let j = 0; j < count; j++) result.push(tokens[i + j]);
      }
      i += count;
    } else {
      result.push(token);
      i++;
    }
  }

  return result;
}

// ─── Duplicate row ──────────────────────────────────────────────

export interface DuplicateRowParams {
  sourceRow: number;
  targetRow: number;
}

export function duplicateRowCommand(params: DuplicateRowParams): EditorCommand {
  let previousRow: TeletextRow | null = null;

  return {
    type: 'duplicateRow',
    apply(subpage) {
      const sp = structuredClone(subpage);
      previousRow = structuredClone(sp.rows[params.targetRow]);
      sp.rows[params.targetRow] = {
        ...structuredClone(sp.rows[params.sourceRow]),
        index: params.targetRow,
      };
      return sp;
    },
    undo(subpage) {
      if (!previousRow) return subpage;
      const sp = structuredClone(subpage);
      sp.rows[params.targetRow] = previousRow;
      return sp;
    },
  };
}

// ─── Insert row template ────────────────────────────────────────

export interface InsertRowTemplateParams {
  row: number;
  tokens: TeletextToken[];
}

export function insertRowTemplateCommand(params: InsertRowTemplateParams): EditorCommand {
  let previousRow: TeletextRow | null = null;

  return {
    type: 'insertRowTemplate',
    apply(subpage) {
      const sp = structuredClone(subpage);
      previousRow = structuredClone(sp.rows[params.row]);
      sp.rows[params.row] = { index: params.row, tokens: structuredClone(params.tokens) };
      return sp;
    },
    undo(subpage) {
      if (!previousRow) return subpage;
      const sp = structuredClone(subpage);
      sp.rows[params.row] = previousRow;
      return sp;
    },
  };
}

// ─── Paste region ───────────────────────────────────────────────

export interface PasteRegionParams {
  targetRow: number;
  targetCol: number;
  clipboard: TeletextToken[][]; // array of rows, each row is array of tokens
}

export function pasteRegionCommand(params: PasteRegionParams): EditorCommand {
  let previousState: TeletextRow[] = [];

  return {
    type: 'pasteRegion',
    apply(subpage) {
      const sp = structuredClone(subpage);
      previousState = [];
      for (let r = 0; r < params.clipboard.length; r++) {
        const rowIdx = params.targetRow + r;
        if (rowIdx >= 24) break;
        previousState.push(structuredClone(sp.rows[rowIdx]));
        const expanded = expandTokens(sp.rows[rowIdx].tokens);
        const clipRow = params.clipboard[r];
        for (let c = 0; c < clipRow.length; c++) {
          const col = params.targetCol + c;
          if (col >= 40) break;
          expanded[col] = structuredClone(clipRow[c]);
        }
        sp.rows[rowIdx] = { index: rowIdx, tokens: collapseTokens(expanded) };
      }
      return sp;
    },
    undo(subpage) {
      const sp = structuredClone(subpage);
      for (let i = 0; i < previousState.length; i++) {
        sp.rows[params.targetRow + i] = previousState[i];
      }
      return sp;
    },
  };
}

// ─── Copy region (read-only, no undo needed) ────────────────────

export function copyRegion(
  subpage: TeletextSubpage,
  startRow: number, startCol: number,
  endRow: number, endCol: number,
): TeletextToken[][] {
  const result: TeletextToken[][] = [];
  for (let r = startRow; r <= endRow && r < 24; r++) {
    const expanded = expandTokens(subpage.rows[r].tokens);
    const sc = r === startRow ? startCol : 0;
    const ec = r === endRow ? endCol : 39;
    result.push(expanded.slice(sc, ec + 1).map(t => structuredClone(t)));
  }
  return result;
}

// ─── Flood fill mosaics ─────────────────────────────────────────

export interface FloodFillParams {
  row: number;
  col: number;
  sextantBit: number;
  value: boolean;
  contiguous: boolean;
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number };
}

export function floodFillMosaicCommand(params: FloodFillParams): EditorCommand {
  let previousState: TeletextRow[] = [];

  return {
    type: 'floodFill',
    apply(subpage) {
      const sp = structuredClone(subpage);
      previousState = [];
      for (let r = params.bounds.startRow; r <= params.bounds.endRow && r < 24; r++) {
        previousState.push(structuredClone(sp.rows[r]));
      }

      // Simple fill: set the specified sextant bit in all cells within bounds
      for (let r = params.bounds.startRow; r <= params.bounds.endRow && r < 24; r++) {
        const expanded = expandTokens(sp.rows[r].tokens);
        for (let c = params.bounds.startCol; c <= params.bounds.endCol && c < 40; c++) {
          let currentBits = 0;
          const current = expanded[c];
          if (current.kind === 'mosaic') {
            if (current.codepoint7 >= 0x20 && current.codepoint7 <= 0x3F) {
              currentBits = current.codepoint7 - 0x20;
            } else if (current.codepoint7 >= 0x60 && current.codepoint7 <= 0x7F) {
              currentBits = (current.codepoint7 - 0x60) | 0x20;
            }
          }

          if (params.value) {
            currentBits |= (1 << params.sextantBit);
          } else {
            currentBits &= ~(1 << params.sextantBit);
          }

          let code: number;
          if (currentBits <= 0x1F) {
            code = 0x20 + currentBits;
          } else {
            code = 0x60 + (currentBits & 0x1F);
          }
          expanded[c] = { kind: 'mosaic', codepoint7: code, contiguous: params.contiguous };
        }
        sp.rows[r] = { index: r, tokens: collapseTokens(expanded) };
      }
      return sp;
    },
    undo(subpage) {
      const sp = structuredClone(subpage);
      for (let i = 0; i < previousState.length; i++) {
        sp.rows[params.bounds.startRow + i] = previousState[i];
      }
      return sp;
    },
  };
}

// ─── Set page flags ─────────────────────────────────────────────

export interface SetPageFlagsParams {
  flags: Partial<import('../model/types.js').PageControlFlags>;
}

export function setPageFlagsCommand(params: SetPageFlagsParams): EditorCommand {
  let previousFlags: import('../model/types.js').PageControlFlags | null = null;

  return {
    type: 'setPageFlags',
    apply(subpage) {
      const sp = structuredClone(subpage);
      previousFlags = structuredClone(sp.pageFlags);
      sp.pageFlags = { ...sp.pageFlags, ...params.flags };
      return sp;
    },
    undo(subpage) {
      if (!previousFlags) return subpage;
      const sp = structuredClone(subpage);
      sp.pageFlags = previousFlags;
      return sp;
    },
  };
}
