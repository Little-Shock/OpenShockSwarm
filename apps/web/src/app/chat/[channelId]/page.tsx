import { StitchChannelsView } from "@/components/stitch-chat-room-views";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  return <StitchChannelsView channelId={channelId} />;
}
