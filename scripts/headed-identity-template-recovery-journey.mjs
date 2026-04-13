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

const OPS_EMAIL = "ops@openshock.dev";
const REVIEWER_EMAIL = "reviewer@openshock.dev";
const REVIEWER_NAME = "Reviewer";
const REVIEWER_MEMBER_ID = "member-reviewer-openshock-dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt44-identity-template-journey-")));
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
    const response = await fetch(`${webURL}/settings`);
    return response.ok;
  }, `web did not become ready at ${webURL}/settings`);

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

async function waitForText(page, testID, expectedText) {
  await page.waitForFunction(
    ({ currentTestID, currentExpectedText }) => {
      const value = document.querySelector(`[data-testid="${currentTestID}"]`)?.textContent?.trim() ?? "";
      return value === currentExpectedText;
    },
    { currentTestID: testID, currentExpectedText: expectedText },
    { timeout: 30_000 }
  );
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

async function readNotificationCenter(serverURL) {
  const response = await fetch(`${serverURL}/v1/notifications`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /v1/notifications failed: ${response.status}`);
  }
  return response.json();
}

let browser = null;
let context = null;
let page = null;

try {
  const { serverURL, webURL } = await startServices();
  const reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-identity-template-recovery-journey -- --report ${path.relative(projectRoot, reportPath)}`;

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1500, height: 1340 } });
  page = await context.newPage();

  await page.goto(`${webURL}/settings`, { waitUntil: "load" });
  await page.getByTestId("settings-advanced-notifications-toggle").click();
  await page.getByTestId("notification-subscribers-count").waitFor({ state: "visible" });
  await page.getByTestId("notification-email-policy-all").click();
  await page.getByTestId("notification-save-policy").click();
  await waitForContainsText(page, "notification-action-message", "工作区通知默认值已保存");
  await page.getByTestId("notification-email-target-input").fill(OPS_EMAIL);
  await page.getByTestId("notification-save-email").click();
  await waitForContainsText(page, "notification-action-message", OPS_EMAIL);
  await waitForContainsText(page, "notification-subscribers-count", "1");
  await capture(page, "settings-identity-delivery-ready");

  await gotoAccessControls(page, webURL);
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "所有者",
  });
  await page.getByTestId("access-invite-email").fill(REVIEWER_EMAIL);
  await page.getByTestId("access-invite-name").fill(REVIEWER_NAME);
  await page.getByTestId("access-invite-role").selectOption("member");
  await page.getByTestId("access-invite-submit").click();
  await waitForText(page, "access-invite-success", `已邀请 ${REVIEWER_EMAIL}，角色为 成员`);
  await waitForText(page, `access-member-status-${REVIEWER_MEMBER_ID}`, "待接受");
  await capture(page, "access-invite-created");

  await page.goto(`${webURL}/settings`, { waitUntil: "load" });
  await page.getByTestId("settings-advanced-notifications-toggle").click();
  await page.getByTestId("notification-identity-template-auth_invite").waitFor({ state: "visible" });
  await waitForContainsText(page, "notification-identity-signal-count", "1");
  await waitForContainsText(page, "notification-identity-ready-count", "1");
  await page.getByTestId("notification-run-fanout").click();
  await waitForContainsText(page, "notification-identity-worker-summary", "1/1 已送达");
  await capture(page, "settings-invite-template-fanout");

  const inviteCenter = await readNotificationCenter(serverURL);
  assert(
    inviteCenter.worker.receipts.some((receipt) => receipt.templateId === "auth_invite" && receipt.status === "sent"),
    "invite fanout should emit auth_invite receipt"
  );

  await gotoAccessControls(page, webURL);
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
  await page.getByTestId("access-request-reset-email").fill(REVIEWER_EMAIL);
  await page.getByTestId("access-request-reset-submit").click();
  await waitForText(page, "access-recovery-reset-status", "pending");
  await capture(page, "access-verify-reset-pending");

  await page.goto(`${webURL}/settings`, { waitUntil: "load" });
  await page.getByTestId("settings-advanced-notifications-toggle").click();
  await page.getByTestId("notification-identity-template-auth_verify_email").waitFor({ state: "visible" });
  await page.getByTestId("notification-identity-template-auth_password_reset").waitFor({ state: "visible" });
  await page.getByTestId("notification-identity-template-auth_blocked_recovery").waitFor({ state: "visible" });
  await page.getByTestId("notification-run-fanout").click();
  await waitForContainsText(page, "notification-identity-worker-summary", "3/3 已送达");
  await capture(page, "settings-recovery-template-fanout");

  const recoveryCenter = await readNotificationCenter(serverURL);
  for (const templateID of ["auth_verify_email", "auth_password_reset", "auth_blocked_recovery"]) {
    assert(
      recoveryCenter.worker.receipts.some((receipt) => receipt.templateId === templateID && receipt.status === "sent"),
      `recovery fanout should emit ${templateID} receipt`
    );
  }

  await page.goto(`${webURL}/access`, { waitUntil: "load" });
  await page.getByTestId("access-verify-email-submit").click();
  await waitForText(page, "access-recovery-email-status", "已验证");
  await page.getByTestId("access-authorize-device-submit").click();
  await waitForText(page, "access-session-device-auth", "已授权");
  await page.getByTestId("access-complete-reset-device-label").fill("Recovery Laptop");
  await page.getByTestId("access-complete-reset-submit").click();
  await waitForSession(page, {
    status: "已登录",
    email: REVIEWER_EMAIL,
    role: "成员",
  });
  await waitForText(page, "access-session-device-label", "Recovery Laptop");
  await waitForText(page, "access-recovery-status", "已恢复");
  await capture(page, "access-recovery-complete");

  const report = [
    "# 2026-04-12 身份通知恢复链路测试报告",
    "",
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    `- Web: \`${webURL}\``,
    `- Server: \`${serverURL}\``,
    "",
    "## 结果",
    "",
    `- \`/settings\` 已先保存身份通知邮箱 \`${OPS_EMAIL}\`，邀请、验证、重置与恢复会统一进入通知模板区。`,
    `- \`/access\` 发出邀请后，\`auth_invite\` 会直接出现在 \`/settings\` 的身份通知模板区；首次发送已送达 \`${inviteCenter.worker.receipts.filter((receipt) => receipt.templateId === "auth_invite" && receipt.status === "sent").length}\` 条邀请通知。`,
    `- 邀请成员快速登录后再触发重置流程，\`auth_verify_email\` / \`auth_password_reset\` / \`auth_blocked_recovery\` 会一并进入同一通知区；第二次发送已送达 \`${recoveryCenter.worker.receipts.filter((receipt) => receipt.status === "sent").length}\` 条恢复通知。`,
    "- 返回 `/access` 完成邮箱验证、当前设备授权和另一设备密码重置后，session recovery 会回到 `已恢复`，说明 invite -> verify/reset -> delivery -> recovery 已经是同一条产品旅程。",
    "",
    "## 模板证据",
    "",
    `- 邀请阶段模板：\`${inviteCenter.worker.receipts.map((receipt) => receipt.templateId).join(", ")}\``,
    `- 恢复阶段模板：\`${recoveryCenter.worker.receipts.map((receipt) => receipt.templateId).join(", ")}\``,
    "",
    "## 截图",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "## 范围说明",
    "",
    "- 已在 `/settings` 配好身份通知默认值和邮箱地址。",
    "- 已验证 `/access` 的邀请会写入身份通知模板区，并进入发送结果。",
    "- 已验证快速登录和重置待处理会把 `auth_verify_email`、`auth_password_reset`、`auth_blocked_recovery` 一起写入同一条通知链路。",
    "- 已验证 `/access` 在另一台设备上完成验证与授权后可以恢复成功。",
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
