/**
 * TTI control character translation.
 *
 * TTI files store Teletext control codes (0x00-0x1F) by mapping them
 * into the high ASCII range 0x00→0x80, 0x01→0x81, ..., 0x1F→0x9F.
 * This avoids conflicts with ASCII control characters in text files.
 *
 * Per 03_TTI_INTEROP.md.
 */

const TTI_CONTROL_OFFSET = 0x80;

/**
 * Convert a TTI-encoded byte (from OL line content) to Teletext byte.
 * - 0x80-0x9F → 0x00-0x1F (control codes)
 * - everything else passes through
 */
export function ttiByteToTeletext(byte: number): number {
  if (byte >= 0x80 && byte <= 0x9F) {
    return byte - TTI_CONTROL_OFFSET;
  }
  return byte;
}

/**
 * Convert a Teletext byte to TTI-encoded byte for export.
 * - 0x00-0x1F → 0x80-0x9F (translated control codes)
 * - everything else passes through
 */
export function teletextByteToTti(byte: number): number {
  if (byte >= 0x00 && byte <= 0x1F) {
    return byte + TTI_CONTROL_OFFSET;
  }
  return byte;
}

/**
 * Decode an OL line string into Teletext bytes.
 *
 * Handles two encoding styles:
 * 1. Direct high-byte encoding: characters 0x80-0x9F represent control codes
 * 2. Escaped hex notation: literal \xNN sequences (common in text-mode TTI files)
 *
 * Both are translated to Teletext bytes (0x00-0x1F for control codes).
 */
export function decodeOLContent(content: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < content.length; i++) {
    // Check for \xNN hex escape sequence
    if (
      content[i] === '\\' &&
      i + 3 < content.length &&
      content[i + 1] === 'x' &&
      isHexDigit(content[i + 2]) &&
      isHexDigit(content[i + 3])
    ) {
      const code = parseInt(content.substring(i + 2, i + 4), 16);
      bytes.push(ttiByteToTeletext(code));
      i += 3; // skip past \xNN (loop increments once more)
      continue;
    }
    const code = content.charCodeAt(i);
    bytes.push(ttiByteToTeletext(code));
  }
  return bytes;
}

function isHexDigit(ch: string): boolean {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

/**
 * Encode Teletext bytes into an OL line string for export.
 * Control codes 0x00-0x1F are translated to 0x80-0x9F.
 */
export function encodeOLContent(bytes: number[]): string {
  return bytes.map(b => String.fromCharCode(teletextByteToTti(b))).join('');
}
