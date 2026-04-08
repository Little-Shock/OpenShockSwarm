import Link from "next/link";

import { Panel } from "@/components/phase-zero-views";
import type {
  AgentStatus,
  InboxItem,
  PullRequest,
  Room,
  Run,
  Session,
  RuntimeLeaseRecord,
  RuntimeScheduler,
} from "@/lib/mock-data";

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
  workspaceRoot?: string;
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
        runtime.id.includes(agent.runtimePreference) ||
        runtime.workspaceRoot?.includes(agent.runtimePreference)
    ) ?? null
  );
}

function autoMergeSummary(
  pullRequest: PullRequest,
  relatedInbox: InboxItem[]
) {
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
}) {
  const runningAgents = agents.filter((agent) => agent.state === "running");
  const blockedAgents = agents.filter((agent) => agent.state === "blocked");
  const idleAgents = agents.filter((agent) => agent.state === "idle");
  const busyRuntimes = runtimes.filter((runtime) => runtime.state === "busy");
  const activeLeases = leases.filter((lease) => runtimeLeaseIsActive(lease.status));
  const mergeCandidates = pullRequests.filter((pullRequest) => pullRequest.status !== "merged");
  const approvalGates = inbox.filter((item) => item.kind === "approval");
  const blockedGates = inbox.filter((item) => item.kind === "blocked");

  return (
    <div className="space-y-4">
      <Panel tone="yellow">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Orchestration Board</p>
        <h2 className="mt-3 font-display text-4xl font-bold">把公民、运行队列和 merge guard 收进同一个前台</h2>
        <p className="mt-3 max-w-4xl text-base leading-7">
          这层只消费当前 live `agents / runs / runtimes / leases / inbox / pullRequests / sessions` 真值，把调度态、failover、人工闸门和 auto-merge 候选摆清楚，不再回退到旧的 placeholder 注释窗口。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          <MetricTile label="Running Agents" value={String(runningAgents.length)} detail="当前正在占用调度泳道的公民数" />
          <MetricTile label="Blocked Agents" value={String(blockedAgents.length)} detail="等待人类决策或外部输入的公民数" />
          <MetricTile label="Busy Runtimes" value={String(busyRuntimes.length)} detail="当前被占用或处于压力态的 runtime 数" />
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
                  <SurfaceNotice title={`暂无${column.title}公民`} message="当前这一列还没有 live truth 命中，等 planner / assignment 合同接上后会继续扩。 " />
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
            <h3 className="mt-3 font-display text-3xl font-bold">调度队列</h3>
            <div className="mt-5 space-y-3">
              {sessions.length === 0 ? (
                <SurfaceNotice title="当前还没有 session queue truth" message="前台先把 queue 缺口明面化；真正 planner / assignment / run queue 继续由 `#61` 提供合同。" />
              ) : (
                sessions.map((session) => (
                  <Link
                    key={session.id}
                    href={`/runs/${session.activeRunId}`}
                    className="block rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">{session.id}</p>
                        <h4 className="mt-2 font-display text-2xl font-bold">{session.issueKey}</h4>
                      </div>
                      <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        {runStatusLabel(session.status)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6">{session.summary}</p>
                    <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                      runtime: {session.runtime} · branch: {session.branch} · memory paths: {session.memoryPaths.length}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>

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
            <SurfaceNotice title="当前没有待判断的 merge 候选" message="等 `#61` 的 planner / auto-merge guard 合同落下后，这里会把真实 merge queue 和策略结果接进来。" />
          ) : (
            mergeCandidates.map((pullRequest) => {
              const relatedInbox = resolveRelatedInbox([pullRequest.runId], [pullRequest.roomId], inbox);
              const summary = autoMergeSummary(pullRequest, relatedInbox);
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
                    <button
                      type="button"
                      disabled
                      className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)] opacity-70"
                    >
                      Auto-merge 待 #61/#62
                    </button>
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
