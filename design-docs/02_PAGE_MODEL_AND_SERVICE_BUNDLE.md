# Page Model and Service Bundle

## Design goal

Represent Teletext pages exactly enough to support:
- editing
- `.tti` import/export
- packet compilation
- bitmap-to-mosaic conversion
- future extension packets

## Canonical model

```ts
export type TeletextService = {
  id: string;
  title: string;
  pages: TeletextPage[];
  defaultLanguageSubset: NationalSubset;
  metadata?: Record<string, unknown>;
};

export type TeletextPage = {
  pageNumber: PageNumber;
  subpages: TeletextSubpage[];
  description?: string;
  defaultCycle?: CycleTiming | null;
  serviceFlags: PageServiceFlags;
  fastext?: FastextLinks | null;
};

export type TeletextSubpage = {
  subcode: number;
  rows: TeletextRow[];
  languageSubset: NationalSubset;
  pageFlags: PageControlFlags;
  editorMeta?: EditorMetadata;
};

export type TeletextRow = {
  index: number;
  tokens: TeletextToken[];
};

export type TeletextToken =
  | CharToken
  | MosaicToken
  | ControlToken
  | FillToken
  | CommentToken;

export type CharToken = {
  kind: "char";
  codepoint7: number;
};

export type MosaicToken = {
  kind: "mosaic";
  codepoint7: number;
  contiguous: boolean;
};

export type ControlToken = {
  kind: "control";
  codepoint7: number;
};

export type FillToken = {
  kind: "fill";
  count: number;
  codepoint7: number;
};

export type CommentToken = {
  kind: "comment";
  text: string;
};

export type PageServiceFlags = {
  serialMagazine: boolean;
};

export type PageControlFlags = {
  erasePage: boolean;
  newsflash: boolean;
  subtitle: boolean;
  suppressHeader: boolean;
  updateIndicator: boolean;
  interruptedSequence: boolean;
  inhibitDisplay: boolean;
};

export type FastextLinks = {
  red?: number | null;
  green?: number | null;
  yellow?: number | null;
  cyan?: number | null;
  link?: number | null;
  index?: number | null;
};

export type CycleTiming = {
  mode: "cycle" | "time";
  value: number;
};

export type NationalSubset =
  | "english"
  | "german"
  | "swedish_finnish"
  | "italian"
  | "french"
  | "portuguese_spanish"
  | "czech_slovak"
  | "undefined";

export type EditorMetadata = {
  guides?: RegionGuide[];
  lockedRegions?: LockedRegion[];
  traceImage?: TraceImageRef | null;
};

export type RegionGuide = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
};

export type LockedRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
};

export type TraceImageRef = {
  assetId: string;
  opacity: number;
  fitMode: "contain" | "cover" | "stretch";
};
```

## Canonical rules

1. AST must preserve byte-level meaning
2. Editor metadata must not affect compiled output
3. Rows must be normalized
4. Subpages are first-class
5. Unknown imported constructs must survive

## Required APIs

- `createEmptyService()`
- `createEmptyPage(pageNumber)`
- `createEmptySubpage(subcode)`
- `normalizeRowTo40Columns(row)`
- `clonePage(page)`
- `validatePage(page)`
- `validateSubpage(subpage)`
- `stripEditorMetadata(page)`
- `resolveRowToDisplayCells(row)` for preview/debug only

## Validation rules

- exactly 24 rows in canonical page model
- compiled display rows must be exactly 40 columns
- row token streams may be sparse internally, but normalization must be deterministic
- invalid page numbers rejected
- invalid fastext links rejected
- subcode range validated
- editor metadata never blocks compile
