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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt07-session-foundation-")));
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

  return { webURL, serverURL, workspaceRoot, statePath };
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
  assert((await readText(page, "access-probe-status-issue-create")) === "allowed", "owner should be allowed to create issues");
  assert((await readText(page, "access-probe-status-runtime-manage")) === "allowed", "owner should be allowed to manage runtime");
  await capture(page, screenshotsDir, "owner-session");

  await page.getByTestId("access-quick-login-member-mina").click();
  await waitForSession(page, {
    status: "已登录",
    email: "mina@openshock.dev",
    role: "Member",
  });
  assert((await readText(page, "access-probe-status-issue-create")) === "allowed", "member should still be allowed to create issues");
  assert((await readText(page, "access-probe-status-runtime-manage")) === "blocked", "member should not manage runtime");
  await capture(page, screenshotsDir, "member-session");

  await page.reload({ waitUntil: "load" });
  await waitForSession(page, {
    status: "已登录",
    email: "mina@openshock.dev",
    role: "Member",
  });
  await capture(page, screenshotsDir, "member-session-persisted");

  await page.getByTestId("access-logout-submit").click();
  await waitForSession(page, {
    status: "未登录",
    email: "signed out",
    role: "未分配",
  });
  assert((await readText(page, "access-probe-status-issue-create")) === "blocked", "signed out session should block issue creation");
  assert((await readText(page, "access-probe-status-inbox-review")) === "blocked", "signed out session should block inbox review");
  await capture(page, screenshotsDir, "signed-out-session");

  await page.reload({ waitUntil: "load" });
  await waitForSession(page, {
    status: "未登录",
    email: "signed out",
    role: "未分配",
  });
  await capture(page, screenshotsDir, "signed-out-session-persisted");

  await page.getByTestId("access-quick-login-member-larkspur").click();
  await waitForSession(page, {
    status: "已登录",
    email: "larkspur@openshock.dev",
    role: "Owner",
  });
  await capture(page, screenshotsDir, "owner-session-restored");

  const report = [
    "# TKT-07 Login / Session Foundation Report",
    "",
    `- Command: \`pnpm test:headed-session-foundation -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "### Access Session Lifecycle",
    "",
    "- Initial session: `active / larkspur@openshock.dev / Owner`",
    "- Quick login member: `mina@openshock.dev / Member`",
    "- Session persistence after reload: PASS",
    "- Logout state: `signed out / 未分配`",
    "- Signed-out persistence after reload: PASS",
    "- Owner restore after quick login: PASS",
    "",
    "### Permission Surface",
    "",
    "- Owner: `issue.create = allowed`, `runtime.manage = allowed`",
    "- Member: `issue.create = allowed`, `runtime.manage = blocked`",
    "- Signed out: `issue.create = blocked`, `inbox.review = blocked`",
    "",
    "### Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
    "## Conclusion",
    "",
    "- `/access` 现在已站住真实 login / logout / session lifecycle，不再停在静态占位说明。",
    "- 刷新后 session 仍保持当前登录态，证明 foundation 不只是单次前端内存状态。",
    "- 当前票只收 session foundation；invite / role mutation / action-level authz matrix 继续留给后续票。",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
