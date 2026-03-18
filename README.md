# Teletext System B

A complete Teletext System B (WST) platform: renderer, authoring system, editor, and viewer. Built from scratch in TypeScript based on ETSI EN 300 706.

![Teletext Viewer](https://img.shields.io/badge/pages-36-cyan) ![Tests](https://img.shields.io/badge/tests-389%20passing-green) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

## What is this?

This is a fully functional Teletext system that can:

- **Render** pixel-perfect Teletext pages through a state machine that implements every Level 1 control code
- **Import** real broadcast captures from `.t42` (DVB) and `.tti` files
- **Author** new pages with a browser-based editor
- **Compile** pages into exact Teletext packet structures
- **Display** pages through a CRT shader that simulates scanlines, phosphor persistence, bloom, and aperture grille
- **View** a complete Teletext service with keypad navigation, fastext links, and subpage carousels

## Quick Start

```bash
npm install

# Run the viewer (teletext service with CRT shader)
npm run viewer

# Run the editor
npm run editor

# Run the basic demo
npm run demo

# Run tests
npm test
```

## The Viewer

A standalone Teletext viewer with a CRT shader overlay. Type page numbers on the keypad or keyboard. Navigate with fastext color buttons. Arrow keys flip through subpages.

The viewer ships with a 36-page Teletext service built from [ai-created.com](https://ai-created.com) content — products, stories, lab notes, media, and about pages, all formatted as authentic Teletext.

**Page map:**
| Pages | Content |
|---|---|
| P100 | Main index |
| P200 | Products index |
| P201-P214 | Individual products |
| P300-P304 | 0→1 Stories |
| P400-P411 | Lab Notes |
| P500 | Media |
| P600 | About |

## The Editor

A browser-based Teletext page editor with four modes:

- **Text** — type characters, arrow keys to navigate
- **Control** — insert color codes, flash, double-height, hold graphics
- **Mosaic** — click and drag to paint 2×3 sextant blocks, right-click to erase
- **Inspect** — examine raw byte values of any cell

Features: undo/redo, copy/paste rows, subpage management, page settings, fastext link editing, keyboard shortcuts for all control codes, control code overlay, bitmap import, TTI/T42 import/export.

Press `?` for the help overlay.

## The Renderer

The core rendering pipeline:

```
Raw bytes → State Machine → Cell Grid → Glyph Cache → Render Buffer → RGBA Pixels
```

- **State machine** — processes all Level 1 spacing attributes: 8 alpha colors, 8 mosaic colors, flash/steady, double-height, conceal, hold/release graphics, contiguous/separated mosaics, background color, ESC switch
- **Glyph system** — bitmap font for G0 (text) with national variants, G1 mosaic renderer with contiguous/separated modes
- **Render buffer** — resolves cells to glyph IDs, renders to 480×240 RGBA pixel buffer with flash phase and reveal support
- **CRT shader** — 5-pass WebGL pipeline: bloom extraction → Gaussian blur (H+V) → CRT composite → blit. Simulates scanlines, aperture grille, phosphor persistence, halation, RGB convergence, interlace flicker, analog noise

## T42 Import

Imports real Teletext broadcast captures from `.t42` files (DVB teletext data units). Handles:

- Raw 42-byte and 46-byte block formats
- PES-framed DVB data units
- Auto-detection of bit-reversed captures
- Hamming 8/4 decoding with the standard ETSI lookup table
- Persistent page buffers (rows accumulate over multiple transmissions, like a real decoder)
- Null line filtering
- Page number extraction from Hamming-encoded header bytes

## TTI Import/Export

Full `.tti` interoperability:

- Lexer → parser → AST mapper pipeline
- Control character translation (0x00-0x1F ↔ 0x80-0x9F)
- Round-trip fidelity: AST → TTI → AST preserves control codes, page flags, fastext links
- Unknown record preservation for vendor extensions
- Deterministic export ordering

## Packet Compiler

Compiles the canonical page model into exact Teletext packet structures:

- Row normalization to 40 bytes
- Hamming 8/4 encoding for address and header bytes
- Odd parity for data bytes
- Page flag and language subset encoding
- Fastext link packets
- Structured diagnostics (warnings/errors with row/col positions)

## Bitmap Import

Converts images into editable Teletext mosaic graphics:

- **Monochrome** — single foreground color, threshold-based
- **Two-color** — per-row dominant color analysis
- **Full color** — per-cell color analysis with automatic color run optimization, minimizes control code overhead while maximizing visual fidelity

Pipeline: image → resize/fit → quantize to 8-color palette → encode 2×3 sextant cells → plan color runs → emit mosaic tokens with control codes.

## Architecture

```
src/
├── state-machine/    # Control code state machine
├── glyph-system/     # G0/G1 fonts, glyph cache, national variants
├── render-buffer/    # Cell grid → RGBA pixel rendering
├── packet-decoder/   # Hamming 8/4 decode, parity
├── page-assembler/   # Packet stream → page reconstruction
├── timing-engine/    # Flash phase timing
├── crt/              # WebGL CRT shader overlay
├── model/            # Canonical page types, validators, factories
├── tti/              # TTI lexer/parser/mapper/exporter, T42 import
├── compile/          # AST → packet compiler
├── bundle/           # Service serialization
├── editor/           # Editor state, commands, preview adapter
└── import/           # Bitmap → mosaic pipeline

demo/
├── viewer.html       # Standalone teletext viewer
├── editor.html       # Page editor
├── index.html        # Basic renderer demo
└── ai-created-pages.ts  # 36-page teletext service

tests/                # 389 tests across 26 files
```

## Key Design Decisions

- **Internal page model is the source of truth** — not TTI, not packets. All formats are derived from or mapped to the canonical AST.
- **Exactness over convenience** — control codes preserve byte-level meaning. The renderer shows what's in the data, errors and all.
- **The compiler doesn't "fix" illegal authoring** — it may warn, it may fail, but it won't silently rewrite semantics.
- **Editor metadata never affects compiled output** — guides, locked regions, and trace images are stripped before compilation.

## Tests

389 tests covering:

- State machine control codes, edge cases, and interactions
- TTI round-trip fidelity
- T42 import with Hamming decode verification
- Packet compiler determinism
- Editor command reversibility (50 edits + 50 undos = original state)
- Bitmap import pipeline bijectivity
- Golden pixel-perfect rendering validation
- Bundle serialization round-trips
- Full pipeline regression (model → compile → render)

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Tech Stack

TypeScript, Vite, Vitest, WebGL (GLSL shaders). No runtime dependencies.

## References

- ETSI EN 300 706 — Enhanced Teletext specification
- SAA5050 — Teletext character generator
- libzvbi — Hamming 8/4 decode table

## License

ISC

---

Built by [Marco van Hylckama Vlieg](https://ai-created.com) using AI tools.
