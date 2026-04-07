#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${OPENSHOCK_SERVER_URL:-http://127.0.0.1:8080}"
DAEMON_URL="${OPENSHOCK_DAEMON_URL:-http://127.0.0.1:8090}"
CURL_MAX_TIME="${OPENSHOCK_CURL_MAX_TIME:-10}"
REQUIRE_GITHUB_READY="${OPENSHOCK_REQUIRE_GITHUB_READY:-0}"

last_status=""
last_body=""

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

preview_body() {
  local body="$1"
  body="${body//$'\n'/ }"
  printf '%s\n' "${body:0:200}"
}

request_json() {
  local url="$1"
  local body_file

  body_file="$(mktemp)"
  trap 'rm -f "$body_file"' RETURN
  last_status="$(curl -sS --max-time "$CURL_MAX_TIME" -o "$body_file" -w '%{http_code}' "$url")"
  last_body="$(cat "$body_file")"
  rm -f "$body_file"
  trap - RETURN
}

assert_status() {
  local expected="$1"
  local label="$2"

  if [[ "$last_status" != "$expected" ]]; then
    echo "$label returned status $last_status, want $expected" >&2
    preview_body "$last_body" >&2
    exit 1
  fi
}

assert_contains() {
  local needle="$1"
  local label="$2"

  if [[ "$last_body" != *"$needle"* ]]; then
    echo "$label missing marker $needle" >&2
    preview_body "$last_body" >&2
    exit 1
  fi
}

probe() {
  local label="$1"
  local url="$2"
  local needle="$3"

  echo "==> $label"
  request_json "$url"
  assert_status "200" "$label"
  assert_contains "$needle" "$label"
  preview_body "$last_body"
}

probe_github_connection() {
  local url="$1"

  echo "==> GitHub connection"
  request_json "$url"
  assert_status "200" "GitHub connection"
  assert_contains '"ready":' "GitHub connection"
  if [[ "$REQUIRE_GITHUB_READY" == "1" ]]; then
    assert_contains '"ready":true' "GitHub connection"
  fi
  preview_body "$last_body"
}

require_cmd curl

probe "Server healthz" "$SERVER_URL/healthz" '"service":"openshock-server"'
probe "Daemon healthz" "$DAEMON_URL/healthz" '"service":"openshock-daemon"'
probe "Server state" "$SERVER_URL/v1/state" '"workspace"'
probe "Server runtime registry" "$SERVER_URL/v1/runtime/registry" '"runtimes"'
probe "Server runtime pairing" "$SERVER_URL/v1/runtime/pairing" '"pairingStatus"'
probe "Server repo binding" "$SERVER_URL/v1/repo/binding" '"bindingStatus"'
probe "Daemon runtime" "$DAEMON_URL/v1/runtime" '"providers"'
probe_github_connection "$SERVER_URL/v1/github/connection"

echo "ops smoke passed"
