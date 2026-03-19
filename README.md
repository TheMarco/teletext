# Teletext System B

A complete Teletext System B (WST) platform: renderer, authoring system, editor, and viewer. Built from scratch in TypeScript based on ETSI EN 300 706.

![Teletext Viewer](https://img.shields.io/badge/pages-36+-cyan) ![Tests](https://img.shields.io/badge/tests-400%20passing-green) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

## What is this?

This is a fully functional Teletext system that can:

- **Render** pixel-perfect Teletext pages through a state machine that implements every Level 1 control code
- **Import** real broadcast captures from `.t42` (DVB) files
- **Author** new pages with a browser-based visual editor
- **Compile** pages into exact Teletext packet structures
- **Display** pages through a CRT shader that simulates scanlines, phosphor persistence, bloom, and aperture grille
- **View** a complete Teletext service with keypad navigation, fastext links, and subpage carousels

## Quick Start

```bash
npm install

# Run the homepage (viewer + info)
npm start

# Run the editor
npm run editor

# Run tests
npm test
```

## The Viewer

A standalone Teletext viewer with a CRT shader overlay. Type page numbers on the keypad or keyboard (hex, 100-8FF). Navigate with fastext color buttons. Arrow keys and PgUp/PgDn flip through subpages. Press R to reveal concealed text. Load any `.t42` file with the Load button.

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

A browser-based WYSIWYG Teletext page editor. Press `?` for the full help overlay.

**Tools:**

- **Text** — click to place cursor, type characters. Arrow keys navigate, Enter for new line, Tab advances 4 columns
- **Paint Blocks** — click/drag to paint individual 2×3 sextant sub-blocks. Right-click erases. Shift+drag constrains to straight horizontal lines. Space places a full block at cursor
- **Recolor** — flood fill that recolors all connected cells sharing the same fg, bg, and type (text/mosaic)
- **Eraser** — click/drag to clear cells to default state
- **Pick Color** — click any cell to grab its foreground and background colors
- **Select/Move** — drag to select a region, click inside to move it, Delete to clear

**Features:**

- Undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- Double-height rows
- Foreground and background color selection (8 teletext colors, keys 1-8 / Shift+1-8 in non-text tools)
- Multi-page editing with insert, duplicate, and delete
- Subpage management (add, duplicate, delete, navigate)
- Fastext link editing with separate label and page target fields (renders colored bar on row 24)
- CRT shader overlay toggle
- Full-color bitmap import with configurable position, size, and background color
- T42 import (loads all pages from broadcast captures) and export (saves all pages)
- Smart row compiler that automatically manages teletext control codes, sacrificing cell positions for color/mode transitions as required by the format

## The Renderer

The core rendering pipeline:

```
Raw bytes → State Machine → Cell Grid → Glyph Cache → Render Buffer → RGBA Pixels
```

- **State machine** — processes all Level 1 spacing attributes: 8 alpha colors, 8 mosaic colors, flash/steady, double-height, conceal, hold/release graphics, contiguous/separated mosaics, background color, ESC switch
- **Glyph system** — bitmap font for G0 (text) with national variants, G1 mosaic renderer with contiguous/separated modes
- **Render buffer** — resolves cells to glyph IDs, renders to 480×240 RGBA pixel buffer with flash phase and reveal support
- **CRT shader** — 5-pass WebGL pipeline: bloom extraction → Gaussian blur (H+V) → CRT composite → blit. Simulates scanlines, aperture grille, phosphor persistence, halation, RGB convergence, interlace flicker, analog noise

## T42 Import/Export

Imports and exports real Teletext broadcast data in `.t42` format (DVB teletext data units).

**Import handles:**

- Raw 42-byte and 46-byte block formats
- PES-framed DVB data units
- Auto-detection of bit-reversed captures
- Hamming 8/4 decoding with the standard ETSI lookup table
- Persistent page buffers (rows accumulate over multiple transmissions, like a real decoder)
- Null line filtering
- Page number extraction from Hamming-encoded header bytes

**Export produces:**

- Standard 42-byte wire-format packets
- Hamming 8/4 encoded address and header bytes
- Odd parity on all data bytes
- Correct page flags, subcode, and language subset encoding
- Fastext link packets (packet 27)

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

## Smart Row Compiler

The editor uses a smart row compiler that bridges the gap between the visual editing model (each cell has its own color) and the teletext byte format (colors are set by control codes that consume display positions):

- Automatically inserts color/mode control codes before transitions
- Prefers placing control codes in existing empty space cells
- When no space is available, sacrifices cells at the transition point — this is standard teletext behavior where every color/mode change requires one display position
- Handles background color changes, foreground color changes, text/mosaic mode switches, and contiguous/separated mosaic transitions

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
├── tti/              # TTI lexer/parser/mapper/exporter, T42 import/export
├── compile/          # AST → packet compiler, Hamming 8/4 encode
├── bundle/           # Service serialization
├── editor/           # Visual editor types, smart row compiler
└── import/           # Bitmap → mosaic pipeline

demo/
├── index.html        # Viewer + info panel
├── viewer.html       # Standalone teletext viewer
├── viewer-main.ts    # Viewer logic (T42 load, keypad, subpage carousel)
├── editor.html       # Page editor
├── editor-main.ts    # Editor logic (tools, painting, import/export)
└── ai-created-pages.ts  # 36-page teletext service

tests/                # 400 tests across 27 files
```

## Key Design Decisions

- **Internal page model is the source of truth** — not TTI, not packets. All formats are derived from or mapped to the canonical AST.
- **Exactness over convenience** — control codes preserve byte-level meaning. The renderer shows what's in the data, errors and all.
- **The compiler doesn't "fix" illegal authoring** — it may warn, it may fail, but it won't silently rewrite semantics.
- **Editor metadata never affects compiled output** — guides, locked regions, and trace images are stripped before compilation.
- **Color transitions consume display positions** — the smart row compiler automatically places control codes, sacrificing cells when no empty space is available, matching real teletext hardware behavior.

## Tests

400 tests across 27 files covering:

- State machine control codes, edge cases, and interactions
- TTI round-trip fidelity
- T42 import with Hamming decode verification
- Packet compiler determinism
- Smart row compiler color transitions
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

CC BY 4.0 — Attribution required. See [LICENSE](LICENSE).

---

Built by [Marco van Hylckama Vlieg](https://ai-created.com) using AI tools.
