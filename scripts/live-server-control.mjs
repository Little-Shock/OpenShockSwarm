import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cli = parseCli(process.argv.slice(2));
const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspaceRoot = path.resolve(cli.options.workspaceRoot ?? process.env.OPENSHOCK_WORKSPACE_ROOT ?? repoRoot);
const serverAddress = cli.options.serverAddress ?? process.env.OPENSHOCK_SERVER_ADDR ?? ":8080";
const baseUrl = resolveBaseUrl(serverAddress, cli.options.serverUrl ?? process.env.OPENSHOCK_SERVER_URL);
const metadataPath = path.join(workspaceRoot, "data", "ops", "live-server.json");
const logPath = path.join(workspaceRoot, "data", "logs", "openshock-server.log");
const binaryPath = path.join(workspaceRoot, "data", "ops", "bin", "openshock-server-live");
const commands = buildCommands({ repoRoot, workspaceRoot, serverAddress, baseUrl });
const launchCommand = `OPENSHOCK_WORKSPACE_ROOT="${workspaceRoot}" OPENSHOCK_SERVER_ADDR="${serverAddress}" "${binaryPath}"`;

const verb = cli.verb;

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
  const liveService = await probeLiveService();
  const health = await probeJSON(`${baseUrl}/healthz`);
  const state = await probeJSON(`${baseUrl}/v1/state`);
  const routedTruth = liveService.ok ? normalizeLiveServiceTruth(liveService.body) : null;
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

  if (routedTruth) {
    const routedCommands = buildCommands({
      repoRoot: routedTruth.repoRoot || repoRoot,
      workspaceRoot: routedTruth.workspaceRoot || workspaceRoot,
      serverAddress: routedTruth.address || serverAddress,
      baseUrl: routedTruth.baseUrl || baseUrl,
    });
    status.service = routedTruth.service || status.service;
    status.managed = routedTruth.managed;
    status.status = routedTruth.status || (routedTruth.managed ? "running" : "unmanaged_live_service");
    status.message = routedTruth.message || "live service truth was read from the service route";
    status.owner = routedTruth.owner || "";
    status.pid = routedTruth.pid || 0;
    status.workspaceRoot = routedTruth.workspaceRoot || status.workspaceRoot;
    status.repoRoot = routedTruth.repoRoot || status.repoRoot;
    status.address = routedTruth.address || status.address;
    status.baseUrl = routedTruth.baseUrl || status.baseUrl;
    status.healthUrl = routedTruth.healthUrl || status.healthUrl;
    status.stateUrl = routedTruth.stateUrl || status.stateUrl;
    status.metadataPath = routedTruth.metadataPath || status.metadataPath;
    status.logPath = routedTruth.logPath || status.logPath;
    status.branch = routedTruth.branch || "";
    status.head = routedTruth.head || "";
    status.launchCommand = routedTruth.launchCommand || status.launchCommand;
    status.launchedAt = routedTruth.launchedAt || "";
    status.reloadedAt = routedTruth.reloadedAt || "";
    status.stoppedAt = routedTruth.stoppedAt || "";
    status.lastError = routedTruth.lastError || "";
    status.statusCommand = routedTruth.statusCommand || routedCommands.status;
    status.startCommand = routedTruth.startCommand || routedCommands.start;
    status.stopCommand = routedTruth.stopCommand || routedCommands.stop;
    status.reloadCommand = routedTruth.reloadCommand || routedCommands.reload;
    status.processReachable = health.ok || pidAlive(status.pid);
  } else if (metadata) {
    status.status = metadata.status || (status.processReachable ? "running" : "stopped");
    status.message =
      status.status === "running"
        ? "managed live service metadata is present in the requested workspace; use the recorded reload command to roll current code"
        : "managed metadata exists, but the recorded process is not currently reachable";
  } else if (health.ok) {
    status.status = "unmanaged_live_service";
    status.message = "a live service is responding, but no managed owner metadata exists for reload control";
  }

  return status;
}

async function startManagedServer(reload) {
  const existing = await buildStatus();
  assertControlWorkspace(existing, reload ? "reload" : "start");
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
  const existing = await buildStatus();
  assertControlWorkspace(existing, "stop");

  if (!existing.managed) {
    if (silent) {
      return existing;
    }
    throw new Error(`no managed live service metadata at ${existing.metadataPath}`);
  }

  const metadata = readMetadataAt(existing.metadataPath);
  if (!metadata) {
    if (silent) {
      return existing;
    }
    throw new Error(`no managed live service metadata at ${existing.metadataPath}`);
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
  return readMetadataAt(metadataPath);
}

function readMetadataAt(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
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

function buildCommands({ repoRoot, workspaceRoot, serverAddress, baseUrl }) {
  return {
    status: controlCommand("status", { repoRoot, workspaceRoot, serverAddress, baseUrl }),
    start: controlCommand("start", { repoRoot, workspaceRoot, serverAddress, baseUrl }),
    stop: controlCommand("stop", { repoRoot, workspaceRoot, serverAddress, baseUrl }),
    reload: controlCommand("reload", { repoRoot, workspaceRoot, serverAddress, baseUrl }),
  };
}

function controlCommand(action, { repoRoot, workspaceRoot, serverAddress, baseUrl }) {
  return [
    "pnpm",
    "--dir",
    quoteArg(repoRoot),
    `ops:live-server:${action}`,
    "--",
    "--workspace-root",
    quoteArg(workspaceRoot),
    "--server-url",
    quoteArg(baseUrl),
    "--server-addr",
    quoteArg(serverAddress),
  ].join(" ");
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
      body: parsed,
      error: response.ok ? "" : text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      service: "",
      readable: false,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeLiveService() {
  return probeJSON(`${baseUrl}/v1/runtime/live-service`);
}

function normalizeLiveServiceTruth(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return {
    service: readString(payload.service),
    managed: Boolean(payload.managed),
    status: readString(payload.status),
    message: readString(payload.message),
    owner: readString(payload.owner),
    pid: readInteger(payload.pid),
    workspaceRoot: readString(payload.workspaceRoot),
    repoRoot: readString(payload.repoRoot),
    address: readString(payload.address),
    baseUrl: readString(payload.baseUrl),
    healthUrl: readString(payload.healthUrl),
    stateUrl: readString(payload.stateUrl),
    metadataPath: readString(payload.metadataPath),
    logPath: readString(payload.logPath),
    branch: readString(payload.branch),
    head: readString(payload.head),
    launchCommand: readString(payload.launchCommand),
    launchedAt: readString(payload.launchedAt),
    reloadedAt: readString(payload.reloadedAt),
    stoppedAt: readString(payload.stoppedAt),
    lastError: readString(payload.lastError),
    statusCommand: readString(payload.statusCommand),
    startCommand: readString(payload.startCommand),
    stopCommand: readString(payload.stopCommand),
    reloadCommand: readString(payload.reloadCommand),
  };
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

function parseCli(argv) {
  let verb = "status";
  let index = 0;
  if (argv[0] && !argv[0].startsWith("--")) {
    verb = argv[0];
    index = 1;
  }

  const options = {};
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    switch (token) {
      case "--workspace-root":
        options.workspaceRoot = requireValue(token, value);
        index += 2;
        break;
      case "--server-addr":
        options.serverAddress = requireValue(token, value);
        index += 2;
        break;
      case "--server-url":
        options.serverUrl = requireValue(token, value);
        index += 2;
        break;
      default:
        throw new Error(`unsupported argument: ${token}`);
    }
  }

  return { verb, options };
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function quoteArg(value) {
  return JSON.stringify(String(value));
}

function assertControlWorkspace(status, action) {
  if (!status.managed) {
    return;
  }
  if (!status.workspaceRoot || path.resolve(status.workspaceRoot) === workspaceRoot) {
    return;
  }
  throw new Error(
    `refusing to ${action} ${status.baseUrl || baseUrl} from requested workspace ${workspaceRoot}: actual managed service is controlled by ${status.workspaceRoot}; rerun ${status[`${action}Command`] || "the recorded control command"}`,
  );
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(value) {
  return Number.isInteger(value) ? value : 0;
}
