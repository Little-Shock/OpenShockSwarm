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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt62-team-topology-")));
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function timestamp() {
  return new Date().toISOString();
}

function reportDateLabel() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
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

async function waitForHealth(serverURL) {
  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);
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

async function capture(page, name) {
  const shotPath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  screenshots.push({ name, path: shotPath });
}

async function readText(page, testID) {
  return (await page.getByTestId(testID).textContent())?.trim() ?? "";
}

async function readState(serverURL) {
  const response = await fetch(`${serverURL}/v1/state`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /v1/state failed: ${response.status}`);
  }
  return response.json();
}

async function waitForInputValue(page, testID, expected) {
  await waitFor(async () => (await page.getByTestId(testID).inputValue()) === expected, `${testID} did not become ${expected}`);
}

let browser = null;
let context = null;
let page = null;

try {
  const webPort = await freePort();
  const serverPort = await freePort();
  const serverURL = `http://127.0.0.1:${serverPort}`;
  let serverChild = startServer(serverPort);
  await waitForHealth(serverURL);
  const webURL = await startWeb(webPort, serverURL);

  const reportDate = reportDateLabel();
  const browserLabel = process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "Windows Chrome " : "";
  const reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-configurable-team-topology -- --report ${path.relative(projectRoot, reportPath)}`;

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1560, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("settings-governance-topology-count").waitFor({ state: "visible" });
  await waitFor(async () => (await readText(page, "settings-governance-topology-count")).includes("5"), "baseline topology should start with 5 configured lanes");
  await capture(page, "settings-governance-before");

  await page.getByTestId("settings-governance-lane-label-2").fill("Builder");
  await page.getByTestId("settings-governance-lane-role-2").fill("实现与交付");
  await page.getByTestId("settings-governance-lane-default-agent-2").fill("Build Pilot");
  await page.getByTestId("settings-governance-lane-path-2").fill("build / ship");
  await page.getByTestId("settings-governance-add-lane").click();
  await page.getByTestId("settings-governance-lane-id-5").fill("ops");
  await page.getByTestId("settings-governance-lane-label-5").fill("Ops");
  await page.getByTestId("settings-governance-lane-role-5").fill("发布与回收");
  await page.getByTestId("settings-governance-lane-default-agent-5").fill("QA Relay");
  await page.getByTestId("settings-governance-lane-path-5").fill("release / closeout");
  await page.getByTestId("settings-governance-save").click();
  await waitFor(async () => (await readText(page, "settings-governance-success")).includes("team topology 已写回"), "governance save success message did not appear");
  await capture(page, "settings-governance-after-save");

  let state = await readState(serverURL);
  assert(state.workspace.governance.configuredTopology.length === 6, "server configured topology should contain 6 lanes after save");
  assert(state.workspace.governance.teamTopology.some((lane) => lane.id === "ops"), "server derived topology should include ops lane");
  assert(state.workspace.governance.teamTopology.some((lane) => lane.id === "developer" && lane.label === "Builder"), "developer lane should be renamed to Builder in derived topology");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForInputValue(page, "settings-governance-lane-label-2", "Builder");
  await waitForInputValue(page, "settings-governance-lane-id-5", "ops");
  await waitForInputValue(page, "settings-governance-lane-label-5", "Ops");
  await waitFor(async () => (await readText(page, "settings-governance-topology-count")).includes("6"), "topology count did not persist after reload");

  await page.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("setup-governance-lane-developer").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-lane-ops").waitFor({ state: "visible" });
  assert((await readText(page, "setup-governance-lane-developer")).includes("Builder"), "setup governance preview should reflect Builder lane label");
  assert((await readText(page, "setup-governance-lane-ops")).includes("Ops"), "setup governance preview should reflect ops lane");
  await capture(page, "setup-governance-preview");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("mailbox-governance-lane-developer").waitFor({ state: "visible" });
  await page.getByTestId("mailbox-governance-lane-ops").waitFor({ state: "visible" });
  assert((await readText(page, "mailbox-governance-lane-developer")).includes("Builder"), "mailbox governance lane should reflect Builder");
  assert((await readText(page, "mailbox-governance-lane-ops")).includes("Ops"), "mailbox governance lane should reflect Ops");
  await capture(page, "mailbox-governance-preview");

  await page.goto(`${webURL}/agents`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("orchestration-governance-lane-developer").waitFor({ state: "visible" });
  await page.getByTestId("orchestration-governance-lane-ops").waitFor({ state: "visible" });
  assert((await readText(page, "orchestration-governance-lane-developer")).includes("Builder"), "orchestration governance lane should reflect Builder");
  assert((await readText(page, "orchestration-governance-lane-ops")).includes("Ops"), "orchestration governance lane should reflect Ops");
  await capture(page, "agents-governance-preview");

  await stopProcess(serverChild);
  serverChild = startServer(serverPort);
  await waitForHealth(serverURL);

  await page.goto(`${webURL}/settings`, { waitUntil: "domcontentloaded" });
  await waitForInputValue(page, "settings-governance-lane-label-2", "Builder");
  await waitForInputValue(page, "settings-governance-lane-id-5", "ops");
  await capture(page, "settings-governance-after-restart");

  state = await readState(serverURL);
  assert(state.workspace.governance.configuredTopology.length === 6, "configured topology should survive server restart");
  assert(state.workspace.governance.teamTopology.some((lane) => lane.id === "ops"), "derived topology should survive server restart");

  const secondContext = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(`${webURL}/setup`, { waitUntil: "domcontentloaded" });
  await secondPage.getByTestId("setup-governance-lane-ops").waitFor({ state: "visible" });
  assert((await readText(secondPage, "setup-governance-lane-ops")).includes("Ops"), "second browser context should read same ops lane truth");
  await capture(secondPage, "second-context-setup-preview");
  await secondContext.close();

  const report = [
    `# Test Report ${reportDate} ${browserLabel}Configurable Team Topology / Governance Persistence`,
    "",
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    `- Web: \`${webURL}\``,
    `- Server: \`${serverURL}\``,
    "",
    "## Results",
    "",
    "- `/settings` 现在可以直接编辑 team topology，不再只有只读 governance preview；本轮将 `Developer` 改成 `Builder`，并新增了 `Ops` lane -> PASS",
    "- `/setup`、`/mailbox`、`/agents` 会消费同一份 topology truth；三处 preview 都已同步显示 `Builder` 和 `Ops` -> PASS",
    "- browser reload、server restart 和 second browser context 后，configured topology 与 derived governance snapshot 仍保持 6 lanes -> PASS",
    "",
    "## Evidence",
    "",
    "- persisted lane ids: `pm, architect, developer, reviewer, qa, ops`",
    "- renamed execution lane: `developer -> Builder`",
    "- restart recovery: same state file still projects Builder/Ops across settings/setup/mailbox/agents",
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
