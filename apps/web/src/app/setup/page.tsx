import { OpenShockShell } from "@/components/open-shock-shell";
import { GitHubConnectionConsole } from "@/components/github-connection-console";
import { LiveBridgeConsole } from "@/components/live-bridge-console";
import {
  LiveSetupContextRail,
  LiveSetupOverview,
  OnboardingStudioPanel,
  SetupFirstStartJourneyPanel,
} from "@/components/live-setup-views";
import { RepoBindingConsole } from "@/components/repo-binding-console";
import { LiveRuntimeProvider } from "@/lib/live-runtime";

export default function SetupPage() {
  return (
    <LiveRuntimeProvider>
      <OpenShockShell
        view="setup"
        eyebrow="Onboarding Studio"
        title="把 `/access` 和 `/setup` 收成同一条首次启动主链"
        description="这里不再只摆静态 setup 步骤卡，而是直接镜像 access recovery、template bootstrap、repo binding、GitHub effective auth path、runtime bridge 与当前 resume progress。"
        contextTitle="首次启动在线"
        contextDescription="当 access recovery、模板选择、repo/GitHub/runtime 真值和 resumable progress 都直接从 live contract 读清时，首次启动才算真正站住。"
        contextBody={<LiveSetupContextRail />}
      >
        <div className="space-y-4">
          <LiveSetupOverview />
          <SetupFirstStartJourneyPanel />
          <OnboardingStudioPanel />
          <RepoBindingConsole />
          <GitHubConnectionConsole />
          <LiveBridgeConsole />
        </div>
      </OpenShockShell>
    </LiveRuntimeProvider>
  );
}
