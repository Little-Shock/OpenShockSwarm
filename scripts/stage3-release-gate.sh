#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASELINE_REF="${BASELINE_REF:-0116e37}"
GATE_SERVER_PORT="${GATE_SERVER_PORT:-44315}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[gate] missing command: $1" >&2
    exit 1
  }
}

require_cmd git
require_cmd node
require_cmd curl
require_cmd rg

echo "[gate] root=$ROOT_DIR"
echo "[gate] baseline_ref=$BASELINE_REF"

if git rev-parse --verify "${BASELINE_REF}^{commit}" >/dev/null 2>&1; then
  if ! git merge-base --is-ancestor "$BASELINE_REF" HEAD; then
    echo "[gate] HEAD does not contain baseline ref $BASELINE_REF" >&2
    exit 1
  fi
else
  echo "[gate] baseline ref $BASELINE_REF is not found in local git objects" >&2
  exit 1
fi

for required_file in \
  "README.md" \
  "docs/stage3-delivery-ops-entry.md" \
  "docs/stage3-release-gate.md" \
  "apps/shell/README.md"; do
  if [[ ! -f "$required_file" ]]; then
    echo "[gate] missing required entry file: $required_file" >&2
    exit 1
  fi
done

if rg -n "/Users/atou/.slock/.*/OpenShockSwarm" \
  README.md docs/stage3-delivery-ops-entry.md docs/stage3-release-gate.md apps/shell/README.md >/dev/null 2>&1; then
  echo "[gate] stage3 entry files contain forbidden .slock OpenShockSwarm path" >&2
  exit 1
fi

echo "[gate] shell adapter syntax check"
node --check apps/shell/scripts/dev-server.mjs
node --check apps/shell/src/app.js

echo "[gate] server test suite"
(
  cd apps/server
  node --test
)

SERVER_LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[gate] starting server smoke on :$GATE_SERVER_PORT"
PORT="$GATE_SERVER_PORT" node apps/server/src/index.js >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

for _ in $(seq 1 100); do
  if curl -fsS "http://127.0.0.1:${GATE_SERVER_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! curl -fsS "http://127.0.0.1:${GATE_SERVER_PORT}/health" >/dev/null 2>&1; then
  echo "[gate] server smoke startup failed" >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi

echo "[gate] /runtime fixture seed"
curl -fsS -X POST "http://127.0.0.1:${GATE_SERVER_PORT}/runtime/fixtures/seed" >/dev/null

echo "[gate] /v1 topics smoke"
TOPICS_JSON="$(curl -fsS "http://127.0.0.1:${GATE_SERVER_PORT}/v1/topics?limit=1")"
echo "$TOPICS_JSON" | node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    process.exit(1);
  }
'

echo "[gate] /runtime smoke"
RUNTIME_SMOKE_JSON="$(curl -fsS "http://127.0.0.1:${GATE_SERVER_PORT}/runtime/smoke")"
echo "$RUNTIME_SMOKE_JSON" | node -e '
  const fs = require("node:fs");
  const payload = JSON.parse(fs.readFileSync(0, "utf8"));
  if (payload.ok !== true || payload.serverReachable !== true) {
    process.exit(1);
  }
  if (payload.sampleTopicReady !== true) {
    process.exit(1);
  }
'

HEAD_REF="$(git rev-parse --short HEAD)"
echo "STAGE3_GATE_OK head=${HEAD_REF} baseline=${BASELINE_REF} server_test=pass smoke=pass"
