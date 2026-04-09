"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DestructiveGuardCard } from "@/components/destructive-guard-views";
import { QuickSearchSurface, StitchSidebar, StitchTopBar, WorkspaceStatusStrip } from "@/components/stitch-shell-primitives";
import { buildRunHistoryEntries } from "@/lib/phase-zero-helpers";
import { useQuickSearchController } from "@/lib/quick-search";
import { buildNamedProfileHref, buildProfileHref } from "@/lib/profile-surface";
import {
  type AgentHandoff,
  type ApprovalCenterItem,
  type DestructiveGuard,
  type Message,
  type PhaseZeroState,
  type PullRequest,
  type Room,
  type Run,
  type Session,
} from "@/lib/phase-zero-types";
import { type RoomStreamEvent, usePhaseZeroState } from "@/lib/live-phase0";
import { buildPlanningMirrorHref } from "@/lib/planning-mirror";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import { Panel, RunDetailView } from "@/components/phase-zero-views";
import { RunControlSurface } from "@/components/run-control-surface";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function roleLabel(role: Message["role"]) {
  switch (role) {
    case "human":
      return "人类";
    case "agent":
      return "Agent";
    default:
      return "System";
  }
}

function pullRequestStatusLabel(status?: string) {
  switch (status) {
    case "draft":
      return "草稿";
    case "open":
      return "已打开";
    case "in_review":
      return "评审中";
    case "changes_requested":
      return "待修改";
    case "merged":
      return "已合并";
    default:
      return "未创建";
  }
}

function runStatusLabel(status?: string) {
  switch (status) {
    case "running":
      return "执行中";
    case "paused":
      return "已暂停";
    case "review":
      return "评审中";
    case "blocked":
      return "阻塞";
    case "done":
      return "已完成";
    default:
      return "待同步";
  }
}

function buildMachineProfileHref(state: PhaseZeroState, machineRef: string) {
  const machine = state.machines.find((item) => item.id === machineRef || item.name === machineRef);
  return buildProfileHref("machine", machine?.id ?? machineRef);
}

function formatCount(value?: number) {
  return typeof value === "number" ? value.toLocaleString("zh-CN") : "未返回";
}

function runBudgetStatusLabel(status?: string) {
  switch (status) {
    case "near_limit":
      return "逼近上限";
    case "watch":
      return "进入观察";
    case "healthy":
      return "健康";
    default:
      return "待同步";
  }
}

function formatQuotaCounter(used?: number, limit?: number, label?: string) {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) {
    return "未返回";
  }
  return `${used}/${limit}${label ? ` ${label}` : ""}`;
}

function formatRetentionSummary(workspace?: PhaseZeroState["workspace"]) {
  const quota = workspace?.quota;
  if (!quota) {
    return "未返回";
  }
  return `${quota.messageHistoryDays}d 消息 / ${quota.runLogDays}d Run / ${quota.memoryDraftDays}d 草稿`;
}

function DiscussionStateMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[3px_3px_0_0_var(--shock-ink)]">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </section>
  );
}

const MARKER_PATTERN =
  /(PR\s?#\d+|#\d+|TC-\d+|TKT-\d+|CHK-\d+|TS\d+|@[A-Za-z0-9_\u4e00-\u9fa5-]+|origin\/[A-Za-z0-9._/-]+|feat\/[A-Za-z0-9._/-]+|verify:[A-Za-z0-9._/-]+|in_progress|in_review|todo|done|MERGED|PASS|FAIL|OPEN|CLEAN|MERGEABLE)/g;

function renderMarkedMessage(text: string) {
  return text.split(MARKER_PATTERN).map((part, index) => {
    if (!part) return null;
    const matched = part.match(MARKER_PATTERN);
    if (matched) {
      return (
        <span
          key={`${part}-${index}`}
          className="inline-block border border-[var(--shock-ink)] bg-[#f4df7f] px-1.5 py-[1px] font-mono text-[11px] leading-5"
        >
          {part}
        </span>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function messageBadgeTone(message: Message) {
  if (message.tone === "blocked") return "bg-[var(--shock-pink)] text-white";
  if (message.role === "agent") return "bg-[var(--shock-cyan)]";
  if (message.role === "human") return "bg-[var(--shock-yellow)]";
  return "bg-white";
}

function messageGlyph(message: Message) {
  if (message.role === "human") return "人";
  if (message.role === "agent") return "AI";
  return "SYS";
}

type ReplyTarget = {
  messageId: string;
  speaker: string;
  excerpt: string;
};

type ThreadMap = Record<string, Message[]>;
type ChannelWorkbenchTab = "chat" | "followed" | "saved";
type SidebarDirectMessage = {
  id: string;
  name: string;
  summary: string;
  purpose: string;
  unread: number;
  presence: "running" | "idle" | "blocked";
  counterpart: string;
};
type MessageSurfaceEntry = {
  id: string;
  channelId: string;
  messageId: string;
  channelLabel: string;
  title: string;
  summary: string;
  note: string;
  updatedAt: string;
  unread: number;
};
type MessageChannelSurface = {
  id: string;
  name: string;
  summary: string;
  purpose: string;
  unread: number;
  kind: "channel" | "dm";
  counterpart?: string;
  presence?: "running" | "idle" | "blocked";
};

const CHANNEL_WORKBENCH_TAB_LABEL: Record<ChannelWorkbenchTab, string> = {
  chat: "Chat",
  followed: "Followed",
  saved: "Saved Later",
};

function parseChannelWorkbenchTab(value?: string | null): ChannelWorkbenchTab {
  switch (value) {
    case "followed":
    case "saved":
      return value;
    default:
      return "chat";
  }
}

type RoomWorkbenchTab = "chat" | "topic" | "run" | "pr" | "context";

const ROOM_WORKBENCH_TABS: RoomWorkbenchTab[] = ["chat", "topic", "run", "pr", "context"];

const ROOM_WORKBENCH_TAB_LABEL: Record<RoomWorkbenchTab, string> = {
  chat: "Chat",
  topic: "Topic",
  run: "Run",
  pr: "PR",
  context: "Context",
};

function parseRoomWorkbenchTab(value?: string | null): RoomWorkbenchTab {
  switch (value) {
    case "topic":
    case "run":
    case "pr":
    case "context":
      return value;
    default:
      return "chat";
  }
}

function buildChannelWorkbenchHref(channelId: string, tab: ChannelWorkbenchTab, threadId?: string) {
  const params = new URLSearchParams();
  if (tab !== "chat") {
    params.set("tab", tab);
  }
  if (threadId) {
    params.set("thread", threadId);
  }
  const query = params.toString();
  return query ? `/chat/${channelId}?${query}` : `/chat/${channelId}`;
}

function buildThreadReopenHref(channelId: string, threadId: string) {
  return buildChannelWorkbenchHref(channelId, "chat", threadId);
}

const DIRECT_MESSAGES: SidebarDirectMessage[] = [
  {
    id: "dm-codex-dockmaster",
    name: "@Codex Dockmaster",
    summary: "room-first UI、thread reopen 和消息工作流的快速对齐面。",
    purpose: "这条 DM 用来快速对齐前台壳层和 thread reopen，不需要立刻升级成 room。",
    unread: 2,
    presence: "running",
    counterpart: "Codex Dockmaster",
  },
  {
    id: "dm-mina",
    name: "@Mina",
    summary: "copy、saved later 队列和人类回访习惯的收口面。",
    purpose: "产品文案和 saved-later 队列先在这条 DM 里收紧，再决定是否升级为正式 room。",
    unread: 1,
    presence: "idle",
    counterpart: "Mina",
  },
];

const DIRECT_MESSAGE_MESSAGES: Record<string, Message[]> = {
  "dm-codex-dockmaster": [
    {
      id: "msg-dm-codex-1",
      speaker: "Codex Dockmaster",
      role: "agent",
      tone: "agent",
      message: "我先不把这条抬成 room。等 thread follow / reopen 真闭环了，再升级。",
      time: "11:12",
    },
    {
      id: "msg-dm-codex-2",
      speaker: "Larkspur",
      role: "human",
      tone: "human",
      message: "可以。DM 先承担快速澄清，真正需要 run / PR / approval 时再升房间。",
      time: "11:14",
    },
  ],
  "dm-mina": [
    {
      id: "msg-dm-mina-1",
      speaker: "Mina",
      role: "human",
      tone: "human",
      message: "saved later 不应该像任务板，它更像“我晚点回来看这条 thread”。",
      time: "11:22",
    },
    {
      id: "msg-dm-mina-2",
      speaker: "System",
      role: "system",
      tone: "system",
      message: "已记录：Later surface 用于 revisit，不伪装成新一层 backlog。",
      time: "11:24",
    },
  ],
};

const DEFAULT_FOLLOWED_THREADS: MessageSurfaceEntry[] = [
  {
    id: "followed-all-runtime",
    channelId: "all",
    messageId: "msg-all-2",
    channelLabel: "#all",
    title: "Codex Dockmaster runtime sync thread",
    summary: "Runtime 在线状态已经同步；下一步要把真实 Run 和审批链路带进前台。",
    note: "这条 thread 已被 follow，用来反复回看频道里的关键协作线索。",
    updatedAt: "09:19",
    unread: 2,
  },
];

const DEFAULT_SAVED_LATER_ITEMS: MessageSurfaceEntry[] = [
  {
    id: "saved-roadmap-chat-first",
    channelId: "roadmap",
    messageId: "msg-roadmap-1",
    channelLabel: "#roadmap",
    title: "Longwen default-entry note",
    summary: "默认入口必须聊天优先，任务板只能是辅助视图。",
    note: "Later 队列里保留的是“之后要重新打开的消息”，不是新的 planning lane。",
    updatedAt: "10:06",
    unread: 1,
  },
  {
    id: "saved-dm-mina-later",
    channelId: "dm-mina",
    messageId: "msg-dm-mina-1",
    channelLabel: "@Mina",
    title: "Mina saved-later guideline",
    summary: "saved later 更像“晚点回来看这条 thread”，不是第二个 board。",
    note: "DM 里的轻量讨论也可以被 later 化，然后重新打开。",
    updatedAt: "11:24",
    unread: 0,
  },
];

function buildRoomWorkbenchHref(roomId: string, tab: RoomWorkbenchTab) {
  if (tab === "chat") {
    return `/rooms/${roomId}`;
  }
  return `/rooms/${roomId}?tab=${tab}`;
}

const CHANNEL_THREAD_REPLIES: Record<string, ThreadMap> = {
  all: {
    "msg-all-2": [
      {
        id: "thread-all-1",
        speaker: "Mina",
        role: "human",
        tone: "human",
        message: "那就别把机器状态塞进 setup 了，直接留在主壳和 room 里常驻。",
        time: "09:18",
      },
      {
        id: "thread-all-2",
        speaker: "Codex Dockmaster",
        role: "agent",
        tone: "agent",
        message: "收到。我会把 presence 和 room context 一起留在左栏和右 rail，不再只给后台页。",
        time: "09:19",
      },
    ],
  },
  roadmap: {
    "msg-roadmap-1": [
      {
        id: "thread-roadmap-1",
        speaker: "System",
        role: "system",
        tone: "system",
        message: "已记录：Board 仅保留为 planning mirror，不再作为首页主心智。",
        time: "10:06",
      },
    ],
  },
  "dm-codex-dockmaster": {
    "msg-dm-codex-1": [
      {
        id: "thread-dm-codex-1",
        speaker: "Larkspur",
        role: "human",
        tone: "human",
        message: "先把 revisit 做顺，再谈是不是要升成新 room。",
        time: "11:15",
      },
    ],
  },
  "dm-mina": {
    "msg-dm-mina-1": [
      {
        id: "thread-dm-mina-1",
        speaker: "System",
        role: "system",
        tone: "system",
        message: "Later surface 已记录为当前消息工作流的一等入口需求。",
        time: "11:25",
      },
    ],
  },
};

const ROOM_THREAD_REPLIES: Record<string, ThreadMap> = {
  "room-runtime": {
    "msg-room-1": [
      {
        id: "thread-room-runtime-1",
        speaker: "Larkspur",
        role: "human",
        tone: "human",
        message: "房间里只保留当前 room 的执行信息，不要再搞一个总览页。",
        time: "09:24",
      },
      {
        id: "thread-room-runtime-2",
        speaker: "Codex Dockmaster",
        role: "agent",
        tone: "agent",
        message: "明白。当前 room 会只盯住 branch、runtime、PR 和当前 topic，不再分散视线。",
        time: "09:25",
      },
    ],
    "msg-room-2": [
      {
        id: "thread-room-runtime-3",
        speaker: "System",
        role: "system",
        tone: "system",
        message: "Follow-thread 已可把后续恢复继续锁在同一条 room discussion 上。",
        time: "09:27",
      },
    ],
  },
  "room-inbox": {
    "msg-room-4": [
      {
        id: "thread-room-inbox-1",
        speaker: "Mina",
        role: "human",
        tone: "human",
        message: "Inbox 入口放左下角是对的，但卡片正文还得更克制。",
        time: "10:03",
      },
    ],
  },
  "room-memory": {
    "msg-room-6": [
      {
        id: "thread-room-memory-1",
        speaker: "Larkspur",
        role: "human",
        tone: "human",
        message: "先别写回，优先级策略没定之前必须卡住。",
        time: "10:32",
      },
    ],
  },
};

function messageExcerpt(text: string, maxLength = 72) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildReplyTarget(message: Message): ReplyTarget {
  return {
    messageId: message.id,
    speaker: message.speaker,
    excerpt: messageExcerpt(message.message, 56),
  };
}

function initialThreadMessageId(messages: Message[], threadMap: ThreadMap) {
  const seeded = messages.find((message) => (threadMap[message.id] ?? []).length > 0);
  return seeded?.id ?? messages[messages.length - 1]?.id ?? null;
}

function actionTone(tone: "yellow" | "white" | "ink") {
  switch (tone) {
    case "yellow":
      return "bg-[var(--shock-yellow)]";
    case "ink":
      return "bg-black text-white";
    default:
      return "bg-white";
  }
}

function signalTone(kind: ApprovalCenterItem["kind"]) {
  switch (kind) {
    case "approval":
      return "bg-[var(--shock-yellow)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "review":
      return "bg-[var(--shock-lime)]";
    default:
      return "bg-white";
  }
}

function signalLabel(kind: ApprovalCenterItem["kind"]) {
  switch (kind) {
    case "approval":
      return "Approval";
    case "blocked":
      return "Blocked";
    case "review":
      return "Review";
    default:
      return "Status";
  }
}

function handoffStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "ack";
    case "blocked":
      return "blocked";
    case "completed":
      return "done";
    default:
      return "requested";
  }
}

function handoffStatusTone(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "bg-[var(--shock-lime)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "completed":
      return "bg-[var(--shock-ink)] text-white";
    default:
      return "bg-[var(--shock-yellow)]";
  }
}

function RoomRelatedSignalsPanel({
  roomId,
  relatedSignals,
  recentSignals,
}: {
  roomId: string;
  relatedSignals: ApprovalCenterItem[];
  recentSignals: ApprovalCenterItem[];
}) {
  return (
    <Panel tone="white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
            Inbox Back-links
          </p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">
            {relatedSignals.length} open / {recentSignals.length} recent
          </p>
        </div>
        <Link
          href="/inbox"
          data-testid="room-workbench-open-inbox"
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
        >
          打开 Inbox
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {(relatedSignals.length === 0 ? recentSignals.slice(0, 2) : relatedSignals.slice(0, 3)).map((item) => (
          <div
            key={item.id}
            data-testid={`room-workbench-signal-${item.id}`}
            className={cn("border-2 border-[var(--shock-ink)] px-3 py-3 shadow-[var(--shock-shadow-sm)]", signalTone(item.kind))}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-white/90 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--shock-ink)]">
                {signalLabel(item.kind)}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] opacity-70">{item.time}</span>
            </div>
            <p className="mt-2 font-display text-[18px] font-bold leading-6">{item.title}</p>
            <p className="mt-2 text-[13px] leading-6 opacity-85">{item.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/inbox"
                className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shock-ink)]"
              >
                Inbox Detail
              </Link>
              <Link
                href={buildRoomWorkbenchHref(roomId, item.kind === "review" ? "pr" : "context")}
                className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
              >
                回到 Room
              </Link>
            </div>
          </div>
        ))}
        {relatedSignals.length === 0 && recentSignals.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            当前这条 room 还没有挂住新的 approval / blocked / review signal。
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function RoomMailboxPanel({
  roomId,
  handoffs,
}: {
  roomId: string;
  handoffs: AgentHandoff[];
}) {
  return (
    <Panel tone="paper">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
            Mailbox Back-links
          </p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">{handoffs.length} tracked handoffs</p>
        </div>
        <Link
          href={`/mailbox?roomId=${roomId}`}
          data-testid="room-workbench-open-mailbox"
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
        >
          打开 Mailbox
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {handoffs.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            当前这条 room 还没有 formal handoff；发起 request 后，这里会直接显示 request / ack / blocked / complete 轨迹。
          </p>
        ) : (
          handoffs.slice(0, 3).map((handoff) => (
            <Link
              key={handoff.id}
              href={`/mailbox?handoffId=${handoff.id}&roomId=${handoff.roomId}`}
              data-testid={`room-workbench-handoff-${handoff.id}`}
              className="block rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-[18px] font-bold leading-6">{handoff.title}</p>
                <span
                  className={cn(
                    "rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                    handoffStatusTone(handoff.status)
                  )}
                >
                  {handoffStatusLabel(handoff.status)}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                {handoff.fromAgent} {"->"} {handoff.toAgent}
              </p>
              <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{handoff.lastAction}</p>
            </Link>
          ))
        )}
      </div>
    </Panel>
  );
}

function RoomContextPanels({
  room,
  run,
  session,
  pullRequest,
  issueTitle,
  activeAgents,
  topicOwnerProfileHref,
  runOwnerProfileHref,
  machineProfileHref,
  sessionMemoryPaths,
  latestTimelineEvent,
  relatedGuards,
  relatedSignals,
  recentSignals,
  relatedHandoffs,
  canControlRun,
  runControlStatus,
  runControlBoundary,
  onRunControl,
  pullRequestActionLabel,
  pullRequestActionDisabled,
  onPullRequestAction,
  pullRequestActionStatus,
  pullRequestBoundary,
  prError,
}: {
  room: Room;
  run: Run;
  session?: Session;
  pullRequest?: PullRequest;
  issueTitle?: string;
  activeAgents: Array<{ id: string; name: string; state: string }>;
  topicOwnerProfileHref?: string | null;
  runOwnerProfileHref?: string | null;
  machineProfileHref?: string | null;
  sessionMemoryPaths: string[];
  latestTimelineEvent?: Run["timeline"][number];
  relatedGuards: DestructiveGuard[];
  relatedSignals: ApprovalCenterItem[];
  recentSignals: ApprovalCenterItem[];
  relatedHandoffs: AgentHandoff[];
  canControlRun: boolean;
  runControlStatus: string;
  runControlBoundary: string;
  onRunControl: (action: "stop" | "resume" | "follow_thread", note: string) => Promise<void>;
  pullRequestActionLabel: string;
  pullRequestActionDisabled: boolean;
  onPullRequestAction: (() => Promise<void>) | null;
  pullRequestActionStatus: string;
  pullRequestBoundary: string;
  prError: string | null;
}) {
  const currentRunStatus = session?.status ?? run.status;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel tone="white">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Topic</p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">{room.topic.title}</p>
          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">{room.topic.summary}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Owner</p>
              {topicOwnerProfileHref ? (
                <Link
                  href={topicOwnerProfileHref}
                  data-testid="room-workbench-topic-owner-profile"
                  className="mt-2 block text-sm font-semibold underline decoration-[1.5px] underline-offset-4"
                >
                  {room.topic.owner}
                </Link>
              ) : (
                <p className="mt-2 text-sm font-semibold">{room.topic.owner}</p>
              )}
            </div>
            <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Issue</p>
              <p className="mt-2 text-sm font-semibold">{room.issueKey}</p>
            </div>
          </div>
          {issueTitle ? (
            <p className="mt-3 text-[12px] leading-5 text-[color:rgba(24,20,14,0.6)]">
              当前 topic 绑定的 Issue 标题：{issueTitle}
            </p>
          ) : null}
        </Panel>

        <Panel tone="paper">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Context Links</p>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <Link
              href={`/issues/${room.issueKey}`}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              Issue Context
            </Link>
            <Link
              href={buildRoomWorkbenchHref(room.id, "run")}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              Run Truth
            </Link>
            <Link
              href={buildRoomWorkbenchHref(room.id, "pr")}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              PR Surface
            </Link>
            <Link
              href="/board"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              Board Mirror
            </Link>
          </div>
        </Panel>
      </div>

      <Panel tone="white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Run</p>
            <p className="mt-2 font-display text-[20px] font-bold leading-6">{run.id}</p>
          </div>
          <span
            data-testid="room-workbench-run-status"
            className={cn(
              "rounded-[4px] border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px]",
              currentRunStatus === "paused"
                ? "bg-[var(--shock-paper)]"
                : currentRunStatus === "blocked"
                  ? "bg-[var(--shock-pink)] text-white"
                  : currentRunStatus === "review"
                    ? "bg-[var(--shock-lime)]"
                    : currentRunStatus === "done"
                      ? "bg-[var(--shock-ink)] text-white"
                      : "bg-[var(--shock-yellow)]"
            )}
          >
            {runStatusLabel(currentRunStatus)}
          </span>
        </div>
        <p className="mt-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">
          Branch {session?.branch ?? run.branch}
        </p>
        <p className="mt-1 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">
          Worktree {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {machineProfileHref ? (
            <Link
              href={machineProfileHref}
              data-testid="room-workbench-machine-profile"
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              Machine Profile
            </Link>
          ) : null}
          {runOwnerProfileHref ? (
            <Link
              href={runOwnerProfileHref}
              data-testid="room-workbench-run-owner-profile"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              Owner Profile
            </Link>
          ) : null}
        </div>
      </Panel>

      <RunControlSurface
        scope="room"
        run={run}
        session={session}
        canControl={canControlRun}
        controlStatus={runControlStatus}
        controlBoundary={runControlBoundary}
        onControl={onRunControl}
      />

      {relatedGuards.length > 0 ? (
        <Panel tone="paper">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Guard Truth</p>
              <p className="mt-2 font-display text-[20px] font-bold leading-6">Destructive / Secret Boundary</p>
            </div>
            <span className="rounded-[4px] border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px]">
              {relatedGuards.length} active
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {relatedGuards.map((guard) => (
              <DestructiveGuardCard
                key={guard.id}
                guard={guard}
                compact
                contextHref={buildRoomWorkbenchHref(room.id, "run")}
                testIdPrefix="room-guard"
              />
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel tone="white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Pull Request</p>
            <p data-testid="room-workbench-pr-label" className="mt-2 font-display text-[20px] font-bold leading-6">
              {pullRequest?.label ?? run.pullRequest ?? "未创建"}
            </p>
          </div>
          <button
            type="button"
            data-testid="room-workbench-pr-action"
            disabled={pullRequestActionDisabled}
            onClick={() => void onPullRequestAction?.()}
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
          >
            {pullRequestActionLabel}
          </button>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {pullRequestActionStatus}
        </p>
        {(pullRequestActionStatus === "blocked" ||
          pullRequestActionStatus === "signed_out" ||
          pullRequestActionStatus === "review_only" ||
          pullRequestActionStatus === "merged") ? (
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{pullRequestBoundary}</p>
        ) : null}
        <p data-testid="room-workbench-pr-summary" className="mt-3 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
          {pullRequest?.reviewSummary ?? run.nextAction}
        </p>
        {prError ? (
          <p data-testid="room-workbench-pr-error" className="mt-3 font-mono text-[11px] text-[var(--shock-pink)]">
            {prError}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {pullRequest ? (
            <Link
              href={`/pull-requests/${pullRequest.id}`}
              data-testid="room-workbench-pr-detail-link"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              PR Detail
            </Link>
          ) : null}
          {pullRequest?.url ? (
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              Open Remote PR
            </Link>
          ) : null}
          <Link
            href="/inbox"
            data-testid="room-workbench-pr-inbox-link"
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
          >
            Inbox Back-link
          </Link>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel tone="ink">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">Session Memory</p>
          <div className="mt-3 space-y-2 font-mono text-[10px] leading-5 text-[#8bff9e]">
            {sessionMemoryPaths.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </Panel>
        <Panel tone="paper">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Active Presence</p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">{activeAgents.length} active agents</p>
          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
            最近执行 lane 仍挂在这个 room 上的 Agent 会在这里持续可见，不再只留在总览页 badge。
          </p>
          <div className="mt-4 space-y-2">
            {activeAgents.slice(0, 3).map((agent) => (
              <Link
                key={agent.id}
                href={buildProfileHref("agent", agent.id)}
                data-testid={`room-workbench-active-agent-${agent.id}`}
                className="block border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)]"
              >
                <p className="font-display text-[16px] font-semibold leading-5">{agent.name}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  {agent.state}
                </p>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel tone="yellow">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Tool Calls</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-none">{run.toolCalls.length}</p>
          <p className="mt-2 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.tool ?? "当前还没有工具调用"}</p>
          <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.summary ?? "等待下一条执行事件"}</p>
        </Panel>
        <Panel tone="white">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Timeline</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-none">{run.timeline.length}</p>
          <p className="mt-2 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{latestTimelineEvent?.label ?? "暂无事件"}</p>
          <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{latestTimelineEvent?.at ?? "等待同步"}</p>
        </Panel>
      </div>

      <RoomRelatedSignalsPanel roomId={room.id} relatedSignals={relatedSignals} recentSignals={recentSignals} />
      <RoomMailboxPanel roomId={room.id} handoffs={relatedHandoffs} />
    </div>
  );
}

function RoomTopicWorkbenchPanel({
  room,
  issueTitle,
  messages,
  topicOwnerProfileHref,
}: {
  room: Room;
  issueTitle?: string;
  messages: Message[];
  topicOwnerProfileHref?: string | null;
}) {
  const highlights = messages.slice(-3).reverse();

  return (
    <div data-testid="room-workbench-topic-panel" className="space-y-4">
      <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
          {room.issueKey} / Topic
        </p>
        <h3 className="mt-2 font-display text-3xl font-bold">{room.topic.title}</h3>
        <p className="mt-4 text-base leading-7">{room.topic.summary}</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Owner</p>
            {topicOwnerProfileHref ? (
              <Link
                href={topicOwnerProfileHref}
                data-testid="room-topic-owner-profile"
                className="mt-2 block font-display text-xl font-semibold underline decoration-[1.5px] underline-offset-4"
              >
                {room.topic.owner}
              </Link>
            ) : (
              <p className="mt-2 font-display text-xl font-semibold">{room.topic.owner}</p>
            )}
          </div>
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Board Mirror</p>
            <p className="mt-2 font-display text-xl font-semibold">{room.boardCount} cards</p>
          </div>
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Issue Title</p>
            <p className="mt-2 text-sm font-semibold leading-6">{issueTitle ?? "等待 issue detail 同步"}</p>
          </div>
        </div>
      </Panel>

      <Panel tone="white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Topic Guidance</p>
            <p className="mt-2 font-display text-[20px] font-bold leading-6">最近 room 语境</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/topics/${room.topic.id}`}
              data-testid="room-topic-open-route"
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              打开 Topic 页
            </Link>
            <Link
              href={buildRoomWorkbenchHref(room.id, "chat")}
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              回到 Chat
            </Link>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {highlights.map((message) => (
            <div key={message.id} className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]", messageBadgeTone(message))}>
                  {messageGlyph(message)} {roleLabel(message.role)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  {message.time}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6">{renderMarkedMessage(message.message)}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function RoomPullRequestWorkbenchPanel({
  roomId,
  pullRequest,
  actionLabel,
  actionDisabled,
  onAction,
  actionStatus,
  actionBoundary,
  prError,
  relatedSignals,
}: {
  roomId: string;
  pullRequest?: PullRequest;
  actionLabel: string;
  actionDisabled: boolean;
  onAction: (() => Promise<void>) | null;
  actionStatus: string;
  actionBoundary: string;
  prError: string | null;
  relatedSignals: ApprovalCenterItem[];
}) {
  return (
    <div data-testid="room-workbench-pr-panel" className="space-y-4">
      <Panel tone="white" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Pull Request</p>
            <h3 className="mt-2 font-display text-3xl font-bold">{pullRequest?.label ?? "未创建 PR"}</h3>
          </div>
          <button
            type="button"
            data-testid="room-workbench-pr-primary-action"
            disabled={actionDisabled}
            onClick={() => void onAction?.()}
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
          >
            {actionLabel}
          </button>
        </div>
        <p data-testid="room-workbench-pr-status" className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {actionStatus}
        </p>
        {(actionStatus === "blocked" ||
          actionStatus === "signed_out" ||
          actionStatus === "review_only" ||
          actionStatus === "merged") ? (
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{actionBoundary}</p>
        ) : null}
        <p className="mt-4 text-sm leading-6">{pullRequest?.title ?? "当前 room 还没有远端或本地 PR 对象。"}</p>
        <p data-testid="room-workbench-pr-review-summary" className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
          {pullRequest?.reviewSummary ?? "创建 PR 后，这里会直接展示 review / merge 当前真值。"}
        </p>
        {prError ? (
          <p className="mt-3 font-mono text-[11px] text-[var(--shock-pink)]">{prError}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {pullRequest ? (
            <Link
              href={`/pull-requests/${pullRequest.id}`}
              data-testid="room-pr-detail-link"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              PR Detail
            </Link>
          ) : null}
          <Link
            href="/inbox"
            className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Inbox Review
          </Link>
          {pullRequest?.url ? (
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              Remote PR
            </Link>
          ) : null}
          <Link
            href={buildRoomWorkbenchHref(roomId, "context")}
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Topic Context
          </Link>
        </div>
      </Panel>

      <RoomRelatedSignalsPanel roomId={roomId} relatedSignals={relatedSignals} recentSignals={[]} />
    </div>
  );
}

function RoomWorkbenchRailSummary({
  room,
  run,
  pullRequest,
  activeTab,
  activeAgentsCount,
  relatedSignals,
}: {
  room: Room;
  run: Run;
  pullRequest?: PullRequest;
  activeTab: RoomWorkbenchTab;
  activeAgentsCount: number;
  relatedSignals: ApprovalCenterItem[];
}) {
  return (
    <div className="space-y-3">
      <Panel tone="paper">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Workbench Summary</p>
        <div className="mt-3 space-y-2">
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Current Tab</p>
            <p className="mt-1.5 font-display text-[18px] font-semibold">{ROOM_WORKBENCH_TAB_LABEL[activeTab]}</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Run</p>
            <p className="mt-1.5 font-display text-[18px] font-semibold">{run.id}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              {runStatusLabel(run.status)}
            </p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">PR</p>
            <p className="mt-1.5 font-display text-[18px] font-semibold">{pullRequest?.label ?? "未创建"}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              {pullRequestStatusLabel(pullRequest?.status)}
            </p>
          </div>
        </div>
      </Panel>

      <Panel tone="white">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Quick Links</p>
        <div className="mt-3 grid gap-2">
          {ROOM_WORKBENCH_TABS.map((tab) => (
            <Link
              key={tab}
              href={buildRoomWorkbenchHref(room.id, tab)}
              className={cn(
                "border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]",
                activeTab === tab ? "bg-[var(--shock-yellow)]" : "bg-white"
              )}
            >
              {ROOM_WORKBENCH_TAB_LABEL[tab]}
            </Link>
          ))}
        </div>
      </Panel>

      <Panel tone="white">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Live Context</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Issue</p>
            <p className="mt-1.5 text-sm font-semibold">{room.issueKey}</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Signals</p>
            <p className="mt-1.5 text-sm font-semibold">{relatedSignals.length} open links</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Agents</p>
            <p className="mt-1.5 text-sm font-semibold">{activeAgentsCount} active</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Board</p>
            <p className="mt-1.5 text-sm font-semibold">{room.boardCount} mirror cards</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ReplyComposerChip({
  replyTarget,
  onClear,
}: {
  replyTarget: ReplyTarget;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 shadow-[var(--shock-shadow-sm)]">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          Reply
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] text-[color:rgba(24,20,14,0.74)]">
          {replyTarget.speaker}: {replyTarget.excerpt}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="min-h-[32px] rounded-[10px] border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-yellow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--shock-paper)]"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function ThreadReplyRow({ message }: { message: Message }) {
  return (
    <article className="border-b border-[color:rgba(24,20,14,0.12)] px-3 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-7 min-w-7 items-center justify-center border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
            messageBadgeTone(message)
          )}
        >
          {messageGlyph(message)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[13px] font-bold leading-none">{message.speaker}</span>
            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.5)]">{message.time}</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-[color:rgba(24,20,14,0.86)]">
            {renderMarkedMessage(message.message)}
          </div>
        </div>
      </div>
    </article>
  );
}

function ThreadRail({
  scopeLabel,
  selectedMessage,
  replies,
  replyTarget,
  onReply,
  primaryAction,
  secondaryAction,
  emptyTitle,
  emptyMessage,
}: {
  scopeLabel: string;
  selectedMessage?: Message;
  replies: Message[];
  replyTarget?: ReplyTarget | null;
  onReply: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    tone?: "yellow" | "white" | "ink";
    testId?: string;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    tone?: "yellow" | "white" | "ink";
    testId?: string;
  };
  emptyTitle: string;
  emptyMessage: string;
}) {
  return (
    <>
      <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[20px] font-bold leading-none">Thread</p>
            <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
              {scopeLabel}
            </p>
          </div>
          {primaryAction || secondaryAction ? (
            <div className="flex flex-wrap justify-end gap-2">
              {primaryAction ? (
                <button
                  type="button"
                  data-testid={primaryAction.testId}
                  onClick={() => void primaryAction.onClick()}
                  disabled={primaryAction.disabled}
                  className={cn(
                    "min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60",
                    actionTone(primaryAction.tone ?? "white")
                  )}
                >
                  {primaryAction.label}
                </button>
              ) : null}
              {secondaryAction ? (
                <button
                  type="button"
                  data-testid={secondaryAction.testId}
                  onClick={() => void secondaryAction.onClick()}
                  disabled={secondaryAction.disabled}
                  className={cn(
                    "min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60",
                    actionTone(secondaryAction.tone ?? "white")
                  )}
                >
                  {secondaryAction.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-y-contain p-3 [scrollbar-gutter:stable]">
        {!selectedMessage ? (
          <section className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
            <p className="font-display text-[18px] font-bold">{emptyTitle}</p>
            <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.7)]">{emptyMessage}</p>
          </section>
        ) : (
          <div className="space-y-3">
            <section className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                Parent Message
              </p>
              <div className="mt-3 flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 min-w-8 items-center justify-center border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
                    messageBadgeTone(selectedMessage)
                  )}
                >
                  {messageGlyph(selectedMessage)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[15px] font-bold leading-none">{selectedMessage.speaker}</p>
                    <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">{selectedMessage.time}</span>
                  </div>
                  <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.86)]">
                    {selectedMessage.message}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)]">
              <div className="border-b-2 border-[var(--shock-ink)] px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                  Replies
                </p>
              </div>
              {replies.length > 0 ? (
                replies.map((reply) => <ThreadReplyRow key={reply.id} message={reply} />)
              ) : (
                <div className="px-3 py-4 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                  当前还没有独立 reply，下一条就从这里继续。
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <button
          type="button"
          onClick={onReply}
          disabled={!selectedMessage}
          className="min-h-[44px] w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-yellow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
        >
          {selectedMessage && replyTarget?.messageId === selectedMessage.id
            ? "Reply target ready in composer"
            : "Reply in composer"}
        </button>
      </div>
    </>
  );
}

function MessageWorkbenchCollectionPanel({
  title,
  description,
  items,
  activeItemId,
  testId,
}: {
  title: string;
  description: string;
  items: Array<
    MessageSurfaceEntry & {
      surfaceHref: string;
      reopenHref: string;
      queueLabel: string;
      reopenTestId: string;
    }
  >;
  activeItemId?: string;
  testId: string;
}) {
  return (
    <div data-testid={testId} className="space-y-4">
      <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
        <p className="font-display text-[20px] font-bold">{title}</p>
        <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{description}</p>
      </section>

      {items.length > 0 ? (
        items.map((item) => (
          <section
            key={item.id}
            data-testid={`${testId}-card-${item.id}`}
            className={cn(
              "border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]",
              activeItemId === item.id && "bg-[#fff4cc]"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                {item.queueLabel}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                {item.channelLabel}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.5)]">
                {item.updatedAt}
              </span>
              {item.unread > 0 ? (
                <span className="ml-auto min-w-5 rounded-full border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-1 text-center font-mono text-[10px]">
                  {item.unread}
                </span>
              ) : null}
            </div>
            <p className="mt-3 font-display text-[18px] font-bold leading-6">{item.title}</p>
            <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.82)]">{item.summary}</p>
            <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.62)]">{item.note}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={item.reopenHref}
                data-testid={item.reopenTestId}
                className="border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)]"
              >
                Reopen Thread
              </Link>
              <Link
                href={item.surfaceHref}
                className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
              >
                Open Surface
              </Link>
            </div>
          </section>
        ))
      ) : (
        <section className="border-2 border-dashed border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
          <p className="font-display text-[18px] font-bold">当前还没有条目</p>
          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
            先在 Chat 里打开一条 thread，再选择 follow 或 save for later。
          </p>
        </section>
      )}
    </div>
  );
}

function MessageStreamRow({
  message,
  replyCount,
  threadActive = false,
  onOpenThread,
}: {
  message: Message;
  replyCount?: number;
  threadActive?: boolean;
  onOpenThread?: (message: Message) => void;
}) {
  return (
    <article
      className={cn(
        "border-b border-[color:rgba(24,20,14,0.12)] px-4 py-3.5 last:border-b-0",
        threadActive && "bg-[#fff4cc]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-[10px] border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
            messageBadgeTone(message)
          )}
        >
          {messageGlyph(message)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[14px] font-bold leading-none">{message.speaker}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.42)]">
              {roleLabel(message.role)}
            </span>
            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.5)]">{message.time}</span>
          </div>
          <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-[color:rgba(24,20,14,0.9)]">
            {renderMarkedMessage(message.message)}
          </div>
          {typeof replyCount === "number" || onOpenThread ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid={`message-thread-open-${message.id}`}
                onClick={() => onOpenThread?.(message)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1 rounded-full border border-[var(--shock-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff9ec]",
                  threadActive ? "bg-[var(--shock-yellow)]" : "bg-white"
                )}
              >
                {typeof replyCount === "number" && replyCount > 0
                  ? `${replyCount} ${replyCount > 1 ? "replies" : "reply"}`
                  : "Reply"}
              </button>
              {threadActive ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.5)]">
                  thread open
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function useStickyMessageScroll(scopeId: string, messageCount: number, latestMessageSize: number) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const updateStickiness = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom <= 72;
    };

    updateStickiness();
    node.addEventListener("scroll", updateStickiness, { passive: true });
    return () => node.removeEventListener("scroll", updateStickiness);
  }, [scopeId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !shouldStickToBottomRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [scopeId, messageCount, latestMessageSize]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    shouldStickToBottomRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [scopeId]);

  return scrollRef;
}

function ClaudeCompactComposer({
  room,
  initialMessages,
  onSend,
  canSend,
  sendStatus,
  sendBoundary,
  replyTarget,
  onClearReplyTarget,
  threadReplyCounts,
  activeThreadMessageId,
  onOpenThread,
}: {
  room: Room;
  initialMessages: Message[];
  onSend: (
    roomId: string,
    prompt: string,
    provider?: string,
    onEvent?: (event: RoomStreamEvent) => void
  ) => Promise<{ state?: PhaseZeroState; error?: string } | null | undefined>;
  canSend: boolean;
  sendStatus: string;
  sendBoundary: string;
  replyTarget?: ReplyTarget | null;
  onClearReplyTarget?: () => void;
  threadReplyCounts: Record<string, number>;
  activeThreadMessageId?: string | null;
  onOpenThread: (message: Message) => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("先给我一句结论：这个讨论间现在该先做哪一步？");
  const [loading, setLoading] = useState(false);
  const latestMessage = messages[messages.length - 1];
  const scrollRef = useStickyMessageScroll(room.id, messages.length, latestMessage?.message.length ?? 0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (replyTarget) {
      inputRef.current?.focus();
    }
  }, [replyTarget]);

  async function handleSend() {
    if (!draft.trim() || loading || !canSend) return;
    const prompt = draft.trim();
    const sendPrompt = replyTarget ? `回复 ${replyTarget.speaker}：${prompt}` : prompt;
    setLoading(true);
    const now = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const humanMessage: Message = {
      id: `local-human-${Date.now()}`,
      speaker: "Lead_Architect",
      role: "human",
      tone: "human",
      message: sendPrompt,
      time: now,
    };
    const agentMessageId = `local-agent-${Date.now()}`;
    const agentMessage: Message = {
      id: agentMessageId,
      speaker: "Shock_AI_Core",
      role: "agent",
      tone: "agent",
      message: "",
      time: now,
    };
    setMessages((current) => [...current, humanMessage, agentMessage]);

    try {
      const payload = await onSend(room.id, sendPrompt, "claude", (event) => {
        if (event.type === "stdout" && event.delta) {
          setMessages((current) =>
            current.map((item) =>
              item.id === agentMessageId ? { ...item, message: `${item.message}${event.delta}` } : item
            )
          );
        }
        if (event.type === "stderr" && event.delta) {
          setMessages((current) =>
            current.map((item) =>
              item.id === agentMessageId ? { ...item, tone: "blocked", message: `${item.message}${event.delta}` } : item
            )
          );
        }
      });
      const nextMessages = payload?.state?.roomMessages?.[room.id];
      if (nextMessages) {
        setMessages(nextMessages);
      } else {
        setMessages((current) =>
          current.map((item) =>
            item.id === agentMessageId && item.message.trim() === ""
              ? { ...item, message: payload?.error || "这次没有拿到可展示的输出。" }
              : item
          )
        );
      }
      setDraft("");
      onClearReplyTarget?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "bridge error";
      setMessages((current) => [
        ...current.filter((item) => item.id !== agentMessageId),
        {
          id: `err-${Date.now()}`,
          speaker: "System",
          role: "system",
          tone: "blocked",
          message: `Claude 连接失败：${message}`,
          time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleSend();
  }

  return (
    <>
      <div
        ref={scrollRef}
        data-testid="room-message-list"
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[var(--shock-paper)] [scroll-padding-bottom:11rem] [scrollbar-gutter:stable]"
      >
        <div className="mx-auto max-w-[1040px] border-x-2 border-[var(--shock-ink)] bg-[#fff9ec] pb-4">
          {messages.map((message) => (
            <MessageStreamRow
              key={message.id}
              message={message}
              replyCount={threadReplyCounts[message.id]}
              threadActive={activeThreadMessageId === message.id}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-white/95 px-4 py-3 shadow-[0_-3px_0_0_var(--shock-ink)] backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto max-w-[1040px]">
          {replyTarget ? (
            <ReplyComposerChip replyTarget={replyTarget} onClear={() => onClearReplyTarget?.()} />
          ) : null}
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="mx-auto flex max-w-[1040px] items-center gap-2">
          <button
            type="button"
            aria-label="attach room context"
            className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white text-lg shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            +
          </button>
          <input
            ref={inputRef}
            data-testid="room-message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canSend || loading}
            className="h-11 flex-1 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[13px] outline-none transition-colors duration-150 focus:bg-white focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            placeholder={replyTarget ? `继续回复 ${replyTarget.speaker}...` : "输入指令、问题或新的约束..."}
          />
          <button
            type="submit"
            data-testid="room-send-message"
            disabled={loading || !canSend}
            className="min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
          >
            {loading ? "..." : "Send"}
          </button>
        </form>
        <p data-testid="room-reply-authz" className="mx-auto mt-2 max-w-[1040px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {sendStatus}
        </p>
        {!canSend ? (
          <p className="mx-auto mt-2 max-w-[1040px] text-sm leading-6 text-[var(--shock-pink)]">{sendBoundary}</p>
        ) : null}
      </div>
    </>
  );
}

export function StitchChannelsView({ channelId }: { channelId: string }) {
  const searchParams = useSearchParams();
  const { state, approvalCenter, loading, error, postChannelMessage, postDirectMessage, updateMessageSurfaceCollection } = usePhaseZeroState();
  const quickSearch = useQuickSearchController(loading || error ? { ...state, channels: [], rooms: [], issues: [], runs: [], agents: [] } : state);
  const activeWorkbenchTab = parseChannelWorkbenchTab(searchParams.get("tab"));
  const queryThreadId = searchParams.get("thread");
  const liveChannel = loading || error ? undefined : state.channels.find((item) => item.id === channelId);
  const directMessage = (loading || error ? DIRECT_MESSAGES : state.directMessages).find((item) => item.id === channelId);
  const channel: MessageChannelSurface | undefined = liveChannel
    ? { ...liveChannel, kind: "channel" }
    : directMessage
      ? { ...directMessage, kind: "dm" }
      : undefined;
  const isDirectMessage = channel?.kind === "dm";
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const runningAgents = sidebarAgents.filter((agent) => agent.state === "running").length;
  const blockedAgents = sidebarAgents.filter((agent) => agent.state === "blocked").length;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const directMessageMessages = loading || error ? DIRECT_MESSAGE_MESSAGES : state.directMessageMessages;
  const followedThreads = loading || error ? DEFAULT_FOLLOWED_THREADS : state.followedThreads;
  const savedLaterItems = loading || error ? DEFAULT_SAVED_LATER_ITEMS : state.savedLaterItems;
  const messages = channel
    ? isDirectMessage
      ? directMessageMessages[channel.id] ?? []
      : state.channelMessages[channel.id] ?? []
    : [];
  const channelThreadReplies = channel ? CHANNEL_THREAD_REPLIES[channel.id] ?? {} : {};
  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const messageScrollRef = useStickyMessageScroll(channelId, messages.length, latestMessage?.message.length ?? 0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;
  const directMessagesForSidebar = (loading || error ? DIRECT_MESSAGES : state.directMessages).map((item) => ({
    ...item,
    href: buildChannelWorkbenchHref(item.id, "chat"),
  }));
  const followedItemsForSurface = followedThreads.map((item) => ({
    ...item,
    queueLabel: "Followed",
    surfaceHref: buildChannelWorkbenchHref(item.channelId, "followed", item.messageId),
    reopenHref: buildThreadReopenHref(item.channelId, item.messageId),
    reopenTestId: `followed-thread-reopen-${item.id}`,
  }));
  const savedItemsForSurface = savedLaterItems.map((item) => ({
    ...item,
    queueLabel: "Later",
    surfaceHref: buildChannelWorkbenchHref(item.channelId, "saved", item.messageId),
    reopenHref: buildThreadReopenHref(item.channelId, item.messageId),
    reopenTestId: `saved-later-reopen-${item.id}`,
  }));
  const followedThreadsForSidebar = followedThreads.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    meta: `${item.channelLabel} · ${item.updatedAt}`,
    unread: item.unread,
    href: buildChannelWorkbenchHref(item.channelId, "followed", item.messageId),
  }));
  const savedLaterForSidebar = savedLaterItems.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    meta: `${item.channelLabel} · ${item.updatedAt}`,
    unread: item.unread,
    href: buildChannelWorkbenchHref(item.channelId, "saved", item.messageId),
  }));
  const selectedThreadMessage =
    messages.find((message) => message.id === selectedThreadId) ??
    messages.find((message) => message.id === queryThreadId) ??
    messages.find((message) => message.id === initialThreadMessageId(messages, channelThreadReplies));
  const selectedThreadReplies = selectedThreadMessage ? channelThreadReplies[selectedThreadMessage.id] ?? [] : [];
  const selectedFollowedEntry =
    followedItemsForSurface.find((item) => item.channelId === channelId && item.messageId === queryThreadId) ??
    followedItemsForSurface.find((item) => item.channelId === channelId) ??
    followedItemsForSurface[0];
  const selectedSavedEntry =
    savedItemsForSurface.find((item) => item.channelId === channelId && item.messageId === queryThreadId) ??
    savedItemsForSurface.find((item) => item.channelId === channelId) ??
    savedItemsForSurface[0];
  const selectedCollectionEntry = activeWorkbenchTab === "followed" ? selectedFollowedEntry : selectedSavedEntry;
  const selectedCollectionMessage = selectedCollectionEntry
    ? (selectedCollectionEntry.channelId === channelId
        ? messages
        : directMessageMessages[selectedCollectionEntry.channelId] ?? state.channelMessages[selectedCollectionEntry.channelId] ?? []
      ).find((message) => message.id === selectedCollectionEntry.messageId)
    : undefined;
  const selectedCollectionReplies = selectedCollectionEntry
    ? (CHANNEL_THREAD_REPLIES[selectedCollectionEntry.channelId] ?? {})[selectedCollectionEntry.messageId] ?? []
    : [];
  const selectedFollowedThreadId = activeWorkbenchTab === "followed" ? selectedFollowedEntry?.id : undefined;
  const selectedSavedLaterId = activeWorkbenchTab === "saved" ? selectedSavedEntry?.id : undefined;
  const selectedDirectMessageId = isDirectMessage ? channelId : undefined;
  const selectedChannelLinkId = isDirectMessage ? undefined : channelId;
  const workbenchTabs = (["chat", "followed", "saved"] as ChannelWorkbenchTab[]).map((tab) => ({
    label: CHANNEL_WORKBENCH_TAB_LABEL[tab],
    href: buildChannelWorkbenchHref(channelId, tab, queryThreadId ?? undefined),
    testId: `channel-workbench-tab-${tab}`,
  }));
  const isSelectedThreadFollowed = Boolean(
    selectedThreadMessage &&
      followedThreads.some((item) => item.channelId === channelId && item.messageId === selectedThreadMessage.id)
  );
  const isSelectedThreadSaved = Boolean(
    selectedThreadMessage &&
      savedLaterItems.some((item) => item.channelId === channelId && item.messageId === selectedThreadMessage.id)
  );

  useEffect(() => {
    const nextThreadId =
      queryThreadId && messages.some((message) => message.id === queryThreadId)
        ? queryThreadId
        : initialThreadMessageId(messages, channelThreadReplies);
    setSelectedThreadId((current) => {
      if (queryThreadId && messages.some((message) => message.id === queryThreadId)) {
        return queryThreadId;
      }
      if (current && messages.some((message) => message.id === current)) {
        return current;
      }
      return nextThreadId;
    });
    setReplyTarget((current) => {
      if (current && messages.some((message) => message.id === current.messageId)) {
        return current;
      }
      return null;
    });
  }, [channelId, queryThreadId, messages, channelThreadReplies]);

  useEffect(() => {
    if (replyTarget) {
      inputRef.current?.focus();
    }
  }, [replyTarget]);

  function handleOpenThread(message: Message) {
    setSelectedThreadId(message.id);
    setReplyTarget(buildReplyTarget(message));
  }

  async function handleToggleFollowThread() {
    if (!selectedThreadMessage || !channel) return;
    const exists = followedThreads.some((item) => item.channelId === channelId && item.messageId === selectedThreadMessage.id);
    try {
      await updateMessageSurfaceCollection({
        kind: "followed",
        channelId,
        messageId: selectedThreadMessage.id,
        enabled: !exists,
      });
    } catch (collectionError) {
      setSendError(collectionError instanceof Error ? collectionError.message : "follow thread 写回失败");
    }
  }

  async function handleToggleSaveLater() {
    if (!selectedThreadMessage || !channel) return;
    const exists = savedLaterItems.some((item) => item.channelId === channelId && item.messageId === selectedThreadMessage.id);
    try {
      await updateMessageSurfaceCollection({
        kind: "saved",
        channelId,
        messageId: selectedThreadMessage.id,
        enabled: !exists,
      });
    } catch (collectionError) {
      setSendError(collectionError instanceof Error ? collectionError.message : "saved later 写回失败");
    }
  }

  async function handleChannelSend() {
    if (!channel || !draft.trim() || sending || loading || Boolean(error)) {
      return;
    }
    const sendPrompt = replyTarget ? `回复 ${replyTarget.speaker}：${draft.trim()}` : draft.trim();
    setSending(true);
    setSendError(null);
    try {
      if (isDirectMessage) {
        await postDirectMessage(channel.id, sendPrompt);
      } else {
        await postChannelMessage(channel.id, sendPrompt);
      }
      setDraft("");
      setReplyTarget(null);
    } catch (channelError) {
      setSendError(channelError instanceof Error ? channelError.message : "频道消息发送失败");
    } finally {
      setSending(false);
    }
  }

  async function handleChannelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleChannelSend();
  }

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <StitchSidebar
          active="channels"
          channels={sidebarChannels}
          directMessages={directMessagesForSidebar.map((item) => ({
            id: item.id,
            name: item.name,
            summary: item.summary,
            unread: item.unread,
            presence: item.presence,
            href: item.href,
          }))}
          followedThreads={followedThreadsForSidebar}
          savedLaterItems={savedLaterForSidebar}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          selectedChannelId={selectedChannelLinkId}
          selectedDirectMessageId={selectedDirectMessageId}
          selectedFollowedThreadId={selectedFollowedThreadId}
          selectedSavedLaterId={selectedSavedLaterId}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col bg-white">
          <WorkspaceStatusStrip
            workspaceName={workspaceName}
            disconnected={loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline")}
          />
          <StitchTopBar
            eyebrow={isDirectMessage ? "Direct Message" : "Workspace Channel"}
            title={loading ? "消息面同步中" : error ? "消息面同步失败" : channel?.name ?? channelId}
            description={
              loading
                ? "等待 live message surface 返回。"
                : error
                  ? error
                  : channel?.purpose ?? "当前还没有拿到这条消息面的 purpose。"
            }
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
            searchPlaceholder={isDirectMessage ? "Search DM / thread / saved later" : "Search channel / thread / saved later"}
            tabs={workbenchTabs}
            activeTab={CHANNEL_WORKBENCH_TAB_LABEL[activeWorkbenchTab]}
          />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {workspaceName || "OpenShock"}
              </span>
              {isDirectMessage ? (
                <>
                  <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    dm 1:1
                  </span>
                  <span
                    className={cn(
                      "border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                      channel?.presence === "running"
                        ? "bg-[var(--shock-lime)]"
                        : channel?.presence === "blocked"
                          ? "bg-[var(--shock-pink)] text-white"
                          : "bg-white"
                    )}
                  >
                    {channel?.presence ?? "idle"}
                  </span>
                  <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {channel?.unread ?? 0} unread
                  </span>
                </>
              ) : (
                <>
                  <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {sidebarMachines.length} machines
                  </span>
                  <span className="border border-[var(--shock-ink)] bg-[var(--shock-lime)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {runningAgents} active citizens
                  </span>
                  <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {blockedAgents} blocked
                  </span>
                </>
              )}
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {inboxCount} inbox
              </span>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              {activeWorkbenchTab === "chat" ? (
                <>
                  <div
                    ref={messageScrollRef}
                    data-testid="channel-message-list"
                    className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[var(--shock-paper)] [scroll-padding-bottom:11rem] [scrollbar-gutter:stable]"
                  >
                    <div className="mx-auto max-w-[1040px] border-x-2 border-[var(--shock-ink)] bg-[#fff9ec] pb-4">
                      <div className="border-b-2 border-[var(--shock-ink)] px-4 py-3">
                        <p className="font-display text-[18px] font-bold">{channel?.name ?? "等待同步"}</p>
                        <p className="mt-1 text-[12px] leading-5 text-[color:rgba(24,20,14,0.64)]">
                          {channel?.summary ?? channel?.purpose ?? "当前还没有拿到这条消息面的 purpose。"}
                        </p>
                      </div>
                      {loading ? (
                        <DiscussionStateMessage
                          title="正在同步消息面真值"
                          message="等待 server 返回当前 channel / DM state，前端先不回退到别的页面。"
                        />
                      ) : error ? (
                        <DiscussionStateMessage title="消息面同步失败" message={error} />
                      ) : !channel ? (
                        <DiscussionStateMessage
                          title="未找到消息面"
                          message={`当前找不到 \`${channelId}\` 对应的 channel / DM 记录。`}
                        />
                      ) : messages.length === 0 ? (
                        <DiscussionStateMessage
                          title="这个消息面当前还没有内容"
                          message="等第一条消息出现后，这里会直接显示真实流。"
                        />
                      ) : (
                        messages.map((message) => (
                          <MessageStreamRow
                            key={message.id}
                            message={message}
                            replyCount={channelThreadReplies[message.id]?.length}
                            threadActive={selectedThreadMessage?.id === message.id}
                            onOpenThread={handleOpenThread}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  <div className="border-t-2 border-[var(--shock-ink)] bg-white/95 px-4 py-3 shadow-[0_-3px_0_0_var(--shock-ink)] backdrop-blur supports-[backdrop-filter]:bg-white/85">
                    <div className="mx-auto max-w-[1040px]">
                      {replyTarget ? (
                        <ReplyComposerChip replyTarget={replyTarget} onClear={() => setReplyTarget(null)} />
                      ) : null}
                    </div>
                    <form onSubmit={(event) => void handleChannelSubmit(event)} className="mx-auto flex max-w-[1040px] items-center gap-2">
                      <button
                        type="button"
                        aria-label="attach message context"
                        className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white text-lg shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                      >
                        +
                      </button>
                      <input
                        ref={inputRef}
                        data-testid="channel-message-input"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        disabled={!channel || loading || Boolean(error) || sending}
                        className="h-11 flex-1 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[13px] outline-none transition-colors duration-150 focus:bg-white focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                        placeholder={
                          replyTarget
                            ? `继续回复 ${replyTarget.speaker}...`
                            : channel
                              ? `发送消息到 ${channel.name}...`
                              : "等待消息面同步..."
                        }
                      />
                      <button
                        type="button"
                        aria-label="mention teammate"
                        className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                      >
                        @
                      </button>
                      <button
                        type="submit"
                        data-testid="channel-send-message"
                        disabled={!channel || loading || Boolean(error) || sending || !draft.trim()}
                        className="min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
                      >
                        {sending ? "..." : "Send"}
                      </button>
                    </form>
                    {sendError ? (
                      <p data-testid="channel-send-error" className="mx-auto mt-3 max-w-[1040px] text-sm leading-6 text-[var(--shock-pink)]">
                        {sendError}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : activeWorkbenchTab === "followed" ? (
                <div className="min-h-0 overflow-y-auto bg-[var(--shock-paper)] p-4">
                  <MessageWorkbenchCollectionPanel
                    title="Followed Threads"
                    description="从这里重新打开你决定持续跟踪的线程，不必再从消息流里重新翻。"
                    items={followedItemsForSurface}
                    activeItemId={selectedFollowedEntry?.id}
                    testId="followed-thread-panel"
                  />
                </div>
              ) : (
                <div className="min-h-0 overflow-y-auto bg-[var(--shock-paper)] p-4">
                  <MessageWorkbenchCollectionPanel
                    title="Saved Later"
                    description="Later 队列只收“晚点再回看”的消息，不复制出第二个任务板。"
                    items={savedItemsForSurface}
                    activeItemId={selectedSavedEntry?.id}
                    testId="saved-later-panel"
                  />
                </div>
              )}
                </div>

            <aside className="hidden min-h-0 flex-col border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex">
              {activeWorkbenchTab === "chat" ? (
                <ThreadRail
                  scopeLabel={channel?.name ?? "channel"}
                  selectedMessage={selectedThreadMessage}
                  replies={selectedThreadReplies}
                  replyTarget={replyTarget}
                  onReply={() => {
                    if (selectedThreadMessage) {
                      setReplyTarget(buildReplyTarget(selectedThreadMessage));
                    }
                  }}
                  primaryAction={{
                    label: isSelectedThreadFollowed ? "Following" : "Follow Thread",
                    onClick: handleToggleFollowThread,
                    disabled: !selectedThreadMessage,
                    tone: isSelectedThreadFollowed ? "ink" : "yellow",
                    testId: "channel-thread-follow",
                  }}
                  secondaryAction={{
                    label: isSelectedThreadSaved ? "Saved" : "Save Later",
                    onClick: handleToggleSaveLater,
                    disabled: !selectedThreadMessage,
                    tone: "white",
                    testId: "channel-thread-save-later",
                  }}
                  emptyTitle="先选一条消息"
                  emptyMessage="thread 是频道消息的局部回复区。先在左侧消息流里点一条消息，再决定要不要 follow 或稍后回看。"
                />
              ) : (
                <>
                  <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                    <p className="font-display text-[20px] font-bold leading-none">
                      {activeWorkbenchTab === "followed" ? "Followed Rail" : "Saved Rail"}
                    </p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
                      {selectedCollectionEntry?.channelLabel ?? channel?.name ?? channelId}
                    </p>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {selectedCollectionEntry && selectedCollectionMessage ? (
                      <div className="space-y-3">
                        <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                              {activeWorkbenchTab === "followed" ? "Followed" : "Later"}
                            </span>
                            <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                              {selectedCollectionEntry.channelLabel}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.5)]">
                              {selectedCollectionEntry.updatedAt}
                            </span>
                          </div>
                          <p className="mt-3 font-display text-[18px] font-bold leading-6">{selectedCollectionEntry.title}</p>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.82)]">{selectedCollectionEntry.note}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                              href={selectedCollectionEntry.reopenHref}
                              data-testid={activeWorkbenchTab === "followed" ? "followed-thread-rail-reopen" : "saved-later-rail-reopen"}
                              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)]"
                            >
                              Reopen Thread
                            </Link>
                            <Link
                              href={selectedCollectionEntry.surfaceHref}
                              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
                            >
                              Open Queue
                            </Link>
                          </div>
                        </section>

                        <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                            Parent Message
                          </p>
                          <p className="mt-3 font-display text-[15px] font-bold">{selectedCollectionMessage.speaker}</p>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.84)]">{selectedCollectionMessage.message}</p>
                        </section>

                        <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                            Replies
                          </p>
                          <p className="mt-2 font-display text-[18px] font-bold leading-none">{selectedCollectionReplies.length}</p>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                            这条消息当前有 {selectedCollectionReplies.length} 条 reply，可在 reopen 后继续 thread 级回访。
                          </p>
                        </section>
                      </div>
                    ) : (
                      <DiscussionStateMessage
                        title="等待条目"
                        message="先在 Chat 里选一条消息并 follow / save，它就会进入这个回访队列。"
                      />
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export function StitchDiscussionView({ roomId }: { roomId: string }) {
  const searchParams = useSearchParams();
  const { state, approvalCenter, loading, error, streamRoomMessage, createPullRequest, updatePullRequest, controlRun } = usePhaseZeroState();
  const quickSearch = useQuickSearchController(loading || error ? { ...state, channels: [], rooms: [], issues: [], runs: [], agents: [] } : state);
  const room = state.rooms.find((item) => item.id === roomId);
  const run = room ? state.runs.find((item) => item.id === room.runId) : undefined;
  const session = room
    ? state.sessions.find((item) => item.activeRunId === room.runId) ??
      state.sessions.find((item) => item.roomId === room.id)
    : undefined;
  const issue = room ? state.issues.find((item) => item.roomId === room.id) : undefined;
  const authSession = state.auth.session;
  const currentRunStatus = session?.status ?? run?.status;
  const runPaused = currentRunStatus === "paused";
  const messages = room ? state.roomMessages[room.id] ?? [] : [];
  const roomThreadReplies = room ? ROOM_THREAD_REPLIES[room.id] ?? {} : {};
  const pullRequest = room ? state.pullRequests.find((item) => item.roomId === room.id) : undefined;
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [railMode, setRailMode] = useState<"context" | "thread">("context");
  const canMerge = pullRequest && pullRequest.status !== "merged";
  const canReply = !loading && !error && !runPaused && hasSessionPermission(authSession, "room.reply");
  const roomReplyStatus = loading ? "syncing" : error ? "sync_failed" : runPaused ? "paused" : permissionStatus(authSession, "room.reply");
  const roomReplyBoundary = runPaused
    ? "当前 run 已暂停。先在右侧 Run Control 里 Resume，或先锁定 follow-thread 再恢复执行。"
    : permissionBoundaryCopy(authSession, "room.reply");
  const canControlRun = !loading && !error && hasSessionPermission(authSession, "run.execute");
  const runControlStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "run.execute");
  const runControlBoundary = permissionBoundaryCopy(authSession, "run.execute");
  const canReviewPullRequest = hasSessionPermission(authSession, "pull_request.review");
  const canMergePullRequest = hasSessionPermission(authSession, "pull_request.merge");
  const activeAgents =
    room && run
      ? state.agents.filter(
          (agent) => agent.lane === room.issueKey || agent.recentRunIds.includes(run.id)
        )
      : [];
  const topicOwnerProfileHref = room
    ? buildNamedProfileHref(room.topic.owner, {
        agents: state.agents,
        members: state.auth.members,
        prefer: "agent",
      })
    : null;
  const runOwnerProfileHref = run
    ? buildNamedProfileHref(run.owner, {
        agents: state.agents,
        members: state.auth.members,
        prefer: "agent",
      })
    : null;
  const machineProfileHref = run ? buildMachineProfileHref(state, run.machine) : null;
  const sessionMemoryPaths =
    session && session.memoryPaths.length > 0
      ? session.memoryPaths
      : ["当前 session 还没有暴露 memory paths"];
  const latestTimelineEvent = run ? run.timeline[run.timeline.length - 1] : undefined;
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;
  const activeWorkbenchTab = parseRoomWorkbenchTab(searchParams.get("tab"));
  const planningMirrorHref = room
    ? buildPlanningMirrorHref({
        roomId: room.id,
        issueKey: room.issueKey,
        returnTo: buildRoomWorkbenchHref(room.id, activeWorkbenchTab),
        returnLabel: room.title,
      })
    : "/board";
  const selectedThreadMessage =
    messages.find((message) => message.id === selectedThreadId) ?? messages.find((message) => message.id === initialThreadMessageId(messages, roomThreadReplies));
  const selectedThreadReplies = selectedThreadMessage ? roomThreadReplies[selectedThreadMessage.id] ?? [] : [];
  const threadReplyCounts = Object.fromEntries(
    messages.map((message) => [message.id, roomThreadReplies[message.id]?.length ?? 0])
  );
  const relatedSignals =
    loading || error || !room || !run
      ? []
      : approvalCenter.signals.filter(
          (item) =>
            item.roomId === room.id ||
            item.runId === run.id ||
            item.href.includes(room.id) ||
            item.href.includes(run.id)
        );
  const relatedHandoffs =
    loading || error || !room
      ? []
      : state.mailbox.filter((handoff) => handoff.roomId === room.id);
  const recentSignals =
    loading || error || !room || !run
      ? []
      : approvalCenter.recent.filter(
          (item) =>
            item.roomId === room.id ||
            item.runId === run.id ||
            item.href.includes(room.id) ||
            item.href.includes(run.id)
        );
  const relatedGuards =
    loading || error || !room || !run
      ? []
      : state.guards.filter((guard) => guard.roomId === room.id || guard.runId === run.id);
  const roomRunHistory = loading || error || !room ? [] : buildRunHistoryEntries(state, room.id);
  const workbenchTabs = ROOM_WORKBENCH_TABS.map((tab) => ({
    label: ROOM_WORKBENCH_TAB_LABEL[tab],
    href: buildRoomWorkbenchHref(roomId, tab),
    testId: `room-workbench-tab-${tab}`,
  }));

  useEffect(() => {
    const nextThreadId = initialThreadMessageId(messages, roomThreadReplies);
    setSelectedThreadId((current) => {
      if (current && messages.some((message) => message.id === current)) {
        return current;
      }
      return nextThreadId;
    });
    setReplyTarget((current) => {
      if (current && messages.some((message) => message.id === current.messageId)) {
        return current;
      }
      return null;
    });
  }, [roomId, messages, roomThreadReplies]);

  function handleOpenThread(message: Message) {
    setSelectedThreadId(message.id);
    setReplyTarget(buildReplyTarget(message));
    setRailMode("thread");
  }

  async function handleCreatePullRequest() {
    if (!room || prLoading || !canReviewPullRequest) return;
    setPrLoading(true);
    setPrError(null);
    try {
      await createPullRequest(room.id);
    } catch (pullRequestError) {
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "pull request create failed");
    } finally {
      setPrLoading(false);
    }
  }

  async function handleMergePullRequest() {
    if (!pullRequest || prLoading || !canMergePullRequest) return;
    setPrLoading(true);
    setPrError(null);
    try {
      await updatePullRequest(pullRequest.id, { status: "merged" });
    } catch (pullRequestError) {
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "pull request merge failed");
    } finally {
      setPrLoading(false);
    }
  }

  async function handleSyncPullRequest() {
    if (!pullRequest || prLoading || !canReviewPullRequest) return;
    setPrLoading(true);
    setPrError(null);
    try {
      await updatePullRequest(pullRequest.id, { status: pullRequest.status === "changes_requested" ? "changes_requested" : "in_review" });
    } catch (pullRequestError) {
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "pull request sync failed");
    } finally {
      setPrLoading(false);
    }
  }

  async function handleRunControl(action: "stop" | "resume" | "follow_thread", note: string) {
    if (!run) return;
    await controlRun(run.id, { action, note });
  }

  let pullRequestActionLabel = "发起 PR";
  let pullRequestActionDisabled = !room || prLoading || !canReviewPullRequest;
  let pullRequestActionHandler: (() => Promise<void>) | null = handleCreatePullRequest;
  let pullRequestActionStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "pull_request.review");
  let pullRequestBoundary = permissionBoundaryCopy(authSession, "pull_request.review");

  if (pullRequest?.status === "merged") {
    pullRequestActionLabel = "已合并";
    pullRequestActionDisabled = true;
    pullRequestActionHandler = null;
    pullRequestActionStatus = "merged";
    pullRequestBoundary = "当前 PR 已合并，不再提供新的 review / merge 动作。";
  } else if (pullRequest) {
    if (canMergePullRequest) {
      pullRequestActionLabel = canMerge ? "合并 PR" : "已合并";
      pullRequestActionDisabled = prLoading || !canMerge;
      pullRequestActionHandler = handleMergePullRequest;
      pullRequestActionStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "pull_request.merge");
      pullRequestBoundary = permissionBoundaryCopy(authSession, "pull_request.merge");
    } else {
      pullRequestActionLabel = "同步 PR";
      pullRequestActionDisabled = prLoading || !canReviewPullRequest;
      pullRequestActionHandler = handleSyncPullRequest;
      pullRequestActionStatus =
        loading || error ? "syncing" : canReviewPullRequest ? "review_only" : permissionStatus(authSession, "pull_request.review");
      pullRequestBoundary = canReviewPullRequest
        ? "当前 session 只有 review 权限，可以同步 PR 状态，但不能直接 merge。"
        : permissionBoundaryCopy(authSession, "pull_request.review");
    }
  }

  const contextPanels =
    room && run ? (
      <RoomContextPanels
        room={room}
        run={run}
        session={session}
        pullRequest={pullRequest}
        issueTitle={issue?.title}
        activeAgents={activeAgents}
        topicOwnerProfileHref={topicOwnerProfileHref}
        runOwnerProfileHref={runOwnerProfileHref}
        machineProfileHref={machineProfileHref}
        sessionMemoryPaths={sessionMemoryPaths}
        latestTimelineEvent={latestTimelineEvent}
        relatedGuards={relatedGuards}
        relatedSignals={relatedSignals}
        recentSignals={recentSignals}
        relatedHandoffs={relatedHandoffs}
        canControlRun={canControlRun}
        runControlStatus={runControlStatus}
        runControlBoundary={runControlBoundary}
        onRunControl={handleRunControl}
        pullRequestActionLabel={pullRequestActionLabel}
        pullRequestActionDisabled={pullRequestActionDisabled}
        onPullRequestAction={pullRequestActionHandler}
        pullRequestActionStatus={pullRequestActionStatus}
        pullRequestBoundary={pullRequestBoundary}
        prError={prError}
      />
    ) : null;

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <StitchSidebar
          active="rooms"
          channels={sidebarChannels}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          selectedRoomId={roomId}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col bg-white">
          <WorkspaceStatusStrip
            workspaceName={workspaceName}
            disconnected={loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline")}
          />
          <StitchTopBar
            eyebrow="Issue Room"
            title={loading ? "讨论间同步中" : error ? "讨论间同步失败" : room?.title ?? roomId}
            description={
              loading
                ? "等待 live room / run state 返回。"
                : error
                  ? error
                  : room?.summary ?? "当前还没有拿到这间房的 live 摘要。"
            }
            searchPlaceholder="Search room / run / PR / board"
            tabs={workbenchTabs}
            activeTab={ROOM_WORKBENCH_TAB_LABEL[activeWorkbenchTab]}
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {room?.issueKey ?? "issue"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                run {currentRunStatus ?? "syncing"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {room?.boardCount ?? 0} board cards
              </span>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-[18px] font-bold">
                      {room?.topic.title ?? "等待讨论间同步"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={room ? `/issues/${room.issueKey}` : "/issues"}
                      className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      Issue
                    </Link>
                    <Link
                      href={planningMirrorHref}
                      data-testid="room-open-planning-mirror"
                      className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      Planning mirror
                    </Link>
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="p-4">
                  <DiscussionStateMessage title="正在同步讨论间真值" message="等待 server 返回当前 room / run / message 状态，前端不再自动退回另一间旧的 seed room。" />
                </div>
              ) : error ? (
                <div className="p-4">
                  <DiscussionStateMessage title="讨论间同步失败" message={error} />
                </div>
              ) : !room || !run ? (
                <div className="p-4">
                  <DiscussionStateMessage title="未找到讨论间" message={`当前找不到 \`${roomId}\` 对应的 live room / run 记录。`} />
                </div>
              ) : (
                <div className="min-h-0 overflow-y-auto bg-[var(--shock-paper)] p-3">
                  {activeWorkbenchTab === "chat" ? (
                    <ClaudeCompactComposer
                      room={room}
                      initialMessages={messages}
                      onSend={streamRoomMessage}
                      canSend={canReply}
                      sendStatus={roomReplyStatus}
                      sendBoundary={roomReplyBoundary}
                      replyTarget={replyTarget}
                      onClearReplyTarget={() => setReplyTarget(null)}
                      threadReplyCounts={threadReplyCounts}
                      activeThreadMessageId={selectedThreadMessage?.id}
                      onOpenThread={handleOpenThread}
                    />
                  ) : activeWorkbenchTab === "topic" ? (
                    <RoomTopicWorkbenchPanel
                      room={room}
                      issueTitle={issue?.title}
                      messages={messages}
                      topicOwnerProfileHref={topicOwnerProfileHref}
                    />
                  ) : activeWorkbenchTab === "run" ? (
                    <div data-testid="room-workbench-run-panel" className="space-y-4">
                      <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Run Usage</p>
                        <div className="mt-3 border-2 border-[var(--shock-ink)] bg-[#f7f7f7] px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Current Branch</p>
                              <p className="mt-2 font-display text-[18px] font-bold leading-6">{session?.branch ?? run.branch}</p>
                            </div>
                            <span
                              data-testid="room-run-status"
                              className={cn(
                                "rounded-[4px] border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px]",
                                currentRunStatus === "paused"
                                  ? "bg-[var(--shock-paper)]"
                                  : currentRunStatus === "blocked"
                                    ? "bg-[var(--shock-pink)] text-white"
                                    : currentRunStatus === "review"
                                      ? "bg-[var(--shock-lime)]"
                                      : currentRunStatus === "done"
                                        ? "bg-[var(--shock-ink)] text-white"
                                        : "bg-[var(--shock-yellow)]"
                              )}
                            >
                              {runStatusLabel(currentRunStatus)}
                            </span>
                          </div>
                          <p className="mt-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">
                            Worktree {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">
                            Last Sync {session?.updatedAt || run.startedAt}
                          </p>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="border-2 border-[var(--shock-ink)] bg-white px-2.5 py-2">
                              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Prompt</p>
                              <p className="mt-1 text-sm font-semibold">{formatCount(run.usage?.promptTokens)}</p>
                            </div>
                            <div className="border-2 border-[var(--shock-ink)] bg-white px-2.5 py-2">
                              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Completion</p>
                              <p className="mt-1 text-sm font-semibold">{formatCount(run.usage?.completionTokens)}</p>
                            </div>
                            <div className="border-2 border-[var(--shock-ink)] bg-white px-2.5 py-2">
                              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Budget</p>
                              <p className="mt-1 text-sm font-semibold">{runBudgetStatusLabel(run.usage?.budgetStatus)}</p>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Usage / Quota</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Room</p>
                            <p className="mt-2 text-sm font-semibold">
                              {formatCount(room.usage?.messageCount)} msgs / {formatCount(room.usage?.totalTokens)} tokens
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">
                              {formatCount(room.usage?.humanTurns)} human / {formatCount(room.usage?.agentTurns)} agent · {room.usage?.windowLabel ?? "窗口未返回"}
                            </p>
                          </div>
                          <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Workspace</p>
                            <p className="mt-2 text-sm font-semibold">{state.workspace.plan || "未命名计划"}</p>
                            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">
                              {formatQuotaCounter(state.workspace.quota?.usedAgents, state.workspace.quota?.maxAgents, "agents")} ·{" "}
                              {formatQuotaCounter(state.workspace.quota?.usedRooms, state.workspace.quota?.maxRooms, "rooms")}
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{formatRetentionSummary(state.workspace)}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[12px] leading-6 text-[color:rgba(24,20,14,0.7)]">
                          {run.usage?.warning ?? room.usage?.warning ?? state.workspace.usage?.warning ?? state.workspace.quota?.warning ?? "当前还没有 usage / quota warning。"}
                        </p>
                      </section>

                      <RunControlSurface
                        scope="room"
                        run={run}
                        session={session}
                        canControl={canControlRun}
                        controlStatus={runControlStatus}
                        controlBoundary={runControlBoundary}
                        onControl={handleRunControl}
                      />
                      <RunDetailView
                        run={run}
                        statusTestId="room-workbench-run-detail-status"
                        session={session}
                        history={roomRunHistory}
                        guards={relatedGuards.filter((guard) => guard.runId === run.id)}
                      />
                    </div>
                  ) : activeWorkbenchTab === "pr" ? (
                    <RoomPullRequestWorkbenchPanel
                      roomId={room.id}
                      pullRequest={pullRequest}
                      actionLabel={pullRequestActionLabel}
                      actionDisabled={pullRequestActionDisabled}
                      onAction={pullRequestActionHandler}
                      actionStatus={pullRequestActionStatus}
                      actionBoundary={pullRequestBoundary}
                      prError={prError}
                      relatedSignals={relatedSignals}
                    />
                  ) : (
                    <div data-testid="room-workbench-context-panel">{contextPanels}</div>
                  )}
                </div>
              )}
            </div>

            <aside className="hidden min-h-0 flex-col border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <p className="font-display text-[20px] font-bold leading-none">
                  {activeWorkbenchTab === "chat"
                    ? railMode === "thread"
                      ? "Thread Rail"
                      : "Context Rail"
                    : `${ROOM_WORKBENCH_TAB_LABEL[activeWorkbenchTab]} Rail`}
                </p>
                {activeWorkbenchTab === "chat" ? (
                  <div className="mt-3 flex flex-wrap gap-0 border-2 border-[var(--shock-ink)]">
                    {["Context", "Thread"].map((tab) => (
                      <button
                        type="button"
                        key={tab}
                        data-testid={`room-rail-mode-${tab.toLowerCase()}`}
                        onClick={() => setRailMode(tab === "Thread" ? "thread" : "context")}
                        className={cn(
                          "min-h-[44px] border-r-2 border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--shock-ink)] last:border-r-0",
                          (tab === "Thread" && railMode === "thread") || (tab === "Context" && railMode === "context")
                            ? "bg-[var(--shock-yellow)]"
                            : "bg-white"
                        )}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                    {room?.issueKey ?? roomId} / room workbench
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <DiscussionStateMessage title="等待房间上下文" message="右侧 rail 会在 live room / run / session 真值返回后展开。" />
                ) : error ? (
                  <DiscussionStateMessage title="上下文同步失败" message={error} />
                ) : !room || !run ? (
                  <DiscussionStateMessage title="缺少讨论间上下文" message={`当前找不到 \`${roomId}\` 对应的 live room / run 记录。`} />
                ) : activeWorkbenchTab === "chat" && railMode === "thread" ? (
                  <ThreadRail
                    scopeLabel={room.issueKey}
                    selectedMessage={selectedThreadMessage}
                    replies={selectedThreadReplies}
                    replyTarget={replyTarget}
                    onReply={() => {
                      if (selectedThreadMessage) {
                        setReplyTarget(buildReplyTarget(selectedThreadMessage));
                      }
                    }}
                    primaryAction={{
                      label: session?.followThread ?? run.followThread ? "Thread Locked" : "Lock Thread",
                      onClick: () =>
                        void handleRunControl(
                          "follow_thread",
                          selectedThreadMessage
                            ? `锁定 thread: ${selectedThreadMessage.speaker} / ${messageExcerpt(selectedThreadMessage.message, 48)}`
                            : "锁定当前线程"
                        ),
                      disabled: !selectedThreadMessage || !canControlRun,
                      tone: session?.followThread ?? run.followThread ? "ink" : "yellow",
                      testId: "room-thread-follow-current",
                    }}
                    emptyTitle="先选一条 room 消息"
                    emptyMessage="thread 只作为当前 room 的局部回复区，不会再生成新的一级页面。先在左侧消息流里点一条消息。"
                  />
                ) : (
                  <RoomWorkbenchRailSummary
                    room={room}
                    run={run}
                    pullRequest={pullRequest}
                    activeTab={activeWorkbenchTab}
                    activeAgentsCount={activeAgents.length}
                    relatedSignals={relatedSignals}
                  />
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
