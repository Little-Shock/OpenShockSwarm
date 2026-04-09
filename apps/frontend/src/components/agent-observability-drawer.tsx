"use client";

import { useState } from "react";
import type {
  Agent,
  AgentSession,
  AgentTurn,
  AgentWait,
  HandoffRecord,
} from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";

type AgentObservabilityDrawerProps = {
  agents: Agent[];
  sessions: AgentSession[];
  turns: AgentTurn[];
  waits: AgentWait[];
  handoffs: HandoffRecord[];
  candidateAgentIds?: string[];
};

function formatStatusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function sessionBadgeTone(status: string): BadgeTone {
  switch (status) {
    case "responding":
    case "claimed":
      return "blue";
    case "completed":
    case "resolved":
    case "accepted":
      return "green";
    case "waiting_human":
    case "handoff_requested":
    case "blocked":
      return "orange";
    default:
      return "neutral";
  }
}

function agentName(agentId: string, agents: Agent[]) {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

export function AgentObservabilityDrawer({
  agents,
  sessions,
  turns,
  waits,
  handoffs,
  candidateAgentIds,
}: AgentObservabilityDrawerProps) {
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);
  const visibleAgents = agents.filter((agent) =>
    candidateAgentIds && candidateAgentIds.length > 0
      ? candidateAgentIds.includes(agent.id)
      : true,
  );

  const selectedAgent = visibleAgents.find((agent) => agent.id === openAgentId) ?? null;
  const selectedSessions = selectedAgent
    ? sessions
        .filter((session) => session.agentId === selectedAgent.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];
  const selectedTurns = selectedAgent
    ? turns.filter((turn) => turn.agentId === selectedAgent.id)
    : [];

  const latestTurns = new Map<string, AgentTurn>();
  for (const turn of turns) {
    const previous = latestTurns.get(turn.sessionId);
    if (!previous || turn.sequence > previous.sequence) {
      latestTurns.set(turn.sessionId, turn);
    }
  }

  const openWaits = new Map(
    waits
      .filter((wait) => wait.status === "waiting_human")
      .map((wait) => [wait.sessionId, wait]),
  );
  const queuedHandoffs = new Map(
    handoffs
      .filter((handoff) => handoff.status !== "accepted")
      .map((handoff) => [handoff.fromSessionId, handoff]),
  );

  return (
    <>
      <Card className="rounded-[10px] bg-[var(--surface-muted)] px-2.5 py-2.5 text-[var(--foreground)]">
        <Eyebrow className="mb-1.5 text-black/50">Active Agents</Eyebrow>
        {visibleAgents.length === 0 ? (
          <p className="text-[12px] text-black/55">No room-linked agents yet.</p>
        ) : (
          <div className="space-y-1.5">
            {visibleAgents.map((agent) => {
              const agentTurnCount = turns.filter((turn) => turn.agentId === agent.id).length;
              const activeSession = sessions
                .filter((session) => session.agentId === agent.id)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setOpenAgentId(agent.id)}
                  className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left transition hover:bg-white/70"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px]">{agent.name}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-black/45">
                      {activeSession ? formatStatusLabel(activeSession.status) : "no session"} ·{" "}
                      {agentTurnCount} turns
                    </div>
                  </div>
                  <span className="rounded-full bg-[var(--accent-blue-soft)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--accent-blue)]">
                    inspect
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {selectedAgent ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close agent drawer"
            onClick={() => setOpenAgentId(null)}
            className="absolute inset-0 bg-black/18 backdrop-blur-[1px]"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[680px] border-l border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_80px_rgba(31,35,41,0.22)]">
            <div className="flex h-full flex-col">
              <div className="border-b border-[var(--border)] bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Eyebrow className="text-black/50">Agent Observability</Eyebrow>
                    <div className="display-font mt-1 text-xl font-black">
                      {selectedAgent.name}
                    </div>
                    <div className="mt-1 text-[13px] text-black/60">
                      {selectedAgent.id} · {selectedAgent.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={sessionBadgeTone(selectedAgent.status)}>
                      {formatStatusLabel(selectedAgent.status)}
                    </Badge>
                    <Badge tone="blue-soft">{selectedTurns.length} turns</Badge>
                    <button
                      type="button"
                      onClick={() => setOpenAgentId(null)}
                      className="rounded-[10px] border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-black/65 transition hover:bg-[var(--surface-muted)]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Card className="rounded-[10px] px-3 py-2.5">
                    <Eyebrow>Agent Sessions</Eyebrow>
                    <div className="mt-1 display-font text-xl font-black">
                      {selectedSessions.length}
                    </div>
                  </Card>
                  <Card className="rounded-[10px] px-3 py-2.5">
                    <Eyebrow>Queued Turns</Eyebrow>
                    <div className="mt-1 display-font text-xl font-black">
                      {selectedTurns.filter((turn) => turn.status === "queued").length}
                    </div>
                  </Card>
                  <Card className="rounded-[10px] px-3 py-2.5">
                    <Eyebrow>Responding Now</Eyebrow>
                    <div className="mt-1 display-font text-xl font-black">
                      {selectedSessions.filter((session) => session.status === "responding").length}
                    </div>
                  </Card>
                </div>

                <Card className="mt-3 rounded-[10px] px-3 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Eyebrow>Session Detail</Eyebrow>
                    <Badge tone="blue-soft">{selectedSessions.length} sessions</Badge>
                  </div>
                  {selectedSessions.length === 0 ? (
                    <p className="text-[12px] leading-5 text-black/60">
                      No sessions for this agent in the current room yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {selectedSessions.map((session) => {
                        const turn = latestTurns.get(session.id);
                        const wait = openWaits.get(session.id);
                        const handoff = queuedHandoffs.get(session.id);

                        return (
                          <div
                            key={session.id}
                            className="rounded-[10px] border border-[var(--border)] bg-white px-3 py-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[11px] text-black/55">
                                {session.id} · provider thread {session.providerThreadId ?? "pending"}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone={sessionBadgeTone(session.status)}>
                                  {formatStatusLabel(session.status)}
                                </Badge>
                                {turn ? (
                                  <Badge tone={sessionBadgeTone(turn.status)}>
                                    turn {turn.sequence}: {formatStatusLabel(turn.status)}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-2 grid gap-2 text-[12px] text-black/68 md:grid-cols-2">
                              <div>
                                Current intent:{" "}
                                {turn ? formatStatusLabel(turn.intentType) : "no turn yet"}
                              </div>
                              <div>
                                Last update: <LocalTime value={session.updatedAt} withSeconds />
                              </div>
                              <div>
                                Waiting state:{" "}
                                {wait ? `waiting on ${wait.blockingMessageId}` : "not waiting"}
                              </div>
                              <div>
                                Handoff:{" "}
                                {handoff
                                  ? `queued to ${agentName(handoff.toAgentId, agents)}`
                                  : "none"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
