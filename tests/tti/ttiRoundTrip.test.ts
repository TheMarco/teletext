import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTti, exportPageToTti, exportServiceToTti } from '../../src/tti/index.js';
import {
  createEmptyPage,
  createEmptyService,
  charToken,
  controlToken,
  fillToken,
  textTokens,
} from '../../src/model/factories.js';
import { validatePage, validateService } from '../../src/model/validators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../src/test-fixtures');

describe('TTI import from fixture file', () => {
  it('imports sample-page.tti', () => {
    const ttiText = readFileSync(resolve(fixturesDir, 'sample-page.tti'), 'utf-8');
    const service = importTti(ttiText, 'test-svc', 'Test');
    expect(service.pages).toHaveLength(1);
    expect(service.pages[0].pageNumber).toBe(0x100);
    expect(service.pages[0].description).toBe('Test Page 100');
    expect(service.pages[0].fastext).toBeDefined();
    expect(service.pages[0].fastext?.red).toBe(0x200);

    const result = validateService(service);
    expect(result.valid).toBe(true);
  });

  it('imports multi-subpage.tti', () => {
    const ttiText = readFileSync(resolve(fixturesDir, 'multi-subpage.tti'), 'utf-8');
    const service = importTti(ttiText, 'test-svc', 'Test');
    expect(service.pages).toHaveLength(1);
    expect(service.pages[0].subpages).toHaveLength(2);
    expect(service.pages[0].subpages[0].subcode).toBe(0);
    expect(service.pages[0].subpages[1].subcode).toBe(1);
  });
});

describe('TTI AST → TTI → AST round-trip', () => {
  it('round-trips a simple page', () => {
    // Build a page programmatically
    const page = createEmptyPage(0x100);
    page.description = 'Round-trip test';
    page.subpages[0].rows[0] = {
      index: 0,
      tokens: [
        controlToken(0x07), // alpha white
        ...textTokens('HELLO'),
        fillToken(34),
      ],
    };
    page.subpages[0].rows[5] = {
      index: 5,
      tokens: [
        controlToken(0x01), // alpha red
        ...textTokens('Red text here'),
        fillToken(26),
      ],
    };

    // Export to TTI
    const ttiText = exportPageToTti(page);

    // Re-import
    const service = importTti(ttiText, 'rt-test');
    expect(service.pages).toHaveLength(1);

    const imported = service.pages[0];
    expect(imported.pageNumber).toBe(0x100);
    expect(imported.description).toBe('Round-trip test');

    // Verify row content is preserved
    const sp = imported.subpages[0];

    // Row 0: control(0x07) + HELLO + spaces
    const row0tokens = sp.rows[0].tokens;
    // First token should be control 0x07
    expect(row0tokens[0]).toEqual({ kind: 'control', codepoint7: 0x07 });
    // Next 5 should be H, E, L, L, O
    expect(row0tokens[1]).toEqual({ kind: 'char', codepoint7: 0x48 });
    expect(row0tokens[5]).toEqual({ kind: 'char', codepoint7: 0x4F });
  });

  it('round-trips control codes without loss', () => {
    const page = createEmptyPage(0x200);
    // Row with several control codes
    page.subpages[0].rows[2] = {
      index: 2,
      tokens: [
        controlToken(0x01), // red
        controlToken(0x08), // flash
        ...textTokens('FLASH'),
        controlToken(0x09), // steady
        ...textTokens('OK'),
        fillToken(31),
      ],
    };

    const ttiText = exportPageToTti(page);
    const service = importTti(ttiText);
    const row = service.pages[0].subpages[0].rows[2];

    // Verify control codes survived
    const controls = row.tokens.filter(t => t.kind === 'control');
    expect(controls.length).toBe(3);
    expect(controls[0].codepoint7).toBe(0x01);
    expect(controls[1].codepoint7).toBe(0x08);
    expect(controls[2].codepoint7).toBe(0x09);
  });

  it('round-trips fastext links', () => {
    const page = createEmptyPage(0x100);
    page.fastext = { red: 0x200, green: 0x300, yellow: null, cyan: 0x500 };

    const ttiText = exportPageToTti(page);
    const service = importTti(ttiText);

    expect(service.pages[0].fastext?.red).toBe(0x200);
    expect(service.pages[0].fastext?.green).toBe(0x300);
  });

  it('round-trips page flags', () => {
    const page = createEmptyPage(0x100);
    page.subpages[0].pageFlags.newsflash = true;
    page.subpages[0].pageFlags.subtitle = true;

    const ttiText = exportPageToTti(page);
    const service = importTti(ttiText);

    const flags = service.pages[0].subpages[0].pageFlags;
    expect(flags.newsflash).toBe(true);
    expect(flags.subtitle).toBe(true);
    expect(flags.inhibitDisplay).toBe(false);
  });

  it('round-trips a full service', () => {
    const svc = createEmptyService('svc-1', 'Test Service');
    svc.pages = [createEmptyPage(0x100), createEmptyPage(0x200)];
    svc.pages[0].description = 'Page 100';
    svc.pages[1].description = 'Page 200';

    const ttiText = exportServiceToTti(svc);
    const imported = importTti(ttiText, 'svc-1', 'Test Service');

    expect(imported.pages).toHaveLength(2);
    expect(imported.pages[0].pageNumber).toBe(0x100);
    expect(imported.pages[1].pageNumber).toBe(0x200);
  });
});

describe('TTI export determinism', () => {
  it('same page produces identical export twice', () => {
    const page = createEmptyPage(0x100);
    page.description = 'Deterministic';
    page.subpages[0].rows[0].tokens = [
      controlToken(0x07),
      ...textTokens('TEST'),
      fillToken(35),
    ];

    const export1 = exportPageToTti(page);
    const export2 = exportPageToTti(page);
    expect(export1).toBe(export2);
  });
});
