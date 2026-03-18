# Product Requirements Document

## Overview

Teletext is a broadcast-based page rendering system composed of:
- Packetized data
- Stateful rendering rules
- Character + graphics modes

Pages are reconstructed from a continuous stream and rendered via a state machine.

## Core Requirements

### Layout
- 40 columns × 24 rows
- Fixed grid

### Character Model
- Each cell contains:
  - Character OR mosaic graphics
  - Foreground color
  - Background color
  - Attributes

### Rendering Modes
- Text mode (G0 charset)
- Mosaic graphics mode (G1 charset)

### Control Codes
Must support:
- Foreground colors (8)
- Background color changes
- Flash
- Conceal
- Double height
- Hold graphics
- Release graphics

### State Model
- State persists across characters
- Reset at start of each row
- Some attributes persist across rows

### Timing
- Flashing at ~1Hz
- Double height spans two rows

### Data Model
- Page = 24 packets
- Each packet = 40 bytes
