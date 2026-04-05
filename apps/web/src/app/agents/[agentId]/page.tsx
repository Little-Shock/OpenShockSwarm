import { notFound } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { AgentDetailView, DetailRail } from "@/components/phase-zero-views";
import { getAgentById, getRunsForAgent } from "@/lib/mock-data";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const agent = getAgentById(agentId);

  if (!agent) notFound();

  return (
    <OpenShockShell
      view="agents"
      eyebrow="Agent 详情"
      title={agent.name}
      description={agent.description}
      contextTitle={agent.lane}
      contextDescription="这是这个 Agent 当前拥有的泳道。人类应该能通过讨论间、Run 和 Inbox 看清这条泳道。"
      contextBody={
        <DetailRail
          label="绑定关系"
          items={[
            { label: "Provider", value: agent.provider },
            { label: "Runtime", value: agent.runtimePreference },
            { label: "状态语气", value: agent.mood },
            { label: "运行状态", value: agent.state === "running" ? "执行中" : agent.state === "blocked" ? "阻塞" : "待命" },
          ]}
        />
      }
    >
      <AgentDetailView agent={agent} runsForAgent={getRunsForAgent(agent.id)} />
    </OpenShockShell>
  );
}
