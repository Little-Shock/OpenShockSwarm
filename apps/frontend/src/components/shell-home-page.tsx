import { getBootstrap, getRoom } from "@/lib/api";
import { RoomContextPanel } from "@/components/room-context-panel";
import type { RoomDetailResponse } from "@/lib/types";
import { LiveRefresh } from "@/components/live-refresh";
import { RoomActionComposer } from "@/components/room-action-composer";
import { RoomMessageStream } from "@/components/room-message-stream";
import { ShellFrame } from "@/components/shell-frame";
import { Badge } from "@/components/ui/badge";
import { getCurrentSessionToken } from "@/lib/operator-server";
import { redirect } from "next/navigation";

function roomKindLabel(kind: RoomDetailResponse["room"]["kind"]) {
  switch (kind) {
    case "issue":
      return "Issue Room";
    case "direct_message":
      return "Private Chat";
    default:
      return "Discussion";
  }
}

export async function ShellHomePage({ roomId }: { roomId?: string } = {}) {
  const sessionToken = await getCurrentSessionToken();
  const initialBootstrap = await getBootstrap({ sessionToken });
  const selectedRoomId = roomId ?? initialBootstrap.defaultRoomId;
  if (!selectedRoomId) {
    redirect("/");
  }
  let room: RoomDetailResponse;
  try {
    room = await getRoom(selectedRoomId, { sessionToken });
  } catch {
    redirect("/");
  }
  const bootstrap = await getBootstrap({ sessionToken });
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
      directRooms={bootstrap.directRooms}
      alignedTopRows
      footerPanel={null}
      rightRailWidthClass="md:grid-cols-[minmax(0,1fr)_360px]"
      activeRoute="/"
      activeRoomId={room.room.id}
      title={room.room.title}
      headerMeta={
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Badge tone={room.room.kind === "issue" ? "purple" : "blue-soft"}>
            {roomKindLabel(room.room.kind)}
          </Badge>
          {room.issue ? (
            <span className="shrink-0 text-[12px] font-medium text-black/58">
              {room.issue.id.replace("_", "#")} · {room.issue.status.replaceAll("_", " ")}
            </span>
          ) : room.room.kind === "direct_message" ? (
            <span className="shrink-0 text-[12px] font-medium text-black/52">
              One-to-one chat with {room.room.title}
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
          roomId={room.room.id}
          roomKind={room.room.kind}
          roomDirectAgentId={room.room.directAgentId}
          workspace={workspace}
          issue={room.issue}
          agents={bootstrap.agents}
          runtimes={bootstrap.runtimes}
          sessions={room.agentSessions}
          turns={room.agentTurns}
          turnOutputChunks={room.agentTurnOutputChunks}
          turnToolCalls={room.agentTurnToolCalls}
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
        <RoomMessageStream
          roomId={room.room.id}
          unreadCount={room.room.unreadCount}
          messages={room.messages}
          agents={bootstrap.agents}
          rooms={bootstrap.rooms}
          directRooms={bootstrap.directRooms}
        />
        <div className="border-t border-[var(--border)] bg-white px-3 py-2.5">
          <div className="mx-auto w-full max-w-3xl rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 shadow-[0_6px_18px_rgba(31,35,41,0.05)]">
            <RoomActionComposer
              roomId={room.room.id}
              agents={bootstrap.agents}
              rooms={bootstrap.rooms}
              directRooms={bootstrap.directRooms}
              placeholder={
                room.room.kind === "direct_message"
                  ? `发私信给 ${room.room.title}，支持 @ 和 # ...`
                  : "发消息，支持 @agent 和 #room ..."
              }
            />
          </div>
        </div>
      </div>
    </ShellFrame>
  );
}
