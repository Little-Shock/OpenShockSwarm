import { LiveRunPageContent } from "@/components/live-detail-views";

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  return <LiveRunPageContent runId={runId} />;
}
