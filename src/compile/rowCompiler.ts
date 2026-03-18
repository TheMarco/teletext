/**
 * Row compiler: converts token streams into exact 40-byte rows.
 * Per 04_PACKET_COMPILER.md Stage 1.
 */

import type { TeletextRow, TeletextToken } from '../model/types.js';
import type { CompiledDisplayRow } from './types.js';
import { DiagnosticCollector } from './diagnostics.js';

const COLS = 40;

/**
 * Compile a single row's token stream into an exact 40-byte output.
 *
 * Rules:
 * - control codes remain in stream at their codepoint7
 * - char tokens compile to their codepoint7
 * - mosaic tokens compile to their codepoint7
 * - fill tokens expand to repeated codepoint7
 * - comment tokens are stripped (editor-only)
 * - result is exactly 40 bytes, padded or truncated
 */
export function compileRow(
  row: TeletextRow,
  diag?: DiagnosticCollector,
): CompiledDisplayRow {
  const bytes = new Uint8Array(COLS);
  let col = 0;

  for (const token of row.tokens) {
    if (col >= COLS) {
      diag?.warning('ROW_OVERFLOW', `Row ${row.index} exceeds 40 columns, truncated`, { row: row.index, col });
      break;
    }

    switch (token.kind) {
      case 'char':
        if (token.codepoint7 < 0x20 || token.codepoint7 > 0x7F) {
          diag?.error('INVALID_CHAR', `Invalid char code 0x${token.codepoint7.toString(16)} at col ${col}`, { row: row.index, col });
          bytes[col++] = 0x20; // substitute space
        } else {
          bytes[col++] = token.codepoint7;
        }
        break;

      case 'mosaic':
        if (token.codepoint7 < 0x20 || token.codepoint7 > 0x7F) {
          diag?.error('INVALID_MOSAIC', `Invalid mosaic code 0x${token.codepoint7.toString(16)} at col ${col}`, { row: row.index, col });
          bytes[col++] = 0x20;
        } else {
          bytes[col++] = token.codepoint7;
        }
        break;

      case 'control':
        if (token.codepoint7 < 0x00 || token.codepoint7 > 0x1F) {
          diag?.error('INVALID_CONTROL', `Invalid control code 0x${token.codepoint7.toString(16)} at col ${col}`, { row: row.index, col });
          bytes[col++] = 0x20;
        } else {
          bytes[col++] = token.codepoint7;
        }
        break;

      case 'fill': {
        const fillByte = token.codepoint7;
        for (let i = 0; i < token.count && col < COLS; i++) {
          bytes[col++] = fillByte;
        }
        break;
      }

      case 'comment':
        // Skip — editor only
        break;
    }
  }

  // Pad remaining with spaces
  while (col < COLS) {
    bytes[col++] = 0x20;
  }

  return { rowNumber: row.index, bytes40: bytes };
}

/**
 * Validate a compiled 40-byte row.
 */
export function validateCompiledRow(
  bytes40: Uint8Array,
  diag?: DiagnosticCollector,
): boolean {
  if (bytes40.length !== COLS) {
    diag?.error('INVALID_ROW_LENGTH', `Row must be exactly ${COLS} bytes, got ${bytes40.length}`);
    return false;
  }
  // All bytes must be 0x00-0x7F (7-bit)
  for (let i = 0; i < COLS; i++) {
    if (bytes40[i] > 0x7F) {
      diag?.error('INVALID_BYTE', `Byte at col ${i} is 0x${bytes40[i].toString(16)}, exceeds 7-bit range`);
      return false;
    }
  }
  return true;
}
