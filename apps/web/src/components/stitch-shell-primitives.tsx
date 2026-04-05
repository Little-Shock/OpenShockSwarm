"use client";

import Link from "next/link";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function StitchSidebar({
  active,
}: {
  active: "channels" | "rooms" | "board" | "inbox";
}) {
  const nav = [
    { id: "channels", label: "CHANNELS", href: "/chat/all" },
    { id: "rooms", label: "DISCUSSION ROOMS", href: "/rooms/room-runtime" },
    { id: "board", label: "TASK BOARD", href: "/board" },
    { id: "inbox", label: "INBOX", href: "/inbox" },
  ] as const;

  return (
    <aside className="flex min-h-full flex-col border-r-2 border-[var(--shock-ink)] bg-[#f3f3f3]">
      <div className="border-b-2 border-[var(--shock-ink)] bg-white px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] font-mono text-[11px] font-bold">
            ⚡
          </div>
          <div>
            <p className="font-display text-[14px] font-bold leading-none">OpenShock</p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.52)]">
              local-first os
            </p>
          </div>
        </div>
      </div>

      <button className="mx-3 mt-3 rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.16em] shadow-[2px_2px_0_0_var(--shock-ink)]">
        + New Workspace
      </button>

      <nav className="mt-4 space-y-1 px-2">
        {nav.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-[4px] border-2 border-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]",
              active === item.id
                ? "border-[var(--shock-ink)] bg-[var(--shock-yellow)] shadow-[2px_2px_0_0_var(--shock-ink)]"
                : "hover:bg-white"
            )}
          >
            <span className="text-[12px]">•</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5 px-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.42)]">
          Contextual Raw
        </p>
        <div className="mt-3 space-y-2">
          <Link href="/chat/all" className="block font-mono text-[10px] uppercase tracking-[0.14em] hover:text-black/70">
            # all
          </Link>
          <Link href="/chat/roadmap" className="block font-mono text-[10px] uppercase tracking-[0.14em] hover:text-black/70">
            # roadmap
          </Link>
          <Link
            href="/chat/announcements"
            className="block rounded-[4px] border-2 border-[var(--shock-ink)] bg-black px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white"
          >
            # announcements
          </Link>
        </div>
      </div>

      <div className="mt-auto border-t-2 border-[var(--shock-ink)] px-4 py-4">
        <button className="w-full rounded-[4px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] shadow-[2px_2px_0_0_var(--shock-ink)]">
          New Workspace
        </button>
        <div className="mt-4 space-y-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">
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
  searchPlaceholder,
}: {
  tabs?: string[];
  activeTab?: string;
  searchPlaceholder: string;
}) {
  return (
    <div className="grid items-center gap-3 border-b-2 border-[var(--shock-ink)] bg-white px-4 py-3 xl:grid-cols-[220px_minmax(0,1fr)_360px]">
      <div className="flex items-center gap-4">
        <div className="font-display text-xl font-bold italic">OPENSHOCK.AI</div>
        {tabs ? (
          <div className="hidden items-center gap-4 md:flex">
            {tabs.map((tab) => (
              <span
                key={tab}
                className={cn(
                  "border-b-2 pb-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                  tab === activeTab ? "border-[var(--shock-yellow)]" : "border-transparent text-[color:rgba(24,20,14,0.5)]"
                )}
              >
                {tab}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#f4f4f4] px-4 py-2 font-mono text-[11px] text-[color:rgba(24,20,14,0.48)]">
        {searchPlaceholder}
      </div>

      <div className="flex items-center justify-end gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white text-[12px]">
          ⚙
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white text-[12px]">
          ?
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white text-[12px]">
          ◔
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] text-[12px]">
          👤
        </div>
      </div>
    </div>
  );
}
