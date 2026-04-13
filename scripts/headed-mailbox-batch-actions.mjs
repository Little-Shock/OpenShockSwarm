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
const parsedArgs = parseArgs(process.argv.slice(2));
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt91-mailbox-batch-")));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-mailbox-batch-actions";
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

async function fetchJSON(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json();
}

async function createHandoff(serverURL, input) {
  return fetchJSON(`${serverURL}/v1/mailbox`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function waitForMailbox(serverURL, title) {
  return waitFor(async () => {
    const state = await readState(serverURL);
    return state.mailbox.find((item) => item.title === title) ?? false;
  }, `mailbox handoff ${title} did not appear`);
}

async function waitForMailboxStatus(page, handoffId, expected) {
  const expectedLabel =
    expected === "requested"
      ? "待接手"
      : expected === "acknowledged"
        ? "处理中"
        : expected === "blocked"
          ? "阻塞"
          : expected === "completed"
            ? "已完成"
            : expected;
  await page.waitForFunction(
    ({ currentHandoffId, currentExpectedLabel }) => {
      return (
        document.querySelector(`[data-testid="mailbox-status-${currentHandoffId}"]`)?.textContent?.trim() ===
        currentExpectedLabel
      );
    },
    { currentHandoffId: handoffId, currentExpectedLabel: expectedLabel },
    { timeout: 30_000 }
  );
}

async function readText(page, testId) {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
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

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: webEnv,
  });

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/mailbox`);
    return response.ok;
  }, `web did not become ready at ${webURL}/mailbox`);

  return { webURL, serverURL };
}

let browser = null;
let context = null;
let page = null;

try {
  const { webURL, serverURL } = await startServices();
  resolveChromiumExecutable();

  const handoffDefinitions = [
    {
      roomId: "room-runtime",
      fromAgentId: "agent-codex-dockmaster",
      toAgentId: "agent-claude-review-runner",
      title: `Batch reviewer lane A ${Date.now()}`,
      summary: "第一条 reviewer lane，用于验证 mailbox batch queue。",
    },
    {
      roomId: "room-runtime",
      fromAgentId: "agent-codex-dockmaster",
      toAgentId: "agent-claude-review-runner",
      title: `Batch reviewer lane B ${Date.now() + 1}`,
      summary: "第二条 reviewer lane，用于验证 mailbox batch queue。",
    },
  ];
  const batchComment = "Batch formal comment: reviewer queue 已同步，继续按同一条 exact context 收口。";
  const batchComplete = "Batch closeout: reviewer lane 已收口，可以回到 PR / room 继续推进。";

  const created = [];
  for (const definition of handoffDefinitions) {
    const payload = await createHandoff(serverURL, definition);
    created.push(payload.handoff);
  }

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });

  for (const handoff of created) {
    await waitForMailbox(serverURL, handoff.title);
    await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
    await waitForMailboxStatus(page, handoff.id, "requested");
  }
  const stateAfterRequested = await readState(serverURL);
  assert(
    stateAfterRequested.mailbox.filter((item) => item.status !== "completed").length === 2,
    "mailbox state should show two open handoffs before batch actions"
  );
  await capture(page, "mailbox-batch-requested");

  await page.getByTestId("mailbox-batch-select-open").click();
  await waitFor(async () => (await readText(page, "mailbox-batch-selected-count")) === "已选 2", "batch selection count did not reach 2");
  for (const handoff of created) {
    await page.getByTestId(`mailbox-batch-selected-${handoff.id}`).waitFor({ state: "visible" });
  }
  await capture(page, "mailbox-batch-selected");

  await page.getByTestId("mailbox-batch-action-acknowledged").click();
  for (const handoff of created) {
    await waitForMailboxStatus(page, handoff.id, "acknowledged");
  }
  const stateAfterAck = await readState(serverURL);
  for (const handoff of created) {
    const updated = stateAfterAck.mailbox.find((item) => item.id === handoff.id);
    assert(updated?.status === "acknowledged", `handoff ${handoff.id} should acknowledge through batch queue`);
  }
  await capture(page, "mailbox-batch-acknowledged");

  await page.getByTestId("mailbox-batch-note").fill(batchComment);
  await page.getByTestId("mailbox-batch-comment-actor-mode").selectOption("from");
  await page.getByTestId("mailbox-batch-action-comment").click();
  await waitFor(async () => {
    const state = await readState(serverURL);
    return created.every((handoff) => {
      const updated = state.mailbox.find((item) => item.id === handoff.id);
      const lastMessage = updated?.messages?.at(-1);
      return (
        updated?.status === "acknowledged" &&
        lastMessage?.kind === "comment" &&
        lastMessage?.authorName === "Codex Dockmaster" &&
        lastMessage?.body.includes("reviewer queue 已同步")
      );
    });
  }, "batch comment did not land on every selected handoff");
  assert((await readText(page, "mailbox-batch-selected-count")) === "已选 2", "selected handoffs should remain selected after batch comment");
  await capture(page, "mailbox-batch-comment");

  await page.getByTestId("mailbox-batch-note").fill(batchComplete);
  await page.getByTestId("mailbox-batch-action-completed").click();
  for (const handoff of created) {
    await waitForMailboxStatus(page, handoff.id, "completed");
  }
  const stateAfterComplete = await readState(serverURL);
  assert(
    stateAfterComplete.mailbox.filter((item) => item.status !== "completed").length === 0,
    "mailbox open queue should clear after batch complete"
  );
  await waitFor(async () => (await readText(page, "mailbox-batch-selected-count")) === "已选 0", "batch selection should clear after completed handoffs leave the open queue");
  for (const handoff of created) {
    const updated = stateAfterComplete.mailbox.find((item) => item.id === handoff.id);
    const inboxItem = stateAfterComplete.inbox.find((item) => item.id === updated?.inboxItemId);
    assert(updated?.status === "completed", `handoff ${handoff.id} should complete through batch queue`);
    assert(updated?.lastNote === batchComplete, `handoff ${handoff.id} should retain batch closeout note`);
    assert(inboxItem?.summary?.includes("收口备注"), `handoff ${handoff.id} inbox summary should reflect closeout`);
  }
  await capture(page, "mailbox-batch-completed");

  const report = [
    "# 2026-04-11 Mailbox Batch Queue Report",
    "",
    "- Ticket: `TKT-91`",
    "- Checklist: `CHK-21`",
    "- Test Case: `TC-080`",
    "- Scope: mailbox multi-select batch queue, sequential bulk ack/comment/complete, open queue clear-down",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-mailbox-batch-actions -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/mailbox` 现在支持多选 open handoff 并进入同一条 `Batch Queue`；`Select Open` 后可以一次性锁定多条当前 formal handoff，而不必逐卡重复点击 -> PASS",
    "- `Batch Acknowledge` 会按既有 `/v1/mailbox/:id` 顺序提交到每条 selected handoff；两条 reviewer lane 都会切到 `acknowledged`，证明这不是前端假批量态 -> PASS",
    "- `Batch Formal Comment` 会把统一 note 顺序写回每条 selected handoff，且 lifecycle 继续保持 `acknowledged`，不会因为批量 comment 把状态冲坏 -> PASS",
    "- `Batch Complete` 后，两条 handoff 都会落到 `completed`，open queue 归零、selection 自动清空、closeout note 同步进入 inbox summary，说明 bulk closeout 已进入正式产品面 -> PASS",
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
