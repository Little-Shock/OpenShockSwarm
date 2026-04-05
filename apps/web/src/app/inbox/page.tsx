import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, InboxGrid } from "@/components/phase-zero-views";
import { inboxItems } from "@/lib/mock-data";

export default function InboxPage() {
  return (
    <OpenShockShell
      view="inbox"
      eyebrow="人类决策中心"
      title="收件箱"
      description="凡是需要人类判断的事情都落在这里：阻塞、批准、评审，以及关键状态变化。"
      contextTitle="收件箱默认策略"
      contextDescription="所有系统事件都进收件箱。浏览器 Push 只留给高优先级事件，保证信号不被淹没。"
      contextBody={
        <DetailRail
          label="通知策略"
          items={[
            { label: "收件箱", value: "所有事件" },
            { label: "Push", value: "仅高优先级" },
            { label: "邮件", value: "后续阶段" },
            { label: "Mailbox", value: "未来能力" },
          ]}
        />
      }
    >
      <InboxGrid items={inboxItems} />
    </OpenShockShell>
  );
}
