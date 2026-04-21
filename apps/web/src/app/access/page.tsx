import { LiveAccessContextRail, LiveAccessOverview } from "@/components/live-access-views";
import { OpenShockShell } from "@/components/open-shock-shell";

export default function AccessPage() {
  return (
    <OpenShockShell
      view="access"
      eyebrow="身份"
      title="登录与成员"
      description="这里处理登录、成员切换、邮箱确认和设备授权。首次使用先完成引导。"
      contextTitle="当前登录情况"
      contextDescription="先确认当前身份和可用状态，其他恢复与权限操作放在下方。"
      contextBody={<LiveAccessContextRail />}
    >
      <LiveAccessOverview />
    </OpenShockShell>
  );
}
