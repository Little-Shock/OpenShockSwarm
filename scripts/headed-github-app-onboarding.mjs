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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt04-github-onboarding-")));
const artifactsDir = path.resolve(evidenceRoot);
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const workspaceDir = path.join(artifactsDir, "workspace");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const processes = [];
const screenshots = [];
let browser = null;
let context = null;

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

async function runCommand(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
}

function resolveSpawn(command, args) {
  if (command.endsWith(".sh")) {
    return {
      command: "bash",
      args: [command, ...args],
      printable: `bash ${command} ${args.join(" ")}`.trim(),
    };
  }

  return {
    command,
    args,
    printable: `${command} ${args.join(" ")}`.trim(),
  };
}

function startProcess(name, command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;
  const logPath = path.join(logsDir, `${name}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  const resolved = resolveSpawn(command, args);
  logStream.write(`[${timestamp()}] ${resolved.printable}\n`);

  const child = spawn(resolved.command, resolved.args, {
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

  processes.push({ name, child, logPath });
  return { child, logPath };
}

async function stopProcess(entry) {
  const { child } = entry;
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
    // Process already exited.
  }
}

async function cleanup() {
  if (context) {
    try {
      await context.close();
    } catch {
      // ignore cleanup failure
    }
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore cleanup failure
    }
  }

  await Promise.allSettled(processes.map((entry) => stopProcess(entry)));
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitFor(predicate, message, timeoutMs = 60_000, intervalMs = 500) {
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

async function capture(page, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
  return filePath;
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
      // try the next path
    }
  }

  throw new Error("No executable Chromium binary found. Set OPENSHOCK_CHROMIUM_PATH to continue.");
}

async function prepareWorkspace() {
  await runCommand("git", ["clone", "--shared", projectRoot, workspaceDir]);
  await runCommand("git", ["-C", workspaceDir, "remote", "set-url", "origin", "https://github.com/Larkspur-Wang/OpenShock.git"]);
  await runCommand("git", ["-C", workspaceDir, "checkout", "-B", "main", "HEAD"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.name", "OpenShock Headed E2E"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.email", "openshock-headed-e2e@example.com"]);
}

async function main() {
  const webPort = await freePort();
  const serverPort = await freePort();
  const daemonPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const daemonURL = `http://127.0.0.1:${daemonPort}`;
  const statePath = path.join(workspaceDir, "data", "phase0", "state.json");
  const chromiumExecutable = resolveChromiumExecutable();
  const installURL = "https://github.com/apps/openshock-app/installations/new";

  await prepareWorkspace();

  startProcess(
    "daemon",
    path.join(projectRoot, "scripts", "go.sh"),
    [
      "run",
      "./cmd/openshock-daemon",
      "--workspace-root",
      workspaceDir,
      "--addr",
      `127.0.0.1:${daemonPort}`,
      "--control-url",
      serverURL,
    ],
    {
      cwd: path.join(projectRoot, "apps", "daemon"),
      env: {
        ...process.env,
        OPENSHOCK_DAEMON_HEARTBEAT_INTERVAL: "1s",
        OPENSHOCK_DAEMON_HEARTBEAT_TIMEOUT: "10s",
      },
    }
  );

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_DAEMON_URL: daemonURL,
      OPENSHOCK_WORKSPACE_ROOT: workspaceDir,
      OPENSHOCK_STATE_FILE: statePath,
      OPENSHOCK_GITHUB_APP_ID: "12345",
      OPENSHOCK_GITHUB_APP_SLUG: "openshock-app",
      OPENSHOCK_GITHUB_APP_PRIVATE_KEY: "test-private-key",
      OPENSHOCK_GITHUB_APP_INSTALL_URL: installURL,
    },
  });

  startProcess("web", "pnpm", ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    },
  });

  await waitFor(async () => {
    const response = await fetch(`${daemonURL}/healthz`);
    return response.ok;
  }, `daemon did not become healthy at ${daemonURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`, 120_000);

  await waitFor(async () => {
    const state = await fetchJSON(`${serverURL}/v1/state`);
    return Array.isArray(state.runtimes) && state.runtimes.length > 0;
  }, "runtime heartbeats never appeared in /v1/state");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.locator('[data-testid="setup-github-connection"]').waitFor({ state: "visible" });
  await capture(page, "setup-shell");

  await page.waitForFunction(
    () => {
      const message = document.querySelector('[data-testid="setup-github-message"]')?.textContent?.trim() || "";
      const installLink = document.querySelector('[data-testid="setup-github-install-link"]');
      return message.length > 0 && Boolean(installLink);
    },
    undefined,
    { timeout: 30_000 }
  );

  const githubReadinessStatus = (await page.getByTestId("setup-github-readiness-status").textContent())?.trim() ?? "";
  const githubMessage = (await page.getByTestId("setup-github-message").textContent())?.trim() ?? "";
  const githubMissingFields = (await page.getByTestId("setup-github-missing-fields").textContent())?.trim() ?? "";
  const githubInstallLink = (await page.getByTestId("setup-github-install-link").getAttribute("href"))?.trim() ?? "";
  const githubReturnSteps = (await page.getByTestId("setup-github-return-steps").textContent())?.trim() ?? "";

  assert(
    githubReadinessStatus === "仅本地闭环",
    `expected GitHub readiness status to stay local-only until installation completes, got: ${githubReadinessStatus}`
  );
  assert(githubMessage.includes("installation"), `expected github message to mention installation, got: ${githubMessage}`);
  assert(githubInstallLink === installURL, `expected github install link ${installURL}, got ${githubInstallLink}`);
  await capture(page, "github-app-onboarding");

  const repoBindButtonLabel = (await page.getByTestId("setup-repo-bind-button").textContent())?.trim() ?? "";
  await page.getByTestId("setup-repo-bind-button").click();
  await page.waitForFunction(
    () => {
      const status = document.querySelector('[data-testid="setup-repo-binding-status"]')?.textContent?.trim() || "";
      const error = document.querySelector('[data-testid="setup-repo-binding-error"]')?.textContent?.trim() || "";
      return status.includes("待补安装") || error.length > 0;
    },
    undefined,
    { timeout: 30_000 }
  );

  const repoBindingStatus = (await page.getByTestId("setup-repo-binding-status").textContent())?.trim() ?? "";
  const repoBindingMessage = (await page.getByTestId("setup-repo-binding-message").textContent())?.trim() ?? "";
  const repoBindingError = (await page.getByTestId("setup-repo-binding-error").textContent())?.trim() ?? "";
  const repoBindingMissingFields = (await page.getByTestId("setup-repo-binding-missing-fields").textContent())?.trim() ?? "";
  const repoBindingInstallLink = (await page.getByTestId("setup-repo-binding-install-link").getAttribute("href"))?.trim() ?? "";
  const repoBindingReturnSteps = (await page.getByTestId("setup-repo-binding-return-steps").textContent())?.trim() ?? "";

  assert(repoBindingStatus.includes("待补安装"), `expected repo binding status to be blocked, got: ${repoBindingStatus}`);
  assert(
    repoBindingError.includes("installation") || repoBindingMessage.includes("installation"),
    `expected blocked contract to mention installation, got error=${repoBindingError} message=${repoBindingMessage}`
  );
  assert(repoBindingInstallLink === installURL, `expected repo binding install link ${installURL}, got ${repoBindingInstallLink}`);
  await capture(page, "repo-binding-blocked");

  await context.tracing.stop({ path: path.join(artifactsDir, "trace.zip") });

  const report = `# TKT-04 GitHub App Onboarding Report

Date: ${timestamp()}
Project Root: ${projectRoot}
Workspace Root: ${workspaceDir}
Artifacts Root: ${artifactsDir}
Chromium: ${chromiumExecutable}

## Environment

- Web: ${webURL}
- Server: ${serverURL}
- Daemon: ${daemonURL}
- App Install URL: ${installURL}

## GitHub Setup Checks

- GitHub Readiness Status: ${githubReadinessStatus}
- GitHub Message: ${githubMessage}
- GitHub Missing Fields: ${githubMissingFields}
- GitHub Install Link: ${githubInstallLink}
- GitHub Return Steps: ${githubReturnSteps}
- Repo Bind Button: ${repoBindButtonLabel}
- Repo Binding Status: ${repoBindingStatus}
- Repo Binding Message: ${repoBindingMessage}
- Repo Binding Error: ${repoBindingError}
- Repo Binding Missing Fields: ${repoBindingMissingFields}
- Repo Binding Install Link: ${repoBindingInstallLink}
- Repo Binding Return Steps: ${repoBindingReturnSteps}

## Evidence

${screenshots.map((item) => `- ${item.name}: ${item.path}`).join("\n")}
- trace: ${path.join(artifactsDir, "trace.zip")}
- daemon log: ${path.join(logsDir, "daemon.log")}
- server log: ${path.join(logsDir, "server.log")}
- web log: ${path.join(logsDir, "web.log")}

## Result

- TC-022 GitHub App effective auth setup surface: PASS
- TC-026 Headed Setup onboarding blocked path: PASS
- TKT-04 repo binding blocked contract when installation is pending: PASS
`;

  const metadata = {
    generatedAt: timestamp(),
    projectRoot,
    workspaceDir,
    artifactsDir,
    webURL,
    serverURL,
    daemonURL,
    chromiumExecutable,
    installURL,
    githubReadinessStatus,
    githubMessage,
    githubMissingFields,
    githubInstallLink,
    githubReturnSteps,
    repoBindButtonLabel,
    repoBindingStatus,
    repoBindingMessage,
    repoBindingError,
    repoBindingMissingFields,
    repoBindingInstallLink,
    repoBindingReturnSteps,
    screenshots,
    logs: Object.fromEntries(processes.map((entry) => [entry.name, entry.logPath])),
  };

  await writeFile(path.join(artifactsDir, "report.md"), report);
  await writeFile(path.join(artifactsDir, "metadata.json"), JSON.stringify(metadata, null, 2));

  console.log(report);
  console.log(`Artifacts: ${artifactsDir}`);
}

try {
  await main();
} catch (error) {
  const summary = [
    "# TKT-04 GitHub App Onboarding Failure",
    "",
    `Date: ${timestamp()}`,
    `Artifacts Root: ${artifactsDir}`,
    "",
    "## Error",
    "",
    error instanceof Error ? error.stack || error.message : String(error),
    "",
    "## Logs",
    ...processes.map((entry) => `- ${entry.name}: ${entry.logPath}`),
  ].join("\n");
  await writeFile(path.join(artifactsDir, "report.md"), summary);
  console.error(summary);
  process.exitCode = 1;
} finally {
  await cleanup();
}
