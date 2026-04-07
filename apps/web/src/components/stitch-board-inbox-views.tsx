"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { buildBoardColumns, type InboxItem } from "@/lib/mock-data";
import { usePhaseZeroState } from "@/lib/live-phase0";
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
    if (!title.trim() || creating) return;
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
                <div className="grid min-w-[1320px] gap-4 xl:grid-cols-5">
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
                              card.state === "running" && "bg-[var(--shock-yellow)]"
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
                  <input
                    data-testid="board-create-issue-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                    placeholder="需求标题"
                  />
                  <textarea
                    data-testid="board-create-issue-summary"
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    className="min-h-[120px] w-full rounded-[4px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                    placeholder="需求摘要"
                  />
                  <button
                    data-testid="board-create-issue-submit"
                    onClick={handleCreateIssue}
                    disabled={creating}
                    className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] disabled:opacity-60"
                  >
                    {creating ? "创建中..." : "创建并进入讨论间"}
                  </button>
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
  const { state, loading, error, applyInboxDecision } = usePhaseZeroState();
  const inboxItems = loading || error ? [] : state.inbox;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const blockedCount = inboxItems.filter((item) => item.kind === "blocked").length;

  function findPullRequestForItem(item: InboxItem) {
    return state.pullRequests.find((pullRequest) => item.href.includes(pullRequest.runId) || item.href.includes(pullRequest.roomId));
  }

  async function handleInboxDecision(
    item: InboxItem,
    decision: "approved" | "deferred" | "resolved" | "merged" | "changes_requested"
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
                  <h1 className="font-display text-6xl font-bold">Human Inbox</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.62)]">只显示真正需要你独特判断的事项。这里绕过自动过滤器，只保留高价值的人类干预。</p>
                </div>
                <div className="grid grid-cols-2 gap-6 text-right">
                  <div>
                    <p className="font-display text-4xl font-bold">{blockedCount}</p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Critical Blocks</p>
                  </div>
                  <div>
                    <p className="font-display text-4xl font-bold">{inboxItems.length}</p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Awaiting Replies</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-5">
                {loading ? (
                  <SurfaceStateMessage title="正在同步收件箱" message="等待 server 返回当前需要人类处理的 live inbox items。" />
                ) : error ? (
                  <SurfaceStateMessage title="收件箱同步失败" message={error} />
                ) : inboxItems.length === 0 ? (
                  <SurfaceStateMessage title="收件箱当前为空" message="这表示当前没有需要人工判断的 approval / blocked / review 信号。" />
                ) : (
                  inboxItems.map((item, index) => (
                    <article
                      key={item.id}
                      className={cn(
                        "grid gap-4 rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[3px_3px_0_0_var(--shock-ink)] xl:grid-cols-[56px_minmax(0,1fr)_200px]",
                        index === 0 && "border-l-[6px] border-l-[var(--shock-yellow)]",
                        index === 1 && "border-l-[6px] border-l-[var(--shock-purple)]"
                      )}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#f7f7f7] text-lg">
                        {item.kind === "approval" ? "⌘" : item.kind === "blocked" ? "⇡" : "🖼"}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)]">{inboxKindLabel(item.kind)}</span>
                          <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)]">{item.room}</span>
                          {findPullRequestForItem(item) ? (
                            <span className="font-mono text-[9px] text-[color:rgba(24,20,14,0.48)]">{pullRequestStatusLabel(findPullRequestForItem(item)?.status)}</span>
                          ) : null}
                        </div>
                        <h3 className="mt-2 font-display text-2xl font-bold">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">{item.summary}</p>
                      </div>
                      <div className="flex flex-col gap-2 xl:items-end">
                        {item.kind === "review" && findPullRequestForItem(item) ? (
                          <>
                            <button
                              disabled={busyId === item.id}
                              onClick={() => void handleInboxDecision(item, "merged")}
                              className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[10px] disabled:opacity-60"
                            >
                              Merge
                            </button>
                            <button
                              disabled={busyId === item.id}
                              onClick={() => void handleInboxDecision(item, "changes_requested")}
                              className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[10px] disabled:opacity-60"
                            >
                              Request Changes
                            </button>
                          </>
                        ) : item.kind === "approval" ? (
                          <>
                            <button
                              disabled={busyId === item.id}
                              onClick={() => void handleInboxDecision(item, "approved")}
                              className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[10px] disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyId === item.id}
                              onClick={() => void handleInboxDecision(item, "deferred")}
                              className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[10px] disabled:opacity-60"
                            >
                              Defer
                            </button>
                          </>
                        ) : item.kind === "blocked" ? (
                          <>
                            <button
                              disabled={busyId === item.id}
                              onClick={() => void handleInboxDecision(item, "resolved")}
                              className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-purple)] px-4 py-3 font-mono text-[10px] text-white disabled:opacity-60"
                            >
                              Resolve
                            </button>
                            <button
                              disabled={busyId === item.id}
                              onClick={() => void handleInboxDecision(item, "deferred")}
                              className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[10px] disabled:opacity-60"
                            >
                              Defer
                            </button>
                          </>
                        ) : (
                          <Link href={item.href} className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[10px]">
                            View
                          </Link>
                        )}
                        {item.kind !== "status" ? (
                          <Link href={item.href} className="font-mono text-[10px] text-[color:rgba(24,20,14,0.6)] underline underline-offset-2">
                            Open Context
                          </Link>
                        ) : null}
                        {actionError?.id === item.id ? (
                          <p className="max-w-[200px] text-right font-mono text-[10px] text-[var(--shock-pink)]">{actionError.message}</p>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
