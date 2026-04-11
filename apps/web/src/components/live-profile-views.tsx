"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveMemoryCenter } from "@/lib/live-memory";
import { formatSandboxList, sandboxPolicyDraft, sandboxPolicySummary, sandboxProfileLabel } from "@/lib/sandbox-policy";
import type {
  AgentStatus,
  AuthSession,
  CredentialProfile,
  MachineStatus,
  PhaseZeroState,
  Room,
  Run,
  RuntimeRegistryRecord,
  SandboxProfile,
  WorkspaceMember,
} from "@/lib/phase-zero-types";
import { buildProfileHref, isProfileKind, type ProfileKind } from "@/lib/profile-surface";

const PROFILE_MEMORY_SPACE_OPTIONS = [
  { value: "workspace", label: "工作区", summary: "MEMORY.md / work-log" },
  { value: "issue-room", label: "事项房间", summary: "当前事项的房间上下文" },
  { value: "room-notes", label: "房间笔记", summary: "notes/rooms/* 记录" },
  { value: "topic", label: "话题", summary: "决策 / 话题上下文" },
  { value: "user", label: "智能体记忆", summary: ".openshock/agents/*/MEMORY.md" },
] as const;

const AGENT_RECALL_POLICY_OPTIONS = [
  { value: "governed-first", label: "治理优先" },
  { value: "balanced", label: "平衡" },
  { value: "agent-first", label: "智能体优先" },
] as const;

function valueOrPlaceholder(value: string | undefined | null, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function credentialLabel(profileID: string, profiles: CredentialProfile[]) {
  return profiles.find((profile) => profile.id === profileID)?.label ?? profileID;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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

function machineStateLabel(state: MachineStatus["state"]) {
  switch (state) {
    case "busy":
      return "忙碌";
    case "online":
      return "在线";
    default:
      return "离线";
  }
}

function humanPresenceLabel(member: WorkspaceMember, session?: PhaseZeroState["auth"]["session"]) {
  if (session?.memberId === member.id && session.status === "active") {
    return "当前在线";
  }
  switch (member.status) {
    case "active":
      return "可协作";
    case "invited":
      return "待加入";
    case "suspended":
      return "已停用";
    default:
      return member.status || "未知";
  }
}

function workspaceRoleLabel(role: string | undefined) {
  switch (role) {
    case "owner":
      return "所有者";
    case "member":
      return "成员";
    case "viewer":
      return "访客";
    default:
      return role || "未设置";
  }
}

function runStateLabel(status?: string) {
  switch (status) {
    case "running":
      return "执行中";
    case "blocked":
      return "阻塞";
    case "review":
      return "评审中";
    case "done":
      return "已完成";
    case "paused":
      return "已暂停";
    default:
      return status || "待同步";
  }
}

function topicStateLabel(status?: string) {
  switch (status) {
    case "active":
      return "进行中";
    case "planned":
      return "计划中";
    case "blocked":
      return "阻塞";
    case "done":
      return "已完成";
    case "review":
      return "评审中";
    default:
      return status || "待同步";
  }
}

function recallPolicyLabel(policy?: string) {
  switch (policy) {
    case "governed-first":
      return "治理优先";
    case "balanced":
      return "平衡";
    case "agent-first":
      return "智能体优先";
    default:
      return policy || "未设置";
  }
}

function sandboxProfileText(profile?: string) {
  switch (profile) {
    case "trusted":
      return "可信";
    case "restricted":
      return "受限";
    default:
      return sandboxProfileLabel(profile);
  }
}

function statusTone(status: "white" | "paper" | "yellow" | "lime" | "pink" | "ink") {
  switch (status) {
    case "paper":
      return "paper";
    case "yellow":
      return "yellow";
    case "lime":
      return "lime";
    case "pink":
      return "pink";
    case "ink":
      return "ink";
    default:
      return "white";
  }
}

function toneForAgent(agent: AgentStatus) {
  return statusTone(agent.state === "running" ? "yellow" : agent.state === "blocked" ? "pink" : "white");
}

function toneForMachine(machine: MachineStatus) {
  return statusTone(machine.state === "busy" ? "yellow" : machine.state === "online" ? "lime" : "paper");
}

function toneForHuman(member: WorkspaceMember, session?: PhaseZeroState["auth"]["session"]) {
  if (session?.memberId === member.id && session.status === "active") {
    return statusTone("lime");
  }
  if (member.status === "suspended") {
    return statusTone("pink");
  }
  if (member.status === "invited") {
    return statusTone("paper");
  }
  return statusTone("white");
}

function hasPermission(session: AuthSession, permission: string) {
  return session.status === "active" && session.permissions.includes(permission);
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "尚未记录";
  }
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toTestID(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function ProfileMetric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">{label}</p>
      <p className="mt-1.5 font-display text-[18px] font-semibold leading-5">{value}</p>
    </div>
  );
}

function SurfaceNotice({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
      <p className="font-display text-[24px] font-bold leading-7">{title}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </div>
  );
}

function RelationshipList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; label: string; href: string; meta: string }>;
}) {
  return (
    <Panel tone="white">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">{title}</p>
      <div className="mt-4 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="block rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-white"
            >
              <p className="font-display text-[18px] font-semibold leading-5">{item.label}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">{item.meta}</p>
            </Link>
          ))
        ) : (
          <p className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            当前还没有可回跳的最近关系。
          </p>
        )}
      </div>
    </Panel>
  );
}

function CapabilityChips({ items }: { items: string[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.length > 0 ? (
        items.map((item) => (
          <span
            key={item}
            className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            {item}
          </span>
        ))
      ) : (
        <span className="rounded-full border-2 border-dashed border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          no capability truth yet
        </span>
      )}
    </div>
  );
}

function findPreviewForAgent(center: ReturnType<typeof useLiveMemoryCenter>["center"], agent: AgentStatus, sessionId?: string) {
  if (sessionId) {
    const direct = center.previews.find((item) => item.sessionId === sessionId);
    if (direct) {
      return direct;
    }
  }
  return center.previews.find((item) => agent.recentRunIds.includes(item.runId));
}

function AgentProfileAuditPanel({ audit = [] }: { audit?: AgentStatus["profileAudit"] }) {
  return (
    <Panel tone="white">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">档案审计</p>
      <div className="mt-4 space-y-3">
        {audit.length > 0 ? (
          audit.map((entry, index) => (
            <div
              key={entry.id}
              data-testid={index === 0 ? "profile-audit-entry" : undefined}
              className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-[18px] font-semibold">{entry.summary}</p>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                  {entry.updatedBy} · {formatTimestamp(entry.updatedAt)}
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                {entry.changes.map((change) => (
                  <div key={`${entry.id}-${change.field}`} className="rounded-[14px] border border-[var(--shock-ink)] bg-white px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">{change.field}</p>
                    <p className="mt-1 text-sm leading-6">
                      <span className="font-semibold">变更前：</span> {valueOrPlaceholder(change.previous, "空")}
                    </p>
                    <p className="text-sm leading-6">
                      <span className="font-semibold">变更后：</span> {valueOrPlaceholder(change.current, "空")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            这位智能体还没有档案审计记录。
          </p>
        )}
      </div>
    </Panel>
  );
}

function findRunsByRoomIds(runs: Run[], roomIds: string[]) {
  const set = new Set(roomIds);
  return runs.filter((run) => set.has(run.roomId));
}

function roomLink(room: Room) {
  return `/rooms/${room.id}`;
}

function runLink(run: Run) {
  return `/runs/${run.id}`;
}

function findMachineRuntimeRecords(state: PhaseZeroState, machine: MachineStatus) {
  return state.runtimes.filter((runtime) => runtime.machine === machine.name || runtime.id === machine.id);
}

function runtimeCapabilityList(runtimes: RuntimeRegistryRecord[]) {
  return uniqueStrings(
    runtimes.flatMap((runtime) =>
      runtime.providers.flatMap((provider) => [
        provider.label,
        ...provider.capabilities.map((capability) => `${provider.label}:${capability}`),
      ])
    )
  );
}

function matchesRuntimePreference(runtime: RuntimeRegistryRecord, value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && (runtime.id === trimmed || runtime.machine === trimmed);
}

function findRuntimeRecordByPreference(runtimes: RuntimeRegistryRecord[], value: string) {
  return runtimes.find((runtime) => matchesRuntimePreference(runtime, value)) ?? null;
}

function runtimeOptionLabel(runtime: RuntimeRegistryRecord) {
  const cliLabel = runtime.detectedCli.join(" + ") || "CLI 未返回";
  return `${runtime.machine} · ${runtime.shell || "shell 未返回"} · ${cliLabel}`;
}

function runtimeProviderLabel(provider: RuntimeRegistryRecord["providers"][number]) {
  return provider.label || provider.id;
}

function matchesProviderPreference(
  provider: RuntimeRegistryRecord["providers"][number],
  value: string
) {
  const trimmed = value.trim();
  return trimmed.length > 0 && (provider.id === trimmed || runtimeProviderLabel(provider) === trimmed);
}

function providerModelList(provider: RuntimeRegistryRecord["providers"][number] | null | undefined) {
  return provider?.models ?? [];
}

function catalogIncludesModel(models: string[], value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && models.some((model) => model.toLowerCase() === trimmed.toLowerCase());
}

function RuntimeProviderInventory({
  runtime,
  testPrefix,
}: {
  runtime: RuntimeRegistryRecord;
  testPrefix: string;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {runtime.providers.map((provider) => (
        <div
          key={`${runtime.id}-${provider.id}`}
          data-testid={`${testPrefix}-provider-${provider.id}`}
          className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3"
        >
          <p className="font-display text-[18px] font-semibold">{runtimeProviderLabel(provider)}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            {provider.mode} · {provider.transport}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {providerModelList(provider).length > 0 ? (
              providerModelList(provider).map((model) => (
                <span
                  key={`${provider.id}-${model}`}
                  className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px]"
                >
                  {model}
                </span>
              ))
            ) : (
              <span className="rounded-full border border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px]">
                no models reported
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {provider.capabilities.map((capability) => (
              <span
                key={`${provider.id}-${capability}`}
                className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
              >
                {capability}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentProfileSurface({
  state,
  agent,
}: {
  state: PhaseZeroState;
  agent: AgentStatus;
}) {
  const { updateAgentProfile } = usePhaseZeroState();
  const { center, loading: centerLoading, error: centerError, refresh: refreshMemoryCenter } = useLiveMemoryCenter();
  const recentRuns = state.runs.filter((run) => agent.recentRunIds.includes(run.id));
  const recentRooms = state.rooms.filter((room) => recentRuns.some((run) => run.roomId === room.id));
  const runtimeRecords = state.runtimes.filter((runtime) => matchesRuntimePreference(runtime, agent.runtimePreference));
  const activeSessions = state.sessions.filter((session) => recentRuns.some((run) => run.id === session.activeRunId));
  const relatedHumans = state.auth.members.filter((member) => recentRuns.some((run) => run.owner === member.name));
  const capabilityTruth = runtimeCapabilityList(runtimeRecords);
  const sessionItems = activeSessions.map((session) => {
    const linkedRun = state.runs.find((run) => run.id === session.activeRunId);
    return {
      id: session.id,
      label: session.id,
      href: linkedRun ? runLink(linkedRun) : buildProfileHref("machine", session.machine),
      meta: `${runStateLabel(session.status)} · ${session.machine} · ${session.worktree}`,
    };
  });
  const previewSessionId = activeSessions[0]?.id;
  const preview = findPreviewForAgent(center, agent, previewSessionId);
  const canEdit = hasPermission(state.auth.session, "workspace.manage");
  const [roleDraft, setRoleDraft] = useState(agent.role);
  const [avatarDraft, setAvatarDraft] = useState(agent.avatar);
  const [promptDraft, setPromptDraft] = useState(agent.prompt);
  const [instructionsDraft, setInstructionsDraft] = useState(agent.operatingInstructions);
  const [providerPreferenceDraft, setProviderPreferenceDraft] = useState(agent.providerPreference);
  const [modelPreferenceDraft, setModelPreferenceDraft] = useState(agent.modelPreference);
  const [recallPolicyDraft, setRecallPolicyDraft] = useState(agent.recallPolicy);
  const [runtimePreferenceDraft, setRuntimePreferenceDraft] = useState(agent.runtimePreference);
  const [memorySpacesDraft, setMemorySpacesDraft] = useState<string[]>(agent.memorySpaces);
  const [credentialProfileIDsDraft, setCredentialProfileIDsDraft] = useState<string[]>(agent.credentialProfileIds ?? []);
  const [sandboxProfileDraft, setSandboxProfileDraft] = useState<SandboxProfile>((agent.sandbox.profile || "trusted") as SandboxProfile);
  const [allowedHostsDraft, setAllowedHostsDraft] = useState(formatSandboxList(agent.sandbox.allowedHosts));
  const [allowedCommandsDraft, setAllowedCommandsDraft] = useState(formatSandboxList(agent.sandbox.allowedCommands));
  const [allowedToolsDraft, setAllowedToolsDraft] = useState(formatSandboxList(agent.sandbox.allowedTools));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const runtimeOptions = state.runtimes.map((runtime) => ({
    value: runtime.id,
    label: runtimeOptionLabel(runtime),
  }));
  const selectedRuntimeRecord = findRuntimeRecordByPreference(state.runtimes, runtimePreferenceDraft);
  const selectedRuntimeProviders = selectedRuntimeRecord?.providers ?? [];
  const selectedRuntimeFirstProviderLabel = selectedRuntimeProviders[0]
    ? runtimeProviderLabel(selectedRuntimeProviders[0])
    : "";
  const selectedProviderRecord =
    selectedRuntimeProviders.find((provider) => matchesProviderPreference(provider, providerPreferenceDraft)) ?? null;
  const selectedProviderCatalog = providerModelList(selectedProviderRecord);
  const providerOptions = uniqueStrings([
    agent.providerPreference,
    ...selectedRuntimeProviders.map((provider) => runtimeProviderLabel(provider)),
  ]);
  const modelOptions = uniqueStrings([
    agent.modelPreference,
    ...selectedProviderCatalog,
  ]);
  const alternateProviderCatalog = uniqueStrings(
    selectedRuntimeProviders
      .filter((provider) => provider.id !== selectedProviderRecord?.id)
      .flatMap((provider) => providerModelList(provider))
  );
  const modelCatalogListId = `profile-editor-model-catalog-${agent.id}`;

  useEffect(() => {
    setRoleDraft(agent.role);
    setAvatarDraft(agent.avatar);
    setPromptDraft(agent.prompt);
    setInstructionsDraft(agent.operatingInstructions);
    setProviderPreferenceDraft(agent.providerPreference);
    setModelPreferenceDraft(agent.modelPreference);
    setRecallPolicyDraft(agent.recallPolicy);
    setRuntimePreferenceDraft(agent.runtimePreference);
    setMemorySpacesDraft(agent.memorySpaces);
    setCredentialProfileIDsDraft(agent.credentialProfileIds ?? []);
    setSandboxProfileDraft((agent.sandbox.profile || "trusted") as SandboxProfile);
    setAllowedHostsDraft(formatSandboxList(agent.sandbox.allowedHosts));
    setAllowedCommandsDraft(formatSandboxList(agent.sandbox.allowedCommands));
    setAllowedToolsDraft(formatSandboxList(agent.sandbox.allowedTools));
  }, [
    agent.avatar,
    agent.credentialProfileIds,
    agent.id,
    agent.sandbox.allowedCommands,
    agent.sandbox.allowedHosts,
    agent.sandbox.allowedTools,
    agent.sandbox.profile,
    agent.memorySpaces,
    agent.modelPreference,
    agent.operatingInstructions,
    agent.prompt,
    agent.providerPreference,
    agent.recallPolicy,
    agent.role,
    agent.runtimePreference,
  ]);

  useEffect(() => {
    void refreshMemoryCenter().catch(() => {});
  }, [refreshMemoryCenter]);

  useEffect(() => {
    if (!selectedRuntimeRecord && runtimeOptions.length > 0) {
      setRuntimePreferenceDraft(runtimeOptions[0]?.value ?? "");
    }
  }, [runtimeOptions, selectedRuntimeRecord]);

  useEffect(() => {
    if (!selectedRuntimeFirstProviderLabel || selectedProviderRecord) {
      return;
    }
    setProviderPreferenceDraft(selectedRuntimeFirstProviderLabel);
  }, [selectedProviderRecord, selectedRuntimeFirstProviderLabel]);

  useEffect(() => {
    if (selectedProviderCatalog.length === 0) {
      return;
    }
    if (modelPreferenceDraft.trim() === "") {
      setModelPreferenceDraft(selectedProviderCatalog[0] ?? "");
      return;
    }
    if (catalogIncludesModel(selectedProviderCatalog, modelPreferenceDraft)) {
      return;
    }
    if (catalogIncludesModel(alternateProviderCatalog, modelPreferenceDraft)) {
      setModelPreferenceDraft(selectedProviderCatalog[0] ?? "");
    }
  }, [alternateProviderCatalog, modelPreferenceDraft, selectedProviderCatalog]);

  function toggleMemorySpace(value: string) {
    setMemorySpacesDraft((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  function toggleCredentialProfile(value: string) {
    setCredentialProfileIDsDraft((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveStatus(null);

    try {
      await updateAgentProfile(agent.id, {
        name: agent.name,
        role: roleDraft,
        avatar: avatarDraft,
        prompt: promptDraft,
        operatingInstructions: instructionsDraft,
        providerPreference: providerPreferenceDraft,
        modelPreference: modelPreferenceDraft,
        recallPolicy: recallPolicyDraft,
        runtimePreference: runtimePreferenceDraft,
        memorySpaces: memorySpacesDraft,
        credentialProfileIds: credentialProfileIDsDraft,
        sandbox: sandboxPolicyDraft(sandboxProfileDraft, {
          allowedHosts: allowedHostsDraft,
          allowedCommands: allowedCommandsDraft,
          allowedTools: allowedToolsDraft,
        }),
      });
      await refreshMemoryCenter();
      setSaveStatus("智能体档案已写回后端真值，下一次执行预览已同步刷新。");
    } catch (mutationError) {
      setSaveError(mutationError instanceof Error ? mutationError.message : "保存智能体档案失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OpenShockShell
      view="profiles"
      eyebrow="智能体档案"
      title={agent.name}
      description={agent.description}
      contextTitle="档案状态"
      contextDescription="智能体档案把角色、提示词、记忆绑定和运行环境偏好放在同一页：供应商、模型和运行环境直接对齐机器真值与模型目录建议，不再长出第二套影子状态。"
      contextBody={
        <DetailRail
          label="智能体真值"
          items={[
            { label: "状态", value: agentStateLabel(agent.state) },
            { label: "角色", value: agent.role },
            { label: "供应商偏好", value: agent.providerPreference },
            { label: "模型", value: valueOrPlaceholder(agent.modelPreference, "未设置") },
            { label: "运行环境", value: agent.runtimePreference },
            { label: "召回策略", value: recallPolicyLabel(agent.recallPolicy) },
          ]}
        />
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.16fr)_0.84fr]">
        <div className="space-y-4">
          <Panel tone={toneForAgent(agent)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">
                  {agent.role} · {agent.avatar}
                </p>
                <h2 data-testid="profile-surface-title" className="mt-2 font-display text-[30px] font-bold leading-8">
                  {agent.name}
                </h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                {agentStateLabel(agent.state)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6">{agent.description}</p>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <ProfileMetric label="职责线" value={agent.lane} />
              <ProfileMetric label="供应商" value={agent.providerPreference} />
              <ProfileMetric label="模型" value={valueOrPlaceholder(agent.modelPreference, "未设置")} />
              <ProfileMetric label="运行环境" value={agent.runtimePreference} />
            </div>
            <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
              <span className="font-semibold">提示词：</span> {agent.prompt}
            </p>
            <p className="mt-2 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
              <span className="font-semibold">操作说明：</span> {valueOrPlaceholder(agent.operatingInstructions, "尚未填写操作说明")}
            </p>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">能力</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              当前能力直接从运行环境注册表的供应商真值组装，不再只剩一条供应商角标。
            </p>
            <CapabilityChips items={capabilityTruth} />
          </Panel>

          <Panel tone="paper">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">已绑定运行目录</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                {selectedRuntimeRecord ? selectedRuntimeRecord.id : "未命中运行环境"}
              </span>
            </div>
            {selectedRuntimeRecord ? (
              <div className="mt-3 space-y-3" data-testid="profile-binding-runtime-card">
                <div className="grid gap-2 md:grid-cols-4">
                  <ProfileMetric label="机器" value={selectedRuntimeRecord.machine} />
                  <ProfileMetric label="Shell" value={valueOrPlaceholder(selectedRuntimeRecord.shell, "未返回")} testId="profile-binding-shell" />
                  <ProfileMetric label="连接地址" value={valueOrPlaceholder(selectedRuntimeRecord.daemonUrl, "未配对")} />
                  <ProfileMetric
                    label="CLI"
                    value={valueOrPlaceholder(selectedRuntimeRecord.detectedCli.join(" + "), "未返回")}
                    testId="profile-binding-cli"
                  />
                </div>
                <RuntimeProviderInventory runtime={selectedRuntimeRecord} testPrefix="profile-binding" />
              </div>
            ) : (
              <p className="mt-3 rounded-[16px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
                当前草稿还没命中任何运行环境供应商或目录；先从已注册的机器真值里选一条运行环境偏好。
              </p>
            )}
          </Panel>

          <Panel tone="paper">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">记忆空间</p>
            <CapabilityChips items={agent.memorySpaces} />
          </Panel>

          <Panel tone="paper">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">凭据范围</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              智能体侧只绑定元数据真值；实际密钥内容仍停在加密保险库。当前智能体直绑的档案会在执行详情里与工作区默认和执行覆盖一起结算。
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <ProfileMetric label="已绑定" value={String(agent.credentialProfileIds?.length ?? 0)} testId="profile-credential-bound-count" />
              <ProfileMetric
                label="最近执行"
                value={String(recentRuns.filter((run) => (run.credentialProfileIds ?? []).length > 0).length)}
                testId="profile-credential-run-count"
              />
              <ProfileMetric
                label="工作区默认"
                value={String(state.credentials.filter((profile) => profile.workspaceDefault).length)}
              />
              <ProfileMetric
                label="最近使用"
                value={valueOrPlaceholder(
                  state.credentials.find((profile) => (agent.credentialProfileIds ?? []).includes(profile.id) && profile.lastUsedAt)?.lastUsedAt,
                  "尚未消费"
                )}
              />
            </div>
            <div className="mt-3">
              <CapabilityChips items={(agent.credentialProfileIds ?? []).map((id) => credentialLabel(id, state.credentials))} />
            </div>
          </Panel>

          <Panel tone="paper">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">本地沙箱策略</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                {sandboxProfileText(agent.sandbox.profile)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这层把智能体默认运行环境沙箱档位和白名单写成可审计真值；新执行会先继承所有者策略，再由执行自己按精确目标继续收口。
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <CapabilityChips items={[sandboxPolicySummary(agent.sandbox)]} />
              <div className="space-y-2 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
                <p><span className="font-semibold">主机：</span> {valueOrPlaceholder(formatSandboxList(agent.sandbox.allowedHosts), "未声明")}</p>
                <p><span className="font-semibold">命令：</span> {valueOrPlaceholder(formatSandboxList(agent.sandbox.allowedCommands), "未声明")}</p>
                <p><span className="font-semibold">工具：</span> {valueOrPlaceholder(formatSandboxList(agent.sandbox.allowedTools), "未声明")}</p>
              </div>
            </div>
          </Panel>

          <Panel tone="white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">智能体档案编辑</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                {canEdit ? "可编辑" : "只读"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这层会把角色、头像、提示词、供应商、模型、运行环境偏好、记忆绑定、召回策略和沙箱策略直接写回实时服务端真值；保存后同页会回读下一次执行预览。
            </p>
            {!canEdit ? (
              <p className="mt-3 rounded-[16px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm leading-6">
                当前会话没有 `workspace.manage`。仍可检查档案、预览和审计，但编辑保持只读。
              </p>
            ) : null}
            <form className="mt-4 space-y-4" onSubmit={handleSave}>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">角色</span>
                  <input
                    data-testid="profile-editor-role"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={roleDraft}
                    onChange={(event) => setRoleDraft(event.target.value)}
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">头像</span>
                  <input
                    data-testid="profile-editor-avatar"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={avatarDraft}
                    onChange={(event) => setAvatarDraft(event.target.value)}
                    disabled={!canEdit || saving}
                  />
                </label>
              </div>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">提示词</span>
                <textarea
                  data-testid="profile-editor-prompt"
                  className="mt-1.5 min-h-[110px] w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm leading-6"
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  disabled={!canEdit || saving}
                />
              </label>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">操作说明</span>
                <textarea
                  data-testid="profile-editor-operating-instructions"
                  className="mt-1.5 min-h-[96px] w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm leading-6"
                  value={instructionsDraft}
                  onChange={(event) => setInstructionsDraft(event.target.value)}
                  disabled={!canEdit || saving}
                />
              </label>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">运行环境偏好</span>
                  <select
                    data-testid="profile-editor-runtime-preference"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={runtimePreferenceDraft}
                    onChange={(event) => setRuntimePreferenceDraft(event.target.value)}
                    disabled={!canEdit || saving}
                  >
                    {runtimeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">供应商偏好</span>
                  <select
                    data-testid="profile-editor-provider-preference"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={providerPreferenceDraft}
                    onChange={(event) => setProviderPreferenceDraft(event.target.value)}
                    disabled={!canEdit || saving}
                  >
                    {providerOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">默认模型</span>
                  <input
                    data-testid="profile-editor-model-preference"
                    list={modelCatalogListId}
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={modelPreferenceDraft}
                    onChange={(event) => setModelPreferenceDraft(event.target.value)}
                    disabled={!canEdit || saving}
                    autoComplete="off"
                  />
                  <datalist id={modelCatalogListId}>
                    {modelOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                  <p className="mt-1.5 text-xs leading-5 text-[color:rgba(24,20,14,0.64)]">
                    运行环境侧这份模型目录只提供建议；可直接输入本机配置里的模型 ID，不按静态目录做硬拒绝。
                  </p>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">召回策略</span>
                  <select
                    data-testid="profile-editor-recall-policy"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={recallPolicyDraft}
                    onChange={(event) => setRecallPolicyDraft(event.target.value)}
                    disabled={!canEdit || saving}
                  >
                    {AGENT_RECALL_POLICY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">沙箱档位</span>
                  <select
                    data-testid="profile-editor-sandbox-profile"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={sandboxProfileDraft}
                    onChange={(event) => setSandboxProfileDraft(event.target.value as SandboxProfile)}
                    disabled={!canEdit || saving}
                  >
                    <option value="trusted">可信</option>
                    <option value="restricted">受限</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">允许主机</span>
                  <input
                    data-testid="profile-editor-sandbox-allowed-hosts"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={allowedHostsDraft}
                    onChange={(event) => setAllowedHostsDraft(event.target.value)}
                    disabled={!canEdit || saving}
                    placeholder="github.com, api.openai.com"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">允许工具</span>
                  <input
                    data-testid="profile-editor-sandbox-allowed-tools"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={allowedToolsDraft}
                    onChange={(event) => setAllowedToolsDraft(event.target.value)}
                    disabled={!canEdit || saving}
                    placeholder="read_file, rg"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">允许命令</span>
                  <input
                    data-testid="profile-editor-sandbox-allowed-commands"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={allowedCommandsDraft}
                    onChange={(event) => setAllowedCommandsDraft(event.target.value)}
                    disabled={!canEdit || saving}
                    placeholder="git status, pnpm test"
                  />
                </label>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">记忆绑定</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {PROFILE_MEMORY_SPACE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                    >
                      <input
                        data-testid={`profile-editor-memory-space-${option.value}`}
                        type="checkbox"
                        checked={memorySpacesDraft.includes(option.value)}
                        onChange={() => toggleMemorySpace(option.value)}
                        disabled={!canEdit || saving}
                      />
                      <span>
                        <span className="block font-semibold">{option.label}</span>
                        <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">{option.summary}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">凭据绑定</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {state.credentials.length === 0 ? (
                    <p className="rounded-[16px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm leading-6">
                      先去设置页创建凭据档案，这里只消费那份元数据真值。
                    </p>
                  ) : (
                    state.credentials.map((profile) => (
                      <label
                        key={profile.id}
                        className="flex items-start gap-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                      >
                        <input
                          data-testid={`profile-editor-credential-${profile.id}`}
                          type="checkbox"
                          checked={credentialProfileIDsDraft.includes(profile.id)}
                          onChange={() => toggleCredentialProfile(profile.id)}
                          disabled={!canEdit || saving}
                        />
                        <span>
                          <span className="block font-semibold">{profile.label}</span>
                          <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
                            {profile.secretKind} · {profile.workspaceDefault ? "工作区默认" : "智能体专属"}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  data-testid="profile-editor-save"
                  disabled={!canEdit || saving}
                  className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:bg-[var(--shock-paper)]"
                >
                  {saving ? "保存中..." : "保存档案"}
                </button>
                {saveStatus ? (
                  <span data-testid="profile-editor-save-status" className="text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
                    {saveStatus}
                  </span>
                ) : null}
                {saveError ? (
                  <span className="text-sm leading-6 text-[color:rgba(163,37,28,0.9)]">{saveError}</span>
                ) : null}
              </div>
            </form>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel tone="paper">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">下一次执行预览</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这块直接读取 `/v1/memory-center` 的会话级预览；档案保存后，这里应立刻反映新的召回策略、记忆绑定和提示词骨架。
            </p>
            {centerLoading ? (
              <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">正在同步下一次执行预览…</p>
            ) : centerError ? (
              <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">{centerError}</p>
            ) : preview ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                    {preview.sessionId} · {recallPolicyLabel(preview.recallPolicy)}
                  </p>
                  <pre
                    data-testid="profile-next-run-preview-summary"
                    className="mt-2 whitespace-pre-wrap font-mono text-[12px] leading-6 text-[color:rgba(24,20,14,0.82)]"
                  >
                    {preview.promptSummary}
                  </pre>
                </div>
                <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">挂载文件</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {preview.files.map((path) => (
                      <span
                        key={path}
                        data-testid={`profile-next-run-preview-file-${toTestID(path)}`}
                        className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px]"
                      >
                        {path}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
                当前智能体还没有可对齐的会话预览。
              </p>
            )}
          </Panel>

          <AgentProfileAuditPanel audit={agent.profileAudit} />

          <RelationshipList
            title="最近执行"
            items={recentRuns.map((run) => ({
              id: run.id,
              label: run.id,
              href: runLink(run),
              meta: `${runStateLabel(run.status)} · ${run.roomId} · ${run.machine}`,
            }))}
          />
          <RelationshipList
            title="最近房间"
            items={recentRooms.map((room) => ({
              id: room.id,
              label: room.title,
              href: roomLink(room),
              meta: `${room.issueKey} · ${topicStateLabel(room.topic.status)} · ${room.topic.owner}`,
            }))}
          />
          <RelationshipList
            title="相关成员"
            items={relatedHumans.map((member) => ({
              id: member.id,
              label: member.name,
              href: buildProfileHref("human", member.id),
              meta: `${workspaceRoleLabel(member.role)} · ${valueOrPlaceholder(member.lastSeenAt, "未返回最近在线时间")}`,
            }))}
          />
          <RelationshipList
            title="实时会话"
            items={sessionItems}
          />
        </div>
      </div>
    </OpenShockShell>
  );
}

function MachineProfileSurface({
  state,
  machine,
}: {
  state: PhaseZeroState;
  machine: MachineStatus;
}) {
  const runtimeRecords = findMachineRuntimeRecords(state, machine);
  const activeRuns = state.runs.filter(
    (run) =>
      run.machine === machine.name ||
      runtimeRecords.some((runtime) => runtime.id === run.runtime || runtime.machine === run.machine)
  );
  const recentRooms = state.rooms.filter((room) => activeRuns.some((run) => run.roomId === room.id));
  const relatedAgents = state.agents.filter(
    (agent) =>
      agent.runtimePreference === machine.name ||
      agent.runtimePreference === machine.id ||
      runtimeRecords.some((runtime) => agent.runtimePreference === runtime.id || agent.runtimePreference === runtime.machine)
  );
  const leases = state.runtimeLeases.filter(
    (lease) =>
      lease.machine === machine.name ||
      lease.machine === machine.id ||
      runtimeRecords.some((runtime) => lease.runtime === runtime.id)
  );
  const capabilityTruth = runtimeCapabilityList(runtimeRecords);

  return (
    <OpenShockShell
      view="profiles"
      eyebrow="机器档案"
      title={machine.name}
      description="机器档案把心跳、Shell、连接地址、供应商模型目录、最近执行和已绑定智能体收成一张前台页面。"
      contextTitle="机器状态"
      contextDescription="这页只读取实时机器与运行环境真值；绑定编辑继续留在智能体档案，但 `/setup`、`/agents` 和这里都读同一份供应商与模型目录。"
      contextBody={
        <DetailRail
          label="机器真值"
          items={[
            { label: "状态", value: machineStateLabel(machine.state) },
            { label: "CLI", value: machine.cli },
            { label: "Shell", value: valueOrPlaceholder(machine.shell, "未返回") },
            { label: "心跳", value: machine.lastHeartbeat },
            { label: "租约", value: `${leases.length} 条` },
          ]}
        />
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <div className="space-y-4">
          <Panel tone={toneForMachine(machine)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">machine</p>
                <h2 data-testid="profile-surface-title" className="mt-2 font-display text-[30px] font-bold leading-8">
                  {machine.name}
                </h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                {machineStateLabel(machine.state)}
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <ProfileMetric label="CLI" value={machine.cli} />
              <ProfileMetric label="Shell" value={valueOrPlaceholder(machine.shell, "未返回")} testId="machine-profile-shell" />
              <ProfileMetric label="系统" value={machine.os} />
              <ProfileMetric label="最近心跳" value={machine.lastHeartbeat} />
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">运行能力</p>
            <CapabilityChips items={capabilityTruth} />
            <div className="mt-4 space-y-3">
              {runtimeRecords.map((runtime) => (
                <div
                  key={runtime.id}
                  data-testid={`machine-runtime-card-${toTestID(runtime.id)}`}
                  className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[18px] font-semibold">{runtime.id}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                        {runtime.pairingState} · {runtime.state}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      {valueOrPlaceholder(runtime.shell, machine.shell || "shell 未返回")}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <ProfileMetric label="连接地址" value={valueOrPlaceholder(runtime.daemonUrl, "未配对")} />
                    <ProfileMetric label="CLI" value={valueOrPlaceholder(runtime.detectedCli.join(" + "), machine.cli)} />
                    <ProfileMetric label="模型数" value={`${runtime.providers.reduce((sum, provider) => sum + providerModelList(provider).length, 0)} 个`} />
                  </div>
                  <div className="mt-3">
                    <RuntimeProviderInventory runtime={runtime} testPrefix={`machine-runtime-${toTestID(runtime.id)}`} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <RelationshipList
            title="最近执行"
            items={activeRuns.map((run) => ({
              id: run.id,
              label: run.id,
              href: runLink(run),
              meta: `${runStateLabel(run.status)} · ${run.owner} · ${run.roomId}`,
            }))}
          />
          <RelationshipList
            title="最近房间"
            items={recentRooms.map((room) => ({
              id: room.id,
              label: room.title,
              href: roomLink(room),
              meta: `${room.issueKey} · ${topicStateLabel(room.topic.status)}`,
            }))}
          />
          <RelationshipList
            title="已绑定智能体"
            items={relatedAgents.map((agent) => ({
              id: agent.id,
              label: agent.name,
              href: buildProfileHref("agent", agent.id),
              meta: `${agentStateLabel(agent.state)} · ${agent.providerPreference} / ${valueOrPlaceholder(agent.modelPreference, "未设置")} · ${agent.lane}`,
            }))}
          />
        </div>
      </div>
    </OpenShockShell>
  );
}

function HumanProfileSurface({
  state,
  member,
}: {
  state: PhaseZeroState;
  member: WorkspaceMember;
}) {
  const authSession = state.auth.session.memberId === member.id ? state.auth.session : undefined;
  const ownedRuns = state.runs.filter((run) => run.owner === member.name);
  const ownedRooms = state.rooms.filter((room) => room.topic.owner === member.name || ownedRuns.some((run) => run.roomId === room.id));
  const recentRuns = ownedRuns.length > 0 ? ownedRuns : findRunsByRoomIds(state.runs, ownedRooms.map((room) => room.id));

  return (
    <OpenShockShell
      view="profiles"
      eyebrow="成员档案"
      title={member.name}
      description="成员档案把会话、角色权限、最近执行与房间关系，以及成员在线状态收在同一条前台页面里。"
      contextTitle="成员状态"
      contextDescription="这张档案只读取当前工作区成员真值，不提前混入更大的引导、模板或持久化配置。"
      contextBody={
        <DetailRail
          label="成员真值"
          items={[
            { label: "状态", value: humanPresenceLabel(member, authSession) },
            { label: "角色", value: workspaceRoleLabel(member.role) },
            { label: "权限", value: `${member.permissions.length} 项` },
            { label: "最近在线", value: valueOrPlaceholder(member.lastSeenAt, "未返回") },
          ]}
        />
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <div className="space-y-4">
          <Panel tone={toneForHuman(member, authSession)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">workspace member</p>
                <h2 data-testid="profile-surface-title" className="mt-2 font-display text-[30px] font-bold leading-8">
                  {member.name}
                </h2>
                <p className="mt-2 break-all font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">{member.email}</p>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                {humanPresenceLabel(member, authSession)}
              </span>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              <ProfileMetric label="角色" value={workspaceRoleLabel(member.role)} />
              <ProfileMetric label="状态" value={humanPresenceLabel(member, authSession)} />
              <ProfileMetric label="来源" value={valueOrPlaceholder(member.source, "初始数据")} />
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">能力 / 权限</p>
            <CapabilityChips items={member.permissions} />
          </Panel>

          {authSession ? (
            <Panel tone="paper">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">当前会话</p>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <ProfileMetric label="登录方式" value={valueOrPlaceholder(authSession.authMethod, "未返回")} />
                <ProfileMetric label="登录时间" value={valueOrPlaceholder(authSession.signedInAt, "未返回")} />
                <ProfileMetric label="最近在线" value={valueOrPlaceholder(authSession.lastSeenAt, "未返回")} />
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <RelationshipList
            title="最近执行"
            items={recentRuns.map((run) => ({
              id: run.id,
              label: run.id,
              href: runLink(run),
              meta: `${runStateLabel(run.status)} · ${run.machine} · ${run.roomId}`,
            }))}
          />
          <RelationshipList
            title="最近房间"
            items={ownedRooms.map((room) => ({
              id: room.id,
              label: room.title,
              href: roomLink(room),
              meta: `${room.issueKey} · ${topicStateLabel(room.topic.status)}`,
            }))}
          />
        </div>
      </div>
    </OpenShockShell>
  );
}

export function LiveProfilePageContent({
  kind,
  profileId,
}: {
  kind: ProfileKind | string;
  profileId: string;
}) {
  const { state, loading, error } = usePhaseZeroState();

  if (!isProfileKind(kind)) {
    return (
      <OpenShockShell
        view="profiles"
        eyebrow="档案"
        title="未知档案"
        description="当前路由类型不在支持列表里。"
        contextTitle="档案页面"
        contextDescription="目前支持 `agent / machine / human` 三类。"
      >
        <SurfaceNotice title="不支持的档案类型" message={`当前不支持 \`${kind}\`。`} />
      </OpenShockShell>
    );
  }

  if (loading) {
    return (
      <OpenShockShell
        view="profiles"
        eyebrow="档案"
        title="正在同步档案"
        description="等待服务端返回当前档案真值。"
        contextTitle="档案页面"
        contextDescription="这页现在只读实时真值。"
      >
        <SurfaceNotice title="同步中" message="正在拉取智能体、机器和成员档案真值。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="profiles"
        eyebrow="档案"
        title="档案同步失败"
        description="当前没拿到服务端真值。"
        contextTitle="档案页面"
        contextDescription="先检查服务端是否在线，再重新打开这页。"
      >
        <SurfaceNotice title="同步失败" message={error} />
      </OpenShockShell>
    );
  }

  if (kind === "agent") {
    const agent = state.agents.find((item) => item.id === profileId);
    if (!agent) {
      return (
        <OpenShockShell
          view="profiles"
          eyebrow="智能体档案"
          title="未找到智能体"
          description="这个智能体可能已经不在当前服务端状态里。"
          contextTitle="档案页面"
          contextDescription="从主壳或讨论间重新进入，通常就能拿到最新对象。"
        >
          <SurfaceNotice title="未找到智能体" message={`当前找不到 \`${profileId}\` 对应的智能体真值。`} />
        </OpenShockShell>
      );
    }
    return <AgentProfileSurface state={state} agent={agent} />;
  }

  if (kind === "machine") {
    const machine = state.machines.find((item) => item.id === profileId || item.name === profileId);
    if (!machine) {
      return (
        <OpenShockShell
          view="profiles"
          eyebrow="机器档案"
          title="未找到机器"
          description="这台机器可能已经不在当前注册表里。"
          contextTitle="档案页面"
          contextDescription="从主壳或设置页重新进入，通常就能拿到最新对象。"
        >
          <SurfaceNotice title="未找到机器" message={`当前找不到 \`${profileId}\` 对应的机器真值。`} />
        </OpenShockShell>
      );
    }
    return <MachineProfileSurface state={state} machine={machine} />;
  }

  const member = state.auth.members.find((item) => item.id === profileId);
  if (!member) {
    return (
      <OpenShockShell
        view="profiles"
        eyebrow="成员档案"
        title="未找到成员"
        description="这个工作区成员可能已经不在当前名单里。"
        contextTitle="档案页面"
        contextDescription="从主壳重新进入通常就能拿到最新对象。"
      >
        <SurfaceNotice title="未找到成员" message={`当前找不到 \`${profileId}\` 对应的成员真值。`} />
      </OpenShockShell>
    );
  }
  return <HumanProfileSurface state={state} member={member} />;
}
