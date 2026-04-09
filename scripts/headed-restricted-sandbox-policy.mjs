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
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt46-sandbox-policy-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
const logsDir = path.join(runDir, "logs");
const workspaceRoot = path.join(runDir, "workspace");
const statePath = path.join(runDir, "state.json");

const screenshots = [];
const processes = [];

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(workspaceRoot, { recursive: true });

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

function timestamp() {
  return new Date().toISOString();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  const { cwd = projectRoot, env = process.env, logPath } = options;
  const stream = createWriteStream(logPath, { flags: "a" });
  stream.write(`[${timestamp()}] ${command} ${args.join(" ")}\n`);

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  child.on("exit", (code, signal) => {
    stream.write(`\n[${timestamp()}] exited code=${code} signal=${signal}\n`);
    stream.end();
  });

  processes.push({ name, child });
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
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  throw new Error(lastError ? `${message}: ${lastError.message}` : message);
}

async function waitForHealth(serverURL) {
  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, "server healthz never became ready");
}

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try next path
    }
  }
  throw new Error("Chromium executable not found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.");
}

function startServer(serverPort) {
  return startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
    },
    logPath: path.join(logsDir, "server.log"),
  });
}

async function startWeb(webPort, serverURL) {
  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
      logPath: path.join(logsDir, "web.log"),
    }
  );

  const webURL = `http://127.0.0.1:${webPort}`;
  await waitFor(async () => {
    const response = await fetch(`${webURL}/runs/run_runtime_01`);
    return response.ok;
  }, `web dev server never became ready at ${webURL}/runs/run_runtime_01`);
  return webURL;
}

async function capture(page, name) {
  const shotPath = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  screenshots.push({ name, path: shotPath });
}

async function waitForVisible(locator, message) {
  await locator.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {
    throw new Error(message);
  });
}

async function waitForText(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.includes(currentExpected) ?? false;
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

async function waitForInputValue(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
        ? element.value === currentExpected
        : false;
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

async function fetchState(serverURL) {
  const response = await fetch(`${serverURL}/v1/state`);
  if (!response.ok) {
    throw new Error(`GET /v1/state failed with ${response.status}`);
  }
  return response.json();
}

let browser;

try {
  const webPort = await freePort();
  const serverPort = await freePort();
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const serverChild = startServer(serverPort);
  await waitForHealth(serverURL);
  const webURL = await startWeb(webPort, serverURL);

  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1280 } });
  const results = [];
  const sandboxProfile = "restricted";
  const allowedHosts = "github.com, api.openai.com";
  const allowedCommands = "git status";
  const allowedTools = "read_file, rg";
  const allowedNetworkTarget = "github.com";
  const blockedCommand = "git push --force";

  await page.goto(`${webURL}/runs/run_runtime_01`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("run-detail-sandbox-profile"), "run sandbox surface did not render");
  await capture(page, "run-sandbox-before-edit");

  await page.getByTestId("run-detail-sandbox-profile").selectOption(sandboxProfile);
  await page.getByTestId("run-detail-sandbox-allowed-hosts").fill(allowedHosts);
  await page.getByTestId("run-detail-sandbox-allowed-commands").fill(allowedCommands);
  await page.getByTestId("run-detail-sandbox-allowed-tools").fill(allowedTools);
  await page.getByTestId("run-detail-sandbox-save").click();
  await waitForText(page, "run-detail-sandbox-save-status", "run sandbox policy 已写回 live truth");
  await capture(page, "run-sandbox-after-save");
  results.push("- `/runs/:id` 现在可直接编辑 run-level sandbox profile 与 allowlist，不再只剩后端隐式判断。");

  await page.getByTestId("run-detail-sandbox-kind").selectOption("network");
  await page.getByTestId("run-detail-sandbox-target").fill(allowedNetworkTarget);
  await page.getByTestId("run-detail-sandbox-check").click();
  await waitForText(page, "run-detail-sandbox-check-status", "允许");
  await waitForText(page, "run-detail-sandbox-decision-status", "允许");
  await capture(page, "run-sandbox-allowed-check");
  results.push("- 命中 allowlist 的 network target 会在 run detail 上直接回 `allowed`，并同步回当前 decision truth。");

  await page.getByTestId("run-detail-sandbox-kind").selectOption("command");
  await page.getByTestId("run-detail-sandbox-target").fill(blockedCommand);
  assert(await page.getByTestId("run-detail-sandbox-override").isDisabled(), "override should stay disabled before approval_required decision");
  await page.getByTestId("run-detail-sandbox-check").click();
  await waitForText(page, "run-detail-sandbox-check-status", "需要批准");
  await waitForText(page, "run-detail-sandbox-decision-status", "需要批准");
  await waitFor(async () => !(await page.getByTestId("run-detail-sandbox-override").isDisabled()), "override button never enabled for approval_required decision");
  await capture(page, "run-sandbox-approval-required");
  results.push("- 非 allowlisted command 会 fail-closed 到 `approval_required`，而且 override 按钮只会在同 target 的 review state 之后放开。");

  await page.getByTestId("run-detail-sandbox-target").fill("git push origin main");
  assert(await page.getByTestId("run-detail-sandbox-override").isDisabled(), "override should disable again after target drift");
  await page.getByTestId("run-detail-sandbox-target").fill(blockedCommand);
  await waitFor(async () => !(await page.getByTestId("run-detail-sandbox-override").isDisabled()), "override button did not recover after restoring exact target");

  await page.getByTestId("run-detail-sandbox-override").click();
  await waitForText(page, "run-detail-sandbox-check-status", "已 override");
  await waitForText(page, "run-detail-sandbox-decision-status", "已 override");
  await capture(page, "run-sandbox-override");
  results.push("- owner 侧 `workspace.manage` 可以对同一条 `approval_required` action 执行 override retry；target 漂移时 UI 会重新收紧。");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForInputValue(page, "run-detail-sandbox-profile", sandboxProfile);
  await waitForInputValue(page, "run-detail-sandbox-allowed-hosts", allowedHosts);
  await waitForInputValue(page, "run-detail-sandbox-allowed-commands", allowedCommands);
  await waitForInputValue(page, "run-detail-sandbox-allowed-tools", allowedTools);
  await waitForText(page, "run-detail-sandbox-decision-status", "已 override");
  await capture(page, "run-sandbox-after-reload");

  const state = await fetchState(serverURL);
  const run = state.runs.find((item) => item.id === "run_runtime_01");
  assert(run, "run_runtime_01 missing from /v1/state");
  assert(run.sandbox.profile === "restricted", "run sandbox profile did not persist to state");
  assert(run.sandboxDecision.status === "overridden", "run sandbox decision did not persist to state");
  results.push("- reload 后，run policy 与 latest decision 会继续从 persisted state 读回，不会退回默认 trusted / idle。");

  const report = [
    "# Test Report 2026-04-09 Restricted Sandbox Policy",
    "",
    `- Command: \`pnpm test:headed-restricted-sandbox-policy -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Generated At: ${timestamp()}`,
    "",
    "## Result",
    "",
    ...results,
    "",
    "## Evidence",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "## Scope",
    "",
    "- Edited run-level sandbox profile / allowlists from `/runs/run_runtime_01`.",
    "- Verified allowlisted network action -> `allowed`.",
    "- Verified blocked command -> `approval_required` -> same-target override retry -> `overridden`.",
    "- Verified reload and `/v1/state` both read the same persisted run sandbox truth.",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
  await stopProcess(serverChild);
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
