#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${1:-$HOME/.local/bin}"
TARGET="$PREFIX/docx2pdf"

mkdir -p "$PREFIX"
chmod +x "$ROOT_DIR/src/cli.js"
ln -sf "$ROOT_DIR/src/cli.js" "$TARGET"

cat <<EOF
Installed docx2pdf to:
  $TARGET

If '$PREFIX' is not on your PATH, add:
  export PATH="$PREFIX:\$PATH"
EOF
