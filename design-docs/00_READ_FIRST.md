# Teletext Authoring System: Read This First

## Goal

Build a complete Teletext authoring pipeline that can:

1. Represent exact Teletext pages internally
2. Import and export `.tti`
3. Compile authored pages into exact Teletext packet data
4. Provide a custom editor for page creation
5. Import bitmap graphics and convert them into Teletext mosaic graphics
6. Feed the compiled result into the existing CRT renderer

This project does NOT need to build a CRT renderer.
The renderer already exists.
This project supplies exact page data and authoring tooling.

## Core philosophy

- Internal page model is the source of truth
- `.tti` is the primary interoperability format
- Raw Teletext packets are a compile target, not the main authoring format
- Bitmap import is an authoring feature, not a rendering trick
- All behavior must be deterministic and testable
- All exactness concerns must favor spec compliance over convenience

## Build order

1. Internal page model
2. TTI parser
3. TTI exporter
4. Packet compiler
5. Service bundle format
6. Editor core
7. Bitmap import pipeline
8. Validation and compatibility tests

## Non-goals for v1

- No broadcast VBI insertion
- No OCR
- No AI-assisted page layout
- No dependence on Unicode for fidelity
- No custom raster effects inside this project

## Definition of done

The system is complete when all of the following are true:

- Pages round-trip AST -> TTI -> AST without semantic loss
- Pages compile AST -> packets deterministically
- Existing TTI pages from real tools import cleanly
- Bitmap graphics can be converted to usable mosaic art
- Author-created pages render exactly through the existing CRT renderer
- A golden corpus of known pages passes visual and byte-level tests
