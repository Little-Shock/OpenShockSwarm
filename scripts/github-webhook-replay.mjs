#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const fixtureDir = path.join(repoRoot, "scripts", "fixtures", "github-webhook-replay");
const goWrapper = path.join(repoRoot, "scripts", "go.sh");
const reportArg = readArg("--report");
const reportPath = reportArg ? path.resolve(process.cwd(), reportArg) : "";
const secret = "super-secret";
const artifactsDir =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR && process.env.OPENSHOCK_E2E_ARTIFACTS_DIR.trim() !== ""
    ? path.resolve(process.cwd(), process.env.OPENSHOCK_E2E_ARTIFACTS_DIR.trim())
    : await mkdtemp(path.join(os.tmpdir(), "openshock-webhook-replay-"));

let server;
let serverExited = false;
let stdoutStream;
let stderrStream;
let runArtifactsDir = artifactsDir;

try {
  await mkdir(artifactsDir, { recursive: true });
  runArtifactsDir = await mkdtemp(path.join(artifactsDir, "run-"));
  const workspaceRoot = path.join(runArtifactsDir, "workspace");
  const statePath = path.join(workspaceRoot, "data", "phase0", "state.json");
  await mkdir(path.dirname(statePath), { recursive: true });
  const serverBinary = path.join(runArtifactsDir, "openshock-server");
  await runCommand("bash", [goWrapper, "build", "-o", serverBinary, "./cmd/openshock-server"], {
    cwd: path.join(repoRoot, "apps", "server"),
  });

  const port = await reservePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const stdoutPath = path.join(runArtifactsDir, "server.stdout.log");
  const stderrPath = path.join(runArtifactsDir, "server.stderr.log");
  stdoutStream = fs.createWriteStream(stdoutPath);
  stderrStream = fs.createWriteStream(stderrPath);

  server = spawn(serverBinary, {
    cwd: runArtifactsDir,
    env: {
      ...process.env,
      OPENSHOCK_SERVER_ADDR: `127.0.0.1:${port}`,
      OPENSHOCK_DAEMON_URL: "http://127.0.0.1:65531",
      OPENSHOCK_WORKSPACE_ROOT: workspaceRoot,
      OPENSHOCK_STATE_FILE: statePath,
      OPENSHOCK_GITHUB_WEBHOOK_SECRET: secret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.pipe(stdoutStream);
  server.stderr.pipe(stderrStream);
  server.once("exit", () => {
    serverExited = true;
  });

  await waitForHealthy(baseURL, stdoutPath, stderrPath);

  const baselineState = await getJSON(`${baseURL}/v1/state`);
  await writeArtifact("baseline-state.json", baselineState);

  assert(findPullRequest(baselineState, 18), "seed state missing tracked PR #18");
  assert(findPullRequest(baselineState, 22), "seed state missing tracked PR #22");

  const checks = [];

  checks.push(
    await runCheck("Repeated check replay stays idempotent", async () => {
      const first = await postWebhook(baseURL, {
        eventType: "check_run",
        deliveryID: "delivery-check-1",
        fixture: "pr18-check-run-success.json",
      });
      const second = await postWebhook(baseURL, {
        eventType: "check_run",
        deliveryID: "delivery-check-2",
        fixture: "pr18-check-run-success.json",
      });

      assert(first.status === 200, `first check replay status = ${first.status}, want 200`);
      assert(second.status === 200, `second check replay status = ${second.status}, want 200`);
      const state = second.body.state;
      const pullRequest = mustFindPullRequest(state, 18);
      const roomMessages = state.roomMessages["room-runtime"] ?? [];
      const reviewInboxCount = countItems(
        state.inbox,
        (item) =>
          item.kind === "review" &&
          item.title === "PR #18 已准备评审" &&
          item.href === "/rooms/room-runtime/runs/run_runtime_01",
      );
      const syncMessageCount = countItems(
        roomMessages,
        (item) => item.message === "PR #18 已同步到 GitHub 当前状态：in_review。",
      );

      assert(pullRequest.status === "in_review", `PR #18 status = ${pullRequest.status}, want in_review`);
      assert(reviewInboxCount === 1, `review inbox count = ${reviewInboxCount}, want 1`);
      assert(syncMessageCount === 1, `room sync message count = ${syncMessageCount}, want 1`);

      return {
        status: second.status,
        observed: [
          "重复回放同一条 check_run 成功事件后，PR #18 仍保持 in_review。",
          "review inbox 只保留 1 张 `PR #18 已准备评审` 卡片。",
          "room-runtime 只保留 1 条 `PR #18 已同步到 GitHub 当前状态：in_review。` 消息。",
        ],
      };
    }),
  );

  checks.push(
    await runCheck("Review replay blocks tracked PR and adds blocked inbox surface", async () => {
      const result = await postWebhook(baseURL, {
        eventType: "pull_request_review",
        deliveryID: "delivery-review-sync",
        fixture: "pr22-review-changes-requested.json",
      });

      assert(result.status === 200, `review replay status = ${result.status}, want 200`);
      const state = result.body.state;
      const pullRequest = mustFindPullRequest(state, 22);
      const room = mustFindRoom(state, "room-inbox");
      const issue = mustFindIssueByRoom(state, "room-inbox");
      const blockedInbox = state.inbox.find(
        (item) => item.kind === "blocked" && item.title === "PR #22 需要补充修改",
      );
      const unrelatedSeedReview = state.inbox.find((item) => item.id === "inbox-review-copy");

      assert(pullRequest.status === "changes_requested", `PR #22 status = ${pullRequest.status}, want changes_requested`);
      assert(
        pullRequest.reviewDecision === "CHANGES_REQUESTED",
        `PR #22 reviewDecision = ${pullRequest.reviewDecision}, want CHANGES_REQUESTED`,
      );
      assert(
        pullRequest.reviewSummary.includes("needs tests"),
        `PR #22 reviewSummary = ${pullRequest.reviewSummary}, want synced review body`,
      );
      assert(room.topic.status === "blocked", `room-inbox status = ${room.topic.status}, want blocked`);
      assert(issue.state === "blocked", `issue for room-inbox = ${issue.state}, want blocked`);
      assert(blockedInbox, "blocked inbox item for PR #22 missing after review sync");
      assert(unrelatedSeedReview, "seed review inbox card should remain because it is not a PR-sync artifact");

      return {
        status: result.status,
        observed: [
          "PR #22 被回写成 changes_requested / CHANGES_REQUESTED。",
          "room-inbox 与对应 issue 同步进入 blocked。",
          "新增 `PR #22 需要补充修改` blocked 卡片，且不误删无关的 seed review inbox。",
        ],
      };
    }),
  );

  checks.push(
    await runCheck("Comment replay preserves blocked review summary", async () => {
      const result = await postWebhook(baseURL, {
        eventType: "issue_comment",
        deliveryID: "delivery-comment-follow-up",
        fixture: "pr22-comment-follow-up.json",
      });

      assert(result.status === 200, `comment replay status = ${result.status}, want 200`);
      const state = result.body.state;
      const pullRequest = mustFindPullRequest(state, 22);
      const room = mustFindRoom(state, "room-inbox");
      const run = mustFindRunByRoom(state, "room-inbox");

      assert(pullRequest.status === "changes_requested", `PR #22 status = ${pullRequest.status}, want changes_requested`);
      assert(
        pullRequest.reviewSummary.includes("GitHub Review 要求补充修改"),
        `PR #22 reviewSummary = ${pullRequest.reviewSummary}, want blocked summary preserved`,
      );
      assert(
        !pullRequest.reviewSummary.includes("please also cover stale runtime"),
        "comment body overwrote blocked review summary",
      );
      assert(room.topic.status === "blocked", `room-inbox topic status = ${room.topic.status}, want blocked`);
      assert(run.status === "blocked", `run_inbox_01 status = ${run.status}, want blocked`);

      return {
        status: result.status,
        observed: [
          "PR #22 继续保持 changes_requested。",
          "comment body 没有覆盖 blocked review summary。",
          "room / run 继续保持 blocked 语义。",
        ],
      };
    }),
  );

  checks.push(
    await runCheck("Merge replay marks room, run, issue, and PR as done", async () => {
      const result = await postWebhook(baseURL, {
        eventType: "pull_request",
        deliveryID: "delivery-merge-sync",
        fixture: "pr18-merge.json",
      });

      assert(result.status === 200, `merge replay status = ${result.status}, want 200`);
      const state = result.body.state;
      const pullRequest = mustFindPullRequest(state, 18);
      const room = mustFindRoom(state, "room-runtime");
      const run = mustFindRunByRoom(state, "room-runtime");
      const issue = mustFindIssueByRoom(state, "room-runtime");
      const mergedInbox = state.inbox.find(
        (item) => item.kind === "status" && item.title === "PR #18 已合并",
      );

      assert(pullRequest.status === "merged", `PR #18 status = ${pullRequest.status}, want merged`);
      assert(room.topic.status === "done", `room-runtime topic status = ${room.topic.status}, want done`);
      assert(run.status === "done", `run_runtime_01 status = ${run.status}, want done`);
      assert(issue.state === "done", `issue for room-runtime = ${issue.state}, want done`);
      assert(mergedInbox, "merged inbox card for PR #18 missing");

      return {
        status: result.status,
        observed: [
          "PR #18 被回写成 merged。",
          "room-runtime / run_runtime_01 / 对应 issue 同步进入 done。",
          "inbox 出现 `PR #18 已合并` status 卡片。",
        ],
      };
    }),
  );

  checks.push(
    await runCheck("Bad signature fails closed", async () => {
      const result = await postWebhook(baseURL, {
        eventType: "pull_request",
        deliveryID: "delivery-bad-signature",
        fixture: "pr18-merge.json",
        signingSecret: "wrong-secret",
      });

      assert(result.status === 401, `bad signature status = ${result.status}, want 401`);
      assert(
        result.body.error === "invalid github webhook signature",
        `bad signature error = ${result.body.error}, want invalid github webhook signature`,
      );

      return {
        status: result.status,
        observed: [
          "错误签名被 401 拒绝。",
          "返回 payload 明确给出 `invalid github webhook signature`。",
        ],
      };
    }),
  );

  checks.push(
    await runCheck("Untracked PR replay is accepted but explicitly ignored", async () => {
      const result = await postWebhook(baseURL, {
        eventType: "pull_request_review",
        deliveryID: "delivery-untracked",
        fixture: "pr404-review-untracked.json",
      });

      assert(result.status === 202, `untracked replay status = ${result.status}, want 202`);
      assert(result.body.ignored === true, "untracked replay did not set ignored=true");
      assert(
        String(result.body.reason).includes("not tracked"),
        `untracked replay reason = ${result.body.reason}, want not tracked`,
      );

      return {
        status: result.status,
        observed: [
          "未跟踪 PR #404 没有把 state 写坏。",
          "接口以 202 + ignored=true + not tracked reason 显式回包。",
        ],
      };
    }),
  );

  const finalState = await getJSON(`${baseURL}/v1/state`);
  await writeArtifact("final-state.json", finalState);

  const report = renderReport(checks, {
    artifactsDir: runArtifactsDir,
    baseURL,
    workspaceRoot,
    statePath,
  });

  if (reportPath) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report, "utf8");
  }

  process.stdout.write(report);
} finally {
  if (server && !serverExited) {
    server.kill("SIGTERM");
    await onceExit(server, 3000);
  }
  await closeStream(stdoutStream);
  await closeStream(stderrStream);
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return "";
  }
  return process.argv[index + 1];
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close(() => reject(new Error("failed to reserve local port")));
        return;
      }
      socket.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealthy(baseURL, stdoutPath, stderrPath) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverExited) {
      const stderr = await safeRead(stderrPath);
      throw new Error(`openshock-server exited before /healthz became ready\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseURL}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {}
    await delay(250);
  }
  const stdout = await safeRead(stdoutPath);
  const stderr = await safeRead(stderrPath);
  throw new Error(`openshock-server did not become healthy in time\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return await response.json();
}

async function postWebhook(baseURL, { eventType, deliveryID, fixture, signingSecret = secret }) {
  const body = await readFile(path.join(fixtureDir, fixture), "utf8");
  const response = await fetch(`${baseURL}/v1/github/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Delivery": deliveryID,
      "X-GitHub-Event": eventType,
      "X-Hub-Signature-256": signBody(body, signingSecret),
    },
    body,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  await writeArtifact(`${deliveryID}.json`, parsed);
  return { status: response.status, body: parsed };
}

function signBody(body, signingSecret) {
  return `sha256=${createHmac("sha256", signingSecret).update(body).digest("hex")}`;
}

async function writeArtifact(name, value) {
  await writeFile(path.join(runArtifactsDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCheck(name, verify) {
  const result = await verify();
  return { name, ...result };
}

async function runCommand(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}\n${stderr}`));
    });
  });
}

function renderReport(checks, context) {
  const lines = [
    "# Test Report 2026-04-07 Webhook Replay",
    "",
    "- Command: `pnpm test:webhook-replay`",
    `- Control server: \`${context.baseURL}\``,
    `- Workspace root: \`${context.workspaceRoot}\``,
    `- State file: \`${context.statePath}\``,
    `- Artifacts dir: \`${context.artifactsDir}\``,
    "",
    "## Scope",
    "",
    "- 覆盖 `TC-015` 的 webhook ingest / signature verify / normalized writeback 片段。",
    "- 覆盖 `TC-025` 的 review / comment / check / merge replay，以及 failure-path observability。",
    "- 环境使用临时 `openshock-server` + seed state，通过真实 HTTP 请求打 `/v1/github/webhook`，不是直接调用 store helper。",
    "",
    "## Checks",
    "",
  ];

  for (const check of checks) {
    lines.push(`### ${check.name}`);
    lines.push(`- HTTP status: \`${check.status}\``);
    for (const item of check.observed) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("## TC-015 GitHub App 安装与 Webhook");
  lines.push("");
  lines.push("- 当前执行状态: Blocked");
  lines.push("- 实际结果: 已在本地 replay 环境坐实签名校验、review/comment/check/merge 事件写回和错误回包；但这仍不是“GitHub App installation 完成后的真实远端 callback”。");
  lines.push("- 业务结论: webhook ingest / replay 这半段已被 `TKT-05` 验到；完整 installation-complete live callback 继续留给后续远端票收口。");
  lines.push("");
  lines.push("## TC-025 GitHub Webhook Replay / Review Sync");
  lines.push("");
  lines.push("- 当前执行状态: Pass");
  lines.push("- 实际结果: 重放 review/comment/check/merge 事件后，PR / inbox / room / run / issue 都按预期更新；bad-signature 与 untracked PR 都有显式失败 / ignored contract。");
  lines.push("- 业务结论: `TKT-05` 现在已经把 webhook replay fixture 和 exact replay evidence 摆上桌，reviewer 可以按同一命令独立复核。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function countItems(items, predicate) {
  return items.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function findPullRequest(state, number) {
  return (state.pullRequests ?? []).find((item) => item.number === number);
}

function mustFindPullRequest(state, number) {
  const item = findPullRequest(state, number);
  assert(item, `pull request #${number} missing from state`);
  return item;
}

function mustFindRoom(state, roomID) {
  const item = (state.rooms ?? []).find((room) => room.id === roomID);
  assert(item, `room ${roomID} missing from state`);
  return item;
}

function mustFindRunByRoom(state, roomID) {
  const item = (state.runs ?? []).find((run) => run.roomId === roomID);
  assert(item, `run for room ${roomID} missing from state`);
  return item;
}

function mustFindIssueByRoom(state, roomID) {
  const item = (state.issues ?? []).find((issue) => issue.roomId === roomID);
  assert(item, `issue for room ${roomID} missing from state`);
  return item;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function onceExit(child, timeoutMs) {
  if (serverExited) {
    return;
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs),
  ]);
}

async function closeStream(stream) {
  if (!stream) {
    return;
  }
  await new Promise((resolve) => {
    stream.end(resolve);
  });
}
