import Link from "next/link";

import { GovernanceEscalationGraph } from "@/components/governance-escalation-graph";
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
      return "进行中";
    case "ready":
      return "就绪";
    case "blocked":
      return "阻塞";
    case "done":
      return "完成";
    case "required":
      return "需要处理";
    case "watch":
      return "关注";
    case "draft":
      return "草稿";
    default:
      return "等待中";
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

function escalationQueueAgeLabel(entry: {
  elapsedMinutes: number;
  thresholdMinutes: number;
  timeLabel?: string;
}) {
  if (entry.elapsedMinutes > 0) {
    return `${entry.elapsedMinutes} / ${entry.thresholdMinutes} 分钟`;
  }
  if (entry.timeLabel?.trim()) {
    return entry.timeLabel;
  }
  return `${entry.thresholdMinutes} 分钟时限`;
}

function escalationRoomRollupSummary(entry: {
  escalationCount: number;
  blockedCount: number;
}) {
  const activeCount = Math.max(0, entry.escalationCount - entry.blockedCount);
  if (entry.blockedCount > 0 && activeCount > 0) {
    return `${entry.escalationCount} 项 · ${entry.blockedCount} 项阻塞 · ${activeCount} 项处理中`;
  }
  if (entry.blockedCount > 0) {
    return `${entry.escalationCount} 项 · ${entry.blockedCount} 项阻塞`;
  }
  return `${entry.escalationCount} 项 · 全部处理中`;
}

function plannerQueueStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "review":
      return "评审中";
    case "blocked":
      return "阻塞";
    case "paused":
      return "已暂停";
    case "done":
      return "完成";
    default:
      return "等待中";
  }
}

function plannerAutoMergeLabel(status: string) {
  switch (status) {
    case "ready":
      return "就绪";
    case "approval_required":
      return "需要审批";
    case "blocked":
      return "阻塞";
    case "merged":
      return "已合并";
    default:
      return "暂不可用";
  }
}

function runtimeStateLabel(state: string) {
  switch (state) {
    case "busy":
      return "忙碌";
    case "online":
      return "在线";
    case "offline":
      return "离线";
    default:
      return state || "待同步";
  }
}

function runtimePairingStateLabel(state: string) {
  switch (state) {
    case "paired":
      return "已配对";
    case "degraded":
      return "连接不稳定";
    case "pending":
      return "等待接入";
    case "unpaired":
      return "未配对";
    default:
      return state || "待同步";
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
      return "沿用已选机器";
    case "agent_preference":
      return "按智能体偏好";
    case "least_loaded":
      return "按当前占用";
    case "failover":
      return "自动切换";
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
          headline: "满足自动合并条件",
          detail: guard.reason,
          tone: "bg-[var(--shock-lime)]",
        };
      default:
        return {
          headline: "条件未就绪",
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
    headline: "等待人工确认",
    detail: "这里会先把自动合并条件和人工确认节点展示清楚，避免误以为已经自动完成。",
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">供应商 / 模型</p>
          <p className="mt-2 text-sm leading-6">{agent.providerPreference} / {agent.modelPreference}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">机器偏好</p>
          <p className="mt-2 text-sm leading-6">
            {agent.runtimePreference}
            {preferredRuntime
              ? ` · ${runtimeStateLabel(preferredRuntime.state)} / ${runtimePairingStateLabel(preferredRuntime.pairingState)}`
              : " · 未匹配到已连接机器"}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">最近执行</p>
        {recentRuns.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前还没有最近执行记录。</p>
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
          {relatedInbox.length} 条待处理节点
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
  const worktreeLabel = item.worktreePath?.trim() || "等待当前运行环境接入";

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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">分配情况</p>
          <p
            data-testid={`orchestration-planner-queue-owner-${item.sessionId}`}
            className="mt-2 text-sm leading-6"
          >
            {ownerLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            服务商：{item.provider || "待整理"} · 运行环境：{item.runtime || "待整理"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">接续信息</p>
          <p className="mt-2 text-sm leading-6">机器：{item.machine || "待整理"}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{worktreeLabel}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">前置检查</p>
            <span className="rounded-full border border-[var(--shock-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
              {item.gates.length} 条
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.gates.length === 0 ? (
              <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                当前无检查
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">自动合并门槛</p>
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
          查看执行
        </Link>
      </div>
    </article>
  );
}

function GovernanceReplaySurface({ governance }: { governance: WorkspaceGovernanceSnapshot }) {
  const escalationQueue = governance.escalationSla.queue ?? [];
  const escalationRollup = governance.escalationSla.rollup ?? [];

  return (
    <Panel tone="lime">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            协作回放
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">
            新事项从分工到交付的过程现在可以同页回看
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
          label="待交接"
          value={`${governance.stats.openHandoffs}`}
          detail="请求、接手、阻塞和完成会继续围绕同一条协作链路汇总。"
        />
        <MetricTile
          label="阻塞升级"
          value={`${governance.stats.blockedEscalations}`}
          detail="被卡住的升级会直接显示在这里，不再只藏在消息里。"
        />
        <MetricTile
          label="待评审"
          value={`${governance.stats.reviewGates}`}
          detail="评审结论会和调度队列、合并状态、消息中心一起同步。"
        />
        <MetricTile
          label="人工接管"
          value={`${governance.stats.humanOverrideGates}`}
          detail="人工接管数量会和当前协作里的升级、审批一起更新。"
        />
        <MetricTile
          label="超时事项"
          value={`${governance.stats.slaBreaches}`}
          detail="超时的协作事项会直接抬到治理快照里。"
        />
        <MetricTile
          label="汇总来源"
          value={`${governance.stats.aggregationSources}`}
          detail="最终回复到底汇总了多少路信息，这里会直接展示。"
        />
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Panel tone="paper" className="!p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  当前分工
                </p>
                <h4 className="mt-2 font-display text-2xl font-bold">团队分工直接贴当前协作状态</h4>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.teamTopology.length} 条分工
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
                  关键流程
                </p>
                <h4 className="mt-2 font-display text-2xl font-bold">
                  {"事项创建 -> 交接 -> 评审 -> 测试 -> 最终回复"}
                </h4>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.walkthrough.length} 步
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                      {governanceStatusLabel(step.status)}
                    </span>
                  </div>
                </Panel>
              ))}
            </div>
          </Panel>

          <Panel tone="white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  路由 / 升级 / 通知
                </p>
                <h4 className="mt-2 font-display text-2xl font-bold">协作规则和通知一页看清</h4>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.routingPolicy.defaultRoute || "等待路由"}
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
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">升级时限</p>
                  <p className="mt-2 font-display text-[22px] font-bold leading-7">
                    {governance.escalationSla.timeoutMinutes} 分钟 / {governance.escalationSla.retryBudget} 次重试
                  </p>
                  <p className="mt-2 text-sm leading-6">{governance.escalationSla.summary}</p>
                  {governance.escalationSla.nextEscalation ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                      下一次升级：{governance.escalationSla.nextEscalation}
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {escalationQueue.length === 0 ? (
                      <p className="text-sm leading-6 opacity-70">当前没有待升级事项。</p>
                    ) : (
                      escalationQueue.map((entry) => (
                        <div
                          key={entry.id}
                          data-testid={`orchestration-governance-escalation-entry-${entry.id}`}
                          className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-display text-lg font-semibold">{entry.label}</p>
                              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                {entry.source}
                                {entry.owner ? ` · ${entry.owner}` : ""} · {escalationQueueAgeLabel(entry)}
                              </p>
                            </div>
                            <span
                              data-testid={`orchestration-governance-escalation-status-${entry.id}`}
                              className={cn(
                                "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]",
                                governanceTone(entry.status) === "pink"
                                  ? "bg-[var(--shock-pink)] text-white"
                                  : governanceTone(entry.status) === "lime"
                                    ? "bg-[var(--shock-lime)]"
                                    : governanceTone(entry.status) === "yellow"
                                      ? "bg-[var(--shock-yellow)]"
                                      : "bg-white"
                              )}
                            >
                              {governanceStatusLabel(entry.status)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6">{entry.summary}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-4 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">跨讨论汇总</p>
                      <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                        {escalationRollup.length} 个讨论
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {escalationRollup.length > 0 ? (
                        escalationRollup.map((entry) => (
                          <div
                            key={entry.roomId}
                            data-testid={`orchestration-governance-escalation-rollup-room-${entry.roomId}`}
                            className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-display text-lg font-semibold">{entry.roomTitle}</p>
                                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                  {escalationRoomRollupSummary(entry)}
                                  {entry.latestSource ? ` · 最近来源 ${entry.latestSource}` : ""}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  data-testid={`orchestration-governance-escalation-rollup-status-${entry.roomId}`}
                                  className={cn(
                                    "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]",
                                    governanceTone(entry.status) === "pink"
                                      ? "bg-[var(--shock-pink)] text-white"
                                      : governanceTone(entry.status) === "lime"
                                        ? "bg-[var(--shock-lime)]"
                                        : governanceTone(entry.status) === "yellow"
                                          ? "bg-[var(--shock-yellow)]"
                                          : "bg-white"
                                  )}
                                >
                                  {governanceStatusLabel(entry.status)}
                                </span>
                                <span
                                  data-testid={`orchestration-governance-escalation-rollup-route-status-${entry.roomId}`}
                                  className={cn(
                                    "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]",
                                    governanceTone(entry.nextRouteStatus ?? "pending") === "pink"
                                      ? "bg-[var(--shock-pink)] text-white"
                                      : governanceTone(entry.nextRouteStatus ?? "pending") === "lime"
                                        ? "bg-[var(--shock-lime)]"
                                        : governanceTone(entry.nextRouteStatus ?? "pending") === "yellow"
                                          ? "bg-[var(--shock-yellow)]"
                                          : "bg-white"
                                  )}
                                >
                                  {governanceStatusLabel(entry.nextRouteStatus ?? "pending")}
                                </span>
                              </div>
                            </div>
                            {entry.latestLabel ? <p className="mt-2 font-display text-base font-semibold">{entry.latestLabel}</p> : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {entry.nextRouteHref ? (
                                <Link
                                  href={entry.nextRouteHref}
                                  className="inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                                >
                                  打开下一步
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        ))
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4">
                    <GovernanceEscalationGraph
                      entries={escalationRollup}
                      testIdPrefix="orchestration-governance-escalation"
                      compact
                    />
                  </div>
                </Panel>
                <Panel tone={governanceTone(governance.notificationPolicy.status)} className="!p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">通知策略</p>
                  <p className="mt-2 font-display text-[22px] font-bold leading-7">
                    {governance.notificationPolicy.browserPush || "等待通知策略"}
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
              人工接管
            </p>
            <p
              data-testid="orchestration-governance-human-override"
              className="mt-2 font-display text-2xl font-bold"
            >
              {governanceStatusLabel(governance.humanOverride.status)}
            </p>
            <p className="mt-3 text-sm leading-6">{governance.humanOverride.summary}</p>
          </Panel>

          <Panel tone={governanceTone(governance.responseAggregation.status)}>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              回复聚合
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
                聚合负责人：{governance.responseAggregation.aggregator}
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
            {(governance.responseAggregation.auditTrail ?? []).length > 0 ? (
              <div className="mt-4 space-y-2">
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
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">协作总览</p>
        <h2 className="mt-3 font-display text-4xl font-bold">把智能体协作、调度和合并状态放到一个面板里</h2>
        <p className="mt-3 max-w-4xl text-base leading-7">
          这里集中显示当前智能体、执行、运行环境、待处理事项和调度状态，方便快速判断哪里在推进、哪里需要人接手。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="执行中智能体" value={String(runningAgents.length)} detail="当前正在处理任务的智能体数量" />
          <MetricTile label="阻塞中的智能体" value={String(blockedAgents.length)} detail="等待人类决策或外部输入的智能体数量" />
          <MetricTile label="繁忙机器" value={String(busyRuntimes.length)} detail="当前正在被占用的运行环境数量" />
          <MetricTile label="调度队列" value={String(plannerQueue.length)} detail="等待分配或继续推进的事项数量" />
          <MetricTile label="活动会话" value={String(sessions.length)} detail="当前仍在占用上下文的会话数量" />
          <MetricTile label="有效占用" value={String(activeLeases.length)} detail="当前仍持有运行环境或工作树的会话数量" />
        </div>
        <div className="mt-4 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">调度摘要</p>
          <p className="mt-2 text-base leading-7">{scheduler.summary || "当前还没有可用的调度摘要。"}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            策略：{runtimeSchedulerStrategyLabel(scheduler.strategy)} · 下一分配：
            {" "}{scheduler.assignedMachine || scheduler.assignedRuntime || "未分配"} · 待处理合并：{mergeCandidates.length}
          </p>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">协作泳道</p>
              <h3 className="mt-3 font-display text-3xl font-bold">调度泳道</h3>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {agents.length} 位智能体
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
                    title={`暂无${column.title}智能体`}
                    message="当前这一列还没有对应数据；新的分配或交接一发生，就会直接显示在这里。"
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
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">运行环境压力</p>
            <h3 className="mt-3 font-display text-3xl font-bold">机器占用与切换压力</h3>
            <div className="mt-5 space-y-3">
              {runtimes.length === 0 ? (
                <SurfaceNotice title="当前还没有运行环境状态" message="等服务端返回机器列表后，这里会显示占用、切换和恢复情况。" />
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
                          {assigned
                            ? "下一优先机器"
                            : `${runtimeStateLabel(runtime.state)} / ${runtimePairingStateLabel(runtime.pairingState)}`}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6">
                        连接地址：{runtime.daemonUrl || "未上报"} · 服务商：{(runtime.providers ?? []).map((provider: RuntimeProviderRecord) => provider.label).join(" / ") || "未上报"}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                        当前占用：{runtimeLeaseCount} · 可调度：{candidate?.schedulable ? "是" : "否"} · 当前策略：
                        {runtimeSchedulerStrategyLabel(scheduler.strategy)}
                      </p>
                      {recovery?.summary ? (
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">{recovery.summary}</p>
                      ) : null}
                      {recovery?.note ? (
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">恢复建议：{recovery.note}</p>
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
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">调度队列</p>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-3xl font-bold">调度队列</h3>
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  这里会显示待分配、进行中、待评审的事项，以及负责人、前置检查和合并条件。
                </p>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {plannerQueue.length} 条事项
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {plannerLoading ? (
                <SurfaceNotice title="正在同步调度队列" message="正在拉取当前事项的分配与推进状态。" />
              ) : plannerError ? (
                <SurfaceNotice title="调度队列同步失败" message={plannerError} />
              ) : plannerQueue.length === 0 ? (
                <SurfaceNotice
                  title="当前没有待调度事项"
                  message="新事项一进入协作链路，这里就会直接出现对应的分配与推进状态。"
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
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">合并候选</p>
        <h3 className="mt-3 font-display text-3xl font-bold">自动合并条件与人工确认</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm leading-6 text-white/82">
          <p>待批准：{approvalGates.length}</p>
          <p>已阻塞：{blockedGates.length}</p>
          <p>待判断合并：{mergeCandidates.length}</p>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {mergeCandidates.length === 0 ? (
            <SurfaceNotice
              title="当前没有待判断的合并候选"
              message="一旦事项进入合并阶段，这里会同时显示自动合并条件和人工确认节点。"
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
                      查看执行
                    </Link>
                    <span
                      className={cn(
                        "rounded-2xl border-2 border-[var(--shock-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]",
                        plannerAutoMergeTone(plannerGuardByPullRequestId.get(pullRequest.id)?.status ?? "unavailable")
                      )}
                    >
                      合并条件：{plannerAutoMergeLabel(plannerGuardByPullRequestId.get(pullRequest.id)?.status ?? "unavailable")}
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
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">智能体控制</p>
        <h3 className="mt-3 font-display text-3xl font-bold">高风险动作先保持只读</h3>
        <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
          这里会先把调度、切换和恢复状态展示清楚，但暂停、改派和自动合并这类高风险动作仍保持只读，不伪造可点即生效的按钮。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            { label: "暂停调度", detail: "当前仍保持只读，避免伪造调度变更。" },
            { label: "切换运行环境", detail: "自动切换已经生效；手动改派仍留在后续。" },
            { label: "申请自动合并", detail: "合并门槛与高风险边界仍保留人工确认。" },
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
              <p className="mt-2 text-sm leading-6">当前没有命中这位智能体的待处理节点。</p>
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
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">相关 PR 与运行环境</p>
            <p className="mt-2 text-sm leading-6">
              运行环境：
              {runtime
                ? `${runtime.machine} · ${runtimeStateLabel(runtime.state)} / ${runtimePairingStateLabel(runtime.pairingState)}`
                : "当前没有匹配到运行环境"}
            </p>
            <div className="mt-3 space-y-2">
              {relatedPullRequests.length === 0 ? (
                <p className="text-sm leading-6">当前还没有这位智能体最近执行对应的 PR 记录。</p>
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
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">控制概览</p>
        <div className="mt-4 space-y-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">最近执行</p>
            <p className="mt-2 text-sm leading-6">{runsForAgent.length} 条</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">人工闸门</p>
            <p className="mt-2 text-sm leading-6">{relatedInbox.length} 条</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">合并候选</p>
            <p className="mt-2 text-sm leading-6">{relatedPullRequests.length} 条</p>
          </div>
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这位智能体当前的机器占用、人工确认和合并状态都已可见；高风险操作仍保持只读，避免误触。
          </p>
        </div>
      </Panel>
    </div>
  );
}
