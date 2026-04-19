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
  const result = { reportPath: "", mode: "orchestration" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--report") {
      result.reportPath = args[index + 1] ?? "";
      index += 1;
    } else if (args[index] === "--mode") {
      result.mode = args[index + 1] ?? "orchestration";
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

async function patchMailboxHandoff(serverURL, handoffId, body) {
  return requestJSON(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function readPullRequestDetail(serverURL, pullRequestId) {
  return fetchJSON(`${serverURL}/v1/pull-requests/${pullRequestId}/detail`, { cache: "no-store" });
}

function findRollup(state, roomId) {
  return state.workspace.governance.escalationSla?.rollup?.find((item) => item.roomId === roomId) ?? null;
}

async function readText(page, testId) {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
}

async function readTextIfPresent(page, testId) {
  const locator = page.getByTestId(testId);
  if ((await locator.count()) === 0) {
    return "";
  }
  return (await locator.first().textContent())?.trim() ?? "";
}

async function readLocatorText(locator) {
  return (await locator.textContent())?.trim() ?? "";
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
      ...(parsedArgs.mode === "auto-closeout" ? { deliveryDelegationMode: "auto-complete" } : {}),
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
  await page.getByTestId("mailbox-governance-escalation-graph").waitFor({ state: "visible" });
  await page.getByTestId(`mailbox-governance-escalation-graph-room-${targetRoom.id}`).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, `mailbox-governance-escalation-rollup-status-${targetRoom.id}`)) === "阻塞",
    "runtime room should appear as blocked in mailbox cross-room rollup"
  );
  await waitFor(
    async () => (await readText(page, `mailbox-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "就绪",
    "runtime room route metadata should be ready before cross-room create"
  );
  await waitFor(
    async () => {
      const ownerText = await readText(page, `mailbox-governance-escalation-graph-owner-${targetRoom.id}`);
      return ownerText.includes("当前负责人") && !ownerText.includes("等待负责人") && !ownerText.includes("待补齐");
    },
    "mailbox governance graph should surface a resolved current owner node for the hot room"
  );
  await waitFor(
    async () => {
      const routeText = await readText(page, `mailbox-governance-escalation-graph-route-${targetRoom.id}`);
      return routeText.includes("下一棒") && !routeText.includes("等待下一棒") && !routeText.includes("正在整理中");
    },
    "mailbox governance graph should surface a resolved next-route node for the hot room"
  );
  assert(
    (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount + 1} rooms`,
    "cross-room rollup count should increase by one after runtime room becomes hot"
  );
  const compactRollupCard = page.getByTestId(`mailbox-governance-escalation-rollup-room-${targetRoom.id}`);
  const compactRollupText = await readLocatorText(compactRollupCard);
  assert(
    !compactRollupText.includes("当前负责人"),
    "mailbox cross-room rollup should not duplicate current-owner copy that is already owned by the dependency graph"
  );
  assert(
    !compactRollupText.includes("下一步建议"),
    "mailbox cross-room rollup should not duplicate next-route guidance that is already owned by the dependency graph"
  );
  if (readyState.rollup.latestSummary?.trim()) {
    assert(
      !compactRollupText.includes(readyState.rollup.latestSummary),
      "mailbox cross-room rollup should not repeat latest-summary copy that is already owned by the dependency graph"
    );
  }
  assert(
    (await compactRollupCard.getByRole("link", { name: "查看该讨论" }).count()) === 0,
    "mailbox cross-room rollup should not keep a secondary room-link CTA once the dependency graph already owns room navigation"
  );
  assert(
    (await compactRollupCard.getByRole("button", { name: "创建自动交接" }).count()) === 1,
    "mailbox cross-room rollup should keep create-governed-handoff as the single ready-state primary action"
  );
  assert(
    (await compactRollupCard.getByRole("link", { name: "打开下一步" }).count()) === 0,
    "mailbox cross-room rollup should not keep a second next-step CTA while route is only ready"
  );
  await capture(page, "mailbox-cross-room-route-ready");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-governance-escalation-rollup-room-${targetRoom.id}`).waitFor({ state: "visible" });
  await page.getByTestId("orchestration-governance-escalation-graph").waitFor({ state: "visible" });
  await page.getByTestId(`orchestration-governance-escalation-graph-room-${targetRoom.id}`).waitFor({
    state: "visible",
  });
  await waitFor(
    async () => (await readText(page, `orchestration-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "就绪",
    "orchestration mirror should expose the same ready route metadata before create"
  );
  await waitFor(
    async () => {
      const ownerText = await readText(page, `orchestration-governance-escalation-graph-owner-${targetRoom.id}`);
      return ownerText.includes("当前负责人") && !ownerText.includes("等待负责人") && !ownerText.includes("待补齐");
    },
    "orchestration governance graph should surface a resolved current owner node for the hot room"
  );
  await waitFor(
    async () => {
      const routeText = await readText(page, `orchestration-governance-escalation-graph-route-${targetRoom.id}`);
      return routeText.includes("下一棒") && !routeText.includes("等待下一棒") && !routeText.includes("正在整理中");
    },
    "orchestration governance graph should surface a resolved next-route node for the hot room"
  );
  const orchestrationRollupCard = page.getByTestId(`orchestration-governance-escalation-rollup-room-${targetRoom.id}`);
  const orchestrationRollupText = await readLocatorText(orchestrationRollupCard);
  assert(
    !orchestrationRollupText.includes("当前负责人"),
    "orchestration cross-room rollup should not duplicate current-owner copy that is already owned by the dependency graph"
  );
  assert(
    !orchestrationRollupText.includes("下一步建议"),
    "orchestration cross-room rollup should not duplicate next-route guidance that is already owned by the dependency graph"
  );
  if (readyState.rollup.latestSummary?.trim()) {
    assert(
      !orchestrationRollupText.includes(readyState.rollup.latestSummary),
      "orchestration cross-room rollup should not repeat latest-summary copy that is already owned by the dependency graph"
    );
  }
  assert(
    (await orchestrationRollupCard.getByRole("link", { name: "查看该讨论" }).count()) === 0,
    "orchestration cross-room rollup should not keep a secondary room-link CTA once the dependency graph already owns room navigation"
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
  await waitFor(
    async () =>
      (await readText(page, `mailbox-governance-escalation-graph-route-${targetRoom.id}`)).includes("进行中"),
    "mailbox governance graph should flip the route node to active after create"
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
  await waitFor(
    async () =>
      (await readText(page, `orchestration-governance-escalation-graph-route-${targetRoom.id}`)).includes("进行中"),
    "orchestration governance graph should flip the route node to active after create"
  );
  await capture(page, "orchestration-cross-room-route-active");

  let autoCloseoutSummary = null;
  if (parsedArgs.mode === "auto-closeout") {
    const ackReviewer = await patchMailboxHandoff(serverURL, activeState.handoff.id, {
      action: "acknowledged",
      actingAgentId: "agent-claude-review-runner",
    });
    assert(ackReviewer.ok, `reviewer acknowledge should succeed, received ${ackReviewer.status}`);

    const completeReviewer = await patchMailboxHandoff(serverURL, activeState.handoff.id, {
      action: "completed",
      actingAgentId: "agent-claude-review-runner",
      note: "review 已完成，直接续到 QA。",
      continueGovernedRoute: true,
    });
    assert(completeReviewer.ok, `reviewer continue should succeed, received ${completeReviewer.status}`);
    const qaHandoff =
      completeReviewer.body?.state?.mailbox?.find(
        (item) =>
          item.roomId === targetRoom.id &&
          item.kind === "governed" &&
          item.status === "requested" &&
          item.toAgent === "Memory Clerk"
      ) ?? null;
    assert(qaHandoff, "reviewer continue should materialize a requested QA governed handoff");

    const ackQA = await patchMailboxHandoff(serverURL, qaHandoff.id, {
      action: "acknowledged",
      actingAgentId: "agent-memory-clerk",
    });
    assert(ackQA.ok, `qa acknowledge should succeed, received ${ackQA.status}`);

    const completeQA = await patchMailboxHandoff(serverURL, qaHandoff.id, {
      action: "completed",
      actingAgentId: "agent-memory-clerk",
      note: "QA 验证完成，按 auto-complete 直接收口 delivery delegate。",
    });
    assert(completeQA.ok, `qa complete should succeed, received ${completeQA.status}`);

    const finalAutoCloseout = await waitFor(async () => {
      const state = await readState(serverURL);
      const detail = await readPullRequestDetail(serverURL, "pr-runtime-18");
      const runtimeRollup = findRollup(state, targetRoom.id);
      if (!runtimeRollup) {
        return false;
      }
      const hasRuntimeSidecar = state.mailbox.some(
        (item) =>
          item.roomId === targetRoom.id && (item.kind === "delivery-closeout" || item.kind === "delivery-reply")
      );
      if (hasRuntimeSidecar) {
        return false;
      }
      if (runtimeRollup.status !== "blocked" || runtimeRollup.blockedCount < 1 || runtimeRollup.nextRouteStatus !== "done") {
        return false;
      }
      if (detail.delivery?.delegation?.status !== "done" || detail.delivery?.delegation?.handoffId) {
        return false;
      }
      return { state, detail, qaHandoff, runtimeRollup };
    }, "auto-closeout should keep the original runtime blocker hot while leaving no delivery sidecars behind");

    await page.goto(`${webURL}/pull-requests/pr-runtime-18`, { waitUntil: "load" });
    await page.getByTestId("delivery-delegation-status").waitFor({ state: "visible" });
    await waitFor(
      async () => (await readText(page, "delivery-delegation-status")) === "已完成",
      "pr detail should show delivery delegation done after auto-closeout"
    );
    await waitFor(
      async () => (await readText(page, "delivery-delegation-summary")).includes("auto-complete"),
      "pr detail summary should mention auto-complete policy after closeout"
    );
    await capture(page, "pr-detail-cross-room-auto-closeout-done");

    await page.goto(`${webURL}/mailbox?roomId=${targetRoom.id}`, { waitUntil: "load" });
    await page.getByTestId("mailbox-governance-escalation-graph").waitFor({ state: "visible" });
    await waitFor(
      async () => (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount + 1} rooms`,
      "mailbox rollup count should keep the original runtime blocker hot after auto-closeout"
    );
    await waitFor(
      async () =>
        (await readText(page, `mailbox-governance-escalation-graph-route-${targetRoom.id}`)).includes("完成"),
      "mailbox graph should show the runtime room as done-route after auto-closeout"
    );
    await waitFor(
      async () => (await readText(page, `mailbox-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "完成",
      "mailbox rollup should show the runtime room route as done after auto-closeout"
    );
    const visibleMailboxKinds = await page.locator('[data-testid^="mailbox-kind-"]').allTextContents();
    assert(
      visibleMailboxKinds.every((label) => !label.includes("交付收尾") && !label.includes("收尾回复")),
      `mailbox should not surface delivery sidecar kinds after auto-closeout, received ${visibleMailboxKinds.join(", ")}`
    );
    await capture(page, "mailbox-cross-room-auto-closeout-done");

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("mailbox-governance-escalation-graph").waitFor({ state: "visible" });
    await waitFor(
      async () => (await readText(page, `mailbox-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "完成",
      "mailbox rollup should stay done after reload"
    );
    await capture(page, "mailbox-cross-room-auto-closeout-reloaded");

    await page.goto(`${webURL}/agents`, { waitUntil: "load" });
    await waitFor(
      async () =>
        (await readTextIfPresent(page, `orchestration-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "完成",
      "orchestration rollup should show the runtime room route as done after auto-closeout"
    );
    await waitFor(
      async () =>
        (await readTextIfPresent(page, `orchestration-governance-escalation-graph-route-${targetRoom.id}`)).includes("完成"),
      "orchestration graph should show the runtime room route as done after auto-closeout"
    );
    await capture(page, "orchestration-cross-room-auto-closeout-done");

    await page.reload({ waitUntil: "load" });
    await waitFor(
      async () =>
        (await readTextIfPresent(page, `orchestration-governance-escalation-rollup-route-status-${targetRoom.id}`)) === "完成",
      "orchestration rollup should stay done after reload"
    );
    await capture(page, "orchestration-cross-room-auto-closeout-reloaded");

    autoCloseoutSummary = {
      finalState: finalAutoCloseout.state,
      detail: finalAutoCloseout.detail,
      qaHandoff: finalAutoCloseout.qaHandoff,
      runtimeRollup: finalAutoCloseout.runtimeRollup,
      visibleMailboxKinds,
    };
  }

  const reportHeading =
    parsedArgs.mode === "auto-closeout"
      ? `${reportDate} Cross-Room Governance Auto-Closeout Report`
      : `${reportDate} Cross-Room Governance Orchestration Report`;
  const reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm ${
    parsedArgs.mode === "auto-closeout"
      ? "test:headed-cross-room-governance-auto-closeout"
      : "test:headed-cross-room-governance-orchestration"
  } -- --report ${path.relative(projectRoot, reportPath)}`;
  const reportTicket = parsedArgs.mode === "auto-closeout" ? "`TKT-72` + `TKT-95`" : "`TKT-95`";
  const reportTestCase = parsedArgs.mode === "auto-closeout" ? "`TC-061` + `TC-084`" : "`TC-084`";
  const reportScope =
    parsedArgs.mode === "auto-closeout"
      ? "cross-room graph lifecycle, governed route -> QA -> auto-complete delivery closeout, mailbox/agents done-route sync, reload continuity, sidecar-safe blocker retention"
      : "cross-room rollup route metadata, dependency graph surface, room-level governed create action, mailbox + orchestration mirror, inbox deep-link";
  const reportResults = [
    "- runtime room 通过真实 blocked inbox replay 进入 cross-room governance rollup 后，会带出 `current owner / current lane / next governed route` 元数据，不再只剩 room 状态摘要 -> PASS",
    "- `/mailbox` 与 `/agents` 现在都会把 hot room 重新组织成 `room -> current owner/lane -> next route` 的 cross-room dependency graph；人类不必逐卡读长文也能看出哪一棒卡住、下一棒准备交给谁 -> PASS",
    "- `/mailbox` 上的 cross-room rollup 在 route `ready` 时会开放 `Create Governed Handoff`，并通过正式 `POST /v1/mailbox/governed` 合同起单，而不是前端本地拼接 mutation -> PASS",
    "- governed create 成功后，runtime room 的 route metadata 会从 `ready` 切成 `active`，`Open Next Route` 也会深链到新建 handoff；说明 room-level orchestration 已进入正式产品面 -> PASS",
    "- `/agents` 会镜像同一份 route status 与 deep-link，不会出现 mailbox 已 active、orchestration 仍停在 ready 的分裂真相 -> PASS",
  ];
  if (autoCloseoutSummary) {
    reportResults.push(
      "- reviewer -> QA -> delivery auto-complete 走完后，runtime room 仍会因为最初的 blocker 保持 hot，但 route 会同步切到 `done`，且不会额外长出 `delivery-closeout / delivery-reply` sidecar；说明 blocker truth 与 closeout truth 已被正确拆开 -> PASS",
      "- `/pull-requests/pr-runtime-18` 的 Delivery Delegation 会直接显示 `已完成`，并保留 auto-complete policy 摘要；用户能在交付面确认正式收口，而不是只在后台状态里猜测 -> PASS",
      "- `/mailbox` 与 `/agents` 在 reload 后仍会维持同一条 `done` route truth，而且 Mailbox 当前 room ledger 不会露出 `交付收尾 / 收尾回复` sidecar 卡片 -> PASS"
    );
  }
  const reportAssertions = [
    `- Baseline rollup length: ${baselineRollupCount}`,
    `- Ready route: ${readyState.rollup.currentOwner} / ${readyState.rollup.currentLane} / ${readyState.rollup.nextRouteLabel}`,
    `- Created handoff: ${activeState.handoff.id} (${activeState.handoff.fromAgent} -> ${activeState.handoff.toAgent})`,
    `- Active route href: ${activeState.rollup.nextRouteHref}`,
  ];
  if (autoCloseoutSummary) {
    reportAssertions.push(
      `- QA followup: ${autoCloseoutSummary.qaHandoff.id} (${autoCloseoutSummary.qaHandoff.toAgent})`,
      `- Final rollup length: ${autoCloseoutSummary.finalState.workspace.governance.escalationSla.rollup.length}`,
      `- Final runtime route: ${autoCloseoutSummary.runtimeRollup.nextRouteStatus} / ${autoCloseoutSummary.runtimeRollup.nextRouteHref}`,
      `- Final delegation status: ${autoCloseoutSummary.detail.delivery.delegation.status}`,
      `- Visible mailbox kinds after closeout: ${autoCloseoutSummary.visibleMailboxKinds.join(", ")}`
    );
  }

  const report = [
    `# ${reportHeading}`,
    "",
    `- Ticket: ${reportTicket}`,
    "- Checklist: `CHK-21`",
    `- Test Case: ${reportTestCase}`,
    `- Scope: ${reportScope}`,
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    ...reportResults,
    "",
    "## Assertions",
    "",
    ...reportAssertions,
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
