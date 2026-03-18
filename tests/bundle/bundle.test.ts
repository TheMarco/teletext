import { describe, it, expect } from 'vitest';
import {
  serializeBundle,
  deserializeBundle,
  getPageIndex,
  addPage,
  removePage,
  getPage,
  reorderPages,
} from '../../src/bundle/index.js';
import { createEmptyService, createEmptyPage } from '../../src/model/factories.js';
import { validateService } from '../../src/model/validators.js';

describe('serializeBundle / deserializeBundle', () => {
  it('round-trips a service through JSON', () => {
    const svc = createEmptyService('svc-1', 'Test');
    svc.pages = [createEmptyPage(0x100), createEmptyPage(0x200)];
    svc.pages[0].description = 'Page 100';

    const json = serializeBundle(svc);
    const restored = deserializeBundle(json);

    expect(restored.id).toBe('svc-1');
    expect(restored.title).toBe('Test');
    expect(restored.pages.length).toBe(2);
    expect(restored.pages[0].pageNumber).toBe(0x100);
    expect(restored.pages[0].description).toBe('Page 100');
  });

  it('restored service validates', () => {
    const svc = createEmptyService('svc-1', 'Test');
    svc.pages = [createEmptyPage(0x100)];

    const json = serializeBundle(svc);
    const restored = deserializeBundle(json);
    const result = validateService(restored);
    expect(result.valid).toBe(true);
  });

  it('rejects unsupported version', () => {
    const json = JSON.stringify({ version: 99, service: {} });
    expect(() => deserializeBundle(json)).toThrow('Unsupported bundle version');
  });

  it('preserves subpage data', () => {
    const svc = createEmptyService('s1');
    const page = createEmptyPage(0x100);
    page.subpages[0].pageFlags.newsflash = true;
    page.subpages[0].languageSubset = 'german';
    svc.pages = [page];

    const restored = deserializeBundle(serializeBundle(svc));
    expect(restored.pages[0].subpages[0].pageFlags.newsflash).toBe(true);
    expect(restored.pages[0].subpages[0].languageSubset).toBe('german');
  });
});

describe('getPageIndex', () => {
  it('returns page summary', () => {
    const svc = createEmptyService('s1');
    svc.pages = [createEmptyPage(0x100), createEmptyPage(0x200)];
    svc.pages[0].description = 'Index';

    const index = getPageIndex(svc);
    expect(index).toEqual([
      { pageNumber: 0x100, subpageCount: 1, description: 'Index' },
      { pageNumber: 0x200, subpageCount: 1, description: undefined },
    ]);
  });
});

describe('addPage / removePage / getPage', () => {
  it('adds a page immutably', () => {
    const svc = createEmptyService('s1');
    const newSvc = addPage(svc, createEmptyPage(0x100));
    expect(svc.pages.length).toBe(0); // original unchanged
    expect(newSvc.pages.length).toBe(1);
  });

  it('removes a page by number', () => {
    const svc = createEmptyService('s1');
    const s2 = addPage(svc, createEmptyPage(0x100));
    const s3 = addPage(s2, createEmptyPage(0x200));
    const s4 = removePage(s3, 0x100);
    expect(s4.pages.length).toBe(1);
    expect(s4.pages[0].pageNumber).toBe(0x200);
  });

  it('getPage finds by number', () => {
    const svc = createEmptyService('s1');
    const s2 = addPage(svc, createEmptyPage(0x100));
    expect(getPage(s2, 0x100)?.pageNumber).toBe(0x100);
    expect(getPage(s2, 0x999)).toBeUndefined();
  });
});

describe('reorderPages', () => {
  it('reorders pages by number list', () => {
    let svc = createEmptyService('s1');
    svc = addPage(svc, createEmptyPage(0x100));
    svc = addPage(svc, createEmptyPage(0x200));
    svc = addPage(svc, createEmptyPage(0x300));

    const reordered = reorderPages(svc, [0x300, 0x100, 0x200]);
    expect(reordered.pages.map(p => p.pageNumber)).toEqual([0x300, 0x100, 0x200]);
  });

  it('appends missing pages at the end', () => {
    let svc = createEmptyService('s1');
    svc = addPage(svc, createEmptyPage(0x100));
    svc = addPage(svc, createEmptyPage(0x200));

    const reordered = reorderPages(svc, [0x200]);
    expect(reordered.pages.map(p => p.pageNumber)).toEqual([0x200, 0x100]);
  });
});
