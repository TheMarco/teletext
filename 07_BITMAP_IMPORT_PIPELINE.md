# Bitmap Import Pipeline

## Objective

Convert arbitrary bitmap graphics into editable Teletext mosaic graphics that can be placed on authored pages.

## Design principle

Import must produce legal page content, not a rendered overlay.
The output of import is:
- control codes
- mosaic bytes
- row structure
- editable page content

## Supported import modes

### Mode 1 — Monochrome mosaic
- simplest
- strongest readability
- one foreground color + background

### Mode 2 — Two-color row-aware import
- optimize per row/region
- choose foreground/background pair
- reduce control-code overhead

### Mode 3 — Full teletext-aware segmentation
- optimize color runs
- insert control codes strategically
- preserve row legality

## Pipeline stages

### Stage 1 — image ingest
- load local asset
- decode to RGBA
- preserve original for trace overlay

### Stage 2 — crop and fit
- support page region placement
- support contain/cover/stretch
- support manual crop handles

### Stage 3 — preprocessing
- grayscale option
- sharpen option
- threshold option
- posterize option
- edge-emphasis option

### Stage 4 — Teletext quantization
- reduce to Teletext-compatible palette and structure
- choose import mode
- choose active background strategy

### Stage 5 — mosaic encoding
- partition region into 2x3 sextant cells
- choose best mosaic byte per cell
- choose contiguous/separated behavior
- decide where control codes are needed

### Stage 6 — page insertion
- write required row-leading graphics/color codes
- place mosaic bytes into region
- preserve existing protected/locked cells where requested

### Stage 7 — cleanup handoff
- imported result becomes editable
- original trace can remain visible for refinement

## Required output model

```ts
type BitmapImportResult = {
  placedRegion: { x: number; y: number; width: number; height: number };
  generatedMutations: EditorMutation[];
  diagnostics: ImportDiagnostic[];
  previewMetrics: ImportMetrics;
};
```

## Required options

- mode
- target page region
- preferred foreground color
- preferred background color
- allow row color changes
- contiguous/separated mosaics
- preserve existing control codes
- erase target region first
- keep trace overlay after import

## Required diagnostics

- source too detailed
- heavy loss due to color limits
- imported region requires many control codes
- locked cells prevented full placement
- target rows lacked graphics activation until inserted

## Required APIs

- `importBitmapToPage(options)`
- `fitBitmapToRegion(image, region, mode)`
- `buildTraceOverlay(image, region)`
- `applyBitmapImportResult(page, result)`

## Important rule

Never directly mutate raster preview output.
All import must flow through page mutations.
