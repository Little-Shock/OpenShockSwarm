import { OpenShockShell } from "@/components/open-shock-shell";
import { LiveIssuesListView } from "@/components/live-detail-views";
import { DetailRail } from "@/components/phase-zero-views";

export default function IssuesPage() {
  return (
    <OpenShockShell
      view="issues"
      eyebrow="事项"
      title="所有事项"
      description="这里集中查看当前事项，以及它对应的讨论间和执行记录。"
      contextTitle="事项关联"
      contextDescription="每个事项都会关联对应的讨论间和执行记录，方便继续处理。"
      contextBody={
        <DetailRail
          label="事项概览"
          items={[
            { label: "Issue -> Room", value: "1:1" },
            { label: "Room -> Topic", value: "1:1" },
            { label: "运行记录", value: "按房间关联" },
            { label: "PR 关联", value: "按房间关联" },
          ]}
        />
      }
    >
      <LiveIssuesListView />
    </OpenShockShell>
  );
}
