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
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt31-runtime-lease-")));
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

async function postExpectConflict(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  assert(response.status === 409, `expected 409 from ${url}, received ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

async function startFakeDaemon(name, workspaceRoot) {
  const port = await freePort();
  const hits = { ensure: 0, exec: 0, conflict: 0 };
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
          providers: [
            {
              id: "provider-codex",
              label: name === "shock-sidecar" ? "Claude Code CLI" : "Codex CLI",
              mode: "local",
              capabilities: ["exec"],
              transport: "http",
            },
          ],
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

    if (req.method === "POST" && req.url === "/v1/exec") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const payload = body ? JSON.parse(body) : {};
        hits.exec += 1;
        if (String(payload.prompt || "").includes("force-conflict")) {
          hits.conflict += 1;
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `runtime lease conflict: ${payload.cwd} is already held by session-other`,
              conflict: {
                leaseId: "session-other",
                runId: "run_other_01",
                sessionId: "session-other",
                roomId: "room-other",
                operation: "exec",
                key: payload.cwd,
                cwd: payload.cwd,
                acquiredAt: new Date().toISOString(),
              },
            })
          );
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            provider: payload.provider || "codex",
            output: `${name} exec ok`,
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

  return { webURL, serverURL, workspaceRoot };
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

    const failoverIssue = await postJSON(`${serverURL}/v1/issues`, {
      title: "Offline Failover Lane",
      summary: "verify scheduler picks the least-loaded spare during offline failover",
      owner: "Codex Dockmaster",
      priority: "critical",
    });

    state = await fetchJSON(`${serverURL}/v1/state`);
    const failoverRun = state.runs.find((run) => run.id === failoverIssue.runId);
    assert(failoverRun?.runtime === "shock-spare", `expected failover run on shock-spare, received ${JSON.stringify(failoverRun)}`);

    const conflictPayload = await postExpectConflict(`${serverURL}/v1/rooms/${failoverIssue.roomId}/messages`, {
      provider: "codex",
      prompt: "force-conflict",
    });
    const blockedRun = conflictPayload.state.runs.find((run) => run.id === failoverIssue.runId);
    assert(blockedRun?.status === "blocked", `expected blocked run after conflict, received ${JSON.stringify(blockedRun)}`);
    assert(
      blockedRun?.controlNote?.includes("session-other"),
      `expected control note to mention session-other, received ${blockedRun?.controlNote || "<missing>"}`
    );

    browser = await launchChromiumSession(chromium);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });

    await page.goto(`${webURL}/setup`, { waitUntil: "load" });
    await waitForPageText(page, "自动 Failover");
    await waitForPageText(page, "shock-spare");
    await page.waitForSelector('[data-testid="setup-runtime-lease-recovery"]', { timeout: 30_000 });
    await waitForPageText(page, "session-other");
    await capture(page, screenshotsDir, "setup-lease-recovery");

    await page.goto(`${webURL}/agents`, { waitUntil: "load" });
    await waitForPageText(page, "runtime lease 冲突");
    await waitForPageText(page, "recovery:");
    await waitForPageText(page, "session-other");
    await capture(page, screenshotsDir, "agents-lease-recovery");

    await page.goto(`${webURL}/runs/${failoverIssue.runId}`, { waitUntil: "load" });
    await waitForPageText(page, "当前控制说明");
    await waitForPageText(page, "session-other");
    await waitForPageText(page, "shock-spare / Codex CLI");
    await capture(page, screenshotsDir, "run-lease-recovery");

    const report = `# Test Report 2026-04-09 Runtime Lease Conflict / Scheduler Hardening

- Harness: \`pnpm test:headed-runtime-lease-conflict-recovery -- --report ${path.relative(projectRoot, reportPath)}\`
- Scope: \`TKT-31 / CHK-14 / CHK-15 / TC-020 / TC-021\`
- Result: \`PASS\`

## Environment

- server URL: \`${serverURL}\`
- web URL: \`${webURL}\`
- runtimes:
  - selected runtime: \`shock-main\`
  - pressured runtime: \`shock-sidecar\`
  - failover runtime: \`shock-spare\`

## Assertions

1. Scheduler failover remains stable under lease pressure
   - owner \`Claude Review Runner\` first created a lane on \`shock-sidecar\`
   - after forcing \`shock-main\` stale, \`/setup\` switched scheduler strategy to \`自动 Failover\`
   - next lane truth pointed to \`shock-spare\`
2. Runtime lease conflict now writes recovery truth into live state
   - posting \`force-conflict\` to room \`${failoverIssue.roomId}\` returned 409 with lease holder \`session-other\`
   - blocked run \`${failoverIssue.runId}\` carried control-note recovery guidance instead of only generic blocked text
3. \`/setup\` and \`/agents\` both surface the current decision reason
   - browser \`/setup\` rendered the runtime lease recovery panel and recovery note
   - browser \`/agents\` rendered the blocked session summary plus \`recovery:\` line with the same holder-aware note
   - run detail showed \`当前控制说明\` with the same lease recovery guidance

## Daemon Evidence

- main ensure hits: ${mainDaemon.hits.ensure}
- sidecar ensure hits: ${sidecarDaemon.hits.ensure}
- spare ensure hits: ${spareDaemon.hits.ensure}
- spare exec hits: ${spareDaemon.hits.exec}
- spare conflict hits: ${spareDaemon.hits.conflict}

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
