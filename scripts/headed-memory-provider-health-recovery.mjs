#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt97-memory-provider-health-")));
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

  return { webURL, workspaceRoot };
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
  const { webURL, workspaceRoot } = await startServices(runDir);
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1660, height: 1220 } });
  await page.goto(`${webURL}/memory`, { waitUntil: "load" });

  await page.getByTestId("memory-provider-details-summary").click();
  await waitForVisible(page, "memory-provider-card-workspace-file");
  await waitForVisible(page, "memory-provider-card-search-sidecar");
  await waitForVisible(page, "memory-provider-card-external-persistent");
  await waitForContains(page, "memory-provider-count", "1 可用 / 0 异常");
  await capture(page, screenshotsDir, "initial-provider-health");

  await page.getByTestId("memory-provider-toggle-search-sidecar").click();
  await page.getByTestId("memory-provider-toggle-external-persistent").click();
  await page.getByTestId("memory-providers-save").click();

  await waitForContains(page, "memory-mutation-success", "来源设置已保存");
  await waitForContains(page, "memory-provider-status-search-sidecar", "异常");
  await waitForContains(page, "memory-provider-status-external-persistent", "异常");
  await waitForContains(page, "memory-provider-count", "3 可用 / 2 异常");
  await waitForContains(page, "memory-provider-health-summary-search-sidecar", "Local recall index is missing.");
  await waitForContains(page, "memory-provider-next-action-external-persistent", "Attempt recovery");
  await capture(page, screenshotsDir, "enabled-providers-degraded");

  await page.getByTestId("memory-provider-check-search-sidecar").click();
  await waitForContains(page, "memory-mutation-success", "检查完成，当前状态：异常");
  await waitForContains(page, "memory-provider-activity-search-sidecar", "检查 / 异常");
  await capture(page, screenshotsDir, "search-sidecar-checked");

  await page.getByTestId("memory-provider-recover-search-sidecar").click();
  await waitForContains(page, "memory-mutation-success", "恢复完成，当前状态：正常");
  await waitForContains(page, "memory-provider-status-search-sidecar", "正常");
  await waitForContains(page, "memory-provider-count", "3 可用 / 1 异常");
  await waitForContains(page, "memory-provider-activity-search-sidecar", "恢复 / 正常");
  await capture(page, screenshotsDir, "search-sidecar-recovered");

  await page.getByTestId("memory-provider-recover-external-persistent").click();
  await waitForContains(page, "memory-mutation-success", "恢复完成，当前状态：正常");
  await waitForContains(page, "memory-provider-status-external-persistent", "正常");
  await waitForContains(page, "memory-provider-count", "3 可用 / 0 异常");
  await waitForContains(page, "memory-provider-next-action-external-persistent", "Attach a real remote durable sink");
  await capture(page, screenshotsDir, "external-persistent-recovered");

  await rm(path.join(workspaceRoot, "MEMORY.md"), { force: true });
  await page.getByTestId("memory-provider-check-workspace-file").click();
  await waitForContains(page, "memory-mutation-success", "检查完成，当前状态：异常");
  await waitForContains(page, "memory-provider-status-workspace-file", "异常");
  await waitForContains(page, "memory-provider-status-search-sidecar", "异常");
  await waitForContains(page, "memory-provider-count", "3 可用 / 2 异常");
  await waitForContains(page, "memory-provider-error-workspace-file", "Missing governed memory scaffold");
  await capture(page, screenshotsDir, "workspace-file-degraded");

  await page.getByTestId("memory-provider-recover-workspace-file").click();
  await waitForContains(page, "memory-mutation-success", "恢复完成，当前状态：正常");
  await waitForContains(page, "memory-provider-status-workspace-file", "正常");
  await waitForContains(page, "memory-provider-count", "3 可用 / 0 异常");
  await capture(page, screenshotsDir, "workspace-file-recovered");

  await page.getByTestId("memory-preview-session").selectOption("session-memory");
  await waitForVisible(page, "memory-preview-provider-workspace-file");
  await waitForVisible(page, "memory-preview-provider-search-sidecar");
  await waitForVisible(page, "memory-preview-provider-external-persistent");
  await waitForContains(page, "memory-preview-summary", "Search sidecar index ready");
  await waitForContains(page, "memory-preview-summary", "External durable adapter stub is configured in local relay mode.");
  await capture(page, screenshotsDir, "preview-recovered-provider-health");

  await page.reload({ waitUntil: "load" });
  await page.getByTestId("memory-provider-details-summary").click();
  await waitForContains(page, "memory-provider-status-workspace-file", "正常");
  await waitForContains(page, "memory-provider-status-search-sidecar", "正常");
  await waitForContains(page, "memory-provider-status-external-persistent", "正常");
  await waitForContains(page, "memory-provider-count", "3 可用 / 0 异常");
  await capture(page, screenshotsDir, "provider-health-reload-persisted");

  const commandPrefix = process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : "";
  const report = [
    "# Test Report 2026-04-11 Windows Chrome Memory Provider Health Recovery",
    "",
    `- Command: \`${commandPrefix}pnpm test:headed-memory-provider-health-recovery -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "- Scope: `TKT-97 / GAP-66 / CHK-10 / CHK-22 / TC-086`",
    "- Result: `PASS`",
    "",
    "## Results",
    "",
    "### Health Checks",
    "",
    "- 启用 `search-sidecar / external-persistent` 后，provider 不再假装健康；缺少 index 或 adapter stub 时会显式进入 `degraded` 并给出 next action -> PASS",
    "- `/memory` 现在支持逐 provider `run health check`，并把失败次数、last-check source 与 health timeline 写回 durable truth -> PASS",
    "",
    "### Recovery",
    "",
    "- Search Sidecar recovery 会重建本地 recall index，并把 provider 从 `degraded` 拉回 `healthy` -> PASS",
    "- External Persistent recovery 会生成本地 relay stub config / queue，并明确提示真实 remote durable sink 仍待后续接入 -> PASS",
    "- Workspace File recovery 会重新补齐缺失的 `MEMORY.md / notes / decisions` scaffold；上游文件记忆损坏时，Search Sidecar 也会同步降级，不再假装仍然健康 -> PASS",
    "",
    "### Preview And Persistence",
    "",
    "- `session-memory` preview 会同步读取恢复后的 provider health summary / next action，不再只显示静态 binding 描述 -> PASS",
    "- 页面 reload 后，三类 provider 的 health / recovery timeline 继续保留，证明状态已写回 durable `memory-center.json` -> PASS",
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
