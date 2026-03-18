import { describe, it, expect } from 'vitest';
import {
  ttiByteToTeletext,
  teletextByteToTti,
  decodeOLContent,
  encodeOLContent,
} from '../../src/tti/ttiTranslations.js';

describe('ttiByteToTeletext', () => {
  it('translates 0x80-0x9F to 0x00-0x1F', () => {
    expect(ttiByteToTeletext(0x80)).toBe(0x00);
    expect(ttiByteToTeletext(0x87)).toBe(0x07); // alpha white
    expect(ttiByteToTeletext(0x9F)).toBe(0x1F); // release mosaic
  });

  it('passes through normal ASCII', () => {
    expect(ttiByteToTeletext(0x20)).toBe(0x20);
    expect(ttiByteToTeletext(0x41)).toBe(0x41);
    expect(ttiByteToTeletext(0x7F)).toBe(0x7F);
  });
});

describe('teletextByteToTti', () => {
  it('translates 0x00-0x1F to 0x80-0x9F', () => {
    expect(teletextByteToTti(0x00)).toBe(0x80);
    expect(teletextByteToTti(0x07)).toBe(0x87);
    expect(teletextByteToTti(0x1F)).toBe(0x9F);
  });

  it('passes through normal ASCII', () => {
    expect(teletextByteToTti(0x20)).toBe(0x20);
    expect(teletextByteToTti(0x41)).toBe(0x41);
  });
});

describe('round-trip byte translation', () => {
  it('translates back and forth for all 256 values', () => {
    for (let b = 0; b < 0x20; b++) {
      expect(ttiByteToTeletext(teletextByteToTti(b))).toBe(b);
    }
    for (let b = 0x20; b < 0x80; b++) {
      expect(ttiByteToTeletext(teletextByteToTti(b))).toBe(b);
    }
  });
});

describe('decodeOLContent', () => {
  it('decodes plain ASCII content', () => {
    const bytes = decodeOLContent('Hello');
    expect(bytes).toEqual([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
  });

  it('decodes translated control codes', () => {
    const content = String.fromCharCode(0x87) + 'Hi'; // 0x87 = alpha white
    const bytes = decodeOLContent(content);
    expect(bytes[0]).toBe(0x07); // alpha white
    expect(bytes[1]).toBe(0x48); // H
    expect(bytes[2]).toBe(0x69); // i
  });

  it('handles empty string', () => {
    expect(decodeOLContent('')).toEqual([]);
  });
});

describe('encodeOLContent', () => {
  it('encodes plain ASCII', () => {
    const result = encodeOLContent([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
    expect(result).toBe('Hello');
  });

  it('encodes control codes to high ASCII', () => {
    const result = encodeOLContent([0x07, 0x48, 0x69]);
    expect(result.charCodeAt(0)).toBe(0x87);
    expect(result.substring(1)).toBe('Hi');
  });

  it('round-trips through decode/encode', () => {
    const original = [0x07, 0x41, 0x42, 0x1E, 0x3F, 0x20];
    const encoded = encodeOLContent(original);
    const decoded = decodeOLContent(encoded);
    expect(decoded).toEqual(original);
  });
});
