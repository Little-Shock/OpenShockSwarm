import { OpenShockShell } from "@/components/open-shock-shell";
import { LiveBridgeConsole } from "@/components/live-bridge-console";
import { DetailRail, SetupOverview } from "@/components/phase-zero-views";
import { RepoBindingConsole } from "@/components/repo-binding-console";

export default function SetupPage() {
  return (
    <OpenShockShell
      view="setup"
      eyebrow="Phase 0 配置"
      title="接通真实执行链"
      description="这里是 Phase 0 的操作脊柱：身份、仓库绑定、runtime 配对，以及第一条 PR 收口链。"
      contextTitle="工作区在线"
      contextDescription="当真实本地 runtime 能从创建讨论间一路走到 Run 真相和 PR 收口时，Phase 0 才算成立。"
      contextBody={
        <DetailRail
          label="配置检查点"
          items={[
            { label: "身份", value: "邮箱优先" },
            { label: "仓库", value: "GitHub 已连接" },
            { label: "Runtime", value: "shock-main 在线" },
            { label: "PR 链路", value: "mock / 下一步" },
          ]}
        />
      }
    >
      <div className="space-y-4">
        <SetupOverview />
        <RepoBindingConsole />
        <LiveBridgeConsole />
      </div>
    </OpenShockShell>
  );
}
