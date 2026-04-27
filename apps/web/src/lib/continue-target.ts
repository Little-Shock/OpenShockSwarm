import { buildFirstStartJourney, type FirstStartJourney } from "./first-start-journey.ts";
import type {
  ApprovalCenterItem,
  AgentHandoff,
  Channel,
  DirectMessage,
  InboxItem,
  PhaseZeroState,
  PullRequest,
  Room,
  RunStatus,
} from "./phase-zero-types.ts";

export type ContinueTargetSource =
  | "inbox"
  | "approval-center"
  | "mailbox"
  | "pull-request"
  | "direct-message"
  | "channel"
  | "room-blocked"
  | "room-unread"
  | "room-active"
  | "room-recent"
  | "journey"
  | "launch";

export type ContinueTarget = {
  source: ContinueTargetSource;
  href: string;
  title: string;
  summary: string;
  reason: string;
  ctaLabel: string;
  roomTitle?: string;
  roomId?: string;
  inboxId?: string;
  handoffId?: string;
  pullRequestId?: string;
};

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function surfaceLabelFromHref(href: string) {
  if (href.includes("?tab=run") || href.includes("/runs/")) return "执行详情";
  if (href.includes("?tab=pr")) return "交付详情";
  if (href.startsWith("/mailbox")) return "交接箱";
  if (href.startsWith("/inbox")) return "收件箱";
  if (href.startsWith("/rooms")) return "讨论间";
  if (href.startsWith("/pull-requests")) return "交付详情";
  if (href.startsWith("/setup")) return "设置";
  if (href.startsWith("/access")) return "身份";
  if (href.startsWith("/onboarding")) return "设置";
  if (href.startsWith("/chat")) return "聊天";
  return "下一步";
}

function roomRank(status: RunStatus, unread: number) {
  if (status === "blocked" || status === "paused") return 0;
  if (unread > 0) return 1;
  if (status === "running" || status === "review") return 2;
  return 3;
}

function roomTargetSource(status: RunStatus, unread: number): ContinueTargetSource {
  const rank = roomRank(status, unread);
  if (rank === 0) return "room-blocked";
  if (rank === 1) return "room-unread";
  if (rank === 2) return "room-active";
  return "room-recent";
}

function roomContinueHref(room: Room, source: ContinueTargetSource) {
  if (source === "room-blocked") return `/rooms/${room.id}?tab=run`;
  if (source === "room-active" && room.topic.status === "review") return `/rooms/${room.id}?tab=pr`;
  return `/rooms/${room.id}`;
}

function inboxKindRank(kind: InboxItem["kind"]) {
  if (kind === "blocked") return 0;
  if (kind === "approval") return 1;
  if (kind === "review") return 2;
  return 3;
}

function sortInboxForContinue(items: InboxItem[]) {
  return [...items].sort((left, right) => {
    const leftRank = inboxKindRank(left.kind);
    const rightRank = inboxKindRank(right.kind);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.title.localeCompare(right.title);
  });
}

function buildInboxContinueTarget(inbox: InboxItem[]): ContinueTarget | null {
  const actionableInbox = sortInboxForContinue(inbox.filter((item) => item.kind !== "status"));
  const firstInbox = actionableInbox[0];
  if (!firstInbox) return null;

  return {
    source: "inbox",
    inboxId: firstInbox.id,
    href: firstInbox.href || "/mailbox",
    title: "先处理当前待办",
    summary: firstInbox.summary || firstInbox.title,
    reason: `${actionableInbox.length} 条待处理，先接住最紧急的交接或阻塞。`,
    ctaLabel: surfaceLabelFromHref(firstInbox.href || "/mailbox"),
  };
}

function approvalPriorityRank(priority: ApprovalCenterItem["priority"]) {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  return 2;
}

function sortApprovalSignalsForContinue(signals: ApprovalCenterItem[]) {
  return [...signals]
    .filter((item) => item.kind !== "status")
    .sort((left, right) => {
      const leftKindRank = inboxKindRank(left.kind);
      const rightKindRank = inboxKindRank(right.kind);
      if (leftKindRank !== rightKindRank) return leftKindRank - rightKindRank;
      const leftPriority = approvalPriorityRank(left.priority);
      const rightPriority = approvalPriorityRank(right.priority);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (left.unread !== right.unread) return Number(right.unread) - Number(left.unread);
      return left.title.localeCompare(right.title);
    });
}

function approvalSignalTitle(item: ApprovalCenterItem) {
  switch (item.kind) {
    case "blocked":
      return "先处理阻塞";
    case "approval":
      return "先拍板";
    case "review":
      return "先看评审";
    default:
      return "先看待处理";
  }
}

function buildApprovalSignalContinueTarget(signals: ApprovalCenterItem[]): ContinueTarget | null {
  const actionableSignals = sortApprovalSignalsForContinue(signals);
  const signal = actionableSignals[0];
  if (!signal) {
    return null;
  }

  const href = firstNonEmpty(signal.href, "/inbox");
  return {
    source: "approval-center",
    href,
    title: approvalSignalTitle(signal),
    summary: firstNonEmpty(signal.summary, signal.title, "先回到待处理列表继续。"),
    reason: `${actionableSignals.length} 条待处理信号，先回到${surfaceLabelFromHref(href)}。`,
    ctaLabel: surfaceLabelFromHref(href),
    inboxId: signal.id,
    roomId: signal.roomId,
  };
}

function mailboxStatusRank(status: AgentHandoff["status"]) {
  if (status === "blocked") return 0;
  if (status === "requested") return 1;
  if (status === "acknowledged") return 2;
  return 3;
}

function sortMailboxForContinue(mailbox: AgentHandoff[]) {
  return [...mailbox]
    .filter((handoff) => handoff.status !== "completed")
    .sort((left, right) => {
      const leftRank = mailboxStatusRank(left.status);
      const rightRank = mailboxStatusRank(right.status);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

function buildMailboxContinueTarget(mailbox: AgentHandoff[]): ContinueTarget | null {
  const openMailbox = sortMailboxForContinue(mailbox);
  const handoff = openMailbox[0];
  if (!handoff) {
    return null;
  }

  let title = "继续处理交接";
  if (handoff.status === "blocked") {
    title = "先处理交接阻塞";
  } else if (handoff.status === "requested") {
    title = "先接住新的交接";
  }

  return {
    source: "mailbox",
    href: `/mailbox?handoffId=${handoff.id}&roomId=${handoff.roomId}`,
    title,
    summary: firstNonEmpty(handoff.lastAction, handoff.summary, handoff.title, "先回到交接箱继续。"),
    reason: `${openMailbox.length} 条交接还在推进，先接住最靠前的一条。`,
    ctaLabel: "交接箱",
    handoffId: handoff.id,
    roomId: handoff.roomId,
  };
}

function pullRequestRank(status: PullRequest["status"]) {
  if (status === "changes_requested") return 0;
  if (status === "in_review") return 1;
  if (status === "open") return 2;
  if (status === "draft") return 3;
  return 4;
}

function pullRequestStatusLabel(status: PullRequest["status"]) {
  switch (status) {
    case "changes_requested":
      return "待修改";
    case "in_review":
      return "评审中";
    case "open":
      return "已打开";
    case "draft":
      return "草稿";
    default:
      return "已完成";
  }
}

function sortPullRequestsForContinue(pullRequests: PullRequest[]) {
  return [...pullRequests]
    .filter((pullRequest) => pullRequest.status !== "merged")
    .sort((left, right) => {
      const leftRank = pullRequestRank(left.status);
      const rightRank = pullRequestRank(right.status);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

function buildPullRequestContinueTarget(pullRequests: PullRequest[]): ContinueTarget | null {
  const activePullRequests = sortPullRequestsForContinue(pullRequests);
  const pullRequest = activePullRequests[0];
  if (!pullRequest) {
    return null;
  }

  let title = "先看当前交付";
  if (pullRequest.status === "changes_requested") {
    title = "先处理交付修改";
  } else if (pullRequest.status === "in_review") {
    title = "先看评审";
  }

  return {
    source: "pull-request",
    href: `/rooms/${pullRequest.roomId}?tab=pr`,
    title,
    summary: firstNonEmpty(pullRequest.reviewSummary, pullRequest.title, pullRequest.label, "先回到交付详情。"),
    reason: `PR ${pullRequest.label} · ${pullRequestStatusLabel(pullRequest.status)}`,
    ctaLabel: "交付详情",
    pullRequestId: pullRequest.id,
    roomId: pullRequest.roomId,
  };
}

function buildDirectMessageContinueTarget(directMessages: DirectMessage[]): ContinueTarget | null {
  const target = [...directMessages]
    .filter((message) => message.unread > 0)
    .sort((left, right) => {
      if (left.unread !== right.unread) return right.unread - left.unread;
      return left.name.localeCompare(right.name);
    })[0];

  if (!target) return null;

  return {
    source: "direct-message",
    href: `/chat/${target.id}`,
    title: target.name,
    summary: firstNonEmpty(target.summary, target.purpose, `${target.name} 在等你回复。`),
    reason: `${target.unread} 条未读私聊`,
    ctaLabel: "聊天",
  };
}

function buildChannelContinueTarget(channels: Channel[]): ContinueTarget | null {
  const target = [...channels]
    .filter((channel) => channel.unread > 0)
    .sort((left, right) => {
      if (left.unread !== right.unread) return right.unread - left.unread;
      return left.name.localeCompare(right.name);
    })[0];

  if (!target) return null;

  return {
    source: "channel",
    href: `/chat/${target.id}`,
    title: target.name,
    summary: firstNonEmpty(target.summary, target.purpose, `${target.name} 有新消息。`),
    reason: `${target.unread} 条未读频道消息`,
    ctaLabel: "聊天",
  };
}

export function sortRoomsForContinue(rooms: Room[]) {
  return [...rooms].sort((left, right) => {
    const leftRank = roomRank(left.topic.status, left.unread);
    const rightRank = roomRank(right.topic.status, right.unread);
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (left.unread !== right.unread) return right.unread - left.unread;
    if (left.boardCount !== right.boardCount) return right.boardCount - left.boardCount;
    return left.title.localeCompare(right.title);
  });
}

export function buildRoomContinueTarget(rooms: Room[]): ContinueTarget | null {
  const room = sortRoomsForContinue(rooms)[0];
  if (!room) return null;
  const roomSummary = firstNonEmpty(room.topic.summary, room.summary, room.topic.title, room.title);

  const source = roomTargetSource(room.topic.status, room.unread);
  const href = roomContinueHref(room, source);
  const ctaLabel = surfaceLabelFromHref(href);
  if (source === "room-blocked") {
    return {
      source,
      roomTitle: room.title,
      roomId: room.id,
      href,
      title: room.title,
      summary: roomSummary,
      reason: "阻塞 / 暂停优先",
      ctaLabel,
    };
  }
  if (source === "room-unread") {
    return {
      source,
      roomTitle: room.title,
      roomId: room.id,
      href,
      title: room.title,
      summary: roomSummary,
      reason: `${room.unread} 条未读`,
      ctaLabel,
    };
  }
  if (source === "room-active") {
    return {
      source,
      roomTitle: room.title,
      roomId: room.id,
      href,
      title: room.title,
      summary: roomSummary,
      reason: room.topic.status === "review" ? "当前评审中" : "当前进行中",
      ctaLabel,
    };
  }
  return {
    source,
    roomTitle: room.title,
    roomId: room.id,
    href,
    title: room.title,
    summary: roomSummary,
    reason: "最近讨论",
    ctaLabel,
  };
}

export function buildContinueTarget({
  inbox,
  approvalSignals = [],
  mailbox = [],
  pullRequests = [],
  channels,
  directMessages,
  rooms,
  journey,
  preferLaunchWhenIdle = false,
}: {
  inbox: InboxItem[];
  approvalSignals?: ApprovalCenterItem[];
  mailbox?: AgentHandoff[];
  pullRequests?: PullRequest[];
  channels: Channel[];
  directMessages: DirectMessage[];
  rooms: Room[];
  journey: FirstStartJourney;
  preferLaunchWhenIdle?: boolean;
}): ContinueTarget {
  const inboxTarget = buildInboxContinueTarget(inbox);
  if (inboxTarget) {
    return inboxTarget;
  }

  const approvalSignalTarget = buildApprovalSignalContinueTarget(approvalSignals);
  if (approvalSignalTarget) {
    return approvalSignalTarget;
  }

  const mailboxTarget = buildMailboxContinueTarget(mailbox);
  if (mailboxTarget) {
    return mailboxTarget;
  }

  const roomTarget = buildRoomContinueTarget(rooms);
  if (roomTarget?.source === "room-blocked") {
    return roomTarget;
  }

  const pullRequestTarget = buildPullRequestContinueTarget(pullRequests);
  if (pullRequestTarget) {
    return pullRequestTarget;
  }

  const directMessageTarget = buildDirectMessageContinueTarget(directMessages);
  if (directMessageTarget) {
    return directMessageTarget;
  }

  const channelTarget = buildChannelContinueTarget(channels);
  if (channelTarget) {
    return channelTarget;
  }

  if (roomTarget) {
    return roomTarget;
  }

  if (preferLaunchWhenIdle) {
    return {
      source: "launch",
      href: journey.launchHref,
      title: journey.launchSurfaceLabel === "聊天" ? "进入聊天" : `进入${journey.launchSurfaceLabel}`,
      summary: `当前没有新的待办，直接进入${journey.launchSurfaceLabel}。`,
      reason: "设置已经完成，先回到默认入口。",
      ctaLabel: journey.launchSurfaceLabel,
    };
  }

  return {
    source: "journey",
    href: journey.nextHref,
    title: journey.nextLabel,
    summary: journey.nextSummary,
    reason: "当前没有待办或讨论，先完成工作区下一步。",
    ctaLabel: journey.nextSurfaceLabel,
  };
}

type WorkspaceContinueState = Pick<
  PhaseZeroState,
  "workspace" | "auth" | "inbox" | "mailbox" | "channels" | "directMessages" | "rooms" | "pullRequests"
>;

export type WorkspaceContinueTarget = {
  journey: FirstStartJourney;
  target: ContinueTarget;
};

export function buildWorkspaceContinueTarget(
  state: WorkspaceContinueState,
  options?: { approvalSignals?: ApprovalCenterItem[]; preferLaunchWhenIdle?: boolean }
): WorkspaceContinueTarget {
  const journey = buildFirstStartJourney(state.workspace, state.auth.session);
  return {
    journey,
    target: buildContinueTarget({
      inbox: state.inbox,
      approvalSignals: options?.approvalSignals,
      mailbox: state.mailbox,
      pullRequests: state.pullRequests,
      channels: state.channels,
      directMessages: state.directMessages,
      rooms: state.rooms,
      journey,
      preferLaunchWhenIdle: options?.preferLaunchWhenIdle,
    }),
  };
}
