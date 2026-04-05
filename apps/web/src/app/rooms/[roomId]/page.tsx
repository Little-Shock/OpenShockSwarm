import { StitchDiscussionView } from "@/components/stitch-chat-room-views";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <StitchDiscussionView roomId={roomId} />;
}
