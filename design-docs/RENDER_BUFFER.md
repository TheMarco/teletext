# Render Buffer

type Cell = {
  glyphId: number;
  fg: Color;
  bg: Color;
  flash: boolean;
  conceal: boolean;
};

Grid:
Cell[24][40]

## Rules

- Buffer represents final resolved state
- Renderer must NOT interpret control codes
