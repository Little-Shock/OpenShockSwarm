"use client";

import { AgentObservabilitySurface } from "@/components/agent-observability-panel";
import type { Agent } from "@/lib/types";

type AgentObservabilityDrawerProps = {
  agents: Agent[];
  sessionToken: string;
  openAgentId: string | null;
  onOpenAgentIdChange: (agentId: string | null) => void;
  refreshKey?: string;
};

export function AgentObservabilityDrawer({
  agents,
  sessionToken,
  openAgentId,
  onOpenAgentIdChange,
  refreshKey,
}: AgentObservabilityDrawerProps) {
  return (
    <>
      {openAgentId ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close agent drawer"
            onClick={() => onOpenAgentIdChange(null)}
            className="absolute inset-0 bg-black/18 backdrop-blur-[1px]"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[680px] border-l border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_80px_rgba(31,35,41,0.22)]">
            <AgentObservabilitySurface
              agentId={openAgentId}
              sessionToken={sessionToken}
              agents={agents}
              refreshKey={refreshKey}
              showCloseButton
              onClose={() => onOpenAgentIdChange(null)}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}
