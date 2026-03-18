# System Architecture

Pipeline:

[Packet Stream]
→ Packet Decoder
→ Page Assembler
→ State Machine
→ Render Buffer
→ Pixel Renderer (external CRT)

## Modules

1. packet-decoder
2. page-assembler
3. state-machine
4. glyph-system
5. render-buffer
6. timing-engine

Each module must be independent and testable.
