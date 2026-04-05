import { OpenShockShell } from "@/components/open-shock-shell";
import { LiveIssuesListView } from "@/components/live-detail-views";
import { DetailRail } from "@/components/phase-zero-views";

export default function IssuesPage() {
  return (
    <OpenShockShell
      view="issues"
      eyebrow="Issue 总表"
      title="先拥有房间，再拥有执行"
      description="Issue 依然是最耐久的规划对象，只是每个严肃需求都会自动长成一个带 Run 的讨论间。"
      contextTitle="Issue -> 讨论间"
      contextDescription="在 Phase 0 里，每个 Issue 默认只有一个讨论间和一个 Topic。PR 不要求和 Session 一一绑定。"
      contextBody={
        <DetailRail
          label="Issue 模型"
          items={[
            { label: "Issue -> Room", value: "1:1" },
            { label: "Room -> Topic", value: "P0 阶段 1:1" },
            { label: "Session", value: "仅系统内部" },
            { label: "PR 绑定", value: "以房间为中心" },
          ]}
        />
      }
    >
      <LiveIssuesListView />
    </OpenShockShell>
  );
}
