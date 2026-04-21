#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";
import { resolveProvidedServiceTargets } from "./lib/headed-service-targets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

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

const parsedArgs = parseArgs(process.argv.slice(2));
const providedServiceTargets = resolveProvidedServiceTargets(process.argv.slice(2), {
  requireServerURL: true,
});
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-four-agent-website-")));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const workspaceDir = path.join(artifactsDir, "workspace");
const webDistDirName = ".next-e2e-website-four-agent-delivery";
const webDistDir = path.join(projectRoot, "apps", "web", webDistDirName);

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(webDistDir, { recursive: true });

const screenshots = [];
const processes = [];

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
    // Process already exited.
  }
}

async function cleanup() {
  await Promise.allSettled([context?.close(), browser?.close()]);
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
      // try the next path
    }
  }

  throw new Error("No executable Chromium binary found. Set OPENSHOCK_CHROMIUM_PATH to continue.");
}

async function capture(page, name) {
  const filePath = path.join(
    screenshotsDir,
    `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`
  );
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function fetchJSON(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `${url} failed: ${response.status}`);
  }
  return payload;
}

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function readPlannerQueue(serverURL) {
  return fetchJSON(`${serverURL}/v1/planner/queue`, { cache: "no-store" });
}

async function readText(page, testId) {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
}

async function prepareWorkspace() {
  await rm(workspaceDir, { recursive: true, force: true });
  await runCommand("git", ["clone", "--shared", projectRoot, workspaceDir]);
  await runCommand("git", ["-C", workspaceDir, "remote", "set-url", "origin", "https://github.com/Larkspur-Wang/OpenShock.git"]);
  await runCommand("git", ["-C", workspaceDir, "checkout", "-B", "main", "HEAD"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.name", "OpenShock Headed E2E"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.email", "openshock-headed-e2e@example.com"]);
}

async function startServices() {
  if (providedServiceTargets) {
    const { webURL, serverURL } = providedServiceTargets;

    await waitFor(async () => {
      const response = await fetch(`${serverURL}/healthz`);
      return response.ok;
    }, `external server did not become healthy at ${serverURL}/healthz`);

    await waitFor(async () => {
      const response = await fetch(`${webURL}/setup`);
      return response.ok;
    }, `external web did not become ready at ${webURL}/setup`);

    return { webURL, serverURL };
  }

  const statePath = path.join(artifactsDir, "state.json");
  const webPort = await freePort();
  const serverPort = await freePort();
  const daemonPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const daemonURL = `http://127.0.0.1:${daemonPort}`;
  const webEnv = {
    ...process.env,
    OPENSHOCK_CONTROL_API_BASE: serverURL,
    NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    OPENSHOCK_NEXT_DIST_DIR: webDistDirName,
  };
  const buildLogPath = path.join(logsDir, "web-build.log");

  await prepareWorkspace();
  await rm(webDistDir, { recursive: true, force: true });
  await mkdir(webDistDir, { recursive: true });

  const buildResult = spawnSync("pnpm", ["--dir", "apps/web", "build"], {
    cwd: projectRoot,
    env: webEnv,
    encoding: "utf8",
  });
  writeFileSync(
    buildLogPath,
    [
      `[${timestamp()}] pnpm --dir apps/web build`,
      buildResult.stdout ?? "",
      buildResult.stderr ?? "",
      `[${timestamp()}] exited code=${buildResult.status} signal=${buildResult.signal ?? "null"}`,
      "",
    ].join("\n"),
    "utf8"
  );
  if (buildResult.status !== 0) {
    throw new Error(`web build failed before website delivery replay. See ${buildLogPath}`);
  }

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
    },
  });

  startProcess(
    "web",
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: webEnv,
    }
  );

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
  }, `web did not become ready at ${webURL}/setup`);

  return { webURL, serverURL };
}

const customTopology = [
  {
    id: "architect",
    label: "Architect",
    role: "网站信息架构与边界",
    defaultAgent: "Codex Dockmaster",
    lane: "scope / IA",
  },
  {
    id: "developer",
    label: "Developer",
    role: "页面实现与交互收口",
    defaultAgent: "Build Pilot",
    lane: "build / polish",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    role: "exact-head 复核",
    defaultAgent: "Claude Review Runner",
    lane: "review / copy",
  },
  {
    id: "qa",
    label: "QA",
    role: "跨端验证与演示确认",
    defaultAgent: "Memory Clerk",
    lane: "verify / demo",
  },
];

try {
  resolveChromiumExecutable();
  const { webURL, serverURL } = await startServices();
  const issueTitle = `Build website landing page ${Date.now()}`;
  const issueSummary =
    "Ship a marketing website with a clear hero, pricing, FAQ, and a user-ready demo path.";
  const architectToDeveloperNote = "信息架构、区块顺序和 CTA 边界已经收清，交给开发开始落页面。";
  const developerToReviewerNote = "首屏、定价、FAQ 和 CTA 已落好，交给评审做 exact-head 复核。";
  const reviewerBlockedNote = "Hero 文案和 FAQ 顺序还要再收平。";
  const reviewerToQANote = "视觉层级、CTA 文案和导航一致性已复核，可以交 QA 做最终验证。";
  const qaCloseoutNote = "桌面和移动主链验证已通过，网站可以给用户演示。";

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  const page = await context.newPage();

  await page.goto(`${webURL}/setup`, { waitUntil: "load" });
  await page.getByTestId("setup-template-select-dev-team").waitFor({ state: "visible" });
  await page.getByTestId("setup-template-select-dev-team").click();
  await page.getByTestId("setup-onboarding-success").waitFor({ state: "visible" });

  await fetchJSON(`${serverURL}/v1/workspace`, {
    method: "PATCH",
    body: JSON.stringify({
      governance: {
        teamTopology: customTopology,
      },
    }),
  });

  const stateAfterTopology = await readState(serverURL);
  assert(
    stateAfterTopology.agents.some((agent) => agent.id === "agent-build-pilot"),
    "custom website topology requires the Build Pilot agent to exist in live state"
  );
  assert(
    stateAfterTopology.workspace.governance.teamTopology.length === 4,
    "website topology should expose 4 visible governed lanes"
  );

  await page.reload({ waitUntil: "load" });
  await page.getByTestId("setup-governance-lane-architect").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-lane-developer").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-lane-reviewer").waitFor({ state: "visible" });
  await page.getByTestId("setup-governance-lane-qa").waitFor({ state: "visible" });
  assert(
    (await readText(page, "setup-governance-lane-architect-agent")).includes("Codex Dockmaster"),
    "setup should surface Codex Dockmaster as the architect lane agent"
  );
  assert(
    (await readText(page, "setup-governance-lane-developer-agent")).includes("Build Pilot"),
    "setup should surface Build Pilot as the developer lane agent"
  );
  assert(
    (await readText(page, "setup-governance-lane-reviewer-agent")).includes("Claude Review Runner"),
    "setup should surface Claude Review Runner as the reviewer lane agent"
  );
  assert(
    (await readText(page, "setup-governance-lane-qa-agent")).includes("Memory Clerk"),
    "setup should surface Memory Clerk as the QA lane agent"
  );
  await capture(page, "setup-website-four-agent-topology");

  const createdPayload = await fetchJSON(`${serverURL}/v1/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: issueTitle,
      summary: issueSummary,
      owner: "Codex Dockmaster",
      priority: "critical",
    }),
  });

  const createdState = createdPayload.state;
  const createdIssue =
    createdState.issues.find((item) => item.roomId === createdPayload.roomId) ??
    (await waitFor(async () => {
      const state = await readState(serverURL);
      return state.issues.find((item) => item.roomId === createdPayload.roomId) ?? false;
    }, "created website issue never appeared in live state"));
  const createdSession =
    createdState.sessions?.find((item) => item.id === createdPayload.sessionId) ??
    (await waitFor(async () => {
      const state = await readState(serverURL);
      return state.sessions.find((item) => item.id === createdPayload.sessionId) ?? false;
    }, "created planner session never appeared in live state"));

  await page.goto(`${webURL}/board`, { waitUntil: "load" });
  await page.getByTestId(`board-card-room-${createdIssue.key}`).waitFor({ state: "visible" });
  await capture(page, "board-website-issue-visible");

  const initialQueue = await readPlannerQueue(serverURL);
  const queuedItem = initialQueue.find((item) => item.sessionId === createdSession.id);
  assert(queuedItem, "planner queue should expose the website issue session");

  await fetchJSON(`${serverURL}/v1/planner/sessions/${createdSession.id}/assignment`, {
    method: "POST",
    body: JSON.stringify({ agentId: "agent-codex-dockmaster" }),
  });

  await page.goto(`${webURL}/agents`, { waitUntil: "load" });
  await page.getByTestId(`orchestration-planner-queue-item-${createdSession.id}`).waitFor({ state: "visible" });
  await waitFor(
    async () => (await readText(page, `orchestration-planner-queue-owner-${createdSession.id}`)).includes("Codex Dockmaster"),
    "assigned planner queue card did not expose Codex Dockmaster as the architect owner"
  );
  await capture(page, "agents-after-website-planner-assignment");

  const architectHandoffPayload = await fetchJSON(`${serverURL}/v1/mailbox`, {
    method: "POST",
    body: JSON.stringify({
      roomId: createdIssue.roomId,
      fromAgentId: "agent-codex-dockmaster",
      toAgentId: "agent-build-pilot",
      title: `Architect handoff for ${issueTitle}`,
      summary: architectToDeveloperNote,
      kind: "governed",
    }),
  });
  const architectHandoff = architectHandoffPayload.handoff;
  assert(
    architectHandoff.fromAgent === "Codex Dockmaster" && architectHandoff.toAgent === "Build Pilot",
    "first website handoff should seed architect -> developer"
  );

  await page.goto(`${webURL}/mailbox?roomId=${createdIssue.roomId}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-card-${architectHandoff.id}`).waitFor({ state: "visible" });

  await fetchJSON(`${serverURL}/v1/mailbox/${architectHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "acknowledged",
      actingAgentId: "agent-build-pilot",
    }),
  });
  const developerCompletePayload = await fetchJSON(`${serverURL}/v1/mailbox/${architectHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "completed",
      actingAgentId: "agent-build-pilot",
      note: developerToReviewerNote,
      continueGovernedRoute: true,
    }),
  });
  const reviewerHandoff = developerCompletePayload.state.mailbox[0];
  assert(
    reviewerHandoff.fromAgent === "Build Pilot" &&
      reviewerHandoff.toAgent === "Claude Review Runner" &&
      reviewerHandoff.status === "requested",
    "developer completion should auto-create a reviewer handoff"
  );

  await page.reload({ waitUntil: "load" });
  await page.getByTestId(`mailbox-card-${reviewerHandoff.id}`).waitFor({ state: "visible" });
  await capture(page, "mailbox-reviewer-requested");

  const blockedWithoutNoteResponse = await fetch(`${serverURL}/v1/mailbox/${reviewerHandoff.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "blocked",
      actingAgentId: "agent-claude-review-runner",
    }),
  });
  const blockedWithoutNotePayload = await blockedWithoutNoteResponse.json();
  assert(
    blockedWithoutNoteResponse.status === 400,
    "blocked reviewer handoff without note should fail closed with 400"
  );
  assert(
    String(blockedWithoutNotePayload.error || "").includes("note"),
    "blocked reviewer handoff without note should explain the missing note requirement"
  );

  await fetchJSON(`${serverURL}/v1/mailbox/${reviewerHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "blocked",
      actingAgentId: "agent-claude-review-runner",
      note: reviewerBlockedNote,
    }),
  });

  await page.reload({ waitUntil: "load" });
  assert(
    (await readText(page, "mailbox-governance-lane-status-reviewer")) === "阻塞",
    "reviewer lane should surface the blocked website review step"
  );
  const overrideLabel = await readText(page, "mailbox-governance-human-override");
  assert(
    overrideLabel === "关注" || overrideLabel === "需要处理",
    "blocked reviewer step should surface a visible human-override watch state"
  );
  await capture(page, "mailbox-reviewer-blocked");

  await fetchJSON(`${serverURL}/v1/mailbox/${reviewerHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "acknowledged",
      actingAgentId: "agent-claude-review-runner",
    }),
  });
  const reviewerCompletePayload = await fetchJSON(`${serverURL}/v1/mailbox/${reviewerHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "completed",
      actingAgentId: "agent-claude-review-runner",
      note: reviewerToQANote,
      continueGovernedRoute: true,
    }),
  });
  const qaHandoff = reviewerCompletePayload.state.mailbox[0];
  assert(
    qaHandoff.fromAgent === "Claude Review Runner" &&
      qaHandoff.toAgent === "Memory Clerk" &&
      qaHandoff.status === "requested",
    "reviewer completion should auto-create a QA handoff"
  );

  await page.reload({ waitUntil: "load" });
  await page.getByTestId(`mailbox-card-${qaHandoff.id}`).waitFor({ state: "visible" });
  await capture(page, "mailbox-qa-requested");

  await fetchJSON(`${serverURL}/v1/mailbox/${qaHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "acknowledged",
      actingAgentId: "agent-memory-clerk",
    }),
  });
  const qaCompletePayload = await fetchJSON(`${serverURL}/v1/mailbox/${qaHandoff.id}`, {
    method: "POST",
    body: JSON.stringify({
      action: "completed",
      actingAgentId: "agent-memory-clerk",
      note: qaCloseoutNote,
    }),
  });

  await page.reload({ waitUntil: "load" });
  await waitFor(
    async () => (await readText(page, "mailbox-governance-response-aggregation")).includes(qaCloseoutNote),
    "mailbox response aggregation did not expose the QA closeout note"
  );
  await capture(page, "mailbox-website-final-response");

  const finalState = qaCompletePayload.state;
  assert(
    finalState.workspace.governance.routingPolicy.suggestedHandoff.status === "done",
    "website governance route should settle to done after QA completes the final lane"
  );
  assert(
    finalState.workspace.governance.responseAggregation.finalResponse.includes(qaCloseoutNote),
    "server governance snapshot should aggregate the website QA closeout note"
  );
  const finalStep = finalState.workspace.governance.walkthrough.find((item) => item.id === "final-response");
  assert(finalStep?.status === "ready", "final response walkthrough step should settle to ready after QA completes");

  const report = [
    "# 2026-04-21 Website / Four-Agent Delivery Replay Report",
    "",
    `- Command: \`pnpm test:headed-website-four-agent-delivery -- --report ${path.relative(projectRoot, reportPath)}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    "- `/setup` 现在会直接露出 Architect / Developer / Reviewer / QA 四条 lane 的默认智能体；网站场景不再只是抽象模板名 -> PASS",
    `- 新网站事项 \`${createdIssue.key}\` 建立后，\`/board\`、planner queue 和 \`/agents\` orchestration 会围同一条 session 前滚，首棒由 Codex Dockmaster 挂住 architect lane -> PASS`,
    "- architect -> developer 采用显式 seeded governed handoff，随后 developer -> reviewer 与 reviewer -> qa 都通过 `continueGovernedRoute: true` 自动前滚，证明四棒网站链路已经走通 -> PASS",
    "- adversarial non-happy probe 已覆盖 reviewer `blocked` without note：`POST /v1/mailbox/:id` 在缺 note 时稳定返回 `400`，不会把网站评审 blocker 假绿吞掉 -> PASS",
    "- QA 完成后，governance `suggestedHandoff.status` 会切到 `done`，response aggregation 会直接聚合最终演示结论 -> PASS",
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await cleanup();
}
