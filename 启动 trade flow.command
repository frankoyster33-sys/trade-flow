#!/bin/zsh
set -e
APP_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
HS_RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node"
HS_NODE="${HS_QUOTE_NODE:-$HS_RUNTIME/bin/node}"
if [[ ! -x "$HS_NODE" ]]; then
  HS_NODE="$(command -v node || true)"
fi
if [[ -z "$HS_NODE" || ! -x "$HS_NODE" ]]; then
  print '没有找到 Node.js。请先准备使用说明中的运行环境。'
  exit 1
fi
HS_URL="http://127.0.0.1:${HS_QUOTE_PORT:-60322}"
mkdir -p "$APP_DIR/.data"
chmod 700 "$APP_DIR/.data"
if [[ ! -e "$APP_DIR/node_modules" && -d "$HS_RUNTIME/node_modules/@oai/artifact-tool" ]]; then
  ln -s "$HS_RUNTIME/node_modules" "$APP_DIR/node_modules"
fi
hs_ready() {
  local hs_response
  hs_response=$(/usr/bin/curl --silent --fail --max-time 2 "$HS_URL/api/health") || return 1
  [[ "$hs_response" == *'"application":"hengsheng-quotation"'* ]]
}
if ! hs_ready; then
  cd "$APP_DIR"
  nohup "$HS_NODE" server.mjs >"$APP_DIR/.data/server.log" 2>&1 &
  for attempt in {1..30}; do
    hs_ready && break
    sleep 0.3
  done
fi
if hs_ready; then
  if [[ "${HS_QUOTE_NO_OPEN:-0}" != "1" ]]; then
    /usr/bin/open "$HS_URL"
  fi
else
  print '启动未完成，请查看本文件夹 .data/server.log。'
  exit 1
fi
