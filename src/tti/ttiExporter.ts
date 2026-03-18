/**
 * TTI exporter: converts canonical AST back to TTI text format.
 *
 * Per 03_TTI_INTEROP.md export rules:
 * - stable ordering
 * - canonical formatting
 * - legal translated OL content
 * - preserved pass-through records when requested
 *
 * Output order per page/subpage:
 * 1. DE
 * 2. PN
 * 3. CT
 * 4. SC
 * 5. PS
 * 6. OL records in row order
 * 7. FL
 * 8. preserved vendor records
 */

import type {
  TeletextPage,
  TeletextSubpage,
  TeletextService,
  TeletextRow,
  TeletextToken,
  PreservedTtiRecord,
} from '../model/types.js';
import { encodeOLContent } from './ttiTranslations.js';
import { encodePageFlags, encodeLanguageSubset } from './ttiMapper.js';
import { normalizeRowTo40Columns, resolveRowToDisplayBytes } from '../model/factories.js';

// ─── Row to OL bytes ────────────────────────────────────────────

function rowToBytes(row: TeletextRow): number[] {
  const bytes = resolveRowToDisplayBytes(row);
  return Array.from(bytes);
}

/**
 * Check if a row is all spaces (skip in export for compactness).
 */
function isBlankRow(bytes: number[]): boolean {
  return bytes.every(b => b === 0x20);
}

// ─── Export functions ───────────────────────────────────────────

export interface TtiExportOptions {
  includePreservedRecords?: boolean;
  skipBlankRows?: boolean;
}

/**
 * Export a single page (all subpages) to TTI format.
 */
export function exportPageToTti(
  page: TeletextPage,
  options: TtiExportOptions = {},
): string {
  const lines: string[] = [];

  for (const subpage of page.subpages) {
    lines.push(...exportSubpageToTti(page, subpage, options));
  }

  return lines.join('\n') + '\n';
}

/**
 * Export a full service to TTI format.
 */
export function exportServiceToTti(
  service: TeletextService,
  options: TtiExportOptions = {},
): string {
  const lines: string[] = [];

  for (const page of service.pages) {
    lines.push(...exportSubpagesForPage(page, options));
  }

  return lines.join('\n') + '\n';
}

function exportSubpagesForPage(
  page: TeletextPage,
  options: TtiExportOptions,
): string[] {
  const lines: string[] = [];
  for (const subpage of page.subpages) {
    lines.push(...exportSubpageToTti(page, subpage, options));
  }
  return lines;
}

function exportSubpageToTti(
  page: TeletextPage,
  subpage: TeletextSubpage,
  options: TtiExportOptions,
): string[] {
  const lines: string[] = [];
  const skipBlanks = options.skipBlankRows ?? false;

  // 1. DE — description
  if (page.description) {
    lines.push(`DE,${page.description}`);
  }

  // 2. PN — page number + subcode
  const pnHex = page.pageNumber.toString(16).toUpperCase().padStart(3, '0');
  const scHex = subpage.subcode.toString(16).toUpperCase().padStart(2, '0');
  lines.push(`PN,${pnHex}${scHex}`);

  // 3. CT — cycle timing
  if (page.defaultCycle) {
    const modeChar = page.defaultCycle.mode === 'time' ? 'T' : 'C';
    lines.push(`CT,${page.defaultCycle.value},${modeChar}`);
  }

  // 4. SC — explicit subcode
  lines.push(`SC,${subpage.subcode.toString(16).toUpperCase().padStart(4, '0')}`);

  // 5. PS — page status (flags + language)
  const ps = encodePageFlags(subpage.pageFlags, page.serviceFlags.serialMagazine)
           | encodeLanguageSubset(subpage.languageSubset);
  lines.push(`PS,${ps.toString(16).padStart(4, '0')}`);

  // 6. OL — output lines in row order
  for (const row of subpage.rows) {
    const bytes = rowToBytes(row);
    if (skipBlanks && isBlankRow(bytes)) continue;
    const encoded = encodeOLContent(bytes);
    lines.push(`OL,${row.index},${encoded}`);
  }

  // 7. FL — fastext links
  if (page.fastext) {
    const fl = page.fastext;
    const parts = [
      fl.red ?? 0,
      fl.green ?? 0,
      fl.yellow ?? 0,
      fl.cyan ?? 0,
      fl.link ?? 0,
      fl.index ?? 0,
    ].map(v => (v as number).toString(16).toUpperCase().padStart(3, '0'));
    lines.push(`FL,${parts.join(',')}`);
  }

  // 8. Preserved vendor records
  if (options.includePreservedRecords) {
    // These would come from a side-channel during import
    // Not available from pure AST, but the hook is here
  }

  return lines;
}

// ─── Full import → export convenience ───────────────────────────

/**
 * Import TTI text and immediately re-export.
 * Useful for round-trip testing.
 */
export { exportPageToTti as exportPage, exportServiceToTti as exportService };
