# TTI Interop

## Objective

Implement robust `.tti` import/export without making TTI the canonical internal model.

## Supported record types for v1

Mandatory:
- PN
- CT
- DE
- PS
- SC
- OL
- FL

Pass-through / preserve if encountered:
- unknown records
- ordering comments
- vendor-specific extensions

## Parser architecture

### Stage 1 — raw line reader
- read file as text
- normalize line endings
- preserve original raw lines for diagnostics

### Stage 2 — record lexer
Each line is:
- two-letter command
- comma-separated payload

Output:
```ts
type TtiRecord = {
  command: string;
  raw: string;
  parts: string[];
  lineNumber: number;
};
```

### Stage 3 — semantic parser
Convert records into structured model objects and page groups.

### Stage 4 — AST mapper
Map structured TTI page records into TeletextPage and TeletextSubpage.

## Record semantics

### PN
Represents page number and subpage shorthand.
Must map to page identity.
Do not assume PN alone defines full subcode state if SC exists.

### CT
Represents subpage rotation timing.
Support both cycle-based and time-based forms.

### DE
Optional descriptive text.
Retain exactly as given where possible.

### PS
Represents page/service flags and language bits.
Must parse as a bitfield.
Do not collapse into a string enum.

### SC
Explicit subcode.
Canonical numeric storage in AST.

### OL
Represents output line content.
Must support:
- empty output lines
- 1..27 line numbers
- translated control characters
- viewdata escape forms where present

### FL
Represents fasttext/fastext links.
Store as nullable numeric targets.

## Translation rules

### Control chars
When importing OL:
- treat high ASCII 0x80..0x9F as translated control codes where applicable
- optionally support Viewdata escape sequences during parse
- preserve exact byte intent

### Double-height special case
Importer must preserve meaning exactly.
Exporter must provide a compatibility option for systems expecting the alternate storage convention.

## Unknown record policy

Unknown records must not be discarded.
Store them in:
```ts
type PreservedTtiRecord = {
  command: string;
  raw: string;
  pageScope: "service" | "page" | "subpage";
};
```
Round-trip them back out in stable order unless explicitly stripped.

## Export rules

Exporter must:
- emit stable ordering
- preserve canonical formatting
- emit legal translated OL content
- preserve pass-through records when requested

Recommended output order per page/subpage:
1. DE
2. PN
3. CT
4. SC
5. PS
6. OL records in row order
7. FL
8. preserved vendor records

## Required tests

- parse sample real-world TTI
- AST -> TTI -> AST round-trip
- import translated control chars
- import empty OL lines
- preserve unknown records
- export deterministic output ordering

## Required modules

- `/src/tti/ttiLexer.ts`
- `/src/tti/ttiParser.ts`
- `/src/tti/ttiMapper.ts`
- `/src/tti/ttiExporter.ts`
- `/src/tti/ttiTranslations.ts`
- `/tests/tti/*.test.ts`
