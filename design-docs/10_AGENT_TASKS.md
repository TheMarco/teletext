# Agent Tasks for Claude Code

## Use order

Run these tasks in order.
Do not skip.

---

## Task 1 — Build page model

Read:
- 00_READ_FIRST.md
- CLAUDE.md
- 01_IMPLEMENTATION_ORDER.md
- 02_PAGE_MODEL_AND_SERVICE_BUNDLE.md

Implement:
- `/src/model/types.ts`
- `/src/model/validators.ts`
- `/src/model/factories.ts`
- `/tests/model/*.test.ts`

Success criteria:
- model compiles
- validation rules enforced
- tests pass

---

## Task 2 — Build TTI interop

Read:
- 03_TTI_INTEROP.md

Implement:
- `/src/tti/ttiLexer.ts`
- `/src/tti/ttiParser.ts`
- `/src/tti/ttiMapper.ts`
- `/src/tti/ttiExporter.ts`
- `/src/tti/ttiTranslations.ts`
- `/tests/tti/*.test.ts`

Success criteria:
- AST round-trip works
- fixtures parse
- deterministic export

---

## Task 3 — Build packet compiler

Read:
- 04_PACKET_COMPILER.md

Implement:
- `/src/compile/rowCompiler.ts`
- `/src/compile/pageCompiler.ts`
- `/src/compile/packetBuilder.ts`
- `/src/compile/diagnostics.ts`
- `/tests/compile/*.test.ts`

Success criteria:
- packets compile deterministically
- snapshots pass

---

## Task 4 — Build service bundle

Read:
- 02_PAGE_MODEL_AND_SERVICE_BUNDLE.md

Implement:
- `/src/bundle/serviceBundle.ts`
- `/src/bundle/loaders.ts`
- `/src/bundle/savers.ts`
- `/tests/bundle/*.test.ts`

Success criteria:
- multiple pages/subpages serialize and load

---

## Task 5 — Build editor core

Read:
- 05_EDITOR_PRD.md
- 06_AUTHORING_UX.md

Implement:
- editor state store
- command system
- mutation APIs
- basic UI shell
- preview integration adapter

Success criteria:
- create/edit/import/export page works

---

## Task 6 — Build bitmap import

Read:
- 07_BITMAP_IMPORT_PIPELINE.md
- 08_MOSAIC_AND_QUANTIZATION.md

Implement:
- `/src/import/imageDecode.ts`
- `/src/import/imageFit.ts`
- `/src/import/quantize.ts`
- `/src/import/sextantEncode.ts`
- `/src/import/placement.ts`
- `/tests/import/*.test.ts`

Success criteria:
- bitmap imports into editable page content

---

## Task 7 — Harden and validate

Read:
- 09_TEST_PLAN.md

Implement:
- golden fixtures
- regression corpus
- snapshot harness
- CLI validation scripts

Success criteria:
- full test suite green
- corpus stable
