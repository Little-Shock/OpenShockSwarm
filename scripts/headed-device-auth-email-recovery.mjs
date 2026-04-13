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

const REVIEWER_EMAIL = "reviewer@openshock.dev";
const REVIEWER_NAME = "Reviewer";
const REVIEWER_MEMBER_ID = "member-reviewer-openshock-dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt29-device-auth-email-recovery-")));
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
    const response = await fetch(`${webURL}/access`);
    return response.ok;
  }, `web did not become ready at ${webURL}/access`);

  return { webURL };
}

async function readText(page, testID) {
  return (await page.getByTestId(testID).textContent())?.trim() ?? "";
}

async function waitForSession(page, expectations) {
  await page.waitForFunction(
    (expected) => {
      const read = (testID) => document.querySelector(`[data-testid="${testID}"]`)?.textContent?.trim() ?? "";
      return (
        read("access-session-status") === expected.status &&
        read("access-session-email") === expected.email &&
        read("access-session-role") === expected.role
      );
    },
    expectations,
    { timeout: 30_000 }
  );
}

async function waitForText(page, testID, expectedText) {
  await page.waitForFunction(
    ({ currentTestID, currentExpectedText }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.trim() === currentExpectedText;
    },
    { currentTestID: testID, currentExpectedText: expectedText },
    { timeout: 30_000 }
  );
}

async function waitForVisible(page, locator, message) {
  await waitFor(async () => (await locator.isVisible()) ? locator : null, message, 30_000, 250);
}

async function ensureAccessDetailsOpen(page, detailsTestID, toggleTestID) {
  const toggle = page.getByTestId(toggleTestID);
  await toggle.waitFor({ state: "visible", timeout: 30_000 });
  const details = page.getByTestId(detailsTestID);
  await details.waitFor({ state: "attached", timeout: 30_000 });
  const isOpen = await details.evaluate(
    (element) => element instanceof HTMLDetailsElement && element.open
  );
  if (!isOpen) {
    await details.evaluate((element) => {
      if (element instanceof HTMLDetailsElement) {
        element.open = true;
      }
    });
    await page.waitForFunction((currentDetailsTestID) => {
      const element = document.querySelector(`[data-testid="${currentDetailsTestID}"]`);
      return element instanceof HTMLDetailsElement && element.open;
    }, detailsTestID);
  }
}

async function ensureAccessAdvancedOpen(page) {
  await ensureAccessDetailsOpen(page, "access-advanced-details", "access-advanced-toggle");
}

async function ensureAccessMemberAdminOpen(page) {
  await ensureAccessDetailsOpen(page, "access-member-admin-details", "access-member-admin-toggle");
}

async function gotoAccessControls(page, webURL, focusTestID = "access-invite-email") {
  await page.goto(`${webURL}/access`, { waitUntil: "load" });
  const focus = page.getByTestId(focusTestID);
  try {
    await focus.waitFor({ state: "visible", timeout: 5_000 });
    return;
  } catch {
    await ensureAccessMemberAdminOpen(page);
    await focus.waitFor({ state: "visible", timeout: 30_000 });
  }
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

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1460, height: 1280 } });
  page = await context.newPage();

  await gotoAccessControls(page, services.webURL);
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "所有者",
  });
  await capture(page, screenshotsDir, "owner-baseline");

  await page.getByTestId("access-invite-email").fill(REVIEWER_EMAIL);
  await page.getByTestId("access-invite-name").fill(REVIEWER_NAME);
  await page.getByTestId("access-invite-role").selectOption("member");
  await page.getByTestId("access-invite-submit").click();
  await waitForText(page, "access-invite-success", `已邀请 ${REVIEWER_EMAIL}，角色为 成员`);
  await waitForText(page, `access-member-status-${REVIEWER_MEMBER_ID}`, "待接受");
  await capture(page, screenshotsDir, "member-invited");

  await ensureAccessAdvancedOpen(page);
  await page.getByTestId("access-login-device-label").fill("Reviewer Phone");
  await page.getByTestId(`access-quick-login-${REVIEWER_MEMBER_ID}`).click();
  await waitForSession(page, {
    status: "已登录",
    email: REVIEWER_EMAIL,
    role: "成员",
  });
  await waitForText(page, "access-session-device-label", "Reviewer Phone");
  await waitForText(page, "access-session-device-auth", "待授权");
  await waitForText(page, "access-recovery-email-status", "待验证");
  await waitForText(page, "access-recovery-status", "待邮箱验证");
  assert((await readText(page, "access-probe-status-issue-create")) === "可进入", "recovered member should keep issue.create access");
  assert((await readText(page, "access-probe-status-runtime-manage")) === "受限", "member should still be blocked from runtime.manage");
  await capture(page, screenshotsDir, "pending-verify-device");

  await page.getByTestId("access-verify-email-submit").click();
  await waitForText(page, "access-recovery-success", "邮箱已验证");
  await waitForText(page, "access-recovery-email-status", "已验证");
  await waitForText(page, "access-recovery-status", "待设备授权");

  await page.getByTestId("access-authorize-device-submit").click();
  await waitForText(page, "access-recovery-success", "Reviewer Phone 已授权");
  await waitForText(page, "access-session-device-auth", "已授权");
  await waitForText(page, "access-recovery-status", "可用");
  await waitForVisible(
    page,
    page.locator('[data-testid^="access-device-"]').filter({ hasText: "Reviewer Phone" }),
    "authorized Reviewer Phone device card did not render"
  );
  await capture(page, screenshotsDir, "verified-and-authorized");

  await page.getByTestId("access-request-reset-email").fill(REVIEWER_EMAIL);
  await page.getByTestId("access-request-reset-submit").click();
  await waitForText(page, "access-recovery-success", `${REVIEWER_EMAIL} 已进入待重置状态`);
  await waitForText(page, "access-recovery-reset-status", "pending");
  await waitForText(page, "access-recovery-status", "待密码重置");
  await capture(page, screenshotsDir, "reset-requested");

  await page.getByTestId("access-complete-reset-device-label").fill("Recovery Laptop");
  await page.getByTestId("access-complete-reset-submit").click();
  await waitForSession(page, {
    status: "已登录",
    email: REVIEWER_EMAIL,
    role: "成员",
  });
  await waitForText(page, "access-session-device-label", "Recovery Laptop");
  await waitForText(page, "access-session-device-auth", "已授权");
  await waitForText(page, "access-recovery-reset-status", "completed");
  await waitForText(page, "access-recovery-status", "已恢复");
  assert((await readText(page, "access-probe-status-issue-create")) === "可进入", "password-reset session should retain issue.create");
  assert((await readText(page, "access-probe-status-runtime-manage")) === "受限", "password-reset session should not gain runtime.manage");
  await capture(page, screenshotsDir, "password-reset-recovered");

  await page.getByTestId("access-bind-identity-provider").selectOption("github");
  await page.getByTestId("access-bind-identity-handle").fill("@reviewer");
  await page.getByTestId("access-bind-identity-submit").click();
  await waitForText(page, "access-recovery-success", "github 身份已绑定到当前成员");
  await waitForText(page, "access-recovery-identity-count", "1");
  await waitForVisible(page, page.getByTestId("access-identity-github"), "github identity chip did not render");
  assert((await readText(page, "access-identity-github")).includes("@reviewer"), "github identity chip should include @reviewer");
  await capture(page, screenshotsDir, "identity-bound");

  const report = [
    "# 2026-04-08 Device Authorization / Email Verification / Reset Report",
    "",
    `- Command: \`pnpm test:headed-device-auth-email-recovery -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "- Invited member can log in on a named device and immediately surface pending email verification plus pending device authorization in the same `/access` recovery panel.",
    "- Verifying email and authorizing the current device push both member truth and session truth forward without dropping role-based permissions.",
    "- Password reset recovery on another device keeps the same member permission boundary while switching the active session onto the recovery device.",
    "- External identity binding lands in the same member truth and is visible alongside authorized devices and recovery status.",
    "",
    "## Screenshots",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
    "## Single Value",
    "- `/access` 现在已经把 `device authorization / email verification / password reset / session recovery / external identity binding` 收成同一条 live identity chain；新成员、换设备和忘记密码不再停在 invite / quick login 的半成品状态。",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
