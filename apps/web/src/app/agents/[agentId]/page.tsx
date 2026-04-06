import { LiveAgentPageContent } from "@/components/live-detail-views";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <LiveAgentPageContent agentId={agentId} />;
}
