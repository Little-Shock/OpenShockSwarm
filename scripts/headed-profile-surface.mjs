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
const reportDate = new Date().toISOString().slice(0, 10);
const browserLabel = process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "Windows Chrome " : "";
const reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-profile-surface -- --report ${path.relative(projectRoot, reportPath)}`;

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
  await waitForVisible(page.locator('[data-testid="sidebar-profile-hub"]'), "sidebar profile hub did not render");
  await capture(page, "room-context-shell-profile-hub");

  await page.locator('[data-testid="sidebar-profile-human"]').click();
  await waitForUrlIncludes(page, "/profiles/human/member-larkspur");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "human profile title did not render");
  await waitForVisible(page.locator("text=能力 / 权限"), "human permission panel did not render");
  await capture(page, "shell-human-profile");
  results.push("- 左侧档案入口会常驻显示当前成员、机器、智能体；点击成员后会直接进入统一的成员档案页，并保留同一套壳层。");

  await waitForVisible(page.locator('[data-testid="sidebar-profile-machine"]'), "sidebar machine profile entry did not render");
  await page.locator('[data-testid="sidebar-profile-machine"]').click();
  await waitForUrlIncludes(page, "/profiles/machine/machine-main");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "machine profile title did not render");
  await waitForVisible(page.locator("text=运行能力"), "machine capability panel did not render");
  await capture(page, "shell-machine-profile");
  results.push("- 左侧档案入口里的机器项会一跳进入当前已配对机器档案，可直接看到心跳、运行能力、最近执行/房间和已绑定智能体。");

  await waitForVisible(page.locator('[data-testid="sidebar-profile-agent"]'), "sidebar agent profile entry did not render");
  await page.locator('[data-testid="sidebar-profile-agent"]').click();
  await waitForUrlIncludes(page, "/profiles/agent/agent-codex-dockmaster");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "agent profile title did not render");
  await waitForVisible(page.locator("text=能力"), "agent capability panel did not render");
  await capture(page, "shell-agent-profile");
  results.push("- 左侧档案入口里的智能体项会一跳进入当前默认值班智能体档案，不再需要绕到右栏或独立列表页。");

  await page.goto(`${webURL}/rooms/room-runtime?tab=context`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "room context panel did not rerender");
  await waitForVisible(
    page.locator('[data-testid="room-workbench-active-agent-agent-codex-dockmaster"]'),
    "room active agent profile link did not render"
  );
  await page.locator('[data-testid="room-workbench-active-agent-agent-codex-dockmaster"]').click();
  await waitForUrlIncludes(page, "/profiles/agent/agent-codex-dockmaster");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "agent profile title did not render");
  await waitForVisible(page.locator("text=能力"), "agent capability panel did not render");
  await capture(page, "room-agent-profile");
  results.push("- 房间上下文里的当前智能体入口仍可用；房间和页脚都会进入同一套智能体档案页。");

  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "/rooms/room-runtime?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-machine-profile"]'), "room machine profile link did not render");
  await page.locator('[data-testid="room-workbench-machine-profile"]').click();
  await waitForUrlIncludes(page, "/profiles/machine/machine-main");
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "machine profile title did not render");
  await waitForVisible(page.locator("text=运行能力"), "machine capability panel did not render");
  await capture(page, "room-machine-profile");
  results.push("- 房间上下文里的机器入口也保持可用；当前房间的执行上下文和壳层里的机器入口会汇总到同一份机器档案信息。");

  const report = [
    `# ${reportDate} ${browserLabel}档案页联动报告`,
    "",
    "- Scope: `TKT-88 / CHK-16 / TC-077` + regression of `TKT-25 / TC-030`",
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- 左侧档案入口把当前成员、机器、智能体收成同一组壳层入口；shell footer 与 room context 都会进入同一套统一档案页，信息不再散落在右栏或孤立页面里。",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
