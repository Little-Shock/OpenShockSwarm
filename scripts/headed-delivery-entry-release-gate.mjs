#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const PULL_REQUEST_ID = "pr-runtime-18";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt49-delivery-entry-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");

const screenshots = [];
const processes = [];

await mkdir(screenshotsDir, { recursive: true });

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

function reportDateLabel() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
      const value = await predicate();
      if (value) {
        return value;
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

async function startServices() {
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
    const response = await fetch(`${webURL}/pull-requests/${PULL_REQUEST_ID}`);
    return response.ok;
  }, `web did not become ready at ${webURL}/pull-requests/${PULL_REQUEST_ID}`);

  return { serverURL, webURL };
}

async function capture(page, name) {
  const shotPath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  screenshots.push({ name, path: shotPath });
}

async function readText(page, testID) {
  return (await page.getByTestId(testID).textContent())?.trim() ?? "";
}

async function waitForContainsText(page, testID, expectedText) {
  await page.waitForFunction(
    ({ currentTestID, currentExpectedText }) => {
      const value = document.querySelector(`[data-testid="${currentTestID}"]`)?.textContent?.trim() ?? "";
      return value.includes(currentExpectedText);
    },
    { currentTestID: testID, currentExpectedText: expectedText },
    { timeout: 30_000 }
  );
}

async function readPullRequestDetail(serverURL, pullRequestID) {
  const response = await fetch(`${serverURL}/v1/pull-requests/${pullRequestID}/detail`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /v1/pull-requests/${pullRequestID}/detail failed: ${response.status}`);
  }
  return response.json();
}

async function upsertNotificationSubscriber(serverURL) {
  const response = await fetch(`${serverURL}/v1/notifications/subscribers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      channel: "browser_push",
      target: "https://ops.example.test/review-console",
      label: "Review Console",
      preference: "all",
      status: "ready",
      source: "headed-delivery-entry-release-gate",
    }),
  });
  if (!response.ok) {
    throw new Error(`POST /v1/notifications/subscribers failed: ${response.status}`);
  }
}

async function dispatchNotificationFanout(serverURL) {
  const response = await fetch(`${serverURL}/v1/notifications/fanout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`POST /v1/notifications/fanout failed: ${response.status}`);
  }
  return response.json();
}

function templateTestID(template) {
  return `delivery-template-${(template.templateId || template.label || "untyped")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untyped"}`;
}

let browser = null;
let context = null;
let page = null;

try {
  const { serverURL, webURL } = await startServices();
  await upsertNotificationSubscriber(serverURL);
  const fanout = await dispatchNotificationFanout(serverURL);
  let detail = await readPullRequestDetail(serverURL, PULL_REQUEST_ID);
  const reportDate = reportDateLabel();
  const browserLabel = process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "Windows Chrome " : "";
  const reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-delivery-entry-release-gate -- --report ${path.relative(projectRoot, reportPath)}`;

  assert(detail.delivery.gates.length === 4, "pull request detail should expose four delivery gates");
  assert(detail.delivery.templates.length > 0, "pull request detail should expose at least one delivery template");
  assert(detail.delivery.handoffNote.lines.length >= 4, "pull request detail should expose populated handoff note");
  assert(detail.delivery.evidence.length >= 4, "pull request detail should expose evidence bundle entries");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1520, height: 1340 } });
  page = await context.newPage();

  await page.goto(`${webURL}/pull-requests/${PULL_REQUEST_ID}`, { waitUntil: "load" });
  await page.getByTestId("pull-request-context-room").waitFor({ state: "visible" });
  detail = await readPullRequestDetail(serverURL, PULL_REQUEST_ID);
  const liveDeliveryStatusLabel =
    detail.delivery.status === "ready" ? "可以交付" : detail.delivery.status === "warning" ? "需要关注" : "暂不可交付";
  const liveHandoffStatusLabel = detail.delivery.releaseReady ? "可以交接" : "交接受阻";
  assert(
    (await readText(page, "pull-request-context-release-ready")).includes(detail.delivery.releaseReady ? "是" : "否"),
    "release ready context tile should match API detail"
  );
  assert((await readText(page, "pull-request-delivery-status")) === liveDeliveryStatusLabel, "delivery status should match API detail");
  await waitForContainsText(page, "pull-request-delivery-gates-count", String(detail.delivery.gates.length));
  await waitForContainsText(page, "pull-request-delivery-templates-count", String(detail.delivery.templates.length));
  await waitForContainsText(page, "pull-request-delivery-evidence-count", String(detail.delivery.evidence.length));
  await page.getByTestId("delivery-gate-review-merge").waitFor({ state: "visible" });
  await page.getByTestId("delivery-gate-run-usage").waitFor({ state: "visible" });
  await page.getByTestId("delivery-gate-workspace-quota").waitFor({ state: "visible" });
  await page.getByTestId("delivery-gate-notification-delivery").waitFor({ state: "visible" });
  await page.getByTestId(templateTestID(detail.delivery.templates[0])).waitFor({ state: "visible" });
  await page.getByTestId("delivery-evidence-release-contract").waitFor({ state: "visible" });
  await page.getByTestId("delivery-evidence-notification-templates").waitFor({ state: "visible" });
  if (detail.delivery.evidence.some((item) => item.id === "remote-pr")) {
    await page.getByTestId("delivery-evidence-remote-pr").waitFor({ state: "visible" });
  }
  if (detail.delivery.evidence.some((item) => item.id === "review-conversation")) {
    await page.getByTestId("delivery-evidence-review-conversation").waitFor({ state: "visible" });
  }
  assert((await readText(page, "delivery-handoff-status")) === liveHandoffStatusLabel, "handoff status should match API detail");
  const handoffLines = await page.locator('[data-testid="delivery-handoff-note"] li').count();
  assert(handoffLines === detail.delivery.handoffNote.lines.length, "handoff note line count should match API detail");
  await capture(page, "pull-request-delivery-entry");

  const templateCard = page.getByTestId(templateTestID(detail.delivery.templates[0]));
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/settings"),
    templateCard.getByRole("link", { name: "打开详情" }).click(),
  ]);
  await page.getByTestId("settings-advanced-notifications-toggle").click();
  await page.getByTestId("notification-worker-summary").waitFor({ state: "visible" });
  await capture(page, "settings-delivery-surface");

  await page.goto(`${webURL}/pull-requests/${PULL_REQUEST_ID}`, { waitUntil: "load" });
  await page.getByTestId("pull-request-context-room").waitFor({ state: "visible" });
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/rooms/${detail.room.id}` && url.searchParams.get("tab") === "pr"),
    page.getByTestId("pull-request-room-pr-link").click(),
  ]);
  await page.getByTestId("room-workbench-pr-panel").waitFor({ state: "visible" });
  await capture(page, "room-pr-workbench-backlink");

  await page.goto(`${webURL}/pull-requests/${PULL_REQUEST_ID}`, { waitUntil: "load" });
  await page.getByTestId("pull-request-context-room").waitFor({ state: "visible" });
  const runGate = page.getByTestId("delivery-gate-run-usage");
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/runs/${detail.run.id}`),
    runGate.getByRole("link", { name: "打开详情" }).click(),
  ]);
  await page.getByTestId("run-detail-usage-panel").waitFor({ state: "visible" });
  await capture(page, "run-gate-context");

  const report = [
    `# Test Report ${reportDate} ${browserLabel}Delivery Entry / Release Gate / Handoff Contract`,
    "",
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    `- Web: \`${webURL}\``,
    `- Server: \`${serverURL}\``,
    "",
    "## Results",
    "",
    `- \`/pull-requests/${PULL_REQUEST_ID}\` 已把 delivery status、release ready、${detail.delivery.gates.length} 个 gate、${detail.delivery.templates.length} 个 template 和 ${detail.delivery.evidence.length} 条 evidence 收到同一页，不再散在 room / settings / runbook。当前判断结果 = \`${detail.delivery.status}\` / releaseReady=\`${detail.delivery.releaseReady}\`。`,
    `- release gate 当前全部可复核：${detail.delivery.gates.map((gate) => `${gate.id}:${gate.status}`).join(" / ")}。`,
    `- operator handoff note 已有 ${detail.delivery.handoffNote.lines.length} 条可执行说明，并且 UI 与 API 都把当前状态显示为 \`${liveHandoffStatusLabel}\`。`,
    "- browser walkthrough 已验证 delivery template 可回到 `/settings`，room PR backlink 可回到同一条 PR workbench，run usage gate 也能回到对应 run context。",
    "",
    "## Evidence",
    "",
    `- fanout summary before drill-in: attempted=${fanout.worker.attempted} delivered=${fanout.worker.delivered} failed=${fanout.worker.failed}`,
    `- delivery templates: \`${detail.delivery.templates.map((template) => `${template.templateId}:${template.status}`).join(", ")}\``,
    `- evidence bundle ids: \`${detail.delivery.evidence.map((item) => item.id).join(", ")}\``,
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
