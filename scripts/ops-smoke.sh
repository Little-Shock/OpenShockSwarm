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

normalize_url() {
  local value="$1"
  while [[ "$value" == */ ]]; do
    value="${value%/}"
  done
  printf '%s\n' "$value"
}

assert_runtime_pairing_truth() {
  local pairing_body="$1"
  local registry_body="$2"
  local runtime_body="$3"
  local daemon_body="$4"

  PAIRING_BODY="$pairing_body" \
  REGISTRY_BODY="$registry_body" \
  RUNTIME_BODY="$runtime_body" \
  DAEMON_BODY="$daemon_body" \
  EXPECTED_DAEMON_URL="$(normalize_url "$DAEMON_URL")" \
    node <<'NODE'
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const normalize = (value) => String(value ?? "").trim().replace(/\/+$/, "")
const parse = (name) => {
  try {
    return JSON.parse(process.env[name] || "{}")
  } catch (error) {
    fail(`${name} invalid json: ${error.message}`)
  }
}

const expectedDaemonURL = normalize(process.env.EXPECTED_DAEMON_URL)
const pairing = parse("PAIRING_BODY")
const registry = parse("REGISTRY_BODY")
const runtime = parse("RUNTIME_BODY")
const daemon = parse("DAEMON_BODY")

const pairingURL = normalize(pairing.daemonUrl)
if (!pairingURL) {
  fail("Server runtime pairing missing daemonUrl")
}
if (pairingURL !== expectedDaemonURL) {
  fail(`Server runtime pairing daemonUrl mismatch: got ${pairingURL}, want ${expectedDaemonURL}`)
}

const runtimeURL = normalize(runtime.daemonUrl)
if (!runtimeURL) {
  fail("Server runtime snapshot missing daemonUrl")
}
if (runtimeURL !== expectedDaemonURL) {
  fail(`Server runtime snapshot daemonUrl mismatch: got ${runtimeURL}, want ${expectedDaemonURL}`)
}

const daemonURL = normalize(daemon.daemonUrl || expectedDaemonURL)
if (daemonURL !== expectedDaemonURL) {
  fail(`Daemon runtime daemonUrl mismatch: got ${daemonURL}, want ${expectedDaemonURL}`)
}

const pairedRuntime = String(registry.pairedRuntime || "").trim()
const runtimes = Array.isArray(registry.runtimes) ? registry.runtimes : []
if (!pairedRuntime) {
  fail("Server runtime registry missing pairedRuntime")
}
const pairedRecord = runtimes.find((item) => {
  const id = String(item?.id || "").trim()
  const machine = String(item?.machine || "").trim()
  return id === pairedRuntime || machine === pairedRuntime
})
if (!pairedRecord) {
  fail(`Server runtime registry missing paired runtime ${pairedRuntime}`)
}
const registryURL = normalize(pairedRecord.daemonUrl)
if (!registryURL) {
  fail(`Server runtime registry paired runtime ${pairedRuntime} missing daemonUrl`)
}
if (registryURL !== expectedDaemonURL) {
  fail(`Server runtime registry paired daemonUrl mismatch: got ${registryURL}, want ${expectedDaemonURL}`)
}
NODE
}

assert_usage_observability_truth() {
  local state_body="$1"

  STATE_BODY="$state_body" node <<'NODE'
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

let state
try {
  state = JSON.parse(process.env.STATE_BODY || "{}")
} catch (error) {
  fail(`STATE_BODY invalid json: ${error.message}`)
}

const workspace = state.workspace || {}
const quota = workspace.quota || {}
const usage = workspace.usage || {}
if (!(quota.maxAgents > 0) || !(quota.messageHistoryDays > 0)) {
  fail("Server state missing workspace quota observability truth")
}
if (!Number.isFinite(usage.totalTokens) || !Number.isFinite(usage.messageCount)) {
  fail("Server state missing workspace usage observability truth")
}

const runs = Array.isArray(state.runs) ? state.runs : []
if (!runs[0] || !runs[0].usage || !Number.isFinite(runs[0].usage.totalTokens)) {
  fail("Server state missing run usage truth")
}
NODE
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
require_cmd node

probe "Server healthz" "$SERVER_URL/healthz" '"service":"openshock-server"'
probe "Daemon healthz" "$DAEMON_URL/healthz" '"service":"openshock-daemon"'
echo "==> Server state"
request_json "$SERVER_URL/v1/state"
assert_status "200" "Server state"
assert_contains '"workspace"' "Server state"
state_body="$last_body"
preview_body "$state_body"
assert_usage_observability_truth "$state_body"
probe "Server repo binding" "$SERVER_URL/v1/repo/binding" '"bindingStatus"'
probe_github_connection "$SERVER_URL/v1/github/connection"

echo "==> Server runtime registry"
request_json "$SERVER_URL/v1/runtime/registry"
assert_status "200" "Server runtime registry"
assert_contains '"runtimes"' "Server runtime registry"
registry_body="$last_body"
preview_body "$registry_body"

echo "==> Server runtime pairing"
request_json "$SERVER_URL/v1/runtime/pairing"
assert_status "200" "Server runtime pairing"
assert_contains '"pairingStatus"' "Server runtime pairing"
pairing_body="$last_body"
preview_body "$pairing_body"

echo "==> Server runtime bridge"
request_json "$SERVER_URL/v1/runtime"
assert_status "200" "Server runtime bridge"
assert_contains '"daemonUrl"' "Server runtime bridge"
runtime_body="$last_body"
preview_body "$runtime_body"

echo "==> Daemon runtime"
request_json "$DAEMON_URL/v1/runtime"
assert_status "200" "Daemon runtime"
assert_contains '"providers"' "Daemon runtime"
daemon_body="$last_body"
preview_body "$daemon_body"

assert_runtime_pairing_truth "$pairing_body" "$registry_body" "$runtime_body" "$daemon_body"

echo "ops smoke passed"
