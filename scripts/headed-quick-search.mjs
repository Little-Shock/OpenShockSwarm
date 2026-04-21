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
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-quick-search-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
const logsDir = path.join(runDir, "logs");

const screenshots = [];
const processes = [];

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

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

async function startServices() {
  const workspaceRoot = path.join(runDir, "workspace");
  const statePath = path.join(runDir, "state.json");
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;

  await mkdir(workspaceRoot, { recursive: true });

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
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/chat/all`);
    return response.ok;
  }, `web did not become ready at ${webURL}/chat/all`);

  return { webURL };
}

async function waitForVisible(page, testID) {
  await page.waitForFunction(
    (currentTestID) => Boolean(document.querySelector(`[data-testid="${currentTestID}"]`)),
    testID,
    { timeout: 30_000 }
  );
}

async function waitForPath(page, pathname) {
  await page.waitForFunction(
    (expectedPath) => window.location.pathname === expectedPath,
    pathname,
    { timeout: 30_000 }
  );
}

async function waitForUrlIncludes(page, fragment) {
  await page.waitForFunction(
    (expectedFragment) => window.location.href.includes(expectedFragment),
    fragment,
    { timeout: 30_000 }
  );
}

async function waitForPageText(page, expectedText) {
  await page.waitForFunction(
    (text) => document.body?.textContent?.includes(text) ?? false,
    expectedText,
    { timeout: 30_000 }
  );
}

async function waitForAnyPageText(page, expectedTexts) {
  await page.waitForFunction(
    (texts) => texts.some((text) => document.body?.textContent?.includes(text) ?? false),
    expectedTexts,
    { timeout: 30_000 }
  );
}

async function openQuickSearchWithTrigger(page, testID) {
  await page.getByTestId(testID).click();
  await waitForVisible(page, "quick-search-dialog");
}

async function openQuickSearchWithHotkey(page) {
  await page.keyboard.press("Control+K");
  await waitForVisible(page, "quick-search-dialog");
}

async function expectHighlightedResult(page, resultTestID) {
  await waitForVisible(page, resultTestID);
  const markCount = await page.getByTestId(resultTestID).locator("mark").count();
  assert(markCount > 0, `expected highlighted mark inside ${resultTestID}`);
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await page.goto(`${webURL}/chat/all`, { waitUntil: "load" });
  await waitForVisible(page, "quick-search-trigger-sidebar");
  await openQuickSearchWithTrigger(page, "quick-search-trigger-sidebar");
  await page.getByTestId("quick-search-input").fill("roadmap");
  await expectHighlightedResult(page, "quick-search-result-channel-roadmap");
  await page.getByTestId("quick-search-result-channel-roadmap").click();
  await waitForPath(page, "/chat/roadmap");
  await waitForPageText(page, "#roadmap");
  await capture(page, "channel-roadmap");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("Runtime 讨论间");
  await expectHighlightedResult(page, "quick-search-result-room-room-runtime");
  await page.keyboard.press("Enter");
  await waitForPath(page, "/rooms/room-runtime");
  await waitForPageText(page, "Runtime 讨论间");
  await capture(page, "room-runtime");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("OPS-19");
  await expectHighlightedResult(page, "quick-search-result-issue-issue-inbox");
  await page.getByTestId("quick-search-result-issue-issue-inbox").click();
  await waitForPath(page, "/issues/OPS-19");
  await waitForPageText(page, "OPS-19");
  await capture(page, "issue-ops-19");

  await openQuickSearchWithTrigger(page, "quick-search-trigger-topbar");
  await page.getByTestId("quick-search-input").fill("run_runtime_01");
  await expectHighlightedResult(page, "quick-search-result-run-run_runtime_01");
  await page.keyboard.press("Enter");
  await waitForPath(page, "/rooms/room-runtime/runs/run_runtime_01");
  await waitForPageText(page, "run_runtime_01");
  await capture(page, "run-runtime-01");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("Codex Dockmaster");
  await expectHighlightedResult(page, "quick-search-result-agent-agent-codex-dockmaster");
  await page.getByTestId("quick-search-result-agent-agent-codex-dockmaster").click();
  await waitForPath(page, "/profiles/agent/agent-codex-dockmaster");
  await waitForPageText(page, "Codex Dockmaster");
  await capture(page, "agent-dockmaster");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("Mina");
  await expectHighlightedResult(page, "quick-search-result-dm-dm-mina");
  await page.getByTestId("quick-search-result-dm-dm-mina").click();
  await waitForPath(page, "/chat/dm-mina");
  await waitForPageText(page, "稍后查看不应该像任务板");
  await capture(page, "dm-mina");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("runtime sync thread");
  await expectHighlightedResult(page, "quick-search-result-followed-followed-all-runtime");
  await page.getByTestId("quick-search-result-followed-followed-all-runtime").click();
  await waitForUrlIncludes(page, "/chat/all?tab=followed&thread=msg-all-2");
  await waitForVisible(page, "followed-thread-panel-card-followed-all-runtime");
  await capture(page, "followed-thread-result");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("Longwen default-entry");
  await expectHighlightedResult(page, "quick-search-result-saved-saved-roadmap-chat-first");
  await page.getByTestId("quick-search-result-saved-saved-roadmap-chat-first").click();
  await waitForUrlIncludes(page, "/chat/roadmap?tab=saved&thread=msg-roadmap-1");
  await waitForVisible(page, "saved-later-panel-card-saved-roadmap-chat-first");
  await capture(page, "saved-thread-result");

  await openQuickSearchWithHotkey(page);
  await page.getByTestId("quick-search-input").fill("zzzz-not-found");
  await waitForPageText(page, "没有匹配结果");
  await capture(page, "no-matches");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[data-testid="quick-search-dialog"]'), undefined, { timeout: 30_000 });

  const report = [
    "# 2026-04-09 快速搜索与消息入口报告",
    "",
    `- Command: \`pnpm test:headed-quick-search -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Channel / Room / Issue / Run / Agent Jump",
    "",
    "- 侧栏“快速搜索”入口已不再只是静态按钮；输入 `roadmap` 会出现高亮结果，并直接跳到 `/chat/roadmap` -> PASS",
    "- `Ctrl+K` 可在 room / run / agent 等高频页重复打开同一套命令面板；输入 `Runtime 讨论间`、`OPS-19`、`run_runtime_01`、`Codex Dockmaster` 都能命中对应 kind 并完成跳转 -> PASS",
    "- 事项页顶部的“快速搜索”触发器已接上真实结果面，不再只有占位文案 -> PASS",
    "",
    "### DM / Followed Thread / Saved Later Jump",
    "",
    "- 输入 `Mina` 会命中 server-backed `dm` 结果并直接进入 `/chat/dm-mina`；DM 不再只靠本地占位列表维持入口 -> PASS",
    "- 输入 `runtime sync thread` 会命中 `followed` 结果并打开 `/chat/all?tab=followed&thread=msg-all-2`；同一条 thread 能从 search result 直接回到 followed revisit rail -> PASS",
    "- 输入 `Longwen default-entry` 会命中 `saved` 结果并打开 `/chat/roadmap?tab=saved&thread=msg-roadmap-1`；saved-later 不再只是 sidebar 入口，也能作为 search result 直接 reopen -> PASS",
    "",
    "### Highlight / Empty State",
    "",
    "- 搜索命中项会在标题或摘要里显式高亮关键字，验证了 `roadmap`、`OPS-19`、`run_runtime_01`、`Codex Dockmaster`、`Mina`、`runtime sync thread`、`Longwen default-entry` 的 `<mark>` 呈现 -> PASS",
    "- 输入 `zzzz-not-found` 时不会误跳转，而是稳定展示“没有匹配结果”；`Esc` 可正常关闭面板 -> PASS",
    "",
    "### Scope Boundary",
    "",
    "- 这轮继续保留 `channel / room / issue / run / agent` 的既有 `TKT-21` 覆盖，同时补齐 `TKT-27` 负责的 `dm / followed / saved` search result contract。",
    "- mailbox / handoff 仍不在这轮范围；这里只收 message-surface reopen / jump target 的 backend contract。",
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
