import { OpenShockShell } from "@/components/open-shock-shell";
import { GitHubConnectionConsole } from "@/components/github-connection-console";
import { LiveBridgeConsole } from "@/components/live-bridge-console";
import { LiveSetupContextRail, LiveSetupOverview } from "@/components/live-setup-views";
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
      contextBody={<LiveSetupContextRail />}
    >
      <div className="space-y-4">
        <LiveSetupOverview />
        <RepoBindingConsole />
        <GitHubConnectionConsole />
        <LiveBridgeConsole />
      </div>
    </OpenShockShell>
  );
}
