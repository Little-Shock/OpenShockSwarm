import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";
import type {
  Agent,
  AgentSession,
  AgentTurn,
  HandoffRecord,
  Runtime,
} from "@/lib/types";

type RoomSystemPanelProps = {
  agents: Agent[];
  runtimes: Runtime[];
  sessions: AgentSession[];
  turns: AgentTurn[];
  handoffs: HandoffRecord[];
  messageCount: number;
};

function metricCard(label: string, value: number, hint: string) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-white px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-black/45">{label}</div>
      <div className="display-font mt-1 text-lg font-black">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-black/55">{hint}</div>
    </div>
  );
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
    case "handoff_requested":
    case "blocked":
      return "orange";
    default:
      return "neutral";
  }
}

function formatStatusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function agentName(agentId: string, agents: Agent[]) {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

export function RoomSystemPanel({
  agents,
  runtimes,
  sessions,
  turns,
  handoffs,
  messageCount,
}: RoomSystemPanelProps) {
  const activeSessions = sessions
    .filter((session) => session.status !== "idle")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const onlineRuntimes = runtimes.filter((runtime) => runtime.status === "online");
  const busyRuntimes = runtimes.filter((runtime) => runtime.status === "busy");
  const queuedTurns = turns.filter((turn) => turn.status === "queued");
  const claimedTurns = turns.filter((turn) => turn.status === "claimed");
  const respondingSessions = sessions.filter((session) => session.status === "responding");
  const openHandoffs = handoffs
    .filter((handoff) => handoff.status !== "accepted")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestTurns = new Map<string, AgentTurn>();

  for (const turn of turns) {
    const previous = latestTurns.get(turn.sessionId);
    if (!previous || turn.sequence > previous.sequence) {
      latestTurns.set(turn.sessionId, turn);
    }
  }

  return (
    <section className="space-y-2.5">
      <div className="px-0.5">
        <Eyebrow className="tracking-[0.18em]">System</Eyebrow>
      </div>

      <Card className="rounded-[12px] px-2.5 py-2.5">
        <div className="grid gap-2 sm:grid-cols-2">
          {metricCard("Messages", messageCount, "chat events in this room")}
          {metricCard("Sessions", sessions.length, "agent contexts live here")}
          {metricCard("Queued Turns", queuedTurns.length, "waiting for daemon claim")}
          {metricCard("Open Handoffs", openHandoffs.length, "pending agent coordination")}
        </div>

        <div className="mt-2.5 space-y-1.5 border-t border-[var(--border)] pt-2.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-black/55">Runtime health</span>
            <span className="font-medium text-black/75">
              {onlineRuntimes.length} online · {busyRuntimes.length} busy
            </span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-black/55">Responding sessions</span>
            <span className="font-medium text-black/75">{respondingSessions.length}</span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-black/55">Claimed turns</span>
            <span className="font-medium text-black/75">{claimedTurns.length}</span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-black/55">Open handoffs</span>
            <span className="font-medium text-black/75">{openHandoffs.length}</span>
          </div>
        </div>
      </Card>

      <Card className="rounded-[12px] px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Eyebrow>Session Flow</Eyebrow>
          <Badge tone="dark">{activeSessions.length}</Badge>
        </div>
        {activeSessions.length === 0 ? (
          <p className="text-[12px] text-black/55">No active agent sessions in this room yet.</p>
        ) : (
          <div className="space-y-1.5">
            {activeSessions.map((session) => {
              const turn = latestTurns.get(session.id);

              return (
                <div
                  key={session.id}
                  className="rounded-[10px] border border-[var(--border)] bg-white px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium">
                        {agentName(session.agentId, agents)}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-black/45">
                        {session.id}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Badge tone={sessionBadgeTone(session.status)}>
                        {formatStatusLabel(session.status)}
                      </Badge>
                      {turn ? (
                        <Badge tone={sessionBadgeTone(turn.status)}>
                          turn {turn.sequence}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-1.5 grid gap-1 text-[11px] text-black/60">
                    <div>
                      Intent: {turn ? formatStatusLabel(turn.intentType) : "no turn yet"}
                    </div>
                    <div>
                      Last update: <LocalTime value={session.updatedAt} withSeconds />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {openHandoffs.length > 0 ? (
        <Card className="rounded-[12px] px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Eyebrow>Attention Queue</Eyebrow>
            <Badge tone="orange">{openHandoffs.length} open</Badge>
          </div>
          <div className="space-y-1.5">
            {openHandoffs.map((handoff) => (
              <div
                key={handoff.id}
                className="rounded-[10px] border border-[var(--border)] bg-white px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium">
                    {agentName(handoff.fromAgentId, agents)} to{" "}
                    {agentName(handoff.toAgentId, agents)}
                  </div>
                  <Badge tone="blue-soft">handoff</Badge>
                </div>
                <div className="mt-1 grid gap-1 text-[11px] text-black/60">
                  <div>Status: {formatStatusLabel(handoff.status)}</div>
                  <div>
                    Created: <LocalTime value={handoff.createdAt} withSeconds />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </section>
  );
}
