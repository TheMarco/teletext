# Mosaic Encoding and Quantization

## Objective

Implement the exact logic that turns processed image data into Teletext mosaic content.

## Teletext mosaic model

A mosaic cell is treated as a 2x3 sextant block:
- 2 columns
- 3 rows
- 6 binary occupancy bits

The encoder must produce legal Teletext mosaic bytes and the control codes needed to display them correctly.

## Internal representations

```ts
type SextantCell = {
  bits: [number, number, number, number, number, number];
  score?: number;
};

type QuantizedPixel = {
  r: number;
  g: number;
  b: number;
  a: number;
  paletteIndex: number;
};

type RowColorPlan = {
  row: number;
  graphicsEnabled: boolean;
  foregroundRuns: ColorRun[];
  backgroundPolicy: "fixed" | "new_background";
};

type ColorRun = {
  startCol: number;
  endCol: number;
  fg: TeletextColor;
  bg: TeletextColor;
};
```

## Quantization strategy

### Step 1 — page-space conversion
Convert image region into Teletext graphics-space resolution: 2x3 subcells per character cell.

### Step 2 — palette reduction
Map pixels to Teletext-compatible palette candidates.

### Step 3 — region segmentation
Find color grouping that minimizes visual error, required control-code insertions, and illegal row transitions.

### Step 4 — sextant fitting
For each sextant cell: derive occupancy bits, choose contiguous/separated interpretation, compute confidence/error score.

### Step 5 — row color planning
Determine row-level code strategy: where to activate graphics mode, where to change foreground, whether background remains fixed or uses new background logic.

## Scoring model

```
total_score = visual_error + code_overhead_penalty + fragmentation_penalty + illegal_state_penalty
```

## v1 encoding heuristics

### Monochrome
- threshold image
- one foreground color
- background fixed
- minimal control codes

### Two-color row mode
- choose dominant foreground/background pair per row or local band
- minimize changes inside row

### Full teletext-aware mode
- dynamic programming or greedy-with-lookahead to reduce control-code waste
- prioritize legal output and readability over color richness

## Editing continuity rule

Imported mosaics must be represented as normal page content.
No opaque bitmap object may remain in final compiled page data.

## Required tests

- exact sextant bit mapping
- color-plan generation
- monochrome import snapshots
- two-color import snapshots
- control-code minimization sanity checks
- imported output remains editable
