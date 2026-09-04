#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
PROCESS_NAME="laniakea"
BUNDLE_ID="com.openadam.origin"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/Laniakea.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"
VERIFY_CONFIG="$ROOT_DIR/src-tauri/tauri.verify.conf.json"
VERIFY_APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/Laniakea Verify.app"
VERIFY_APP_BINARY="$VERIFY_APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"

open_app() {
  local bundle="$1"
  local attempt
  for attempt in 1 2 3 4 5; do
    if /usr/bin/open -n "$bundle"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

open_verify_app() {
  local bundle="$1"
  local attempt
  for attempt in 1 2 3 4 5; do
    # Verification must not take keyboard focus from an owner editing in the
    # live client. Launch the separately identified app hidden and in back.
    if /usr/bin/open -gj -n "$bundle"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if [[ "$MODE" == "--verify" || "$MODE" == "verify" ]]; then
  # Runtime verification must never terminate or reuse the owner's installed
  # client. The separate identifier also gives it an independent app-data
  # directory and global-preference namespace.
  pkill -f "$VERIFY_APP_BINARY" >/dev/null 2>&1 || true
  cd "$ROOT_DIR"
  rm -rf -- "$VERIFY_APP_BUNDLE"
  npx tauri build --bundles app --config "$VERIFY_CONFIG"
  if [[ ! -x "$VERIFY_APP_BINARY" ]]; then
    echo "isolated app is missing its executable: $VERIFY_APP_BINARY" >&2
    exit 1
  fi
  open_verify_app "$VERIFY_APP_BUNDLE"
  for _ in 1 2 3 4 5; do
    if pgrep -f "$VERIFY_APP_BINARY" >/dev/null; then
      echo "isolated desktop runtime verified: $VERIFY_APP_BUNDLE"
      # The check only needs proof the app stays up; leave no verify
      # instance running on the owner's desktop afterwards.
      pkill -f "$VERIFY_APP_BINARY" >/dev/null 2>&1 || true
      exit 0
    fi
    sleep 1
  done
  echo "isolated app did not stay running: $VERIFY_APP_BINARY" >&2
  exit 1
fi

pkill -f "${PROCESS_NAME}$" >/dev/null 2>&1 || true

cd "$ROOT_DIR"
rm -rf -- "$APP_BUNDLE"
npx tauri build --bundles app
if [[ ! -x "$APP_BINARY" ]]; then
  echo "built app is missing its executable: $APP_BINARY" >&2
  exit 1
fi

case "$MODE" in
  run)
    open_app "$APP_BUNDLE"
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app "$APP_BUNDLE"
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    open_app "$APP_BUNDLE"
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
