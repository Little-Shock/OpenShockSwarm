"use client";

import { useEffect, useMemo, useState } from "react";
import { getAgentDetail } from "@/lib/api";
import type {
  Agent,
  AgentDetailResponse,
  AgentTurn,
  RoomSummary,
} from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";
import { cn } from "@/lib/cn";
import { restoreVisibleLineBreaks } from "@/lib/message-text";
import { useAutoScrollBottom } from "@/lib/use-auto-scroll-bottom";
import { collapseFeedItems, type AgentFeedItem } from "@/lib/agent-feed";

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
    case "handoff_requested":
    case "blocked":
      return "orange";
    default:
      return "neutral";
  }
}

function roomKindLabel(kind: RoomSummary["kind"]) {
  switch (kind) {
    case "direct_message":
      return "private chat";
    case "issue":
      return "issue";
    default:
      return "discussion";
  }
}

function roomKindTone(kind: RoomSummary["kind"]): BadgeTone {
  switch (kind) {
    case "issue":
      return "purple";
    case "direct_message":
      return "green";
    default:
      return "blue-soft";
  }
}

function streamTone(stream: string): BadgeTone {
  switch (stream) {
    case "session":
      return "green";
    case "stderr":
      return "orange";
    default:
      return "blue-soft";
  }
}

function turnSummaryLabel(item: Extract<AgentFeedItem, { kind: "turn" }>) {
  if (item.hasTriggerMessage) {
    return `Started turn ${item.turnSequence} from a new message.`;
  }

  return `Started turn ${item.turnSequence}.`;
}

function summarizeTriggerBody(body: string) {
  const compact = restoreVisibleLineBreaks(body).replace(/\s+/g, " ").trim();
  if (compact.length <= 180) {
    return compact;
  }

  return `${compact.slice(0, 177)}...`;
}

function resolveAgentDisplayName(actorName: string, agents: Agent[]) {
  const normalized = actorName.trim();
  if (!normalized) {
    return actorName;
  }

  return (
    agents.find((agent) => agent.id === normalized || agent.name === normalized)?.name ?? actorName
  );
}

type AgentObservabilityPanelProps = {
  detail: AgentDetailResponse;
  agents: Agent[];
  showCloseButton?: boolean;
  onClose?: () => void;
};

export function AgentObservabilityPanel({
  detail,
  agents,
  showCloseButton = false,
  onClose,
}: AgentObservabilityPanelProps) {
  const {
    agent,
    rooms,
    messages,
    agentSessions,
    agentTurns,
    agentTurnOutputChunks,
    agentTurnToolCalls,
    handoffRecords,
  } = detail;
  const selectedSessions = [...agentSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedTurns = agentTurns;
  const orderedTurns = [...selectedTurns].sort((a, b) => b.sequence - a.sequence);
  const selectedPrimarySession = selectedSessions[0] ?? null;
  const selectedTurnIds = new Set(selectedTurns.map((turn) => turn.id));
  const turnSequenceByTurnId = new Map(selectedTurns.map((turn) => [turn.id, turn.sequence]));
  const turnRoomIdByTurnId = new Map(selectedTurns.map((turn) => [turn.id, turn.roomId]));
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  const latestTurns = new Map<string, AgentTurn>();
  for (const turn of selectedTurns) {
    const previous = latestTurns.get(turn.sessionId);
    if (!previous || turn.sequence > previous.sequence) {
      latestTurns.set(turn.sessionId, turn);
    }
  }

  const queuedHandoffs = new Map(
    handoffRecords
      .filter((handoff) => handoff.status !== "accepted")
      .map((handoff) => [handoff.fromSessionId, handoff]),
  );

  const rawFeedItems: AgentFeedItem[] = [
    ...selectedTurns.map((turn) => {
      const triggerMessage = messageById.get(turn.triggerMessageId);
      return {
        id: `turn:${turn.id}`,
        kind: "turn" as const,
        turnId: turn.id,
        roomId: turn.roomId,
        createdAt: turn.createdAt,
        sequence: 0,
        turnSequence: turn.sequence,
        intentType: turn.intentType,
        wakeupMode: turn.wakeupMode,
        triggerActorName: triggerMessage?.actorName
          ? resolveAgentDisplayName(triggerMessage.actorName, agents)
          : undefined,
        triggerBody: triggerMessage?.body ? summarizeTriggerBody(triggerMessage.body) : undefined,
        hasTriggerMessage: Boolean(triggerMessage),
      };
    }),
    ...agentTurnOutputChunks
      .filter((chunk) => selectedTurnIds.has(chunk.turnId))
      .map((chunk) => ({
        id: chunk.id,
        kind: "output" as const,
        turnId: chunk.turnId,
        roomId: turnRoomIdByTurnId.get(chunk.turnId) ?? "",
        createdAt: chunk.createdAt,
        sequence: chunk.sequence,
        turnSequence: turnSequenceByTurnId.get(chunk.turnId) ?? 0,
        stream: chunk.stream,
        content: chunk.content,
      })),
    ...agentTurnToolCalls
      .filter((toolCall) => selectedTurnIds.has(toolCall.turnId))
      .map((toolCall) => ({
        id: toolCall.id,
        kind: "tool" as const,
        turnId: toolCall.turnId,
        roomId: turnRoomIdByTurnId.get(toolCall.turnId) ?? "",
        createdAt: toolCall.createdAt,
        sequence: toolCall.sequence,
        turnSequence: turnSequenceByTurnId.get(toolCall.turnId) ?? 0,
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        status: toolCall.status,
      })),
  ].sort((a, b) => {
    if (a.turnId === b.turnId && a.kind !== b.kind) {
      if (a.kind === "turn") {
        return -1;
      }
      if (b.kind === "turn") {
        return 1;
      }
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    if (a.turnSequence !== b.turnSequence) {
      return a.turnSequence - b.turnSequence;
    }
    if (a.sequence !== b.sequence) {
      return a.sequence - b.sequence;
    }
    return a.id.localeCompare(b.id);
  });
  const feedItems = collapseFeedItems(rawFeedItems);
  const lastFeedItem = feedItems[feedItems.length - 1];
  const feedChangeKey = !lastFeedItem
    ? "empty"
    : [
        feedItems.length,
        lastFeedItem.id,
        lastFeedItem.createdAt,
        lastFeedItem.kind,
        lastFeedItem.kind === "output"
          ? lastFeedItem.content.length
          : lastFeedItem.kind === "tool"
          ? lastFeedItem.status
          : lastFeedItem.turnSequence,
      ].join(":");
  const feedContainerRef = useAutoScrollBottom<HTMLDivElement>(feedChangeKey);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow className="text-black/50">Agent Observability</Eyebrow>
            <div className="display-font mt-1 text-xl font-black">{agent.name}</div>
            {agent.prompt ? (
              <div className="mt-2 max-w-2xl">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/42">
                  Agent Prompt
                </div>
                <div className="mt-1 text-[12px] leading-5 text-black/58">{agent.prompt}</div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={sessionBadgeTone(selectedPrimarySession?.status ?? "idle")}>
              {selectedPrimarySession ? formatStatusLabel(selectedPrimarySession.status) : "no session"}
            </Badge>
            <Badge tone="blue-soft">{orderedTurns.length} turns</Badge>
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-[10px] border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-black/65 transition hover:bg-[var(--surface-muted)]"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="rounded-[10px] px-3 py-2.5">
            <Eyebrow>Active Rooms</Eyebrow>
            <div className="mt-1 display-font text-xl font-black">{rooms.length}</div>
          </Card>
          <Card className="rounded-[10px] px-3 py-2.5">
            <Eyebrow>Agent Sessions</Eyebrow>
            <div className="mt-1 display-font text-xl font-black">{selectedSessions.length}</div>
          </Card>
          <Card className="rounded-[10px] px-3 py-2.5">
            <Eyebrow>Queued Turns</Eyebrow>
            <div className="mt-1 display-font text-xl font-black">
              {selectedTurns.filter((turn) => turn.status === "queued").length}
            </div>
          </Card>
          <Card className="rounded-[10px] px-3 py-2.5">
            <Eyebrow>Live Events</Eyebrow>
            <div className="mt-1 display-font text-xl font-black">
              {agentTurnOutputChunks.filter((chunk) => selectedTurnIds.has(chunk.turnId)).length +
                agentTurnToolCalls.filter((toolCall) => selectedTurnIds.has(toolCall.turnId)).length}
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
              No sessions for this agent in the workspace yet.
            </p>
          ) : (
            <div className="space-y-3">
              {selectedSessions.map((session) => {
                const turn = latestTurns.get(session.id);
                const handoff = queuedHandoffs.get(session.id);
                const room = roomById.get(session.roomId);

                return (
                  <div
                    key={session.id}
                    className="rounded-[10px] border border-[var(--border)] bg-white px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {room ? (
                            <Badge tone={roomKindTone(room.kind)}>{roomKindLabel(room.kind)}</Badge>
                          ) : null}
                          <div className="text-[12px] font-medium text-black/82">
                            {room?.title ?? session.roomId}
                          </div>
                        </div>
                        <div className="text-[11px] text-black/55">
                          {session.id} · provider thread {session.providerThreadId ?? "pending"}
                        </div>
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
                        Current intent: {turn ? formatStatusLabel(turn.intentType) : "no turn yet"}
                      </div>
                      <div>
                        Wakeup mode: {turn?.wakeupMode ? formatStatusLabel(turn.wakeupMode) : "direct"}
                      </div>
                      <div>
                        Last update: <LocalTime value={session.updatedAt} withSeconds />
                      </div>
                      <div>
                        App thread: {session.appServerThreadId ?? "not linked"}
                      </div>
                      <div>Handoff: {handoff ? "queued" : "none"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="mt-3 rounded-[10px] px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <Eyebrow>Session Feed</Eyebrow>
            <Badge tone="blue-soft">{feedItems.length} events</Badge>
          </div>
          {feedItems.length === 0 ? (
            <p className="text-[12px] leading-5 text-black/60">
              No live session feed for this agent yet.
            </p>
          ) : (
            <div
              ref={feedContainerRef}
              className="max-h-[640px] space-y-1.5 overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface-muted)] p-2"
            >
              {feedItems.map((item) => {
                const room = roomById.get(item.roomId);

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "relative rounded-[8px] border px-2.5 py-2",
                      item.kind === "turn"
                        ? "border-[#b9e2c7] bg-[#f4fbf6] pl-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
                        : "border-[var(--border)] bg-white",
                    )}
                  >
                    {item.kind === "turn" ? (
                      <div className="absolute inset-y-2 left-2 w-1 rounded-full bg-[#1f8f4d]" />
                    ) : null}
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.kind === "turn" ? (
                          <Badge
                            tone="green"
                            className="bg-[#1f8f4d] text-white shadow-[0_8px_18px_rgba(31,143,77,0.16)]"
                          >
                            turn start
                          </Badge>
                        ) : item.kind === "output" ? (
                          <Badge tone={streamTone(item.stream)}>{item.stream}</Badge>
                        ) : (
                          <>
                            <Badge tone="dark">{item.toolName}</Badge>
                            <Badge tone={sessionBadgeTone(item.status)}>
                              {formatStatusLabel(item.status)}
                            </Badge>
                          </>
                        )}
                        {room ? (
                          <Badge tone={roomKindTone(room.kind)}>{room.title}</Badge>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-black/45">
                        <LocalTime value={item.createdAt} withSeconds />
                      </div>
                    </div>
                    {item.kind === "turn" ? (
                      <div className="space-y-1.5">
                        <div className="text-[12px] leading-5 text-black/82">{turnSummaryLabel(item)}</div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.12em] text-black/45">
                          <span>{formatStatusLabel(item.intentType)}</span>
                          {item.wakeupMode ? <span>· {formatStatusLabel(item.wakeupMode)}</span> : null}
                        </div>
                        {item.triggerBody ? (
                          <div className="rounded-[8px] bg-[var(--surface-muted)] px-2.5 py-2 text-[11px] leading-5 text-black/70">
                            <span className="font-semibold text-black/82">
                              {item.triggerActorName ?? "trigger"}:
                            </span>{" "}
                            {item.triggerBody}
                          </div>
                        ) : null}
                      </div>
                    ) : item.kind === "output" ? (
                      item.stream === "session" ? (
                        <div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-black/82">
                          {item.content}
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-black/72">
                          {item.content}
                        </pre>
                      )
                    ) : item.arguments ? (
                      <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-black/60">
                        {item.arguments}
                      </pre>
                    ) : (
                      <div className="text-[11px] leading-5 text-black/52">
                        Tool executed with no arguments payload.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

type AgentObservabilitySurfaceProps = {
  agentId: string;
  sessionToken: string;
  agents: Agent[];
  refreshKey?: string;
  showCloseButton?: boolean;
  onClose?: () => void;
};

export function AgentObservabilitySurface({
  agentId,
  sessionToken,
  agents,
  refreshKey,
  showCloseButton = false,
  onClose,
}: AgentObservabilitySurfaceProps) {
  const [detail, setDetail] = useState<AgentDetailResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hasSession = Boolean(agentId.trim() && sessionToken.trim());
  const visibleDetail = useMemo(
    () => (detail?.agent.id === agentId ? detail : null),
    [agentId, detail],
  );

  useEffect(() => {
    const resolvedAgentId = agentId.trim();
    const resolvedSessionToken = sessionToken.trim();
    if (!resolvedAgentId || !resolvedSessionToken) {
      return;
    }

    const controller = new AbortController();
    void (async () => {
      setErrorMessage(null);
      setLoading(true);
      setDetail((current) => (current?.agent.id === resolvedAgentId ? current : null));

      try {
        const nextDetail = await getAgentDetail(resolvedAgentId, {
          sessionToken: resolvedSessionToken,
          signal: controller.signal,
        });
        setDetail(nextDetail);
        setLoading(false);
      } catch (error: unknown) {
        if ((error as { name?: string } | null)?.name === "AbortError") {
          return;
        }
        setDetail(null);
        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load agent observability.",
        );
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [agentId, refreshKey, sessionToken]);

  if (visibleDetail) {
    return (
      <AgentObservabilityPanel
        detail={visibleDetail}
        agents={agents}
        showCloseButton={showCloseButton}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow className="text-black/50">Agent Observability</Eyebrow>
            <div className="display-font mt-1 text-xl font-black">Loading agent…</div>
          </div>
          {showCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-black/65 transition hover:bg-[var(--surface-muted)]"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-[280px] flex-1 items-center justify-center px-4 py-6">
        <Card className="w-full max-w-[420px] rounded-[12px] px-4 py-4 text-center">
          <div className="display-font text-[16px] font-black text-black/86">
            {loading ? "Loading agent observability..." : "Agent observability unavailable"}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-black/62">
            {!hasSession
              ? "Login required."
              : loading
              ? "Fetching the latest session, turn, and tool activity for this agent."
              : errorMessage ?? "No observability payload is available yet."}
          </p>
        </Card>
      </div>
    </div>
  );
}
