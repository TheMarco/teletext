/**
 * TTI parser: converts lexed records into structured page groups.
 *
 * Stage 3 from 03_TTI_INTEROP.md: semantic parser.
 * Groups records by page/subpage boundaries and extracts typed fields.
 */

import type { TtiRecord } from './ttiLexer.js';
import type { PreservedTtiRecord } from '../model/types.js';

// ─── Parsed structures ──────────────────────────────────────────

export interface TtiPageGroup {
  pageNumber: number;
  subcode: number;
  description?: string;
  cycleMode?: 'cycle' | 'time';
  cycleValue?: number;
  pageStatus?: number;
  fastextLinks?: number[];
  outputLines: TtiOutputLine[];
  preservedRecords: PreservedTtiRecord[];
}

export interface TtiOutputLine {
  lineNumber: number;
  content: string; // raw encoded content (still has 0x80-0x9F translations)
}

export interface TtiParseResult {
  pages: TtiPageGroup[];
  servicePreserved: PreservedTtiRecord[];
}

// ─── Parser ─────────────────────────────────────────────────────

/**
 * Parse lexed TTI records into page groups.
 * A new page group starts at each PN record.
 */
export function parseTtiRecords(records: TtiRecord[]): TtiParseResult {
  const pages: TtiPageGroup[] = [];
  const servicePreserved: PreservedTtiRecord[] = [];
  let current: TtiPageGroup | null = null;
  let pendingDescription: string | undefined;

  for (const record of records) {
    if (record.command === '') {
      // Unrecognized line — preserve
      const scope = current ? 'subpage' : 'service';
      const target = current ? current.preservedRecords : servicePreserved;
      target.push({ command: '', raw: record.raw, pageScope: scope as 'service' | 'page' | 'subpage' });
      continue;
    }

    switch (record.command) {
      case 'PN': {
        // Start a new page group
        const pn = parsePNRecord(record.parts);
        current = {
          pageNumber: pn.pageNumber,
          subcode: pn.subcode,
          outputLines: [],
          preservedRecords: [],
        };
        // Apply any buffered DE that appeared before PN
        if (pendingDescription !== undefined) {
          current.description = pendingDescription;
          pendingDescription = undefined;
        }
        pages.push(current);
        break;
      }
      case 'DE': {
        if (current) {
          current.description = record.parts.join(',').trim();
        } else {
          // DE before first PN — buffer it
          pendingDescription = record.parts.join(',').trim();
        }
        break;
      }
      case 'CT': {
        if (current) {
          const ct = parseCTRecord(record.parts);
          current.cycleMode = ct.mode;
          current.cycleValue = ct.value;
        }
        break;
      }
      case 'SC': {
        if (current) {
          current.subcode = parseInt(record.parts[0], 16) || 0;
        }
        break;
      }
      case 'PS': {
        if (current) {
          current.pageStatus = parseInt(record.parts[0], 16) || 0;
        }
        break;
      }
      case 'OL': {
        if (current) {
          const ol = parseOLRecord(record.parts);
          if (ol) current.outputLines.push(ol);
        }
        break;
      }
      case 'FL': {
        if (current) {
          current.fastextLinks = parseFLRecord(record.parts);
        }
        break;
      }
      default: {
        // Unknown command — preserve
        const scope = current ? 'subpage' : 'service';
        const target = current ? current.preservedRecords : servicePreserved;
        target.push({ command: record.command, raw: record.raw, pageScope: scope as 'service' | 'page' | 'subpage' });
        break;
      }
    }
  }

  return { pages, servicePreserved };
}

// ─── Record parsers ─────────────────────────────────────────────

function parsePNRecord(parts: string[]): { pageNumber: number; subcode: number } {
  // TTI PN format: "mppss" where mpp = page number (hex), ss = subcode (hex)
  // Variants seen in the wild:
  //   PN,10000   → page 0x100, subcode 0x00
  //   PN,10001   → page 0x100, subcode 0x01
  //   PN,3FF02   → page 0x3FF, subcode 0x02
  //   PN,100     → page 0x100, subcode 0x00 (short form)
  //   PN,8FF     → page 0x8FF, subcode 0x00
  const raw = parts[0]?.trim() ?? '10000';

  if (raw.length < 3) return { pageNumber: 0x100, subcode: 0 };

  // Always interpret first 3 hex chars as page number
  const pageHex = raw.substring(0, 3);
  const pageNumber = parseInt(pageHex, 16);
  if (isNaN(pageNumber)) return { pageNumber: 0x100, subcode: 0 };

  // Remaining chars (if any) are subcode
  let subcode = 0;
  if (raw.length > 3) {
    const scHex = raw.substring(3);
    subcode = parseInt(scHex, 16);
    if (isNaN(subcode)) subcode = 0;
  }

  return { pageNumber, subcode };
}

function parseCTRecord(parts: string[]): { mode: 'cycle' | 'time'; value: number } {
  // CT,value,mode — mode: C=cycle, T=time
  const value = parseInt(parts[0]?.trim() ?? '0', 10);
  const modeStr = (parts[1]?.trim() ?? 'C').toUpperCase();
  return {
    mode: modeStr === 'T' ? 'time' : 'cycle',
    value: isNaN(value) ? 0 : value,
  };
}

function parseOLRecord(parts: string[]): TtiOutputLine | null {
  // OL,lineNumber,content
  const lineNum = parseInt(parts[0]?.trim() ?? '', 10);
  if (isNaN(lineNum)) return null;

  const content = parts.length > 1 ? parts[1] : '';
  return { lineNumber: lineNum, content };
}

function parseFLRecord(parts: string[]): number[] {
  // FL,red,green,yellow,cyan,link,index
  return parts.map(p => {
    const val = parseInt(p.trim(), 16);
    return isNaN(val) ? 0 : val;
  });
}
