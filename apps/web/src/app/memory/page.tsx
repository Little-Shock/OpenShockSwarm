import { OpenShockShell } from "@/components/open-shock-shell";
import {
  LiveMemoryContextRail,
  LiveMemoryView,
} from "@/components/live-memory-views";

export default function MemoryPage() {
  return (
    <OpenShockShell
      view="memory"
      eyebrow="Phase 5 记忆治理"
      title="把 file memory 收成可检查的 version / diff / audit center"
      description="这里不再只看 `MEMORY.md + notes/ + decisions/` 的文件名或摘要，而是直接消费 governed artifact registry、content diff 和 audit timeline。"
      contextTitle="Memory Ledger Online"
      contextDescription="当 artifact version、governance、content 和最近一版差异都能直接从 live contract 读清时，memory subsystem 才算真正站住。"
      contextBody={<LiveMemoryContextRail />}
    >
      <LiveMemoryView />
    </OpenShockShell>
  );
}
