# Glyph System

## Requirement

Do NOT use Unicode rendering.

## Glyph Types

### Text (G0)
- ASCII-like
- National variants

### Mosaic (G1)
- 2x3 block grid
- 6 regions per cell

## Representation

type Glyph = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

## Mosaic Encoding

Each character encodes:
[bit0 bit1]
[bit2 bit3]
[bit4 bit5]

Each bit → filled block

## Rendering

- Each cell drawn independently
- No anti-aliasing
