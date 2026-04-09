import Link from "next/link";
import { RoomCreateDialog } from "@/components/room-create-dialog";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { Agent, RoomSummary } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

type ShellFrameProps = {
  workspaceId: string;
  workspaceName: string;
  rooms: RoomSummary[];
  agents: Agent[];
  alignedTopRows?: boolean;
  sidebarPanel?: React.ReactNode;
  footerPanel?: React.ReactNode;
  rightRailWidthClass?: string;
  activeRoute: "/" | "/board" | "/inbox" | "/profile" | "/settings";
  activeRoomId?: string;
  title: string;
  headerMeta?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  rightRail?: React.ReactNode;
};

const navItems = [
  { href: "/board", label: "Task Board" },
  { href: "/inbox", label: "Inbox" },
  { href: "/profile", label: "Personal Info" },
  { href: "/settings", label: "System Config" },
];

export function ShellFrame({
  workspaceId,
  workspaceName,
  rooms,
  agents,
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
  const discussionRooms = rooms.filter((room) => room.kind === "discussion");
  const issueRooms = rooms.filter((room) => room.kind === "issue");
  const hasRightRail = Boolean(rightRail);
  const resolvedRightRailWidthClass = rightRailWidthClass ?? "md:grid-cols-[minmax(0,1fr)_280px]";
  const resolvedFooterPanel =
    footerPanel !== undefined ? footerPanel : (
      <Card className="rounded-[12px] bg-[var(--surface-muted)] px-3 py-2.5 text-[var(--foreground)]">
        <Eyebrow className="mb-1.5 text-black/50">Active Agents</Eyebrow>
        <div className="space-y-1.5">
          {agents.slice(0, 3).map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between text-[13px]"
            >
              <span>{agent.name}</span>
              <span className="rounded-full bg-[var(--accent-blue-soft)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                {agent.status}
              </span>
            </div>
          ))}
        </div>
      </Card>
    );

  return (
    <div className="h-screen overflow-hidden">
      <div className="card-enter grid h-full grid-cols-1 overflow-hidden bg-[var(--surface)] md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-auto border-b border-[var(--border)] bg-[var(--surface)] md:border-r md:border-b-0">
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

            <div className="flex min-h-0 flex-1 flex-col gap-4 px-2.5 py-3">
              <WorkspaceSwitcher workspaceName={workspaceName} />

              <section className="flex min-h-0 flex-1 flex-col border-t border-[var(--border)] pt-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Eyebrow className="tracking-[0.18em]">Rooms {rooms.length}</Eyebrow>
                  <RoomCreateDialog workspaceId={workspaceId} />
                </div>
                <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
                  <div>
                    <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-black/45">
                      Discussion
                    </div>
                    <div className="space-y-1.5">
                      {discussionRooms.map((room) => {
                        const active = room.id === activeRoomId;
                        return (
                          <Link
                            key={room.id}
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
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-black/45">
                      Issue Rooms
                    </div>
                    <div className="space-y-1.5">
                      {issueRooms.map((room) => {
                        const active = room.id === activeRoomId;
                        return (
                          <Link
                            key={room.id}
                            href={`/rooms/${room.id}`}
                            className={`block rounded-[10px] border px-2.5 py-2 transition-colors ${
                              active
                                ? "border-[var(--accent-blue)] bg-[var(--accent-blue-soft)]"
                                : "border-[var(--border)] bg-white hover:bg-[var(--surface-muted)]"
                            }`}
                          >
                            <div className="display-font truncate text-[13px] font-bold">
                              {room.title}
                            </div>
                            <div className="mt-1.5 flex items-center justify-between text-[11px] text-black/55">
                              <span>{room.issueId?.replace("_", "#")}</span>
                              {room.unreadCount > 0 ? (
                                <span
                                  aria-label={`${room.unreadCount} unread messages`}
                                  className="h-2.5 w-2.5 rounded-full bg-[var(--accent-blue)]"
                                />
                              ) : null}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

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
            </div>

            {resolvedFooterPanel !== null ? (
              <div className="mt-auto border-t border-[var(--border)] px-2.5 py-2.5">
                {resolvedFooterPanel}
              </div>
            ) : null}
          </div>
        </aside>

        <div className={`grid min-h-0 grid-cols-1 ${hasRightRail ? resolvedRightRailWidthClass : ""}`}>
          <main className="flex min-h-0 flex-col border-r-0 border-[var(--border)] md:border-r">
            {alignedTopRows ? (
              <header className="bg-white">
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
              <header className="border-b border-[var(--border)] bg-white px-4 py-2.5">
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
            <aside className="min-h-0 overflow-auto border-t border-[var(--border)] bg-[var(--surface-muted)] md:border-t-0">
              {rightRail}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
