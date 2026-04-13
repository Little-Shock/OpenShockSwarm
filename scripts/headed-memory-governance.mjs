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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt12-memory-governance-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");

const screenshots = [];
const processes = [];

await mkdir(artifactsDir, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });

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

async function waitForText(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.trim() === currentExpected;
    },
    { currentTestID: testID, currentExpected: expected },
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

async function waitForVisible(page, testID) {
  await page.waitForFunction(
    (currentTestID) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return Boolean(element);
    },
    testID,
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

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(`${webURL}/memory`, { waitUntil: "load" });

  await waitForContains(page, "memory-artifact-count", "条");
  await waitForVisible(page, "memory-preview-item-memory-md");
  await capture(page, screenshotsDir, "initial-memory-center");

  await page.getByTestId("memory-preview-session").selectOption("session-memory");
  await waitForContains(page, "memory-preview-summary", "session-memory");
  await waitForVisible(page, "memory-preview-item-decisions-ops-27-md");

  await page.getByTestId("memory-policy-agent").click();
  await page.getByTestId("memory-policy-max-items").selectOption("8");
  await page.getByTestId("memory-policy-save").click();
  await waitForContains(page, "memory-mutation-success", "带入设置已更新为");
  await waitForVisible(page, "memory-preview-item-openshock-agents-memory-clerk-memory-md");
  await capture(page, screenshotsDir, "policy-preview-updated");

  await page.getByTestId("memory-artifact-notes-rooms-room-memory-md").click();
  await page.getByTestId("memory-promotion-kind-skill").click();
  await page.getByTestId("memory-promotion-title").fill("Room Conflict Triage");
  await page.getByTestId("memory-promotion-rationale").fill("把房间内反复出现的冲突处理步骤提升成可复用 skill。");
  await page.getByTestId("memory-promotion-submit").click();
  await waitForText(page, "memory-promotion-room-conflict-triage-status", "待审核");
  await page.getByTestId("memory-promotion-room-conflict-triage-approve").click();
  await waitForText(page, "memory-promotion-room-conflict-triage-status", "已通过");
  await capture(page, screenshotsDir, "skill-promotion-approved");

  await page.getByTestId("memory-artifact-decisions-ops-27-md").click();
  await page.getByTestId("memory-promotion-kind-policy").click();
  await page.getByTestId("memory-promotion-title").fill("Room Over User Priority");
  await page.getByTestId("memory-promotion-rationale").fill("把阻塞时的优先级顺序提升成 policy，避免下次继续靠口头判断。");
  await page.getByTestId("memory-promotion-submit").click();
  await waitForText(page, "memory-promotion-room-over-user-priority-status", "待审核");
  await page.getByTestId("memory-promotion-room-over-user-priority-approve").click();
  await waitForText(page, "memory-promotion-room-over-user-priority-status", "已通过");
  await waitForVisible(page, "memory-preview-item-notes-skills-md");
  await waitForVisible(page, "memory-preview-item-notes-policies-md");
  await page.getByTestId("memory-artifact-notes-policies-md").click();
  await waitForContains(page, "memory-detail-content", "Room Over User Priority");
  await capture(page, screenshotsDir, "policy-ledger-approved");

  const report = [
    "# TKT-12 Memory Injection / Promotion / Governance Report",
    "",
    `- Command: \`pnpm test:headed-memory-governance -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Injection Policy + Preview",
    "",
    "- `/memory` 现在直接消费 `/v1/memory-center`，`session-memory` preview 默认会把 `MEMORY.md`、room note、decision ledger 拉进 next-run recall pack -> PASS",
    "- 打开 `Agent Memory` 并把 preview 容量扩到 `8 items` 后，同一页 preview 会立刻补进 `.openshock/agents/memory-clerk/MEMORY.md`，不再停在静态文案 -> PASS",
    "",
    "### Skill / Policy Promotion",
    "",
    "- `notes/rooms/room-memory.md` 可被发起为 `Skill` promotion，并在人工 approve 后落进 `notes/skills.md` -> PASS",
    "- `decisions/ops-27.md` 可被发起为 `Policy` promotion，并在人工 approve 后落进 `notes/policies.md`，同时重新进入 next-run preview -> PASS",
    "",
    "### Scope Boundary",
    "",
    "- 这轮只收 `TC-019` 的 injection / promotion / governance loop。",
    "- 长期记忆引擎、外部 provider 编排和更重的后台整理任务继续留在后续范围，不借写成这张票已完成。",
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
