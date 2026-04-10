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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const parsedArgs = parseArgs(process.argv.slice(2));
const requestedReportPath = parsedArgs.reportPath
  ? path.resolve(projectRoot, parsedArgs.reportPath)
  : "";
const runMode =
  parsedArgs.mode === "auto-advance"
    ? "auto-advance"
    : parsedArgs.mode === "closeout"
      ? "closeout"
      : parsedArgs.mode === "delegation"
        ? "delegation"
        : parsedArgs.mode === "delegate-handoff"
          ? "delegate-handoff"
    : requestedReportPath.includes("autocreate")
      ? "auto-create"
      : "route";
const evidencePrefix =
  runMode === "auto-advance"
    ? "openshock-tkt66-governed-route-"
    : runMode === "closeout"
      ? "openshock-tkt67-governed-route-"
      : runMode === "delegation"
        ? "openshock-tkt68-governed-route-"
        : runMode === "delegate-handoff"
          ? "openshock-tkt69-governed-route-"
    : runMode === "auto-create"
      ? "openshock-tkt65-governed-route-"
      : "openshock-tkt64-governed-route-";
const evidenceRoot =
  process.env.OPENSHOCK_E2E_ARTIFACTS_DIR?.trim() ||
  (await mkdtemp(path.join(os.tmpdir(), evidencePrefix)));
const artifactsDir = path.resolve(evidenceRoot);
const reportPath = requestedReportPath || path.join(artifactsDir, "report.md");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const logsDir = path.join(artifactsDir, "logs");

await mkdir(screenshotsDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const screenshots = [];
const processes = [];

function parseArgs(args) {
  const result = { reportPath: "", mode: "default" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--report") {
      result.reportPath = args[index + 1] ?? "";
      index += 1;
    } else if (args[index] === "--mode") {
      result.mode = args[index + 1] ?? "default";
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
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json();
}

async function readState(serverURL) {
  return fetchJSON(`${serverURL}/v1/state`, { cache: "no-store" });
}

async function readMailbox(serverURL) {
  return fetchJSON(`${serverURL}/v1/mailbox`, { cache: "no-store" });
}

async function patchGovernedQATopology(serverURL) {
  return fetchJSON(`${serverURL}/v1/workspace`, {
    method: "PATCH",
    body: JSON.stringify({
      governance: {
        teamTopology: [
          { id: "pm", label: "PM", role: "目标与验收", defaultAgent: "Spec Captain", lane: "scope / final response" },
          { id: "architect", label: "Architect", role: "拆解与边界", defaultAgent: "Spec Captain", lane: "shape / split" },
          { id: "developer", label: "Developer", role: "实现与分支推进", defaultAgent: "Build Pilot", lane: "issue -> branch" },
          { id: "reviewer", label: "Reviewer", role: "exact-head verdict", defaultAgent: "Review Runner", lane: "review / blocker" },
          { id: "qa", label: "QA", role: "verify / release evidence", defaultAgent: "Memory Clerk", lane: "test / release gate" },
        ],
      },
    }),
  });
}

async function waitForMailbox(serverURL, title) {
  return waitFor(async () => {
    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => item.title === title) ?? false;
  }, `mailbox handoff ${title} did not appear`);
}

async function waitForMailboxWhere(serverURL, predicate, message) {
  return waitFor(async () => {
    const handoffs = await readMailbox(serverURL);
    return handoffs.find((item) => predicate(item)) ?? false;
  }, message);
}

async function readText(page, testId) {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
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
    const response = await fetch(`${webURL}/mailbox`);
    return response.ok;
  }, `web did not become ready at ${webURL}/mailbox`);

  return { webURL, serverURL };
}

let browser = null;
let context = null;
let page = null;

try {
  const { webURL, serverURL } = await startServices();
  resolveChromiumExecutable();
  if (
    runMode === "auto-advance" ||
    runMode === "closeout" ||
    runMode === "delegation" ||
    runMode === "delegate-handoff"
  ) {
    await patchGovernedQATopology(serverURL);
  }
  const initialState = await readState(serverURL);
  const requestTitle = initialState.workspace.governance.routingPolicy.suggestedHandoff.draftTitle;
  assert(requestTitle, "governed route should expose a draft title before auto-create");

  browser = await launchChromiumSession(chromium);
  context = await browser.newContext({ viewport: { width: 1440, height: 1280 } });
  page = await context.newPage();

  await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-compose-governed-route").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-compose-governed-route-status")) === "ready",
    "governed compose route should start in ready state"
  );
  await page.getByTestId("mailbox-compose-governed-route-create").waitFor({ state: "visible" });
  await capture(page, "governed-compose-ready");

  await page.goto(`${webURL}/mailbox?roomId=room-runtime`, { waitUntil: "load" });
  await page.getByTestId("mailbox-governed-route").waitFor({ state: "visible" });

  assert(
    (await readText(page, "mailbox-governed-route-status")) === "ready",
    "governed mailbox route should start in ready state"
  );
  assert(
    (await page.getByTestId("mailbox-create-from-agent").inputValue()) === "agent-codex-dockmaster",
    "governed route should auto-fill Codex as the source agent"
  );
  assert(
    (await page.getByTestId("mailbox-create-to-agent").inputValue()) === "agent-claude-review-runner",
    "governed route should auto-fill Claude reviewer as the target agent"
  );
  await capture(page, "governed-route-ready");

  await page.getByTestId("mailbox-governed-route-create").click();

  const handoff = await waitForMailbox(serverURL, requestTitle);
  await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-governed-route-status")) === "active",
    "governed mailbox route should become active after creating the recommended handoff"
  );
  await capture(page, "governed-route-active");

  await page.goto(`${webURL}/inbox?roomId=room-runtime&handoffId=${handoff.id}`, { waitUntil: "load" });
  await page.getByTestId("mailbox-compose-governed-route").waitFor({ state: "visible" });
  assert(
    (await readText(page, "mailbox-compose-governed-route-status")) === "active",
    "governed compose route should become active after auto-create"
  );
  await capture(page, "governed-compose-active");

  await page.getByTestId("mailbox-compose-governed-route-focus").click();
  await page.getByTestId(`mailbox-card-${handoff.id}`).waitFor({ state: "visible" });
  await capture(page, "governed-route-focus-inbox");

  let reportTitle = "# 2026-04-11 Governed Mailbox Route Report";
  let reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-route -- --report ${path.relative(projectRoot, reportPath)}`;
  let reportTicket = "TKT-64";
  let reportChecklist = "CHK-21";
  let reportTestCase = "TC-053";
  let reportScope = "governed default route、active handoff focus、blocked fallback";
  let resultLines = [
    "- `/mailbox` 与 Inbox compose 都会读取 `workspace.governance.routingPolicy.suggestedHandoff`，并在 `ready` 状态下显式给出 `Create Governed Handoff` 一键起单入口 -> PASS",
    "- 通过 governed route 一键起单后，`/mailbox` 与 Inbox compose 会一起切到 `active`，并提供聚焦当前 handoff 的回链，防止同一路由被重复创建 -> PASS",
    "- 完成当前 reviewer handoff 后，两处 governed surface 会一起前滚到下一条 lane；当 QA lane 缺少可映射 agent 时，状态会显式转成 `blocked`，不会静默回退到随机接收方 -> PASS",
  ];

  await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${handoff.id}`, { waitUntil: "load" });
  await page.getByTestId(`mailbox-action-acknowledged-${handoff.id}`).click();
  await page.getByTestId(`mailbox-note-${handoff.id}`).fill("review 已完成，继续看下一条治理建议。");

  if (
    runMode === "auto-advance" ||
    runMode === "closeout" ||
    runMode === "delegation" ||
    runMode === "delegate-handoff"
  ) {
    await page.getByTestId(`mailbox-action-completed-continue-${handoff.id}`).click();
    const followup = await waitForMailboxWhere(
      serverURL,
      (item) =>
        item.id !== handoff.id &&
        item.status === "requested" &&
        item.fromAgent === "Claude Review Runner" &&
        item.toAgent === "Memory Clerk",
      "auto-advanced governed handoff did not appear"
    );

    await page.getByTestId(`mailbox-card-${followup.id}`).waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="mailbox-governed-route-status"]')?.textContent?.trim() === "active";
    });
    await capture(page, "governed-route-auto-advanced");

    const stateAfterContinue = await readState(serverURL);
    const governedSuggestion = stateAfterContinue.workspace.governance.routingPolicy.suggestedHandoff;
    assert(governedSuggestion.status === "active", "next governed handoff should become active after auto-advance");
    assert(governedSuggestion.handoffId === followup.id, "governed suggestion should point at the auto-created followup");
    assert(governedSuggestion.toLaneLabel === "QA", "auto-advanced governed handoff should move into the QA lane");
    assert(
      governedSuggestion.toAgent === "Memory Clerk",
      "auto-advanced governed handoff should target the mapped QA agent"
    );

    await page.goto(`${webURL}/inbox?roomId=room-runtime&handoffId=${followup.id}`, { waitUntil: "load" });
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="mailbox-compose-governed-route-status"]')?.textContent?.trim() === "active";
    });
    await page.getByTestId("mailbox-compose-governed-route-focus").click();
    await page.getByTestId(`mailbox-card-${followup.id}`).waitFor({ state: "visible" });
    await capture(page, "governed-compose-auto-advanced");

    if (runMode === "closeout" || runMode === "delegation" || runMode === "delegate-handoff") {
      const qaCloseoutNote = "QA 验证完成，可以进入 PR delivery closeout。";

      await page.goto(`${webURL}/mailbox?roomId=room-runtime&handoffId=${followup.id}`, { waitUntil: "load" });
      await page.getByTestId(`mailbox-action-acknowledged-${followup.id}`).click();
      await page.getByTestId(`mailbox-note-${followup.id}`).fill(qaCloseoutNote);
      await page.getByTestId(`mailbox-action-completed-${followup.id}`).click();
      await page.waitForFunction(() => {
        return document.querySelector('[data-testid="mailbox-governed-route-status"]')?.textContent?.trim() === "done";
      });
      await page.getByTestId("mailbox-governed-route-closeout").waitFor({ state: "visible" });
      await capture(page, "governed-route-closeout-ready");

      const stateAfterCloseout = await readState(serverURL);
      const doneSuggestion = stateAfterCloseout.workspace.governance.routingPolicy.suggestedHandoff;
      assert(doneSuggestion.status === "done", "governed route should become done after final QA closeout");
      assert(
        doneSuggestion.href === "/pull-requests/pr-runtime-18",
        "done governed route should point to the runtime PR delivery entry"
      );

      await page.getByTestId("mailbox-governed-route-closeout").click();
      await page.getByTestId("pull-request-delivery-status").waitFor({ state: "visible" });
      await page.waitForFunction(
        (note) => document.querySelector('[data-testid="delivery-handoff-note"]')?.textContent?.includes(note),
        qaCloseoutNote
      );
      await capture(page, "pull-request-delivery-closeout");

      if (runMode === "delegation" || runMode === "delegate-handoff") {
        assert(
          (await readText(page, "delivery-delegation-status")) === "delegate ready",
          "delivery delegation should become ready after final QA closeout"
        );
        assert(
          (await readText(page, "delivery-delegation-target")) === "PM · Spec Captain",
          "delivery delegation should point back to PM / Spec Captain"
        );
        assert(
          (await readText(page, "delivery-delegation-summary")).includes("Spec Captain"),
          "delivery delegation summary should mention the delegated agent"
        );
        await page
          .getByTestId("pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18")
          .waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const node = document.querySelector(
            '[data-testid="pull-request-related-inbox-inbox-delivery-delegation-pr-runtime-18"]'
          );
          return node?.textContent?.includes("Spec Captain") ?? false;
        });
        await capture(page, "pull-request-delivery-delegation");

        if (runMode === "delegate-handoff") {
          assert(
            (await readText(page, "delivery-delegation-handoff-status")) === "handoff requested",
            "delivery delegation should auto-create a requested formal closeout handoff"
          );
          const delegatedHandoffHref = await page.getByTestId("delivery-delegation-open").getAttribute("href");
          assert(
            delegatedHandoffHref && delegatedHandoffHref.includes("handoffId="),
            "delivery delegation open link should point at the delegated handoff"
          );
          const delegatedHandoffURL = new URL(delegatedHandoffHref, webURL);
          const delegatedHandoffID = delegatedHandoffURL.searchParams.get("handoffId");
          assert(delegatedHandoffID, "delegated handoff href should include handoffId");

          await page.getByTestId("delivery-delegation-open").click();
          await page.getByTestId(`mailbox-card-${delegatedHandoffID}`).waitFor({ state: "visible" });
          await page.waitForFunction(
            (handoffId) => {
              const card = document.querySelector(`[data-testid="mailbox-card-${handoffId}"]`);
              return (
                card?.textContent?.includes("Memory Clerk") &&
                card?.textContent?.includes("Spec Captain") &&
                card?.textContent?.includes("requested")
              );
            },
            delegatedHandoffID
          );
          await capture(page, "delivery-delegated-handoff");
        }
      }

      await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
      await page.waitForFunction(() => {
        return document.querySelector('[data-testid="mailbox-compose-governed-route-status"]')?.textContent?.trim() === "done";
      });
      await page.getByTestId("mailbox-compose-governed-route-closeout").waitFor({ state: "visible" });
      await capture(page, "governed-compose-closeout-ready");

      if (runMode === "delegate-handoff") {
        reportTitle = "# 2026-04-11 Governed Mailbox Delegated Closeout Handoff Report";
        reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegate-handoff -- --report ${path.relative(projectRoot, reportPath)}`;
        reportTicket = "TKT-69";
        reportTestCase = "TC-058";
        reportScope = "governed final closeout auto-create、delegated mailbox handoff、PR detail handoff backlink";
        resultLines = [
          "- QA final lane closeout 后，系统不会只停在 `delegate ready` 提示，而是会继续自动创建 `Memory Clerk -> Spec Captain` 的 formal delivery closeout handoff -> PASS",
          "- PR delivery entry 的 `Delivery Delegation` card 会保留 `PM · Spec Captain` 目标，同时新增 `handoff requested` 状态与 handoff deep link，说明 delegate signal 已经升级为可执行 contract -> PASS",
          "- 点击 delegation card 的 handoff link 后，Inbox / Mailbox 会直接聚焦到新创建的 closeout handoff，证明 post-QA orchestration 已经进入正式 mailbox ledger，而没有把治理 done-state 冲回 active governed route -> PASS",
        ];
      } else if (runMode === "delegation") {
        reportTitle = "# 2026-04-11 Governed Mailbox Delivery Delegation Report";
        reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-delegation -- --report ${path.relative(projectRoot, reportPath)}`;
        reportTicket = "TKT-68";
        reportTestCase = "TC-057";
        reportScope = "governed final closeout delegation、delivery delegate card、PR-related inbox signal";
        resultLines = [
          "- QA final lane closeout 后，`/mailbox` 与 Inbox compose 继续围同一条 governed done-state closeout 回链工作，不会把治理链和 delivery closeout 拆成两套真相 -> PASS",
          "- 打开 PR delivery entry 后，`Delivery Delegation` card 会显式给出 `delegate ready`、`PM · Spec Captain` 目标与 summary，说明 final closeout 已经被委托回 owner lane，而不是只停在抽象 done 文案 -> PASS",
          "- PR detail 的 related inbox 也会同步出现 `inbox-delivery-delegation-pr-runtime-18` 信号，并回链到同一条 PR detail，证明 delivery delegation 已经进入正式 inbox truth，而不只是页面内推导 -> PASS",
        ];
      } else {
        reportTitle = "# 2026-04-11 Governed Mailbox Closeout Delivery Report";
        reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-closeout -- --report ${path.relative(projectRoot, reportPath)}`;
        reportTicket = "TKT-67";
        reportTestCase = "TC-056";
        reportScope = "governed final-lane done state、delivery entry closeout backlink、PR handoff note sync";
        resultLines = [
          "- QA followup handoff 完成后，`/mailbox` 上的 governed surface 不再停在纯 `done` 文案，而是直接给出 `Open Delivery Entry` closeout 回链 -> PASS",
          "- 最终 lane 收口后，`workspace.governance.routingPolicy.suggestedHandoff` 会切到 `done` 并指向 `/pull-requests/pr-runtime-18`，说明治理链和交付面已经接上同一条 closeout truth -> PASS",
          "- 打开 PR delivery entry 后，operator handoff note 与 evidence 会直接带上 QA closeout note；Inbox compose 也同步显示同一条 done-state closeout 回链 -> PASS",
        ];
      }
    } else {
      reportTitle = "# 2026-04-11 Governed Mailbox Auto-Advance Report";
      reportCommand = `${process.env.OPENSHOCK_WINDOWS_CHROME === "1" ? "OPENSHOCK_WINDOWS_CHROME=1 " : ""}pnpm test:headed-governed-mailbox-auto-advance -- --report ${path.relative(projectRoot, reportPath)}`;
      reportTicket = "TKT-66";
      reportTestCase = "TC-055";
      reportScope = "governed complete + auto-advance、QA followup auto-create、dual-surface active replay";
      resultLines = [
        "- `/mailbox` 上的 `Complete + Auto-Advance` 现在会把当前 governed handoff 正式收口，并继续围当前 topology 自动创建下一棒 formal handoff，而不是要求人类重新手工起单 -> PASS",
        "- 当 QA lane 已映射到 `Memory Clerk` 时，reviewer closeout 会自动前滚出 `Claude Review Runner -> Memory Clerk` 的下一条 handoff，同时 `workspace.governance.routingPolicy.suggestedHandoff` 会切到同一条 `active` 指针 -> PASS",
        "- Inbox compose 与 `/mailbox` 在 auto-advance 后都会继续显示同一条 active followup，focus 回链直接跳到新 handoff，不会停在旧 reviewer ledger 或回退成 `ready`/`blocked` 假状态 -> PASS",
      ];
    }
  } else {
    await page.getByTestId(`mailbox-action-completed-${handoff.id}`).click();
    await page.getByTestId(`mailbox-status-${handoff.id}`).waitFor({ state: "visible" });

    const stateAfterComplete = await readState(serverURL);
    const governedSuggestion = stateAfterComplete.workspace.governance.routingPolicy.suggestedHandoff;
    assert(governedSuggestion.status === "blocked", "next governed handoff should block when QA lane has no mapped agent");
    assert(governedSuggestion.toLaneLabel === "QA", "next governed handoff should point at the QA lane");
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="mailbox-governed-route-status"]')?.textContent?.trim() === "blocked";
    });
    await capture(page, "governed-route-next-blocked");

    await page.goto(`${webURL}/inbox?roomId=room-runtime`, { waitUntil: "load" });
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="mailbox-compose-governed-route-status"]')?.textContent?.trim() === "blocked";
    });
    await capture(page, "governed-compose-next-blocked");

    if (runMode === "auto-create") {
      reportTitle = "# 2026-04-11 Governed Mailbox Auto-Create Report";
      reportTicket = "TKT-65";
      reportTestCase = "TC-054";
      reportScope = "governed one-click create、dual-surface active sync、blocked replay";
      resultLines = [
        "- `/mailbox` 与 Inbox compose 在 `ready` governed route 下都提供 `Create Governed Handoff` 一键入口，不再要求人类重复选择 source / target -> PASS",
        "- 通过 governed route 一键起单后，`/mailbox` 与 Inbox compose 会同步切到同一条 `active` handoff，并提供 focus 回链，避免出现双面状态分裂 -> PASS",
        "- 当前 reviewer handoff 完成后，两处 governed surface 会围同一条 topology truth 一起前滚到下一条 lane；当 QA lane 缺少映射 agent 时，两处都显式 `blocked` -> PASS",
      ];
    }
  }

  const report = [
    reportTitle,
    "",
    `- Ticket: \`${reportTicket}\``,
    `- Checklist: \`${reportChecklist}\``,
    `- Test Case: \`${reportTestCase}\``,
    `- Scope: ${reportScope}`,
    `- Command: \`${reportCommand}\``,
    `- Artifacts Dir: \`${artifactsDir}\``,
    "",
    "## Results",
    "",
    ...resultLines,
    "",
    "## Screenshots",
    "",
    ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    "",
  ].join("\n");

  await writeFile(reportPath, report, "utf8");
} finally {
  await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
  await cleanupProcesses();
}
