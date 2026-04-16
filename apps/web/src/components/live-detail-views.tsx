"use client";

import Link from "next/link";
import { startTransition, useEffect, useState, type FormEvent } from "react";

import { OpenShockShell } from "@/components/open-shock-shell";
import {
  AgentControlSurface,
  LiveOrchestrationBoard,
  type RuntimeRegistryRecord,
} from "@/components/live-orchestration-views";
import { RunSandboxSurface } from "@/components/run-sandbox-surface";
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
import { buildRunHistoryEntries, sanitizePlannerQueue, sanitizeRunDetail, sanitizeRunHistoryPage } from "@/lib/phase-zero-helpers";
import { resolveLiveRunDetail } from "@/lib/run-detail-view-model";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import type {
  AgentHandoff,
  CredentialProfile,
  Issue,
  Message,
  PlannerQueueItem,
  Room,
  Run,
  RunDetail,
  RunHistoryPage,
  Session,
} from "@/lib/phase-zero-types";

type PanelTone = "white" | "paper" | "yellow" | "lime" | "pink" | "ink";
const CONTROL_API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

function requestErrorMessage(status: number, fallback?: string) {
  return fallback && fallback.trim() ? fallback : `读取失败，请稍后重试。状态码 ${status}`;
}

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

function findRunAgent(state: ReturnType<typeof usePhaseZeroState>["state"], run: Run) {
  return state.agents.find((agent) => agent.name === run.owner || agent.id === run.owner || agent.recentRunIds.includes(run.id)) ?? null;
}

function effectiveCredentialProfiles(state: ReturnType<typeof usePhaseZeroState>["state"], run: Run) {
  const agent = findRunAgent(state, run);
  const seen = new Set<string>();
  const profiles: CredentialProfile[] = [];
  const allIDs = [
    ...state.credentials.filter((profile) => profile.workspaceDefault).map((profile) => profile.id),
    ...(agent?.credentialProfileIds ?? []),
    ...(run.credentialProfileIds ?? []),
  ];
  for (const profileID of allIDs) {
    if (seen.has(profileID)) {
      continue;
    }
    seen.add(profileID);
    const profile = state.credentials.find((candidate) => candidate.id === profileID);
    if (profile) {
      profiles.push(profile);
    }
  }
  return { agent, profiles };
}

function formatCredentialTimestamp(value?: string) {
  if (!value) {
    return "尚未发生";
  }
  return value;
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
    throw new Error(requestErrorMessage(response.status, payload.error));
  }
  return sanitizeRunHistoryPage(payload);
}

async function readPlannerQueue() {
  const response = await fetch(`${CONTROL_API_BASE}/v1/planner/queue`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as PlannerQueueItem[] | { error?: string };
  if (!response.ok) {
    const message = Array.isArray(payload) ? undefined : payload.error;
    throw new Error(requestErrorMessage(response.status, message));
  }
  return sanitizePlannerQueue(Array.isArray(payload) ? payload : []);
}

async function readRunDetail(runId: string) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/detail`, {
    cache: "no-store",
  });
  if (response.status === 404) {
    return null;
  }
  const payload = (await response.json()) as RunDetail & { error?: string };
  if (!response.ok) {
    throw new Error(requestErrorMessage(response.status, payload.error));
  }
  return sanitizeRunDetail(payload);
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
      return "已接手";
    case "blocked":
      return "阻塞";
    case "completed":
      return "已完成";
    default:
      return "待接手";
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
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">交接记录</p>
          <h3 className="mt-2 font-display text-2xl font-bold">
            {handoffs.length} 条交接任务
          </h3>
        </div>
        <Link
          href={`/mailbox?agentId=${agentId}`}
          className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          打开交接箱
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {handoffs.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            当前还没有需要这位智能体继续跟进的交接任务。后续一有新交接，这里会直接显示。
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

function RunCredentialScopePanel({
  state,
  run,
  canEdit,
  onUpdate,
}: {
  state: ReturnType<typeof usePhaseZeroState>["state"];
  run: Run;
  canEdit: boolean;
  onUpdate: (runId: string, input: { credentialProfileIds: string[] }) => Promise<unknown>;
}) {
  const { agent, profiles } = effectiveCredentialProfiles(state, run);
  const [draft, setDraft] = useState<string[]>(run.credentialProfileIds ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDraft(run.credentialProfileIds ?? []);
  }, [run.credentialProfileIds]);

  function toggle(profileID: string) {
    setDraft((current) => (current.includes(profileID) ? current.filter((item) => item !== profileID) : [...current, profileID]));
  }

  async function handleSave() {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await onUpdate(run.id, { credentialProfileIds: draft });
      setSuccess("本次执行的凭据绑定已保存。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "执行凭据绑定保存失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-lime)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">执行凭据</p>
          <h3 className="mt-2 font-display text-3xl font-bold">当前执行可用的凭据</h3>
        </div>
        <span
          data-testid="run-credential-effective-count"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {profiles.length} 条生效
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">智能体</p>
          <p className="mt-2 font-display text-xl font-semibold">{agent?.name ?? "未匹配到智能体"}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">工作区默认</p>
          <p className="mt-2 font-display text-xl font-semibold">{state.credentials.filter((profile) => profile.workspaceDefault).length}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">智能体已绑定</p>
          <p className="mt-2 font-display text-xl font-semibold">{agent?.credentialProfileIds?.length ?? 0}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">本次执行已绑定</p>
          <p className="mt-2 font-display text-xl font-semibold">{run.credentialProfileIds?.length ?? 0}</p>
        </div>
      </div>

      <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">当前生效</p>
        <div data-testid="run-credential-effective-labels" className="mt-3 flex flex-wrap gap-2">
          {profiles.length === 0 ? (
            <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前执行还没有命中任何凭据范围。</span>
          ) : (
            profiles.map((profile) => (
              <span key={profile.id} className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                {profile.label}
              </span>
            ))
          )}
        </div>
        <p data-testid="run-credential-audit" className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
          最近一次使用：
          {profiles.find((profile) => profile.lastUsedAt)?.lastUsedAt
            ? `${profiles.find((profile) => profile.lastUsedAt)?.lastUsedBy ?? "系统"} @ ${formatCredentialTimestamp(profiles.find((profile) => profile.lastUsedAt)?.lastUsedAt)}`
            : " 尚未记录"}
        </p>
      </div>

      <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">本次覆盖</p>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
            {canEdit ? "可修改" : "只读"}
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {state.credentials.map((profile) => (
            <label key={profile.id} className="flex items-start gap-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
              <input
                data-testid={`run-credential-binding-${profile.id}`}
                type="checkbox"
                checked={draft.includes(profile.id)}
                onChange={() => toggle(profile.id)}
                disabled={!canEdit || pending}
              />
              <span>
                <span className="block font-semibold">{profile.label}</span>
                <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
                  {profile.secretKind} · {profile.workspaceDefault ? "工作区默认" : "可选覆盖"}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="run-credential-save"
            onClick={() => void handleSave()}
            disabled={!canEdit || pending}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "写回中..." : "保存本次执行绑定"}
          </button>
          {success ? <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{success}</span> : null}
          {error ? <span className="text-sm leading-6 text-[color:rgba(163,37,28,0.92)]">{error}</span> : null}
        </div>
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
        <FactTile label="当前话题" value={room.topic.title} />
        <FactTile label="负责人" value={room.topic.owner} />
        <FactTile label="当前执行" value={run?.id ?? room.runId} />
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
        <Link
          href={`/topics/${room.topic.id}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          查看话题
        </Link>
        {run ? (
          <Link
            href={`/runs/${run.id}`}
            className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            查看执行
          </Link>
        ) : null}
        {issue ? (
          <Link
            href={`/issues/${issue.key}`}
            className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            查看事项
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
        <FactTile label="运行环境" value={run.runtime} />
        <FactTile label="服务商" value={run.provider} />
        <FactTile label="负责人" value={run.owner} />
        <FactTile label="时长" value={run.duration} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <FactTile label="分支" value={run.branch} />
        <FactTile label="工作树" value={run.worktree} />
        <FactTile label="下一步" value={run.nextAction} />
      </div>
      {session ? (
        <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
          当前会话：{session.id} / {session.worktree}。{session.summary}
        </p>
      ) : null}
      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        {run.approvalRequired
          ? "这条执行当前需要人工批准后才能继续推进。"
          : `当前已关联 ${issue?.pullRequest ?? run.pullRequest}，可以继续处理。`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/runs/${run.id}`}
          data-testid={`run-history-open-${run.id}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          打开执行详情
        </Link>
        <Link
          href={`/topics/${run.topicId}`}
          className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          查看话题
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
          查看事项
        </Link>
      </div>
    </Panel>
  );
}

function messageRoleLabel(role: Message["role"]) {
  switch (role) {
    case "human":
      return "成员";
    case "agent":
      return "智能体";
    default:
      return "系统";
  }
}

function messageRoleTone(role: Message["role"]) {
  switch (role) {
    case "human":
      return "bg-[var(--shock-yellow)]";
    case "agent":
      return "bg-[var(--shock-cyan)]";
    default:
      return "bg-white";
  }
}

function TopicGuidanceEntry({ message }: { message: Message }) {
  return (
    <article className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]",
            messageRoleTone(message.role)
          )}
        >
          {messageRoleLabel(message.role)}
        </span>
        <span className="font-display text-sm font-semibold">{message.speaker}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {message.time}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">{message.message}</p>
    </article>
  );
}

export function LiveIssuesListView() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <LiveStateNotice
        title="正在载入事项"
        message="正在获取事项、讨论间和执行记录。"
      />
    );
  }

  if (error) {
    return <LiveStateNotice title="Issue 同步失败" message={error} />;
  }

  if (state.issues.length === 0) {
    return (
      <LiveStateNotice title="当前还没有事项" message="创建第一条事项后，这里会显示对应内容。" />
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
      title="所有讨论间"
      description="这里查看当前讨论间、对应事项和执行状态。"
      contextTitle="讨论间概览"
      contextDescription="每个讨论间都会关联事项和执行记录，方便直接继续处理。"
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
          title="正在载入讨论间"
          message="正在获取讨论间、事项和执行状态。"
        />
      ) : error ? (
        <LiveStateNotice title="讨论间同步失败" message={error} />
      ) : rooms.length === 0 ? (
        <LiveStateNotice title="当前还没有讨论间" message="创建第一条事项后，这里会显示对应讨论间。" />
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
  const plannerRefreshKey =
    loading || error
      ? ""
      : [
          state.sessions.map((item) => `${item.id}:${item.status}:${item.updatedAt}`).join("|"),
          state.pullRequests.map((item) => `${item.id}:${item.status}:${item.reviewDecision ?? ""}:${item.updatedAt}`).join("|"),
          state.mailbox.map((item) => `${item.id}:${item.status}:${item.updatedAt}`).join("|"),
          state.inbox.map((item) => `${item.id}:${item.kind}:${item.title}:${item.summary}`).join("|"),
        ].join("::");
  const [plannerQueue, setPlannerQueue] = useState<PlannerQueueItem[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(true);
  const [plannerError, setPlannerError] = useState<string | null>(null);
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

  useEffect(() => {
    if (loading || error) {
      return;
    }

    let cancelled = false;

    void readPlannerQueue()
      .then((queue) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPlannerQueue(queue);
          setPlannerError(null);
          setPlannerLoading(false);
        });
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setPlannerError(fetchError instanceof Error ? fetchError.message : "调度队列读取失败");
        setPlannerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [error, loading, plannerRefreshKey]);

  return (
    <OpenShockShell
      view="agents"
      eyebrow="智能体"
      title="所有智能体"
      description="这里查看智能体当前状态、最近执行和所用运行环境。"
      contextTitle="智能体概览"
      contextDescription="可以在这里快速了解当前有哪些智能体正在运行、阻塞或空闲。"
      contextBody={
        <DetailRail
          label="调度基线"
          items={[
            { label: "总数", value: `${agents.length} 个` },
            { label: "执行中", value: `${agents.filter((agent) => agent.state === "running").length} 个` },
            { label: "阻塞", value: `${agents.filter((agent) => agent.state === "blocked").length} 个` },
            { label: "会话", value: `${sessions.length} 条` },
          ]}
        />
      }
    >
      {loading ? (
        <LiveStateNotice title="正在载入智能体" message="正在获取智能体列表和最近执行记录。" />
      ) : error ? (
        <LiveStateNotice title="智能体载入失败" message={error} />
      ) : agents.length === 0 ? (
        <LiveStateNotice title="当前还没有智能体" message="创建智能体后，这里会显示对应内容。" />
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
            governance={state.workspace.governance}
            plannerQueue={plannerQueue}
            plannerLoading={plannerLoading}
            plannerError={plannerError}
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
        eyebrow="智能体详情"
        title="正在载入智能体"
        description="正在获取当前智能体详情。"
        contextTitle="智能体详情"
        contextDescription="请稍候，页面正在同步最新信息。"
      >
        <LiveStateNotice title="载入中" message="正在获取智能体详情和最近执行记录。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="agents"
        eyebrow="智能体详情"
        title="智能体载入失败"
        description="暂时无法获取当前智能体详情。"
        contextTitle="智能体详情"
        contextDescription="请检查服务是否正常，然后重试。"
      >
        <LiveStateNotice title="载入失败" message={error} />
      </OpenShockShell>
    );
  }

  if (!agent) {
    return (
      <OpenShockShell
        view="agents"
        eyebrow="智能体详情"
        title="未找到智能体"
        description="这个智能体可能已被删除，或当前数据尚未更新。"
        contextTitle="智能体详情"
        contextDescription="请返回智能体列表后重新进入。"
      >
        <LiveStateNotice title="未找到智能体" message={`当前找不到 \`${agentId}\` 对应的智能体记录。`} />
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
      eyebrow="智能体详情"
      title={agent.name}
      description={agent.description}
      contextTitle={agent.lane}
      contextDescription="这里显示这个智能体当前绑定的运行环境和相关信息。"
      contextBody={
        <DetailRail
          label="绑定关系"
          items={[
            { label: "服务通道", value: agent.providerPreference },
            { label: "模型", value: agent.modelPreference },
            { label: "运行环境", value: agent.runtimePreference },
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
        setHistoryError(fetchError instanceof Error ? fetchError.message : "执行历史读取失败");
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
      setHistoryError(fetchError instanceof Error ? fetchError.message : "执行历史读取失败");
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleHistory = historyPage.items.length > 0 ? historyPage.items : historyError ? fallbackHistory : [];

  return (
    <OpenShockShell
      view="runs"
      eyebrow="执行总览"
      title="所有执行记录"
      description="这里查看当前和历史执行记录，包括运行环境、分支、日志和状态。"
      contextTitle="执行概览"
      contextDescription="每条执行记录都保留对应的运行环境、状态和关联对象，方便排查和继续处理。"
      contextBody={
        <DetailRail
          label="执行概况"
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
        <LiveStateNotice title="正在载入执行记录" message="正在获取执行记录、讨论间和事项信息。" />
      ) : error ? (
        <LiveStateNotice title="执行记录同步失败" message={error} />
      ) : historyLoading && historyPage.items.length === 0 && !historyError ? (
        <LiveStateNotice title="正在载入历史记录" message="正在获取较早的执行记录。" />
      ) : visibleHistory.length === 0 ? (
        <LiveStateNotice title="当前还没有执行记录" message="执行开始后，这里会显示对应内容。" />
      ) : (
        <div className="grid gap-4">
          {historyError ? (
            <LiveStateNotice title="历史记录载入失败" message={historyError} />
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
              {loadingMore ? "载入中..." : "加载更早的记录"}
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
        eyebrow="事项详情"
        title="正在载入事项"
        description="正在获取当前事项详情。"
        contextTitle="事项详情"
        contextDescription="请稍候，页面正在同步最新信息。"
      >
        <LiveStateNotice title="载入中" message="正在获取事项详情和对应的讨论间、执行记录。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="issues"
        eyebrow="事项详情"
        title="事项载入失败"
        description="暂时无法获取当前事项详情。"
        contextTitle="事项详情"
        contextDescription="请检查服务是否正常，然后重试。"
      >
        <LiveStateNotice title="载入失败" message={error} />
      </OpenShockShell>
    );
  }

  const issue = state.issues.find((candidate) => candidate.key.toLowerCase() === issueKey.toLowerCase());

  if (!issue) {
    return (
      <OpenShockShell
        view="issues"
        eyebrow="事项详情"
        title="未找到事项"
        description="这条事项可能已被删除，或当前数据尚未更新。"
        contextTitle="事项详情"
        contextDescription="请刷新页面，或从事项列表重新进入。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{issueKey}` 对应的事项。
        </div>
      </OpenShockShell>
    );
  }

  const run = state.runs.find((candidate) => candidate.id === issue.runId);
  const room = state.rooms.find((candidate) => candidate.id === issue.roomId);

  return (
    <OpenShockShell
      view="issues"
      eyebrow="事项详情"
      title={issue.key}
      description={issue.summary}
      selectedRoomId={issue.roomId}
      contextTitle={issue.owner}
      contextDescription="这里显示这条事项的负责人、讨论间和执行记录。"
      contextBody={
        <DetailRail
          label="事项关联"
          items={[
            { label: "讨论间", value: room?.title ?? issue.roomId },
            { label: "执行", value: run?.id ?? issue.runId },
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

export function LiveTopicPageContent({ topicId }: { topicId: string }) {
  const { state, loading, error, updateTopicGuidance, controlRun } = usePhaseZeroState();
  const [guidanceDraft, setGuidanceDraft] = useState("请先给我一句结论：这条话题现在最该推进的下一步是什么？");
  const [guidancePending, setGuidancePending] = useState(false);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const [guidanceSuccess, setGuidanceSuccess] = useState<string | null>(null);

  useEffect(() => {
    setGuidanceError(null);
    setGuidanceSuccess(null);
    setGuidanceDraft("请先给我一句结论：这条话题现在最该推进的下一步是什么？");
  }, [topicId]);

  if (loading) {
    return (
      <OpenShockShell
        view="topic"
        eyebrow="话题详情"
        title="正在载入话题"
        description="正在获取当前话题、讨论间和执行记录。"
        contextTitle="话题详情"
        contextDescription="请稍候，页面正在同步最新信息。"
      >
        <LiveStateNotice title="载入中" message="正在获取话题内容和当前执行状态。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="topic"
        eyebrow="话题详情"
        title="话题载入失败"
        description="暂时无法获取当前话题详情。"
        contextTitle="话题详情"
        contextDescription="请检查服务是否正常，然后重试。"
      >
        <LiveStateNotice title="载入失败" message={error} />
      </OpenShockShell>
    );
  }

  const room = state.rooms.find((candidate) => candidate.topic.id === topicId);
  const run = room
    ? state.runs.find((candidate) => candidate.id === room.runId) ??
      state.runs.find((candidate) => candidate.topicId === topicId && candidate.roomId === room.id) ??
      state.runs.find((candidate) => candidate.topicId === topicId)
    : undefined;
  const issue = room
    ? state.issues.find((candidate) => candidate.roomId === room.id || candidate.key === room.issueKey)
    : undefined;
  const session = room
    ? state.sessions.find((candidate) => candidate.activeRunId === run?.id) ??
      state.sessions.find((candidate) => candidate.topicId === topicId && candidate.roomId === room.id) ??
      state.sessions.find((candidate) => candidate.roomId === room.id || candidate.topicId === topicId)
    : undefined;
  const pullRequest = room ? state.pullRequests.find((candidate) => candidate.roomId === room.id) : undefined;
  const messages = room ? state.roomMessages[room.id] ?? [] : [];
  const recentGuidance = messages.slice(-5).reverse();
  const authSession = state.auth.session;
  const canGuide = hasSessionPermission(authSession, "room.reply");
  const guidanceStatus = permissionStatus(authSession, "room.reply");
  const guidanceBoundary = permissionBoundaryCopy(authSession, "room.reply");
  const canControlRun = hasSessionPermission(authSession, "run.execute");
  const runControlStatus = permissionStatus(authSession, "run.execute");
  const runControlBoundary = permissionBoundaryCopy(authSession, "run.execute");
  const continuityLabel = session
    ? `${session.id} / ${session.worktree || session.runtime || "沿用当前上下文"}`
    : "当前还没有可继续的上下文";

  if (!room) {
    return (
      <OpenShockShell
        view="topic"
        eyebrow="话题详情"
        title="未找到话题"
        description="这条话题可能还没同步，或者当前讨论间已经变化。"
        contextTitle="话题同步"
        contextDescription="从讨论间或快速搜索重新进入，通常就能拿到最新状态。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{topicId}` 对应的话题。
        </div>
      </OpenShockShell>
    );
  }

  async function handleGuidanceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guidanceDraft.trim() || guidancePending || !canGuide) {
      return;
    }

    setGuidancePending(true);
    setGuidanceError(null);
    setGuidanceSuccess(null);

    try {
      await updateTopicGuidance(topicId, { summary: guidanceDraft.trim() });
      setGuidanceSuccess("说明已保存到当前话题。");
      setGuidanceDraft("");
    } catch (submitError) {
      setGuidanceError(submitError instanceof Error ? submitError.message : "保存说明失败");
    } finally {
      setGuidancePending(false);
    }
  }

  async function handleRunControl(action: "stop" | "resume" | "follow_thread", note: string) {
    if (!run) return;
    await controlRun(run.id, { action, note });
  }

  return (
    <OpenShockShell
      view="topic"
      eyebrow="话题详情"
      title={room.topic.title}
      description="这里集中查看这条话题的说明、当前执行和恢复入口。"
      selectedRoomId={room.id}
      contextTitle={room.issueKey}
      contextDescription="话题仍然绑定同一条讨论和执行记录，但现在可以直接在这里补充说明并继续处理。"
      contextBody={
        <DetailRail
          label="话题关联"
          items={[
            { label: "讨论间", value: room.title },
            { label: "当前执行", value: run?.id ?? room.runId },
            { label: "PR", value: pullRequest?.title ?? issue?.pullRequest ?? "待产生" },
            { label: "连续性", value: continuityLabel },
          ]}
        />
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
        <div className="space-y-4">
          <Panel tone={panelToneForStatus(session?.status ?? run?.status ?? room.topic.status)} className="!p-4" data-testid="topic-route-overview">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.58)]">
                  {room.issueKey} / 话题
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold">{room.topic.title}</h2>
              </div>
              <span
                data-testid="topic-route-status"
                className={cn(
                  "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                  statusBadgeTone(session?.status ?? run?.status ?? room.topic.status)
                )}
              >
                {runStatusLabel(session?.status ?? run?.status ?? room.topic.status)}
              </span>
            </div>
            <p className="mt-4 text-base leading-7">{room.topic.summary}</p>
            <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <FactTile label="讨论间" value={room.title} />
              <FactTile label="负责人" value={room.topic.owner} />
              <FactTile label="当前执行" value={run?.id ?? room.runId} />
              <FactTile label="事项" value={issue?.title ?? room.issueKey} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/rooms/${room.id}?tab=topic`}
                data-testid="topic-open-room-workbench"
                className="rounded-xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
                打开讨论页话题
              </Link>
              <Link
                href={`/rooms/${room.id}`}
                className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
                回到讨论间
              </Link>
              {run ? (
                <Link
                  href={`/runs/${run.id}`}
                  data-testid="topic-open-run-link"
                  className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
                >
                  打开当前执行
                </Link>
              ) : null}
              {issue ? (
                <Link
                  href={`/issues/${issue.key}`}
                  className="rounded-xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
                >
                  查看事项
                </Link>
              ) : null}
            </div>
          </Panel>

          <Panel tone="white" className="!p-4" data-testid="topic-guidance-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">补充说明</p>
                <h3 className="mt-2 font-display text-2xl font-bold">直接补充这条话题的处理说明</h3>
              </div>
              <span
                data-testid="topic-guidance-authz"
                className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
              >
                {guidanceStatus}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这里会把新的说明直接写回当前话题，方便后续继续处理或恢复执行。
            </p>
            <form className="mt-4 space-y-3" onSubmit={(event) => void handleGuidanceSubmit(event)}>
              <textarea
                data-testid="topic-guidance-draft"
                value={guidanceDraft}
                onChange={(event) => setGuidanceDraft(event.target.value)}
                disabled={guidancePending || !canGuide}
                className="min-h-[116px] w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-[#faf6ea] px-4 py-3 text-sm leading-6 outline-none disabled:opacity-60"
                placeholder="补充当前话题的纠偏说明、下一步约束，或对评审与合并的判断。"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  data-testid="topic-guidance-submit"
                  disabled={guidancePending || !canGuide || !guidanceDraft.trim()}
                  className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-60"
                >
                  {guidancePending ? "保存中..." : "保存当前说明"}
                </button>
                <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
                  {canGuide ? "保存后会直接保留在当前话题里，不会打断你继续处理。" : guidanceBoundary}
                </p>
              </div>
            </form>
            {guidanceError ? (
              <p data-testid="topic-guidance-error" className="mt-3 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] text-white">
                {guidanceError}
              </p>
            ) : null}
            {guidanceSuccess ? (
              <p data-testid="topic-guidance-success" className="mt-3 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px]">
                {guidanceSuccess}
              </p>
            ) : null}
            <div className="mt-4 space-y-3">
              {recentGuidance.length > 0 ? (
                recentGuidance.map((message) => <TopicGuidanceEntry key={message.id} message={message} />)
              ) : (
                <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-4 py-5">
                  <p className="font-display text-lg font-bold">还没有说明记录</p>
                  <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
                    第一条说明保存后，这里会直接显示最近的补充记录。
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {run ? (
            <RunControlSurface
              scope="topic"
              run={run}
              session={session}
              canControl={canControlRun}
              controlStatus={runControlStatus}
              controlBoundary={runControlBoundary}
              onControl={handleRunControl}
            />
          ) : (
            <LiveStateNotice title="当前话题还没有可继续的执行" message="这条话题已经独立成页面，但目前还没有可恢复的执行记录。" />
          )}
          {run ? <RunSnapshotCard run={run} room={room} issue={issue} session={session} /> : null}
        </div>
      </div>
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
  const { state, loading, error, controlRun, updateRunCredentialBindings } = usePhaseZeroState();
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);

  useEffect(() => {
    if (loading || error) {
      return;
    }
    let cancelled = false;
    startTransition(() => {
      setRunDetail(null);
    });
    readRunDetail(runId)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setRunDetail(payload);
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setRunDetail(null);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [error, loading, runId]);

  if (loading) {
    return (
        <OpenShockShell
        view="runs"
        eyebrow="执行详情"
        title="正在载入执行记录"
        description="正在获取当前执行记录详情。"
        selectedRoomId={roomId}
        contextTitle="执行记录详情"
        contextDescription="请稍候，页面正在同步最新信息。"
      >
        <LiveStateNotice title="载入中" message="正在获取执行记录和对应的讨论间信息。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
        <OpenShockShell
        view="runs"
        eyebrow="执行详情"
        title="执行记录载入失败"
        description="暂时无法获取当前执行记录详情。"
        selectedRoomId={roomId}
        contextTitle="执行记录详情"
        contextDescription="请检查服务是否正常，然后重试。"
      >
        <LiveStateNotice title="载入失败" message={error} />
      </OpenShockShell>
    );
  }

  const runModel = resolveLiveRunDetail(state, runId, roomId, runDetail);
  const run = runModel.run;
  const room = runModel.room;
  const session = state.sessions.find((candidate) => candidate.activeRunId === runId);
  const authSession = state.auth.session;
  const canControlRun = hasSessionPermission(authSession, "run.execute");
  const runControlStatus = permissionStatus(authSession, "run.execute");
  const runControlBoundary = permissionBoundaryCopy(authSession, "run.execute");

  if (!room || !run) {
    return (
        <OpenShockShell
        view="runs"
        eyebrow="执行详情"
        title="未找到执行记录"
        description="这条执行记录可能还没同步，或者对应讨论间已经变化。"
        selectedRoomId={roomId}
        contextTitle="执行记录同步"
        contextDescription="从讨论间重新进入通常就能拿到最新状态。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{runId}` 的执行详情。
        </div>
      </OpenShockShell>
    );
  }

  const currentRun = run;
  const currentSession = runModel.session ?? session;
  const roomHistory = runModel.history;
  const issue = runModel.issue;

  async function handleRunControl(action: "stop" | "resume" | "follow_thread", note: string) {
    await controlRun(currentRun.id, { action, note });
  }

  return (
      <OpenShockShell
      view="runs"
      eyebrow="执行详情"
      title={run.id}
      description="这里查看这条执行记录的运行环境、分支、日志、工具调用和当前状态。"
      selectedRoomId={room.id}
      contextTitle={run.issueKey}
      contextDescription="这里用于快速定位这条执行记录的问题和上下文。"
      contextBody={
        <DetailRail
          label="执行泳道"
          items={[
            { label: "负责人", value: run.owner },
            { label: "服务商", value: run.provider },
            { label: "开始时间", value: run.startedAt },
            { label: "时长", value: run.duration },
          ]}
        />
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/topics/${currentRun.topicId}`}
            data-testid="run-detail-open-topic"
            className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            打开话题页
          </Link>
          <Link
            href={`/rooms/${room.id}?tab=topic`}
            className="rounded-xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
          >
            打开讨论页话题
          </Link>
          {issue ? (
            <Link
              href={`/issues/${issue.key}`}
              className="rounded-xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              查看事项
            </Link>
          ) : null}
        </div>
        <RunControlSurface
          scope="run"
          run={currentRun}
          session={currentSession}
          canControl={canControlRun}
          controlStatus={runControlStatus}
          controlBoundary={runControlBoundary}
          onControl={handleRunControl}
        />
        <RunCredentialScopePanel
          state={state}
          run={currentRun}
          canEdit={canControlRun}
          onUpdate={updateRunCredentialBindings}
        />
        <RunSandboxSurface run={currentRun} />
        <RunDetailView
          run={currentRun}
          statusTestId="run-detail-status"
          session={currentSession}
          history={roomHistory}
          guards={state.guards.filter((guard) => guard.runId === currentRun.id)}
          recoveryAudit={runModel.recoveryAudit}
        />
      </div>
    </OpenShockShell>
  );
}
