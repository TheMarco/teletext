/**
 * Editor state store with undo/redo.
 * Per 05_EDITOR_PRD.md.
 */

import type { TeletextService, TeletextPage, TeletextSubpage } from '../model/types.js';
import type { EditorCommand } from './commands.js';
import { createEmptyService, createEmptyPage, clonePage } from '../model/factories.js';

export interface EditorSelection {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface EditorState {
  service: TeletextService;
  activePageNumber: number | null;
  activeSubpageIndex: number;
  undoStack: EditorCommand[];
  redoStack: EditorCommand[];
  selection: EditorSelection | null;
  editingMode: 'text' | 'control' | 'mosaic' | 'inspect';
}

export function createEditorState(service?: TeletextService): EditorState {
  return {
    service: service ?? createEmptyService(),
    activePageNumber: null,
    activeSubpageIndex: 0,
    undoStack: [],
    redoStack: [],
    selection: null,
    editingMode: 'text',
  };
}

/**
 * Get the active subpage from the editor state.
 */
export function getActiveSubpage(state: EditorState): TeletextSubpage | null {
  if (state.activePageNumber === null) return null;
  const page = state.service.pages.find(p => p.pageNumber === state.activePageNumber);
  if (!page) return null;
  return page.subpages[state.activeSubpageIndex] ?? null;
}

/**
 * Get the active page from the editor state.
 */
export function getActivePage(state: EditorState): TeletextPage | null {
  if (state.activePageNumber === null) return null;
  return state.service.pages.find(p => p.pageNumber === state.activePageNumber) ?? null;
}

/**
 * Apply a command to the active subpage with undo support.
 */
export function applyCommand(state: EditorState, command: EditorCommand): EditorState {
  const subpage = getActiveSubpage(state);
  if (!subpage) return state;

  const newSubpage = command.apply(subpage);
  const newState = replaceActiveSubpage(state, newSubpage);

  return {
    ...newState,
    undoStack: [...state.undoStack, command],
    redoStack: [], // clear redo on new action
  };
}

/**
 * Undo the last command.
 */
export function undo(state: EditorState): EditorState {
  if (state.undoStack.length === 0) return state;

  const command = state.undoStack[state.undoStack.length - 1];
  const subpage = getActiveSubpage(state);
  if (!subpage) return state;

  const newSubpage = command.undo(subpage);
  const newState = replaceActiveSubpage(state, newSubpage);

  return {
    ...newState,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, command],
  };
}

/**
 * Redo the last undone command.
 */
export function redo(state: EditorState): EditorState {
  if (state.redoStack.length === 0) return state;

  const command = state.redoStack[state.redoStack.length - 1];
  const subpage = getActiveSubpage(state);
  if (!subpage) return state;

  const newSubpage = command.apply(subpage);
  const newState = replaceActiveSubpage(state, newSubpage);

  return {
    ...newState,
    undoStack: [...state.undoStack, command],
    redoStack: state.redoStack.slice(0, -1),
  };
}

/**
 * Set the active page.
 */
export function setActivePage(state: EditorState, pageNumber: number): EditorState {
  return { ...state, activePageNumber: pageNumber, activeSubpageIndex: 0 };
}

/**
 * Set the active subpage index.
 */
export function setActiveSubpage(state: EditorState, index: number): EditorState {
  return { ...state, activeSubpageIndex: index };
}

// ─── Internal ───────────────────────────────────────────────────

function replaceActiveSubpage(state: EditorState, newSubpage: TeletextSubpage): EditorState {
  if (state.activePageNumber === null) return state;

  const newPages = state.service.pages.map(page => {
    if (page.pageNumber !== state.activePageNumber) return page;
    const newSubpages = [...page.subpages];
    newSubpages[state.activeSubpageIndex] = newSubpage;
    return { ...page, subpages: newSubpages };
  });

  return {
    ...state,
    service: { ...state.service, pages: newPages },
  };
}
