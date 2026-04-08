"use client";

import Link from "next/link";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type {
  AgentStatus,
  MachineStatus,
  PhaseZeroState,
  Room,
  Run,
  RuntimeRegistryRecord,
  WorkspaceMember,
} from "@/lib/mock-data";
import { buildProfileHref, isProfileKind, type ProfileKind } from "@/lib/profile-surface";

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

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
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

function AgentProfileSurface({
  state,
  agent,
}: {
  state: PhaseZeroState;
  agent: AgentStatus;
}) {
  const recentRuns = state.runs.filter((run) => agent.recentRunIds.includes(run.id));
  const recentRooms = state.rooms.filter((room) => recentRuns.some((run) => run.roomId === room.id));
  const runtimeRecords = state.runtimes.filter(
    (runtime) => runtime.machine === agent.runtimePreference || runtime.id === agent.runtimePreference
  );
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

  return (
    <OpenShockShell
      view="profiles"
      eyebrow="Agent Profile"
      title={agent.name}
      description={agent.description}
      contextTitle="Profile Presence"
      contextDescription="Agent profile 现在是前台读面：presence、runtime/capability、最近 run/room 关系和 memory spaces 都直接挂在同一张 surface。"
      contextBody={
        <DetailRail
          label="Agent Truth"
          items={[
            { label: "Presence", value: agentStateLabel(agent.state) },
            { label: "Provider", value: agent.provider },
            { label: "Runtime", value: agent.runtimePreference },
            { label: "Recent Runs", value: `${recentRuns.length} 条` },
          ]}
        />
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_0.88fr]">
        <div className="space-y-4">
          <Panel tone={toneForAgent(agent)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">
                  {agent.provider}
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
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              <ProfileMetric label="lane" value={agent.lane} />
              <ProfileMetric label="runtime" value={agent.runtimePreference} />
              <ProfileMetric label="mood" value={agent.mood} />
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Capability</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              当前 capability 直接从 runtime registry provider truth 组装，不再只剩一条 provider badge。
            </p>
            <CapabilityChips items={capabilityTruth} />
          </Panel>

          <Panel tone="paper">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Memory Spaces</p>
            <CapabilityChips items={agent.memorySpaces} />
          </Panel>
        </div>

        <div className="space-y-4">
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
      description="Machine profile 现在直接把 heartbeat、runtime capability、最近 runs 和已绑定 agents 收成一张前台 surface。"
      contextTitle="Machine Presence"
      contextDescription="这页只读 live machine/runtime truth，不去偷做后续 capability binding editor。"
      contextBody={
        <DetailRail
          label="Machine Truth"
          items={[
            { label: "Presence", value: machineStateLabel(machine.state) },
            { label: "CLI", value: machine.cli },
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
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              <ProfileMetric label="cli" value={machine.cli} />
              <ProfileMetric label="os" value={machine.os} />
              <ProfileMetric label="last heartbeat" value={machine.lastHeartbeat} />
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Runtime Capability</p>
            <CapabilityChips items={capabilityTruth} />
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {runtimeRecords.map((runtime) => (
                <div key={runtime.id} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                  <p className="font-display text-[18px] font-semibold">{runtime.id}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    {runtime.pairingState} · {runtime.state}
                  </p>
                  <p className="mt-2 text-sm leading-6">{runtime.daemonUrl}</p>
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
              meta: `${agent.state} · ${agent.provider} · ${agent.lane}`,
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
