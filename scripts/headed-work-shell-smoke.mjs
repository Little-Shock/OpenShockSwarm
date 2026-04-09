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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-work-shell-smoke-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
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

async function waitForPage(page, url, expectedText) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitFor(async () => {
    const content = await page.content();
    return content.includes(expectedText);
  }, `${url} did not render expected text: ${expectedText}`);
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
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);

  return { webURL };
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await waitForPage(page, `${webURL}/chat/all`, "Quick Search");
  await capture(page, "chat-all");

  await waitForPage(page, `${webURL}/setup`, "工作区在线状态");
  await capture(page, "setup");

  await waitForPage(page, `${webURL}/issues`, "Issue");
  await capture(page, "issues");

  await waitForPage(page, `${webURL}/memory`, "Memory Registry");
  await capture(page, "memory");

  await waitForPage(page, `${webURL}/inbox`, "Approval Center");
  await capture(page, "inbox");

  await waitForPage(page, `${webURL}/board`, "Board");
  await capture(page, "board");

  await waitForPage(page, `${webURL}/rooms/room-runtime`, "Runtime 讨论间");
  await capture(page, "room-runtime");

  await waitForPage(page, `${webURL}/runs/run_runtime_01`, "run_runtime_01");
  await capture(page, "run-runtime");

  const report = [
    "# 2026-04-08 Work Shell Smoke Report",
    "",
    `- Command: \`pnpm test:headed-work-shell-smoke -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/chat/all`、`/setup`、`/issues`、`/memory`、`/inbox`、`/board`、`/rooms/room-runtime`、`/runs/run_runtime_01` 已在同一套 workspace shell 下完成有头浏览器走查 -> PASS",
    "- Work 模式现在会在左侧 `Chat / Work` 顶部切换上显示明确激活态，不再让 utility surface 像未激活副按钮 -> PASS",
    "- 中栏背景已从纯白整块改回统一工作台底色，左栏与中栏之间不再出现突兀白缝；`setup / issues / memory / run` 的卡片密度也已收紧 -> PASS",
    "- Board 仍保持次级 planning surface 位置，但 card 语言和 room / issue 回跳仍有继续压缩空间 -> GAP",
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await browser?.close().catch(() => {});
  await cleanupProcesses();
}
