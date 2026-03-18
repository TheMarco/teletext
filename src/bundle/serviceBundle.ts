/**
 * Service bundle: multi-page container with serialization.
 * Per 02_PAGE_MODEL_AND_SERVICE_BUNDLE.md.
 */

import type { TeletextService, TeletextPage, NationalSubset } from '../model/types.js';
import { createEmptyService, createEmptyPage, clonePage } from '../model/factories.js';
import { validateService } from '../model/validators.js';

export interface BundleManifest {
  version: number;
  id: string;
  title: string;
  defaultLanguageSubset: NationalSubset;
  pageCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Serialize a service to a JSON bundle.
 */
export function serializeBundle(service: TeletextService): string {
  const bundle = {
    version: 1,
    service: structuredClone(service),
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Deserialize a JSON bundle to a service.
 */
export function deserializeBundle(json: string): TeletextService {
  const parsed = JSON.parse(json);
  if (parsed.version !== 1) {
    throw new Error(`Unsupported bundle version: ${parsed.version}`);
  }
  return parsed.service as TeletextService;
}

/**
 * Get a page index summary for a service.
 */
export function getPageIndex(service: TeletextService): Array<{
  pageNumber: number;
  subpageCount: number;
  description?: string;
}> {
  return service.pages.map(p => ({
    pageNumber: p.pageNumber,
    subpageCount: p.subpages.length,
    description: p.description,
  }));
}

/**
 * Add a page to a service. Returns a new service (immutable).
 */
export function addPage(service: TeletextService, page: TeletextPage): TeletextService {
  return {
    ...service,
    pages: [...service.pages, clonePage(page)],
  };
}

/**
 * Remove a page by page number. Returns a new service.
 */
export function removePage(service: TeletextService, pageNumber: number): TeletextService {
  return {
    ...service,
    pages: service.pages.filter(p => p.pageNumber !== pageNumber),
  };
}

/**
 * Get a page by number.
 */
export function getPage(service: TeletextService, pageNumber: number): TeletextPage | undefined {
  return service.pages.find(p => p.pageNumber === pageNumber);
}

/**
 * Reorder pages by providing a sorted list of page numbers.
 */
export function reorderPages(service: TeletextService, order: number[]): TeletextService {
  const pageMap = new Map(service.pages.map(p => [p.pageNumber, p]));
  const reordered = order
    .map(pn => pageMap.get(pn))
    .filter((p): p is TeletextPage => p !== undefined);

  // Append any pages not in the order list
  for (const page of service.pages) {
    if (!order.includes(page.pageNumber)) {
      reordered.push(page);
    }
  }

  return { ...service, pages: reordered };
}
