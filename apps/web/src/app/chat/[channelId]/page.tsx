import { notFound } from "next/navigation";

import { StitchChannelsView } from "@/components/stitch-chat-room-views";
import { getChannelById } from "@/lib/mock-data";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const channel = getChannelById(channelId);

  if (!channel) notFound();

  return <StitchChannelsView channelId={channel.id} />;
}
