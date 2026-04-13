import { BranchHeadTruthConsole } from "@/components/branch-head-truth-console";
import { OpenShockShell } from "@/components/open-shock-shell";
import { GitHubConnectionConsole } from "@/components/github-connection-console";
import { LiveBridgeConsole } from "@/components/live-bridge-console";
import { LiveRolloutParityConsole } from "@/components/live-rollout-parity-console";
import {
  LiveSetupContextRail,
  LiveSetupOverview,
  OnboardingStudioPanel,
} from "@/components/live-setup-views";
import { RepoBindingConsole } from "@/components/repo-binding-console";
import { LiveRuntimeProvider } from "@/lib/live-runtime";

export default function SetupPage() {
  return (
    <LiveRuntimeProvider>
      <OpenShockShell
        view="setup"
        eyebrow="高级设置"
        title="设置与诊断"
        description="仓库、GitHub、运行环境和诊断都集中在这里。首次使用请先完成首页设置。"
        contextTitle="当前是否可用"
        contextDescription="先看主链路状态，详细信息按需展开。"
        contextBody={<LiveSetupContextRail />}
      >
        <div className="space-y-4">
          <OnboardingStudioPanel />
          <LiveSetupOverview />
          <details data-testid="setup-repo-section" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white px-5 py-4 shadow-[6px_6px_0_0_var(--shock-yellow)]">
            <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              展开仓库与远端
            </summary>
            <div className="mt-4 space-y-4">
              <RepoBindingConsole />
              <GitHubConnectionConsole />
            </div>
          </details>
          <details data-testid="setup-runtime-section" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white px-5 py-4 shadow-[6px_6px_0_0_var(--shock-pink)]">
            <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              展开运行环境
            </summary>
            <div className="mt-4 space-y-4">
              <LiveBridgeConsole />
            </div>
          </details>
          <details data-testid="setup-diagnostics-section" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white px-5 py-4 shadow-[6px_6px_0_0_var(--shock-lime)]">
            <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              展开诊断对账
            </summary>
            <div className="mt-4 space-y-4">
              <BranchHeadTruthConsole />
              <LiveRolloutParityConsole />
            </div>
          </details>
        </div>
      </OpenShockShell>
    </LiveRuntimeProvider>
  );
}
