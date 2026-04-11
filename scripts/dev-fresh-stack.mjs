#!/usr/bin/env node

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const stackRoot = path.join(repoRoot, "data", "dev", "fresh-stack");
const logsDir = path.join(stackRoot, "logs");
const workspaceRoot = process.env.OPENSHOCK_FRESH_WORKSPACE_ROOT?.trim()
  ? path.resolve(process.env.OPENSHOCK_FRESH_WORKSPACE_ROOT.trim())
  : repoRoot;
const statePath = path.join(stackRoot, "state.json");
const metadataPath = path.join(stackRoot, "stack.json");
const webDistDirRelative = ".next-fresh-stack";
const webDistDir = path.join(repoRoot, "apps", "web", webDistDirRelative);

const action = process.argv[2] ?? "start";
const noOpen = process.argv.includes("--no-open");

switch (action) {
  case "start":
    await startFreshStack({ openBrowser: !noOpen });
    break;
  case "stop":
    await stopFreshStack(true);
    break;
  case "status":
    await printFreshStackStatus();
    break;
  default:
    console.error(`Unknown action: ${action}`);
    console.error("Usage: node ./scripts/dev-fresh-stack.mjs <start|stop|status> [--no-open]");
    process.exitCode = 1;
}

async function startFreshStack({ openBrowser }) {
  await stopFreshStack(false);
  await rm(stackRoot, { recursive: true, force: true });
  await rm(webDistDir, { recursive: true, force: true });
  await mkdir(logsDir, { recursive: true });
  if (workspaceRoot !== repoRoot) {
    await mkdir(workspaceRoot, { recursive: true });
  }
  await mkdir(webDistDir, { recursive: true });

  const ports = {
    web: await resolvePort(3000),
    server: await resolvePort(8080),
    daemon: await resolvePort(8090),
  };
  const urls = {
    web: `http://127.0.0.1:${ports.web}`,
    onboarding: `http://127.0.0.1:${ports.web}/onboarding`,
    chat: `http://127.0.0.1:${ports.web}/chat/all`,
    setup: `http://127.0.0.1:${ports.web}/setup`,
    server: `http://127.0.0.1:${ports.server}`,
    daemon: `http://127.0.0.1:${ports.daemon}`,
  };

  const server = spawnLoggedProcess(
    "server",
    path.join(repoRoot, "scripts", "go.sh"),
    ["run", "./cmd/openshock-server"],
    {
      cwd: path.join(repoRoot, "apps", "server"),
      env: {
        ...process.env,
        OPENSHOCK_SERVER_ADDR: `127.0.0.1:${ports.server}`,
        OPENSHOCK_DAEMON_URL: urls.daemon,
        OPENSHOCK_ACTUAL_LIVE_URL: urls.server,
        OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
        OPENSHOCK_STATE_FILE: statePath,
        OPENSHOCK_BOOTSTRAP_MODE: "fresh",
      },
    }
  );

  const daemon = spawnLoggedProcess(
    "daemon",
    path.join(repoRoot, "scripts", "go.sh"),
    [
      "run",
      "./cmd/openshock-daemon",
      "--workspace-root",
      workspaceRoot,
      "--addr",
      `127.0.0.1:${ports.daemon}`,
      "--control-url",
      urls.server,
      "--machine-name",
      "shock-main",
    ],
    {
      cwd: path.join(repoRoot, "apps", "daemon"),
      env: {
        ...process.env,
        OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      },
    }
  );

  const web = spawnLoggedProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(ports.web)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENSHOCK_CONTROL_API_BASE: urls.server,
        OPENSHOCK_NEXT_DIST_DIR: webDistDirRelative,
      },
    }
  );

  const metadata = {
    startedAt: new Date().toISOString(),
    status: "starting",
    workspaceRoot,
    statePath,
    webDistDir,
    urls,
    processes: {
      server,
      daemon,
      web,
    },
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  try {
    await waitForURL(`${urls.server}/healthz`, (response, body) => response.ok && body.includes("ok"));
    await waitForURL(urls.onboarding, (response, body) => response.ok && body.includes("data-testid=\"onboarding-overlay\""));
  } catch (error) {
    await stopFreshStack(false, { server, daemon, web });
    throw error;
  }

  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        ...metadata,
        status: "ready",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (openBrowser) {
    await openInBrowser(urls.onboarding);
  }

  console.log("OpenShock fresh stack is ready.");
  console.log(`Entry: ${urls.onboarding}`);
  console.log(`Chat: ${urls.chat}`);
  console.log(`Setup: ${urls.setup}`);
  console.log(`Workspace root: ${workspaceRoot}`);
  console.log(`State file: ${statePath}`);
}

async function stopFreshStack(verbose, overrideProcesses) {
  const metadata = overrideProcesses ? null : await readMetadata();
  const processes = overrideProcesses ?? metadata?.processes ?? {};

  const entries = Object.entries(processes).filter(([, value]) => value?.pid);
  for (const [, value] of entries) {
    await stopProcessGroup(value.pid);
  }

  if (!overrideProcesses) {
    await rm(metadataPath, { force: true });
    if (verbose) {
      console.log(entries.length > 0 ? "OpenShock fresh stack stopped." : "No managed fresh stack was running.");
    }
  }
}

async function printFreshStackStatus() {
  const metadata = await readMetadata();
  if (!metadata) {
    console.log("OpenShock fresh stack is not running.");
    return;
  }

  const lines = [
    "OpenShock fresh stack status",
    `Status: ${metadata.status ?? "unknown"}`,
    `Started at: ${metadata.startedAt}`,
    `Entry URL: ${metadata.urls.onboarding ?? metadata.urls.chat ?? metadata.urls.setup}`,
    `Chat URL: ${metadata.urls.chat}`,
    `Setup URL: ${metadata.urls.setup}`,
    `Workspace root: ${metadata.workspaceRoot}`,
    `State file: ${metadata.statePath}`,
    `Web dist dir: ${metadata.webDistDir ?? "-"}`,
  ];

  for (const [name, processInfo] of Object.entries(metadata.processes ?? {})) {
    const live = processInfo?.pid ? isPidRunning(processInfo.pid) : false;
    lines.push(`${name}: pid=${processInfo?.pid ?? "unknown"} ${live ? "running" : "stopped"} log=${processInfo?.logPath ?? "-"}`);
  }

  console.log(lines.join("\n"));
}

function spawnLoggedProcess(name, command, args, options) {
  const logPath = path.join(logsDir, `${name}.log`);
  const logFd = openSync(logPath, "a");
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();

  if (!child.pid) {
    throw new Error(`failed to start ${name}`);
  }

  return {
    pid: child.pid,
    logPath,
  };
}

async function stopProcessGroup(pid) {
  if (!pid || !isPidRunning(pid)) {
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (!isPidRunning(pid)) {
      return;
    }
    await delay(250);
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
  }
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForURL(url, predicate, timeoutMs = 120_000, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (predicate(response, body)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  if (lastError instanceof Error) {
    throw new Error(`${url} did not become ready: ${lastError.message}`);
  }
  throw new Error(`${url} did not become ready`);
}

async function resolvePort(preferredPort) {
  if (await portAvailable(preferredPort)) {
    return preferredPort;
  }
  return freePort();
}

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function openInBrowser(url) {
  try {
    if (process.env.WSL_DISTRO_NAME) {
      for (const candidate of ["/mnt/c/Windows/System32/cmd.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"]) {
        try {
          const args = candidate.endsWith("powershell.exe")
            ? ["-NoProfile", "-Command", "Start-Process", url]
            : ["/C", "start", "", url];
          const child = spawn(candidate, args, {
            detached: true,
            stdio: "ignore",
          });
          child.on("error", () => {});
          child.unref();
          return;
        } catch {
          // try next Windows launcher
        }
      }
    }
  } catch {
    // fall through
  }

  try {
    const child = spawn("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // ignore browser launch failure
  }
}

async function readMetadata() {
  try {
    const body = await readFile(metadataPath, "utf8");
    return JSON.parse(body);
  } catch {
    return null;
  }
}
