import { hammingDecode84, stripParity } from './hamming.js';

/**
 * Decoded teletext packet.
 */
export interface TeletextPacket {
  magazine: number;     // 1-8 (0 maps to 8)
  packetNumber: number; // 0-31
  data: Uint8Array;     // 40 bytes, parity-stripped
}

/**
 * Header packet (X/0) additional fields.
 */
export interface HeaderPacket extends TeletextPacket {
  packetNumber: 0;
  pageNumber: number;    // 0x00-0xFF
  subCode: number;       // sub-page code
  controlBits: number;   // page control bits
}

/**
 * Decode a raw teletext packet (42 bytes).
 *
 * Per ETSI EN 300 706 Section 7.1:
 * - Bytes 0-1: clock run-in / framing (already stripped in most inputs)
 * - Bytes 0-1 (of our input): magazine and packet number (Hamming 8/4)
 * - Bytes 2-41: 40 data bytes
 *
 * We accept either 42-byte (with address) or 40-byte (data only) input.
 * For 42-byte input, bytes 0-1 are the address bytes.
 */
export function decodePacket(raw: Uint8Array): TeletextPacket | null {
  if (raw.length < 40) return null;

  if (raw.length >= 42) {
    return decodeFullPacket(raw);
  }

  // 40-byte input: data only, no address — return as row data
  const data = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    data[i] = stripParity(raw[i]);
  }
  return {
    magazine: 0,
    packetNumber: 0,
    data,
  };
}

function decodeFullPacket(raw: Uint8Array): TeletextPacket | null {
  // Bytes 0-1: Hamming 8/4 encoded magazine and packet number
  const b0 = hammingDecode84(raw[0]);
  const b1 = hammingDecode84(raw[1]);

  if (b0 === -1 || b1 === -1) return null; // uncorrectable error

  // Magazine number: bits 0-2 of b0 (3 bits)
  // Packet number: bit 3 of b0 + 4 bits of b1 (5 bits)
  const magazine = b0 & 0x07;
  const packetNumber = ((b0 >> 3) & 0x01) | (b1 << 1);

  // Magazine 0 = magazine 8
  const mag = magazine === 0 ? 8 : magazine;

  // Extract 40 data bytes, strip parity
  const data = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    data[i] = stripParity(raw[i + 2]);
  }

  const packet: TeletextPacket = {
    magazine: mag,
    packetNumber,
    data,
  };

  // If it's a header packet (X/0), decode additional fields
  if (packetNumber === 0) {
    return decodeHeaderPacket(packet, raw);
  }

  return packet;
}

function decodeHeaderPacket(
  packet: TeletextPacket,
  raw: Uint8Array,
): HeaderPacket | null {
  // Bytes 2-9 of raw are Hamming 8/4 encoded header data
  // Bytes 2-3: page number (two Hamming-coded nibbles)
  const pageUnits = hammingDecode84(raw[2]);
  const pageTens = hammingDecode84(raw[3]);
  if (pageUnits === -1 || pageTens === -1) return null;
  const pageNumber = (pageTens << 4) | pageUnits;

  // Bytes 4-9: sub-code and control bits (Hamming 8/4)
  const s1 = hammingDecode84(raw[4]);
  const s2 = hammingDecode84(raw[5]);
  const s3 = hammingDecode84(raw[6]);
  const s4 = hammingDecode84(raw[7]);
  if (s1 === -1 || s2 === -1 || s3 === -1 || s4 === -1) return null;

  const subCode = s1 | ((s2 & 0x07) << 4);
  const controlBits = ((s2 >> 3) & 0x01) | (s3 << 1) | (s4 << 5);

  // Re-strip parity for data bytes 8-41 (displayable header row)
  const data = new Uint8Array(40);
  // First 8 bytes of data are the decoded header fields (not displayable)
  // Bytes 10-41 of raw = displayable part of header row
  for (let i = 0; i < 40; i++) {
    if (i < 8) {
      data[i] = 0x20; // spaces for non-displayable header area
    } else {
      data[i] = stripParity(raw[i + 2]);
    }
  }

  return {
    ...packet,
    packetNumber: 0 as const,
    pageNumber,
    subCode,
    controlBits,
    data,
  };
}

/**
 * Check if a packet is a header packet.
 */
export function isHeaderPacket(packet: TeletextPacket): packet is HeaderPacket {
  return packet.packetNumber === 0 && 'pageNumber' in packet;
}
