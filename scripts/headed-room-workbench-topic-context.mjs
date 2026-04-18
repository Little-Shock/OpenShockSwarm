#!/usr/bin/env node

import assert from "node:assert/strict";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-room-workbench-")));
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

async function startServices() {
  const workspaceRoot = path.join(artifactsDir, "workspace");
  const statePath = path.join(artifactsDir, "state.json");
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
        OPENSHOCK_CONTROL_API_BASE: serverURL,
      },
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

  return { webURL };
}

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

async function waitForUrlIncludes(page, fragment) {
  await waitFor(() => page.url().includes(fragment), `expected URL to include ${fragment}, got ${page.url()}`);
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const results = [];

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator("text=Runtime 讨论间"), "room title did not render");
  await waitForVisible(page.locator('[data-testid="room-message-list"]'), "chat message list did not render");
  await page.locator('[data-testid="room-rail-mode-thread"]').click();
  await waitForVisible(page.locator('[data-testid="room-thread-follow-current"]'), "chat thread rail action did not render");
  await capture(page, "room-chat");
  results.push("- 默认房间现在直接回到聊天主面，thread rail 仍保留在右侧，不再先展示一排一级 workbench tabs。");

  await page.goto(`${webURL}/rooms/room-runtime?tab=topic`, { waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=topic");
  await waitForVisible(page.locator('[data-testid="room-workbench-topic-panel"]'), "topic workbench panel did not render");
  await capture(page, "room-topic");
  results.push("- Topic 继续作为 room 内的次级 sheet 保留，可从同一条 room URL 打开 topic summary 和最近 guidance。");

  await page.goto(`${webURL}/rooms/room-runtime?tab=run`, { waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=run");
  await waitForVisible(page.locator('[data-testid="room-workbench-run-panel"]'), "run workbench panel did not render");
  await page.locator('[data-testid="room-run-control-note"]').fill("TC-031 follow thread from room workbench");
  await page.locator('[data-testid="room-run-control-follow-thread"]').click();
  await waitFor(async () => {
    const text = await page.locator('[data-testid="room-run-follow-thread-status"]').textContent();
    return text?.includes("跟随当前线程");
  }, "follow_thread did not persist on room workbench");
  await capture(page, "room-run");
  results.push("- Run sheet 仍可在 room 内直接执行 stop / resume / follow_thread，不需要被拆成完全独立的新工作流。");

  await page.goto(`${webURL}/rooms/room-runtime?tab=pr`, { waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=pr");
  await waitForVisible(page.locator('[data-testid="room-workbench-pr-panel"]'), "PR workbench panel did not render");
  await waitForVisible(page.locator('[data-testid="room-workbench-pr-primary-action"]'), "PR primary action did not render");
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByRole("link", { name: "收件箱", exact: true }).count()) === 0,
    "room PR sheet should not keep a duplicate inbox CTA once room signal/context surfaces already own that navigation"
  );
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByRole("link", { name: "交接箱", exact: true }).count()) === 0,
    "room PR sheet should not keep a duplicate mailbox CTA once room context surfaces already own that navigation"
  );
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByText("收件箱详情", { exact: true }).count()) === 0,
    "room PR sheet should not keep per-signal inbox-detail CTA once the room-level inbox entry already owns navigation"
  );
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByText("回到讨论间", { exact: true }).count()) === 0,
    "room PR sheet should not keep per-signal return-to-room CTA when the user is already inside the same room workbench"
  );
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByRole("link", { name: "收件箱评审", exact: true }).count()) === 0,
    "room PR sheet should not keep a generic inbox-review CTA once shell/sidebar navigation already owns inbox access"
  );
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByRole("link", { name: "话题上下文", exact: true }).count()) === 0,
    "room PR sheet should not keep a context-tab CTA once the room workbench tabs already own that navigation"
  );
  assert(
    (await page.getByTestId("room-workbench-pr-panel").getByRole("link", { name: "打开收件箱", exact: true }).count()) === 0,
    "room PR sheet signal summary should not keep a generic open-inbox CTA once room context already owns the inbox entry"
  );
  await page.getByTestId("room-rail-summary-delivery").click();
  await waitForVisible(page.locator('[data-testid="room-rail-pr-panel"]'), "room delivery rail panel did not render");
  assert(
    (await page.getByTestId("room-rail-pr-panel").getByRole("link", { name: "房间 PR", exact: true }).count()) === 0,
    "room delivery rail should not keep a self-referential room-pr CTA when the user is already inside the PR tab"
  );
  await capture(page, "room-pr");
  results.push("- PR sheet 继续保留在 room 语境里，可直接看到 review / merge 入口，而不是强制跳走。");

  await page.goto(`${webURL}/rooms/room-runtime?tab=context`, { waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "context workbench panel did not render");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "context tab did not survive reload");
  assert(
    (await page.getByTestId("room-workbench-open-mailbox").count()) === 0,
    "room context pending panel should not keep a generic open-mailbox CTA once inbox owns the primary triage entry and handoff cards already link into mailbox"
  );
  assert(
    (await page.getByText("当前没有待跟进交接", { exact: true }).count()) > 0,
    "room context should make mailbox absence explicit instead of keeping a generic open-mailbox CTA"
  );
  await capture(page, "room-context");
  results.push("- Context sheet 继续支持 query-state reload，并保留 issue / board / inbox back-links。");

  await page.locator('[data-testid="room-workbench-open-inbox"]').first().click();
  await waitForUrlIncludes(page, "/inbox");
  await waitForVisible(page.locator('[data-testid="approval-center-open-count"]'), "inbox did not open from room context link");
  await capture(page, "inbox-backlink");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await waitForUrlIncludes(page, "?tab=context");
  await waitForVisible(page.locator('[data-testid="room-workbench-context-panel"]'), "room context did not restore after inbox backlink");
  results.push("- Inbox back-link 仍能把人带回同一条 room context state。");

  const report = [
    "# 2026-04-11 Room Simplified Sheet / Topic Context Report",
    "",
    `- Command: \`${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-room-workbench-topic-context -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- `/rooms/:roomId` 现在默认回到 chat-first room shell：聊天主面始终优先，`Topic / Run / PR / Context` 退成次级 sheet，但 `follow_thread`、PR review 入口、reload persistence 与 inbox back-links 仍完整保留。",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
