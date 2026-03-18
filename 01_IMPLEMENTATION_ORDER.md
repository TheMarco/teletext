# Implementation Order

## Phase 1 — Foundation: Internal page model

Deliverables:
- exact page AST
- exact token/cell model
- page metadata model
- subpage model
- validation rules
- serialization helpers for tests only

Gate to exit phase:
- can construct pages programmatically
- can represent all Level 1 page content needed by editor and compiler
- model tests pass

---

## Phase 2 — TTI interoperability

Deliverables:
- TTI lexer
- TTI parser
- TTI exporter
- preservation of unknown records
- record ordering rules
- fixtures from real-world samples

Gate to exit phase:
- AST -> TTI -> AST round-trip passes
- sample TTI pages import successfully
- row/control code translations are preserved

---

## Phase 3 — Packet compiler

Deliverables:
- page AST -> compiled row bytes
- compiled row bytes -> Teletext packet structures
- packet ordering
- page header generation
- extension-packet hooks
- fasttext/fastext link compilation

Gate to exit phase:
- compiled packets are deterministic
- packet bytes match expected fixtures
- page metadata maps correctly into packet/header state

---

## Phase 4 — Service bundle

Deliverables:
- bundle format for multiple pages/subpages
- carousel ordering
- page indexing
- language/national subset metadata
- load/save APIs

Gate to exit phase:
- multiple pages can be grouped and loaded as one service
- subpage timing/carousel metadata is preserved

---

## Phase 5 — Editor core

Deliverables:
- grid model
- editor document lifecycle
- undo/redo
- selection model
- mutation commands
- import/export actions
- live preview handoff to CRT renderer

Gate to exit phase:
- user can author a page from scratch
- user can edit imported TTI
- mutations are reversible and deterministic

---

## Phase 6 — Bitmap import

Deliverables:
- image preprocess pipeline
- quantization
- mosaic encoding
- placement into page model
- interactive cleanup tools
- trace/overlay mode

Gate to exit phase:
- bitmap can be imported into a page region
- imported result is editable
- conversion can preserve control-code legality

---

## Phase 7 — Hardening

Deliverables:
- golden corpus
- compatibility suite
- regression suite
- export validation
- performance sanity checks

Gate to exit phase:
- corpus passes
- round-trips are stable
- no known semantic-loss bugs remain
