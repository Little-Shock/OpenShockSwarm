"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { QuickSearchEntry, QuickSearchEntryKind } from "@/lib/quick-search";
import type { AgentStatus, Channel, MachineStatus, Room } from "@/lib/mock-data";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function roomStatusTone(status: Room["topic"]["status"]) {
  switch (status) {
    case "running":
      return "bg-[var(--shock-lime)]";
    case "review":
      return "bg-[var(--shock-cyan)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "paused":
      return "bg-[#f0de97]";
    default:
      return "bg-white";
  }
}

function ChatModeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <rect x="3" y="4" width="14" height="10" rx="1.5" />
      <path d="M7 14v3l3-3" />
    </svg>
  );
}

function WorkspaceModeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <path d="M4 15v-7h12v7" />
      <path d="M8 8V5h4v3" />
      <path d="M4 11h12" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <path d="M7 3 5 17" />
      <path d="M13 3l-2 14" />
      <path d="M3 8h14" />
      <path d="M2 13h14" />
    </svg>
  );
}

function RoomIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <rect x="3" y="4" width="14" height="10" rx="1.5" />
      <path d="M7 14v3l3-3" />
      <path d="M7 8h6" />
      <path d="M7 11h4" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <path d="M4 6h12v8H4z" />
      <path d="M4 11h3l1 2h4l1-2h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
  );
}

function kindLabel(kind: QuickSearchEntryKind) {
  switch (kind) {
    case "channel":
      return "Channel";
    case "room":
      return "Room";
    case "issue":
      return "Issue";
    case "run":
      return "Run";
    case "agent":
      return "Agent";
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => escapeRegex(term));

  if (terms.length === 0) {
    return text;
  }

  const matcher = new RegExp(`(${terms.join("|")})`, "ig");
  const exactMatcher = new RegExp(`^(${terms.join("|")})$`, "i");
  const parts = text.split(matcher).filter(Boolean);

  return parts.map((part, index) =>
    exactMatcher.test(part) ? (
      <mark key={`${part}-${index}`} className="bg-[var(--shock-yellow)] px-0.5 text-[var(--shock-ink)]">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

type StitchSidebarProps = {
  active: "channels" | "rooms" | "board" | "inbox" | null;
  mode?: "chat" | "work";
  channels?: Channel[];
  rooms?: Room[];
  machines?: MachineStatus[];
  agents?: AgentStatus[];
  workspaceName?: string;
  workspaceSubtitle?: string;
  selectedChannelId?: string;
  selectedRoomId?: string;
  inboxCount?: number;
  onOpenQuickSearch?: () => void;
};

function SidebarSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mb-1 flex w-full items-center justify-between gap-2 px-2 py-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.62)]">
            {open ? "▾" : "▸"}
          </span>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
            {title}
          </p>
        </div>
        {typeof count === "number" ? (
          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.52)]">{count}</span>
        ) : null}
      </button>
      {open ? <div className="space-y-1">{children}</div> : null}
    </section>
  );
}

export function WorkspaceStatusStrip({
  workspaceName,
  disconnected,
}: {
  workspaceName?: string;
  disconnected?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[var(--shock-ink)] bg-[var(--shock-status)] px-4 py-2">
      <span className="font-display text-[13px] font-bold">{workspaceName || "OpenShock"}</span>
      <span className="text-[11px] text-[color:rgba(24,20,14,0.62)]">
        {disconnected ? "offline" : "live"}
      </span>
      <Link
        href="/setup"
        className="ml-auto border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
      >
        Reconnect
      </Link>
    </div>
  );
}

export function StitchSidebar({
  active,
  mode = "chat",
  channels,
  rooms,
  machines,
  agents,
  workspaceName,
  workspaceSubtitle,
  selectedChannelId,
  selectedRoomId,
  inboxCount,
  onOpenQuickSearch,
}: StitchSidebarProps) {
  const navChannels = channels ?? [];
  const roomList = rooms ?? [];
  const machineList = machines ?? [];
  const agentList = agents ?? [];
  const openInboxCount = inboxCount ?? 0;
  const runningAgents = agentList.filter((agent) => agent.state === "running").length;
  const blockedAgents = agentList.filter((agent) => agent.state === "blocked").length;
  const selectedRoom = selectedRoomId ? roomList.find((room) => room.id === selectedRoomId) : undefined;

  return (
    <aside className="hidden h-full w-[282px] flex-col border-r-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] md:flex">
      <div className="border-b-2 border-[var(--shock-ink)] px-2 py-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 border-2 border-[var(--shock-ink)] bg-black px-3 py-2 font-display text-[15px] font-bold text-[var(--shock-yellow)] shadow-[var(--shock-shadow-sm)]"
        >
          <span className="min-w-0 flex-1 truncate text-left">{workspaceName || "OpenShock"}</span>
          <span className="font-mono text-[10px]">▾</span>
        </button>
        <p className="mt-2 truncate px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
          {workspaceSubtitle || "local-first command room"}
        </p>
      </div>

      <div className="grid grid-cols-2 border-b-2 border-[var(--shock-ink)] bg-white">
        <Link
          href="/chat/all"
          className={cn(
            "flex items-center justify-center gap-2 border-r-2 border-[var(--shock-ink)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em]",
            mode === "chat"
              ? "bg-white text-[var(--shock-ink)]"
              : "bg-[var(--shock-paper)] text-[color:rgba(24,20,14,0.72)] hover:bg-white"
          )}
        >
          <ChatModeIcon />
          Chat
        </Link>
        <Link
          href="/setup"
          className={cn(
            "flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em]",
            mode === "work"
              ? "bg-white text-[var(--shock-ink)]"
              : "text-[color:rgba(24,20,14,0.72)] hover:bg-[var(--shock-paper)]"
          )}
        >
          <WorkspaceModeIcon />
          Work
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onOpenQuickSearch}
            data-testid="quick-search-trigger-sidebar"
            className={cn(
              "flex w-full items-center gap-2 border-2 border-[var(--shock-ink)] px-2 py-2 text-left text-sm shadow-[var(--shock-shadow-sm)]",
              active === "channels"
                ? "bg-[var(--shock-pink)] font-semibold text-white"
                : "border-transparent bg-transparent hover:border-[var(--shock-ink)] hover:bg-white"
            )}
          >
            <SearchIcon />
            <span className="flex-1">Quick Search</span>
            <span className="font-mono text-[10px]">Ctrl+K</span>
          </button>
        </div>

        <SidebarSection title="Channels" count={navChannels.length}>
          {navChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/chat/${channel.id}`}
              className={cn(
                "block border-2 px-2 py-1.5 text-sm transition-colors",
                selectedChannelId === channel.id
                  ? "border-[var(--shock-ink)] bg-[var(--shock-pink)] text-white shadow-[var(--shock-shadow-sm)]"
                  : "border-transparent hover:border-[var(--shock-ink)] hover:bg-white"
              )}
              >
                <div className="flex items-center gap-2">
                  <HashIcon />
                  <p className="min-w-0 flex-1 truncate font-medium">{channel.name}</p>
                {channel.unread > 0 ? (
                  <span className={cn("min-w-5 rounded-full border border-[var(--shock-ink)] px-1 text-center font-mono text-[10px]", selectedChannelId === channel.id ? "bg-white text-[var(--shock-ink)]" : "bg-white")}>
                    {channel.unread}
                  </span>
                ) : null}
              </div>
              <p className={cn("mt-0.5 truncate pl-6 text-[10px]", selectedChannelId === channel.id ? "text-white/80" : "text-[color:rgba(24,20,14,0.56)]")}>
                {channel.summary}
              </p>
            </Link>
          ))}
        </SidebarSection>

        <SidebarSection title="Rooms" count={roomList.length} defaultOpen={Boolean(selectedRoomId) || roomList.length <= 5}>
          {roomList.map((room) => (
            <Link
              key={room.id}
              href={`/rooms/${room.id}`}
              className={cn(
                "block border-2 px-2 py-1.5 text-sm transition-colors",
                selectedRoomId === room.id
                  ? "border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)]"
                  : "border-transparent hover:border-[var(--shock-ink)] hover:bg-white"
              )}
            >
              <div className="flex items-center gap-2">
                <RoomIcon />
                <p className="min-w-0 flex-1 truncate font-medium">{room.title}</p>
                <span className={cn("rounded-full border border-[var(--shock-ink)] px-1.5 py-0.5 font-mono text-[9px] uppercase", roomStatusTone(room.topic.status))}>
                  {room.topic.status}
                </span>
              </div>
              <p className="mt-0.5 truncate pl-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.56)]">
                {room.issueKey}
              </p>
            </Link>
          ))}
        </SidebarSection>
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-2">
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/inbox"
            className={cn(
              "flex items-center justify-between gap-2 border-2 px-2 py-2 text-sm shadow-[var(--shock-shadow-sm)]",
              active === "inbox" ? "border-[var(--shock-ink)] bg-[var(--shock-pink)] text-white" : "bg-white"
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <InboxIcon />
              Inbox
            </span>
            <span className="font-mono text-[10px]">{openInboxCount}</span>
          </Link>
          <Link
            href="/board"
            className={cn(
              "flex items-center justify-between gap-2 border-2 px-2 py-2 text-sm shadow-[var(--shock-shadow-sm)]",
              active === "board" ? "border-[var(--shock-ink)] bg-white" : "bg-white"
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <WorkspaceModeIcon />
              Board
            </span>
            <span className="font-mono text-[10px]">{roomList.length}</span>
          </Link>
        </div>

        <div className="mt-2 border-2 border-[var(--shock-ink)] bg-white px-2 py-2 shadow-[var(--shock-shadow-sm)]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-[14px] font-bold leading-none">
                {selectedRoom?.title || workspaceName || "OpenShock"}
              </p>
              <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[color:rgba(24,20,14,0.56)]">
                {selectedRoom ? selectedRoom.issueKey : workspaceSubtitle || "shock-main"}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase text-[color:rgba(24,20,14,0.56)]">presence</p>
              <p className="font-mono text-[10px] uppercase">{runningAgents}/{machineList.length}</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
            <div className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1">
              <p className="font-mono uppercase text-[color:rgba(24,20,14,0.52)]">live</p>
              <p className="mt-1 font-mono">{runningAgents}</p>
            </div>
            <div className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1">
              <p className="font-mono uppercase text-[color:rgba(24,20,14,0.52)]">blocked</p>
              <p className="mt-1 font-mono">{blockedAgents}</p>
            </div>
            <div className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1">
              <p className="font-mono uppercase text-[color:rgba(24,20,14,0.52)]">inbox</p>
              <p className="mt-1 font-mono">{openInboxCount}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

type StitchTopBarProps = {
  title: string;
  searchPlaceholder: string;
  eyebrow?: string;
  description?: string;
  currentHref?: string;
  tabs?: Array<
    | string
    | {
        label: string;
        href?: string;
        testId?: string;
      }
  >;
  activeTab?: string;
  onOpenQuickSearch?: () => void;
};

export function StitchTopBar({
  title,
  searchPlaceholder,
  eyebrow,
  description,
  currentHref,
  tabs,
  activeTab,
  onOpenQuickSearch,
}: StitchTopBarProps) {
  return (
    <header className="border-b-2 border-[var(--shock-ink)] bg-white">
      <div className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(250px,320px)_auto] xl:items-center">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.52)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 truncate font-display text-[22px] font-bold leading-none">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-[11px] leading-5 text-[color:rgba(24,20,14,0.66)]">{description}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onOpenQuickSearch}
          data-testid="quick-search-trigger-topbar"
          className="flex items-center gap-2 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 text-left"
        >
          <span className="flex h-7 w-7 items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] font-mono text-[10px] font-bold">
            K
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
              Quick Search
            </p>
            <p className="truncate font-medium text-[12px]">{searchPlaceholder}</p>
          </div>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.48)]">
            Ctrl+K
          </span>
        </button>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {[
            { href: "/issues", label: "Issues" },
            { href: "/runs", label: "Runs" },
            { href: "/agents", label: "Agents" },
            { href: "/setup", label: "Setup" },
            { href: "/memory", label: "Memory" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]",
                currentHref === link.href ? "bg-[var(--shock-yellow)]" : "bg-white hover:bg-[var(--shock-paper)]"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {tabs && tabs.length > 0 ? (
        <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4">
          <div className="flex flex-wrap gap-0">
            {tabs.map((tab) => {
              const resolvedTab = typeof tab === "string" ? { label: tab } : tab;
              const className = cn(
                "border-r-2 border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]",
                resolvedTab.label === activeTab
                  ? "bg-[var(--shock-yellow)] font-semibold"
                  : "bg-white text-[color:rgba(24,20,14,0.62)]"
              );

              if (resolvedTab.href) {
                return (
                  <Link
                    key={resolvedTab.label}
                    href={resolvedTab.href}
                    data-testid={resolvedTab.testId}
                    className={className}
                  >
                    {resolvedTab.label}
                  </Link>
                );
              }

              return (
                <span key={resolvedTab.label} data-testid={resolvedTab.testId} className={className}>
                  {resolvedTab.label}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </header>
  );
}

type QuickSearchSurfaceProps = {
  open: boolean;
  query: string;
  results: QuickSearchEntry[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSelect: (entry: QuickSearchEntry) => void;
};

export function QuickSearchSurface({
  open,
  query,
  results,
  onClose,
  onQueryChange,
  onSelect,
}: QuickSearchSurfaceProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const resolvedActiveIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  function handleQueryChange(value: string) {
    setActiveIndex(0);
    onQueryChange(value);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onSelect(results[resolvedActiveIndex]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[color:rgba(24,20,14,0.56)] px-4 py-8 md:px-8 md:py-12">
      <button type="button" aria-label="Close quick search" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        className="relative z-10 flex max-h-[min(720px,100%)] w-full max-w-4xl flex-col overflow-hidden border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] shadow-[var(--shock-shadow-lg)]"
        data-testid="quick-search-dialog"
      >
        <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)]">
              <SearchIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.52)]">Quick Search</p>
              <input
                ref={inputRef}
                data-testid="quick-search-input"
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search channel / room / issue / run / agent"
                className="mt-1 w-full bg-transparent font-display text-[24px] font-bold leading-none outline-none placeholder:text-[color:rgba(24,20,14,0.36)]"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
            >
              Esc
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-h-0 overflow-y-auto bg-[#f7f0dc] p-3">
            {results.length > 0 ? (
              <div className="space-y-2">
                {results.map((entry, index) => (
                  <button
                    key={`${entry.kind}-${entry.id}`}
                    type="button"
                    onClick={() => onSelect(entry)}
                    data-testid={`quick-search-result-${entry.kind}-${entry.id}`}
                    className={cn(
                      "block w-full border-2 px-3 py-3 text-left shadow-[var(--shock-shadow-sm)]",
                      index === resolvedActiveIndex ? "border-[var(--shock-ink)] bg-white" : "border-transparent bg-white/70 hover:border-[var(--shock-ink)] hover:bg-white"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                        {kindLabel(entry.kind)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{highlightText(entry.title, query)}</p>
                        <p className="mt-1 text-[12px] leading-5 text-[color:rgba(24,20,14,0.72)]">{highlightText(entry.summary, query)}</p>
                        <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                          {highlightText(entry.meta, query)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="border-2 border-dashed border-[var(--shock-ink)] bg-white px-4 py-5">
                <p className="font-display text-[18px] font-bold">No matches yet</p>
                <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                  试试输入 channel、room、issue、run 或 agent 关键字，直接跳到对应工作面。
                </p>
              </div>
            )}
          </div>

          <aside className="border-t-2 border-[var(--shock-ink)] bg-white p-3 md:border-l-2 md:border-t-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.48)]">Command Hints</p>
            <div className="mt-3 space-y-2 text-[12px] leading-5 text-[color:rgba(24,20,14,0.74)]">
              <p><span className="font-mono">↑ ↓</span> move</p>
              <p><span className="font-mono">Enter</span> open target</p>
              <p><span className="font-mono">Esc</span> close palette</p>
              <p><span className="font-mono">Ctrl/Cmd + K</span> reopen from anywhere in shell</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
