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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt37-config-persistence-")));
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
    const response = await fetch(`${webURL}/settings`);
    return response.ok;
  }, `web did not become ready at ${webURL}/settings`);
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

async function waitForText(page, testID, expected) {
  await waitFor(async () => (await readText(page, testID)) === expected, `${testID} did not become ${expected}`);
}

async function waitForInputValue(page, testID, expected) {
  await waitFor(async () => (await page.getByTestId(testID).inputValue()) === expected, `${testID} did not become ${expected}`);
}

async function expandDetails(page, selector, message) {
  const details = page.locator(selector);
  await waitFor(async () => (await details.count()) > 0, message);
  await details.evaluate((node) => {
    if (node instanceof HTMLDetailsElement) {
      node.open = true;
    }
  });
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
  const templateId = "research-team";
  const onboardingStatus = "ready";
  const currentStep = "identity-proof";
  const resumeUrl = "/access?resume=research-team";
  const browserPush = "全部通知";
  const memoryMode = "governed-first / recovery ready";
  const sandboxProfile = "restricted";
  const allowedHosts = "github.com, api.openai.com";
  const allowedCommands = "git status, pnpm test";
  const allowedTools = "read_file, rg";
  const preferredAgentId = "agent-claude-review-runner";
  const preferredAgentLabel = "Claude Review Runner";
  const startRoute = "/rooms";
  const githubHandle = "@durable-owner";
  const templateLabel = "研究团队";
  const onboardingStatusLabel = "待收口";

  const page = await browser.newPage({ viewport: { width: 1560, height: 1280 } });

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await waitFor(async () => (await page.getByTestId("settings-workspace-template").count()) > 0, "settings workspace panel did not render");
  await capture(page, "settings-before-write");

  await page.getByTestId("settings-workspace-template").fill(templateId);
  await page.getByTestId("settings-workspace-onboarding-status").selectOption(onboardingStatus);
  await page.getByTestId("settings-workspace-current-step").fill(currentStep);
  await page.getByTestId("settings-workspace-completed-steps").fill("workspace-created, repo-bound, agent-profile");
  await page.getByTestId("settings-workspace-resume-url").fill(resumeUrl);
  await page.getByTestId("settings-workspace-browser-push").fill(browserPush);
  await page.getByTestId("settings-workspace-memory-mode").fill(memoryMode);
  await page.getByTestId("settings-workspace-sandbox-profile").selectOption(sandboxProfile);
  await page.getByTestId("settings-workspace-sandbox-allowed-hosts").fill(allowedHosts);
  await page.getByTestId("settings-workspace-sandbox-allowed-commands").fill(allowedCommands);
  await page.getByTestId("settings-workspace-sandbox-allowed-tools").fill(allowedTools);
  await page.getByTestId("settings-workspace-save").click();
  await waitForText(page, "settings-workspace-success", "工作区设置已保存。");

  await page.getByTestId("settings-member-preferred-agent").selectOption(preferredAgentId);
  await page.getByTestId("settings-member-start-route").selectOption(startRoute);
  await page.getByTestId("settings-member-github-handle").fill(githubHandle);
  await page.getByTestId("settings-member-save").click();
  await waitForText(page, "settings-member-success", "成员偏好已保存，换设备后也会继续读取同一份设置。");
  await capture(page, "settings-after-write");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForInputValue(page, "settings-workspace-template", templateId);
  await waitForInputValue(page, "settings-workspace-current-step", currentStep);
  await waitForInputValue(page, "settings-workspace-resume-url", resumeUrl);
  await waitForInputValue(page, "settings-workspace-browser-push", browserPush);
  await waitForInputValue(page, "settings-workspace-memory-mode", memoryMode);
  await waitFor(async () => (await page.getByTestId("settings-workspace-sandbox-profile").inputValue()) === sandboxProfile, "sandbox profile did not persist");
  await waitForInputValue(page, "settings-workspace-sandbox-allowed-hosts", allowedHosts);
  await waitForInputValue(page, "settings-workspace-sandbox-allowed-commands", allowedCommands);
  await waitForInputValue(page, "settings-workspace-sandbox-allowed-tools", allowedTools);
  await waitForText(page, "settings-workspace-template-text", templateId);
  await waitFor(async () => (await page.getByTestId("settings-member-preferred-agent").inputValue()) === preferredAgentId, "preferred agent select did not persist");
  await waitFor(async () => (await page.getByTestId("settings-member-start-route").inputValue()) === startRoute, "start route select did not persist");
  await waitForInputValue(page, "settings-member-github-handle", githubHandle);
  results.push("- `/settings` 写入后的引导信息和安全设置可以在刷新后保持一致。");

  await page.goto(`${webURL}/access`, { waitUntil: "domcontentloaded" });
  await waitForText(page, "access-durable-preferred-agent", preferredAgentLabel);
  await waitForText(page, "access-durable-start-route", startRoute);
  await waitForText(page, "access-durable-github-handle", githubHandle);
  await capture(page, "access-projection");
  results.push("- `/access` 会显示和 `/settings` 一致的成员偏好与 GitHub 身份。");

  await page.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await expandDetails(page, '[data-testid="setup-overview-technical-details"]', "setup technical detail panel did not render");
  await waitForText(page, "setup-onboarding-template", templateLabel);
  await waitForText(page, "setup-onboarding-status", onboardingStatusLabel);
  await waitForText(page, "setup-onboarding-resume-url", resumeUrl);
  await capture(page, "setup-projection");
  results.push("- `/setup` 会读取同一份引导模板、状态和继续地址。");

  await stopProcess(serverChild);
  serverChild = startServer(serverPort);
  await waitForHealth(serverURL);

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await waitForInputValue(page, "settings-workspace-template", templateId);
  await waitFor(async () => (await page.getByTestId("settings-member-preferred-agent").inputValue()) === preferredAgentId, "preferred agent did not survive server restart");
  await capture(page, "settings-after-server-restart");
  results.push("- 服务端重启后，工作区和成员设置都能继续保留。");

  const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(`${webURL}/access`, { waitUntil: "domcontentloaded" });
  await waitForText(secondPage, "access-durable-preferred-agent", preferredAgentLabel);
  await waitForText(secondPage, "access-durable-start-route", startRoute);
  await waitForText(secondPage, "access-durable-github-handle", githubHandle);
  await secondPage.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await expandDetails(secondPage, '[data-testid="setup-overview-technical-details"]', "setup technical detail panel did not render in second browser");
  await waitForText(secondPage, "setup-onboarding-template", templateLabel);
  await waitForText(secondPage, "setup-onboarding-status", onboardingStatusLabel);
  await waitForText(secondPage, "setup-onboarding-resume-url", resumeUrl);
  await capture(secondPage, "second-device-recovery");
  await secondContext.close();
  results.push("- 第二个浏览器上下文也能读取同一份工作区和成员设置。");

  const reportLines = [
    "# 2026-04-12 配置持久化与恢复测试报告",
    "",
    `- Command: \`pnpm test:headed-config-persistence-recovery -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- 生成时间: ${timestamp()}`,
    "",
    "## 结果",
    "",
    ...results,
    "",
    "## 证据",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "## 范围说明",
    "",
    "- 已从 `/settings` 修改工作区引导、模板、浏览器提醒、记忆模式和安全基线。",
    "- 已从 `/settings` 修改成员常用智能体、默认入口和 GitHub 身份。",
    "- 已验证刷新、服务端重启和第二浏览器上下文后，`/access` 与 `/setup` 仍读取同一份配置。",
  ];
  await writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8");
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  await cleanupProcesses();
}
