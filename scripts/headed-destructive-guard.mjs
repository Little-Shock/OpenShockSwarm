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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt30-destructive-guard-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const reportDate = path.basename(reportPath).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? new Date().toISOString().slice(0, 10);
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

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

async function startServices() {
  const workspaceRoot = path.join(artifactsDir, "workspace");
  const statePath = path.join(artifactsDir, "state.json");
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
        OPENSHOCK_CONTROL_API_BASE: serverURL,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
    }
  );

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

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

async function waitForUrlIncludes(page, fragment) {
  await waitFor(() => page.url().includes(fragment), `expected URL to include ${fragment}, got ${page.url()}`);
}

async function readState(serverURL) {
  const response = await fetch(`${serverURL}/v1/state`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /v1/state failed: ${response.status}`);
  }
  return response.json();
}

function findGuard(snapshot, guardID) {
  return snapshot.guards.find((guard) => guard.id === guardID);
}

function findRun(snapshot, runID) {
  return snapshot.runs.find((run) => run.id === runID);
}

async function expectTextIncludes(locator, expected, message) {
  await waitFor(async () => {
    const text = (await locator.textContent())?.trim() ?? "";
    return text.includes(expected);
  }, message);
}

let browser = null;

try {
  const { webURL, serverURL } = await startServices();
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const results = [];

  await page.goto(`${webURL}/inbox`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("approval-center-signal-inbox-approval-runtime"), "runtime approval card did not render");
  await waitForVisible(page.getByTestId("approval-center-signal-inbox-blocked-memory"), "memory blocked card did not render");
  assert(
    (await page.getByTestId("approval-center-guard-status-guard-runtime-destructive-git").count()) === 1,
    "desktop destructive guard status should keep a single strict-mode-safe test id"
  );
  assert(
    (await page.getByTestId("approval-center-mobile-guard-status-guard-runtime-destructive-git").count()) === 1,
    "mobile destructive guard status should keep its own distinct test id"
  );
  results.push("- Approval center desktop/mobile guard mirrors now keep distinct test ids, so the destructive-guard replay stays strict-mode stable instead of resolving duplicate status badges.");
  await expectTextIncludes(
    page.getByTestId("approval-center-guard-status-guard-runtime-destructive-git"),
    "approval required",
    "runtime destructive guard should start in approval_required"
  );
  await expectTextIncludes(
    page.getByTestId("approval-center-guard-status-guard-memory-boundary"),
    "blocked",
    "memory boundary guard should start blocked"
  );
  const runtimeGuardText = (await page.getByTestId("approval-center-guard-guard-runtime-destructive-git").textContent()) ?? "";
  const memoryGuardText = (await page.getByTestId("approval-center-guard-guard-memory-boundary").textContent()) ?? "";
  assert(
    runtimeGuardText.includes("Sandbox") && runtimeGuardText.includes("Secrets"),
    "runtime destructive guard should expose sandbox and secret boundaries"
  );
  assert(
    memoryGuardText.includes("Target") && memoryGuardText.includes("跨 scope 写入先 blocked"),
    "memory guard should expose cross-scope write boundary"
  );
  await capture(page, "inbox-guard-intake");
  results.push("- `/inbox` approval center now surfaces both destructive git and cross-scope write guards, including `Action / Sandbox / Secrets / Target` boundaries before any action executes.");

  await page.goto(`${webURL}/rooms/room-runtime?tab=context`, { waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "/rooms/room-runtime?tab=context");
  await waitForVisible(page.getByTestId("room-workbench-context-panel"), "runtime room context did not render");
  await expectTextIncludes(
    page.getByTestId("room-guard-status-guard-runtime-destructive-git"),
    "approval required",
    "room context should mirror runtime destructive guard"
  );
  await capture(page, "room-runtime-guard");
  results.push("- Runtime room context shows the same destructive guard truth as Inbox, so approval state no longer disappears behind a separate admin surface.");

  await page.goto(`${webURL}/runs/run_runtime_01`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("run-detail-status"), "runtime run detail status did not render");
  await expectTextIncludes(
    page.getByTestId("run-detail-guard-status-guard-runtime-destructive-git"),
    "approval required",
    "run detail should show destructive guard status"
  );
  await page.getByText("需要人工批准").waitFor({ state: "visible" });
  await capture(page, "run-runtime-guard");
  results.push("- Run detail also mirrors the guard card and approval state, which makes the high-risk action visible on the execution surface itself.");

  await page.goto(`${webURL}/inbox`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("approval-center-action-deferred-inbox-approval-runtime").click();
  const stateAfterDefer = await waitFor(async () => {
    const snapshot = await readState(serverURL);
    const run = findRun(snapshot, "run_runtime_01");
    return run?.status === "blocked" ? snapshot : null;
  }, "runtime approval defer did not push run into blocked state");
  const runtimeRun = findRun(stateAfterDefer, "run_runtime_01");
  const runtimeGuard = findGuard(stateAfterDefer, "guard-runtime-destructive-git");
  assert(runtimeRun?.approvalRequired === true, "runtime defer should keep approval_required gate active");
  assert(runtimeGuard?.status === "approval_required", "runtime guard should remain approval_required after defer");
  await page.goto(`${webURL}/runs/run_runtime_01`, { waitUntil: "domcontentloaded" });
  await expectTextIncludes(page.getByTestId("run-detail-status"), "阻塞", "runtime run should stay blocked after defer");
  await expectTextIncludes(
    page.getByTestId("run-detail-guard-status-guard-runtime-destructive-git"),
    "approval required",
    "runtime guard should remain approval_required after defer"
  );
  await capture(page, "runtime-deferred");
  results.push("- Adversarial probe: clicking `Defer` does not silently execute the destructive git request; the run moves to `blocked` and the guard stays `approval required`.");

  await page.goto(`${webURL}/rooms/room-memory?tab=context`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("room-workbench-context-panel"), "memory room context did not render");
  await expectTextIncludes(
    page.getByTestId("room-guard-status-guard-memory-boundary"),
    "blocked",
    "memory room should surface blocked write boundary"
  );
  await capture(page, "room-memory-guard-blocked");
  results.push("- Cross-scope write protection is also visible from the memory room before recovery, so blocked write scope is not only an Inbox-side event.");

  await page.goto(`${webURL}/inbox`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("approval-center-action-resolved-inbox-blocked-memory").click();
  const stateAfterResolve = await waitFor(async () => {
    const snapshot = await readState(serverURL);
    const run = findRun(snapshot, "run_memory_01");
    return run?.status === "running" ? snapshot : null;
  }, "memory resolve did not resume run");
  const memoryRun = findRun(stateAfterResolve, "run_memory_01");
  const memoryGuard = findGuard(stateAfterResolve, "guard-memory-boundary");
  assert(memoryRun?.approvalRequired === false, "resolved memory boundary should release approval gate");
  assert(memoryGuard?.status === "ready", "memory guard should move to ready after resolve");

  await page.goto(`${webURL}/rooms/room-memory?tab=context`, { waitUntil: "domcontentloaded" });
  await expectTextIncludes(
    page.getByTestId("room-guard-status-guard-memory-boundary"),
    "ready",
    "memory room should reflect resolved guard status"
  );
  await page.goto(`${webURL}/runs/run_memory_01`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("run-detail-status"), "memory run detail did not render");
  await expectTextIncludes(page.getByTestId("run-detail-status"), "执行中", "memory run should resume after resolve");
  await expectTextIncludes(
    page.getByTestId("run-detail-guard-status-guard-memory-boundary"),
    "ready",
    "memory run detail should show ready guard after resolve"
  );
  await page.getByText("可继续执行").waitFor({ state: "visible" });
  await capture(page, "memory-resolved");
  results.push("- Resolving the blocked write boundary propagates the same guard truth back to room and run: the guard flips to `ready`, and the run can continue without pretending the scope issue never existed.");

  const report = [
    `# ${reportDate} Destructive Guard / Secret Boundary Report`,
    "",
    `- Command: \`pnpm test:headed-destructive-guard -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Scope Boundary",
    "- This replay only closes `TKT-30 / TC-027`: destructive approval, sandbox / secret scope visibility, and cross-scope write guard truth on Inbox / Room / Run.",
    "- It does not claim a full credential vault or a stricter host sandbox than the current local runtime already provides.",
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- High-risk actions now stop in explicit guard objects instead of disappearing into implicit runtime state: Inbox shows the approval item, Room and Run mirror the same guard truth, `defer` keeps destructive work blocked, and `resolve` visibly clears the write boundary.",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
