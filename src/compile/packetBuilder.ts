/**
 * Packet builder: constructs Teletext packet structures.
 * Per 04_PACKET_COMPILER.md Stage 2-3.
 */

import type {
  PageControlFlags,
  FastextLinks,
  NationalSubset,
} from '../model/types.js';
import type { CompiledPacket } from './types.js';
import { hammingEncode84, addParity, encodePacketBytes } from './hamming.js';

// ─── Language subset to C12/C13/C14 mapping ─────────────────────

const SUBSET_BITS: Record<NationalSubset, number> = {
  english: 0,
  german: 1,
  swedish_finnish: 2,
  italian: 3,
  french: 4,
  portuguese_spanish: 5,
  czech_slovak: 6,
  undefined: 7,
};

// ─── Header packet (Y=0) ───────────────────────────────────────

/**
 * Build a header packet (packet number 0) for a page.
 *
 * The header packet payload is 40 bytes:
 * - Bytes 0-7: page number, subcode, control bits (normally Hamming-encoded,
 *   but we output logical values for the renderer)
 * - Bytes 8-39: header display row
 */
export function buildHeaderPacket(
  magazine: number,
  pageNumber: number,
  subcode: number,
  flags: PageControlFlags,
  languageSubset: NationalSubset,
  headerRow: Uint8Array,
): CompiledPacket {
  const payload = new Uint8Array(40);

  // Bytes 0-1: page number (units + tens)
  const pageUnits = pageNumber & 0x0F;
  const pageTens = (pageNumber >> 4) & 0x0F;
  payload[0] = pageUnits;
  payload[1] = pageTens;

  // Bytes 2-3: subcode S1, S2 + C4
  payload[2] = subcode & 0x0F;
  payload[3] = ((subcode >> 4) & 0x07) | ((flags.erasePage ? 1 : 0) << 3);

  // Bytes 4-5: S3 + C5/C6, S4 + C7/C8/C9/C10
  payload[4] = ((subcode >> 8) & 0x03) | ((flags.newsflash ? 1 : 0) << 2) | ((flags.subtitle ? 1 : 0) << 3);
  payload[5] = ((subcode >> 12) & 0x03) |
    ((flags.suppressHeader ? 1 : 0) << 2) |
    ((flags.updateIndicator ? 1 : 0) << 3);

  // Bytes 6-7: C11 (serial magazine), C12-C14 (language)
  const langBits = SUBSET_BITS[languageSubset] ?? 0;
  payload[6] = ((flags.interruptedSequence ? 1 : 0)) |
    ((flags.inhibitDisplay ? 1 : 0) << 1) |
    ((langBits & 0x01) << 2) |
    ((langBits >> 1 & 0x01) << 3);
  payload[7] = ((langBits >> 2) & 0x01);

  // Bytes 8-39: header display row
  for (let i = 0; i < 32 && i < headerRow.length; i++) {
    payload[8 + i] = headerRow[i + 8] ?? 0x20;
  }
  // First 8 bytes of display are not shown (used for address)
  // Copy the displayable part starting from byte 8 of the header row
  for (let i = 0; i < 32; i++) {
    payload[8 + i] = (8 + i) < headerRow.length ? headerRow[8 + i] : 0x20;
  }

  return {
    magazine,
    packetNumber: 0,
    payload,
  };
}

// ─── Display packet (Y=1..23) ──────────────────────────────────

/**
 * Build a display packet for rows 1-23.
 */
export function buildDisplayPacket(
  magazine: number,
  rowNumber: number,
  rowBytes: Uint8Array,
): CompiledPacket {
  return {
    magazine,
    packetNumber: rowNumber,
    payload: rowBytes.slice(),
  };
}

// ─── Fastext packet (packet 27/0) ──────────────────────────────

/**
 * Build a fastext links packet (packet 27).
 * Simplified version: stores 6 link page numbers.
 */
export function buildFastextPacket(
  magazine: number,
  links: FastextLinks,
): CompiledPacket {
  const payload = new Uint8Array(40);

  // Simplified: store link values as 3-byte groups
  const linkValues = [
    links.red ?? 0,
    links.green ?? 0,
    links.yellow ?? 0,
    links.cyan ?? 0,
    links.link ?? 0,
    links.index ?? 0,
  ];

  for (let i = 0; i < 6; i++) {
    const val = linkValues[i];
    payload[i * 6] = val & 0xFF;
    payload[i * 6 + 1] = (val >> 8) & 0xFF;
  }

  return {
    magazine,
    packetNumber: 27,
    designationCode: 0,
    payload,
  };
}

// ─── Wire format ────────────────────────────────────────────────

/**
 * Convert a compiled packet to wire-format bytes (42 bytes):
 * [hamming_addr0, hamming_addr1, ...40 parity-protected data bytes]
 */
export function toWireBytes(packet: CompiledPacket): Uint8Array {
  return encodePacketBytes(packet.magazine, packet.packetNumber, packet.payload);
}

/**
 * Convert a header packet payload to Hamming-encoded header bytes.
 * Bytes 0-7 of the payload are Hamming 8/4 encoded,
 * bytes 8-39 get odd parity.
 */
export function toWireHeaderPayload(payload: Uint8Array): Uint8Array {
  const wire = new Uint8Array(40);
  // First 8 bytes: Hamming 8/4 encoded (each byte holds a 4-bit nibble)
  for (let i = 0; i < 8; i++) {
    wire[i] = hammingEncode84(payload[i] & 0x0F);
  }
  // Remaining 32 bytes: odd parity
  for (let i = 8; i < 40; i++) {
    wire[i] = addParity(payload[i]);
  }
  return wire;
}
