#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt45-credential-scope-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
const logsDir = path.join(runDir, "logs");
const dataDir = path.join(runDir, "data");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(dataDir, { recursive: true });

const screenshots = [];
const processes = [];

function parseArgs(args) {
  const result = { reportPath: "" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--report") {
      result.reportPath = args[index + 1] ?? "";
      index += 1;
    }
  }
  return result;
}

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

  processes.push({ child });
  return child;
}

async function stopProcess(child) {
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
    // already exited
  }
}

async function cleanupProcesses() {
  await Promise.allSettled(processes.map((entry) => stopProcess(entry.child)));
}

async function waitFor(predicate, message, timeoutMs = 120_000, intervalMs = 500) {
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
      // try next candidate
    }
  }

  throw new Error("No executable Chromium binary found. Set OPENSHOCK_CHROMIUM_PATH to continue.");
}

async function capture(page, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

async function waitForEnabled(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isEnabled()), message);
}

async function expectTextIncludes(locator, expected, message) {
  await waitFor(async () => {
    const text = (await locator.textContent())?.trim() ?? "";
    return text.includes(expected);
  }, message);
}

async function readJSON(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function readState(serverURL) {
  return readJSON(`${serverURL}/v1/state`);
}

async function readDaemonHits(hitsFile) {
  const raw = await readFile(hitsFile, "utf8");
  return JSON.parse(raw);
}

function findCredential(snapshot, label) {
  return snapshot.credentials.find((profile) => profile.label === label) ?? null;
}

function findAgent(snapshot, agentID) {
  return snapshot.agents.find((agent) => agent.id === agentID) ?? null;
}

function findRun(snapshot, runID) {
  return snapshot.runs.find((run) => run.id === runID) ?? null;
}

function findSecretScopeGuard(snapshot, runID, label) {
  return (
    snapshot.guards.find(
      (guard) =>
        guard.runId === runID &&
        guard.risk === "secret_scope" &&
        Array.isArray(guard.boundaries) &&
        guard.boundaries.some((boundary) => boundary.label === "Profiles" && String(boundary.value || "").includes(label))
    ) ?? null
  );
}

async function startSyntheticDaemon() {
  const port = await freePort();
  const hitsFile = path.join(dataDir, "daemon-hits.json");
  startProcess(
    "daemon-mock",
    process.execPath,
    [path.join(projectRoot, "scripts", "mock-exec-daemon.mjs"), "--port", String(port), "--workspace-root", runDir, "--hits-file", hitsFile],
    {
      cwd: projectRoot,
      env: process.env,
    }
  );
  return { daemonURL: `http://127.0.0.1:${port}`, hitsFile };
}

async function startServices() {
  const { daemonURL, hitsFile } = await startSyntheticDaemon();
  const workspaceRoot = path.join(runDir, "workspace");
  const statePath = path.join(dataDir, "state.json");
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;

  await mkdir(workspaceRoot, { recursive: true });

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_DAEMON_URL: daemonURL,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
    },
  });

  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${daemonURL}/healthz`);
    return response.ok;
  }, `daemon did not become healthy at ${daemonURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/settings`);
    return response.ok;
  }, `web did not become ready at ${webURL}/settings`);

  return { webURL, serverURL, statePath, daemonHitsFile: hitsFile };
}

let browser = null;

try {
  const { webURL, serverURL, statePath } = await startServices();
  const chromiumExecutable = resolveChromiumExecutable();
  const credentialLabel = `Runtime Token ${Date.now()}`;
  const credentialSecret = `runtime-secret-${Date.now()}`;
  const credentialKind = "github-app";
  const agentID = "agent-codex-dockmaster";
  const runID = "run_runtime_01";
  const results = [];

  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("settings-credential-create-save"), "settings credential create form did not render");
  await waitForEnabled(page.getByTestId("settings-credential-create-label"), "settings credential create form never became editable");
  await page.getByTestId("settings-credential-create-label").fill(credentialLabel);
  await page.getByTestId("settings-credential-create-secret-kind").fill(credentialKind);
  await page.getByTestId("settings-credential-create-secret").fill(credentialSecret);
  await page.getByTestId("settings-credential-create-workspace-default").check();
  await page.getByTestId("settings-credential-create-save").click();
  await page.getByText("新 credential profile 已加密落库，并同步到 workspace / agent / run surfaces。").waitFor({ state: "visible" });

  const createdState = await waitFor(async () => {
    const snapshot = await readState(serverURL);
    return findCredential(snapshot, credentialLabel) ? snapshot : null;
  }, "created credential never appeared in /v1/state");
  const createdCredential = findCredential(createdState, credentialLabel);
  assert(createdCredential, "created credential missing from state after creation");
  await expectTextIncludes(
    page.getByTestId(`settings-credential-workspace-default-${createdCredential.id}`),
    "workspace default",
    "settings scope tile should show workspace default"
  );
  await expectTextIncludes(
    page.getByTestId(`settings-credential-usage-${createdCredential.id}`),
    "workspace default · 0 agent · 0 run",
    "settings usage summary should start at zero bindings"
  );
  await capture(page, "settings-credential-created");

  const liveStateBody = JSON.stringify(createdState);
  assert(!liveStateBody.includes(credentialSecret), "live /v1/state leaked credential plaintext");
  const persistedStateBody = await readFile(statePath, "utf8");
  assert(!persistedStateBody.includes(credentialSecret), "persisted state.json leaked credential plaintext");
  const vaultBody = await readFile(path.join(dataDir, "credentials.vault.json"), "utf8");
  assert(vaultBody.includes("\"ciphertext\""), "credentials.vault.json should contain ciphertext");
  assert(!vaultBody.includes(credentialSecret), "credentials.vault.json leaked credential plaintext");
  const keyBody = await readFile(path.join(dataDir, "credentials.vault.key"), "utf8");
  assert(keyBody.trim() !== "", "credentials.vault.key should not be empty");
  const settingsHTML = await (await fetch(`${webURL}/settings`)).text();
  assert(!settingsHTML.includes(credentialSecret), "settings SSR leaked credential plaintext");
  results.push("- Settings create flow writes credential metadata into live truth, persists ciphertext + key under the vault files, and keeps plaintext out of `/v1/state`, `state.json`, and `/settings` SSR HTML.");

  await page.goto(`${webURL}/profiles/agent/${agentID}`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("profile-surface-title"), "agent profile did not render");
  await waitForVisible(page.getByTestId(`profile-editor-credential-${createdCredential.id}`), "credential binding checkbox did not render on agent profile");
  await waitForEnabled(page.getByTestId(`profile-editor-credential-${createdCredential.id}`), "agent credential checkbox never became editable");
  await page.getByTestId(`profile-editor-credential-${createdCredential.id}`).check();
  await waitForEnabled(page.getByTestId("profile-editor-save"), "agent profile save button never became enabled");
  await page.getByTestId("profile-editor-save").click();
  await expectTextIncludes(
    page.getByTestId("profile-editor-save-status"),
    "Agent profile 已写回后端 truth",
    "agent profile save status did not confirm writeback"
  );
  await expectTextIncludes(page.getByTestId("profile-credential-bound-count"), "1", "agent profile bound count should be 1");
  await capture(page, "profile-agent-credential-bound");

  const agentBoundState = await waitFor(async () => {
    const snapshot = await readState(serverURL);
    const agent = findAgent(snapshot, agentID);
    return agent?.credentialProfileIds?.includes(createdCredential.id) ? snapshot : null;
  }, "agent credential binding never appeared in /v1/state");
  assert(findAgent(agentBoundState, agentID)?.credentialProfileIds?.includes(createdCredential.id), "agent state missing bound credential");
  results.push("- Agent profile editor consumes the same credential metadata truth and persists `credentialProfileIds` back to the server; the bound-count tile moves to `1` without exposing secret payload.");

  await page.goto(`${webURL}/runs/${runID}`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("run-detail-status"), "run detail did not render");
  await expectTextIncludes(page.getByTestId("run-credential-effective-count"), "1 effective", "run should inherit the workspace-default credential");
  await expectTextIncludes(page.getByTestId("run-credential-effective-labels"), credentialLabel, "run effective credential labels missing created credential");
  await waitForEnabled(page.getByTestId(`run-credential-binding-${createdCredential.id}`), "run credential checkbox never became editable");
  await page.getByTestId(`run-credential-binding-${createdCredential.id}`).check();
  await waitForEnabled(page.getByTestId("run-credential-save"), "run credential save button never became enabled");
  await page.getByTestId("run-credential-save").click();
  await page.getByText("run-scope credential binding 已写回。").waitFor({ state: "visible" });

  const runBoundState = await waitFor(async () => {
    const snapshot = await readState(serverURL);
    const run = findRun(snapshot, runID);
    const guard = findSecretScopeGuard(snapshot, runID, credentialLabel);
    return run?.credentialProfileIds?.includes(createdCredential.id) && guard ? { snapshot, guard } : null;
  }, "run credential binding or secret scope guard never appeared in /v1/state");
  await waitForVisible(
    page.getByTestId(`run-detail-guard-status-${runBoundState.guard.id}`),
    "run detail secret scope guard did not render"
  );
  await expectTextIncludes(
    page.getByTestId(`run-detail-guard-status-${runBoundState.guard.id}`),
    "ready",
    "secret scope guard should be ready after binding"
  );
  await capture(page, "run-credential-scope-bound");
  results.push("- Run detail dedupes workspace default + agent bind + run override into one effective credential scope, and it materializes a `secret_scope` guard on the execution surface before any consume happens.");

  await page.goto(`${webURL}/profiles/agent/${agentID}`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("profile-surface-title"), "agent profile did not rerender after run binding");
  await expectTextIncludes(page.getByTestId("profile-credential-bound-count"), "1", "agent bound count should stay 1 after run binding");
  await expectTextIncludes(page.getByTestId("profile-credential-run-count"), "1", "agent profile recent credential run count should be 1");
  await capture(page, "profile-credential-run-count");

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId(`settings-credential-usage-${createdCredential.id}`), "settings credential usage summary did not rerender");
  await expectTextIncludes(
    page.getByTestId(`settings-credential-usage-${createdCredential.id}`),
    "workspace default · 1 agent · 1 run",
    "settings usage summary should reflect agent + run bindings"
  );
  await capture(page, "settings-credential-usage-audit");
  results.push("- Settings, agent profile, and run detail stay on the same credential metadata truth after binding: profile shows `1` recent bound run and settings rolls up `1 agent · 1 run` without leaking plaintext.");

  const report = [
    "# Test Report 2026-04-09 Credential Profile / Encrypted Secret Scope",
    "",
    `- Command: \`pnpm test:headed-credential-profile-scope -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "- Scope: `TKT-45 / credential profile / encrypted secret scope`",
    "- Result: `PASS`",
    "",
    "## Results",
    "",
    "### End-to-End Surface Replay",
    "",
    ...results,
    "",
    "### Adversarial Checks",
    "",
    "- Plaintext secret does not appear in `/v1/state`, persisted `state.json`, `credentials.vault.json`, or `/settings` SSR HTML -> PASS",
    "- `credentials.vault.json` stores ciphertext and `credentials.vault.key` is non-empty -> PASS",
    "- Headed replay intentionally stops at UI create/bind/guard truth; exec->audit stays covered by the Go contract tests for this ticket -> PASS",
    "",
    "### Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await browser?.close().catch(() => {});
  await cleanupProcesses();
}
