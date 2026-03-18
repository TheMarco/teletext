# Teletext State Machine

## Initial State (per row)

{
  fgColor: WHITE,
  bgColor: BLACK,
  graphicsMode: false,
  holdGraphics: false,
  heldMosaic: null,
  doubleHeight: false,
  flash: false,
  conceal: false
}

## Processing Loop

for row in 0..23:
  state = default

  for col in 0..39:
    byte = input[row][col]

    if controlCode(byte):
      applyControl(state, byte)
    else:
      render(byte, state)

## Key Rules

### Control Codes
- Apply from position onward
- Some occupy a space (spacing)
- Some do not render

### Graphics Mode
- Switches character interpretation
- Uses mosaic character set

### Hold Graphics
- Repeats last mosaic character
- Active until release

### Double Height
- Affects current row AND next row
- Row N = top
- Row N+1 = bottom

### Conceal
- Characters not rendered unless reveal active

### Flash
- Toggle visibility based on timer

## Critical

State MUST be deterministic and match spec behavior exactly.
