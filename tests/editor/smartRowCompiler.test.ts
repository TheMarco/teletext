import { describe, it, expect } from 'vitest';
import { compileVisualRow, decompileToVisualRow } from '../../src/editor/smartRowCompiler.js';
import { createVisualGrid, defaultVisualCell } from '../../src/editor/visualTypes.js';
import { compileRow } from '../../src/compile/index.js';
import { processRow } from '../../src/state-machine/state-machine.js';

function makeRow(cells: Array<Partial<import('../../src/editor/visualTypes.js').VisualCell>>) {
  const row = [];
  for (let i = 0; i < 40; i++) {
    row.push({ ...defaultVisualCell(), ...cells[i] });
  }
  return row;
}

describe('smartRowCompiler', () => {
  it('compiles a blank row to all spaces', () => {
    const row = makeRow([]);
    const result = compileVisualRow(row);
    expect(result.tokens.length).toBe(40);
    expect(result.tokens.every(t => t.kind === 'char' && t.codepoint7 === 0x20)).toBe(true);
  });

  it('compiles white text without extra codes (default state)', () => {
    const row = makeRow([
      { char: 0x48, fg: 7 }, // H
      { char: 0x49, fg: 7 }, // I
    ]);
    const result = compileVisualRow(row);
    // No color codes needed — default is white
    expect(result.tokens[0]).toEqual({ kind: 'char', codepoint7: 0x48 });
    expect(result.tokens[1]).toEqual({ kind: 'char', codepoint7: 0x49 });
  });

  it('places control code BEFORE the cell that needs it', () => {
    // Red H at position 1 — control code goes at position 0
    const row = makeRow([
      { char: 0x20, fg: 7 }, // space (will be overwritten by control code)
      { char: 0x48, fg: 1 }, // H in red at position 1
    ]);
    const result = compileVisualRow(row);
    // Position 0: control code (red), Position 1: H
    expect(result.tokens[0]).toEqual({ kind: 'control', codepoint7: 0x01 });
    expect(result.tokens[1]).toEqual({ kind: 'char', codepoint7: 0x48 });
  });

  it('cell at position 0 with non-default color has no room for control code', () => {
    // Red H at position 0 — no room before it for a control code
    const row = makeRow([
      { char: 0x48, fg: 1 }, // H in red at position 0
    ]);
    const result = compileVisualRow(row);
    // Position 0 should still be the H (can't place control before position 0)
    // The color won't be applied correctly, but position is preserved
    expect(result.tokens.length).toBe(40);
  });

  it('mosaic control code placed before mosaic cell', () => {
    const row = makeRow([
      { char: 0x20, fg: 7 }, // space (overwritten by control code)
      { char: 0x3F, fg: 2, mosaic: true }, // green mosaic at position 1
    ]);
    const result = compileVisualRow(row);
    expect(result.tokens[0]).toEqual({ kind: 'control', codepoint7: 0x12 }); // mosaic green
    expect(result.tokens[1]).toEqual({ kind: 'mosaic', codepoint7: 0x3F, contiguous: true });
  });

  it('multiple color changes overwrite preceding cells', () => {
    const row = makeRow([
      { char: 0x20, fg: 7 }, // overwritten by red code
      { char: 0x41, fg: 1 }, // A red at position 1
      { char: 0x20, fg: 1 }, // overwritten by green code
      { char: 0x43, fg: 2 }, // C green at position 3
    ]);
    const result = compileVisualRow(row);
    const controls = result.tokens.filter(t => t.kind === 'control');
    expect(controls.length).toBe(2); // red + green
    // Positions are preserved
    expect(result.tokens[1].codepoint7).toBe(0x41); // A still at pos 1
    expect(result.tokens[3].codepoint7).toBe(0x43); // C still at pos 3
  });

  it('compiles result is always exactly 40 tokens', () => {
    const row = makeRow(Array.from({ length: 40 }, (_, i) => ({ char: 0x41, fg: i % 8 })));
    const result = compileVisualRow(row);
    expect(result.tokens.length).toBe(40);
  });

  it('renders correctly through the full pipeline', () => {
    const row = makeRow([
      { char: 0x20, fg: 7 }, // space (overwritten by control code)
      { char: 0x48, fg: 1 }, // H in red at position 1
      { char: 0x49, fg: 1 }, // I in red at position 2
    ]);
    const result = compileVisualRow(row);
    const compiled = compileRow({ index: 0, tokens: result.tokens });
    expect(compiled.bytes40.length).toBe(40);
    const cells = processRow(Array.from(compiled.bytes40));
    // H should be at position 1 and be red
    expect(cells[1].char).toBe(0x48);
    expect(cells[1].fgColor).toBe(1); // red
  });
});

describe('decompileToVisualRow', () => {
  it('decompiles blank row', () => {
    const bytes = new Array(40).fill(0x20);
    const visual = decompileToVisualRow(bytes);
    expect(visual.length).toBe(40);
    expect(visual[0].fg).toBe(7);
    expect(visual[0].bg).toBe(0);
  });

  it('decompiles row with color code', () => {
    const bytes = new Array(40).fill(0x20);
    bytes[0] = 0x01; // alpha red
    bytes[1] = 0x48; // H
    const visual = decompileToVisualRow(bytes);
    expect(visual[0].char).toBe(0x20); // control code = space
    expect(visual[1].fg).toBe(1); // red
    expect(visual[1].char).toBe(0x48);
  });

  it('round-trips: compile → render → decompile preserves positions', () => {
    const row = makeRow([
      { char: 0x20, fg: 7 },
      { char: 0x48, fg: 1 }, // red H at position 1
      { char: 0x49, fg: 1 }, // red I at position 2
    ]);
    const compiled = compileVisualRow(row);
    const bytes = compileRow({ index: 0, tokens: compiled.tokens }).bytes40;
    const decompiled = decompileToVisualRow(Array.from(bytes));

    // H should be at position 1, red
    expect(decompiled[1].char).toBe(0x48);
    expect(decompiled[1].fg).toBe(1);
  });
});
