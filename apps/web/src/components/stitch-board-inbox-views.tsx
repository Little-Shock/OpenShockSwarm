"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { buildBoardColumns, fallbackState, type InboxItem } from "@/lib/mock-data";
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

export function StitchBoardView() {
  const router = useRouter();
  const { state, createIssue } = usePhaseZeroState();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("把真实 PR 写回接进讨论间");
  const [summary, setSummary] = useState("从房间直接创建 PR，并把 review / merge 状态回写到 Room 和 Inbox。");
  const columns = buildBoardColumns(state.issues.length > 0 ? state.issues : fallbackState.issues);

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
        <StitchSidebar active="board" channels={state.channels} machines={state.machines} agents={state.agents} />
        <section className="flex min-h-0 flex-col">
          <StitchTopBar tabs={["仪表盘", "任务板", "节点"]} activeTab="任务板" searchPlaceholder="搜索任务..." />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-2">
            <div className="grid items-center gap-3 xl:grid-cols-[220px_160px_1fr_auto_auto]">
              <p className="font-mono text-[10px] tracking-[0.16em]">Machine Health: 94%</p>
              <p className="font-mono text-[10px] tracking-[0.16em]">{state.agents.length} agents online</p>
              <div className="flex gap-1">
                <span className="h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-[var(--shock-purple)]" />
                <span className="h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-[var(--shock-lime)]" />
                <span className="h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-black" />
              </div>
              <span className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px]">Low Latency</span>
              <span className="font-mono text-[10px]">sys_time: 14:02:49</span>
            </div>
          </div>

          <div className="grid flex-1 min-h-0 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-x-auto bg-[#f7f7f7] px-4 py-4">
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
                            <p>In Room: {card.key.replace("OPS", "ROOM")}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <aside className="hidden border-l-2 border-[var(--shock-ink)] bg-white p-4 xl:block">
              <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-[#fff8e6] p-4 shadow-[3px_3px_0_0_var(--shock-ink)]">
                <p className="font-mono text-[10px] tracking-[0.16em]">创建新 Issue Room</p>
                <div className="mt-4 space-y-3">
                  <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none" placeholder="需求标题" />
                  <textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="min-h-[120px] w-full rounded-[4px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none" placeholder="需求摘要" />
                  <button onClick={handleCreateIssue} disabled={creating} className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] disabled:opacity-60">
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
  const { state } = usePhaseZeroState();
  const inboxItems = state.inbox.length > 0 ? state.inbox : fallbackState.inbox;

  return (
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[256px_minmax(0,1fr)]">
        <StitchSidebar active="inbox" channels={state.channels} machines={state.machines} agents={state.agents} />
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
                    <p className="font-display text-4xl font-bold">3</p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Critical Blocks</p>
                  </div>
                  <div>
                    <p className="font-display text-4xl font-bold">{inboxItems.length}</p>
                    <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Awaiting Replies</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-5">
                {inboxItems.map((item, index) => (
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
                      </div>
                      <h3 className="mt-2 font-display text-2xl font-bold">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">{item.summary}</p>
                    </div>
                    <div className="flex flex-col gap-2 xl:items-end">
                      <Link href={item.href} className={cn("inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] px-4 py-3 font-mono text-[10px]", item.kind === "approval" ? "bg-[var(--shock-yellow)]" : item.kind === "blocked" ? "bg-[var(--shock-purple)] text-white" : "bg-white")}>
                        {item.kind === "approval" ? "Authorize" : item.kind === "blocked" ? "Resolve" : "View"}
                      </Link>
                      <button className="inline-flex min-w-[150px] items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[10px]">
                        {item.kind === "approval" ? "Review Diff" : item.kind === "blocked" ? "Defer" : "Reply"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
