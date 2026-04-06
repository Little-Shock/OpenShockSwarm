import { NextResponse } from "next/server";

import type { InboxItem } from "@/lib/mock-data";
import { readControlJSON } from "@/lib/server-api";

export async function GET() {
  try {
    const inbox = await readControlJSON<InboxItem[]>("/v1/inbox");
    return NextResponse.json(inbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : "inbox fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
