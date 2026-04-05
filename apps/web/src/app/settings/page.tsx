import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, SettingsView } from "@/components/phase-zero-views";

export default function SettingsPage() {
  return (
    <OpenShockShell
      view="settings"
      eyebrow="全局设置"
      title="先定策略，再谈魔法"
      description="Phase 0 把关键旋钮都摆在明面上：身份、沙盒默认值、记忆模式，以及通知规则。"
      contextTitle="当前技术栈"
      contextDescription="前端是 Next.js，后端和本地 daemon 都是 Go。这一层先把产品契约定清楚，再把真实服务接上。"
      contextBody={
        <DetailRail
          label="Runtime 栈"
          items={[
            { label: "Web", value: "Next.js 16" },
            { label: "API", value: "Go" },
            { label: "Daemon", value: "Go" },
            { label: "记忆", value: "文件优先" },
          ]}
        />
      }
    >
      <SettingsView />
    </OpenShockShell>
  );
}
