import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspaceRoot = path.resolve(process.env.OPENSHOCK_WORKSPACE_ROOT ?? repoRoot);
const serverAddress = process.env.OPENSHOCK_SERVER_ADDR ?? ":8080";
const baseUrl = resolveBaseUrl(serverAddress, process.env.OPENSHOCK_SERVER_URL);
const metadataPath = path.join(workspaceRoot, "data", "ops", "live-server.json");
const logPath = path.join(workspaceRoot, "data", "logs", "openshock-server.log");
const binaryPath = path.join(workspaceRoot, "data", "ops", "bin", "openshock-server-live");
const commands = {
  status: "pnpm ops:live-server:status",
  start: "pnpm ops:live-server:start",
  stop: "pnpm ops:live-server:stop",
  reload: "pnpm ops:live-server:reload",
};
const launchCommand = `OPENSHOCK_WORKSPACE_ROOT="${workspaceRoot}" OPENSHOCK_SERVER_ADDR="${serverAddress}" "${binaryPath}"`;

const verb = process.argv[2] ?? "status";

try {
  switch (verb) {
    case "status":
      printStatus(await buildStatus());
      break;
    case "start":
      printStatus(await startManagedServer(false));
      break;
    case "stop":
      printStatus(await stopManagedServer());
      break;
    case "reload":
      printStatus(await startManagedServer(true));
      break;
    default:
      throw new Error(`unsupported command: ${verb}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function printStatus(status) {
  console.log(JSON.stringify(status, null, 2));
}

async function buildStatus() {
  const metadata = readMetadata();
  const health = await probeJSON(`${baseUrl}/healthz`);
  const state = await probeJSON(`${baseUrl}/v1/state`);
  const status = {
    service: metadata?.service || "openshock-server",
    managed: Boolean(metadata),
    status: "unmanaged",
    message: "no managed live service metadata found",
    owner: metadata?.owner || "",
    pid: metadata?.pid || 0,
    workspaceRoot,
    repoRoot: metadata?.repoRoot || repoRoot,
    address: metadata?.address || serverAddress,
    baseUrl: metadata?.baseUrl || baseUrl,
    healthUrl: metadata?.healthUrl || `${baseUrl}/healthz`,
    stateUrl: metadata?.stateUrl || `${baseUrl}/v1/state`,
    metadataPath,
    logPath: metadata?.logPath || logPath,
    branch: metadata?.branch || "",
    head: metadata?.head || "",
    launchCommand: metadata?.launchCommand || launchCommand,
    launchedAt: metadata?.launchedAt || "",
    reloadedAt: metadata?.reloadedAt || "",
    stoppedAt: metadata?.stoppedAt || "",
    lastError: metadata?.lastError || "",
    statusCommand: metadata?.statusCommand || commands.status,
    startCommand: metadata?.startCommand || commands.start,
    stopCommand: metadata?.stopCommand || commands.stop,
    reloadCommand: metadata?.reloadCommand || commands.reload,
    processReachable: pidAlive(metadata?.pid),
    health,
    state,
  };

  if (metadata) {
    status.status = metadata.status || (status.processReachable ? "running" : "stopped");
    status.message =
      status.status === "running"
        ? "managed live service metadata is present; use the recorded reload command to roll current code"
        : "managed metadata exists, but the recorded process is not currently reachable";
  } else if (health.ok) {
    status.status = "unmanaged_live_service";
    status.message = "a live service is responding, but no managed owner metadata exists for reload control";
  }

  return status;
}

async function startManagedServer(reload) {
  const existing = await buildStatus();
  if (reload) {
    if (existing.managed) {
      await stopManagedServer(true);
    } else if (existing.health.ok) {
      throw new Error(`refusing to reload ${baseUrl}: service responds but no managed metadata is available`);
    }
  } else if (existing.processReachable || existing.health.ok) {
    if (existing.managed) {
      throw new Error(`managed live service already present at ${baseUrl} (pid ${existing.pid || "unknown"})`);
    }
    throw new Error(`refusing to start ${baseUrl}: address already serves an unmanaged live service`);
  }

  mkdirSync(path.dirname(metadataPath), { recursive: true });
  mkdirSync(path.dirname(logPath), { recursive: true });
  mkdirSync(path.dirname(binaryPath), { recursive: true });
  buildManagedBinary();

  const now = new Date().toISOString();
  const metadata = {
    service: "openshock-server",
    owner: currentOwner(),
    pid: 0,
    workspaceRoot,
    repoRoot,
    address: serverAddress,
    baseUrl,
    healthUrl: `${baseUrl}/healthz`,
    stateUrl: `${baseUrl}/v1/state`,
    logPath,
    branch: safeGit(["branch", "--show-current"]),
    head: safeGit(["rev-parse", "--short", "HEAD"]),
    launchCommand,
    launchedAt: now,
    reloadedAt: reload ? now : "",
    stoppedAt: "",
    status: "starting",
    lastError: "",
    statusCommand: commands.status,
    startCommand: commands.start,
    stopCommand: commands.stop,
    reloadCommand: commands.reload,
  };
  writeMetadata(metadata);

  const logFd = openSync(logPath, "a");
  const child = spawn(binaryPath, [], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_SERVER_ADDR: serverAddress,
    },
  });
  closeSync(logFd);
  child.unref();

  if (!child.pid) {
    metadata.status = "start_failed";
    metadata.lastError = "launcher did not return a pid";
    writeMetadata(metadata);
    throw new Error(metadata.lastError);
  }

  metadata.pid = child.pid;
  metadata.status = "running";
  writeMetadata(metadata);

  try {
    await waitForHealth(child.pid);
  } catch (error) {
    metadata.status = "start_failed";
    metadata.lastError = error instanceof Error ? error.message : String(error);
    writeMetadata(metadata);
    if (pidAlive(child.pid)) {
      process.kill(child.pid, "SIGTERM");
    }
    throw error;
  }

  return buildStatus();
}

async function stopManagedServer(silent = false) {
  const metadata = readMetadata();
  if (!metadata) {
    if (silent) {
      return buildStatus();
    }
    throw new Error(`no managed live service metadata at ${metadataPath}`);
  }

  if (pidAlive(metadata.pid)) {
    process.kill(metadata.pid, "SIGTERM");
    await waitForExit(metadata.pid, 10_000);
    if (pidAlive(metadata.pid)) {
      process.kill(metadata.pid, "SIGKILL");
      await waitForExit(metadata.pid, 5_000);
      if (pidAlive(metadata.pid)) {
        throw new Error(`managed live service pid ${metadata.pid} did not exit after SIGKILL`);
      }
    }
  }

  metadata.status = "stopped";
  metadata.stoppedAt = new Date().toISOString();
  metadata.lastError = "";
  writeMetadata(metadata);
  return buildStatus();
}

function readMetadata() {
  if (!existsSync(metadataPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    return {
      service: "openshock-server",
      status: "metadata_invalid",
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeMetadata(metadata) {
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function currentOwner() {
  return (
    process.env.OPENSHOCK_LIVE_OWNER ||
    process.env.SLOCK_AGENT_NAME ||
    process.env.USER ||
    process.env.USERNAME ||
    os.userInfo().username ||
    "unknown"
  );
}

function safeGit(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function buildManagedBinary() {
  execFileSync(path.join(repoRoot, "scripts", "go.sh"), ["build", "-o", binaryPath, "./apps/server/cmd/openshock-server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
    },
    stdio: "pipe",
  });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForHealth(pid) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (pid && !pidAlive(pid)) {
      throw new Error(`managed live service exited before ${baseUrl}/healthz became ready`);
    }
    const probe = await probeJSON(`${baseUrl}/healthz`);
    if (probe.ok && probe.service === "openshock-server") {
      return;
    }
    await sleep(500);
  }
  throw new Error(`managed live service did not become healthy at ${baseUrl}/healthz within 30s`);
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) {
      return;
    }
    await sleep(250);
  }
}

async function probeJSON(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      service: parsed?.service || "",
      readable: response.ok,
      error: response.ok ? "" : text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      service: "",
      readable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveBaseUrl(address, explicitBaseUrl) {
  const trimmedBase = (explicitBaseUrl || "").trim().replace(/\/+$/, "");
  if (trimmedBase) {
    return trimmedBase;
  }
  const trimmedAddress = (address || "").trim();
  if (!trimmedAddress) {
    return "http://127.0.0.1:8080";
  }
  if (trimmedAddress.startsWith("http://") || trimmedAddress.startsWith("https://")) {
    return trimmedAddress.replace(/\/+$/, "");
  }
  if (trimmedAddress.startsWith(":")) {
    return `http://127.0.0.1${trimmedAddress}`;
  }
  return `http://${trimmedAddress.replace(/^\/+/, "")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
