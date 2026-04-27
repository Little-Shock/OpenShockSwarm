#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-repo}"
REPORT_DATE="${OPENSHOCK_RELEASE_REPORT_DATE:-$(date +%F)}"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPORT_FULL_GATE="docs/testing/Test-Report-${REPORT_DATE}-release-full-gate.md"
REPORT_RC_GATE="docs/testing/Test-Report-${REPORT_DATE}-release-candidate-gate.md"
FULL_ARTIFACT_DIR="docs/testing/artifacts/${REPORT_DATE}/release-full"
FULL_REPO_LOG="${FULL_ARTIFACT_DIR}/repo-gate.log"
FULL_BROWSER_LOG="${FULL_ARTIFACT_DIR}/browser-gate.log"
FULL_STACK_LOG="${FULL_ARTIFACT_DIR}/stack-gate.log"
RC_ARTIFACT_DIR="docs/testing/artifacts/${REPORT_DATE}/release-candidate"
RC_REPO_LOG="${RC_ARTIFACT_DIR}/repo-gate.log"
RC_INTEGRATION_LOG="${RC_ARTIFACT_DIR}/integration-gate.log"
RC_BROWSER_LOG="${RC_ARTIFACT_DIR}/browser-gate.log"
RC_STACK_LOG="${RC_ARTIFACT_DIR}/strict-stack-gate.log"

# Keep the release-critical browser suite in one manifest so the gate and docs
# do not drift when we add or remove a required product journey.
source "$ROOT_DIR/scripts/release-browser-suite.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "missing required environment variable: ${key}" >&2
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

git_ref_or_unknown() {
  local args=("$@")

  if ! command -v git >/dev/null 2>&1; then
    printf 'unknown\n'
    return
  fi

  git -C "$ROOT_DIR" "${args[@]}" 2>/dev/null || printf 'unknown\n'
}

print_release_summary() {
  local mode="$1"

  echo "==> release summary"
  printf 'mode: %s\n' "$mode"
  printf 'branch: %s\n' "$(git_ref_or_unknown rev-parse --abbrev-ref HEAD)"
  printf 'head: %s\n' "$(git_ref_or_unknown rev-parse --short=12 HEAD)"
  printf 'report date: %s\n' "$REPORT_DATE"

  case "$mode" in
    browser|release-candidate|full)
      for suite_id in "${RELEASE_BROWSER_SUITE_IDS[@]}"; do
        printf 'browser report: %s\n' "$(browser_report_path "$suite_id")"
      done
      ;;
  esac

  if [[ "$mode" == "release-candidate" || "$mode" == "full" || "$mode" == "stack" ]]; then
    printf 'server: %s\n' "${OPENSHOCK_SERVER_URL:-http://127.0.0.1:8080}"
    printf 'daemon: %s\n' "${OPENSHOCK_DAEMON_URL:-http://127.0.0.1:8090}"
  fi

  if [[ "$mode" == "full" ]]; then
    printf 'release report: %s\n' "$REPORT_FULL_GATE"
    printf 'evidence locator: %s\n' 'pnpm release:evidence:latest full'
  fi

  if [[ "$mode" == "release-candidate" ]]; then
    printf 'release report: %s\n' "$REPORT_RC_GATE"
    printf 'evidence locator: %s\n' 'pnpm release:evidence:latest rc'
    printf 'github ready required: %s\n' "${OPENSHOCK_REQUIRE_GITHUB_READY:-1}"
    printf 'actual live parity required: %s\n' "${OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY:-1}"
    printf 'internal worker secret configured: %s\n' "$(if [[ -n "${OPENSHOCK_INTERNAL_WORKER_SECRET:-}" ]]; then printf 'yes'; else printf 'no'; fi)"
    printf 'runtime heartbeat secret configured: %s\n' "$(if [[ -n "${OPENSHOCK_RUNTIME_HEARTBEAT_SECRET:-}" ]]; then printf 'yes'; else printf 'no'; fi)"
  fi
}

browser_report_path() {
  local suite_id="$1"
  printf 'docs/testing/Test-Report-%s-%s.md' "$REPORT_DATE" "$suite_id"
}

write_browser_report_links() {
  local report_path="$1"
  local index

  for index in "${!RELEASE_BROWSER_SUITE_IDS[@]}"; do
    printf -- '- [%s](./Test-Report-%s-%s.md)\n' \
      "${RELEASE_BROWSER_SUITE_REPORT_TITLES[$index]}" \
      "$REPORT_DATE" \
      "${RELEASE_BROWSER_SUITE_IDS[$index]}" >>"$report_path"
  done
}

write_full_gate_report() {
  mkdir -p "$ROOT_DIR/$(dirname "$REPORT_FULL_GATE")" "$ROOT_DIR/$FULL_ARTIFACT_DIR"

  cat >"$ROOT_DIR/$REPORT_FULL_GATE" <<EOF
# Test Report ${REPORT_DATE} Release Full Gate

- Generated At: \`${GENERATED_AT}\`
- Branch: \`$(git_ref_or_unknown rev-parse --abbrev-ref HEAD)\`
- Commit: \`$(git_ref_or_unknown rev-parse --short=12 HEAD)\`
- Target stack: \`server ${OPENSHOCK_SERVER_URL:-http://127.0.0.1:8080}\` / \`daemon ${OPENSHOCK_DAEMON_URL:-http://127.0.0.1:8090}\`
- Review command: \`OPENSHOCK_SERVER_URL=${OPENSHOCK_SERVER_URL:-http://127.0.0.1:8080} OPENSHOCK_DAEMON_URL=${OPENSHOCK_DAEMON_URL:-http://127.0.0.1:8090} pnpm verify:release:full\`

## Result

- Repo gate: PASS
- Browser suite: PASS
- Live stack smoke: PASS

## Browser Reports

EOF
  write_browser_report_links "$ROOT_DIR/$REPORT_FULL_GATE"

  cat >>"$ROOT_DIR/$REPORT_FULL_GATE" <<EOF

## Durable Logs

- [Repo Gate Log](./artifacts/${REPORT_DATE}/release-full/repo-gate.log)
- [Browser Gate Log](./artifacts/${REPORT_DATE}/release-full/browser-gate.log)
- [Live Stack Gate Log](./artifacts/${REPORT_DATE}/release-full/stack-gate.log)
EOF
}

write_rc_gate_report() {
  mkdir -p "$ROOT_DIR/$(dirname "$REPORT_RC_GATE")" "$ROOT_DIR/$RC_ARTIFACT_DIR"

  cat >"$ROOT_DIR/$REPORT_RC_GATE" <<EOF
# Test Report ${REPORT_DATE} Release Candidate Gate

- Generated At: \`${GENERATED_AT}\`
- Branch: \`$(git_ref_or_unknown rev-parse --abbrev-ref HEAD)\`
- Commit: \`$(git_ref_or_unknown rev-parse --short=12 HEAD)\`
- Target stack: \`server ${OPENSHOCK_SERVER_URL:-http://127.0.0.1:8080}\` / \`daemon ${OPENSHOCK_DAEMON_URL:-http://127.0.0.1:8090}\`
- Actual live URL: \`${OPENSHOCK_ACTUAL_LIVE_URL:-http://127.0.0.1:8080}\`
- Internal worker secret: \`$(if [[ -n "${OPENSHOCK_INTERNAL_WORKER_SECRET:-}" ]]; then printf 'configured'; else printf 'missing'; fi)\`
- Runtime heartbeat secret: \`$(if [[ -n "${OPENSHOCK_RUNTIME_HEARTBEAT_SECRET:-}" ]]; then printf 'configured'; else printf 'missing'; fi)\`
- Review command: \`OPENSHOCK_SERVER_URL=${OPENSHOCK_SERVER_URL:-http://127.0.0.1:8080} OPENSHOCK_DAEMON_URL=${OPENSHOCK_DAEMON_URL:-http://127.0.0.1:8090} OPENSHOCK_ACTUAL_LIVE_URL=${OPENSHOCK_ACTUAL_LIVE_URL:-http://127.0.0.1:8080} OPENSHOCK_INTERNAL_WORKER_SECRET=<configured> OPENSHOCK_RUNTIME_HEARTBEAT_SECRET=<configured> pnpm verify:release:rc\`

## Result

- Repo gate: PASS
- Server/daemon integration: PASS
- Browser suite: PASS
- Strict live stack smoke: PASS

## Browser Reports

EOF
  write_browser_report_links "$ROOT_DIR/$REPORT_RC_GATE"

  cat >>"$ROOT_DIR/$REPORT_RC_GATE" <<EOF

## Durable Logs

- [Repo Gate Log](./artifacts/${REPORT_DATE}/release-candidate/repo-gate.log)
- [Integration Gate Log](./artifacts/${REPORT_DATE}/release-candidate/integration-gate.log)
- [Browser Gate Log](./artifacts/${REPORT_DATE}/release-candidate/browser-gate.log)
- [Strict Stack Gate Log](./artifacts/${REPORT_DATE}/release-candidate/strict-stack-gate.log)
EOF
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
  rg -n 'verify:release|ops:smoke|ops:experience-metrics|OPENSHOCK_SERVER_URL|OPENSHOCK_REQUIRE_GITHUB_READY' \
    "$ROOT_DIR/package.json" \
    "$ROOT_DIR/docs/engineering/Runbook.md"

  echo "==> release gate contract"
  node --test \
    "$ROOT_DIR/scripts/release-gate-contract.test.mjs" \
    "$ROOT_DIR/scripts/release-evidence-latest.test.mjs"
}

run_stack_gate() {
  echo "==> live stack smoke"
  "$ROOT_DIR/scripts/ops-smoke.sh"
}

run_browser_case() {
  local label="$1"
  shift

  echo "==> browser ${label}"
  OPENSHOCK_E2E_HEADLESS="${OPENSHOCK_E2E_HEADLESS:-1}" \
    pnpm --dir "$ROOT_DIR" "$@"
}

run_browser_gate() {
  local index

  for index in "${!RELEASE_BROWSER_SUITE_IDS[@]}"; do
    run_browser_case \
      "${RELEASE_BROWSER_SUITE_LABELS[$index]}" \
      "${RELEASE_BROWSER_SUITE_COMMANDS[$index]}" \
      -- \
      --report "$(browser_report_path "${RELEASE_BROWSER_SUITE_IDS[$index]}")"
  done
}

run_integration_gate() {
  echo "==> server daemon integration loop"
  pnpm --dir "$ROOT_DIR" verify:server:integration
}

run_rc_gate() {
  require_env OPENSHOCK_INTERNAL_WORKER_SECRET
  require_env OPENSHOCK_RUNTIME_HEARTBEAT_SECRET
  mkdir -p "$ROOT_DIR/$RC_ARTIFACT_DIR"

  run_repo_gate 2>&1 | tee "$ROOT_DIR/$RC_REPO_LOG"
  run_integration_gate 2>&1 | tee "$ROOT_DIR/$RC_INTEGRATION_LOG"
  run_browser_gate 2>&1 | tee "$ROOT_DIR/$RC_BROWSER_LOG"

  echo "==> strict GitHub-ready + actual-live-parity live stack smoke"
  OPENSHOCK_REQUIRE_GITHUB_READY=1 OPENSHOCK_REQUIRE_BRANCH_HEAD_ALIGNED=1 OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY=1 run_stack_gate 2>&1 | tee "$ROOT_DIR/$RC_STACK_LOG"
  write_rc_gate_report
  print_release_summary "release-candidate"
}

run_full_gate() {
  mkdir -p "$ROOT_DIR/$FULL_ARTIFACT_DIR"

  run_repo_gate 2>&1 | tee "$ROOT_DIR/$FULL_REPO_LOG"
  run_browser_gate 2>&1 | tee "$ROOT_DIR/$FULL_BROWSER_LOG"
  run_stack_gate 2>&1 | tee "$ROOT_DIR/$FULL_STACK_LOG"

  write_full_gate_report
  print_release_summary "full"
}

require_cmd pnpm
require_cmd rg
require_cmd node

case "$MODE" in
  repo)
    run_repo_gate
    ;;
  stack)
    run_stack_gate
    ;;
  browser)
    run_browser_gate
    print_release_summary "browser"
    ;;
  all)
    run_full_gate
    ;;
  rc|github-ready|release-candidate)
    run_rc_gate
    ;;
  *)
    echo "usage: $0 [repo|stack|browser|all|rc|github-ready|release-candidate]" >&2
    exit 1
    ;;
esac
