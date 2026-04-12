import type { Agent, Member, RoomSummary } from "@/lib/types";

export type MentionSuggestion = {
  id: string;
  kind: "agent" | "room" | "member";
  trigger: "@" | "#";
  insertText: string;
  primaryLabel: string;
  secondaryLabel?: string;
  lookupTokens: string[];
};

export type MentionSegment = {
  key: string;
  text: string;
  kind: "text" | "agent" | "room" | "member";
  isCurrentUser: boolean;
};

export type CompletionMatch = {
  trigger: "@" | "#";
  start: number;
  end: number;
  query: string;
};

const TRAILING_PUNCTUATION = ".,:;!?()[]{}<>\"'，。；：！？、】【（）";

function normalizeLookupToken(value: string) {
  const trimmed = value.trim().replace(/^[@#]/, "").trim();
  return trimmed.replace(new RegExp(`[${escapeForCharClass(TRAILING_PUNCTUATION)}]+$`), "").toLowerCase();
}

function escapeForCharClass(value: string) {
  return value.replace(/[-\\\]^]/g, "\\$&");
}

function buildLookupVariants(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const base = trimmed.toLowerCase();
  return Array.from(
    new Set([
      base,
      base.replace(/\s+/g, ""),
      base.replace(/\s+/g, "_"),
      base.replace(/\s+/g, "-"),
    ].filter(Boolean)),
  );
}

function buildRoomReference(room: RoomSummary) {
  const title = room.title.trim();
  if (!title) {
    return room.id.toLowerCase();
  }

  const lowered = title.toLowerCase();
  const compact = lowered.replace(/\s+/g, "-");
  const cleaned = compact.replace(/[^\p{L}\p{N}_-]+/gu, "");
  return cleaned || room.id.toLowerCase();
}

export function buildMentionSuggestions(
  agents: Agent[],
  rooms: RoomSummary[],
  directRooms: RoomSummary[],
  member: Member | null,
) {
  const suggestions: MentionSuggestion[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    const insertText = `@${agent.name}`;
    if (seen.has(insertText)) {
      continue;
    }
    seen.add(insertText);
    suggestions.push({
      id: `agent:${agent.id}`,
      kind: "agent",
      trigger: "@",
      insertText,
      primaryLabel: insertText,
      secondaryLabel: "Agent",
      lookupTokens: [
        ...buildLookupVariants(agent.name),
        ...buildLookupVariants(agent.id),
      ],
    });
  }

  if (member) {
    const insertText = `@${member.username}`;
    if (!seen.has(insertText)) {
      seen.add(insertText);
      suggestions.push({
        id: `member:${member.id}`,
        kind: "member",
        trigger: "@",
        insertText,
        primaryLabel: insertText,
        secondaryLabel: member.displayName,
        lookupTokens: [
          ...buildLookupVariants(member.username),
          ...buildLookupVariants(member.displayName),
        ],
      });
    }
  }

  for (const room of [...rooms, ...directRooms]) {
    const roomReference = buildRoomReference(room);
    const insertText = `#${roomReference}`;
    if (seen.has(insertText)) {
      continue;
    }
    seen.add(insertText);
    suggestions.push({
      id: `room:${room.id}`,
      kind: "room",
      trigger: "#",
      insertText,
      primaryLabel: insertText,
      secondaryLabel: room.title,
      lookupTokens: [
        roomReference,
        ...buildLookupVariants(room.title),
        ...buildLookupVariants(room.id),
      ],
    });
  }

  return suggestions;
}

export function findCompletionMatch(value: string, caret: number): CompletionMatch | null {
  const boundedCaret = Math.max(0, Math.min(caret, value.length));
  let tokenStart = boundedCaret - 1;
  while (tokenStart >= 0 && !/\s/.test(value[tokenStart])) {
    tokenStart -= 1;
  }
  tokenStart += 1;

  if (tokenStart >= boundedCaret) {
    return null;
  }

  const token = value.slice(tokenStart, boundedCaret);
  const triggerOffset = Math.max(token.lastIndexOf("@"), token.lastIndexOf("#"));
  if (triggerOffset < 0) {
    return null;
  }
  const trigger = token[triggerOffset];
  if (trigger !== "@" && trigger !== "#") {
    return null;
  }
  const start = tokenStart + triggerOffset;

  return {
    trigger,
    start,
    end: boundedCaret,
    query: normalizeLookupToken(token.slice(triggerOffset + 1)),
  };
}

export function filterMentionSuggestions(
  suggestions: MentionSuggestion[],
  match: CompletionMatch | null,
) {
  if (!match) {
    return [];
  }

  const filtered = suggestions.filter((suggestion) => {
    if (suggestion.trigger !== match.trigger) {
      return false;
    }
    if (!match.query) {
      return true;
    }
    return suggestion.lookupTokens.some(
      (token) => token.startsWith(match.query) || token.includes(match.query),
    );
  });

  return filtered.sort((left, right) => {
    const leftStarts = left.lookupTokens.some((token) => token.startsWith(match.query));
    const rightStarts = right.lookupTokens.some((token) => token.startsWith(match.query));
    if (leftStarts !== rightStarts) {
      return leftStarts ? -1 : 1;
    }
    return left.primaryLabel.localeCompare(right.primaryLabel);
  });
}

export function applyMentionSuggestion(
  value: string,
  match: CompletionMatch,
  suggestion: MentionSuggestion,
) {
  const prefix = value.slice(0, match.start);
  const suffix = value.slice(match.end);
  const needsTrailingSpace =
    suffix.length > 0 && !/^\s/.test(suffix);
  const nextValue = `${prefix}${suggestion.insertText}${needsTrailingSpace ? " " : ""}${suffix}`;
  const caret = prefix.length + suggestion.insertText.length + (needsTrailingSpace ? 1 : 0);
  return { value: nextValue, caret };
}

export function parseMentionSegments(
  value: string,
  suggestions: MentionSuggestion[],
  member: Member | null,
): MentionSegment[] {
  if (!value) {
    return [{ key: "empty", text: "", kind: "text", isCurrentUser: false }];
  }

  const roomLookup = new Set(
    suggestions
      .filter((suggestion) => suggestion.kind === "room")
      .flatMap((suggestion) => suggestion.lookupTokens),
  );
  const agentLookup = new Set(
    suggestions
      .filter((suggestion) => suggestion.kind === "agent")
      .flatMap((suggestion) => suggestion.lookupTokens),
  );
  const currentUserLookup = new Set([
    ...buildLookupVariants(member?.username ?? ""),
    ...buildLookupVariants(member?.displayName ?? ""),
  ]);

  const segments: MentionSegment[] = [];
  const tokenPattern = /([@#][^\s@#]+)/g;
  let lastIndex = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const token = match[0];
    if (index > lastIndex) {
      segments.push({
        key: `text:${lastIndex}`,
        text: value.slice(lastIndex, index),
        kind: "text",
        isCurrentUser: false,
      });
    }

    const normalized = normalizeLookupToken(token);
    const trigger = token[0];
    const isCurrentUser = trigger === "@" && currentUserLookup.has(normalized);
    let kind: MentionSegment["kind"] = "text";
    if (trigger === "#" && roomLookup.has(normalized)) {
      kind = "room";
    } else if (trigger === "@") {
      if (isCurrentUser) {
        kind = "member";
      } else if (agentLookup.has(normalized)) {
        kind = "agent";
      }
    }

    segments.push({
      key: `token:${index}`,
      text: token,
      kind,
      isCurrentUser,
    });
    lastIndex = index + token.length;
  }

  if (lastIndex < value.length) {
    segments.push({
      key: `text:${lastIndex}`,
      text: value.slice(lastIndex),
      kind: "text",
      isCurrentUser: false,
    });
  }

  return segments;
}
