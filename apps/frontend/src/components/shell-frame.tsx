"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MobileDrawer } from "@/components/mobile-drawer";
import { RoomCreateDialog } from "@/components/room-create-dialog";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { ROOM_READ_EVENT, type RoomReadEventDetail } from "@/lib/room-read-events";
import type { RoomSummary } from "@/lib/types";
import { Eyebrow } from "@/components/ui/eyebrow";

type ShellFrameProps = {
  workspaceId: string;
  workspaceName: string;
  rooms: RoomSummary[];
  directRooms?: RoomSummary[];
  alignedTopRows?: boolean;
  sidebarPanel?: React.ReactNode;
  footerPanel?: React.ReactNode;
  rightRailWidthClass?: string;
  activeRoute: "/" | "/board" | "/inbox" | "/agents" | "/settings";
  activeRoomId?: string;
  title: string;
  headerMeta?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  rightRail?: React.ReactNode;
};

const navItems = [
  { href: "/board", label: "Task Board" },
  { href: "/agents", label: "Agents" },
  { href: "/inbox", label: "Inbox" },
  { href: "/settings", label: "Settings" },
];

function RoomLink({
  room,
  active,
}: {
  room: RoomSummary;
  active: boolean;
}) {
  return (
    <Link
      href={`/rooms/${room.id}`}
      className={`block rounded-[10px] border px-2.5 py-2 transition-colors ${
        active
          ? "border-[var(--accent-blue)] bg-[var(--accent-blue-soft)]"
          : "border-[var(--border)] bg-white hover:bg-[var(--surface-muted)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="display-font truncate text-[13px] font-bold">
          {room.title}
        </div>
        {room.unreadCount > 0 ? (
          <span
            aria-label={`${room.unreadCount} unread messages`}
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent-blue)]"
          />
        ) : null}
      </div>
      {room.kind === "issue" ? (
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-black/55">
          <span>{room.issueId?.replace("_", "#")}</span>
        </div>
      ) : null}
    </Link>
  );
}

function SidebarContent({
  workspaceId,
  workspaceName,
  rooms,
  directRooms,
  activeRoute,
  activeRoomId,
  sidebarPanel,
  footerPanel,
}: {
  workspaceId: string;
  workspaceName: string;
  rooms: RoomSummary[];
  directRooms: RoomSummary[];
  activeRoute: ShellFrameProps["activeRoute"];
  activeRoomId?: string;
  sidebarPanel?: React.ReactNode;
  footerPanel?: React.ReactNode | null;
}) {
  const discussionRooms = rooms.filter((room) => room.kind === "discussion");
  const issueRooms = rooms.filter((room) => room.kind === "issue");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-2.5 py-3">
      <WorkspaceSwitcher workspaceId={workspaceId} workspaceName={workspaceName} />

      <section className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)] pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Eyebrow className="tracking-[0.18em]">Rooms {rooms.length}</Eyebrow>
          <RoomCreateDialog workspaceId={workspaceId} />
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {rooms.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-white px-3 py-3 text-[13px] leading-6 text-black/62">
              No rooms yet. Create the first room to open a shared thread for people and agents.
            </div>
          ) : null}
          <div>
            <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-black/45">
              Discussion
            </div>
            <div className="space-y-1.5">
              {discussionRooms.map((room) => (
                <RoomLink key={room.id} room={room} active={room.id === activeRoomId} />
              ))}
              {discussionRooms.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-white px-2.5 py-2 text-[11px] text-black/45">
                  No discussion rooms yet.
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-black/45">
              Issue Rooms
            </div>
            <div className="space-y-1.5">
              {issueRooms.map((room) => (
                <RoomLink key={room.id} room={room} active={room.id === activeRoomId} />
              ))}
              {issueRooms.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-white px-2.5 py-2 text-[11px] text-black/45">
                  No issue rooms yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {directRooms.length > 0 ? (
        <section className="border-t border-[var(--border)] pt-4">
          <Eyebrow className="mb-2 tracking-[0.18em]">Agent Private Chat</Eyebrow>
          <div className="max-h-[188px] space-y-1.5 overflow-y-auto pr-1">
            {directRooms.map((room) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                aria-current={room.id === activeRoomId ? "page" : undefined}
                className={`block rounded-[10px] border px-2.5 py-2 transition-colors ${
                  room.id === activeRoomId
                    ? "border-[var(--accent-blue)] bg-[var(--accent-blue-soft)]"
                    : "border-[var(--border)] bg-white hover:bg-[var(--surface-muted)]"
                }`}
                title={room.title}
              >
                <div
                  className={`display-font truncate text-[13px] font-bold ${
                    room.id === activeRoomId ? "text-[var(--accent-blue)]" : "text-black/84"
                  }`}
                >
                  {room.title}
                </div>
                <div className="mt-1 truncate text-[11px] uppercase tracking-[0.12em] text-black/45">
                  private chat
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {sidebarPanel ?? (
        <section className="mt-auto border-t border-[var(--border)] pt-4">
          <Eyebrow className="mb-2 tracking-[0.18em]">Navigate</Eyebrow>
          <div className="space-y-1.5">
            {navItems.map((item) => {
              const active = activeRoute === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`display-font flex items-center justify-between rounded-[10px] border px-2.5 py-2 text-[13px] font-medium transition-colors ${
                    active
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]"
                      : "border-transparent bg-transparent text-black/70 hover:bg-black/[0.03]"
                  }`}
                >
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {footerPanel !== null ? (
        <div className="mt-auto border-t border-[var(--border)] px-0 py-2.5">
          {footerPanel}
        </div>
      ) : null}
    </div>
  );
}

export function ShellFrame({
  workspaceId,
  workspaceName,
  rooms,
  directRooms = [],
  alignedTopRows,
  sidebarPanel,
  footerPanel,
  rightRailWidthClass,
  activeRoute,
  activeRoomId,
  title,
  headerMeta,
  subtitle,
  children,
  rightRail,
}: ShellFrameProps) {
  const hasRightRail = Boolean(rightRail);
  const resolvedRightRailWidthClass = rightRailWidthClass ?? "md:grid-cols-[minmax(0,1fr)_280px]";
  const resolvedFooterPanel = footerPanel !== undefined ? footerPanel : null;
  const [visibleRooms, setVisibleRooms] = useState(rooms);
  const [visibleDirectRooms, setVisibleDirectRooms] = useState(directRooms);

  useEffect(() => {
    setVisibleRooms(rooms);
  }, [rooms]);

  useEffect(() => {
    setVisibleDirectRooms(directRooms);
  }, [directRooms]);

  useEffect(() => {
    const handleRoomRead = (event: Event) => {
      const detail = (event as CustomEvent<RoomReadEventDetail>).detail;
      const roomId = detail?.roomId?.trim();
      if (!roomId) {
        return;
      }

      const clearUnread = (room: RoomSummary) =>
        room.id === roomId && room.unreadCount > 0 ? { ...room, unreadCount: 0 } : room;

      setVisibleRooms((current) => current.map(clearUnread));
      setVisibleDirectRooms((current) => current.map(clearUnread));
    };

    window.addEventListener(ROOM_READ_EVENT, handleRoomRead as EventListener);
    return () => {
      window.removeEventListener(ROOM_READ_EVENT, handleRoomRead as EventListener);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--surface)] md:h-screen md:overflow-hidden">
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-white md:hidden">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="display-font text-sm font-semibold uppercase tracking-[0.16em]">
              OpenShock
            </div>
            <div className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-[0.14em] text-black/55">
              {workspaceName}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MobileDrawer label="Navigate" title="Navigate">
              <SidebarContent
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                rooms={visibleRooms}
                directRooms={visibleDirectRooms}
                activeRoute={activeRoute}
                activeRoomId={activeRoomId}
                sidebarPanel={sidebarPanel}
                footerPanel={resolvedFooterPanel}
              />
            </MobileDrawer>
            {hasRightRail ? (
              <MobileDrawer label="More" title={title}>
                <div className="p-3">{rightRail}</div>
              </MobileDrawer>
            ) : null}
          </div>
        </div>
        <div className="border-t border-[var(--border)] px-3 py-2.5">
          <div className="display-font text-base font-black uppercase tracking-[0.08em]">
            {title}
          </div>
          {headerMeta ? (
            <div className="mt-1.5 min-w-0 overflow-x-auto text-sm font-semibold text-black/80">
              {headerMeta}
            </div>
          ) : subtitle ? (
            <p className="mt-1 max-w-2xl text-[13px] text-black/65">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-screen grid-cols-1 bg-[var(--surface)] md:h-full md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-auto border-r border-[var(--border)] bg-[var(--surface)] md:block">
          <div className="flex h-full flex-col">
            {alignedTopRows ? (
              <div className="sticky top-0 z-10 bg-[var(--surface)] text-[var(--foreground)]">
                <div className="flex h-12 items-center bg-white px-3">
                  <div className="display-font text-sm font-semibold uppercase tracking-[0.16em]">
                    OpenShock
                  </div>
                </div>
                <div className="flex h-10 items-center border-b border-[var(--border)] bg-[var(--surface-muted)] px-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-black/55">
                    {workspaceName}
                  </div>
                </div>
              </div>
            ) : (
              <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[var(--foreground)]">
                <div className="display-font text-sm font-semibold uppercase tracking-[0.16em]">
                  OpenShock
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-black/55">
                  {workspaceName}
                </div>
              </div>
            )}
              <SidebarContent
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                rooms={visibleRooms}
                directRooms={visibleDirectRooms}
                activeRoute={activeRoute}
                activeRoomId={activeRoomId}
                sidebarPanel={sidebarPanel}
              footerPanel={resolvedFooterPanel}
            />
          </div>
        </aside>

        <div className={`grid min-h-0 grid-cols-1 ${hasRightRail ? resolvedRightRailWidthClass : ""}`}>
          <main className="flex min-h-0 flex-col border-r-0 border-[var(--border)] md:border-r">
            {alignedTopRows ? (
              <header className="hidden bg-white md:block">
                <div className="flex h-12 items-center px-4">
                  <div className="display-font text-lg font-black uppercase tracking-[0.08em]">
                    {title}
                  </div>
                </div>
                <div className="flex h-10 items-center border-b border-[var(--border)] px-4">
                  <div className="min-w-0 w-full text-sm font-semibold text-black/80">
                    {headerMeta ?? subtitle ?? ""}
                  </div>
                </div>
              </header>
            ) : (
              <header className="hidden border-b border-[var(--border)] bg-white px-4 py-2.5 md:block">
                <div>
                  <div>
                    <div className="display-font text-lg font-black uppercase tracking-[0.08em]">
                      {title}
                    </div>
                    {subtitle ? (
                      <p className="mt-0.5 max-w-2xl text-[13px] text-black/65">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>
                </div>
              </header>
            )}
            <div className="min-h-0 flex-1 overflow-auto bg-[var(--surface-muted)]">{children}</div>
          </main>

          {hasRightRail ? (
            <aside className="hidden min-h-0 overflow-auto border-t border-[var(--border)] bg-[var(--surface-muted)] md:block md:border-t-0">
              {rightRail}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
