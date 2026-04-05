import Link from "next/link";
import type { ReactNode } from "react";

import {
  agents,
  channels,
  getGlobalStats,
  machines,
  rooms,
  tabs,
  utilityLinks,
  workspace,
  type AppTab,
  type MachineState,
  type PresenceState,
} from "@/lib/mock-data";

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
  const stats = getGlobalStats();

  return (
    <main className="min-h-screen bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col px-3 py-3 md:px-4 md:py-4">
        <div className="grid min-h-[calc(100vh-1.5rem)] gap-3 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="flex min-h-full flex-col overflow-hidden rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-cream)] shadow-[8px_8px_0_0_var(--shock-ink)]">
            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 py-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--shock-ink)]">
                OpenShock.ai
              </p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <h1 className="font-display text-3xl font-bold leading-none">{workspace.name}</h1>
                  <p className="mt-2 max-w-[16rem] text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                    外层像 Slock，骨架像 Multica。真正的干活发生在讨论间里。
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                  Phase 0
                </div>
              </div>
            </div>

            <div className="border-b-2 border-[var(--shock-ink)] px-3 py-3">
              <nav className="grid grid-cols-2 gap-2">
                {tabs.map((tab) => (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    className={cn(
                      "rounded-2xl border-2 border-[var(--shock-ink)] px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.18em] transition-transform duration-150 hover:-translate-y-0.5",
                      activeTab === tab.id
                        ? "bg-[var(--shock-ink)] text-white shadow-[4px_4px_0_0_var(--shock-yellow)]"
                        : "bg-white"
                    )}
                  >
                    {tab.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {utilityLinks.map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    className={cn(
                      "rounded-2xl border-2 border-[var(--shock-ink)] px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.16em] transition-transform hover:-translate-y-0.5",
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
                  <span className="rounded-full bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    公屏
                  </span>
                </div>
                <div className="space-y-2">
                  {channels.map((channel) => (
                    <Link
                      key={channel.id}
                      href={`/chat/${channel.id}`}
                      className={cn(
                        "block rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-3 transition-all duration-150 hover:-translate-y-0.5",
                        selectedChannelId === channel.id
                          ? "bg-[var(--shock-yellow)] shadow-[5px_5px_0_0_var(--shock-ink)]"
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
                        <span className="min-w-9 rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-2 py-1 text-center font-mono text-[11px]">
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
                  <span className="rounded-full bg-[var(--shock-pink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white">
                    干活
                  </span>
                </div>
                <div className="space-y-2">
                  {rooms.map((room) => (
                    <Link
                      key={room.id}
                      href={`/rooms/${room.id}`}
                      className={cn(
                        "block rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-3 transition-all duration-150 hover:-translate-y-0.5",
                        selectedRoomId === room.id
                          ? "bg-white shadow-[5px_5px_0_0_var(--shock-pink)]"
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
                        <span className="min-w-9 rounded-full border-2 border-[var(--shock-ink)] bg-white px-2 py-1 text-center font-mono text-[11px]">
                          {room.unread}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-3 border-t-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-3 text-white">
              <div className="rounded-[20px] border-2 border-white/80 bg-white/10 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em]">机器</p>
                  <span className="rounded-full bg-[var(--shock-lime)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--shock-ink)]">
                    在线
                  </span>
                </div>
                <div className="space-y-2">
                  {machines.map((machine) => (
                    <div key={machine.id} className="rounded-2xl border border-white/40 bg-black/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base">{machine.name}</p>
                        <span className={cn("rounded-full px-2 py-1 font-mono text-[10px] uppercase", machineTone(machine.state))}>
                          {machineStateLabel(machine.state)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/72">{machine.cli}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/56">
                        {machine.os} / {machine.lastHeartbeat}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[20px] border-2 border-white/80 bg-white/10 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em]">公民 Agent</p>
                  <span className="rounded-full bg-[var(--shock-yellow)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--shock-ink)]">
                    已加载 {agents.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {agents.map((agent) => (
                    <Link
                      key={agent.id}
                      href={`/agents/${agent.id}`}
                      className="block rounded-2xl border border-white/40 bg-black/20 px-3 py-2 transition-transform hover:-translate-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base">{agent.name}</p>
                        <span className={cn("rounded-full px-2 py-1 font-mono text-[10px] uppercase", agentTone(agent.state))}>
                          {agentStateLabel(agent.state)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/72">{agent.mood}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/56">
                        泳道 {agent.lane}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="flex min-h-full flex-col overflow-hidden rounded-[28px] border-2 border-[var(--shock-ink)] bg-white shadow-[8px_8px_0_0_var(--shock-yellow)]">
            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-5 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    {eyebrow}
                  </p>
                  <h2 className="mt-2 font-display text-4xl font-bold leading-none">{title}</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                    {description}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {stats.map((stat) => (
                    <div
                      key={stat.label}
                      className={cn(
                        "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
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

            <div className="flex-1 overflow-y-auto p-4 md:p-5">{children}</div>
          </section>

          <aside className="flex min-h-full flex-col gap-3">
            <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[8px_8px_0_0_var(--shock-lime)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                当前上下文
              </p>
              <h3 className="mt-2 font-display text-3xl font-bold">{contextTitle}</h3>
              <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{contextDescription}</p>
            </section>

            {contextBody}

            <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] p-5 text-white shadow-[8px_8px_0_0_var(--shock-pink)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">MVP 契约</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-white/78">
                <li>频道负责轻松讨论，不直接背负执行压力。</li>
                <li>严肃工作必须进入讨论间，和 Run 保持绑定。</li>
                <li>Topic 可见，Session 继续留在系统内部。</li>
                <li>任务板只做辅助，不取代聊天和房间。</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
