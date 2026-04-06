import { LiveAccessContextRail, LiveAccessOverview } from "@/components/live-access-views";
import { OpenShockShell } from "@/components/open-shock-shell";

export default function AccessPage() {
  return (
    <OpenShockShell
      view="access"
      eyebrow="Phase 5 身份"
      title="把登录入口、成员目录与权限闸门收进前台"
      description="这里直接消费当前 workspace / repo auth / control-plane truth，并把仍待 #53/#55 的 email session、member roster 与 role guard 缺口摆到台前。"
      contextTitle="Auth / Member / Guard"
      contextDescription="当前仓库已经有 workspace、repo auth、runtime pairing 与控制面真值，但邮箱 session、workspace member 和 role-aware permission 仍在下一拍 contract；这页先把边界和入口收成单值。"
      contextBody={<LiveAccessContextRail />}
    >
      <LiveAccessOverview />
    </OpenShockShell>
  );
}
