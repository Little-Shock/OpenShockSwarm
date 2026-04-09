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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-cjk-font-recovery-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  await page.screenshot({ path: filePath });
  screenshots.push({ name, path: filePath });
}

async function waitForText(page, url, expectedText) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitFor(async () => {
    const content = await page.content();
    return content.includes(expectedText);
  }, `${url} did not render expected text: ${expectedText}`);
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

  return { webURL };
}

function normalizeFamily(value) {
  return value
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function containsFamily(family, candidate) {
  return normalizeFamily(family).some((entry) => entry === candidate);
}

async function fontSnapshot(locator, label) {
  const family = await locator.evaluate((node) => getComputedStyle(node).fontFamily);
  return { label, family };
}

let browser;

try {
  const { webURL } = await startServices();
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await waitForText(page, `${webURL}/setup`, "工作区在线状态");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await capture(page, "setup-cjk");

  const bodySnapshot = await fontSnapshot(page.locator("body"), "body");
  const monoSnapshot = await fontSnapshot(page.getByText("工作区在线状态").first(), "工作区在线状态");
  const displaySnapshot = await fontSnapshot(
    page.getByText("Setup 现在直接镜像同一条首次启动路径").first(),
    "Setup 现在直接镜像同一条首次启动路径"
  );

  const rootFontState = await page.evaluate(() => ({
    cjkVar: getComputedStyle(document.documentElement).getPropertyValue("--font-cjk-sans").trim(),
    cjkFaces: Array.from(document.fonts)
      .map((font) => ({ family: font.family, status: font.status }))
      .filter((font) => /Noto[_ ]Sans[_ ]SC/i.test(font.family)),
  }));
  const cjkFamily = normalizeFamily(rootFontState.cjkVar)[0];
  const totalCjkFaces = rootFontState.cjkFaces.length;
  const loadedCjkFaces = rootFontState.cjkFaces.filter((font) => font.status === "loaded").length;

  assert(cjkFamily, "missing --font-cjk-sans runtime value");
  assert(/Noto[_ ]Sans[_ ]SC/i.test(cjkFamily), `unexpected cjk font variable: ${cjkFamily}`);
  assert(loadedCjkFaces > 0, "Noto Sans SC did not load in the page");
  assert(containsFamily(bodySnapshot.family, cjkFamily), `body font chain does not include ${cjkFamily}`);
  assert(containsFamily(monoSnapshot.family, cjkFamily), `mono Chinese label does not include ${cjkFamily}`);
  assert(containsFamily(displaySnapshot.family, cjkFamily), `display Chinese heading does not include ${cjkFamily}`);

  const report = [
    "# 2026-04-09 CJK Font Recovery Report",
    "",
    `- Command: \`pnpm test:headed-cjk-font-recovery -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Result",
    "",
    "- PASS: body, mono label, and display heading all include the bundled `Noto Sans SC` runtime family.",
    "- Adversarial probe: fail immediately if any Chinese surface falls back to a system-only chain without the bundled CJK family.",
    "",
    "## Evidence",
    "",
    `- Runtime \`--font-cjk-sans\`: \`${rootFontState.cjkVar}\``,
    `- Loaded CJK font faces: \`${loadedCjkFaces} / ${totalCjkFaces}\``,
    `- Body family: \`${bodySnapshot.family}\``,
    `- Mono family (\`${monoSnapshot.label}\`): \`${monoSnapshot.family}\``,
    `- Display family (\`${displaySnapshot.label}\`): \`${displaySnapshot.family}\``,
    "",
    "## Screenshots",
    "",
    ...screenshots.map((entry) => `- ${entry.name}: \`${path.relative(projectRoot, entry.path)}\``),
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
  console.log(report);
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  await cleanupProcesses();
}
