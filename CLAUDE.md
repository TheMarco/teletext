# PROJECT: Teletext System B — Renderer + Authoring System

## Current phase: Authoring system implementation

The CRT renderer and state machine are complete and working (in `src/`).
This phase builds the authoring, page-compilation, and editing system on top of it.

## Absolute priorities

1. Exactness over speed
2. Determinism over convenience
3. Interoperability over novelty
4. Small, testable modules over large abstractions

## Architecture

### Existing (complete, out of scope for changes)
- `src/state-machine/` — control code state machine
- `src/glyph-system/` — G0/G1 glyph rendering + cache
- `src/render-buffer/` — resolved cell grid → RGBA pixels
- `src/packet-decoder/` — Hamming 8/4 + parity stripping
- `src/page-assembler/` — packet stream → page reconstruction
- `src/timing-engine/` — flash phase timing
- `demo/` — browser demo

### New (this phase)
- `src/model/` — canonical page AST and types
- `src/tti/` — TTI import/export
- `src/compile/` — AST → packet compiler
- `src/bundle/` — service bundle format
- `src/editor/` — editor core (commands, undo, state)
- `src/import/` — bitmap → mosaic import pipeline
- `src/test-fixtures/` — shared fixtures

## Working rules

- Internal page model is the source of truth (not TTI, not packets)
- `.tti` is the required interchange format
- Packet compilation must preserve exact control-code semantics
- Do not invent alternate Teletext behavior
- Do not replace control codes with rich abstractions that lose byte-level meaning
- Do not couple editor UI state directly to compiled packet bytes
- Do not use Unicode mosaic approximations as authoritative data
- If behavior is ambiguous, follow ETSI EN 300 706 spec exactly

## Implementation order

Follow `design-docs/01_IMPLEMENTATION_ORDER.md` exactly. Do not skip phases.

## Spec documents (in design-docs/)

- `design-docs/00_READ_FIRST.md` — project overview
- `design-docs/01_IMPLEMENTATION_ORDER.md` — phase sequence and gates
- `design-docs/02_PAGE_MODEL_AND_SERVICE_BUNDLE.md` — canonical types and APIs
- `design-docs/03_TTI_INTEROP.md` — TTI parser/exporter architecture
- `design-docs/04_PACKET_COMPILER.md` — AST → packet compilation
- `design-docs/05_EDITOR_PRD.md` — editor product requirements
- `design-docs/06_AUTHORING_UX.md` — editor UX design
- `design-docs/07_BITMAP_IMPORT_PIPELINE.md` — image import pipeline
- `design-docs/08_MOSAIC_AND_QUANTIZATION.md` — mosaic encoding logic
- `design-docs/09_TEST_PLAN.md` — full test plan
- `design-docs/10_AGENT_TASKS.md` — ordered task list

## Engineering style

- Strong TypeScript types
- Pure functions where practical
- Snapshot and golden-file testing
- Lossless parsing where possible
- Preserve unknown records during TTI round-trip

## Deliverable expectations

Every major module must include:
- source file(s)
- unit tests
- fixtures
- at least one round-trip test if the module transforms data
