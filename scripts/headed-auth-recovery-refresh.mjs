#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { resolveProvidedServiceTargets } from "./lib/headed-service-targets.mjs";
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const OWNER_EMAIL = "larkspur@openshock.dev";
const OWNER_DEVICE = "Owner Browser";
const REVIEWER_EMAIL = "recovery-refresh-reviewer@openshock.dev";
const REVIEWER_NAME = "Recovery Refresh Reviewer";
const REVIEWER_DEVICE = "Reviewer Phone";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const parsedArgs = parseArgs(process.argv.slice(2));
const providedServiceTargets = resolveProvidedServiceTargets(process.argv.slice(2), { requireServerURL: true });
const defaultEvidenceRoot = path.join(projectRoot, "output", "testing", "us-009-auth-recovery-refresh", "run-attempt");
const artifactsDir = path.resolve(process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() || defaultEvidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(projectRoot, "output", "testing", "us-009-auth-recovery-refresh", "report.json");
const runDir = path.join(artifactsDir, "run");
const screenshotsDir = path.join(runDir, "screenshots");
const logsDir = path.join(runDir, "logs");

const processes = [];
const screenshots = [];
const failedResponses = [];
const consoleProblems = [];
const checkpoints = [];
const report = {
  story: "US-009",
  name: "Auth recovery token refresh browser smoke",
  status: "failed",
  startedAt: new Date().toISOString(),
  endedAt: "",
  command: "pnpm test:headed-auth-recovery-refresh",
  artifactsDir,
  reportPath,
  webURL: "",
  serverURL: "",
  checkpoints,
  failedResponses,
  consoleProblems,
  finalSession: null,
  screenshots,
  error: null,
};

await rm(runDir, { recursive: true, force: true });
await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
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

function pushCheckpoint(step, details = {}) {
  checkpoints.push({ at: timestamp(), step, ...details });
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

  processes.push({ name, child, logPath });
  return child;
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

  for (let attempt = 0; attempt < 24; attempt += 1) {
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

async function startServices() {
  if (providedServiceTargets) {
    await waitFor(async () => (await fetch(`${providedServiceTargets.serverURL}/healthz`)).ok, "external server did not become healthy");
    await waitFor(async () => (await fetch(`${providedServiceTargets.webURL}/access`)).ok, "external web did not become ready");
    return providedServiceTargets;
  }

  const workspaceRoot = path.join(runDir, "workspace");
  const statePath = path.join(runDir, "state.json");
  const serverPort = await freePort();
  const webPort = await freePort();
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const webURL = `http://127.0.0.1:${webPort}`;

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
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
    }
  );

  await waitFor(async () => (await fetch(`${serverURL}/healthz`)).ok, `server did not become healthy at ${serverURL}/healthz`);
  await waitFor(async () => (await fetch(`${webURL}/access`)).ok, `web did not become ready at ${webURL}/access`);
  return { webURL, serverURL };
}

function sanitizeFailureBody(body) {
  if (!body || typeof body !== "object") {
    return body;
  }
  const clone = { ...body };
  delete clone.token;
  return clone;
}

async function browserJSON(page, serverURL, route, options = {}) {
  const request = {
    route,
    method: options.method ?? "GET",
    body: options.body ?? null,
  };
  const response = await page.evaluate(
    async ({ baseURL, currentRequest }) => {
      const init = {
        method: currentRequest.method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
      if (currentRequest.body !== null) {
        init.body = JSON.stringify(currentRequest.body);
      }
      const fetchResponse = await fetch(`${baseURL}${currentRequest.route}`, init);
      const text = await fetchResponse.text();
      let body = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // keep text body
      }
      return {
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        statusText: fetchResponse.statusText,
        body,
      };
    },
    { baseURL: serverURL, currentRequest: request }
  );

  if (!response.ok) {
    failedResponses.push({
      at: timestamp(),
      route,
      method: request.method,
      status: response.status,
      statusText: response.statusText,
      body: sanitizeFailureBody(response.body),
    });
    throw new Error(`${request.method} ${route} returned ${response.status}: ${JSON.stringify(response.body)}`);
  }

  return response.body;
}

async function capture(page, name) {
  const filePath = path.join(screenshotsDir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function requestChallenge(page, serverURL, action, input) {
  const payload = await browserJSON(page, serverURL, "/v1/auth/recovery", {
    method: "POST",
    body: { action, ...input },
  });
  const challengeID = payload?.challenge?.id;
  assert.ok(challengeID, `${action} should return a challenge id`);
  return payload.challenge;
}

function summarizeSession(session) {
  return {
    status: session?.status ?? "",
    email: session?.email ?? "",
    role: session?.role ?? "",
    memberStatus: session?.memberStatus ?? "",
    deviceIdPresent: Boolean(session?.deviceId),
    deviceLabel: session?.deviceLabel ?? "",
    deviceAuthStatus: session?.deviceAuthStatus ?? "",
    emailVerificationStatus: session?.emailVerificationStatus ?? "",
    recoveryStatus: session?.recoveryStatus ?? "",
    permissionCount: Array.isArray(session?.permissions) ? session.permissions.length : 0,
  };
}

let browser = null;
let context = null;
let page = null;

try {
  const services = await startServices();
  report.webURL = services.webURL;
  report.serverURL = services.serverURL;

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  page = await context.newPage();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleProblems.push({ at: timestamp(), type: message.type(), text: message.text(), location: message.location() });
    }
  });
  page.on("pageerror", (error) => {
    consoleProblems.push({ at: timestamp(), type: "pageerror", text: error.message });
  });

  await page.goto(`${services.webURL}/access`, { waitUntil: "load" });
  await capture(page, "access-loaded");
  pushCheckpoint("loaded /access in a real browser");

  const ownerChallenge = await requestChallenge(page, services.serverURL, "request_login_challenge", { email: OWNER_EMAIL });
  const ownerLogin = await browserJSON(page, services.serverURL, "/v1/auth/session", {
    method: "POST",
    body: {
      email: OWNER_EMAIL,
      deviceLabel: OWNER_DEVICE,
      challengeId: ownerChallenge.id,
    },
  });
  assert.equal(ownerLogin?.session?.email, OWNER_EMAIL, "owner login should establish owner session");
  pushCheckpoint("owner logged in through browser credentials cookie", { email: ownerLogin.session.email });

  const invite = await browserJSON(page, services.serverURL, "/v1/workspace/members", {
    method: "POST",
    body: {
      email: REVIEWER_EMAIL,
      name: REVIEWER_NAME,
      role: "member",
    },
  });
  assert.equal(invite?.member?.email, REVIEWER_EMAIL, "owner invite should create reviewer member");
  pushCheckpoint("owner invited reviewer", { memberId: invite.member.id });

  const reviewerChallenge = await requestChallenge(page, services.serverURL, "request_login_challenge", { email: REVIEWER_EMAIL });
  const reviewerLogin = await browserJSON(page, services.serverURL, "/v1/auth/session", {
    method: "POST",
    body: {
      email: REVIEWER_EMAIL,
      deviceLabel: REVIEWER_DEVICE,
      challengeId: reviewerChallenge.id,
    },
  });
  assert.equal(reviewerLogin?.session?.email, REVIEWER_EMAIL, "reviewer login should replace owner browser session");
  assert.equal(reviewerLogin?.session?.deviceAuthStatus, "pending", "reviewer device should start pending");
  pushCheckpoint("reviewer logged in with pending recovery gates", summarizeSession(reviewerLogin.session));

  const verifyChallenge = await requestChallenge(page, services.serverURL, "request_verify_email_challenge", { email: REVIEWER_EMAIL });
  const verified = await browserJSON(page, services.serverURL, "/v1/auth/recovery", {
    method: "POST",
    body: {
      action: "verify_email",
      email: REVIEWER_EMAIL,
      challengeId: verifyChallenge.id,
    },
  });
  assert.equal(verified?.session?.emailVerificationStatus, "verified", "verify_email should refresh session to verified");
  const afterVerifySession = await browserJSON(page, services.serverURL, "/v1/auth/session");
  assert.equal(afterVerifySession.email, REVIEWER_EMAIL, "session after verify_email should stay on reviewer");
  assert.equal(afterVerifySession.emailVerificationStatus, "verified", "GET session after verify_email should be verified");
  pushCheckpoint("verify_email consumed and /v1/auth/session reflects reviewer", summarizeSession(afterVerifySession));

  const authorizeChallenge = await requestChallenge(page, services.serverURL, "request_authorize_device_challenge", {
    deviceId: afterVerifySession.deviceId,
  });
  const authorized = await browserJSON(page, services.serverURL, "/v1/auth/recovery", {
    method: "POST",
    body: {
      action: "authorize_device",
      deviceId: afterVerifySession.deviceId,
      challengeId: authorizeChallenge.id,
    },
  });
  assert.equal(authorized?.session?.deviceAuthStatus, "authorized", "authorize_device should refresh session to authorized");

  const finalSession = await browserJSON(page, services.serverURL, "/v1/auth/session");
  assert.equal(finalSession.email, REVIEWER_EMAIL, "final /v1/auth/session should reflect recovered reviewer");
  assert.equal(finalSession.deviceLabel, REVIEWER_DEVICE, "final /v1/auth/session should keep the recovered device");
  assert.equal(finalSession.emailVerificationStatus, "verified", "final session should keep verified email");
  assert.equal(finalSession.deviceAuthStatus, "authorized", "final session should keep authorized device");
  report.finalSession = summarizeSession(finalSession);
  pushCheckpoint("authorize_device consumed and final /v1/auth/session reflects recovered caller", report.finalSession);
  await capture(page, "final-recovered-session");

  report.status = "passed";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
