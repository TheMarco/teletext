import { describe, it, expect } from 'vitest';
import { PageAssembler } from '../page-assembler/index.js';
import type { HeaderPacket, TeletextPacket } from '../packet-decoder/index.js';

function makeHeader(magazine: number, pageNumber: number, subCode = 0): HeaderPacket {
  const data = new Uint8Array(40).fill(0x20);
  return {
    magazine,
    packetNumber: 0 as const,
    data,
    pageNumber,
    subCode,
    controlBits: 0,
  };
}

function makeRow(magazine: number, packetNumber: number, fill = 0x20): TeletextPacket {
  const data = new Uint8Array(40).fill(fill);
  return { magazine, packetNumber, data };
}

describe('PageAssembler', () => {
  it('assembles a page from header + row packets', () => {
    const asm = new PageAssembler();
    asm.feed(makeHeader(1, 0x00));
    asm.feed(makeRow(1, 1, 0x41));
    asm.feed(makeRow(1, 2, 0x42));

    const page = asm.getPage(1, 0x00);
    expect(page).toBeDefined();
    expect(page!.rows[1][0]).toBe(0x41);
    expect(page!.rows[2][0]).toBe(0x42);
  });

  it('marks page complete after header received', () => {
    const asm = new PageAssembler();
    asm.feed(makeHeader(1, 0x00));
    const page = asm.getPage(1, 0x00);
    expect(page!.complete).toBe(true);
  });

  it('emits previous page when new header arrives for same magazine', () => {
    const asm = new PageAssembler();
    const emitted: number[] = [];
    asm.onPage((page) => emitted.push(page.pageNumber));

    asm.feed(makeHeader(1, 0x00));
    asm.feed(makeRow(1, 1, 0x41));
    // New header for same magazine, different page
    asm.feed(makeHeader(1, 0x01));

    expect(emitted).toEqual([0x00]);
  });

  it('handles multiple magazines independently', () => {
    const asm = new PageAssembler();
    asm.feed(makeHeader(1, 0x00));
    asm.feed(makeHeader(2, 0x10));
    asm.feed(makeRow(1, 1, 0x41));
    asm.feed(makeRow(2, 1, 0x42));

    const page1 = asm.getPage(1, 0x00);
    const page2 = asm.getPage(2, 0x10);
    expect(page1!.rows[1][0]).toBe(0x41);
    expect(page2!.rows[1][0]).toBe(0x42);
  });

  it('ignores row packets with no active page', () => {
    const asm = new PageAssembler();
    // No header fed — row should be silently dropped
    asm.feed(makeRow(1, 1, 0x41));
    expect(asm.getAllPages()).toHaveLength(0);
  });

  it('resets page on new header for same page number', () => {
    const asm = new PageAssembler();
    asm.feed(makeHeader(1, 0x00));
    asm.feed(makeRow(1, 5, 0x41));
    // Second header for same page — should reset
    asm.feed(makeHeader(1, 0x00));

    const page = asm.getPage(1, 0x00);
    expect(page!.rows[5][0]).toBe(0x20); // reset to space
  });

  it('clear() removes all pages', () => {
    const asm = new PageAssembler();
    asm.feed(makeHeader(1, 0x00));
    asm.clear();
    expect(asm.getAllPages()).toHaveLength(0);
  });
});
