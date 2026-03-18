# Packet Decoder

## Input
Raw Teletext packet (42 bytes typical)

## Processing

- Remove parity bit (7-bit data)
- Validate Hamming (8/4) if enabled
- Extract:
  - magazine number
  - packet number
  - 40 data bytes

## Output

type TeletextPacket = {
  magazine: number;
  packetNumber: number;
  data: Uint8Array; // length 40
};

## Rules

- Ignore invalid parity packets
- Support raw binary + test fixtures
