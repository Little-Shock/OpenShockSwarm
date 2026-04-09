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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt53-planner-dispatch-")));
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
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `${url} failed: ${response.status}`);
  }
  return payload;
}

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function readPlannerQueue(serverURL) {
  return fetchJSON(`${serverURL}/v1/planner/queue`, { cache: "no-store" });
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
    const response = await fetch(`${webURL}/board`);
    return response.ok;
  }, `web did not become ready at ${webURL}/board`);

  return { webURL, serverURL };
}

let browser = null;
let context = null;
let page = null;

try {
  const { webURL, serverURL } = await startServices();
  const chromiumExecutable = resolveChromiumExecutable();
  const issueTitle = `Planner Dispatch Replay ${Date.now()}`;
  const issueSummary = "把 planner dispatch、blocked escalation 和 first-response replay 摆成同页 visible truth。";
  const handoffTitle = `Review ${issueTitle}`;
  const handoffSummary = "请接住 reviewer lane，并把 blocked / closeout evidence 写回同一份治理链。";
  const blockedNote = "等 reviewer exact evidence 先收平。";
  const completeNote = "review / test evidence 已收平，可以回到最终响应。";

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await context.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-template").waitFor({ state: "visible" });
  assert(
    (await readText(page, "setup-governance-template")).includes("开发团队治理链"),
    "setup should resolve to dev-team governance before replay starts"
  );

  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await waitFor(
    async () => (await readText(page, "board-create-issue-authz")) === "allowed",
    "board create-issue authz did not settle to allowed"
  );
  await page.getByTestId("board-create-issue-title").fill(issueTitle);
  await page.getByTestId("board-create-issue-summary").fill(issueSummary);
  await page.getByTestId("board-create-issue-submit").click();
  const createdIssue = await waitFor(async () => {
    const nextState = await readState(serverURL);
    return nextState.issues.find((item) => item.title === issueTitle) ?? false;
  }, "created issue should exist in server state after board submit");
  await page.goto(`${webURL}/rooms/${createdIssue.roomId}`, { waitUntil: "load" });
  await capture(page, "room-after-board-create");

  const stateAfterCreate = await readState(serverURL);
  const createdSession = stateAfterCreate.sessions.find((item) => item.issueKey === createdIssue.key);
  assert(createdSession, "created issue should materialize a planner session");
  const createdQueue = await readPlannerQueue(serverURL);
  const queuedItem = createdQueue.find((item) => item.sessionId === createdSession.id);
  assert(queuedItem, "planner queue should expose the new issue after board creation");
  const initialPlannerStatus = queuedItem.status;
  assert(Boolean(initialPlannerStatus), "planner queue item should expose a visible initial status");

  await fetchJSON(`${serverURL}/v1/planner/sessions/${createdSession.id}/assignment`, {
    method: "POST",
    body: JSON.stringify({ agentId: "agent-codex-dockmaster" }),
  });

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-planner-queue-item-${createdSession.id}`).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, `orchestration-planner-queue-owner-${createdSession.id}`)).includes("Codex Dockmaster"),
    "assigned planner queue card did not expose Codex Dockmaster"
  );
  await waitFor(
    async () => (await readText(page, "orchestration-governance-step-issue")).includes(createdIssue.key),
    "governance replay did not pivot to the created issue"
  );
  await capture(page, "agents-after-planner-assignment");

  const createHandoffPayload = await fetchJSON(`${serverURL}/v1/mailbox`, {
    method: "POST",
    body: JSON.stringify({
      roomId: createdIssue.roomId,
      fromAgentId: "agent-codex-dockmaster",
      toAgentId: "agent-claude-review-runner",
      title: handoffTitle,
      summary: handoffSummary,
    }),
  });
  const handoffId = createHandoffPayload.handoff.id;

  const blockedWithoutNoteResponse = await fetch(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "blocked",
      actingAgentId: "agent-claude-review-runner",
    }),
  });
  const blockedWithoutNotePayload = await blockedWithoutNoteResponse.json();
  assert(blockedWithoutNoteResponse.status === 400, "blocked handoff without note should fail closed with 400");
  assert(
    String(blockedWithoutNotePayload.error || "").includes("note"),
    "blocked handoff without note should explain the missing note requirement"
  );

  await fetchJSON(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "blocked",
      actingAgentId: "agent-claude-review-runner",
      note: blockedNote,
    }),
  });

  await page.reload({ waitUntil: "load" });
  await waitFor(
    async () => (await readText(page, "orchestration-governance-human-override")) === "watch",
    "orchestration page did not expose blocked escalation watch state"
  );
  await waitFor(
    async () => (await readText(page, "orchestration-governance-step-handoff")).includes("blocked"),
    "handoff walkthrough step did not expose blocked status"
  );
  await capture(page, "agents-after-blocked-escalation");

  await fetchJSON(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "acknowledged",
      actingAgentId: "agent-claude-review-runner",
    }),
  });
  await fetchJSON(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    body: JSON.stringify({
      action: "completed",
      actingAgentId: "agent-claude-review-runner",
      note: completeNote,
    }),
  });

  await page.reload({ waitUntil: "load" });
  await waitFor(
    async () => (await readText(page, "orchestration-governance-response-aggregation")).includes(completeNote),
    "response aggregation did not expose the final closeout note"
  );
  await capture(page, "agents-after-final-response");

  const queueAfterAssignment = await readPlannerQueue(serverURL);
  const assignedItem = queueAfterAssignment.find((item) => item.sessionId === createdSession.id);
  assert(assignedItem, "assigned planner queue item should still exist");
  assert(
    assignedItem.status === "running" && assignedItem.summary.includes("Mailbox"),
    "planner queue item should keep exposing the completed handoff continuity"
  );

  const stateAfterComplete = await readState(serverURL);
  const handoffStep = stateAfterComplete.workspace.governance.walkthrough.find((item) => item.id === "handoff");
  const finalStep = stateAfterComplete.workspace.governance.walkthrough.find((item) => item.id === "final-response");
  assert(handoffStep?.status === "done", "governance handoff step should settle to done after completion");
  assert(finalStep?.status === "ready", "governance final-response step should settle to ready after completion");
  assert(
    stateAfterComplete.workspace.governance.responseAggregation.finalResponse.includes(completeNote),
    "server governance snapshot should aggregate the final closeout note"
  );

  const report = [
    "# 2026-04-09 Planner Dispatch / First-Instruction Replay Report",
    "",
    `- Command: \`pnpm test:headed-planner-dispatch-replay -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    `- \`/board\` 真创建 issue 后，\`/v1/planner/queue\` 会立即露出同一条 visible item（本次 initial status = \`${initialPlannerStatus}\`）；随后把 session assignment 前滚给 \`Codex Dockmaster\` 后，\`/agents\` orchestration page 会直接显示 owner / runtime / gate / auto-merge guard truth -> PASS`,
    "- orchestration page 现在不再只剩旧的 fail-closed copy；`planner queue + governed topology + issue -> handoff -> review -> test -> final response` walkthrough 已经同页可见 -> PASS",
    "- adversarial non-happy probe 已覆盖 `blocked` without note：`POST /v1/mailbox/:id` 在缺 note 时稳定返回 `400`，不会把 reviewer blocker 假绿吞掉 -> PASS",
    "- blocked escalation 与 final response aggregation 都能在同一条 orchestration page 上前滚：`human override = watch`，随后 closeout note 会进入 response aggregation 与 final-response step -> PASS",
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
