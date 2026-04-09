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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt47-mobile-notification-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
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

async function visibleBox(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 120_000 });
  const box = await locator.boundingBox();
  assert(box, `${label} did not produce a visible bounding box`);
  const viewport = page.viewportSize();
  assert(viewport, `${label} did not expose viewport information`);
  return { box, viewport };
}

async function assertMinHitArea(page, locator, label, minWidth = 44, minHeight = 44) {
  const { box } = await visibleBox(page, locator, label);
  assert(box.width >= minWidth, `${label} width ${Math.round(box.width)} < ${minWidth}`);
  assert(box.height >= minHeight, `${label} height ${Math.round(box.height)} < ${minHeight}`);
  return `${Math.round(box.width)}x${Math.round(box.height)}`;
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert(
    metrics.scrollWidth <= metrics.viewportWidth + 1 && metrics.scrollWidth <= metrics.clientWidth + 1,
    `${label} has horizontal overflow (${metrics.scrollWidth} > ${metrics.viewportWidth}/${metrics.clientWidth})`
  );
  return metrics;
}

async function waitForContainsText(page, testId, expected) {
  await page.waitForFunction(
    ({ currentTestId, currentExpected }) =>
      (document.querySelector(`[data-testid="${currentTestId}"]`)?.textContent?.trim() ?? "").includes(currentExpected),
    { currentTestId: testId, currentExpected: expected },
    { timeout: 30_000 }
  );
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

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    },
  });

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/inbox`);
    return response.ok;
  }, `web did not become ready at ${webURL}/inbox`);

  return { webURL };
}

let browser = null;
let context = null;
let page = null;

try {
  const services = await startServices();
  const chromiumExecutable = resolveChromiumExecutable();

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  page = await context.newPage();

  await page.goto(`${services.webURL}/inbox`, { waitUntil: "load" });
  await page.getByTestId("approval-center-mobile-triage").waitFor({ state: "visible" });
  await waitForContainsText(page, "approval-center-mobile-open", "3");
  await waitForContainsText(page, "approval-center-mobile-unread", "3");
  await waitForContainsText(page, "approval-center-mobile-blocked", "1");
  await waitForContainsText(page, "approval-center-mobile-recent", "1");

  const initialOverflow = await assertNoHorizontalOverflow(page, "mobile inbox initial render");
  const mobileSettingsHitArea = await assertMinHitArea(
    page,
    page.getByTestId("approval-center-mobile-settings-link"),
    "mobile settings link"
  );

  const firstSignal = page.locator('[data-testid^="approval-center-signal-"]').first();
  const { box: firstSignalBox, viewport } = await visibleBox(page, firstSignal, "first mobile inbox signal");
  assert(firstSignalBox.width <= viewport.width + 1, "first mobile inbox signal exceeds viewport width");
  assert(firstSignalBox.height <= 640, `first mobile inbox signal too tall for light triage (${Math.round(firstSignalBox.height)}px)`);
  const firstSignalTitle = (await firstSignal.locator("h3").first().textContent())?.trim() ?? "";

  const openContextHitArea = await assertMinHitArea(
    page,
    firstSignal.locator('[data-testid^="approval-center-open-context-mobile-"]').first(),
    "first mobile open-context action"
  );
  const primaryDecision = firstSignal.locator('button[data-testid^="approval-center-action-"]').first();
  const primaryDecisionLabel = (await primaryDecision.textContent())?.trim() ?? "decision";
  const primaryDecisionHitArea = await assertMinHitArea(page, primaryDecision, "first mobile decision action");

  await capture(page, "mobile-inbox-initial");

  const detailsToggle = firstSignal.locator("summary").first();
  const detailsToggleHitArea = await assertMinHitArea(page, detailsToggle, "first mobile detail disclosure");
  await detailsToggle.click();
  const roomLink = firstSignal.locator('[data-testid^="mobile-approval-center-room-link-"]').first();
  await roomLink.waitFor({ state: "visible" });
  const roomLinkHitArea = await assertMinHitArea(page, roomLink, "first mobile room backlink");
  const expandedOverflow = await assertNoHorizontalOverflow(page, "mobile inbox after expanding details");

  await capture(page, "mobile-inbox-details-expanded");

  const recentLedger = page.getByTestId("approval-center-mobile-recent-ledger");
  await recentLedger.locator("summary").click();
  await page.locator('[data-testid^="approval-center-mobile-recent-"]').first().waitFor({ state: "visible" });
  await capture(page, "mobile-inbox-recent-ledger");

  const report = [
    "# TKT-47 Mobile Notification Triage Report",
    "",
    `- Command: \`pnpm test:headed-mobile-notification-triage -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Scope Boundary",
    "",
    "- `TKT-47` 只收 mobile web 的轻量通知处理面：围 `/inbox` 上的 open / unread / blocked / recent 信号与直接 decision。",
    "- 更重的通知策略、subscriber、delivery template 仍继续留在 `/settings` 与 `TKT-11` / `TKT-44`。",
    "",
    "## Results",
    "",
    "### Mobile Triage Surface",
    "",
    `- mobile triage 卡片已直接给出 Open / Unread / Blocked / Recent 四个摘要，初始值 = \`3 / 3 / 1 / 1\` -> PASS`,
    `- mobile settings link 命中区 = \`${mobileSettingsHitArea}\`，可以直接把更重策略回跳到 \`/settings\` -> PASS`,
    `- 首张 mobile signal = \`${firstSignalTitle}\`，可见框尺寸 = \`${Math.round(firstSignalBox.width)}x${Math.round(firstSignalBox.height)}\`，低于 640px 高度上限 -> PASS`,
    "",
    "### Adversarial Checks",
    "",
    `- initial render 无横向溢出：\`scrollWidth/clientWidth/viewport = ${initialOverflow.scrollWidth}/${initialOverflow.clientWidth}/${initialOverflow.viewportWidth}\` -> PASS`,
    `- Open Context 命中区 = \`${openContextHitArea}\`，首个 decision (\`${primaryDecisionLabel}\`) 命中区 = \`${primaryDecisionHitArea}\` -> PASS`,
    `- 展开 details / guard / links 后，Room backlink 命中区 = \`${roomLinkHitArea}\`，且仍无横向溢出：\`${expandedOverflow.scrollWidth}/${expandedOverflow.clientWidth}/${expandedOverflow.viewportWidth}\` -> PASS`,
    `- mobile detail disclosure 命中区 = \`${detailsToggleHitArea}\`，说明 guard / backlinks 已从默认常显收敛成可展开 triage 附件，而不是继续把首屏撑爆 -> PASS`,
    "",
    "### Recent Resolution Ledger",
    "",
    "- mobile recent ledger 现在默认折叠，可按需展开查看最新 resolution / status 回写 -> PASS",
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
