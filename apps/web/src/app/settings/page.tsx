import { OpenShockShell } from "@/components/open-shock-shell";
import {
  LiveSettingsContextRail,
  LiveSettingsView,
} from "@/components/live-settings-views";

export default function SettingsPage() {
  return (
    <OpenShockShell
      view="settings"
      eyebrow="Phase 5 通知"
      title="把提醒系统从静态默认值推到可交付通知面"
      description="这里直接消费 live inbox / unread truth，并把浏览器 push 偏好、权限和 registration surface 摆到前台；真实 subscriber 与 fanout delivery 继续由后续 server / worker 票接上。"
      contextTitle="通知真值在线"
      contextDescription="前台现在要把 server 已知的通知默认值、本地浏览器能力和仍待接通的 delivery contract 分清楚。"
      contextBody={<LiveSettingsContextRail />}
    >
      <LiveSettingsView />
    </OpenShockShell>
  );
}
