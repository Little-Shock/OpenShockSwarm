import assert from "node:assert/strict";
import test from "node:test";

import type { FirstStartJourney } from "./first-start-journey";
import type { ApprovalCenterItem, AgentHandoff, Channel, DirectMessage, InboxItem, PullRequest, Room } from "./phase-zero-types";

const { buildContinueTarget, buildRoomContinueTarget, sortRoomsForContinue } = (await import(
  new URL("./continue-target.ts", import.meta.url).href
)) as typeof import("./continue-target");

function buildJourney(overrides: Partial<FirstStartJourney> = {}): FirstStartJourney {
  return {
    accessReady: true,
    onboardingDone: true,
    onboardingStarted: true,
    nextHref: "/setup",
    nextSurfaceLabel: "设置",
    nextLabel: "继续设置",
    nextSummary: "先把工作区接通。",
    launchHref: "/chat/all",
    launchSurfaceLabel: "聊天",
    steps: [],
    ...overrides,
  };
}

function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-runtime",
    issueKey: "OPS-101",
    title: "Runtime 讨论间",
    unread: 0,
    summary: "继续处理运行环境问题。",
    boardCount: 2,
    topic: {
      id: "topic-runtime",
      title: "Runtime pairing",
      status: "running",
      owner: "Build Pilot",
      summary: "当前还在推进配对修复。",
    },
    runId: "run-runtime",
    messageIds: [],
    ...overrides,
  };
}

function buildInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "inbox-blocked",
    title: "需要你接手",
    kind: "blocked",
    room: "Runtime 讨论间",
    time: "刚刚",
    summary: "QA 等你确认阻塞原因。",
    action: "处理",
    href: "/mailbox?handoffId=handoff-runtime&roomId=room-runtime",
    ...overrides,
  };
}

function buildDirectMessage(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id: "dm-memory-clerk",
    name: "Memory Clerk",
    summary: "等你确认下一步。",
    purpose: "记忆协作",
    unread: 0,
    presence: "idle",
    counterpart: "Memory Clerk",
    messageIds: [],
    ...overrides,
  };
}

function buildChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "roadmap",
    name: "#roadmap",
    summary: "产品和排期讨论。",
    purpose: "先在频道里对齐。",
    unread: 0,
    ...overrides,
  };
}

function buildHandoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    id: "handoff-runtime",
    title: "QA 继续验证",
    summary: "等待 QA 接手继续验证。",
    status: "requested",
    issueKey: "OPS-101",
    roomId: "room-runtime",
    runId: "run-runtime",
    fromAgentId: "agent-builder",
    fromAgent: "Builder",
    toAgentId: "agent-qa",
    toAgent: "QA",
    requestedAt: "2026-04-27T10:00:00Z",
    updatedAt: "2026-04-27T10:05:00Z",
    lastAction: "等待 QA 接手。",
    messages: [],
    ...overrides,
  };
}

function buildApprovalSignal(overrides: Partial<ApprovalCenterItem> = {}): ApprovalCenterItem {
  return {
    id: "signal-runtime",
    kind: "blocked",
    priority: "critical",
    room: "Runtime 讨论间",
    roomId: "room-runtime",
    runId: "run-runtime",
    title: "Runtime 阻塞待拍板",
    summary: "先回到当前阻塞，确认下一步。",
    action: "处理",
    href: "/rooms/room-runtime?tab=run",
    time: "刚刚",
    unread: true,
    decisionOptions: ["approved", "deferred"],
    deliveryStatus: "blocked",
    deliveryTargets: 1,
    blockedDeliveries: 1,
    ...overrides,
  };
}

function buildPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: "pr-runtime",
    number: 42,
    label: "#42",
    title: "Runtime pairing polish",
    status: "in_review",
    issueKey: "OPS-101",
    roomId: "room-runtime",
    runId: "run-runtime",
    branch: "feat/runtime-pairing",
    author: "Builder",
    reviewSummary: "等待确认 daemon 配对文案。",
    updatedAt: "2026-04-27T10:06:00Z",
    ...overrides,
  };
}

test("buildContinueTarget prioritizes actionable inbox before room when a handoff is waiting", () => {
  const target = buildContinueTarget({
    inbox: [buildInboxItem()],
    mailbox: [buildHandoff()],
    pullRequests: [],
    channels: [],
    directMessages: [],
    rooms: [
      buildRoom({
        unread: 6,
        topic: { ...buildRoom().topic, status: "blocked" },
      }),
    ],
    journey: buildJourney(),
  });

  assert.equal(target.source, "inbox");
  assert.equal(target.href, "/mailbox?handoffId=handoff-runtime&roomId=room-runtime");
  assert.equal(target.title, "先处理当前待办");
  assert.equal(target.summary, "QA 等你确认阻塞原因。");
  assert.equal(target.reason, "1 条待处理，先接住最紧急的交接或阻塞。");
  assert.equal(target.ctaLabel, "交接箱");
});

test("buildContinueTarget lets approval center truth outrank mailbox and chat when a blocked signal is live", () => {
  const target = buildContinueTarget({
    inbox: [],
    approvalSignals: [buildApprovalSignal()],
    mailbox: [buildHandoff({ status: "requested" })],
    pullRequests: [],
    channels: [buildChannel({ unread: 2 })],
    directMessages: [buildDirectMessage({ unread: 1 })],
    rooms: [buildRoom({ unread: 0, topic: { ...buildRoom().topic, status: "running" } })],
    journey: buildJourney(),
  });

  assert.equal(target.source, "approval-center");
  assert.equal(target.href, "/rooms/room-runtime?tab=run");
  assert.equal(target.title, "先处理阻塞");
  assert.equal(target.summary, "先回到当前阻塞，确认下一步。");
  assert.equal(target.reason, "1 条待处理信号，先回到执行详情。");
  assert.equal(target.ctaLabel, "执行详情");
});

test("buildRoomContinueTarget prioritizes blocked room before unread and active rooms", () => {
  const target = buildRoomContinueTarget([
    buildRoom({ id: "room-active", unread: 0 }),
    buildRoom({
      id: "room-unread",
      unread: 8,
      topic: { ...buildRoom().topic, status: "running" },
    }),
    buildRoom({
      id: "room-blocked",
      unread: 0,
      topic: { ...buildRoom().topic, status: "blocked", summary: "需要先处理阻塞。" },
    }),
  ]);

  assert.equal(target?.source, "room-blocked");
  assert.equal(target?.href, "/rooms/room-blocked?tab=run");
  assert.equal(target?.title, "Runtime 讨论间");
  assert.equal(target?.roomTitle, "Runtime 讨论间");
  assert.equal(target?.summary, "需要先处理阻塞。");
  assert.equal(target?.reason, "阻塞 / 暂停优先");
  assert.equal(target?.ctaLabel, "执行详情");
});

test("buildRoomContinueTarget prioritizes unread room before running room", () => {
  const target = buildRoomContinueTarget([
    buildRoom({ id: "room-running", unread: 0 }),
    buildRoom({
      id: "room-unread",
      unread: 3,
      topic: { ...buildRoom().topic, status: "running", summary: "先读完这几条回复。" },
    }),
  ]);

  assert.equal(target?.source, "room-unread");
  assert.equal(target?.title, "Runtime 讨论间");
  assert.equal(target?.roomTitle, "Runtime 讨论间");
  assert.equal(target?.summary, "先读完这几条回复。");
  assert.equal(target?.reason, "3 条未读");
  assert.doesNotMatch(target?.summary ?? "", /Runtime 讨论间/);
});

test("buildRoomContinueTarget sends review rooms straight to delivery detail", () => {
  const target = buildRoomContinueTarget([
    buildRoom({
      id: "room-review",
      unread: 0,
      topic: { ...buildRoom().topic, status: "review", summary: "先处理评审回流。" },
    }),
  ]);

  assert.equal(target?.source, "room-active");
  assert.equal(target?.href, "/rooms/room-review?tab=pr");
  assert.equal(target?.reason, "当前评审中");
  assert.equal(target?.ctaLabel, "交付详情");
});

test("sortRoomsForContinue orders blocked, unread, active, then recent", () => {
  const sorted = sortRoomsForContinue([
    buildRoom({ id: "room-recent", topic: { ...buildRoom().topic, status: "done" } }),
    buildRoom({ id: "room-active", topic: { ...buildRoom().topic, status: "review" } }),
    buildRoom({ id: "room-unread", unread: 4 }),
    buildRoom({ id: "room-blocked", topic: { ...buildRoom().topic, status: "paused" } }),
  ]);

  assert.deepEqual(
    sorted.map((room) => room.id),
    ["room-blocked", "room-unread", "room-active", "room-recent"]
  );
});

test("buildContinueTarget falls back to journey when no inbox or rooms exist", () => {
  const target = buildContinueTarget({
    inbox: [],
    mailbox: [],
    pullRequests: [],
    channels: [],
    directMessages: [],
    rooms: [],
    journey: buildJourney({
      nextHref: "/setup",
      nextSurfaceLabel: "设置",
      nextLabel: "继续设置",
      nextSummary: "先把 GitHub 和运行环境接通。",
    }),
  });

  assert.equal(target.source, "journey");
  assert.equal(target.href, "/setup");
  assert.equal(target.title, "继续设置");
  assert.equal(target.ctaLabel, "设置");
});

test("buildContinueTarget lets unread direct messages become the primary continue target", () => {
  const target = buildContinueTarget({
    inbox: [],
    mailbox: [],
    pullRequests: [],
    channels: [],
    directMessages: [buildDirectMessage({ unread: 3, summary: "等你拍板是否现在写回。" })],
    rooms: [buildRoom({ topic: { ...buildRoom().topic, status: "done" } })],
    journey: buildJourney(),
  });

  assert.equal(target.source, "direct-message");
  assert.equal(target.href, "/chat/dm-memory-clerk");
  assert.equal(target.title, "Memory Clerk");
  assert.equal(target.summary, "等你拍板是否现在写回。");
  assert.equal(target.reason, "3 条未读私聊");
  assert.equal(target.ctaLabel, "聊天");
});

test("buildContinueTarget lets unread channels beat a recent room when chat is the real next step", () => {
  const target = buildContinueTarget({
    inbox: [],
    mailbox: [],
    pullRequests: [],
    channels: [buildChannel({ unread: 4, summary: "路线有新回复。" })],
    directMessages: [],
    rooms: [buildRoom({ topic: { ...buildRoom().topic, status: "done" } })],
    journey: buildJourney(),
  });

  assert.equal(target.source, "channel");
  assert.equal(target.href, "/chat/roadmap");
  assert.equal(target.title, "#roadmap");
  assert.equal(target.summary, "路线有新回复。");
  assert.equal(target.reason, "4 条未读频道消息");
  assert.equal(target.ctaLabel, "聊天");
});

test("buildContinueTarget lets mailbox truth win when no inbox item has been materialized yet", () => {
  const target = buildContinueTarget({
    inbox: [],
    mailbox: [buildHandoff({ status: "blocked", lastAction: "QA 卡住了，等你拍板。", updatedAt: "2026-04-27T10:08:00Z" })],
    pullRequests: [],
    channels: [buildChannel({ unread: 2 })],
    directMessages: [],
    rooms: [buildRoom({ unread: 0, topic: { ...buildRoom().topic, status: "running" } })],
    journey: buildJourney(),
  });

  assert.equal(target.source, "mailbox");
  assert.equal(target.href, "/mailbox?handoffId=handoff-runtime&roomId=room-runtime");
  assert.equal(target.title, "先处理交接阻塞");
  assert.equal(target.summary, "QA 卡住了，等你拍板。");
  assert.match(target.reason, /交接还在推进/);
  assert.equal(target.ctaLabel, "交接箱");
});

test("buildContinueTarget surfaces pull request review before chat when delivery is the real next step", () => {
  const target = buildContinueTarget({
    inbox: [],
    mailbox: [],
    pullRequests: [buildPullRequest({ status: "changes_requested", reviewSummary: "请先补上 auth token 生命周期。", label: "#58" })],
    channels: [buildChannel({ unread: 3, summary: "频道里有人催进度。" })],
    directMessages: [buildDirectMessage({ unread: 2 })],
    rooms: [buildRoom({ topic: { ...buildRoom().topic, status: "running" } })],
    journey: buildJourney(),
  });

  assert.equal(target.source, "pull-request");
  assert.equal(target.href, "/rooms/room-runtime?tab=pr");
  assert.equal(target.title, "先处理交付修改");
  assert.equal(target.summary, "请先补上 auth token 生命周期。");
  assert.equal(target.reason, "PR #58 · 待修改");
  assert.equal(target.ctaLabel, "交付详情");
});

test("buildContinueTarget can launch to the default workspace surface once setup is done and nothing is waiting", () => {
  const target = buildContinueTarget({
    inbox: [],
    approvalSignals: [],
    mailbox: [],
    pullRequests: [],
    channels: [],
    directMessages: [],
    rooms: [],
    journey: buildJourney({
      nextHref: "/setup",
      nextLabel: "继续设置",
      nextSummary: "还要补设置。",
      launchHref: "/mailbox",
      launchSurfaceLabel: "交接箱",
    }),
    preferLaunchWhenIdle: true,
  });

  assert.equal(target.source, "launch");
  assert.equal(target.href, "/mailbox");
  assert.equal(target.title, "进入交接箱");
  assert.equal(target.summary, "当前没有新的待办，直接进入交接箱。");
  assert.equal(target.reason, "设置已经完成，先回到默认入口。");
  assert.equal(target.ctaLabel, "交接箱");
});
