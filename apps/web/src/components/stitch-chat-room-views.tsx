"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { DestructiveGuardCard } from "@/components/destructive-guard-views";
import type { SidebarProfileEntry } from "@/components/stitch-shell-primitives";
import { QuickSearchSurface, StitchSidebar, StitchTopBar, WorkspaceStatusStrip } from "@/components/stitch-shell-primitives";
import { buildRunHistoryEntries, rewriteCustomerFacingText } from "@/lib/phase-zero-helpers";
import { useQuickSearchController } from "@/lib/quick-search";
import { buildNamedProfileHref, buildProfileHref } from "@/lib/profile-surface";
import {
  type AgentHandoff,
  type ApprovalCenterItem,
  type DestructiveGuard,
  type Message,
  type PhaseZeroState,
  type PullRequest,
  type PullRequestConversationEntry,
  type Room,
  type Run,
  type Session,
} from "@/lib/phase-zero-types";
import { type RoomStreamEvent, usePhaseZeroState } from "@/lib/live-phase0";
import { buildPlanningMirrorHref } from "@/lib/planning-mirror";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import { runtimeProviderBlockingReason } from "@/lib/runtime-provider-health";
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
      return "智能体";
    default:
      return "系统";
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

function conversationKindLabel(kind: PullRequestConversationEntry["kind"]) {
  switch (kind) {
    case "review":
      return "评审";
    case "review_comment":
      return "评论";
    case "review_thread":
      return "线程";
    default:
      return "备注";
  }
}

function conversationBadgeTone(kind: PullRequestConversationEntry["kind"]) {
  switch (kind) {
    case "review":
      return "bg-[var(--shock-lime)]";
    case "review_thread":
      return "bg-[var(--shock-purple)] text-white";
    case "review_comment":
      return "bg-[var(--shock-yellow)]";
    default:
      return "bg-white";
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

function roomReplyStatusLabel(status: string) {
  switch (status) {
    case "syncing":
      return "同步中";
    case "sync_failed":
      return "读取失败";
    case "allowed":
      return "可发送";
    case "paused":
      return "已暂停";
    case "blocked":
      return "无权限";
    case "runtime_blocked":
      return "模型未就绪";
    case "signed_out":
      return "未登录";
    default:
      return status || "待同步";
  }
}

function roomPullRequestActionStatusLabel(status: string) {
  switch (status) {
    case "syncing":
      return "同步中";
    case "sync_failed":
      return "读取失败";
    case "allowed":
      return "可操作";
    case "review_only":
      return "仅可同步";
    case "blocked":
      return "无权限";
    case "signed_out":
      return "未登录";
    case "merged":
      return "已合并";
    default:
      return status || "待同步";
  }
}

function buildMachineProfileHref(state: PhaseZeroState, machineRef: string) {
  const machine = state.machines.find((item) => item.id === machineRef || item.name === machineRef);
  return buildProfileHref("machine", machine?.id ?? machineRef);
}

function machineStatusLabel(state: PhaseZeroState["machines"][number]["state"]) {
  switch (state) {
    case "busy":
      return "忙碌";
    case "online":
      return "在线";
    default:
      return "离线";
  }
}

function resolveRuntimeRecord(state: PhaseZeroState, runtimeName?: string) {
  const target = runtimeName?.trim();
  if (target) {
    const matched =
      state.runtimes.find((runtime) => runtime.id === target || runtime.machine === target) ?? null;
    if (matched) {
      return matched;
    }
  }

  const pairedRuntime = state.workspace.pairedRuntime?.trim();
  if (pairedRuntime) {
    const paired =
      state.runtimes.find((runtime) => runtime.id === pairedRuntime || runtime.machine === pairedRuntime) ?? null;
    if (paired) {
      return paired;
    }
  }

  return state.runtimes[0] ?? null;
}

function agentStatusLabel(state: PhaseZeroState["agents"][number]["state"]) {
  switch (state) {
    case "running":
      return "执行中";
    case "blocked":
      return "阻塞";
    default:
      return "待命";
  }
}

function humanStatusLabel(active: boolean, status: string) {
  if (active) {
    return "在线";
  }

  switch (status) {
    case "suspended":
      return "停用";
    case "invited":
      return "待加入";
    default:
      return "可协作";
  }
}

function workspaceRoleLabel(role: string | undefined) {
  switch (role) {
    case "owner":
      return "所有者";
    case "member":
      return "成员";
    case "viewer":
      return "访客";
    default:
      return role || "成员";
  }
}

function channelPresenceLabel(presence?: string) {
  switch (presence) {
    case "running":
      return "进行中";
    case "blocked":
      return "阻塞";
    default:
      return "待命";
  }
}

function buildShellProfileEntries(state: PhaseZeroState, disabled: boolean): SidebarProfileEntry[] {
  if (disabled) {
    return [];
  }

  const activeMemberId = state.auth.session.memberId;
  const activeMember = state.auth.members.find((member) => member.id === activeMemberId) ?? state.auth.members[0];
  const pairedMachine =
    state.machines.find(
      (machine) => machine.id === state.workspace.pairedRuntime || machine.name === state.workspace.pairedRuntime
    ) ??
    state.machines.find((machine) => machine.state === "busy") ??
    state.machines.find((machine) => machine.state === "online") ??
    state.machines[0];
  const preferredAgent =
    state.agents.find((agent) => agent.id === state.auth.session.preferences.preferredAgentId) ??
    state.agents.find((agent) => agent.state === "running") ??
    state.agents.find((agent) => agent.state === "blocked") ??
    state.agents[0];
  const entries: SidebarProfileEntry[] = [];

  if (activeMember) {
    const active = activeMember.id === activeMemberId && state.auth.session.status === "active";
    entries.push({
      id: "human",
      badge: "我",
      title: activeMember.name,
      meta: `${workspaceRoleLabel(activeMember.role)} · ${activeMember.email}`,
      href: buildProfileHref("human", activeMember.id),
      status: humanStatusLabel(active, activeMember.status),
      tone: active ? "lime" : activeMember.status === "suspended" ? "pink" : "white",
    });
  }

  if (pairedMachine) {
    entries.push({
      id: "machine",
      badge: "机",
      title: pairedMachine.name,
      meta: `${pairedMachine.cli} · ${pairedMachine.shell}`,
      href: buildProfileHref("machine", pairedMachine.id),
      status: machineStatusLabel(pairedMachine.state),
      tone: pairedMachine.state === "busy" ? "yellow" : pairedMachine.state === "online" ? "lime" : "white",
    });
  }

  if (preferredAgent) {
    entries.push({
      id: "agent",
      badge: "智",
      title: preferredAgent.name,
      meta: `${preferredAgent.role} · ${preferredAgent.lane}`,
      href: buildProfileHref("agent", preferredAgent.id),
      status: agentStatusLabel(preferredAgent.state),
      tone: preferredAgent.state === "running" ? "yellow" : preferredAgent.state === "blocked" ? "pink" : "white",
    });
  }

  return entries;
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
  return `${quota.messageHistoryDays} 天消息 / ${quota.runLogDays} 天运行记录 / ${quota.memoryDraftDays} 天草稿`;
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
  if (message.role === "agent") return "智";
  return "系";
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
  chat: "聊天",
  followed: "关注中",
  saved: "稍后看",
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

const ROOM_WORKBENCH_TAB_LABEL: Record<RoomWorkbenchTab, string> = {
  chat: "聊天",
  topic: "话题",
  run: "运行",
  pr: "PR",
  context: "上下文",
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
    summary: "以对话为主的界面、线程重开和消息工作流的快速对齐面。",
    purpose: "这条私聊用来快速对齐前台壳层和线程重开，不需要立刻升级成讨论间。",
    unread: 2,
    presence: "running",
    counterpart: "Codex Dockmaster",
  },
  {
    id: "dm-mina",
    name: "@Mina",
    summary: "文案、稍后查看队列和人类回访习惯的收口面。",
    purpose: "产品文案和稍后查看队列先在这条私聊里收紧，再决定是否升级为正式讨论间。",
    unread: 1,
    presence: "idle",
    counterpart: "Mina",
  },
].map(
  (item): SidebarDirectMessage => ({
    ...item,
    presence: item.presence as SidebarDirectMessage["presence"],
    name: rewriteCustomerFacingText(item.name),
    summary: rewriteCustomerFacingText(item.summary),
    purpose: rewriteCustomerFacingText(item.purpose),
    counterpart: rewriteCustomerFacingText(item.counterpart),
  })
);

const DIRECT_MESSAGE_MESSAGES: Record<string, Message[]> = {
  "dm-codex-dockmaster": [
    {
      id: "msg-dm-codex-1",
      speaker: "Codex Dockmaster",
      role: "agent",
      tone: "agent",
      message: "我先不把这条抬成讨论间。等线程关注和重新打开真的闭环了，再升级。",
      time: "11:12",
    },
    {
      id: "msg-dm-codex-2",
      speaker: "Larkspur",
      role: "human",
      tone: "human",
      message: "可以。私聊先承担快速澄清，真正需要执行、PR 或审批时再升讨论间。",
      time: "11:14",
    },
  ],
  "dm-mina": [
    {
      id: "msg-dm-mina-1",
      speaker: "Mina",
      role: "human",
      tone: "human",
      message: "稍后查看不应该像任务板，它更像“我晚点回来看这条线程”。",
      time: "11:22",
    },
    {
      id: "msg-dm-mina-2",
      speaker: "系统",
      role: "system",
      tone: "system",
      message: "已记录：稍后查看用于回访，不伪装成新一层待办。",
      time: "11:24",
    },
  ],
};

const SANITIZED_DIRECT_MESSAGE_MESSAGES: Record<string, Message[]> = Object.fromEntries(
  Object.entries(DIRECT_MESSAGE_MESSAGES).map(([channelId, messages]) => [
    channelId,
    messages.map((message) => ({
      ...message,
      speaker: rewriteCustomerFacingText(message.speaker),
      message: rewriteCustomerFacingText(message.message),
    })),
  ])
);

const DEFAULT_FOLLOWED_THREADS: MessageSurfaceEntry[] = [
  {
    id: "followed-all-runtime",
    channelId: "all",
    messageId: "msg-all-2",
    channelLabel: "#all",
    title: "Codex Dockmaster 运行同步线程",
    summary: "运行环境在线状态已经同步；下一步要把真实执行和审批链路带进前台。",
    note: "这条线程已被关注，用来反复回看频道里的关键协作线索。",
    updatedAt: "09:19",
    unread: 2,
  },
].map((item) => ({
  ...item,
  title: rewriteCustomerFacingText(item.title),
  summary: rewriteCustomerFacingText(item.summary),
  note: rewriteCustomerFacingText(item.note),
}));

const DEFAULT_SAVED_LATER_ITEMS: MessageSurfaceEntry[] = [
  {
    id: "saved-roadmap-chat-first",
    channelId: "roadmap",
    messageId: "msg-roadmap-1",
    channelLabel: "#roadmap",
    title: "Longwen 默认入口备注",
    summary: "默认入口必须聊天优先，任务板只能是辅助视图。",
    note: "稍后查看队列里保留的是“之后要重新打开的消息”，不是新的规划泳道。",
    updatedAt: "10:06",
    unread: 1,
  },
  {
    id: "saved-dm-mina-later",
    channelId: "dm-mina",
    messageId: "msg-dm-mina-1",
    channelLabel: "@Mina",
    title: "Mina 稍后查看准则",
    summary: "稍后查看更像“晚点回来看这条线程”，不是第二个看板。",
    note: "私聊里的轻量讨论也可以暂存，然后重新打开。",
    updatedAt: "11:24",
    unread: 0,
  },
].map((item) => ({
  ...item,
  title: rewriteCustomerFacingText(item.title),
  summary: rewriteCustomerFacingText(item.summary),
  note: rewriteCustomerFacingText(item.note),
}));

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
        message: "那就别把机器状态塞进设置页了，直接留在主壳和讨论间里常驻。",
        time: "09:18",
      },
      {
        id: "thread-all-2",
        speaker: "Codex Dockmaster",
        role: "agent",
        tone: "agent",
        message: "收到。我会把在线状态和讨论间上下文一起留在左栏和右侧摘要，不再只给后台页。",
        time: "09:19",
      },
    ],
  },
  roadmap: {
    "msg-roadmap-1": [
      {
        id: "thread-roadmap-1",
        speaker: "系统",
        role: "system",
        tone: "system",
        message: "已记录：看板仅保留为规划镜像，不再作为首页主心智。",
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
        message: "先把回访做顺，再谈是不是要升成新讨论间。",
        time: "11:15",
      },
    ],
  },
  "dm-mina": {
    "msg-dm-mina-1": [
      {
        id: "thread-dm-mina-1",
        speaker: "系统",
        role: "system",
        tone: "system",
        message: "稍后查看已记录为当前消息工作流的一等入口需求。",
        time: "11:25",
      },
    ],
  },
};

const SANITIZED_CHANNEL_THREAD_REPLIES: Record<string, ThreadMap> = Object.fromEntries(
  Object.entries(CHANNEL_THREAD_REPLIES).map(([channelId, threadMap]) => [
    channelId,
    Object.fromEntries(
      Object.entries(threadMap).map(([messageId, replies]) => [
        messageId,
        replies.map((reply) => ({
          ...reply,
          speaker: rewriteCustomerFacingText(reply.speaker),
          message: rewriteCustomerFacingText(reply.message),
        })),
      ])
    ),
  ])
);

const ROOM_THREAD_REPLIES: Record<string, ThreadMap> = {
  "room-runtime": {
    "msg-room-1": [
      {
        id: "thread-room-runtime-1",
        speaker: "Larkspur",
        role: "human",
        tone: "human",
        message: "房间里只保留当前讨论间的执行信息，不要再搞一个总览页。",
        time: "09:24",
      },
      {
        id: "thread-room-runtime-2",
        speaker: "Codex Dockmaster",
        role: "agent",
        tone: "agent",
        message: "明白。当前讨论间会只盯住分支、运行环境、PR 和当前话题，不再分散视线。",
        time: "09:25",
      },
    ],
    "msg-room-2": [
      {
        id: "thread-room-runtime-3",
        speaker: "系统",
        role: "system",
        tone: "system",
        message: "关注线程已经可以把后续恢复继续锁在同一条讨论上。",
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
        message: "收件箱入口放左下角是对的，但卡片正文还得更克制。",
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

const SANITIZED_ROOM_THREAD_REPLIES: Record<string, ThreadMap> = Object.fromEntries(
  Object.entries(ROOM_THREAD_REPLIES).map(([roomKey, threadMap]) => [
    roomKey,
    Object.fromEntries(
      Object.entries(threadMap).map(([messageId, replies]) => [
        messageId,
        replies.map((reply) => ({
          ...reply,
          speaker: rewriteCustomerFacingText(reply.speaker),
          message: rewriteCustomerFacingText(reply.message),
        })),
      ])
    ),
  ])
);

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

const MESSAGE_SENDING_PLACEHOLDER = "正在生成回复...";

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
      return "审批";
    case "blocked":
      return "阻塞";
    case "review":
      return "评审";
    default:
      return "状态";
  }
}

function handoffStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "已接收";
    case "blocked":
      return "阻塞";
    case "completed":
      return "完成";
    default:
      return "待接收";
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
            收件箱回链
          </p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">
            {relatedSignals.length} 条待处理 / {recentSignals.length} 条最近
          </p>
        </div>
        <Link
          href="/inbox"
          data-testid="room-workbench-open-inbox"
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
        >
          打开收件箱
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
                收件箱详情
              </Link>
              <Link
                href={buildRoomWorkbenchHref(roomId, item.kind === "review" ? "pr" : "context")}
                className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
              >
                回到讨论间
              </Link>
            </div>
          </div>
        ))}
        {relatedSignals.length === 0 && recentSignals.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            当前这条讨论间还没有挂住新的审批、阻塞或评审信号。
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
            交接回链
          </p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">{handoffs.length} 条在跟交接</p>
        </div>
        <Link
          href={`/mailbox?roomId=${roomId}`}
          data-testid="room-workbench-open-mailbox"
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
        >
          打开交接箱
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {handoffs.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            当前这条讨论间还没有正式交接；发起请求后，这里会直接显示请求、接收、阻塞和完成轨迹。
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
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">话题</p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">{room.topic.title}</p>
          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">{room.topic.summary}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">负责人</p>
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
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">事项</p>
              <p className="mt-2 text-sm font-semibold">{room.issueKey}</p>
            </div>
          </div>
          {issueTitle ? (
            <p className="mt-3 text-[12px] leading-5 text-[color:rgba(24,20,14,0.6)]">
              当前话题绑定的事项标题：{issueTitle}
            </p>
          ) : null}
        </Panel>

        <Panel tone="paper">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">上下文入口</p>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <Link
              href={`/issues/${room.issueKey}`}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              事项上下文
            </Link>
            <Link
              href={buildRoomWorkbenchHref(room.id, "run")}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              运行详情
            </Link>
            <Link
              href={buildRoomWorkbenchHref(room.id, "pr")}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              PR 面板
            </Link>
            <Link
              href="/board"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-3 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              看板镜像
            </Link>
          </div>
        </Panel>
      </div>

      <Panel tone="white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">执行</p>
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
          分支 {session?.branch ?? run.branch}
        </p>
        <p className="mt-1 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">
          工作区 {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {machineProfileHref ? (
            <Link
              href={machineProfileHref}
              data-testid="room-workbench-machine-profile"
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              机器档案
            </Link>
          ) : null}
          {runOwnerProfileHref ? (
            <Link
              href={runOwnerProfileHref}
              data-testid="room-workbench-run-owner-profile"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              负责人档案
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
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">风险守护</p>
              <p className="mt-2 font-display text-[20px] font-bold leading-6">高风险 / 密钥边界</p>
            </div>
            <span className="rounded-[4px] border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px]">
              {relatedGuards.length} 条生效中
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
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">PR</p>
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
              PR 详情
            </Link>
          ) : null}
          {pullRequest?.url ? (
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              打开远端 PR
            </Link>
          ) : null}
          <Link
            href="/inbox"
            data-testid="room-workbench-pr-inbox-link"
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
          >
            返回收件箱
          </Link>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel tone="ink">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">会话记忆</p>
          <div className="mt-3 space-y-2 font-mono text-[10px] leading-5 text-[#8bff9e]">
            {sessionMemoryPaths.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </Panel>
        <Panel tone="paper">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">当前在线</p>
          <p className="mt-2 font-display text-[20px] font-bold leading-6">{activeAgents.length} 个在线智能体</p>
          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
            最近执行线仍挂在这个讨论间上的智能体会在这里持续可见，不再只留在总览页角标里。
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
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">工具调用</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-none">{run.toolCalls.length}</p>
          <p className="mt-2 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.tool ?? "当前还没有工具调用"}</p>
          <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.summary ?? "等待下一条执行事件"}</p>
        </Panel>
        <Panel tone="white">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">时间线</p>
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
          {room.issueKey} / 话题
        </p>
        <h3 className="mt-2 font-display text-3xl font-bold">{room.topic.title}</h3>
        <p className="mt-4 text-base leading-7">{room.topic.summary}</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">负责人</p>
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
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">看板镜像</p>
            <p className="mt-2 font-display text-xl font-semibold">{room.boardCount} 张卡片</p>
          </div>
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">事项标题</p>
            <p className="mt-2 text-sm font-semibold leading-6">{issueTitle ?? "等待事项详情同步"}</p>
          </div>
        </div>
      </Panel>

      <Panel tone="white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">话题引导</p>
            <p className="mt-2 font-display text-[20px] font-bold leading-6">最近讨论语境</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/topics/${room.topic.id}`}
              data-testid="room-topic-open-route"
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              打开话题页
            </Link>
            <Link
              href={buildRoomWorkbenchHref(room.id, "chat")}
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
            >
              回到聊天
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
  const conversation = pullRequest?.conversation?.slice(0, 3) ?? [];

  return (
    <div data-testid="room-workbench-pr-panel" className="space-y-4">
      <Panel tone="white" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">PR</p>
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
          {roomPullRequestActionStatusLabel(actionStatus)}
        </p>
        {(actionStatus === "blocked" ||
          actionStatus === "signed_out" ||
          actionStatus === "review_only" ||
          actionStatus === "merged") ? (
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{actionBoundary}</p>
        ) : null}
        <p className="mt-4 text-sm leading-6">{pullRequest?.title ?? "当前讨论间还没有远端或本地 PR 对象。"}</p>
        <p data-testid="room-workbench-pr-review-summary" className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
          {pullRequest?.reviewSummary ?? "创建 PR 后，这里会直接展示评审和合并的当前状态。"}
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
              PR 详情
            </Link>
          ) : null}
          <Link
            href="/inbox"
            className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            收件箱评审
          </Link>
          {pullRequest?.url ? (
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              打开远端 PR
            </Link>
          ) : null}
          <Link
            href={buildRoomWorkbenchHref(roomId, "context")}
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            话题上下文
          </Link>
        </div>
      </Panel>

      <Panel tone="paper">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              最近评审会话
            </p>
            <p className="mt-2 font-display text-[22px] font-bold">把最新评论和线程直接带回讨论间</p>
          </div>
          <span
            data-testid="room-pr-conversation-count"
            className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
          >
            {conversation.length} 条记录
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {conversation.length === 0 ? (
            <p
              data-testid="room-pr-conversation-empty"
              className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]"
            >
              当前还没有 webhook 回流的评审会话；一旦评论或线程到达，这里会和 PR 详情共用同一份记录。
            </p>
          ) : (
            conversation.map((entry) => (
              <article
                key={entry.id}
                data-testid={`room-pr-conversation-entry-${entry.id}`}
                className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[var(--shock-shadow-sm)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]",
                      conversationBadgeTone(entry.kind)
                    )}
                  >
                    {conversationKindLabel(entry.kind)}
                  </span>
                  <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{entry.author}</span>
                  <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{entry.updatedAt || "刚刚"}</span>
                  {entry.threadStatus ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      {entry.threadStatus}
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm leading-6">{entry.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.path ? (
                    <span className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1 font-mono text-[10px]">
                      {entry.path}
                      {entry.line ? `:${entry.line}` : ""}
                    </span>
                  ) : null}
                  {entry.url ? (
                    <Link
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px]"
                    >
                      远端评论
                    </Link>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>

      <RoomRelatedSignalsPanel roomId={roomId} relatedSignals={relatedSignals} recentSignals={[]} />
    </div>
  );
}

function RoomWorkbenchRailSummary({
  room,
  run,
  session,
  pullRequest,
  issueTitle,
  activeTab,
  activeAgentsCount,
  relatedSignals,
  relatedHandoffs,
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
  activeTab: RoomWorkbenchTab;
  activeAgentsCount: number;
  relatedSignals: ApprovalCenterItem[];
  relatedHandoffs: AgentHandoff[];
  pullRequestActionLabel: string;
  pullRequestActionDisabled: boolean;
  onPullRequestAction: (() => Promise<void>) | null;
  pullRequestActionStatus: string;
  pullRequestBoundary: string;
  prError: string | null;
}) {
  const currentRunStatus = session?.status ?? run.status;
  const contextPanelTestId = activeTab === "context" ? "room-rail-context-panel" : "room-workbench-context-panel";
  const runPanelTestId = activeTab === "run" ? "room-rail-run-panel" : "room-workbench-run-panel";
  const prPanelTestId = activeTab === "pr" ? "room-rail-pr-panel" : "room-workbench-pr-panel";

  return (
    <div data-testid={contextPanelTestId} className="space-y-3">
      <Panel tone="paper">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">房间焦点</p>
        <p className="mt-2 font-display text-[22px] font-bold leading-6">{room.topic.title}</p>
        <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.7)]">{room.topic.summary}</p>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">事项</p>
            <p className="mt-1.5 text-sm font-semibold">{room.issueKey}</p>
            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{issueTitle ?? "等待事项详情同步"}</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">当前视图</p>
            <p className="mt-1.5 text-sm font-semibold">{ROOM_WORKBENCH_TAB_LABEL[activeTab]}</p>
            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">默认回到聊天主面，其他信息只作为次级进入面保留。</p>
          </div>
        </div>
      </Panel>

      <Panel tone="white">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">右栏摘要</p>
        <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.66)]">
          聊天保持主面，话题、运行、PR、上下文统一改走顶部标签，右侧只保留摘要，不再重复摆一套跳转入口。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {ROOM_WORKBENCH_TAB_LABEL[activeTab]}
          </span>
          <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {activeAgentsCount} 个在线智能体
          </span>
          <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {relatedSignals.length} 条信号
          </span>
          <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {relatedHandoffs.length} 条交接
          </span>
        </div>
      </Panel>

      <Panel tone="white">
        <div data-testid={runPanelTestId}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">执行</p>
              <p className="mt-2 font-display text-[18px] font-bold leading-5">{run.id}</p>
            </div>
            <span
              data-testid="room-workbench-run-status"
              className={cn(
                "rounded-[4px] border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
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
          <p className="mt-3 font-mono text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">
            {session?.branch ?? run.branch}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-[color:rgba(24,20,14,0.68)]">
            {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={buildRoomWorkbenchHref(room.id, "run")}
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              房间执行
            </Link>
            <Link
              href={`/runs/${run.id}`}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              执行详情
            </Link>
          </div>
        </div>
      </Panel>

      <Panel tone="white">
        <div data-testid={prPanelTestId}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">PR</p>
              <h3 data-testid="room-workbench-pr-label" className="mt-2 font-display text-[18px] font-bold leading-5">
                {pullRequest?.label ?? run.pullRequest ?? "未创建"}
              </h3>
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
            <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.68)]">{pullRequestBoundary}</p>
          ) : null}
          <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.68)]">
            {pullRequest?.reviewSummary ?? run.nextAction}
          </p>
          {prError ? (
            <p data-testid="room-workbench-pr-error" className="mt-2 font-mono text-[11px] text-[var(--shock-pink)]">
              {prError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={buildRoomWorkbenchHref(room.id, "pr")}
              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
            >
              房间 PR
            </Link>
            {pullRequest ? (
              <Link
                href={`/pull-requests/${pullRequest.id}`}
                data-testid="room-workbench-pr-detail-link"
                className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
              >
              PR 详情
              </Link>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel tone="paper">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">信号</p>
            <p className="mt-1.5 text-sm font-semibold">{relatedSignals.length} 条待处理</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">交接箱</p>
            <p className="mt-1.5 text-sm font-semibold">{relatedHandoffs.length} 条跟进中</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">智能体</p>
            <p className="mt-1.5 text-sm font-semibold">{activeAgentsCount} 在线</p>
          </div>
          <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">看板</p>
            <p className="mt-1.5 text-sm font-semibold">{room.boardCount} 张卡片</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/inbox"
            data-testid="room-workbench-open-inbox"
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
          >
            收件箱
          </Link>
          <Link
            href={`/mailbox?roomId=${room.id}`}
            data-testid="room-workbench-open-mailbox"
            className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
          >
            交接箱
          </Link>
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
          回复
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] text-[color:rgba(24,20,14,0.74)]">
          {replyTarget.speaker}: {replyTarget.excerpt}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="min-h-[32px] rounded-[10px] border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-yellow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--shock-paper)]"
        >
          清除
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
            <p className="font-display text-[20px] font-bold leading-none">线程</p>
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
                原始消息
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
                  回复
                </p>
              </div>
              {replies.length > 0 ? (
                replies.map((reply) => <ThreadReplyRow key={reply.id} message={reply} />)
              ) : (
                <div className="px-3 py-4 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                  当前还没有独立回复，下一条就从这里继续。
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
            ? "已在输入框锁定回复目标"
            : "在输入框回复"}
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
                重新打开线程
              </Link>
              <Link
                href={item.surfaceHref}
                className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
              >
                打开原视图
              </Link>
            </div>
          </section>
        ))
      ) : (
        <section className="border-2 border-dashed border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
          <p className="font-display text-[18px] font-bold">当前还没有条目</p>
          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
            先在聊天里打开一条线程，再选择关注或稍后查看。
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
                  ? `${replyCount} 条回复`
                  : "回复"}
              </button>
              {threadActive ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.5)]">
                  线程已展开
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
  humanSpeaker,
  agentSpeaker,
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
  humanSpeaker: string;
  agentSpeaker: string;
}) {
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("先给我一句结论：这个讨论间现在该先做哪一步？");
  const [loading, setLoading] = useState(false);
  const messages = useMemo(
    () => (pendingMessages.length > 0 ? [...initialMessages, ...pendingMessages] : initialMessages),
    [initialMessages, pendingMessages]
  );
  const latestMessage = messages[messages.length - 1];
  const scrollRef = useStickyMessageScroll(room.id, messages.length, latestMessage?.message.length ?? 0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPendingMessages([]);
  }, [room.id]);

  useEffect(() => {
    if (loading) {
      return;
    }
    const pendingPrompt = pendingMessages.find((item) => item.role === "human")?.message;
    if (!pendingPrompt) {
      return;
    }
    if (initialMessages.some((item) => item.role === "human" && item.message === pendingPrompt)) {
      setPendingMessages([]);
    }
  }, [initialMessages, loading, pendingMessages]);

  useEffect(() => {
    if (replyTarget) {
      inputRef.current?.focus();
    }
  }, [replyTarget]);

  function replacePlaceholderWithDelta(message: Message, delta: string, tone?: Message["tone"]) {
    const nextMessage =
      message.message === MESSAGE_SENDING_PLACEHOLDER || !message.message.trim()
        ? delta
        : `${message.message}${delta}`;
    return {
      ...message,
      tone: tone ?? message.tone,
      message: nextMessage,
    };
  }

  async function handleSend() {
    if (!draft.trim() || loading || !canSend) return;
    const prompt = draft.trim();
    const sendPrompt = replyTarget ? `回复 ${replyTarget.speaker}：${prompt}` : prompt;
    setLoading(true);
    const now = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const humanMessage: Message = {
      id: `local-human-${Date.now()}`,
      speaker: humanSpeaker,
      role: "human",
      tone: "human",
      message: sendPrompt,
      time: now,
    };
    const agentMessageId = `local-agent-${Date.now()}`;
    const agentMessage: Message = {
      id: agentMessageId,
      speaker: agentSpeaker,
      role: "agent",
      tone: "agent",
      message: MESSAGE_SENDING_PLACEHOLDER,
      time: now,
    };
    setPendingMessages([humanMessage, agentMessage]);

    try {
      const payload = await onSend(room.id, sendPrompt, undefined, (event) => {
        if (event.type === "stdout" && event.delta) {
          const delta = event.delta;
          setPendingMessages((current) =>
            current.map((item) => (item.id === agentMessageId ? replacePlaceholderWithDelta(item, delta) : item))
          );
        }
        if (event.type === "stderr" && event.delta) {
          const delta = event.delta;
          setPendingMessages((current) =>
            current.map((item) => (item.id === agentMessageId ? replacePlaceholderWithDelta(item, delta, "blocked") : item))
          );
        }
      });
      const nextMessages = payload?.state?.roomMessages?.[room.id];
      if (nextMessages) {
        setPendingMessages([]);
      } else {
        setPendingMessages((current) =>
          current.map((item) =>
            item.id === agentMessageId &&
            (item.message === MESSAGE_SENDING_PLACEHOLDER || item.message.trim() === "")
              ? {
                  ...item,
                  tone: payload?.error ? "blocked" : item.tone,
                  message: payload?.error || "这次没有拿到可展示的输出。",
                }
              : item
          )
        );
      }
      setDraft("");
      onClearReplyTarget?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      setPendingMessages((current) =>
        current.map((item) =>
          item.id === agentMessageId
            ? {
                id: `err-${Date.now()}`,
                speaker: "系统",
                role: "system",
                tone: "blocked",
                message: `消息发送失败：${message}`,
                time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()),
              }
            : item
        )
      );
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
            {loading ? "发送中" : "发送"}
          </button>
        </form>
        <p data-testid="room-reply-authz" className="mx-auto mt-2 max-w-[1040px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {roomReplyStatusLabel(sendStatus)}
        </p>
        {canSend && loading ? (
          <p className="mx-auto mt-2 max-w-[1040px] text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">{MESSAGE_SENDING_PLACEHOLDER}</p>
        ) : null}
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
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const activeMemberName =
    state.auth.members.find((member) => member.id === state.auth.session.memberId)?.name ||
    state.auth.session.name ||
    "我";
  const directMessageMessages = loading || error ? SANITIZED_DIRECT_MESSAGE_MESSAGES : state.directMessageMessages;
  const followedThreads = loading || error ? DEFAULT_FOLLOWED_THREADS : state.followedThreads;
  const savedLaterItems = loading || error ? DEFAULT_SAVED_LATER_ITEMS : state.savedLaterItems;
  const activeChannelId = channel?.id;
  const channelRuntimeRecord = useMemo(() => resolveRuntimeRecord(state), [state]);
  const channelSendBoundary = useMemo(
    () => (loading || error ? "" : runtimeProviderBlockingReason(channelRuntimeRecord?.providers ?? [])),
    [channelRuntimeRecord?.providers, error, loading]
  );
  const canChannelCompose = Boolean(channel) && !loading && !error && !channelSendBoundary;
  const persistedMessages = useMemo(
    () =>
      activeChannelId
        ? isDirectMessage
          ? directMessageMessages[activeChannelId] ?? []
          : state.channelMessages[activeChannelId] ?? []
        : [],
    [activeChannelId, directMessageMessages, isDirectMessage, state.channelMessages]
  );
  const messages = useMemo(
    () => (pendingMessages.length > 0 ? [...persistedMessages, ...pendingMessages] : persistedMessages),
    [pendingMessages, persistedMessages]
  );
  const channelThreadReplies = useMemo(
    () => (activeChannelId ? SANITIZED_CHANNEL_THREAD_REPLIES[activeChannelId] ?? {} : {}),
    [activeChannelId]
  );
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
    queueLabel: "关注中",
    surfaceHref: buildChannelWorkbenchHref(item.channelId, "followed", item.messageId),
    reopenHref: buildThreadReopenHref(item.channelId, item.messageId),
    reopenTestId: `followed-thread-reopen-${item.id}`,
  }));
  const savedItemsForSurface = savedLaterItems.map((item) => ({
    ...item,
    queueLabel: "稍后看",
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
  const shellProfileEntries = buildShellProfileEntries(state, loading || Boolean(error));
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
    setPendingMessages([]);
  }, [channelId]);

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
      setSendError(collectionError instanceof Error ? collectionError.message : "关注线程写回失败");
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
      setSendError(collectionError instanceof Error ? collectionError.message : "稍后查看写回失败");
    }
  }

  async function handleChannelSend() {
    if (!channel || !draft.trim() || sending || loading || Boolean(error) || Boolean(channelSendBoundary)) {
      return;
    }
    const submittedDraft = draft.trim();
    const sendPrompt = replyTarget ? `回复 ${replyTarget.speaker}：${submittedDraft}` : submittedDraft;
    const sentAt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    setPendingMessages([
      {
        id: `pending-human-${Date.now()}`,
        speaker: activeMemberName,
        role: "human",
        tone: "human",
        message: sendPrompt,
        time: sentAt,
      },
      {
        id: `pending-agent-${Date.now()}`,
        speaker: isDirectMessage ? channel.name : "智能体",
        role: "agent",
        tone: "agent",
        message: MESSAGE_SENDING_PLACEHOLDER,
        time: sentAt,
      },
    ]);
    setDraft("");
    setSending(true);
    setSendError(null);
    try {
      if (isDirectMessage) {
        await postDirectMessage(channel.id, sendPrompt);
      } else {
        await postChannelMessage(channel.id, sendPrompt);
      }
      setPendingMessages([]);
      setReplyTarget(null);
    } catch (channelError) {
      setPendingMessages([]);
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
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] md:grid-cols-[258px_minmax(0,1fr)]">
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
          profileEntries={shellProfileEntries}
          selectedChannelId={selectedChannelLinkId}
          selectedDirectMessageId={selectedDirectMessageId}
          selectedFollowedThreadId={selectedFollowedThreadId}
          selectedSavedLaterId={selectedSavedLaterId}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col bg-[var(--shock-paper)]">
          <WorkspaceStatusStrip
            workspaceName={workspaceName}
            disconnected={loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline")}
          />
          <StitchTopBar
            eyebrow={isDirectMessage ? "私聊" : "工作区频道"}
            title={loading ? "消息面同步中" : error ? "消息面同步失败" : channel?.name ?? channelId}
            description={
              loading
                ? "等待消息面真实状态返回。"
                : error
                  ? error
                  : channel?.purpose ?? "当前还没有拿到这条消息面的用途说明。"
            }
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
            searchPlaceholder={isDirectMessage ? "搜索私聊 / 线程 / 稍后查看" : "搜索频道 / 线程 / 稍后查看"}
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
                    私聊 1:1
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
                    {channelPresenceLabel(channel?.presence)}
                  </span>
                  <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {channel?.unread ?? 0} 未读
                  </span>
                </>
              ) : (
                <>
                  <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {sidebarMachines.length} 台机器
                  </span>
                  <span className="border border-[var(--shock-ink)] bg-[var(--shock-lime)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {runningAgents} 个在线智能体
                  </span>
                  <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {blockedAgents} 个阻塞
                  </span>
                </>
              )}
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {inboxCount} 条收件箱
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
                        <p className="font-display text-[18px] font-bold">{channel?.name ?? "正在载入"}</p>
                        <p className="mt-1 text-[12px] leading-5 text-[color:rgba(24,20,14,0.64)]">
                          {channel?.summary ?? channel?.purpose ?? "这里会显示当前频道或私聊的说明。"}
                        </p>
                      </div>
                      {loading ? (
                        <DiscussionStateMessage
                          title="正在载入消息"
                          message="正在获取当前频道或私聊内容。"
                        />
                      ) : error ? (
                        <DiscussionStateMessage title="消息面同步失败" message={error} />
                      ) : !channel ? (
                        <DiscussionStateMessage
                          title="未找到消息面"
                          message={`当前找不到 \`${channelId}\` 对应的频道或私聊记录。`}
                        />
                      ) : messages.length === 0 ? (
                        <DiscussionStateMessage
                          title="这个消息面当前还没有内容"
                          message="发送第一条消息后，这里会显示对应内容。"
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
                        disabled={!canChannelCompose}
                        className="h-11 flex-1 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[13px] outline-none transition-colors duration-150 focus:bg-white focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                        placeholder={
                          replyTarget
                            ? `继续回复 ${replyTarget.speaker}...`
                              : canChannelCompose && channel
                                ? `发送消息到 ${channel.name}...`
                              : channelSendBoundary || "正在载入消息..."
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
                        disabled={!canChannelCompose || sending || !draft.trim()}
                        className="min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
                      >
                        {sending ? "发送中" : "发送"}
                      </button>
                    </form>
                    {sendError ? (
                      <p data-testid="channel-send-error" className="mx-auto mt-3 max-w-[1040px] text-sm leading-6 text-[var(--shock-pink)]">
                        {sendError}
                      </p>
                    ) : channelSendBoundary ? (
                      <p data-testid="channel-send-boundary" className="mx-auto mt-3 max-w-[1040px] text-sm leading-6 text-[var(--shock-pink)]">
                        {channelSendBoundary}
                      </p>
                    ) : sending ? (
                      <p className="mx-auto mt-3 max-w-[1040px] text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
                        {MESSAGE_SENDING_PLACEHOLDER}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : activeWorkbenchTab === "followed" ? (
                <div className="min-h-0 overflow-y-auto bg-[var(--shock-paper)] p-4">
                  <MessageWorkbenchCollectionPanel
                    title="关注中的线程"
                    description="从这里重新打开你决定持续跟踪的线程，不必再从消息流里重新翻。"
                    items={followedItemsForSurface}
                    activeItemId={selectedFollowedEntry?.id}
                    testId="followed-thread-panel"
                  />
                </div>
              ) : (
                <div className="min-h-0 overflow-y-auto bg-[var(--shock-paper)] p-4">
                  <MessageWorkbenchCollectionPanel
                    title="稍后查看"
                    description="这里只收“晚点再回看”的消息，不复制出第二个任务板。"
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
                  scopeLabel={channel?.name ?? "频道"}
                  selectedMessage={selectedThreadMessage}
                  replies={selectedThreadReplies}
                  replyTarget={replyTarget}
                  onReply={() => {
                    if (selectedThreadMessage) {
                      setReplyTarget(buildReplyTarget(selectedThreadMessage));
                    }
                  }}
                  primaryAction={{
                    label: isSelectedThreadFollowed ? "已关注" : "关注线程",
                    onClick: handleToggleFollowThread,
                    disabled: !selectedThreadMessage,
                    tone: isSelectedThreadFollowed ? "ink" : "yellow",
                    testId: "channel-thread-follow",
                  }}
                  secondaryAction={{
                    label: isSelectedThreadSaved ? "已暂存" : "稍后查看",
                    onClick: handleToggleSaveLater,
                    disabled: !selectedThreadMessage,
                    tone: "white",
                    testId: "channel-thread-save-later",
                  }}
                  emptyTitle="先选一条消息"
                  emptyMessage="线程是频道消息的局部回复区。先在左侧消息流里点一条消息，再决定要不要关注或稍后回看。"
                />
              ) : (
                <>
                  <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                    <p className="font-display text-[20px] font-bold leading-none">
                      {activeWorkbenchTab === "followed" ? "关注回访区" : "暂存回访区"}
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
                              {activeWorkbenchTab === "followed" ? "关注中" : "稍后看"}
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
                              重新打开线程
                            </Link>
                            <Link
                              href={selectedCollectionEntry.surfaceHref}
                              className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
                            >
                              打开列表
                            </Link>
                          </div>
                        </section>

                        <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                            原始消息
                          </p>
                          <p className="mt-3 font-display text-[15px] font-bold">{selectedCollectionMessage.speaker}</p>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.84)]">{selectedCollectionMessage.message}</p>
                        </section>

                        <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                            回复数
                          </p>
                          <p className="mt-2 font-display text-[18px] font-bold leading-none">{selectedCollectionReplies.length}</p>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                            这条消息当前有 {selectedCollectionReplies.length} 条回复，重新打开后可以继续在线程层级回访。
                          </p>
                        </section>
                      </div>
                    ) : (
                      <DiscussionStateMessage
                        title="暂无内容"
                        message="先在聊天里选一条消息并关注或暂存，它就会进入这个回访队列。"
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
  const roomRuntimeRecord = useMemo(() => resolveRuntimeRecord(state, run?.runtime), [run?.runtime, state]);
  const roomRuntimeBoundary = useMemo(
    () => (loading || error ? "" : runtimeProviderBlockingReason(roomRuntimeRecord?.providers ?? [])),
    [error, loading, roomRuntimeRecord?.providers]
  );
  const messages = useMemo(() => (room ? state.roomMessages[room.id] ?? [] : []), [room, state.roomMessages]);
  const roomThreadReplies = useMemo(() => (room ? SANITIZED_ROOM_THREAD_REPLIES[room.id] ?? {} : {}), [room]);
  const pullRequest = room ? state.pullRequests.find((item) => item.roomId === room.id) : undefined;
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [railMode, setRailMode] = useState<"context" | "thread">("context");
  const canMerge = pullRequest && pullRequest.status !== "merged";
  const permissionReplyStatus = permissionStatus(authSession, "room.reply");
  const permissionReplyBoundary = permissionBoundaryCopy(authSession, "room.reply");
  const canReply =
    !loading &&
    !error &&
    !runPaused &&
    permissionReplyStatus === "allowed" &&
    roomRuntimeBoundary === "";
  const roomReplyStatus = loading
    ? "syncing"
    : error
      ? "sync_failed"
      : runPaused
        ? "paused"
        : permissionReplyStatus !== "allowed"
          ? permissionReplyStatus
          : roomRuntimeBoundary
            ? "runtime_blocked"
            : "allowed";
  const roomReplyBoundary = runPaused
    ? "当前执行已暂停。先在右侧控制面板里恢复，或先锁定当前线程再继续执行。"
    : permissionReplyStatus !== "allowed"
      ? permissionReplyBoundary
      : roomRuntimeBoundary;
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
  const roomWorkbenchTabs = (["chat", "topic", "run", "pr", "context"] as RoomWorkbenchTab[]).map((tab) => ({
    label: ROOM_WORKBENCH_TAB_LABEL[tab],
    href: buildRoomWorkbenchHref(roomId, tab),
    testId: `room-workbench-tab-${tab}`,
  }));
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
  const shellProfileEntries = buildShellProfileEntries(state, loading || Boolean(error));

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
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "创建 PR 失败");
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
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "合并 PR 失败");
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
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "同步 PR 状态失败");
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
    pullRequestBoundary = "当前 PR 已合并，不再提供新的评审或合并动作。";
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
        ? "当前会话只有评审权限，可以同步 PR 状态，但不能直接合并。"
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
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] md:grid-cols-[258px_minmax(0,1fr)]">
        <StitchSidebar
          active="rooms"
          channels={sidebarChannels}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          profileEntries={shellProfileEntries}
          selectedRoomId={roomId}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col bg-[var(--shock-paper)]">
          <WorkspaceStatusStrip
            workspaceName={workspaceName}
            disconnected={loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline")}
          />
          <StitchTopBar
            eyebrow="讨论间"
            title={loading ? "讨论间同步中" : error ? "讨论间同步失败" : room?.title ?? roomId}
            description={
              loading
                ? "正在获取讨论间和执行状态。"
                : error
                  ? error
                  : room?.summary ?? "这里会显示当前讨论间的摘要。"
            }
            searchPlaceholder="搜索讨论间 / 事项 / 执行"
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
            tabs={roomWorkbenchTabs}
            activeTab={ROOM_WORKBENCH_TAB_LABEL[activeWorkbenchTab]}
          />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {room?.issueKey ?? "事项"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                执行 {currentRunStatus ? runStatusLabel(currentRunStatus) : "待同步"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                PR {pullRequestStatusLabel(pullRequest?.status)}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {relatedSignals.length} 条信号
              </span>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-h-0 flex-col bg-[var(--shock-paper)]">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-[18px] font-bold">
                      {room?.topic.title ?? "等待讨论间同步"}
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-[color:rgba(24,20,14,0.66)]">
                      {room?.topic.summary ?? "这里显示当前讨论主题的简要说明。"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={room ? `/issues/${room.issueKey}` : "/issues"}
                      className="flex min-h-[44px] items-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      事项
                    </Link>
                    <Link
                      href={planningMirrorHref}
                      data-testid="room-open-planning-mirror"
                      className="flex min-h-[44px] items-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      看板
                    </Link>
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="p-4">
                  <DiscussionStateMessage title="正在载入讨论间" message="正在获取当前讨论间、执行和消息内容。" />
                </div>
              ) : error ? (
                <div className="p-4">
                  <DiscussionStateMessage title="讨论间同步失败" message={error} />
                </div>
              ) : !room || !run ? (
                <div className="p-4">
                  <DiscussionStateMessage title="未找到讨论间" message={`当前找不到 \`${roomId}\` 对应的讨论间或执行记录。`} />
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
                      humanSpeaker={
                        state.auth.members.find((member) => member.id === state.auth.session.memberId)?.name ||
                        state.auth.session.name ||
                        "我"
                      }
                      agentSpeaker={run.owner || room.topic.owner || "当前智能体"}
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
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">执行用量</p>
                        <div className="mt-3 border-2 border-[var(--shock-ink)] bg-[#f7f7f7] px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">当前分支</p>
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
                            工作区 {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">
                            最近同步 {session?.updatedAt || run.startedAt}
                          </p>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="border-2 border-[var(--shock-ink)] bg-white px-2.5 py-2">
                              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">输入令牌</p>
                              <p className="mt-1 text-sm font-semibold">{formatCount(run.usage?.promptTokens)}</p>
                            </div>
                            <div className="border-2 border-[var(--shock-ink)] bg-white px-2.5 py-2">
                              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">输出令牌</p>
                              <p className="mt-1 text-sm font-semibold">{formatCount(run.usage?.completionTokens)}</p>
                            </div>
                            <div className="border-2 border-[var(--shock-ink)] bg-white px-2.5 py-2">
                              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">预算</p>
                              <p className="mt-1 text-sm font-semibold">{runBudgetStatusLabel(run.usage?.budgetStatus)}</p>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section data-testid="room-workbench-usage-panel" className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">用量 / 配额</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div data-testid="room-workbench-room-usage-summary" className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">讨论间</p>
                            <p className="mt-2 text-sm font-semibold">
                              {formatCount(room.usage?.messageCount)} 条消息 / {formatCount(room.usage?.totalTokens)} 令牌
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">
                              {formatCount(room.usage?.humanTurns)} 人类 / {formatCount(room.usage?.agentTurns)} 智能体 · {room.usage?.windowLabel ?? "时间范围未返回"}
                            </p>
                          </div>
                          <div data-testid="room-workbench-workspace-usage-summary" className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">工作区</p>
                            <p className="mt-2 text-sm font-semibold">{state.workspace.plan || "未命名计划"}</p>
                            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">
                              {formatQuotaCounter(state.workspace.quota?.usedAgents, state.workspace.quota?.maxAgents, "个智能体")} ·{" "}
                              {formatQuotaCounter(state.workspace.quota?.usedRooms, state.workspace.quota?.maxRooms, "个讨论间")}
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{formatRetentionSummary(state.workspace)}</p>
                          </div>
                        </div>
                        <p data-testid="room-workbench-usage-warning" className="mt-3 text-[12px] leading-6 text-[color:rgba(24,20,14,0.7)]">
                          {run.usage?.warning ?? room.usage?.warning ?? state.workspace.usage?.warning ?? state.workspace.quota?.warning ?? "当前没有用量或配额提醒。"}
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
                      ? "线程侧栏"
                      : "房间信息"
                    : "房间信息"}
                </p>
                {activeWorkbenchTab === "chat" ? (
                  <div className="mt-3 flex flex-wrap gap-0 border-2 border-[var(--shock-ink)]">
                    {[
                      { id: "context", label: "上下文" },
                      { id: "thread", label: "线程" },
                    ].map((tab) => (
                      <button
                        type="button"
                        key={tab.id}
                        data-testid={`room-rail-mode-${tab.id}`}
                        onClick={() => setRailMode(tab.id === "thread" ? "thread" : "context")}
                        className={cn(
                          "min-h-[44px] border-r-2 border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--shock-ink)] last:border-r-0",
                          (tab.id === "thread" && railMode === "thread") || (tab.id === "context" && railMode === "context")
                            ? "bg-[var(--shock-yellow)]"
                            : "bg-white"
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                    {room?.issueKey ?? roomId} / 详情
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <DiscussionStateMessage title="正在载入房间信息" message="右侧会显示当前讨论间、执行和会话信息。" />
                ) : error ? (
                  <DiscussionStateMessage title="上下文同步失败" message={error} />
                ) : !room || !run ? (
                  <DiscussionStateMessage title="缺少讨论间信息" message={`当前找不到 \`${roomId}\` 对应的讨论间或执行记录。`} />
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
                      label: session?.followThread ?? run.followThread ? "已锁定线程" : "锁定线程",
                      onClick: () =>
                        void handleRunControl(
                          "follow_thread",
                          selectedThreadMessage
                            ? `锁定线程: ${selectedThreadMessage.speaker} / ${messageExcerpt(selectedThreadMessage.message, 48)}`
                            : "锁定当前线程"
                        ),
                      disabled: !selectedThreadMessage || !canControlRun,
                      tone: session?.followThread ?? run.followThread ? "ink" : "yellow",
                      testId: "room-thread-follow-current",
                    }}
                    emptyTitle="先选一条讨论消息"
                    emptyMessage="线程只作为当前讨论间的局部回复区，不会再生成新的一级页面。先在左侧消息流里点一条消息。"
                  />
                ) : (
                  <RoomWorkbenchRailSummary
                    room={room}
                    run={run}
                    session={session}
                    pullRequest={pullRequest}
                    issueTitle={issue?.title}
                    activeTab={activeWorkbenchTab}
                    activeAgentsCount={activeAgents.length}
                    relatedSignals={relatedSignals}
                    relatedHandoffs={relatedHandoffs}
                    pullRequestActionLabel={pullRequestActionLabel}
                    pullRequestActionDisabled={pullRequestActionDisabled}
                    onPullRequestAction={pullRequestActionHandler}
                    pullRequestActionStatus={pullRequestActionStatus}
                    pullRequestBoundary={pullRequestBoundary}
                    prError={prError}
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
