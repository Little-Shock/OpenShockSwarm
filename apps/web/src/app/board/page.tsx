import { OpenShockShell } from "@/components/open-shock-shell";
import { BoardView, DetailRail } from "@/components/phase-zero-views";

export default function BoardPage() {
  return (
    <OpenShockShell
      view="board"
      eyebrow="全局任务板"
      title="任务板"
      description="任务板是全局扫描视图，用来辅助你看执行状态，不是产品的第一入口。"
      contextTitle="任务板从属原则"
      contextDescription="OpenShock 仍然是频道优先、讨论间优先。任务板只负责帮你扫描状态，不接管协作。"
      contextBody={
        <DetailRail
          label="任务板约束"
          items={[
            { label: "主体验", value: "频道 + 讨论间" },
            { label: "任务板角色", value: "辅助控制视图" },
            { label: "隐藏模型", value: "Session 内部维护" },
            { label: "收口", value: "PR 仍回到房间语境" },
          ]}
        />
      }
    >
      <BoardView />
    </OpenShockShell>
  );
}
