"use client";

import { useMemo, useState } from "react";

import {
  agents,
  boardColumns,
  channels,
  feedMessages,
  inboxItems,
  machines,
  rooms,
  tabs,
  type AppTab,
} from "@/lib/mock-data";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusTone(state: string) {
  switch (state) {
    case "running":
    case "busy":
      return "bg-[var(--shock-yellow)] text-[var(--shock-ink)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "review":
    case "online":
      return "bg-[var(--shock-lime)] text-[var(--shock-ink)]";
    default:
      return "bg-white text-[var(--shock-ink)]";
  }
}

export function OpenShockShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("chat");
  const [selectedChannelId, setSelectedChannelId] = useState(channels[0].id);
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0].id);

  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? channels[0];
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];

  const contextTitle = useMemo(() => {
    if (activeTab === "chat") return selectedChannel.name;
    if (activeTab === "rooms") return selectedRoom.title;
    if (activeTab === "inbox") return "Human intervention inbox";
    return "Global issue board";
  }, [activeTab, selectedChannel.name, selectedRoom.title]);

  return (
    <main className="min-h-screen bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="mx-auto flex min-h-screen max-w-[1700px] flex-col px-3 py-3 md:px-4 md:py-4">
        <div className="grid min-h-[calc(100vh-1.5rem)] gap-3 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="flex min-h-full flex-col rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-cream)] shadow-[8px_8px_0_0_var(--shock-ink)]">
            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 py-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--shock-ink)]">
                OpenShock.ai
              </p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <h1 className="font-display text-3xl font-bold leading-none">Electric Architect</h1>
                  <p className="mt-2 max-w-[16rem] text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                    Slock shell outside. Multica bones inside. Work happens in Issue Rooms.
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                  P0
                </div>
              </div>
            </div>

            <div className="px-3 py-3">
              <nav className="grid grid-cols-2 gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "rounded-2xl border-2 border-[var(--shock-ink)] px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.18em] transition-transform duration-150 hover:-translate-y-0.5",
                      activeTab === tab.id
                        ? "bg-[var(--shock-ink)] text-white shadow-[4px_4px_0_0_var(--shock-yellow)]"
                        : "bg-white"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-3">
              <section>
                <div className="mb-3 flex items-center justify-between px-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    Chat
                  </p>
                  <span className="rounded-full bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    Lounge
                  </span>
                </div>
                <div className="space-y-2">
                  {channels.map((channel) => (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => {
                        setActiveTab("chat");
                        setSelectedChannelId(channel.id);
                      }}
                      className={cn(
                        "w-full rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-3 text-left transition-all duration-150 hover:-translate-y-0.5",
                        selectedChannelId === channel.id && activeTab === "chat"
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
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between px-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    Issue Rooms
                  </p>
                  <span className="rounded-full bg-[var(--shock-pink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white">
                    Work
                  </span>
                </div>
                <div className="space-y-2">
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => {
                        setActiveTab("rooms");
                        setSelectedRoomId(room.id);
                      }}
                      className={cn(
                        "w-full rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-3 text-left transition-all duration-150 hover:-translate-y-0.5",
                        selectedRoomId === room.id && activeTab === "rooms"
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
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-3 border-t-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-3 text-white">
              <div className="rounded-[20px] border-2 border-white/80 bg-white/10 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Machines</p>
                  <span className="rounded-full bg-[var(--shock-lime)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--shock-ink)]">
                    Live
                  </span>
                </div>
                <div className="space-y-2">
                  {machines.map((machine) => (
                    <div key={machine.id} className="rounded-2xl border border-white/40 bg-black/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base">{machine.name}</p>
                        <span className={cn("rounded-full px-2 py-1 font-mono text-[10px] uppercase", statusTone(machine.state))}>
                          {machine.state}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/72">{machine.cli}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[20px] border-2 border-white/80 bg-white/10 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Agents</p>
                  <span className="rounded-full bg-[var(--shock-yellow)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--shock-ink)]">
                    3 Active
                  </span>
                </div>
                <div className="space-y-2">
                  {agents.map((agent) => (
                    <div key={agent.id} className="rounded-2xl border border-white/40 bg-black/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base">{agent.name}</p>
                        <span className={cn("rounded-full px-2 py-1 font-mono text-[10px] uppercase", statusTone(agent.state))}>
                          {agent.state}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/72">{agent.mood}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/56">
                        Lane {agent.lane}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="flex min-h-full flex-col rounded-[28px] border-2 border-[var(--shock-ink)] bg-white shadow-[8px_8px_0_0_var(--shock-yellow)]">
            <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-5 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                    {activeTab === "chat" ? "Global chat shell" : activeTab === "rooms" ? "Issue room" : activeTab}
                  </p>
                  <h2 className="mt-2 font-display text-4xl font-bold leading-none">{contextTitle}</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                    {activeTab === "chat"
                      ? selectedChannel.purpose
                      : activeTab === "rooms"
                        ? selectedRoom.summary
                        : activeTab === "inbox"
                          ? "Everything that needs human eyes lands here before the product drifts."
                          : "Board exists, but it stays secondary to rooms and runs."}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em]">Runs</p>
                    <p className="mt-2 font-display text-3xl font-bold">03</p>
                  </div>
                  <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em]">Blocked</p>
                    <p className="mt-2 font-display text-3xl font-bold">01</p>
                  </div>
                  <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-white">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em]">Inbox</p>
                    <p className="mt-2 font-display text-3xl font-bold">04</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-5">
              {activeTab === "chat" && (
                <div className="space-y-4">
                  {feedMessages.map((message) => (
                    <article
                      key={message.id}
                      className={cn(
                        "rounded-[24px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]",
                        message.tone === "human"
                          ? "bg-[var(--shock-yellow)]"
                          : message.tone === "blocked"
                            ? "bg-[var(--shock-pink)] text-white shadow-[4px_4px_0_0_var(--shock-yellow)]"
                            : "bg-[var(--shock-paper)]"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-display text-xl font-semibold">{message.speaker}</h3>
                        <span className="rounded-full border-2 border-current px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                          {message.role}
                        </span>
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-70">
                          {message.time}
                        </span>
                      </div>
                      <p className="mt-3 max-w-3xl text-base leading-7">{message.message}</p>
                    </article>
                  ))}

                  <div className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-cream)] p-4 shadow-[6px_6px_0_0_var(--shock-pink)]">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-display text-xl font-semibold">Say it in the public feed</p>
                        <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">
                          Keep casual discussion in channels, then graduate serious work into an Issue Room.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition-transform hover:-translate-y-0.5"
                      >
                        Start new thread
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "rooms" && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-4">
                    <div className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-cream)] p-5 shadow-[6px_6px_0_0_var(--shock-lime)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
                            {selectedRoom.issueKey}
                          </p>
                          <h3 className="mt-2 font-display text-3xl font-bold">{selectedRoom.topic.title}</h3>
                        </div>
                        <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(selectedRoom.topic.status))}>
                          {selectedRoom.topic.status}
                        </span>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Run</p>
                          <p className="mt-2 font-display text-xl font-semibold">{selectedRoom.topic.runId}</p>
                        </div>
                        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Branch</p>
                          <p className="mt-2 font-display text-xl font-semibold">{selectedRoom.topic.branch}</p>
                        </div>
                        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Worktree</p>
                          <p className="mt-2 font-display text-xl font-semibold">{selectedRoom.topic.worktree}</p>
                        </div>
                      </div>
                      <p className="mt-5 max-w-3xl text-base leading-7 text-[color:rgba(24,20,14,0.8)]">
                        {selectedRoom.topic.summary}
                      </p>
                    </div>

                    <div className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-display text-2xl font-bold">Room chat</h3>
                        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                          Chat / Topics / Board
                        </span>
                      </div>
                      <div className="space-y-3">
                        {feedMessages.slice(1).map((message) => (
                          <div key={message.id} className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
                            <div className="flex items-center gap-3">
                              <p className="font-display text-lg font-semibold">{message.speaker}</p>
                              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">
                                {message.time}
                              </p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{message.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] p-4 text-white shadow-[6px_6px_0_0_var(--shock-pink)]">
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em]">Task board</p>
                      <p className="mt-3 font-display text-2xl font-bold">{selectedRoom.boardCount} cards in flight</p>
                      <p className="mt-2 text-sm leading-6 text-white/72">
                        Board stays here inside the room so work remains anchored to conversation.
                      </p>
                    </div>
                    <div className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] p-4 shadow-[6px_6px_0_0_var(--shock-ink)]">
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em]">Primary owner</p>
                      <p className="mt-2 font-display text-2xl font-bold">{selectedRoom.topic.owner}</p>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
                        This agent owns the active lane. Human guidance stays visible in the room, not hidden in side chats.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "inbox" && (
                <div className="grid gap-4 xl:grid-cols-2">
                  {inboxItems.map((item) => (
                    <article
                      key={item.id}
                      className={cn(
                        "rounded-[28px] border-2 border-[var(--shock-ink)] p-5 shadow-[6px_6px_0_0_var(--shock-ink)]",
                        item.kind === "approval"
                          ? "bg-[var(--shock-yellow)]"
                          : item.kind === "blocked"
                            ? "bg-[var(--shock-pink)] text-white"
                            : item.kind === "review"
                              ? "bg-[var(--shock-lime)]"
                              : "bg-white"
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="rounded-full border-2 border-current px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                          {item.kind}
                        </span>
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-70">{item.time}</span>
                      </div>
                      <h3 className="mt-4 font-display text-2xl font-bold leading-tight">{item.title}</h3>
                      <p className="mt-3 text-sm leading-6 opacity-85">{item.summary}</p>
                      <div className="mt-5 flex items-center justify-between gap-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{item.room}</span>
                        <button
                          type="button"
                          className="rounded-2xl border-2 border-current bg-white/90 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)] transition-transform hover:-translate-y-0.5"
                        >
                          {item.action}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {activeTab === "board" && (
                <div className="grid gap-4 lg:grid-cols-4">
                  {boardColumns.map((column) => (
                    <section
                      key={column.title}
                      className="rounded-[28px] border-2 border-[var(--shock-ink)] p-4 shadow-[6px_6px_0_0_var(--shock-ink)]"
                      style={{ backgroundColor: column.accent }}
                    >
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-display text-2xl font-bold">{column.title}</h3>
                        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                          {column.cards.length}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {column.cards.map((card) => (
                          <article key={card.id} className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                              {card.issueKey}
                            </p>
                            <h4 className="mt-2 font-display text-xl font-semibold leading-tight">{card.title}</h4>
                            <div className="mt-4 flex items-center justify-between gap-3">
                              <p className="text-sm text-[color:rgba(24,20,14,0.72)]">{card.owner}</p>
                              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                {card.state}
                              </span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="flex min-h-full flex-col gap-3">
            <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[8px_8px_0_0_var(--shock-lime)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.68)]">
                Current context
              </p>
              <h3 className="mt-2 font-display text-3xl font-bold">
                {activeTab === "rooms" ? selectedRoom.issueKey : "OS-01"}
              </h3>
              <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                {activeTab === "rooms"
                  ? selectedRoom.summary
                  : "The shell keeps rooms, inbox, and board visible without forcing users to think in internal sessions."}
              </p>
            </section>

            <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-cream)] p-5 shadow-[8px_8px_0_0_var(--shock-yellow)]">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Run detail</p>
                <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(selectedRoom.topic.status))}>
                  {selectedRoom.topic.status}
                </span>
              </div>
              <dl className="mt-4 space-y-3">
                <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
                    Runtime
                  </dt>
                  <dd className="mt-2 font-display text-xl font-semibold">shock-main / Codex</dd>
                </div>
                <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
                    Branch
                  </dt>
                  <dd className="mt-2 font-display text-xl font-semibold">{selectedRoom.topic.branch}</dd>
                </div>
                <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
                    Worktree
                  </dt>
                  <dd className="mt-2 font-display text-xl font-semibold">{selectedRoom.topic.worktree}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] p-5 text-white shadow-[8px_8px_0_0_var(--shock-pink)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">MVP contract</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-white/78">
                <li>Chat stays informal in channels.</li>
                <li>Serious work happens in Issue Rooms.</li>
                <li>Topic is visible, Session stays internal.</li>
                <li>Board supports the room instead of replacing it.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
