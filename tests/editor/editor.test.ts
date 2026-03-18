import { describe, it, expect } from 'vitest';
import {
  createEditorState,
  applyCommand,
  undo,
  redo,
  setActivePage,
  getActiveSubpage,
  setCellCommand,
  clearRegionCommand,
  plotMosaicCommand,
  expandTokens,
} from '../../src/editor/index.js';
import {
  createEmptyService,
  createEmptyPage,
  charToken,
  controlToken,
} from '../../src/model/factories.js';
import { addPage } from '../../src/bundle/index.js';

function setupEditor() {
  let svc = createEmptyService('test');
  svc = addPage(svc, createEmptyPage(0x100));
  let state = createEditorState(svc);
  state = setActivePage(state, 0x100);
  return state;
}

describe('EditorState basics', () => {
  it('creates with empty service', () => {
    const state = createEditorState();
    expect(state.activePageNumber).toBeNull();
    expect(state.undoStack).toHaveLength(0);
  });

  it('getActiveSubpage returns null when no page selected', () => {
    const state = createEditorState();
    expect(getActiveSubpage(state)).toBeNull();
  });

  it('setActivePage + getActiveSubpage works', () => {
    const state = setupEditor();
    const sp = getActiveSubpage(state);
    expect(sp).not.toBeNull();
    expect(sp!.rows).toHaveLength(24);
  });
});

describe('setCellCommand', () => {
  it('sets a cell to a char token', () => {
    let state = setupEditor();
    const cmd = setCellCommand({ row: 0, col: 0, token: charToken(0x41) });
    state = applyCommand(state, cmd);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0]).toEqual({ kind: 'char', codepoint7: 0x41 });
  });

  it('sets a cell to a control token', () => {
    let state = setupEditor();
    const cmd = setCellCommand({ row: 5, col: 3, token: controlToken(0x07) });
    state = applyCommand(state, cmd);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[5].tokens);
    expect(expanded[3]).toEqual({ kind: 'control', codepoint7: 0x07 });
  });

  it('is undoable', () => {
    let state = setupEditor();
    const before = getActiveSubpage(state)!.rows[0];

    const cmd = setCellCommand({ row: 0, col: 0, token: charToken(0x41) });
    state = applyCommand(state, cmd);
    expect(state.undoStack).toHaveLength(1);

    state = undo(state);
    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].codepoint7).toBe(0x20); // back to space
  });

  it('is redoable after undo', () => {
    let state = setupEditor();
    const cmd = setCellCommand({ row: 0, col: 0, token: charToken(0x41) });
    state = applyCommand(state, cmd);
    state = undo(state);
    state = redo(state);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].codepoint7).toBe(0x41);
  });

  it('clears redo stack on new command', () => {
    let state = setupEditor();
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));
    state = undo(state);
    expect(state.redoStack).toHaveLength(1);
    state = applyCommand(state, setCellCommand({ row: 0, col: 1, token: charToken(0x42) }));
    expect(state.redoStack).toHaveLength(0);
  });
});

describe('clearRegionCommand', () => {
  it('clears a region to spaces', () => {
    let state = setupEditor();
    // First set some content
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));
    state = applyCommand(state, setCellCommand({ row: 0, col: 1, token: charToken(0x42) }));

    // Clear cols 0-1
    const cmd = clearRegionCommand({ startRow: 0, startCol: 0, endRow: 0, endCol: 1 });
    state = applyCommand(state, cmd);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].codepoint7).toBe(0x20);
    expect(expanded[1].codepoint7).toBe(0x20);
  });

  it('is undoable', () => {
    let state = setupEditor();
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));

    const cmd = clearRegionCommand({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    state = applyCommand(state, cmd);
    state = undo(state);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].codepoint7).toBe(0x41);
  });
});

describe('plotMosaicCommand', () => {
  it('plots a sextant bit', () => {
    let state = setupEditor();
    const cmd = plotMosaicCommand({ row: 0, col: 0, sextantBit: 0, value: true, contiguous: true });
    state = applyCommand(state, cmd);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].kind).toBe('mosaic');
    if (expanded[0].kind === 'mosaic') {
      expect(expanded[0].codepoint7).toBe(0x21); // bit 0 set = 0x20 + 1
    }
  });

  it('clears a sextant bit', () => {
    let state = setupEditor();
    // Set bit 0 and bit 1
    state = applyCommand(state, plotMosaicCommand({ row: 0, col: 0, sextantBit: 0, value: true, contiguous: true }));
    state = applyCommand(state, plotMosaicCommand({ row: 0, col: 0, sextantBit: 1, value: true, contiguous: true }));
    // Clear bit 0
    state = applyCommand(state, plotMosaicCommand({ row: 0, col: 0, sextantBit: 0, value: false, contiguous: true }));

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    if (expanded[0].kind === 'mosaic') {
      expect(expanded[0].codepoint7).toBe(0x22); // bit 1 only = 0x20 + 2
    }
  });

  it('is undoable', () => {
    let state = setupEditor();
    state = applyCommand(state, plotMosaicCommand({ row: 0, col: 0, sextantBit: 0, value: true, contiguous: true }));
    state = undo(state);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].codepoint7).toBe(0x20); // back to space
  });
});

describe('Multiple undo/redo', () => {
  it('supports chained undo', () => {
    let state = setupEditor();
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));
    state = applyCommand(state, setCellCommand({ row: 0, col: 1, token: charToken(0x42) }));
    state = applyCommand(state, setCellCommand({ row: 0, col: 2, token: charToken(0x43) }));

    state = undo(state);
    state = undo(state);
    state = undo(state);

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[0].tokens);
    expect(expanded[0].codepoint7).toBe(0x20);
    expect(expanded[1].codepoint7).toBe(0x20);
    expect(expanded[2].codepoint7).toBe(0x20);
  });

  it('undo past empty stack is no-op', () => {
    let state = setupEditor();
    state = undo(state);
    expect(state.undoStack).toHaveLength(0);
  });

  it('redo past empty stack is no-op', () => {
    let state = setupEditor();
    state = redo(state);
    expect(state.redoStack).toHaveLength(0);
  });
});
