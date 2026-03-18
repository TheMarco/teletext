# Editor Product Requirements

## Product goal

Create a serious Teletext editor that feels modern but authors exact Teletext data.

## Core principle

The editor is not a paint app pretending to be Teletext.
The editor must expose Teletext-native behavior clearly.

## Primary user stories

1. As an author, I can create a page from scratch on a 40x24 grid.
2. As an author, I can type text and insert exact control codes.
3. As an author, I can paint mosaic graphics.
4. As an author, I can manage subpages and timing.
5. As an author, I can import and export `.tti`.
6. As an author, I can import a bitmap and convert it into Teletext graphics.
7. As an author, I can preview my page through the existing CRT renderer.
8. As an author, I can inspect exact row bytes when debugging.

## v1 screens

### 1. Service browser
- list pages
- list subpages
- create/delete/duplicate
- reorder subpages

### 2. Page editor
- 40x24 editable grid
- toolbar for text/graphics/control actions
- inspector panel
- page metadata panel
- live preview panel

### 3. Bitmap import dialog
- choose image
- crop/scale
- choose conversion mode
- preview result
- place into page region

### 4. TTI import/export panel
- import file
- export current page
- export whole service
- view preserved raw records

## Required editing modes

### Text mode
- insert G0 chars
- preserve active code semantics
- optional overwrite/insert behavior

### Control-code mode
- insert exact Teletext control codes
- show code overlays
- show code names
- support keyboard shortcuts

### Mosaic paint mode
- paint individual sextant pixels
- choose contiguous/separated mode
- choose active color
- line/rectangle/fill tools

### Inspect mode
- show row bytes
- show normalized row
- show compile diagnostics
- show packet mapping

## Essential editor features

- undo/redo
- copy/paste within page
- duplicate row
- flood fill for mosaics
- region move/copy
- lock region
- guides
- subpage duplicate
- page-number editing
- fastext editing
- language subset selection
- reveal/conceal toggle in preview
- double-height preview

## Must-have UX constraints

- control codes must be visible on demand
- imported bitmap result must remain editable
- preview must reflect compiled data, not raw editor abstractions
- illegal states should surface clearly, not silently mutate

## Required commands

- set cell char
- set cell control
- plot mosaic point
- fill mosaic region
- clear region
- paste region
- insert row template
- apply active color sequence
- set page flags
- set subpage timing
- normalize selection to legal row width

## Deliverables

- PRD-aligned component map
- editor state store
- command system
- mutation tests
- UI shell
