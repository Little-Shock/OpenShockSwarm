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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt13-stop-resume-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");

const screenshots = [];
const processes = [];

await mkdir(artifactsDir, { recursive: true });

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
    const response = await fetch(`${webURL}/rooms/room-runtime`);
    return response.ok;
  }, `web did not become ready at ${webURL}/rooms/room-runtime`);

  return { webURL, serverURL };
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

async function waitForPageContains(page, expected) {
  await page.waitForFunction(
    (currentExpected) => document.body?.textContent?.includes(currentExpected) ?? false,
    expected,
    { timeout: 30_000 }
  );
}

async function expectButtonState(page, testID, expectedDisabled) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element instanceof HTMLButtonElement && element.disabled === currentExpected;
    },
    { currentTestID: testID, currentExpected: expectedDisabled },
    { timeout: 30_000 }
  );
}

async function fetchState(serverURL) {
  const response = await fetch(`${serverURL}/v1/state`);
  if (!response.ok) {
    throw new Error(`GET /v1/state failed with ${response.status}`);
  }
  return response.json();
}

function findRunBundle(state) {
  const run = state.runs.find((item) => item.id === "run_runtime_01");
  const room = state.rooms.find((item) => item.id === "room-runtime");
  const issue = state.issues.find((item) => item.key === "OPS-12");
  const session = state.sessions.find((item) => item.activeRunId === "run_runtime_01");
  return { run, room, issue, session };
}

const stopNote = "先暂停，补清人类纠偏说明再继续。";
const followNote = "恢复后继续沿当前 thread 收口，不切新 follow-up run。";
const resumeNote = "按当前 thread 的纠偏说明恢复执行，并同步回 Room / Run / Inbox。";

const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
await mkdir(screenshotsDir, { recursive: true });

let browser;

try {
  const { webURL, serverURL } = await startServices(runDir);
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "load" });
  await waitForText(page, "room-run-control-authz", "allowed");
  await waitForText(page, "room-run-status", "执行中");
  await waitForText(page, "room-run-control-status", "执行中");
  await waitForText(page, "room-run-follow-thread-status", "未锁定线程");
  await waitForText(page, "room-reply-authz", "allowed");
  await expectButtonState(page, "room-send-message", false);
  await capture(page, screenshotsDir, "room-running");

  await page.getByTestId("room-run-control-note").fill(stopNote);
  await page.getByTestId("room-run-control-stop").click();
  await waitForText(page, "room-run-status", "已暂停");
  await waitForText(page, "room-run-control-status", "已暂停");
  await waitForText(page, "room-reply-authz", "paused");
  await waitForContains(page, "room-run-control-note-preview", stopNote);
  await expectButtonState(page, "room-send-message", true);
  await capture(page, screenshotsDir, "room-paused");

  const stoppedState = await waitFor(async () => {
    const state = await fetchState(serverURL);
    const bundle = findRunBundle(state);
    return bundle.run?.status === "paused" &&
      bundle.room?.topic?.status === "paused" &&
      bundle.issue?.state === "paused" &&
      bundle.session?.status === "paused"
      ? bundle
      : null;
  }, "stop action did not sync paused state across room/run/issue/session");
  assert(stoppedState.run.controlNote.includes(stopNote), "paused run control note did not persist");
  assert(stoppedState.session.controlNote.includes(stopNote), "paused session control note did not persist");
  assert(stoppedState.run.followThread === false, "stop action should not force follow-thread");

  await page.goto(`${webURL}/inbox`, { waitUntil: "load" });
  await waitForContains(page, "approval-center-recent-count", "2");
  await waitForPageContains(page, "Run 已暂停");
  await capture(page, screenshotsDir, "inbox-stop-status");

  await page.goto(`${webURL}/runs/run_runtime_01`, { waitUntil: "load" });
  await waitForText(page, "run-detail-status", "已暂停");
  await waitForText(page, "run-detail-control-status", "已暂停");
  await waitForText(page, "run-detail-follow-thread-status", "未锁定线程");
  await page.getByTestId("run-detail-control-note").fill(followNote);
  await page.getByTestId("run-detail-control-follow-thread").click();
  await waitForText(page, "run-detail-follow-thread-status", "跟随当前线程");
  await waitForContains(page, "run-detail-control-note-preview", followNote);
  await capture(page, screenshotsDir, "run-follow-thread");

  const followState = await waitFor(async () => {
    const state = await fetchState(serverURL);
    const bundle = findRunBundle(state);
    return bundle.run?.status === "paused" &&
      bundle.run?.followThread &&
      bundle.session?.followThread &&
      bundle.issue?.state === "paused"
      ? bundle
      : null;
  }, "follow-thread action did not sync paused + follow-thread state");
  assert(followState.run.controlNote.includes(followNote), "follow-thread note did not persist on run");
  assert(followState.session.controlNote.includes(followNote), "follow-thread note did not persist on session");

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "load" });
  await waitForText(page, "room-run-status", "已暂停");
  await waitForText(page, "room-run-follow-thread-status", "跟随当前线程");
  await waitForContains(page, "room-run-control-note-preview", followNote);
  await page.getByTestId("room-run-control-note").fill(resumeNote);
  await page.getByTestId("room-run-control-resume").click();
  await waitForText(page, "room-run-status", "执行中");
  await waitForText(page, "room-run-control-status", "执行中");
  await waitForText(page, "room-run-follow-thread-status", "跟随当前线程");
  await waitForText(page, "room-reply-authz", "allowed");
  await waitForContains(page, "room-run-control-note-preview", resumeNote);
  await expectButtonState(page, "room-send-message", false);
  await capture(page, screenshotsDir, "room-resumed");

  const resumedState = await waitFor(async () => {
    const state = await fetchState(serverURL);
    const bundle = findRunBundle(state);
    return bundle.run?.status === "running" &&
      bundle.room?.topic?.status === "running" &&
      bundle.issue?.state === "running" &&
      bundle.session?.status === "running" &&
      bundle.run?.followThread &&
      bundle.session?.followThread
      ? bundle
      : null;
  }, "resume action did not restore running state across room/run/issue/session");
  assert(resumedState.run.controlNote.includes(resumeNote), "resume note did not persist on run");
  assert(resumedState.session.controlNote.includes(resumeNote), "resume note did not persist on session");

  await page.goto(`${webURL}/runs/run_runtime_01`, { waitUntil: "load" });
  await waitForText(page, "run-detail-status", "执行中");
  await waitForText(page, "run-detail-control-status", "执行中");
  await waitForText(page, "run-detail-follow-thread-status", "跟随当前线程");
  await waitForContains(page, "run-detail-control-note-preview", resumeNote);
  await capture(page, screenshotsDir, "run-resumed");

  await page.goto(`${webURL}/inbox`, { waitUntil: "load" });
  await waitForContains(page, "approval-center-recent-count", "4");
  await waitForPageContains(page, "已锁定当前线程");
  await waitForPageContains(page, "Run 已恢复");
  await capture(page, screenshotsDir, "inbox-recent-ledger");

  const report = [
    "# TKT-13 Stop / Resume / Follow-thread Report",
    "",
    `- Command: \`pnpm test:headed-stop-resume-follow-thread -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Stop: room composer really freezes",
    "",
    `- 在 \`/rooms/room-runtime\` 触发 Stop 后，room / run / issue / session 都切到 \`paused\`，而且 \`room-send-message\` 会被禁用，避免普通消息把暂停态悄悄恢复 -> PASS`,
    `- stop note 会同步进 room / run 两侧控制面板和 server state，不再只停在局部 textarea -> PASS`,
    "",
    "### Follow-thread: same paused run keeps current thread",
    "",
    `- 在 run detail 上执行 Follow Thread 后，\`followThread\` 会同时写进 run / session，暂停态保持不变 -> PASS`,
    `- room surface 会同步显示“跟随当前线程”，说明 follow-thread 不再只是文案，而是 live state -> PASS`,
    "",
    "### Resume: room / run / inbox return to one truth",
    "",
    `- Resume 后 room / run / issue / session 一起回到 \`running\`，follow-thread 标记保持为 true，普通 room composer 也恢复可发送 -> PASS`,
    `- \`/inbox\` recent ledger 会按顺序记录 \`Run 已暂停\`、\`已锁定当前线程\`、\`Run 已恢复\`，说明 stop / follow-thread / resume 已经写回同一条状态链 -> PASS`,
    "",
    "### Scope Boundary",
    "",
    "- 这轮只收 `TC-018` 的 stop / resume / follow-thread 闭环。",
    "- 不回退重复 `#96` 的 memory governance，也不把 `#98+` 的 scheduler / failover 混进来。",
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
