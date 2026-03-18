/**
 * Teletext Level 1 spacing attributes (column 0 of code table).
 * Per ETSI EN 300 706 Table 26.
 *
 * Codes 0x00-0x1F are control codes. The 7-bit data byte from the
 * packet maps directly to these values after parity stripping.
 */

// Alpha (text) foreground colors — set-after (spacing attributes)
export const ALPHA_BLACK   = 0x00; // Not used at Level 1, but defined
export const ALPHA_RED     = 0x01;
export const ALPHA_GREEN   = 0x02;
export const ALPHA_YELLOW  = 0x03;
export const ALPHA_BLUE    = 0x04;
export const ALPHA_MAGENTA = 0x05;
export const ALPHA_CYAN    = 0x06;
export const ALPHA_WHITE   = 0x07;

// Flash control
export const FLASH   = 0x08;
export const STEADY  = 0x09;

// Box control (Level 1)
export const END_BOX   = 0x0A;
export const START_BOX = 0x0B;

// Size control
export const NORMAL_HEIGHT = 0x0C;
export const DOUBLE_HEIGHT = 0x0D;
// 0x0E = Double Width (not Level 1)
// 0x0F = Double Size (not Level 1)

// Mosaic (graphics) foreground colors — set-after (spacing attributes)
export const MOSAIC_BLACK   = 0x10; // Not used at Level 1, but defined
export const MOSAIC_RED     = 0x11;
export const MOSAIC_GREEN   = 0x12;
export const MOSAIC_YELLOW  = 0x13;
export const MOSAIC_BLUE    = 0x14;
export const MOSAIC_MAGENTA = 0x15;
export const MOSAIC_CYAN    = 0x16;
export const MOSAIC_WHITE   = 0x17;

// Display control
export const CONCEAL = 0x18;

// Mosaic type
export const CONTIGUOUS_MOSAIC = 0x19;
export const SEPARATED_MOSAIC  = 0x1A;

// Character set switch
export const ESC = 0x1B;

// Background control
export const BLACK_BACKGROUND = 0x1C;
export const NEW_BACKGROUND   = 0x1D;

// Hold/Release mosaic
export const HOLD_MOSAIC    = 0x1E;
export const RELEASE_MOSAIC = 0x1F;

/**
 * Returns true if the byte is a control code (0x00-0x1F).
 */
export function isControlCode(byte: number): boolean {
  return byte >= 0x00 && byte <= 0x1F;
}

/**
 * Returns true if the byte is an alpha (text) color code.
 */
export function isAlphaColor(byte: number): boolean {
  return byte >= ALPHA_BLACK && byte <= ALPHA_WHITE;
}

/**
 * Returns true if the byte is a mosaic (graphics) color code.
 */
export function isMosaicColor(byte: number): boolean {
  return byte >= MOSAIC_BLACK && byte <= MOSAIC_WHITE;
}
