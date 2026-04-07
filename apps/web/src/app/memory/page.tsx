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
      title="把 file memory 收成可治理、可注入、可提升的 memory center"
      description="这里直接消费 `/v1/memory` 和 `/v1/memory-center`，把 governed artifact registry、next-run injection preview、skill / policy promotion queue 与 audit timeline 收成同一页真值。"
      contextTitle="Memory Ledger Online"
      contextDescription="当 artifact version、policy、preview、promotion review 和最近一版差异都能直接从 live contract 读清时，memory subsystem 才算真正站住。"
      contextBody={<LiveMemoryContextRail />}
    >
      <LiveMemoryView />
    </OpenShockShell>
  );
}
