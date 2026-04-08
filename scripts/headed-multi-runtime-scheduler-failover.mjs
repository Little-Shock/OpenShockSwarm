#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream } from "node:fs";
import http from "node:http";
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
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt14-runtime-scheduler-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");

const screenshots = [];
const processes = [];
const daemonServers = [];

await mkdir(artifactsDir, { recursive: true });

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

async function cleanupDaemons() {
  await Promise.allSettled(
    daemonServers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => resolve(undefined));
        })
    )
  );
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

async function capture(page, screenshotsDir, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function fetchJSON(url, init) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function postJSON(url, payload) {
  return fetchJSON(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function startFakeDaemon(name, workspaceRoot) {
  const port = await freePort();
  const hits = { ensure: 0 };
  const reportedAt = () => new Date().toISOString();

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }

    if (req.method === "GET" && req.url === "/v1/runtime") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          runtimeId: name,
          daemonUrl: `http://127.0.0.1:${port}`,
          machine: name,
          detectedCli: name === "shock-sidecar" ? ["claude"] : ["codex"],
          providers: [{ id: "provider-codex", label: name === "shock-sidecar" ? "Claude Code CLI" : "Codex CLI", mode: "local", capabilities: ["exec"], transport: "http" }],
          state: "online",
          workspaceRoot,
          reportedAt: reportedAt(),
          heartbeatIntervalSeconds: 10,
          heartbeatTimeoutSeconds: 45,
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/v1/worktrees/ensure") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const payload = body ? JSON.parse(body) : {};
        hits.ensure += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            workspaceRoot: payload.workspaceRoot,
            branch: payload.branch,
            worktreeName: payload.worktreeName,
            path: path.join(payload.workspaceRoot || workspaceRoot, ".openshock-worktrees", name, payload.worktreeName),
            created: true,
            baseRef: payload.baseRef,
          })
        );
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  daemonServers.push(server);
  return { name, url: `http://127.0.0.1:${port}`, hits };
}

async function startServices(runDir) {
  const logsDir = path.join(runDir, "logs");
  const workspaceRoot = path.join(runDir, "workspace");
  const statePath = path.join(runDir, "state.json");
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;

  await mkdir(logsDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
    },
    logPath: path.join(logsDir, "server.log"),
  });

  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
      logPath: path.join(logsDir, "web.log"),
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

  return { webURL, serverURL, workspaceRoot, logsDir };
}

async function waitForPageText(page, expected) {
  await page.waitForFunction(
    (text) => document.body.textContent?.includes(text) ?? false,
    expected,
    { timeout: 30_000 }
  );
}

async function main() {
  const runDir = path.join(artifactsDir, "run");
  const screenshotsDir = path.join(artifactsDir, "screenshots");
  await mkdir(runDir, { recursive: true });
  await mkdir(screenshotsDir, { recursive: true });

  const { webURL, serverURL, workspaceRoot } = await startServices(runDir);
  const mainDaemon = await startFakeDaemon("shock-main", workspaceRoot);
  const sidecarDaemon = await startFakeDaemon("shock-sidecar", workspaceRoot);
  const spareDaemon = await startFakeDaemon("shock-spare", workspaceRoot);

  let browser;
  try {
    await postJSON(`${serverURL}/v1/runtime/pairing`, {
      daemonUrl: mainDaemon.url,
      runtimeId: "shock-main",
    });

    for (const daemon of [sidecarDaemon, spareDaemon]) {
      await postJSON(`${serverURL}/v1/runtime/heartbeats`, {
        runtimeId: daemon.name,
        daemonUrl: daemon.url,
        machine: daemon.name,
        state: "online",
        reportedAt: new Date().toISOString(),
        heartbeatIntervalSeconds: 10,
        heartbeatTimeoutSeconds: 45,
      });
    }

    const sidecarIssue = await postJSON(`${serverURL}/v1/issues`, {
      title: "Sidecar Preference Lane",
      summary: "occupy sidecar so failover can pick the least-loaded spare",
      owner: "Claude Review Runner",
      priority: "high",
    });

    let state = await fetchJSON(`${serverURL}/v1/state`);
    const sidecarRun = state.runs.find((run) => run.id === sidecarIssue.runId);
    assert(sidecarRun?.runtime === "shock-sidecar", `expected sidecar preference run on shock-sidecar, received ${JSON.stringify(sidecarRun)}`);

    await postJSON(`${serverURL}/v1/runtime/heartbeats`, {
      runtimeId: "shock-main",
      daemonUrl: mainDaemon.url,
      machine: "shock-main",
      state: "online",
      reportedAt: new Date(Date.now() - 120_000).toISOString(),
      heartbeatIntervalSeconds: 10,
      heartbeatTimeoutSeconds: 45,
    });

    state = await fetchJSON(`${serverURL}/v1/state`);
    assert(state.runtimeScheduler?.strategy === "failover", `expected runtimeScheduler.strategy=failover, received ${JSON.stringify(state.runtimeScheduler)}`);
    assert(
      state.runtimeScheduler?.assignedRuntime === "shock-spare",
      `expected runtimeScheduler.assignedRuntime=shock-spare, received ${JSON.stringify(state.runtimeScheduler)}`
    );

    browser = await chromium.launch({
      executablePath: resolveChromiumExecutable(),
      headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });

    await page.goto(`${webURL}/runs/${sidecarIssue.runId}`, { waitUntil: "load" });
    await waitForPageText(page, "shock-sidecar / Claude Code CLI");
    await capture(page, screenshotsDir, "run-sidecar-preference");

    await page.goto(`${webURL}/setup`, { waitUntil: "load" });
    await waitForPageText(page, "自动 Failover");
    await waitForPageText(page, "shock-spare");
    await waitForPageText(page, "active leases");
    await capture(page, screenshotsDir, "setup-failover-preview");

    const failoverIssue = await postJSON(`${serverURL}/v1/issues`, {
      title: "Offline Failover Lane",
      summary: "verify scheduler picks the least-loaded spare during offline failover",
      owner: "Codex Dockmaster",
      priority: "critical",
    });

    state = await fetchJSON(`${serverURL}/v1/state`);
    const failoverRun = state.runs.find((run) => run.id === failoverIssue.runId);
    assert(failoverRun?.runtime === "shock-spare", `expected failover run on shock-spare, received ${JSON.stringify(failoverRun)}`);
    assert(
      failoverRun?.nextAction?.includes("failover"),
      `expected failover nextAction wording, received ${failoverRun?.nextAction || "<missing>"}`
    );

    await page.goto(`${webURL}/runs/${failoverIssue.runId}`, { waitUntil: "load" });
    await waitForPageText(page, "shock-spare / Codex CLI");
    await waitForPageText(page, "Runtime 已 failover 到 shock-spare");
    await waitForPageText(page, "failover");
    await capture(page, screenshotsDir, "run-failover-detail");

    const report = `# Test Report 2026-04-07 Multi-runtime Scheduler Failover

- Harness: \`pnpm test:headed-multi-runtime-scheduler-failover -- --report ${path.relative(projectRoot, reportPath)}\`
- Scope: \`TKT-14 / CHK-14 / TC-020\`
- Result: \`PASS\`

## Environment

- server URL: \`${serverURL}\`
- web URL: \`${webURL}\`
- runtimes:
  - selected runtime: \`shock-main\`
  - secondary runtime: \`shock-sidecar\`
  - spare runtime: \`shock-spare\`

## Assertions

1. Scheduler preference / lease pressure
   - owner \`Claude Review Runner\` first created a lane on \`shock-sidecar\`
   - browser \`/runs/${sidecarIssue.runId}\` rendered \`shock-sidecar / Claude Code CLI\`
2. Offline failover preview
   - after marking \`shock-main\` stale/offline, \`/setup\` switched strategy to \`自动 Failover\`
   - live scheduler summary pointed next lane to \`shock-spare\`
3. Failover execution truth
   - owner \`Codex Dockmaster\` next created a lane on \`shock-spare\`
   - browser \`/runs/${failoverIssue.runId}\` rendered \`shock-spare / Codex CLI\`
   - run detail timeline included \`Runtime 已 failover 到 shock-spare\`

## Daemon Routing Evidence

- main ensure hits: ${mainDaemon.hits.ensure}
- sidecar ensure hits: ${sidecarDaemon.hits.ensure}
- spare ensure hits: ${spareDaemon.hits.ensure}

## Screenshots

${screenshots.map((shot) => `- ${shot.name}: \`${shot.path}\``).join("\n")}
`;

    await writeFile(reportPath, report, "utf8");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

try {
  await main();
} finally {
  await cleanupDaemons();
  await cleanupProcesses();
}
