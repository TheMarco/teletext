# Authoring UX

## UX objective

Make exact Teletext authoring understandable without hiding how Teletext actually works.

## UX strategy

Expose two layers at all times:

1. Human-friendly editing layer
2. Exact Teletext structure layer

The user should always be able to switch between:
- visual page view
- control-code overlay
- row byte inspection
- packet inspection

## Layout

### Left panel
- page tree
- page/subpage navigator
- metadata summary

### Center
- editable grid
- optional trace image overlay
- selection handles
- current tool state

### Right panel
Tabs:
- inspector
- page settings
- compile diagnostics
- import/export
- preview

### Bottom panel
- row bytes
- token list
- normalized output row
- active control-state readout

## Tooling details

### Text tool
- keyboard input
- active G0 subset awareness
- current color/status display

### Control tool
- palette of exact control codes
- insert by click or shortcut
- hover shows semantic effect from insertion point onward

### Mosaic tool
- sextant plotting
- contiguous/separated toggle
- rectangle fill
- erase
- eyedropper

### Region tools
- move
- stamp
- duplicate
- crop clear
- lock

## Visual overlays

### Control code overlay
- code name
- code glyph placeholder
- effect scope

### Mosaic overlay
- sextant cell subdivision
- contiguous/separated boundaries

### Double-height overlay
- row pairing
- top/bottom dependency

### Trace overlay
- imported source image behind page content with adjustable opacity

## Validation UX

- inline warnings on illegal row width
- compile warnings attached to cells/rows
- packet preview warnings attached to metadata
- import warnings attached to conversion result

## Keyboard shortcuts

Must support:
- mode switch
- color insertion
- graphics/text mode insertion
- hold/release graphics
- double height
- flash/steady
- reveal preview
- compile/export

## UX anti-patterns to avoid

- hiding control codes completely
- pretending each cell is just a plain character
- making bitmap import destructive
- making preview diverge from compiled output
