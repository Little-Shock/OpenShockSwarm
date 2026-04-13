import assert from "node:assert/strict";
import test from "node:test";

const {
  buildPhaseZeroStateStreamURL,
  resolvePhaseZeroDeltaDecision,
  resolvePhaseZeroResyncDecision,
  resolvePhaseZeroSnapshotDecision,
} = (await import(new URL("./live-phase0-stream.ts", import.meta.url).href)) as typeof import("./live-phase0-stream");

test("buildPhaseZeroStateStreamURL omits since when no replay cursor exists", () => {
  assert.equal(buildPhaseZeroStateStreamURL("/api/control", "/v1/state/stream", 0), "/api/control/v1/state/stream");
  assert.equal(buildPhaseZeroStateStreamURL("/api/control", "/v1/state/stream", -3), "/api/control/v1/state/stream");
});

test("buildPhaseZeroStateStreamURL includes since when a replay cursor exists", () => {
  assert.equal(buildPhaseZeroStateStreamURL("/api/control", "/v1/state/stream", 17), "/api/control/v1/state/stream?since=17");
});

test("resolvePhaseZeroSnapshotDecision ignores stale snapshot sequences", () => {
  assert.deepEqual(resolvePhaseZeroSnapshotDecision(9, 9), { kind: "ignore", nextSequence: 9 });
  assert.deepEqual(resolvePhaseZeroSnapshotDecision(9, 7), { kind: "ignore", nextSequence: 9 });
});

test("resolvePhaseZeroSnapshotDecision applies newer or unsequenced snapshots", () => {
  assert.deepEqual(resolvePhaseZeroSnapshotDecision(9, 11), { kind: "apply", nextSequence: 11 });
  assert.deepEqual(resolvePhaseZeroSnapshotDecision(9, undefined), { kind: "apply", nextSequence: 9 });
});

test("resolvePhaseZeroDeltaDecision ignores stale delta sequences", () => {
  assert.deepEqual(resolvePhaseZeroDeltaDecision(12, 12), { kind: "ignore", nextSequence: 12 });
  assert.deepEqual(resolvePhaseZeroDeltaDecision(12, 10), { kind: "ignore", nextSequence: 12 });
});

test("resolvePhaseZeroDeltaDecision applies contiguous or unsequenced deltas", () => {
  assert.deepEqual(resolvePhaseZeroDeltaDecision(12, 13), { kind: "apply", nextSequence: 13 });
  assert.deepEqual(resolvePhaseZeroDeltaDecision(0, 3), { kind: "apply", nextSequence: 3 });
  assert.deepEqual(resolvePhaseZeroDeltaDecision(12, undefined), { kind: "apply", nextSequence: 12 });
});

test("resolvePhaseZeroDeltaDecision triggers refresh when a gap appears", () => {
  assert.deepEqual(resolvePhaseZeroDeltaDecision(12, 15), { kind: "refresh", nextSequence: 15 });
});

test("resolvePhaseZeroResyncDecision always refreshes and only advances valid cursors", () => {
  assert.deepEqual(resolvePhaseZeroResyncDecision(12, 18), { kind: "refresh", nextSequence: 18 });
  assert.deepEqual(resolvePhaseZeroResyncDecision(12, undefined), { kind: "refresh", nextSequence: 12 });
  assert.deepEqual(resolvePhaseZeroResyncDecision(12, 0), { kind: "refresh", nextSequence: 12 });
});
