import { OpenShockShell } from "@/components/open-shock-shell";
import { GitHubConnectionConsole } from "@/components/github-connection-console";
import { LiveBridgeConsole } from "@/components/live-bridge-console";
import { LiveSetupContextRail, LiveSetupOverview } from "@/components/live-setup-views";
import { RepoBindingConsole } from "@/components/repo-binding-console";
import { LiveRuntimeProvider } from "@/lib/live-runtime";

export default function SetupPage() {
  return (
    <LiveRuntimeProvider>
      <OpenShockShell
        view="setup"
        eyebrow="Phase 4 配置"
        title="把 GitHub 安装态与 Runtime 真值收进前台"
        description="这里不再只摆 Phase 0 静态步骤卡，而是直接显示 GitHub effective auth path、repo binding contract、runtime bridge 与选择真值。"
        contextTitle="安装与配对在线"
        contextDescription="当 GitHub App install/auth、repo binding 和 runtime selection 都能直接从 live contract 读清时，Setup 才算真正站住。"
        contextBody={<LiveSetupContextRail />}
      >
        <div className="space-y-4">
          <LiveSetupOverview />
          <RepoBindingConsole />
          <GitHubConnectionConsole />
          <LiveBridgeConsole />
        </div>
      </OpenShockShell>
    </LiveRuntimeProvider>
  );
}
