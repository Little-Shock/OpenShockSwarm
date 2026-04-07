#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, createWriteStream } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceBaseBranch = process.env.OPENSHOCK_TKT06_SOURCE_BASE_BRANCH?.trim() || "dev/openshock-20260407-next";
const repoRemoteURL = process.env.OPENSHOCK_TKT06_REPO_URL?.trim() || "https://github.com/Larkspur-Wang/OpenShock.git";
const repoName = process.env.OPENSHOCK_TKT06_REPO?.trim() || "Larkspur-Wang/OpenShock";
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), "openshock-tkt06-remote-pr-loop-")));
const artifactsDir = path.resolve(evidenceRoot);
const parsedArgs = parseArgs(process.argv.slice(2));
const reportPath = parsedArgs.reportPath ? path.resolve(projectRoot, parsedArgs.reportPath) : path.join(artifactsDir, "report.md");
const scenarios = [
  { key: "happy", label: "Authenticated Safe Remote PR Loop", noAuth: false },
  { key: "no-auth", label: "No-Auth Failure Probe", noAuth: true },
];

const processes = [];
const screenshots = [];

await mkdir(artifactsDir, { recursive: true });

function parseArgs(args) {
  const result = { reportPath: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--report") {
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

async function runCommand(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env, allowFailure = false } = options;
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
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
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

  processes.push({ child, logPath });
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
    // process already exited
  }
}

async function cleanupProcesses() {
  await Promise.allSettled(processes.map((entry) => stopProcess(entry.child)));
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
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

async function capture(page, scenarioKey, screenshotsDir, name) {
  const filePath = path.join(
    screenshotsDir,
    `${String(screenshots.length + 1).padStart(2, "0")}-${scenarioKey}-${name}.png`
  );
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ scenario: scenarioKey, name, path: filePath });
  return filePath;
}

async function prepareWorkspace(workspaceDir, safeBaseBranch) {
  await runCommand("git", ["clone", "--shared", projectRoot, workspaceDir]);
  await runCommand("git", ["-C", workspaceDir, "remote", "set-url", "origin", repoRemoteURL]);
  await runCommand("git", ["-C", workspaceDir, "fetch", "origin", sourceBaseBranch]);
  await runCommand("git", ["-C", workspaceDir, "checkout", "-B", safeBaseBranch, `origin/${sourceBaseBranch}`]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.name", "OpenShock TKT-06 Harness"]);
  await runCommand("git", ["-C", workspaceDir, "config", "user.email", "openshock-tkt06@example.com"]);
  await runCommand("git", ["-C", workspaceDir, "push", "-u", "origin", safeBaseBranch]);
}

async function remoteBranchExists(workspaceDir, branch) {
  const result = await runCommand("git", ["-C", workspaceDir, "ls-remote", "--heads", "origin", branch], {
    allowFailure: true,
  });
  return Boolean(result.stdout.trim());
}

async function deleteRemoteBranch(workspaceDir, branch) {
  if (!branch) {
    return false;
  }
  if (!(await remoteBranchExists(workspaceDir, branch))) {
    return false;
  }
  await runCommand("git", ["-C", workspaceDir, "push", "origin", "--delete", branch], {
    allowFailure: true,
  });
  return !(await remoteBranchExists(workspaceDir, branch));
}

async function fetchState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`);
}

function findScenarioObjects(state, issueTitle) {
  const issue = state.issues.find((item) => item.title === issueTitle) ?? null;
  const room = issue ? state.rooms.find((item) => item.id === issue.roomId) ?? null : null;
  const run = room ? state.runs.find((item) => item.id === room.runId) ?? null : null;
  const session = room ? state.sessions.find((item) => item.roomId === room.id) ?? null : null;
  const pullRequest = room ? state.pullRequests.find((item) => item.roomId === room.id) ?? null : null;
  return { issue, room, run, session, pullRequest };
}

async function waitForScenarioObjects(serverURL, issueTitle) {
  return waitFor(async () => {
    const state = await fetchState(serverURL);
    const found = findScenarioObjects(state, issueTitle);
    if (found.issue && found.room && found.run && found.session) {
      return { state, ...found };
    }
    return false;
  }, `scenario objects for ${issueTitle} never appeared in /v1/state`);
}

async function createEmptyCommit(worktreePath, label) {
  await runCommand("git", ["-C", worktreePath, "config", "user.name", "OpenShock TKT-06 Harness"]);
  await runCommand("git", ["-C", worktreePath, "config", "user.email", "openshock-tkt06@example.com"]);
  await runCommand("git", ["-C", worktreePath, "commit", "--allow-empty", "-m", label]);
  const result = await runCommand("git", ["-C", worktreePath, "rev-parse", "--short", "HEAD"]);
  return result.stdout.trim();
}

async function readRemotePullRequest(number) {
  const result = await runCommand("gh", [
    "pr",
    "view",
    String(number),
    "--repo",
    repoName,
    "--json",
    "number,url,state,headRefName,baseRefName,reviewDecision,isDraft,mergedAt",
  ]);
  return JSON.parse(result.stdout);
}

async function startScenarioServices(scenario, scenarioDir, workspaceDir) {
  const logsDir = path.join(scenarioDir, "logs");
  await mkdir(logsDir, { recursive: true });

  const webPort = await freePort();
  const serverPort = await freePort();
  const daemonPort = await freePort();
  const webURL = `http://127.0.0.1:${webPort}`;
  const serverURL = `http://127.0.0.1:${serverPort}`;
  const daemonURL = `http://127.0.0.1:${daemonPort}`;
  const statePath = path.join(scenarioDir, "state.json");
  const ghConfigDir = scenario.noAuth ? await mkdtemp(path.join(os.tmpdir(), "openshock-tkt06-gh-empty-")) : "";
  const sharedEnv = {
    ...process.env,
    ...(scenario.noAuth
      ? {
          GH_CONFIG_DIR: ghConfigDir,
          GH_TOKEN: "",
          GITHUB_TOKEN: "",
          GIT_TERMINAL_PROMPT: "0",
        }
      : {}),
  };

  startProcess(
    `${scenario.key}-daemon`,
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
        ...sharedEnv,
        OPENSHOCK_DAEMON_HEARTBEAT_INTERVAL: "1s",
        OPENSHOCK_DAEMON_HEARTBEAT_TIMEOUT: "10s",
      },
      logPath: path.join(logsDir, "daemon.log"),
    }
  );

  startProcess(
    `${scenario.key}-server`,
    path.join(projectRoot, "scripts", "go.sh"),
    ["run", "./cmd/openshock-server"],
    {
      cwd: path.join(projectRoot, "apps", "server"),
      env: {
        ...sharedEnv,
        OPENSHOCK_SERVER_ADDR: `127.0.0.1:${serverPort}`,
        OPENSHOCK_DAEMON_URL: daemonURL,
        OPENSHOCK_WORKSPACE_ROOT: workspaceDir,
        OPENSHOCK_STATE_FILE: statePath,
      },
      logPath: path.join(logsDir, "server.log"),
    }
  );

  startProcess(
    `${scenario.key}-web`,
    "pnpm",
    ["--dir", "apps/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: projectRoot,
      env: {
        ...sharedEnv,
        NEXT_PUBLIC_OPENSHOCK_API_BASE: serverURL,
      },
      logPath: path.join(logsDir, "web.log"),
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

  await waitFor(async () => {
    const state = await fetchState(serverURL);
    return Array.isArray(state.runtimes) && state.runtimes.length > 0;
  }, `runtime heartbeats never appeared in ${serverURL}/v1/state`);

  return { webURL, serverURL, daemonURL, statePath, ghConfigDir, logsDir };
}

async function runScenario(scenario) {
  const now = Date.now();
  const scenarioDir = path.join(artifactsDir, scenario.key);
  const screenshotsDir = path.join(scenarioDir, "screenshots");
  const workspaceDir = path.join(scenarioDir, "workspace");
  const safeBaseBranch = `sandbox/tkt06-${scenario.key}-${now}`;
  const issueTitle = `TKT-06 ${scenario.key} remote PR loop ${now}`;
  const issueSummary = scenario.noAuth
    ? "Drive browser create PR failure and verify the failure stays visible."
    : "Drive browser create / merge against a safe remote sandbox branch.";
  const commitMessage = `test(tkt-06): ${scenario.key} remote pr probe`;

  await mkdir(screenshotsDir, { recursive: true });
  await prepareWorkspace(workspaceDir, safeBaseBranch);

  let browser = null;
  let context = null;
  let page = null;
  let runBranch = "";
  let pullRequestNumber = 0;
  let cleanupHeadDeleted = false;
  let cleanupBaseDeleted = false;
  let worktreePath = "";
  const processStartIndex = processes.length;

  try {
    const services = await startScenarioServices(scenario, scenarioDir, workspaceDir);
    const chromiumExecutable = resolveChromiumExecutable();

    browser = await chromium.launch({
      executablePath: chromiumExecutable,
      headless: false,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
    });
    page = await context.newPage();

    await page.goto(`${services.webURL}/setup`, { waitUntil: "load" });
    await page.locator('[data-testid="setup-repo-binding"]').waitFor({ state: "visible" });
    await capture(page, scenario.key, screenshotsDir, "setup-initial");

    await page.getByTestId("setup-repo-bind-button").click();
    await page.waitForFunction(
      (expectedBranch) =>
        document.querySelector('[data-testid="setup-repo-binding-branch"]')?.textContent?.trim() === expectedBranch,
      safeBaseBranch,
      { timeout: 30_000 }
    );
    const boundBranch = (await page.getByTestId("setup-repo-binding-branch").textContent())?.trim() ?? "";
    assert(
      boundBranch === safeBaseBranch,
      `expected repo binding branch ${safeBaseBranch}, got ${boundBranch || "<empty>"}`
    );

    await page.getByTestId("setup-github-refresh-button").click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="setup-github-message"]')?.textContent || "").trim().length > 0,
      undefined,
      { timeout: 30_000 }
    );

    const readinessStatus = (await page.getByTestId("setup-github-readiness-status").textContent())?.trim() ?? "";
    const readinessMessage = (await page.getByTestId("setup-github-message").textContent())?.trim() ?? "";
    await capture(page, scenario.key, screenshotsDir, "setup-bound");

    if (scenario.noAuth) {
      assert(readinessStatus === "仅本地闭环", `expected no-auth readiness to be 仅本地闭环, got ${readinessStatus}`);
    } else {
      assert(readinessStatus === "可进远端 PR", `expected readiness to be 可进远端 PR, got ${readinessStatus}`);
    }

    await page.goto(`${services.webURL}/board`, { waitUntil: "load" });
    await page.getByTestId("board-create-issue-title").fill(issueTitle);
    await page.getByTestId("board-create-issue-summary").fill(issueSummary);
    await page.getByTestId("board-create-issue-submit").click();
    await page.waitForURL(/\/rooms\//, { timeout: 30_000 });
    await page.getByTestId("room-pull-request-action").waitFor({ state: "visible" });
    await capture(page, scenario.key, screenshotsDir, "room-ready");

    const created = await waitForScenarioObjects(services.serverURL, issueTitle);
    runBranch = created.run.branch;
    worktreePath = created.session.worktreePath;
    assert(worktreePath, "expected created session to expose a worktree path");

    const commitSha = await createEmptyCommit(worktreePath, commitMessage);

    await page.getByTestId("room-pull-request-action").click();

    if (scenario.noAuth) {
      const errorText = await page.waitForFunction(
        () => document.querySelector('[data-testid="room-pull-request-error"]')?.textContent?.trim() || false,
        undefined,
        { timeout: 30_000 }
      );
      const visibleError = String(await errorText.jsonValue());
      assert(visibleError.length > 0, "expected room PR error to stay visible");
      await capture(page, scenario.key, screenshotsDir, "room-pr-failure");

      const blocked = await waitFor(async () => {
        const state = await fetchState(services.serverURL);
        const found = findScenarioObjects(state, issueTitle);
        const blockedInbox = state.inbox.find(
          (item) => item.kind === "blocked" && item.href.includes(found.room?.id || "")
        );
        const blockedMessage = (state.roomMessages[found.room?.id || ""] || []).find((item) =>
          item.message.includes("GitHub PR 创建失败")
        );
        if (found.issue?.state === "blocked" && found.run?.status === "blocked" && blockedInbox && blockedMessage) {
          return { state, blockedInbox, blockedMessage, ...found };
        }
        return false;
      }, `expected ${scenario.key} scenario to surface a blocked failure state`);

      cleanupHeadDeleted = await deleteRemoteBranch(workspaceDir, runBranch);
      cleanupBaseDeleted = await deleteRemoteBranch(workspaceDir, safeBaseBranch);

      return {
        key: scenario.key,
        label: scenario.label,
        readinessStatus,
        readinessMessage,
        safeBaseBranch,
        issueKey: blocked.issue.key,
        roomID: blocked.room.id,
        runID: blocked.run.id,
        runBranch,
        worktreePath,
        commitSha,
        visibleError,
        blockedInboxTitle: blocked.blockedInbox.title,
        blockedRoomMessage: blocked.blockedMessage.message,
        remoteBranchDeleted: cleanupHeadDeleted,
        safeBaseDeleted: cleanupBaseDeleted,
      };
    }

    const createdPullRequest = await waitFor(async () => {
      const state = await fetchState(services.serverURL);
      const found = findScenarioObjects(state, issueTitle);
      if (found.pullRequest && found.pullRequest.number > 0) {
        return { state, ...found };
      }
      return false;
    }, `expected ${scenario.key} scenario to create a remote pull request`);
    pullRequestNumber = createdPullRequest.pullRequest.number;

    const remoteOpen = await readRemotePullRequest(pullRequestNumber);
    assert(remoteOpen.state === "OPEN", `expected remote PR to be OPEN, got ${remoteOpen.state}`);
    assert(
      remoteOpen.baseRefName === safeBaseBranch,
      `expected remote PR base ${safeBaseBranch}, got ${remoteOpen.baseRefName}`
    );
    assert(
      remoteOpen.headRefName === runBranch,
      `expected remote PR head ${runBranch}, got ${remoteOpen.headRefName}`
    );
    await capture(page, scenario.key, screenshotsDir, "room-pr-created");

    await page.getByTestId("room-pull-request-action").click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="room-pull-request-status"]')?.textContent?.includes("已合并"),
      undefined,
      { timeout: 60_000 }
    );
    await capture(page, scenario.key, screenshotsDir, "room-pr-merged");

    const mergedState = await waitFor(async () => {
      const state = await fetchState(services.serverURL);
      const found = findScenarioObjects(state, issueTitle);
      if (
        found.issue?.state === "done" &&
        found.run?.status === "done" &&
        found.pullRequest?.status === "merged"
      ) {
        return { state, ...found };
      }
      return false;
    }, `expected ${scenario.key} scenario to propagate merged state back to room/run/issue`);

    const remoteMerged = await readRemotePullRequest(pullRequestNumber);
    assert(remoteMerged.state === "MERGED", `expected remote PR to be MERGED, got ${remoteMerged.state}`);

    cleanupHeadDeleted = await deleteRemoteBranch(workspaceDir, runBranch);
    cleanupBaseDeleted = await deleteRemoteBranch(workspaceDir, safeBaseBranch);

    return {
      key: scenario.key,
      label: scenario.label,
      readinessStatus,
      readinessMessage,
      safeBaseBranch,
      issueKey: mergedState.issue.key,
      roomID: mergedState.room.id,
      runID: mergedState.run.id,
      runBranch,
      worktreePath,
      commitSha,
      pullRequestNumber,
      pullRequestURL: remoteOpen.url,
      remoteOpenState: remoteOpen.state,
      remoteMergedState: remoteMerged.state,
      remoteMergedAt: remoteMerged.mergedAt,
      remoteBranchDeleted: cleanupHeadDeleted,
      safeBaseDeleted: cleanupBaseDeleted,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }

    if (!cleanupHeadDeleted && runBranch) {
      await deleteRemoteBranch(workspaceDir, runBranch).catch(() => {});
    }
    if (!cleanupBaseDeleted) {
      await deleteRemoteBranch(workspaceDir, safeBaseBranch).catch(() => {});
    }

    const scenarioProcesses = processes.splice(processStartIndex);
    await Promise.allSettled(scenarioProcesses.map((entry) => stopProcess(entry.child)));
  }
}

function buildReport(results) {
  const lines = [
    "# TKT-06 Remote PR Browser Loop Report",
    "",
    `- Command: \`pnpm test:headed-remote-pr-loop${parsedArgs.reportPath ? ` -- --report ${parsedArgs.reportPath}` : ""}\``,
    `- Repo: \`${repoName}\``,
    `- Source Base Branch: \`${sourceBaseBranch}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Scenario Results",
    "",
  ];

  for (const result of results) {
    lines.push(`### ${result.label}`);
    lines.push("");
    lines.push(`- GitHub Readiness Status: ${result.readinessStatus}`);
    lines.push(`- GitHub Message: ${result.readinessMessage}`);
    lines.push(`- Safe Base Branch: ${result.safeBaseBranch}`);
    lines.push(`- Issue / Room / Run: ${result.issueKey} / ${result.roomID} / ${result.runID}`);
    lines.push(`- Run Branch: ${result.runBranch}`);
    lines.push(`- Worktree Path: ${result.worktreePath}`);
    lines.push(`- Commit SHA: ${result.commitSha}`);
    if (result.pullRequestNumber) {
      lines.push(`- PR: #${result.pullRequestNumber} (${result.pullRequestURL})`);
      lines.push(`- Remote State: ${result.remoteOpenState} -> ${result.remoteMergedState}`);
      lines.push(`- Remote Merged At: ${result.remoteMergedAt || "n/a"}`);
    }
    if (result.visibleError) {
      lines.push(`- Visible Error: ${result.visibleError}`);
      lines.push(`- Blocked Inbox: ${result.blockedInboxTitle}`);
      lines.push(`- Blocked Room Message: ${result.blockedRoomMessage}`);
    }
    lines.push(`- Remote Head Branch Cleanup: ${result.remoteBranchDeleted ? "PASS" : "SKIPPED/FAILED"}`);
    lines.push(`- Safe Base Branch Cleanup: ${result.safeBaseDeleted ? "PASS" : "SKIPPED/FAILED"}`);
    lines.push("");
  }

  lines.push("## Screenshots");
  lines.push("");
  lines.push(...screenshots.map((item) => `- ${item.scenario} / ${item.name}: ${item.path}`));
  lines.push("");
  lines.push("## Conclusions");
  lines.push("");
  lines.push("- `TC-016` 现在有真实远端 PR create / merge browser-level exact evidence，且使用临时 safe base branch 避免污染长期分支。");
  lines.push("- failure probe 证明 room 里的 PR create 失败不再静默吞掉：前台会显示错误，同时 state / inbox / room message 都进入 blocked surface。");
  lines.push("- `TC-015` 仍然不是这条票的收口对象；installation-complete live webhook callback 继续留给后续远端票。");
  return `${lines.join("\n")}\n`;
}

try {
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const report = buildReport(results);
  await writeFile(reportPath, report);
  await writeFile(path.join(artifactsDir, "summary.json"), JSON.stringify({ results, screenshots }, null, 2));
  console.log(report);
} catch (error) {
  const summary = [
    "# TKT-06 Remote PR Browser Loop Report",
    "",
    `- Status: FAIL`,
    `- Error: ${error instanceof Error ? error.message : String(error)}`,
    `- Artifacts Dir: ${artifactsDir}`,
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.scenario} / ${item.name}: ${item.path}`),
    "",
  ].join("\n");
  await writeFile(reportPath, `${summary}\n`);
  console.error(summary);
  process.exitCode = 1;
} finally {
  await cleanupProcesses();
}
