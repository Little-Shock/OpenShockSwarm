export type AgentFeedItem =
  | {
      id: string;
      kind: "turn";
      turnId: string;
      roomId: string;
      createdAt: string;
      sequence: number;
      turnSequence: number;
      intentType: string;
      wakeupMode?: string;
      triggerActorName?: string;
      triggerBody?: string;
      hasTriggerMessage: boolean;
    }
  | {
      id: string;
      kind: "output";
      turnId: string;
      roomId: string;
      createdAt: string;
      sequence: number;
      turnSequence: number;
      stream: string;
      content: string;
    }
  | {
      id: string;
      kind: "tool";
      turnId: string;
      roomId: string;
      createdAt: string;
      sequence: number;
      turnSequence: number;
      toolName: string;
      arguments?: string;
      status: string;
    };

export const DEFAULT_SESSION_FEED_LIMIT = 100;

export function mergeOutputContent(stream: string, current: string, next: string) {
  if (stream === "session") {
    return `${current}${next}`;
  }
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  if (current.endsWith("\n") || next.startsWith("\n")) {
    return `${current}${next}`;
  }
  return `${current}\n${next}`;
}

export function collapseFeedItems(items: AgentFeedItem[], limit = DEFAULT_SESSION_FEED_LIMIT) {
  const collapsed: AgentFeedItem[] = [];

  for (const item of items) {
    const previous = collapsed[collapsed.length - 1];
    if (
      previous &&
      previous.kind === "output" &&
      item.kind === "output" &&
      previous.turnId === item.turnId &&
      previous.stream === item.stream
    ) {
      previous.content = mergeOutputContent(previous.stream, previous.content, item.content);
      previous.createdAt = item.createdAt;
      previous.sequence = item.sequence;
      continue;
    }
    collapsed.push({ ...item });
  }

  if (limit <= 0 || collapsed.length <= limit) {
    return collapsed;
  }

  return collapsed.slice(-limit);
}
