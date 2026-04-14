#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
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
const artifactsRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-room-chat-reload-")));
const artifactsDir = path.resolve(artifactsRoot);
const args = parseArgs(process.argv.slice(2));
const reportPath = args.reportPath
  ? path.resolve(projectRoot, args.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-room-chat-reload";
const webDistDir = path.join(projectRoot, "apps", "web", webDistDirName);
const processes = [];
const checks = [];
const screenshots = [];

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });

function parseArgs(argv) {
  const result = { reportPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") {
      result.reportPath = argv[index + 1] ?? "";
      index += 1;
    }
  }
  return result;
}

function timestamp() {
  return new Date().toISOString();
}

function recordCheck(title, command, output) {
  checks.push({ title, command, output });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

function startProcess(name, command, argv, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  const logPath = path.join(logsDir, `${name}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${timestamp()}] ${command} ${argv.join(" ")}\n`);

  const child = spawn(command, argv, {
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
  processes.push(child);
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
    // ignore
  }
}

async function cleanupProcesses() {
  await Promise.allSettled(processes.map((child) => stopProcess(child)));
}

async function waitFor(predicate, message, timeoutMs = 60_000, intervalMs = 250) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
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

async function capture(page, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

async function waitForText(locator, expected, message) {
  await waitFor(async () => {
    const text = await locator.textContent();
    return String(text ?? "").includes(expected);
  }, message);
}

async function waitForUrlIncludes(page, fragment, message) {
  await waitFor(() => page.url().includes(fragment), message ?? `expected url to include ${fragment}, got ${page.url()}`);
}

async function startServices() {
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const buildLogPath = path.join(logsDir, "web-build.log");
  const nodeOptions = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} --max-old-space-size=4096`
    : "--max-old-space-size=4096";
  const webEnv = {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    OPENSHOCK_CONTROL_API_BASE: serverURL,
    NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    OPENSHOCK_NEXT_DIST_DIR: webDistDirName,
  };

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
    throw new Error(`web build failed before room reload continuity scenario. See ${buildLogPath}`);
  }

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
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
    const response = await fetch(`${webURL}/rooms/room-runtime`);
    return response.ok;
  }, `web did not become ready at ${webURL}/rooms/room-runtime`);

  return { webURL };
}

let browser;
let context;
let page;

try {
  const { webURL } = await startServices();
  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  page = await context.newPage();

  const roomUrl = `${webURL}/rooms/room-runtime`;
  const draft = "先保留机器和智能体状态\n审批边界下一轮补。";

  await page.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByText("Runtime 讨论间", { exact: false }), "room title did not render");
  await waitForVisible(page.getByTestId("room-message-input"), "room composer did not render");

  await page.getByTestId("message-thread-open-msg-room-2").click();
  await waitForVisible(page.getByTestId("room-reply-target-chip"), "reply target chip did not appear after opening thread");
  await waitForText(page.getByTestId("room-reply-target-label"), "Longwen", "reply target chip did not lock to the selected room message");
  await waitForVisible(page.getByText("已在输入框锁定回复目标", { exact: false }), "thread rail did not show locked reply state");
  await waitForUrlIncludes(page, "thread=msg-room-2", "room url did not keep selected thread");
  await waitForUrlIncludes(page, "reply=msg-room-2", "room url did not keep reply target");
  await waitForUrlIncludes(page, "rail=thread", "room url did not keep thread rail mode");
  recordCheck(
    "Room Thread Query State",
    `GET ${roomUrl}`,
    "打开线程后，selected thread、reply target 和 thread rail 都会写回 room URL。"
  );
  await capture(page, "room-thread-selected");

  await page.getByTestId("room-message-input").fill(draft);
  await waitFor(async () => (await page.getByTestId("room-message-input").inputValue()) === draft, "room draft did not stay in composer");
  recordCheck(
    "Room Draft Session State",
    `fill ${roomUrl}`,
    "在房间输入的未发送草稿会写入浏览器 session draft state。"
  );
  await capture(page, "room-draft-filled");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVisible(page.getByTestId("room-message-input"), "room composer did not recover after reload");
  await waitForVisible(page.getByTestId("room-reply-target-chip"), "reply target chip did not recover after reload");
  await waitForText(page.getByTestId("room-reply-target-label"), "Longwen", "reply target chip lost the selected message after reload");
  await waitForVisible(page.getByText("已在输入框锁定回复目标", { exact: false }), "thread rail did not recover locked reply state after reload");
  await waitFor(async () => (await page.getByTestId("room-message-input").inputValue()) === draft, "room draft did not recover after reload");
  await waitForUrlIncludes(page, "thread=msg-room-2", "room thread query disappeared after reload");
  await waitForUrlIncludes(page, "reply=msg-room-2", "room reply query disappeared after reload");
  await waitForUrlIncludes(page, "rail=thread", "room rail query disappeared after reload");
  recordCheck(
    "Room Reload Continuity",
    `reload ${roomUrl}`,
    "reload 后 thread、reply target 和未发送 draft 都会恢复到同一条房间会话。"
  );
  await capture(page, "room-reload-restored");

  const report = [
    "# Headed Room Chat Reload Continuity Report",
    "",
    `- Generated at: ${timestamp()}`,
    `- Command: \`pnpm test:headed-room-chat-reload-continuity -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Verification",
    "",
    ...checks.flatMap((item) => [
      `### Check: ${item.title}`,
      "**Command run:**",
      `  ${item.command}`,
      "**Output observed:**",
      `  ${item.output}`,
      "",
    ]),
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
    "VERDICT: PASS",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
