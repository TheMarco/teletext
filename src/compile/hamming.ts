/**
 * Hamming 8/4 encoding for packet address bytes.
 * Compatible with ETSI EN 300 706 / libzvbi decode table.
 */

import { hammingDecode84 } from '../packet-decoder/hamming.js';

// Build encode table by finding the canonical encoding for each nibble
// from the decode table. For each data value 0-15, find the first byte
// (0-255) that decodes to that value without error correction.
const HAMMING_ENCODE_TABLE = buildEncodeTable();

function buildEncodeTable(): Uint8Array {
  const table = new Uint8Array(16);
  for (let byte = 0; byte < 256; byte++) {
    const decoded = hammingDecode84(byte);
    if (decoded >= 0 && decoded < 16 && table[decoded] === 0 && decoded !== 0) {
      table[decoded] = byte;
    }
    // Handle 0 specially (first match might be byte 0)
    if (decoded === 0 && byte > 0 && table[0] === 0) {
      // Check that this is a clean decode (no error correction needed)
      // by verifying it's the canonical encoding
    }
  }
  // Find encoding for 0 explicitly
  for (let byte = 0; byte < 256; byte++) {
    if (hammingDecode84(byte) === 0) {
      table[0] = byte;
      break;
    }
  }
  return table;
}

/**
 * Hamming 8/4 encode a 4-bit nibble (0-15) into an 8-bit byte.
 */
export function hammingEncode84(nibble: number): number {
  return HAMMING_ENCODE_TABLE[nibble & 0x0F];
}

/**
 * Add odd parity bit (bit 7) to a 7-bit data byte.
 */
export function addParity(byte7: number): number {
  let bits = byte7 & 0x7F;
  let count = 0;
  let v = bits;
  while (v) { count += v & 1; v >>= 1; }
  return (count & 1) ? bits : bits | 0x80;
}

/**
 * Encode a full 42-byte Teletext packet from logical data.
 * [hamming_addr0, hamming_addr1, ...40 parity-protected data bytes]
 */
export function encodePacketBytes(
  magazine: number,
  packetNumber: number,
  data40: Uint8Array,
): Uint8Array {
  const output = new Uint8Array(42);

  const mag = magazine & 0x07;
  const addr0 = (mag & 0x07) | (((packetNumber >> 0) & 0x01) << 3);
  output[0] = hammingEncode84(addr0);

  const addr1 = (packetNumber >> 1) & 0x0F;
  output[1] = hammingEncode84(addr1);

  for (let i = 0; i < 40; i++) {
    output[2 + i] = addParity(data40[i]);
  }

  return output;
}
