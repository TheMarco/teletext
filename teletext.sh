#!/bin/bash
# Interactive Teletext terminal viewer.
#
# Usage:
#   ./teletext.sh <file.t42|file.tti> [page-hex]
#
# Controls:
#   0-9, A-F    Type page number (hex)
#   Enter       Navigate to typed page
#   Backspace   Delete last digit
#   Escape      Clear input
#   Left/Right  Previous/next subpage
#   R           Toggle reveal
#   F1-F4       Fastext: red, green, yellow, cyan
#   Q / Ctrl-C  Quit

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <file.t42|file.tti> [page-hex]"
  exit 1
fi

# Check for npx
if ! command -v npx &>/dev/null; then
  echo "Error: npx not found. Install Node.js first."
  exit 1
fi

# Install dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$SCRIPT_DIR" && npm install --silent)
fi

exec npx --prefix "$SCRIPT_DIR" tsx "$SCRIPT_DIR/scripts/ansi-render.ts" "$@"
