#!/bin/zsh
set -e
HS_APP_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
HS_PYTHON="${HS_QUOTE_PYTHON:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3}"
if [[ ! -x "$HS_PYTHON" ]]; then
  HS_PYTHON="$(command -v python3)"
fi
exec "$HS_PYTHON" "$HS_APP_DIR/scripts/install_shortcut.py"
