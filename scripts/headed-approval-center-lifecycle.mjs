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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt10-approval-center-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");

const screenshots = [];
const processes = [];

await mkdir(artifactsDir, { recursive: true });

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
    // process already exited
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

async function capture(page, screenshotsDir, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function startServices(runDir) {
  const logsDir = path.join(runDir, "logs");
  const workspaceRoot = path.join(runDir, "workspace");
  const statePath = path.join(runDir, "state.json");
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;

  await mkdir(logsDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
    },
    logPath: path.join(logsDir, "server.log"),
  });

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    },
    logPath: path.join(logsDir, "web.log"),
  });

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/inbox`);
    return response.ok;
  }, `web did not become ready at ${webURL}/inbox`);

  return { webURL, serverURL };
}

async function readText(page, testID) {
  return (await page.getByTestId(testID).textContent())?.trim() ?? "";
}

async function waitForText(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      return document.querySelector(`[data-testid="${currentTestID}"]`)?.textContent?.trim() === currentExpected;
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

async function readState(page, serverURL) {
  return page.evaluate(async (currentServerURL) => {
    const response = await fetch(`${currentServerURL}/v1/state`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`GET /v1/state failed: ${response.status}`);
    }
    return response.json();
  }, serverURL);
}

const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
await mkdir(screenshotsDir, { recursive: true });

let browser = null;
let context = null;
let page = null;

try {
  const services = await startServices(runDir);
  const chromiumExecutable = resolveChromiumExecutable();

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${services.webURL}/inbox`, { waitUntil: "load" });
  await page.getByTestId("approval-center-open-count").waitFor({ state: "visible" });
  await waitForText(page, "approval-center-open-count", "3");
  await waitForText(page, "approval-center-unread-count", "3");
  await waitForText(page, "approval-center-recent-count", "1");
  assert((await readText(page, "approval-center-blocked-count")) === "1", "initial blocked count should be 1");

  await page.getByTestId("approval-center-filter-review").click();
  await page.getByTestId("approval-center-signal-inbox-review-copy").waitFor({ state: "visible" });
  assert((await page.getByTestId("approval-center-room-link-inbox-review-copy").getAttribute("href")) === "/rooms/room-inbox", "review signal should link back to room");
  assert((await page.getByTestId("approval-center-run-link-inbox-review-copy").getAttribute("href")) === "/rooms/room-inbox/runs/run_inbox_01", "review signal should link back to run");
  assert((await page.getByTestId("approval-center-pr-link-inbox-review-copy").getAttribute("href"))?.endsWith("/pull/22"), "review signal should link back to PR");
  assert((await page.getByTestId("approval-center-unread-inbox-review-copy").textContent())?.trim() === "unread", "review signal should surface unread hotspot");
  await capture(page, screenshotsDir, "review-signal-backlinks");

  await page.getByTestId("approval-center-filter-approval").click();
  await page.getByTestId("approval-center-action-approved-inbox-approval-runtime").click();
  await waitForText(page, "approval-center-open-count", "2");
  await waitForText(page, "approval-center-recent-count", "2");
  await page.getByTestId("approval-center-recent-inbox-status-shell").waitFor({ state: "visible" });
  await page.getByText("高风险动作已批准").waitFor({ state: "visible" });
  const stateAfterApproval = await readState(page, services.serverURL);
  const runtimeRun = stateAfterApproval.runs.find((item) => item.id === "run_runtime_01");
  assert(runtimeRun?.status === "running" && runtimeRun?.approvalRequired === false, "approval decision should resume runtime run");
  await capture(page, screenshotsDir, "approval-approved");

  await page.getByTestId("approval-center-filter-blocked").click();
  await page.getByTestId("approval-center-action-resolved-inbox-blocked-memory").click();
  await waitForText(page, "approval-center-open-count", "1");
  await waitForText(page, "approval-center-recent-count", "3");
  await page.getByText("阻塞已解除").waitFor({ state: "visible" });
  const stateAfterResolve = await readState(page, services.serverURL);
  const memoryRun = stateAfterResolve.runs.find((item) => item.id === "run_memory_01");
  assert(memoryRun?.status === "running" && memoryRun?.approvalRequired === false, "blocked resolve should resume memory run");
  await capture(page, screenshotsDir, "blocked-resolved");

  await page.getByTestId("approval-center-filter-review").click();
  await page.getByTestId("approval-center-action-changes_requested-inbox-review-copy").click();
  await waitForText(page, "approval-center-open-count", "1");
  await waitForText(page, "approval-center-blocked-count", "1");
  await page.getByTestId("approval-center-filter-blocked").click();
  await page.getByRole("heading", { name: "PR #22 同步失败" }).waitFor({ state: "visible" });
  const stateAfterReview = await readState(page, services.serverURL);
  const inboxPullRequest = stateAfterReview.pullRequests.find((item) => item.id === "pr-inbox-22");
  const inboxIssue = stateAfterReview.issues.find((item) => item.key === "OPS-19");
  assert(inboxPullRequest?.status === "changes_requested", "review decision should sync pull request into changes_requested");
  assert(inboxIssue?.state === "blocked", "review decision failure should escalate blocked issue lifecycle");
  await capture(page, screenshotsDir, "review-converted-to-blocked");

  const report = [
    "# TKT-10 Approval Center Lifecycle Report",
    "",
    `- Command: \`pnpm test:headed-approval-center-lifecycle -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Approval Center Truth",
    "",
    "- `/inbox` 现在直接消费 `/v1/approval-center`，初始 `open = 3`、`unread = 3`、`recent = 1` -> PASS",
    "- review signal 直接给出 Room / Run / PR back-link，并显式标记 unread hotspot -> PASS",
    "",
    "### Human Decision Lifecycle",
    "",
    "- approval card `Approve` 后，open count `3 -> 2`，recent resolution `1 -> 2`，`run_runtime_01` 恢复 `running` -> PASS",
    "- blocked card `Resolve` 后，open count `2 -> 1`，recent resolution `2 -> 3`，`run_memory_01` 恢复 `running` -> PASS",
    "- review card `Request Changes` 后，本地无远端 GitHub 时 failure path 会显式升级成新的 blocked follow-up：`PR #22 同步失败` 可见，且 `pr-inbox-22.status = changes_requested`、`OPS-19.state = blocked` -> PASS",
    "",
    "### Scope Boundary",
    "",
    "- 这轮只收 approval center lifecycle / unread / backlinks / local decision writeback。",
    "- destructive approval guard 仍留给 `TC-027 / TKT-15`，没有被借写成已完成。",
    "",
    "### Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
