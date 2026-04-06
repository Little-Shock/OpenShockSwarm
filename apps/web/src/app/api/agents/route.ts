import { NextResponse } from "next/server";

import type { AgentStatus } from "@/lib/mock-data";
import { readControlJSON } from "@/lib/server-api";

export async function GET() {
  try {
    const agents = await readControlJSON<AgentStatus[]>("/v1/agents");
    return NextResponse.json(agents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
