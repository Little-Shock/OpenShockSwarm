import { OpenShockShell } from "@/components/open-shock-shell";
import { AgentsListView, DetailRail } from "@/components/phase-zero-views";

export default function AgentsPage() {
  return (
    <OpenShockShell
      view="agents"
      eyebrow="Agent 名录"
      title="一等公民，不是隐藏工具"
      description="Agent 必须是可见的行动者，带着 runtime 偏好、记忆绑定和可观察的最近 Run。"
      contextTitle="Agent 契约"
      contextDescription="Phase 0 先把 Agent 模型收成最小但显式的一组字段：名字、provider、runtime 偏好、记忆空间和最近执行真相。"
      contextBody={
        <DetailRail
          label="名录结构"
          items={[
            { label: "身份", value: "name + role" },
            { label: "Runtime 偏好", value: "机器级" },
            { label: "记忆", value: "仅文件空间" },
            { label: "Run 历史", value: "可见历史" },
          ]}
        />
      }
    >
      <AgentsListView />
    </OpenShockShell>
  );
}
