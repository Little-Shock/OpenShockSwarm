"use client";

import Link from "next/link";

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
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import {
  type AgentStatus,
  type Issue,
  type Room,
  type Run,
} from "@/lib/mock-data";

type PanelTone = "white" | "paper" | "yellow" | "lime" | "pink" | "ink";

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
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 max-w-2xl text-base leading-7 text-[color:rgba(24,20,14,0.76)]">{message}</p>
    </div>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold">{value}</p>
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
    <Panel tone={panelToneForStatus(room.topic.status)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
            {room.issueKey} / {issue ? priorityLabel(issue.priority) : "讨论间"}
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">{room.title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            statusBadgeTone(room.topic.status)
          )}
        >
          {runStatusLabel(room.topic.status)}
        </span>
      </div>
      <p className="mt-3 text-base leading-7">{room.summary}</p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile label="当前 Topic" value={room.topic.title} />
        <FactTile label="负责人" value={room.topic.owner} />
        <FactTile label="Run" value={run?.id ?? room.runId} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile label="任务卡" value={`${room.boardCount} 张`} />
        <FactTile label="未读" value={`${room.unread} 条`} />
        <FactTile label="分支" value={run?.branch ?? "待接入"} />
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href={`/rooms/${room.id}`}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          打开讨论间
        </Link>
        {run ? (
          <Link
            href={`/runs/${run.id}`}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            查看 Run
          </Link>
        ) : null}
        {issue ? (
          <Link
            href={`/issues/${issue.key}`}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
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
}: {
  run: Run;
  room?: Room;
  issue?: Issue;
}) {
  return (
    <Panel tone={panelToneForStatus(run.status)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
            {run.issueKey} / {room?.title ?? run.roomId}
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">{run.id}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            statusBadgeTone(run.status)
          )}
        >
          {runStatusLabel(run.status)}
        </span>
      </div>
      <p className="mt-3 text-base leading-7">{run.summary}</p>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <FactTile label="Runtime" value={run.runtime} />
        <FactTile label="Provider" value={run.provider} />
        <FactTile label="负责人" value={run.owner} />
        <FactTile label="时长" value={run.duration} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile label="分支" value={run.branch} />
        <FactTile label="Worktree" value={run.worktree} />
        <FactTile label="下一步" value={run.nextAction} />
      </div>
      <p className="mt-5 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        {run.approvalRequired
          ? "这条 Run 当前需要人工批准后才能继续推进。"
          : `当前已绑定 ${issue?.pullRequest ?? run.pullRequest}，可继续沿着 Room / Run / PR 同步收口。`}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href={`/runs/${run.id}`}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          打开 Run
        </Link>
        <Link
          href={`/rooms/${run.roomId}`}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          回到讨论间
        </Link>
        <Link
          href={`/issues/${run.issueKey}`}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
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
        message="等待 server 返回当前 issue / room / run 绑定关系，前端不再先拿本地 issue mock 顶上。"
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
          message="等待 server 返回最新的 room / run / issue 状态，前端不再先拿本地 mock 卡片顶上。"
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

export function LiveAgentsPageContent() {
  const { state, loading, error } = usePhaseZeroState();
  const agents = loading || error ? [] : state.agents;
  const runs = loading || error ? [] : state.runs;
  const rooms = loading || error ? [] : state.rooms;
  const inbox = loading || error ? [] : state.inbox;
  const pullRequests = loading || error ? [] : state.pullRequests;
  const runtimes = loading || error ? [] : readRuntimeRegistry(state);
  const sessions = loading || error ? [] : state.sessions;

  return (
    <OpenShockShell
      view="agents"
      eyebrow="Agent 名录"
      title="把公民名录推进成 orchestration board"
      description="Agent 不只要可见，还要能把调度泳道、runtime 压力、人工闸门和 auto-merge 候选摆在同一个前台。"
      contextTitle="Agent Loop Surface"
      contextDescription="这张票先把 orchestration board / agent control / auto-merge surface 收进 `/agents`，真正的 planner / lease / merge action 仍由 `#61/#62` 合同提供。"
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
        contextDescription="这页现在只读 live state，不再回退到本地 mock agent。"
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
            { label: "Provider", value: agent.provider },
            { label: "Runtime", value: agent.runtimePreference },
            { label: "状态语气", value: agent.mood },
            { label: "运行状态", value: agentStateLabel(agent.state) },
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
  const activeRuns = runs.filter((run) => run.status === "running" || run.status === "review").length;
  const blockedRuns = runs.filter((run) => run.status === "blocked" || run.status === "paused").length;
  const approvalRuns = runs.filter((run) => run.approvalRequired).length;

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
      ) : runs.length === 0 ? (
        <LiveStateNotice title="当前还没有 Run" message="当 server state 里出现第一条 run 后，这里会直接显示 live run surface。" />
      ) : (
        <div className="grid gap-4">
          {runs.map((run) => (
            <RunSnapshotCard
              key={run.id}
              run={run}
              room={rooms.find((candidate) => candidate.id === run.roomId)}
              issue={issues.find((candidate) => candidate.key === run.issueKey)}
            />
          ))}
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
        contextDescription="这页现在只读 live state，不再回退到本地 mock issue。"
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
        contextDescription="这页现在只读 live state，不再回退到本地 mock run。"
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
        <RunDetailView run={currentRun} statusTestId="run-detail-status" />
      </div>
    </OpenShockShell>
  );
}
