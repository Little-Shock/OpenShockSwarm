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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt34-onboarding-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
const logsDir = path.join(runDir, "logs");
const workspaceRoot = path.join(runDir, "workspace");
const statePath = path.join(runDir, "state.json");

const processes = [];
const screenshots = [];

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(workspaceRoot, { recursive: true });

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

async function capture(page, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function waitForHealth(serverURL) {
  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);
}

async function startWeb(webPort, serverURL) {
  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    },
    logPath: path.join(logsDir, "web.log"),
  });
  const webURL = `http://127.0.0.1:${webPort}`;
  await waitFor(async () => {
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);
  return webURL;
}

function startServer(serverPort) {
  return startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
    },
    logPath: path.join(logsDir, "server.log"),
  });
}

async function readText(page, testID) {
  return (await page.getByTestId(testID).textContent())?.trim() ?? "";
}

async function readWorkspace(serverURL) {
  const response = await fetch(`${serverURL}/v1/workspace`);
  if (!response.ok) {
    throw new Error(`GET /v1/workspace failed with ${response.status}`);
  }
  return response.json();
}

async function patchWorkspace(serverURL, payload) {
  const response = await fetch(`${serverURL}/v1/workspace`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`PATCH /v1/workspace failed with ${response.status}`);
  }

  return response.json();
}

async function waitForText(page, testID, expected) {
  await waitFor(async () => (await readText(page, testID)) === expected, `${testID} did not become ${expected}`);
}

async function waitForVisible(page, testID) {
  await page.getByTestId(testID).waitFor({ state: "visible", timeout: 30_000 });
}

let browser;

try {
  const webPort = await freePort();
  const serverPort = await freePort();
  const serverURL = `http://127.0.0.1:${serverPort}`;
  let serverChild = startServer(serverPort);
  await waitForHealth(serverURL);
  const webURL = await startWeb(webPort, serverURL);

  browser = await launchChromiumSession(chromium);

  const results = [];
  const page = await browser.newPage({ viewport: { width: 1560, height: 1280 } });

  await page.goto(`${webURL}/access`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "access-first-start-next-route", "/onboarding");
  await waitForText(page, "access-first-start-step-session-status", "ready");
  await waitForText(page, "access-first-start-step-identity-status", "ready");
  await waitForText(page, "access-first-start-step-setup-status", "active");
  await capture(page, "access-before-onboarding");
  results.push("- `/access` 在当前已登录但尚未完成设置的状态下，会把下一跳明确压成 `/onboarding`。");

  await page.getByTestId("access-first-start-next-link").click();
  await page.waitForURL(new RegExp(`${webURL}/onboarding`), { timeout: 30_000 });
  await waitForVisible(page, "onboarding-github-skip");
  await capture(page, "onboarding-resume-github");
  results.push("- 从 `/access` 点继续后会直接恢复到页内向导当前步骤，而不是先绕到旧的 setup 面板。");

  await page.getByTestId("onboarding-go-back").click();
  await waitForVisible(page, "onboarding-template-research-team");
  await capture(page, "onboarding-template");

  await page.getByTestId("onboarding-template-research-team").click();
  await waitForText(page, "onboarding-success", "模板已保存，继续配置 GitHub。");
  await waitForVisible(page, "onboarding-github-skip");
  await capture(page, "onboarding-github");

  await page.getByTestId("onboarding-github-skip").click();
  await waitForText(page, "onboarding-success", "已跳过 GitHub，继续下一步。");
  await waitForVisible(page, "onboarding-repo-manual-submit");

  await page.getByTestId("onboarding-repo-name").fill("Larkspur-Wang/OpenShock");
  await page.getByTestId("onboarding-repo-url").fill("https://github.com/Larkspur-Wang/OpenShock");
  await page.getByTestId("onboarding-repo-branch").fill("main");
  await page.getByTestId("onboarding-repo-manual-submit").click();
  await waitForText(page, "onboarding-success", "仓库信息已保存。");
  await waitForVisible(page, "onboarding-runtime-pair");
  await capture(page, "onboarding-repo");

  await page.getByTestId("onboarding-runtime-pair").click();
  await waitForText(page, "onboarding-success", "运行环境已连接，继续设置智能体。");
  await waitForVisible(page, "onboarding-agent-submit");
  await capture(page, "onboarding-runtime");

  await page.getByTestId("onboarding-agent-name").fill("启动智能体");
  await page.getByTestId("onboarding-agent-role").fill("工作区搭建");
  await page.getByTestId("onboarding-agent-submit").click();
  await waitForText(page, "onboarding-success", "智能体配置已保存。");
  await waitForVisible(page, "onboarding-finish-submit");
  await capture(page, "onboarding-agent");

  await page.getByTestId("onboarding-finish-submit").click();
  await page.waitForURL(new RegExp(`${webURL}/chat/all`), { timeout: 30_000 });
  await capture(page, "chat-after-onboarding");
  results.push("- 新向导会继续完成模板、仓库、运行环境和智能体配置，最后直接落到 `/chat/all`。");

  const workspaceAfterFinish = await readWorkspace(serverURL);
  if (workspaceAfterFinish.onboarding.status !== "done") {
    throw new Error(`expected onboarding status done, got ${workspaceAfterFinish.onboarding.status}`);
  }
  if ((workspaceAfterFinish.onboarding.templateId ?? "").trim() !== "research-team") {
    throw new Error(`expected research-team template, got ${workspaceAfterFinish.onboarding.templateId}`);
  }
  if ((workspaceAfterFinish.onboarding.resumeUrl ?? "").trim() !== "/chat/all") {
    throw new Error(`expected /chat/all resume route, got ${workspaceAfterFinish.onboarding.resumeUrl}`);
  }

  await page.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "setup-onboarding-template", "研究团队");
  await waitForText(page, "setup-onboarding-status", "已完成");
  await waitForText(page, "setup-onboarding-resume-url", "/chat/all");
  await capture(page, "setup-after-onboarding");
  results.push("- `/setup` 会回显同一份 onboarding truth，包括模板、状态和恢复入口。");

  await page.goto(`${webURL}/access`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "access-first-start-next-route", "/chat/all");
  await waitForText(page, "access-first-start-step-session-status", "ready");
  await waitForText(page, "access-first-start-step-identity-status", "ready");
  await waitForText(page, "access-first-start-step-setup-status", "ready");
  await capture(page, "access-after-onboarding");
  results.push("- 引导完成后回到 `/access`，下一跳会变成 `/chat/all`，first-start journey 会正确收口。");

  await page.getByTestId("access-first-start-next-link").click();
  await page.waitForURL(new RegExp(`${webURL}/chat/all`), { timeout: 30_000 });
  await capture(page, "access-launch-chat");
  results.push("- `/access` 的继续按钮在完成首次设置后会直接进入聊天主界面。");

  await stopProcess(serverChild);
  serverChild = startServer(serverPort);
  await waitForHealth(serverURL);

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "settings-workspace-template-text", "research-team");
  await waitFor(async () => (await readText(page, "settings-workspace-onboarding-value")).includes("已完成"), "settings did not project finished onboarding truth");
  await capture(page, "settings-after-server-restart");
  results.push("- 重启 server 后，`/settings` 仍能读到同一份已完成 onboarding 状态，说明数据已经持久化。");

  const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await waitForText(secondPage, "setup-onboarding-template", "研究团队");
  await waitForText(secondPage, "setup-onboarding-status", "已完成");
  await waitForText(secondPage, "setup-onboarding-resume-url", "/chat/all");
  await capture(secondPage, "setup-second-context");
  await secondContext.close();
  results.push("- 第二个浏览器上下文打开 `/setup` 时也能读到同一份 onboarding 结果，恢复不依赖单个 tab。");

  const reportLines = [
    "# Test Report 2026-04-11 First-Start Journey / Access-Onboarding-Chat",
    "",
    `- Command: \`pnpm test:headed-first-start-journey -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Generated At: ${timestamp()}`,
    "",
    "## Result",
    "",
    ...results,
    "",
    "## Evidence",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "## Scope",
    "",
    "- 从 `/access` 起步，验证未完成设置时下一跳会进入 `/onboarding`，而不是继续指向旧的 setup 主路径。",
    "- 在 `/onboarding` 从当前恢复步骤回退到模板，重新选择模板后继续完成 GitHub 跳过、仓库识别、运行环境连接和智能体保存，然后确认最终进入 `/chat/all`。",
    "- 验证完成首次启动后，`/access`、`/setup` 和 `/settings` 会投影同一份已完成的 onboarding truth。",
    "- 验证 server restart 与第二个浏览器上下文后，模板、状态和恢复入口仍保持一致。",
  ];

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8");
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  await cleanupProcesses();
}
