import { notFound } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, RunDetailView } from "@/components/phase-zero-views";
import { getRoomById, getRunById } from "@/lib/mock-data";

export default async function RunPage({
  params,
}: {
  params: Promise<{ roomId: string; runId: string }>;
}) {
  const { roomId, runId } = await params;
  const room = getRoomById(roomId);
  const run = getRunById(runId);

  if (!room || !run || run.roomId !== room.id) notFound();

  return (
    <OpenShockShell
      view="rooms"
      eyebrow="Run 详情"
      title={run.id}
      description="Run 详情就是执行真相面：runtime、分支、worktree、日志、工具调用、审批状态和收口目标都在这里。"
      selectedRoomId={room.id}
      contextTitle={run.issueKey}
      contextDescription="每个活跃 Topic 都应该产出一个可见 Run。人类需要在 30 秒内定位问题落点。"
      contextBody={
        <DetailRail
          label="执行泳道"
          items={[
            { label: "负责人", value: run.owner },
            { label: "Provider", value: run.provider },
            { label: "开始时间", value: run.startedAt },
            { label: "时长", value: run.duration },
          ]}
        />
      }
    >
      <RunDetailView run={run} />
    </OpenShockShell>
  );
}
