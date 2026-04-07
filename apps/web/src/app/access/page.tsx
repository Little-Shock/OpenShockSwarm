import { LiveAccessContextRail, LiveAccessOverview } from "@/components/live-access-views";
import { OpenShockShell } from "@/components/open-shock-shell";

export default function AccessPage() {
  return (
    <OpenShockShell
      view="access"
      eyebrow="Phase 5 身份"
      title="把 invite、成员 roster 和 role/status 真值正式收进前台"
      description="这里直接消费 live auth session、workspace member 和 role truth，并把 owner-side invite / member mutation 做成真实可操作 surface。"
      contextTitle="Auth / Member / Guard"
      contextDescription="当前仓库已经有 email login/logout、session persistence 与 workspace member roster contract；这页继续把 invite / role mutation 收平，并把 action-level authz matrix 留给后续票。"
      contextBody={<LiveAccessContextRail />}
    >
      <LiveAccessOverview />
    </OpenShockShell>
  );
}
