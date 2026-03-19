/**
 * T42 (DVB Teletext) importer.
 *
 * T42 files contain EBU Teletext data units from DVB PES packets.
 * Each data unit carries one teletext line (42 bytes):
 *   - 2 bytes: Hamming 8/4 encoded magazine + packet address
 *   - 40 bytes: data with odd parity
 *
 * File structure variants:
 *   1. Raw data units: repeating 42-byte blocks (no framing)
 *   2. PES-wrapped: data_identifier + data_unit_id + data_unit_length + payload
 *
 * We support both by auto-detecting the format.
 */

import { hammingDecode84, stripParity } from '../packet-decoder/hamming.js';
import type { TeletextPage, TeletextSubpage, TeletextToken, TeletextRow } from '../model/types.js';
import { createEmptyPage, createEmptySubpage, createEmptyRow } from '../model/factories.js';
import { exportPageToTti } from './ttiExporter.js';

// ─── Bit reversal ───────────────────────────────────────────────

const REVERSE_TABLE = buildReverseTable();

function buildReverseTable(): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] =
      ((i & 0x01) << 7) | ((i & 0x02) << 5) | ((i & 0x04) << 3) | ((i & 0x08) << 1) |
      ((i & 0x10) >> 1) | ((i & 0x20) >> 3) | ((i & 0x40) >> 5) | ((i & 0x80) >> 7);
  }
  return table;
}

function reverseByte(b: number): number {
  return REVERSE_TABLE[b & 0xFF];
}

/**
 * Detect whether T42 data needs bit-reversal.
 * Teletext is transmitted LSB first. Some T42 files store bytes as-transmitted
 * (needing reversal) while others pre-reverse them.
 *
 * Heuristic: try decoding the first few lines both ways and see which
 * produces more valid Hamming results.
 */
function needsBitReversal(buffer: Uint8Array): boolean {
  if (buffer.length < 42) return false;

  let normalValid = 0;
  let reversedValid = 0;
  const testCount = Math.min(10, Math.floor(buffer.length / 42));

  for (let i = 0; i < testCount; i++) {
    const offset = i * 42;
    if (offset + 2 > buffer.length) break;

    // Try normal
    const n0 = hammingDecode84(buffer[offset]);
    const n1 = hammingDecode84(buffer[offset + 1]);
    if (n0 !== -1 && n1 !== -1) {
      const pn = ((n0 >> 3) & 0x01) | (n1 << 1);
      if (pn <= 31) normalValid++;
    }

    // Try reversed
    const r0 = hammingDecode84(reverseByte(buffer[offset]));
    const r1 = hammingDecode84(reverseByte(buffer[offset + 1]));
    if (r0 !== -1 && r1 !== -1) {
      const pn = ((r0 >> 3) & 0x01) | (r1 << 1);
      if (pn <= 31) reversedValid++;
    }
  }

  return reversedValid > normalValid;
}

// ─── Hamming fallback ───────────────────────────────────────────

/**
 * Use Hamming-decoded value if available, otherwise extract data bits
 * directly from the raw byte (bits at positions 1, 3, 5, 7).
 */
function hammingOrDirect(hammingResult: number, rawByte: number): number {
  if (hammingResult !== -1) return hammingResult;
  // Direct extraction: D1=bit1, D2=bit3, D3=bit5, D4=bit7
  return ((rawByte >> 1) & 1) |
         (((rawByte >> 3) & 1) << 1) |
         (((rawByte >> 5) & 1) << 2) |
         (((rawByte >> 7) & 1) << 3);
}

// ─── Data unit extraction ───────────────────────────────────────

interface TeletextLine {
  magazine: number;    // 1-8
  packetNumber: number; // 0-31
  data: Uint8Array;     // 40 bytes, parity-stripped
  rawData: Uint8Array;  // 40 bytes, original (for Hamming decode of header bytes)
}

/**
 * Extract teletext lines from raw T42 binary data.
 * Auto-detects whether the data is raw 42-byte blocks or PES-framed.
 * Also auto-detects whether bytes need bit-reversal.
 */
export function extractTeletextLines(buffer: Uint8Array): TeletextLine[] {
  // Apply bit-reversal if needed (DVB teletext is LSB-first)
  let data = buffer;
  if (needsBitReversal(buffer)) {
    data = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      data[i] = reverseByte(buffer[i]);
    }
  }

  // Try PES format first (look for data_identifier in EBU range 0x10-0x1F)
  if (data.length > 6 && data[0] >= 0x10 && data[0] <= 0x1F) {
    return extractFromPES(data);
  }

  // Try raw 42-byte blocks
  if (data.length >= 42 && data.length % 42 === 0) {
    const lines = extractRaw42(data);
    if (lines.length > 0) return lines;
  }

  // Try 46-byte blocks (2 byte header + 1 framing + 1 reserved + 42 data)
  if (data.length >= 46 && data.length % 46 === 0) {
    const lines = extractRaw46(data);
    if (lines.length > 0) return lines;
  }

  // Try to find valid teletext lines anywhere in the data
  return extractBestEffort(data);
}

/**
 * Extract from PES data field format.
 * Structure: data_identifier, then repeating:
 *   data_unit_id (1 byte), data_unit_length (1 byte), field+line (2 bytes), framing (1 byte), 42 teletext bytes
 */
function extractFromPES(buffer: Uint8Array): TeletextLine[] {
  const lines: TeletextLine[] = [];
  let offset = 1; // skip data_identifier

  while (offset + 2 < buffer.length) {
    const dataUnitId = buffer[offset];
    const dataUnitLength = buffer[offset + 1];

    // EBU teletext non-subtitle data unit: 0x02
    // EBU teletext subtitle data unit: 0x03
    if ((dataUnitId === 0x02 || dataUnitId === 0x03) && dataUnitLength === 0x2C) {
      // data_unit payload: field_parity + line_offset (2 bytes) + framing_code (1 byte) + 42 bytes
      if (offset + 2 + dataUnitLength <= buffer.length) {
        const payloadStart = offset + 2 + 2 + 1; // skip header + field/line + framing
        if (payloadStart + 42 <= buffer.length) {
          const line = decodeLine(buffer, payloadStart);
          if (line) lines.push(line);
        }
      }
      offset += 2 + dataUnitLength;
    } else {
      // Unknown data unit — skip
      if (dataUnitLength > 0) {
        offset += 2 + dataUnitLength;
      } else {
        offset++;
      }
    }
  }

  return lines;
}

/**
 * Extract from raw 42-byte teletext line blocks.
 */
function extractRaw42(buffer: Uint8Array): TeletextLine[] {
  const lines: TeletextLine[] = [];
  for (let offset = 0; offset + 42 <= buffer.length; offset += 42) {
    const line = decodeLine(buffer, offset);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Extract from raw 46-byte blocks.
 * Format: field_parity (1), line_offset (1), framing_code (1), reserved (1), then 42 teletext bytes.
 * Or: 2-byte header + 2-byte prefix + 42 data (varies by capture tool).
 */
function extractRaw46(buffer: Uint8Array): TeletextLine[] {
  const lines: TeletextLine[] = [];

  // Try offset 4 (skip 4-byte header per block)
  for (let offset = 0; offset + 46 <= buffer.length; offset += 46) {
    const line = decodeLine(buffer, offset + 4);
    if (line) lines.push(line);
  }
  if (lines.length > 0) return lines;

  // Try offset 2 (skip 2-byte header per block)
  for (let offset = 0; offset + 46 <= buffer.length; offset += 46) {
    const line = decodeLine(buffer, offset + 2);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Best-effort extraction: scan for valid Hamming-coded addresses.
 */
function extractBestEffort(buffer: Uint8Array): TeletextLine[] {
  const lines: TeletextLine[] = [];

  for (let offset = 0; offset + 42 <= buffer.length; offset++) {
    const b0 = hammingDecode84(buffer[offset]);
    const b1 = hammingDecode84(buffer[offset + 1]);
    if (b0 === -1 || b1 === -1) continue;

    const magazine = b0 & 0x07;
    const packetNumber = ((b0 >> 3) & 0x01) | (b1 << 1);

    // Valid packet number range: 0-31
    if (packetNumber > 31) continue;

    const data = new Uint8Array(40);
    const rawData = new Uint8Array(40);
    for (let i = 0; i < 40; i++) {
      rawData[i] = buffer[offset + 2 + i];
      data[i] = stripParity(buffer[offset + 2 + i]);
    }

    lines.push({
      magazine: magazine === 0 ? 8 : magazine,
      packetNumber,
      data,
      rawData,
    });

    offset += 41; // skip to next potential line (will be incremented by loop)
  }

  return lines;
}

/**
 * Decode a single 42-byte teletext line at the given offset.
 */
function decodeLine(buffer: Uint8Array, offset: number): TeletextLine | null {
  if (offset + 42 > buffer.length) return null;

  // Skip null/padding lines (all-zero address bytes)
  if (buffer[offset] === 0x00 && buffer[offset + 1] === 0x00) return null;

  const b0 = hammingDecode84(buffer[offset]);
  const b1 = hammingDecode84(buffer[offset + 1]);
  if (b0 === -1 || b1 === -1) return null;

  const magazine = b0 & 0x07;
  const packetNumber = ((b0 >> 3) & 0x01) | (b1 << 1);

  if (packetNumber > 31) return null;

  const data = new Uint8Array(40);
  const rawData = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    rawData[i] = buffer[offset + 2 + i];
    data[i] = stripParity(buffer[offset + 2 + i]);
  }

  return {
    magazine: magazine === 0 ? 8 : magazine,
    packetNumber,
    data,
    rawData,
  };
}

// ─── Page assembly from lines ───────────────────────────────────

interface PageAccumulator {
  magazine: number;
  pageNumber: number;
  subcode: number;
  rows: Map<number, Uint8Array>;
  fastext?: Uint8Array; // packet 27 raw data
}

/**
 * Assemble extracted teletext lines into pages.
 *
 * Works like a real teletext decoder: maintains a persistent page buffer
 * per (pageNumber, subcode). Rows accumulate over multiple transmissions.
 * When a header has the C4 "erase page" flag set, the existing page is
 * cleared before new rows are added. Otherwise rows merge incrementally.
 */
function assemblePages(lines: TeletextLine[]): PageAccumulator[] {
  // Persistent page buffers: key = "pageNumber:subcode"
  const buffers = new Map<string, PageAccumulator>();
  const active = new Map<number, string>(); // magazine → active buffer key

  for (const line of lines) {
    if (line.packetNumber === 0) {
      // Header packet
      const h0 = hammingDecode84(line.rawData[0]);
      const h1 = hammingDecode84(line.rawData[1]);
      const h2 = hammingDecode84(line.rawData[2]);
      const h3 = hammingDecode84(line.rawData[3]);
      const h4 = hammingDecode84(line.rawData[4]);
      const h5 = hammingDecode84(line.rawData[5]);

      const d0 = hammingOrDirect(h0, line.rawData[0]);
      const d1 = hammingOrDirect(h1, line.rawData[1]);

      const pageUnits = d0 & 0x0F;
      const pageTens = d1 & 0x0F;
      const pageLow = (pageTens << 4) | pageUnits;
      const pageNumber = (line.magazine << 8) | pageLow;

      // For subcode and flags, use Hamming decode if possible,
      // otherwise extract data bits directly (positions 1,3,5,7 of raw byte)
      const s1 = hammingOrDirect(h2, line.rawData[2]);
      const s2 = hammingOrDirect(h3, line.rawData[3]);
      const s3 = hammingOrDirect(h4, line.rawData[4]);
      const s4 = hammingOrDirect(h5, line.rawData[5]);
      const subcode = (s1 & 0x0F) | ((s2 & 0x07) << 4) | ((s3 & 0x03) << 8) | ((s4 & 0x03) << 12);

      // C4 erase flag: bit 3 of s2
      const erasePage = !!(s2 & 0x08);

      const key = `${pageNumber}:${subcode}`;

      // Get or create persistent buffer for this page/subcode
      let acc = buffers.get(key);
      if (!acc) {
        acc = { magazine: line.magazine, pageNumber, subcode, rows: new Map() };
        buffers.set(key, acc);
      }

      // If erase flag set, clear all rows
      if (erasePage) {
        acc.rows.clear();
      }

      // Store header display row (bytes 8-39)
      const headerDisplay = new Uint8Array(40);
      headerDisplay.fill(0x20);
      for (let i = 8; i < 40; i++) {
        headerDisplay[i] = line.data[i];
      }
      acc.rows.set(0, headerDisplay);
      active.set(line.magazine, key);

    } else if (line.packetNumber >= 1 && line.packetNumber <= 23) {
      // Display row — add to the active buffer for this magazine
      const key = active.get(line.magazine);
      if (key) {
        const acc = buffers.get(key);
        if (acc) {
          acc.rows.set(line.packetNumber, line.data.slice());
        }
      }
    } else if (line.packetNumber === 27) {
      // Fastext links packet — store for the active page
      const key = active.get(line.magazine);
      if (key) {
        const acc = buffers.get(key);
        if (acc) {
          acc.fastext = line.data.slice();
        }
      }
    }
    // Packets 24-26, 28-31: other enhancement data — skip for now
  }

  // Return all accumulated page buffers
  return Array.from(buffers.values());
}

// ─── VBI capture repair ─────────────────────────────────────────

/**
 * Repair systematic bit errors from analogue VBI captures.
 *
 * Many T42 files from analogue captures have bit 4 corrupted on control
 * code bytes, turning Mosaic color codes (0x10-0x17) into Alpha color
 * codes (0x00-0x07). This makes mosaic graphics render as text.
 *
 * Heuristic: if an Alpha color code (0x00-0x07) is followed by characters
 * predominantly in the mosaic range (0x20-0x3F or 0x60-0x7F), flip bit 4
 * to make it a Mosaic color code. This is safe because:
 * - Real text rows rarely have 0x60-0x7F characters (backticks, lowercase)
 *   immediately after a color control code
 * - Real mosaic rows ALWAYS have 0x20-0x3F/0x60-0x7F after the mosaic code
 */
function repairVbiData(bytes: Uint8Array): Uint8Array {
  const repaired = new Uint8Array(bytes);

  for (let i = 0; i < 39; i++) {
    const b = repaired[i];

    // Only consider Alpha color codes (0x00-0x07)
    if (b > 0x07) continue;

    // Look ahead at the next few non-control bytes
    let mosaicCount = 0;
    let textCount = 0;
    for (let j = i + 1; j < Math.min(i + 10, 40); j++) {
      const next = repaired[j];
      if (next <= 0x1F) break; // another control code — stop looking
      if ((next >= 0x21 && next <= 0x3F) || (next >= 0x60 && next <= 0x7F)) {
        // 0x21-0x3F and 0x60-0x7F are mosaic range (excluding 0x20 space)
        mosaicCount++;
      } else if (next === 0x20 || (next >= 0x40 && next <= 0x5F)) {
        textCount++; // uppercase letters — likely real text
      }
    }

    // If mostly mosaic-range characters follow, this should be a Mosaic code
    if (mosaicCount >= 2 && mosaicCount > textCount) {
      repaired[i] = b | 0x10; // flip bit 4: Alpha → Mosaic
    }
  }

  return repaired;
}

/**
 * Detect if a T42 file likely needs VBI repair.
 * Check ratio of alpha vs mosaic color codes — if alpha vastly outnumbers
 * mosaic, the file probably has the bit 4 corruption.
 */
function needsVbiRepair(lines: TeletextLine[]): boolean {
  let alphaCodes = 0;
  let mosaicCodes = 0;
  const sampleSize = Math.min(lines.length, 5000);

  for (let i = 0; i < sampleSize; i++) {
    for (const b of lines[i].data) {
      if (b >= 0x00 && b <= 0x07) alphaCodes++;
      if (b >= 0x10 && b <= 0x17) mosaicCodes++;
    }
  }

  // In normal teletext, mosaic codes are common (30-50% of color codes).
  // If < 10%, the file likely has the bit 4 corruption.
  const total = alphaCodes + mosaicCodes;
  if (total === 0) return false;
  return mosaicCodes / total < 0.10;
}

// ─── Bytes to token stream ──────────────────────────────────────

function bytesToTokens(bytes: Uint8Array): TeletextToken[] {
  const tokens: TeletextToken[] = [];
  for (const byte of bytes) {
    if (byte >= 0x00 && byte <= 0x1F) {
      tokens.push({ kind: 'control', codepoint7: byte });
    } else {
      tokens.push({ kind: 'char', codepoint7: byte });
    }
  }
  return tokens;
}

// ─── Public API ─────────────────────────────────────────────────

export interface T42ImportResult {
  pages: TeletextPage[];
  lineCount: number;
  pageCount: number;
  errors: string[];
}

/**
 * Import a T42 binary file into TeletextPage objects.
 */
export function importT42(buffer: Uint8Array): T42ImportResult {
  const errors: string[] = [];

  const lines = extractTeletextLines(buffer);
  if (lines.length === 0) {
    errors.push('No valid teletext lines found in T42 data');
    return { pages: [], lineCount: 0, pageCount: 0, errors };
  }

  // VBI repair is available but disabled by default — the heuristic
  // is too aggressive and mangles text rows. The bit 4 corruption in
  // analogue VBI captures is baked into the source data.

  const assembled = assemblePages(lines);
  const pageMap = new Map<number, TeletextPage>();

  for (const acc of assembled) {
    // Filter out invalid pages:
    // - Page low byte 0xFF = filler/null header (not a real page)
    // - Magazine 0 with page 0xFF = time-filling header
    // - Pages with very few rows (likely transmission noise)
    const pageLow = acc.pageNumber & 0xFF;
    if (pageLow === 0xFF) {
      continue; // filler header
    }

    // Validate page number is in valid range (0x100-0x8FF)
    const magazine = (acc.pageNumber >> 8) & 0xF;
    if (magazine < 1 || magazine > 8) {
      continue; // invalid magazine
    }

    // Skip pages with no display rows (only header)
    if (acc.rows.size <= 1) {
      // Only has header row or empty — check if it has meaningful content
      const headerRow = acc.rows.get(0);
      if (!headerRow || headerRow.every(b => b === 0x20 || b === 0x00)) {
        continue; // empty page
      }
    }

    let page = pageMap.get(acc.pageNumber);
    if (!page) {
      page = createEmptyPage(acc.pageNumber);
      page.subpages = [];
      pageMap.set(acc.pageNumber, page);
    }

    // Decode fastext links from packet 27 if present
    if (acc.fastext && !page.fastext) {
      const ft = acc.fastext;
      const red = (ft[0] & 0xFF) | ((ft[1] & 0xFF) << 8);
      const green = (ft[6] & 0xFF) | ((ft[7] & 0xFF) << 8);
      const yellow = (ft[12] & 0xFF) | ((ft[13] & 0xFF) << 8);
      const cyan = (ft[18] & 0xFF) | ((ft[19] & 0xFF) << 8);
      if (red || green || yellow || cyan) {
        page.fastext = {
          red: red || null,
          green: green || null,
          yellow: yellow || null,
          cyan: cyan || null,
        };
      }
    }

    const subpage = createEmptySubpage(acc.subcode);
    for (const [rowNum, rowData] of acc.rows) {
      if (rowNum >= 0 && rowNum < 24) {
        subpage.rows[rowNum] = {
          index: rowNum,
          tokens: bytesToTokens(rowData),
        };
      }
    }
    page.subpages.push(subpage);
  }

  const pages = Array.from(pageMap.values());
  return {
    pages,
    lineCount: lines.length,
    pageCount: pages.length,
    errors,
  };
}

/**
 * Import T42 and convert to TTI text format for easy consumption.
 */
export function t42ToTti(buffer: Uint8Array): string {
  const { pages } = importT42(buffer);
  return pages.map(p => exportPageToTti(p)).join('\n');
}
