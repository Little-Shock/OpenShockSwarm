import test from "node:test";
import assert from "node:assert/strict";

import { collapseFeedItems } from "./agent-feed.ts";

function buildTurnItem(index: number) {
  return {
    id: `turn:${index}`,
    kind: "turn" as const,
    turnId: `turn_${index}`,
    roomId: "room_001",
    createdAt: `2026-04-13T10:${String(index % 60).padStart(2, "0")}:00Z`,
    sequence: 0,
    turnSequence: index,
    intentType: "visible_message_response",
    hasTriggerMessage: true,
  };
}

test("collapseFeedItems defaults to the latest 100 feed items", () => {
  const items = Array.from({ length: 140 }, (_, index) => buildTurnItem(index + 1));

  const collapsed = collapseFeedItems(items);

  assert.equal(collapsed.length, 100);
  assert.equal(collapsed[0]?.id, "turn:41");
  assert.equal(collapsed.at(-1)?.id, "turn:140");
});
