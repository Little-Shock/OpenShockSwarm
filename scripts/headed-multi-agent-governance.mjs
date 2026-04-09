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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt36-governance-")));
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

async function waitForMailboxStatus(page, handoffId, expected) {
  await page.waitForFunction(
    ({ currentHandoffId, currentExpected }) => {
      return (
        document
          .querySelector(`[data-testid="mailbox-status-${currentHandoffId}"]`)
          ?.textContent?.trim() === currentExpected
      );
    },
    { currentHandoffId: handoffId, currentExpected: expected },
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
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);

  return { webURL, serverURL };
}

let browser = null;
let context = null;
let page = null;

try {
  const { webURL, serverURL } = await startServices();
  const chromiumExecutable = resolveChromiumExecutable();
  const requestTitle = `把 runtime reviewer lane 交给 Claude ${Date.now()}`;
  const requestSummary =
    "请你正式接住 current reviewer lane，并把 blocked / complete / closeout note 写回治理链。";
  const blockedNote = "等 reviewer evidence 先收平。";
  const completeNote = "review / test evidence 已收平，可以回到最终响应。";

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await context.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-template").waitFor({ state: "visible" });
  assert(
    (await readText(page, "setup-governance-template")).includes("开发团队治理链"),
    "setup governance preview should resolve to dev-team governance"
  );
  await page.getByTestId("setup-governance-lane-reviewer").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-lane-qa").waitFor({ state: "visible" });
  await capture(page, "setup-governance-preview");

  const stateAfterTemplate = await readState(serverURL);
  assert(
    stateAfterTemplate.workspace.governance.templateId === "dev-team",
    "server state should derive dev-team governance after template sync"
  );
  assert(
    stateAfterTemplate.workspace.governance.teamTopology.some((lane) => lane.id === "reviewer") &&
      stateAfterTemplate.workspace.governance.teamTopology.some((lane) => lane.id === "qa"),
    "governance team topology should include reviewer and qa lanes"
  );

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governance-template").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-governance-template")).includes("开发团队治理链"),
    "mailbox governance surface should reflect dev-team topology"
  );
  assert(
    (await readText(page, "mailbox-governance-human-override")) === "required",
    "mailbox governance surface should expose the explicit human override gate"
  );
  await page.getByTestId("mailbox-governance-step-review").waitFor({ state: "visible" });
  await page.getByTestId("mailbox-governance-step-test").waitFor({ state: "visible" });
  await capture(page, "mailbox-governance-baseline");

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
  await waitFor(async () => (await readText(page, "mailbox-governance-open-handoffs")) === "1", "governance stat did not update to 1 open handoff");
  await capture(page, "mailbox-governance-requested");

  await page.getByTestId(`mailbox-note-${handoffId}`).fill(blockedNote);
  await page.getByTestId(`mailbox-action-blocked-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "blocked");
  await page.getByTestId("mailbox-governance-lane-status-reviewer").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-governance-lane-status-reviewer")) === "blocked",
    "reviewer lane should surface blocked escalation"
  );
  await capture(page, "mailbox-governance-blocked");

  await page.getByTestId(`mailbox-action-acknowledged-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "acknowledged");
  await page.getByTestId(`mailbox-note-${handoffId}`).fill(completeNote);
  await page.getByTestId(`mailbox-action-completed-${handoffId}`).click();
  await waitForMailboxStatus(page, handoffId, "completed");
  await waitFor(async () => {
    return (await readText(page, "mailbox-governance-response-aggregation")).includes("最终响应");
  }, "response aggregation did not expose completed closeout note");
  await capture(page, "mailbox-governance-completed");

  const stateAfterComplete = await readState(serverURL);
  const handoffStep = stateAfterComplete.workspace.governance.walkthrough.find((item) => item.id === "handoff");
  const finalStep = stateAfterComplete.workspace.governance.walkthrough.find((item) => item.id === "final-response");
  assert(handoffStep?.status === "done", "handoff walkthrough step should settle to done after completion");
  assert(finalStep?.status === "ready", "final response walkthrough step should be ready after completion");
  assert(
    stateAfterComplete.workspace.governance.responseAggregation.status === "ready" &&
      stateAfterComplete.workspace.governance.responseAggregation.finalResponse.includes("最终响应"),
    "server governance snapshot should aggregate final response closeout note"
  );

  const report = [
    "# 2026-04-09 Multi-Agent Governance / Reviewer-Tester Loop Report",
    "",
    `- Command: \`pnpm test:headed-multi-agent-governance -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/setup` 现在会把模板同步成 governance preview；`开发团队` 模板会直接露出 PM / Architect / Developer / Reviewer / QA topology，而不是只剩静态 onboarding notes -> PASS",
    "- `/mailbox` 现在新增 multi-agent governance surface：team topology、review/test/blocked/human-override rules、response aggregation 和 TC-041 walkthrough 会围同一份 workspace truth 前滚 -> PASS",
    "- exact replay 已覆盖 `issue -> handoff -> review -> test -> final response`：从 room-runtime 创建 formal handoff、切到 blocked escalation、再 completed closeout 后，walkthrough 与 response aggregation 会同步前滚 -> PASS",
    "- explicit human override gate 继续可见：runtime lane 现有 approval item 会在 governance surface 上显示 `required`，不会被 reviewer/tester loop 隐身 -> PASS",
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
