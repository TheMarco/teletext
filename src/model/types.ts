/**
 * Canonical Teletext page model types.
 *
 * This is the source of truth for the authoring system.
 * All other formats (TTI, packets) are derived from or mapped to this model.
 *
 * Per 02_PAGE_MODEL_AND_SERVICE_BUNDLE.md
 */

// ─── Page number ────────────────────────────────────────────────

/** Teletext page number: magazine (1-8) + page (0x00-0xFF) = 0x100-0x8FF */
export type PageNumber = number;

// ─── National subset ────────────────────────────────────────────

export type NationalSubset =
  | 'english'
  | 'german'
  | 'swedish_finnish'
  | 'italian'
  | 'french'
  | 'portuguese_spanish'
  | 'czech_slovak'
  | 'undefined';

// ─── Tokens ─────────────────────────────────────────────────────

export type CharToken = {
  kind: 'char';
  codepoint7: number; // 0x20-0x7F (G0)
};

export type MosaicToken = {
  kind: 'mosaic';
  codepoint7: number; // G1 mosaic code
  contiguous: boolean;
};

export type ControlToken = {
  kind: 'control';
  codepoint7: number; // 0x00-0x1F
};

export type FillToken = {
  kind: 'fill';
  count: number;
  codepoint7: number; // usually 0x20 (space)
};

export type CommentToken = {
  kind: 'comment';
  text: string; // editor-only, never compiled
};

export type TeletextToken =
  | CharToken
  | MosaicToken
  | ControlToken
  | FillToken
  | CommentToken;

// ─── Row ────────────────────────────────────────────────────────

export type TeletextRow = {
  index: number; // 0..23
  tokens: TeletextToken[];
};

// ─── Flags ──────────────────────────────────────────────────────

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

// ─── Links and timing ───────────────────────────────────────────

export type FastextLinks = {
  red?: number | null;
  green?: number | null;
  yellow?: number | null;
  cyan?: number | null;
  link?: number | null;
  index?: number | null;
};

export type CycleTiming = {
  mode: 'cycle' | 'time';
  value: number;
};

// ─── Editor metadata (never compiled) ───────────────────────────

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
  fitMode: 'contain' | 'cover' | 'stretch';
};

export type EditorMetadata = {
  guides?: RegionGuide[];
  lockedRegions?: LockedRegion[];
  traceImage?: TraceImageRef | null;
};

// ─── Subpage ────────────────────────────────────────────────────

export type TeletextSubpage = {
  subcode: number; // 0x0000-0x3F7F
  rows: TeletextRow[];
  languageSubset: NationalSubset;
  pageFlags: PageControlFlags;
  editorMeta?: EditorMetadata;
};

// ─── Page ───────────────────────────────────────────────────────

export type TeletextPage = {
  pageNumber: PageNumber;
  subpages: TeletextSubpage[];
  description?: string;
  defaultCycle?: CycleTiming | null;
  serviceFlags: PageServiceFlags;
  fastext?: FastextLinks | null;
};

// ─── Service ────────────────────────────────────────────────────

export type TeletextService = {
  id: string;
  title: string;
  pages: TeletextPage[];
  defaultLanguageSubset: NationalSubset;
  metadata?: Record<string, unknown>;
};

// ─── Preserved TTI records (for round-trip) ─────────────────────

export type PreservedTtiRecord = {
  command: string;
  raw: string;
  pageScope: 'service' | 'page' | 'subpage';
};

// ─── Validation result ──────────────────────────────────────────

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

export type ValidationError = {
  code: string;
  message: string;
  path?: string;
};

export type ValidationWarning = {
  code: string;
  message: string;
  path?: string;
};
