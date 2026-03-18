/**
 * T42 export: compile a TeletextService into raw 42-byte teletext packets.
 *
 * Output format: raw 42-byte lines (address + data), concatenated.
 * Compatible with any T42 player/decoder.
 */

import type { TeletextService, TeletextPage } from '../model/types.js';
import { compilePage } from '../compile/pageCompiler.js';
import { hammingEncode84, addParity } from '../compile/hamming.js';

/**
 * Encode a single packet into 42 wire-format bytes.
 */
function encodePacket(magazine: number, packetNumber: number, data: Uint8Array, isHeader: boolean): Uint8Array {
  const out = new Uint8Array(42);
  const mag = magazine & 0x07;
  out[0] = hammingEncode84((mag & 0x07) | (((packetNumber >> 0) & 0x01) << 3));
  out[1] = hammingEncode84((packetNumber >> 1) & 0x0F);

  if (isHeader) {
    // Header: bytes 0-7 are logical nibbles → Hamming 8/4 encode them
    for (let i = 0; i < 8; i++) {
      out[2 + i] = hammingEncode84(data[i] & 0x0F);
    }
    // Bytes 8-39 are display characters → add parity
    for (let i = 8; i < 40; i++) {
      out[2 + i] = addParity(data[i] ?? 0x20);
    }
  } else {
    // Display rows: all 40 bytes get parity
    for (let i = 0; i < 40; i++) {
      out[2 + i] = addParity(data[i] ?? 0x20);
    }
  }
  return out;
}

/**
 * Export a single page (one subpage) as T42 packets.
 */
function exportPagePackets(page: TeletextPage, subpageIdx: number = 0): Uint8Array[] {
  const compiled = compilePage(page);
  if (subpageIdx >= compiled.length) return [];
  const payload = compiled[subpageIdx];

  const packets: Uint8Array[] = [];

  // Header packet (bytes 0-7 need Hamming encoding)
  packets.push(encodePacket(payload.headerPacket.magazine, 0, payload.headerPacket.payload, true));

  // Display packets (rows 1-23, all bytes get parity)
  for (const dp of payload.displayPackets) {
    packets.push(encodePacket(dp.magazine, dp.packetNumber, dp.payload, false));
  }

  return packets;
}

/**
 * Export an entire service as a T42 binary buffer.
 * Pages are interleaved in order, with all subpages included.
 */
export function exportServiceToT42(service: TeletextService): Uint8Array {
  const allPackets: Uint8Array[] = [];

  for (const page of service.pages) {
    for (let s = 0; s < page.subpages.length; s++) {
      const packets = exportPagePackets(page, s);
      allPackets.push(...packets);
    }
  }

  // Concatenate all 42-byte packets
  const totalBytes = allPackets.length * 42;
  const buffer = new Uint8Array(totalBytes);
  for (let i = 0; i < allPackets.length; i++) {
    buffer.set(allPackets[i], i * 42);
  }

  return buffer;
}

/**
 * Export a single page as T42.
 */
export function exportPageToT42(page: TeletextPage): Uint8Array {
  return exportServiceToT42({ id: '', title: '', pages: [page], defaultLanguageSubset: 'english' });
}
