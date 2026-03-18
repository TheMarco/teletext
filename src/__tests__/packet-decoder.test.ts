import { describe, it, expect } from 'vitest';
import { hammingDecode84, stripParity, decodePacket } from '../packet-decoder/index.js';

describe('hammingDecode84', () => {
  it('decodes all 16 valid codewords', () => {
    // Verify that for each data value 0-15, at least one byte decodes to it
    const seen = new Set<number>();
    for (let b = 0; b < 256; b++) {
      const val = hammingDecode84(b);
      if (val >= 0) seen.add(val);
    }
    for (let d = 0; d < 16; d++) {
      expect(seen.has(d)).toBe(true);
    }
  });

  it('corrects single-bit errors', () => {
    // Find the correct encoding for data=0 by scanning
    let encoding0 = -1;
    for (let b = 0; b < 256; b++) {
      if (hammingDecode84(b) === 0) {
        // Verify all single-bit flips also decode to 0
        let allCorrect = true;
        for (let bit = 0; bit < 8; bit++) {
          if (hammingDecode84(b ^ (1 << bit)) !== 0) {
            allCorrect = false;
            break;
          }
        }
        if (allCorrect) {
          encoding0 = b;
          break;
        }
      }
    }
    expect(encoding0).not.toBe(-1);

    // Verify single-bit error correction for data=0
    for (let bit = 0; bit < 8; bit++) {
      expect(hammingDecode84(encoding0 ^ (1 << bit))).toBe(0);
    }
  });

  it('detects 2-bit errors as uncorrectable', () => {
    // Find a valid codeword and flip 2 bits
    // Some 2-bit errors should be detected (return -1)
    let found = false;
    for (let b = 0; b < 256 && !found; b++) {
      const val = hammingDecode84(b);
      if (val < 0) continue;
      for (let b1 = 0; b1 < 8 && !found; b1++) {
        for (let b2 = b1 + 1; b2 < 8; b2++) {
          const corrupted = b ^ (1 << b1) ^ (1 << b2);
          if (hammingDecode84(corrupted) === -1) {
            found = true;
            break;
          }
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe('stripParity', () => {
  it('strips bit 7', () => {
    expect(stripParity(0xC1)).toBe(0x41);
    expect(stripParity(0x41)).toBe(0x41);
    expect(stripParity(0xFF)).toBe(0x7F);
  });
});

describe('decodePacket', () => {
  it('returns null for input shorter than 40 bytes', () => {
    expect(decodePacket(new Uint8Array(10))).toBeNull();
  });

  it('decodes 40-byte data-only input', () => {
    const raw = new Uint8Array(40).fill(0xC1); // 'A' with parity
    const packet = decodePacket(raw);
    expect(packet).not.toBeNull();
    expect(packet!.data[0]).toBe(0x41);
    expect(packet!.data.length).toBe(40);
  });
});
