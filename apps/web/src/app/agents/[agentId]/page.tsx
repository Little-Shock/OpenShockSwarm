import { LiveProfilePageContent } from "@/components/live-profile-views";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <LiveProfilePageContent kind="agent" profileId={agentId} />;
}
