import { LiveIssuePageContent } from "@/components/live-detail-views";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ issueKey: string }>;
}) {
  const { issueKey } = await params;

  return <LiveIssuePageContent issueKey={issueKey} />;
}
