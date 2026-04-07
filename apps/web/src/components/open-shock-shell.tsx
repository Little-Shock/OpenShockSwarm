"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  buildGlobalStats,
  tabs,
  utilityLinks,
  type AppTab,
  type MachineState,
  type PresenceState,
} from "@/lib/mock-data";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { WorkspaceStatusStrip } from "@/components/stitch-shell-primitives";

type ShellView = AppTab | "setup" | "issues" | "runs" | "agents" | "settings" | "memory" | "access";
type Tone = "yellow" | "pink" | "lime";
const ACCESS_UTILITY_LINK = { id: "access", label: "身份", href: "/access" } as const;

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

function activeFromView(view: ShellView): AppTab | null {
  if (
    view === "setup" ||
    view === "issues" ||
    view === "runs" ||
    view === "agents" ||
    view === "settings" ||
    view === "memory" ||
    view === "access"
  ) {
    return null;
  }

  return view;
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
  const { state, loading, error } = usePhaseZeroState();
  const shellUtilityLinks = utilityLinks.some((link) => link.id === ACCESS_UTILITY_LINK.id)
    ? utilityLinks
    : [...utilityLinks, ACCESS_UTILITY_LINK];
  const hasWorkspaceTruth = Boolean(state.workspace.name || state.workspace.repo || state.workspace.branch);
  const hasCollectionTruth =
    state.channels.length > 0 ||
    state.issues.length > 0 ||
    state.rooms.length > 0 ||
    state.runs.length > 0 ||
    state.agents.length > 0 ||
    state.machines.length > 0 ||
    state.inbox.length > 0 ||
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
    ? `${resolvedState.workspace.repoProvider || "local"} / ${resolvedState.workspace.branch || "unknown branch"}`
    : loading
      ? "等待 server 返回 workspace truth"
      : error
        ? "server workspace truth unavailable"
        : "local-first os";
  const stats = buildGlobalStats(resolvedState);
  const chatModeActive = activeTab !== null;
  const disconnected = loading || Boolean(error) || resolvedState.machines.every((machine) => machine.state === "offline");

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <aside className="hidden h-full min-h-0 flex-col border-r-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] md:flex">
          <div className="border-b-2 border-[var(--shock-ink)] px-2 py-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 border-2 border-[var(--shock-ink)] bg-black px-3 py-1.5 font-display text-base font-bold text-[var(--shock-yellow)] shadow-[var(--shock-shadow-sm)]"
            >
              <span className="truncate">{workspaceTitle}</span>
              <span className="font-mono text-[10px]">v</span>
            </button>
            <p className="mt-2 truncate px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
              {workspaceSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-2 border-b-2 border-[var(--shock-ink)] bg-white">
            <Link
              href="/chat/all"
              className={cn(
                "flex items-center justify-center border-r-2 border-[var(--shock-ink)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em]",
                chatModeActive ? "bg-[var(--shock-yellow)]" : "bg-white text-[color:rgba(24,20,14,0.72)]"
              )}
            >
              Chat
            </Link>
            <Link
              href="/setup"
              className={cn(
                "flex items-center justify-center px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em]",
                chatModeActive ? "bg-white text-[color:rgba(24,20,14,0.72)]" : "bg-[var(--shock-yellow)]"
              )}
            >
              Work
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            <section className="space-y-1">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={tab.href}
                  className={cn(
                    "flex items-center justify-between border-2 px-2 py-2 text-sm",
                    activeTab === tab.id
                      ? "border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)]"
                      : "border-transparent hover:border-[var(--shock-ink)] hover:bg-white"
                  )}
                >
                  <span>{tab.label}</span>
                  <span className="font-mono text-[10px]">
                    {tab.id === "chat"
                      ? resolvedState.channels.length
                      : tab.id === "rooms"
                        ? resolvedState.rooms.length
                        : tab.id === "inbox"
                          ? resolvedState.inbox.length
                          : resolvedState.issues.length}
                  </span>
                </Link>
              ))}
            </section>

            <section className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
                  Work Views
                </p>
                <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.52)]">
                  {shellUtilityLinks.length}
                </span>
              </div>
              <div className="space-y-1">
                {shellUtilityLinks.map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    className={cn(
                      "block border-2 px-2 py-2 text-sm transition-colors",
                      view === link.id
                        ? "border-[var(--shock-ink)] bg-[var(--shock-pink)] text-white shadow-[var(--shock-shadow-sm)]"
                        : "border-transparent hover:border-[var(--shock-ink)] hover:bg-white"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{link.label}</span>
                      <span className="font-mono text-[10px] uppercase">
                        {view === link.id ? "open" : "view"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
                  Channels
                </p>
                <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.52)]">
                  {resolvedState.channels.length}
                </span>
              </div>
              <div className="space-y-1">
                {resolvedState.channels.map((channel) => (
                  <Link
                    key={channel.id}
                    href={`/chat/${channel.id}`}
                    className={cn(
                      "block border-2 px-2 py-2 text-sm transition-colors",
                      selectedChannelId === channel.id
                        ? "border-[var(--shock-ink)] bg-[var(--shock-pink)] text-white shadow-[var(--shock-shadow-sm)]"
                        : "border-transparent hover:border-[var(--shock-ink)] hover:bg-white"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{channel.name}</span>
                      {channel.unread > 0 ? (
                        <span className="ml-auto min-w-5 border border-[var(--shock-ink)] bg-white px-1 text-center font-mono text-[10px] text-[var(--shock-ink)]">
                          {channel.unread}
                        </span>
                      ) : null}
                    </div>
                    <p className={cn("mt-1 truncate text-[11px]", selectedChannelId === channel.id ? "text-white/80" : "text-[color:rgba(24,20,14,0.56)]")}>
                      {channel.summary}
                    </p>
                  </Link>
                ))}
              </div>
            </section>

            <section className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
                  Rooms
                </p>
                <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.52)]">
                  {resolvedState.rooms.length}
                </span>
              </div>
              <div className="space-y-1">
                {resolvedState.rooms.map((room) => (
                  <Link
                    key={room.id}
                    href={`/rooms/${room.id}`}
                    className={cn(
                      "block border-2 px-2 py-2 text-sm transition-colors",
                      selectedRoomId === room.id
                        ? "border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)]"
                        : "border-transparent hover:border-[var(--shock-ink)] hover:bg-white"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{room.title}</span>
                      <span className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-1.5 py-0.5 font-mono text-[9px] uppercase">
                        {room.issueKey}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                      {room.topic.status}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <div className="border-t-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-2">
            <div className="border-2 border-[var(--shock-ink)] bg-white px-2 py-2 text-[11px] shadow-[var(--shock-shadow-sm)]">
              <div className="flex items-center justify-between">
                <span>Repo</span>
                <span className="font-mono text-[10px] uppercase">{resolvedState.workspace.branch || "syncing"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Runtime</span>
                <span className="font-mono text-[10px] uppercase">{resolvedState.workspace.pairedRuntime || "none"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Agents</span>
                <span className="font-mono">{resolvedState.agents.length}</span>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-white">
          <WorkspaceStatusStrip workspaceName={workspaceTitle} disconnected={disconnected} />

          <header className="border-b-2 border-[var(--shock-ink)] bg-white">
            <div className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)_auto] xl:items-center">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.52)]">
                  {eyebrow}
                </p>
                <h1 className="mt-1 truncate font-display text-[26px] font-bold leading-none">{title}</h1>
                <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[color:rgba(24,20,14,0.66)]">
                  {description}
                </p>
              </div>

              <div className="flex items-center gap-2 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] font-mono text-[10px] font-bold">
                  K
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                    Quick Search
                  </p>
                  <p className="truncate font-medium text-[12px]">
                    Search issue / run / agent / machine
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {shellUtilityLinks.slice(0, 4).map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    className={cn(
                      "border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]",
                      view === link.id ? "bg-[var(--shock-yellow)]" : "bg-white hover:bg-[var(--shock-paper)]"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </header>

          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div>
                <p className="font-display text-[18px] font-bold">{contextTitle}</p>
                <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:rgba(24,20,14,0.66)]">
                  {contextDescription}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {stats.map((stat) => (
                  <span
                    key={stat.label}
                    className={cn(
                      "border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                      statTone(stat.tone)
                    )}
                  >
                    {stat.label} {stat.value}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-0 overflow-y-auto bg-white p-4 xl:min-h-0">{children}</div>
            <aside className="hidden min-h-0 border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex xl:flex-col">
              <div className="flex-1 overflow-y-auto p-4">
                {contextBody ?? (
                  <section className="border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">MVP Contract</p>
                    <ul className="mt-3 space-y-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.76)]">
                      <li>频道负责轻松讨论，不直接背负执行压力。</li>
                      <li>严肃工作必须进入讨论间，并和 Run 保持绑定。</li>
                      <li>Topic 可见，Session 继续留在系统内部。</li>
                      <li>任务板只做辅助，不取代聊天和房间。</li>
                    </ul>
                  </section>
                )}

                <section className="mt-4 border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Live Machines</p>
                    <span className="font-mono text-[10px] uppercase">{resolvedState.machines.length}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {resolvedState.machines.map((machine) => (
                      <div key={machine.id} className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold">{machine.name}</p>
                          <span className={cn("border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase", machineTone(machine.state))}>
                            {machineStateLabel(machine.state)}
                          </span>
                        </div>
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                          {machine.cli}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="mt-4 border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Agents</p>
                    <span className="font-mono text-[10px] uppercase">{resolvedState.agents.length}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {resolvedState.agents.slice(0, 5).map((agent) => (
                      <Link
                        key={agent.id}
                        href={`/agents/${agent.id}`}
                        className="block border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate font-semibold">{agent.name}</p>
                          <span className={cn("border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase", agentTone(agent.state))}>
                            {agentStateLabel(agent.state)}
                          </span>
                        </div>
                        <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                          {agent.lane}
                        </p>
                      </Link>
                    ))}
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
