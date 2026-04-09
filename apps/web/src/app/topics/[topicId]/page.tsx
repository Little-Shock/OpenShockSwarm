import { LiveTopicPageContent } from "@/components/live-detail-views";

export default async function TopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;

  return <LiveTopicPageContent topicId={topicId} />;
}
