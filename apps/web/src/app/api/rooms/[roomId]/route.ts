import { NextResponse } from "next/server";

import type { Issue, Message, PhaseZeroState, PullRequest, Room, Run, Session } from "@/lib/phase-zero-types";
import { readControlJSON } from "@/lib/server-api";

type RoomDetailResponse = {
  room: Room;
  messages: Message[];
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  try {
    const [state, detail] = await Promise.all([
      readControlJSON<PhaseZeroState>("/v1/state"),
      readControlJSON<RoomDetailResponse>(`/v1/rooms/${roomId}`),
    ]);

    const room = detail.room;
    const issue = state.issues.find((candidate: Issue) => candidate.roomId === roomId) ?? null;
    const run = state.runs.find((candidate: Run) => candidate.id === room.runId) ?? null;
    const pullRequest =
      state.pullRequests.find((candidate: PullRequest) => candidate.roomId === roomId) ?? null;
    const session =
      state.sessions.find((candidate: Session) => candidate.activeRunId === room.runId) ??
      state.sessions.find((candidate: Session) => candidate.roomId === roomId) ??
      null;

    return NextResponse.json({
      room,
      issue,
      run,
      messages: detail.messages,
      pullRequest,
      session,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "room fetch failed";
    const status = message.includes("404") || message.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
