#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt95-cross-room-governance-")));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-cross-room-governance";
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

async function requestJSON(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text.trim()) {
    body = JSON.parse(text);
  }
  return { ok: response.ok, status: response.status, body };
}

async function patchWorkspace(serverURL, body) {
  return fetchJSON(`${serverURL}/v1/workspace`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function postRoomMessage(serverURL, roomId, prompt) {
  return requestJSON(`${serverURL}/v1/rooms/${roomId}/messages`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

function findRollup(state, roomId) {
  return state.workspace.governance.escalationSla?.rollup?.find((item) => item.roomId === roomId) ?? null;
}

async function readText(page, testId) {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
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
    ({ currentHandoffId, currentExpectedLabel }) =>
      document.querySelector(`[data-testid="mailbox-status-${currentHandoffId}"]`)?.textContent?.trim() === currentExpectedLabel,
    { currentHandoffId: handoffId, currentExpectedLabel: expectedLabel },
    { timeout: 30_000 }
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

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await context.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });

  await patchWorkspace(serverURL, {
    governance: {
      teamTopology: [
        { id: "pm", label: "PM", role: "目标与验收", defaultAgent: "Spec Captain", lane: "scope / final response" },
        { id: "architect", label: "Architect", role: "拆解与边界", defaultAgent: "Spec Captain", lane: "shape / split" },
        { id: "developer", label: "Developer", role: "实现与分支推进", defaultAgent: "Build Pilot", lane: "issue -> branch" },
        { id: "reviewer", label: "Reviewer", role: "exact-head verdict", defaultAgent: "Review Runner", lane: "review / blocker" },
        { id: "qa", label: "QA", role: "verify / release evidence", defaultAgent: "Memory Clerk", lane: "test / release gate" },
      ],
    },
  });

  const baselineState = await readState(serverURL);
  const baselineRollupCount = baselineState.workspace.governance.escalationSla?.rollup?.length ?? 0;
  const targetRoom = baselineState.rooms.find((room) => room.id === "room-runtime") ?? baselineState.rooms[0];
  assert(targetRoom, "expected runtime room to exist");
  assert(!findRollup(baselineState, targetRoom.id), "runtime room should not already be hot before orchestration replay");

  await page.goto(`${webURL}/mailbox?roomId=${targetRoom.id}`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governance-escalation-rollup").waitFor({ state: "visible" });
  await capture(page, "mailbox-cross-room-baseline");

  const blockedReplay = await postRoomMessage(
    serverURL,
    targetRoom.id,
    "runtime replay blocked probe: force a real blocked inbox so cross-room governance can orchestrate next route."
  );
  assert(!blockedReplay.ok, "room message should fail without daemon so runtime room becomes a blocked governance hot room");
  assert(
    blockedReplay.status === 502 || blockedReplay.status === 409,
    `room message should fail with runtime error status, received ${blockedReplay.status}`
  );

  const readyState = await waitFor(async () => {
    const state = await readState(serverURL);
    const rollup = findRollup(state, targetRoom.id);
    if (!rollup) {
      return false;
    }
    if (
      rollup.status !== "blocked" ||
      rollup.escalationCount < 1 ||
      rollup.blockedCount < 1 ||
      rollup.currentOwner !== "Codex Dockmaster" ||
      !String(rollup.currentLane ?? "").trim() ||
      rollup.nextRouteStatus !== "ready" ||
      !String(rollup.nextRouteLabel ?? "").includes("Claude Review Runner")
    ) {
      return false;
    }
    return { state, rollup };
  }, "runtime room did not become a blocked cross-room rollup with ready next route");

  await page.goto(`${webURL}/mailbox?roomId=${targetRoom.id}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-governance-escalation-rollup-room-${targetRoom.id}`).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, `mailbox-governance-escalation-rollup-status-${targetRoom.id}`)) === "阻塞",
    "runtime room should appear as blocked in mailbox cross-room rollup"
  );
  await waitFor(
    async () => (await readText(page, `mailbox-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "就绪",
    "runtime room route metadata should be ready before cross-room create"
  );
  assert(
    (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount + 1} rooms`,
    "cross-room rollup count should increase by one after runtime room becomes hot"
  );
  await capture(page, "mailbox-cross-room-route-ready");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-governance-escalation-rollup-room-${targetRoom.id}`).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, `orchestration-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "就绪",
    "orchestration mirror should expose the same ready route metadata before create"
  );
  await capture(page, "orchestration-cross-room-route-ready");

  await page.goto(`${webURL}/mailbox?roomId=${targetRoom.id}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-governance-escalation-rollup-route-create-${targetRoom.id}`).click();

  const activeState = await waitFor(async () => {
    const state = await readState(serverURL);
    const rollup = findRollup(state, targetRoom.id);
    const handoff = state.mailbox.find(
      (item) =>
        item.roomId === targetRoom.id &&
        item.kind === "governed" &&
        item.status === "requested" &&
        item.fromAgent === "Codex Dockmaster" &&
        item.toAgent === "Claude Review Runner"
    );
    if (!rollup || !handoff) {
      return false;
    }
    if (rollup.nextRouteStatus !== "active" || !String(rollup.nextRouteHref ?? "").includes(handoff.id)) {
      return false;
    }
    return { state, rollup, handoff };
  }, "cross-room governed create did not materialize an active handoff for runtime room");

  await page.getByTestId(`mailbox-card-${activeState.handoff.id}`).waitFor({ state: "visible" });
  await waitForMailboxStatus(page, activeState.handoff.id, "requested");
  await waitFor(
    async () => (await readText(page, `mailbox-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "进行中",
    "mailbox rollup should flip route metadata to active after create"
  );
  await capture(page, "mailbox-cross-room-route-active");

  const roomRollupCard = page.getByTestId(`mailbox-governance-escalation-rollup-room-${targetRoom.id}`);
  const nextRouteLink = roomRollupCard.getByRole("link", { name: "打开下一步" });
  await nextRouteLink.waitFor({ state: "visible" });
  const nextRouteHref = await nextRouteLink.getAttribute("href");
  assert(nextRouteHref && nextRouteHref.includes(`handoffId=${activeState.handoff.id}`), "open next route link should deep-link to the created governed handoff");
  await nextRouteLink.click();
  await page.waitForURL((url) => url.toString().includes(`handoffId=${activeState.handoff.id}`), { timeout: 30_000 });
  await page.getByTestId(`mailbox-card-${activeState.handoff.id}`).waitFor({ state: "visible" });
  assert(page.url().includes(`handoffId=${activeState.handoff.id}`), "inbox next-route deep link should focus the created governed handoff");
  await capture(page, "inbox-cross-room-route-focus");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-governance-escalation-rollup-room-${targetRoom.id}`).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, `orchestration-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "进行中",
    "orchestration mirror should flip to active after cross-room create"
  );
  await capture(page, "orchestration-cross-room-route-active");

  const report = [
    "# 2026-04-11 Cross-Room Governance Orchestration Report",
    "",
    "- Ticket: `TKT-95`",
    "- Checklist: `CHK-21`",
    "- Test Case: `TC-084`",
    "- Scope: cross-room rollup route metadata, room-level governed create action, mailbox + orchestration mirror, inbox deep-link",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-cross-room-governance-orchestration -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- runtime room 通过真实 blocked inbox replay 进入 cross-room governance rollup 后，会带出 `current owner / current lane / next governed route` 元数据，不再只剩 room 状态摘要 -> PASS",
    "- `/mailbox` 上的 cross-room rollup 在 route `ready` 时会开放 `Create Governed Handoff`，并通过正式 `POST /v1/mailbox/governed` 合同起单，而不是前端本地拼接 mutation -> PASS",
    "- governed create 成功后，runtime room 的 route metadata 会从 `ready` 切成 `active`，`Open Next Route` 也会深链到新建 handoff；说明 room-level orchestration 已进入正式产品面 -> PASS",
    "- `/agents` 会镜像同一份 route status 与 deep-link，不会出现 mailbox 已 active、orchestration 仍停在 ready 的分裂真相 -> PASS",
    "",
    "## Assertions",
    "",
    `- Baseline rollup length: ${baselineRollupCount}`,
    `- Ready route: ${readyState.rollup.currentOwner} / ${readyState.rollup.currentLane} / ${readyState.rollup.nextRouteLabel}`,
    `- Created handoff: ${activeState.handoff.id} (${activeState.handoff.fromAgent} -> ${activeState.handoff.toAgent})`,
    `- Active route href: ${activeState.rollup.nextRouteHref}`,
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
