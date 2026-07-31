#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
PROCESS_NAME="origin-mind-mapper"
BUNDLE_ID="com.openadam.origin"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/原点.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"

pkill -f "${PROCESS_NAME}$" >/dev/null 2>&1 || true

cd "$ROOT_DIR"
rm -rf -- "$APP_BUNDLE"
npx tauri build --bundles app
if [[ ! -x "$APP_BINARY" ]]; then
  echo "built app is missing its executable: $APP_BINARY" >&2
  exit 1
fi

open_app() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if /usr/bin/open "$APP_BUNDLE"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 2
    pgrep -f "$APP_BINARY" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
