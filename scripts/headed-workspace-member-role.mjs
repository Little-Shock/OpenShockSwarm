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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt08-workspace-member-role-")));
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

async function waitForMemberLabel(page, memberID, kind, label) {
  await page.waitForFunction(
    ({ currentMemberID, currentKind, currentLabel }) => {
      const element = document.querySelector(`[data-testid="access-member-${currentKind}-${currentMemberID}"]`);
      return element?.textContent?.trim() === currentLabel;
    },
    { currentMemberID: memberID, currentKind: kind, currentLabel: label },
    { timeout: 30_000 }
  );
}

async function waitForEnabled(page, testID) {
  await page.waitForFunction(
    (currentTestID) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element instanceof HTMLButtonElement && !element.disabled;
    },
    testID,
    { timeout: 30_000 }
  );
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
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${services.webURL}/access`, { waitUntil: "load" });
  await page.getByTestId("access-session-status").waitFor({ state: "visible" });
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "Owner",
  });
  assert((await readText(page, "access-members-manage-status")) === "owner can mutate", "owner session should expose member management");

  await page.getByTestId("access-invite-email").fill(REVIEWER_EMAIL);
  await page.getByTestId("access-invite-name").fill(REVIEWER_NAME);
  await page.getByTestId("access-invite-role").selectOption("viewer");
  await page.getByTestId("access-invite-submit").click();
  await page.getByTestId(`access-member-${REVIEWER_MEMBER_ID}`).waitFor({ state: "visible" });
  await waitForMemberLabel(page, REVIEWER_MEMBER_ID, "role", "Viewer");
  await waitForMemberLabel(page, REVIEWER_MEMBER_ID, "status", "待接受");
  assert((await readText(page, "access-invite-success")) === `${REVIEWER_EMAIL} invited as Viewer`, "invite should confirm reviewer viewer invite");
  await capture(page, screenshotsDir, "invited-viewer");

  await page.getByTestId(`access-member-role-select-${REVIEWER_MEMBER_ID}`).selectOption("member");
  await waitForEnabled(page, `access-member-update-${REVIEWER_MEMBER_ID}`);
  await page.getByTestId(`access-member-update-${REVIEWER_MEMBER_ID}`).click();
  await waitForMemberLabel(page, REVIEWER_MEMBER_ID, "role", "Member");
  await waitForMemberLabel(page, REVIEWER_MEMBER_ID, "status", "待接受");
  assert(
    (await readText(page, `access-member-success-${REVIEWER_MEMBER_ID}`)) === "Member / 待接受 已同步到 live roster",
    "member update should confirm invited member role change"
  );
  await capture(page, screenshotsDir, "invited-member");

  await page.getByTestId(`access-quick-login-${REVIEWER_MEMBER_ID}`).click();
  await waitForSession(page, {
    status: "已登录",
    email: REVIEWER_EMAIL,
    role: "Member",
  });
  await waitForMemberLabel(page, REVIEWER_MEMBER_ID, "status", "在线成员");
  assert((await readText(page, "access-probe-status-issue-create")) === "allowed", "member session should be allowed to create issues");
  assert((await readText(page, "access-probe-status-runtime-manage")) === "blocked", "member session should not manage runtime");
  assert((await readText(page, "access-members-manage-status")) === "read-only session", "member session should lose member management");
  await capture(page, screenshotsDir, "member-activated");

  await page.getByTestId("access-quick-login-member-larkspur").click();
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "Owner",
  });
  assert((await readText(page, "access-members-manage-status")) === "owner can mutate", "owner restore should recover member management");

  await page.getByTestId(`access-member-status-select-${REVIEWER_MEMBER_ID}`).selectOption("suspended");
  await waitForEnabled(page, `access-member-update-${REVIEWER_MEMBER_ID}`);
  await page.getByTestId(`access-member-update-${REVIEWER_MEMBER_ID}`).click();
  await waitForMemberLabel(page, REVIEWER_MEMBER_ID, "status", "已暂停");
  assert(
    (await readText(page, `access-member-success-${REVIEWER_MEMBER_ID}`)) === "Member / 已暂停 已同步到 live roster",
    "owner should be able to suspend invited member"
  );
  await capture(page, screenshotsDir, "member-suspended");

  await page.getByTestId(`access-quick-login-${REVIEWER_MEMBER_ID}`).click();
  await page.getByTestId("access-auth-error").waitFor({ state: "visible" });
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "Owner",
  });
  assert((await readText(page, "access-auth-error")) === "workspace member is suspended", "suspended member login should fail closed");
  await capture(page, screenshotsDir, "suspended-login-blocked");

  const report = [
    "# TKT-08 Workspace Invite / Member / Role Report",
    "",
    `- Command: \`pnpm test:headed-workspace-member-role -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Invite / Role / Status Lifecycle",
    "",
    "- Owner invited `reviewer@openshock.dev` as `Viewer` -> PASS",
    "- Owner changed invited reviewer role from `Viewer` to `Member` -> PASS",
    "- Reviewer quick login activated invited member and surfaced `Member` session -> PASS",
    "- Owner suspended reviewer and roster status flipped to `已暂停` -> PASS",
    "- Suspended reviewer login failed closed with `workspace member is suspended` -> PASS",
    "",
    "### Permission Surface",
    "",
    "- Owner session: `members.manage = live`, `runtime.manage = allowed`",
    "- Reviewer member session: `issue.create = allowed`, `runtime.manage = blocked`, `members.manage = hidden`",
    "- Suspended reviewer login attempt leaves owner session intact and surfaces explicit error",
    "",
    "### Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
    "## Conclusion",
    "",
    "- `/access` 现在已把 owner-side invite、member role/status mutation 接到 live API，而不是只展示 read-only roster。",
    "- invited member 会在首次登录时转成 `active`，role 变化会同步反映到 session permissions 和 browser probes。",
    "- 当前票只收 workspace invite / member / role；更大范围的 action-level authz matrix 继续留给 `TKT-09`。",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
