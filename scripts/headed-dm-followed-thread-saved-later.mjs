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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-dm-followed-thread-")));
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
    const response = await fetch(`${webURL}/chat/all`);
    return response.ok;
  }, `web did not become ready at ${webURL}/chat/all`);

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

  await page.goto(`${webURL}/chat/all`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="sidebar-dm-dm-codex-dockmaster"]'), "DM sidebar entry did not render");
  await page.locator('[data-testid="sidebar-dm-dm-codex-dockmaster"]').click();
  await waitForUrlIncludes(page, "/chat/dm-codex-dockmaster");
  await waitForVisible(page.locator("text=@Codex Dockmaster"), "DM surface did not render");
  await waitForVisible(page.locator("text=dm 1:1"), "DM badge did not render");
  await capture(page, "dm-surface");
  results.push("- Sidebar now exposes direct messages; entering a DM keeps the operator inside the same workspace shell.");

  await page.locator('[data-testid="sidebar-channel-all"]').click();
  await waitForUrlIncludes(page, "/chat/all");
  await waitForVisible(page.locator('[data-testid="message-thread-open-msg-all-1"]'), "channel thread trigger did not render");
  await page.locator('[data-testid="message-thread-open-msg-all-1"]').click();
  await waitForVisible(page.locator('[data-testid="channel-thread-follow"]'), "thread follow action did not render");
  await page.locator('[data-testid="channel-thread-follow"]').click();
  await waitFor(async () => {
    const label = await page.locator('[data-testid="channel-thread-follow"]').textContent();
    return label?.includes("Following");
  }, "follow thread state did not persist");
  await page.locator('[data-testid="channel-thread-save-later"]').click();
  await waitFor(async () => {
    const label = await page.locator('[data-testid="channel-thread-save-later"]').textContent();
    return label?.includes("Saved");
  }, "save later state did not persist");
  await waitForVisible(page.locator('[data-testid="sidebar-followed-followed-all-msg-all-1"]'), "followed sidebar entry did not appear");
  await waitForVisible(page.locator('[data-testid="sidebar-saved-saved-all-msg-all-1"]'), "saved sidebar entry did not appear");
  await capture(page, "channel-thread-actions");
  results.push("- Channel thread rail can now follow a thread and send it to saved-later without leaving chat.");

  await page.locator('[data-testid="channel-workbench-tab-followed"]').click();
  await waitForUrlIncludes(page, "tab=followed");
  await waitForVisible(page.locator('[data-testid="followed-thread-panel-card-followed-all-msg-all-1"]'), "followed thread panel did not render");
  await capture(page, "followed-panel");
  await page.locator('[data-testid="followed-thread-reopen-followed-all-msg-all-1"]').click();
  await waitForUrlIncludes(page, "/chat/all?thread=msg-all-1");
  await waitForVisible(page.locator("text=thread open"), "thread did not reopen from followed queue");
  await capture(page, "followed-reopen");
  results.push("- Followed thread queue can reopen the same thread back into chat without re-scanning the message stream.");

  await page.locator('[data-testid="channel-workbench-tab-saved"]').click();
  await waitForUrlIncludes(page, "tab=saved");
  await waitForVisible(page.locator('[data-testid="saved-later-panel-card-saved-all-msg-all-1"]'), "saved later panel did not render");
  await capture(page, "saved-panel");
  await page.locator('[data-testid="saved-later-reopen-saved-all-msg-all-1"]').click();
  await waitForUrlIncludes(page, "/chat/all?thread=msg-all-1");
  await waitForVisible(page.locator("text=thread open"), "thread did not reopen from saved queue");
  await capture(page, "saved-reopen");
  results.push("- Saved-later queue keeps revisit intent in the same shell and can reopen the exact thread when the operator is ready.");

  const report = [
    "# 2026-04-08 DM / Followed Thread / Saved Later Report",
    "",
    `- Command: \`pnpm test:headed-dm-followed-thread-saved-later -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- Workspace shell now carries DM entry, followed thread revisit, and saved-later revisit inside the same `/chat/:channelId` workbench; the operator can enter a DM, follow a channel thread, save it for later, and reopen that same thread from either queue without promoting it to a room.",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
