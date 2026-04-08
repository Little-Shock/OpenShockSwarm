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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-machine-profile-binding-")));
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

async function waitForVisible(locator, message) {
  await waitFor(async () => (await locator.count()) > 0 && (await locator.first().isVisible()), message);
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
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);

  return { webURL, serverURL };
}

async function expectLocatorText(locator, expected, message) {
  await waitFor(async () => {
    const text = await locator.first().textContent();
    return text?.includes(expected);
  }, message);
}

let browser;

try {
  const { webURL, serverURL } = await startServices();
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const results = [];

  await page.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="setup-runtime-card-shock-main"]'), "setup runtime card did not render");
  await waitForVisible(page.locator('[data-testid="setup-selected-runtime-shell"]'), "selected runtime shell metric did not render");
  await capture(page, "setup-runtime-inventory");
  await expectLocatorText(
    page.locator('[data-testid="setup-selected-runtime-shell"]'),
    "pwsh",
    "setup shell metric did not report pwsh"
  );
  await expectLocatorText(
    page.locator('[data-testid="setup-runtime-card-shock-main"]'),
    "Codex CLI: gpt-5.2 / gpt-5.3-codex / gpt-5.1-codex-mini",
    "setup card missing codex model catalog"
  );
  await expectLocatorText(
    page.locator('[data-testid="setup-runtime-card-shock-main"]'),
    "Claude Code CLI: claude-sonnet-4 / claude-opus-4.1",
    "setup card missing claude model catalog"
  );
  results.push("`/setup` 当前会直接展示 selected runtime 的 shell 与 provider-model catalog。");

  await page.goto(`${webURL}/profiles/machine/machine-main`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="machine-profile-shell"]'), "machine profile shell metric did not render");
  await waitForVisible(page.locator('[data-testid="machine-runtime-shock-main-provider-codex"]'), "machine provider catalog did not render");
  await capture(page, "machine-profile-inventory");
  await expectLocatorText(
    page.locator('[data-testid="machine-profile-shell"]'),
    "pwsh",
    "machine profile shell metric did not report pwsh"
  );
  await expectLocatorText(
    page.locator('[data-testid="machine-runtime-shock-main-provider-codex"]'),
    "gpt-5.3-codex",
    "machine profile codex catalog missing model"
  );
  await expectLocatorText(
    page.locator('[data-testid="machine-runtime-shock-main-provider-claude"]'),
    "claude-opus-4.1",
    "machine profile claude catalog missing model"
  );
  results.push("machine profile 会和 `/setup` 读同一份 runtime truth：shell、daemon、CLI 与 provider-model catalog 一致。");

  await page.goto(`${webURL}/profiles/agent/agent-codex-dockmaster`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="profile-editor-runtime-preference"]'), "agent runtime select did not render");
  await waitForVisible(page.locator('[data-testid="profile-binding-runtime-card"]'), "agent binding catalog card did not render");
  await capture(page, "agent-profile-before-binding-edit");

  await page.locator('[data-testid="profile-editor-runtime-preference"]').selectOption("shock-sidecar");
  await expectLocatorText(
    page.locator('[data-testid="profile-binding-runtime-card"]'),
    "shock-sidecar",
    "binding catalog did not switch to shock-sidecar"
  );
  await expectLocatorText(
    page.locator('[data-testid="profile-binding-shell"]'),
    "zsh",
    "binding catalog did not switch shell to zsh"
  );
  await page.locator('[data-testid="profile-editor-provider-preference"]').selectOption("Codex CLI");
  await page.locator('[data-testid="profile-editor-model-preference"]').fill("gpt-5.4");
  await page.locator('[data-testid="profile-editor-save"]').click();
  await waitForVisible(page.locator('[data-testid="profile-editor-save-status"]'), "agent profile save status did not render");
  await capture(page, "agent-profile-after-binding-save");

  const agentResponse = await fetch(`${serverURL}/v1/agents/agent-codex-dockmaster`);
  if (!agentResponse.ok) {
    throw new Error(`GET /v1/agents/agent-codex-dockmaster failed: ${agentResponse.status}`);
  }
  const savedAgent = await agentResponse.json();
  if (
    savedAgent.providerPreference !== "Codex CLI" ||
    savedAgent.modelPreference !== "gpt-5.4" ||
    savedAgent.runtimePreference !== "shock-sidecar"
  ) {
    throw new Error(`saved agent binding mismatch: ${JSON.stringify(savedAgent)}`);
  }

  await expectLocatorText(
    page.locator('[data-testid="profile-next-run-preview-summary"]'),
    "gpt-5.4",
    "next-run preview did not absorb updated custom model preference"
  );
  await expectLocatorText(
    page.locator('[data-testid="profile-next-run-preview-summary"]'),
    "shock-sidecar",
    "next-run preview did not absorb updated runtime preference"
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="profile-editor-runtime-preference"]'), "agent profile did not reload");
  if ((await page.locator('[data-testid="profile-editor-runtime-preference"]').inputValue()) !== "shock-sidecar") {
    throw new Error("runtime preference did not persist after reload");
  }
  if ((await page.locator('[data-testid="profile-editor-provider-preference"]').inputValue()) !== "Codex CLI") {
    throw new Error("provider preference did not persist after reload");
  }
  if ((await page.locator('[data-testid="profile-editor-model-preference"]').inputValue()) !== "gpt-5.4") {
    throw new Error("model preference did not persist after reload");
  }
  await capture(page, "agent-profile-after-reload");
  results.push("Agent profile editor 现在可把 provider / model / runtime affinity 直接写回后端 truth；provider-model catalog 只作 suggestion，catalog 外 model id reload 后仍保持同一份绑定。");

  await page.goto(`${webURL}/agents`, { waitUntil: "domcontentloaded" });
  await waitForVisible(page.locator('[data-testid="agents-card-agent-codex-dockmaster"]'), "agents card did not render");
  await capture(page, "agents-page-binding-summary");
  await expectLocatorText(
    page.locator('[data-testid="agents-card-agent-codex-dockmaster"]'),
    "Codex CLI / gpt-5.4",
    "agents page did not reflect provider/model binding"
  );
  await expectLocatorText(
    page.locator('[data-testid="agents-card-agent-codex-dockmaster"]'),
    "shock-sidecar",
    "agents page did not reflect runtime binding"
  );
  results.push("`/agents` 也会回读同一份 binding truth，不再停留在旧 provider/runtime 摘要。");

  const reportLines = [
    "# 2026-04-09 Machine Profile / Local CLI Model Capability Binding Report",
    "",
    "- Command: `pnpm test:headed-machine-profile-capability-binding -- --report docs/testing/Test-Report-2026-04-09-machine-profile-capability-binding.md`",
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    ...results.map((line) => `- ${line}`),
    "",
    "## Screenshots",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
    "## Single Value",
    "- `TKT-33` 现在已经把 machine shell / daemon / provider-model catalog 和 Agent provider+model+runtime affinity 收进同一份后端 truth；`/setup`、machine profile、`/agents` 与 Agent profile editor 回读一致，而 model catalog 只作 suggestion、不再对 catalog 外 model 做静态硬拒绝。",
    "",
  ];

  await writeFile(reportPath, reportLines.join("\n"), "utf8");
  process.stdout.write(`Report written to ${reportPath}\n`);
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  await cleanupProcesses();
}
