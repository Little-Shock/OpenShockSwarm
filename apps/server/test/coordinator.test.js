import test from "node:test";
import assert from "node:assert/strict";
import { ServerCoordinator } from "../src/coordinator.js";
import { CoordinatorError } from "../src/errors.js";

function createBaselineCoordinator() {
  const coordinator = new ServerCoordinator({ escalationMs: 10_000 });
  coordinator.createTopic({
    topicId: "topic_0a",
    goal: "prove deterministic multi-agent closed loop"
  });
  coordinator.registerAgent("topic_0a", {
    agentId: "lead_01",
    role: "lead",
    status: "active"
  });
  coordinator.registerAgent("topic_0a", {
    agentId: "worker_01",
    role: "worker",
    laneId: "lane_1",
    status: "active"
  });
  coordinator.registerAgent("topic_0a", {
    agentId: "worker_02",
    role: "worker",
    laneId: "lane_2",
    status: "active"
  });
  coordinator.registerAgent("topic_0a", {
    agentId: "human_reviewer",
    role: "human",
    status: "active"
  });
  coordinator.registerAgent("topic_0a", {
    agentId: "human_reviewer_inactive",
    role: "human",
    status: "idle"
  });
  return coordinator;
}

function completeLeadAcceptedHandoff(coordinator, options = {}) {
  const fromAgentId = options.fromAgentId ?? "worker_01";
  const artifactId = options.artifactId ?? "artifact://handoff-a";
  const handoff = coordinator.ingestMessage("topic_0a", {
    type: "handoff_package",
    sourceAgentId: fromAgentId,
    sourceRole: "worker",
    targetScope: "lead",
    referencedArtifacts: [artifactId],
    payload: {
      summary: "ready for merge review"
    }
  });

  coordinator.ingestMessage("topic_0a", {
    type: "status_report",
    sourceAgentId: "lead_01",
    sourceRole: "lead",
    payload: {
      event: "handoff_ack",
      handoffId: handoff.messageId,
      resolvedArtifacts: [artifactId]
    }
  });
  return handoff.messageId;
}

test("dispatch stays pending until worker explicitly accepts", () => {
  const coordinator = createBaselineCoordinator();
  const dispatch = coordinator.ingestMessage("topic_0a", {
    type: "dispatch",
    sourceAgentId: "lead_01",
    sourceRole: "lead",
    payload: {
      workerAgentId: "worker_01",
      task: "implement server core"
    }
  });
  assert.equal(dispatch.state, "pending_accept");

  const accepted = coordinator.ingestMessage("topic_0a", {
    type: "status_report",
    sourceAgentId: "worker_01",
    sourceRole: "worker",
    payload: {
      event: "dispatch_accepted",
      dispatchId: dispatch.messageId
    }
  });
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.result.status, "active");
});

test("shared truth proposal rejects stale revision", () => {
  const coordinator = createBaselineCoordinator();
  coordinator.ingestMessage("topic_0a", {
    type: "shared_truth_proposal",
    sourceAgentId: "lead_01",
    sourceRole: "lead",
    truthRevision: 1,
    payload: {
      patch: {
        plan: { stage: "slice_a" }
      }
    }
  });
  assert.throws(
    () =>
      coordinator.ingestMessage("topic_0a", {
        type: "shared_truth_proposal",
        sourceAgentId: "worker_01",
        sourceRole: "worker",
        truthRevision: 1,
        payload: {
          patch: {
            plan: { stage: "slice_b" }
          }
        }
      }),
    (error) =>
      error instanceof CoordinatorError &&
      error.code === "stale_revision" &&
      error.details.expectedRevision === 2
  );
});

test("challenge blocks merge request until conflict is resolved", () => {
  const coordinator = createBaselineCoordinator();
  const handoffId = completeLeadAcceptedHandoff(coordinator, {
    fromAgentId: "worker_02",
    artifactId: "artifact://handoff-b"
  });
  const challenge = coordinator.ingestMessage("topic_0a", {
    type: "challenge",
    sourceAgentId: "worker_02",
    sourceRole: "worker",
    payload: {
      scopes: ["delivery"]
    }
  });
  assert.equal(challenge.result.status, "unresolved");

  const blockedMerge = coordinator.ingestMessage("topic_0a", {
    type: "merge_request",
    sourceAgentId: "worker_02",
    sourceRole: "worker",
    payload: {
      handoffId,
      prUrl: "https://example.com/pr/1"
    }
  });
  assert.equal(blockedMerge.state, "blocked_conflict");

  const resolved = coordinator.ingestMessage("topic_0a", {
    type: "conflict_resolution",
    sourceAgentId: "lead_01",
    sourceRole: "lead",
    payload: {
      conflictId: challenge.result.conflictId,
      outcome: "accept_side",
      notes: "adopt worker_01 implementation"
    }
  });
  assert.equal(resolved.state, "closed");

  const mergeAfterResolution = coordinator.ingestMessage("topic_0a", {
    type: "merge_request",
    sourceAgentId: "worker_02",
    sourceRole: "worker",
    payload: {
      handoffId,
      prUrl: "https://example.com/pr/2"
    }
  });
  assert.equal(mergeAfterResolution.state, "merge_candidate");
  assert.equal(mergeAfterResolution.result.holdIds.length, 1);
  assert.equal(mergeAfterResolution.result.status, "merge_candidate_waiting_human_gate");
});

test("human gate hold and release updates delivery state", () => {
  const coordinator = createBaselineCoordinator();
  const handoffId = completeLeadAcceptedHandoff(coordinator, {
    fromAgentId: "worker_01",
    artifactId: "artifact://handoff-c"
  });
  const merge = coordinator.ingestMessage("topic_0a", {
    type: "merge_request",
    sourceAgentId: "worker_01",
    sourceRole: "worker",
    payload: {
      handoffId,
      prUrl: "https://example.com/pr/3"
    }
  });
  const holdId = merge.result.holdIds[0];
  const decision = coordinator.applyHumanDecision("topic_0a", holdId, {
    decider: "human_reviewer",
    approve: true,
    interventionId: holdId
  });
  assert.equal(decision.status, "approved");

  const overview = coordinator.getTopicOverview("topic_0a");
  assert.equal(overview.truth.deliveryState.state, "pr_ready");
  assert.equal(overview.truth.deliveryState.prUrl, "https://example.com/pr/3");
});

test("coarse observability surfaces blockers and pending approvals", () => {
  const coordinator = createBaselineCoordinator();
  const handoffId = completeLeadAcceptedHandoff(coordinator, {
    fromAgentId: "worker_02",
    artifactId: "artifact://handoff-d"
  });
  coordinator.ingestMessage("topic_0a", {
    type: "blocker_escalation",
    sourceAgentId: "worker_01",
    sourceRole: "worker",
    payload: {
      reason: "runtime down"
    }
  });
  coordinator.ingestMessage("topic_0a", {
    type: "merge_request",
    sourceAgentId: "worker_02",
    sourceRole: "worker",
    payload: {
      handoffId,
      prUrl: "https://example.com/pr/4"
    }
  });

  const coarse = coordinator.getCoarseObservability("topic_0a");
  assert.ok(coarse.blockerCount >= 1);
  assert.ok(coarse.pendingApprovalCount >= 1);
  assert.equal(coarse.deliveryState.state, "awaiting_merge_gate");
});

test("merge_request is rejected when lead has not accepted handoff package", () => {
  const coordinator = createBaselineCoordinator();
  const handoff = coordinator.ingestMessage("topic_0a", {
    type: "handoff_package",
    sourceAgentId: "worker_01",
    sourceRole: "worker",
    targetScope: "lead",
    referencedArtifacts: ["artifact://handoff-e"],
    payload: {
      summary: "unaccepted package"
    }
  });

  assert.throws(
    () =>
      coordinator.ingestMessage("topic_0a", {
        type: "merge_request",
        sourceAgentId: "worker_01",
        sourceRole: "worker",
        payload: {
          handoffId: handoff.messageId,
          prUrl: "https://example.com/pr/no-ack"
        }
      }),
    (error) => error instanceof CoordinatorError && error.code === "merge_request_requires_completed_handoff"
  );
});

test("handoff_ack is rejected from unintended receiver", () => {
  const coordinator = createBaselineCoordinator();
  const handoff = coordinator.ingestMessage("topic_0a", {
    type: "handoff_package",
    sourceAgentId: "worker_01",
    sourceRole: "worker",
    targetScope: "lead",
    referencedArtifacts: ["artifact://handoff-f"],
    payload: {
      summary: "handoff should be acked by lead"
    }
  });

  assert.throws(
    () =>
      coordinator.ingestMessage("topic_0a", {
        type: "status_report",
        sourceAgentId: "worker_02",
        sourceRole: "worker",
        payload: {
          event: "handoff_ack",
          handoffId: handoff.messageId,
          resolvedArtifacts: ["artifact://handoff-f"]
        }
      }),
    (error) => error instanceof CoordinatorError && error.code === "handoff_ack_forbidden"
  );
});

test("rogue structured sender is rejected when actor is not registered", () => {
  const coordinator = createBaselineCoordinator();
  assert.throws(
    () =>
      coordinator.ingestMessage("topic_0a", {
        type: "status_report",
        sourceAgentId: "rogue_worker_999",
        sourceRole: "worker",
        payload: {
          event: "agent_state",
          status: "active"
        }
      }),
    (error) => error instanceof CoordinatorError && error.code === "source_actor_not_registered"
  );
});

test("human decision rejects free-string or inactive decider with intervention binding", () => {
  const coordinator = createBaselineCoordinator();
  const handoffId = completeLeadAcceptedHandoff(coordinator, {
    fromAgentId: "worker_01",
    artifactId: "artifact://handoff-perm-01"
  });
  const merge = coordinator.ingestMessage("topic_0a", {
    type: "merge_request",
    sourceAgentId: "worker_01",
    sourceRole: "worker",
    payload: {
      handoffId,
      prUrl: "https://example.com/pr/perm-1"
    }
  });
  const holdId = merge.result.holdIds[0];

  assert.throws(
    () =>
      coordinator.applyHumanDecision("topic_0a", holdId, {
        decider: "free_string_decider",
        approve: true,
        interventionId: holdId
      }),
    (error) => error instanceof CoordinatorError && error.code === "decision_decider_not_registered"
  );

  assert.throws(
    () =>
      coordinator.applyHumanDecision("topic_0a", holdId, {
        decider: "human_reviewer_inactive",
        approve: true,
        interventionId: holdId
      }),
    (error) => error instanceof CoordinatorError && error.code === "decision_decider_inactive"
  );
});
