import { redirect } from "next/navigation";

import { buildProfileHref } from "@/lib/profile-surface";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  redirect(buildProfileHref("agent", agentId));
}
