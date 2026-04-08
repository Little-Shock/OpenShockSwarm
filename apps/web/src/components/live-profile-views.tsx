"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveMemoryCenter } from "@/lib/live-memory";
import type {
  AgentStatus,
  AuthSession,
  MachineStatus,
  PhaseZeroState,
  Room,
  Run,
  RuntimeRegistryRecord,
  WorkspaceMember,
} from "@/lib/mock-data";
import { buildProfileHref, isProfileKind, type ProfileKind } from "@/lib/profile-surface";

const PROFILE_MEMORY_SPACE_OPTIONS = [
  { value: "workspace", label: "Workspace", summary: "MEMORY.md / work-log" },
  { value: "issue-room", label: "Issue Room", summary: "当前 issue 的房间上下文" },
  { value: "room-notes", label: "Room Notes", summary: "notes/rooms/* ledger" },
  { value: "topic", label: "Topic", summary: "decision / topic context" },
  { value: "user", label: "Agent Memory", summary: ".openshock/agents/*/MEMORY.md" },
] as const;

const AGENT_RECALL_POLICY_OPTIONS = [
  { value: "governed-first", label: "Governed First" },
  { value: "balanced", label: "Balanced" },
  { value: "agent-first", label: "Agent First" },
] as const;

function valueOrPlaceholder(value: string | undefined | null, fallback: string) {
  return value && value.trim() ? value : fallback;
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
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Profile Audit</p>
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
                      <span className="font-semibold">Before:</span> {valueOrPlaceholder(change.previous, "empty")}
                    </p>
                    <p className="text-sm leading-6">
                      <span className="font-semibold">After:</span> {valueOrPlaceholder(change.current, "empty")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6 text-[color:rgba(24,20,14,0.68)]">
            这条 agent 还没有 profile audit 记录。
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
      meta: `${session.status} · ${session.machine} · ${session.worktree}`,
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
  }, [
    agent.avatar,
    agent.id,
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

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveStatus(null);

    try {
      await updateAgentProfile(agent.id, {
        role: roleDraft,
        avatar: avatarDraft,
        prompt: promptDraft,
        operatingInstructions: instructionsDraft,
        providerPreference: providerPreferenceDraft,
        modelPreference: modelPreferenceDraft,
        recallPolicy: recallPolicyDraft,
        runtimePreference: runtimePreferenceDraft,
        memorySpaces: memorySpacesDraft,
      });
      await refreshMemoryCenter();
      setSaveStatus("Agent profile 已写回后端 truth，next-run preview 已同步刷新。");
    } catch (mutationError) {
      setSaveError(mutationError instanceof Error ? mutationError.message : "保存 Agent profile 失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OpenShockShell
      view="profiles"
      eyebrow="Agent Profile"
      title={agent.name}
      description={agent.description}
      contextTitle="Profile Presence"
      contextDescription="Agent profile 现在把 role / prompt / memory binding 和 runtime affinity contract 放在同一页：provider、model、runtime 直接对齐 machine provider truth 与 model catalog suggestion，不再长第二套 shadow state。"
      contextBody={
        <DetailRail
          label="Agent Truth"
          items={[
            { label: "Presence", value: agentStateLabel(agent.state) },
            { label: "Role", value: agent.role },
            { label: "Provider Pref", value: agent.providerPreference },
            { label: "Model", value: valueOrPlaceholder(agent.modelPreference, "未设置") },
            { label: "Runtime", value: agent.runtimePreference },
            { label: "Recall", value: agent.recallPolicy },
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
              <ProfileMetric label="lane" value={agent.lane} />
              <ProfileMetric label="provider" value={agent.providerPreference} />
              <ProfileMetric label="model" value={valueOrPlaceholder(agent.modelPreference, "未设置")} />
              <ProfileMetric label="runtime" value={agent.runtimePreference} />
            </div>
            <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
              <span className="font-semibold">Prompt:</span> {agent.prompt}
            </p>
            <p className="mt-2 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
              <span className="font-semibold">Operating Instructions:</span> {valueOrPlaceholder(agent.operatingInstructions, "尚未写 operating instructions")}
            </p>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Capability</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              当前 capability 直接从 runtime registry provider truth 组装，不再只剩一条 provider badge。
            </p>
            <CapabilityChips items={capabilityTruth} />
          </Panel>

          <Panel tone="paper">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Bound Runtime Catalog</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                {selectedRuntimeRecord ? selectedRuntimeRecord.id : "未命中 runtime"}
              </span>
            </div>
            {selectedRuntimeRecord ? (
              <div className="mt-3 space-y-3" data-testid="profile-binding-runtime-card">
                <div className="grid gap-2 md:grid-cols-4">
                  <ProfileMetric label="machine" value={selectedRuntimeRecord.machine} />
                  <ProfileMetric label="shell" value={valueOrPlaceholder(selectedRuntimeRecord.shell, "未返回")} testId="profile-binding-shell" />
                  <ProfileMetric label="daemon" value={valueOrPlaceholder(selectedRuntimeRecord.daemonUrl, "未配对")} />
                  <ProfileMetric
                    label="cli"
                    value={valueOrPlaceholder(selectedRuntimeRecord.detectedCli.join(" + "), "未返回")}
                    testId="profile-binding-cli"
                  />
                </div>
                <RuntimeProviderInventory runtime={selectedRuntimeRecord} testPrefix="profile-binding" />
              </div>
            ) : (
              <p className="mt-3 rounded-[16px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
                当前 draft 还没命中任何 runtime provider/catalog；先从已注册 machine truth 里选一条 runtime affinity。
              </p>
            )}
          </Panel>

          <Panel tone="paper">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Memory Spaces</p>
            <CapabilityChips items={agent.memorySpaces} />
          </Panel>

          <Panel tone="white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Agent Profile Editor</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                {canEdit ? "workspace.manage" : "read only"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这层把 `role / avatar / prompt / provider / model / runtime affinity / memory binding / recall policy` 直接写回 live server truth；保存后同页会回读 next-run preview。
            </p>
            {!canEdit ? (
              <p className="mt-3 rounded-[16px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm leading-6">
                当前 session 没有 `workspace.manage`。仍可检查 profile / preview / audit，但编辑保持只读。
              </p>
            ) : null}
            <form className="mt-4 space-y-4" onSubmit={handleSave}>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Role</span>
                  <input
                    data-testid="profile-editor-role"
                    className="mt-1.5 w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm"
                    value={roleDraft}
                    onChange={(event) => setRoleDraft(event.target.value)}
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Avatar</span>
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
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Prompt</span>
                <textarea
                  data-testid="profile-editor-prompt"
                  className="mt-1.5 min-h-[110px] w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm leading-6"
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  disabled={!canEdit || saving}
                />
              </label>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Operating Instructions</span>
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Runtime Affinity</span>
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Provider Preference</span>
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Default Model</span>
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
                    runtime 侧这份 model catalog 只提供 suggestion；可直接输入本机配置里的 model id，不按静态目录做硬拒绝。
                  </p>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Recall Policy</span>
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
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Memory Binding</p>
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

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  data-testid="profile-editor-save"
                  disabled={!canEdit || saving}
                  className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:bg-[var(--shock-paper)]"
                >
                  {saving ? "Saving..." : "Save Profile"}
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
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Next-Run Preview</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这块直接吃 `/v1/memory-center` 的 session-level preview；profile save 后这里应立刻反映新的 recall policy、memory binding 和 prompt skeleton。
            </p>
            {centerLoading ? (
              <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">正在同步 next-run preview…</p>
            ) : centerError ? (
              <p className="mt-3 rounded-[16px] border border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">{centerError}</p>
            ) : preview ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                    {preview.sessionId} · {preview.recallPolicy}
                  </p>
                  <pre
                    data-testid="profile-next-run-preview-summary"
                    className="mt-2 whitespace-pre-wrap font-mono text-[12px] leading-6 text-[color:rgba(24,20,14,0.82)]"
                  >
                    {preview.promptSummary}
                  </pre>
                </div>
                <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">Mounted Files</p>
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
                当前 agent 还没有可对齐的 session preview。
              </p>
            )}
          </Panel>

          <AgentProfileAuditPanel audit={agent.profileAudit} />

          <RelationshipList
            title="Recent Runs"
            items={recentRuns.map((run) => ({
              id: run.id,
              label: run.id,
              href: runLink(run),
              meta: `${run.status} · ${run.roomId} · ${run.machine}`,
            }))}
          />
          <RelationshipList
            title="Recent Rooms"
            items={recentRooms.map((room) => ({
              id: room.id,
              label: room.title,
              href: roomLink(room),
              meta: `${room.issueKey} · ${room.topic.status} · ${room.topic.owner}`,
            }))}
          />
          <RelationshipList
            title="Related Humans"
            items={relatedHumans.map((member) => ({
              id: member.id,
              label: member.name,
              href: buildProfileHref("human", member.id),
              meta: `${member.role} · ${valueOrPlaceholder(member.lastSeenAt, "未返回 last seen")}`,
            }))}
          />
          <RelationshipList
            title="Live Sessions"
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
      eyebrow="Machine Profile"
      title={machine.name}
      description="Machine profile 现在把 heartbeat、shell、daemon、provider-model catalog、最近 runs 和已绑定 agents 收成一张前台 surface。"
      contextTitle="Machine Presence"
      contextDescription="这页只读 live machine/runtime truth；binding editor 继续留在 Agent profile，但 `/setup`、`/agents` 和这里都读同一份 provider/model catalog。"
      contextBody={
        <DetailRail
          label="Machine Truth"
          items={[
            { label: "Presence", value: machineStateLabel(machine.state) },
            { label: "CLI", value: machine.cli },
            { label: "Shell", value: valueOrPlaceholder(machine.shell, "未返回") },
            { label: "Heartbeat", value: machine.lastHeartbeat },
            { label: "Leases", value: `${leases.length} 条` },
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
              <ProfileMetric label="cli" value={machine.cli} />
              <ProfileMetric label="shell" value={valueOrPlaceholder(machine.shell, "未返回")} testId="machine-profile-shell" />
              <ProfileMetric label="os" value={machine.os} />
              <ProfileMetric label="last heartbeat" value={machine.lastHeartbeat} />
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Runtime Capability</p>
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
                    <ProfileMetric label="daemon" value={valueOrPlaceholder(runtime.daemonUrl, "未配对")} />
                    <ProfileMetric label="cli" value={valueOrPlaceholder(runtime.detectedCli.join(" + "), machine.cli)} />
                    <ProfileMetric label="models" value={`${runtime.providers.reduce((sum, provider) => sum + providerModelList(provider).length, 0)} 个`} />
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
            title="Recent Runs"
            items={activeRuns.map((run) => ({
              id: run.id,
              label: run.id,
              href: runLink(run),
              meta: `${run.status} · ${run.owner} · ${run.roomId}`,
            }))}
          />
          <RelationshipList
            title="Recent Rooms"
            items={recentRooms.map((room) => ({
              id: room.id,
              label: room.title,
              href: roomLink(room),
              meta: `${room.issueKey} · ${room.topic.status}`,
            }))}
          />
          <RelationshipList
            title="Bound Agents"
            items={relatedAgents.map((agent) => ({
              id: agent.id,
              label: agent.name,
              href: buildProfileHref("agent", agent.id),
              meta: `${agent.state} · ${agent.providerPreference} / ${valueOrPlaceholder(agent.modelPreference, "未设置")} · ${agent.lane}`,
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
      eyebrow="Human Profile"
      title={member.name}
      description="Human profile 现在直接把 session、role/permission、最近 run/room 关系和成员 presence 收在同一条前台面里。"
      contextTitle="Human Presence"
      contextDescription="这张 profile 只读当前 workspace member truth，不提前混入更大的 onboarding / template / durable config 票。"
      contextBody={
        <DetailRail
          label="Human Truth"
          items={[
            { label: "Presence", value: humanPresenceLabel(member, authSession) },
            { label: "Role", value: member.role },
            { label: "Permissions", value: `${member.permissions.length} 项` },
            { label: "Last Seen", value: valueOrPlaceholder(member.lastSeenAt, "未返回") },
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
              <ProfileMetric label="role" value={member.role} />
              <ProfileMetric label="status" value={member.status} />
              <ProfileMetric label="source" value={valueOrPlaceholder(member.source, "seed")} />
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Capability / Permission</p>
            <CapabilityChips items={member.permissions} />
          </Panel>

          {authSession ? (
            <Panel tone="paper">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Current Session</p>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                <ProfileMetric label="auth method" value={valueOrPlaceholder(authSession.authMethod, "未返回")} />
                <ProfileMetric label="signed in" value={valueOrPlaceholder(authSession.signedInAt, "未返回")} />
                <ProfileMetric label="last seen" value={valueOrPlaceholder(authSession.lastSeenAt, "未返回")} />
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <RelationshipList
            title="Recent Runs"
            items={recentRuns.map((run) => ({
              id: run.id,
              label: run.id,
              href: runLink(run),
              meta: `${run.status} · ${run.machine} · ${run.roomId}`,
            }))}
          />
          <RelationshipList
            title="Recent Rooms"
            items={ownedRooms.map((room) => ({
              id: room.id,
              label: room.title,
              href: roomLink(room),
              meta: `${room.issueKey} · ${room.topic.status}`,
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
        eyebrow="Profile"
        title="未知 Profile"
        description="当前 route kind 不在支持列表里。"
        contextTitle="Profile Surface"
        contextDescription="支持 `agent / machine / human` 三类。"
      >
        <SurfaceNotice title="不支持的 profile kind" message={`当前不支持 \`${kind}\`。`} />
      </OpenShockShell>
    );
  }

  if (loading) {
    return (
      <OpenShockShell
        view="profiles"
        eyebrow="Profile"
        title="正在同步 Profile"
        description="等待 server 返回当前 profile truth。"
        contextTitle="Profile Surface"
        contextDescription="这页现在只读 live truth。"
      >
        <SurfaceNotice title="同步中" message="正在拉取 Agent / Machine / Human profile truth。" />
      </OpenShockShell>
    );
  }

  if (error) {
    return (
      <OpenShockShell
        view="profiles"
        eyebrow="Profile"
        title="Profile 同步失败"
        description="当前没拿到 server truth。"
        contextTitle="Profile Surface"
        contextDescription="先检查 server 是否在线，再重新打开这页。"
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
          eyebrow="Agent Profile"
          title="未找到 Agent"
          description="这个 Agent 可能已经不在当前 server state 里。"
          contextTitle="Profile Surface"
          contextDescription="从 shell 或 room 重新进入通常就能拿到最新对象。"
        >
          <SurfaceNotice title="未找到 Agent" message={`当前找不到 \`${profileId}\` 对应的 agent truth。`} />
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
          eyebrow="Machine Profile"
          title="未找到 Machine"
          description="这个 Machine 可能已经不在当前 registry 里。"
          contextTitle="Profile Surface"
          contextDescription="从 shell 或 setup 重新进入通常就能拿到最新对象。"
        >
          <SurfaceNotice title="未找到 Machine" message={`当前找不到 \`${profileId}\` 对应的 machine truth。`} />
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
        eyebrow="Human Profile"
        title="未找到 Human"
        description="这个 workspace member 可能已经不在当前 roster 里。"
        contextTitle="Profile Surface"
        contextDescription="从 shell 重新进入通常就能拿到最新对象。"
      >
        <SurfaceNotice title="未找到 Human" message={`当前找不到 \`${profileId}\` 对应的 member truth。`} />
      </OpenShockShell>
    );
  }
  return <HumanProfileSurface state={state} member={member} />;
}
