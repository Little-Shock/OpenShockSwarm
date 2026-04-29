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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-us-012-memory-compaction-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");

const screenshots = [];
const processes = [];

await mkdir(artifactsDir, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });

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

function toTestID(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
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
        OPENSHOCK_CONTROL_API_BASE: serverURL,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: "/api/control",
      },
      logPath: path.join(logsDir, "web.log"),
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/memory`);
    return response.ok;
  }, `web did not become ready at ${webURL}/memory`);

  return { webURL };
}

async function authenticateSeedOwner(page, webURL) {
  await page.goto(`${webURL}/access`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const challengeResponse = await fetch("/api/control/v1/auth/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "request_login_challenge",
        email: "larkspur@openshock.dev",
      }),
    });
    const challengePayload = await challengeResponse.json();
    if (!challengeResponse.ok) {
      throw new Error(`request_login_challenge -> ${challengeResponse.status}: ${JSON.stringify(challengePayload)}`);
    }

    const loginResponse = await fetch("/api/control/v1/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        email: "larkspur@openshock.dev",
        deviceLabel: "Owner Browser",
        challengeId: challengePayload.challenge?.id,
      }),
    });
    const loginPayload = await loginResponse.json();
    if (!loginResponse.ok) {
      throw new Error(`auth/session -> ${loginResponse.status}: ${JSON.stringify(loginPayload)}`);
    }
  });
}

async function seedCompactionCandidates(page) {
  return page.evaluate(async () => {
    const readJSON = async (url, init = {}) => {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
      }
      return payload;
    };

    const memory = await readJSON("/api/control/v1/memory");
    const decisionArtifact = memory.find((item) => item.path === "decisions/ops-27.md");
    const workspaceArtifact = memory.find((item) => item.path === "MEMORY.md");
    if (!decisionArtifact) {
      throw new Error("seed decision artifact should exist");
    }
    if (!workspaceArtifact) {
      throw new Error("seed workspace artifact should exist");
    }

    const first = await readJSON("/api/control/v1/memory-center/compaction", {
      method: "POST",
      body: JSON.stringify({
        sourceArtifactId: decisionArtifact.id,
        reason: "把重复的优先级判断合并成一条长期规则",
      }),
    });
    const second = await readJSON("/api/control/v1/memory-center/compaction", {
      method: "POST",
      body: JSON.stringify({
        sourceArtifactId: workspaceArtifact.id,
        reason: "确认这条工作区资料暂时不需要压缩",
      }),
    });

    return {
      approve: first.candidate,
      dismiss: second.candidate,
    };
  });
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

async function waitForContains(page, testID, expected) {
  await page.waitForFunction(
    ({ currentTestID, currentExpected }) => {
      const element = document.querySelector(`[data-testid="${currentTestID}"]`);
      return element?.textContent?.includes(currentExpected) ?? false;
    },
    { currentTestID: testID, currentExpected: expected },
    { timeout: 30_000 }
  );
}

const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
await mkdir(screenshotsDir, { recursive: true });

let browser;

try {
  const { webURL } = await startServices(runDir);
  browser = await launchChromiumSession(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await authenticateSeedOwner(page, webURL);
  const candidates = await seedCompactionCandidates(page);
  const approveSlug = toTestID(candidates.approve.id);
  const dismissSlug = toTestID(candidates.dismiss.id);

  await page.goto(`${webURL}/memory`, { waitUntil: "load" });

  await waitForContains(page, "memory-artifact-count", "条");
  await page.waitForSelector('[data-testid="memory-default-stack"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="memory-compaction-details"]', { timeout: 30_000 });
  const defaultStackBeforeCompaction = await page.evaluate(() => {
    const defaultStack = document.querySelector('[data-testid="memory-default-stack"]');
    const compaction = document.querySelector('[data-testid="memory-compaction-details"]');
    if (!defaultStack || !compaction) {
      return false;
    }
    return Boolean(defaultStack.compareDocumentPosition(compaction) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert(defaultStackBeforeCompaction, "compaction queue should render after default memory stack");
  await capture(page, screenshotsDir, "memory-default-stack-before-compaction");

  await page.getByTestId("memory-compaction-details-summary").click();
  await waitForContains(page, `memory-compaction-reason-${approveSlug}`, "优先级判断");
  await waitForContains(page, `memory-compaction-source-${approveSlug}`, "decisions/ops-27.md");
  await waitForText(page, `memory-compaction-status-${approveSlug}`, "待处理");
  await page.getByTestId(`memory-compaction-${approveSlug}-approve`).waitFor({ state: "visible" });
  await page.getByTestId(`memory-compaction-${dismissSlug}-dismiss`).waitFor({ state: "visible" });
  await capture(page, screenshotsDir, "compaction-queue-open");

  await page.getByTestId(`memory-compaction-${approveSlug}-approve`).click();
  await waitForText(page, `memory-compaction-status-${approveSlug}`, "已通过");
  await page.getByTestId(`memory-compaction-${dismissSlug}-dismiss`).click();
  await waitForText(page, `memory-compaction-status-${dismissSlug}`, "已忽略");
  await capture(page, screenshotsDir, "compaction-queue-reviewed");

  const report = [
    "# US-012 Memory Compaction Queue UI Report",
    "",
    `- Command: \`pnpm test:headed-memory-compaction-queue -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/memory` keeps the default file stack before the collapsed compaction queue section -> PASS",
    "- Compaction candidates show source artifact, reason, status, approve action, and dismiss action -> PASS",
    "- Browser approve/dismiss actions update the visible candidate statuses to 已通过 / 已忽略 -> PASS",
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
