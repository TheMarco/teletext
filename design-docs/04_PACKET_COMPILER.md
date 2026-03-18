# Packet Compiler

## Objective

Compile the canonical AST into exact Teletext packet structures suitable for the existing renderer and for future transport/export tooling.

## Compiler outputs

### Output A — compiled page rows
```ts
type CompiledDisplayRow = {
  rowNumber: number;
  bytes40: Uint8Array;
};
```

### Output B — packet model
```ts
type CompiledPacket = {
  magazine: number;
  packetNumber: number;
  designationCode?: number;
  payload: Uint8Array;
};
```

### Output C — service bundle page payload
```ts
type CompiledPagePayload = {
  pageNumber: number;
  subcode: number;
  headerPacket: CompiledPacket;
  displayPackets: CompiledPacket[];
  extensionPackets: CompiledPacket[];
};
```

## Compilation stages

### Stage 1 — row normalization
Convert row token streams into exact 40-byte row output.

### Stage 2 — metadata compilation
Map page flags, language subset, subcode, cycle timing, and fastext to packet/header structures.

### Stage 3 — packet emission
Emit header packet, display packets, optional extension packets.

## Row normalization rules

- final output row is exactly 40 bytes
- no editor metadata allowed
- control codes remain in stream
- mosaic tokens compile to exact G1 bytes
- char tokens compile to exact G0 bytes
- unknown or illegal tokens fail compile with diagnostics

## Header compilation rules

Compiler must own translation from page number, subcode, page flags, language subset, timing metadata, fastext links into exact packet/header representation.

## Extension strategy

v1 scope:
- compile direct display packets cleanly
- define hooks for packet 25..28 support
- do not block future support for enhancement packets

```ts
type CompilerFeatureFlags = {
  enablePacket25: boolean;
  enablePacket26: boolean;
  enablePacket27: boolean;
  enablePacket28: boolean;
};
```

## Diagnostics

```ts
type CompileDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  pageNumber?: number;
  subcode?: number;
  row?: number;
  col?: number;
};
```

## Required APIs

- `compileRow(row: TeletextRow): CompiledDisplayRow`
- `compileSubpage(subpage, pageNumber): CompiledPagePayload`
- `compilePage(page): CompiledPagePayload[]`
- `compileService(service): CompiledServiceBundle`
- `validateCompiledRow(bytes40)`
- `compileFastextLinks(...)`
- `compilePageFlags(...)`

## Required tests

- exact 40-byte row compilation
- control-code preservation
- mosaic byte correctness
- page flag mapping
- deterministic output
- known-fixture packet snapshots

## Important constraint

The packet compiler is not allowed to "helpfully fix" illegal authoring.
It may warn. It may fail. It may not silently rewrite semantics.
