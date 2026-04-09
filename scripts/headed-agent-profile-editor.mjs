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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-agent-profile-editor-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
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

  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        OPENSHOCK_CONTROL_API_BASE: serverURL,
      },
    }
  );

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/profiles/agent/agent-codex-dockmaster`);
    return response.ok;
  }, `web did not become ready at ${webURL}/profiles/agent/agent-codex-dockmaster`);

  return { webURL };
}

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await launchChromiumSession(chromium);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const results = [];
  const sandboxProfile = "restricted";
  const allowedHosts = "github.com, api.openai.com";
  const allowedCommands = "git status, pnpm test";
  const allowedTools = "read_file, rg";

  await page.goto(`${webURL}/profiles/agent/agent-codex-dockmaster`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="profile-surface-title"]'), "agent profile title did not render");
  await waitForVisible(page.locator('[data-testid="profile-editor-role"]'), "agent profile editor did not render");
  await capture(page, "agent-profile-before-edit");

  await page.locator('[data-testid="profile-editor-role"]').fill("Delivery Lead");
  await page.locator('[data-testid="profile-editor-avatar"]').fill("signal-radar");
  await page
    .locator('[data-testid="profile-editor-prompt"]')
    .fill("Always start from live repo truth, then propose the shortest next action.");
  await page
    .locator('[data-testid="profile-editor-operating-instructions"]')
    .fill("Keep reviewer and owner windows separate.");
  await page.locator('[data-testid="profile-editor-provider-preference"]').selectOption("Claude Code CLI");
  await page.locator('[data-testid="profile-editor-recall-policy"]').selectOption("agent-first");
  await page.locator('[data-testid="profile-editor-sandbox-profile"]').selectOption(sandboxProfile);
  await page.locator('[data-testid="profile-editor-sandbox-allowed-hosts"]').fill(allowedHosts);
  await page.locator('[data-testid="profile-editor-sandbox-allowed-commands"]').fill(allowedCommands);
  await page.locator('[data-testid="profile-editor-sandbox-allowed-tools"]').fill(allowedTools);

  const issueRoomToggle = page.locator('[data-testid="profile-editor-memory-space-issue-room"]');
  if (await issueRoomToggle.isChecked()) {
    await issueRoomToggle.uncheck();
  }
  const topicToggle = page.locator('[data-testid="profile-editor-memory-space-topic"]');
  if (await topicToggle.isChecked()) {
    await topicToggle.uncheck();
  }
  const userToggle = page.locator('[data-testid="profile-editor-memory-space-user"]');
  if (!(await userToggle.isChecked())) {
    await userToggle.check();
  }

  await page.locator('[data-testid="profile-editor-save"]').click();
  await waitForVisible(page.locator('[data-testid="profile-editor-save-status"]'), "profile save status did not render");
  await waitFor(async () => {
    const text = await page.locator('[data-testid="profile-next-run-preview-summary"]').innerText();
    return text.includes("Delivery Lead") && text.includes("Claude Code CLI") && text.includes("agent-first");
  }, "next-run preview did not reflect updated profile");
  await waitForVisible(page.locator('[data-testid="profile-audit-entry"]'), "profile audit entry did not render");
  await capture(page, "agent-profile-after-save");
  results.push("- 在 Agent profile 中编辑 `role / avatar / prompt / provider preference / memory binding / recall policy / sandbox policy` 后，保存会直接写回后端 truth，并立刻刷新同页状态。");

  await waitForVisible(
    page.locator('[data-testid="profile-next-run-preview-file-openshock-agents-codex-dockmaster-memory-md"]'),
    "agent memory file did not enter next-run preview"
  );
  const previewText = await page.locator('[data-testid="profile-next-run-preview-summary"]').innerText();
  if (previewText.includes("notes/rooms/room-runtime.md")) {
    throw new Error("room note still appears in prompt summary after removing issue-room binding");
  }
  results.push("- next-run preview 现在会吸收新的 Agent profile：summary 带出 `Delivery Lead / Claude Code CLI / agent-first`，并把 `.openshock/agents/codex-dockmaster/MEMORY.md` 收进 preview。");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="profile-editor-role"]'), "profile editor did not survive reload");
  await waitFor(async () => (await page.locator('[data-testid="profile-editor-role"]').inputValue()) === "Delivery Lead", "role did not persist after reload");
  await waitFor(async () => (await page.locator('[data-testid="profile-editor-sandbox-profile"]').inputValue()) === sandboxProfile, "sandbox profile did not persist after reload");
  await waitFor(async () => (await page.locator('[data-testid="profile-editor-sandbox-allowed-hosts"]').inputValue()) === allowedHosts, "sandbox hosts did not persist after reload");
  await waitFor(async () => (await page.locator('[data-testid="profile-editor-sandbox-allowed-commands"]').inputValue()) === allowedCommands, "sandbox commands did not persist after reload");
  await waitFor(async () => (await page.locator('[data-testid="profile-editor-sandbox-allowed-tools"]').inputValue()) === allowedTools, "sandbox tools did not persist after reload");
  await waitFor(async () => {
    const text = await page.locator('[data-testid="profile-next-run-preview-summary"]').innerText();
    return text.includes("Delivery Lead") && text.includes("agent-first");
  }, "next-run preview did not persist after reload");
  await capture(page, "agent-profile-after-reload");
  results.push("- 刷新页面后，profile editor、profile audit 和 next-run preview 都会继续读回同一份持久化 truth；sandbox allowlist 也不会退回默认值。");

  const report = [
    "# 2026-04-09 Agent Profile Editor Report",
    "",
    `- Command: \`pnpm test:headed-agent-profile-editor -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results,
    "",
    "## Screenshots",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
    "",
    "## Single Value",
    "- Agent profile 现在已经不只是只读 surface：`role / avatar / prompt / provider preference / memory binding / recall policy / sandbox policy` 可编辑、可持久化，并能直接改写同页 next-run preview 与 profile audit truth。",
  ].join("\n");

  await writeFile(reportPath, `${report}\n`, "utf8");
} finally {
  await Promise.allSettled([browser?.close(), cleanupProcesses()]);
}
