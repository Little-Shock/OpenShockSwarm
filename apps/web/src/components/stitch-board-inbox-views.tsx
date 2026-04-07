"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  buildBoardColumns,
  type ApprovalCenterItem,
  type InboxDecision,
  type InboxItem,
} from "@/lib/mock-data";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { hasSessionPermission, permissionStatus } from "@/lib/session-authz";
import { StitchSidebar, StitchTopBar } from "@/components/stitch-shell-primitives";

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

export function StitchBoardView() {
  const router = useRouter();
  const { state, loading, error, createIssue } = usePhaseZeroState();
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
  const sidebarMachines = liveMachines;
  const sidebarAgents = liveAgents;
  const activeAgents = liveAgents.filter((agent) => agent.state === "running").length;

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
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[256px_minmax(0,1fr)]">
        <StitchSidebar active="board" channels={sidebarChannels} machines={sidebarMachines} agents={sidebarAgents} />
        <section className="flex min-h-0 flex-col">
          <StitchTopBar tabs={["仪表盘", "任务板", "节点"]} activeTab="任务板" searchPlaceholder="搜索任务..." />
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

          <div className="grid flex-1 min-h-0 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-x-auto bg-[#f7f7f7] px-4 py-4">
              {loading ? (
                <SurfaceStateMessage
                  title="正在同步任务板"
                  message="等待 server 返回当前 issue / room / run 真值，任务板不再先渲染本地 mock 卡片。"
                />
              ) : error ? (
                <SurfaceStateMessage title="任务板同步失败" message={error} />
              ) : liveIssues.length === 0 ? (
                <SurfaceStateMessage title="当前还没有任务卡" message="等第一条 Issue 创建后，Board 会直接显示 live lane truth。" />
              ) : (
                <div className="grid min-w-[1560px] gap-4 xl:grid-cols-6">
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
                          <Link
                            key={card.id}
                            href={`/issues/${card.key}`}
                            className={cn(
                              "block rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 shadow-[2px_2px_0_0_var(--shock-ink)]",
                              card.state === "running" && "bg-[var(--shock-yellow)]",
                              card.state === "paused" && "bg-[var(--shock-paper)]"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="rounded-[2px] bg-[var(--shock-yellow)] px-1 py-0.5 font-mono text-[9px]">{card.key}</span>
                              <span className="font-mono text-[10px]">···</span>
                            </div>
                            <h4 className="mt-3 text-sm font-semibold leading-6">{card.title}</h4>
                            <div className="mt-4 space-y-1 font-mono text-[9px] text-[color:rgba(24,20,14,0.58)]">
                              <p>Agent: {card.owner}</p>
                              <p>Room: {card.roomId}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            <aside className="hidden border-l-2 border-[var(--shock-ink)] bg-white p-4 xl:block">
              <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-[#fff8e6] p-4 shadow-[3px_3px_0_0_var(--shock-ink)]">
                <p className="font-mono text-[10px] tracking-[0.16em]">创建新 Issue Room</p>
                <div className="mt-4 space-y-3">
                  <input data-testid="board-create-issue-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canCreateIssue} className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60" placeholder="需求标题" />
                  <textarea data-testid="board-create-issue-summary" value={summary} onChange={(event) => setSummary(event.target.value)} disabled={!canCreateIssue} className="min-h-[120px] w-full rounded-[4px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60" placeholder="需求摘要" />
                  <button data-testid="board-create-issue-submit" onClick={handleCreateIssue} disabled={creating || !canCreateIssue} className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] disabled:opacity-60">
                    {creating ? "创建中..." : "创建并进入讨论间"}
                  </button>
                  <p data-testid="board-create-issue-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    {createIssueStatus}
                  </p>
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
  const {
    state,
    approvalCenter,
    loading,
    error,
    approvalCenterLoading,
    approvalCenterError,
    applyInboxDecision,
  } = usePhaseZeroState();
  const openSignals = loading || error ? [] : approvalCenter.signals.filter((item) => item.kind !== "status");
  const recentSignals = loading || error ? [] : approvalCenter.recent;
  const session = state.auth.session;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<ApprovalCenterFilter>("all");
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const centerLoading = loading || approvalCenterLoading;
  const blockedCount = loading || error ? 0 : approvalCenter.blockedCount;

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

  return (
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[256px_minmax(0,1fr)]">
        <StitchSidebar active="inbox" channels={sidebarChannels} machines={sidebarMachines} agents={sidebarAgents} />
        <section className="flex min-h-0 flex-col">
          <StitchTopBar tabs={["仪表盘", "收件箱", "系统"]} activeTab="收件箱" searchPlaceholder="搜索信号..." />
          <div className="flex-1 overflow-y-auto bg-white px-10 py-8">
            <div className="mx-auto max-w-5xl">
              <p className="inline-flex rounded-[4px] bg-[#ead7ff] px-2 py-1 font-mono text-[9px] text-[var(--shock-purple)]">HUMAN INTELLIGENCE REQUIRED</p>
              <div className="mt-4 flex items-end justify-between gap-6">
                <div>
                  <h1 className="font-display text-6xl font-bold">Approval Center</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.62)]">
                    `/inbox` 现在直接消费 `/v1/approval-center`，把 approval / blocked / review 的 open lifecycle、unread 热点和 recent resolution 明面化，不再停在裸卡片列表。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-6 text-right xl:grid-cols-4">
                  <div>
                    <p data-testid="approval-center-open-count" className="font-display text-4xl font-bold">
                      {centerLoading || error ? "…" : approvalCenter.openCount}
                    </p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Open Signals</p>
                  </div>
                  <div>
                    <p data-testid="approval-center-unread-count" className="font-display text-4xl font-bold">
                      {centerLoading || error ? "…" : approvalCenter.unreadCount}
                    </p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Unread Hotspots</p>
                  </div>
                  <div>
                    <p data-testid="approval-center-recent-count" className="font-display text-4xl font-bold">
                      {centerLoading || error ? "…" : approvalCenter.recentCount}
                    </p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Recent Resolutions</p>
                  </div>
                  <div>
                    <p data-testid="approval-center-blocked-count" className="font-display text-4xl font-bold">
                      {centerLoading || error ? "…" : blockedCount}
                    </p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Critical Blocks</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
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
                      "rounded-full border-2 border-[var(--shock-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                      activeFilter === filter.id ? "bg-[var(--shock-yellow)] shadow-[3px_3px_0_0_var(--shock-ink)]" : "bg-white"
                    )}
                  >
                    {filter.label} · {centerLoading || error ? "…" : filter.count}
                  </button>
                ))}
              </div>

              <div className="mt-8 space-y-5">
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
                    const roomHref = room ? `/rooms/${room.id}` : item.roomId ? `/rooms/${item.roomId}` : item.href;
                    const runHref = item.roomId && item.runId ? `/rooms/${item.roomId}/runs/${item.runId}` : item.runId ? `/runs/${item.runId}` : null;

                    return (
                    <article
                      key={item.id}
                      data-testid={`approval-center-signal-${item.id}`}
                      className={cn(
                        "grid gap-4 rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[3px_3px_0_0_var(--shock-ink)] xl:grid-cols-[56px_minmax(0,1fr)_200px]",
                        index === 0 && "border-l-[6px] border-l-[var(--shock-yellow)]",
                        index === 1 && "border-l-[6px] border-l-[var(--shock-purple)]"
                      )}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#f7f7f7] text-lg">
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
                        </div>
                        <h3 className="mt-2 font-display text-2xl font-bold">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">{item.summary}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            data-testid={`approval-center-room-link-${item.id}`}
                            href={roomHref}
                            className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px]"
                          >
                            Room
                          </Link>
                          {runHref ? (
                            <Link
                              data-testid={`approval-center-run-link-${item.id}`}
                              href={runHref}
                              className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
                            >
                              Run
                            </Link>
                          ) : null}
                          {pullRequest?.url ? (
                            <a
                              data-testid={`approval-center-pr-link-${item.id}`}
                              href={pullRequest.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px]"
                            >
                              PR
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 xl:items-end">
                        {item.decisionOptions.map((decision) => (
                          <button
                            key={decision}
                            data-testid={`approval-center-action-${decision}-${item.id}`}
                            disabled={busyId === item.id || !hasSessionPermission(session, permissionForInboxAction(item, decision))}
                            onClick={() => void handleInboxDecision(item, decision)}
                            className={cn(
                              "inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] px-4 py-3 font-mono text-[10px] disabled:opacity-60",
                              decisionTone(decision)
                            )}
                          >
                            {decisionLabel(decision)}
                          </button>
                        ))}
                        <Link href={item.href} className="font-mono text-[10px] text-[color:rgba(24,20,14,0.6)] underline underline-offset-2">
                          Open Context
                        </Link>
                        {actionError?.id === item.id ? (
                          <p className="max-w-[200px] text-right font-mono text-[10px] text-[var(--shock-pink)]">{actionError.message}</p>
                        ) : null}
                      </div>
                    </article>
                    );
                  })
                )}
              </div>

              <div className="mt-10 rounded-[6px] border-2 border-[var(--shock-ink)] bg-[#f7f7f7] p-5 shadow-[3px_3px_0_0_var(--shock-ink)]">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">Recent Resolution Ledger</p>
                    <h2 className="mt-2 font-display text-3xl font-bold">最近状态回写</h2>
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
                        className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]">
                            status
                          </span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{item.room}</span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{item.time}</span>
                        </div>
                        <h3 className="mt-2 font-display text-2xl font-bold">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{item.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={item.href}
                            className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px]"
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
        </section>
      </div>
    </main>
  );
}
