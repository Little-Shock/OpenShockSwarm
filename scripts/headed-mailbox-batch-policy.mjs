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
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt94-mailbox-batch-policy-")));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-mailbox-batch-policy";
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

async function createHandoff(serverURL, input) {
  return fetchJSON(`${serverURL}/v1/mailbox`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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
      document.querySelector(`[data-testid="mailbox-status-${currentHandoffId}"]`)?.textContent?.trim() ===
      currentExpectedLabel,
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

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: webEnv,
  });

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
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
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

  const governedDefinitions = [
    {
      roomId: "room-runtime",
      fromAgentId: "agent-codex-dockmaster",
      toAgentId: "agent-claude-review-runner",
      title: `Governed batch reviewer lane A ${Date.now()}`,
      summary: "第一条 governed reviewer lane，用于验证 batch auto-advance policy。",
      kind: "governed",
    },
    {
      roomId: "room-runtime",
      fromAgentId: "agent-codex-dockmaster",
      toAgentId: "agent-claude-review-runner",
      title: `Governed batch reviewer lane B ${Date.now() + 1}`,
      summary: "第二条 governed reviewer lane，用于验证 batch auto-advance policy。",
      kind: "governed",
    },
  ];
  const batchCompleteNote = "Governed batch closeout: reviewer lane 已成批收口，请继续把 QA 一棒自动接起来。";

  const created = [];
  for (const definition of governedDefinitions) {
    const payload = await createHandoff(serverURL, definition);
    created.push(payload.handoff);
  }

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  for (const handoff of created) {
    await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
    await waitForMailboxStatus(page, handoff.id, "requested");
  }
  await capture(page, "mailbox-batch-policy-requested");

  await page.getByTestId("mailbox-batch-select-open").click();
  await waitFor(async () => (await readText(page, "mailbox-batch-selected-count")) === "已选 2", "batch selection count did not reach 2");
  assert((await readText(page, "mailbox-batch-policy-status")) === "关注", "governed batch policy should wait until selected handoffs are completable");
  await capture(page, "mailbox-batch-policy-selected");

  await page.getByTestId("mailbox-batch-action-acknowledged").click();
  for (const handoff of created) {
    await waitForMailboxStatus(page, handoff.id, "acknowledged");
  }
  assert((await readText(page, "mailbox-batch-policy-status")) === "就绪", "governed batch policy should become ready after acknowledge");
  await capture(page, "mailbox-batch-policy-ready");

  await page.getByTestId("mailbox-batch-note").fill(batchCompleteNote);
  await page.getByTestId("mailbox-batch-action-completed-continue").click();
  for (const handoff of created) {
    await waitForMailboxStatus(page, handoff.id, "completed");
  }
  await waitFor(async () => (await readText(page, "mailbox-batch-selected-count")) === "已选 0", "batch selection should clear after governed batch complete");

  const finalState = await waitFor(async () => {
    const state = await readState(serverURL);
    const followup = state.mailbox.find((item) => item.status === "requested" && item.fromAgent === "Claude Review Runner" && item.toAgent === "Memory Clerk");
    if (!followup || followup.kind !== "governed") {
      return false;
    }
    if (state.workspace.governance.routingPolicy.suggestedHandoff?.handoffId !== followup.id) {
      return false;
    }
    const completedSourceHandoffs = created.every((handoff) => {
      const current = state.mailbox.find((item) => item.id === handoff.id);
      return current?.status === "completed" && current?.kind === "governed" && current?.lastNote === batchCompleteNote;
    });
    return completedSourceHandoffs ? { state, followup } : false;
  }, "governed batch auto-advance did not materialize a followup handoff");

  await page.getByTestId(`mailbox-card-${finalState.followup.id}`).waitFor({ state: "visible" });
  await waitForMailboxStatus(page, finalState.followup.id, "requested");
  await capture(page, "mailbox-batch-policy-followup");

  const report = [
    "# 2026-04-11 Mailbox Batch Policy Report",
    "",
    "- Ticket: `TKT-94`",
    "- Checklist: `CHK-21`",
    "- Test Case: `TC-083`",
    "- Scope: governed batch policy, bulk complete + auto-advance, governed create contract, selection clear-down",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-mailbox-batch-policy -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `Create Governed Handoff` 现在对应同一条正式 create contract；seed 进来的 batch items 会保留 `kind=governed`，不再把 governed route 假装成 manual handoff -> PASS",
    "- 当前 room ledger 里的纯 governed selection 会先显示 `watch`，等 handoff 进入可 complete 状态后切到 `ready`，说明 batch surface 已读到正式治理 policy，而不是写死一个额外按钮 -> PASS",
    "- `Batch Complete + Auto-Advance` 会顺序完成所有 selected governed handoff，并在 closeout 后只物化一条新的 reviewer -> QA followup handoff，避免重复起单 -> PASS",
    "- 两条源 handoff 都保留同一份 closeout note，selection 自动清空，routing policy 会把 followup handoff 标成新的 active suggestion，说明 bulk auto-advance 已进入正式产品面 -> PASS",
    "",
    "## Assertions",
    "",
    `- Source handoffs: ${created.map((handoff) => handoff.id).join(", ")}`,
    `- Followup handoff: ${finalState.followup.id} (${finalState.followup.fromAgent} -> ${finalState.followup.toAgent})`,
    `- Suggested handoff: ${finalState.state.workspace.governance.routingPolicy.suggestedHandoff.handoffId}`,
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
