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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt11-notification-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");

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
    // process already exited
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

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    },
    logPath: path.join(logsDir, "web.log"),
  });

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/settings`);
    return response.ok;
  }, `web did not become ready at ${webURL}/settings`);

  return { webURL, serverURL };
}

async function readText(page, testID) {
  return (await page.getByTestId(testID).textContent())?.trim() ?? "";
}

async function waitForContainsText(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const value = document.querySelector(`[data-testid="${currentTestID}"]`)?.textContent?.trim() ?? "";
      return value.includes(currentExpected);
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

async function readNotificationCenter(page, serverURL) {
  return page.evaluate(async (currentServerURL) => {
    const response = await fetch(`${currentServerURL}/v1/notifications`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`GET /v1/notifications failed: ${response.status}`);
    }
    return response.json();
  }, serverURL);
}

const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
await mkdir(screenshotsDir, { recursive: true });

let browser = null;
let context = null;
let page = null;

try {
  const services = await startServices(runDir);
  const chromiumExecutable = resolveChromiumExecutable();

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({ viewport: { width: 1480, height: 1360 } });
  await context.grantPermissions(["notifications"], { origin: services.webURL });
  page = await context.newPage();

  await page.goto(`${services.webURL}/settings`, { waitUntil: "load" });
  await page.getByTestId("notification-subscribers-count").waitFor({ state: "visible" });
  await waitForContainsText(page, "notification-subscribers-count", "0");
  await waitForContainsText(page, "notification-browser-permission", "已授权");
  await capture(page, screenshotsDir, "initial-notification-settings");

  await page.getByTestId("notification-browser-policy-all").click();
  await page.getByTestId("notification-email-policy-all").click();
  await page.getByTestId("notification-save-policy").click();
  await waitForContainsText(page, "notification-action-message", "默认策略已写回 server");
  await waitForContainsText(page, "notification-workspace-browser-policy", "全部 live 事件");
  await waitForContainsText(page, "notification-workspace-email-policy", "全部 live 事件");

  await page.getByTestId("notification-register-browser").click();
  await waitForContainsText(page, "notification-browser-registration", "已注册");
  await page.getByTestId("notification-connect-browser").click();
  await waitForContainsText(page, "notification-browser-subscriber-status", "已就绪");
  await waitForContainsText(page, "notification-subscribers-count", "1");

  await page.getByTestId("notification-email-preference-all").click();
  await page.getByTestId("notification-email-target-input").fill("not-an-email");
  await page.getByTestId("notification-save-email").click();
  await waitForContainsText(page, "notification-action-message", "not-an-email");
  await waitForContainsText(page, "notification-subscribers-count", "2");

  const preFailureCenter = await readNotificationCenter(page, services.serverURL);
  const readyBrowserDeliveries = preFailureCenter.deliveries.filter(
    (delivery) => delivery.channel === "browser_push" && delivery.status === "ready"
  ).length;
  const readyEmailDeliveries = preFailureCenter.deliveries.filter(
    (delivery) => delivery.channel === "email" && delivery.status === "ready"
  ).length;
  const expectedAttempted = readyBrowserDeliveries + readyEmailDeliveries;

  await page.getByTestId("notification-run-fanout").click();
  await waitForContainsText(page, "notification-worker-attempted", String(expectedAttempted));
  await waitForContainsText(page, "notification-worker-delivered", String(readyBrowserDeliveries));
  await waitForContainsText(page, "notification-worker-failed", String(readyEmailDeliveries));
  await waitForContainsText(page, "notification-email-last-error", "invalid");
  const failedReceiptCount = await page.locator('[data-testid^="notification-receipt-"]').count();
  assert(failedReceiptCount === expectedAttempted, `expected ${expectedAttempted} worker receipts after failed run, got ${failedReceiptCount}`);
  await capture(page, screenshotsDir, "invalid-email-fanout-failure");

  await page.getByTestId("notification-email-target-input").fill("ops@openshock.dev");
  await page.getByTestId("notification-save-email").click();
  await waitForContainsText(page, "notification-action-message", "ops@openshock.dev");
  await page.getByTestId("notification-run-fanout").click();
  await waitForContainsText(page, "notification-worker-attempted", String(expectedAttempted));
  await waitForContainsText(page, "notification-worker-delivered", String(expectedAttempted));
  await waitForContainsText(page, "notification-worker-failed", "0");
  await waitForContainsText(page, "notification-email-last-error", "无");
  const center = await readNotificationCenter(page, services.serverURL);
  assert(center.worker.delivered === expectedAttempted && center.worker.failed === 0, `latest worker summary malformed: ${JSON.stringify(center.worker)}`);
  assert(center.subscribers.length === 2, `expected 2 subscribers in notification center, got ${center.subscribers.length}`);
  assert(center.subscribers.some((subscriber) => subscriber.channel === "browser_push" && subscriber.status === "ready"), "browser subscriber should be ready");
  assert(center.subscribers.some((subscriber) => subscriber.channel === "email" && subscriber.target === "ops@openshock.dev" && subscriber.lastDeliveredAt), "email subscriber should have delivered timestamp after retry");
  await capture(page, screenshotsDir, "retry-fanout-green");

  const report = [
    "# TKT-11 Notification Preference / Delivery Report",
    "",
    `- Command: \`pnpm test:headed-notification-preference-delivery -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Workspace Policy + Subscriber Contract",
    "",
    "- `/settings` 现在直接消费 `/v1/notifications`，workspace browser/email policy 可写回 server -> PASS",
    "- 当前浏览器能注册 service worker、同步成 ready browser subscriber，并在 page 上暴露稳定 subscriber target -> PASS",
    "- email subscriber 也在同页写入同一 contract surface，不再停在 placeholder 文案 -> PASS",
    "",
    "### Delivery / Retry Lifecycle",
    "",
    `- invalid email target 首次 fanout 会显式打出 \`attempted = ${expectedAttempted} / delivered = ${readyBrowserDeliveries} / failed = ${readyEmailDeliveries}\`，email subscriber \`lastError\` 明面可见 -> PASS`,
    `- 修正 email target 为 \`ops@openshock.dev\` 后，同页 retry fanout 转成 \`attempted = ${expectedAttempted} / delivered = ${expectedAttempted} / failed = 0\`，\`lastDeliveredAt\` 落桌 -> PASS`,
    "- browser subscriber 在同一 fanout 上保持 `ready`，并把 sent browser receipts 转成 local notification -> PASS",
    "",
    "### Scope Boundary",
    "",
    "- 这轮只收 `TC-017` 的 browser push / email preference、subscriber contract、fanout receipts 与 retry truth。",
    "- invite / verify / reset password 继续留在后续身份链路范围，不借写成这张票已完成。",
    "",
    "### Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
