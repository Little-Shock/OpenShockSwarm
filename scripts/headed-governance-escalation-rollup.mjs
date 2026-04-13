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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt93-escalation-rollup-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-governance-escalation-rollup";
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

async function createMailbox(serverURL, input) {
  return fetchJSON(`${serverURL}/v1/mailbox`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function advanceMailbox(serverURL, handoffId, input) {
  return fetchJSON(`${serverURL}/v1/mailbox/${handoffId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function waitForMailbox(serverURL, title) {
  return waitFor(async () => {
    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => item.title === title) ?? false;
  }, `mailbox handoff ${title} did not appear`);
}

function findRollup(state, roomId) {
  return state.workspace.governance.escalationSla?.rollup?.find((item) => item.roomId === roomId) ?? null;
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

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await context.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });

  const baselineState = await readState(serverURL);
  const baselineRollupCount = baselineState.workspace.governance.escalationSla?.rollup?.length ?? 0;
  const baselineHotRoomIDs = new Set((baselineState.workspace.governance.escalationSla?.rollup ?? []).map((item) => item.roomId));
  const primaryRoom = baselineState.rooms.find((room) => room.id === "room-runtime") ?? baselineState.rooms[0];
  const secondaryRoom = baselineState.rooms.find((room) => room.id !== primaryRoom.id && !baselineHotRoomIDs.has(room.id));
  assert(primaryRoom && secondaryRoom, "expected at least two rooms for cross-room escalation rollup");

  const primaryTitle = `Cross-room rollup primary ${Date.now()}`;
  const secondaryTitle = `Cross-room rollup secondary ${Date.now()}`;

  await page.goto(`${webURL}/mailbox?roomId=${primaryRoom.id}`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governance-escalation-rollup").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount} rooms`,
    "baseline escalation rollup should match current workspace hot-room truth"
  );
  await capture(page, "mailbox-rollup-baseline");

  await createMailbox(serverURL, {
    roomId: primaryRoom.id,
    fromAgentId: "agent-codex-dockmaster",
    toAgentId: "agent-claude-review-runner",
    title: primaryTitle,
    summary: "先把 primary room reviewer blocker 抬进跨 room escalation rollup。",
  });
  const primaryHandoff = await waitForMailbox(serverURL, primaryTitle);
  await advanceMailbox(serverURL, primaryHandoff.id, {
    action: "blocked",
    actingAgentId: primaryHandoff.toAgentId,
    note: "primary room 还在等 reviewer evidence。",
  });

  await createMailbox(serverURL, {
    roomId: secondaryRoom.id,
    fromAgentId: "agent-codex-dockmaster",
    toAgentId: "agent-memory-clerk",
    title: secondaryTitle,
    summary: "让 secondary room 保持 active，从而验证跨 room rollup 不只认 blocker。",
  });
  const secondaryHandoff = await waitForMailbox(serverURL, secondaryTitle);

  const hotState = await waitFor(async () => {
    const state = await readState(serverURL);
    const primaryRollup = findRollup(state, primaryRoom.id);
    const secondaryRollup = findRollup(state, secondaryRoom.id);
    if (!primaryRollup || !secondaryRollup) {
      return false;
    }
    if (
      primaryRollup.status !== "blocked" ||
      primaryRollup.escalationCount !== 2 ||
      primaryRollup.blockedCount !== 2 ||
      secondaryRollup.status !== "active" ||
      secondaryRollup.escalationCount !== 1 ||
      secondaryRollup.blockedCount !== 0 ||
      (state.workspace.governance.escalationSla?.rollup?.length ?? 0) !== baselineRollupCount + 2
    ) {
      return false;
    }
    return state;
  }, "cross-room escalation rollup did not surface both rooms");

  await page.goto(`${webURL}/mailbox?roomId=${primaryRoom.id}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-governance-escalation-rollup-room-${primaryRoom.id}`).waitFor({ state: "visible" });
  await page.getByTestId(`mailbox-governance-escalation-rollup-room-${secondaryRoom.id}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, `mailbox-governance-escalation-rollup-status-${primaryRoom.id}`)) === governanceStatusLabel("blocked"),
    "primary room should appear as blocked in mailbox cross-room rollup"
  );
  assert(
    (await readText(page, `mailbox-governance-escalation-rollup-status-${secondaryRoom.id}`)) === governanceStatusLabel("active"),
    "secondary room should appear as active in mailbox cross-room rollup"
  );
  assert(
    (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount + 2} rooms`,
    "mailbox cross-room rollup should expose baseline hot rooms plus two new rooms"
  );
  await capture(page, "mailbox-rollup-hot-rooms");

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-governance-escalation-rollup-room-${primaryRoom.id}`).waitFor({ state: "visible" });
  await page.getByTestId(`orchestration-governance-escalation-rollup-room-${secondaryRoom.id}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, `orchestration-governance-escalation-rollup-status-${primaryRoom.id}`)) === governanceStatusLabel("blocked"),
    "orchestration rollup should mirror blocked primary room"
  );
  assert(
    (await readText(page, `orchestration-governance-escalation-rollup-status-${secondaryRoom.id}`)) === governanceStatusLabel("active"),
    "orchestration rollup should mirror active secondary room"
  );
  await capture(page, "orchestration-rollup-hot-rooms");

  await advanceMailbox(serverURL, primaryHandoff.id, {
    action: "acknowledged",
    actingAgentId: primaryHandoff.toAgentId,
  });
  await advanceMailbox(serverURL, primaryHandoff.id, {
    action: "completed",
    actingAgentId: primaryHandoff.toAgentId,
    note: "primary room blocker 已收平。",
  });

  await waitFor(async () => {
    const state = await readState(serverURL);
    return (
      !findRollup(state, primaryRoom.id) &&
      Boolean(findRollup(state, secondaryRoom.id)) &&
      (state.workspace.governance.escalationSla?.rollup?.length ?? 0) === baselineRollupCount + 1
    );
  }, "primary room rollup did not clear while secondary room stayed active");

  await page.goto(`${webURL}/mailbox?roomId=${secondaryRoom.id}`, { waitUntil: "load" });
  assert(
    (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount + 1} rooms`,
    "one newly added room should remain after primary closeout"
  );
  await capture(page, "mailbox-rollup-primary-cleared");

  await advanceMailbox(serverURL, secondaryHandoff.id, {
    action: "acknowledged",
    actingAgentId: secondaryHandoff.toAgentId,
  });
  await advanceMailbox(serverURL, secondaryHandoff.id, {
    action: "completed",
    actingAgentId: secondaryHandoff.toAgentId,
    note: "secondary room 也已收口。",
  });

  const finalState = await waitFor(async () => {
    const state = await readState(serverURL);
    return (state.workspace.governance.escalationSla?.rollup?.length ?? 0) === baselineRollupCount ? state : false;
  }, "cross-room escalation rollup did not clear after both rooms closed");

  await page.goto(`${webURL}/mailbox?roomId=${primaryRoom.id}`, { waitUntil: "load" });
  assert(
    (await readText(page, "mailbox-governance-escalation-rollup-count")) === `${baselineRollupCount} rooms`,
    "mailbox cross-room rollup should return to baseline hot-room count after both rooms close"
  );
  await capture(page, "mailbox-rollup-cleared");

  const report = [
    "# 2026-04-11 Governance Escalation Rollup Report",
    "",
    "- Ticket: `TKT-93`",
    "- Checklist: `CHK-21`",
    "- Test Case: `TC-082`",
    "- Scope: cross-room escalation rollup, mailbox + orchestration mirror, blocked+active room split, clear-down",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governance-escalation-rollup -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    `- primary room ${primaryRoom.title} 被 blocker 抬进 governance 后，cross-room rollup 会把它显示为 blocked room，并给出 room-level deep link -> PASS`,
    `- secondary room ${secondaryRoom.title} 即便只是 active handoff，也会进入同一条 rollup；治理面不再只认 blocker，不会漏掉另一个仍在推进的 hot room -> PASS`,
    "- `/mailbox` 与 `/agents` 会镜像同一份 rollup truth，而不是一个页面有 room rollup、另一个页面只剩 aggregate counter -> PASS",
    "- primary room closeout 后，rollup 会只保留 secondary room；两边都完成后 rollup 会回退到 baseline hot-room 数量，说明跨 room 视角同样沿正式 handoff truth 清退 -> PASS",
    "",
    "## Assertions",
    "",
    `- Baseline rollup length: ${baselineRollupCount}`,
    `- Hot rooms: ${hotState.workspace.governance.escalationSla.rollup.map((item) => `${item.roomTitle}:${item.status}:${item.escalationCount}`).join(" | ")}`,
    `- Final rollup length: ${finalState.workspace.governance.escalationSla.rollup?.length ?? 0}`,
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
