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
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus, permissionStatusSurfaceLabel } from "@/lib/session-authz";

type MailboxAdvanceAction = "acknowledged" | "blocked" | "comment" | "completed";
type MailboxCommentActorMode = "from" | "to";

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
      return "自动交接";
    case "delivery-closeout":
      return "交付收尾";
    case "delivery-reply":
      return "收尾回复";
    default:
      return "手动交接";
  }
}

function mailboxReplyStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "回复受阻";
    case "completed":
      return "回复完成";
    default:
      return "等待回复";
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
  return `主交接 ${handoffStatusLabel(status)}`;
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
      return "阻塞";
    case "queued":
      return "待处理";
    case "running":
      return "进行中";
    case "paused":
      return "已暂停";
    case "review":
      return "评审中";
    case "done":
      return "已完成";
    default:
      return "状态";
  }
}

function boardCreatePermissionLabel(status: "syncing" | "sync_failed" | "allowed" | "blocked" | "signed_out") {
  switch (status) {
    case "syncing":
      return "同步中";
    case "sync_failed":
      return "读取失败";
    case "allowed":
      return "可创建";
    case "blocked":
      return "无权限";
    default:
      return "未登录";
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
      return "可发送";
    case "blocked":
      return "发送受阻";
    case "suppressed":
      return "已静默";
    default:
      return "未路由";
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
      return "进行中";
    case "ready":
      return "就绪";
    case "required":
      return "需要处理";
    case "blocked":
      return "阻塞";
    case "done":
      return "完成";
    case "draft":
      return "草稿";
    case "watch":
      return "关注";
    default:
      return "等待中";
  }
}

function decisionLabel(decision: InboxDecision) {
  switch (decision) {
    case "approved":
      return "通过";
    case "deferred":
      return "稍后";
    case "resolved":
      return "已解决";
    case "merged":
      return "合并";
    default:
      return "请求修改";
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
  return href.startsWith("/pull-requests/") ? "打开交付详情" : "查看交付结果";
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
      return "待接手";
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "阻塞";
    default:
      return "已完成";
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

function availableHandoffActions(status: AgentHandoff["status"]): MailboxAdvanceAction[] {
  switch (status) {
    case "requested":
      return ["acknowledged", "blocked", "comment"];
    case "acknowledged":
      return ["blocked", "comment", "completed"];
    case "blocked":
      return ["acknowledged", "comment"];
    default:
      return ["comment"];
  }
}

function batchSelectableHandoff(handoff: AgentHandoff) {
  return handoff.status !== "completed";
}

function commonBatchActions(handoffs: AgentHandoff[]) {
  if (handoffs.length === 0) {
    return [] as MailboxAdvanceAction[];
  }
  return availableHandoffActions(handoffs[0].status).filter((action) =>
    handoffs.every((handoff) => availableHandoffActions(handoff.status).includes(action))
  );
}

function handoffActionLabel(action: MailboxAdvanceAction) {
  switch (action) {
    case "acknowledged":
      return "接手";
    case "blocked":
      return "阻塞";
    case "comment":
      return "留言";
    default:
      return "完成";
  }
}

function mailboxMessageKindLabel(kind: AgentHandoff["messages"][number]["kind"]) {
  switch (kind) {
    case "request":
      return "请求";
    case "ack":
      return "接手";
    case "blocked":
      return "阻塞";
    case "comment":
      return "留言";
    case "parent-progress":
      return "主任务进度";
    case "response-progress":
      return "回复进度";
    default:
      return "完成";
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
  const [title, setTitle] = useState("把当前任务推进成 PR");
  const [summary, setSummary] = useState("直接从讨论起一条事项，后续在讨论间持续推进。");
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
  const openLaneCount = liveIssues.filter((issue) => issue.state !== "done").length;
  const reviewLaneCount = liveIssues.filter((issue) => issue.state === "review").length;
  const blockedLaneCount = liveIssues.filter((issue) => issue.state === "blocked" || issue.state === "paused").length;
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
  const visibleColumns = columns.filter((column) => column.cards.length > 0);
  const displayColumns = visibleColumns.length > 0 ? visibleColumns : columns;

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
          label: "看事项",
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
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] md:grid-cols-[258px_minmax(0,1fr)]">
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
            eyebrow="任务板"
            title="任务板"
            description="这里只看优先级和推进状态，真正的讨论、执行和追问都回到讨论间。"
            searchPlaceholder="搜索事项 / 讨论 / 智能体"
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          {planningContextVisible ? (
            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                    返回上下文
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
                    {sourceRoom
                      ? `当前从 ${sourceRoom.title} 回到任务板排优先级，处理完可以直接回讨论继续推进。`
                      : sourceIssue
                        ? `当前从 ${sourceIssue.key} 进入任务板，处理完可以直接回原事项继续。`
                        : "当前任务板带着来源上下文打开，处理完请直接回原页面。"}
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
          <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                进行中事项 {String(openLaneCount).padStart(2, "0")}
              </span>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                待评审 {String(reviewLaneCount).padStart(2, "0")}
              </span>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                阻塞 {String(blockedLaneCount).padStart(2, "0")}
              </span>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                在线智能体 {String(activeAgents).padStart(2, "0")}
              </span>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                关联 PR {String(livePullRequests.length).padStart(2, "0")}
              </span>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.64)]">
                最近连接 {loading || error ? "更新中" : state.workspace.lastPairedAt || "未连接"}
              </span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_296px]">
            <div className="min-h-0 overflow-auto bg-[var(--shock-paper)] px-4 py-4">
              {loading ? (
                <SurfaceStateMessage
                  title="正在同步任务板"
                  message="正在获取事项、讨论间和执行状态。"
                />
              ) : error ? (
                <SurfaceStateMessage title="任务板同步失败" message={error} />
              ) : liveIssues.length === 0 ? (
                <SurfaceStateMessage title="当前还没有事项" message="先新建一条事项，或从讨论间带着上下文回到这里排优先级。" />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {displayColumns.map((column) => (
                    <section
                      key={column.title}
                      className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[#fbf7eb] p-3 shadow-[var(--shock-shadow-sm)]"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-display text-lg font-bold">{column.title}</h3>
                          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">
                            {column.cards.length > 0 ? "有事项" : "空列"}
                          </p>
                        </div>
                        <span className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px]">
                          {String(column.cards.length).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {column.cards.map((card) => (
                          <article
                            key={card.id}
                            className={cn(
                              "rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-3.5 py-3.5 shadow-[var(--shock-shadow-sm)]",
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
                                {card.pullRequest ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-[#f6f1df] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]">
                                    {card.pullRequest}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <p className="mt-3 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.54)]">
                              来自 {roomMap.get(card.roomId)?.title ?? "关联讨论间"}
                            </p>
                            <h4 className="mt-3 text-sm font-semibold leading-6">{card.title}</h4>
                            <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.68)]">
                              {card.summary}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.62)]">
                              <span className="rounded-full border border-[var(--shock-ink)] bg-[#f7f7f7] px-2 py-1">
                                负责人 {card.owner}
                              </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Link
                                href={`/rooms/${card.roomId}?tab=context`}
                                data-testid={`board-card-room-${card.key}`}
                                className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
                              >
                                回讨论间
                              </Link>
                              <Link
                                href={`/issues/${card.key}`}
                                data-testid={`board-card-issue-${card.key}`}
                                className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                              >
                                看事项
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
                <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">快速新建</p>
                  <h3 className="mt-2 font-display text-[24px] font-bold leading-none">起一条新事项</h3>
                  <p className="mt-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.68)]">
                    先把事项建出来，再进入讨论间继续沟通、拆解和交付。
                  </p>
                  <div className="mt-4 space-y-3">
                    <input data-testid="board-create-issue-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canCreateIssue} className="w-full rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60" placeholder="事项标题" />
                    <textarea data-testid="board-create-issue-summary" value={summary} onChange={(event) => setSummary(event.target.value)} disabled={!canCreateIssue} className="min-h-[120px] w-full rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60" placeholder="一句话说明要推进什么" />
                    <button data-testid="board-create-issue-submit" onClick={handleCreateIssue} disabled={creating || !canCreateIssue} className="w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] shadow-[var(--shock-shadow-sm)] disabled:opacity-60">
                      {creating ? "创建中..." : "创建后进入讨论间"}
                    </button>
                    <p data-testid="board-create-issue-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      {boardCreatePermissionLabel(createIssueStatus)}
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
  const [mailboxBatchBusyAction, setMailboxBatchBusyAction] = useState<MailboxAdvanceAction | null>(null);
  const [mailboxError, setMailboxError] = useState<{ id: string; message: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<ApprovalCenterFilter>("all");
  const [composeRoomId, setComposeRoomId] = useState("");
  const [composeFromAgentId, setComposeFromAgentId] = useState("");
  const [composeToAgentId, setComposeToAgentId] = useState("");
  const [composeTitle, setComposeTitle] = useState("把当前任务交给下一位智能体");
  const [composeSummary, setComposeSummary] = useState("请继续处理这条任务，并在交接箱里更新进展或结果。");
  const [manualComposeExpanded, setManualComposeExpanded] = useState(false);
  const [creatingHandoff, setCreatingHandoff] = useState(false);
  const [handoffNotes, setHandoffNotes] = useState<Record<string, string>>({});
  const [mailboxCommentActors, setMailboxCommentActors] = useState<Record<string, string>>({});
  const [selectedMailboxIds, setSelectedMailboxIds] = useState<string[]>([]);
  const [mailboxBatchNote, setMailboxBatchNote] = useState("");
  const [mailboxBatchCommentActorMode, setMailboxBatchCommentActorMode] = useState<MailboxCommentActorMode>("from");
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
  const governedComposeAvailable = governedSuggestion.roomId === composeRoomId;

  const recommendedMailboxAgents = useCallback((roomId: string) => {
    if (governedSuggestion.roomId === roomId && governedSuggestion.status === "ready") {
      return {
        fromAgentId: governedSuggestion.fromAgentId ?? "",
        toAgentId: governedSuggestion.toAgentId ?? "",
        title: governedSuggestion.draftTitle ?? "把当前流程交给下一位智能体",
        summary: governedSuggestion.draftSummary ?? "请按当前分工继续推进这条任务。",
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
      title: "把当前任务交给下一位智能体",
      summary: "请继续处理这条任务，并在交接箱里更新进展或结果。",
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
    setComposeTitle(governedSuggestion.draftTitle ?? "把当前流程交给下一位智能体");
    setComposeSummary(governedSuggestion.draftSummary ?? "请按当前分工继续推进这条任务。");
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
    if (loading || error || !composeRoomId) {
      return;
    }
    setManualComposeExpanded(!governedComposeAvailable);
  }, [composeRoomId, error, governedComposeAvailable, loading]);

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
  const selectableMailboxHandoffs = orderedMailboxHandoffs.filter(batchSelectableHandoff);
  const selectedMailboxHandoffs = orderedMailboxHandoffs.filter((handoff) => selectedMailboxIds.includes(handoff.id));
  const batchActions = commonBatchActions(selectedMailboxHandoffs);
  const mailboxMutationBusy = mailboxBusyId !== null || mailboxBatchBusyAction !== null;

  useEffect(() => {
    if (loading || error) {
      return;
    }
    setSelectedMailboxIds((current) =>
      current.filter((handoffId) => state.mailbox.some((item) => item.id === handoffId && batchSelectableHandoff(item)))
    );
  }, [error, loading, state.mailbox]);

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
      setComposeTitle("把当前任务交给下一位智能体");
      setComposeSummary("请继续处理这条任务，并在交接箱里更新进展或结果。");
    } catch (handoffError) {
      setMailboxError({
        id: "compose",
        message: handoffError instanceof Error ? handoffError.message : "创建交接失败",
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
    action: MailboxAdvanceAction,
    options?: { continueGovernedRoute?: boolean }
  ) {
    if (mailboxMutationBusy) {
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
        message: handoffError instanceof Error ? handoffError.message : "交接操作失败",
      });
    } finally {
      setMailboxBusyId(null);
    }
  }

  function toggleMailboxSelection(handoffId: string, selected: boolean) {
    setSelectedMailboxIds((current) => {
      if (selected) {
        return current.includes(handoffId) ? current : [...current, handoffId];
      }
      return current.filter((item) => item !== handoffId);
    });
  }

  async function handleBatchMailboxAction(action: MailboxAdvanceAction) {
    if (!canManageMailbox || mailboxMutationBusy || selectedMailboxHandoffs.length === 0 || !batchActions.includes(action)) {
      return;
    }
    const note = mailboxBatchNote.trim();
    if ((action === "blocked" || action === "comment") && !note) {
      return;
    }

    const handoffs = [...selectedMailboxHandoffs];
    setMailboxError(null);
    setMailboxBatchBusyAction(action);
    try {
      for (const handoff of handoffs) {
        await updateHandoff(handoff.id, {
          action,
          actingAgentId:
            action === "comment"
              ? mailboxBatchCommentActorMode === "to"
                ? handoff.toAgentId
                : handoff.fromAgentId
              : handoff.toAgentId,
          note: action === "acknowledged" ? undefined : note || undefined,
        });
      }
      setMailboxBatchNote("");
    } catch (handoffError) {
      setMailboxError({
        id: "batch",
        message: handoffError instanceof Error ? handoffError.message : "批量操作失败",
      });
    } finally {
      setMailboxBatchBusyAction(null);
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
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] md:grid-cols-[258px_minmax(0,1fr)]">
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
            eyebrow={mailboxSurfaceActive ? "交接" : "收件箱"}
            title={mailboxSurfaceActive ? "交接" : "收件箱"}
            description={
              mailboxSurfaceActive
                ? "这里集中处理需要继续交接的事项。"
                : "这里集中处理需要人工判断的提醒和待办。"
            }
            searchPlaceholder={mailboxSurfaceActive ? "搜索交接 / 讨论间 / 智能体" : "搜索审批 / 评审 / 讨论间"}
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--shock-paper)] px-4 py-4">
            <div className="mx-auto max-w-[1180px]">
              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[var(--shock-shadow-sm)]">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      {mailboxSurfaceActive ? "交接列表" : "待处理列表"}
                    </p>
                    <p className="mt-2 font-display text-[22px] font-bold">
                      {mailboxSurfaceActive ? "先处理交接，再回到讨论间继续" : "先集中处理需要判断的事项"}
                    </p>
                    <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[color:rgba(24,20,14,0.62)]">
                      {mailboxSurfaceActive
                        ? "这里显示需要继续交接和跟进的内容。"
                        : "这里显示需要人工决定的审批、阻塞和评审提醒。"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]" data-testid={centerLoading || error ? undefined : "approval-center-open-count"}>
                      {centerLoading || error ? "…" : approvalCenter.openCount} 条待处理
                    </span>
                    <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]" data-testid={centerLoading || error ? undefined : "approval-center-unread-count"}>
                      {centerLoading || error ? "…" : approvalCenter.unreadCount} 条未读
                    </span>
                    <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]" data-testid={centerLoading || error ? undefined : "approval-center-recent-count"}>
                      {centerLoading || error ? "…" : approvalCenter.recentCount} 条最近
                    </span>
                    <span className="border border-[var(--shock-ink)] bg-[var(--shock-pink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white" data-testid={centerLoading || error ? undefined : "approval-center-blocked-count"}>
                      {centerLoading || error ? "…" : blockedCount} 条阻塞
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { id: "all", label: "全部", count: approvalCenter.openCount },
                  { id: "approval", label: "批准", count: approvalCenter.approvalCount },
                  { id: "blocked", label: "阻塞", count: approvalCenter.blockedCount },
                  { id: "review", label: "评审", count: approvalCenter.reviewCount },
                  { id: "unread", label: "未读", count: approvalCenter.unreadCount },
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
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">移动端提醒</p>
                      
                      <h2 className="mt-2 font-display text-[22px] font-bold leading-6">手机端先看收件箱。</h2>
                      <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                        手机端只保留待处理、未读和阻塞提醒，以及直接处理动作。更完整的设置仍在设置页。
                      </p>
                    </div>
                    <Link
                      href="/settings"
                      data-testid="approval-center-mobile-settings-link"
                      className="inline-flex min-h-[44px] items-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                    >
                      通知设置
                    </Link>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <TriageFactTile label="待处理" value={centerLoading || error ? "…" : String(approvalCenter.openCount)} testId="approval-center-mobile-open" />
                    <TriageFactTile label="未读" value={centerLoading || error ? "…" : String(approvalCenter.unreadCount)} testId="approval-center-mobile-unread" />
                    <TriageFactTile label="阻塞" value={centerLoading || error ? "…" : String(blockedCount)} testId="approval-center-mobile-blocked" />
                    <TriageFactTile label="最近" value={centerLoading || error ? "…" : String(approvalCenter.recentCount)} testId="approval-center-mobile-recent" />
                  </div>
                </div>
                {centerLoading ? (
                  <SurfaceStateMessage title="正在同步收件箱" message="正在读取当前提醒和待办。" />
                ) : error ? (
                  <SurfaceStateMessage title="收件箱同步失败" message={error} />
                ) : approvalCenterError ? (
                  <SurfaceStateMessage title="待处理列表同步失败" message={approvalCenterError} />
                ) : openSignals.length === 0 ? (
                  <SurfaceStateMessage title="当前没有待处理提醒" message="现在没有需要人工判断的事项。" />
                ) : filteredSignals.length === 0 ? (
                  <SurfaceStateMessage title="当前筛选下没有结果" message="换个筛选试试。" />
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
                              未读
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
                            打开详情
                          </Link>
                          {guard || detailLinks.length > 0 ? (
                            <details
                              data-testid={`approval-center-mobile-details-${item.id}`}
                              className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                            >
                              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.7)]">
                                <span>更多信息</span>
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
                          打开详情
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
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">最近更新</p>
                        <h2 className="mt-2 font-display text-[20px] font-bold">最近状态回写</h2>
                      </div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
                        {centerLoading || error ? "同步中" : `${approvalCenter.recentCount} 条`}
                      </p>
                    </div>
                  </summary>
                  <div className="mt-5 space-y-3">
                    {centerLoading ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">正在同步最近更新。</p>
                    ) : recentSignals.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有最近更新。</p>
                    ) : (
                      recentSignals.slice(0, 3).map((item) => (
                        <article
                          key={`mobile-${item.id}`}
                          data-testid={`approval-center-mobile-recent-${item.id}`}
                          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
                              状态
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">交接记录</p>
                    <h2 className="mt-2 font-display text-[20px] font-bold">当前交接</h2>
                    <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                      这里集中显示每一条交接的状态、说明和后续动作。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      data-testid="mailbox-open-count"
                      className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                    >
                      {loading || error ? "…" : `待处理 ${openMailboxCount}`}
                    </span>
                    <span
                      className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                    >
                      {loading || error ? "…" : `全部 ${mailboxHandoffs.length}`}
                    </span>
                  </div>
                </div>
                <div className="mt-5 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                  <section className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">发起交接</p>
                        <h3 className="mt-2 font-display text-[18px] font-bold">创建一条交接</h3>
                      </div>
                      <span
                        data-testid="mailbox-compose-authz"
                        className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                      >
                        {permissionStatusSurfaceLabel(loading ? "syncing" : permissionStatus(session, "run.execute"))}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {governedComposeAvailable ? (
                        <div
                          data-testid="mailbox-compose-governed-route"
                          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                                自动建议
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
                                    采用建议
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="mailbox-compose-governed-route-create"
                                    onClick={() => void handleCreateGovernedComposeRoute()}
                                    disabled={!canManageMailbox || creatingHandoff}
                                    className="border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] text-white disabled:opacity-60"
                                  >
                                    {creatingHandoff ? "创建中..." : "创建交接"}
                                  </button>
                                </>
                              ) : null}
                              {governedSuggestion.status === "active" && governedSuggestion.href ? (
                                <Link
                                  href={governedSuggestion.href}
                                  data-testid="mailbox-compose-governed-route-focus"
                                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px]"
                                >
                                  打开交接
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
                                {governedSuggestion.fromLaneLabel} · {governedSuggestion.fromAgent || "人工指定"}
                              </span>
                            ) : null}
                            {governedSuggestion.toLaneLabel ? (
                              <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                                {governedSuggestion.toLaneLabel} · {governedSuggestion.toAgent || "人工指定"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {governedComposeAvailable ? (
                        <div className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                                手动改写
                              </p>
                              <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                                自动建议已经覆盖默认 source / target / 说明；只有需要偏离治理建议时再展开手动表单。
                              </p>
                            </div>
                            <button
                              type="button"
                              data-testid="mailbox-compose-manual-toggle"
                              onClick={() => setManualComposeExpanded((current) => !current)}
                              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              {manualComposeExpanded ? "收起手动表单" : "展开手动表单"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {manualComposeExpanded || !governedComposeAvailable ? (
                        <div data-testid="mailbox-compose-manual-panel" className="space-y-3 border-2 border-[var(--shock-ink)] bg-white p-3">
                          <label className="block">
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">讨论</span>
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
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">发起方</span>
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
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">接收方</span>
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
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">标题</span>
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
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">说明</span>
                            <textarea
                              data-testid="mailbox-compose-summary"
                              value={composeSummary}
                              disabled={!canManageMailbox}
                              onChange={(event) => setComposeSummary(event.target.value)}
                              className="mt-2 min-h-[132px] w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                              placeholder="把交接背景写清楚"
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
                            {creatingHandoff ? "创建中..." : "创建交接"}
                          </button>
                        </div>
                      ) : null}
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
                    <div
                      data-testid="mailbox-batch-surface"
                      className="border-2 border-[var(--shock-ink)] bg-[#fff7dd] p-4 shadow-[var(--shock-shadow-sm)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                            批量处理
                          </p>
                          <h3 className="mt-2 font-display text-[18px] font-bold">批量处理当前交接</h3>
                          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                            先勾选多条交接，再统一执行接手、留言、阻塞或完成。
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span
                            data-testid="mailbox-batch-selected-count"
                            className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                          >
                            已选 {selectedMailboxHandoffs.length}
                          </span>
                          <button
                            type="button"
                            data-testid="mailbox-batch-select-open"
                            disabled={!canManageMailbox || mailboxMutationBusy || selectableMailboxHandoffs.length === 0}
                            onClick={() => setSelectedMailboxIds(selectableMailboxHandoffs.map((handoff) => handoff.id))}
                            className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60"
                          >
                            全选可处理项
                          </button>
                          <button
                            type="button"
                            data-testid="mailbox-batch-clear"
                            disabled={mailboxMutationBusy || selectedMailboxIds.length === 0}
                            onClick={() => setSelectedMailboxIds([])}
                            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="space-y-3">
                          <textarea
                            data-testid="mailbox-batch-note"
                            value={mailboxBatchNote}
                            disabled={!canManageMailbox}
                            onChange={(event) => setMailboxBatchNote(event.target.value)}
                            className="min-h-[108px] w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                            placeholder="批量阻塞或留言时，会把这段说明写入所有选中的交接。"
                          />
                          <label className="block">
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                              留言身份
                            </span>
                            <select
                              data-testid="mailbox-batch-comment-actor-mode"
                              value={mailboxBatchCommentActorMode}
                              disabled={!canManageMailbox}
                              onChange={(event) => setMailboxBatchCommentActorMode(event.target.value as MailboxCommentActorMode)}
                              className="mt-2 w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                            >
                              <option value="from">发起方</option>
                              <option value="to">接收方</option>
                            </select>
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {selectedMailboxHandoffs.map((handoff) => (
                              <span
                                key={handoff.id}
                                data-testid={`mailbox-batch-selected-${handoff.id}`}
                                className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]"
                              >
                                {handoff.title}
                              </span>
                            ))}
                            {selectedMailboxHandoffs.length === 0 ? (
                              <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">
                                还没有选中交接。先从右侧列表勾选。
                              </span>
                            ) : null}
                          </div>
                          {!canManageMailbox ? (
                            <p className="text-[12px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                              {permissionBoundaryCopy(session, "run.execute")}
                            </p>
                          ) : null}
                          {mailboxError?.id === "batch" ? (
                            <p className="font-mono text-[10px] text-[var(--shock-pink)]">{mailboxError.message}</p>
                          ) : null}
                        </div>
                        <div className="grid gap-2">
                          {(["acknowledged", "blocked", "comment", "completed"] as const).map((action) => (
                            <button
                              key={action}
                              type="button"
                              data-testid={`mailbox-batch-action-${action}`}
                              disabled={
                                !canManageMailbox ||
                                mailboxMutationBusy ||
                                selectedMailboxHandoffs.length === 0 ||
                                !batchActions.includes(action) ||
                                ((action === "blocked" || action === "comment") && !mailboxBatchNote.trim())
                              }
                              onClick={() => void handleBatchMailboxAction(action)}
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
                              {mailboxBatchBusyAction === action ? "处理中..." : `批量${handoffActionLabel(action)}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {loading ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">正在同步交接记录。</p>
                    ) : orderedMailboxHandoffs.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有交接项；创建后会直接显示在这里。</p>
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
                        const selectedForBatch = selectedMailboxIds.includes(handoff.id);
                        const note = handoffNotes[handoff.id] ?? "";
                        const commentActorId =
                          mailboxCommentActors[handoff.id] === handoff.toAgentId ? handoff.toAgentId : handoff.fromAgentId;
                        const availableActions = availableHandoffActions(handoff.status);

                        return (
                          <article
                            key={handoff.id}
                            data-testid={`mailbox-card-${handoff.id}`}
                            className={cn(
                              "grid gap-4 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] p-4 shadow-[var(--shock-shadow-sm)] xl:grid-cols-[minmax(0,1fr)_240px]",
                              selectedForBatch && "border-l-[6px] border-l-[var(--shock-purple)] bg-white",
                              highlightedHandoffId === handoff.id && "border-l-[6px] border-l-[var(--shock-yellow)] bg-white"
                            )}
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                {batchSelectableHandoff(handoff) ? (
                                  <label className="inline-flex items-center gap-2 rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]">
                                    <input
                                      type="checkbox"
                                      data-testid={`mailbox-select-${handoff.id}`}
                                      checked={selectedForBatch}
                                      disabled={!canManageMailbox || mailboxMutationBusy}
                                      onChange={(event) => toggleMailboxSelection(handoff.id, event.target.checked)}
                                      className="h-3.5 w-3.5 accent-[var(--shock-purple)]"
                                    />
                                    batch
                                  </label>
                                ) : null}
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
                                    当前查看
                                  </span>
                                ) : null}
                                {selectedForBatch ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-purple)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white">
                                    已选
                                  </span>
                                ) : null}
                              </div>
                              <h3 className="mt-3 font-display text-[20px] font-bold leading-6">{handoff.title}</h3>
                              <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{handoff.summary}</p>
                              <div className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] text-[color:rgba(24,20,14,0.6)]">
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                  发起方 {handoff.fromAgent}
                                </span>
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                  接收方 {handoff.toAgent}
                                </span>
                                {room ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                    讨论 {room.title}
                                  </span>
                                ) : null}
                                {run ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1">
                                    运行 {run.owner}
                                  </span>
                                ) : null}
                                {parentHandoff ? (
                                  <span
                                    data-testid={`mailbox-parent-chip-${handoff.id}`}
                                    className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1"
                                  >
                                    主交接 · {parentHandoff.title}
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
                                    回复 {responseAttemptCount} 次
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
                                  最近说明：{handoff.lastNote}
                                </p>
                              ) : null}

                              <div className="mt-4 flex flex-wrap gap-2">
                                <Link
                                  data-testid={`mailbox-focus-link-${handoff.id}`}
                                  href={`/inbox?handoffId=${handoff.id}&roomId=${handoff.roomId}`}
                                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px]"
                                >
                                  打开收件箱
                                </Link>
                                <Link
                                  data-testid={`mailbox-room-link-${handoff.id}`}
                                  href={`/rooms/${handoff.roomId}?tab=context`}
                                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                >
                                  讨论
                                </Link>
                                <Link
                                  data-testid={`mailbox-run-link-${handoff.id}`}
                                  href={`/rooms/${handoff.roomId}?tab=run`}
                                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                >
                                  运行
                                </Link>
                                <Link
                                  data-testid={`mailbox-issue-link-${handoff.id}`}
                                  href={`/issues/${handoff.issueKey}`}
                                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                >
                                  事项
                                </Link>
                                {parentHandoff ? (
                                  <Link
                                    data-testid={`mailbox-parent-link-${handoff.id}`}
                                    href={`/inbox?handoffId=${parentHandoff.id}&roomId=${parentHandoff.roomId}`}
                                    className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                  >
                                    打开主交接
                                  </Link>
                                ) : null}
                                {responseHandoff ? (
                                  <Link
                                    data-testid={`mailbox-response-link-${handoff.id}`}
                                    href={`/inbox?handoffId=${responseHandoff.id}&roomId=${responseHandoff.roomId}`}
                                    className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                                  >
                                    打开回复
                                  </Link>
                                ) : null}
                                {canResumeParent ? (
                                  <button
                                    type="button"
                                    data-testid={`mailbox-action-resume-parent-${handoff.id}`}
                                    disabled={!canManageMailbox || mailboxMutationBusy}
                                    onClick={() => void handleMailboxAction(parentHandoff, "acknowledged")}
                                    className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] disabled:opacity-60"
                                  >
                                    {mailboxBusyId === parentHandoff.id ? "处理中..." : "继续主交接"}
                                  </button>
                                ) : null}
                              </div>

                              <div className="mt-5 border-2 border-[var(--shock-ink)] bg-white p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">交接记录</p>
                                  {inboxItem ? (
                                    <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">
                                      收件箱：{inboxKindLabel(inboxItem.kind)}
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
                                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">处理操作</p>
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
                                  placeholder="需要留言或标记阻塞时，请写清楚原因；完成时也可以补充说明。"
                                />
                                <label className="mt-3 block">
                                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                                    留言身份
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
                                        mailboxMutationBusy ||
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
                                      {mailboxBusyId === handoff.id ? "处理中..." : handoffActionLabel(action)}
                                    </button>
                                  ))}
                                  {handoff.status === "acknowledged" ? (
                                    <button
                                      type="button"
                                      data-testid={`mailbox-action-completed-continue-${handoff.id}`}
                                      disabled={!canManageMailbox || mailboxMutationBusy}
                                      onClick={() => void handleMailboxAction(handoff, "completed", { continueGovernedRoute: true })}
                                      className="inline-flex min-h-[42px] items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                    >
                                      {mailboxBusyId === handoff.id ? "处理中..." : "完成并继续下一步"}
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">最近更新</p>
                    <h2 className="mt-2 font-display text-[20px] font-bold">最近状态回写</h2>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
                    {centerLoading || error ? "同步中" : `${approvalCenter.recentCount} 条`}
                  </p>
                </div>
                <div className="mt-5 space-y-3">
                  {centerLoading ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">正在同步最近更新。</p>
                  ) : recentSignals.length === 0 ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有最近更新。</p>
                  ) : (
                    recentSignals.slice(0, 6).map((item) => (
                      <article
                        key={item.id}
                        data-testid={`approval-center-recent-${item.id}`}
                        className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
                            状态
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
