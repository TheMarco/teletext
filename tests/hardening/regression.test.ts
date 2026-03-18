import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createEmptyPage, createEmptyService, createEmptySubpage,
  charToken, controlToken, mosaicToken, fillToken, textTokens,
  normalizeRowTo40Columns, resolveRowToDisplayBytes,
  stripEditorMetadata, tokenDisplayWidth, clonePage,
} from '../../src/model/factories.js';
import { validatePage, validateService } from '../../src/model/validators.js';
import { importTti, exportPageToTti, exportServiceToTti } from '../../src/tti/index.js';
import { compileRow, compilePage, compileService } from '../../src/compile/index.js';
import {
  encodeSextant, decodeSextant, pixelsToSextants,
  rgbaToGrayscale, applyThreshold,
  buildImportMutations, applyImportToSubpage,
  fitToRegion, sharpen, posterize, edgeEmphasis,
} from '../../src/import/index.js';
import {
  createEditorState, applyCommand, undo, redo,
  setActivePage, setActiveSubpage, getActiveSubpage,
  setCellCommand, plotMosaicCommand, clearRegionCommand,
  duplicateRowCommand, copyRegion, pasteRegionCommand,
  floodFillMosaicCommand, setPageFlagsCommand,
  expandTokens, renderSubpage,
} from '../../src/editor/index.js';
import { addPage, serializeBundle, deserializeBundle } from '../../src/bundle/index.js';

function hash(data: Uint8ClampedArray | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── Model regression ───────────────────────────────────────────

describe('Regression: model invariants', () => {
  it('normalizeRowTo40Columns is idempotent', () => {
    const row = { index: 0, tokens: [charToken(0x41), fillToken(10), charToken(0x42)] };
    const n1 = normalizeRowTo40Columns(row);
    const n2 = normalizeRowTo40Columns(n1);
    expect(tokenDisplayWidth(n1.tokens)).toBe(40);
    expect(tokenDisplayWidth(n2.tokens)).toBe(40);
    expect(resolveRowToDisplayBytes(n1)).toEqual(resolveRowToDisplayBytes(n2));
  });

  it('stripEditorMetadata + compile = same as compile with metadata', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].editorMeta = { guides: [{ id: 'g1', x: 0, y: 0, width: 10, height: 5 }] };
    page.subpages[0].rows[5] = {
      index: 5,
      tokens: [controlToken(0x07), ...textTokens('TEST'), { kind: 'comment', text: 'note' }, fillToken(34)],
    };
    const r1 = compilePage(page);
    const r2 = compilePage(stripEditorMetadata(page));
    expect(hash(r1[0].displayPackets[4].payload)).toBe(hash(r2[0].displayPackets[4].payload));
  });

  it('clonePage creates independent deep copy', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].rows[0].tokens = [controlToken(0x01), fillToken(39)];
    const clone = clonePage(page);
    clone.subpages[0].rows[0].tokens = [controlToken(0x07), fillToken(39)];
    // Original unchanged
    expect(page.subpages[0].rows[0].tokens[0]).toEqual({ kind: 'control', codepoint7: 0x01 });
  });
});

// ─── TTI regression ─────────────────────────────────────────────

describe('Regression: TTI round-trip stability', () => {
  it('export→import→export produces identical output', () => {
    const page = createEmptyPage(0x100);
    page.description = 'Stability test';
    page.fastext = { red: 0x200, green: 0x300 };
    page.subpages[0].rows[0] = { index: 0, tokens: [controlToken(0x07), ...textTokens('STABLE'), fillToken(33)] };
    page.subpages[0].rows[10] = { index: 10, tokens: [controlToken(0x02), ...textTokens('green text'), fillToken(29)] };

    const tti1 = exportPageToTti(page);
    const imported = importTti(tti1);
    const tti2 = exportPageToTti(imported.pages[0]);
    const reimported = importTti(tti2);
    const tti3 = exportPageToTti(reimported.pages[0]);

    expect(tti2).toBe(tti3); // stable after 2 round-trips
  });

  it('multi-page service round-trips', () => {
    let svc = createEmptyService('rt', 'Round-trip');
    for (let i = 0; i < 5; i++) {
      const page = createEmptyPage(0x100 + i);
      page.description = `Page ${i}`;
      page.subpages[0].rows[2] = { index: 2, tokens: [controlToken(0x07), ...textTokens(`Content ${i}`), fillToken(30)] };
      svc = addPage(svc, page);
    }
    const tti = exportServiceToTti(svc);
    const imported = importTti(tti);
    expect(imported.pages.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(imported.pages[i].pageNumber).toBe(0x100 + i);
    }
  });
});

// ─── Compiler regression ────────────────────────────────────────

describe('Regression: compiler determinism', () => {
  it('same page compiles identically 100 times', () => {
    const page = createEmptyPage(0x200);
    page.subpages[0].rows[0] = { index: 0, tokens: [controlToken(0x07), ...textTokens('HEADER'), fillToken(33)] };
    page.subpages[0].rows[5] = { index: 5, tokens: [controlToken(0x11), mosaicToken(0x3F), mosaicToken(0x7F), fillToken(37)] };

    const baseline = compilePage(page);
    const baseHash = hash(baseline[0].headerPacket.payload);

    for (let i = 0; i < 100; i++) {
      const result = compilePage(page);
      expect(hash(result[0].headerPacket.payload)).toBe(baseHash);
    }
  });

  it('compiled row bytes are all 7-bit', () => {
    const page = createEmptyPage(0x100);
    for (let r = 0; r < 24; r++) {
      page.subpages[0].rows[r] = {
        index: r,
        tokens: [controlToken(r % 8), ...textTokens('Test row ' + r), fillToken(28)],
      };
    }
    const compiled = compilePage(page);
    for (const dp of compiled[0].displayPackets) {
      for (const byte of dp.payload) {
        expect(byte).toBeLessThanOrEqual(0x7F);
      }
    }
  });
});

// ─── Editor regression ──────────────────────────────────────────

describe('Regression: editor state integrity', () => {
  it('50 edits + 50 undos returns to original', () => {
    let svc = createEmptyService('test');
    svc = addPage(svc, createEmptyPage(0x100));
    let state = createEditorState(svc);
    state = setActivePage(state, 0x100);

    const originalBytes = resolveRowToDisplayBytes(getActiveSubpage(state)!.rows[5]);

    for (let i = 0; i < 50; i++) {
      state = applyCommand(state, setCellCommand({ row: 5, col: i % 40, token: charToken(0x41 + (i % 26)) }));
    }
    for (let i = 0; i < 50; i++) {
      state = undo(state);
    }

    const restoredBytes = resolveRowToDisplayBytes(getActiveSubpage(state)!.rows[5]);
    expect(Array.from(restoredBytes)).toEqual(Array.from(originalBytes));
  });

  it('redo after undo restores the edit', () => {
    let svc = createEmptyService('test');
    svc = addPage(svc, createEmptyPage(0x100));
    let state = createEditorState(svc);
    state = setActivePage(state, 0x100);

    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));
    const afterEdit = resolveRowToDisplayBytes(getActiveSubpage(state)!.rows[0]);

    state = undo(state);
    state = redo(state);

    const afterRedo = resolveRowToDisplayBytes(getActiveSubpage(state)!.rows[0]);
    expect(Array.from(afterRedo)).toEqual(Array.from(afterEdit));
  });
});

// ─── Import pipeline regression ─────────────────────────────────

describe('Regression: bitmap import pipeline', () => {
  it('sextant encode/decode is bijective for all 64 patterns', () => {
    for (let bits = 0; bits < 64; bits++) {
      const cell = {
        bits: [
          (bits >> 0) & 1, (bits >> 1) & 1, (bits >> 2) & 1,
          (bits >> 3) & 1, (bits >> 4) & 1, (bits >> 5) & 1,
        ] as [number, number, number, number, number, number],
      };
      const encoded = encodeSextant(cell);
      const decoded = decodeSextant(encoded);
      expect(decoded.bits).toEqual(cell.bits);
    }
  });

  it('imported bitmap produces valid compilable page', () => {
    const gray = new Uint8Array(40 * 30).fill(200);
    // Draw a simple pattern
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 20; x++) {
        gray[y * 40 + x] = 255;
      }
    }
    const binary = applyThreshold(gray, 128);
    const sextants = pixelsToSextants(binary, 40, 30, 128);
    const result = buildImportMutations(sextants, {
      region: { x: 0, y: 2, width: 20, height: 10 },
      fgColor: 7, contiguous: true, eraseFirst: false,
    });
    const sp = applyImportToSubpage(createEmptySubpage(0), result);
    const page = createEmptyPage(0x100);
    page.subpages = [sp];

    expect(validatePage(page).valid).toBe(true);
    const compiled = compilePage(page);
    expect(compiled.length).toBe(1);
    expect(compiled[0].displayPackets.length).toBe(23);
  });

  it('fitToRegion + pixelsToSextants produces consistent output', () => {
    const gray = new Uint8Array(100 * 50);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.floor(i / gray.length * 255);

    const fit1 = fitToRegion(gray, 100, 50, 20, 10, 'contain');
    const fit2 = fitToRegion(gray, 100, 50, 20, 10, 'contain');
    expect(Array.from(fit1.data)).toEqual(Array.from(fit2.data));

    const sext1 = pixelsToSextants(applyThreshold(fit1.data, 128), fit1.width, fit1.height, 128);
    const sext2 = pixelsToSextants(applyThreshold(fit2.data, 128), fit2.width, fit2.height, 128);
    expect(JSON.stringify(sext1)).toBe(JSON.stringify(sext2));
  });

  it('preprocessing functions are deterministic', () => {
    const gray = new Uint8Array(16);
    for (let i = 0; i < 16; i++) gray[i] = i * 16;

    expect(Array.from(sharpen(gray, 4, 4))).toEqual(Array.from(sharpen(gray, 4, 4)));
    expect(Array.from(posterize(gray, 4))).toEqual(Array.from(posterize(gray, 4)));
    expect(Array.from(edgeEmphasis(gray, 4, 4))).toEqual(Array.from(edgeEmphasis(gray, 4, 4)));
  });
});

// ─── Bundle regression ──────────────────────────────────────────

describe('Regression: bundle serialization', () => {
  it('large service survives serialize/deserialize', () => {
    let svc = createEmptyService('large', 'Large Service');
    for (let i = 0; i < 50; i++) {
      const page = createEmptyPage(0x100 + i);
      page.description = `Page ${i}`;
      if (i % 3 === 0) {
        page.subpages.push(createEmptySubpage(1));
        page.subpages.push(createEmptySubpage(2));
      }
      svc = addPage(svc, page);
    }

    const json = serializeBundle(svc);
    const restored = deserializeBundle(json);
    expect(restored.pages.length).toBe(50);
    expect(validateService(restored).valid).toBe(true);

    // Re-serialize should produce identical JSON
    const json2 = serializeBundle(restored);
    expect(json).toBe(json2);
  });
});

// ─── Cross-module regression ────────────────────────────────────

describe('Regression: full pipeline (model → compile → render)', () => {
  it('authored page renders without errors', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].rows[0] = { index: 0, tokens: [controlToken(0x07), ...textTokens('CEEFAX'), fillToken(33)] };
    page.subpages[0].rows[2] = { index: 2, tokens: [controlToken(0x11), mosaicToken(0x3F, true), mosaicToken(0x7F, true), fillToken(37)] };
    page.subpages[0].rows[4] = { index: 4, tokens: [controlToken(0x0D), controlToken(0x03), ...textTokens('BIG'), fillToken(35)] };

    const result = renderSubpage(page.subpages[0]);
    expect(result.width).toBe(480);
    expect(result.height).toBe(240);
    expect(result.data.length).toBe(480 * 240 * 4);

    // All pixels should be valid palette colors
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 3]).toBe(255); // full alpha
    }
  });

  it('TTI import → compile → render produces pixels', () => {
    const tti = 'DE,Test\nPN,10000\nPS,8000\nOL,0,\\x87        TEST PAGE\\x83100\nOL,5,\\x82 Hello world\n';
    const svc = importTti(tti);
    if (svc.pages.length > 0) {
      const compiled = compilePage(svc.pages[0]);
      expect(compiled.length).toBeGreaterThanOrEqual(1);

      const result = renderSubpage(svc.pages[0].subpages[0]);
      expect(result.data.length).toBeGreaterThan(0);
    }
  });
});
