import { NextResponse } from "next/server";

import type { Message, PhaseZeroState } from "@/lib/mock-data";
import { readControlJSON } from "@/lib/server-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;
  try {
    const state = await readControlJSON<PhaseZeroState>("/v1/state");
    const channel = state.channels.find((candidate) => candidate.id === channelId);

    if (!channel) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...channel,
      messages: (state.channelMessages[channelId] ?? []) as Message[],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel fetch failed";
    const status = message.includes("404") || message.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
