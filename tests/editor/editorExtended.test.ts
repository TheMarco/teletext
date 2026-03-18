import { describe, it, expect } from 'vitest';
import {
  createEditorState, applyCommand, undo, redo, setActivePage, setActiveSubpage,
  getActiveSubpage, getActivePage,
  setCellCommand, duplicateRowCommand, copyRegion, pasteRegionCommand,
  plotMosaicCommand, floodFillMosaicCommand, setPageFlagsCommand, clearRegionCommand,
  expandTokens,
} from '../../src/editor/index.js';
import {
  createEmptyService, createEmptyPage, createEmptySubpage,
  charToken, controlToken, mosaicToken,
} from '../../src/model/factories.js';
import { addPage } from '../../src/bundle/index.js';

function setup() {
  let svc = createEmptyService('test');
  svc = addPage(svc, createEmptyPage(0x100));
  let state = createEditorState(svc);
  state = setActivePage(state, 0x100);
  return state;
}

describe('Subpage management', () => {
  it('setActiveSubpage switches between subpages', () => {
    let state = setup();
    const page = getActivePage(state)!;
    // Add a second subpage
    const sub2 = createEmptySubpage(1);
    const newPages = state.service.pages.map(p =>
      p.pageNumber === 0x100 ? { ...p, subpages: [...p.subpages, sub2] } : p
    );
    state = { ...state, service: { ...state.service, pages: newPages } };

    state = setActiveSubpage(state, 1);
    expect(state.activeSubpageIndex).toBe(1);
    expect(getActiveSubpage(state)!.subcode).toBe(1);
  });

  it('edits on different subpages are independent', () => {
    let state = setup();
    const sub2 = createEmptySubpage(1);
    const newPages = state.service.pages.map(p =>
      p.pageNumber === 0x100 ? { ...p, subpages: [...p.subpages, sub2] } : p
    );
    state = { ...state, service: { ...state.service, pages: newPages } };

    // Edit subpage 0
    state = setActiveSubpage(state, 0);
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));

    // Edit subpage 1
    state = setActiveSubpage(state, 1);
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x42) }));

    // Check subpage 0 still has 'A'
    state = setActiveSubpage(state, 0);
    const exp0 = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp0[0].codepoint7).toBe(0x41);

    // Check subpage 1 has 'B'
    state = setActiveSubpage(state, 1);
    const exp1 = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp1[0].codepoint7).toBe(0x42);
  });
});

describe('Copy/Paste between rows', () => {
  it('copies and pastes a full row', () => {
    let state = setup();
    // Write "HELLO" to row 0
    for (let i = 0; i < 5; i++) {
      state = applyCommand(state, setCellCommand({
        row: 0, col: i, token: charToken('HELLO'.charCodeAt(i)),
      }));
    }

    // Copy row 0 and paste to row 5
    const clip = copyRegion(getActiveSubpage(state)!, 0, 0, 0, 39);
    state = applyCommand(state, pasteRegionCommand({ targetRow: 5, targetCol: 0, clipboard: clip }));

    const exp = expandTokens(getActiveSubpage(state)!.rows[5].tokens);
    expect(exp[0].codepoint7).toBe(0x48); // H
    expect(exp[4].codepoint7).toBe(0x4F); // O
  });
});

describe('Control code insertion', () => {
  it('inserts mosaic color codes', () => {
    let state = setup();
    // Insert MosaicGreen (0x12)
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: controlToken(0x12) }));
    const exp = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp[0]).toEqual({ kind: 'control', codepoint7: 0x12 });
  });

  it('inserts double height', () => {
    let state = setup();
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: controlToken(0x0D) }));
    const exp = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp[0].codepoint7).toBe(0x0D);
  });

  it('inserts hold/release graphics', () => {
    let state = setup();
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: controlToken(0x1E) })); // hold
    state = applyCommand(state, setCellCommand({ row: 0, col: 5, token: controlToken(0x1F) })); // release
    const exp = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp[0].codepoint7).toBe(0x1E);
    expect(exp[5].codepoint7).toBe(0x1F);
  });
});

describe('Page flags editing', () => {
  it('sets and unsets page flags', () => {
    let state = setup();
    state = applyCommand(state, setPageFlagsCommand({ flags: { newsflash: true, subtitle: true } }));
    expect(getActiveSubpage(state)!.pageFlags.newsflash).toBe(true);
    expect(getActiveSubpage(state)!.pageFlags.subtitle).toBe(true);

    state = applyCommand(state, setPageFlagsCommand({ flags: { newsflash: false } }));
    expect(getActiveSubpage(state)!.pageFlags.newsflash).toBe(false);
    expect(getActiveSubpage(state)!.pageFlags.subtitle).toBe(true); // still set
  });
});

describe('Mosaic contiguous vs separated', () => {
  it('plots with contiguous flag', () => {
    let state = setup();
    state = applyCommand(state, plotMosaicCommand({
      row: 0, col: 0, sextantBit: 0, value: true, contiguous: true,
    }));
    const exp = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp[0].kind).toBe('mosaic');
    if (exp[0].kind === 'mosaic') expect(exp[0].contiguous).toBe(true);
  });

  it('plots with separated flag', () => {
    let state = setup();
    state = applyCommand(state, plotMosaicCommand({
      row: 0, col: 0, sextantBit: 0, value: true, contiguous: false,
    }));
    const exp = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    if (exp[0].kind === 'mosaic') expect(exp[0].contiguous).toBe(false);
  });
});

describe('Flood fill mosaic', () => {
  it('fills a rectangular region', () => {
    let state = setup();
    state = applyCommand(state, floodFillMosaicCommand({
      row: 0, col: 0, sextantBit: 0, value: true, contiguous: true,
      bounds: { startRow: 0, startCol: 0, endRow: 2, endCol: 3 },
    }));

    for (let r = 0; r <= 2; r++) {
      const exp = expandTokens(getActiveSubpage(state)!.rows[r].tokens);
      for (let c = 0; c <= 3; c++) {
        expect(exp[c].kind).toBe('mosaic');
      }
    }
  });

  it('is undoable', () => {
    let state = setup();
    state = applyCommand(state, floodFillMosaicCommand({
      row: 0, col: 0, sextantBit: 0, value: true, contiguous: true,
      bounds: { startRow: 0, startCol: 0, endRow: 0, endCol: 5 },
    }));
    state = undo(state);
    const exp = expandTokens(getActiveSubpage(state)!.rows[0].tokens);
    expect(exp[0].codepoint7).toBe(0x20); // back to space
  });
});
