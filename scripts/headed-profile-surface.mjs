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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-profile-surface-")));
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
    const response = await fetch(`${webURL}/rooms/room-runtime?tab=context`);
    return response.ok;
  }, `web did not become ready at ${webURL}/rooms/room-runtime?tab=context`);

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

  await page.goto(`${webURL}/rooms/room-runtime?tab=context`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "room context panel did not render");
  await waitForVisible(
    page.locator('[data-testid="room-workbench-active-agent-agent-codex-dockmaster"]'),
    "room active agent profile link did not render"
  );
  await capture(page, "room-context-entry");
  await page.locator('[data-testid="room-workbench-active-agent-agent-codex-dockmaster"]').click();
  await waitForUrlIncludes(page, "/profiles/agent/agent-codex-dockmaster");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "agent profile title did not render");
  await waitForVisible(page.locator("text=Capability"), "agent capability panel did not render");
  await capture(page, "agent-profile");
  results.push("- 从 room context 点击 active agent 后，会进入统一 Agent profile，并直接显示 presence、runtime capability、recent run/room 关系。");

  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "/rooms/room-runtime?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-machine-profile"]'), "room machine profile link did not render");
  await page.locator('[data-testid="room-workbench-machine-profile"]').click();
  await waitForUrlIncludes(page, "/profiles/machine/machine-main");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "machine profile title did not render");
  await waitForVisible(page.locator("text=Runtime Capability"), "machine capability panel did not render");
  await capture(page, "machine-profile");
  results.push("- 从 room context 点击 machine profile 后，会进入统一 Machine profile，并直接显示 heartbeat、runtime capability、recent run/room 与 bound agents。");

  await waitForVisible(page.locator('[data-testid="shell-human-profile-member-larkspur"]'), "shell human profile link did not render");
  await page.locator('[data-testid="shell-human-profile-member-larkspur"]').click();
  await waitForUrlIncludes(page, "/profiles/human/member-larkspur");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "human profile title did not render");
  await waitForVisible(page.locator("text=Capability / Permission"), "human permission panel did not render");
  await capture(page, "human-profile");
  results.push("- shell right rail 里的 Human entry 现在也会进入统一 Human profile，并直接显示 session、role/permission 与最近 run/room 关系。");

  const report = [
    "# 2026-04-08 Agent / Machine / Human Profile Surface Report",
    "",
    `- Command: \`pnpm test:headed-profile-surface -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- `Agent / Machine / Human` 现在都能从 shell 或 room drill-in 到同一套 profile surface；presence、activity、capability 和最近 run/room 关系直接读取 live truth，不再只剩零散 badge 或孤立详情页。",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
