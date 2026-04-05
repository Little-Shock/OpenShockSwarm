import { notFound } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, RoomOverview } from "@/components/phase-zero-views";
import { getRoomById, getRunById } from "@/lib/mock-data";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const room = getRoomById(roomId);

  if (!room) notFound();

  const run = getRunById(room.runId);

  return (
    <OpenShockShell
      view="rooms"
      eyebrow="讨论间"
      title={room.title}
      description={room.summary}
      selectedRoomId={room.id}
      contextTitle={room.issueKey}
      contextDescription="Issue -> 讨论间 是一等用户心智。Topic 可见，Session 继续留在系统内部。"
      contextBody={
        <DetailRail
          label="执行上下文"
          items={[
            { label: "Runtime", value: run?.runtime ?? "等待中" },
            { label: "分支", value: run?.branch ?? "等待中" },
            { label: "Worktree", value: run?.worktree ?? "等待中" },
            { label: "PR", value: run?.pullRequest ?? "等待中" },
          ]}
        />
      }
    >
      <RoomOverview room={room} />
    </OpenShockShell>
  );
}
