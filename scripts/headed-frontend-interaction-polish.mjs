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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-frontend-polish-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const screenshots = [];
const processes = [];
const notes = {
  channel: [],
  room: [],
  work: [],
  narrow: [],
  boundary: [],
};

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

function record(section, message) {
  notes[section].push(`- ${message}`);
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

async function waitForPage(page, url, expectedText) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitFor(async () => {
    const content = await page.content();
    return content.includes(expectedText);
  }, `${url} did not render expected text: ${expectedText}`);
}

async function visibleBox(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 120_000 });
  const box = await locator.boundingBox();
  assert(box, `${label} did not produce a visible bounding box`);
  const viewport = page.viewportSize();
  assert(viewport, `${label} did not expose viewport information`);
  return { box, viewport };
}

async function assertMinHitArea(page, locator, label, section, minWidth = 44, minHeight = 44) {
  const { box } = await visibleBox(page, locator, label);
  assert(box.width >= minWidth, `${label} width ${Math.round(box.width)} < ${minWidth}`);
  assert(box.height >= minHeight, `${label} height ${Math.round(box.height)} < ${minHeight}`);
  record(section, `${label} 命中区 ${Math.round(box.width)}x${Math.round(box.height)}，达到高频点击下限 -> PASS`);
}

async function assertVisibleInViewport(page, locator, label, section) {
  const { box, viewport } = await visibleBox(page, locator, label);
  assert(box.x >= 0, `${label} extends beyond left viewport edge`);
  assert(box.y >= 0, `${label} extends beyond top viewport edge`);
  assert(box.x + box.width <= viewport.width + 1, `${label} extends beyond right viewport edge`);
  assert(box.y + box.height <= viewport.height + 1, `${label} extends beyond bottom viewport edge`);
  record(section, `${label} 保持在当前视口内 (${Math.round(box.y + box.height)} / ${viewport.height}) -> PASS`);
}

async function assertNoHorizontalOverflow(page, label, section) {
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(metrics.scrollWidth <= metrics.width + 1, `${label} has horizontal overflow (${metrics.scrollWidth} > ${metrics.width})`);
  record(section, `${label} 在 ${metrics.width}px 视口下没有横向溢出 -> PASS`);
}

async function scrollContainerTo(page, testId, ratio) {
  await page.getByTestId(testId).evaluate((node, ratioValue) => {
    if (!(node instanceof HTMLElement)) {
      throw new Error(`test id ${testId} is not an HTMLElement`);
    }
    node.scrollTop = Math.round(Math.max(0, (node.scrollHeight - node.clientHeight) * Number(ratioValue)));
  }, ratio);
  await delay(250);
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
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);

  return { webURL };
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  record("boundary", "`TKT-24` 当前只验证 interaction polish：不包含 quick search result surface，也不依赖 room workbench 新 contract。");

  await waitForPage(page, `${webURL}/chat/all`, "Quick Search");
  await assertMinHitArea(page, page.getByTestId("quick-search-trigger-sidebar"), "Sidebar Quick Search", "channel");
  await assertMinHitArea(page, page.getByTestId("quick-search-trigger-topbar"), "Topbar Quick Search", "channel");
  await assertVisibleInViewport(page, page.getByTestId("channel-message-input"), "Channel composer", "channel");
  await scrollContainerTo(page, "channel-message-list", 0.55);
  await assertVisibleInViewport(page, page.getByTestId("channel-message-input"), "Channel composer after scroll", "channel");
  const channelReplyButton = page.locator('[data-testid="channel-message-list"] button').first();
  await assertMinHitArea(page, channelReplyButton, "Channel reply action", "channel");
  await capture(page, "chat-channel-scrollback");
  await channelReplyButton.click();
  await waitFor(async () => (await page.content()).includes("thread open"), "channel thread state did not become active");
  record("channel", "频道消息流滚动后，reply action 仍可直接把 thread 交给右侧 rail，说明高亮与入口没有漂移 -> PASS");
  await capture(page, "chat-thread-focus");

  await waitForPage(page, `${webURL}/rooms/room-runtime`, "Issue Room");
  await assertMinHitArea(page, page.getByRole("link", { name: "Issue" }).first(), "Room issue link", "room");
  await assertMinHitArea(page, page.getByRole("link", { name: "Board" }).first(), "Room board link", "room");
  await assertVisibleInViewport(page, page.getByTestId("room-message-input"), "Room composer", "room");
  await scrollContainerTo(page, "room-message-list", 0.55);
  await assertVisibleInViewport(page, page.getByTestId("room-message-input"), "Room composer after scroll", "room");
  const roomReplyButton = page.locator('[data-testid="room-message-list"] button').first();
  await assertMinHitArea(page, roomReplyButton, "Room reply action", "room");
  await capture(page, "room-scrollback");
  await roomReplyButton.click();
  await page.getByTestId("room-thread-follow-current").waitFor({ state: "visible", timeout: 120_000 });
  await assertMinHitArea(page, page.getByTestId("room-thread-follow-current"), "Thread lock action", "room");
  record("room", "room message list 在滚动与 thread 打开后，composer 仍常驻可见，follow-thread 控件也维持可点 -> PASS");
  await capture(page, "room-thread-rail");

  await waitForPage(page, `${webURL}/setup`, "工作区在线状态");
  await assertNoHorizontalOverflow(page, "Setup work surface", "work");
  await capture(page, "setup-density");

  await waitForPage(page, `${webURL}/inbox`, "Approval Center");
  await assertNoHorizontalOverflow(page, "Inbox work surface", "work");
  record("work", "Setup / Inbox 都沿用更紧凑的 work shell 卡片密度，没有再出现需要横向挤压的白缝 -> PASS");
  await capture(page, "inbox-density");

  await page.setViewportSize({ width: 1180, height: 1100 });
  await waitForPage(page, `${webURL}/rooms/room-runtime`, "Issue Room");
  await assertNoHorizontalOverflow(page, "Narrow room surface", "narrow");
  await assertVisibleInViewport(page, page.getByTestId("room-message-input"), "Narrow room composer", "narrow");
  record("narrow", "1180px 窄屏抽查下，message list 与 composer 仍同页可用，不需要横向拖拽 -> PASS");
  await capture(page, "room-narrow");

  const report = [
    "# TKT-24 Frontend Interaction Polish Report",
    "",
    `- Command: \`pnpm test:headed-frontend-interaction-polish -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Scope Boundary",
    ...notes.boundary,
    "",
    "## Results",
    "",
    "### Channel Shell + Scrollback",
    ...notes.channel,
    "",
    "### Room Composer + Thread Rail",
    ...notes.room,
    "",
    "### Work Surface Density",
    ...notes.work,
    "",
    "### Narrow Viewport Spot Check",
    ...notes.narrow,
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await browser?.close().catch(() => {});
  await cleanupProcesses();
}
