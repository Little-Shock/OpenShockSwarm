#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt40-run-history-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-run-history-resume-context";
const webDistDir = path.join(projectRoot, "apps", "web", webDistDirName);

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(webDistDir, { recursive: true });

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
  const webAppRoot = path.join(projectRoot, "apps", "web");
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const webEnv = {
    ...process.env,
    OPENSHOCK_CONTROL_API_BASE: serverURL,
    NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    OPENSHOCK_NEXT_DIST_DIR: webDistDirName,
  };
  const buildLogPath = path.join(logsDir, "web-build.log");

  await mkdir(workspaceRoot, { recursive: true });
  await rm(webDistDir, { recursive: true, force: true });
  await mkdir(webDistDir, { recursive: true });

  const buildResult = spawnSync("pnpm", ["--dir", "apps/web", "build"], {
    cwd: projectRoot,
    env: webEnv,
    encoding: "utf8",
  });
  writeFileSync(
    buildLogPath,
    [
      `[${timestamp()}] pnpm --dir apps/web build`,
      buildResult.stdout ?? "",
      buildResult.stderr ?? "",
      `[${timestamp()}] exited code=${buildResult.status} signal=${buildResult.signal ?? "null"}`,
      "",
    ].join("\n"),
    "utf8"
  );
  if (buildResult.status !== 0) {
    throw new Error(`web build failed before headed replay. See ${buildLogPath}`);
  }

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
    ["--dir", "apps/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: webEnv,
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/runs`);
    return response.ok;
  }, `web did not become ready at ${webURL}/runs`);

  return { webURL, serverURL };
}

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

async function waitForUrlIncludes(page, fragment) {
  await waitFor(() => page.url().includes(fragment), `expected URL to include ${fragment}, got ${page.url()}`);
}

async function waitForText(page, testId, expected) {
  await waitFor(async () => {
    const text = await page.getByTestId(testId).textContent();
    return text?.includes(expected);
  }, `expected ${testId} to include ${expected}`);
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${url}`);
  }
  return response.json();
}

let browser;

try {
  const { webURL, serverURL } = await startServices();
  const results = [];

  const firstPage = await fetchJSON(`${serverURL}/v1/runs/history?limit=3`);
  assert(firstPage.items.length === 3, "run history first page should return exactly 3 items");
  assert(firstPage.items[0].run.id === "run_memory_01", "run history should start from latest run");
  assert(firstPage.nextCursor === "3", "run history should expose nextCursor=3 on first page");

  const detail = await fetchJSON(`${serverURL}/v1/runs/run_runtime_01/detail`);
  assert(detail.session.id === "session-runtime", "run detail should return current runtime session");
  assert(detail.history[1]?.run?.id === "run_runtime_00", "run detail should include prior runtime run");
  results.push("- `/v1/runs/history` and `/v1/runs/:id/detail` now expose paginated history plus session-backed resume context.");

  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await page.goto(`${webURL}/runs`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("run-history-load-more"), "run history load-more button did not render");
  await waitForVisible(page.getByTestId("run-history-open-run_runtime_01"), "latest runtime run card did not render");
  assert(
    (await page.getByTestId("run-history-open-run_runtime_00").count()) === 0,
    "older run should stay hidden before incremental fetch"
  );
  await capture(page, "runs-initial-page");
  results.push("- `/runs` 首次只展示最新一页历史；更早的房间执行会保持折叠，直到主动加载。");

  await page.getByTestId("run-history-load-more").click();
  await waitForVisible(page.getByTestId("run-history-open-run_runtime_00"), "older runtime run did not appear after load more");
  await capture(page, "runs-after-load-more");
  results.push("- 点击“加载更早执行”后，会按需追加更早的执行历史，而不是在首屏一次性灌入整条流水。");

  await page.getByTestId("run-history-open-run_runtime_01").click();
  await waitForUrlIncludes(page, "/runs/run_runtime_01");
  await waitForText(page, "run-detail-resume-session", "session-runtime");
  await waitForVisible(page.getByTestId("run-history-entry-run_runtime_00"), "run detail history did not show prior room run");
  await capture(page, "run-detail-current");
  results.push("- 当前执行详情会展示实时恢复会话信息和同一房间的历史记录，包括紧邻的上一条执行。");

  await page.getByTestId("run-history-reopen-run_runtime_00").click();
  await waitForUrlIncludes(page, "/runs/run_runtime_00");
  await waitForText(page, "run-detail-resume-session", "session-runtime-00");
  await waitForVisible(page.getByTestId("run-history-entry-run_runtime_01"), "reopened run did not keep room history context");
  await capture(page, "run-detail-reopened-history");
  results.push("- 重新打开较早执行后，房间级历史仍保持可见，同时恢复上下文会切换到该执行自己的会话链路。");

  await page.getByTestId("run-history-room-tab-run_runtime_00").click();
  await waitForUrlIncludes(page, "/rooms/room-runtime?tab=run");
  await waitForVisible(page.getByTestId("room-workbench-run-panel"), "room run panel did not render");
  await waitForText(page, "run-detail-resume-session", "session-runtime");
  await capture(page, "room-run-tab-current-session");
  results.push("- 从历史执行回到房间执行页签时，会重新锚定到当前房间链路，而不是停留在过时会话上。");

  const report = [
    "# 2026-04-09 执行历史与恢复上下文报告",
    "",
    `- Command: \`pnpm test:headed-run-history-resume-context -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- `/runs` 现在会按页加载历史，执行详情会同时展示恢复会话与同房间历史，而回到房间执行页签时也会重新锚定到当前活跃链路，不会误留在旧会话上。",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
