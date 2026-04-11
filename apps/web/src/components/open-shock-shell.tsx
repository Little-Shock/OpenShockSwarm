"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { SidebarProfileEntry } from "@/components/stitch-shell-primitives";
import { buildGlobalStats } from "@/lib/phase-zero-helpers";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type { AppTab, MachineState, PresenceState } from "@/lib/phase-zero-types";
import { buildProfileHref } from "@/lib/profile-surface";
import { useQuickSearchController } from "@/lib/quick-search";
import {
  QuickSearchSurface,
  StitchSidebar,
  StitchTopBar,
  WorkspaceStatusStrip,
} from "@/components/stitch-shell-primitives";

type ShellView = AppTab | "setup" | "issues" | "runs" | "agents" | "settings" | "memory" | "access" | "profiles" | "mailbox" | "topic";
type Tone = "yellow" | "pink" | "lime";

type OpenShockShellProps = {
  view: ShellView;
  title: string;
  eyebrow: string;
  description: string;
  selectedChannelId?: string;
  selectedRoomId?: string;
  contextTitle: string;
  contextDescription: string;
  contextBody?: ReactNode;
  children: ReactNode;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function activeFromView(view: ShellView): "channels" | "rooms" | "inbox" | "board" | null {
  if (
    view === "setup" ||
    view === "issues" ||
    view === "runs" ||
    view === "agents" ||
    view === "settings" ||
    view === "memory" ||
    view === "mailbox" ||
    view === "access" ||
    view === "profiles" ||
    view === "topic"
  ) {
    return null;
  }

  if (view === "chat") {
    return "channels";
  }

  return view;
}

function shellModeFromView(view: ShellView): "chat" | "work" {
  return activeFromView(view) === null ? "work" : "chat";
}

function topBarHrefFromView(view: ShellView) {
  switch (view) {
    case "issues":
      return "/issues";
    case "runs":
      return "/runs";
    case "agents":
      return "/agents";
    case "setup":
      return "/setup";
    case "memory":
      return "/memory";
    case "mailbox":
      return "/mailbox";
    default:
      return undefined;
  }
}

function statTone(tone: Tone) {
  switch (tone) {
    case "yellow":
      return "bg-[var(--shock-yellow)]";
    case "pink":
      return "bg-[var(--shock-pink)] text-white";
    case "lime":
      return "bg-[var(--shock-lime)]";
  }
}

function machineTone(state: MachineState) {
  switch (state) {
    case "busy":
      return "bg-[var(--shock-yellow)] text-[var(--shock-ink)]";
    case "online":
      return "bg-[var(--shock-lime)] text-[var(--shock-ink)]";
    default:
      return "bg-white text-[var(--shock-ink)]";
  }
}

function agentTone(state: PresenceState) {
  switch (state) {
    case "running":
      return "bg-[var(--shock-yellow)] text-[var(--shock-ink)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    default:
      return "bg-white text-[var(--shock-ink)]";
  }
}

function machineStateLabel(state: MachineState) {
  switch (state) {
    case "busy":
      return "忙碌";
    case "online":
      return "在线";
    default:
      return "离线";
  }
}

function agentStateLabel(state: PresenceState) {
  switch (state) {
    case "running":
      return "执行中";
    case "blocked":
      return "阻塞";
    default:
      return "待命";
  }
}

function humanTone(active: boolean, status: string) {
  if (active) {
    return "bg-[var(--shock-lime)] text-[var(--shock-ink)]";
  }
  if (status === "suspended") {
    return "bg-[var(--shock-pink)] text-white";
  }
  if (status === "invited") {
    return "bg-[var(--shock-paper)] text-[var(--shock-ink)]";
  }
  return "bg-white text-[var(--shock-ink)]";
}

function humanStateLabel(active: boolean, status: string) {
  if (active) {
    return "在线";
  }
  switch (status) {
    case "suspended":
      return "停用";
    case "invited":
      return "待加入";
    default:
      return "可协作";
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
      return role || "成员";
  }
}

export function OpenShockShell({
  view,
  title,
  eyebrow,
  description,
  selectedChannelId,
  selectedRoomId,
  contextTitle,
  contextDescription,
  contextBody,
  children,
}: OpenShockShellProps) {
  const activeTab = activeFromView(view);
  const shellMode = shellModeFromView(view);
  const currentHref = topBarHrefFromView(view);
  const { state, loading, error } = usePhaseZeroState();
  const hasWorkspaceTruth = Boolean(state.workspace.name || state.workspace.repo || state.workspace.branch);
  const hasCollectionTruth =
    state.channels.length > 0 ||
    state.issues.length > 0 ||
    state.rooms.length > 0 ||
    state.runs.length > 0 ||
    state.agents.length > 0 ||
    state.machines.length > 0 ||
    state.inbox.length > 0 ||
    state.mailbox.length > 0 ||
    state.pullRequests.length > 0 ||
    state.sessions.length > 0 ||
    state.memory.length > 0 ||
    Object.keys(state.channelMessages).length > 0 ||
    Object.keys(state.roomMessages).length > 0;
  const resolvedState =
    loading || (!hasCollectionTruth && Boolean(error))
      ? {
          ...state,
          channels: [],
          channelMessages: {},
          issues: [],
          rooms: [],
          roomMessages: {},
          runs: [],
          agents: [],
          machines: [],
          inbox: [],
          mailbox: [],
          pullRequests: [],
          sessions: [],
          memory: [],
        }
      : state;
  const workspaceTitle = hasWorkspaceTruth
    ? resolvedState.workspace.name
    : loading
      ? "同步工作区"
      : error
        ? "工作区未同步"
        : "OpenShock";
  const workspaceSubtitle = hasWorkspaceTruth
    ? `${resolvedState.workspace.branch || "分支未返回"} · ${resolvedState.workspace.pairedRuntime || "运行环境未连接"}`
    : loading
      ? "正在连接工作区"
      : error
        ? "暂时无法连接工作区"
        : "本地优先协作台";
  const stats = buildGlobalStats(resolvedState);
  const disconnected = loading || Boolean(error) || resolvedState.machines.every((machine) => machine.state === "offline");
  const inboxCount = resolvedState.inbox.length;
  const activeMemberId = resolvedState.auth.session.memberId;
  const activeMember =
    resolvedState.auth.members.find((member) => member.id === activeMemberId) ?? resolvedState.auth.members[0];
  const pairedMachine =
    resolvedState.machines.find(
      (machine) =>
        machine.id === resolvedState.workspace.pairedRuntime || machine.name === resolvedState.workspace.pairedRuntime
    ) ??
    resolvedState.machines.find((machine) => machine.state === "busy") ??
    resolvedState.machines.find((machine) => machine.state === "online") ??
    resolvedState.machines[0];
  const preferredAgent =
    resolvedState.agents.find((agent) => agent.id === resolvedState.auth.session.preferences.preferredAgentId) ??
    resolvedState.agents.find((agent) => agent.state === "running") ??
    resolvedState.agents.find((agent) => agent.state === "blocked") ??
    resolvedState.agents[0];
  const shellProfileEntries: SidebarProfileEntry[] = [];

  if (activeMember) {
    const active = activeMember.id === activeMemberId && resolvedState.auth.session.status === "active";
    shellProfileEntries.push({
      id: "human",
      badge: "我",
      title: activeMember.name,
      meta: `${workspaceRoleLabel(activeMember.role)} · ${activeMember.email}`,
      href: buildProfileHref("human", activeMember.id),
      status: humanStateLabel(active, activeMember.status),
      tone: active ? "lime" : activeMember.status === "suspended" ? "pink" : "white",
    });
  }

  if (pairedMachine) {
    shellProfileEntries.push({
      id: "machine",
      badge: "机",
      title: pairedMachine.name,
      meta: `${pairedMachine.cli} · ${pairedMachine.shell}`,
      href: buildProfileHref("machine", pairedMachine.id),
      status: machineStateLabel(pairedMachine.state),
      tone: pairedMachine.state === "busy" ? "yellow" : pairedMachine.state === "online" ? "lime" : "white",
    });
  }

  if (preferredAgent) {
    shellProfileEntries.push({
      id: "agent",
      badge: "智",
      title: preferredAgent.name,
      meta: `${preferredAgent.role} · ${preferredAgent.lane}`,
      href: buildProfileHref("agent", preferredAgent.id),
      status: agentStateLabel(preferredAgent.state),
      tone: preferredAgent.state === "running" ? "yellow" : preferredAgent.state === "blocked" ? "pink" : "white",
    });
  }
  const quickSearch = useQuickSearchController(resolvedState);

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] md:grid-cols-[258px_minmax(0,1fr)]">
        <StitchSidebar
          active={activeTab}
          mode={shellMode}
          channels={resolvedState.channels}
          rooms={resolvedState.rooms}
          machines={resolvedState.machines}
          agents={resolvedState.agents}
          workspaceName={workspaceTitle}
          workspaceSubtitle={workspaceSubtitle}
          selectedChannelId={selectedChannelId}
          selectedRoomId={selectedRoomId}
          inboxCount={inboxCount}
          profileEntries={shellProfileEntries}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />

        <section className="flex min-h-0 flex-col bg-[var(--shock-paper)]">
          <WorkspaceStatusStrip workspaceName={workspaceTitle} disconnected={disconnected} />
          <StitchTopBar
            eyebrow={eyebrow}
            title={title}
            description={description}
            searchPlaceholder="搜索频道 / 讨论间 / 话题 / 事项 / 运行 / 智能体"
            currentHref={currentHref}
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />

          <div className="border-b-2 border-[var(--shock-ink)] bg-[#f3ead3] px-3 py-2 md:px-4">
            <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div>
                <p className="font-display text-[17px] font-bold">{contextTitle}</p>
                <p className="mt-1 max-w-3xl text-[11px] leading-5 text-[color:rgba(24,20,14,0.66)]">
                  {contextDescription}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {stats.map((stat) => (
                  <span
                    key={stat.label}
                    className={cn(
                      "rounded-[10px] border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                      statTone(stat.tone)
                    )}
                  >
                    {stat.label} {stat.value}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_288px]">
            <div className="min-h-0 overflow-y-auto bg-[var(--shock-paper)] px-2 py-2.5 md:px-3 xl:min-h-0">
              {children}
            </div>
            <aside className="hidden min-h-0 border-l-2 border-[var(--shock-ink)] bg-[#efe5ce] xl:flex xl:flex-col">
              <div className="flex-1 overflow-y-auto p-2.5">
                {contextBody ?? (
                  <section className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white p-2.5 shadow-[var(--shock-shadow-sm)]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">当前原则</p>
                    <ul className="mt-2.5 space-y-1.5 text-[12px] leading-5 text-[color:rgba(24,20,14,0.76)]">
                      <li>频道负责轻松讨论，不直接背负执行压力。</li>
                      <li>严肃工作必须进入讨论间，并和当前运行保持绑定。</li>
                      <li>话题可见，会话继续留在系统内部。</li>
                      <li>任务板只做辅助，不取代聊天和房间。</li>
                    </ul>
                  </section>
                )}

                <section className="mt-2.5 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white p-2.5 shadow-[var(--shock-shadow-sm)]">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">运行机器</p>
                    <span className="font-mono text-[10px] uppercase">{resolvedState.machines.length}</span>
                  </div>
                  <div className="mt-2.5 space-y-2">
                    {resolvedState.machines.map((machine) => (
                      <Link
                        key={machine.id}
                        href={buildProfileHref("machine", machine.id)}
                        data-testid={`shell-machine-profile-${machine.id}`}
                        className="block rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2.5 py-2.5 transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#efe5ce]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold">{machine.name}</p>
                          <span className={cn("rounded-full border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase", machineTone(machine.state))}>
                            {machineStateLabel(machine.state)}
                          </span>
                        </div>
                        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                          {machine.cli}
                        </p>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="mt-2.5 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white p-2.5 shadow-[var(--shock-shadow-sm)]">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">智能体</p>
                    <span className="font-mono text-[10px] uppercase">{resolvedState.agents.length}</span>
                  </div>
                  <div className="mt-2.5 space-y-2">
                    {resolvedState.agents.slice(0, 5).map((agent) => (
                      <Link
                        key={agent.id}
                        href={buildProfileHref("agent", agent.id)}
                        data-testid={`shell-agent-profile-${agent.id}`}
                        className="block rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2.5 py-2.5 transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#efe5ce]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate font-semibold">{agent.name}</p>
                          <span className={cn("rounded-full border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase", agentTone(agent.state))}>
                            {agentStateLabel(agent.state)}
                          </span>
                        </div>
                        <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                          {agent.lane}
                        </p>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="mt-2.5 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white p-2.5 shadow-[var(--shock-shadow-sm)]">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">成员</p>
                    <span className="font-mono text-[10px] uppercase">{resolvedState.auth.members.length}</span>
                  </div>
                  <div className="mt-2.5 space-y-2">
                    {resolvedState.auth.members.slice(0, 5).map((member) => {
                      const active = activeMemberId === member.id && resolvedState.auth.session.status === "active";
                      return (
                        <Link
                          key={member.id}
                          href={buildProfileHref("human", member.id)}
                          data-testid={`shell-human-profile-${member.id}`}
                          className="block rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2.5 py-2.5 transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#efe5ce]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 truncate font-semibold">{member.name}</p>
                            <span className={cn("rounded-full border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase", humanTone(active, member.status))}>
                              {humanStateLabel(active, member.status)}
                            </span>
                          </div>
                          <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                            {workspaceRoleLabel(member.role)} · {member.email}
                          </p>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
