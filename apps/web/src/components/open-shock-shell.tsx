"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  buildGlobalStats,
  fallbackState,
  tabs,
  utilityLinks,
  type AppTab,
  type MachineState,
  type PresenceState,
} from "@/lib/mock-data";
import { usePhaseZeroState } from "@/lib/live-phase0";

type ShellView = AppTab | "setup" | "issues" | "agents" | "settings";
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

function activeFromView(view: ShellView): AppTab | null {
  if (view === "setup" || view === "issues" || view === "agents" || view === "settings") {
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
  const { state } = usePhaseZeroState();
  const resolvedState = state.channels.length > 0 ? state : fallbackState;
  const stats = buildGlobalStats(resolvedState);

  return (
    <main className="min-h-screen bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="mx-auto flex min-h-screen max-w-[1860px] flex-col px-2 py-2 md:px-3 md:py-3">
        <div className="grid min-h-[calc(100vh-1rem)] gap-0 overflow-hidden rounded-[12px] border-2 border-[var(--shock-ink)] bg-white shadow-[6px_6px_0_0_var(--shock-ink)] xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="flex min-h-full flex-col border-r-2 border-[var(--shock-ink)] bg-[var(--shock-card)]">
            <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-[6px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] font-mono text-sm font-bold">
                  OS
                </div>
                <div>
                  <p className="font-display text-lg font-bold leading-none">{resolvedState.workspace.name}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">
                    local-first os
                  </p>
                </div>
              </div>
            </div>

            <div className="border-b-2 border-[var(--shock-ink)] px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
                OpenShock.ai
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                聊天在频道，认真干活进讨论间。
              </p>
            </div>

            <div className="border-b-2 border-[var(--shock-ink)] px-3 py-3">
              <nav className="space-y-2">
                {tabs.map((tab) => (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    className={cn(
                      "block rounded-[8px] border-2 border-[var(--shock-ink)] px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.18em] transition-transform duration-150 hover:-translate-y-0.5",
                      activeTab === tab.id
                        ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]"
                        : "bg-white"
                    )}
                  >
                    {tab.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 space-y-2">
                {utilityLinks.map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    className={cn(
                      "block rounded-[8px] border-2 border-[var(--shock-ink)] px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.16em] transition-transform hover:-translate-y-0.5",
                      view === link.id ? "bg-[var(--shock-pink)] text-white" : "bg-[var(--shock-paper)]"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
              <section>
                <div className="mb-3 flex items-center justify-between px-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    频道
                  </p>
                  <span className="rounded-[6px] border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    公屏
                  </span>
                </div>
                <div className="space-y-2">
                  {resolvedState.channels.map((channel) => (
                    <Link
                      key={channel.id}
                      href={`/chat/${channel.id}`}
                      className={cn(
                        "block rounded-[8px] border-2 border-[var(--shock-ink)] px-3 py-3 transition-all duration-150 hover:-translate-y-0.5",
                        selectedChannelId === channel.id
                          ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]"
                          : "bg-white"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-lg font-semibold">{channel.name}</p>
                          <p className="mt-1 text-sm leading-5 text-[color:rgba(24,20,14,0.74)]">
                            {channel.summary}
                          </p>
                        </div>
                        <span className="min-w-9 rounded-[6px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-2 py-1 text-center font-mono text-[11px]">
                          {channel.unread}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between px-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    讨论间
                  </p>
                  <span className="rounded-[6px] border border-[var(--shock-ink)] bg-[var(--shock-pink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white">
                    干活
                  </span>
                </div>
                <div className="space-y-2">
                  {resolvedState.rooms.map((room) => (
                    <Link
                      key={room.id}
                      href={`/rooms/${room.id}`}
                      className={cn(
                        "block rounded-[8px] border-2 border-[var(--shock-ink)] px-3 py-3 transition-all duration-150 hover:-translate-y-0.5",
                        selectedRoomId === room.id
                          ? "bg-white shadow-[4px_4px_0_0_var(--shock-pink)]"
                          : "bg-[var(--shock-cream)]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-lg font-semibold">{room.title}</p>
                          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.68)]">
                            {room.issueKey}
                          </p>
                        </div>
                        <span className="min-w-9 rounded-[6px] border-2 border-[var(--shock-ink)] bg-white px-2 py-1 text-center font-mono text-[11px]">
                          {room.unread}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-3 border-t-2 border-[var(--shock-ink)] px-3 py-3">
              <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-3">
                <div className="space-y-2">
                  {resolvedState.machines.map((machine) => (
                    <div key={machine.id} className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base">{machine.name}</p>
                        <span className={cn("rounded-full px-2 py-1 font-mono text-[10px] uppercase", machineTone(machine.state))}>
                          {machineStateLabel(machine.state)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[color:rgba(24,20,14,0.72)]">{machine.cli}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                        {machine.os} / {machine.lastHeartbeat}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <button className="w-full rounded-[8px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-left font-mono text-[11px] uppercase tracking-[0.18em] shadow-[4px_4px_0_0_var(--shock-ink)]">
                新工作区
              </button>

              <div className="px-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">
                  docs
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">
                  system status
                </p>
              </div>

              <div className="hidden rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-3 xl:block">
                <div className="mb-3 flex items-center justify-between">
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em]">公民 Agent</p>
                    <span className="rounded-full bg-[var(--shock-yellow)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--shock-ink)]">
                    {resolvedState.agents.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {resolvedState.agents.map((agent) => (
                    <Link
                      key={agent.id}
                      href={`/agents/${agent.id}`}
                      className="block rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 transition-transform hover:-translate-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base">{agent.name}</p>
                        <span className={cn("rounded-full px-2 py-1 font-mono text-[10px] uppercase", agentTone(agent.state))}>
                          {agentStateLabel(agent.state)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[color:rgba(24,20,14,0.72)]">{agent.mood}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                        泳道 {agent.lane}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="flex min-h-full flex-col bg-white">
            <div className="border-b-2 border-[var(--shock-ink)] px-4 py-3">
              <div className="grid gap-3 xl:grid-cols-[180px_minmax(0,1fr)_auto] xl:items-center">
                <div className="font-display text-xl font-bold">OPENSHOCK.AI</div>
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
                  <p className="font-mono text-[11px] text-[color:rgba(24,20,14,0.52)]">Search workspace...</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-[var(--shock-ink)] bg-white font-mono text-[10px]">⚙</div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-[var(--shock-ink)] bg-white font-mono text-[10px]">◎</div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] font-mono text-[10px]">你</div>
                </div>
              </div>
            </div>

            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    {eyebrow}
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-bold leading-none">{title}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                    {description}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {stats.map((stat) => (
                    <div
                      key={stat.label}
                      className={cn(
                        "rounded-[8px] border-2 border-[var(--shock-ink)] px-4 py-3",
                        statTone(stat.tone)
                      )}
                    >
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em]">{stat.label}</p>
                      <p className="mt-2 font-display text-3xl font-bold">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                  当前上下文
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold">{contextTitle}</h3>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{contextDescription}</p>
              </div>
              {contextBody ?? (
                <section className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em]">MVP 契约</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
                    <li>频道负责轻松讨论，不直接背负执行压力。</li>
                    <li>严肃工作必须进入讨论间，和 Run 保持绑定。</li>
                    <li>Topic 可见，Session 继续留在系统内部。</li>
                    <li>任务板只做辅助，不取代聊天和房间。</li>
                  </ul>
                </section>
              )}
            </div>

            <div className="flex-1 overflow-y-auto bg-white p-4">{children}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
