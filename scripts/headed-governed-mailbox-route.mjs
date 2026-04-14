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
const requestedReportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : "";
const supportedModes = new Set([
  "auto-advance",
  "closeout",
  "delegation",
  "delegate-handoff",
  "delegate-response",
  "delegate-retry",
  "delegate-response-comment-sync",
  "delegate-communication-thread",
  "delegate-thread-actions",
  "delegate-resume",
  "delegate-visibility",
  "delegate-resume-parent",
  "delegate-history-sync",
  "delegate-parent-status",
  "delegate-parent-context",
  "delegate-child-context",
  "delegate-child-timeline",
  "delegate-parent-timeline",
  "delegate-room-trace",
  "delegate-room-trace-blocked",
  "delegate-policy",
  "delegate-auto-complete",
  "delegate-comment-sync",
  "delegate-lifecycle",
]);
const runMode = supportedModes.has(parsedArgs.mode)
  ? parsedArgs.mode
  : requestedReportPath.includes("autocreate")
    ? "auto-create"
    : "route";
const evidencePrefixByMode = {
  route: "openshock-tkt64-governed-route-",
  "auto-create": "openshock-tkt65-governed-route-",
  "auto-advance": "openshock-tkt66-governed-route-",
  closeout: "openshock-tkt67-governed-route-",
  delegation: "openshock-tkt68-governed-route-",
  "delegate-handoff": "openshock-tkt69-governed-route-",
  "delegate-lifecycle": "openshock-tkt70-governed-route-",
  "delegate-policy": "openshock-tkt71-governed-route-",
  "delegate-auto-complete": "openshock-tkt72-governed-route-",
  "delegate-comment-sync": "openshock-tkt73-governed-route-",
  "delegate-response": "openshock-tkt74-governed-route-",
  "delegate-retry": "openshock-tkt75-governed-route-",
  "delegate-response-comment-sync": "openshock-tkt76-governed-route-",
  "delegate-communication-thread": "openshock-tkt89-governed-route-",
  "delegate-thread-actions": "openshock-tkt90-governed-route-",
  "delegate-resume": "openshock-tkt77-governed-route-",
  "delegate-visibility": "openshock-tkt78-governed-route-",
  "delegate-resume-parent": "openshock-tkt79-governed-route-",
  "delegate-history-sync": "openshock-tkt80-governed-route-",
  "delegate-parent-status": "openshock-tkt81-governed-route-",
  "delegate-parent-context": "openshock-tkt82-governed-route-",
  "delegate-child-context": "openshock-tkt83-governed-route-",
  "delegate-child-timeline": "openshock-tkt84-governed-route-",
  "delegate-parent-timeline": "openshock-tkt85-governed-route-",
  "delegate-room-trace": "openshock-tkt86-governed-route-",
  "delegate-room-trace-blocked": "openshock-tkt87-governed-route-",
};
const evidencePrefix = evidencePrefixByMode[runMode] ?? evidencePrefixByMode.route;
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), evidencePrefix)));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = requestedReportPath || path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-governed-mailbox-route";
const webDistDir = path.join(projectRoot, "apps", "web", webDistDirName);

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(webDistDir, { recursive: true });

const screenshots = [];
const processes = [];

function parseArgs(args) {
  const result = { reportPath: "", mode: "default" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--report") {
      result.reportPath = args[index + 1] ?? "";
      index += 1;
    } else if (args[index] === "--mode") {
      result.mode = args[index + 1] ?? "default";
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

const reportDate = new Date().toISOString().slice(0, 10);

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

async function patchGovernedQATopology(serverURL, deliveryDelegationMode = "formal-handoff") {
  return fetchJSON(`${serverURL}/v1/workspace`, {
    method: "PATCH",
    body: JSON.stringify({
      governance: {
        deliveryDelegationMode,
        teamTopology: [
          { id: "pm", label: "PM", role: "目标与验收", defaultAgent: "Spec Captain", lane: "scope / final response" },
          { id: "architect", label: "Architect", role: "拆解与边界", defaultAgent: "Spec Captain", lane: "shape / split" },
          { id: "developer", label: "Developer", role: "实现与分支推进", defaultAgent: "Build Pilot", lane: "issue -> branch" },
          { id: "reviewer", label: "Reviewer", role: "exact-head verdict", defaultAgent: "Review Runner", lane: "review / blocker" },
          { id: "qa", label: "QA", role: "verify / release evidence", defaultAgent: "Memory Clerk", lane: "test / release gate" },
        ],
      },
    }),
  });
}

async function waitForMailbox(serverURL, title) {
  return waitFor(async () => {
    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => item.title === title) ?? false;
  }, `mailbox handoff ${title} did not appear`);
}

async function waitForMailboxWhere(serverURL, predicate, message) {
  return waitFor(async () => {
    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => predicate(item)) ?? false;
  }, message);
}

async function waitForGovernedHandoff(serverURL, expected) {
  return waitFor(async () => {
    const state = await readState(serverURL);
    const suggestion = state.workspace?.governance?.routingPolicy?.suggestedHandoff;
    if (!suggestion || suggestion.status !== "active" || !suggestion.handoffId) {
      return false;
    }
    if (expected.roomId && suggestion.roomId !== expected.roomId) {
      return false;
    }
    if (expected.fromAgentId && suggestion.fromAgentId !== expected.fromAgentId) {
      return false;
    }
    if (expected.toAgentId && suggestion.toAgentId !== expected.toAgentId) {
      return false;
    }

    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => item.id === suggestion.handoffId) ?? false;
  }, `governed mailbox handoff ${expected.roomId} did not appear`);
}

function governanceStatusLabel(status) {
  switch (status) {
    case "active":
      return "进行中";
    case "ready":
      return "就绪";
    case "required":
      return "需要处理";
    case "blocked":
      return "阻塞";
    case "done":
      return "完成";
    case "draft":
      return "草稿";
    case "watch":
      return "关注";
    default:
      return "等待中";
  }
}

function handoffStatusLabel(status) {
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

function deliveryDelegationStatusLabel(status) {
  switch (status) {
    case "ready":
      return "可交接";
    case "blocked":
      return "交接受阻";
    case "done":
      return "已完成";
    default:
      return "等待中";
  }
}

function deliveryDelegationHandoffStatusLabel(status) {
  switch (status) {
    case "acknowledged":
      return "已接手";
    case "blocked":
      return "交接受阻";
    case "completed":
      return "交接完成";
    case "requested":
      return "等待接手";
    default:
      return "";
  }
}

function deliveryDelegationResponseStatusLabel(status) {
  switch (status) {
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "回复受阻";
    case "completed":
      return "回复完成";
    case "requested":
      return "等待回复";
    default:
      return "";
  }
}

function deliveryDelegationResponseAttemptsLabel(count) {
  return `回复 x${count}`;
}

function mailboxReplyStatusLabel(status) {
  switch (status) {
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "回复受阻";
    case "completed":
      return "回复完成";
    case "requested":
      return "等待回复";
    default:
      return "";
  }
}

function mailboxResponseAttemptsLabel(count) {
  return `回复 ${count} 次`;
}

function mailboxParentStatusLabel(status) {
  return `主交接 ${handoffStatusLabel(status)}`;
}

function mailboxKindLabel(kind) {
  switch (kind) {
    case "governed":
      return "自动交接";
    case "delivery-closeout":
      return "交付收尾";
    case "delivery-reply":
      return "收尾回复";
    default:
      return "手动交接";
  }
}

function mailboxMessageKindLabel(kind) {
  switch (kind) {
    case "request":
      return "请求";
    case "ack":
      return "已接手";
    case "blocked":
      return "阻塞";
    case "comment":
      return "留言";
    case "parent-progress":
      return "主任务进度";
    case "response-progress":
      return "回复进度";
    default:
      return "完成";
  }
}

async function readText(page, testId) {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
}

async function waitForTestIdText(page, testId, expectedText, timeout = 30_000) {
  await page.waitForFunction(
    ({ id, text }) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() === text,
    { id: testId, text: expectedText },
    { timeout }
  );
}

async function waitForGovernanceStatus(page, testId, status) {
  await waitForTestIdText(page, testId, governanceStatusLabel(status));
}

async function waitForMailboxStatus(page, handoffId, status) {
  await waitForTestIdText(page, `mailbox-status-${handoffId}`, handoffStatusLabel(status));
}

async function waitForActionEnabled(page, testId) {
  await page.waitForFunction(
    (id) => {
      const button = document.querySelector(`[data-testid="${id}"]`);
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    testId
  );
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
  if (
    runMode === "auto-advance" ||
    runMode === "closeout" ||
    runMode === "delegation" ||
    runMode === "delegate-handoff" ||
    runMode === "delegate-response" ||
    runMode === "delegate-retry" ||
    runMode === "delegate-response-comment-sync" ||
    runMode === "delegate-communication-thread" ||
    runMode === "delegate-thread-actions" ||
    runMode === "delegate-resume" ||
    runMode === "delegate-visibility" ||
    runMode === "delegate-resume-parent" ||
    runMode === "delegate-history-sync" ||
    runMode === "delegate-parent-status" ||
    runMode === "delegate-parent-context" ||
    runMode === "delegate-child-context" ||
    runMode === "delegate-child-timeline" ||
    runMode === "delegate-parent-timeline" ||
    runMode === "delegate-room-trace" ||
    runMode === "delegate-room-trace-blocked" ||
    runMode === "delegate-policy" ||
    runMode === "delegate-auto-complete" ||
    runMode === "delegate-comment-sync" ||
    runMode === "delegate-lifecycle"
  ) {
    await patchGovernedQATopology(
      serverURL,
      runMode === "delegate-policy"
        ? "signal-only"
        : runMode === "delegate-auto-complete"
          ? "auto-complete"
          : "formal-handoff"
    );
  }
  const initialState = await readState(serverURL);
  const requestTitle = initialState.workspace.governance.routingPolicy.suggestedHandoff.draftTitle;
  assert(requestTitle, "governed route should expose a draft title before auto-create");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-compose-governed-route").waitFor({ state: "visible" });
  await waitForGovernanceStatus(page, "mailbox-compose-governed-route-status", "ready");
  assert(
    (await readText(page, "mailbox-compose-governed-route-status")) === governanceStatusLabel("ready"),
    "governed compose route should start in ready state"
  );
  await page.getByTestId("mailbox-compose-governed-route-create").waitFor({ state: "visible" });
  await capture(page, "governed-compose-ready");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governed-route").waitFor({ state: "visible" });
  await waitForGovernanceStatus(page, "mailbox-governed-route-status", "ready");

  assert(
    (await readText(page, "mailbox-governed-route-status")) === governanceStatusLabel("ready"),
    "governed mailbox route should start in ready state"
  );
  assert(
    (await page.getByTestId("mailbox-create-from-agent").inputValue()) === "agent-codex-dockmaster",
    "governed route should auto-fill Codex as the source agent"
  );
  assert(
    (await page.getByTestId("mailbox-create-to-agent").inputValue()) === "agent-claude-review-runner",
    "governed route should auto-fill Claude reviewer as the target agent"
  );
  await capture(page, "governed-route-ready");

  await page.getByTestId("mailbox-governed-route-create").click();

  const handoff = await waitForGovernedHandoff(serverURL, {
    roomId: initialState.workspace.governance.routingPolicy.suggestedHandoff.roomId,
    fromAgentId: initialState.workspace.governance.routingPolicy.suggestedHandoff.fromAgentId,
    toAgentId: initialState.workspace.governance.routingPolicy.suggestedHandoff.toAgentId,
  });
  await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
  await waitForGovernanceStatus(page, "mailbox-governed-route-status", "active");
  assert(
    (await readText(page, "mailbox-governed-route-status")) === governanceStatusLabel("active"),
    "governed mailbox route should become active after creating the recommended handoff"
  );
  await capture(page, "governed-route-active");

  await page.goto(`${webURL}/inbox?roomId=room-runtime&handoffId=${handoff.id}`, { waitUntil: "load" });
  await page.getByTestId("mailbox-compose-governed-route").waitFor({ state: "visible" });
  await waitForGovernanceStatus(page, "mailbox-compose-governed-route-status", "active");
  assert(
    (await readText(page, "mailbox-compose-governed-route-status")) === governanceStatusLabel("active"),
    "governed compose route should become active after auto-create"
  );
  await capture(page, "governed-compose-active");

  await page.getByTestId("mailbox-compose-governed-route-focus").click();
  await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
  await capture(page, "governed-route-focus-inbox");

  let reportTitle = "# 2026-04-11 Governed Mailbox Route Report";
  let reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-route -- --report ${path.relative(projectRoot, reportPath)}`;
  let reportTicket = "TKT-64";
  let reportChecklist = "CHK-21";
  let reportTestCase = "TC-053";
  let reportScope = "governed default route、active handoff focus、blocked fallback";
  let resultLines = [
    "- `/mailbox` 与 Inbox compose 都会读取 `workspace.governance.routingPolicy.suggestedHandoff`，并在 `ready` 状态下显式给出 `Create Governed Handoff` 一键起单入口 -> PASS",
    "- 通过 governed route 一键起单后，`/mailbox` 与 Inbox compose 会一起切到 `active`，并提供聚焦当前 handoff 的回链，防止同一路由被重复创建 -> PASS",
    "- 完成当前 reviewer handoff 后，两处 governed surface 会一起前滚到下一条 lane；当 QA lane 缺少可映射 agent 时，状态会显式转成 `blocked`，不会静默回退到随机接收方 -> PASS",
  ];

  await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${handoff.id}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-action-acknowledged-${handoff.id}`).click();
  await page.getByTestId(`mailbox-note-${handoff.id}`).fill("review 已完成，继续看下一条治理建议。");

  if (
    runMode === "auto-advance" ||
    runMode === "closeout" ||
    runMode === "delegation" ||
    runMode === "delegate-handoff" ||
    runMode === "delegate-response" ||
    runMode === "delegate-retry" ||
    runMode === "delegate-response-comment-sync" ||
    runMode === "delegate-communication-thread" ||
    runMode === "delegate-thread-actions" ||
    runMode === "delegate-resume" ||
    runMode === "delegate-visibility" ||
    runMode === "delegate-resume-parent" ||
    runMode === "delegate-history-sync" ||
    runMode === "delegate-parent-status" ||
    runMode === "delegate-parent-context" ||
    runMode === "delegate-child-context" ||
    runMode === "delegate-child-timeline" ||
    runMode === "delegate-parent-timeline" ||
    runMode === "delegate-room-trace" ||
    runMode === "delegate-room-trace-blocked" ||
    runMode === "delegate-policy" ||
    runMode === "delegate-auto-complete" ||
    runMode === "delegate-comment-sync" ||
    runMode === "delegate-lifecycle"
  ) {
    await page.getByTestId(`mailbox-action-completed-continue-${handoff.id}`).click();
    const followup = await waitForMailboxWhere(
      serverURL,
      (item) =>
        item.id !== handoff.id &&
        item.status === "requested" &&
        item.fromAgent === "Claude Review Runner" &&
        item.toAgent === "Memory Clerk",
      "auto-advanced governed handoff did not appear"
    );

    await page.getByTestId(`mailbox-card-${followup.id}`).waitFor({ state: "visible" });
    await waitForGovernanceStatus(page, "mailbox-governed-route-status", "active");
    await capture(page, "governed-route-auto-advanced");

    const stateAfterContinue = await readState(serverURL);
    const governedSuggestion = stateAfterContinue.workspace.governance.routingPolicy.suggestedHandoff;
    assert(governedSuggestion.status === "active", "next governed handoff should become active after auto-advance");
    assert(governedSuggestion.handoffId === followup.id, "governed suggestion should point at the auto-created followup");
    assert(governedSuggestion.toLaneLabel === "QA", "auto-advanced governed handoff should move into the QA lane");
    assert(
      governedSuggestion.toAgent === "Memory Clerk",
      "auto-advanced governed handoff should target the mapped QA agent"
    );

    await page.goto(`${webURL}/inbox?roomId=room-runtime&handoffId=${followup.id}`, { waitUntil: "load" });
    await waitForGovernanceStatus(page, "mailbox-compose-governed-route-status", "active");
    await page.getByTestId("mailbox-compose-governed-route-focus").click();
    await page.getByTestId(`mailbox-card-${followup.id}`).waitFor({ state: "visible" });
    await capture(page, "governed-compose-auto-advanced");

    if (
      runMode === "closeout" ||
      runMode === "delegation" ||
      runMode === "delegate-handoff" ||
      runMode === "delegate-response" ||
      runMode === "delegate-retry" ||
      runMode === "delegate-response-comment-sync" ||
      runMode === "delegate-communication-thread" ||
      runMode === "delegate-thread-actions" ||
      runMode === "delegate-resume" ||
      runMode === "delegate-visibility" ||
	      runMode === "delegate-resume-parent" ||
	      runMode === "delegate-history-sync" ||
	      runMode === "delegate-parent-status" ||
	      runMode === "delegate-parent-context" ||
	      runMode === "delegate-child-context" ||
	      runMode === "delegate-child-timeline" ||
	      runMode === "delegate-parent-timeline" ||
	      runMode === "delegate-room-trace" ||
	      runMode === "delegate-room-trace-blocked" ||
	      runMode === "delegate-policy" ||
      runMode === "delegate-auto-complete" ||
      runMode === "delegate-comment-sync" ||
      runMode === "delegate-lifecycle"
    ) {
	      const qaCloseoutNote = "QA 验证完成，可以进入 PR delivery closeout。";

	      await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${followup.id}`, { waitUntil: "load" });
	      if (
	        runMode === "delegate-history-sync" ||
	        runMode === "delegate-communication-thread" ||
	        runMode === "delegate-thread-actions" ||
	        runMode === "delegate-room-trace" ||
	        runMode === "delegate-room-trace-blocked" ||
	        runMode === "delegate-auto-complete"
	      ) {
	        await fetchJSON(`${serverURL}/v1/mailbox/${followup.id}`, {
	          method: "POST",
	          body: JSON.stringify({
	            action: "acknowledged",
	            actingAgentId: followup.toAgentId,
	          }),
	        });
	        await fetchJSON(`${serverURL}/v1/mailbox/${followup.id}`, {
	          method: "POST",
	          body: JSON.stringify({
	            action: "completed",
	            actingAgentId: followup.toAgentId,
	            note: qaCloseoutNote,
	          }),
	        });
	        await page.reload({ waitUntil: "load" });
	      } else {
	        await waitForActionEnabled(page, `mailbox-action-acknowledged-${followup.id}`);
	        await Promise.all([
	          page.waitForResponse(
	            (response) =>
	              response.request().method() === "POST" &&
	              response.url().includes(`/v1/mailbox/${followup.id}`) &&
	              response.ok()
	          ),
	          page.getByTestId(`mailbox-action-acknowledged-${followup.id}`).click(),
	        ]);
	        await page.reload({ waitUntil: "load" });
	        await page.getByTestId(`mailbox-card-${followup.id}`).waitFor({ state: "visible" });
	        await waitForActionEnabled(page, `mailbox-action-completed-${followup.id}`);
	        await page.getByTestId(`mailbox-note-${followup.id}`).fill(qaCloseoutNote);
	        await page.getByTestId(`mailbox-action-completed-${followup.id}`).click();
	      }
	      await waitForGovernanceStatus(page, "mailbox-governed-route-status", "done");
      await page.getByTestId("mailbox-governed-route-closeout").waitFor({ state: "visible" });
      await capture(page, "governed-route-closeout-ready");

      const stateAfterCloseout = await readState(serverURL);
      const doneSuggestion = stateAfterCloseout.workspace.governance.routingPolicy.suggestedHandoff;
      assert(doneSuggestion.status === "done", "governed route should become done after final QA closeout");
      assert(
        doneSuggestion.href === "/pull-requests/pr-runtime-18",
        "done governed route should point to the runtime PR delivery entry"
      );

      await page.getByTestId("mailbox-governed-route-closeout").click();
      await page.getByTestId("pull-request-delivery-status").waitFor({ state: "visible" });
      await page.waitForFunction(
        (note) => document.querySelector('[data-testid="delivery-handoff-note"]')?.textContent?.includes(note),
        qaCloseoutNote
      );
      await capture(page, "pull-request-delivery-closeout");

      if (
        runMode === "delegation" ||
        runMode === "delegate-handoff" ||
        runMode === "delegate-response" ||
        runMode === "delegate-retry" ||
        runMode === "delegate-response-comment-sync" ||
        runMode === "delegate-communication-thread" ||
        runMode === "delegate-thread-actions" ||
        runMode === "delegate-resume" ||
        runMode === "delegate-visibility" ||
        runMode === "delegate-resume-parent" ||
        runMode === "delegate-history-sync" ||
        runMode === "delegate-parent-status" ||
        runMode === "delegate-parent-context" ||
        runMode === "delegate-child-context" ||
        runMode === "delegate-child-timeline" ||
        runMode === "delegate-parent-timeline" ||
        runMode === "delegate-room-trace" ||
        runMode === "delegate-room-trace-blocked" ||
        runMode === "delegate-policy" ||
        runMode === "delegate-auto-complete" ||
        runMode === "delegate-comment-sync" ||
        runMode === "delegate-lifecycle"
      ) {
        const expectedDelegationStatus =
          runMode === "delegate-auto-complete"
            ? deliveryDelegationStatusLabel("done")
            : deliveryDelegationStatusLabel("ready");
        assert(
          (await readText(page, "delivery-delegation-status")) === expectedDelegationStatus,
          "delivery delegation should reflect the configured post-closeout policy"
        );
        assert(
          (await readText(page, "delivery-delegation-target")) === "PM · Spec Captain",
          "delivery delegation should point back to PM / Spec Captain"
        );
        assert(
          (await readText(page, "delivery-delegation-summary")).includes("Spec Captain"),
          "delivery delegation summary should mention the delegated agent"
        );
        await page
          .getByTestId("pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18")
          .waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const node = document.querySelector(
            '[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]'
          );
          return node?.textContent?.includes("Spec Captain") ?? false;
        });
        await capture(page, "pull-request-delivery-delegation");

        if (runMode === "delegate-auto-complete") {
          assert(
            (await readText(page, "delivery-delegation-status")) === deliveryDelegationStatusLabel("done"),
            "auto-complete policy should mark delivery delegation done immediately"
          );
          assert(
            (await readText(page, "delivery-delegation-summary")).includes("auto-complete"),
            "auto-complete policy should be reflected in delivery delegation summary"
          );
          assert(
            (await page.getByTestId("delivery-delegation-handoff-status").count()) === 0,
            "auto-complete policy should not render a delegated handoff status chip"
          );
          assert(
            (await readText(page, "delivery-delegation-open")) === "打开交付详情",
            "auto-complete policy should keep the PR-level delivery context link"
          );
          const mailboxAfterCloseout = await readMailbox(serverURL);
          assert(
            !mailboxAfterCloseout.some((item) => item.kind === "delivery-closeout" && item.roomId === "room-runtime"),
            "auto-complete policy should skip auto-created delivery-closeout handoffs"
          );
          await capture(page, "pull-request-delivery-delegation-auto-complete");
          const stateAfterAutoComplete = await readState(serverURL);
          assert(
            stateAfterAutoComplete.workspace.governance.deliveryDelegationMode === "auto-complete",
            "auto-complete policy should remain durable after final closeout"
          );
          reportTitle = `# ${reportDate} Governed Mailbox Delegate Auto-Complete Report`;
          reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-auto-complete -- --report ${path.relative(projectRoot, reportPath)}`;
          reportTicket = "TKT-72";
          reportTestCase = "TC-061";
          reportScope = "auto-complete delivery policy、PR delegation done truth、durable workspace policy truth";
          resultLines = [
            "- workspace governance 现在支持 `auto-complete` delivery delegation policy；final lane closeout 后 PR detail 会直接把 `Delivery Delegation` 收成 `delegation done`，不再额外创建 delegated closeout handoff -> PASS",
            "- related inbox signal 会同步写回 auto-complete delivery summary，说明这条更重的 auto-closeout 策略已经进入正式 delivery contract，而不是只在某一页本地推导 -> PASS",
            "- workspace durable config 会继续保留同一份 `auto-complete` delivery policy，Mailbox 里也不会偷偷物化 `delivery-closeout` handoff，证明 auto-closeout truth 不依赖页面局部状态 -> PASS",
          ];
        } else if (runMode === "delegate-policy") {
          assert(
            (await readText(page, "delivery-delegation-summary")).includes("signal-only"),
            "signal-only policy should be reflected in delivery delegation summary"
          );
          assert(
            (await page.getByTestId("delivery-delegation-handoff-status").count()) === 0,
            "signal-only policy should not auto-create a delegated handoff status chip"
          );
          assert(
            (await readText(page, "delivery-delegation-open")) === "打开交付详情",
            "signal-only policy should keep the PR-level delivery context link"
          );
          const mailboxAfterCloseout = await readMailbox(serverURL);
          assert(
            !mailboxAfterCloseout.some((item) => item.kind === "delivery-closeout" && item.roomId === "room-runtime"),
            "signal-only policy should skip auto-created delivery-closeout handoffs"
          );
          await capture(page, "pull-request-delivery-delegation-signal-only");

          await page.goto(`${webURL}/settings`, { waitUntil: "load" });
          await page.getByTestId("settings-advanced-governance-toggle").click();
          await page.waitForFunction(() => {
            return document.querySelector('[data-testid="settings-governance-delivery-policy"]')?.textContent?.includes("仅提醒") ?? false;
          });
          await capture(page, "settings-governance-delivery-policy");
          reportTitle = "# 2026-04-11 Governed Mailbox Delegate Automation Policy Report";
          reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-policy -- --report ${path.relative(projectRoot, reportPath)}`;
          reportTicket = "TKT-71";
          reportTestCase = "TC-060";
          reportScope = "signal-only delivery policy、PR delegation signal、settings durable policy truth";
          resultLines = [
            "- workspace governance 现在支持 `signal-only` delivery delegation policy；final lane closeout 后 PR detail 仍会给出 `Delivery Delegation` card 和 related inbox signal，但不会自动创建 delegated closeout handoff -> PASS",
            "- `/settings` 会把同一份 `signal only` delivery policy 读回前台，说明这不是脚本局部开关，而是 durable workspace governance truth -> PASS",
            "- Mailbox ledger 在 `signal-only` 模式下不会偷偷物化 `delivery-closeout` handoff，delegate automation policy 已真正收口到产品行为而不是文案 -> PASS",
          ];
        } else if (
          runMode === "delegate-comment-sync" ||
          runMode === "delegate-handoff" ||
          runMode === "delegate-response" ||
          runMode === "delegate-retry" ||
          runMode === "delegate-response-comment-sync" ||
          runMode === "delegate-communication-thread" ||
          runMode === "delegate-thread-actions" ||
          runMode === "delegate-resume" ||
          runMode === "delegate-visibility" ||
          runMode === "delegate-resume-parent" ||
          runMode === "delegate-history-sync" ||
          runMode === "delegate-parent-status" ||
          runMode === "delegate-parent-context" ||
          runMode === "delegate-child-context" ||
          runMode === "delegate-child-timeline" ||
          runMode === "delegate-parent-timeline" ||
          runMode === "delegate-room-trace" ||
          runMode === "delegate-room-trace-blocked" ||
          runMode === "delegate-lifecycle"
        ) {
          assert(
            (await readText(page, "delivery-delegation-handoff-status")) ===
              deliveryDelegationHandoffStatusLabel("requested"),
            "delivery delegation should auto-create a requested formal closeout handoff"
          );
          const delegatedHandoffHref = await page.getByTestId("delivery-delegation-open").getAttribute("href");
          assert(
            delegatedHandoffHref && delegatedHandoffHref.includes("handoffId="),
            "delivery delegation open link should point at the delegated handoff"
          );
          const delegatedHandoffURL = new URL(delegatedHandoffHref, webURL);
          const delegatedHandoffID = delegatedHandoffURL.searchParams.get("handoffId");
          assert(delegatedHandoffID, "delegated handoff href should include handoffId");

          await page.getByTestId("delivery-delegation-open").click();
          await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
          const delegatedHandoff = await waitForMailboxWhere(
            serverURL,
            (item) => item.id === delegatedHandoffID,
            "delegated closeout handoff did not appear in mailbox state"
          );
          assert(
            delegatedHandoff.fromAgent === "Memory Clerk",
            "delegated closeout handoff should come from Memory Clerk after QA closeout"
          );
          assert(
            delegatedHandoff.toAgent === "Spec Captain",
            "delegated closeout handoff should target Spec Captain as the final delivery delegate"
          );
          await waitForMailboxStatus(page, delegatedHandoffID, "requested");
          await capture(page, "delivery-delegated-handoff");

          if (runMode === "delegate-comment-sync") {
            const sourceComment = "QA 已补充 release receipt checklist，先按这个清单收最终 operator closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(sourceComment);
            await page.getByTestId(`mailbox-action-comment-${delegatedHandoffID}`).click();
            await page.waitForFunction(
              ({ handoffId, note }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(note) ?? false;
              },
              { handoffId: delegatedHandoffID, note: sourceComment }
            );
            await capture(page, "delivery-delegated-handoff-source-comment");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: sourceComment }
            );
            assert(
              (await readText(page, "delivery-delegation-handoff-status")) ===
                deliveryDelegationHandoffStatusLabel("requested"),
              "source formal comment should not change delegated handoff lifecycle"
            );
            await capture(page, "pull-request-delivery-delegation-source-comment");

            const delegatedHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout handoff missing during comment sync run"
            );
            const targetComment = "Spec Captain 已收到 checklist，会按这个顺序补最终 release note 和 receipt。";
            await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${delegatedHandoffID}`, { waitUntil: "load" });
            await page
              .getByTestId(`mailbox-comment-actor-${delegatedHandoffID}`)
              .selectOption(delegatedHandoff.toAgentId);
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(targetComment);
            await page.getByTestId(`mailbox-action-comment-${delegatedHandoffID}`).click();
            await page.waitForFunction(
              ({ handoffId, note }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(note) ?? false;
              },
              { handoffId: delegatedHandoffID, note: targetComment }
            );
            await capture(page, "delivery-delegated-handoff-target-comment");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: targetComment }
            );
            await page.waitForFunction(
              ({ note }) =>
                document
                  .querySelector('[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]')
                  ?.textContent?.includes(note) ?? false,
              { note: targetComment }
            );
            assert(
              (await readText(page, "delivery-delegation-handoff-status")) ===
                deliveryDelegationHandoffStatusLabel("requested"),
              "target formal comment should preserve delegated handoff lifecycle"
            );
            await capture(page, "pull-request-delivery-delegation-comment-sync");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Comment Sync Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-comment-sync -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-73";
            reportTestCase = "TC-062";
            reportScope = "delegated closeout formal comments、PR detail summary sync、related inbox latest-comment sync";
            resultLines = [
              "- delegated closeout handoff 上的 formal comment 现在不再只留在 Mailbox card；source / target 的最新评论会同步回 PR detail `Delivery Delegation` summary -> PASS",
              "- related inbox signal 也会跟着写回最新 delegated closeout formal comment，说明跨 Agent closeout 的沟通已经进入正式 delivery contract，而不是停在局部 ledger -> PASS",
              "- 整个 comment sync 过程中 delegated handoff 继续维持 `handoff requested` lifecycle，没有因为补充评论而偷偷改成 blocked / completed 假状态 -> PASS",
            ];
          } else if (runMode === "delegate-response") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");
            await capture(page, "delivery-delegated-handoff-blocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(
              page,
              "delivery-delegation-response-status",
              deliveryDelegationResponseStatusLabel("requested")
            );
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: blockNote }
            );
            await capture(page, "pull-request-delivery-delegation-response-requested");

            const responseHandoffHref = await page.getByTestId("delivery-delegation-response-open").getAttribute("href");
            assert(responseHandoffHref, "response handoff link should expose href");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response handoff href should include handoffId");
            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            await page.waitForFunction(
              ({ handoffId, expectedStatus }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return (
                  card?.textContent?.includes("Spec Captain") &&
                  card?.textContent?.includes("Memory Clerk") &&
                  card?.textContent?.includes(expectedStatus)
                );
              },
              { handoffId: responseHandoffID, expectedStatus: handoffStatusLabel("requested") }
            );
            await capture(page, "delivery-delegated-response-handoff");

            await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === "POST" &&
                  response.url().includes(`/v1/mailbox/${responseHandoffID}`) &&
                  response.ok()
              ),
              page.getByTestId(`mailbox-action-acknowledged-${responseHandoffID}`).click(),
            ]);
            await page.reload({ waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            await waitForMailboxStatus(page, responseHandoffID, "acknowledged");
            const responseNote = "release receipt checklist 已补齐，请重新接住 delivery closeout。";
            await page.getByTestId(`mailbox-note-${responseHandoffID}`).fill(responseNote);
            await page.getByTestId(`mailbox-action-completed-${responseHandoffID}`).click();
            await waitForMailboxStatus(page, responseHandoffID, "completed");
            await capture(page, "delivery-delegated-response-handoff-completed");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(
              page,
              "delivery-delegation-response-status",
              deliveryDelegationResponseStatusLabel("completed")
            );
            assert(
              (await readText(page, "delivery-delegation-status")) === deliveryDelegationStatusLabel("blocked"),
              "delegated closeout should remain blocked until target re-acknowledges"
            );
            assert(
              (await readText(page, "delivery-delegation-handoff-status")) ===
                deliveryDelegationHandoffStatusLabel("blocked"),
              "blocked delegated closeout handoff should stay blocked after response completion"
            );
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: "重新 acknowledge final delivery closeout" }
            );
            await capture(page, "pull-request-delivery-delegation-response-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Response Orchestration Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-response -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-74";
            reportTestCase = "TC-063";
            reportScope = "delegated closeout blocked response handoff、PR detail response chip、cross-agent unblock orchestration";
            resultLines = [
              "- delegated closeout handoff 被 target `blocked` 后，系统现在会自动创建一条从 target 回给 source 的 `delivery-reply` formal handoff，把 unblock 下一棒物化成正式协作对象 -> PASS",
              "- PR detail 的 `Delivery Delegation` card 会同步露出 `reply requested / reply completed` 状态和 deep link，说明 blocked closeout 的跨 Agent 回链已经进入单一 delivery contract -> PASS",
              "- source 完成 unblock response 后，原 delegated closeout 仍保持 `delegate blocked / handoff blocked`，直到 target 重新 acknowledge；response orchestration 不会偷偷篡改主 handoff lifecycle -> PASS",
            ];
          } else if (runMode === "delegate-retry") {
            const firstBlockNote = "第一轮 blocker：release 文案待确认。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(firstBlockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(
              page,
              "delivery-delegation-response-attempts",
              deliveryDelegationResponseAttemptsLabel(1)
            );
            const firstResponseHandoffHref = await page.getByTestId("delivery-delegation-response-open").getAttribute("href");
            assert(firstResponseHandoffHref, "first response handoff link should expose href");
            const firstResponseURL = new URL(firstResponseHandoffHref, webURL);
            const firstResponseHandoffID = firstResponseURL.searchParams.get("handoffId");
            assert(firstResponseHandoffID, "first response handoff href should include handoffId");

            await page.goto(firstResponseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${firstResponseHandoffID}`).waitFor({ state: "visible" });
            await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === "POST" &&
                  response.url().includes(`/v1/mailbox/${firstResponseHandoffID}`) &&
                  response.ok()
              ),
              page.getByTestId(`mailbox-action-acknowledged-${firstResponseHandoffID}`).click(),
            ]);
            await page.reload({ waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${firstResponseHandoffID}`).waitFor({ state: "visible" });
            await waitForMailboxStatus(page, firstResponseHandoffID, "acknowledged");
            await page.getByTestId(`mailbox-note-${firstResponseHandoffID}`).fill("第一轮 unblock response 已补齐。");
            await page.getByTestId(`mailbox-action-completed-${firstResponseHandoffID}`).click();
            await waitForMailboxStatus(page, firstResponseHandoffID, "completed");

            await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${delegatedHandoffID}`, { waitUntil: "load" });
            await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === "POST" &&
                  response.url().includes(`/v1/mailbox/${delegatedHandoffID}`) &&
                  response.ok()
              ),
              page.getByTestId(`mailbox-action-acknowledged-${delegatedHandoffID}`).click(),
            ]);
            await page.reload({ waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await waitForMailboxStatus(page, delegatedHandoffID, "acknowledged");
            const secondBlockNote = "第二轮 blocker：release owner 还没签字。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(secondBlockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");
            await capture(page, "delivery-delegated-handoff-reblocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(
              page,
              "delivery-delegation-response-status",
              deliveryDelegationResponseStatusLabel("requested")
            );
            await waitForTestIdText(
              page,
              "delivery-delegation-response-attempts",
              deliveryDelegationResponseAttemptsLabel(2)
            );
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: "第 2 轮" }
            );
            await capture(page, "pull-request-delivery-delegation-retry-requested");

            const secondResponseHandoffHref = await page.getByTestId("delivery-delegation-response-open").getAttribute("href");
            assert(secondResponseHandoffHref, "second response handoff link should expose href");
            const secondResponseURL = new URL(secondResponseHandoffHref, webURL);
            const secondResponseHandoffID = secondResponseURL.searchParams.get("handoffId");
            assert(secondResponseHandoffID, "second response handoff href should include handoffId");
            assert(
              secondResponseHandoffID !== firstResponseHandoffID,
              "second response retry should create a new response handoff"
            );
            await page.goto(secondResponseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${secondResponseHandoffID}`).waitFor({ state: "visible" });
            await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === "POST" &&
                  response.url().includes(`/v1/mailbox/${secondResponseHandoffID}`) &&
                  response.ok()
              ),
              page.getByTestId(`mailbox-action-acknowledged-${secondResponseHandoffID}`).click(),
            ]);
            await page.reload({ waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${secondResponseHandoffID}`).waitFor({ state: "visible" });
            await waitForMailboxStatus(page, secondResponseHandoffID, "acknowledged");
            await page.getByTestId(`mailbox-note-${secondResponseHandoffID}`).fill("第二轮 unblock response 已补齐，请重新接住。");
            await page.getByTestId(`mailbox-action-completed-${secondResponseHandoffID}`).click();
            await waitForMailboxStatus(page, secondResponseHandoffID, "completed");
            await capture(page, "delivery-delegated-response-handoff-retry-completed");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(
              page,
              "delivery-delegation-response-status",
              deliveryDelegationResponseStatusLabel("completed")
            );
            assert(
              (await readText(page, "delivery-delegation-response-attempts")) === deliveryDelegationResponseAttemptsLabel(2),
              "PR detail should preserve second response attempt count"
            );
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: "第 2 轮" }
            );
            await capture(page, "pull-request-delivery-delegation-retry-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Retry Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-retry -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-75";
            reportTestCase = "TC-064";
            reportScope = "delegated closeout retry attempts、response handoff re-create、PR detail retry visibility";
            resultLines = [
              "- delegated closeout 在 `blocked -> response completed -> re-ack -> blocked` 第二轮后，系统会新建一条新的 `delivery-reply` handoff，而不是复用旧 response ledger -> PASS",
              "- PR detail 的 `Delivery Delegation` card 现在会显式显示 `reply x2` 这类 retry attempt truth，说明 cross-agent closeout retry 已进入正式 delivery contract -> PASS",
              "- 第二轮 response 完成后，PR detail 仍维持 `reply completed` + `reply x2`，并继续要求 target 重新 acknowledge 主 closeout handoff，retry orchestration 没有偷改主 lifecycle -> PASS",
            ];
          } else if (runMode === "delegate-response-comment-sync") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            const responseHandoffHref = await page.getByTestId("delivery-delegation-response-open").getAttribute("href");
            assert(responseHandoffHref, "response handoff link should expose href");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response handoff href should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during response comment sync run"
            );

            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            const sourceComment = "source 说明：release receipt checklist 正在补。";
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.fromAgentId,
                note: sourceComment,
              }),
            });
            await page.reload({ waitUntil: "load" });
            await page.waitForFunction(
              ({ handoffId, note }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(note) ?? false;
              },
              { handoffId: responseHandoffID, note: sourceComment }
            );
            await capture(page, "delivery-response-handoff-source-comment");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: sourceComment }
            );
            assert(
              (await readText(page, "delivery-delegation-response-status")) ===
                deliveryDelegationResponseStatusLabel("requested"),
              "response comment should preserve response handoff lifecycle"
            );
            await page.waitForFunction(
              ({ note }) =>
                document
                  .querySelector('[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]')
                  ?.textContent?.includes(note) ?? false,
              { note: sourceComment }
            );
            await capture(page, "pull-request-delivery-response-source-comment-sync");

            const targetComment = "target 回应：等 owner 签字后我会重新接住。";
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.toAgentId,
                note: targetComment,
              }),
            });
            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: targetComment }
            );
            assert(
              (await readText(page, "delivery-delegation-response-status")) ===
                deliveryDelegationResponseStatusLabel("requested"),
              "target response comment should preserve response handoff lifecycle"
            );
            await page.waitForFunction(
              ({ note }) =>
                document
                  .querySelector('[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]')
                  ?.textContent?.includes(note) ?? false,
              { note: targetComment }
            );
            await capture(page, "pull-request-delivery-response-target-comment-sync");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Response Comment Sync Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-response-comment-sync -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-76";
            reportTestCase = "TC-065";
            reportScope = "delivery-reply formal comments、PR detail response summary sync、related inbox latest response comment";
            resultLines = [
              "- `delivery-reply` response handoff 上的 source formal comment 现在会同步回 PR detail `Delivery Delegation` summary，而不是只留在 response ledger 本身 -> PASS",
              "- related inbox signal 也会跟着写回最新 response formal comment，说明二级 unblock response 沟通已经进入单一 delivery contract -> PASS",
              "- source / target comment sync 过程中 response handoff 继续维持 `reply requested`，comment 不会偷偷把 response lifecycle 改坏 -> PASS",
            ];
          } else if (runMode === "delegate-communication-thread") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(() => {
              return document.querySelector('[data-testid="delivery-communication-count"]')?.textContent?.trim() === "3";
            });
            const requestedThreadEntries = await page
              .locator('[data-testid^="delivery-communication-entry-"]')
              .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
            assert(requestedThreadEntries.length === 3, "communication thread should show parent request, parent blocker, and child request");
            assert(
              requestedThreadEntries[0]?.includes("Parent Closeout") &&
                requestedThreadEntries[0]?.includes(mailboxMessageKindLabel("request")),
              "communication thread should start with the parent closeout request"
            );
            assert(
              requestedThreadEntries[1]?.includes("Parent Closeout") && requestedThreadEntries[1]?.includes(blockNote),
              "communication thread should keep the parent blocker in chronological order"
            );
            assert(
              requestedThreadEntries[2]?.includes("Unblock Reply x1") &&
                requestedThreadEntries[2]?.includes(mailboxMessageKindLabel("request")),
              "communication thread should append the child unblock request after the parent blocker"
            );
            await capture(page, "pull-request-delivery-collaboration-thread-requested");

            const responseHandoffHref = await page.getByTestId("delivery-delegation-response-open").getAttribute("href");
            assert(responseHandoffHref, "response handoff link should expose href");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response handoff href should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during communication thread run"
            );

            const sourceComment = "source 说明：release receipt checklist 正在补。";
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.toAgentId,
                note: sourceComment,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
	            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
	              method: "POST",
	              body: JSON.stringify({
	                action: "completed",
	                actingAgentId: responseHandoff.toAgentId,
	                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
	              }),
	            });
	            const delegatedParent = await waitForMailboxWhere(
	              serverURL,
	              (item) => item.id === delegatedHandoffID,
	              "delegated closeout missing during communication thread run"
	            );
	            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
	              method: "POST",
	              body: JSON.stringify({
	                action: "acknowledged",
	                actingAgentId: delegatedParent.toAgentId,
	              }),
	            });

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(() => {
              return Number(document.querySelector('[data-testid="delivery-communication-count"]')?.textContent?.trim() ?? "0") >= 8;
            });
            const finalThreadEntries = await page
              .locator('[data-testid^="delivery-communication-entry-"]')
              .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
            const blockedIndex = finalThreadEntries.findIndex(
              (text) => text.includes("Parent Closeout") && text.includes(blockNote)
            );
            const replyCommentIndex = finalThreadEntries.findIndex(
              (text) => text.includes("Unblock Reply x1") && text.includes(sourceComment)
            );
            const parentAckIndex = finalThreadEntries.findIndex(
              (text) => text.includes("Parent Closeout") && text.includes("已确认接住")
            );
            const parentProgressIndex = finalThreadEntries.findIndex(
              (text) => text.includes("Unblock Reply x1") && text.includes("已重新 acknowledge 主 closeout")
            );
            assert(
              blockedIndex !== -1 &&
                replyCommentIndex !== -1 &&
                parentAckIndex !== -1 &&
                parentProgressIndex !== -1,
              "communication thread should include parent blocker, child comment, parent resume, and child parent-progress"
            );
            assert(
              blockedIndex < replyCommentIndex &&
                replyCommentIndex < parentAckIndex &&
                parentAckIndex < parentProgressIndex,
              "communication thread should stay chronological across parent and child ledgers"
            );
            await capture(page, "pull-request-delivery-collaboration-thread-resumed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delivery Collaboration Thread Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-communication-thread -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-89";
            reportTestCase = "TC-078";
            reportScope = "PR detail unified delivery collaboration thread, parent closeout chronology, child reply progress sync";
            resultLines = [
              "- PR detail 新增 `Delivery Collaboration Thread`，在父级 delegated closeout blocked 后会先后展示 `Parent Closeout request -> blocker -> Unblock Reply x1 request`，证明 parent / child 沟通已经进入单一时间线 -> PASS",
              "- child `delivery-reply` 的 source comment、response completion，以及 parent 重新 acknowledge 后回写给 child 的 `parent-progress`，现在都会一起出现在同一条 PR detail thread 中，而不是散落在多个卡片摘要里 -> PASS",
              "- 浏览器里读取到的 thread DOM 顺序保持 `parent blocker -> child comment -> parent resume -> child parent-progress`，说明这条 timeline 是按真实发生顺序收口，而不是静态分组拼接 -> PASS",
            ];
          } else if (runMode === "delegate-thread-actions") {
            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.getByTestId(`thread-action-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            assert(
              (await readText(page, "pull-request-thread-action-gate")) === "可操作",
              "PR detail thread action gate should allow live handoff mutations"
            );

            const blockNote = "PR detail inline action：先确认最终 release 文案。";
            await page.getByTestId(`thread-action-note-${delegatedHandoffID}`).fill(blockNote);
            await waitForActionEnabled(page, `thread-action-blocked-${delegatedHandoffID}`);
            await page.getByTestId(`thread-action-blocked-${delegatedHandoffID}`).click();
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.kind === "delivery-reply" && item.parentHandoffId === delegatedHandoffID,
              "response handoff missing after PR detail blocked action"
            );

            await page.waitForFunction(
              ({ responseHandoffId }) => {
                return document.querySelector(`[data-testid="thread-action-card-${responseHandoffId}"]`) !== null;
              },
              { responseHandoffId: responseHandoff.id }
            );
            await page.waitForFunction(
              ({ note }) => {
                return document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note) ?? false;
              },
              { note: blockNote }
            );
            await capture(page, "pull-request-delivery-thread-actions-blocked");

            const sourceComment = "PR detail inline action：receipt checklist 正在补。";
            await page.getByTestId(`thread-action-comment-actor-${responseHandoff.id}`).selectOption(responseHandoff.toAgentId);
            await page.getByTestId(`thread-action-note-${responseHandoff.id}`).fill(sourceComment);
            await waitForActionEnabled(page, `thread-action-comment-${responseHandoff.id}`);
            await page.getByTestId(`thread-action-comment-${responseHandoff.id}`).click();
            await page.waitForFunction(
              ({ note }) => {
                const text = document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent ?? "";
                const thread = document.querySelector('[data-testid="delivery-communication-count"]')?.textContent ?? "";
                return text.includes(note) && Number(thread.trim()) >= 4;
              },
              { note: sourceComment }
            );
            await capture(page, "pull-request-delivery-thread-actions-comment");

            await waitForActionEnabled(page, `thread-action-acknowledged-${responseHandoff.id}`);
            await page.getByTestId(`thread-action-acknowledged-${responseHandoff.id}`).click();
            await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoff.id && item.status === "acknowledged",
              "response handoff did not acknowledge from PR detail action surface"
            );
            const completeNote = "PR detail inline action：receipt 已补齐，请重新接住 closeout。";
            await page.getByTestId(`thread-action-note-${responseHandoff.id}`).fill(completeNote);
            await waitForActionEnabled(page, `thread-action-completed-${responseHandoff.id}`);
            await page.getByTestId(`thread-action-completed-${responseHandoff.id}`).click();
            await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoff.id && item.status === "completed",
              "response handoff did not complete from PR detail action surface"
            );
            await page.waitForFunction(
              ({ responseHandoffId }) => {
                return document.querySelector(`[data-testid="thread-action-resume-parent-${responseHandoffId}"]`) !== null;
              },
              { responseHandoffId: responseHandoff.id }
            );
            await capture(page, "pull-request-delivery-thread-actions-response-completed");

            await waitForActionEnabled(page, `thread-action-resume-parent-${responseHandoff.id}`);
            await page.getByTestId(`thread-action-resume-parent-${responseHandoff.id}`).click();
            await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID && item.status === "acknowledged",
              "parent delegated closeout did not resume from PR detail action surface"
            );
            await waitForTestIdText(
              page,
              `thread-action-status-${delegatedHandoffID}`,
              deliveryDelegationHandoffStatusLabel("acknowledged")
            );
            await page.waitForFunction(
              () => {
                const count = Number(document.querySelector('[data-testid="delivery-communication-count"]')?.textContent?.trim() ?? "0");
                const text = document.body.textContent ?? "";
                return count >= 8 && text.includes("已重新 acknowledge 主 closeout");
              }
            );
            await capture(page, "pull-request-delivery-thread-actions-resumed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delivery Thread Actions Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-thread-actions -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-90";
            reportTestCase = "TC-079";
            reportScope = "PR detail inline thread actions, delegated closeout mutation from PR surface, child reply resume path";
            resultLines = [
              "- PR detail `Thread Actions` 现在可以直接把 parent delegated closeout 标成 `blocked`，并在同页长出 child `delivery-reply` action card，不必先跳回 Mailbox -> PASS",
              "- child `delivery-reply` 现在也能直接在 PR detail 内做 formal comment、acknowledge、complete；这些 mutation 会同步回 `Delivery Delegation` summary 与 collaboration thread，而不是只在局部输入框里假更新 -> PASS",
              "- child response 完成后，PR detail 还能直接 `Resume Parent Closeout`；点击后 parent handoff 会在同页前滚到 `handoff acknowledged`，证明 thread action surface 不是只读回放，而是正式执行入口 -> PASS",
            ];
          } else if (runMode === "delegate-resume") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            const responseHandoffHref = await page.getByTestId("delivery-delegation-response-open").getAttribute("href");
            assert(responseHandoffHref, "response handoff link should expose href");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response handoff href should include handoffId");
            const delegatedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated parent handoff missing during resume sync run"
            );
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during resume sync run"
            );

            const sourceComment = "source 说明：release receipt checklist 正在补。";
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.toAgentId,
                note: sourceComment,
              }),
            });

            await page.goto(`${webURL}/inbox?roomId=room-runtime&handoffId=${delegatedHandoffID}`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ handoffId, note, blocker }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(note) && card?.textContent?.includes(blocker);
              },
              { handoffId: delegatedHandoffID, note: sourceComment, blocker: blockNote }
            );
            await page.waitForFunction(
              ({ inboxId, note, blocker }) => {
                const card = document.querySelector(`[data-testid="approval-center-signal-${inboxId}"]`);
                return card?.textContent?.includes(note) && card?.textContent?.includes(blocker);
              },
              { inboxId: delegatedParent.inboxItemId, note: sourceComment, blocker: blockNote }
            );
            await capture(page, "delivery-delegation-parent-response-comment-sync");

            const completeNote = "release receipt checklist 已补齐，请重新接住 delivery closeout。";
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: completeNote,
              }),
            });

            await page.reload({ waitUntil: "load" });
            await page.waitForFunction(
              ({ handoffId, note }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(note) && card?.textContent?.includes("重新 acknowledge 主 closeout");
              },
              { handoffId: delegatedHandoffID, note: completeNote }
            );
            await page.waitForFunction(
              ({ inboxId, note }) => {
                const card = document.querySelector(`[data-testid="approval-center-signal-${inboxId}"]`);
                return card?.textContent?.includes(note) && card?.textContent?.includes("重新 acknowledge 主 closeout");
              },
              { inboxId: delegatedParent.inboxItemId, note: completeNote }
            );
            assert(
              (await readText(page, `mailbox-status-${delegatedHandoffID}`)) === handoffStatusLabel("blocked"),
              "parent delegated closeout should stay blocked until target re-acknowledges"
            );
            await capture(page, "delivery-delegation-parent-response-complete-sync");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Resume Signal Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-resume -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-77";
            reportTestCase = "TC-066";
            reportScope = "delivery-reply progress sync back to parent handoff、mailbox/inbox resume signal、blocked lifecycle preservation";
            resultLines = [
              "- `delivery-reply` response comment 现在会直接回推到父级 delegated closeout handoff card，而不是让 target 只能盯 PR detail 才知道 source 已开始补 unblock response -> PASS",
              "- source 完成 response 后，父级 handoff 的 inbox signal 也会明确写回最新 unblock note 和 `重新 acknowledge 主 closeout` 提示，跨 Agent 收口不再停在子 ledger 局部状态 -> PASS",
              "- 整个 resume signal sync 过程中，父级 delegated closeout 继续保持 `blocked`，直到 target 自己重新 acknowledge，主 lifecycle 没有被 response completion 偷偷篡改 -> PASS",
            ];
          } else if (runMode === "delegate-visibility") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");
            await waitForTestIdText(
              page,
              `mailbox-response-status-${delegatedHandoffID}`,
              mailboxReplyStatusLabel("requested")
            );
            await waitForTestIdText(
              page,
              `mailbox-response-attempts-${delegatedHandoffID}`,
              mailboxResponseAttemptsLabel(1)
            );
            await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await capture(page, "delivery-delegation-parent-mailbox-requested");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "mailbox parent card should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during delegate visibility run"
            );

            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            const responseKindLabel = await readText(page, `mailbox-kind-${responseHandoffID}`);
            assert(
              responseKindLabel === mailboxKindLabel("delivery-reply"),
              `response mailbox card should surface delivery-reply kind, got ${responseKindLabel || "<empty>"}`
            );
            await page.getByTestId(`mailbox-parent-chip-${responseHandoffID}`).waitFor({ state: "visible" });
            await page.getByTestId(`mailbox-parent-link-${responseHandoffID}`).waitFor({ state: "visible" });
            await capture(page, "delivery-response-mailbox-parent-link");

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await page.reload({ waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            await waitForActionEnabled(page, `mailbox-action-completed-${responseHandoffID}`);
            await page.getByTestId(`mailbox-note-${responseHandoffID}`).fill("release receipt checklist 已补齐，请重新接住 delivery closeout。");
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });
            await page.reload({ waitUntil: "load" });
            await waitForMailboxStatus(page, responseHandoffID, "completed");

            await page.getByTestId(`mailbox-parent-link-${responseHandoffID}`).click();
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await waitForTestIdText(
              page,
              `mailbox-response-status-${delegatedHandoffID}`,
              mailboxReplyStatusLabel("completed")
            );
            await waitForTestIdText(
              page,
              `mailbox-response-attempts-${delegatedHandoffID}`,
              mailboxResponseAttemptsLabel(1)
            );
            assert(
              (await readText(page, `mailbox-status-${delegatedHandoffID}`)) === handoffStatusLabel("blocked"),
              "parent delegated closeout should remain blocked after response completion"
            );
            await capture(page, "delivery-delegation-parent-mailbox-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Visibility Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-visibility -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-78";
            reportTestCase = "TC-067";
            reportScope = "delegated closeout parent/child mailbox visibility、reply status chips、parent/response deep links";
            resultLines = [
              "- 父级 delegated closeout handoff 现在会直接在 Mailbox card 上显示 `reply requested / reply completed` 与 `reply x1`，target 不必离开 mailbox 才知道 unblock response 进度 -> PASS",
              "- `delivery-reply` child handoff 现在会显式标出 parent closeout，并支持 `Open Parent Closeout` 回跳，parent/child orchestration 在 mailbox 内已经成型 -> PASS",
              "- response 完成后，回到父级 closeout card 仍能看到 `reply completed`，而主 handoff 继续保持 `blocked`，child visibility 没有偷改主 lifecycle -> PASS",
            ];
          } else if (runMode === "delegate-resume-parent") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during resume-parent run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });

            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            await page.getByTestId(`mailbox-action-resume-parent-${responseHandoffID}`).waitFor({ state: "visible" });
            await capture(page, "delivery-response-resume-parent-ready");

            await page.getByTestId(`mailbox-action-resume-parent-${responseHandoffID}`).click();

            await page.getByTestId(`mailbox-parent-link-${responseHandoffID}`).click();
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await waitForMailboxStatus(page, delegatedHandoffID, "acknowledged");
            assert(
              (await readText(page, `mailbox-response-status-${delegatedHandoffID}`)) ===
                mailboxReplyStatusLabel("completed"),
              "parent card should preserve completed response chip after resume"
            );
            await capture(page, "delivery-response-parent-resumed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Resume Parent Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-resume-parent -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-79";
            reportTestCase = "TC-068";
            reportScope = "delivery-reply child-ledger resume action、parent closeout re-ack orchestration、response chip preservation";
            resultLines = [
              "- child `delivery-reply` 完成后，Mailbox 现在会直接给出 `Resume Parent Closeout`，blocker agent 不必手动回找父级 closeout 再 re-ack -> PASS",
              "- 点击 child ledger 上的 resume 动作后，父级 delegated closeout 会直接切到 `acknowledged`，跨 Agent closeout orchestration 已从可见升级为可操作 -> PASS",
              "- parent closeout 被重新接住后，父级 card 仍保留 `reply completed` 这条子链路真相，resume 动作不会把 response evidence 冲掉 -> PASS",
            ];
          } else if (runMode === "delegate-history-sync") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during history-sync run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });

	            const delegatedParent = await waitForMailboxWhere(
	              serverURL,
	              (item) => item.id === delegatedHandoffID,
	              "delegated closeout missing during history-sync resume"
	            );
	            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
	              method: "POST",
	              body: JSON.stringify({
	                action: "acknowledged",
	                actingAgentId: delegatedParent.toAgentId,
	              }),
	            });
	            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
	            assert(
	              ((await readText(page, "delivery-delegation-summary")).includes("第 1 轮") &&
                (await readText(page, "delivery-delegation-summary")).includes("已重新 acknowledge final delivery closeout")),
              "PR detail summary should preserve response history after parent resume"
            );
            const resumedInboxText =
              (await page.getByTestId("pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18").textContent())?.trim() ?? "";
            assert(
              resumedInboxText.includes("第 1 轮") && resumedInboxText.includes("已重新 acknowledge final delivery closeout"),
              "related inbox should preserve response history after parent resume"
            );
	            await capture(page, "delivery-response-history-resumed");

	            await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${delegatedHandoffID}`, { waitUntil: "load" });
	            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
	            const resumedParent = await waitForMailboxWhere(
	              serverURL,
	              (item) => item.id === delegatedHandoffID,
	              "delegated closeout missing during history-sync completion"
	            );
	            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
	              method: "POST",
	              body: JSON.stringify({
	                action: "completed",
	                actingAgentId: resumedParent.toAgentId,
	                note: "最终 delivery closeout 已收口，等待 merge / release receipt。",
	              }),
	            });
	            await page.reload({ waitUntil: "load" });
            await waitForMailboxStatus(page, delegatedHandoffID, "completed");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            assert(
              ((await readText(page, "delivery-delegation-summary")).includes("第 1 轮") &&
                (await readText(page, "delivery-delegation-summary")).includes("也已完成 final delivery closeout")),
              "PR detail summary should preserve response history after parent closeout completion"
            );
            const completedInboxText =
              (await page.getByTestId("pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18").textContent())?.trim() ?? "";
            assert(
              completedInboxText.includes("第 1 轮") && completedInboxText.includes("也已完成 final delivery closeout"),
              "related inbox should preserve response history after parent closeout completion"
            );
            await capture(page, "delivery-response-history-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate History Sync Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-history-sync -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-80";
            reportTestCase = "TC-069";
            reportScope = "delivery reply history preservation across parent resume/completion, PR detail summary, related inbox sync";
            resultLines = [
              "- child reply 把 parent closeout 重新接住后，PR detail `Delivery Delegation` summary 仍会保留 `reply xN / 第 N 轮 unblock response` 历史，而不会在 resume 后消失 -> PASS",
              "- parent closeout 重新 `acknowledged` 后，related inbox signal 也会同步保留这段 response 历史，不会只剩抽象的 active/done 状态 -> PASS",
              "- parent closeout 最终 `completed` 后，PR detail 与 related inbox 仍会带着这段 reply 历史一起收口，single delivery contract 现在覆盖到整条跨 Agent closeout 尾链 -> PASS",
            ];
          } else if (runMode === "delegate-parent-status") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during parent-status run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });

            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            assert(
              (await readText(page, `mailbox-parent-status-${responseHandoffID}`)) ===
                mailboxParentStatusLabel("blocked"),
              "child response card should show blocked parent status before resume"
            );
            await capture(page, "delivery-response-parent-blocked");

            const delegatedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during parent-status resume"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: delegatedParent.toAgentId,
              }),
            });
            await page.reload({ waitUntil: "load" });
            assert(
              (await readText(page, `mailbox-parent-status-${responseHandoffID}`)) ===
                mailboxParentStatusLabel("acknowledged"),
              "child response card should show acknowledged parent status after resume"
            );
            await capture(page, "delivery-response-parent-acknowledged");

            const resumedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during parent-status completion"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: resumedParent.toAgentId,
                note: "最终 delivery closeout 已收口，等待 merge / release receipt。",
              }),
            });
            await page.reload({ waitUntil: "load" });
            assert(
              (await readText(page, `mailbox-parent-status-${responseHandoffID}`)) ===
                mailboxParentStatusLabel("completed"),
              "child response card should show completed parent status after closeout finishes"
            );
            await capture(page, "delivery-response-parent-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Parent Status Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-parent-status -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-81";
            reportTestCase = "TC-070";
            reportScope = "delivery-reply child-ledger parent blocked/acknowledged/completed visibility";
            resultLines = [
              "- child `delivery-reply` card 现在会直接显示 parent 当前是 `blocked / acknowledged / completed`，source agent 不必离开 child ledger 才知道主 closeout 状态 -> PASS",
              "- parent closeout 重新被接住后，child card 会即时切到 `parent acknowledged`，response 不再像黑盒一样停在“reply completed” -> PASS",
              "- parent closeout 最终收口后，child card 还会继续显示 `parent completed`，跨 Agent closeout 尾链现在能在 child ledger 里直接回放 -> PASS",
            ];
          } else if (runMode === "delegate-parent-context") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during parent-context run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });

            const delegatedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during parent-context resume"
            );
            const delegatedRunID = delegatedParent.runId;
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: delegatedParent.toAgentId,
              }),
            });

            await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${delegatedHandoffID}`, { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await page.waitForFunction(
              ({ handoffId, marker }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(marker) ?? false;
              },
              { handoffId: delegatedHandoffID, marker: "已重新 acknowledge final delivery closeout" }
            );
            const resumedParentCardText = (await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).textContent())?.trim() ?? "";
            assert(
              resumedParentCardText.includes("第 1 轮") && resumedParentCardText.includes("已重新 acknowledge final delivery closeout"),
              "parent mailbox card should preserve reply history after resume"
            );
            await capture(page, "delivery-parent-context-resumed-mailbox");

            await page.goto(`${webURL}/runs/${delegatedRunID}`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ runId, marker }) => {
                const bodyText = document.body?.textContent ?? "";
                return bodyText.includes(runId) && bodyText.includes(marker);
              },
              { runId: delegatedRunID, marker: "已重新 acknowledge final delivery closeout" }
            );
            const resumedRunText = (await page.locator("body").textContent())?.trim() ?? "";
            assert(
              resumedRunText.includes("第 1 轮") && resumedRunText.includes("已重新 acknowledge final delivery closeout"),
              "run detail should preserve reply history after parent resume"
            );
            await capture(page, "delivery-parent-context-resumed-run");

            const resumedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during parent-context completion"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: resumedParent.toAgentId,
                note: "最终 delivery closeout 已收口，等待 merge / release receipt。",
              }),
            });

            await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${delegatedHandoffID}`, { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await page.waitForFunction(
              ({ handoffId, marker }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(marker) ?? false;
              },
              { handoffId: delegatedHandoffID, marker: "也已完成 final delivery closeout" }
            );
            const completedParentCardText = (await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).textContent())?.trim() ?? "";
            assert(
              completedParentCardText.includes("第 1 轮") && completedParentCardText.includes("也已完成 final delivery closeout"),
              "parent mailbox card should preserve reply history after completion"
            );
            await capture(page, "delivery-parent-context-completed-mailbox");

            await page.goto(`${webURL}/runs/${delegatedRunID}`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ runId, marker }) => {
                const bodyText = document.body?.textContent ?? "";
                return bodyText.includes(runId) && bodyText.includes(marker);
              },
              { runId: delegatedRunID, marker: "也已完成 final delivery closeout" }
            );
            const completedRunText = (await page.locator("body").textContent())?.trim() ?? "";
            assert(
              completedRunText.includes("第 1 轮") && completedRunText.includes("也已完成 final delivery closeout"),
              "run detail should preserve reply history after parent completion"
            );
            await capture(page, "delivery-parent-context-completed-run");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Parent Context Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-parent-context -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-82";
            reportTestCase = "TC-071";
            reportScope = "parent delegated closeout mailbox/run context preservation after reply-driven resume/completion";
            resultLines = [
              "- parent delegated closeout 重新 `acknowledged` 后，parent mailbox card 会继续保留 `第 N 轮 unblock response` 历史，而不是退回成抽象 resume 文案 -> PASS",
              "- 同一次 resume 后，Run detail 的下一步与 resume context 也会继续带着这段 reply 历史，target 不必回到 PR detail 才知道这次 closeout 为什么重开 -> PASS",
              "- parent delegated closeout 最终 `completed` 后，Mailbox 与 Run 仍会带着这段 response history 一起收口，parent surface 不再吞掉 child `delivery-reply` 上下文 -> PASS",
            ];
          } else if (runMode === "delegate-child-context") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during child-context run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });

            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            assert(
              (await readText(page, `mailbox-parent-status-${responseHandoffID}`)) ===
                mailboxParentStatusLabel("blocked"),
              "child response card should start from blocked parent state"
            );

            const delegatedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during child-context resume"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: delegatedParent.toAgentId,
              }),
            });
            await page.reload({ waitUntil: "load" });
            assert(
              (await readText(page, `mailbox-parent-status-${responseHandoffID}`)) ===
                mailboxParentStatusLabel("acknowledged"),
              "child response card should show acknowledged parent status after resume"
            );
            assert(
              (await readText(page, `mailbox-last-action-${responseHandoffID}`)).includes("已重新 acknowledge 主 closeout"),
              "child response last action should sync to parent acknowledged"
            );
            await capture(page, "delivery-response-child-context-acknowledged");

            const resumedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during child-context completion"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: resumedParent.toAgentId,
                note: "最终 delivery closeout 已收口，等待 merge / release receipt。",
              }),
            });
            await page.reload({ waitUntil: "load" });
            assert(
              (await readText(page, `mailbox-parent-status-${responseHandoffID}`)) ===
                mailboxParentStatusLabel("completed"),
              "child response card should show completed parent status after closeout finishes"
            );
            assert(
              (await readText(page, `mailbox-last-action-${responseHandoffID}`)).includes("已完成主 closeout"),
              "child response last action should sync to parent completion"
            );
            await capture(page, "delivery-response-child-context-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Child Context Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-child-context -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-83";
            reportTestCase = "TC-072";
            reportScope = "delivery-reply child-ledger last-action synchronization after parent resume/completion";
            resultLines = [
              "- child `delivery-reply` 不再只有一个前滚的 parent-status chip；parent 重新接住主 closeout 后，child `lastAction` 也会同步变成 parent acknowledged 的真实状态 -> PASS",
              "- parent 最终 `completed` 后，child card 的正文会继续前滚到 parent completed，而不是卡在旧的“等待 parent 重新 acknowledge”文案 -> PASS",
              "- source agent 现在在 child ledger 里既能看到 parent status，也能看到 parent follow-through 的正文真相，跨 Agent closeout 不再只靠 chip 猜测 -> PASS",
            ];
          } else if (runMode === "delegate-child-timeline") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            const targetComment = "target 回应：等 owner 签字后我会重新接住。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during child-timeline run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.fromAgentId,
                note: targetComment,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: "release receipt checklist 已补齐，请重新接住 delivery closeout。",
              }),
            });

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              (comment) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(comment),
              targetComment
            );
            await capture(page, "delivery-response-child-timeline-comment-preserved");

            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            const timelineMessages = page.locator(`[data-testid^="mailbox-message-${responseHandoffID}-"]`);
            assert(
              ((await page.getByTestId(`mailbox-card-${responseHandoffID}`).textContent()) ?? "").includes(targetComment),
              "child response ledger should still show the latest formal comment before parent follow-through"
            );

            const delegatedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during child-timeline resume"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: delegatedParent.toAgentId,
              }),
            });
            await page.reload({ waitUntil: "load" });
            assert(
              (await readText(page, `mailbox-last-action-${responseHandoffID}`)).includes("已重新 acknowledge 主 closeout"),
              "child response last action should sync to parent acknowledged during timeline replay"
            );
            const resumedTimelineMessage = (await timelineMessages.last().textContent())?.trim() ?? "";
            assert(
              resumedTimelineMessage.includes(mailboxMessageKindLabel("parent-progress")) &&
                resumedTimelineMessage.includes("已重新 acknowledge 主 closeout"),
              "child response lifecycle messages should append parent-progress entry after parent resume"
            );
            await capture(page, "delivery-response-child-timeline-acknowledged");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ comment, marker }) => {
                const text = document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent ?? "";
                return text.includes(comment) && text.includes(marker);
              },
              { comment: targetComment, marker: "已重新 acknowledge final delivery closeout" }
            );
            await capture(page, "delivery-response-child-timeline-pr-acknowledged");

            const resumedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during child-timeline completion"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: resumedParent.toAgentId,
                note: "最终 delivery closeout 已收口，等待 merge / release receipt。",
              }),
            });
            await page.goto(responseURL.toString(), { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${responseHandoffID}`).waitFor({ state: "visible" });
            const completedTimelineMessage = (await timelineMessages.last().textContent())?.trim() ?? "";
            assert(
              completedTimelineMessage.includes(mailboxMessageKindLabel("parent-progress")) &&
                completedTimelineMessage.includes("已完成主 closeout"),
              "child response lifecycle messages should append parent-progress completion entry"
            );
            await capture(page, "delivery-response-child-timeline-completed");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await page.waitForFunction(
              ({ comment, marker }) => {
                const text = document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent ?? "";
                return text.includes(comment) && text.includes(marker);
              },
              { comment: targetComment, marker: "也已完成 final delivery closeout" }
            );
            await capture(page, "delivery-response-child-timeline-pr-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Child Timeline Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-child-timeline -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-84";
            reportTestCase = "TC-073";
            reportScope = "delivery-reply lifecycle messages parent-progress sync with latest formal comment preservation";
            resultLines = [
              "- child `delivery-reply` 的 lifecycle messages 现在会显式追加 parent-progress 事件；source 打开 child ledger 历史时，不再像 parent 后续从未接住过这条 closeout -> PASS",
              "- parent 重新 `acknowledged` / 最终 `completed` 后，child ledger 的最新 timeline entry 会分别写出这两次 follow-through，而不是只改卡片摘要 -> PASS",
              "- PR detail `Delivery Delegation` summary 在这些后续 lifecycle 之后仍会保留最新 formal comment，说明 parent-progress 事件没有把 comment truth 洗掉 -> PASS",
            ];
          } else if (runMode === "delegate-parent-timeline") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            const sourceComment = "source 说明：release receipt checklist 正在补。";
            const completeNote = "release receipt checklist 已补齐，请重新接住 delivery closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during parent-timeline run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.toAgentId,
                note: sourceComment,
              }),
            });

            const parentURL = `${webURL}/inbox?handoffId=${delegatedHandoffID}&roomId=room-runtime`;
            await page.goto(parentURL, { waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            const parentTimelineMessages = page.locator(`[data-testid^="mailbox-message-${delegatedHandoffID}-"]`);
            const commentTimelineMessage = (await parentTimelineMessages.last().textContent())?.trim() ?? "";
            assert(
              commentTimelineMessage.includes(mailboxMessageKindLabel("response-progress")) &&
                commentTimelineMessage.includes(sourceComment),
              "parent ledger should append response-progress timeline entry after child response comment"
            );
            await capture(page, "delivery-parent-timeline-comment");

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: completeNote,
              }),
            });

            await page.reload({ waitUntil: "load" });
            const completionTimelineMessage = (await parentTimelineMessages.last().textContent())?.trim() ?? "";
            assert(
              completionTimelineMessage.includes(mailboxMessageKindLabel("response-progress")) &&
                completionTimelineMessage.includes(completeNote),
              "parent ledger should append response-progress completion entry after child response complete"
            );
            await capture(page, "delivery-parent-timeline-response-completed");

            const resumedParent = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === delegatedHandoffID,
              "delegated closeout missing during parent-timeline resume"
            );
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: resumedParent.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${delegatedHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: resumedParent.toAgentId,
                note: "最终 delivery closeout 已收口，等待 merge / release receipt。",
              }),
            });

            await page.reload({ waitUntil: "load" });
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await waitForMailboxStatus(page, delegatedHandoffID, "completed");
            await page.waitForFunction(
              (handoffId) => {
                const text = document.querySelector(`[data-testid="mailbox-last-action-${handoffId}"]`)?.textContent ?? "";
                return text.includes("也已完成 final delivery closeout");
              },
              delegatedHandoffID
            );
            const parentTimelineTexts = await parentTimelineMessages.allTextContents();
            assert(
              parentTimelineTexts.some(
                (text) => text.includes(mailboxMessageKindLabel("response-progress")) && text.includes(sourceComment)
              ),
              "parent ledger should preserve response-progress comment history after parent follow-through"
            );
            assert(
              parentTimelineTexts.some(
                (text) => text.includes(mailboxMessageKindLabel("response-progress")) && text.includes(completeNote)
              ),
              "parent ledger should preserve response-progress completion history after parent follow-through"
            );
            await capture(page, "delivery-parent-timeline-preserved-after-parent-complete");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Parent Timeline Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-parent-timeline -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-85";
            reportTestCase = "TC-074";
            reportScope = "parent delegated closeout lifecycle messages for child response progress";
            resultLines = [
              "- child `delivery-reply` 的 formal comment 和 response complete 现在都会在 parent delegated closeout 的 lifecycle messages 里显式落成 `response progress`，target 深看 parent ledger 时不再只剩一条被覆盖的摘要 -> PASS",
              "- parent 自己后续重新 `acknowledged` / `completed` 后，这些 response-progress timeline entry 仍会保留在 parent ledger 历史里，而不是被 parent 自己的新动作洗掉 -> PASS",
              "- parent card 现在不只会在 `lastAction` 上知道 child reply 的进度；它自己的时间线也能完整回放这条跨 Agent closeout 的 child response 轨迹 -> PASS",
            ];
          } else if (runMode === "delegate-room-trace") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            const sourceComment = "source 说明：release receipt checklist 正在补。";
            const completeNote = "release receipt checklist 已补齐，请重新接住 delivery closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during room-trace run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "comment",
                actingAgentId: responseHandoff.toAgentId,
                note: sourceComment,
              }),
            });

            const roomURL = `${webURL}/rooms/room-runtime?tab=chat`;
            await page.goto(roomURL, { waitUntil: "load" });
            await page.getByTestId("room-message-list").waitFor({ state: "visible" });
            await page.waitForFunction(
              ({ comment }) => {
                const text = document.querySelector('[data-testid="room-message-list"]')?.textContent ?? "";
                return text.includes("[Mailbox Sync]") && text.includes(comment) && text.includes("重新 acknowledge 主 closeout");
              },
              { comment: sourceComment }
            );
            await capture(page, "delivery-room-trace-comment");

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "acknowledged",
                actingAgentId: responseHandoff.toAgentId,
              }),
            });
            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "completed",
                actingAgentId: responseHandoff.toAgentId,
                note: completeNote,
              }),
            });

            await page.reload({ waitUntil: "load" });
            await page.waitForFunction(
              ({ comment, complete }) => {
                const text = document.querySelector('[data-testid="room-message-list"]')?.textContent ?? "";
                return text.includes("[Mailbox Sync]") && text.includes(comment) && text.includes(complete);
              },
              { comment: sourceComment, complete: completeNote }
            );
            await capture(page, "delivery-room-trace-response-completed");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Room Trace Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-room-trace -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-86";
            reportTestCase = "TC-075";
            reportScope = "room chat trace for parent-synced child response progress";
            resultLines = [
              "- child `delivery-reply` 的 formal comment 现在不只写进 Mailbox / PR / Inbox；Room 主消息流也会追加 `[Mailbox Sync]` 叙事，直接说明 parent closeout 已收到这轮 unblock context -> PASS",
              "- child `delivery-reply` 完成后，Room 主消息流还会继续写出 parent 已同步的 completion guidance，房间里不需要先跳 Mailbox 才知道谁该重新接住主 closeout -> PASS",
              "- Room 历史会同时保留 comment sync 和 completion sync 两条 `[Mailbox Sync]` 记录，跨 Agent closeout 的 parent/child orchestration 不再只藏在局部 ledger 里 -> PASS",
            ];
          } else if (runMode === "delegate-room-trace-blocked") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            const responseBlockNote = "source 也卡住了：release owner 还没签字。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");
            await capture(page, "delivery-delegated-handoff-blocked");

            const responseHandoffHref = await page.getByTestId(`mailbox-response-link-${delegatedHandoffID}`).getAttribute("href");
            assert(responseHandoffHref, "parent delegated closeout should expose response handoff link");
            const responseURL = new URL(responseHandoffHref, webURL);
            const responseHandoffID = responseURL.searchParams.get("handoffId");
            assert(responseHandoffID, "response link should include handoffId");
            const responseHandoff = await waitForMailboxWhere(
              serverURL,
              (item) => item.id === responseHandoffID,
              "response handoff missing during blocked room-trace run"
            );

            await fetchJSON(`${serverURL}/v1/mailbox/${responseHandoffID}`, {
              method: "POST",
              body: JSON.stringify({
                action: "blocked",
                actingAgentId: responseHandoff.toAgentId,
                note: responseBlockNote,
              }),
            });

            const roomURL = `${webURL}/rooms/room-runtime?tab=chat`;
            await page.goto(roomURL, { waitUntil: "load" });
            await page.getByTestId("room-message-list").waitFor({ state: "visible" });
            await page.waitForFunction(
              ({ note }) => {
                const text = document.querySelector('[data-testid="room-message-list"]')?.textContent ?? "";
                return text.includes("[Mailbox Sync]") && text.includes(note) && text.includes("当前也 blocked");
              },
              { note: responseBlockNote }
            );
            await capture(page, "delivery-room-trace-response-blocked");

            reportTitle = "# 2026-04-11 Governed Mailbox Delegate Blocked Room Trace Report";
            reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-room-trace-blocked -- --report ${path.relative(projectRoot, reportPath)}`;
            reportTicket = "TKT-87";
            reportTestCase = "TC-076";
            reportScope = "room chat trace for blocked child response progress";
            resultLines = [
              "- child `delivery-reply` 如果自己再次 `blocked`，Room 主消息流现在也会追加 `[Mailbox Sync]` 叙事，不再只在 Mailbox / PR / Inbox 里留下这一层阻塞 -> PASS",
              "- 这条 room trace 会明确保留 child response 的 blocker note，并写出“当前也 blocked / 主 closeout 继续保持 blocked”的 parent guidance，房间里可以直接读懂谁还卡着 -> PASS",
              "- 即使 unblock 链路二次受阻，跨 Agent closeout 的关键状态仍会写回 room shell；Room 不再只会显示乐观的 comment / complete 同步 -> PASS",
            ];
          } else if (runMode === "delegate-lifecycle") {
            const blockNote = "需要先确认最终 release 文案，再继续 closeout。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(blockNote);
            await page.getByTestId(`mailbox-action-blocked-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "blocked");
            await page.waitForFunction(
              ({ handoffId, note }) => {
                const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
                return card?.textContent?.includes(note) ?? false;
              },
              { handoffId: delegatedHandoffID, note: blockNote }
            );
            await capture(page, "delivery-delegated-handoff-blocked");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(page, "delivery-delegation-status", deliveryDelegationStatusLabel("blocked"));
            assert(
              (await readText(page, "delivery-delegation-handoff-status")) ===
                deliveryDelegationHandoffStatusLabel("blocked"),
              "blocked delegated handoff should flow back into PR detail"
            );
            await page.waitForFunction(
              ({ note }) => document.querySelector('[data-testid="delivery-delegation-summary"]')?.textContent?.includes(note),
              { note: blockNote }
            );
            await page.waitForFunction(
              ({ note }) =>
                document
                  .querySelector('[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]')
                  ?.textContent?.includes(note) ?? false,
              { note: blockNote }
            );
            await capture(page, "pull-request-delivery-delegation-blocked");

            await page.getByTestId("delivery-delegation-open").click();
            await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
            await page.getByTestId(`mailbox-action-acknowledged-${delegatedHandoffID}`).click();
            await waitForActionEnabled(page, `mailbox-action-completed-${delegatedHandoffID}`);
            const completeNote = "最终 delivery closeout 已收口，等待 merge / release receipt。";
            await page.getByTestId(`mailbox-note-${delegatedHandoffID}`).fill(completeNote);
            await page.getByTestId(`mailbox-action-completed-${delegatedHandoffID}`).click();
            await waitForMailboxStatus(page, delegatedHandoffID, "completed");
            await capture(page, "delivery-delegated-handoff-completed");

            await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
            await waitForTestIdText(page, "delivery-delegation-status", deliveryDelegationStatusLabel("done"));
            assert(
              (await readText(page, "delivery-delegation-handoff-status")) ===
                deliveryDelegationHandoffStatusLabel("completed"),
              "completed delegated handoff should show completed status in PR detail"
            );
            await page.waitForFunction(() => {
              return (
                document
                  .querySelector('[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]')
                  ?.textContent?.includes("已完成") ?? false
              );
            });
            await capture(page, "pull-request-delivery-delegation-done");
          }
        }
      }

      if (runMode !== "delegate-policy" && runMode !== "delegate-auto-complete" && runMode !== "delegate-comment-sync") {
        await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
        await waitForGovernanceStatus(page, "mailbox-compose-governed-route-status", "done");
        await page.getByTestId("mailbox-compose-governed-route-closeout").waitFor({ state: "visible" });
        await capture(page, "governed-compose-closeout-ready");
      }

      if (runMode !== "delegate-policy" && runMode !== "delegate-auto-complete" && runMode !== "delegate-comment-sync") {
        if (runMode === "delegate-response") {
          // report metadata already set inside the delegate-response branch above
        } else if (runMode === "delegate-retry") {
          // report metadata already set inside the delegate-retry branch above
        } else if (runMode === "delegate-response-comment-sync") {
          // report metadata already set inside the delegate-response-comment-sync branch above
        } else if (runMode === "delegate-communication-thread") {
          // report metadata already set inside the delegate-communication-thread branch above
        } else if (runMode === "delegate-thread-actions") {
          // report metadata already set inside the delegate-thread-actions branch above
        } else if (runMode === "delegate-resume") {
          // report metadata already set inside the delegate-resume branch above
        } else if (runMode === "delegate-visibility") {
          // report metadata already set inside the delegate-visibility branch above
        } else if (runMode === "delegate-resume-parent") {
          // report metadata already set inside the delegate-resume-parent branch above
        } else if (runMode === "delegate-history-sync") {
          // report metadata already set inside the delegate-history-sync branch above
        } else if (runMode === "delegate-parent-status") {
          // report metadata already set inside the delegate-parent-status branch above
        } else if (runMode === "delegate-parent-context") {
          // report metadata already set inside the delegate-parent-context branch above
        } else if (runMode === "delegate-child-context") {
          // report metadata already set inside the delegate-child-context branch above
        } else if (runMode === "delegate-child-timeline") {
          // report metadata already set inside the delegate-child-timeline branch above
        } else if (runMode === "delegate-parent-timeline") {
          // report metadata already set inside the delegate-parent-timeline branch above
        } else if (runMode === "delegate-room-trace") {
          // report metadata already set inside the delegate-room-trace branch above
        } else if (runMode === "delegate-room-trace-blocked") {
          // report metadata already set inside the delegate-room-trace-blocked branch above
        } else if (runMode === "delegate-lifecycle") {
          reportTitle = "# 2026-04-11 Governed Mailbox Delegate Lifecycle Sync Report";
          reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-lifecycle -- --report ${path.relative(projectRoot, reportPath)}`;
          reportTicket = "TKT-70";
          reportTestCase = "TC-059";
          reportScope = "delegated closeout blocked sync、completed sync、PR detail + inbox signal lifecycle";
          resultLines = [
            "- delegated closeout handoff 进入 `blocked` 后，PR detail 的 `Delivery Delegation` card 会立即切到 `delegate blocked`，并把 blocker note 同步回 deterministic inbox signal -> PASS",
            "- delegated handoff 重新 acknowledge 并 `completed` 后，PR detail 会切到 `delegation done` / `handoff completed`，说明 closeout orchestration 的 lifecycle 已真正回写到 delivery contract -> PASS",
            "- 整个 delegated lifecycle 过程中，governed route 仍维持 final-lane done-state closeout 回链，没有因为额外 closeout handoff 被错误冲回 active governance -> PASS",
          ];
        } else if (runMode === "delegate-handoff") {
          reportTitle = "# 2026-04-11 Governed Mailbox Delegated Closeout Handoff Report";
          reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-handoff -- --report ${path.relative(projectRoot, reportPath)}`;
          reportTicket = "TKT-69";
          reportTestCase = "TC-058";
          reportScope = "governed final closeout auto-create、delegated mailbox handoff、PR detail handoff backlink";
          resultLines = [
            "- QA final lane closeout 后，系统不会只停在 `delegate ready` 提示，而是会继续自动创建 `Memory Clerk -> Spec Captain` 的 formal delivery closeout handoff -> PASS",
            "- PR delivery entry 的 `Delivery Delegation` card 会保留 `PM · Spec Captain` 目标，同时新增 `handoff requested` 状态与 handoff deep link，说明 delegate signal 已经升级为可执行 contract -> PASS",
            "- 点击 delegation card 的 handoff link 后，Inbox / Mailbox 会直接聚焦到新创建的 closeout handoff，证明 post-QA orchestration 已经进入正式 mailbox ledger，而没有把治理 done-state 冲回 active governed route -> PASS",
          ];
        } else if (runMode === "delegation") {
          reportTitle = "# 2026-04-11 Governed Mailbox Delivery Delegation Report";
          reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegation -- --report ${path.relative(projectRoot, reportPath)}`;
          reportTicket = "TKT-68";
          reportTestCase = "TC-057";
          reportScope = "governed final closeout delegation、delivery delegate card、PR-related inbox signal";
          resultLines = [
            "- QA final lane closeout 后，`/mailbox` 与 Inbox compose 继续围同一条 governed done-state closeout 回链工作，不会把治理链和 delivery closeout 拆成两套真相 -> PASS",
            "- 打开 PR delivery entry 后，`Delivery Delegation` card 会显式给出 `delegate ready`、`PM · Spec Captain` 目标与 summary，说明 final closeout 已经被委托回 owner lane，而不是只停在抽象 done 文案 -> PASS",
            "- PR detail 的 related inbox 也会同步出现 `inbox-delivery-delegation-pr-runtime-18` 信号，并回链到同一条 PR detail，证明 delivery delegation 已经进入正式 inbox truth，而不只是页面内推导 -> PASS",
          ];
        } else {
          reportTitle = "# 2026-04-11 Governed Mailbox Closeout Delivery Report";
          reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-closeout -- --report ${path.relative(projectRoot, reportPath)}`;
          reportTicket = "TKT-67";
          reportTestCase = "TC-056";
          reportScope = "governed final-lane done state、delivery entry closeout backlink、PR handoff note sync";
          resultLines = [
            "- QA followup handoff 完成后，`/mailbox` 上的 governed surface 不再停在纯 `done` 文案，而是直接给出 `Open Delivery Entry` closeout 回链 -> PASS",
            "- 最终 lane 收口后，`workspace.governance.routingPolicy.suggestedHandoff` 会切到 `done` 并指向 `/pull-requests/pr-runtime-18`，说明治理链和交付面已经接上同一条 closeout truth -> PASS",
            "- 打开 PR delivery entry 后，operator handoff note 与 evidence 会直接带上 QA closeout note；Inbox compose 也同步显示同一条 done-state closeout 回链 -> PASS",
          ];
        }
      }
    } else {
      reportTitle = "# 2026-04-11 Governed Mailbox Auto-Advance Report";
      reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-auto-advance -- --report ${path.relative(projectRoot, reportPath)}`;
      reportTicket = "TKT-66";
      reportTestCase = "TC-055";
      reportScope = "governed complete + auto-advance、QA followup auto-create、dual-surface active replay";
      resultLines = [
        "- `/mailbox` 上的 `Complete + Auto-Advance` 现在会把当前 governed handoff 正式收口，并继续围当前 topology 自动创建下一棒 formal handoff，而不是要求人类重新手工起单 -> PASS",
        "- 当 QA lane 已映射到 `Memory Clerk` 时，reviewer closeout 会自动前滚出 `Claude Review Runner -> Memory Clerk` 的下一条 handoff，同时 `workspace.governance.routingPolicy.suggestedHandoff` 会切到同一条 `active` 指针 -> PASS",
        "- Inbox compose 与 `/mailbox` 在 auto-advance 后都会继续显示同一条 active followup，focus 回链直接跳到新 handoff，不会停在旧 reviewer ledger 或回退成 `ready`/`blocked` 假状态 -> PASS",
      ];
    }
  } else {
    await page.getByTestId(`mailbox-action-completed-${handoff.id}`).click();
    await page.getByTestId(`mailbox-status-${handoff.id}`).waitFor({ state: "visible" });

    const stateAfterComplete = await readState(serverURL);
    const governedSuggestion = stateAfterComplete.workspace.governance.routingPolicy.suggestedHandoff;
    assert(governedSuggestion.status === "blocked", "next governed handoff should block when QA lane has no mapped agent");
    assert(governedSuggestion.toLaneLabel === "QA", "next governed handoff should point at the QA lane");
    await waitForGovernanceStatus(page, "mailbox-governed-route-status", "blocked");
    await capture(page, "governed-route-next-blocked");

    await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
    await waitForGovernanceStatus(page, "mailbox-compose-governed-route-status", "blocked");
    await capture(page, "governed-compose-next-blocked");

    if (runMode === "auto-create") {
      reportTitle = "# 2026-04-11 Governed Mailbox Auto-Create Report";
      reportTicket = "TKT-65";
      reportTestCase = "TC-054";
      reportScope = "governed one-click create、dual-surface active sync、blocked replay";
      resultLines = [
        "- `/mailbox` 与 Inbox compose 在 `ready` governed route 下都提供 `Create Governed Handoff` 一键入口，不再要求人类重复选择 source / target -> PASS",
        "- 通过 governed route 一键起单后，`/mailbox` 与 Inbox compose 会同步切到同一条 `active` handoff，并提供 focus 回链，避免出现双面状态分裂 -> PASS",
        "- 当前 reviewer handoff 完成后，两处 governed surface 会围同一条 topology truth 一起前滚到下一条 lane；当 QA lane 缺少映射 agent 时，两处都显式 `blocked` -> PASS",
      ];
    }
  }

  const report = [
    reportTitle,
    "",
    `- Ticket: \`${reportTicket}\``,
    `- Checklist: \`${reportChecklist}\``,
    `- Test Case: \`${reportTestCase}\``,
    `- Scope: ${reportScope}`,
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    ...resultLines,
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
