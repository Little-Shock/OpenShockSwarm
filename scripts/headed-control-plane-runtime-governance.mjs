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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt58-61-headed-")));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-control-plane-runtime-governance";
const webDistDir = path.join(projectRoot, "apps", "web", webDistDirName);

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(webDistDir, { recursive: true });

const screenshots = [];
const processes = [];
const reportCommand = buildReportCommand();

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

function buildReportCommand() {
  const relativeReportPath = parsedArgs.reportPath
    ? parsedArgs.reportPath
    : path.relative(projectRoot, reportPath);

  if (process.env.OPENSHOCK_CHROMIUM_CDP_URL?.trim()) {
    return `OPENSHOCK_CHROMIUM_CDP_URL=${process.env.OPENSHOCK_CHROMIUM_CDP_URL.trim()} pnpm test:headed-control-plane-runtime-governance -- --report ${relativeReportPath}`;
  }

  if (process.env.OPENSHOCK_WINDOWS_CHROME === "1") {
    return `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-control-plane-runtime-governance -- --report ${relativeReportPath}`;
  }

  return `pnpm test:headed-control-plane-runtime-governance -- --report ${relativeReportPath}`;
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

function resolveSpawn(command, args) {
  if (command.endsWith(".sh")) {
    return {
      command: "bash",
      args: [command, ...args],
      printable: `bash ${command} ${args.join(" ")}`.trim(),
    };
  }

  return {
    command,
    args,
    printable: `${command} ${args.join(" ")}`.trim(),
  };
}

function startProcess(name, command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  const logPath = path.join(logsDir, `${name}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  const resolved = resolveSpawn(command, args);
  logStream.write(`[${timestamp()}] ${resolved.printable}\n`);

  const child = spawn(resolved.command, resolved.args, {
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
  const filePath = path.join(
    screenshotsDir,
    `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`
  );
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function requestJSON(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { text: await response.text() };
  return {
    status: response.status,
    ok: response.ok,
    payload,
  };
}

async function readState(serverURL) {
  const response = await requestJSON(`${serverURL}/v1/state`, { cache: "no-store" });
  assert(response.ok, `GET /v1/state failed with ${response.status}`);
  return response.payload;
}

async function waitForMailbox(serverURL, title) {
  return waitFor(async () => {
    const response = await requestJSON(`${serverURL}/v1/mailbox`, { cache: "no-store" });
    assert(response.ok, `/v1/mailbox failed with ${response.status}`);
    return response.payload.find((item) => item.title === title) ?? false;
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
    ({ currentHandoffId, currentExpectedLabel }) =>
      document
        .querySelector(`[data-testid="mailbox-status-${currentHandoffId}"]`)
        ?.textContent?.trim() === currentExpectedLabel,
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
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);

  return { webURL, serverURL };
}

function dirtyGovernanceState(state) {
  const dirtyState = structuredClone(state);
  dirtyState.workspace.governance.label = "placeholder governance";
  dirtyState.workspace.governance.summary = "E2E residue 202604100930 governance summary";
  dirtyState.workspace.governance.routingPolicy.summary = "fixture routing summary";
  if ((dirtyState.workspace.governance.routingPolicy.rules ?? []).length > 0) {
    dirtyState.workspace.governance.routingPolicy.rules[0].summary = "/tmp/openshock-routing-leak";
  }
  dirtyState.workspace.governance.notificationPolicy.summary = "mock 卡片 notification";
  dirtyState.workspace.governance.responseAggregation.finalResponse = "mock 卡片";
  dirtyState.workspace.governance.responseAggregation.summary = "placeholder aggregation summary";
  if ((dirtyState.workspace.governance.responseAggregation.auditTrail ?? []).length > 0) {
    dirtyState.workspace.governance.responseAggregation.auditTrail[0].summary = "C:\\temp\\governance-leak";
  }
  return dirtyState;
}

let browser = null;
let primaryContext = null;
let dirtyContext = null;
let page = null;
let dirtyPage = null;

try {
  const { webURL, serverURL } = await startServices();
  const runStamp = Date.now();
  const requestTitle = `治理链 reviewer closeout ${runStamp}`;
  const requestSummary = "请把 reviewer evidence、blocked escalation 和最终 closeout note 全部写回同一条治理链。";
  const blockedNote = "先卡住 reviewer lane，验证 escalation SLA 和通知链仍然同源。";
  const completeNote = "最终响应：review / test / closeout 证据已经收平。";

  browser = await launchChromiumSession(chromium);
  primaryContext = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await primaryContext.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });
  await capture(page, "setup-dev-team-template");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governance-template").waitFor({ state: "visible" });
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
  await capture(page, "mailbox-handoff-requested");

  await page.getByTestId(`mailbox-note-${handoffId}`).fill(blockedNote);
  await page.getByTestId(`mailbox-action-blocked-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "blocked");
  await capture(page, "mailbox-handoff-blocked");

  await page.getByTestId(`mailbox-action-acknowledged-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "acknowledged");
  await page.getByTestId(`mailbox-note-${handoffId}`).fill(completeNote);
  await page.getByTestId(`mailbox-action-completed-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "completed");
  await capture(page, "mailbox-handoff-completed");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId("orchestration-governance-template").waitFor({ state: "visible" });
  await page.getByText("协作规则和通知一页看清").waitFor({ state: "visible" });
  await page.getByText(/^升级时限$/).waitFor({ state: "visible" });
  await page.getByText(/^通知策略$/).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, "orchestration-governance-response-aggregation")).includes("最终响应"),
    "response aggregation did not expose final closeout note on /agents"
  );
  await capture(page, "agents-governance-routing-sla-aggregation");

  const stateAfterGovernance = await readState(serverURL);
  const governance = stateAfterGovernance.workspace.governance;
  assert(governance.templateId === "dev-team", "governance template should resolve to dev-team");
  assert((governance.routingPolicy?.rules ?? []).length > 0, "routing policy rules should be present");
  assert((governance.notificationPolicy?.targets ?? []).length > 0, "notification policy targets should be present");
  assert((governance.escalationSla?.timeoutMinutes ?? 0) > 0, "escalation SLA should expose timeout minutes");
  assert((governance.responseAggregation?.auditTrail ?? []).length > 0, "response aggregation should expose audit trail");

  const controlPlaneIdempotencyKey = `cp-issue-${runStamp}`;
  const controlPlaneCreate = await requestJSON(`${serverURL}/v1/control-plane/commands`, {
    method: "POST",
    body: JSON.stringify({
      kind: "issue.create",
      idempotencyKey: controlPlaneIdempotencyKey,
      payload: {
        title: `Control-plane created issue ${runStamp}`,
        summary: "通过 /v1 command write 创建 issue，并在 browser 上回看结果。",
        owner: "Codex Dockmaster",
        priority: "high",
      },
    }),
  });

  assert(controlPlaneCreate.status === 200, `control-plane create status = ${controlPlaneCreate.status}, want 200`);
  assert(controlPlaneCreate.payload.command?.status === "committed", "control-plane command should commit");
  assert(controlPlaneCreate.payload.events?.[0]?.kind === "issue.created", "control-plane event should be issue.created");
  assert(controlPlaneCreate.payload.command?.replayAnchor, "control-plane command should expose replay anchor");

  const controlPlaneReplay = await requestJSON(`${serverURL}/v1/control-plane/commands`, {
    method: "POST",
    body: JSON.stringify({
      kind: "issue.create",
      idempotencyKey: controlPlaneIdempotencyKey,
      payload: {
        title: `Control-plane created issue ${runStamp}`,
        summary: "通过 /v1 command write 创建 issue，并在 browser 上回看结果。",
        owner: "Codex Dockmaster",
        priority: "high",
      },
    }),
  });

  assert(controlPlaneReplay.status === 200, `control-plane replay status = ${controlPlaneReplay.status}, want 200`);
  assert(controlPlaneReplay.payload.deduped === true, "control-plane replay should dedupe by idempotency key");

  const controlPlaneReject = await requestJSON(`${serverURL}/v1/control-plane/commands`, {
    method: "POST",
    body: JSON.stringify({
      kind: "run.control",
      idempotencyKey: `cp-reject-${runStamp}`,
      payload: {
        runId: "run-missing",
        action: "stop",
        note: "验证稳定 error family。",
      },
    }),
  });

  assert(controlPlaneReject.status === 404, `control-plane rejection status = ${controlPlaneReject.status}, want 404`);
  assert(controlPlaneReject.payload.family === "not_found", "control-plane rejection family should be not_found");

  const controlPlaneEvents = await requestJSON(`${serverURL}/v1/control-plane/events?cursor=0&limit=20`, {
    cache: "no-store",
  });
  assert(controlPlaneEvents.status === 200, `control-plane events status = ${controlPlaneEvents.status}, want 200`);
  assert(
    controlPlaneEvents.payload.items.some((item) => item.commandId === controlPlaneCreate.payload.command.id),
    "control-plane events page should include the created command"
  );

  const controlPlaneDebug = await requestJSON(
    `${serverURL}${controlPlaneCreate.payload.command.replayAnchor}`,
    { cache: "no-store" }
  );
  assert(controlPlaneDebug.status === 200, `control-plane debug status = ${controlPlaneDebug.status}, want 200`);
  assert(controlPlaneDebug.payload.command?.id === controlPlaneCreate.payload.command.id, "debug read-model should echo the created command");

  const controlPlaneRejections = await requestJSON(
    `${serverURL}/v1/control-plane/debug/rejections?family=not_found&limit=20`,
    { cache: "no-store" }
  );
  assert(controlPlaneRejections.status === 200, `control-plane rejections status = ${controlPlaneRejections.status}, want 200`);
  assert(
    controlPlaneRejections.payload.items.some((item) => item.commandId === controlPlaneReject.payload.command.id),
    "control-plane rejection page should include the rejected command"
  );

  const createdIssueKey = controlPlaneCreate.payload.command.aggregateId;
  await page.goto(`${webURL}/issues/${createdIssueKey}`, { waitUntil: "load" });
  await page
    .getByRole("heading", { name: `Control-plane created issue ${runStamp}` })
    .waitFor({ state: "visible" });
  await capture(page, "control-plane-issue-browser-surface");

  const runtimePublishOne = await requestJSON(`${serverURL}/v1/runtime/publish`, {
    method: "POST",
    body: JSON.stringify({
      runtimeId: "shock-main",
      runId: "run_memory_01",
      cursor: 1,
      phase: "publish",
      status: "blocked",
      summary: "memory writeback 在治理边界暂停，准备写 replay evidence。",
      idempotencyKey: `runtime-publish-1-${runStamp}`,
      evidenceLines: ["memory-writeback", "governance-blocked"],
    }),
  });

  assert(runtimePublishOne.status === 202, `runtime publish#1 status = ${runtimePublishOne.status}, want 202`);
  assert(runtimePublishOne.payload.record?.cursor === 1, "runtime publish#1 should persist cursor 1");

  const runtimePublishReplayOne = await requestJSON(`${serverURL}/v1/runtime/publish`, {
    method: "POST",
    body: JSON.stringify({
      runtimeId: "shock-main",
      runId: "run_memory_01",
      cursor: 1,
      phase: "publish",
      status: "blocked",
      summary: "memory writeback 在治理边界暂停，准备写 replay evidence。",
      idempotencyKey: `runtime-publish-1-${runStamp}`,
      evidenceLines: ["memory-writeback", "governance-blocked"],
    }),
  });

  assert(runtimePublishReplayOne.status === 200, `runtime publish replay status = ${runtimePublishReplayOne.status}, want 200`);
  assert(runtimePublishReplayOne.payload.deduped === true, "runtime publish retry should dedupe");

  const runtimePublishTwo = await requestJSON(`${serverURL}/v1/runtime/publish`, {
    method: "POST",
    body: JSON.stringify({
      runtimeId: "shock-main",
      runId: "run_memory_01",
      cursor: 2,
      phase: "closeout",
      status: "done",
      summary: "已把 failure anchor 与 closeout reason 收进 replay packet。",
      idempotencyKey: `runtime-publish-2-${runStamp}`,
      failureAnchor: "notes/rooms/room-memory.md#policy-conflict",
      closeoutReason: "等待治理规则对齐后再恢复记忆写回。",
      evidenceLines: ["closeout-recorded", "replay-anchor-ready"],
    }),
  });

  assert(runtimePublishTwo.status === 202, `runtime publish#2 status = ${runtimePublishTwo.status}, want 202`);
  assert(runtimePublishTwo.payload.record?.cursor === 2, "runtime publish#2 should persist cursor 2");

  const runtimePublishPage = await requestJSON(`${serverURL}/v1/runtime/publish?runId=run_memory_01&cursor=0&limit=10`, {
    cache: "no-store",
  });
  assert(runtimePublishPage.status === 200, `runtime publish page status = ${runtimePublishPage.status}, want 200`);
  assert(runtimePublishPage.payload.items?.length === 2, "runtime publish page should expose 2 records");

  const runtimeReplay = await requestJSON(`${serverURL}/v1/runtime/publish/replay?runId=run_memory_01`, {
    cache: "no-store",
  });
  assert(runtimeReplay.status === 200, `runtime replay status = ${runtimeReplay.status}, want 200`);
  assert(runtimeReplay.payload.lastCursor === 2, "runtime replay should expose last cursor = 2");
  assert(runtimeReplay.payload.closeoutReason?.includes("恢复记忆写回"), "runtime replay should expose closeout reason");
  assert(runtimeReplay.payload.failureAnchor?.includes("policy-conflict"), "runtime replay should expose failure anchor");

  await page.goto(`${webURL}/runs/run_memory_01`, { waitUntil: "load" });
  await page.getByText("机器执行与收尾记录").waitFor({ state: "visible" });
  await page.getByText("执行回放").waitFor({ state: "visible" });
  await page
    .getByText("收尾说明：等待治理规则对齐后再恢复记忆写回。")
    .first()
    .waitFor({ state: "visible" });
  await page
    .getByText("失败锚点：notes/rooms/room-memory.md#policy-conflict")
    .first()
    .waitFor({ state: "visible" });
  await capture(page, "runtime-replay-browser-surface");

  const cleanState = await readState(serverURL);
  const dirtyState = dirtyGovernanceState(cleanState);

  dirtyContext = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  await dirtyContext.route("**/v1/state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dirtyState),
    });
  });

  dirtyPage = await dirtyContext.newPage();
  await dirtyPage.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  await dirtyPage.goto(`${webURL}/agents`, { waitUntil: "load" });
  await dirtyPage.getByTestId("orchestration-governance-summary").waitFor({ state: "visible" });
  assert(
    (await readText(dirtyPage, "orchestration-governance-template")) === "当前治理链正在整理中。",
    "dirty governance label should fail closed in browser adapter"
  );
  assert(
    (await readText(dirtyPage, "orchestration-governance-summary")) === "当前多智能体治理摘要正在整理中。",
    "dirty governance summary should fail closed in browser adapter"
  );
  assert(
    (await readText(dirtyPage, "orchestration-governance-response-aggregation")) === "等待当前治理链收口。",
    "dirty response aggregation should fail closed in browser adapter"
  );
  await capture(dirtyPage, "dirty-projection-fail-closed");

  const report = [
    "# 2026-04-10 Windows Chrome Control-Plane / Runtime Replay / Governance Report",
    "",
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    `- Web: \`${webURL}\``,
    `- Server: \`${serverURL}\``,
    "",
    "## Results",
    "",
    "### Check: TKT-61 routing policy / escalation SLA / notification policy / aggregation",
    `- Browser path: \`/setup -> /mailbox?roomId=room-runtime -> /agents\``,
    `- Observed: governance template=\`${governance.label}\`, routing rules=\`${governance.routingPolicy.rules.length}\`, notification targets=\`${governance.notificationPolicy.targets.join(", ")}\`, audit trail=\`${governance.responseAggregation.auditTrail.length}\``,
    `- Result: PASS. blocked escalation、final response aggregation、routing matrix、SLA 和 notification policy 已围同一份 workspace governance truth 前滚。`,
    "",
    "### Check: TKT-58 control-plane /v1 command-event-debug contract",
    `- API: \`POST /v1/control-plane/commands\` -> \`GET /v1/control-plane/events\` -> \`GET ${controlPlaneCreate.payload.command.replayAnchor}\` -> \`GET /v1/control-plane/debug/rejections?family=not_found\``,
    `- Observed: command=\`${controlPlaneCreate.payload.command.id}\`, aggregate=\`${createdIssueKey}\`, eventCursor=\`${controlPlaneCreate.payload.events[0].cursor}\`, replayDeduped=\`${controlPlaneReplay.payload.deduped}\`, rejectionFamily=\`${controlPlaneReject.payload.family}\``,
    `- Result: PASS. command write、event read、debug read-model、idempotency 和稳定 error family 已成立；browser 侧已能直接回看新建 issue。`,
    "",
    "### Check: TKT-60 runtime publish cursor / replay evidence packet",
    `- API: \`POST /v1/runtime/publish\` x2 + retry -> \`GET /v1/runtime/publish\` -> \`GET /v1/runtime/publish/replay?runId=run_memory_01\``,
    `- Observed: sequences=\`${runtimePublishPage.payload.items.map((item) => item.sequence).join(", ")}\`, lastCursor=\`${runtimeReplay.payload.lastCursor}\`, closeout=\`${runtimeReplay.payload.closeoutReason}\`, failureAnchor=\`${runtimeReplay.payload.failureAnchor}\``,
    `- Result: PASS. daemon publish retry 不再重复落账；replay packet 会把 cursor、closeout reason、failure anchor 和 browser run detail 对齐。`,
    "",
    "### Check: TKT-59 no-shadow-truth / dirty projection fail-closed",
    `- Browser path: intercepted dirty \`/v1/state\` on \`/agents\` with EventSource disabled`,
    `- Observed: template fallback=\`${await readText(dirtyPage, "orchestration-governance-template")}\`, summary fallback=\`${await readText(dirtyPage, "orchestration-governance-summary")}\`, aggregation fallback=\`${await readText(dirtyPage, "orchestration-governance-response-aggregation")}\``,
    "- Result: PASS. 浏览器 adapter 在 dirty projection 下会 fail-closed 回退到产品级 fallback，不会继续展示 placeholder / mock / path residue。",
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([
    dirtyPage?.close(),
    dirtyContext?.close(),
    page?.close(),
    primaryContext?.close(),
    browser?.close(),
  ]);
  await cleanupProcesses();
}
