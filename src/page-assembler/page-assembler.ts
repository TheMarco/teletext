import type { TeletextPacket, HeaderPacket } from '../packet-decoder/index.js';
import { isHeaderPacket } from '../packet-decoder/index.js';

const ROWS = 24;
const COLS = 40;

/**
 * A raw assembled teletext page.
 */
export interface TeletextPage {
  magazine: number;
  pageNumber: number;
  subCode: number;
  rows: Uint8Array[];   // 24 rows of 40 bytes
  complete: boolean;     // true if all rows populated at least once
  rowPresent: boolean[]; // tracks which rows have been received
}

/**
 * Create a blank page filled with spaces.
 */
function createBlankPage(magazine: number, pageNumber: number, subCode: number): TeletextPage {
  const rows: Uint8Array[] = [];
  for (let i = 0; i < ROWS; i++) {
    const row = new Uint8Array(COLS);
    row.fill(0x20);
    rows.push(row);
  }
  return {
    magazine,
    pageNumber,
    subCode,
    rows,
    complete: false,
    rowPresent: new Array(ROWS).fill(false),
  };
}

/**
 * Page key for indexing the page buffer.
 */
function pageKey(magazine: number, pageNumber: number): string {
  return `${magazine}:${pageNumber.toString(16).padStart(2, '0')}`;
}

/**
 * Assembles teletext pages from a packet stream.
 *
 * Per ETSI EN 300 706 Section 9.3:
 * - A header packet (X/0) signals the start of a new page.
 * - Subsequent row packets (X/1 to X/23) populate the page.
 * - A new header for the same magazine closes the previous page.
 */
export class PageAssembler {
  private pages = new Map<string, TeletextPage>();
  private activePage = new Map<number, string>(); // magazine → active page key
  private listeners: ((page: TeletextPage) => void)[] = [];

  /**
   * Register a callback for when a page is complete or replaced.
   */
  onPage(listener: (page: TeletextPage) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Feed a decoded packet into the assembler.
   */
  feed(packet: TeletextPacket): void {
    if (isHeaderPacket(packet)) {
      this.handleHeader(packet);
    } else if (packet.packetNumber >= 1 && packet.packetNumber <= 23) {
      this.handleRow(packet);
    }
    // Packets 24-31 are enhancement packets — ignored at Level 1
  }

  /**
   * Get the current state of a page, or undefined if not seen.
   */
  getPage(magazine: number, pageNumber: number): TeletextPage | undefined {
    return this.pages.get(pageKey(magazine, pageNumber));
  }

  /**
   * Get all assembled pages.
   */
  getAllPages(): TeletextPage[] {
    return Array.from(this.pages.values());
  }

  /**
   * Clear all assembled pages.
   */
  clear(): void {
    this.pages.clear();
    this.activePage.clear();
  }

  private handleHeader(header: HeaderPacket): void {
    const key = pageKey(header.magazine, header.pageNumber);

    // Emit the previous active page for this magazine if different
    const prevKey = this.activePage.get(header.magazine);
    if (prevKey && prevKey !== key) {
      const prevPage = this.pages.get(prevKey);
      if (prevPage) this.emit(prevPage);
    }

    // Create or reset the page
    const page = createBlankPage(header.magazine, header.pageNumber, header.subCode);
    page.rows[0] = header.data.slice();
    page.rowPresent[0] = true;
    page.complete = true;

    this.pages.set(key, page);
    this.activePage.set(header.magazine, key);
  }

  private handleRow(packet: TeletextPacket): void {
    const key = this.activePage.get(packet.magazine);
    if (!key) return; // no active page for this magazine

    const page = this.pages.get(key);
    if (!page) return;

    const rowIndex = packet.packetNumber;
    if (rowIndex >= 0 && rowIndex < ROWS) {
      page.rows[rowIndex] = packet.data.slice();
      page.rowPresent[rowIndex] = true;
    }

    // Check if page is complete (header + at least rows 1-23 considered)
    // A page is "complete" once we've seen the header — we don't require
    // all 23 rows since many pages have fewer rows.
    page.complete = page.rowPresent[0];
  }

  private emit(page: TeletextPage): void {
    for (const listener of this.listeners) {
      listener(page);
    }
  }
}
