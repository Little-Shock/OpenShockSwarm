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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-room-workbench-")));
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
    const response = await fetch(`${webURL}/rooms/room-runtime`);
    return response.ok;
  }, `web did not become ready at ${webURL}/rooms/room-runtime`);

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
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const results = [];

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="room-workbench-tab-chat"]'), "room workbench tabs did not render");
  await waitForVisible(page.locator("text=Runtime 讨论间"), "room title did not render");
  await waitForVisible(page.locator('[data-testid="room-message-list"]'), "chat message list did not render");
  await page.locator('[data-testid="room-rail-mode-thread"]').click();
  await waitForVisible(page.locator('[data-testid="room-thread-follow-current"]'), "chat thread rail action did not render");
  await capture(page, "room-chat");
  results.push("- Chat tab loads room-first shell and keeps thread rail available.");

  await page.locator('[data-testid="room-workbench-tab-topic"]').click();
  await waitForUrlIncludes(page, "?tab=topic");
  await waitForVisible(page.locator('[data-testid="room-workbench-topic-panel"]'), "topic workbench panel did not render");
  await capture(page, "room-topic");
  results.push("- Topic tab stays inside the same room URL and surfaces topic summary plus recent guidance.");

  await page.locator('[data-testid="room-workbench-tab-run"]').click();
  await waitForUrlIncludes(page, "?tab=run");
  await waitForVisible(page.locator('[data-testid="room-workbench-run-panel"]'), "run workbench panel did not render");
  await page.locator('[data-testid="room-run-control-note"]').fill("TC-031 follow thread from room workbench");
  await page.locator('[data-testid="room-run-control-follow-thread"]').click();
  await waitFor(async () => {
    const text = await page.locator('[data-testid="room-run-follow-thread-status"]').textContent();
    return text?.includes("跟随当前线程");
  }, "follow_thread did not persist on room workbench");
  await capture(page, "room-run");
  results.push("- Run tab keeps run control usable; follow_thread writes back while staying on the room workbench.");

  await page.locator('[data-testid="room-workbench-tab-pr"]').click();
  await waitForUrlIncludes(page, "?tab=pr");
  await waitForVisible(page.locator('[data-testid="room-workbench-pr-panel"]'), "PR workbench panel did not render");
  await waitForVisible(page.locator('[data-testid="room-workbench-pr-primary-action"]'), "PR primary action did not render");
  await capture(page, "room-pr");
  results.push("- PR tab keeps review / merge entry visible inside the same room without jumping to a separate detail page.");

  await page.locator('[data-testid="room-workbench-tab-context"]').click();
  await waitForUrlIncludes(page, "?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "context workbench panel did not render");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "context tab did not survive reload");
  await capture(page, "room-context");
  results.push("- Context tab survives reload via query state and keeps issue / board / inbox back-links inside the room.");

  await page.locator('[data-testid="room-workbench-open-inbox"]').first().click();
  await waitForUrlIncludes(page, "/inbox");
  await waitForVisible(page.locator("text=Approval Center"), "inbox did not open from room context link");
  await capture(page, "inbox-backlink");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "room context did not restore after inbox backlink");
  results.push("- Inbox back-link stays usable and returns the operator to the same room context state.");

  const report = [
    "# 2026-04-08 Room Workbench / Topic Context Report",
    "",
    `- Command: \`pnpm test:headed-room-workbench-topic-context -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- `/rooms/:roomId` now behaves as a query-driven room workbench: `Chat / Topic / Run / PR / Context` switch inside one room, `follow_thread` remains usable on the Run tab, PR entry stays local to the room, and the Context tab survives reload while preserving inbox back-links.",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
