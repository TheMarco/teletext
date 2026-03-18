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

  it('inserts alpha color code when fg changes', () => {
    const row = makeRow([
      { char: 0x48, fg: 1 }, // H in red
    ]);
    const result = compileVisualRow(row);
    // Should have: control(0x01=red), then H
    expect(result.tokens[0]).toEqual({ kind: 'control', codepoint7: 0x01 });
    expect(result.tokens[1]).toEqual({ kind: 'char', codepoint7: 0x48 });
  });

  it('inserts mosaic color code for mosaic cells', () => {
    const row = makeRow([
      { char: 0x3F, fg: 2, mosaic: true }, // green mosaic
    ]);
    const result = compileVisualRow(row);
    expect(result.tokens[0]).toEqual({ kind: 'control', codepoint7: 0x12 }); // mosaic green
    expect(result.tokens[1]).toEqual({ kind: 'mosaic', codepoint7: 0x3F, contiguous: true });
  });

  it('multiple color changes in one row', () => {
    const row = makeRow([
      { char: 0x41, fg: 1 }, // A red
      { char: 0x42, fg: 1 }, // B red (no change)
      { char: 0x43, fg: 2 }, // C green (change)
    ]);
    const result = compileVisualRow(row);
    // red code, A, B, green code, C
    const controls = result.tokens.filter(t => t.kind === 'control');
    expect(controls.length).toBe(2); // red + green
  });

  it('compiles result fits in 40 columns', () => {
    // Fill entire row with different colors — maximum control code overhead
    const row = makeRow(Array.from({ length: 40 }, (_, i) => ({ char: 0x41, fg: i % 8 })));
    const result = compileVisualRow(row);
    expect(result.tokens.length).toBe(40);
  });

  it('renders correctly through the full pipeline', () => {
    const row = makeRow([
      { char: 0x48, fg: 1 },
      { char: 0x49, fg: 1 },
    ]);
    const result = compileVisualRow(row);
    const compiled = compileRow({ index: 0, tokens: result.tokens });
    // Should produce valid 40-byte row
    expect(compiled.bytes40.length).toBe(40);
    // Run through state machine
    const cells = processRow(Array.from(compiled.bytes40));
    // The 'H' should be red
    // Find the first non-space cell
    const hCell = cells.find(c => c.char === 0x48);
    expect(hCell).toBeDefined();
    expect(hCell!.fgColor).toBe(1); // red
  });
});

describe('decompileToVisualRow', () => {
  it('decompiles blank row', () => {
    const bytes = new Array(40).fill(0x20);
    const visual = decompileToVisualRow(bytes);
    expect(visual.length).toBe(40);
    expect(visual[0].fg).toBe(7); // default white
    expect(visual[0].bg).toBe(0); // default black
  });

  it('decompiles row with color code', () => {
    const bytes = new Array(40).fill(0x20);
    bytes[0] = 0x01; // alpha red
    bytes[1] = 0x48; // H
    const visual = decompileToVisualRow(bytes);
    expect(visual[0].char).toBe(0x20); // control code = space
    expect(visual[1].fg).toBe(1); // red
    expect(visual[1].char).toBe(0x48); // H
  });

  it('round-trips: compile → render → decompile preserves colors', () => {
    const row = makeRow([
      { char: 0x48, fg: 1 }, // red H
      { char: 0x49, fg: 2 }, // green I
    ]);
    const compiled = compileVisualRow(row);
    const bytes = compileRow({ index: 0, tokens: compiled.tokens }).bytes40;
    const decompiled = decompileToVisualRow(Array.from(bytes));

    // Find the H and I in the decompiled row
    const hIdx = decompiled.findIndex(c => c.char === 0x48);
    const iIdx = decompiled.findIndex(c => c.char === 0x49);
    expect(hIdx).toBeGreaterThanOrEqual(0);
    expect(iIdx).toBeGreaterThanOrEqual(0);
    expect(decompiled[hIdx].fg).toBe(1); // red
    expect(decompiled[iIdx].fg).toBe(2); // green
  });
});
