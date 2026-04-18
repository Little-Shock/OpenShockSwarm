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
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt92-escalation-queue-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-governance-escalation-queue";
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

function parseCountText(value) {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function governanceStatusLabel(status) {
  switch (status) {
    case "active":
      return "进行中";
    case "blocked":
      return "阻塞";
    case "done":
      return "完成";
    case "ready":
      return "就绪";
    case "required":
      return "需要处理";
    case "watch":
      return "关注";
    case "draft":
      return "草稿";
    default:
      return status;
  }
}

function mailboxStatusLabel(status) {
  switch (status) {
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "阻塞";
    case "completed":
      return "已完成";
    default:
      return "待接手";
  }
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
  const expectedLabel = mailboxStatusLabel(expected);
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

async function advanceMailbox(serverURL, handoffId, input) {
  return fetchJSON(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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
  resolveChromiumExecutable();
  const requestTitle = `Governance escalation queue ${Date.now()}`;
  const requestSummary = "请把当前 reviewer lane 接住，并把 blocker / reroute / closeout 写回 escalation queue。";
  const blockedNote = "review evidence 还没收平，需要先抬到 blocker queue。";
  const completeNote = "review evidence 已回齐，可以从 escalation queue 收口。";

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await context.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });

  const baselineState = await readState(serverURL);
  const baselineQueueCount = baselineState.workspace.governance.escalationSla?.queue?.length ?? 0;
  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governance-escalation-queue").waitFor({ state: "visible" });
  assert(
    parseCountText(await readText(page, "mailbox-governance-escalation-count")) === baselineQueueCount,
    "baseline escalation queue count should match server governance snapshot"
  );
  await capture(page, "mailbox-escalation-baseline");

  await page.getByTestId("mailbox-create-room").selectOption("room-runtime");
  await page.getByTestId("mailbox-create-from-agent").selectOption("agent-codex-dockmaster");
  await page.getByTestId("mailbox-create-to-agent").selectOption("agent-claude-review-runner");
  await page.getByTestId("mailbox-create-title").fill(requestTitle);
  await page.getByTestId("mailbox-create-summary").fill(requestSummary);
  await page.getByTestId("mailbox-create-submit").click();

  const handoff = await waitForMailbox(serverURL, requestTitle);
  const handoffEntryId = `handoff:${handoff.id}`;
  await page.getByTestId(`mailbox-governance-escalation-entry-${handoffEntryId}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, `mailbox-governance-escalation-status-${handoffEntryId}`)) === governanceStatusLabel("active"),
    "requested handoff should appear as active escalation queue entry"
  );
  assert(
    parseCountText(await readText(page, "mailbox-governance-escalation-count")) === baselineQueueCount + 1,
    "mailbox queue should expose one additional active handoff entry after create"
  );
  const mailboxActiveEntryText =
    (await page.getByTestId(`mailbox-governance-escalation-entry-${handoffEntryId}`).textContent())?.trim() ?? "";
  assert(
    !mailboxActiveEntryText.includes("SLA 内继续围当前 handoff ledger 推进"),
    "mailbox escalation queue should not keep standalone next-step helper copy once the handoff ledger already exposes the same escalation intent"
  );
  assert(
    !mailboxActiveEntryText.includes("打开详情"),
    "mailbox escalation queue should not keep a generic open-detail CTA once the mailbox ledger already owns actionable navigation"
  );
  await capture(page, "mailbox-escalation-requested");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-governance-escalation-entry-${handoffEntryId}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, `orchestration-governance-escalation-status-${handoffEntryId}`)) === governanceStatusLabel("active"),
    "orchestration page should mirror active handoff escalation entry"
  );
  const orchestrationActiveEntryText =
    (await page.getByTestId(`orchestration-governance-escalation-entry-${handoffEntryId}`).textContent())?.trim() ?? "";
  assert(
    !orchestrationActiveEntryText.includes("SLA 内继续围当前 handoff ledger 推进"),
    "orchestration escalation queue should not keep standalone next-step helper copy once the governance surfaces already expose the same escalation intent"
  );
  assert(
    !orchestrationActiveEntryText.includes("打开升级事项"),
    "orchestration escalation queue should not keep a generic open-escalation CTA once the primary governance surfaces already own navigation"
  );
  const orchestrationEscalationPanelText =
    (await page.getByText("升级时限").locator("..").textContent())?.trim() ?? "";
  assert(
    !orchestrationEscalationPanelText.includes("下一次升级："),
    "orchestration escalation SLA panel should not keep next-escalation helper copy once the queue already exposes active escalation truth"
  );
  await capture(page, "orchestration-escalation-requested");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-note-${handoff.id}`).fill(blockedNote);
  await page.getByTestId(`mailbox-action-blocked-${handoff.id}`).click();
  await waitForMailboxStatus(page, handoff.id, "blocked");

  const blockedState = await waitFor(async () => {
    const state = await readState(serverURL);
    const blockerInbox = state.inbox.find((item) => item.kind === "blocked" && item.handoffId === handoff.id);
    if (!blockerInbox) {
      return false;
    }
    return { state, blockerInbox };
  }, "blocked inbox escalation did not appear");
  const blockerEntryId = `inbox:${blockedState.blockerInbox.id}`;

  await page.getByTestId(`mailbox-governance-escalation-entry-${handoffEntryId}`).waitFor({ state: "visible" });
  await page.getByTestId(`mailbox-governance-escalation-entry-${blockerEntryId}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, `mailbox-governance-escalation-status-${handoffEntryId}`)) === governanceStatusLabel("blocked"),
    "blocked handoff should switch escalation queue status to blocked"
  );
  assert(
    (await readText(page, `mailbox-governance-escalation-status-${blockerEntryId}`)) === governanceStatusLabel("blocked"),
    "blocked inbox signal should appear as blocked escalation queue entry"
  );
  assert(
    parseCountText(await readText(page, "mailbox-governance-escalation-count")) === baselineQueueCount + 2,
    "mailbox queue should expose handoff + inbox blocker entries after block"
  );
  const mailboxBlockedEntryText =
    (await page.getByTestId(`mailbox-governance-escalation-entry-${blockerEntryId}`).textContent())?.trim() ?? "";
  assert(
    !mailboxBlockedEntryText.includes("决定 unblock / reroute"),
    "mailbox escalation queue should not repeat unblock helper copy that already belongs to inbox and human-override surfaces"
  );
  assert(
    !mailboxBlockedEntryText.includes("打开详情"),
    "mailbox escalation queue should not keep a generic open-detail CTA once inbox and handoff ledger already own navigation"
  );
  await capture(page, "mailbox-escalation-blocked");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-governance-escalation-entry-${handoffEntryId}`).waitFor({ state: "visible" });
  await page.getByTestId(`orchestration-governance-escalation-entry-${blockerEntryId}`).waitFor({ state: "visible" });
  const orchestrationBlockedEntryText =
    (await page.getByTestId(`orchestration-governance-escalation-entry-${blockerEntryId}`).textContent())?.trim() ?? "";
  assert(
    !orchestrationBlockedEntryText.includes("决定 unblock / reroute"),
    "orchestration escalation queue should not repeat unblock helper copy that already belongs to inbox and human-override surfaces"
  );
  await capture(page, "orchestration-escalation-blocked");

  await advanceMailbox(serverURL, handoff.id, {
    action: "acknowledged",
    actingAgentId: handoff.toAgentId,
  });
  await waitFor(async () => {
    const latestHandoff = (await readMailbox(serverURL)).find((item) => item.id === handoff.id);
    return latestHandoff?.status === "acknowledged";
  }, "handoff did not re-acknowledge via formal mailbox truth");
  await advanceMailbox(serverURL, handoff.id, {
    action: "completed",
    actingAgentId: handoff.toAgentId,
    note: completeNote,
  });
  await waitFor(async () => {
    const latestHandoff = (await readMailbox(serverURL)).find((item) => item.id === handoff.id);
    return latestHandoff?.status === "completed";
  }, "handoff did not complete via formal mailbox truth");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await waitFor(
    async () => parseCountText(await readText(page, "mailbox-governance-escalation-count")) === baselineQueueCount,
    "escalation queue should return to baseline after handoff closeout"
  );
  await waitFor(
    async () => (await page.getByTestId(`mailbox-governance-escalation-entry-${handoffEntryId}`).count()) === 0,
    "handoff escalation entry should disappear after closeout"
  );
  await waitFor(
    async () => (await page.getByTestId(`mailbox-governance-escalation-entry-${blockerEntryId}`).count()) === 0,
    "blocked inbox escalation entry should disappear after closeout"
  );
  await capture(page, "mailbox-escalation-cleared");

  const finalState = await readState(serverURL);
  assert(
    (finalState.workspace.governance.escalationSla?.queue?.length ?? 0) === baselineQueueCount,
    "server governance snapshot should return escalation queue to baseline after closeout"
  );

  const report = [
    "# 2026-04-11 Governance Escalation Queue Report",
    "",
    "- Ticket: `TKT-92`",
    "- Checklist: `CHK-21`",
    "- Test Case: `TC-081`",
    "- Scope: workspace governance escalation queue, mailbox + orchestration mirror, blocked inbox escalation, queue clear-down",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governance-escalation-queue -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/mailbox` 的 governance area 现在不只显示 SLA summary，而是会把当前 active handoff 直接排进 `Escalation Queue`；创建 formal handoff 后，queue 会立刻出现 `mailbox handoff` entry -> PASS",
    "- `/agents` orchestration page 会镜像同一份 escalation queue truth，而不是只在 Mailbox 局部可见；同一条 handoff escalation 会在两个工作面同源出现 -> PASS",
    "- handoff 被 `blocked` 后，queue 会同时出现 blocked handoff 与 related inbox blocker 两条 entry，证明 escalation 不再只剩一串 aggregate counter -> PASS",
    "- handoff 重新 `acknowledged -> completed` 后，这次新增的 escalation entry 会自动退出队列，server snapshot 也会回到初始基线，说明 escalation queue 已成为正式治理对象，而不是脏残留列表 -> PASS",
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
