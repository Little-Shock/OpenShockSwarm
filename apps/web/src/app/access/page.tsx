import { LiveAccessContextRail, LiveAccessOverview } from "@/components/live-access-views";
import { OpenShockShell } from "@/components/open-shock-shell";

export default function AccessPage() {
  return (
    <OpenShockShell
      view="access"
      eyebrow="Phase 5 身份"
      title="把登录、会话与成员真值正式收进前台"
      description="这里直接消费 live auth session、workspace member 和 role truth，把 login/logout/session foundation 摆成真实可操作 surface。"
      contextTitle="Auth / Member / Guard"
      contextDescription="当前仓库已经有 email login/logout、session persistence 与 workspace member roster contract；这页先把 foundation 收住，再把 invite / role mutation / action-level authz 留给后续票。"
      contextBody={<LiveAccessContextRail />}
    >
      <LiveAccessOverview />
    </OpenShockShell>
  );
}
