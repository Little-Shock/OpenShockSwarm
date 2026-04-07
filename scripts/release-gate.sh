#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-repo}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"

  if [[ "$haystack" != *"$needle"* ]]; then
    echo "$label missing marker $needle" >&2
    printf '%s\n' "$haystack" >&2
    exit 1
  fi
}

run_repo_gate() {
  echo "==> repo verify"
  pnpm --dir "$ROOT_DIR" verify

  echo "==> daemon heartbeat snapshot"
  local heartbeat_output
  heartbeat_output="$(
    cd "$ROOT_DIR/apps/daemon" &&
      "$ROOT_DIR/scripts/go.sh" run ./cmd/openshock-daemon --workspace-root "$ROOT_DIR" -once 2>&1
  )"
  assert_contains "$heartbeat_output" '"machine"' "daemon heartbeat snapshot"
  assert_contains "$heartbeat_output" '"providers"' "daemon heartbeat snapshot"
  printf '%s\n' "$heartbeat_output"

  echo "==> runbook entry points"
  rg -n 'verify:release|ops:smoke|OPENSHOCK_SERVER_URL|OPENSHOCK_REQUIRE_GITHUB_READY' \
    "$ROOT_DIR/package.json" \
    "$ROOT_DIR/docs/engineering/Runbook.md"
}

run_stack_gate() {
  echo "==> live stack smoke"
  "$ROOT_DIR/scripts/ops-smoke.sh"
}

require_cmd pnpm
require_cmd rg

case "$MODE" in
  repo)
    run_repo_gate
    ;;
  stack)
    run_stack_gate
    ;;
  all)
    run_repo_gate
    run_stack_gate
    ;;
  *)
    echo "usage: $0 [repo|stack|all]" >&2
    exit 1
    ;;
esac
