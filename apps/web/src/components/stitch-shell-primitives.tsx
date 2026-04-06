"use client";

import Link from "next/link";

import type { AgentStatus, Channel, MachineStatus } from "@/lib/mock-data";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function StitchSidebar({
  active,
  channels,
  machines,
  agents,
}: {
  active: "channels" | "rooms" | "board" | "inbox";
  channels?: Channel[];
  machines?: MachineStatus[];
  agents?: AgentStatus[];
}) {
  const navChannels = channels ?? [];
  const machine = machines?.[0];
  const activeAgents = agents?.filter((agent) => agent.state === "running").length ?? 0;
  const nav = [
    { id: "channels", label: "频道", href: "/chat/all" },
    { id: "rooms", label: "讨论间", href: "/rooms" },
    { id: "board", label: "任务板", href: "/board" },
    { id: "inbox", label: "收件箱", href: "/inbox" },
  ] as const;

  return (
    <aside className="hidden h-screen w-64 flex-col border-r-2 border-[var(--shock-ink)] bg-[#f3f4f6] md:flex">
      <div className="border-b-2 border-[var(--shock-ink)] bg-white px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] shadow-[2px_2px_0_0_var(--shock-ink)]">
            ⚡
          </div>
          <div>
            <p className="font-display text-xl font-bold leading-none">OpenShock</p>
            <p className="mt-1 font-mono text-[10px] tracking-[0.02em] text-[color:rgba(24,20,14,0.52)]">
              Local-First OS
            </p>
          </div>
        </div>
      </div>

      <button className="mx-4 mt-4 rounded-[6px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.16em] shadow-[2px_2px_0_0_var(--shock-ink)]">
        + New Workspace
      </button>

      <nav className="mt-4 space-y-1 px-3">
        {nav.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-[4px] border-2 border-transparent px-4 py-3 font-mono text-[11px] tracking-[0.08em]",
              active === item.id
                ? "border-[var(--shock-ink)] bg-[var(--shock-yellow)] shadow-[2px_2px_0_0_var(--shock-ink)]"
                : "text-[color:rgba(24,20,14,0.72)] hover:bg-white hover:translate-x-[2px]"
            )}
          >
            <span className="text-[12px]">◦</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 px-5">
        <p className="font-mono text-[10px] tracking-[0.12em] text-[color:rgba(24,20,14,0.42)]">
          全局频道
        </p>
        <div className="mt-3 space-y-2">
          {navChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/chat/${channel.id}`}
              className={cn(
                "flex items-center gap-2 px-2 py-2 font-mono text-[11px] tracking-[0.08em]",
                channel.id === "announcements"
                  ? "rounded-[6px] border-2 border-[var(--shock-ink)] bg-black text-white"
                  : "text-[color:rgba(24,20,14,0.72)] hover:text-black"
              )}
            >
              <span>#</span>
              <span>{channel.id}</span>
              {channel.unread > 0 ? <span className="ml-auto text-[10px]">{channel.unread}</span> : null}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-auto border-t-2 border-[var(--shock-ink)] px-4 py-4">
        <div className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 shadow-[2px_2px_0_0_var(--shock-ink)]">
          <p className="font-mono text-[10px] tracking-[0.12em] text-[color:rgba(24,20,14,0.52)]">机器 / Agent</p>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span>{machine?.name ?? "shock-main"}</span>
              <span className="text-[color:rgba(24,20,14,0.56)]">{machine?.state ?? "busy"}</span>
            </div>
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span>活跃公民</span>
              <span className="text-[color:rgba(24,20,14,0.56)]">{activeAgents}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2 font-mono text-[10px] tracking-[0.12em] text-[color:rgba(24,20,14,0.52)]">
          <p>Docs</p>
          <p>System Status</p>
        </div>
      </div>
    </aside>
  );
}

export function StitchTopBar({
  tabs,
  activeTab,
  title,
  searchPlaceholder,
}: {
  tabs?: string[];
  activeTab?: string;
  title?: string;
  searchPlaceholder: string;
}) {
  return (
    <div className="grid h-16 items-center gap-4 border-b-2 border-[var(--shock-ink)] bg-white px-6 xl:grid-cols-[minmax(360px,auto)_minmax(0,1fr)_320px]">
      <div className="flex min-w-0 items-center gap-4">
        <div className="font-display text-[28px] font-black italic">OPENSHOCK.AI</div>
        {title ? <div className="h-8 w-[2px] bg-[var(--shock-ink)]" /> : null}
        {title ? <h1 className="truncate font-display text-lg font-bold">{title}</h1> : null}
        {tabs ? (
          <div className="hidden items-center gap-4 md:flex">
            {tabs.map((tab) => (
              <span
                key={tab}
                className={cn(
                  "border-b-2 pb-1 font-mono text-[10px] tracking-[0.16em]",
                  tab === activeTab ? "border-[var(--shock-yellow)]" : "border-transparent text-[color:rgba(24,20,14,0.5)]"
                )}
              >
                {tab}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="hidden items-center rounded-[6px] border-2 border-[var(--shock-ink)] bg-[#f4f4f4] px-4 py-2 font-mono text-[11px] text-[color:rgba(24,20,14,0.48)] lg:flex">
        ⌕ {searchPlaceholder}
      </div>

      <div className="flex items-center justify-end gap-2">
        <div className="flex h-8 w-8 items-center justify-center bg-white text-[12px]">
          ⚙
        </div>
        <div className="flex h-8 w-8 items-center justify-center bg-white text-[12px]">
          ?
        </div>
        <div className="flex h-8 w-8 items-center justify-center bg-white text-[12px]">
          ◔
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] text-[12px]">
          👤
        </div>
      </div>
    </div>
  );
}
