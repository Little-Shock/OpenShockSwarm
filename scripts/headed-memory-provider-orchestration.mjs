#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt96-memory-provider-")));
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

  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
      logPath: path.join(logsDir, "web.log"),
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/memory`);
    return response.ok;
  }, `web did not become ready at ${webURL}/memory`);

  return { webURL };
}

async function waitForVisible(page, testID) {
  await page.waitForFunction(
    (currentTestID) => Boolean(document.querySelector(`[data-testid="${currentTestID}"]`)),
    testID,
    { timeout: 30_000 }
  );
}

async function waitForContains(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.includes(currentExpected) ?? false;
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
await mkdir(screenshotsDir, { recursive: true });

let browser;

try {
  const { webURL } = await startServices(runDir);
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1660, height: 1220 } });
  await page.goto(`${webURL}/memory`, { waitUntil: "load" });

  await waitForVisible(page, "memory-provider-card-workspace-file");
  await waitForVisible(page, "memory-provider-toggle-search-sidecar");
  await waitForVisible(page, "memory-provider-toggle-external-persistent");
  await waitForContains(page, "memory-provider-count", "1 active / 0 degraded");
  await capture(page, screenshotsDir, "initial-provider-bindings");

  await page.getByTestId("memory-provider-toggle-search-sidecar").click();
  await page.getByTestId("memory-provider-toggle-external-persistent").click();
  await page.getByTestId("memory-providers-save").click();

  await waitForContains(page, "memory-mutation-success", "memory providers updated");
  await waitForContains(page, "memory-provider-status-search-sidecar", "healthy");
  await waitForContains(page, "memory-provider-status-external-persistent", "degraded");
  await waitForContains(page, "memory-provider-count", "3 active / 1 degraded");
  await capture(page, screenshotsDir, "provider-bindings-saved");

  await page.getByTestId("memory-preview-session").selectOption("session-memory");
  await waitForVisible(page, "memory-preview-provider-workspace-file");
  await waitForVisible(page, "memory-preview-provider-search-sidecar");
  await waitForVisible(page, "memory-preview-provider-external-persistent");
  await waitForContains(page, "memory-preview-summary", "Memory providers active for this run:");
  await waitForContains(page, "memory-preview-summary", "External durable adapter is not configured yet");
  await capture(page, screenshotsDir, "preview-provider-orchestration");

  await page.reload({ waitUntil: "load" });
  await waitForContains(page, "memory-provider-status-search-sidecar", "healthy");
  await waitForContains(page, "memory-provider-status-external-persistent", "degraded");
  await waitForContains(page, "memory-provider-count", "3 active / 1 degraded");
  await capture(page, screenshotsDir, "provider-bindings-reload-persisted");

  const report = [
    "# Test Report 2026-04-11 Windows Chrome Memory Provider Orchestration",
    "",
    `- Command: \`OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-memory-provider-orchestration -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "- Scope: `TKT-96 / CHK-10 / CHK-22 / TC-085`",
    "- Result: `PASS`",
    "",
    "## Results",
    "",
    "### Provider Binding Truth",
    "",
    "- `/memory` 现在会直接暴露 `workspace-file / search-sidecar / external-persistent` 三类 provider binding，并允许在同页保存 durable binding truth -> PASS",
    "- Search Sidecar 启用后会进入 `healthy`，External Persistent 启用后会显式进入 `degraded` 并给出 adapter 未配置的 fallback note，而不是假装健康 -> PASS",
    "",
    "### Next-Run Preview",
    "",
    "- `session-memory` preview 现在不只显示 mounted files / tools，还会显式列出 active providers、scope、retention 和 degraded provider note -> PASS",
    "- prompt summary 会同步写入 provider orchestration truth，并保留 external durable adapter 的 failure note -> PASS",
    "",
    "### Persistence",
    "",
    "- 页面 reload 后 provider enabled/status 状态保持不变，证明 binding 已写回 durable memory-center state -> PASS",
    "",
    "### Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await browser?.close().catch(() => {});
  await cleanupProcesses();
}
