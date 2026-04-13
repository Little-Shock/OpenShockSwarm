#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { accessSync, constants as fsConstants, createWriteStream, writeFileSync } from "node:fs";
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
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-movie-multi-agent-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");
const webDistDirName = ".next-e2e-movie-multi-agent";
const webDistDir = path.join(projectRoot, "apps", "web", webDistDirName);

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
await mkdir(webDistDir, { recursive: true });

const screenshots = [];
const checks = [];
const processes = [];
const daemonHits = [];

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function recordCheck(title, command, output) {
  checks.push({
    title,
    command,
    output,
    result: "PASS",
  });
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
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${timestamp()}] ${command} ${args.join(" ")}\n`);

  const child = spawn(command, args, {
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

async function waitFor(predicate, message, timeoutMs = 120_000, intervalMs = 400) {
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

function trimLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function extractTurnAgent(prompt) {
  const byTurn = prompt.match(/本轮响应：([^|\n]+)/);
  if (byTurn?.[1]) {
    return trimLine(byTurn[1]);
  }
  const byIdentity = prompt.match(/本轮请以 (.+?) 的身份回应/);
  if (byIdentity?.[1]) {
    return trimLine(byIdentity[1]);
  }
  return "";
}

function buildSyntheticResponse(prompt, streamed) {
  const turnAgent = extractTurnAgent(prompt);
  const isAutoFollowup = prompt.includes("你刚刚已经接住当前房间的正式交棒");
  const isSecondHumanTurn =
    prompt.includes("影片资料") ||
    prompt.includes("空状态") ||
    prompt.includes("收藏反馈") ||
    prompt.includes("验收点");

  if (turnAgent === "星野产品") {
    const output = [
      "SEND_PUBLIC_MESSAGE",
      "KIND: message",
      "CLAIM: keep",
      "BODY:",
      "我先把这条需求收紧一下：首屏要先让团队继续对话，电影搜索、影片详情、收藏入口都围着同一条工作流展开，不再拆成很多散页。",
      "第一版先做聊天优先的首页骨架，再把搜索、详情和收藏整理成一套稳定的信息结构，避免页面一上来就太满。",
      "OPENSHOCK_HANDOFF: agent-claude-review-runner | 电影网站信息结构 | 请把首页、搜索、详情、收藏和聊天工作台整理成一条清晰的信息结构。",
    ].join("\n");
    return {
      output,
      preview: "我先把需求边界收一下，先把聊天优先和电影工作流绑在一起。",
      streamed,
    };
  }

  if (turnAgent === "折光交互" && isAutoFollowup) {
    return {
      output:
        "我接手信息结构这条线。左栏保留频道和房间，中栏默认就是当前讨论和电影工作流，搜索直接放在中上方，不单独再做复杂总览。影片详情页保留海报、简介、演职员和讨论入口，收藏只做轻动作，不再扩成第二套管理页面。",
      preview: "我接手信息结构这条线，先把中栏、搜索和详情骨架收出来。",
      streamed: false,
    };
  }

  if (turnAgent === "折光交互" && isSecondHumanTurn) {
    const output = [
      "SEND_PUBLIC_MESSAGE",
      "KIND: message",
      "CLAIM: keep",
      "BODY:",
      "我先把交互补齐：搜索结果保留筛选和最近操作，详情页里要能直接回到当前讨论，收藏成功给即时反馈并允许撤销。",
      "这条线接下来更适合让内容策展把字段、空态和验收口径一次收平。",
      "OPENSHOCK_HANDOFF: agent-memory-clerk | 补齐影片资料与验收点 | 请整理电影字段、空状态、收藏反馈和首轮验收口径。",
    ].join("\n");
    return {
      output,
      preview: "我先把搜索、详情和收藏反馈收一下，然后转给内容策展补字段和验收。",
      streamed,
    };
  }

  if (turnAgent === "青岚策展") {
    return {
      output:
        "我接着把内容和验收口径收平。电影卡片至少要有海报、片名、年份、类型、评分、时长和一句简介；搜索空结果给明确建议，收藏成功要即时反馈并支持撤销。首轮验收先盯四件事：关键字段齐、搜索可回退、收藏有反馈、详情页还能回到当前讨论。",
      preview: "我来把电影字段、空态和收藏反馈收平。",
      streamed: false,
    };
  }

  return {
    output:
      "SEND_PUBLIC_MESSAGE\nKIND: summary\nCLAIM: keep\nBODY:\n当前多智能体场景已接通，这一轮没有额外变更。",
    preview: "当前多智能体场景已接通。",
    streamed,
  };
}

async function startSyntheticDaemon({ port, workspaceRoot }) {
  const worktreeRoot = path.join(workspaceRoot, ".openshock-worktrees");
  await mkdir(worktreeRoot, { recursive: true });

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      daemonHits.push(`[${timestamp()}] GET /healthz`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "movie-multi-agent-daemon" }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/runtime") {
      daemonHits.push(`[${timestamp()}] GET /v1/runtime`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          runtimeId: "shock-main",
          daemonUrl: `http://127.0.0.1:${port}`,
          machine: "shock-main",
          detectedCli: ["codex", "claude"],
          providers: [
            {
              id: "codex",
              label: "Codex CLI",
              mode: "direct-cli",
              capabilities: ["conversation", "stream", "non-interactive-exec"],
              models: ["gpt-5.3-codex", "gpt-5.1-codex-mini"],
              transport: "http bridge",
            },
            {
              id: "claude",
              label: "Claude Code CLI",
              mode: "direct-cli",
              capabilities: ["conversation", "stream", "non-interactive-exec"],
              models: ["claude-sonnet-4"],
              transport: "http bridge",
            },
          ],
          shell: "bash",
          state: "online",
          workspaceRoot,
          reportedAt: new Date().toISOString(),
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
      req.on("end", async () => {
        const payload = body ? JSON.parse(body) : {};
        const targetPath = path.join(worktreeRoot, payload.worktreeName || `wt-${Date.now()}`);
        await mkdir(targetPath, { recursive: true });
        daemonHits.push(
          `[${timestamp()}] POST /v1/worktrees/ensure branch=${trimLine(payload.branch)} worktree=${trimLine(
            payload.worktreeName
          )}`
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            workspaceRoot: payload.workspaceRoot || workspaceRoot,
            branch: payload.branch,
            worktreeName: payload.worktreeName,
            path: targetPath,
            created: true,
            baseRef: payload.baseRef || "HEAD",
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
        const response = buildSyntheticResponse(payload.prompt || "", false);
        daemonHits.push(
          `[${timestamp()}] POST /v1/exec provider=${trimLine(payload.provider)} agent=${extractTurnAgent(
            payload.prompt || ""
          )}`
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            provider: payload.provider || "codex",
            command: [payload.provider || "codex", "--synthetic"],
            output: response.output,
            duration: "0.5s",
          })
        );
      });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/exec/stream") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        const payload = body ? JSON.parse(body) : {};
        const response = buildSyntheticResponse(payload.prompt || "", true);
        daemonHits.push(
          `[${timestamp()}] POST /v1/exec/stream provider=${trimLine(payload.provider)} agent=${extractTurnAgent(
            payload.prompt || ""
          )}`
        );
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        const events = [
          { type: "start", provider: payload.provider || "codex", command: [payload.provider || "codex", "--synthetic"] },
          { type: "stdout", provider: payload.provider || "codex", delta: `${response.preview}\n` },
          { type: "done", provider: payload.provider || "codex", output: response.output, duration: "1.1s" },
        ];
        for (const event of events) {
          res.write(`${JSON.stringify(event)}\n`);
          await delay(180);
        }
        res.end();
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

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function fetchJSON(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${url} failed: ${response.status}`);
  }
  return payload;
}

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function waitForServerReady(webURL, serverURL) {
  await waitFor(async () => {
    const response = await fetch(`${serverURL}/healthz`);
    return response.ok;
  }, `server did not become healthy at ${serverURL}/healthz`);

  await waitFor(async () => {
    const response = await fetch(`${webURL}/setup`);
    return response.ok;
  }, `web did not become ready at ${webURL}/setup`);
}

async function startServices() {
  const workspaceRoot = path.join(artifactsDir, "workspace");
  const statePath = path.join(artifactsDir, "state.json");
  const webPort = await freePort();
  const serverPort = await freePort();
  const daemonPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const daemon = await startSyntheticDaemon({ port: daemonPort, workspaceRoot });
  const nodeOptions = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} --max-old-space-size=4096`
    : "--max-old-space-size=4096";
  const webEnv = {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    OPENSHOCK_CONTROL_API_BASE: serverURL,
    NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
    OPENSHOCK_NEXT_DIST_DIR: webDistDirName,
  };
  const buildLogPath = path.join(logsDir, "web-build.log");

  await mkdir(workspaceRoot, { recursive: true });
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
    throw new Error(`web build failed before headed movie scenario. See ${buildLogPath}`);
  }

  startProcess("server", path.join(projectRoot, "scripts", "go.sh"), ["run", "./cmd/openshock-server"], {
    cwd: path.join(projectRoot, "apps", "server"),
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
      OPENSHOCK_DAEMON_URL: daemon.url,
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

  await waitForServerReady(webURL, serverURL);
  return { webURL, serverURL, daemon };
}

async function pairRuntime(serverURL, daemonURL) {
  await fetchJSON(`${serverURL}/v1/runtime/pairing`, {
    method: "POST",
    body: JSON.stringify({
      runtimeId: "shock-main",
      daemonUrl: daemonURL,
    }),
  });
}

async function updateAgentPersona(serverURL, agentId, next) {
  const agent = await fetchJSON(`${serverURL}/v1/agents/${agentId}`, { cache: "no-store" });
  await fetchJSON(`${serverURL}/v1/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: next.name,
      role: next.role,
      avatar: agent.avatar,
      prompt: next.prompt,
      operatingInstructions: next.operatingInstructions,
      providerPreference: agent.providerPreference,
      modelPreference: agent.modelPreference,
      recallPolicy: agent.recallPolicy,
      runtimePreference: "shock-main",
      memorySpaces: agent.memorySpaces,
      credentialProfileIds: agent.credentialProfileIds ?? [],
    }),
  });
}

async function createMovieIssue(serverURL) {
  const payload = await fetchJSON(`${serverURL}/v1/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: "做一个电影网站",
      summary: "围绕聊天优先的协作体验，完成首页、搜索、影片详情和收藏入口的第一版多 Agent 方案。",
      owner: "星野产品",
      priority: "high",
    }),
  });
  return {
    roomId: payload.roomId,
    runId: payload.runId,
    sessionId: payload.sessionId,
  };
}

async function updateMemoryPolicy(serverURL) {
  await fetchJSON(`${serverURL}/v1/memory-center/policy`, {
    method: "POST",
    body: JSON.stringify({
      mode: "governed-first",
      includeRoomNotes: true,
      includeDecisionLedger: true,
      includeAgentMemory: true,
      includePromotedArtifacts: true,
      maxItems: 8,
    }),
  });
}

async function updateMemoryProviders(serverURL) {
  await fetchJSON(`${serverURL}/v1/memory-center/providers`, {
    method: "POST",
    body: JSON.stringify({
      providers: [
        {
          id: "workspace-file",
          kind: "workspace-file",
          label: "Workspace File Memory",
          enabled: true,
          readScopes: ["workspace", "issue-room", "room-notes", "decision-ledger", "agent", "promoted-ledger"],
          writeScopes: ["workspace", "issue-room", "room-notes", "decision-ledger", "agent"],
          recallPolicy: "governed-first",
          retentionPolicy: "保留版本、人工纠偏和提升 ledger。",
          sharingPolicy: "workspace-governed",
          summary: "Primary file-backed memory.",
        },
        {
          id: "search-sidecar",
          kind: "search-sidecar",
          label: "Search Sidecar",
          enabled: true,
          readScopes: ["workspace", "issue-room", "decision-ledger", "promoted-ledger"],
          writeScopes: [],
          recallPolicy: "search-on-demand",
          retentionPolicy: "短期 query cache。",
          sharingPolicy: "workspace-query-only",
          summary: "Use local recall index before full scan.",
        },
        {
          id: "external-persistent",
          kind: "external-persistent",
          label: "External Persistent Memory",
          enabled: true,
          readScopes: ["workspace", "agent", "user"],
          writeScopes: ["agent", "user"],
          recallPolicy: "promote-approved-only",
          retentionPolicy: "长期保留审核通过的 durable memory。",
          sharingPolicy: "explicit-share-only",
          summary: "Forward approved memories to an external durable sink.",
        },
      ],
    }),
  });
}

async function waitForVisibleText(page, text, message, timeoutMs = 30_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs }).catch(() => {
    throw new Error(message);
  });
}

async function waitForTestIdContains(page, testId, text, message, timeoutMs = 30_000) {
  await waitFor(
    async () => {
      const value = await page.getByTestId(testId).textContent();
      return String(value ?? "").includes(text);
    },
    message,
    timeoutMs,
    200
  );
}

async function waitForButtonLabel(page, testId, label, message, timeoutMs = 30_000) {
  await waitFor(async () => {
    const text = await page.getByTestId(testId).textContent();
    return String(text ?? "").includes(label);
  }, message, timeoutMs, 200);
}

async function waitForState(predicate, serverURL, message, timeoutMs = 60_000) {
  return waitFor(async () => {
    const state = await readState(serverURL);
    return (await predicate(state)) ? state : false;
  }, message, timeoutMs, 350);
}

function roomMessages(state, roomId) {
  return state.roomMessages?.[roomId] ?? [];
}

function mailboxByTitle(state, title) {
  return (state.mailbox ?? []).find((item) => item.title === title) ?? null;
}

function roomById(state, roomId) {
  return (state.rooms ?? []).find((item) => item.id === roomId) ?? null;
}

function runById(state, runId) {
  return (state.runs ?? []).find((item) => item.id === runId) ?? null;
}

function issueByRoom(state, roomId) {
  return (state.issues ?? []).find((item) => item.roomId === roomId) ?? null;
}

function roomHasLeak(state, roomId) {
  return roomMessages(state, roomId).some((message) =>
    String(message.message ?? "").includes("SEND_PUBLIC_MESSAGE") ||
    String(message.message ?? "").includes("OPENSHOCK_HANDOFF:")
  );
}

async function sendRoomMessage(page, roomId, prompt, expected) {
  await page.route(
    `**/v1/rooms/${roomId}/messages/stream`,
    async (route) => {
      await delay(900);
      await route.continue();
    },
    { times: 1 }
  );

  await page.getByTestId("room-message-input").fill(prompt);
  await waitForButtonLabel(page, "room-send-message", "发送", "room send button did not show idle state before submit");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/v1/rooms/${roomId}/messages/stream`),
    { timeout: 30_000 }
  );
  await page.getByTestId("room-message-input").press("Enter");

  await waitForVisibleText(page, prompt, `human room message did not appear immediately: ${prompt}`);
  await waitForVisibleText(page, "正在生成回复", "room placeholder did not appear while streaming");
  await waitForButtonLabel(page, "room-send-message", "发送中", "room send button did not expose sending state");

  const response = await responsePromise;
  assert(response.ok(), `room send response failed with status ${response.status()}`);

  for (const text of expected) {
    await waitForVisibleText(page, text, `expected room copy did not become visible: ${text}`, 60_000);
  }

  await waitForButtonLabel(page, "room-send-message", "发送", "room send button did not recover after streaming", 60_000);
}

let daemon = null;
let browser = null;
let context = null;
let page = null;

try {
  const services = await startServices();
  daemon = services.daemon;

  await pairRuntime(services.serverURL, daemon.url);
  recordCheck(
    "Pair Runtime",
    `POST ${services.serverURL}/v1/runtime/pairing`,
    `runtime shock-main paired to ${daemon.url}`
  );

  await updateAgentPersona(services.serverURL, "agent-codex-dockmaster", {
    name: "星野产品",
    role: "产品导演",
    prompt: "先收需求边界，再给最短可执行方向；公开回复只说客户看得懂的话。",
    operatingInstructions: "回复保持两到三句，先结论后下一步，不写心理活动。",
  });
  await updateAgentPersona(services.serverURL, "agent-claude-review-runner", {
    name: "折光交互",
    role: "交互架构师",
    prompt: "把页面骨架、信息结构和交互路径压到最简，不要分散注意力。",
    operatingInstructions: "公开回复只说当前判断和下一步，不写后台术语。",
  });
  await updateAgentPersona(services.serverURL, "agent-memory-clerk", {
    name: "青岚策展",
    role: "内容策展",
    prompt: "把内容字段、空状态、反馈文案和验收口径一次收平。",
    operatingInstructions: "回复短、准、可验收，不写系统旁白。",
  });
  recordCheck(
    "Patch Personas",
    `PATCH ${services.serverURL}/v1/agents/:id`,
    "星野产品 / 折光交互 / 青岚策展 三个 agent persona 已写入临时场景"
  );

  const created = await createMovieIssue(services.serverURL);
  recordCheck(
    "Create Movie Issue",
    `POST ${services.serverURL}/v1/issues`,
    `room=${created.roomId} run=${created.runId} session=${created.sessionId}`
  );

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1480, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${services.webURL}/rooms/${created.roomId}`, { waitUntil: "load" });
  await page.getByTestId("room-message-input").waitFor({ state: "visible" });
  await capture(page, "room-movie-initial");

  const firstPrompt =
    "我们要做一个电影网站，参考 slock 的聊天感。先把需求边界收紧，再安排合适的人继续推进首页、搜索、影片详情和收藏。";
  await sendRoomMessage(page, created.roomId, firstPrompt, [
    "首屏要先让团队继续对话",
    "左栏保留频道和房间",
  ]);

  const stateAfterFirstTurn = await waitForState(
    async (state) => {
      const handoff = mailboxByTitle(state, "电影网站信息结构");
      const room = roomById(state, created.roomId);
      const run = runById(state, created.runId);
      const issue = issueByRoom(state, created.roomId);
      return (
        Boolean(handoff) &&
        handoff.status === "acknowledged" &&
        room?.topic?.owner === "折光交互" &&
        run?.owner === "折光交互" &&
        issue?.owner === "折光交互"
      );
    },
    services.serverURL,
    "first multi-agent handoff did not settle to 折光交互"
  );
  assert(!roomHasLeak(stateAfterFirstTurn, created.roomId), "room leaked handoff or envelope protocol after first turn");
  recordCheck(
    "First Room Turn",
    `POST ${services.serverURL}/v1/rooms/${created.roomId}/messages/stream`,
    "星野产品公开收需求，随后自动交棒给折光交互；room/run/issue owner 同步切换，且房间未泄露内部协议"
  );
  await capture(page, "room-after-first-turn");

  const secondPrompt = "继续把影片资料、搜索空状态、收藏反馈和首轮验收点收一下。";
  await sendRoomMessage(page, created.roomId, secondPrompt, [
    "搜索结果保留筛选和最近操作",
    "电影卡片至少要有海报、片名、年份",
  ]);

  const stateAfterSecondTurn = await waitForState(
    async (state) => {
      const handoff = mailboxByTitle(state, "补齐影片资料与验收点");
      const room = roomById(state, created.roomId);
      const run = runById(state, created.runId);
      const issue = issueByRoom(state, created.roomId);
      return (
        Boolean(handoff) &&
        handoff.status === "acknowledged" &&
        room?.topic?.owner === "青岚策展" &&
        run?.owner === "青岚策展" &&
        issue?.owner === "青岚策展"
      );
    },
    services.serverURL,
    "second multi-agent handoff did not settle to 青岚策展"
  );
  assert(!roomHasLeak(stateAfterSecondTurn, created.roomId), "room leaked handoff or envelope protocol after second turn");
  const uniqueSpeakers = new Set(roomMessages(stateAfterSecondTurn, created.roomId).map((item) => item.speaker));
  assert(uniqueSpeakers.has("星野产品"), "room did not retain 星野产品 public message");
  assert(uniqueSpeakers.has("折光交互"), "room did not retain 折光交互 public message");
  assert(uniqueSpeakers.has("青岚策展"), "room did not retain 青岚策展 public message");
  recordCheck(
    "Second Room Turn",
    `POST ${services.serverURL}/v1/rooms/${created.roomId}/messages/stream`,
    "折光交互继续补交互，再自动交棒给青岚策展；三位 agent 都在同一条房间公开发言，owner 继续前滚"
  );
  await capture(page, "room-after-second-turn");

  await updateMemoryPolicy(services.serverURL);
  await updateMemoryProviders(services.serverURL);

  await page.goto(`${services.webURL}/memory`, { waitUntil: "load" });
  await page.getByTestId("memory-preview-session").waitFor({ state: "visible" });
  await page.getByTestId("memory-preview-session").selectOption(created.sessionId);
  await page.getByTestId("memory-preview-provider-search-sidecar").waitFor({ state: "visible" });
  await page.getByTestId("memory-preview-provider-external-persistent").waitFor({ state: "visible" });
  await waitForTestIdContains(page, "memory-preview-summary", "青岚策展", "memory preview did not switch to 青岚策展");
  await waitForTestIdContains(
    page,
    "memory-preview-summary",
    "把内容字段、空状态、反馈文案和验收口径一次收平。",
    "memory preview did not surface 青岚策展 prompt scaffold"
  );
  await waitForTestIdContains(page, "memory-preview-summary", "Search Sidecar", "memory preview missing search provider");
  await waitForTestIdContains(
    page,
    "memory-preview-summary",
    "External Persistent Memory",
    "memory preview missing external provider"
  );
  assert(
    !String(await page.getByTestId("memory-preview-summary").textContent()).includes("把页面骨架、信息结构和交互路径压到最简"),
    "memory preview should not fall back to stale 折光交互 prompt scaffold"
  );
  recordCheck(
    "Memory Preview Continuity",
    `GET ${services.webURL}/memory`,
    `session ${created.sessionId} 的 next-run preview 已切到青岚策展，并带出 Search/External provider note`
  );
  await capture(page, "memory-preview-final-owner");

  await page.reload({ waitUntil: "load" });
  await page.getByTestId("memory-preview-session").waitFor({ state: "visible" });
  await page.getByTestId("memory-preview-session").selectOption(created.sessionId);
  await waitForTestIdContains(page, "memory-preview-summary", "青岚策展", "memory preview lost 青岚策展 after reload");
  await waitForTestIdContains(page, "memory-preview-summary", "Search Sidecar", "memory preview lost search provider after reload");
  await waitForTestIdContains(
    page,
    "memory-preview-summary",
    "External Persistent Memory",
    "memory preview lost external provider after reload"
  );
  recordCheck(
    "Memory Preview Reload",
    `reload ${services.webURL}/memory`,
    `reload 后同一 session preview 仍锚定青岚策展，并保留 provider binding 与异常提示`
  );
  await capture(page, "memory-preview-reload");

  const firstHandoff = mailboxByTitle(stateAfterSecondTurn, "电影网站信息结构");
  const secondHandoff = mailboxByTitle(stateAfterSecondTurn, "补齐影片资料与验收点");
  assert(firstHandoff?.id, "first handoff missing after second turn");
  assert(secondHandoff?.id, "second handoff missing after second turn");

  await page.goto(`${services.webURL}/mailbox?roomId=${created.roomId}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-card-${firstHandoff.id}`).waitFor({ state: "visible" });
  await page.getByTestId(`mailbox-card-${secondHandoff.id}`).waitFor({ state: "visible" });
  assert(
    trimLine(await page.getByTestId(`mailbox-status-${firstHandoff.id}`).textContent()) === "处理中",
    "first mailbox handoff did not render as acknowledged"
  );
  assert(
    trimLine(await page.getByTestId(`mailbox-status-${secondHandoff.id}`).textContent()) === "处理中",
    "second mailbox handoff did not render as acknowledged"
  );
  recordCheck(
    "Mailbox Walkthrough",
    `GET ${services.webURL}/mailbox?roomId=${created.roomId}`,
    "Mailbox 页面能直接看到两条自动交接，状态都已前滚到“处理中”"
  );
  await capture(page, "mailbox-movie-handoffs");

  await page.goto(`${services.webURL}/rooms/${created.roomId}?tab=context`, { waitUntil: "load" });
  await page.getByTestId("room-workbench-topic-owner-profile").waitFor({ state: "visible" });
  await waitForVisibleText(page, "青岚策展", "room context did not expose the final topic owner");
  recordCheck(
    "Room Context Owner",
    `GET ${services.webURL}/rooms/${created.roomId}?tab=context`,
    "讨论间右侧上下文里的当前 owner 已更新为青岚策展"
  );
  await capture(page, "room-context-final-owner");

  const report = [
    "# Headed Movie Site Multi-Agent Report",
    "",
    `- Generated at: ${timestamp()}`,
    `- Web URL: ${services.webURL}`,
    `- Control URL: ${services.serverURL}`,
    `- Synthetic Daemon: ${daemon.url}`,
    `- Room ID: ${created.roomId}`,
    "",
    "## Verification",
    "",
    ...checks.flatMap((item) => [
      `### Check: ${item.title}`,
      "**Command run:**",
      `  ${item.command}`,
      "**Output observed:**",
      `  ${item.output}`,
      `**Result: ${item.result}**`,
      "",
    ]),
    "### Check: Protocol Leak Probe",
    "**Command run:**",
    `  inspect ${services.serverURL}/v1/state roomMessages for ${created.roomId}`,
    "**Output observed:**",
    "  room public messages contain星野产品 / 折光交互 / 青岚策展的正文，但不包含 SEND_PUBLIC_MESSAGE 或 OPENSHOCK_HANDOFF: protocol lines",
    "**Result: PASS**",
    "",
    "## Daemon Hits",
    "",
    ...daemonHits.map((item) => `- ${item}`),
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
    "VERDICT: PASS",
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const report = [
    "# Headed Movie Site Multi-Agent Report",
    "",
    `- Generated at: ${timestamp()}`,
    "",
    "## Failure",
    `- ${message}`,
    "",
    "## Partial Daemon Hits",
    "",
    ...daemonHits.map((item) => `- ${item}`),
    "",
    "VERDICT: FAIL",
    "",
  ].join("\n");
  await writeFile(reportPath, report, "utf8");
  console.error(message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
  await daemon?.close?.();
}
