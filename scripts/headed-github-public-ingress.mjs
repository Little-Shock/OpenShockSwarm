#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { accessSync, constants as fsConstants, createWriteStream } from "node:fs";
import { createServer as createHTTPServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const webhookFixtureDir = path.join(projectRoot, "scripts", "fixtures", "github-webhook-replay");
const reportArg = readArg("--report");
const reportPath = reportArg ? path.resolve(process.cwd(), reportArg) : "";
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt57-github-public-ingress-")));
const artifactsDir = path.resolve(evidenceRoot);
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const workspacesDir = path.join(artifactsDir, "workspaces");
const secret = "super-secret";
const processes = [];
const ingressServers = [];
const screenshots = [];

let browser = null;
let context = null;

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(workspacesDir, { recursive: true });

function timestamp() {
  return new Date().toISOString();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return "";
  }
  return process.argv[index + 1];
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate port")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function runCommand(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env, logName = "" } = options;
  return await new Promise((resolve, reject) => {
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
    child.on("close", async (code) => {
      if (logName) {
        const logPath = path.join(logsDir, logName);
        await writeFile(logPath, `[${timestamp()}] ${command} ${args.join(" ")}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`, "utf8");
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
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

  const entry = { name, child, logPath };
  processes.push(entry);
  return entry;
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
    // already exited
  }
}

async function closeIngress(entry) {
  await new Promise((resolve) => {
    entry.server.close(() => resolve());
  });
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

  await Promise.allSettled(ingressServers.map((entry) => closeIngress(entry)));
  await Promise.allSettled(processes.map((entry) => stopProcess(entry)));
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
      // try next path
    }
  }

  throw new Error("No executable Chromium binary found. Set OPENSHOCK_CHROMIUM_PATH to continue.");
}

async function prepareWorkspace(name) {
  const workspaceDir = path.join(workspacesDir, name);
  await runCommand("git", ["clone", "--shared", projectRoot, workspaceDir]);
  await runCommand("git", ["-C", workspaceDir, "remote", "set-url", "origin", "https://github.com/Larkspur-Wang/OpenShock.git"]);
  await runCommand("git", ["-C", workspaceDir, "checkout", "-B", "main", "HEAD"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.name", "OpenShock Public Ingress Harness"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.email", "openshock-public-ingress@example.com"]);
  return workspaceDir;
}

function ownerPermissions() {
  return [
    "workspace.manage",
    "members.manage",
    "repo.admin",
    "runtime.manage",
    "issue.create",
    "room.reply",
    "run.execute",
    "inbox.review",
    "inbox.decide",
    "memory.read",
    "memory.write",
    "pull_request.read",
    "pull_request.review",
    "pull_request.merge",
  ];
}

function createCallbackState(now) {
  return {
    workspace: {
      name: "OpenShock",
      repo: "",
      repoUrl: "",
      branch: "",
      repoProvider: "",
      repoBindingStatus: "",
      repoAuthMode: "",
      plan: "",
      quota: {
        usedMachines: 0,
        maxMachines: 0,
        usedAgents: 0,
        maxAgents: 0,
        usedChannels: 0,
        maxChannels: 0,
        usedRooms: 0,
        maxRooms: 0,
        messageHistoryDays: 0,
        runLogDays: 0,
        memoryDraftDays: 0,
        status: "",
        warning: "",
      },
      usage: {
        windowLabel: "",
        totalTokens: 0,
        runCount: 0,
        messageCount: 0,
        refreshedAt: now,
        warning: "",
      },
      pairedRuntime: "",
      pairedRuntimeUrl: "",
      pairingStatus: "",
      deviceAuth: "",
      lastPairedAt: "",
      browserPush: "",
      memoryMode: "",
      repoBinding: {
        repo: "",
        repoUrl: "",
        branch: "",
        provider: "",
        bindingStatus: "",
        authMode: "",
      },
      githubInstallation: {
        provider: "",
        preferredAuthMode: "",
        connectionReady: false,
        appConfigured: false,
        appInstalled: false,
        installationId: "",
        installationUrl: "",
        missing: [],
        connectionMessage: "",
        syncedAt: "",
      },
      onboarding: {
        status: "",
        templateId: "",
        currentStep: "",
        completedSteps: [],
        resumeUrl: "",
        materialization: {
          label: "",
          channels: [],
          roles: [],
          agents: [],
          notificationPolicy: "",
          notes: [],
        },
        updatedAt: now,
      },
    },
    channels: [],
    channelMessages: {},
    directMessages: [],
    directMessageMessages: {},
    followedThreads: [],
    savedLaterItems: [],
    quickSearchEntries: [],
    issues: [],
    rooms: [],
    roomMessages: {},
    runs: [],
    agents: [],
    machines: [],
    runtimes: [],
    inbox: [],
    pullRequests: [],
    sessions: [],
    runtimeLeases: [],
    runtimeScheduler: {
      selectedRuntime: "",
      preferredRuntime: "",
      assignedRuntime: "",
      assignedMachine: "",
      strategy: "",
      failoverFrom: "",
      summary: "",
      candidates: [],
    },
    guards: [],
    auth: {
      session: {
        id: "auth-session-current",
        memberId: "member-larkspur",
        email: "larkspur@openshock.dev",
        name: "Larkspur",
        role: "owner",
        status: "active",
        authMethod: "email-link",
        signedInAt: now,
        lastSeenAt: now,
        deviceId: "device-member-larkspur-owner-browser",
        deviceLabel: "Owner Browser",
        deviceAuthStatus: "authorized",
        emailVerificationStatus: "verified",
        emailVerifiedAt: now,
        passwordResetStatus: "idle",
        recoveryStatus: "ready",
        githubIdentity: {},
        preferences: {},
        linkedIdentities: [],
        permissions: ownerPermissions(),
      },
      roles: [
        {
          id: "owner",
          label: "Owner",
          summary: "Workspace owner",
          permissions: ownerPermissions(),
        },
      ],
      members: [
        {
          id: "member-larkspur",
          email: "larkspur@openshock.dev",
          name: "Larkspur",
          role: "owner",
          status: "active",
          source: "seed",
          addedAt: now,
          lastSeenAt: now,
          recoveryEmail: "larkspur@openshock.dev",
          emailVerificationStatus: "verified",
          emailVerifiedAt: now,
          passwordResetStatus: "idle",
          recoveryStatus: "ready",
          githubIdentity: {},
          preferences: {},
          linkedIdentities: [],
          trustedDeviceIds: ["device-member-larkspur-owner-browser"],
          permissions: ownerPermissions(),
        },
      ],
      devices: [
        {
          id: "device-member-larkspur-owner-browser",
          memberId: "member-larkspur",
          label: "Owner Browser",
          status: "authorized",
          requestedAt: now,
          authorizedAt: now,
          lastSeenAt: now,
        },
      ],
    },
    memory: [],
    memoryVersions: {},
  };
}

async function startIngress(name, port, webURL, serverURL) {
  const logPath = path.join(logsDir, `${name}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  const server = createHTTPServer(async (req, res) => {
    const requestURL = req.url || "/";
    const targetBase =
      requestURL.startsWith("/v1/") || requestURL === "/healthz" ? serverURL : webURL;
    const targetURL = new URL(requestURL, targetBase);

    try {
      const body = await readRequestBody(req);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) {
          continue;
        }
        const normalized = key.toLowerCase();
        if (normalized === "host" || normalized === "connection" || normalized === "content-length") {
          continue;
        }
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      logStream.write(`[${timestamp()}] ${req.method} ${requestURL} -> ${targetURL}\n`);

      const response = await fetch(targetURL, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
        redirect: "manual",
      });

      const responseHeaders = {};
      for (const [key, value] of response.headers.entries()) {
        const normalized = key.toLowerCase();
        if (
          normalized === "connection" ||
          normalized === "transfer-encoding" ||
          normalized === "content-length" ||
          normalized === "content-encoding" ||
          normalized === "keep-alive"
        ) {
          continue;
        }
        responseHeaders[key] = value;
      }
      res.writeHead(response.status, responseHeaders);
      const responseBody = Buffer.from(await response.arrayBuffer());
      res.end(responseBody);
    } catch (error) {
      logStream.write(`[${timestamp()}] proxy error: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "public ingress proxy failed" }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  ingressServers.push({ server, logPath });
  return { server, logPath };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchJSON(url, init = {}) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function signBody(body, signingSecret) {
  return `sha256=${createHmac("sha256", signingSecret).update(body).digest("hex")}`;
}

function findPullRequest(state, number) {
  return (state.pullRequests ?? []).find((item) => item.number === number);
}

async function runCallbackPhase(chromiumExecutable) {
  const workspaceDir = await prepareWorkspace("callback-phase");
  const statePath = path.join(workspaceDir, "data", "phase0", "state.json");
  const daemonPort = await freePort();
  const serverPort = await freePort();
  const webPort = await freePort();
  const ingressPort = await freePort();
  const daemonURL = `http://127.0.0.1:${daemonPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const webURL = `http://127.0.0.1:${webPort}`;
  const ingressURL = `http://127.0.0.1:${ingressPort}`;
  const installURL = "https://github.com/apps/openshock-app/installations/new";
  const now = timestamp();

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(createCallbackState(now), null, 2)}\n`, "utf8");

  const buildLog = await runCommand("pnpm", ["--dir", "apps/web", "build"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: ingressURL,
    },
    logName: "callback-web-build.log",
  });

  startProcess(
    "callback-daemon",
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

  startProcess("callback-server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_DAEMON_URL: daemonURL,
      OPENSHOCK_CONTROL_URL: ingressURL,
      OPENSHOCK_WORKSPACE_ROOT: workspaceDir,
      OPENSHOCK_STATE_FILE: statePath,
      OPENSHOCK_GITHUB_APP_ID: "12345",
      OPENSHOCK_GITHUB_APP_SLUG: "openshock-app",
      OPENSHOCK_GITHUB_APP_PRIVATE_KEY: "test-private-key",
      OPENSHOCK_GITHUB_APP_INSTALL_URL: installURL,
      OPENSHOCK_GITHUB_WEBHOOK_SECRET: secret,
    },
  });

  startProcess("callback-web", "pnpm", ["--dir", "apps/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_OPENSHOCK_API_BASE: ingressURL,
    },
  });

  await startIngress("callback-ingress", ingressPort, webURL, serverURL);

  await waitFor(async () => {
    const response = await fetch(`${daemonURL}/healthz`);
    return response.ok;
  }, `callback daemon did not become healthy at ${daemonURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `callback server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${ingressURL}/setup`);
    return response.ok;
  }, `callback ingress did not become ready at ${ingressURL}/setup`);

  const initialConnection = await fetchJSON(`${ingressURL}/v1/github/connection`);
  assert(initialConnection.callbackUrl === `${ingressURL}/setup/github/callback`, `initial callback URL mismatch: ${initialConnection.callbackUrl}`);
  assert(initialConnection.webhookUrl === `${ingressURL}/v1/github/webhook`, `initial webhook URL mismatch: ${initialConnection.webhookUrl}`);
  assert(initialConnection.ready === false, "initial connection should stay local-only until callback lands");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });

  const page = await context.newPage();
  await page.goto(`${ingressURL}/setup`, { waitUntil: "load" });
  await page.getByText("展开仓库与远端").click();
  await page.locator('[data-testid="setup-github-connection"]:visible').waitFor({ state: "visible" });
  await page.getByText("查看回流地址").click();
  await page.locator('[data-testid="setup-github-callback-link"]:visible').waitFor({ state: "visible" });
  await page.locator('[data-testid="setup-github-webhook-url"]:visible').waitFor({ state: "visible" });

  const readinessBefore = (await page.getByTestId("setup-github-readiness-status").textContent())?.trim() ?? "";
  const messageBefore = (await page.getByTestId("setup-github-message").textContent())?.trim() ?? "";
  const callbackLink = (await page.getByTestId("setup-github-callback-link").getAttribute("href"))?.trim() ?? "";
  const webhookURL = (await page.getByTestId("setup-github-webhook-url").textContent())?.trim() ?? "";

  assert(readinessBefore === "未完成", `expected local-only readiness before callback, got ${readinessBefore}`);
  assert(callbackLink === `${ingressURL}/setup/github/callback`, `callback link mismatch: ${callbackLink}`);
  assert(webhookURL === `${ingressURL}/v1/github/webhook`, `webhook URL mismatch: ${webhookURL}`);
  await capture(page, "callback-setup-before");

  await page.goto(`${callbackLink}?installation_id=67890&setup_action=install`, { waitUntil: "load" });
  await page.getByRole("heading", { level: 2 }).waitFor({ state: "visible" });
  await page.waitForFunction(() => document.body.textContent?.includes("GitHub 安装回跳已接住") ?? false, undefined, {
    timeout: 30_000,
  });
  const callbackHeading = (await page.getByRole("heading", { level: 2 }).textContent())?.trim() ?? "";
  const callbackBody = (await page.textContent("body"))?.trim() ?? "";
  assert(callbackHeading === "GitHub 安装回跳已接住", `callback heading mismatch: ${callbackHeading}`);
  assert(callbackBody.includes("GitHub 已连接"), `callback success body missing ready text: ${callbackBody}`);
  await capture(page, "callback-success");

  await page.waitForURL(`${ingressURL}/setup?github_installation=connected`, { timeout: 30_000 });
  await page.getByText("展开仓库与远端").click();
  await page.locator('[data-testid="setup-github-connection"]:visible').waitFor({ state: "visible" });
  await page.locator('[data-testid="setup-github-readiness-status"]:visible').waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="setup-github-readiness-status"]:not([hidden])')?.textContent?.trim() === "已连接",
    undefined,
    { timeout: 30_000 },
  );
  const readinessAfter = (await page.locator('[data-testid="setup-github-readiness-status"]:visible').textContent())?.trim() ?? "";
  assert(readinessAfter === "已连接", `expected ready status after callback, got ${readinessAfter}`);
  await capture(page, "callback-setup-after");

  const stateAfter = await fetchJSON(`${ingressURL}/v1/state`);
  const connectionAfter = await fetchJSON(`${ingressURL}/v1/github/connection`);
  assert(connectionAfter.ready === true, "connection should be ready after callback");
  assert(connectionAfter.installationId === "67890", `connection installation id mismatch: ${connectionAfter.installationId}`);
  assert(
    stateAfter.workspace?.githubInstallation?.installationId === "67890",
    `workspace installation id mismatch: ${stateAfter.workspace?.githubInstallation?.installationId}`,
  );
  assert(stateAfter.workspace?.repoAuthMode === "github-app", `workspace repoAuthMode mismatch: ${stateAfter.workspace?.repoAuthMode}`);

  return {
    ingressURL,
    installURL,
    readinessBefore,
    readinessAfter,
    messageBefore,
    callbackLink,
    webhookURL,
    callbackHeading,
    callbackWorkspaceRepoAuthMode: stateAfter.workspace?.repoAuthMode ?? "",
    buildStdout: buildLog.stdout,
  };
}

async function runWebhookPhase() {
  const workspaceDir = await prepareWorkspace("webhook-phase");
  const statePath = path.join(workspaceDir, "data", "phase0", "state.json");
  const serverPort = await freePort();
  const ingressPort = await freePort();
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const ingressURL = `http://127.0.0.1:${ingressPort}`;

  startProcess("webhook-server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_CONTROL_URL: ingressURL,
      OPENSHOCK_DAEMON_URL: "http://127.0.0.1:65531",
      OPENSHOCK_WORKSPACE_ROOT: workspaceDir,
      OPENSHOCK_STATE_FILE: statePath,
      OPENSHOCK_GITHUB_WEBHOOK_SECRET: secret,
    },
  });

  await startIngress("webhook-ingress", ingressPort, serverURL, serverURL);

  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `webhook server did not become healthy at ${serverURL}/healthz`);

  const baselineState = await fetchJSON(`${ingressURL}/v1/state`);
  assert(findPullRequest(baselineState, 18), "seed state missing tracked PR #18");

  const goodBody = await readFile(path.join(webhookFixtureDir, "pr18-check-run-success.json"), "utf8");
  const goodResponse = await fetch(`${ingressURL}/v1/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Delivery": "delivery-ingress-check-run",
      "X-GitHub-Event": "check_run",
      "X-Hub-Signature-256": signBody(goodBody, secret),
    },
    body: goodBody,
  });
  const goodPayload = await goodResponse.json();
  assert(goodResponse.status === 200, `good webhook status = ${goodResponse.status}, want 200`);
  assert(goodPayload.pullRequestId === "pr-runtime-18", `good webhook pullRequestId = ${goodPayload.pullRequestId}, want pr-runtime-18`);
  assert(findPullRequest(goodPayload.state, 18)?.status === "in_review", "positive webhook should keep PR #18 in_review");

  const badBody = await readFile(path.join(webhookFixtureDir, "pr18-merge.json"), "utf8");
  const badResponse = await fetch(`${ingressURL}/v1/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Delivery": "delivery-ingress-bad-signature",
      "X-GitHub-Event": "pull_request",
      "X-Hub-Signature-256": signBody(badBody, "wrong-secret"),
    },
    body: badBody,
  });
  const badPayload = await badResponse.json();
  assert(badResponse.status === 401, `bad webhook status = ${badResponse.status}, want 401`);
  assert(badPayload.error === "invalid github webhook signature", `bad webhook error mismatch: ${badPayload.error}`);

  return {
    ingressURL,
    goodStatus: goodResponse.status,
    badStatus: badResponse.status,
    pullRequestID: goodPayload.pullRequestId,
  };
}

function renderReport(callbackPhase, webhookPhase, chromiumExecutable) {
  const lines = [
    "# Test Report 2026-04-09 GitHub Public Ingress Verification",
    "",
    "- Branch: `tkt-57-github-public-ingress`",
    "- Scope: `TKT-57 / CHK-07 / TC-015 / TC-045`",
    "- Evidence mode: production-style local ingress proxy + public-root callback/webhook replay",
    `- Chromium: \`${chromiumExecutable}\``,
    `- Artifacts dir: \`${artifactsDir}\``,
    "",
    "## Scope",
    "",
    "- 覆盖 GitHub Setup surface 暴露 public callback URL / webhook URL。",
    "- 覆盖 `/setup/github/callback` 通过同一 public ingress root 回流 installation truth。",
    "- 覆盖 signed webhook delivery 与 bad-signature fail-closed 都走 public ingress，而不是直打内网 server 端口。",
    "",
    "## Commands",
    "",
    "- `pnpm test:headed-github-public-ingress -- --report docs/testing/Test-Report-2026-04-09-github-public-ingress.md`",
    "",
    "## Checks",
    "",
    "### Public callback surface and callback return page",
    `- Public ingress root: \`${callbackPhase.ingressURL}\``,
    `- Setup readiness before callback: \`${callbackPhase.readinessBefore}\``,
    `- Setup message before callback: ${callbackPhase.messageBefore}`,
    `- Surfaced callback URL: \`${callbackPhase.callbackLink}\``,
    `- Surfaced webhook URL: \`${callbackPhase.webhookURL}\``,
    `- GitHub installation callback page result: \`${callbackPhase.callbackHeading}\``,
    `- Setup readiness after callback: \`${callbackPhase.readinessAfter}\``,
    `- Workspace repo auth mode after callback: \`${callbackPhase.callbackWorkspaceRepoAuthMode}\``,
    "",
    "### Public webhook delivery and fail-closed probe",
    `- Public ingress root: \`${webhookPhase.ingressURL}\``,
    `- Signed webhook replay status: \`${webhookPhase.goodStatus}\``,
    `- Signed webhook pullRequestId: \`${webhookPhase.pullRequestID}\``,
    `- Bad-signature replay status: \`${webhookPhase.badStatus}\``,
    "",
    "## Evidence",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    ...processes.map((entry) => `- ${entry.name} log: ${entry.logPath}`),
    ...ingressServers.map((entry) => `- ingress log: ${entry.logPath}`),
    "- callback web build log: " + path.join(logsDir, "callback-web-build.log"),
    "",
    "## TC-015 GitHub App 安装与 Webhook",
    "",
    "- 当前执行状态: Pass",
    "- 实际结果: Setup 当前会直接暴露 public callback / webhook URL；`/setup/github/callback` 在 production-style public ingress root 下可把 installation truth 前滚回 Setup，而 signed webhook delivery 与 bad-signature fail-closed 也都已通过 ingress `/v1/github/webhook` 复核。",
    "- 业务结论: `installation callback -> Setup refresh -> signed webhook delivery` 这条链现在不再只围内网 server contract，而是已经有同一 public root 下的 exact replay evidence。",
    "",
    "## TC-045 GitHub Public Ingress Callback / Webhook Delivery",
    "",
    "- 当前执行状态: Pass",
    "- 实际结果: local ingress proxy 同时代理 web + API，callback 页与 webhook delivery 都走公开根路径；错误签名继续 401 fail-closed，没有被 ingress 误吞。",
    "- 业务结论: `CHK-07` 剩余的 public ingress 级验证现在已经收成 exact artifact；后续若要做真正 Internet / DNS / TLS / GitHub SaaS 外网演练，那属于环境级演练，而不是产品 contract 缺口。",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

try {
  const chromiumExecutable = resolveChromiumExecutable();
  const callbackPhase = await runCallbackPhase(chromiumExecutable);
  const webhookPhase = await runWebhookPhase();
  const report = renderReport(callbackPhase, webhookPhase, chromiumExecutable);

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report, "utf8");
  }

  await writeFile(path.join(artifactsDir, "report.md"), report, "utf8");
  console.log(report);
  console.log(`Artifacts: ${artifactsDir}`);
} catch (error) {
  const summary = [
    "# TKT-57 GitHub Public Ingress Verification Failure",
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
    ...ingressServers.map((entry) => `- ingress: ${entry.logPath}`),
  ].join("\n");
  await writeFile(path.join(artifactsDir, "report.md"), summary, "utf8");
  console.error(summary);
  process.exitCode = 1;
} finally {
  await cleanup();
}
