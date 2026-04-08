#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo ""
echo "CHUWI 스마트 현황판을 시작합니다."
echo ""

if command -v python3 >/dev/null 2>&1; then
  pkill -f "$SCRIPT_DIR/serve_dashboard.py" >/dev/null 2>&1 || true
  python3 "$SCRIPT_DIR/serve_dashboard.py" >/tmp/chuwi_dashboard.log 2>&1 &
  sleep 2
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" --args --app="http://127.0.0.1:8426/index.html?reload=$(date +%s)"
  else
    open "http://127.0.0.1:8426/index.html?reload=$(date +%s)"
  fi
else
  open "$SCRIPT_DIR/index.html"
fi
