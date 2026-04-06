import { NextResponse } from "next/server";

import type { WorkspaceSnapshot } from "@/lib/mock-data";
import { readControlJSON } from "@/lib/server-api";

export async function GET() {
  try {
    const workspace = await readControlJSON<WorkspaceSnapshot>("/v1/workspace");
    return NextResponse.json(workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "workspace fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
