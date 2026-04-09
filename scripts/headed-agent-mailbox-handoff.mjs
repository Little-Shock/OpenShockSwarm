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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt35-mailbox-")));
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
  const filePath = path.join(
    screenshotsDir,
    `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`
  );
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

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function readMailbox(serverURL) {
  return fetchJSON(`${serverURL}/v1/mailbox`, { cache: "no-store" });
}

async function waitForMailbox(serverURL, title) {
  return waitFor(async () => {
    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => item.title === title) ?? false;
  }, `mailbox handoff ${title} did not appear`);
}

async function waitForMailboxStatus(page, handoffId, expected) {
  await page.waitForFunction(
    ({ currentHandoffId, currentExpected }) => {
      return (
        document
          .querySelector(`[data-testid="mailbox-status-${currentHandoffId}"]`)
          ?.textContent?.trim() === currentExpected
      );
    },
    { currentHandoffId: handoffId, currentExpected: expected },
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
  };
  const buildLogPath = path.join(logsDir, "web-build.log");

  await mkdir(workspaceRoot, { recursive: true });
  await rm(path.join(webAppRoot, ".next"), { recursive: true, force: true });

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

  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: webEnv,
    }
  );

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
  const chromiumExecutable = resolveChromiumExecutable();
  const requestTitle = `把 runtime reviewer lane 交给 Claude ${Date.now()}`;
  const requestSummary =
    "请你正式接住 current reviewer lane，并把 blocked / complete 结果回写到 mailbox ledger。";
  const blockedNote = "等 reviewer comment sync 先收平。";
  const completeNote = "review notes 已吸收，后面可以回到 PR 收口。";

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-create-room").waitFor({ state: "visible" });
  await page.getByTestId("mailbox-create-room").selectOption("room-runtime");
  await page.getByTestId("mailbox-create-from-agent").selectOption("agent-codex-dockmaster");
  await page.getByTestId("mailbox-create-to-agent").selectOption("agent-claude-review-runner");
  await page.getByTestId("mailbox-create-title").fill(requestTitle);
  await page.getByTestId("mailbox-create-summary").fill(requestSummary);
  await page.getByTestId("mailbox-create-submit").click();

  const handoff = await waitForMailbox(serverURL, requestTitle);
  const handoffId = handoff.id;
  await page.getByTestId(`mailbox-card-${handoffId}`).waitFor({ state: "visible" });
  await waitForMailboxStatus(page, handoffId, "requested");

  const stateAfterCreate = await readState(serverURL);
  const createdInbox = stateAfterCreate.inbox.find((item) => item.id === handoff.inboxItemId);
  const createdMessages = stateAfterCreate.roomMessages["room-runtime"] ?? [];
  assert(createdInbox?.handoffId === handoffId, "created handoff should bind inbox item");
  assert(
    createdInbox?.href?.includes(`/inbox?handoffId=${handoffId}`),
    "created inbox item should deep-link back into /inbox mailbox ledger"
  );
  assert(
    createdMessages.some((message) => message.message.includes("正式交接")),
    "room should receive a system handoff writeback"
  );
  await capture(page, "mailbox-requested");

  await page.getByTestId(`mailbox-action-blocked-${handoffId}`).click();
  await page.getByText("blocked handoff requires a note").waitFor({ state: "visible" });
  await waitForMailboxStatus(page, handoffId, "requested");
  await capture(page, "mailbox-blocked-note-required");

  await page.getByTestId(`mailbox-note-${handoffId}`).fill(blockedNote);
  await page.getByTestId(`mailbox-action-blocked-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "blocked");

  const stateAfterBlocked = await readState(serverURL);
  const blockedHandoff = stateAfterBlocked.mailbox.find((item) => item.id === handoffId);
  const blockedInbox = stateAfterBlocked.inbox.find((item) => item.id === handoff.inboxItemId);
  assert(blockedHandoff?.lastNote === blockedNote, "blocked handoff should persist note");
  assert(blockedInbox?.kind === "blocked", "blocked handoff should escalate inbox item tone");
  await capture(page, "mailbox-blocked");

  await page.getByTestId(`mailbox-action-acknowledged-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "acknowledged");

  const stateAfterAck = await readState(serverURL);
  const runtimeRun = stateAfterAck.runs.find((item) => item.id === handoff.runId);
  const runtimeRoom = stateAfterAck.rooms.find((item) => item.id === handoff.roomId);
  const runtimeIssue = stateAfterAck.issues.find((item) => item.key === handoff.issueKey);
  assert(runtimeRun?.owner === "Claude Review Runner", "acknowledged handoff should switch run owner");
  assert(runtimeRoom?.topic?.owner === "Claude Review Runner", "acknowledged handoff should switch room owner");
  assert(runtimeIssue?.owner === "Claude Review Runner", "acknowledged handoff should switch issue owner");
  await capture(page, "mailbox-acknowledged");

  await page.goto(`${webURL}/rooms/room-runtime?tab=context`, { waitUntil: "load" });
  await page.getByTestId(`room-workbench-handoff-${handoffId}`).waitFor({ state: "visible" });
  assert(
    (await page.getByTestId(`room-workbench-handoff-${handoffId}`).getAttribute("href")) ===
      `/mailbox?handoffId=${handoffId}&roomId=room-runtime`,
    "room mailbox backlink should point at the focused mailbox handoff"
  );
  await capture(page, "room-context-mailbox-backlink");

  await page.goto(`${webURL}/mailbox?handoffId=${handoffId}&roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-note-${handoffId}`).fill(completeNote);
  await page.getByTestId(`mailbox-action-completed-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "completed");

  const stateAfterComplete = await readState(serverURL);
  const completedHandoff = stateAfterComplete.mailbox.find((item) => item.id === handoffId);
  const completedInbox = stateAfterComplete.inbox.find((item) => item.id === handoff.inboxItemId);
  const completedRoomMessages = stateAfterComplete.roomMessages["room-runtime"] ?? [];
  assert(completedHandoff?.status === "completed", "completed handoff should persist completed status");
  assert(
    completedHandoff?.lastNote === completeNote,
    "completed handoff should retain the closeout note on the mailbox ledger"
  );
  assert(
    completedInbox?.summary?.includes("收口备注"),
    "completed handoff should write closeout note into inbox summary"
  );
  assert(
    completedRoomMessages.some((message) => message.message.includes("标记为 complete")),
    "completed handoff should write a completion event into room timeline"
  );
  await capture(page, "mailbox-completed");

  await page.getByTestId(`mailbox-inbox-link-${handoffId}`).click();
  await page.waitForURL(new RegExp(`/inbox\\?handoffId=${handoffId}`), { timeout: 30_000 });
  await page.getByTestId(`mailbox-card-${handoffId}`).waitFor({ state: "visible" });
  await page
    .locator(`[data-testid="mailbox-card-${handoffId}"]`)
    .getByText("focused")
    .waitFor({ state: "visible" });
  assert(
    (await readText(page, `mailbox-status-${handoffId}`)) === "completed",
    "inbox mailbox ledger should surface the completed handoff"
  );
  await capture(page, "inbox-mailbox-ledger-focused");

  const report = [
    "# 2026-04-09 Agent Mailbox / Handoff Contract Report",
    "",
    `- Command: \`pnpm test:headed-agent-mailbox-handoff -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/mailbox` 现在可以从 room truth 正式创建 handoff，并把 request 同步写进 mailbox ledger、room system note 和 inbox back-link -> PASS",
    "- adversarial path 已覆盖：未填 note 直接 `blocked` 会被 server 拒绝，UI 继续停在 `requested`，不会把假 blocked 写进 live truth -> PASS",
    "- 填写 blocker note 后，handoff 会前滚到 `blocked`，同一条 inbox item 也切到 blocked tone，note 保持在 ledger 上 -> PASS",
    "- `acknowledged` 后，`run_runtime_01.owner`、`room-runtime.topic.owner`、`OPS-18.owner` 会一起切到 `Claude Review Runner`，handoff 不再只是文案提示 -> PASS",
    "- Room context 现在会直接露出 mailbox backlink；`/inbox?handoffId=...` 也能聚焦同一条 handoff，Room / Inbox / Mailbox 三个面读的是同一份 lifecycle truth -> PASS",
    "- `completed` 后，closeout note 会同时回写到 inbox summary 和 room timeline，handoff ledger 落到 `completed`，生命周期可以完整回放 -> PASS",
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
