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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-topic-route-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
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
      },
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/runs/run_runtime_01`);
    return response.ok;
  }, `web did not become ready at ${webURL}/runs/run_runtime_01`);

  return { webURL };
}

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

async function waitForUrlIncludes(page, fragment) {
  await waitFor(() => page.url().includes(fragment), `expected URL to include ${fragment}, got ${page.url()}`);
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const results = [];

  await page.goto(`${webURL}/runs/run_runtime_01`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="run-detail-open-topic"]'), "run detail topic link did not render");
  await capture(page, "run-detail");
  results.push("- Run detail now exposes a direct Topic deep link instead of forcing operators back through the room tab.");

  await page.locator('[data-testid="run-detail-open-topic"]').click();
  await waitForUrlIncludes(page, "/topics/topic-runtime");
  await waitForVisible(page.locator('[data-testid="topic-route-overview"]'), "topic route overview did not render");
  await waitForVisible(page.locator('[data-testid="topic-guidance-draft"]'), "topic guidance composer did not render");
  await capture(page, "topic-route");
  results.push("- `/topics/:topicId` now resolves as a standalone route with topic, room, run and continuity truth on one page.");

  await page.locator('[data-testid="topic-guidance-draft"]').fill("TC-043 guidance: 先锁 runtime heartbeat truth，再决定是否继续收 PR surface。");
  await page.locator('[data-testid="topic-guidance-submit"]').click();
  await waitForVisible(page.locator('[data-testid="topic-guidance-success"]'), "topic guidance submit did not report success");
  await waitFor(async () => {
    const body = await page.locator('[data-testid="topic-guidance-panel"]').textContent();
    return body?.includes("TC-043 guidance:");
  }, "topic guidance ledger did not include the newly submitted operator note");
  await capture(page, "topic-guidance");
  results.push("- Topic route can write operator guidance back into the same room truth instead of bouncing through the room-only composer.");

  await page.locator('[data-testid="topic-run-control-note"]').fill("TC-043 pause from topic route");
  await page.locator('[data-testid="topic-run-control-stop"]').click();
  await waitFor(async () => {
    const text = await page.locator('[data-testid="topic-run-control-status"]').textContent();
    return text?.includes("已暂停");
  }, "topic route stop control did not pause the current run");
  await waitFor(async () => {
    const text = await page.locator('[data-testid="topic-route-status"]').textContent();
    return text?.includes("已暂停");
  }, "topic route status badge did not reflect paused state");
  await capture(page, "topic-paused");
  results.push("- Topic route keeps the same stop path as room/run truth and immediately reflects paused state on the standalone page.");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "/topics/topic-runtime");
  await waitFor(async () => {
    const text = await page.locator('[data-testid="topic-run-control-status"]').textContent();
    return text?.includes("已暂停");
  }, "paused topic state did not survive reload");
  await capture(page, "topic-reload-paused");
  results.push("- Reload stays on the standalone Topic URL and preserves paused continuity instead of falling back to room-tab-only state.");

  await page.locator('[data-testid="topic-run-control-note"]').fill("TC-043 resume from topic route");
  await page.locator('[data-testid="topic-run-control-resume"]').click();
  await waitFor(async () => {
    const text = await page.locator('[data-testid="topic-run-control-status"]').textContent();
    return text?.includes("执行中");
  }, "topic route resume control did not restore the run");
  await capture(page, "topic-resumed");
  results.push("- Topic route can resume the same run/session continuity directly, so operators no longer need to detour back to the room tab to continue execution.");

  await page.locator('[data-testid="topic-open-room-workbench"]').click();
  await waitForUrlIncludes(page, "/rooms/room-runtime?tab=topic");
  await waitForVisible(page.locator('[data-testid="room-workbench-topic-panel"]'), "room topic workbench did not open from topic route");
  await capture(page, "room-topic-backlink");
  results.push("- Topic route keeps a clean backlink into the room topic workbench, so route drill-in and room-first collaboration stay aligned.");

  const report = [
    "# 2026-04-09 Topic Route / Edit Lifecycle / Resume Deep Link Report",
    "",
    `- Command: \`pnpm test:headed-topic-route-resume-lifecycle -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- `Topic` 现在已经是可独立直达的一等 route：用户可从 Run 直接 deep-link 到 `/topics/:topicId`，在同页写回 guidance、暂停/恢复当前 continuity、reload 保持 paused truth，并再回链到 room topic workbench。",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
