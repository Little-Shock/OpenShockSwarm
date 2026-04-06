import { NextResponse } from "next/server";

import type { Run } from "@/lib/mock-data";
import { readControlJSON } from "@/lib/server-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  try {
    const run = await readControlJSON<Run>(`/v1/runs/${runId}`);
    return NextResponse.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "run fetch failed";
    const status = message.includes("404") || message.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
