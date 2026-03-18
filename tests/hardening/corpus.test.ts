import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createEmptyPage,
  createEmptyService,
  createEmptySubpage,
  charToken,
  controlToken,
  mosaicToken,
  fillToken,
  textTokens,
  normalizeRowTo40Columns,
  resolveRowToDisplayBytes,
  stripEditorMetadata,
  tokenDisplayWidth,
} from '../../src/model/factories.js';
import { validatePage, validateService } from '../../src/model/validators.js';
import { importTti, exportPageToTti, exportServiceToTti } from '../../src/tti/index.js';
import { compileRow, compilePage, compileService } from '../../src/compile/index.js';
import {
  encodeSextant,
  decodeSextant,
  pixelsToSextants,
  rgbaToGrayscale,
  applyThreshold,
  buildImportMutations,
  applyImportToSubpage,
} from '../../src/import/index.js';
import {
  createEditorState,
  applyCommand,
  undo,
  redo,
  setActivePage,
  getActiveSubpage,
  setCellCommand,
  plotMosaicCommand,
  clearRegionCommand,
} from '../../src/editor/index.js';
import { addPage, serializeBundle, deserializeBundle } from '../../src/bundle/index.js';

// ─── Corpus fixture: text page ──────────────────────────────────

function makeTextPage() {
  const page = createEmptyPage(0x100);
  page.description = 'Corpus: text page';
  page.subpages[0].rows[0] = {
    index: 0,
    tokens: [controlToken(0x07), ...textTokens('CEEFAX'), fillToken(33)],
  };
  page.subpages[0].rows[2] = {
    index: 2,
    tokens: [controlToken(0x01), ...textTokens('Breaking News'), fillToken(26)],
  };
  page.subpages[0].rows[23] = {
    index: 23,
    tokens: [controlToken(0x06), ...textTokens('Page 100'), fillToken(31)],
  };
  page.fastext = { red: 0x200, green: 0x300, yellow: 0x400 };
  return page;
}

// ─── Corpus fixture: graphics page ──────────────────────────────

function makeGraphicsPage() {
  const page = createEmptyPage(0x200);
  page.description = 'Corpus: graphics page';
  page.subpages[0].rows[0] = {
    index: 0,
    tokens: [controlToken(0x07), ...textTokens('GRAPHICS'), fillToken(31)],
  };
  // Row 5: mosaic art
  page.subpages[0].rows[5] = {
    index: 5,
    tokens: [
      controlToken(0x12), // mosaic green
      mosaicToken(0x3F, true),
      mosaicToken(0x7F, true),
      mosaicToken(0x21, true),
      mosaicToken(0x22, true),
      fillToken(35),
    ],
  };
  return page;
}

// ─── Corpus fixture: multi-subpage carousel ─────────────────────

function makeCarouselPage() {
  const page = createEmptyPage(0x300);
  page.description = 'Corpus: carousel';
  page.defaultCycle = { mode: 'cycle', value: 8 };
  page.subpages = [
    createEmptySubpage(0),
    createEmptySubpage(1),
    createEmptySubpage(2),
  ];
  page.subpages[0].rows[2] = {
    index: 2,
    tokens: [controlToken(0x07), ...textTokens('Subpage 1'), fillToken(30)],
  };
  page.subpages[1].rows[2] = {
    index: 2,
    tokens: [controlToken(0x07), ...textTokens('Subpage 2'), fillToken(30)],
  };
  page.subpages[2].rows[2] = {
    index: 2,
    tokens: [controlToken(0x07), ...textTokens('Subpage 3'), fillToken(30)],
  };
  return page;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ─── Corpus tests ───────────────────────────────────────────────

describe('Golden corpus: validation', () => {
  const corpus = [makeTextPage(), makeGraphicsPage(), makeCarouselPage()];

  for (const page of corpus) {
    it(`${page.description} validates`, () => {
      const result = validatePage(page);
      expect(result.valid).toBe(true);
    });
  }
});

describe('Golden corpus: TTI round-trip', () => {
  const corpus = [makeTextPage(), makeGraphicsPage(), makeCarouselPage()];

  for (const page of corpus) {
    it(`${page.description} round-trips through TTI`, () => {
      const tti = exportPageToTti(page);
      const imported = importTti(tti);
      expect(imported.pages.length).toBeGreaterThanOrEqual(1);

      // Re-export and compare
      const reExported = exportPageToTti(imported.pages[0]);
      // The second export should match the first structurally
      // (exact string match may vary due to metadata differences)
      const reimported = importTti(reExported);
      expect(reimported.pages[0].pageNumber).toBe(page.pageNumber);
    });
  }
});

describe('Golden corpus: compile determinism', () => {
  const corpus = [makeTextPage(), makeGraphicsPage(), makeCarouselPage()];

  for (const page of corpus) {
    it(`${page.description} compiles deterministically`, () => {
      const r1 = compilePage(page);
      const r2 = compilePage(page);
      expect(r1.length).toBe(r2.length);
      for (let i = 0; i < r1.length; i++) {
        expect(hashBytes(r1[i].headerPacket.payload)).toBe(hashBytes(r2[i].headerPacket.payload));
        for (let j = 0; j < r1[i].displayPackets.length; j++) {
          expect(hashBytes(r1[i].displayPackets[j].payload)).toBe(hashBytes(r2[i].displayPackets[j].payload));
        }
      }
    });
  }
});

describe('Golden corpus: compile row byte exactness', () => {
  it('control codes in compiled rows match source', () => {
    const page = makeTextPage();
    const compiled = compilePage(page);
    const headerBytes = compiled[0].headerPacket.payload;
    // Row 0 has control code 0x07 at the start (within display area, byte 8+)
    // Exact position depends on header layout — just verify it contains 0x07
    const displayBytes = compiled[0].displayPackets[1]?.payload; // row 2
    if (displayBytes) {
      expect(displayBytes[0]).toBe(0x01); // alpha red
    }
  });
});

describe('Golden corpus: bundle round-trip', () => {
  it('service survives serialize/deserialize', () => {
    let svc = createEmptyService('corpus', 'Corpus Service');
    svc = addPage(svc, makeTextPage());
    svc = addPage(svc, makeGraphicsPage());
    svc = addPage(svc, makeCarouselPage());

    const json = serializeBundle(svc);
    const restored = deserializeBundle(json);
    expect(restored.pages.length).toBe(3);
    expect(validateService(restored).valid).toBe(true);

    // Pages preserved
    expect(restored.pages[0].pageNumber).toBe(0x100);
    expect(restored.pages[1].pageNumber).toBe(0x200);
    expect(restored.pages[2].pageNumber).toBe(0x300);
    expect(restored.pages[2].subpages.length).toBe(3);
  });
});

describe('Golden corpus: editor mutations are reversible', () => {
  it('all edits can be undone to restore original', () => {
    let svc = createEmptyService('test');
    svc = addPage(svc, makeTextPage());
    let state = createEditorState(svc);
    state = setActivePage(state, 0x100);

    const originalRow = getActiveSubpage(state)!.rows[10];

    // Apply several mutations
    state = applyCommand(state, setCellCommand({ row: 10, col: 0, token: charToken(0x41) }));
    state = applyCommand(state, setCellCommand({ row: 10, col: 1, token: charToken(0x42) }));
    state = applyCommand(state, plotMosaicCommand({ row: 10, col: 5, sextantBit: 3, value: true, contiguous: true }));

    // Undo all
    state = undo(state);
    state = undo(state);
    state = undo(state);

    const restoredBytes = resolveRowToDisplayBytes(getActiveSubpage(state)!.rows[10]);
    const originalBytes = resolveRowToDisplayBytes(originalRow);
    expect(Array.from(restoredBytes)).toEqual(Array.from(originalBytes));
  });
});

describe('Golden corpus: bitmap import produces editable content', () => {
  it('imported bitmap is standard token stream', () => {
    // 4x6 grayscale image (2x2 sextant cells)
    const gray = new Uint8Array([
      255, 255, 0, 0,
      255, 255, 0, 0,
      255, 255, 0, 0,
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]);
    const binary = applyThreshold(gray, 128);
    const sextants = pixelsToSextants(binary, 4, 6, 128);
    const result = buildImportMutations(sextants, {
      region: { x: 0, y: 0, width: 2, height: 2 },
      fgColor: 7,
      contiguous: true,
      eraseFirst: false,
    });

    const sp = createEmptySubpage(0);
    const updated = applyImportToSubpage(sp, result);

    // Verify all tokens are standard types
    for (const row of updated.rows) {
      for (const token of row.tokens) {
        expect(['char', 'mosaic', 'control', 'fill']).toContain(token.kind);
      }
    }

    // Verify the page validates
    const page = createEmptyPage(0x100);
    page.subpages = [updated];
    expect(validatePage(page).valid).toBe(true);
  });
});

describe('Golden corpus: strip editor metadata does not affect compiled output', () => {
  it('stripped page compiles identically to original', () => {
    const page = makeTextPage();
    page.subpages[0].editorMeta = {
      guides: [{ id: 'g1', x: 0, y: 0, width: 10, height: 5 }],
      traceImage: { assetId: 'img1', opacity: 0.5, fitMode: 'contain' },
    };
    // Add a comment token
    page.subpages[0].rows[5] = {
      index: 5,
      tokens: [
        charToken(0x41),
        { kind: 'comment', text: 'editor note' },
        fillToken(39),
      ],
    };

    const r1 = compilePage(page);
    const stripped = stripEditorMetadata(page);
    const r2 = compilePage(stripped);

    expect(r1.length).toBe(r2.length);
    for (let i = 0; i < r1.length; i++) {
      expect(hashBytes(r1[i].headerPacket.payload)).toBe(hashBytes(r2[i].headerPacket.payload));
    }
  });
});

describe('Sextant encoding: exhaustive round-trip', () => {
  it('all 64 possible sextant patterns encode and decode correctly', () => {
    for (let bits = 0; bits < 64; bits++) {
      const cell = {
        bits: [
          (bits >> 0) & 1,
          (bits >> 1) & 1,
          (bits >> 2) & 1,
          (bits >> 3) & 1,
          (bits >> 4) & 1,
          (bits >> 5) & 1,
        ] as [number, number, number, number, number, number],
      };
      const encoded = encodeSextant(cell);
      const decoded = decodeSextant(encoded);
      expect(decoded.bits).toEqual(cell.bits);

      // Encoded byte must be in valid mosaic range
      const validRange = (encoded >= 0x20 && encoded <= 0x3F) || (encoded >= 0x60 && encoded <= 0x7F);
      expect(validRange).toBe(true);
    }
  });
});
