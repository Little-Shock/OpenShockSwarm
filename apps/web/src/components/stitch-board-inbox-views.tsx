"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { DestructiveGuardCard } from "@/components/destructive-guard-views";
import { QuickSearchSurface, StitchSidebar, StitchTopBar, WorkspaceStatusStrip } from "@/components/stitch-shell-primitives";
import { buildBoardColumns } from "@/lib/phase-zero-helpers";
import {
  type AgentHandoff,
  type ApprovalCenterItem,
  type Issue,
  type InboxDecision,
  type InboxItem,
} from "@/lib/phase-zero-types";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useQuickSearchController } from "@/lib/quick-search";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function inboxKindLabel(kind: InboxItem["kind"]) {
  switch (kind) {
    case "approval":
      return "需要批准";
    case "blocked":
      return "冲突";
    case "review":
      return "评审";
    default:
      return "状态";
  }
}

function mailboxKindLabel(kind?: AgentHandoff["kind"]) {
  switch (kind) {
    case "governed":
      return "governed";
    case "delivery-closeout":
      return "delivery closeout";
    case "delivery-reply":
      return "delivery reply";
    default:
      return "manual";
  }
}

function mailboxReplyStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "reply active";
    case "blocked":
      return "reply blocked";
    case "completed":
      return "reply completed";
    default:
      return "reply requested";
  }
}

function mailboxReplyStatusTone(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "bg-[var(--shock-lime)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "completed":
      return "bg-[var(--shock-yellow)]";
    default:
      return "bg-white";
  }
}

function mailboxParentStatusLabel(status: AgentHandoff["status"]) {
  return `parent ${handoffStatusLabel(status)}`;
}

function findMailboxParent(mailbox: AgentHandoff[], handoff: AgentHandoff) {
  if (!handoff.parentHandoffId) {
    return null;
  }
  return mailbox.find((item) => item.id === handoff.parentHandoffId) ?? null;
}

function findLatestMailboxReply(mailbox: AgentHandoff[], parentHandoffId: string) {
  return (
    mailbox.find((item) => item.kind === "delivery-reply" && item.parentHandoffId === parentHandoffId) ?? null
  );
}

function countMailboxReplies(mailbox: AgentHandoff[], parentHandoffId: string) {
  return mailbox.filter((item) => item.kind === "delivery-reply" && item.parentHandoffId === parentHandoffId).length;
}

function boardStateLabel(state: Issue["state"]) {
  switch (state) {
    case "blocked":
      return "blocked";
    case "queued":
      return "todo";
    case "running":
      return "in progress";
    case "paused":
      return "paused";
    case "review":
      return "in review";
    case "done":
      return "done";
    default:
      return "status";
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
      return "";
  }
}

function deliveryStatusLabel(status: ApprovalCenterItem["deliveryStatus"]) {
  switch (status) {
    case "ready":
      return "delivery ready";
    case "blocked":
      return "delivery blocked";
    case "suppressed":
      return "delivery suppressed";
    default:
      return "delivery unrouted";
  }
}

function deliveryStatusTone(status: ApprovalCenterItem["deliveryStatus"]) {
  switch (status) {
    case "ready":
      return "bg-[var(--shock-lime)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "suppressed":
      return "bg-[#f3e5b8]";
    default:
      return "bg-white";
  }
}

function governanceStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "active";
    case "ready":
      return "ready";
    case "required":
      return "required";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "draft":
      return "draft";
    case "watch":
      return "watch";
    default:
      return "pending";
  }
}

function decisionLabel(decision: InboxDecision) {
  switch (decision) {
    case "approved":
      return "Approve";
    case "deferred":
      return "Defer";
    case "resolved":
      return "Resolve";
    case "merged":
      return "Merge";
    default:
      return "Request Changes";
  }
}

function decisionTone(decision: InboxDecision) {
  switch (decision) {
    case "approved":
    case "merged":
      return "bg-[var(--shock-yellow)]";
    case "resolved":
      return "bg-[var(--shock-purple)] text-white";
    default:
      return "bg-white";
  }
}

function governedCloseoutLabel(href: string) {
  return href.startsWith("/pull-requests/") ? "Open Delivery Entry" : "Review Closeout";
}

function signalIcon(kind: InboxItem["kind"]) {
  switch (kind) {
    case "approval":
      return "⌘";
    case "blocked":
      return "⇡";
    case "review":
      return "🖼";
    default:
      return "●";
  }
}

function handoffStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "requested":
      return "requested";
    case "acknowledged":
      return "acknowledged";
    case "blocked":
      return "blocked";
    default:
      return "completed";
  }
}

function handoffStatusTone(status: AgentHandoff["status"]) {
  switch (status) {
    case "requested":
      return "bg-white";
    case "acknowledged":
      return "bg-[var(--shock-lime)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    default:
      return "bg-[var(--shock-yellow)]";
  }
}

function handoffActionLabel(action: "acknowledged" | "blocked" | "comment" | "completed") {
  switch (action) {
    case "acknowledged":
      return "Acknowledge";
    case "blocked":
      return "Mark Blocked";
    case "comment":
      return "Formal Comment";
    default:
      return "Mark Complete";
  }
}

function mailboxMessageKindLabel(kind: AgentHandoff["messages"][number]["kind"]) {
  switch (kind) {
    case "request":
      return "request";
    case "ack":
      return "ack";
    case "blocked":
      return "blocked";
    case "comment":
      return "comment";
    default:
      return "complete";
  }
}

function permissionForInboxAction(
  item: Pick<InboxItem, "kind">,
  decision: InboxDecision
) {
  if (item.kind === "review" && decision === "changes_requested") {
    return "inbox.review";
  }
  return "inbox.decide";
}

type ApprovalCenterFilter = "all" | "approval" | "blocked" | "review" | "unread";

function SurfaceStateMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white px-5 py-5 shadow-[3px_3px_0_0_var(--shock-ink)]">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">{message}</p>
    </div>
  );
}

function TriageFactTile({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 shadow-[var(--shock-shadow-sm)]"
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">{label}</p>
      <p className="mt-1 font-display text-[18px] font-bold leading-none">{value}</p>
    </div>
  );
}

export function StitchBoardView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, approvalCenter, loading, error, createIssue } = usePhaseZeroState();
  const quickSearch = useQuickSearchController(loading || error ? { ...state, channels: [], rooms: [], issues: [], runs: [], agents: [] } : state);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("把真实 PR 写回接进讨论间");
  const [summary, setSummary] = useState("从房间直接创建 PR，并把 review / merge 状态回写到 Room 和 Inbox。");
  const session = state.auth.session;
  const canCreateIssue = hasSessionPermission(session, "issue.create");
  const createIssueStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(session, "issue.create");
  const liveIssues = loading || error ? [] : state.issues;
  const liveMachines = loading || error ? [] : state.machines;
  const liveAgents = loading || error ? [] : state.agents;
  const livePullRequests = loading || error ? [] : state.pullRequests;
  const columns = buildBoardColumns(liveIssues);
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = liveMachines;
  const sidebarAgents = liveAgents;
  const activeAgents = liveAgents.filter((agent) => agent.state === "running").length;
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;
  const disconnected = loading || Boolean(error) || liveMachines.every((machine) => machine.state === "offline");
  const roomMap = new Map((loading || error ? [] : state.rooms).map((room) => [room.id, room]));
  const issueMap = new Map((loading || error ? [] : state.issues).map((issue) => [issue.key, issue]));
  const sourceRoomId = searchParams.get("roomId");
  const sourceIssueKey = searchParams.get("issueKey");
  const sourceRoom = sourceRoomId ? roomMap.get(sourceRoomId) : undefined;
  const sourceIssue = sourceIssueKey ? issueMap.get(sourceIssueKey) : undefined;
  const returnTo = searchParams.get("returnTo");
  const returnLabel = searchParams.get("returnLabel");
  const safeReturnTo = returnTo?.startsWith("/") ? returnTo : null;
  const planningContextVisible = Boolean(sourceRoom || sourceIssue || safeReturnTo);

  const contextActions = [
    sourceRoom
      ? {
          label: "回讨论间",
          href: safeReturnTo && safeReturnTo.startsWith(`/rooms/${sourceRoom.id}`) ? safeReturnTo : `/rooms/${sourceRoom.id}?tab=context`,
          testID: "board-context-room-link",
          tone: "bg-[var(--shock-yellow)]",
        }
      : null,
    sourceIssue
      ? {
          label: "看 Issue",
          href: `/issues/${sourceIssue.key}`,
          testID: "board-context-issue-link",
          tone: "bg-white",
        }
      : null,
    safeReturnTo && !sourceRoom
      ? {
          label: returnLabel ? `回 ${returnLabel}` : "回来源",
          href: safeReturnTo,
          testID: "board-context-return-link",
          tone: "bg-white",
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; href: string; testID: string; tone: string }>;

  async function handleCreateIssue() {
    if (!title.trim() || creating || !canCreateIssue) return;
    setCreating(true);
    try {
      const payload = await createIssue({
        title: title.trim(),
        summary: summary.trim(),
        owner: "Claude Review Runner",
        priority: "high",
      });
      if (payload.roomId) router.push(`/rooms/${payload.roomId}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <StitchSidebar
          active="board"
          channels={sidebarChannels}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col">
          <WorkspaceStatusStrip workspaceName={workspaceName} disconnected={disconnected} />
          <StitchTopBar
            eyebrow="Secondary Planning"
            title="Planning Mirror"
            description="这里保留 lane 排序和轻量计划，但真正的 owner、run、PR 与 blocker 仍然以 room / inbox 为主。"
            tabs={["Rooms First", "Planning Mirror", "Machines"]}
            activeTab="Planning Mirror"
            searchPlaceholder="Search issue / room / run"
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          {planningContextVisible ? (
            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                    planning mirror context
                  </p>
                  <p className="mt-1 text-sm leading-6">
                    {sourceRoom
                      ? `当前从讨论间 ${sourceRoom.title} 打开规划面，先在这里整理 lane，再回 room 收口执行。`
                      : sourceIssue
                        ? `当前从 ${sourceIssue.key} 打开规划面。Issue 仍是耐久对象，但协作上下文优先留在 room。`
                        : "当前规划面带着来源上下文打开，处理完请直接回原工作面。 "}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {contextActions.map((action) => (
                    <Link
                      key={action.testID}
                      href={action.href}
                      data-testid={action.testID}
                      className={cn(
                        "rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                        action.tone
                      )}
                    >
                      {action.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-2">
            <div className="grid items-center gap-3 xl:grid-cols-[220px_160px_1fr_auto_auto]">
              <p className="font-mono text-[10px] tracking-[0.16em]">{liveMachines.length} machines visible</p>
              <p className="font-mono text-[10px] tracking-[0.16em]">{activeAgents} agents running</p>
              <div className="flex gap-1">
                <span className="h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-[var(--shock-purple)]" />
                <span className="h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-[var(--shock-lime)]" />
                <span className="h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-black" />
              </div>
              <span className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px]">{livePullRequests.length} PR links</span>
              <span className="font-mono text-[10px]">paired_at: {loading || error ? "同步中" : state.workspace.lastPairedAt || "未配对"}</span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-0 overflow-auto bg-[var(--shock-paper)] px-4 py-4">
              {loading ? (
                <SurfaceStateMessage
                  title="正在同步任务板"
                  message="等待 server 返回当前 issue / room / run 真值，任务板不再先渲染本地 seed 卡片。"
                />
              ) : error ? (
                <SurfaceStateMessage title="任务板同步失败" message={error} />
              ) : liveIssues.length === 0 ? (
                <SurfaceStateMessage title="当前还没有任务卡" message="等第一条 Issue 创建后，Board 会直接显示 live lane truth。" />
              ) : (
                <div className="grid min-w-[1500px] gap-4 xl:grid-cols-6">
                  {columns.map((column) => (
                    <section key={column.title}>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="font-display text-lg font-bold uppercase italic">{column.title}</h3>
                        <span className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px]">
                          {String(column.cards.length).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {column.cards.map((card) => (
                          <article
                            key={card.id}
                            className={cn(
                              "border-2 border-[var(--shock-ink)] bg-white px-3 py-3 shadow-[var(--shock-shadow-sm)]",
                              card.state === "running" && "bg-[var(--shock-yellow)]",
                              card.state === "paused" && "bg-[var(--shock-paper)]"
                            )}
                            data-testid={`board-card-${card.key}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-[2px] bg-[var(--shock-yellow)] px-1 py-0.5 font-mono text-[9px]">{card.key}</span>
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]">
                                  {boardStateLabel(card.state)}
                                </span>
                              </div>
                              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.52)]">
                                planning
                              </span>
                            </div>
                            <h4 className="mt-3 text-sm font-semibold leading-6">{card.title}</h4>
                            <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.68)]">
                              {card.summary}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.62)]">
                              <span className="rounded-full border border-[var(--shock-ink)] bg-[#f7f7f7] px-2 py-1">
                                owner {card.owner}
                              </span>
                              <span className="rounded-full border border-[var(--shock-ink)] bg-[#f7f7f7] px-2 py-1">
                                room {roomMap.get(card.roomId)?.title ?? card.roomId}
                              </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Link
                                href={`/rooms/${card.roomId}?tab=context`}
                                data-testid={`board-card-room-${card.key}`}
                                className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                              >
                                回讨论间
                              </Link>
                              <Link
                                href={`/issues/${card.key}`}
                                data-testid={`board-card-issue-${card.key}`}
                                className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                              >
                                打开 Issue
                              </Link>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            <aside className="hidden min-h-0 border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:block">
              <div className="h-full overflow-y-auto p-4">
                <div className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                  <p className="font-mono text-[10px] tracking-[0.16em]">创建新 Issue Room</p>
                <div className="mt-4 space-y-3">
                  <input data-testid="board-create-issue-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canCreateIssue} className="w-full border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60" placeholder="需求标题" />
                  <textarea data-testid="board-create-issue-summary" value={summary} onChange={(event) => setSummary(event.target.value)} disabled={!canCreateIssue} className="min-h-[120px] w-full border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60" placeholder="需求摘要" />
                  <button data-testid="board-create-issue-submit" onClick={handleCreateIssue} disabled={creating || !canCreateIssue} className="w-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] shadow-[var(--shock-shadow-sm)] disabled:opacity-60">
                    {creating ? "创建中..." : "创建并进入讨论间"}
                  </button>
                  <p data-testid="board-create-issue-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    {createIssueStatus}
                  </p>
                </div>
              </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export function StitchInboxView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    state,
    approvalCenter,
    loading,
    error,
    approvalCenterLoading,
    approvalCenterError,
    applyInboxDecision,
    createHandoff,
    updateHandoff,
  } = usePhaseZeroState();
  const quickSearch = useQuickSearchController(loading || error ? { ...state, channels: [], rooms: [], issues: [], runs: [], agents: [] } : state);
  const openSignals = loading || error ? [] : approvalCenter.signals.filter((item) => item.kind !== "status");
  const recentSignals = loading || error ? [] : approvalCenter.recent;
  const highlightedHandoffId = searchParams.get("handoffId");
  const contextRoomId = searchParams.get("roomId");
  const mailboxHandoffs = loading || error ? [] : state.mailbox;
  const session = state.auth.session;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [mailboxBusyId, setMailboxBusyId] = useState<string | null>(null);
  const [mailboxError, setMailboxError] = useState<{ id: string; message: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<ApprovalCenterFilter>("all");
  const [composeRoomId, setComposeRoomId] = useState("");
  const [composeFromAgentId, setComposeFromAgentId] = useState("");
  const [composeToAgentId, setComposeToAgentId] = useState("");
  const [composeTitle, setComposeTitle] = useState("把 fresh head reviewer lane 交给下一位 Agent");
  const [composeSummary, setComposeSummary] = useState("请你接住 current exact-head reviewer lane，并在 mailbox 里显式回写 blocked / complete。");
  const [creatingHandoff, setCreatingHandoff] = useState(false);
  const [handoffNotes, setHandoffNotes] = useState<Record<string, string>>({});
  const [mailboxCommentActors, setMailboxCommentActors] = useState<Record<string, string>>({});
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const centerLoading = loading || approvalCenterLoading;
  const blockedCount = loading || error ? 0 : approvalCenter.blockedCount;
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;
  const disconnected = loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline");
  const canManageMailbox = hasSessionPermission(session, "run.execute");
  const mailboxSurfaceActive = pathname === "/mailbox";
  const governedSuggestion = state.workspace.governance.routingPolicy.suggestedHandoff;

  const recommendedMailboxAgents = useCallback((roomId: string) => {
    if (governedSuggestion.roomId === roomId && governedSuggestion.status === "ready") {
      return {
        fromAgentId: governedSuggestion.fromAgentId ?? "",
        toAgentId: governedSuggestion.toAgentId ?? "",
        title: governedSuggestion.draftTitle ?? "把 governed lane 交给下一位 Agent",
        summary: governedSuggestion.draftSummary ?? "按当前治理链继续推进下一棒。",
      };
    }
    const room = state.rooms.find((candidate) => candidate.id === roomId);
    const ownerAgent = state.agents.find((agent) => agent.name === room?.topic.owner);
    const fromAgentId = ownerAgent?.id ?? state.agents[0]?.id ?? "";
    const toAgentId =
      state.agents.find((agent) => agent.id !== fromAgentId)?.id ??
      fromAgentId;
    return {
      fromAgentId,
      toAgentId,
      title: "把 fresh head reviewer lane 交给下一位 Agent",
      summary: "请你接住 current exact-head reviewer lane，并在 mailbox 里显式回写 blocked / complete。",
    };
  }, [governedSuggestion.draftSummary, governedSuggestion.draftTitle, governedSuggestion.fromAgentId, governedSuggestion.roomId, governedSuggestion.status, governedSuggestion.toAgentId, state.agents, state.rooms]);

  function applyRoomDefaults(roomId: string) {
    if (!roomId) {
      return;
    }
    const defaults = recommendedMailboxAgents(roomId);
    setComposeRoomId(roomId);
    setComposeFromAgentId(defaults.fromAgentId);
    setComposeToAgentId(defaults.toAgentId);
    setComposeTitle(defaults.title);
    setComposeSummary(defaults.summary);
  }

  function applyGovernedComposeRoute() {
    if (governedSuggestion.roomId !== composeRoomId || governedSuggestion.status !== "ready") {
      return;
    }
    setComposeFromAgentId(governedSuggestion.fromAgentId ?? "");
    setComposeToAgentId(governedSuggestion.toAgentId ?? "");
    setComposeTitle(governedSuggestion.draftTitle ?? "把 governed lane 交给下一位 Agent");
    setComposeSummary(governedSuggestion.draftSummary ?? "按当前治理链继续推进下一棒。");
  }

  function governedComposeInput() {
    if (governedSuggestion.roomId !== composeRoomId || governedSuggestion.status !== "ready") {
      return null;
    }
    if (!governedSuggestion.fromAgentId || !governedSuggestion.toAgentId || !governedSuggestion.draftTitle?.trim()) {
      return null;
    }
    return {
      roomId: governedSuggestion.roomId,
      fromAgentId: governedSuggestion.fromAgentId,
      toAgentId: governedSuggestion.toAgentId,
      title: governedSuggestion.draftTitle.trim(),
      summary: governedSuggestion.draftSummary?.trim() ?? "",
    };
  }

  useEffect(() => {
    if (loading || error || state.rooms.length === 0 || state.agents.length === 0) {
      return;
    }
    if (composeRoomId && state.rooms.some((room) => room.id === composeRoomId)) {
      return;
    }
    const preferredRoomId =
      contextRoomId && state.rooms.some((room) => room.id === contextRoomId)
        ? contextRoomId
        : state.rooms[0]?.id;
    if (preferredRoomId) {
      const defaults = recommendedMailboxAgents(preferredRoomId);
      setComposeRoomId(preferredRoomId);
      setComposeFromAgentId(defaults.fromAgentId);
      setComposeToAgentId(defaults.toAgentId);
      setComposeTitle(defaults.title);
      setComposeSummary(defaults.summary);
    }
  }, [composeRoomId, contextRoomId, error, loading, recommendedMailboxAgents, state.agents, state.rooms]);

  useEffect(() => {
    if (!mailboxSurfaceActive || loading || error) {
      return;
    }
    const selector = highlightedHandoffId
      ? `[data-testid="mailbox-card-${highlightedHandoffId}"]`
      : '[data-testid="mailbox-open-count"]';
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "start" });
    }
  }, [error, highlightedHandoffId, loading, mailboxSurfaceActive, mailboxHandoffs.length]);

  function findPullRequestForItem(item: Pick<ApprovalCenterItem, "href" | "roomId" | "runId">) {
    return state.pullRequests.find(
      (pullRequest) =>
        (item.runId && pullRequest.runId === item.runId) ||
        (item.roomId && pullRequest.roomId === item.roomId) ||
        item.href.includes(pullRequest.runId) ||
        item.href.includes(pullRequest.roomId)
    );
  }

  function findRoomForItem(item: Pick<ApprovalCenterItem, "room" | "roomId">) {
    return state.rooms.find(
      (room) => (item.roomId ? room.id === item.roomId : room.title === item.room)
    );
  }

  function findRoomForHandoff(item: Pick<AgentHandoff, "roomId">) {
    return state.rooms.find((room) => room.id === item.roomId);
  }

  function findRunForHandoff(item: Pick<AgentHandoff, "runId">) {
    return state.runs.find((run) => run.id === item.runId);
  }

  function findInboxForHandoff(item: Pick<AgentHandoff, "inboxItemId">) {
    return state.inbox.find((inboxItem) => inboxItem.id === item.inboxItemId);
  }

  const filteredSignals = openSignals.filter((item) => {
    switch (activeFilter) {
      case "approval":
      case "blocked":
      case "review":
        return item.kind === activeFilter;
      case "unread":
        return item.unread;
      default:
        return true;
    }
  });
  const orderedMailboxHandoffs = highlightedHandoffId
    ? [...mailboxHandoffs].sort((left, right) => {
        if (left.id === highlightedHandoffId) return -1;
        if (right.id === highlightedHandoffId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      })
    : mailboxHandoffs;
  const openMailboxCount = mailboxHandoffs.filter((item) => item.status !== "completed").length;

  async function handleInboxDecision(
    item: ApprovalCenterItem,
    decision: InboxDecision
  ) {
    if (busyId) return;
    setBusyId(item.id);
    setActionError(null);
    try {
      await applyInboxDecision(item.id, decision);
    } catch (decisionError) {
      setActionError({
        id: item.id,
        message: decisionError instanceof Error ? decisionError.message : "decision failed",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function submitComposeHandoff(
    input: {
      roomId: string;
      fromAgentId: string;
      toAgentId: string;
      title: string;
      summary: string;
    }
  ) {
    if (!canManageMailbox || creatingHandoff) {
      return;
    }
    setMailboxError(null);
    setCreatingHandoff(true);
    try {
      await createHandoff(input);
      setComposeTitle("把 fresh head reviewer lane 交给下一位 Agent");
      setComposeSummary("请你接住 current exact-head reviewer lane，并在 mailbox 里显式回写 blocked / complete。");
    } catch (handoffError) {
      setMailboxError({
        id: "compose",
        message: handoffError instanceof Error ? handoffError.message : "mailbox create failed",
      });
    } finally {
      setCreatingHandoff(false);
    }
  }

  async function handleCreateHandoff() {
    await submitComposeHandoff({
      roomId: composeRoomId,
      fromAgentId: composeFromAgentId,
      toAgentId: composeToAgentId,
      title: composeTitle.trim(),
      summary: composeSummary.trim(),
    });
  }

  async function handleCreateGovernedComposeRoute() {
    const input = governedComposeInput();
    if (!input) {
      return;
    }
    applyGovernedComposeRoute();
    await submitComposeHandoff(input);
  }

  async function handleMailboxAction(
    handoff: AgentHandoff,
    action: "acknowledged" | "blocked" | "comment" | "completed",
    options?: { continueGovernedRoute?: boolean }
  ) {
    if (mailboxBusyId) {
      return;
    }
    const note = handoffNotes[handoff.id]?.trim() ?? "";
    const commentActorId =
      mailboxCommentActors[handoff.id] === handoff.toAgentId ? handoff.toAgentId : handoff.fromAgentId;
    setMailboxBusyId(handoff.id);
    setMailboxError(null);
    try {
      await updateHandoff(handoff.id, {
        action,
        actingAgentId: action === "comment" ? commentActorId : handoff.toAgentId,
        note,
        continueGovernedRoute: options?.continueGovernedRoute,
      });
      if (action === "comment" && note) {
        setHandoffNotes((current) => ({ ...current, [handoff.id]: "" }));
      }
    } catch (handoffError) {
      setMailboxError({
        id: handoff.id,
        message: handoffError instanceof Error ? handoffError.message : "mailbox action failed",
      });
    } finally {
      setMailboxBusyId(null);
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <StitchSidebar
          active="inbox"
          channels={sidebarChannels}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col">
          <WorkspaceStatusStrip workspaceName={workspaceName} disconnected={disconnected} />
          <StitchTopBar
            eyebrow={mailboxSurfaceActive ? "Agent Mailbox Surface" : "Human Decision Surface"}
            title={mailboxSurfaceActive ? "Mailbox Ledger" : "Approval Center"}
            description={
              mailboxSurfaceActive
                ? "这里把正式 handoff request / acknowledge / blocked / complete 收成同一条 governance ledger；Room 和 Inbox 继续保留上下文与通知回链。"
                : "这里是需要人类判断的唯一入口。approval、blocked、review 会在这里汇总，并回跳到 room / run / PR。"
            }
            tabs={mailboxSurfaceActive ? ["Mailbox", "Inbox", "Recent"] : ["Inbox", "Review", "Recent"]}
            activeTab={mailboxSurfaceActive ? "Mailbox" : "Inbox"}
            searchPlaceholder={mailboxSurfaceActive ? "Search mailbox / handoff / room" : "Search approval / review / block"}
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--shock-paper)] px-4 py-4">
            <div className="mx-auto max-w-[1180px]">
              <div className="border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                  <div>
                    <p className="inline-flex border border-[var(--shock-ink)] bg-[#ead7ff] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--shock-purple)]">
                      Human Intelligence Required
                    </p>
                    <p className="mt-3 font-display text-[20px] font-bold">Approval Center</p>
                    <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[color:rgba(24,20,14,0.62)]">
                      `/inbox` 直接消费 `/v1/approval-center`，把 approval / blocked / review 的 open lifecycle、unread 热点和 recent resolution 明面化。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]" data-testid="approval-center-open-count">
                      {centerLoading || error ? "…" : approvalCenter.openCount} open
                    </span>
                    <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]" data-testid="approval-center-unread-count">
                      {centerLoading || error ? "…" : approvalCenter.unreadCount} unread
                    </span>
                    <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]" data-testid="approval-center-recent-count">
                      {centerLoading || error ? "…" : approvalCenter.recentCount} recent
                    </span>
                    <span className="border border-[var(--shock-ink)] bg-[var(--shock-pink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white" data-testid="approval-center-blocked-count">
                      {centerLoading || error ? "…" : blockedCount} blocked
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { id: "all", label: "All", count: approvalCenter.openCount },
                  { id: "approval", label: "Approvals", count: approvalCenter.approvalCount },
                  { id: "blocked", label: "Blocks", count: approvalCenter.blockedCount },
                  { id: "review", label: "Reviews", count: approvalCenter.reviewCount },
                  { id: "unread", label: "Unread", count: approvalCenter.unreadCount },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    data-testid={`approval-center-filter-${filter.id}`}
                    onClick={() => setActiveFilter(filter.id as ApprovalCenterFilter)}
                    className={cn(
                      "border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]",
                      activeFilter === filter.id ? "bg-[var(--shock-yellow)] shadow-[var(--shock-shadow-sm)]" : "bg-white"
                    )}
                  >
                    {filter.label} · {centerLoading || error ? "…" : filter.count}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3">
                <div
                  data-testid="approval-center-mobile-triage"
                  className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] p-4 shadow-[var(--shock-shadow-sm)] md:hidden"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Mobile Triage</p>
                      <h2 className="mt-2 font-display text-[22px] font-bold leading-6">轻量通知只先围 `/inbox` 收。</h2>
                      <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                        手机端不复刻整套桌面工作台，只保留 open / unread / blocked 信号与直接 decision；更重的策略设置继续回 `/settings`。
                      </p>
                    </div>
                    <Link
                      href="/settings"
                      data-testid="approval-center-mobile-settings-link"
                      className="inline-flex min-h-[44px] items-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                    >
                      Notification Settings
                    </Link>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <TriageFactTile label="Open" value={centerLoading || error ? "…" : String(approvalCenter.openCount)} testId="approval-center-mobile-open" />
                    <TriageFactTile label="Unread" value={centerLoading || error ? "…" : String(approvalCenter.unreadCount)} testId="approval-center-mobile-unread" />
                    <TriageFactTile label="Blocked" value={centerLoading || error ? "…" : String(blockedCount)} testId="approval-center-mobile-blocked" />
                    <TriageFactTile label="Recent" value={centerLoading || error ? "…" : String(approvalCenter.recentCount)} testId="approval-center-mobile-recent" />
                  </div>
                </div>
                {centerLoading ? (
                  <SurfaceStateMessage title="正在同步审批中心" message="等待 server 返回当前 `/v1/state + /v1/approval-center` 真值。" />
                ) : error ? (
                  <SurfaceStateMessage title="收件箱同步失败" message={error} />
                ) : approvalCenterError ? (
                  <SurfaceStateMessage title="审批中心同步失败" message={approvalCenterError} />
                ) : openSignals.length === 0 ? (
                  <SurfaceStateMessage title="审批中心当前为空" message="这表示当前没有需要人工判断的 approval / blocked / review 信号。" />
                ) : filteredSignals.length === 0 ? (
                  <SurfaceStateMessage title="当前筛选下没有打开信号" message="换一个 filter，或继续处理现有 open lifecycle。" />
                ) : (
                  filteredSignals.map((item, index) => {
                    const pullRequest = findPullRequestForItem(item);
                    const room = findRoomForItem(item);
                    const guard = item.guardId ? state.guards.find((entry) => entry.id === item.guardId) : undefined;
                    const preferredRoomTab = pullRequest ? "pr" : item.kind === "review" ? "pr" : "context";
                    const roomHref = room
                      ? `/rooms/${room.id}?tab=${preferredRoomTab}`
                      : item.roomId
                        ? `/rooms/${item.roomId}?tab=${preferredRoomTab}`
                        : item.href;
                    const runHref = item.roomId && item.runId ? `/rooms/${item.roomId}?tab=run` : item.runId ? `/runs/${item.runId}` : null;
                    const detailLinks = [
                      { label: "Room", href: roomHref, external: false, testId: `approval-center-room-link-${item.id}` },
                      runHref ? { label: "Run", href: runHref, external: false, testId: `approval-center-run-link-${item.id}` } : null,
                      pullRequest?.url
                        ? { label: "PR", href: pullRequest.url, external: true, testId: `approval-center-pr-link-${item.id}` }
                        : null,
                      pullRequest
                        ? { label: "PR Detail", href: `/pull-requests/${pullRequest.id}`, external: false, testId: `approval-center-pr-detail-link-${item.id}` }
                        : null,
                    ].filter(Boolean) as Array<{ label: string; href: string; external: boolean; testId: string }>;
                    const mobileDetailSummary =
                      item.blockedDeliveries > 0
                        ? `${item.deliveryTargets} targets · ${item.blockedDeliveries} blocked`
                        : `${item.deliveryTargets} targets · ${item.time}`;

                    return (
                    <article
                      key={item.id}
                      data-testid={`approval-center-signal-${item.id}`}
                      className={cn(
                        "grid gap-4 border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)] md:grid-cols-[40px_minmax(0,1fr)] xl:grid-cols-[48px_minmax(0,1fr)_180px]",
                        index === 0 && "border-l-[6px] border-l-[var(--shock-yellow)]",
                        index === 1 && "border-l-[6px] border-l-[var(--shock-purple)]"
                      )}
                    >
                      <div className="hidden h-10 w-10 items-center justify-center border-2 border-[var(--shock-ink)] bg-[#f7f7f7] text-base md:flex">
                        {signalIcon(item.kind)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)]">{inboxKindLabel(item.kind)}</span>
                          <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)]">{item.room}</span>
                          <span
                            data-testid={`approval-center-delivery-${item.id}`}
                            className={cn(
                              "rounded-full border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px]",
                              deliveryStatusTone(item.deliveryStatus)
                            )}
                          >
                            {deliveryStatusLabel(item.deliveryStatus)}
                          </span>
                          {item.unread ? (
                            <span
                              data-testid={`approval-center-unread-${item.id}`}
                              className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-pink)] px-2 py-0.5 font-mono text-[9px] text-white"
                            >
                              unread
                            </span>
                          ) : null}
                          {pullRequest ? (
                            <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)]">{pullRequestStatusLabel(pullRequest.status)}</span>
                          ) : null}
                          <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)] md:hidden">{mobileDetailSummary}</span>
                        </div>
                        <h3 className="mt-2 font-display text-[18px] font-bold leading-6">{item.title}</h3>
                        <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">{item.summary}</p>
                        {guard ? (
                          <div className="mt-4 hidden md:block">
                            <DestructiveGuardCard
                              guard={guard}
                              compact
                              contextHref={item.runId && item.roomId ? `/rooms/${item.roomId}?tab=run` : roomHref}
                              testIdPrefix="approval-center-guard"
                            />
                          </div>
                        ) : null}
                        <div className="mt-4 hidden flex-wrap gap-2 md:flex">
                          {detailLinks.map((link) =>
                            link.external ? (
                              <a
                                key={link.testId}
                                data-testid={link.testId}
                                href={link.href}
                                target="_blank"
                                rel="noreferrer"
                                className={cn(
                                  "border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px]",
                                  link.label === "PR" ? "bg-[var(--shock-yellow)]" : "bg-white"
                                )}
                              >
                                {link.label}
                              </a>
                            ) : (
                              <Link
                                key={link.testId}
                                data-testid={link.testId}
                                href={link.href}
                                className={cn(
                                  "border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px]",
                                  link.label === "Room" ? "bg-[var(--shock-paper)]" : "bg-white"
                                )}
                              >
                                {link.label}
                              </Link>
                            )
                          )}
                        </div>
                        <div className="mt-4 space-y-3 md:hidden">
                          <Link
                            data-testid={`approval-center-open-context-mobile-${item.id}`}
                            href={item.href}
                            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            Open Context
                          </Link>
                          {guard || detailLinks.length > 0 ? (
                            <details
                              data-testid={`approval-center-mobile-details-${item.id}`}
                              className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                            >
                              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.7)]">
                                <span>details / guard / links</span>
                                <span aria-hidden="true">+</span>
                              </summary>
                              <div className="mt-3 space-y-3">
                                {guard ? (
                                  <DestructiveGuardCard
                                    guard={guard}
                                    compact
                                    contextHref={item.runId && item.roomId ? `/rooms/${item.roomId}?tab=run` : roomHref}
                                    testIdPrefix="approval-center-mobile-guard"
                                  />
                                ) : null}
                                {detailLinks.length > 0 ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    {detailLinks.map((link) =>
                                      link.external ? (
                                        <a
                                          key={`mobile-${link.testId}`}
                                          data-testid={`mobile-${link.testId}`}
                                          href={link.href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className={cn(
                                            "inline-flex min-h-[44px] items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                                            link.label === "PR" ? "bg-[var(--shock-yellow)]" : "bg-white"
                                          )}
                                        >
                                          {link.label}
                                        </a>
                                      ) : (
                                        <Link
                                          key={`mobile-${link.testId}`}
                                          data-testid={`mobile-${link.testId}`}
                                          href={link.href}
                                          className={cn(
                                            "inline-flex min-h-[44px] items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                                            link.label === "Room" ? "bg-[var(--shock-paper)]" : "bg-white"
                                          )}
                                        >
                                          {link.label}
                                        </Link>
                                      )
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-col xl:items-end">
                        {item.decisionOptions.map((decision) => (
                          <button
                            key={decision}
                            data-testid={`approval-center-action-${decision}-${item.id}`}
                            disabled={busyId === item.id || !hasSessionPermission(session, permissionForInboxAction(item, decision))}
                            onClick={() => void handleInboxDecision(item, decision)}
                            className={cn(
                              "inline-flex min-h-[44px] w-full items-center justify-center border-2 border-[var(--shock-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60 md:min-w-[140px]",
                              decisionTone(decision)
                            )}
                          >
                            {decisionLabel(decision)}
                          </button>
                        ))}
                        <Link href={item.href} className="hidden font-mono text-[10px] text-[color:rgba(24,20,14,0.6)] underline underline-offset-2 md:inline-flex">
                          Open Context
                        </Link>
                        {actionError?.id === item.id ? (
                          <p className="max-w-[200px] text-left font-mono text-[10px] text-[var(--shock-pink)] md:text-right">{actionError.message}</p>
                        ) : null}
                      </div>
                    </article>
                    );
                  })
                )}
              </div>

              <div className="mt-6 border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                <details data-testid="approval-center-mobile-recent-ledger" className="md:hidden">
                  <summary className="block min-h-[44px] cursor-pointer list-none">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Recent Resolution Ledger</p>
                        <h2 className="mt-2 font-display text-[20px] font-bold">最近状态回写</h2>
                      </div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
                        {centerLoading || error ? "同步中" : `${approvalCenter.recentCount} items`}
                      </p>
                    </div>
                  </summary>
                  <div className="mt-5 space-y-3">
                    {centerLoading ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">等待 approval center recent lifecycle 真值。</p>
                    ) : recentSignals.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有 recent resolution/status 回写。</p>
                    ) : (
                      recentSignals.slice(0, 3).map((item) => (
                        <article
                          key={`mobile-${item.id}`}
                          data-testid={`approval-center-mobile-recent-${item.id}`}
                          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
                              status
                            </span>
                            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{item.room}</span>
                            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{item.time}</span>
                          </div>
                          <h3 className="mt-2 font-display text-[18px] font-bold">{item.title}</h3>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{item.summary}</p>
                          <div className="mt-3">
                            <Link
                              href={item.href}
                              className="inline-flex min-h-[44px] items-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              打开上下文
                            </Link>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </details>
                <div className="hidden md:block">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Mailbox Ledger</p>
                    <h2 className="mt-2 font-display text-[20px] font-bold">正式交接回链</h2>
                    <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                      这块直接消费 `/v1/mailbox`，把 request / acknowledge / blocked / complete 放到同一条可审计 ledger；Room 负责现场上下文，Inbox 负责人类可见通知，这里负责正式 handoff 自身。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      data-testid="mailbox-open-count"
                      className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                    >
                      {loading || error ? "…" : `${openMailboxCount} open`}
                    </span>
                    <span
                      className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                    >
                      {loading || error ? "…" : `${mailboxHandoffs.length} total`}
                    </span>
                  </div>
                </div>
                <div className="mt-5 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                  <section className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Request Handoff</p>
                        <h3 className="mt-2 font-display text-[18px] font-bold">创建一条正式交接</h3>
                      </div>
                      <span
                        data-testid="mailbox-compose-authz"
                        className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                      >
                        {loading ? "syncing" : permissionStatus(session, "run.execute")}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {governedSuggestion.roomId === composeRoomId ? (
                        <div
                          data-testid="mailbox-compose-governed-route"
                          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                                governed route
                              </p>
                              <p
                                data-testid="mailbox-compose-governed-route-status"
                                className="mt-2 font-display text-[18px] font-bold"
                              >
                                {governanceStatusLabel(governedSuggestion.status)}
                              </p>
                              <p className="mt-2 text-[12px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                                {governedSuggestion.reason}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {governedSuggestion.status === "ready" ? (
                                <>
                                  <button
                                    type="button"
                                    data-testid="mailbox-compose-governed-route-apply"
                                    onClick={applyGovernedComposeRoute}
                                    className="border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[10px]"
                                  >
                                    Apply Route
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="mailbox-compose-governed-route-create"
                                    onClick={() => void handleCreateGovernedComposeRoute()}
                                    disabled={!canManageMailbox || creatingHandoff}
                                    className="border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] text-white disabled:opacity-60"
                                  >
                                    {creatingHandoff ? "Creating..." : "Create Handoff"}
                                  </button>
                                </>
                              ) : null}
                              {governedSuggestion.status === "active" && governedSuggestion.href ? (
                                <Link
                                  href={governedSuggestion.href}
                                  data-testid="mailbox-compose-governed-route-focus"
                                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px]"
                                >
                                  Focus Handoff
                                </Link>
                              ) : null}
                              {governedSuggestion.status === "done" && governedSuggestion.href ? (
                                <Link
                                  href={governedSuggestion.href}
                                  data-testid="mailbox-compose-governed-route-closeout"
                                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[10px]"
                                >
                                  {governedCloseoutLabel(governedSuggestion.href)}
                                </Link>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {governedSuggestion.fromLaneLabel ? (
                              <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                                {governedSuggestion.fromLaneLabel} · {governedSuggestion.fromAgent || "manual"}
                              </span>
                            ) : null}
                            {governedSuggestion.toLaneLabel ? (
                              <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                                {governedSuggestion.toLaneLabel} · {governedSuggestion.toAgent || "manual"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Room</span>
                        <select
                          data-testid="mailbox-compose-room"
                          value={composeRoomId}
                          disabled={!canManageMailbox}
                          onChange={(event) => applyRoomDefaults(event.target.value)}
                          className="mt-2 w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                        >
                          {sidebarRooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">From Agent</span>
                        <select
                          data-testid="mailbox-compose-from-agent"
                          value={composeFromAgentId}
                          disabled={!canManageMailbox}
                          onChange={(event) => setComposeFromAgentId(event.target.value)}
                          className="mt-2 w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                        >
                          {sidebarAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">To Agent</span>
                        <select
                          data-testid="mailbox-compose-to-agent"
                          value={composeToAgentId}
                          disabled={!canManageMailbox}
                          onChange={(event) => setComposeToAgentId(event.target.value)}
                          className="mt-2 w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                        >
                          {sidebarAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Title</span>
                        <input
                          data-testid="mailbox-compose-title"
                          value={composeTitle}
                          disabled={!canManageMailbox}
                          onChange={(event) => setComposeTitle(event.target.value)}
                          className="mt-2 w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                          placeholder="这次交接要接什么"
                        />
                      </label>
                      <label className="block">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Summary</span>
                        <textarea
                          data-testid="mailbox-compose-summary"
                          value={composeSummary}
                          disabled={!canManageMailbox}
                          onChange={(event) => setComposeSummary(event.target.value)}
                          className="mt-2 min-h-[132px] w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                          placeholder="把 exact context 写清楚"
                        />
                      </label>
                      <button
                        type="button"
                        data-testid="mailbox-compose-submit"
                        disabled={
                          creatingHandoff ||
                          !canManageMailbox ||
                          !composeRoomId ||
                          !composeFromAgentId ||
                          !composeToAgentId ||
                          composeFromAgentId === composeToAgentId ||
                          !composeTitle.trim() ||
                          !composeSummary.trim()
                        }
                        onClick={() => void handleCreateHandoff()}
                        className="w-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
                      >
                        {creatingHandoff ? "creating..." : "Create Handoff"}
                      </button>
                      {!canManageMailbox ? (
                        <p className="text-[12px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                          {permissionBoundaryCopy(session, "run.execute")}
                        </p>
                      ) : null}
                      {mailboxError?.id === "compose" ? (
                        <p className="font-mono text-[10px] text-[var(--shock-pink)]">{mailboxError.message}</p>
                      ) : null}
                    </div>
                  </section>

                  <section className="space-y-3">
                    {loading ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">等待 mailbox ledger 真值。</p>
                    ) : orderedMailboxHandoffs.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有 formal handoff；后续 request / ack / blocked / complete 会直接回写到这里。</p>
                    ) : (
                      orderedMailboxHandoffs.map((handoff) => {
                        const room = findRoomForHandoff(handoff);
                        const run = findRunForHandoff(handoff);
                        const inboxItem = findInboxForHandoff(handoff);
                        const parentHandoff = findMailboxParent(mailboxHandoffs, handoff);
                        const responseHandoff =
                          handoff.kind === "delivery-closeout" ? findLatestMailboxReply(mailboxHandoffs, handoff.id) : null;
                        const responseAttemptCount = responseHandoff ? countMailboxReplies(mailboxHandoffs, handoff.id) : 0;
                        const canResumeParent =
                          handoff.kind === "delivery-reply" &&
                          parentHandoff &&
                          handoff.status === "completed" &&
                          parentHandoff.status === "blocked";
                        const note = handoffNotes[handoff.id] ?? "";
                        const commentActorId =
                          mailboxCommentActors[handoff.id] === handoff.toAgentId ? handoff.toAgentId : handoff.fromAgentId;
                        const availableActions =
                          handoff.status === "requested"
                            ? (["acknowledged", "blocked", "comment"] as const)
                            : handoff.status === "acknowledged"
                              ? (["blocked", "comment", "completed"] as const)
                              : handoff.status === "blocked"
                                ? (["acknowledged", "comment"] as const)
                                : (["comment"] as const);

                        return (
                          <article
                            key={handoff.id}
                            data-testid={`mailbox-card-${handoff.id}`}
                            className={cn(
                              "grid gap-4 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] p-4 shadow-[var(--shock-shadow-sm)] xl:grid-cols-[minmax(0,1fr)_240px]",
                              highlightedHandoffId === handoff.id && "border-l-[6px] border-l-[var(--shock-yellow)] bg-white"
                            )}
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  data-testid={`mailbox-status-${handoff.id}`}
                                  className={cn(
                                    "rounded-full border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]",
                                    handoffStatusTone(handoff.status)
                                  )}
                                >
                                  {handoffStatusLabel(handoff.status)}
                                </span>
                                <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{handoff.issueKey}</span>
                                <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{handoff.updatedAt}</span>
                                <span
                                  data-testid={`mailbox-kind-${handoff.id}`}
                                  className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]"
                                >
                                  {mailboxKindLabel(handoff.kind)}
                                </span>
                                {highlightedHandoffId === handoff.id ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
                                    focused
                                  </span>
                                ) : null}
                              </div>
                              <h3 className="mt-3 font-display text-[20px] font-bold leading-6">{handoff.title}</h3>
                              <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{handoff.summary}</p>
                              <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] text-[color:rgba(24,20,14,0.6)]">
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                  from {handoff.fromAgent}
                                </span>
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                  to {handoff.toAgent}
                                </span>
                                {room ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                    room {room.title}
                                  </span>
                                ) : null}
                                {run ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                    run {run.owner}
                                  </span>
                                ) : null}
                                {parentHandoff ? (
                                  <span
                                    data-testid={`mailbox-parent-chip-${handoff.id}`}
                                    className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1"
                                  >
                                    parent {parentHandoff.title}
                                  </span>
                                ) : null}
                                {parentHandoff ? (
                                  <span
                                    data-testid={`mailbox-parent-status-${handoff.id}`}
                                    className={cn(
                                      "rounded-full border border-[var(--shock-ink)] px-2 py-1 uppercase tracking-[0.18em]",
                                      handoffStatusTone(parentHandoff.status)
                                    )}
                                  >
                                    {mailboxParentStatusLabel(parentHandoff.status)}
                                  </span>
                                ) : null}
                                {responseHandoff ? (
                                  <span
                                    data-testid={`mailbox-response-status-${handoff.id}`}
                                    className={cn(
                                      "rounded-full border border-[var(--shock-ink)] px-2 py-1 uppercase tracking-[0.18em]",
                                      mailboxReplyStatusTone(responseHandoff.status)
                                    )}
                                  >
                                    {mailboxReplyStatusLabel(responseHandoff.status)}
                                  </span>
                                ) : null}
                                {responseAttemptCount > 0 ? (
                                  <span
                                    data-testid={`mailbox-response-attempts-${handoff.id}`}
                                    className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 uppercase tracking-[0.18em]"
                                  >
                                    reply x{responseAttemptCount}
                                  </span>
                                ) : null}
                              </div>
                              <p
                                data-testid={`mailbox-last-action-${handoff.id}`}
                                className="mt-4 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]"
                              >
                                {handoff.lastAction}
                              </p>
                              {handoff.lastNote ? (
                                <p className="mt-2 border-l-4 border-[var(--shock-ink)] pl-3 text-[12px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                                  latest note: {handoff.lastNote}
                                </p>
                              ) : null}

                              <div className="mt-4 flex flex-wrap gap-2">
                                <Link
                                  data-testid={`mailbox-focus-link-${handoff.id}`}
                                  href={`/inbox?handoffId=${handoff.id}&roomId=${handoff.roomId}`}
                                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px]"
                                >
                                  Inbox Focus
                                </Link>
                                <Link
                                  data-testid={`mailbox-room-link-${handoff.id}`}
                                  href={`/rooms/${handoff.roomId}?tab=context`}
                                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                >
                                  Room
                                </Link>
                                <Link
                                  data-testid={`mailbox-run-link-${handoff.id}`}
                                  href={`/rooms/${handoff.roomId}?tab=run`}
                                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                >
                                  Run
                                </Link>
                                <Link
                                  data-testid={`mailbox-issue-link-${handoff.id}`}
                                  href={`/issues/${handoff.issueKey}`}
                                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                >
                                  Issue
                                </Link>
                                {parentHandoff ? (
                                  <Link
                                    data-testid={`mailbox-parent-link-${handoff.id}`}
                                    href={`/inbox?handoffId=${parentHandoff.id}&roomId=${parentHandoff.roomId}`}
                                    className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                  >
                                    Open Parent Closeout
                                  </Link>
                                ) : null}
                                {responseHandoff ? (
                                  <Link
                                    data-testid={`mailbox-response-link-${handoff.id}`}
                                    href={`/inbox?handoffId=${responseHandoff.id}&roomId=${responseHandoff.roomId}`}
                                    className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                  >
                                    Open Unblock Reply
                                  </Link>
                                ) : null}
                                {canResumeParent ? (
                                  <button
                                    type="button"
                                    data-testid={`mailbox-action-resume-parent-${handoff.id}`}
                                    disabled={!canManageMailbox || mailboxBusyId === parentHandoff.id}
                                    onClick={() => void handleMailboxAction(parentHandoff, "acknowledged")}
                                    className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] disabled:opacity-60"
                                  >
                                    {mailboxBusyId === parentHandoff.id ? "working..." : "Resume Parent Closeout"}
                                  </button>
                                ) : null}
                              </div>

                              <div className="mt-5 border-2 border-[var(--shock-ink)] bg-white p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Lifecycle Messages</p>
                                  {inboxItem ? (
                                    <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">
                                      inbox: {inboxKindLabel(inboxItem.kind)}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-3 space-y-2">
                                  {handoff.messages.map((message) => (
                                    <div
                                      key={message.id}
                                      data-testid={`mailbox-message-${handoff.id}-${message.id}`}
                                      className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]">
                                          {mailboxMessageKindLabel(message.kind)}
                                        </span>
                                        <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{message.authorName}</span>
                                        <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{message.createdAt}</span>
                                      </div>
                                      <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{message.body}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-3">
                              <div className="border-2 border-[var(--shock-ink)] bg-white p-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Mailbox Action</p>
                                <textarea
                                  data-testid={`mailbox-note-${handoff.id}`}
                                  value={note}
                                  disabled={!canManageMailbox}
                                  onChange={(event) =>
                                    setHandoffNotes((current) => ({
                                      ...current,
                                      [handoff.id]: event.target.value,
                                    }))
                                  }
                                  className="mt-3 min-h-[112px] w-full border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
                                  placeholder="comment / blocked 时必须写 note；complete 时可以补收口备注。"
                                />
                                <label className="mt-3 block">
                                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                                    Comment As
                                  </span>
                                  <select
                                    data-testid={`mailbox-comment-actor-${handoff.id}`}
                                    value={commentActorId}
                                    disabled={!canManageMailbox}
                                    onChange={(event) =>
                                      setMailboxCommentActors((current) => ({
                                        ...current,
                                        [handoff.id]: event.target.value,
                                      }))
                                    }
                                    className="mt-2 w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                                  >
                                    <option value={handoff.fromAgentId}>{handoff.fromAgent}</option>
                                    <option value={handoff.toAgentId}>{handoff.toAgent}</option>
                                  </select>
                                </label>
                                <div className="mt-3 flex flex-col gap-2">
                                  {availableActions.map((action) => (
                                    <button
                                      key={action}
                                      type="button"
                                      data-testid={`mailbox-action-${action}-${handoff.id}`}
                                      disabled={
                                        !canManageMailbox ||
                                        mailboxBusyId === handoff.id ||
                                        ((action === "blocked" || action === "comment") && !note.trim())
                                      }
                                      onClick={() => void handleMailboxAction(handoff, action)}
                                      className={cn(
                                        "inline-flex min-h-[42px] items-center justify-center border-2 border-[var(--shock-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60",
                                        action === "blocked"
                                          ? "bg-[var(--shock-pink)] text-white"
                                          : action === "comment"
                                            ? "bg-white"
                                          : action === "completed"
                                            ? "bg-[var(--shock-yellow)]"
                                            : "bg-[var(--shock-lime)]"
                                      )}
                                    >
                                      {mailboxBusyId === handoff.id ? "working..." : handoffActionLabel(action)}
                                    </button>
                                  ))}
                                  {handoff.status === "acknowledged" ? (
                                    <button
                                      type="button"
                                      data-testid={`mailbox-action-completed-continue-${handoff.id}`}
                                      disabled={!canManageMailbox || mailboxBusyId === handoff.id}
                                      onClick={() => void handleMailboxAction(handoff, "completed", { continueGovernedRoute: true })}
                                      className="inline-flex min-h-[42px] items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                    >
                                      {mailboxBusyId === handoff.id ? "working..." : "Complete + Auto-Advance"}
                                    </button>
                                  ) : null}
                                </div>
                                {!canManageMailbox ? (
                                  <p className="mt-3 text-[12px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                                    {permissionBoundaryCopy(session, "run.execute")}
                                  </p>
                                ) : null}
                                {mailboxError?.id === handoff.id ? (
                                  <p className="mt-3 font-mono text-[10px] text-[var(--shock-pink)]">{mailboxError.message}</p>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </section>
                </div>
              </div>

              <div className="mt-6 border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Recent Resolution Ledger</p>
                    <h2 className="mt-2 font-display text-[20px] font-bold">最近状态回写</h2>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
                    {centerLoading || error ? "同步中" : `${approvalCenter.recentCount} items`}
                  </p>
                </div>
                <div className="mt-5 space-y-3">
                  {centerLoading ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">等待 approval center recent lifecycle 真值。</p>
                  ) : recentSignals.length === 0 ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有 recent resolution/status 回写。</p>
                  ) : (
                    recentSignals.slice(0, 6).map((item) => (
                      <article
                        key={item.id}
                        data-testid={`approval-center-recent-${item.id}`}
                        className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
                            status
                          </span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{item.room}</span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{item.time}</span>
                        </div>
                        <h3 className="mt-2 font-display text-[18px] font-bold">{item.title}</h3>
                        <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{item.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={item.href}
                            className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                          >
                            打开上下文
                          </Link>
                        </div>
                      </article>
                    ))
                  )}
                </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
