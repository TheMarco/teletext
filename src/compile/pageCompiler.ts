/**
 * Page compiler: AST → compiled packets.
 * Per 04_PACKET_COMPILER.md.
 *
 * Important constraint: the compiler may warn, may fail,
 * but must NOT silently rewrite semantics.
 */

import type {
  TeletextPage,
  TeletextSubpage,
  TeletextService,
} from '../model/types.js';
import type {
  CompiledPagePayload,
  CompiledServiceBundle,
  CompiledDisplayRow,
} from './types.js';
import { DiagnosticCollector } from './diagnostics.js';
import { compileRow } from './rowCompiler.js';
import {
  buildHeaderPacket,
  buildDisplayPacket,
  buildFastextPacket,
} from './packetBuilder.js';

/**
 * Compile a single subpage into packets.
 */
export function compileSubpage(
  subpage: TeletextSubpage,
  pageNumber: number,
  fastext?: TeletextPage['fastext'],
): CompiledPagePayload {
  const diag = new DiagnosticCollector();
  const magazine = (pageNumber >> 8) & 0x0F;
  const pageLow = pageNumber & 0xFF;

  // Compile all 24 rows
  const compiledRows: CompiledDisplayRow[] = [];
  for (const row of subpage.rows) {
    compiledRows.push(compileRow(row, diag));
  }

  // Build header packet from row 0
  const headerRow = compiledRows[0]?.bytes40 ?? new Uint8Array(40).fill(0x20);
  const headerPacket = buildHeaderPacket(
    magazine,
    pageLow,
    subpage.subcode,
    subpage.pageFlags,
    subpage.languageSubset,
    headerRow,
  );

  // Build display packets for rows 1-23
  const displayPackets = compiledRows
    .filter(r => r.rowNumber >= 1 && r.rowNumber <= 23)
    .map(r => buildDisplayPacket(magazine, r.rowNumber, r.bytes40));

  // Build extension packets
  const extensionPackets = [];
  if (fastext) {
    extensionPackets.push(buildFastextPacket(magazine, fastext));
  }

  return {
    pageNumber,
    subcode: subpage.subcode,
    headerPacket,
    displayPackets,
    extensionPackets,
    diagnostics: diag.diagnostics,
  };
}

/**
 * Compile a page (all subpages).
 */
export function compilePage(page: TeletextPage): CompiledPagePayload[] {
  return page.subpages.map(sp =>
    compileSubpage(sp, page.pageNumber, page.fastext),
  );
}

/**
 * Compile an entire service.
 */
export function compileService(service: TeletextService): CompiledServiceBundle {
  const allDiag = new DiagnosticCollector();
  const pages: CompiledPagePayload[] = [];

  for (const page of service.pages) {
    const compiled = compilePage(page);
    for (const cp of compiled) {
      pages.push(cp);
      allDiag.diagnostics.push(...cp.diagnostics);
    }
  }

  return {
    pages,
    diagnostics: allDiag.diagnostics,
  };
}
