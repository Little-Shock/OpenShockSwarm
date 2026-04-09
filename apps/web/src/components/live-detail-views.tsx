"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";

import { OpenShockShell } from "@/components/open-shock-shell";
import {
  AgentControlSurface,
  LiveOrchestrationBoard,
  type RuntimeRegistryRecord,
} from "@/components/live-orchestration-views";
import {
  AgentDetailView,
  AgentsListView,
  DetailRail,
  IssueDetailView,
  IssuesListView,
  Panel,
  RunDetailView,
} from "@/components/phase-zero-views";
import { RunControlSurface } from "@/components/run-control-surface";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { buildRunHistoryEntries, sanitizeRunHistoryPage } from "@/lib/phase-zero-helpers";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import type { AgentHandoff, Issue, Room, Run, RunHistoryPage, Session } from "@/lib/phase-zero-types";

type PanelTone = "white" | "paper" | "yellow" | "lime" | "pink" | "ink";
const CONTROL_API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

function priorityLabel(priority: Issue["priority"]) {
  switch (priority) {
    case "critical":
      return "关键";
    case "high":
      return "高";
    default:
      return "中";
  }
}

function runStatusLabel(status: Run["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "paused":
      return "已暂停";
    case "blocked":
      return "阻塞";
    case "review":
      return "待评审";
    case "done":
      return "已完成";
  }
}

function panelToneForStatus(status: Run["status"]): PanelTone {
  switch (status) {
    case "running":
      return "yellow";
    case "paused":
      return "paper";
    case "blocked":
      return "pink";
    case "review":
      return "lime";
    case "done":
      return "ink";
    default:
      return "white";
  }
}

function statusBadgeTone(status: Run["status"]) {
  switch (status) {
    case "running":
      return "bg-[var(--shock-yellow)] text-[var(--shock-ink)]";
    case "paused":
      return "bg-[var(--shock-paper)] text-[var(--shock-ink)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "review":
      return "bg-[var(--shock-lime)] text-[var(--shock-ink)]";
    case "done":
      return "bg-[var(--shock-ink)] text-white";
    default:
      return "bg-white text-[var(--shock-ink)]";
  }
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

async function readRunHistoryPage(limit: number, cursor?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    params.set("cursor", cursor);
  }
  const response = await fetch(`${CONTROL_API_BASE}/v1/runs/history?${params.toString()}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as RunHistoryPage & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `request failed: ${response.status}`);
  }
  return sanitizeRunHistoryPage(payload);
}

function readRuntimeRegistry(state: unknown): RuntimeRegistryRecord[] {
  const runtimes = (state as { runtimes?: RuntimeRegistryRecord[] }).runtimes;
  return Array.isArray(runtimes) ? runtimes : [];
}

function LiveStateNotice({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
      <p className="font-display text-[22px] font-bold leading-7">{title}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{message}</p>
    </div>
  );
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

function AgentMailboxPanel({
  agentId,
  handoffs,
}: {
  agentId: string;
  handoffs: AgentHandoff[];
}) {
  return (
    <Panel tone="paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">Mailbox Ledger</p>
          <h3 className="mt-2 font-display text-2xl font-bold">
            {handoffs.length} 条 formal handoff
          </h3>
        </div>
        <Link
          href={`/mailbox?agentId=${agentId}`}
          className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          打开 Mailbox
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {handoffs.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            当前这位 Agent 还没有挂住 formal handoff。后续一旦被 request / ack / blocked / complete 命中，这里会直接显示 ledger。
          </p>
        ) : (
          handoffs.slice(0, 3).map((handoff) => (
            <Link
              key={handoff.id}
              href={`/mailbox?handoffId=${handoff.id}&roomId=${handoff.roomId}`}
              className="block rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-lg font-semibold">{handoff.title}</p>
                <span
                  className={cn(
                    "rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                    handoffStatusTone(handoff.status)
                  )}
                >
                  {handoffStatusLabel(handoff.status)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                {handoff.fromAgent} {"->"} {handoff.toAgent}
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{handoff.lastAction}</p>
            </Link>
          ))
        )}
      </div>
    </Panel>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-1.5 font-display text-[17px] font-semibold leading-5">{value}</p>
    </div>
  );
}

function RoomSnapshotCard({
  room,
  issue,
  run,
}: {
  room: Room;
  issue?: Issue;
  run?: Run;
}) {
  return (
    <Panel tone={panelToneForStatus(room.topic.status)} className="!p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
            {room.issueKey} / {issue ? priorityLabel(issue.priority) : "讨论间"}
          </p>
          <h3 className="mt-1.5 font-display text-[24px] font-bold leading-7">{room.title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
            statusBadgeTone(room.topic.status)
          )}
        >
          {runStatusLabel(room.topic.status)}
        </span>
      </div>
      <p className="mt-2.5 text-sm leading-6">{room.summary}</p>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <FactTile label="当前 Topic" value={room.topic.title} />
        <FactTile label="负责人" value={room.topic.owner} />
        <FactTile label="Run" value={run?.id ?? room.runId} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <FactTile label="任务卡" value={`${room.boardCount} 张`} />
        <FactTile label="未读" value={`${room.unread} 条`} />
        <FactTile label="分支" value={run?.branch ?? "待接入"} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/rooms/${room.id}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          打开讨论间
        </Link>
        {run ? (
          <Link
            href={`/runs/${run.id}`}
            className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            查看 Run
          </Link>
        ) : null}
        {issue ? (
          <Link
            href={`/issues/${issue.key}`}
            className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            查看 Issue
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}

function RunSnapshotCard({
  run,
  room,
  issue,
  session,
}: {
  run: Run;
  room?: Room;
  issue?: Issue;
  session?: Session;
}) {
  return (
    <Panel tone={panelToneForStatus(run.status)} className="!p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
            {run.issueKey} / {room?.title ?? run.roomId}
          </p>
          <h3 className="mt-1.5 font-display text-[24px] font-bold leading-7">{run.id}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
            statusBadgeTone(run.status)
          )}
        >
          {runStatusLabel(run.status)}
        </span>
      </div>
      <p className="mt-2.5 text-sm leading-6">{run.summary}</p>
      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <FactTile label="Runtime" value={run.runtime} />
        <FactTile label="Provider" value={run.provider} />
        <FactTile label="负责人" value={run.owner} />
        <FactTile label="时长" value={run.duration} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <FactTile label="分支" value={run.branch} />
        <FactTile label="Worktree" value={run.worktree} />
        <FactTile label="下一步" value={run.nextAction} />
      </div>
      {session ? (
        <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
          Resume context: {session.id} / {session.worktree}。{session.summary}
        </p>
      ) : null}
      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        {run.approvalRequired
          ? "这条 Run 当前需要人工批准后才能继续推进。"
          : `当前已绑定 ${issue?.pullRequest ?? run.pullRequest}，可继续沿着 Room / Run / PR 同步收口。`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/runs/${run.id}`}
          data-testid={`run-history-open-${run.id}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          打开 Run
        </Link>
        <Link
          href={`/rooms/${run.roomId}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          回到讨论间
        </Link>
        <Link
          href={`/issues/${run.issueKey}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          查看 Issue
        </Link>
      </div>
    </Panel>
  );
}

export function LiveIssuesListView() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <LiveStateNotice
        title="正在同步 Issue 真值"
        message="等待 server 返回当前 issue / room / run 绑定关系，前端不再先拿本地 seed issue 顶上。"
      />
    );
  }

  if (error) {
    return <LiveStateNotice title="Issue 同步失败" message={error} />;
  }

  if (state.issues.length === 0) {
    return (
      <LiveStateNotice
        title="当前还没有 Issue"
        message="当 server state 里出现第一条 issue 后，这里会直接展示 live issue surface。"
      />
    );
  }

  return <IssuesListView issues={state.issues} />;
}

export function LiveRoomsPageContent() {
  const { state, loading, error } = usePhaseZeroState();
  const rooms = loading || error ? [] : state.rooms;
  const issues = loading || error ? [] : state.issues;
  const runs = loading || error ? [] : state.runs;
  const activeRooms = rooms.filter((room) => room.topic.status === "running" || room.topic.status === "review").length;
  const blockedRooms = rooms.filter((room) => room.topic.status === "blocked" || room.topic.status === "paused").length;
  const unreadCount = rooms.reduce((total, room) => total + room.unread, 0);

  return (
    <OpenShockShell
      view="rooms"
      eyebrow="讨论间总览"
      title="严肃工作先进入讨论间"
      description="频道负责聊天和对齐，一旦开始谈 owner、branch、run、PR 或 blocker，就该进入讨论间收拢执行上下文。"
      contextTitle="Room 是协作主战场"
      contextDescription="Phase 0 先把每个严肃需求都绑定到一个讨论间、一个当前 Topic 和一个可追踪的 Run，让前端壳层能直接承载真实协作。"
      contextBody={
        <DetailRail
          label="讨论间基线"
          items={[
            { label: "总数", value: `${rooms.length} 个` },
            { label: "活跃中", value: `${activeRooms} 个` },
            { label: "阻塞", value: `${blockedRooms} 个` },
            { label: "未读", value: `${unreadCount} 条` },
          ]}
        />
      }
    >
      {loading ? (
        <LiveStateNotice
          title="正在同步讨论间真值"
          message="等待 server 返回最新的 room / run / issue 状态，前端不再先拿本地 seed 卡片顶上。"
        />
      ) : error ? (
        <LiveStateNotice title="讨论间同步失败" message={error} />
      ) : rooms.length === 0 ? (
        <LiveStateNotice title="当前还没有讨论间" message="等第一条 Issue 创建后，这里会直接显示 live room surface。" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rooms.map((room) => (
            <RoomSnapshotCard
              key={room.id}
              room={room}
              issue={issues.find((candidate) => candidate.roomId === room.id)}
              run={runs.find((candidate) => candidate.id === room.runId)}
            />
          ))}
        </div>
      )}
    </OpenShockShell>
  );
}

export function LiveAgentsPageContent() {
  const { state, loading, error } = usePhaseZeroState();
  const agents = loading || error ? [] : state.agents;
  const runs = loading || error ? [] : state.runs;
  const rooms = loading || error ? [] : state.rooms;
  const inbox = loading || error ? [] : state.inbox;
  const pullRequests = loading || error ? [] : state.pullRequests;
  const runtimes = loading || error ? [] : readRuntimeRegistry(state);
  const sessions = loading || error ? [] : state.sessions;
  const runtimeLeases = loading || error ? [] : state.runtimeLeases;
  const runtimeScheduler =
    loading || error
      ? {
          selectedRuntime: "",
          preferredRuntime: "",
          assignedRuntime: "",
          assignedMachine: "",
          strategy: "unavailable",
          summary: "",
          candidates: [],
        }
      : state.runtimeScheduler;

  return (
    <OpenShockShell
      view="agents"
      eyebrow="Agent 名录"
      title="把公民名录推进成 orchestration board"
      description="Agent 不只要可见，还要能把调度泳道、runtime 压力、人工闸门和 auto-merge 候选摆在同一个前台。"
      contextTitle="Agent Loop Surface"
      contextDescription="这页现在直接消费 live scheduler / runtime lease / failover truth，把 orchestration board 上的 next-lane 与人工 gate 收成同一个前台。"
      contextBody={
        <DetailRail
          label="调度基线"
          items={[
            { label: "总数", value: `${agents.length} 个` },
            { label: "执行中", value: `${agents.filter((agent) => agent.state === "running").length} 个` },
            { label: "阻塞", value: `${agents.filter((agent) => agent.state === "blocked").length} 个` },
            { label: "Session", value: `${sessions.length} 条` },
          ]}
        />
      }
    >
      {loading ? (
        <LiveStateNotice title="正在同步 Agent 真值" message="等待 server 返回当前公民名录与最近 Run。" />
      ) : error ? (
        <LiveStateNotice title="Agent 同步失败" message={error} />
      ) : agents.length === 0 ? (
        <LiveStateNotice title="当前还没有 Agent" message="当 server state 里出现公民记录后，这里会直接展示 live agent surface。" />
      ) : (
        <div className="space-y-4">
          <LiveOrchestrationBoard
            agents={agents}
            runs={runs}
            rooms={rooms}
            inbox={inbox}
            pullRequests={pullRequests}
            runtimes={runtimes}
            sessions={sessions}
            leases={runtimeLeases}
            scheduler={runtimeScheduler}
          />
          <AgentsListView agentsList={agents} />
        </div>
      )}
    </OpenShockShell>
  );
}

export function LiveAgentPageContent({ agentId }: { agentId: string }) {
  const { state, loading, error } = usePhaseZeroState();
  const agent = loading || error ? undefined : state.agents.find((candidate) => candidate.id === agentId);

  if (loading) {
    return (
      <OpenShockShell
        view="agents"
        eyebrow="Agent 详情"
        title="正在同步 Agent"
        description="等待 server 返回当前公民详情。"
        contextTitle="Agent Sync"
        contextDescription="这页现在只读 live state，不再回退到旧的本地 seed agent。"
      >
        <LiveStateNotice title="同步中" message="正在拉取 Agent 详情和最近 Run。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="agents"
        eyebrow="Agent 详情"
        title="Agent 同步失败"
        description="当前没拿到 server truth。"
        contextTitle="Agent Sync"
        contextDescription="先检查 server 是否在线，再重新打开这页。"
      >
        <LiveStateNotice title="同步失败" message={error} />
      </OpenShockShell>
    );
  }

  if (!agent) {
    return (
      <OpenShockShell
        view="agents"
        eyebrow="Agent 详情"
        title="未找到 Agent"
        description="这个 Agent 可能已经不在当前 server state 里。"
        contextTitle="Agent Sync"
        contextDescription="从公民名录重新进入通常就能拿到最新对象。"
      >
        <LiveStateNotice title="未找到 Agent" message={`当前找不到 \`${agentId}\` 对应的 live agent 记录。`} />
      </OpenShockShell>
    );
  }

  const runsForAgent = state.runs.filter((run) => agent.recentRunIds.includes(run.id));
  const relatedPullRequests = state.pullRequests.filter((pullRequest) =>
    runsForAgent.some((run) => run.id === pullRequest.runId)
  );
  const relatedHandoffs = state.mailbox.filter(
    (handoff) => handoff.fromAgentId === agent.id || handoff.toAgentId === agent.id
  );

  return (
    <OpenShockShell
      view="agents"
      eyebrow="Agent 详情"
      title={agent.name}
      description={agent.description}
      contextTitle={agent.lane}
      contextDescription="这是当前 server state 里这位公民真实绑定的泳道，不再沿用本地样例。"
      contextBody={
        <DetailRail
          label="绑定关系"
          items={[
            { label: "Provider", value: agent.providerPreference },
            { label: "Model", value: agent.modelPreference },
            { label: "Runtime", value: agent.runtimePreference },
            { label: "状态语气", value: agent.mood },
          ]}
        />
      }
    >
      <div className="space-y-4">
        <AgentControlSurface
          agent={agent}
          runsForAgent={runsForAgent}
          pullRequests={relatedPullRequests}
          inbox={state.inbox}
          runtimes={readRuntimeRegistry(state)}
        />
        <AgentMailboxPanel agentId={agent.id} handoffs={relatedHandoffs} />
        <AgentDetailView agent={agent} runsForAgent={runsForAgent} />
      </div>
    </OpenShockShell>
  );
}

export function LiveRunsPageContent() {
  const { state, loading, error } = usePhaseZeroState();
  const rooms = loading || error ? [] : state.rooms;
  const issues = loading || error ? [] : state.issues;
  const runs = loading || error ? [] : state.runs;
  const fallbackHistory = loading || error ? [] : buildRunHistoryEntries(state);
  const [historyPage, setHistoryPage] = useState<RunHistoryPage>({ items: [], totalCount: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const activeRuns = runs.filter((run) => run.status === "running" || run.status === "review").length;
  const blockedRuns = runs.filter((run) => run.status === "blocked" || run.status === "paused").length;
  const approvalRuns = runs.filter((run) => run.approvalRequired).length;

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);

    void readRunHistoryPage(3)
      .then((page) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setHistoryPage(page);
          setHistoryLoading(false);
        });
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setHistoryError(fetchError instanceof Error ? fetchError.message : "run history fetch failed");
        setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!historyPage.nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const nextPage = await readRunHistoryPage(3, historyPage.nextCursor);
      startTransition(() => {
        setHistoryPage((current) => ({
          items: [...current.items, ...nextPage.items],
          nextCursor: nextPage.nextCursor,
          totalCount: nextPage.totalCount,
        }));
      });
    } catch (fetchError) {
      setHistoryError(fetchError instanceof Error ? fetchError.message : "run history fetch failed");
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleHistory = historyPage.items.length > 0 ? historyPage.items : historyError ? fallbackHistory : [];

  return (
    <OpenShockShell
      view="runs"
      eyebrow="Run 总览"
      title="执行真相集中在 Run 面"
      description="Run 不是附属日志，而是前台第一等公民。runtime、branch、worktree、审批状态和下一步动作都要在这里直接可见。"
      contextTitle="Run 是执行收口面"
      contextDescription="Phase 0 先保证每个活跃 Topic 都能落到可见的 Run，再让 Room、Inbox 和 PR 围绕同一个执行真相协作。"
      contextBody={
        <DetailRail
          label="Run 基线"
          items={[
            { label: "总数", value: `${runs.length} 条` },
            { label: "活跃中", value: `${activeRuns} 条` },
            { label: "阻塞", value: `${blockedRuns} 条` },
            { label: "需批准", value: `${approvalRuns} 条` },
          ]}
        />
      }
    >
      {loading ? (
        <LiveStateNotice title="正在同步 Run 真值" message="等待 server 返回当前 run / room / issue 绑定关系。" />
      ) : error ? (
        <LiveStateNotice title="Run 同步失败" message={error} />
      ) : historyLoading && historyPage.items.length === 0 && !historyError ? (
        <LiveStateNotice title="正在分页拉取 Run History" message="先加载最新几条 run，再按需增量展开更早的历史。" />
      ) : visibleHistory.length === 0 ? (
        <LiveStateNotice title="当前还没有 Run" message="当 server state 里出现第一条 run 后，这里会直接显示 live run surface。" />
      ) : (
        <div className="grid gap-4">
          {historyError ? (
            <LiveStateNotice title="Run history fallback" message={historyError} />
          ) : null}
          {visibleHistory.map((entry) => (
            <RunSnapshotCard
              key={entry.run.id}
              run={entry.run}
              room={rooms.find((candidate) => candidate.id === entry.run.roomId) ?? entry.room}
              issue={issues.find((candidate) => candidate.key === entry.run.issueKey) ?? entry.issue}
              session={entry.session}
            />
          ))}
          {historyPage.nextCursor ? (
            <button
              type="button"
              data-testid="run-history-load-more"
              onClick={() => void handleLoadMore()}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              {loadingMore ? "Loading..." : "Load Older Runs"}
            </button>
          ) : null}
        </div>
      )}
    </OpenShockShell>
  );
}

export function LiveIssuePageContent({ issueKey }: { issueKey: string }) {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <OpenShockShell
        view="issues"
        eyebrow="Issue 详情"
        title="正在同步 Issue"
        description="等待 server 返回当前 issue 详情。"
        contextTitle="Issue Sync"
        contextDescription="这页现在只读 live state，不再回退到旧的本地 seed issue。"
      >
        <LiveStateNotice title="同步中" message="正在拉取 Issue 详情和对应的 room / run 关系。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="issues"
        eyebrow="Issue 详情"
        title="Issue 同步失败"
        description="当前没拿到 server truth。"
        contextTitle="Issue Sync"
        contextDescription="先检查 server 是否在线，再重新打开这页。"
      >
        <LiveStateNotice title="同步失败" message={error} />
      </OpenShockShell>
    );
  }

  const issue = state.issues.find((candidate) => candidate.key.toLowerCase() === issueKey.toLowerCase());

  if (!issue) {
    return (
      <OpenShockShell
        view="issues"
        eyebrow="Issue 详情"
        title="未找到需求"
        description="这个 Issue 可能已经被移除，或者本地状态还没有同步到前端。"
        contextTitle="State Sync"
        contextDescription="刷新一下本地服务或重新从任务板进入。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{issueKey}` 对应的 Issue。
        </div>
      </OpenShockShell>
    );
  }

  const run = state.runs.find((candidate) => candidate.id === issue.runId);
  const room = state.rooms.find((candidate) => candidate.id === issue.roomId);

  return (
    <OpenShockShell
      view="issues"
      eyebrow="Issue 详情"
      title={issue.key}
      description={issue.summary}
      selectedRoomId={issue.roomId}
      contextTitle={issue.owner}
      contextDescription="对用户来说，耐久对象仍然是 Issue，但真正谈执行、谈协商、谈闭环的地方已经变成讨论间。"
      contextBody={
        <DetailRail
          label="Issue 链接"
          items={[
            { label: "讨论间", value: room?.title ?? issue.roomId },
            { label: "Run", value: run?.id ?? issue.runId },
            { label: "PR", value: issue.pullRequest },
            { label: "优先级", value: priorityLabel(issue.priority) },
          ]}
        />
      }
    >
      <IssueDetailView issue={issue} run={run} roomTitle={room?.title} />
    </OpenShockShell>
  );
}

export function LiveRunPageContent({
  roomId,
  runId,
}: {
  roomId?: string;
  runId: string;
}) {
  const { state, loading, error, controlRun } = usePhaseZeroState();

  if (loading) {
    return (
      <OpenShockShell
        view="runs"
        eyebrow="Run 详情"
        title="正在同步 Run"
        description="等待 server 返回当前 run 详情。"
        selectedRoomId={roomId}
        contextTitle="Run Sync"
        contextDescription="这页现在只读 live state，不再回退到旧的本地 seed run。"
      >
        <LiveStateNotice title="同步中" message="正在拉取 Run 详情和对应的 room 关系。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="runs"
        eyebrow="Run 详情"
        title="Run 同步失败"
        description="当前没拿到 server truth。"
        selectedRoomId={roomId}
        contextTitle="Run Sync"
        contextDescription="先检查 server 是否在线，再重新打开这页。"
      >
        <LiveStateNotice title="同步失败" message={error} />
      </OpenShockShell>
    );
  }

  const run = state.runs.find((candidate) => candidate.id === runId && (!roomId || candidate.roomId === roomId));
  const room = state.rooms.find((candidate) => candidate.id === (roomId ?? run?.roomId));
  const session = state.sessions.find((candidate) => candidate.activeRunId === runId);
  const authSession = state.auth.session;
  const canControlRun = hasSessionPermission(authSession, "run.execute");
  const runControlStatus = permissionStatus(authSession, "run.execute");
  const runControlBoundary = permissionBoundaryCopy(authSession, "run.execute");

  if (!room || !run) {
    return (
      <OpenShockShell
        view="runs"
        eyebrow="Run 详情"
        title="未找到 Run"
        description="这个 Run 可能还没同步，或者对应房间已经变化。"
        selectedRoomId={roomId}
        contextTitle="Run Sync"
        contextDescription="从讨论间重新进入通常就能拿到最新状态。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{runId}` 的执行详情。
        </div>
      </OpenShockShell>
    );
  }

  const currentRun = run;
  const currentSession = session;
  const roomHistory = buildRunHistoryEntries(state, currentRun.roomId);

  async function handleRunControl(action: "stop" | "resume" | "follow_thread", note: string) {
    await controlRun(currentRun.id, { action, note });
  }

  return (
    <OpenShockShell
      view="runs"
      eyebrow="Run 详情"
      title={run.id}
      description="Run 详情就是执行真相面：runtime、分支、worktree、日志、工具调用、审批状态和收口目标都在这里。"
      selectedRoomId={room.id}
      contextTitle={run.issueKey}
      contextDescription="每个活跃 Topic 都应该产出一个可见 Run。人类需要在 30 秒内定位问题落点。"
      contextBody={
        <DetailRail
          label="执行泳道"
          items={[
            { label: "负责人", value: run.owner },
            { label: "Provider", value: run.provider },
            { label: "开始时间", value: run.startedAt },
            { label: "时长", value: run.duration },
          ]}
        />
      }
    >
      <div className="space-y-4">
        <RunControlSurface
          scope="run"
          run={currentRun}
          session={currentSession}
          canControl={canControlRun}
          controlStatus={runControlStatus}
          controlBoundary={runControlBoundary}
          onControl={handleRunControl}
        />
        <RunDetailView
          run={currentRun}
          statusTestId="run-detail-status"
          session={currentSession}
          history={roomHistory}
          guards={state.guards.filter((guard) => guard.runId === currentRun.id)}
        />
      </div>
    </OpenShockShell>
  );
}
