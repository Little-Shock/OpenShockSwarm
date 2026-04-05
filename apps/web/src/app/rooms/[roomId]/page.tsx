import { notFound } from "next/navigation";

import { StitchDiscussionView } from "@/components/stitch-chat-room-views";
import { getRoomById } from "@/lib/mock-data";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const room = getRoomById(roomId);

  if (!room) notFound();

  return <StitchDiscussionView roomId={room.id} />;
}
