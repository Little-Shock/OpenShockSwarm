import { OpenShockShell } from "@/components/open-shock-shell";
import {
  LiveMemoryContextRail,
  LiveMemoryView,
} from "@/components/live-memory-views";

export default function MemoryPage() {
  return (
    <OpenShockShell
      view="memory"
      eyebrow="记忆"
      title="记忆与知识"
      description="在这里查看资料、管理来源，并决定下一次任务会带上哪些上下文。"
      contextTitle="记忆概览"
      contextDescription="版本、来源、可用范围和最近变更都会集中显示在这里。"
      contextBody={<LiveMemoryContextRail />}
    >
      <LiveMemoryView />
    </OpenShockShell>
  );
}
