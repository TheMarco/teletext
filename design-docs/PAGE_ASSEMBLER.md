# Page Assembler

## Responsibility

Reconstruct pages from packet stream

## Rules

- Pages identified by:
  - magazine (1–8)
  - page number (00–99)

- Packet mapping:
  - X/0 = header
  - X/1–X/23 = rows

## Output

type TeletextPageRaw = {
  pageNumber: number;
  subpage: number;
  rows: Uint8Array[24];
};

## Behavior

- Replace rows when new packets arrive
- Handle incomplete pages gracefully
- Maintain buffer of pages
