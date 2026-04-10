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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt65-governed-route-")));
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
  resolveChromiumExecutable();
  const initialState = await readState(serverURL);
  const requestTitle = initialState.workspace.governance.routingPolicy.suggestedHandoff.draftTitle;
  assert(requestTitle, "governed route should expose a draft title before auto-create");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-compose-governed-route").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-compose-governed-route-status")) === "ready",
    "governed compose route should start in ready state"
  );
  await page.getByTestId("mailbox-compose-governed-route-create").waitFor({ state: "visible" });
  await capture(page, "governed-compose-ready");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governed-route").waitFor({ state: "visible" });

  assert(
    (await readText(page, "mailbox-governed-route-status")) === "ready",
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

  const handoff = await waitForMailbox(serverURL, requestTitle);
  await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-governed-route-status")) === "active",
    "governed mailbox route should become active after creating the recommended handoff"
  );
  await capture(page, "governed-route-active");

  await page.goto(`${webURL}/inbox?roomId=room-runtime&handoffId=${handoff.id}`, { waitUntil: "load" });
  await page.getByTestId("mailbox-compose-governed-route").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-compose-governed-route-status")) === "active",
    "governed compose route should become active after auto-create"
  );
  await capture(page, "governed-compose-active");

  await page.getByTestId("mailbox-compose-governed-route-focus").click();
  await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
  await capture(page, "governed-route-focus-inbox");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${handoff.id}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-action-acknowledged-${handoff.id}`).click();
  await page.getByTestId(`mailbox-note-${handoff.id}`).fill("review 已完成，继续看下一条治理建议。");
  await page.getByTestId(`mailbox-action-completed-${handoff.id}`).click();
  await page.getByTestId(`mailbox-status-${handoff.id}`).waitFor({ state: "visible" });

  const stateAfterComplete = await readState(serverURL);
  const governedSuggestion = stateAfterComplete.workspace.governance.routingPolicy.suggestedHandoff;
  assert(governedSuggestion.status === "blocked", "next governed handoff should block when QA lane has no mapped agent");
  assert(governedSuggestion.toLaneLabel === "QA", "next governed handoff should point at the QA lane");
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="mailbox-governed-route-status"]')?.textContent?.trim() === "blocked";
  });
  await capture(page, "governed-route-next-blocked");

  await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="mailbox-compose-governed-route-status"]')?.textContent?.trim() === "blocked";
  });
  await capture(page, "governed-compose-next-blocked");

  const report = [
    "# 2026-04-11 Governed Mailbox Route Report",
    "",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-route -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/mailbox` 与 Inbox compose 都会读取 `workspace.governance.routingPolicy.suggestedHandoff`，并在 `ready` 状态下显式给出 `Create Governed Handoff` 一键起单入口 -> PASS",
    "- 通过 governed route 一键起单后，`/mailbox` 与 Inbox compose 会一起切到 `active`，并提供聚焦当前 handoff 的回链，防止同一路由被重复创建 -> PASS",
    "- 完成当前 reviewer handoff 后，两处 governed surface 会一起前滚到下一条 lane；当 QA lane 缺少可映射 agent 时，状态会显式转成 `blocked`，不会静默回退到随机接收方 -> PASS",
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
