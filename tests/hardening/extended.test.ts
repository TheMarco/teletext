import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compiler
import { hammingEncode84, addParity, toWireBytes, compileRow, compilePage } from '../../src/compile/index.js';
import { createEmptyPage, charToken, controlToken, fillToken, textTokens } from '../../src/model/factories.js';

// Editor
import {
  createEditorState, applyCommand, undo, redo, setActivePage, getActiveSubpage,
  setCellCommand, duplicateRowCommand, insertRowTemplateCommand,
  pasteRegionCommand, copyRegion, floodFillMosaicCommand, setPageFlagsCommand,
  expandTokens, collapseTokens, renderSubpage, previewCheck,
} from '../../src/editor/index.js';
import { addPage } from '../../src/bundle/index.js';
import { createEmptyService } from '../../src/model/factories.js';

// Import
import {
  sharpen, posterize, edgeEmphasis, resizeNearest, fitToRegion,
  planRowColors, buildTwoColorRowTokens,
  rgbaToGrayscale, applyThreshold, pixelsToSextants,
} from '../../src/import/index.js';

// National glyphs
import { getNationalGlyph, hasNationalGlyph, GlyphCache } from '../../src/glyph-system/index.js';

// TTI fixtures
import { importTti } from '../../src/tti/index.js';
import { validateService } from '../../src/model/validators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../src/test-fixtures');

// ─── Hamming encoding tests ─────────────────────────────────────

describe('Hamming 8/4 encoding', () => {
  it('encodes all 16 nibbles', () => {
    for (let n = 0; n < 16; n++) {
      const encoded = hammingEncode84(n);
      expect(encoded).toBeGreaterThanOrEqual(0);
      expect(encoded).toBeLessThan(256);
    }
  });

  it('all encoded values are distinct', () => {
    const values = new Set<number>();
    for (let n = 0; n < 16; n++) values.add(hammingEncode84(n));
    expect(values.size).toBe(16);
  });
});

describe('Parity encoding', () => {
  it('adds odd parity to 7-bit byte', () => {
    const p = addParity(0x41); // 'A' = 0b1000001, 2 bits → need parity 1
    // Count bits in result
    let bits = 0;
    let v = p;
    while (v) { bits += v & 1; v >>= 1; }
    expect(bits % 2).toBe(1); // odd
  });

  it('result is always 8-bit', () => {
    for (let b = 0; b < 128; b++) {
      const p = addParity(b);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(256);
    }
  });
});

describe('toWireBytes', () => {
  it('produces 42-byte output', () => {
    const page = createEmptyPage(0x100);
    const compiled = compilePage(page);
    const wire = toWireBytes(compiled[0].headerPacket);
    expect(wire.length).toBe(42);
  });
});

// ─── Extended editor command tests ──────────────────────────────

function setupEditor() {
  let svc = createEmptyService('test');
  svc = addPage(svc, createEmptyPage(0x100));
  let state = createEditorState(svc);
  state = setActivePage(state, 0x100);
  return state;
}

describe('duplicateRowCommand', () => {
  it('copies row content to target', () => {
    let state = setupEditor();
    state = applyCommand(state, setCellCommand({ row: 5, col: 0, token: charToken(0x41) }));
    state = applyCommand(state, duplicateRowCommand({ sourceRow: 5, targetRow: 10 }));

    const sp = getActiveSubpage(state)!;
    expect(expandTokens(sp.rows[10].tokens)[0].codepoint7).toBe(0x41);
  });

  it('is undoable', () => {
    let state = setupEditor();
    state = applyCommand(state, setCellCommand({ row: 5, col: 0, token: charToken(0x41) }));
    state = applyCommand(state, duplicateRowCommand({ sourceRow: 5, targetRow: 10 }));
    state = undo(state);

    const sp = getActiveSubpage(state)!;
    expect(expandTokens(sp.rows[10].tokens)[0].codepoint7).toBe(0x20);
  });
});

describe('insertRowTemplateCommand', () => {
  it('replaces row with template', () => {
    let state = setupEditor();
    state = applyCommand(state, insertRowTemplateCommand({
      row: 3,
      tokens: [controlToken(0x07), ...textTokens('HEADER'), fillToken(33)],
    }));

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[3].tokens);
    expect(expanded[0].codepoint7).toBe(0x07);
    expect(expanded[1].codepoint7).toBe(0x48); // H
  });
});

describe('copyRegion + pasteRegionCommand', () => {
  it('copies and pastes cells', () => {
    let state = setupEditor();
    state = applyCommand(state, setCellCommand({ row: 0, col: 0, token: charToken(0x41) }));
    state = applyCommand(state, setCellCommand({ row: 0, col: 1, token: charToken(0x42) }));

    const clip = copyRegion(getActiveSubpage(state)!, 0, 0, 0, 1);
    state = applyCommand(state, pasteRegionCommand({ targetRow: 5, targetCol: 10, clipboard: clip }));

    const sp = getActiveSubpage(state)!;
    const expanded = expandTokens(sp.rows[5].tokens);
    expect(expanded[10].codepoint7).toBe(0x41);
    expect(expanded[11].codepoint7).toBe(0x42);
  });
});

describe('floodFillMosaicCommand', () => {
  it('fills a region with mosaic bits', () => {
    let state = setupEditor();
    state = applyCommand(state, floodFillMosaicCommand({
      row: 0, col: 0, sextantBit: 0, value: true, contiguous: true,
      bounds: { startRow: 2, startCol: 0, endRow: 4, endCol: 5 },
    }));

    const sp = getActiveSubpage(state)!;
    for (let r = 2; r <= 4; r++) {
      const expanded = expandTokens(sp.rows[r].tokens);
      for (let c = 0; c <= 5; c++) {
        expect(expanded[c].kind).toBe('mosaic');
      }
    }
  });
});

describe('setPageFlagsCommand', () => {
  it('sets flags', () => {
    let state = setupEditor();
    state = applyCommand(state, setPageFlagsCommand({ flags: { newsflash: true } }));
    expect(getActiveSubpage(state)!.pageFlags.newsflash).toBe(true);
  });

  it('is undoable', () => {
    let state = setupEditor();
    state = applyCommand(state, setPageFlagsCommand({ flags: { newsflash: true } }));
    state = undo(state);
    expect(getActiveSubpage(state)!.pageFlags.newsflash).toBe(false);
  });
});

// ─── Preview adapter tests ──────────────────────────────────────

describe('Preview adapter', () => {
  it('renderSubpage produces valid pixel buffer', () => {
    const state = setupEditor();
    const sp = getActiveSubpage(state)!;
    const result = renderSubpage(sp);
    expect(result.width).toBe(480);
    expect(result.height).toBe(240);
    expect(result.data.length).toBe(480 * 240 * 4);
  });

  it('previewCheck returns compiled bytes and render result', () => {
    const state = setupEditor();
    const sp = getActiveSubpage(state)!;
    const { result, compiledBytes } = previewCheck(sp);
    expect(compiledBytes.length).toBe(24);
    expect(compiledBytes[0].length).toBe(40);
    expect(result.data.length).toBeGreaterThan(0);
  });
});

// ─── Image preprocessing tests ──────────────────────────────────

describe('Image preprocessing', () => {
  const testImage = new Uint8Array(16).fill(128);

  it('sharpen produces same-size output', () => {
    const result = sharpen(testImage, 4, 4);
    expect(result.length).toBe(16);
  });

  it('posterize to 2 levels produces binary output', () => {
    const gray = new Uint8Array([0, 64, 128, 192, 255]);
    const result = posterize(gray, 2);
    for (const v of result) expect(v === 0 || v === 255).toBe(true);
  });

  it('edgeEmphasis produces same-size output', () => {
    const result = edgeEmphasis(testImage, 4, 4);
    expect(result.length).toBe(16);
  });

  it('resizeNearest scales correctly', () => {
    const src = new Uint8Array([0, 255, 0, 255]);
    const dst = resizeNearest(src, 2, 2, 4, 4);
    expect(dst.length).toBe(16);
  });

  it('fitToRegion contain mode preserves aspect', () => {
    const gray = new Uint8Array(20 * 10).fill(128); // 20×10
    const fitted = fitToRegion(gray, 20, 10, 10, 5, 'contain');
    expect(fitted.width).toBe(20);  // 10 cols × 2
    expect(fitted.height).toBe(15); // 5 rows × 3
  });

  it('fitToRegion stretch mode ignores aspect', () => {
    const gray = new Uint8Array(20 * 10).fill(128);
    const fitted = fitToRegion(gray, 20, 10, 10, 5, 'stretch');
    expect(fitted.width).toBe(20);
    expect(fitted.height).toBe(15);
  });
});

// ─── Two-color import tests ─────────────────────────────────────

describe('Two-color row import', () => {
  it('planRowColors finds dominant colors per row', () => {
    // 4×3 RGBA image: top half red, bottom row green
    const rgba = new Uint8Array(4 * 3 * 4);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      rgba[i] = 255; rgba[i + 3] = 255; // red
    }
    for (let x = 0; x < 4; x++) {
      const i = (2 * 4 + x) * 4;
      rgba[i + 1] = 255; rgba[i + 3] = 255; // green
    }

    const plans = planRowColors(rgba, 4, 3, 1);
    expect(plans.length).toBe(1);
    // Most pixels are red
    expect(plans[0].bgColor).toBe(1); // RED
  });

  it('buildTwoColorRowTokens produces valid tokens', () => {
    const sextants = [{ bits: [1, 1, 1, 1, 1, 1] as [number, number, number, number, number, number] }];
    const tokens = buildTwoColorRowTokens(sextants, { row: 0, fgColor: 7, bgColor: 0 }, 0, true);
    expect(tokens.some(t => t.kind === 'control')).toBe(true);
    expect(tokens.some(t => t.kind === 'mosaic')).toBe(true);
  });
});

// ─── National glyph tests ───────────────────────────────────────

describe('National variant glyphs', () => {
  it('has glyphs for common accented characters', () => {
    expect(hasNationalGlyph(0x00E9)).toBe(true); // é
    expect(hasNationalGlyph(0x00E4)).toBe(true); // ä
    expect(hasNationalGlyph(0x00F6)).toBe(true); // ö
    expect(hasNationalGlyph(0x00FC)).toBe(true); // ü
    expect(hasNationalGlyph(0x00E7)).toBe(true); // ç
    expect(hasNationalGlyph(0x00DF)).toBe(true); // ß
  });

  it('getNationalGlyph returns 120-byte pixel array', () => {
    const glyph = getNationalGlyph(0x00E9);
    expect(glyph).not.toBeNull();
    expect(glyph!.length).toBe(120); // 12 × 10
  });

  it('national glyphs have non-zero pixels', () => {
    const glyph = getNationalGlyph(0x00E9)!;
    const sum = glyph.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('GlyphCache uses real national glyphs for French subset', () => {
    const cache = new GlyphCache();
    cache.setNationalSubset('french');
    // French: 0x23 (#) → é (U+00E9)
    const id = cache.resolveG0(0x23);
    const glyph = cache.getGlyph(id);
    const sum = glyph.pixels.reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
  });
});

// ─── Real-world TTI fixture import tests ────────────────────────

describe('Real-world TTI fixtures', () => {
  it('imports ceefax-style.tti', () => {
    const tti = readFileSync(resolve(fixturesDir, 'ceefax-style.tti'), 'utf-8');
    const svc = importTti(tti, 'ceefax');
    expect(svc.pages.length).toBe(1);
    expect(svc.pages[0].pageNumber).toBe(0x100);
    expect(svc.pages[0].fastext?.red).toBe(0x101);
    expect(validateService(svc).valid).toBe(true);
  });

  it('imports graphics-page.tti', () => {
    const tti = readFileSync(resolve(fixturesDir, 'graphics-page.tti'), 'utf-8');
    const svc = importTti(tti, 'gfx');
    expect(svc.pages.length).toBe(1);
    expect(svc.pages[0].pageNumber).toBe(0x200);
    expect(validateService(svc).valid).toBe(true);
  });

  it('imports carousel-3sub.tti with 3 subpages', () => {
    const tti = readFileSync(resolve(fixturesDir, 'carousel-3sub.tti'), 'utf-8');
    const svc = importTti(tti, 'carousel');
    expect(svc.pages.length).toBe(1);
    expect(svc.pages[0].pageNumber).toBe(0x400);
    expect(svc.pages[0].subpages.length).toBe(3);
    expect(svc.pages[0].defaultCycle?.mode).toBe('time');
    expect(svc.pages[0].defaultCycle?.value).toBe(10);
    expect(validateService(svc).valid).toBe(true);
  });
});

// ─── Collapse optimization test ─────────────────────────────────

describe('Token collapse optimization', () => {
  it('merges 3+ consecutive same chars into fill', () => {
    const tokens = Array(10).fill(null).map(() => charToken(0x20));
    const collapsed = collapseTokens(tokens);
    expect(collapsed.some(t => t.kind === 'fill')).toBe(true);
  });

  it('does not merge 2 consecutive chars', () => {
    const tokens = [charToken(0x41), charToken(0x41), charToken(0x42)];
    const collapsed = collapseTokens(tokens);
    expect(collapsed.length).toBe(3);
  });
});
