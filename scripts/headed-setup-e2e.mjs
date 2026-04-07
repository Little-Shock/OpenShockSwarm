#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt03-headed-setup-")));
const artifactsDir = path.resolve(evidenceRoot);
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const workspaceDir = path.join(artifactsDir, "workspace");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const processes = [];
const screenshots = [];
let browser = null;
let context = null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function timestamp() {
  return new Date().toISOString();
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function runCommand(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
}

function startProcess(name, command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  const logPath = path.join(logsDir, `${name}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${timestamp()}] ${command} ${args.join(" ")}\n`);

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.on("exit", (code, signal) => {
    logStream.write(`\n[${timestamp()}] exited code=${code} signal=${signal}\n`);
    logStream.end();
  });

  processes.push({ name, child, logPath });
  return { child, logPath };
}

async function stopProcess(entry) {
  const { child } = entry;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await delay(250);
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

async function cleanup() {
  if (context) {
    try {
      await context.close();
    } catch {
      // ignore cleanup failure
    }
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore cleanup failure
    }
  }

  await Promise.allSettled(processes.map((entry) => stopProcess(entry)));
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitFor(predicate, message, timeoutMs = 60_000, intervalMs = 500) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  if (lastError instanceof Error) {
    throw new Error(`${message}\nlast error: ${lastError.message}`);
  }
  throw new Error(message);
}

async function capture(page, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
  return filePath;
}

function resolveChromiumExecutable() {
  const candidates = [
    process.env.OPENSHOCK_CHROMIUM_PATH,
    "/snap/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try the next path
    }
  }

  throw new Error("No executable Chromium binary found. Set OPENSHOCK_CHROMIUM_PATH to continue.");
}

async function prepareWorkspace() {
  await runCommand("git", ["clone", "--shared", projectRoot, workspaceDir]);
  await runCommand("git", ["-C", workspaceDir, "remote", "set-url", "origin", "https://github.com/Larkspur-Wang/OpenShock.git"]);
  await runCommand("git", ["-C", workspaceDir, "checkout", "-B", "main", "origin/main"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.name", "OpenShock Headed E2E"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.email", "openshock-headed-e2e@example.com"]);
}

async function main() {
  const webPort = await freePort();
  const serverPort = await freePort();
  const daemonPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const daemonURL = `http://127.0.0.1:${daemonPort}`;
  const statePath = path.join(workspaceDir, "data", "phase0", "state.json");
  const chromiumExecutable = resolveChromiumExecutable();
  const issueTitle = `TKT-03 headed setup e2e ${Date.now()}`;
  const issueSummary = "Replay setup -> board -> room -> PR entry with headed Chromium evidence.";

  await prepareWorkspace();

  startProcess(
    "daemon",
    path.join(projectRoot, "scripts", "go.sh"),
    [
      "run",
      "./cmd/openshock-daemon",
      "--workspace-root",
      workspaceDir,
      "--addr",
      `127.0.0.1:${daemonPort}`,
      "--control-url",
      serverURL,
    ],
    {
      cwd: path.join(projectRoot, "apps", "daemon"),
      env: {
        ...process.env,
        OPENSHOCK_DAEMON_HEARTBEAT_INTERVAL: "1s",
        OPENSHOCK_DAEMON_HEARTBEAT_TIMEOUT: "10s",
      },
    }
  );

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_DAEMON_URL: daemonURL,
      OPENSHOCK_WORKSPACE_ROOT: workspaceDir,
      OPENSHOCK_STATE_FILE: statePath,
    },
  });

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    },
  });

  await waitFor(async () => {
    const response = await fetch(`${daemonURL}/healthz`);
    return response.ok;
  }, `daemon did not become healthy at ${daemonURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`, 120_000);

  await waitFor(async () => {
    const state = await fetchJSON(`${serverURL}/v1/state`);
    return Array.isArray(state.runtimes) && state.runtimes.length > 0;
  }, "runtime heartbeats never appeared in /v1/state");

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.locator('[data-testid="setup-repo-binding"]').waitFor({ state: "visible" });
  await capture(page, "setup-shell");

  await page.getByTestId("setup-repo-bind-button").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="setup-repo-binding-status"]')?.textContent?.includes("已绑定"),
    undefined,
    { timeout: 30_000 }
  );
  const repoBindingStatus = (await page.getByTestId("setup-repo-binding-status").textContent())?.trim() ?? "";
  const repoBindingMessage = (await page.getByTestId("setup-repo-binding-message").textContent())?.trim() ?? "";

  await page.getByTestId("setup-github-refresh-button").click();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="setup-github-message"]')?.textContent || "").trim().length > 0,
    undefined,
    { timeout: 30_000 }
  );
  const githubReadinessStatus = (await page.getByTestId("setup-github-readiness-status").textContent())?.trim() ?? "";
  const githubMessage = (await page.getByTestId("setup-github-message").textContent())?.trim() ?? "";
  await capture(page, "setup-binding-and-github");

  await page.getByTestId("setup-runtime-daemon-url").fill(daemonURL);
  await page.getByTestId("setup-runtime-pair-button").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="setup-runtime-pairing-value"]')?.textContent?.includes("已配对"),
    undefined,
    { timeout: 30_000 }
  );

  let selectedRuntime = (await page.getByTestId("setup-runtime-selection-value").textContent())?.trim() ?? "";
  if (!selectedRuntime || selectedRuntime === "未选择") {
    const selectableRuntime = page.locator('[data-testid^="setup-runtime-select-"]').first();
    await selectableRuntime.waitFor({ state: "visible", timeout: 30_000 });
    if (await selectableRuntime.isEnabled()) {
      await selectableRuntime.click();
    }
    await page.waitForFunction(
      () => {
        const value = document.querySelector('[data-testid="setup-runtime-selection-value"]')?.textContent?.trim();
        return Boolean(value) && value !== "未选择";
      },
      undefined,
      { timeout: 30_000 }
    );
    selectedRuntime = (await page.getByTestId("setup-runtime-selection-value").textContent())?.trim() ?? "";
  }

  await page.waitForFunction(() => {
    const select = document.querySelector('[data-testid="setup-bridge-provider"]');
    return select instanceof HTMLSelectElement && select.options.length > 0;
  }, undefined, { timeout: 30_000 });
  const pairingValue = (await page.getByTestId("setup-runtime-pairing-value").textContent())?.trim() ?? "";

  const providerOptions = await page.locator('[data-testid="setup-bridge-provider"] option').evaluateAll((options) =>
    options.map((option) => ({
      value: option instanceof HTMLOptionElement ? option.value : "",
      label: option.textContent?.trim() ?? "",
    }))
  );
  const selectedProvider =
    providerOptions.find((option) => option.value === "codex")?.value ?? providerOptions[0]?.value ?? "";
  assert(selectedProvider, "setup bridge never exposed a selectable provider");
  await page.getByTestId("setup-bridge-provider").selectOption(selectedProvider);

  await page.getByTestId("setup-bridge-prompt").fill("Please reply with one short sentence confirming the setup bridge is online.");
  await page.getByTestId("setup-bridge-submit").click();
  const bridgeResultHandle = await page.waitForFunction(
    () => {
      const value = document.querySelector('[data-testid="setup-bridge-output"]')?.textContent?.trim();
      if (value && value !== "（没有输出）") {
        return { kind: "output", text: value };
      }

      const error = document.querySelector('[data-testid="setup-bridge-error"]')?.textContent?.trim();
      if (error) {
        return { kind: "error", text: error };
      }

      return false;
    },
    undefined,
    { timeout: 120_000 }
  );
  const bridgeResult = await bridgeResultHandle.jsonValue();
  if (!bridgeResult || typeof bridgeResult !== "object") {
    throw new Error("setup bridge completed without a readable result");
  }
  if (bridgeResult.kind === "error") {
    await capture(page, "setup-runtime-and-bridge-error");
    throw new Error(`setup bridge failed: ${bridgeResult.text}`);
  }
  const bridgeOutput = String(bridgeResult.text ?? "").trim();
  await capture(page, "setup-runtime-and-bridge");

  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await page.getByTestId("board-create-issue-title").fill(issueTitle);
  await page.getByTestId("board-create-issue-summary").fill(issueSummary);
  await page.getByTestId("board-create-issue-submit").click();
  await page.waitForURL(/\/rooms\//, { timeout: 30_000 });
  const roomURL = page.url();
  await page.getByTestId("room-pull-request-action").waitFor({ state: "visible" });
  const pullRequestActionButton = page.getByTestId("room-pull-request-action");
  const pullRequestAction = (await pullRequestActionButton.textContent())?.trim() ?? "";
  const pullRequestActionEnabled = await pullRequestActionButton.isEnabled();
  const pullRequestLabel = (await page.getByTestId("room-pull-request-label").textContent())?.trim() ?? "";
  const pullRequestStatus = (await page.getByTestId("room-pull-request-status").textContent())?.trim() ?? "";
  await capture(page, "room-pr-entry-ready");

  const currentState = await fetchJSON(`${serverURL}/v1/state`);
  const issue = currentState.issues.find((item) => item.title === issueTitle) ?? null;
  const room = issue ? currentState.rooms.find((item) => item.id === issue.roomId) ?? null : null;
  const run = room ? currentState.runs.find((item) => item.id === room.runId) ?? null : null;

  assert(issue, "expected created issue to appear in /v1/state");
  assert(room, "expected created room to appear in /v1/state");
  assert(run, "expected created run to appear in /v1/state");
  assert(pullRequestActionEnabled, "expected room pull request action to be enabled");
  assert(
    pullRequestAction === "发起 PR" && pullRequestLabel === "未创建" && pullRequestStatus === "未创建",
    `expected room pull request entry to stay ready for continuation, got action=${pullRequestAction} label=${pullRequestLabel} status=${pullRequestStatus}`
  );

  await context.tracing.stop({ path: path.join(artifactsDir, "trace.zip") });

  const report = `# TKT-03 Headed Setup E2E Report

Date: ${timestamp()}
Project Root: ${projectRoot}
Workspace Root: ${workspaceDir}
Artifacts Root: ${artifactsDir}
Chromium: ${chromiumExecutable}

## Environment

- Web: ${webURL}
- Server: ${serverURL}
- Daemon: ${daemonURL}

## Setup Checks

- Repo Binding Status: ${repoBindingStatus}
- Repo Binding Message: ${repoBindingMessage}
- GitHub Readiness Status: ${githubReadinessStatus}
- GitHub Message: ${githubMessage}
- Runtime Selection: ${selectedRuntime}
- Pairing Value: ${pairingValue}
- Bridge Output (excerpt): ${bridgeOutput.slice(0, 240)}

## Lane Checks

- Issue: ${issue.key} / ${issue.title}
- Room: ${room.id}
- Run: ${run.id}
- Pull Request Action: ${pullRequestAction} (${pullRequestActionEnabled ? "enabled" : "disabled"})
- Pull Request Label: ${pullRequestLabel}
- Pull Request Status: ${pullRequestStatus}
- Run Next Action: ${run.nextAction}
- Room URL: ${roomURL}

## Evidence

${screenshots.map((item) => `- ${item.name}: ${item.path}`).join("\n")}
- trace: ${path.join(artifactsDir, "trace.zip")}
- daemon log: ${path.join(logsDir, "daemon.log")}
- server log: ${path.join(logsDir, "server.log")}
- web log: ${path.join(logsDir, "web.log")}

## Result

- TC-001 Setup shell visibility: PASS
- TC-002 Repo binding via Setup: PASS
- TC-003 Runtime pairing and bridge prompt via Setup: PASS
- TC-026 Headed Setup to PR entry-ready journey: PASS
`;

  const metadata = {
    generatedAt: timestamp(),
    projectRoot,
    workspaceDir,
    artifactsDir,
    webURL,
    serverURL,
    daemonURL,
    chromiumExecutable,
    repoBindingStatus,
    repoBindingMessage,
    githubReadinessStatus,
    githubMessage,
    selectedRuntime,
    pairingValue,
    bridgeOutput,
    issue: {
      id: issue.id,
      key: issue.key,
      title: issue.title,
      roomId: issue.roomId,
    },
    room: {
      id: room.id,
      runId: room.runId,
    },
    run: {
      id: run.id,
      status: run.status,
      nextAction: run.nextAction,
    },
    pullRequestEntry: {
      action: pullRequestAction,
      enabled: pullRequestActionEnabled,
      label: pullRequestLabel,
      status: pullRequestStatus,
    },
    screenshots,
    logs: Object.fromEntries(processes.map((entry) => [entry.name, entry.logPath])),
  };

  await writeFile(path.join(artifactsDir, "report.md"), report);
  await writeFile(path.join(artifactsDir, "metadata.json"), JSON.stringify(metadata, null, 2));

  console.log(report);
  console.log(`Artifacts: ${artifactsDir}`);
}

try {
  await main();
} catch (error) {
  const summary = [
    "# TKT-03 Headed Setup E2E Failure",
    "",
    `Date: ${timestamp()}`,
    `Artifacts Root: ${artifactsDir}`,
    "",
    "## Error",
    "",
    error instanceof Error ? error.stack || error.message : String(error),
    "",
    "## Logs",
    ...processes.map((entry) => `- ${entry.name}: ${entry.logPath}`),
  ].join("\n");
  await writeFile(path.join(artifactsDir, "report.md"), summary);
  console.error(summary);
  process.exitCode = 1;
} finally {
  await cleanup();
}
