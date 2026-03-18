# Control Codes

## Foreground Colors
0x00–0x07 → Black, Red, Green, Yellow, Blue, Magenta, Cyan, White

## Flash
0x08 → Flash ON
0x09 → Flash OFF

## Graphics Mode
0x10 → Graphics ON
0x11 → Text ON

## Conceal
0x18 → Conceal display

## Background
0x1C → Black background
0x1D → New background

## Hold Graphics
0x1E → Hold ON
0x1F → Hold OFF

## Rules

- Control codes override previous state
- Order matters
- Some are spacing characters

Control characters define rendering attributes such as color, flash, and character size :contentReference[oaicite:1]{index=1}
