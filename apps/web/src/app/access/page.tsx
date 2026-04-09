import { LiveAccessContextRail, LiveAccessOverview } from "@/components/live-access-views";
import { OpenShockShell } from "@/components/open-shock-shell";

export default function AccessPage() {
  return (
    <OpenShockShell
      view="access"
      eyebrow="Phase 5 身份"
      title="把身份恢复链接进首次启动主路径"
      description="这里直接消费 live auth session、workspace member 和 role truth，并明确告诉用户下一步是继续 `/setup` 还是已经可以回到主工作面。"
      contextTitle="Auth / Member / Guard"
      contextDescription="当前仓库已经有 email login/logout、session persistence 与 workspace member roster contract；这页现在继续把 access recovery 和 setup onboarding 串成同一条 first-start journey。"
      contextBody={<LiveAccessContextRail />}
    >
      <LiveAccessOverview />
    </OpenShockShell>
  );
}
