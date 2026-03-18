# Test Plan

## Test philosophy

This project is correctness-sensitive.
It requires:
- semantic tests
- byte-level tests
- visual/golden tests

## Test layers

### Layer 1 — model tests
Verify:
- page model validity
- subpage validity
- row normalization
- metadata constraints

### Layer 2 — TTI tests
Verify:
- lexer tokenization
- parser semantics
- exporter stability
- round-trip fidelity
- unknown-record preservation

### Layer 3 — compiler tests
Verify:
- row compile to 40 bytes
- control-code preservation
- packet generation
- metadata mapping
- deterministic packet ordering

### Layer 4 — editor-command tests
Verify:
- command application
- undo/redo
- region operations
- mosaic plotting
- metadata edits

### Layer 5 — bitmap import tests
Verify:
- crop/fit correctness
- sextant encoding correctness
- quantization stability
- page insertion legality

### Layer 6 — golden page tests
Maintain a corpus:
- handcrafted page fixtures
- imported TTI pages
- imported bitmap-conversion pages

For each:
- AST snapshot
- exported TTI snapshot
- compiled packet snapshot
- rendered golden image through existing CRT renderer

## Required fixture categories

### TTI fixtures
- simple text page
- mixed text/graphics page
- fasttext/fastext page
- multi-subpage carousel
- pages containing translated control chars

### Authoring fixtures
- double-height showcase
- hold/release graphics examples
- row color transition examples
- concealed text examples

### Bitmap fixtures
- logo
- icon
- portrait-like high-contrast image
- line art
- low-detail landscape

## Regression policy

Every bug fixed must add:
- a reproducer fixture
- a failing test before fix
- a stable test after fix

## Acceptance gates

The system cannot be called done unless:
- round-trip tests pass
- packet snapshots pass
- golden-image review is approved
- imported bitmaps remain editable after placement
