/**
 * TTI mapper: converts parsed TTI page groups into canonical AST.
 *
 * Stage 4 from 03_TTI_INTEROP.md: AST mapper.
 */

import type { TtiPageGroup, TtiParseResult } from './ttiParser.js';
import type {
  TeletextPage,
  TeletextSubpage,
  TeletextRow,
  TeletextToken,
  TeletextService,
  PageControlFlags,
  FastextLinks,
  NationalSubset,
  PreservedTtiRecord,
} from '../model/types.js';
import {
  createEmptyPage,
  createEmptySubpage,
  createEmptyRow,
  createDefaultPageFlags,
} from '../model/factories.js';
import { decodeOLContent } from './ttiTranslations.js';

// ─── Page status (PS) bit mapping ───────────────────────────────

const PS_ERASE_PAGE        = 1 << 0;
const PS_NEWSFLASH         = 1 << 1;
const PS_SUBTITLE          = 1 << 2;
const PS_SUPPRESS_HEADER   = 1 << 3;
const PS_UPDATE_INDICATOR  = 1 << 4;
const PS_INTERRUPTED_SEQ   = 1 << 5;
const PS_INHIBIT_DISPLAY   = 1 << 6;
const PS_SERIAL_MAGAZINE   = 1 << 7;

// Language bits are in bits 8-10 of PS
const PS_LANGUAGE_MASK     = 0x0700;
const PS_LANGUAGE_SHIFT    = 8;

const LANGUAGE_MAP: NationalSubset[] = [
  'english',
  'german',
  'swedish_finnish',
  'italian',
  'french',
  'portuguese_spanish',
  'czech_slovak',
  'undefined',
];

function decodePageFlags(ps: number): PageControlFlags {
  return {
    erasePage: !!(ps & PS_ERASE_PAGE),
    newsflash: !!(ps & PS_NEWSFLASH),
    subtitle: !!(ps & PS_SUBTITLE),
    suppressHeader: !!(ps & PS_SUPPRESS_HEADER),
    updateIndicator: !!(ps & PS_UPDATE_INDICATOR),
    interruptedSequence: !!(ps & PS_INTERRUPTED_SEQ),
    inhibitDisplay: !!(ps & PS_INHIBIT_DISPLAY),
  };
}

function decodeLanguageSubset(ps: number): NationalSubset {
  const idx = (ps & PS_LANGUAGE_MASK) >> PS_LANGUAGE_SHIFT;
  return LANGUAGE_MAP[idx] ?? 'english';
}

export function encodePageFlags(flags: PageControlFlags, serialMagazine: boolean): number {
  let ps = 0;
  if (flags.erasePage) ps |= PS_ERASE_PAGE;
  if (flags.newsflash) ps |= PS_NEWSFLASH;
  if (flags.subtitle) ps |= PS_SUBTITLE;
  if (flags.suppressHeader) ps |= PS_SUPPRESS_HEADER;
  if (flags.updateIndicator) ps |= PS_UPDATE_INDICATOR;
  if (flags.interruptedSequence) ps |= PS_INTERRUPTED_SEQ;
  if (flags.inhibitDisplay) ps |= PS_INHIBIT_DISPLAY;
  if (serialMagazine) ps |= PS_SERIAL_MAGAZINE;
  return ps;
}

export function encodeLanguageSubset(subset: NationalSubset): number {
  const idx = LANGUAGE_MAP.indexOf(subset);
  return (idx >= 0 ? idx : 0) << PS_LANGUAGE_SHIFT;
}

// ─── OL content → token stream ──────────────────────────────────

function olBytesToTokens(bytes: number[]): TeletextToken[] {
  const tokens: TeletextToken[] = [];

  for (const byte of bytes) {
    if (byte >= 0x00 && byte <= 0x1F) {
      tokens.push({ kind: 'control', codepoint7: byte });
    } else if (byte >= 0x20 && byte <= 0x7F) {
      tokens.push({ kind: 'char', codepoint7: byte });
    } else {
      // Out of 7-bit range — treat as space
      tokens.push({ kind: 'char', codepoint7: 0x20 });
    }
  }

  return tokens;
}

// ─── Fastext mapping ────────────────────────────────────────────

function mapFastextLinks(links: number[] | undefined): FastextLinks | null {
  if (!links || links.length === 0) return null;

  return {
    red: links[0] || null,
    green: links[1] || null,
    yellow: links[2] || null,
    cyan: links[3] || null,
    link: links[4] || null,
    index: links[5] || null,
  };
}

// ─── Main mapper ────────────────────────────────────────────────

/**
 * Map a single TTI page group to a canonical TeletextPage + TeletextSubpage.
 * Multiple groups with the same page number but different subcodes
 * should be combined by the caller.
 */
export function mapTtiGroupToSubpage(group: TtiPageGroup): {
  pageNumber: number;
  subpage: TeletextSubpage;
  description?: string;
  fastext: FastextLinks | null;
  serialMagazine: boolean;
  cycleMode?: 'cycle' | 'time';
  cycleValue?: number;
  preserved: PreservedTtiRecord[];
} {
  const ps = group.pageStatus ?? 0;
  const pageFlags = decodePageFlags(ps);
  const languageSubset = decodeLanguageSubset(ps);

  // Build rows from OL records
  const subpage = createEmptySubpage(group.subcode, languageSubset);
  subpage.pageFlags = pageFlags;

  for (const ol of group.outputLines) {
    // OL line numbers: 0-based in some tools, 1-based in others
    // Row 0 = header row. OL lines typically use 0-23 or 1-24.
    const rowIndex = ol.lineNumber;
    if (rowIndex >= 0 && rowIndex < 24) {
      const bytes = decodeOLContent(ol.content);
      const tokens = olBytesToTokens(bytes);
      subpage.rows[rowIndex] = { index: rowIndex, tokens };
    }
  }

  return {
    pageNumber: group.pageNumber,
    subpage,
    description: group.description,
    fastext: mapFastextLinks(group.fastextLinks),
    serialMagazine: !!(ps & PS_SERIAL_MAGAZINE),
    cycleMode: group.cycleMode,
    cycleValue: group.cycleValue,
    preserved: group.preservedRecords,
  };
}

/**
 * Map a full TTI parse result into a TeletextService.
 * Groups pages by page number and collects subpages.
 */
export function mapTtiToService(
  parseResult: TtiParseResult,
  serviceId?: string,
  serviceTitle?: string,
): TeletextService {
  const pageMap = new Map<number, TeletextPage>();

  for (const group of parseResult.pages) {
    const mapped = mapTtiGroupToSubpage(group);
    const pn = mapped.pageNumber;

    let page = pageMap.get(pn);
    if (!page) {
      page = createEmptyPage(pn);
      page.subpages = []; // clear the default subpage
      page.description = mapped.description;
      page.fastext = mapped.fastext;
      page.serviceFlags.serialMagazine = mapped.serialMagazine;
      if (mapped.cycleMode && mapped.cycleValue !== undefined) {
        page.defaultCycle = { mode: mapped.cycleMode, value: mapped.cycleValue };
      }
      pageMap.set(pn, page);
    }

    page.subpages.push(mapped.subpage);
  }

  return {
    id: serviceId ?? crypto.randomUUID(),
    title: serviceTitle ?? 'Imported TTI',
    pages: Array.from(pageMap.values()),
    defaultLanguageSubset: 'english',
  };
}
