import { LiveRunPageContent } from "@/components/live-detail-views";

export default async function RunPage({
  params,
}: {
  params: Promise<{ roomId: string; runId: string }>;
}) {
  const { roomId, runId } = await params;

  return <LiveRunPageContent roomId={roomId} runId={runId} />;
}
