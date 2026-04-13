#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-message-send-flow-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const freshStackMetadataPath = path.join(projectRoot, "data", "dev", "fresh-stack", "stack.json");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const screenshots = [];
const processes = [];
const findings = [];
const MESSAGE_PLACEHOLDER = "正在生成回复...";

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

function timestamp() {
  return new Date().toISOString();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function record(line) {
  findings.push(`- ${line}`);
}

function isPidRunning(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

async function readFreshStackMetadata() {
  try {
    return JSON.parse(await readFile(freshStackMetadataPath, "utf8"));
  } catch {
    return null;
  }
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

async function runForeground(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logPath = path.join(logsDir, `fresh-stack-bootstrap.log`);
    const logStream = createWriteStream(logPath, { flags: "a" });
    logStream.write(`[${timestamp()}] ${command} ${args.join(" ")}\n`);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on("exit", (code, signal) => {
      logStream.write(`\n[${timestamp()}] exited code=${code} signal=${signal}\n`);
      logStream.end();
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "null"} signal ${signal ?? "null"}`));
    });
  });
}

async function cleanupProcesses() {
  await Promise.allSettled(processes.map((entry) => stopProcess(entry.child)));
}

async function waitFor(predicate, message, timeoutMs = 120_000, intervalMs = 250) {
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

async function waitForPage(page, url, options = {}) {
  const { expectedPath, expectedTestID } = options;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (expectedPath) {
    await waitFor(async () => page.url().includes(expectedPath), `${url} did not reach expected path: ${expectedPath}`);
  }
  if (expectedTestID) {
    await page.locator(`[data-testid="${expectedTestID}"]:visible`).first().waitFor({
      state: "visible",
      timeout: 120_000,
    });
  }
}

async function waitForVisibleText(page, text, message) {
  await waitFor(async () => (await page.getByText(text, { exact: false }).count()) > 0, message);
}

async function waitForButtonLabel(page, testId, label, message) {
  await waitFor(async () => {
    const text = await page.getByTestId(testId).textContent();
    return String(text ?? "").includes(label);
  }, message);
}

async function waitForButtonEnabled(page, testId, message) {
  await page.waitForFunction(
    (id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      return element instanceof HTMLButtonElement && !element.disabled;
    },
    testId,
    { timeout: 10_000 }
  ).catch(() => {
    throw new Error(message);
  });
}

async function waitForPostRequest(page, urlFragment, message, timeoutMs = 120_000) {
  return page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes(urlFragment),
    { timeout: timeoutMs }
  ).catch(() => {
    throw new Error(message);
  });
}

async function waitForRequestCompletion(request, message, timeoutMs = 120_000) {
  return waitFor(async () => {
    const response = await request.response();
    return response ?? false;
  }, message, timeoutMs, 250);
}

async function readServerState(serverURL) {
  const response = await fetch(`${serverURL}/v1/state`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`state endpoint failed: ${response.status}`);
  }
  return response.json();
}

async function loginFreshWorkspaceOwner(serverURL) {
  const response = await fetch(`${serverURL}/v1/auth/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "owner@openshock.local",
      name: "Workspace Owner",
      deviceLabel: "Headed Send Flow",
    }),
  });

  if (!response.ok) {
    throw new Error(`fresh workspace login failed: ${response.status}`);
  }
}

async function createIssueForRoom(serverURL) {
  const response = await fetch(`${serverURL}/v1/issues`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `发送流验证事项 ${Date.now()}`,
      summary: "为讨论间发送链路创建一个真实 room。",
      owner: "启动智能体",
      priority: "high",
    }),
  });

  if (!response.ok) {
    throw new Error(`issue create failed: ${response.status}`);
  }

  const payload = await response.json();
  const roomId = String(payload.roomId ?? "").trim();
  if (!roomId) {
    throw new Error("issue create did not return a roomId");
  }
  return roomId;
}

function stateHasMessage(state, kind, scopeId, needle) {
  if (kind === "channel") {
    return Array.isArray(state.channelMessages?.[scopeId]) && state.channelMessages[scopeId].some((item) => String(item?.message ?? "").includes(needle));
  }
  return Array.isArray(state.roomMessages?.[scopeId]) && state.roomMessages[scopeId].some((item) => String(item?.message ?? "").includes(needle));
}

async function waitForStateMessage(statePath, kind, scopeId, needle, message) {
  await waitFor(async () => {
    const body = await readFile(statePath, "utf8");
    const state = JSON.parse(body);
    return stateHasMessage(state, kind, scopeId, needle);
  }, message, 90_000, 400);
}

async function waitForServerStateMessage(serverURL, kind, scopeId, needle, message) {
  await waitFor(async () => {
    const state = await readServerState(serverURL);
    return stateHasMessage(state, kind, scopeId, needle);
  }, message, 90_000, 400);
}

async function startServices() {
  const metadataReady = (metadata) =>
    metadata?.status === "ready" &&
    typeof metadata?.urls?.web === "string" &&
    typeof metadata?.urls?.server === "string" &&
    typeof metadata?.statePath === "string" &&
    Object.values(metadata?.processes ?? {}).every((entry) => !entry?.pid || isPidRunning(entry.pid));

  let metadata = await readFreshStackMetadata();

  if (!metadataReady(metadata)) {
    await runForeground("node", ["./scripts/dev-fresh-stack.mjs", "start", "--no-open"], {
      cwd: projectRoot,
      env: process.env,
    });
    metadata = await readFreshStackMetadata();
  }

  if (!metadataReady(metadata)) {
    throw new Error("OpenShock fresh stack is not ready for message send verification");
  }

  const webURL = metadata.urls.web;
  const serverURL = metadata.urls.server;
  const statePath = path.resolve(projectRoot, metadata.statePath);

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/chat/all`);
    return response.ok;
  }, `web did not become ready at ${webURL}/chat/all`);

  return { webURL, serverURL, statePath };
}

async function verifyChannelSend(page, webURL, serverURL, statePath) {
  const uniqueText = `频道发送流验证 ${Date.now()}`;

  await page.route(
    "**/v1/channels/all/messages",
    async (route) => {
      await delay(1500);
      await route.continue();
    },
    { times: 1 }
  );

  await waitForPage(page, `${webURL}/chat/all`, {
    expectedPath: "/chat/all",
    expectedTestID: "channel-message-input",
  });

  await page.getByTestId("channel-message-input").fill(uniqueText);
  await waitForButtonEnabled(page, "channel-send-message", "channel send button did not become enabled after typing");
  const requestPromise = waitForPostRequest(
    page,
    "/v1/channels/all/messages",
    "channel send request did not reach the control API"
  );
  await page.getByTestId("channel-message-input").press("Enter");

  await waitForVisibleText(page, uniqueText, "channel optimistic human message did not appear immediately");
  await waitForVisibleText(page, MESSAGE_PLACEHOLDER, "channel placeholder did not appear while request was in flight");
  await waitForButtonLabel(page, "channel-send-message", "发送中", "channel send button did not expose sending state");
  record("频道发送后，人类消息会先出现在消息流里，同时显示“发送中”和“正在生成回复...” -> PASS");

  const request = await requestPromise;
  const response = await waitForRequestCompletion(request, "channel send request did not complete");
  assert([200, 502].includes(response.status()), `channel send response failed with status ${response.status()}`);
  const payload = await response.json();
  assert(stateHasMessage(payload.state ?? {}, "channel", "all", uniqueText), "channel response state did not include the new human message");
  if (response.status() === 200) {
    record("频道发送请求返回 200，返回状态里已经带回新的会话内容 -> PASS");
  } else {
    assert(typeof payload.error === "string" && payload.error.trim().length > 0, "channel degraded response did not include an error message");
    await waitForVisibleText(page, payload.error, "channel degraded response did not surface the blocked reason");
    record(`频道发送在当前模型不可用时，会把阻塞原因明确展示并写回状态：${payload.error} -> PASS`);
  }

  await waitForServerStateMessage(serverURL, "channel", "all", uniqueText, "channel message did not appear in live state");
  await waitForStateMessage(statePath, "channel", "all", uniqueText, "channel message did not persist into state");
  await waitForButtonLabel(page, "channel-send-message", "发送", "channel send button did not recover after response");
  await capture(page, "channel-send-finished");

  await waitForPage(page, `${webURL}/chat/roadmap`, {
    expectedPath: "/chat/roadmap",
    expectedTestID: "channel-message-input",
  });
  await waitForPage(page, `${webURL}/chat/all`, {
    expectedPath: "/chat/all",
    expectedTestID: "channel-message-input",
  });
  await waitForVisibleText(page, uniqueText, "channel message did not persist after navigation");
  record("频道消息在离开再返回后仍然保留，说明不是只在本地临时渲染 -> PASS");
}

async function verifyRoomSend(page, webURL, serverURL, statePath, roomId) {
  const uniqueText = `讨论间发送流验证 ${Date.now()}`;

  await page.route(
    `**/v1/rooms/${roomId}/messages/stream`,
    async (route) => {
      await delay(1500);
      await route.continue();
    },
    { times: 1 }
  );

  await waitForPage(page, `${webURL}/rooms/${roomId}`, {
    expectedPath: `/rooms/${roomId}`,
    expectedTestID: "room-message-input",
  });

  await page.getByTestId("room-message-input").fill(uniqueText);
  await waitForButtonEnabled(page, "room-send-message", "room send button did not become enabled after typing");
  const requestPromise = waitForPostRequest(
    page,
    `/v1/rooms/${roomId}/messages/stream`,
    "room send request did not reach the control API"
  );
  await page.getByTestId("room-message-input").press("Enter");

  await waitForVisibleText(page, uniqueText, "room optimistic human message did not appear immediately");
  await waitForVisibleText(page, MESSAGE_PLACEHOLDER, "room placeholder did not appear while request was in flight");
  await waitForButtonLabel(page, "room-send-message", "发送中", "room send button did not expose sending state");
  record("讨论间发送后，人类消息会先落到流里，按钮和回复占位会一起进入发送态 -> PASS");

  const request = await requestPromise;
  const response = await waitForRequestCompletion(request, "room send request did not complete");
  assert(response.ok(), `room send response failed with status ${response.status()}`);
  record("讨论间流式请求已经建立，服务端开始返回消息流 -> PASS");

  await waitForServerStateMessage(serverURL, "room", roomId, uniqueText, "room message did not appear in live state");
  await waitForStateMessage(statePath, "room", roomId, uniqueText, "room message did not persist into state");
  await waitForButtonLabel(page, "room-send-message", "发送", "room send button did not recover after response");
  await capture(page, "room-send-finished");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitFor(async () => page.url().includes(`/rooms/${roomId}`), "room page did not stay on the same route after reload");
  await page.getByTestId("room-message-input").waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await waitForVisibleText(page, uniqueText, "room message did not persist after reload");
  record("讨论间消息在刷新后仍可见，说明流式回写已经真正落到状态里 -> PASS");
  await capture(page, "room-send-reloaded");
}

let browser;

try {
  resolveChromiumExecutable();
  const { webURL, serverURL, statePath } = await startServices();
  await loginFreshWorkspaceOwner(serverURL);
  const roomId = await createIssueForRoom(serverURL);
  browser = await launchChromiumSession(chromium);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await verifyChannelSend(page, webURL, serverURL, statePath);
  await verifyRoomSend(page, webURL, serverURL, statePath, roomId);

  const reportLines = [
    "# Headed Message Send Flow Report",
    "",
    `- Generated at: ${timestamp()}`,
    `- Web URL: ${webURL}`,
    `- Control URL: ${serverURL}`,
    "",
    "## Checks",
    ...findings,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${path.relative(path.dirname(reportPath), shot.path)}`),
    "",
    "VERDICT: PASS",
    "",
  ];

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8");
  console.log(`Report written to ${reportPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const reportLines = [
    "# Headed Message Send Flow Report",
    "",
    `- Generated at: ${timestamp()}`,
    "",
    "## Failure",
    `- ${message}`,
    "",
    "VERDICT: FAIL",
    "",
  ];

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8");
  console.error(message);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
  await cleanupProcesses();
}
