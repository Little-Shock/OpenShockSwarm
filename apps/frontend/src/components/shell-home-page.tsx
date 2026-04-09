import { getBootstrap, getRoom } from "@/lib/api";
import { RoomContextPanel } from "@/components/room-context-panel";
import type { Message } from "@/lib/types";
import { LiveRefresh } from "@/components/live-refresh";
import { RoomActionComposer } from "@/components/room-action-composer";
import { ShellFrame } from "@/components/shell-frame";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";

function badgeStyles(kind: string): BadgeTone {
  switch (kind) {
    case "blocked":
      return "orange";
    case "summary":
      return "blue-soft";
    case "log":
      return "purple";
    default:
      return "neutral";
  }
}

function messageToneStyles(kind: string, actorType: string) {
  if (kind === "blocked") {
    return "border-orange-200 bg-orange-50";
  }
  if (kind === "summary") {
    return "border-[var(--accent-blue)]/12 bg-[var(--accent-blue-soft)]/70";
  }
  if (actorType === "system") {
    return "border-[var(--border)] bg-[var(--surface-muted)]";
  }
  return "border-[var(--border)] bg-white";
}

function messageMetaLabel(kind: string) {
  switch (kind) {
    case "blocked":
      return "Needs attention";
    case "summary":
      return "Summary";
    case "log":
      return "Run log";
    default:
      return "";
  }
}

function MessageCard({ message }: { message: Message }) {
  const metaLabel = messageMetaLabel(message.kind);

  return (
    <article className="flex items-start gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--accent-blue-soft)] text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-blue)]">
        {message.actorName.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-black/50">
          <span className="display-font text-[12px] font-black tracking-normal text-black">
            {message.actorName}
          </span>
          <span>{message.actorType}</span>
          <span>
            <LocalTime value={message.createdAt} />
          </span>
          {metaLabel ? <span>· {metaLabel}</span> : null}
        </div>
        <div
          className={`rounded-[12px] border px-3 py-2.5 shadow-[0_4px_12px_rgba(31,35,41,0.04)] ${messageToneStyles(message.kind, message.actorType)}`}
        >
          {message.kind === "blocked" ? (
            <div className="mb-1.5">
              <Badge tone={badgeStyles(message.kind) as never}>{message.kind}</Badge>
            </div>
          ) : null}
          <p className="text-[14px] leading-5 text-black/80">{message.body}</p>
        </div>
      </div>
    </article>
  );
}

export async function ShellHomePage({ roomId }: { roomId?: string } = {}) {
  const bootstrap = await getBootstrap();
  const selectedRoomId = roomId ?? bootstrap.defaultRoomId;
  const room = await getRoom(selectedRoomId);
  const workspace = room.workspace ?? bootstrap.workspace;
  const realtimeScopes = [`workspace:${workspace.id}`, `room:${room.room.id}`];

  if (room.issue) {
    realtimeScopes.push(`issue:${room.issue.id}`);
  }

  return (
    <ShellFrame
      workspaceId={bootstrap.workspace.id}
      workspaceName={bootstrap.workspace.name}
      rooms={bootstrap.rooms}
      agents={bootstrap.agents}
      alignedTopRows
      footerPanel={null}
      rightRailWidthClass="md:grid-cols-[minmax(0,1fr)_360px]"
      activeRoute="/"
      activeRoomId={room.room.id}
      title={room.room.title}
      headerMeta={
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Badge tone={room.room.kind === "issue" ? "purple" : "blue-soft"}>
            {room.room.kind === "issue" ? "Issue Room" : "Discussion"}
          </Badge>
          {room.issue ? (
            <span className="shrink-0 text-[12px] font-medium text-black/58">
              {room.issue.id.replace("_", "#")} · {room.issue.status.replaceAll("_", " ")}
            </span>
          ) : (
            <span className="shrink-0 text-[12px] font-medium text-black/52">
              Shared workspace discussion
            </span>
          )}
          {room.issue?.summary ? (
            <span className="truncate text-[13px] font-medium text-black/58">
              {room.issue.summary}
            </span>
          ) : null}
        </div>
      }
      rightRail={
        <RoomContextPanel
          workspace={workspace}
          issue={room.issue}
          agents={bootstrap.agents}
          runtimes={bootstrap.runtimes}
          sessions={room.agentSessions}
          turns={room.agentTurns}
          waits={room.agentWaits}
          handoffs={room.handoffRecords}
          tasks={room.tasks}
          runs={room.runs}
          integrationBranch={room.integrationBranch}
          deliveryPr={room.deliveryPr}
          messageCount={room.messages.length}
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <LiveRefresh scopes={realtimeScopes} />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {room.messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </div>
        </div>
        <div className="border-t border-[var(--border)] bg-white px-3 py-2.5">
          <div className="mx-auto w-full max-w-3xl rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(31,35,41,0.05)]">
            <RoomActionComposer roomId={room.room.id} />
          </div>
        </div>
      </div>
    </ShellFrame>
  );
}
