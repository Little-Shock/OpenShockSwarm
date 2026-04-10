import Link from "next/link";

import { Panel } from "@/components/phase-zero-views";
import type {
  AgentStatus,
  InboxItem,
  PlannerAutoMergeGuard,
  PlannerQueueItem,
  PullRequest,
  Room,
  Run,
  RuntimeLeaseRecord,
  RuntimeScheduler,
  Session,
  WorkspaceGovernanceSnapshot,
} from "@/lib/phase-zero-types";

type RuntimeProviderRecord = {
  label: string;
};

export type RuntimeRegistryRecord = {
  id: string;
  machine: string;
  daemonUrl?: string;
  providers?: RuntimeProviderRecord[];
  state: string;
  pairingState: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function agentStateLabel(state: AgentStatus["state"]) {
  switch (state) {
    case "running":
      return "执行中";
    case "blocked":
      return "阻塞";
    default:
      return "待命";
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

function pullRequestStatusLabel(status: PullRequest["status"]) {
  switch (status) {
    case "draft":
      return "草稿";
    case "open":
      return "待评审";
    case "in_review":
      return "评审中";
    case "changes_requested":
      return "待修改";
    case "merged":
      return "已合并";
  }
}

function governanceStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "active";
    case "ready":
      return "ready";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "required":
      return "required";
    case "watch":
      return "watch";
    case "draft":
      return "draft";
    default:
      return "pending";
  }
}

function governanceTone(status: string): "lime" | "yellow" | "pink" | "paper" | "white" | "ink" {
  switch (status) {
    case "done":
      return "ink";
    case "blocked":
      return "pink";
    case "active":
    case "required":
      return "yellow";
    case "ready":
      return "lime";
    case "watch":
      return "paper";
    default:
      return "white";
  }
}

function plannerQueueStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "review":
      return "review";
    case "blocked":
      return "blocked";
    case "paused":
      return "paused";
    case "done":
      return "done";
    default:
      return "pending";
  }
}

function plannerAutoMergeLabel(status: string) {
  switch (status) {
    case "ready":
      return "ready";
    case "approval_required":
      return "approval required";
    case "blocked":
      return "blocked";
    case "merged":
      return "merged";
    default:
      return "unavailable";
  }
}

function runtimeTone(runtime: RuntimeRegistryRecord) {
  if (runtime.state === "busy") return "bg-[var(--shock-yellow)]";
  if (runtime.state === "offline" || runtime.pairingState === "degraded") return "bg-[var(--shock-pink)] text-white";
  if (runtime.pairingState === "paired") return "bg-[var(--shock-lime)]";
  return "bg-white";
}

function runtimeSchedulerStrategyLabel(strategy: string) {
  switch (strategy) {
    case "selected_runtime":
      return "沿用 Selection";
    case "agent_preference":
      return "按 Owner 偏好";
    case "least_loaded":
      return "按 Lease 压力";
    case "failover":
      return "自动 Failover";
    default:
      return "待调度";
  }
}

function runtimeLeaseIsActive(status?: string) {
  return Boolean(status && status.trim() && status !== "done");
}

function runtimeMatchesLease(runtime: RuntimeRegistryRecord, lease: RuntimeLeaseRecord) {
  return lease.runtime === runtime.id || lease.machine === runtime.machine;
}

function runtimeConflictRecovery(
  runtime: RuntimeRegistryRecord,
  leases: RuntimeLeaseRecord[],
  sessions: Session[]
) {
  const conflictLease =
    leases.find(
      (lease) =>
        runtimeMatchesLease(runtime, lease) &&
        lease.status === "blocked" &&
        (lease.summary?.includes("runtime lease 冲突") ?? false)
    ) ?? null;
  if (!conflictLease) {
    return null;
  }

  const conflictSession =
    sessions.find(
      (session) =>
        session.id === conflictLease.sessionId ||
        session.activeRunId === conflictLease.runId ||
        (session.status === "blocked" &&
          (session.runtime === conflictLease.runtime || session.machine === conflictLease.machine) &&
          session.summary === conflictLease.summary)
    ) ?? null;

  return {
    summary: conflictLease.summary?.trim() || "",
    note: conflictSession?.controlNote?.trim() || "",
  };
}

function agentTone(state: AgentStatus["state"]) {
  if (state === "running") return "bg-[var(--shock-yellow)]";
  if (state === "blocked") return "bg-[var(--shock-pink)] text-white";
  return "bg-white";
}

function runTone(status: Run["status"]) {
  if (status === "running") return "bg-[var(--shock-yellow)]";
  if (status === "paused") return "bg-[var(--shock-paper)]";
  if (status === "blocked") return "bg-[var(--shock-pink)] text-white";
  if (status === "review") return "bg-[var(--shock-lime)]";
  return "bg-white";
}

function plannerQueueTone(item: PlannerQueueItem) {
  if (item.autoMerge.status === "blocked" || item.status === "blocked") {
    return "bg-[var(--shock-pink)] text-white";
  }
  if (item.autoMerge.status === "ready" || item.status === "review") {
    return "bg-[var(--shock-lime)]";
  }
  if (item.autoMerge.status === "approval_required" || item.status === "running") {
    return "bg-[var(--shock-yellow)]";
  }
  if (item.status === "paused") {
    return "bg-[var(--shock-paper)]";
  }
  return "bg-white";
}

function plannerGateTone(kind: InboxItem["kind"]) {
  if (kind === "blocked") return "bg-[var(--shock-pink)] text-white";
  if (kind === "approval") return "bg-[var(--shock-yellow)]";
  if (kind === "review") return "bg-[var(--shock-lime)]";
  return "bg-white";
}

function plannerAutoMergeTone(status: string) {
  if (status === "blocked") return "bg-[var(--shock-pink)] text-white";
  if (status === "ready") return "bg-[var(--shock-lime)]";
  if (status === "approval_required") return "bg-[var(--shock-yellow)]";
  return "bg-white";
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{detail}</p>
    </div>
  );
}

function SurfaceNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[20px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-5 py-5">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </div>
  );
}

function resolveRelatedInbox(
  candidateRunIds: string[],
  candidateRoomIds: string[],
  inbox: InboxItem[]
) {
  return inbox.filter(
    (item) =>
      candidateRunIds.some((runId) => item.href.includes(runId)) ||
      candidateRoomIds.some((roomId) => item.href.includes(roomId))
  );
}

function resolveAgentRuntime(agent: AgentStatus, runtimes: RuntimeRegistryRecord[]) {
  return (
    runtimes.find(
      (runtime) =>
        runtime.machine === agent.runtimePreference ||
        runtime.id.includes(agent.runtimePreference)
    ) ?? null
  );
}

function autoMergeSummary(
  pullRequest: PullRequest,
  relatedInbox: InboxItem[],
  guard?: PlannerAutoMergeGuard | null
) {
  if (guard) {
    switch (guard.status) {
      case "merged":
        return {
          headline: "已合并",
          detail: guard.reason,
          tone: "bg-[var(--shock-lime)]",
        };
      case "blocked":
        return {
          headline: "阻塞中",
          detail: guard.reason,
          tone: "bg-[var(--shock-pink)] text-white",
        };
      case "approval_required":
        return {
          headline: "等待显式确认",
          detail: guard.reason,
          tone: "bg-[var(--shock-yellow)]",
        };
      case "ready":
        return {
          headline: "可进入 merge guard",
          detail: guard.reason,
          tone: "bg-[var(--shock-lime)]",
        };
      default:
        return {
          headline: "guard 未就绪",
          detail: guard.reason,
          tone: "bg-white",
        };
    }
  }

  if (pullRequest.status === "merged") {
    return {
      headline: "已合并",
      detail: "这条 PR 已经通过主链，当前不再挂自动合并闸门。",
      tone: "bg-[var(--shock-lime)]",
    };
  }

  const reviewGate = relatedInbox.find((item) => item.kind === "review");
  const approvalGate = relatedInbox.find((item) => item.kind === "approval");
  const blockedGate = relatedInbox.find((item) => item.kind === "blocked");

  if (blockedGate) {
    return {
      headline: "阻塞中",
      detail: blockedGate.title,
      tone: "bg-[var(--shock-pink)] text-white",
    };
  }

  if (approvalGate) {
    return {
      headline: "等待批准",
      detail: approvalGate.title,
      tone: "bg-[var(--shock-yellow)]",
    };
  }

  if (reviewGate) {
    return {
      headline: "等待人工决策",
      detail: reviewGate.title,
      tone: "bg-[var(--shock-yellow)]",
    };
  }

  if (pullRequest.status === "changes_requested") {
    return {
      headline: "待修复",
      detail: pullRequest.reviewSummary,
      tone: "bg-[var(--shock-pink)] text-white",
    };
  }

  return {
    headline: "等待人工合并门",
    detail: "前台先把 auto-merge 候选面与人工闸门摆明，不伪造实际 merge 控制。",
    tone: "bg-white",
  };
}

function AgentLaneCard({
  agent,
  runs,
  rooms,
  runtimes,
  inbox,
}: {
  agent: AgentStatus;
  runs: Run[];
  rooms: Room[];
  runtimes: RuntimeRegistryRecord[];
  inbox: InboxItem[];
}) {
  const recentRuns = runs.filter((run) => agent.recentRunIds.includes(run.id));
  const roomIds = recentRuns.map((run) => run.roomId);
  const relatedInbox = resolveRelatedInbox(agent.recentRunIds, roomIds, inbox);
  const preferredRuntime = resolveAgentRuntime(agent, runtimes);

  return (
    <article
      className={cn(
        "rounded-[22px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]",
        agentTone(agent.state)
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {agent.providerPreference} / {agent.modelPreference}
          </p>
          <h4 className="mt-2 font-display text-2xl font-bold">{agent.name}</h4>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shock-ink)]">
          {agentStateLabel(agent.state)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6">{agent.description}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">当前泳道</p>
          <p className="mt-2 text-sm leading-6">{agent.lane}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">Provider / Model</p>
          <p className="mt-2 text-sm leading-6">{agent.providerPreference} / {agent.modelPreference}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">Runtime 偏好</p>
          <p className="mt-2 text-sm leading-6">
            {agent.runtimePreference}
            {preferredRuntime ? ` · ${preferredRuntime.state}/${preferredRuntime.pairingState}` : " · 未命中 registry"}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">最近执行</p>
        {recentRuns.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有 recent run truth。</p>
        ) : (
          recentRuns.slice(0, 2).map((run) => {
            const room = rooms.find((candidate) => candidate.id === run.roomId);
            return (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className={cn(
                  "block rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
                  runTone(run.status)
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-display text-lg font-semibold">{run.id}</p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{runStatusLabel(run.status)}</span>
                </div>
                <p className="mt-2 text-sm leading-6">{room?.title ?? run.roomId}</p>
              </Link>
            );
          })
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {relatedInbox.length} orchestration gates
        </span>
        {agent.memorySpaces.map((space) => (
          <span
            key={space}
            className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            {space}
          </span>
        ))}
      </div>
    </article>
  );
}

function PlannerQueueCard({ item }: { item: PlannerQueueItem }) {
  const ownerLabel = item.agentName ? `${item.owner} · ${item.agentName}` : item.owner;
  const worktreeLabel = item.worktreePath?.trim() || "等待当前 runtime lane attach";

  return (
    <article
      data-testid={`orchestration-planner-queue-item-${item.sessionId}`}
      className={cn(
        "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]",
        plannerQueueTone(item)
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">{item.sessionId}</p>
          <h4 className="mt-2 font-display text-2xl font-bold">{item.issueKey}</h4>
        </div>
        <span
          data-testid={`orchestration-planner-queue-status-${item.sessionId}`}
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
        >
          {plannerQueueStatusLabel(item.status)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6">{item.summary}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">assignment</p>
          <p
            data-testid={`orchestration-planner-queue-owner-${item.sessionId}`}
            className="mt-2 text-sm leading-6"
          >
            {ownerLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            provider: {item.provider || "待整理 provider"} · runtime: {item.runtime || "待整理 runtime"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">lane continuity</p>
          <p className="mt-2 text-sm leading-6">machine: {item.machine || "待整理 machine"}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{worktreeLabel}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">planner gates</p>
            <span className="rounded-full border border-[var(--shock-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
              {item.gates.length} visible
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.gates.length === 0 ? (
              <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                no gate
              </span>
            ) : (
              item.gates.map((gate, index) => (
                <span
                  key={`${item.sessionId}-${gate.kind}-${index}`}
                  data-testid={`orchestration-planner-queue-gate-${item.sessionId}-${index}`}
                  className={cn(
                    "rounded-full border border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                    plannerGateTone(gate.kind)
                  )}
                >
                  {gate.kind}: {gate.title}
                </span>
              ))
            )}
          </div>
        </div>
        <div
          className={cn(
            "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
            plannerAutoMergeTone(item.autoMerge.status)
          )}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">auto-merge guard</p>
          <p
            data-testid={`orchestration-planner-queue-auto-merge-${item.sessionId}`}
            className="mt-2 font-display text-xl font-bold"
          >
            {plannerAutoMergeLabel(item.autoMerge.status)}
          </p>
          <p className="mt-2 text-sm leading-6 opacity-85">{item.autoMerge.reason}</p>
          {item.pullRequestLabel ? (
            <p className="mt-2 text-sm leading-6 opacity-85">
              {item.pullRequestLabel}
              {item.reviewDecision ? ` · ${item.reviewDecision}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href={`/rooms/${item.roomId}`}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
        >
          打开讨论间
        </Link>
        <Link
          href={`/runs/${item.runId}`}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
        >
          查看 Run
        </Link>
      </div>
    </article>
  );
}

function GovernanceReplaySurface({ governance }: { governance: WorkspaceGovernanceSnapshot }) {
  return (
    <Panel tone="lime">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            First-Instruction Replay
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">
            issue 创建后的 owner / reviewer / tester loop 现在同页可回放
          </h3>
          <p
            data-testid="orchestration-governance-summary"
            className="mt-3 max-w-4xl text-sm leading-6 text-[color:rgba(24,20,14,0.74)]"
          >
            {governance.summary}
          </p>
        </div>
        <span
          data-testid="orchestration-governance-template"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {governance.label}
        </span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricTile
          label="Open Handoffs"
          value={`${governance.stats.openHandoffs}`}
          detail="formal request / ack / block / complete 会继续围同一份 orchestration truth 聚合。"
        />
        <MetricTile
          label="Blocked Escalations"
          value={`${governance.stats.blockedEscalations}`}
          detail="blocked escalation 会直接抬到当前 page，不再只藏在 inbox 或 prompt 里。"
        />
        <MetricTile
          label="Review Gates"
          value={`${governance.stats.reviewGates}`}
          detail="review / exact-head verdict 继续和 planner queue、PR、mailbox 同步出现。"
        />
        <MetricTile
          label="Human Override"
          value={`${governance.stats.humanOverrideGates}`}
          detail="人工 override 数量会和当前 loop 的 escalation / approval truth 一起前滚。"
        />
        <MetricTile
          label="SLA Breaches"
          value={`${governance.stats.slaBreaches}`}
          detail="超时或 overdue 的多 Agent escalation 会直接抬到治理快照里。"
        />
        <MetricTile
          label="Aggregation Sources"
          value={`${governance.stats.aggregationSources}`}
          detail="最终响应当前到底吃了多少条 live source，不再只停在一段总结文案。"
        />
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Panel tone="paper" className="!p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  governed topology
                </p>
                <h4 className="mt-2 font-display text-2xl font-bold">team lanes 直接贴当前 loop 真值</h4>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.teamTopology.length} lanes
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {governance.teamTopology.map((lane) => (
                <Panel key={lane.id} tone={governanceTone(lane.status)} className="!p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{lane.role}</p>
                  <p
                    data-testid={`orchestration-governance-lane-${lane.id}`}
                    className="mt-2 font-display text-[22px] font-bold leading-7"
                  >
                    {lane.label}
                  </p>
                  <p className="mt-2 text-sm leading-6">{lane.summary}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                      {governanceStatusLabel(lane.status)}
                    </span>
                    {lane.defaultAgent ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{lane.defaultAgent}</span>
                    ) : null}
                  </div>
                </Panel>
              ))}
            </div>
          </Panel>

          <Panel tone="paper">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  governed replay
                </p>
                <h4 className="mt-2 font-display text-2xl font-bold">
                  {"issue -> handoff -> review -> test -> final response"}
                </h4>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.walkthrough.length} steps
              </span>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-5">
              {governance.walkthrough.map((step) => (
                <Panel key={step.id} tone={governanceTone(step.status)} className="!p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{step.label}</p>
                  <p
                    data-testid={`orchestration-governance-step-${step.id}`}
                    className="mt-2 font-display text-[22px] font-bold leading-7"
                  >
                    {step.summary}
                  </p>
                  <p className="mt-2 text-sm leading-6">{step.detail}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                      {governanceStatusLabel(step.status)}
                    </span>
                    {step.href ? (
                      <Link href={step.href} className="font-mono text-[10px] uppercase tracking-[0.16em] underline">
                        open
                      </Link>
                    ) : null}
                  </div>
                </Panel>
              ))}
            </div>
          </Panel>

          <Panel tone="white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  routing / escalation / notification
                </p>
                <h4 className="mt-2 font-display text-2xl font-bold">多 Agent policy 不再只存在脑补里</h4>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.routingPolicy.defaultRoute || "route pending"}
              </span>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3">
                {(governance.routingPolicy.rules ?? []).map((rule) => (
                  <div key={rule.id} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-lg font-semibold">
                        {rule.fromLane} {"->"} {rule.toLane}
                      </p>
                      <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                        {governanceStatusLabel(rule.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{rule.summary}</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{rule.policy}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <Panel tone={governanceTone(governance.escalationSla.status)} className="!p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">escalation sla</p>
                  <p className="mt-2 font-display text-[22px] font-bold leading-7">{governance.escalationSla.timeoutMinutes} min / {governance.escalationSla.retryBudget} retry</p>
                  <p className="mt-2 text-sm leading-6">{governance.escalationSla.summary}</p>
                  {governance.escalationSla.nextEscalation ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                      next: {governance.escalationSla.nextEscalation}
                    </p>
                  ) : null}
                </Panel>
                <Panel tone={governanceTone(governance.notificationPolicy.status)} className="!p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">notification policy</p>
                  <p className="mt-2 font-display text-[22px] font-bold leading-7">
                    {governance.notificationPolicy.browserPush || "browser push pending"}
                  </p>
                  <p className="mt-2 text-sm leading-6">{governance.notificationPolicy.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(governance.notificationPolicy.targets ?? []).map((target) => (
                      <span
                        key={target}
                        className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                      >
                        {target}
                      </span>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel tone={governanceTone(governance.humanOverride.status)}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              human override
            </p>
            <p
              data-testid="orchestration-governance-human-override"
              className="mt-2 font-display text-2xl font-bold"
            >
              {governanceStatusLabel(governance.humanOverride.status)}
            </p>
            <p className="mt-3 text-sm leading-6">{governance.humanOverride.summary}</p>
            {governance.humanOverride.href ? (
              <Link
                href={governance.humanOverride.href}
                className="mt-4 inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
              >
                打开 override lane
              </Link>
            ) : null}
          </Panel>

          <Panel tone={governanceTone(governance.responseAggregation.status)}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              response aggregation
            </p>
            <p
              data-testid="orchestration-governance-response-aggregation"
              className="mt-2 font-display text-2xl font-bold"
            >
              {governance.responseAggregation.finalResponse || "等待 closeout"}
            </p>
            <p className="mt-3 text-sm leading-6">{governance.responseAggregation.summary}</p>
            {governance.responseAggregation.aggregator ? (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                aggregator: {governance.responseAggregation.aggregator}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {(governance.responseAggregation.sources ?? []).map((source, index) => (
                <span
                  key={`${source}-${index}`}
                  className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                >
                  {source}
                </span>
              ))}
            </div>
            {(governance.responseAggregation.decisionPath ?? []).length > 0 ? (
              <div className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">decision path</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(governance.responseAggregation.decisionPath ?? []).map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {(governance.responseAggregation.overrideTrace ?? []).length > 0 ? (
              <div className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">override trace</p>
                <div className="mt-2 space-y-2">
                  {(governance.responseAggregation.overrideTrace ?? []).map((item, index) => (
                    <p key={`${item}-${index}`} className="text-sm leading-6">
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            {(governance.responseAggregation.auditTrail ?? []).length > 0 ? (
              <div className="mt-3 space-y-2">
                {(governance.responseAggregation.auditTrail ?? []).map((entry) => (
                  <div key={entry.id} className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-base font-semibold">{entry.label}</p>
                      <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                        {governanceStatusLabel(entry.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{entry.summary}</p>
                    {(entry.actor || entry.occurredAt) ? (
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                        {[entry.actor, entry.occurredAt].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              governance rules
            </p>
            <div className="mt-3 space-y-2">
              {governance.handoffRules.map((rule) => (
                <div
                  key={rule.id}
                  data-testid={`orchestration-governance-rule-${rule.id}`}
                  className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="font-display text-lg font-semibold">{rule.label}</p>
                    <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                      {governanceStatusLabel(rule.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6">{rule.summary}</p>
                  {rule.href ? (
                    <Link href={rule.href} className="mt-3 inline-flex font-mono text-[10px] uppercase tracking-[0.16em] underline">
                      open
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Panel>
  );
}

export function LiveOrchestrationBoard({
  agents,
  runs,
  rooms,
  inbox,
  pullRequests,
  runtimes,
  sessions,
  leases,
  scheduler,
  governance,
  plannerQueue,
  plannerLoading,
  plannerError,
}: {
  agents: AgentStatus[];
  runs: Run[];
  rooms: Room[];
  inbox: InboxItem[];
  pullRequests: PullRequest[];
  runtimes: RuntimeRegistryRecord[];
  sessions: Session[];
  leases: RuntimeLeaseRecord[];
  scheduler: RuntimeScheduler;
  governance: WorkspaceGovernanceSnapshot;
  plannerQueue: PlannerQueueItem[];
  plannerLoading: boolean;
  plannerError: string | null;
}) {
  const runningAgents = agents.filter((agent) => agent.state === "running");
  const blockedAgents = agents.filter((agent) => agent.state === "blocked");
  const idleAgents = agents.filter((agent) => agent.state === "idle");
  const busyRuntimes = runtimes.filter((runtime) => runtime.state === "busy");
  const activeLeases = leases.filter((lease) => runtimeLeaseIsActive(lease.status));
  const mergeCandidates = pullRequests.filter((pullRequest) => pullRequest.status !== "merged");
  const approvalGates = inbox.filter((item) => item.kind === "approval");
  const blockedGates = inbox.filter((item) => item.kind === "blocked");
  const plannerGuardByPullRequestId = new Map(
    plannerQueue
      .filter((item) => item.pullRequestId)
      .map((item) => [item.pullRequestId as string, item.autoMerge])
  );

  return (
    <div className="space-y-4">
      <Panel tone="yellow">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Orchestration Board</p>
        <h2 className="mt-3 font-display text-4xl font-bold">把 planner dispatch、治理回放和 merge guard 收进同一个前台</h2>
        <p className="mt-3 max-w-4xl text-base leading-7">
          这层直接拼当前 live `agents / runs / runtimes / leases / inbox / pullRequests / sessions / planner queue / governance`
          真值，让 issue 创建后的 assignment、blocked escalation、human override 和 final response 不再散落在不同页面。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="Running Agents" value={String(runningAgents.length)} detail="当前正在占用调度泳道的公民数" />
          <MetricTile label="Blocked Agents" value={String(blockedAgents.length)} detail="等待人类决策或外部输入的公民数" />
          <MetricTile label="Busy Runtimes" value={String(busyRuntimes.length)} detail="当前被占用或处于压力态的 runtime 数" />
          <MetricTile label="Planner Queue" value={String(plannerQueue.length)} detail="当前 `/v1/planner/queue` 公开的 dispatch item 数" />
          <MetricTile label="Active Sessions" value={String(sessions.length)} detail="当前控制面公开的 session / queue 对象数" />
          <MetricTile label="Active Leases" value={String(activeLeases.length)} detail="当前仍持有 worktree/runtime lane 的会话数" />
        </div>
        <div className="mt-4 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Scheduler Truth</p>
          <p className="mt-2 text-base leading-7">{scheduler.summary || "当前还没有 scheduler truth。"}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            strategy: {runtimeSchedulerStrategyLabel(scheduler.strategy)} · next lane:{" "}
            {scheduler.assignedMachine || scheduler.assignedRuntime || "未分配"} · merge candidates: {mergeCandidates.length}
          </p>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Planner Lanes</p>
              <h3 className="mt-3 font-display text-3xl font-bold">调度泳道</h3>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {agents.length} citizens visible
            </span>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            {[
              { title: "执行中", agents: runningAgents },
              { title: "待命", agents: idleAgents },
              { title: "阻塞", agents: blockedAgents },
            ].map((column) => (
              <section key={column.title} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-2xl font-bold">{column.title}</h4>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {column.agents.length}
                  </span>
                </div>
                {column.agents.length === 0 ? (
                  <SurfaceNotice
                    title={`暂无${column.title}公民`}
                    message="当前这一列还没有命中 live lane；一旦 planner queue 或 handoff 前滚，新的 owner / reviewer / tester 状态会直接在这里展开。"
                  />
                ) : (
                  column.agents.map((agent) => (
                    <AgentLaneCard
                      key={agent.id}
                      agent={agent}
                      runs={runs}
                      rooms={rooms}
                      runtimes={runtimes}
                      inbox={inbox}
                    />
                  ))
                )}
              </section>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel tone="lime">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Runtime Lease Surface</p>
            <h3 className="mt-3 font-display text-3xl font-bold">runtime / lease 压力</h3>
            <div className="mt-5 space-y-3">
              {runtimes.length === 0 ? (
                <SurfaceNotice title="当前没有 runtime truth" message="等 server 返回 runtime registry 后，这里会继续展开 lease 与 failover 真值。" />
              ) : (
                runtimes.map((runtime) => {
                  const candidate =
                    scheduler.candidates.find((item) => item.runtime === runtime.id || item.machine === runtime.machine) ?? null;
                  const runtimeLeaseCount = activeLeases.filter(
                    (lease) => lease.runtime === runtime.id || lease.machine === runtime.machine
                  ).length;
                  const recovery = runtimeConflictRecovery(runtime, activeLeases, sessions);
                  const assigned = runtime.machine === scheduler.assignedMachine || runtime.id === scheduler.assignedRuntime;
                  return (
                    <article
                      key={runtime.id}
                      className={cn(
                        "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]",
                        assigned ? "bg-[var(--shock-lime)]" : runtimeTone(runtime)
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                            {runtime.id}
                          </p>
                          <h4 className="mt-2 font-display text-2xl font-bold">{runtime.machine}</h4>
                        </div>
                        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shock-ink)]">
                          {assigned ? "next lane" : `${runtime.state} / ${runtime.pairingState}`}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6">
                        daemon: {runtime.daemonUrl || "未上报"} · providers: {(runtime.providers ?? []).map((provider: RuntimeProviderRecord) => provider.label).join(" / ") || "未上报"}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                        active lease: {runtimeLeaseCount} · schedulable: {candidate?.schedulable ? "yes" : "no"} · strategy:{" "}
                        {runtimeSchedulerStrategyLabel(scheduler.strategy)}
                      </p>
                      {recovery?.summary ? (
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">{recovery.summary}</p>
                      ) : null}
                      {recovery?.note ? (
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">recovery: {recovery.note}</p>
                      ) : null}
                      {candidate?.reason ? (
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{candidate.reason}</p>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Planner Queue</p>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-3xl font-bold">调度队列</h3>
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  这里直接读 `/v1/planner/queue`，把 issue 创建后的 assignment、gate、review decision 和 auto-merge guard 摆成当前可见 truth。
                </p>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {plannerQueue.length} items
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {plannerLoading ? (
                <SurfaceNotice title="正在同步 planner queue" message="等待 `/v1/planner/queue` 返回当前 dispatch visible truth。" />
              ) : plannerError ? (
                <SurfaceNotice title="planner queue 同步失败" message={plannerError} />
              ) : plannerQueue.length === 0 ? (
                <SurfaceNotice
                  title="当前 planner queue 为空"
                  message="新 issue 一旦进入 session / assignment 主链，这里会直接出现当前 dispatch item，而不是退回静态说明。"
                />
              ) : (
                plannerQueue.map((item) => <PlannerQueueCard key={item.sessionId} item={item} />)
              )}
            </div>
          </Panel>
        </div>
      </div>

      <GovernanceReplaySurface governance={governance} />

      <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Auto-merge Guard</p>
        <h3 className="mt-3 font-display text-3xl font-bold">auto-merge 候选与人工闸门</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm leading-6 text-white/82">
          <p>approval gates: {approvalGates.length}</p>
          <p>blocked gates: {blockedGates.length}</p>
          <p>open review candidates: {mergeCandidates.length}</p>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {mergeCandidates.length === 0 ? (
            <SurfaceNotice
              title="当前没有待判断的 merge 候选"
              message="一旦 planner queue 命中 PR，这里会直接把 exact-head merge guard 与人工 gate 拼到同一块前台。"
            />
          ) : (
            mergeCandidates.map((pullRequest) => {
              const relatedInbox = resolveRelatedInbox([pullRequest.runId], [pullRequest.roomId], inbox);
              const summary = autoMergeSummary(
                pullRequest,
                relatedInbox,
                plannerGuardByPullRequestId.get(pullRequest.id)
              );
              return (
                <article
                  key={pullRequest.id}
                  className={cn(
                    "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-yellow)]",
                    summary.tone
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{pullRequest.label}</p>
                      <h4 className="mt-2 font-display text-2xl font-bold">{pullRequest.title}</h4>
                    </div>
                    <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--shock-ink)]">
                      {pullRequestStatusLabel(pullRequest.status)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6">{summary.headline}</p>
                  <p className="mt-2 text-sm leading-6 opacity-85">{summary.detail}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={`/runs/${pullRequest.runId}`}
                      className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
                    >
                      查看 Run
                    </Link>
                    <span
                      className={cn(
                        "rounded-2xl border-2 border-[var(--shock-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]",
                        plannerAutoMergeTone(plannerGuardByPullRequestId.get(pullRequest.id)?.status ?? "unavailable")
                      )}
                    >
                      guard: {plannerAutoMergeLabel(plannerGuardByPullRequestId.get(pullRequest.id)?.status ?? "unavailable")}
                    </span>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

export function AgentControlSurface({
  agent,
  runsForAgent,
  pullRequests,
  inbox,
  runtimes,
}: {
  agent: AgentStatus;
  runsForAgent: Run[];
  pullRequests: PullRequest[];
  inbox: InboxItem[];
  runtimes: RuntimeRegistryRecord[];
}) {
  const relatedRoomIds = runsForAgent.map((run) => run.roomId);
  const relatedInbox = resolveRelatedInbox(
    runsForAgent.map((run) => run.id),
    relatedRoomIds,
    inbox
  );
  const relatedPullRequests = pullRequests.filter((pullRequest) => runsForAgent.some((run) => run.id === pullRequest.runId));
  const runtime = resolveAgentRuntime(agent, runtimes);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel tone="paper">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Agent Control Surface</p>
        <h3 className="mt-3 font-display text-3xl font-bold">控制按钮先显式 fail-closed</h3>
        <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
          前台先把 scheduler / failover truth 摆出来，但真正的 pause / reassign / auto-merge action 仍继续保持 fail-closed；这里不伪造可点就生效的按钮。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            { label: "暂停调度", detail: "当前仍保持 fail-closed，避免伪造 planner mutation" },
            { label: "切换 runtime", detail: "自动 scheduler / failover 已 live；手动 override 继续留后续" },
            { label: "申请 auto-merge", detail: "merge guard 与 destructive boundary 继续留人工 gate" },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              disabled
              className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 text-left opacity-70"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{action.label}</p>
              <p className="mt-2 text-sm leading-6">{action.detail}</p>
            </button>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">当前人工闸门</p>
            {relatedInbox.length === 0 ? (
              <p className="mt-2 text-sm leading-6">当前没有命中这位公民的 inbox gate。</p>
            ) : (
              <div className="mt-3 space-y-2">
                {relatedInbox.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="block rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3"
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{item.kind}</p>
                    <p className="mt-2 text-sm leading-6">{item.title}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">相关 PR / runtime</p>
            <p className="mt-2 text-sm leading-6">
              runtime: {runtime ? `${runtime.machine} · ${runtime.state}/${runtime.pairingState}` : "当前未命中 runtime registry"}
            </p>
            <div className="mt-3 space-y-2">
              {relatedPullRequests.length === 0 ? (
                <p className="text-sm leading-6">当前还没有命中这位公民最近 run 的 PR truth。</p>
              ) : (
                relatedPullRequests.map((pullRequest) => (
                  <Link
                    key={pullRequest.id}
                    href={`/runs/${pullRequest.runId}`}
                    className="block rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3"
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{pullRequest.label}</p>
                    <p className="mt-2 text-sm leading-6">
                      {pullRequestStatusLabel(pullRequest.status)} · {pullRequest.reviewSummary}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel tone="lime">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Control Readiness</p>
        <div className="mt-4 space-y-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">最近 Run</p>
            <p className="mt-2 text-sm leading-6">{runsForAgent.length} 条</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">人工闸门</p>
            <p className="mt-2 text-sm leading-6">{relatedInbox.length} 条</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Auto-merge 候选</p>
            <p className="mt-2 text-sm leading-6">{relatedPullRequests.length} 条</p>
          </div>
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这位公民当前的 runtime / lease / merge gate 都已可见，但动作入口仍保持 fail-closed，避免把后续手动 override / merge 权限借写成已完成。
          </p>
        </div>
      </Panel>
    </div>
  );
}
