"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";
import { useCurrentOperator } from "@/components/operator-provider";
import { cn } from "@/lib/cn";
import { restoreVisibleLineBreaks } from "@/lib/message-text";
import { buildMentionSuggestions, parseMentionSegments } from "@/lib/mentions";
import type { Agent, Message, RoomSummary } from "@/lib/types";

function resolveAgentDisplayName(actorName: string, agents: Agent[]) {
  const normalized = actorName.trim();
  if (!normalized) {
    return actorName;
  }

  return (
    agents.find((agent) => agent.id === normalized || agent.name === normalized)?.name ?? actorName
  );
}

function badgeStyles(kind: string): BadgeTone {
  switch (kind) {
    case "blocked":
      return "orange";
    case "summary":
      return "blue-soft";
    case "log":
      return "purple";
    default:
      return "neutral";
  }
}

function messageToneStyles(
  kind: string,
  actorType: string,
  isCurrentMemberMessage: boolean,
) {
  if (kind === "blocked") {
    return "border-orange-200 bg-orange-50";
  }
  if (kind === "summary") {
    return "border-[var(--accent-blue)]/12 bg-[var(--accent-blue-soft)]/70";
  }
  if (actorType === "system") {
    return "border-[var(--border)] bg-[var(--surface-muted)]";
  }
  if (isCurrentMemberMessage) {
    return "border-[var(--accent-blue)]/18 bg-[var(--accent-blue-soft)]/58";
  }
  return "border-[var(--border)] bg-white";
}

function messageMetaLabel(kind: string) {
  switch (kind) {
    case "blocked":
      return "Needs attention";
    case "summary":
      return "Summary";
    case "log":
      return "Run log";
    default:
      return "";
  }
}

export function RoomMessageCard({
  message,
  agents,
  rooms,
  directRooms,
}: {
  message: Message;
  agents: Agent[];
  rooms: RoomSummary[];
  directRooms: RoomSummary[];
}) {
  const { member, operatorName } = useCurrentOperator();
  const normalizedBody = restoreVisibleLineBreaks(message.body);

  if (message.actorType === "system") {
    return (
      <article className="py-1">
        <p className="mx-auto max-w-2xl text-center text-[13px] leading-6 text-black/46">
          {normalizedBody}
        </p>
      </article>
    );
  }

  const isCurrentMemberMessage =
    message.actorType === "member" &&
    Boolean(operatorName) &&
    message.actorName.trim() === operatorName;
  const actorDisplayName =
    message.actorType === "agent"
      ? resolveAgentDisplayName(message.actorName, agents)
      : message.actorName;
  const metaLabel = messageMetaLabel(message.kind);
  const mentionSuggestions = buildMentionSuggestions(agents, rooms, directRooms, member);
  const messageSegments = parseMentionSegments(normalizedBody, mentionSuggestions, member);

  return (
    <article className="flex items-start gap-2">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border text-[9px] font-semibold uppercase tracking-[0.1em]",
          isCurrentMemberMessage
            ? "border-[var(--accent-blue)]/20 bg-[var(--accent-blue)] text-white shadow-[0_6px_14px_rgba(51,112,255,0.16)]"
            : "border-[var(--border)] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]",
        )}
      >
        {actorDisplayName.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-black/50",
            isCurrentMemberMessage && "text-[var(--accent-blue)]/72",
          )}
        >
          <span
            className={cn(
              "display-font text-[12px] font-black tracking-normal text-black",
              isCurrentMemberMessage && "text-[var(--accent-blue)]",
            )}
          >
            {actorDisplayName}
          </span>
          <span>
            <LocalTime value={message.createdAt} />
          </span>
          {metaLabel ? <span>· {metaLabel}</span> : null}
        </div>
        <div
          className={cn(
            "rounded-[12px] border px-3 py-2.5 shadow-[0_4px_12px_rgba(31,35,41,0.04)]",
            messageToneStyles(message.kind, message.actorType, isCurrentMemberMessage),
          )}
        >
          {message.kind === "blocked" ? (
            <div className="mb-1.5">
              <Badge tone={badgeStyles(message.kind)}>{message.kind}</Badge>
            </div>
          ) : null}
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-[14px] leading-5 text-black/80",
              isCurrentMemberMessage && "text-black/84",
            )}
          >
            {messageSegments.map((segment) => (
              <span
                key={segment.key}
                className={cn(
                  segment.kind === "text" && "text-inherit",
                  segment.kind === "agent" &&
                    "rounded-[7px] bg-[var(--accent-blue-soft)] px-0.5 py-[1px] font-semibold text-[var(--accent-blue)]",
                  segment.kind === "room" &&
                    "rounded-[7px] bg-[#f2edff] px-0.5 py-[1px] font-semibold text-[#6b4fd3]",
                  segment.kind === "member" &&
                    "rounded-[7px] bg-[#fff1c8] px-0.5 py-[1px] font-semibold text-[#9a6a00]",
                  segment.isCurrentUser &&
                    "bg-[#ffe8a3] text-[#7d5600] shadow-[inset_0_0_0_1px_rgba(188,139,0,0.16)]",
                )}
              >
                {segment.text}
              </span>
            ))}
          </p>
        </div>
      </div>
    </article>
  );
}
