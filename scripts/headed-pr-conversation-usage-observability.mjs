#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { launchChromiumSession } from "./lib/playwright-chromium.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const parsedArgs = parseArgs(process.argv.slice(2));
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt39-41-headed-")));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webhookSecret = "super-secret";
const pullRequestID = "pr-runtime-18";
const pullRequestNumber = 18;
const roomID = "room-runtime";
const runID = "run_runtime_01";

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const screenshots = [];
const processes = [];
const reportCommand = buildReportCommand();

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

function buildReportCommand() {
  const relativeReportPath = parsedArgs.reportPath
    ? parsedArgs.reportPath
    : path.relative(projectRoot, reportPath);

  if (process.env.OPENSHOCK_CHROMIUM_CDP_URL?.trim()) {
    return `OPENSHOCK_CHROMIUM_CDP_URL=${process.env.OPENSHOCK_CHROMIUM_CDP_URL.trim()} pnpm test:headed-pr-conversation-usage-observability -- --report ${relativeReportPath}`;
  }

  if (process.env.OPENSHOCK_WINDOWS_CHROME === "1") {
    return `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-pr-conversation-usage-observability -- --report ${relativeReportPath}`;
  }

  return `pnpm test:headed-pr-conversation-usage-observability -- --report ${relativeReportPath}`;
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

async function capture(page, name) {
  const filePath = path.join(
    screenshotsDir,
    `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`
  );
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
}

async function requestJSON(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { text: await response.text() };
  return {
    status: response.status,
    ok: response.ok,
    payload,
  };
}

function githubWebhookSignature(secret, body) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function postWebhook(serverURL, deliveryID, eventType, payload) {
  const body = JSON.stringify(payload);
  const response = await requestJSON(`${serverURL}/v1/github/webhook`, {
    method: "POST",
    headers: {
      "X-GitHub-Delivery": deliveryID,
      "X-GitHub-Event": eventType,
      "X-Hub-Signature-256": githubWebhookSignature(webhookSecret, body),
    },
    body,
  });
  assert(response.ok, `${eventType} delivery ${deliveryID} failed with ${response.status}`);
  return response.payload;
}

async function readState(serverURL) {
  const response = await requestJSON(`${serverURL}/v1/state`, { cache: "no-store" });
  assert(response.ok, `GET /v1/state failed with ${response.status}`);
  return response.payload;
}

async function readPullRequestDetail(serverURL) {
  const response = await requestJSON(`${serverURL}/v1/pull-requests/${pullRequestID}/detail`, {
    cache: "no-store",
  });
  assert(response.ok, `GET /v1/pull-requests/${pullRequestID}/detail failed with ${response.status}`);
  return response.payload;
}

async function readText(page, testId) {
  return ((await page.getByTestId(testId).textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function startServices() {
  const workspaceRoot = path.join(artifactsDir, "workspace");
  const statePath = path.join(artifactsDir, "state.json");
  const webAppRoot = path.join(projectRoot, "apps", "web");
  const webPort = await freePort();
  const serverPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const webEnv = {
    ...process.env,
    OPENSHOCK_CONTROL_API_BASE: serverURL,
    NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
  };
  const buildLogPath = path.join(logsDir, "web-build.log");

  await mkdir(workspaceRoot, { recursive: true });
  await rm(path.join(webAppRoot, ".next"), { recursive: true, force: true });

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
    throw new Error(`web build failed before headed replay. See ${buildLogPath}`);
  }

  const serverEnv = {
    ...process.env,
    OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
    OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
    OPENSHOCK_STATE_FILE: statePath,
    OPENSHOCK_GITHUB_WEBHOOK_SECRET: webhookSecret,
  };

  const serverProcess = startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: serverEnv,
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
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/pull-requests/${pullRequestID}`);
    return response.ok;
  }, `web did not become ready at ${webURL}/pull-requests/${pullRequestID}`);

  return { webURL, serverURL, statePath, serverEnv, serverProcess };
}

async function waitForConversationState(serverURL) {
  return waitFor(async () => {
    const state = await readState(serverURL);
    const pullRequest = state.pullRequests.find((item) => item.id === pullRequestID);
    const blockedItem = state.inbox.find(
      (item) => item.title === `PR #${pullRequestNumber} 需要补充修改`
    );
    const room = state.rooms.find((item) => item.id === roomID);
    const run = state.runs.find((item) => item.id === runID);

    if (
      pullRequest &&
      Array.isArray(pullRequest.conversation) &&
      pullRequest.conversation.length === 3 &&
      blockedItem &&
      blockedItem.href === `/rooms/${roomID}?tab=pr` &&
      room?.topic?.status === "blocked" &&
      run?.usage?.totalTokens > 0
    ) {
      return { state, pullRequest, blockedItem, room, run };
    }
    return false;
  }, "review conversation / inbox backlink / usage truth did not settle");
}

function removeTrackedPullRequestSignals(state) {
  return {
    ...state,
    inbox: (state.inbox ?? []).filter((item) => {
      if (!item?.title?.startsWith(`PR #${pullRequestNumber}`)) {
        return true;
      }
      return !String(item.href ?? "").includes(roomID);
    }),
    pullRequests: (state.pullRequests ?? []).map((item) =>
      item.id === pullRequestID
        ? {
            ...item,
            provider: "local",
            conversation: [],
          }
        : item
    ),
  };
}

let browser = null;
let context = null;
let page = null;

try {
  const services = await startServices();
  const { webURL, serverURL } = services;
  const seededState = await readState(serverURL);
  await stopProcess(services.serverProcess);
  await writeFile(
    services.statePath,
    `${JSON.stringify(removeTrackedPullRequestSignals(seededState), null, 2)}\n`,
    "utf8"
  );
  services.serverProcess = startProcess(
    "server",
    path.join(projectRoot, "scripts", "go.sh"),
    ["run", "./cmd/openshock-server"],
    {
      cwd: path.join(projectRoot, "apps", "server"),
      env: services.serverEnv,
    }
  );
  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `restarted server did not become healthy at ${serverURL}/healthz`);

  const runStamp = Date.now();

  const reviewResponse = await postWebhook(serverURL, `delivery-review-${runStamp}`, "pull_request_review", {
    action: "submitted",
    repository: { full_name: "Larkspur-Wang/OpenShock" },
    sender: { login: "review-bot" },
    pull_request: {
      number: pullRequestNumber,
      title: "runtime: surface heartbeat and lane state in discussion room",
      html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18",
      state: "open",
      merged: false,
      head: { ref: "feat/runtime-state-shell", sha: "abc123" },
      base: { ref: "main" },
    },
    review: {
      id: 7000,
      state: "changes_requested",
      body: "needs explicit usage / quota visibility before shipping",
      html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18#pullrequestreview-7000",
      submitted_at: "2026-04-11T08:00:00Z",
    },
  });

  const commentResponse = await postWebhook(
    serverURL,
    `delivery-review-comment-${runStamp}`,
    "pull_request_review_comment",
    {
      action: "created",
      repository: { full_name: "Larkspur-Wang/OpenShock" },
      sender: { login: "review-bot" },
      pull_request: {
        number: pullRequestNumber,
        title: "runtime: surface heartbeat and lane state in discussion room",
        html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18",
        state: "open",
        merged: false,
        head: { ref: "feat/runtime-state-shell", sha: "abc123" },
        base: { ref: "main" },
      },
      comment: {
        id: 9001,
        body: "please expose quota warning in settings and keep the same truth in room",
        html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18#discussion_r9001",
        path: "apps/web/src/components/live-settings-views.tsx",
        line: 618,
        updated_at: "2026-04-11T08:01:00Z",
        user: { login: "review-bot" },
      },
    }
  );

  await postWebhook(serverURL, `delivery-review-comment-replay-${runStamp}`, "pull_request_review_comment", {
    action: "created",
    repository: { full_name: "Larkspur-Wang/OpenShock" },
    sender: { login: "review-bot" },
    pull_request: {
      number: pullRequestNumber,
      title: "runtime: surface heartbeat and lane state in discussion room",
      html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18",
      state: "open",
      merged: false,
      head: { ref: "feat/runtime-state-shell", sha: "abc123" },
      base: { ref: "main" },
    },
    comment: {
      id: 9001,
      body: "please expose quota warning in settings and keep the same truth in room",
      html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18#discussion_r9001",
      path: "apps/web/src/components/live-settings-views.tsx",
      line: 618,
      updated_at: "2026-04-11T08:01:00Z",
      user: { login: "review-bot" },
    },
  });

  const threadResponse = await postWebhook(
    serverURL,
    `delivery-review-thread-${runStamp}`,
    "pull_request_review_thread",
    {
      action: "resolved",
      repository: { full_name: "Larkspur-Wang/OpenShock" },
      sender: { login: "review-bot" },
      pull_request: {
        number: pullRequestNumber,
        title: "runtime: surface heartbeat and lane state in discussion room",
        html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18",
        state: "open",
        merged: false,
        head: { ref: "feat/runtime-state-shell", sha: "abc123" },
        base: { ref: "main" },
      },
      thread: {
        id: 7001,
        path: "apps/web/src/components/stitch-chat-room-views.tsx",
        line: 2834,
        resolved: true,
        comments: [
          {
            body: "looks good once the room workbench mirrors the same usage warning",
            html_url: "https://github.com/Larkspur-Wang/OpenShock/pull/18#discussion_r7001",
            updated_at: "2026-04-11T08:02:00Z",
          },
        ],
      },
    }
  );

  const settled = await waitForConversationState(serverURL);
  const detail = await readPullRequestDetail(serverURL);

  const conversationIDs = settled.pullRequest.conversation.map((item) => item.id);
  assert(
    JSON.stringify(conversationIDs) === JSON.stringify(["review_thread:7001", "review_comment:9001", "review:7000"]),
    `unexpected conversation order ${JSON.stringify(conversationIDs)}`
  );
  assert(
    detail.relatedInbox.some((item) => item.href === `/rooms/${roomID}?tab=pr`),
    "pull request detail should expose inbox backlink to room PR tab"
  );
  assert(detail.run.usage?.totalTokens > 0, "pull request detail run usage should be hydrated");
  assert(detail.room.usage?.totalTokens > 0, "pull request detail room usage should be hydrated");
  assert(detail.pullRequest.status === "changes_requested", "pull request detail should preserve blocked review status");
  assert(String(detail.pullRequest.reviewSummary ?? "").length > 8, "pull request detail should expose a non-empty review summary");
  assert(reviewResponse.state?.pullRequests?.length > 0, "review delivery should echo updated state");
  assert(commentResponse.event?.conversationKey === "review_comment:9001", "review comment should normalize conversation key");
  assert(threadResponse.event?.threadStatus === "resolved", "review thread should normalize resolved state");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1320 } });
  page = await context.newPage();

  await page.goto(`${webURL}/pull-requests/${pullRequestID}`, { waitUntil: "load" });
  await page.getByTestId("pull-request-context-room").waitFor({ state: "visible" });
  assert((await readText(page, "pull-request-conversation-count")) === "3", "PR detail should show 3 conversation entries");
  await page.getByTestId(`pull-request-related-inbox-${settled.blockedItem.id}`).waitFor({ state: "visible" });
  await capture(page, "pr-detail-conversation-and-inbox-backlinks");

  await Promise.all([
    page.waitForURL((url) => url.pathname === `/rooms/${roomID}` && url.searchParams.get("tab") === "pr"),
    page.getByTestId("pull-request-room-pr-link").click(),
  ]);
  await page.getByTestId("room-workbench-pr-panel").waitFor({ state: "visible" });
  assert((await readText(page, "room-pr-conversation-count")) === "3 entries", "room PR panel should mirror 3 recent conversation entries");
  await page.getByTestId("room-pr-conversation-entry-review_thread:7001").waitFor({ state: "visible" });
  await capture(page, "room-pr-workbench-conversation-ledger");

  await Promise.all([
    page.waitForURL((url) => url.pathname === `/pull-requests/${pullRequestID}`),
    page.getByTestId("room-pr-detail-link").click(),
  ]);
  await page.getByTestId("pull-request-context-room").waitFor({ state: "visible" });

  await page.goto(`${webURL}/inbox`, { waitUntil: "load" });
  await page.getByTestId(`approval-center-signal-${settled.blockedItem.id}`).waitFor({ state: "visible" });
  const roomLink = page.getByTestId(`approval-center-room-link-${settled.blockedItem.id}`);
  const prDetailLink = page.getByTestId(`approval-center-pr-detail-link-${settled.blockedItem.id}`);
  const approvalRoomHref = await roomLink.getAttribute("href");
  const approvalDetailHref = await prDetailLink.getAttribute("href");
  assert(
    typeof approvalRoomHref === "string" && approvalRoomHref.includes(`/rooms/${roomID}`) && approvalRoomHref.includes("tab=pr"),
    "approval center room link should point to PR tab"
  );
  assert(
    typeof approvalDetailHref === "string" && approvalDetailHref.endsWith(`/pull-requests/${pullRequestID}`),
    "approval center PR detail link should point to delivery entry"
  );
  await capture(page, "approval-center-pr-review-backlinks");

  await page.goto(`${webURL}/rooms/${roomID}?tab=run`, { waitUntil: "load" });
  await page.getByTestId("room-workbench-run-panel").waitFor({ state: "visible" });
  const roomUsageSummary = await readText(page, "room-workbench-room-usage-summary");
  const workspaceUsageSummary = await readText(page, "room-workbench-workspace-usage-summary");
  const roomUsageWarning = await readText(page, "room-workbench-usage-warning");
  assert(roomUsageSummary.includes("msgs /"), "room usage summary should expose message/token counters");
  assert(workspaceUsageSummary.length > 8 && !workspaceUsageSummary.includes("未返回"), "workspace usage summary should expose plan/quota headroom");
  assert(roomUsageWarning.length > 8, "room usage warning should be visible");
  await capture(page, "room-run-usage-observability");

  await page.goto(`${webURL}/runs/${runID}`, { waitUntil: "load" });
  await page.getByTestId("run-detail-usage-panel").waitFor({ state: "visible" });
  const runUsageStatus = await readText(page, "run-detail-usage-status");
  const runUsageWarning = await readText(page, "run-detail-usage-warning");
  assert(runUsageStatus !== "待同步", "run usage status should be hydrated");
  assert(runUsageWarning.length > 8, "run usage warning should be visible");
  await capture(page, "run-detail-token-quota-surface");

  await page.goto(`${webURL}/settings`, { waitUntil: "load" });
  await page.getByTestId("settings-workspace-plan-value").waitFor({ state: "visible" });
  const workspacePlan = await readText(page, "settings-workspace-plan-value");
  const usageWindow = await readText(page, "settings-workspace-usage-window");
  const retention = await readText(page, "settings-workspace-retention");
  const usageSummary = await readText(page, "settings-workspace-usage-summary");
  const quotaWarning = await readText(page, "settings-workspace-quota-warning");
  const usageWarning = await readText(page, "settings-workspace-usage-warning");
  assert(workspacePlan.length > 0 && workspacePlan !== "未声明", "settings plan tile should be populated");
  assert(usageWindow.includes("过去"), "settings usage window should be populated");
  assert(retention.includes("消息"), "settings retention tile should expose retention contract");
  assert(usageSummary.includes("tokens"), "settings usage summary should expose tokens");
  assert(quotaWarning.length > 8, "settings quota warning should be visible");
  assert(usageWarning.length > 8, "settings usage warning should be visible");
  await capture(page, "settings-workspace-plan-usage-retention");

  const roomUsageEvidence = `${settled.room.usage.messageCount} msgs / ${settled.room.usage.totalTokens.toLocaleString("en-US")} tokens; ${settled.room.usage.humanTurns} human / ${settled.room.usage.agentTurns} agent; window=${settled.room.usage.windowLabel}`;
  const workspaceUsageEvidence = `${settled.state.workspace.plan}; ${settled.state.workspace.quota.usedAgents}/${settled.state.workspace.quota.maxAgents} agents; ${settled.state.workspace.quota.usedRooms}/${settled.state.workspace.quota.maxRooms} rooms; retention=${settled.state.workspace.quota.messageHistoryDays}d 消息 / ${settled.state.workspace.quota.runLogDays}d Run / ${settled.state.workspace.quota.memoryDraftDays}d 草稿`;
  const settingsUsageEvidence = `${settled.state.workspace.usage.totalTokens.toLocaleString("en-US")} tokens / ${settled.state.workspace.usage.runCount} runs / ${settled.state.workspace.usage.messageCount} msgs`;

  const report = [
    "# 2026-04-11 Windows Chrome PR Conversation / Usage Observability Report",
    "",
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    `- Web: \`${webURL}\``,
    `- Server: \`${serverURL}\``,
    "",
    "## Results",
    "",
    "### Check: TKT-39 review conversation / room-inbox-PR backlinks",
    `- API replay: \`pull_request_review(changes_requested)\` -> \`pull_request_review_comment\` -> replay dedupe -> \`pull_request_review_thread(resolved)\``,
    `- Observed: conversation IDs=\`${conversationIDs.join(", ")}\`, blocked inbox href=\`${settled.blockedItem.href}\`, PR detail related inbox count=\`${detail.relatedInbox.length}\``,
    `- Result: PASS. review comment、thread resolution、changes requested 已稳定回写到同一条 PR conversation ledger，Inbox 与 Room 统一深链到 PR workbench，而不是把人带离 review 上下文。`,
    "",
    "### Check: TKT-41 run / room / workspace usage observability",
    `- Browser path: \`/rooms/${roomID}?tab=run -> /runs/${runID} -> /settings\``,
    `- Observed: room usage=\`${roomUsageEvidence}\`, workspace usage=\`${workspaceUsageEvidence}\`, run status=\`${runUsageStatus}\`, settings usage=\`${settingsUsageEvidence}\`, retention=\`${retention}\``,
    `- Result: PASS. run / room / workspace 三层 usage、quota、retention 与 warning 已进入正式产品面，不再只藏在日志、默认值或 setup 侧栏。`,
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: \`${path.relative(projectRoot, item.path)}\``),
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
