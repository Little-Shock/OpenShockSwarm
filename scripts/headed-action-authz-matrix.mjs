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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt09-action-authz-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");

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
      logPath: path.join(logsDir, "web.log"),
    }
  );

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

async function waitForText(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.trim() === currentExpected;
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

async function expectButtonState(page, testID, expectedDisabled) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element instanceof HTMLButtonElement && element.disabled === currentExpected;
    },
    { currentTestID: testID, currentExpected: expectedDisabled },
    { timeout: 30_000 }
  );
}

async function expectButtonLabel(page, testID, expectedLabel) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.trim() === currentExpected;
    },
    { currentTestID: testID, currentExpected: expectedLabel },
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

async function verifyOwnerSurface(page, webURL, screenshotsDir) {
  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await waitForText(page, "board-create-issue-authz", "allowed");
  await expectButtonState(page, "board-create-issue-submit", false);
  await capture(page, screenshotsDir, "owner-board");

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "load" });
  await waitForText(page, "room-reply-authz", "allowed");
  await expectButtonState(page, "room-send-message", false);
  await waitForText(page, "room-pull-request-authz", "allowed");
  await expectButtonLabel(page, "room-pull-request-action", "合并 PR");
  await expectButtonState(page, "room-pull-request-action", false);
  await capture(page, screenshotsDir, "owner-room");

  await page.goto(`${webURL}/inbox`, { waitUntil: "load" });
  await expectButtonState(page, "approval-center-action-merged-inbox-review-copy", false);
  await expectButtonState(page, "approval-center-action-changes_requested-inbox-review-copy", false);
  await expectButtonState(page, "approval-center-action-approved-inbox-approval-runtime", false);
  await capture(page, screenshotsDir, "owner-inbox");

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await waitForText(page, "setup-repo-binding-authz", "allowed");
  await waitForText(page, "setup-runtime-manage-authz", "allowed");
  await waitForText(page, "setup-exec-authz", "allowed");
  await expectButtonState(page, "setup-repo-bind-button", false);
  await expectButtonState(page, "setup-runtime-pair", false);
  await expectButtonState(page, "setup-runtime-unpair", false);
  await expectButtonState(page, "setup-runtime-exec-submit", false);
  await capture(page, screenshotsDir, "owner-setup");
}

async function verifyMemberSurface(page, webURL, screenshotsDir) {
  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await waitForText(page, "board-create-issue-authz", "allowed");
  await expectButtonState(page, "board-create-issue-submit", false);

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "load" });
  await waitForText(page, "room-reply-authz", "allowed");
  await expectButtonState(page, "room-send-message", false);
  await waitForText(page, "room-pull-request-authz", "review_only");
  await expectButtonLabel(page, "room-pull-request-action", "同步 PR");
  await expectButtonState(page, "room-pull-request-action", false);
  await capture(page, screenshotsDir, "member-room");

  await page.goto(`${webURL}/inbox`, { waitUntil: "load" });
  await expectButtonState(page, "approval-center-action-merged-inbox-review-copy", true);
  await expectButtonState(page, "approval-center-action-changes_requested-inbox-review-copy", false);
  await expectButtonState(page, "approval-center-action-approved-inbox-approval-runtime", true);

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await waitForText(page, "setup-repo-binding-authz", "blocked");
  await waitForText(page, "setup-runtime-manage-authz", "blocked");
  await waitForText(page, "setup-exec-authz", "allowed");
  await expectButtonState(page, "setup-repo-bind-button", true);
  await expectButtonState(page, "setup-runtime-pair", true);
  await expectButtonState(page, "setup-runtime-unpair", true);
  await expectButtonState(page, "setup-runtime-exec-submit", false);
  await capture(page, screenshotsDir, "member-setup");
}

async function verifyViewerSurface(page, webURL, screenshotsDir) {
  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await waitForText(page, "board-create-issue-authz", "blocked");
  await expectButtonState(page, "board-create-issue-submit", true);

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "load" });
  await waitForText(page, "room-reply-authz", "blocked");
  await expectButtonState(page, "room-send-message", true);
  await waitForText(page, "room-pull-request-authz", "blocked");
  await expectButtonState(page, "room-pull-request-action", true);
  await capture(page, screenshotsDir, "viewer-room");

  await page.goto(`${webURL}/inbox`, { waitUntil: "load" });
  await expectButtonState(page, "approval-center-action-merged-inbox-review-copy", true);
  await expectButtonState(page, "approval-center-action-changes_requested-inbox-review-copy", true);
  await expectButtonState(page, "approval-center-action-approved-inbox-approval-runtime", true);

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await waitForText(page, "setup-repo-binding-authz", "blocked");
  await waitForText(page, "setup-runtime-manage-authz", "blocked");
  await waitForText(page, "setup-exec-authz", "blocked");
  await expectButtonState(page, "setup-repo-bind-button", true);
  await expectButtonState(page, "setup-runtime-pair", true);
  await expectButtonState(page, "setup-runtime-unpair", true);
  await expectButtonState(page, "setup-runtime-exec-submit", true);
  await capture(page, screenshotsDir, "viewer-setup");
}

async function verifySignedOutSurface(page, webURL, screenshotsDir) {
  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await waitForText(page, "board-create-issue-authz", "signed_out");
  await expectButtonState(page, "board-create-issue-submit", true);

  await page.goto(`${webURL}/rooms/room-runtime`, { waitUntil: "load" });
  await waitForText(page, "room-reply-authz", "signed_out");
  await expectButtonState(page, "room-send-message", true);
  await waitForText(page, "room-pull-request-authz", "signed_out");
  await expectButtonState(page, "room-pull-request-action", true);

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await waitForText(page, "setup-repo-binding-authz", "signed_out");
  await waitForText(page, "setup-runtime-manage-authz", "signed_out");
  await waitForText(page, "setup-exec-authz", "signed_out");
  await capture(page, screenshotsDir, "signed-out-setup");
}

function reportBody(sections) {
  return `# TKT-09 Action-level AuthZ Matrix Report

- Generated At: ${timestamp()}
- Scope: Board / Room / Inbox / Setup action-level authz matrix
- Result: PASS

## Owner

- Board create issue: ${sections.owner.board}
- Room reply: ${sections.owner.roomReply}
- Room PR action: ${sections.owner.roomPullRequest}
- Inbox review/approval actions: ${sections.owner.inbox}
- Setup repo/runtime/exec authz: ${sections.owner.setup}

## Member

- Board create issue: ${sections.member.board}
- Room reply: ${sections.member.roomReply}
- Room PR action: ${sections.member.roomPullRequest}
- Inbox split: ${sections.member.inbox}
- Setup repo/runtime/exec authz: ${sections.member.setup}

## Viewer

- Board create issue: ${sections.viewer.board}
- Room reply + PR: ${sections.viewer.room}
- Inbox actions: ${sections.viewer.inbox}
- Setup actions: ${sections.viewer.setup}

## Signed Out

- Board / Room / Setup actions: ${sections.signedOut.summary}

## Evidence

${screenshots.map((item) => `- ${item.name}: ${item.path}`).join("\n")}
`;
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
  context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  page = await context.newPage();

  await page.goto(`${services.webURL}/access`, { waitUntil: "load" });
  await page.getByTestId("access-session-status").waitFor({ state: "visible" });
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "Owner",
  });

  await verifyOwnerSurface(page, services.webURL, screenshotsDir);

  await page.goto(`${services.webURL}/access`, { waitUntil: "load" });
  await page.getByTestId("access-quick-login-member-mina").click();
  await waitForSession(page, {
    status: "已登录",
    email: "mina@openshock.dev",
    role: "Member",
  });
  await verifyMemberSurface(page, services.webURL, screenshotsDir);

  await page.goto(`${services.webURL}/access`, { waitUntil: "load" });
  await page.getByTestId("access-quick-login-member-longwen").click();
  await waitForSession(page, {
    status: "已登录",
    email: "longwen@openshock.dev",
    role: "Viewer",
  });
  await verifyViewerSurface(page, services.webURL, screenshotsDir);

  await page.goto(`${services.webURL}/access`, { waitUntil: "load" });
  await page.getByTestId("access-logout-submit").click();
  await waitForSession(page, {
    status: "未登录",
    email: "signed out",
    role: "未分配",
  });
  await verifySignedOutSurface(page, services.webURL, screenshotsDir);

  const sections = {
    owner: {
      board: "allowed / create button enabled",
      roomReply: "allowed / send enabled",
      roomPullRequest: "allowed / merge action enabled on existing PR",
      inbox: "owner can merge review items and approve approval cards",
      setup: "repo.admin + runtime.manage + run.execute all allowed",
    },
    member: {
      board: "allowed / create button enabled",
      roomReply: "allowed / send enabled",
      roomPullRequest: "review_only / sync enabled, merge withheld",
      inbox: "changes_requested enabled, merge/approve disabled",
      setup: "repo/runtime admin blocked, exec allowed",
    },
    viewer: {
      board: "blocked / create button disabled",
      room: "reply + PR actions blocked",
      inbox: "review / approve / merge actions blocked",
      setup: "repo / runtime / exec all blocked",
    },
    signedOut: {
      summary: "board create, room reply, room PR, setup repo/runtime/exec all signed_out + disabled",
    },
  };

  await writeFile(reportPath, reportBody(sections), "utf8");
  console.log(`report: ${reportPath}`);
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
