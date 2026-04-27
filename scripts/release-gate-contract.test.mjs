import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

function text(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function packageJson() {
  return JSON.parse(text("package.json"));
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function createReleaseGateHarness() {
  const root = mkdtempSync(path.join(tmpdir(), "openshock-release-gate-"));
  const scriptsDir = path.join(root, "scripts");
  const docsDir = path.join(root, "docs", "engineering");
  const appsDaemonDir = path.join(root, "apps", "daemon");
  const appsServerDir = path.join(root, "apps", "server");
  const logPath = path.join(root, "release-gate.log");
  const binDir = path.join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(appsDaemonDir, { recursive: true });
  mkdirSync(appsServerDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "harness" }, null, 2));
  writeFileSync(path.join(docsDir, "Runbook.md"), "# harness\n");
  writeFileSync(path.join(scriptsDir, "release-gate-contract.test.mjs"), "console.log('contract ok')\n");
  writeFileSync(path.join(logPath), "");
  writeFileSync(path.join(scriptsDir, "release-gate.sh"), text("scripts/release-gate.sh"));
  writeFileSync(path.join(scriptsDir, "release-browser-suite.sh"), text("scripts/release-browser-suite.sh"));

  writeExecutable(
    path.join(scriptsDir, "go.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'go.sh|%s\\n' "$*" >>"${logPath}"
if [[ "$*" == *"run ./cmd/openshock-daemon"* ]]; then
  printf '{"machine":"shock-main","providers":[{"id":"codex"}]}\n'
fi
`
  );

  writeExecutable(
    path.join(scriptsDir, "ops-smoke.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'ops-smoke|GITHUB=%s|BRANCH=%s|ACTUAL=%s\\n' "\${OPENSHOCK_REQUIRE_GITHUB_READY:-}" "\${OPENSHOCK_REQUIRE_BRANCH_HEAD_ALIGNED:-}" "\${OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY:-}" >>"${logPath}"
printf 'ops smoke passed\n'
`
  );

  writeExecutable(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm|%s|E2E=%s\\n' "$*" "\${OPENSHOCK_E2E_HEADLESS:-}" >>"${logPath}"
`
  );

  writeExecutable(
    path.join(binDir, "rg"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'rg|%s\\n' "$*" >>"${logPath}"
`
  );

  writeExecutable(
    path.join(binDir, "node"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'node|%s\\n' "$*" >>"${logPath}"
`
  );

  writeExecutable(
    path.join(binDir, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"--abbrev-ref HEAD"* ]]; then
  printf 'main\n'
else
  printf 'deadbeefcafe\n'
fi
`
  );

  return {
    root,
    scriptPath: path.join(scriptsDir, "release-gate.sh"),
    logPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("release candidate command is first-class and strict by default", () => {
  const pkg = packageJson();

  assert.equal(pkg.scripts["verify:server"], "pnpm verify:server:core && pnpm verify:server:integration");
  assert.match(pkg.scripts["verify:server:core"], /go\.sh".*test \.\/\.\.\./);
  assert.match(
    pkg.scripts["verify:server:integration"],
    /go\.sh".*test -tags=integration \.\/internal\/integration -run TestPhaseZeroLoopThroughDaemon -count=1/
  );
  assert.equal(pkg.scripts["verify:release:full"], "bash ./scripts/release-gate.sh all");
  assert.equal(pkg.scripts["verify:release:rc"], "bash ./scripts/release-gate.sh rc");
  assert.equal(pkg.scripts["verify:release:browser"], "bash ./scripts/release-gate.sh browser");
  assert.equal(pkg.scripts["release:evidence:latest"], "node ./scripts/release-evidence-latest.mjs");
  assert.equal(pkg.scripts["ops:smoke:strict"], "OPENSHOCK_REQUIRE_GITHUB_READY=1 OPENSHOCK_REQUIRE_BRANCH_HEAD_ALIGNED=1 bash ./scripts/ops-smoke.sh");
});

test("release gate script supports strict release-candidate mode", () => {
  const script = text("scripts/release-gate.sh");
  const browserSuite = text("scripts/release-browser-suite.sh");

  assert.match(script, /browser\)/);
  assert.match(script, /run_browser_case\(\)/);
  assert.match(script, /print_release_summary\(\)/);
  assert.match(script, /run_integration_gate\(\)/);
  assert.match(script, /REPORT_DATE="\$\{OPENSHOCK_RELEASE_REPORT_DATE:-\$\(date \+%F\)\}"/);
  assert.match(script, /source "\$ROOT_DIR\/scripts\/release-browser-suite\.sh"/);
  assert.match(script, /REPORT_FULL_GATE="docs\/testing\/Test-Report-\$\{REPORT_DATE\}-release-full-gate\.md"/);
  assert.match(script, /REPORT_RC_GATE=/);
  assert.match(script, /FULL_ARTIFACT_DIR="docs\/testing\/artifacts\/\$\{REPORT_DATE\}\/release-full"/);
  assert.match(script, /RC_ARTIFACT_DIR="docs\/testing\/artifacts\/\$\{REPORT_DATE\}\/release-candidate"/);
  assert.match(script, /require_env\(\)/);
  assert.match(script, /mode: %s\\n/);
  assert.match(script, /report date: %s\\n/);
  assert.match(script, /browser report: %s\\n/);
  assert.match(script, /release report: %s\\n/);
  assert.match(script, /evidence locator: %s\\n/);
  assert.match(script, /actual live parity required: %s\\n/);
  assert.match(script, /internal worker secret configured: %s\\n/);
  assert.match(script, /runtime heartbeat secret configured: %s\\n/);
  assert.match(script, /browser_report_path\(\)/);
  assert.match(script, /RELEASE_BROWSER_SUITE_IDS/);
  assert.match(script, /write_full_gate_report\(\)/);
  assert.match(script, /write_rc_gate_report\(\)/);
  assert.match(script, /pnpm --dir "\$ROOT_DIR" verify:server:integration/);
  assert.match(browserSuite, /release-gate-onboarding-studio/);
  assert.match(browserSuite, /setup-e2e/);
  assert.match(browserSuite, /fresh-workspace-critical-loop/);
  assert.match(browserSuite, /rooms-continue-entry/);
  assert.match(browserSuite, /release-gate-config-persistence-recovery/);
  assert.match(browserSuite, /test:headed-setup/);
  assert.match(browserSuite, /test:headed-onboarding-studio/);
  assert.match(browserSuite, /test:headed-critical-loop/);
  assert.match(browserSuite, /test:headed-rooms-continue-entry/);
  assert.match(browserSuite, /test:headed-config-persistence-recovery/);
  assert.match(script, /run_full_gate\(\) \{[\s\S]*run_repo_gate 2>&1 \| tee "\$ROOT_DIR\/\$FULL_REPO_LOG"[\s\S]*run_browser_gate 2>&1 \| tee "\$ROOT_DIR\/\$FULL_BROWSER_LOG"[\s\S]*run_stack_gate 2>&1 \| tee "\$ROOT_DIR\/\$FULL_STACK_LOG"[\s\S]*write_full_gate_report[\s\S]*print_release_summary "full"/);
  assert.match(script, /all\)[\s\S]*run_full_gate/);
  assert.match(script, /release-candidate\)/);
  assert.match(
    script,
    /run_rc_gate\(\) \{[\s\S]*require_env OPENSHOCK_INTERNAL_WORKER_SECRET[\s\S]*require_env OPENSHOCK_RUNTIME_HEARTBEAT_SECRET[\s\S]*run_repo_gate 2>&1 \| tee "\$ROOT_DIR\/\$RC_REPO_LOG"[\s\S]*run_integration_gate 2>&1 \| tee "\$ROOT_DIR\/\$RC_INTEGRATION_LOG"[\s\S]*run_browser_gate 2>&1 \| tee "\$ROOT_DIR\/\$RC_BROWSER_LOG"[\s\S]*OPENSHOCK_REQUIRE_GITHUB_READY=1 OPENSHOCK_REQUIRE_BRANCH_HEAD_ALIGNED=1 OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY=1 run_stack_gate 2>&1 \| tee "\$ROOT_DIR\/\$RC_STACK_LOG"[\s\S]*write_rc_gate_report/
  );
  assert.match(script, /OPENSHOCK_REQUIRE_GITHUB_READY=1 OPENSHOCK_REQUIRE_BRANCH_HEAD_ALIGNED=1 OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY=1 run_stack_gate 2>&1 \| tee "\$ROOT_DIR\/\$RC_STACK_LOG"/);
  assert.match(script, /browser\)[\s\S]*run_browser_gate[\s\S]*print_release_summary "browser"/);
  assert.match(script, /run_rc_gate\(\) \{[\s\S]*print_release_summary "release-candidate"/);
  assert.match(script, /node --test[\s\S]*scripts\/release-gate-contract\.test\.mjs[\s\S]*scripts\/release-evidence-latest\.test\.mjs/);
});

test("release gate rejects unknown modes before doing work", () => {
  const result = spawnSync("bash", [path.join(projectRoot, "scripts/release-gate.sh"), "unknown-mode"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: .*repo\|stack\|browser\|all\|rc/);
});

test("release candidate mode executes repo, integration, browser, and strict stack gates with a dated report bundle", () => {
  const harness = createReleaseGateHarness();
  try {
    const result = spawnSync("bash", [harness.scriptPath, "rc"], {
      cwd: harness.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(harness.root, "bin")}:${process.env.PATH || ""}`,
        OPENSHOCK_RELEASE_REPORT_DATE: "2026-04-24",
        OPENSHOCK_INTERNAL_WORKER_SECRET: "contract-worker-secret",
        OPENSHOCK_RUNTIME_HEARTBEAT_SECRET: "contract-runtime-secret",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /report date: 2026-04-24/);
    assert.match(result.stdout, /release report: docs\/testing\/Test-Report-2026-04-24-release-candidate-gate\.md/);
    assert.match(result.stdout, /evidence locator: pnpm release:evidence:latest rc/);
    assert.match(result.stdout, /internal worker secret configured: yes/);
    assert.match(result.stdout, /runtime heartbeat secret configured: yes/);

    const log = readFileSync(harness.logPath, "utf8");
    assert.match(log, /pnpm\|--dir .* verify\|E2E=/);
    assert.match(log, /go\.sh\|run \.\/cmd\/openshock-daemon --workspace-root .* -once/);
    assert.match(log, /rg\|-n verify:release\|ops:smoke\|ops:experience-metrics\|OPENSHOCK_SERVER_URL\|OPENSHOCK_REQUIRE_GITHUB_READY/);
    assert.match(log, /node\|--test .*scripts\/release-gate-contract\.test\.mjs .*scripts\/release-evidence-latest\.test\.mjs/);
    assert.match(log, /pnpm\|--dir .* verify:server:integration\|E2E=/);
    assert.match(log, /pnpm\|--dir .* test:headed-setup -- --report docs\/testing\/Test-Report-2026-04-24-setup-e2e\.md\|E2E=1/);
    assert.match(log, /pnpm\|--dir .* test:headed-onboarding-studio -- --report docs\/testing\/Test-Report-2026-04-24-release-gate-onboarding-studio\.md\|E2E=1/);
    assert.match(log, /pnpm\|--dir .* test:headed-critical-loop -- --report docs\/testing\/Test-Report-2026-04-24-fresh-workspace-critical-loop\.md\|E2E=1/);
    assert.match(log, /pnpm\|--dir .* test:headed-rooms-continue-entry -- --report docs\/testing\/Test-Report-2026-04-24-rooms-continue-entry\.md\|E2E=1/);
    assert.match(log, /pnpm\|--dir .* test:headed-config-persistence-recovery -- --report docs\/testing\/Test-Report-2026-04-24-release-gate-config-persistence-recovery\.md\|E2E=1/);
    assert.match(log, /ops-smoke\|GITHUB=1\|BRANCH=1\|ACTUAL=1/);

    const reportPath = path.join(harness.root, "docs", "testing", "Test-Report-2026-04-24-release-candidate-gate.md");
    const report = readFileSync(reportPath, "utf8");
    assert.match(report, /Generated At:/);
    assert.match(report, /Internal worker secret: `configured`/);
    assert.match(report, /Runtime heartbeat secret: `configured`/);
    assert.match(report, /Durable Logs/);
    assert.match(report, /artifacts\/2026-04-24\/release-candidate\/repo-gate\.log/);
  } finally {
    harness.cleanup();
  }
});

test("release full mode writes a dated report bundle", () => {
  const harness = createReleaseGateHarness();
  try {
    const result = spawnSync("bash", [harness.scriptPath, "all"], {
      cwd: harness.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(harness.root, "bin")}:${process.env.PATH || ""}`,
        OPENSHOCK_RELEASE_REPORT_DATE: "2026-04-24",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release report: docs\/testing\/Test-Report-2026-04-24-release-full-gate\.md/);
    assert.match(result.stdout, /evidence locator: pnpm release:evidence:latest full/);

    const log = readFileSync(harness.logPath, "utf8");
    assert.match(log, /pnpm\|--dir .* verify\|E2E=/);
    assert.match(log, /pnpm\|--dir .* test:headed-setup -- --report docs\/testing\/Test-Report-2026-04-24-setup-e2e\.md\|E2E=1/);
    assert.match(log, /pnpm\|--dir .* test:headed-onboarding-studio -- --report docs\/testing\/Test-Report-2026-04-24-release-gate-onboarding-studio\.md\|E2E=1/);
    assert.match(log, /ops-smoke\|GITHUB=\|BRANCH=\|ACTUAL=/);

    const reportPath = path.join(harness.root, "docs", "testing", "Test-Report-2026-04-24-release-full-gate.md");
    const report = readFileSync(reportPath, "utf8");
    assert.match(report, /Release Full Gate/);
    assert.match(report, /Durable Logs/);
    assert.match(report, /artifacts\/2026-04-24\/release-full\/repo-gate\.log/);
    assert.match(report, /artifacts\/2026-04-24\/release-full\/stack-gate\.log/);
  } finally {
    harness.cleanup();
  }
});

test("release candidate mode fails closed when internal worker secret is missing", () => {
  const harness = createReleaseGateHarness();
  try {
    const result = spawnSync("bash", [harness.scriptPath, "rc"], {
      cwd: harness.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(harness.root, "bin")}:${process.env.PATH || ""}`,
        OPENSHOCK_RELEASE_REPORT_DATE: "2026-04-24",
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required environment variable: OPENSHOCK_INTERNAL_WORKER_SECRET/);
  } finally {
    harness.cleanup();
  }
});

test("release candidate mode fails closed when runtime heartbeat secret is missing", () => {
  const harness = createReleaseGateHarness();
  try {
    const result = spawnSync("bash", [harness.scriptPath, "rc"], {
      cwd: harness.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(harness.root, "bin")}:${process.env.PATH || ""}`,
        OPENSHOCK_RELEASE_REPORT_DATE: "2026-04-24",
        OPENSHOCK_INTERNAL_WORKER_SECRET: "contract-worker-secret",
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required environment variable: OPENSHOCK_RUNTIME_HEARTBEAT_SECRET/);
  } finally {
    harness.cleanup();
  }
});

test("release docs point reviewers to the strict release-candidate path", () => {
  const releaseGateDoc = text("docs/engineering/Release-Gate.md");
  const testingDoc = text("docs/testing/README.md");
  const runbook = text("docs/engineering/Runbook.md");

  assert.match(releaseGateDoc, /pnpm verify:release:rc/);
  assert.match(releaseGateDoc, /pnpm release:evidence:latest/);
  assert.match(releaseGateDoc, /strict GitHub-ready/i);
  assert.match(releaseGateDoc, /actual-live-parity/i);
  assert.match(releaseGateDoc, /OPENSHOCK_RUNTIME_HEARTBEAT_SECRET/);
  assert.match(releaseGateDoc, /onboarding/i);
  assert.match(releaseGateDoc, /config persistence/i);
  assert.match(testingDoc, /browser/i);
  assert.match(testingDoc, /\| release candidate gate \| `pnpm verify:release:rc` \|/);
  assert.match(testingDoc, /server\/daemon integration/i);
  assert.match(testingDoc, /内含 strict GitHub-ready \+ actual-live-parity smoke/);
  assert.match(testingDoc, /Latest RC Evidence Bundle/i);
  assert.match(testingDoc, /pnpm release:evidence:latest/);
  assert.doesNotMatch(testingDoc, /ls -1t docs\/testing\/Test-Report-/);
  assert.match(testingDoc, /setup spine e2e/i);
  assert.match(testingDoc, /rooms continue entry/i);
  assert.match(testingDoc, /scripts\/release-browser-suite\.sh/);
  assert.match(runbook, /pnpm release:evidence:latest/);
});
