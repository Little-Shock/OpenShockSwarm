import {
  AGENT_ROLES,
  HUMAN_GATES,
  MESSAGE_STATE,
  MESSAGE_TYPES,
  parseGateList
} from "./protocol.js";
import { assertOrThrow, CoordinatorError } from "./errors.js";
import { deepClone, deepMerge, generateId, nowIso } from "./utils.js";

function createEmptyTopic({ topicId, goal, constraints }) {
  const now = nowIso();
  return {
    topicId,
    revision: 1,
    truth: {
      goal,
      constraints: constraints ?? [],
      plan: null,
      taskAllocation: [],
      decisions: [],
      mergeIntent: null,
      stableArtifacts: [],
      deliveryState: {
        state: "not_started",
        prUrl: null,
        lastUpdatedAt: now
      }
    },
    agents: new Map(),
    messages: new Map(),
    routes: new Map(),
    dispatches: new Map(),
    handoffs: new Map(),
    conflicts: new Map(),
    approvals: new Map(),
    holdsByMessage: new Map(),
    blockers: new Map(),
    feedback: [],
    integration: {
      repoBinding: null,
      prs: new Map(),
      inboxAcks: new Map()
    },
    riskFlags: new Set(),
    history: [],
    updatedAt: now
  };
}

function keepHistory(topic, event) {
  topic.history.push(event);
  if (topic.history.length > 2000) {
    topic.history.shift();
  }
}

function routeKey(message) {
  if (typeof message.targetScope === "string" && message.targetScope.trim()) {
    return message.targetScope.trim();
  }
  return "topic";
}

function collectDynamicGates(message) {
  const gates = parseGateList(message.payload);
  if (message.type === "merge_request") {
    gates.add(HUMAN_GATES.PR_MERGE);
  }
  if (message.payload?.crossTopicRewrite === true) {
    gates.add(HUMAN_GATES.CROSS_TOPIC_TRUTH_REWRITE);
  }
  if (message.payload?.changeClass === "architecture") {
    gates.add(HUMAN_GATES.ARCHITECTURE);
  }
  if (message.payload?.changeClass === "external_interface") {
    gates.add(HUMAN_GATES.EXTERNAL_INTERFACE);
  }
  return gates;
}

function conflictTouchesScope(conflict, scope) {
  if (!scope || !Array.isArray(conflict.scopes) || conflict.scopes.length === 0) {
    return true;
  }
  return conflict.scopes.includes(scope);
}

function parseHandoffTarget(targetScope) {
  if (typeof targetScope !== "string" || targetScope.trim().length === 0) {
    return {
      toAgentId: null,
      toRole: null
    };
  }
  const trimmed = targetScope.trim();
  if (trimmed.startsWith("agent:")) {
    const toAgentId = trimmed.slice("agent:".length).trim();
    return {
      toAgentId: toAgentId.length > 0 ? toAgentId : null,
      toRole: null
    };
  }
  if (["lead", "worker", "human", "system"].includes(trimmed)) {
    return {
      toAgentId: null,
      toRole: trimmed
    };
  }
  return {
    toAgentId: null,
    toRole: null
  };
}

function parseOffsetCursor(input, { codePrefix }) {
  if (input === null || input === undefined || input === "") {
    return 0;
  }
  assertOrThrow(typeof input === "string", `${codePrefix}_cursor_invalid`, "cursor must be string");
  const match = input.match(/^o:(\d+)$/);
  assertOrThrow(match, `${codePrefix}_cursor_invalid`, "cursor must match o:<offset>");
  const offset = Number(match[1]);
  assertOrThrow(Number.isInteger(offset) && offset >= 0, `${codePrefix}_cursor_invalid`, "cursor offset must be non-negative");
  return offset;
}

function parseLimit(input, { codePrefix, defaultLimit = 20, maxLimit = 200 }) {
  if (input === null || input === undefined || input === "") {
    return defaultLimit;
  }
  const numeric = Number(input);
  assertOrThrow(Number.isInteger(numeric), `${codePrefix}_limit_invalid`, "limit must be integer");
  assertOrThrow(numeric > 0 && numeric <= maxLimit, `${codePrefix}_limit_invalid`, `limit must be between 1 and ${maxLimit}`);
  return numeric;
}

function parseProviderRef(input, { requireRepoRef = true } = {}) {
  assertOrThrow(input && typeof input === "object" && !Array.isArray(input), "provider_ref_required", "provider_ref must be an object");
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  const repoRefRaw = typeof input.repo_ref === "string" ? input.repo_ref.trim() : "";
  const prNodeIdRaw = typeof input.pr_node_id === "string" ? input.pr_node_id.trim() : "";
  assertOrThrow(provider.length > 0, "provider_required", "provider_ref.provider is required");
  if (requireRepoRef) {
    assertOrThrow(repoRefRaw.length > 0, "repo_ref_required", "provider_ref.repo_ref is required");
  }
  const prNumberRaw = input.pr_number;
  const prNumber =
    prNumberRaw === null || prNumberRaw === undefined || prNumberRaw === ""
      ? null
      : Number(prNumberRaw);
  if (prNumber !== null) {
    assertOrThrow(Number.isInteger(prNumber) && prNumber > 0, "pr_number_invalid", "provider_ref.pr_number must be positive integer");
  }
  return {
    provider,
    repo_ref: repoRefRaw.length > 0 ? repoRefRaw : null,
    pr_number: prNumber,
    pr_node_id: prNodeIdRaw.length > 0 ? prNodeIdRaw : null
  };
}

function classifyProjectionPlane(message) {
  if (message.type === "feedback_ingest" || message.type === "blocker_escalation") {
    return "execution";
  }
  if (message.type === "status_report") {
    const statusEvent = typeof message.payload?.event === "string" ? message.payload.event : "";
    if (statusEvent === "dispatch_accepted" || statusEvent === "handoff_ack" || statusEvent === "agent_state") {
      return "control";
    }
    if (message.runId || message.laneId) {
      return "execution";
    }
    return "control";
  }
  return "control";
}

function toProjectionEvent(topicId, message) {
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  const traceId = payload.trace_id ?? payload.traceId ?? null;
  return {
    event_id: message.messageId,
    topic_id: topicId,
    run_id: message.runId ?? null,
    lane_id: message.laneId ?? null,
    message_id: message.messageId,
    message_type: message.type,
    event_type: message.type === "status_report" ? payload.event ?? "status_report" : message.type,
    source_agent_id: message.sourceAgentId,
    source_role: message.sourceRole,
    state: message.state,
    at: message.createdAt,
    trace_id: typeof traceId === "string" ? traceId : null
  };
}

function compareEventDesc(a, b) {
  const timeDiff = Date.parse(b.at) - Date.parse(a.at);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return b.event_id.localeCompare(a.event_id);
}

function compareEventAsc(a, b) {
  const timeDiff = Date.parse(a.at) - Date.parse(b.at);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return a.event_id.localeCompare(b.event_id);
}

function compareTimestampDesc(left, right, leftId, rightId) {
  const leftParsed = Date.parse(left);
  const rightParsed = Date.parse(right);
  const leftTime = Number.isFinite(leftParsed) ? leftParsed : 0;
  const rightTime = Number.isFinite(rightParsed) ? rightParsed : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return String(rightId).localeCompare(String(leftId));
}

function collectRunSummary(topic, topicId, runId) {
  const runMessages = Array.from(topic.messages.values())
    .filter((message) => message.runId === runId && classifyProjectionPlane(message) === "execution")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  assertOrThrow(runMessages.length > 0, "run_not_found", `run ${runId} not found`);

  const laneIds = new Set();
  const messageStateCounts = {};
  for (const message of runMessages) {
    if (typeof message.laneId === "string" && message.laneId.length > 0) {
      laneIds.add(message.laneId);
    }
    messageStateCounts[message.state] = (messageStateCounts[message.state] ?? 0) + 1;
  }

  const feedbackCount = topic.feedback.filter((feedback) => feedback.runId === runId).length;
  let holdCount = 0;
  for (const hold of topic.approvals.values()) {
    const relatedMessage = topic.messages.get(hold.messageId);
    if (relatedMessage?.runId === runId) {
      holdCount += 1;
    }
  }

  const first = runMessages[0];
  const last = runMessages[runMessages.length - 1];
  return {
    run_id: runId,
    topic_id: topicId,
    lane_ids: Array.from(laneIds.values()).sort(),
    event_count: runMessages.length,
    feedback_count: feedbackCount,
    hold_count: holdCount,
    started_at: first.createdAt,
    last_event_at: last.createdAt,
    last_event_type: last.type,
    last_state: last.state,
    message_state_counts: messageStateCounts,
    closeout_projection: buildRunCloseoutProjection(topic, runId, runMessages)
  };
}

function buildTopicCloseoutRef(topic) {
  const deliveryState = topic.truth?.deliveryState ?? {};
  return {
    topic_id: topic.topicId,
    revision: topic.revision,
    merge_lifecycle_state: typeof deliveryState.state === "string" ? deliveryState.state : "unknown",
    task_allocation_count: Array.isArray(topic.truth?.taskAllocation) ? topic.truth.taskAllocation.length : 0
  };
}

function buildActorCloseoutRef(topic, actorId, fallbackRole = null) {
  if (typeof actorId !== "string" || actorId.length === 0) {
    return null;
  }
  const actor = topic.agents.get(actorId);
  return {
    actor_id: actorId,
    role: actor?.role ?? fallbackRole ?? null,
    status: actor?.status ?? "unknown"
  };
}

function collectApprovalIds(topic, status = null) {
  const ids = [];
  for (const hold of topic.approvals.values()) {
    if (status && hold.status !== status) {
      continue;
    }
    if (typeof hold.holdId === "string" && hold.holdId.length > 0) {
      ids.push(hold.holdId);
    }
  }
  return ids.sort();
}

function collectConflictIds(topic, status = null) {
  const ids = [];
  for (const conflict of topic.conflicts.values()) {
    if (status && conflict.status !== status) {
      continue;
    }
    if (typeof conflict.conflictId === "string" && conflict.conflictId.length > 0) {
      ids.push(conflict.conflictId);
    }
  }
  return ids.sort();
}

function collectBlockerIds(topic) {
  const ids = [];
  for (const blocker of topic.blockers.values()) {
    if (typeof blocker.blockerId === "string" && blocker.blockerId.length > 0) {
      ids.push(blocker.blockerId);
    }
  }
  return ids.sort();
}

function buildMergeLifecycleEvidenceAnchor(topic, input = {}) {
  return {
    source: "server_owned",
    topic_ref: deepClone(input.topicRef ?? buildTopicCloseoutRef(topic)),
    merge_lifecycle_state: input.mergeLifecycleState ?? topic.truth?.deliveryState?.state ?? "unknown",
    run_id: input.runId ?? null,
    lane_id: input.laneId ?? null,
    checkpoint_refs: deepClone(input.checkpointRefs ?? []),
    artifact_refs: deepClone(input.artifactRefs ?? []),
    pending_approval_ids: deepClone(input.pendingApprovalIds ?? collectApprovalIds(topic, "pending")),
    open_conflict_ids: deepClone(input.openConflictIds ?? collectConflictIds(topic, "unresolved")),
    blocker_ids: deepClone(input.blockerIds ?? collectBlockerIds(topic))
  };
}

function readControlFailureReason(topic) {
  const truth = topic.truth && typeof topic.truth === "object" ? topic.truth : {};
  const nodes = [
    truth,
    truth.replay_debug_evidence,
    truth.replayDebugEvidence,
    truth.execution_evidence,
    truth.executionEvidence,
    truth.control_evidence,
    truth.controlEvidence,
    truth.closeout_evidence,
    truth.closeoutEvidence,
    truth.failure_evidence,
    truth.failureEvidence,
    truth.delivery_closeout,
    truth.deliveryCloseout,
    truth.mergeIntent
  ].filter((node) => node && typeof node === "object" && !Array.isArray(node));
  return pickFirstStringFromNodes(nodes, [
    "failure_reason",
    "failureReason",
    "error_reason",
    "errorReason",
    "status_reason",
    "statusReason",
    "reason"
  ]);
}

function buildCloseoutExplanationFromTopic(topic, evidenceAnchor = null) {
  const anchor = evidenceAnchor ?? buildMergeLifecycleEvidenceAnchor(topic);
  const mergeLifecycleState = anchor.merge_lifecycle_state ?? "unknown";
  const blockerIds = Array.isArray(anchor.blocker_ids) ? anchor.blocker_ids : [];
  const pendingApprovalIds = Array.isArray(anchor.pending_approval_ids) ? anchor.pending_approval_ids : [];
  const openConflictIds = Array.isArray(anchor.open_conflict_ids) ? anchor.open_conflict_ids : [];
  const failureReason = readControlFailureReason(topic);

  let status = "in_progress";
  let reasonCode = "in_progress";
  let reasonDetail = "closeout is still progressing";

  if (failureReason || mergeLifecycleState === "failed") {
    status = "failed";
    reasonCode = failureReason ? "truth_failure_reason" : "delivery_failed";
    reasonDetail = failureReason ? `failure reason from server truth: ${failureReason}` : "delivery state is failed";
  } else if (blockerIds.some((item) => item.startsWith("approval_rejected:"))) {
    status = "failed";
    reasonCode = "approval_rejected";
    reasonDetail = "approval gate was rejected";
  } else if (openConflictIds.length > 0) {
    status = "waiting_gate";
    reasonCode = "unresolved_conflict";
    reasonDetail = "closeout is blocked by unresolved conflict";
  } else if (pendingApprovalIds.length > 0 || mergeLifecycleState === "awaiting_merge_gate") {
    status = "waiting_gate";
    reasonCode = "pending_approval_gate";
    reasonDetail = "closeout is waiting for approval gate";
  } else if (["pr_ready", "merged", "delivered"].includes(mergeLifecycleState)) {
    status = "closeout_ready";
    reasonCode = "closeout_ready";
    reasonDetail = "closeout has enough server-owned evidence for downstream surfaces";
  }

  return {
    status,
    reason_code: reasonCode,
    reason_detail: reasonDetail,
    evidence_anchor: deepClone(anchor)
  };
}

function toConflictEvidenceResource(topic, conflict) {
  const resource = deepClone(conflict);
  const resolutionNode = resource.resolution && typeof resource.resolution === "object" ? resource.resolution : null;
  resource.failure_reason = resource.status === "unresolved" ? "unresolved_conflict" : null;
  resource.evidence_anchor = {
    source: "server_owned",
    conflict_id: resource.conflictId ?? null,
    opened_by_message_id: resource.challengeMessageId ?? null,
    resolution_message_id: resolutionNode?.messageId ?? null,
    resolution_outcome: resolutionNode?.outcome ?? null,
    resolved_at: resolutionNode?.at ?? null
  };
  return resource;
}

function toApprovalEvidenceResource(topic, hold) {
  const resource = deepClone(hold);
  resource.failure_reason = resource.status === "rejected" ? "approval_rejected" : null;
  resource.evidence_anchor = {
    source: "server_owned",
    hold_id: resource.holdId ?? null,
    gate: resource.gate ?? null,
    related_message_id: resource.messageId ?? null,
    decision_status: resource.status ?? null,
    decider_actor_id: resource.decider ?? null,
    decided_at: resource.decidedAt ?? null
  };
  return resource;
}

function toDecisionEvidenceResource(topic, hold) {
  const resource = {
    decisionId: `${hold.holdId}:${hold.decidedAt ?? "pending"}`,
    holdId: hold.holdId,
    status: hold.status,
    decider: hold.decider ?? null,
    gate: hold.gate,
    decidedAt: hold.decidedAt,
    failure_reason: hold.status === "rejected" ? "approval_rejected" : null,
    evidence_anchor: {
      source: "server_owned",
      hold_id: hold.holdId,
      gate: hold.gate,
      related_message_id: hold.messageId ?? null,
      decision_status: hold.status,
      decider_actor_id: hold.decider ?? null,
      decided_at: hold.decidedAt ?? null
    }
  };
  return resource;
}

function pushStringRef(out, value) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    out.add(trimmed);
  }
}

function pushStringArrayRefs(out, value) {
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    pushStringRef(out, item);
  }
}

function collectCheckpointRefsFromMessage(message) {
  const refs = new Set();
  if (!message || typeof message !== "object") {
    return refs;
  }
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  pushStringRef(refs, payload.checkpoint_id);
  pushStringRef(refs, payload.checkpointId);
  pushStringArrayRefs(refs, payload.checkpoint_ids);
  pushStringArrayRefs(refs, payload.checkpointIds);
  pushStringArrayRefs(refs, payload.checkpoint_refs);
  pushStringArrayRefs(refs, payload.checkpointRefs);
  return refs;
}

function collectArtifactRefsFromMessage(message) {
  const refs = new Set();
  if (!message || typeof message !== "object") {
    return refs;
  }
  pushStringArrayRefs(refs, message.referencedArtifacts);
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  pushStringRef(refs, payload.artifact_ref);
  pushStringRef(refs, payload.artifactRef);
  pushStringArrayRefs(refs, payload.artifact_refs);
  pushStringArrayRefs(refs, payload.artifactRefs);
  pushStringArrayRefs(refs, payload.resolvedArtifacts);
  return refs;
}

function buildMessageCloseoutProjection(topic, message) {
  const checkpointRefs = collectCheckpointRefsFromMessage(message);
  const artifactRefs = collectArtifactRefsFromMessage(message);
  return {
    topic_ref: buildTopicCloseoutRef(topic),
    actor_ref: buildActorCloseoutRef(topic, message?.sourceAgentId ?? null, message?.sourceRole ?? null),
    checkpoint_refs: Array.from(checkpointRefs.values()).sort(),
    artifact_refs: Array.from(artifactRefs.values()).sort()
  };
}

function buildRunCloseoutProjection(topic, runId, runMessages) {
  const actorById = new Map();
  const checkpointRefs = new Set();
  const artifactRefs = new Set();

  for (const message of runMessages) {
    const actorRef = buildActorCloseoutRef(topic, message.sourceAgentId, message.sourceRole);
    if (actorRef) {
      actorById.set(actorRef.actor_id, actorRef);
    }
    for (const checkpointRef of collectCheckpointRefsFromMessage(message).values()) {
      checkpointRefs.add(checkpointRef);
    }
    for (const artifactRef of collectArtifactRefsFromMessage(message).values()) {
      artifactRefs.add(artifactRef);
    }
  }

  for (const handoff of topic.handoffs.values()) {
    const handoffMessage = topic.messages.get(handoff.handoffId);
    if (!handoffMessage || handoffMessage.runId !== runId) {
      continue;
    }
    pushStringArrayRefs(artifactRefs, handoff.referencedArtifacts);
    pushStringArrayRefs(artifactRefs, handoff.resolvedArtifacts);
  }

  return {
    topic_ref: buildTopicCloseoutRef(topic),
    actor_refs: Array.from(actorById.values()).sort((left, right) => left.actor_id.localeCompare(right.actor_id)),
    checkpoint_refs: Array.from(checkpointRefs.values()).sort(),
    artifact_refs: Array.from(artifactRefs.values()).sort()
  };
}

function collectRunMessages(topic, runId, { includeControl = true } = {}) {
  if (typeof runId !== "string" || runId.length === 0) {
    return [];
  }
  return Array.from(topic.messages.values())
    .filter((message) => {
      if (message.runId !== runId) {
        return false;
      }
      if (includeControl) {
        return true;
      }
      return classifyProjectionPlane(message) === "execution";
    })
    .sort((left, right) => {
      const timeDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(left.messageId).localeCompare(String(right.messageId));
    });
}

function parseOptionalProviderRef(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (provider.length === 0) {
    return null;
  }
  const repoRefRaw = typeof input.repo_ref === "string" ? input.repo_ref.trim() : "";
  const prNodeIdRaw = typeof input.pr_node_id === "string" ? input.pr_node_id.trim() : "";
  const prNumberRaw = input.pr_number;
  const parsedPrNumber =
    prNumberRaw === null || prNumberRaw === undefined || prNumberRaw === ""
      ? null
      : Number(prNumberRaw);
  if (parsedPrNumber !== null && (!Number.isInteger(parsedPrNumber) || parsedPrNumber <= 0)) {
    return null;
  }
  return {
    provider,
    repo_ref: repoRefRaw.length > 0 ? repoRefRaw : null,
    pr_number: parsedPrNumber,
    pr_node_id: prNodeIdRaw.length > 0 ? prNodeIdRaw : null
  };
}

function pickFirstStringFromNodes(nodes, keys) {
  for (const node of nodes) {
    const value = pickFirstString(node, keys);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseOptionalActorRef(topic, input) {
  if (typeof input === "string") {
    const ref = buildActorCloseoutRef(topic, input, null);
    return ref ? { ...ref } : null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const actorId = pickFirstString(input, ["actor_id", "actorId"]);
  if (!actorId) {
    return null;
  }
  const fallbackRole = pickFirstString(input, ["role", "source_role", "sourceRole"]);
  const fromTopic = buildActorCloseoutRef(topic, actorId, fallbackRole);
  if (!fromTopic) {
    return {
      actor_id: actorId,
      role: fallbackRole ?? null,
      status: pickFirstString(input, ["status"]) ?? "unknown"
    };
  }
  return {
    ...fromTopic,
    role: fallbackRole ?? fromTopic.role ?? null,
    status: pickFirstString(input, ["status"]) ?? fromTopic.status ?? "unknown"
  };
}

function collectTruthActorRefs(topic, nodes) {
  const actorById = new Map();
  for (const node of nodes) {
    const singleRef = parseOptionalActorRef(topic, node?.actor_ref ?? node?.actorRef);
    if (singleRef) {
      actorById.set(singleRef.actor_id, singleRef);
    }
    const actorRefs = Array.isArray(node?.actor_refs)
      ? node.actor_refs
      : Array.isArray(node?.actorRefs)
        ? node.actorRefs
        : [];
    for (const item of actorRefs) {
      const parsed = parseOptionalActorRef(topic, item);
      if (parsed) {
        actorById.set(parsed.actor_id, parsed);
      }
    }
  }
  return Array.from(actorById.values()).sort((left, right) => left.actor_id.localeCompare(right.actor_id));
}

function collectTruthCheckpointRefs(nodes) {
  const refs = new Set();
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    pushStringRef(refs, node.checkpoint_id);
    pushStringRef(refs, node.checkpointId);
    pushStringArrayRefs(refs, node.checkpoint_ids);
    pushStringArrayRefs(refs, node.checkpointIds);
    pushStringArrayRefs(refs, node.checkpoint_refs);
    pushStringArrayRefs(refs, node.checkpointRefs);
  }
  return Array.from(refs.values()).sort();
}

function collectTruthArtifactRefs(nodes) {
  const refs = new Set();
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    pushStringRef(refs, node.artifact_ref);
    pushStringRef(refs, node.artifactRef);
    pushStringArrayRefs(refs, node.artifact_refs);
    pushStringArrayRefs(refs, node.artifactRefs);
    pushStringArrayRefs(refs, node.resolvedArtifacts);
    pushStringArrayRefs(refs, node.referencedArtifacts);
  }
  return Array.from(refs.values()).sort();
}

function readServerOwnedDeliveryTruth(topic) {
  const truth = topic.truth && typeof topic.truth === "object" ? topic.truth : {};
  const deliveryState = truth.deliveryState && typeof truth.deliveryState === "object" ? truth.deliveryState : {};
  const candidateNodes = [
    deliveryState,
    deliveryState.pr_writeback,
    deliveryState.prWriteback,
    deliveryState.delivery_closeout,
    deliveryState.deliveryCloseout,
    deliveryState.closeout,
    truth.delivery_closeout,
    truth.deliveryCloseout,
    truth.closeout,
    truth.pr_writeback,
    truth.prWriteback
  ].filter((node) => node && typeof node === "object" && !Array.isArray(node));
  const nestedWritebackNodes = candidateNodes
    .flatMap((node) => [node.pr_writeback, node.prWriteback])
    .filter((node) => node && typeof node === "object" && !Array.isArray(node));
  const nodes = [...candidateNodes, ...nestedWritebackNodes];

  const runId = pickFirstStringFromNodes(nodes, ["run_id", "runId"]);
  const laneId = pickFirstStringFromNodes(nodes, ["lane_id", "laneId"]);
  const messageId = pickFirstStringFromNodes(nodes, ["message_id", "messageId", "writeback_message_id", "writebackMessageId"]);
  const baseBranch = pickFirstStringFromNodes(nodes, ["base_branch", "baseBranch", "target_branch", "targetBranch", "branch"]);
  const prUrl = pickFirstStringFromNodes(nodes, ["pr_url", "prUrl", "url"]);
  const providerRef = nodes
    .map((node) => parseOptionalProviderRef(node?.provider_ref ?? node?.providerRef))
    .find(Boolean) ?? null;
  const checkpointRefs = collectTruthCheckpointRefs(nodes);
  const artifactRefs = collectTruthArtifactRefs(nodes);
  const actorRefs = collectTruthActorRefs(topic, nodes);

  return {
    run_id: runId,
    lane_id: laneId,
    message_id: messageId,
    base_branch: baseBranch,
    pr_url: prUrl,
    provider_ref: providerRef,
    checkpoint_refs: checkpointRefs,
    artifact_refs: artifactRefs,
    actor_refs: actorRefs
  };
}

function collectEvidenceNodes(topic, deliveryProjection = null) {
  const truth = topic.truth && typeof topic.truth === "object" ? topic.truth : {};
  const fromTruth = [
    truth,
    truth.replay_debug_evidence,
    truth.replayDebugEvidence,
    truth.execution_evidence,
    truth.executionEvidence,
    truth.control_evidence,
    truth.controlEvidence,
    truth.closeout_evidence,
    truth.closeoutEvidence,
    truth.failure_evidence,
    truth.failureEvidence,
    truth.delivery_closeout,
    truth.deliveryCloseout,
    truth.deliveryState,
    truth.mergeIntent
  ];
  const fromDelivery = deliveryProjection
    ? [
        deliveryProjection,
        deliveryProjection.pr_writeback_ref,
        deliveryProjection.delivery_ready_lineage,
        deliveryProjection.topic_ref
      ]
    : [];
  const nodes = [...fromTruth, ...fromDelivery].filter((node) => node && typeof node === "object" && !Array.isArray(node));
  return nodes;
}

function buildRunExplanationProjection(topic, runId = null) {
  const deliveryProjection = buildTopicDeliveryProjection(topic);
  const evidenceNodes = collectEvidenceNodes(topic, deliveryProjection);
  const explicitRunId = pickFirstStringFromNodes(evidenceNodes, ["run_id", "runId"]);
  const resolvedRunId = runId ?? explicitRunId ?? deliveryProjection.pr_writeback_ref.run_id ?? null;
  const runMessages = collectRunMessages(topic, resolvedRunId, { includeControl: true });
  const runCloseout =
    resolvedRunId && runMessages.length > 0
      ? buildRunCloseoutProjection(topic, resolvedRunId, runMessages)
      : {
          topic_ref: buildTopicCloseoutRef(topic),
          actor_refs: [],
          checkpoint_refs: [],
          artifact_refs: []
        };

  const truthCheckpointRefs = collectTruthCheckpointRefs(evidenceNodes);
  const truthArtifactRefs = collectTruthArtifactRefs(evidenceNodes);
  const truthActorRefs = collectTruthActorRefs(topic, evidenceNodes);
  const failureReason = pickFirstStringFromNodes(evidenceNodes, [
    "failure_reason",
    "failureReason",
    "error_reason",
    "errorReason",
    "status_reason",
    "statusReason",
    "reason"
  ]);
  const deliveryState = topic.truth?.deliveryState ?? {};
  const approvalHoldCount = Array.from(topic.approvals.values()).length;
  const unresolvedConflictCount = Array.from(topic.conflicts.values()).filter((conflict) => conflict.status === "unresolved").length;
  const blockerCount = topic.blockers.size;

  let explanationOutcome = "in_progress";
  if (failureReason || unresolvedConflictCount > 0 || blockerCount > 0) {
    explanationOutcome = "failure_or_blocked";
  } else if (deliveryState.state === "pr_ready" || deliveryState.state === "merged" || deliveryState.state === "delivered") {
    explanationOutcome = "closeout_ready";
  }

  const controlEvidence = {
    merge_lifecycle_state: typeof deliveryState.state === "string" ? deliveryState.state : "unknown",
    approval_hold_count: approvalHoldCount,
    unresolved_conflict_count: unresolvedConflictCount,
    blocker_count: blockerCount,
    failure_reason: failureReason
  };

  return {
    explanation_version: "v1.batch6",
    outcome: explanationOutcome,
    run_id: resolvedRunId,
    topic_ref: buildTopicCloseoutRef(topic),
    control_evidence: controlEvidence,
    execution_evidence: {
      actor_refs: truthActorRefs.length > 0 ? truthActorRefs : runCloseout.actor_refs,
      checkpoint_refs: truthCheckpointRefs.length > 0 ? truthCheckpointRefs : runCloseout.checkpoint_refs,
      artifact_refs: truthArtifactRefs.length > 0 ? truthArtifactRefs : runCloseout.artifact_refs,
      replay_cursor_scope:
        typeof resolvedRunId === "string" && resolvedRunId.length > 0
          ? `run:${topic.topicId}:${resolvedRunId}:replay`
          : null,
      debug_cursor_scope:
        typeof resolvedRunId === "string" && resolvedRunId.length > 0
          ? `debug_history:topic:${topic.topicId}:run:${resolvedRunId}`
          : null
    },
    compatibility_anchor: {
      contract: "/v1/compatibility/shell-adapter",
      run_history: `/v1/topics/${encodeURIComponent(topic.topicId)}/run-history`,
      replay: resolvedRunId ? `/v1/runs/${encodeURIComponent(resolvedRunId)}/replay?topic_id=${encodeURIComponent(topic.topicId)}` : null,
      debug_events: `/v1/debug/events?topic_id=${encodeURIComponent(topic.topicId)}`,
      debug_history: `/v1/debug/history?topic_id=${encodeURIComponent(topic.topicId)}`
    }
  };
}

function readPayloadProviderRef(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const direct = parseOptionalProviderRef(payload.provider_ref ?? payload.providerRef);
  if (direct) {
    return direct;
  }
  const prWriteback = payload.pr_writeback ?? payload.prWriteback;
  if (!prWriteback || typeof prWriteback !== "object") {
    return null;
  }
  return parseOptionalProviderRef(prWriteback.provider_ref ?? prWriteback.providerRef);
}

function pickFirstString(payload, keys) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function isDeliveryWritebackMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }
  if (message.type === "merge_request") {
    return true;
  }
  if (message.type !== "status_report") {
    return false;
  }
  const eventName = typeof message.payload?.event === "string" ? message.payload.event.toLowerCase() : "";
  return eventName.includes("delivery") || eventName.includes("writeback") || eventName.includes("merge");
}

function findLatestDeliveryWritebackMessage(topic) {
  const candidates = Array.from(topic.messages.values())
    .filter((message) => isDeliveryWritebackMessage(message))
    .sort((left, right) => compareTimestampDesc(left.createdAt, right.createdAt, left.messageId, right.messageId));
  return candidates[0] ?? null;
}

function buildTopicDeliveryProjection(topic) {
  const serverOwnedTruth = readServerOwnedDeliveryTruth(topic);
  const latestWriteback = findLatestDeliveryWritebackMessage(topic);
  const payload = latestWriteback?.payload && typeof latestWriteback.payload === "object" ? latestWriteback.payload : {};
  const deliveryState = topic.truth?.deliveryState ?? {};
  const topicRef = buildTopicCloseoutRef(topic);
  const runId =
    serverOwnedTruth.run_id ??
    (typeof latestWriteback?.runId === "string" && latestWriteback.runId.length > 0 ? latestWriteback.runId : null);
  const runMessages = collectRunMessages(topic, runId, { includeControl: true });
  const runCloseout = runId
    ? buildRunCloseoutProjection(topic, runId, runMessages)
    : {
        topic_ref: topicRef,
        actor_refs: [],
        checkpoint_refs: [],
        artifact_refs: []
      };
  const providerRef =
    serverOwnedTruth.provider_ref ??
    readPayloadProviderRef(payload) ??
    parseOptionalProviderRef(deliveryState.provider_ref ?? deliveryState.providerRef) ??
    null;
  const prUrl =
    serverOwnedTruth.pr_url ??
    (typeof deliveryState.prUrl === "string" && deliveryState.prUrl.trim().length > 0 ? deliveryState.prUrl.trim() : null) ??
    pickFirstString(payload, ["pr_url", "prUrl"]) ??
    null;
  const baseBranch =
    serverOwnedTruth.base_branch ??
    pickFirstString(payload, ["base_branch", "baseBranch", "target_branch", "targetBranch", "branch"]) ??
    (typeof deliveryState.base_branch === "string" && deliveryState.base_branch.trim().length > 0
      ? deliveryState.base_branch.trim()
      : null) ??
    topic.integration.repoBinding?.default_branch ??
    null;
  const actorRefs = serverOwnedTruth.actor_refs.length > 0 ? serverOwnedTruth.actor_refs : runCloseout.actor_refs;
  const checkpointRefs =
    serverOwnedTruth.checkpoint_refs.length > 0 ? serverOwnedTruth.checkpoint_refs : runCloseout.checkpoint_refs;
  const artifactRefs =
    serverOwnedTruth.artifact_refs.length > 0 ? serverOwnedTruth.artifact_refs : runCloseout.artifact_refs;
  const mergeLifecycleState = typeof deliveryState.state === "string" ? deliveryState.state : "unknown";
  const pendingApprovalIds = collectApprovalIds(topic, "pending");
  const openConflictIds = collectConflictIds(topic, "unresolved");
  const blockerIds = collectBlockerIds(topic);
  const evidenceAnchor = buildMergeLifecycleEvidenceAnchor(topic, {
    topicRef,
    mergeLifecycleState,
    runId,
    laneId: serverOwnedTruth.lane_id ?? latestWriteback?.laneId ?? null,
    checkpointRefs,
    artifactRefs,
    pendingApprovalIds,
    openConflictIds,
    blockerIds
  });
  const closeoutExplanation = buildCloseoutExplanationFromTopic(topic, evidenceAnchor);

  return {
    topic_ref: topicRef,
    merge_lifecycle_state: mergeLifecycleState,
    branch_ref: {
      default_branch: topic.integration.repoBinding?.default_branch ?? null,
      base_branch: baseBranch
    },
    pr_writeback_ref: {
      message_id: serverOwnedTruth.message_id ?? latestWriteback?.messageId ?? null,
      run_id: runId,
      lane_id: serverOwnedTruth.lane_id ?? latestWriteback?.laneId ?? null,
      provider_ref: providerRef,
      pr_url: prUrl
    },
    delivery_ready_lineage: {
      run_id: runId,
      actor_refs: actorRefs,
      checkpoint_refs: checkpointRefs,
      artifact_refs: artifactRefs
    },
    evidence_anchor: evidenceAnchor,
    closeout_explanation: closeoutExplanation
  };
}

function toNotificationSeverity(eventName) {
  if (typeof eventName !== "string") {
    return "info";
  }
  if (
    eventName.includes("rejected") ||
    eventName.includes("timeout") ||
    eventName.includes("conflict") ||
    eventName.includes("blocker") ||
    eventName.includes("error")
  ) {
    return "warning";
  }
  return "info";
}

function toNotificationItem(topic, event, index, deliveryProjection = null) {
  const at = typeof event.at === "string" && event.at.length > 0 ? event.at : topic.updatedAt;
  const message = typeof event.messageId === "string" ? topic.messages.get(event.messageId) : null;
  const notificationId = `ntf:${topic.topicId}:${index}:${event.event ?? "event"}:${at}`;
  const resolvedDeliveryProjection = deliveryProjection ?? buildTopicDeliveryProjection(topic);
  return {
    notification_id: notificationId,
    topic_id: topic.topicId,
    at,
    kind: typeof event.event === "string" ? event.event : "history_event",
    severity: toNotificationSeverity(event.event),
    summary: typeof event.event === "string" ? event.event : "history event",
    debug_anchor: {
      topic_id: topic.topicId,
      lane_id: message?.laneId ?? null,
      run_id: message?.runId ?? null,
      message_id: event.messageId ?? null,
      hold_id: event.holdId ?? null,
      blocker_id: event.blockerId ?? null,
      conflict_id: event.conflictId ?? null,
      pr_id: event.prId ?? null
    },
    closeout_projection: message
      ? buildMessageCloseoutProjection(topic, message)
      : {
          topic_ref: buildTopicCloseoutRef(topic),
          actor_ref: null,
          checkpoint_refs: [],
          artifact_refs: []
        },
    delivery_projection: deepClone(resolvedDeliveryProjection)
  };
}

function buildInboxItemsForActor(topic, actor) {
  const items = [];
  const actorRole = actor.role;

  if (actorRole === "human") {
    for (const hold of topic.approvals.values()) {
      if (hold.status !== "pending") {
        continue;
      }
      const related = topic.messages.get(hold.messageId);
      items.push({
        item_id: `inbox:${topic.topicId}:hold:${hold.holdId}`,
        topic_id: topic.topicId,
        actor_id: actor.agentId,
        kind: "approval_hold_pending",
        status: "pending",
        created_at: hold.createdAt,
        summary: `approval hold pending (${hold.gate})`,
        debug_anchor: {
          topic_id: topic.topicId,
          hold_id: hold.holdId,
          message_id: hold.messageId,
          run_id: related?.runId ?? null,
          lane_id: related?.laneId ?? null
        }
      });
    }
  }

  if (actorRole === "lead" || actorRole === "human") {
    for (const conflict of topic.conflicts.values()) {
      if (conflict.status !== "unresolved") {
        continue;
      }
      items.push({
        item_id: `inbox:${topic.topicId}:conflict:${conflict.conflictId}`,
        topic_id: topic.topicId,
        actor_id: actor.agentId,
        kind: "conflict_unresolved",
        status: "pending",
        created_at: conflict.createdAt,
        summary: `conflict unresolved (${conflict.conflictId})`,
        debug_anchor: {
          topic_id: topic.topicId,
          conflict_id: conflict.conflictId,
          message_id: conflict.challengeMessageId ?? null,
          run_id: null,
          lane_id: null
        }
      });
    }
    for (const blocker of topic.blockers.values()) {
      items.push({
        item_id: `inbox:${topic.topicId}:blocker:${blocker.blockerId}`,
        topic_id: topic.topicId,
        actor_id: actor.agentId,
        kind: "blocker_active",
        status: "pending",
        created_at: blocker.createdAt,
        summary: blocker.reason ?? "active blocker",
        debug_anchor: {
          topic_id: topic.topicId,
          blocker_id: blocker.blockerId,
          message_id: blocker.messageId ?? null,
          run_id: blocker.runId ?? null,
          lane_id: blocker.laneId ?? null
        }
      });
    }
  }

  return items;
}

function collectHandoffReceivers(topic, handoff) {
  if (handoff.toAgentId) {
    return new Set([handoff.toAgentId]);
  }
  if (handoff.toRole) {
    const out = new Set();
    for (const agent of topic.agents.values()) {
      if (agent.role === handoff.toRole) {
        out.add(agent.agentId);
      }
    }
    return out;
  }
  return new Set();
}

function hasLeadRole(topic, agentId) {
  const agent = topic.agents.get(agentId);
  return agent?.role === "lead";
}

function requireRegisteredActor(topic, agentId, { codePrefix }) {
  assertOrThrow(
    typeof agentId === "string" && agentId.length > 0,
    `${codePrefix}_id_required`,
    `${codePrefix} id is required`
  );
  const actor = topic.agents.get(agentId);
  assertOrThrow(
    actor,
    `${codePrefix}_not_registered`,
    `${codePrefix} ${agentId} is not registered in topic`
  );
  return actor;
}

function assertActorRole(actor, expectedRole, { codePrefix }) {
  assertOrThrow(
    actor.role === expectedRole,
    `${codePrefix}_role_mismatch`,
    `${codePrefix} role must match registered role`
  );
}

function assertActorActive(actor, { codePrefix }) {
  assertOrThrow(actor.status === "active", `${codePrefix}_inactive`, `${codePrefix} must be active`);
}

function isAllArtifactsResolved(handoff, resolvedArtifacts) {
  const expected = Array.isArray(handoff.referencedArtifacts) ? handoff.referencedArtifacts : [];
  if (expected.length === 0) {
    return true;
  }
  if (!Array.isArray(resolvedArtifacts) || resolvedArtifacts.length === 0) {
    return false;
  }
  const resolved = new Set(resolvedArtifacts);
  return expected.every((artifactId) => resolved.has(artifactId));
}

function normalizeMessage(topicId, messageInput) {
  assertOrThrow(messageInput && typeof messageInput === "object", "invalid_message", "message must be an object");
  assertOrThrow(typeof messageInput.type === "string", "invalid_message", "message.type is required");
  assertOrThrow(MESSAGE_TYPES.has(messageInput.type), "invalid_message_type", `unsupported message type: ${messageInput.type}`);
  assertOrThrow(typeof messageInput.sourceAgentId === "string" && messageInput.sourceAgentId.length > 0, "invalid_message", "sourceAgentId is required");
  assertOrThrow(typeof messageInput.sourceRole === "string", "invalid_message", "sourceRole is required");
  assertOrThrow(AGENT_ROLES.has(messageInput.sourceRole), "invalid_source_role", `unsupported sourceRole: ${messageInput.sourceRole}`);

  return {
    messageId: messageInput.messageId ?? generateId("msg"),
    topicId,
    type: messageInput.type,
    sourceAgentId: messageInput.sourceAgentId,
    sourceRole: messageInput.sourceRole,
    targetScope: messageInput.targetScope ?? "topic",
    laneId: messageInput.laneId ?? null,
    runId: messageInput.runId ?? null,
    referencedArtifacts: Array.isArray(messageInput.referencedArtifacts)
      ? messageInput.referencedArtifacts
      : [],
    truthRevision:
      messageInput.truthRevision === undefined || messageInput.truthRevision === null
        ? null
        : Number(messageInput.truthRevision),
    payload: messageInput.payload ?? {},
    createdAt: nowIso(),
    state: MESSAGE_STATE.RECEIVED
  };
}

export class ServerCoordinator {
  constructor(options = {}) {
    this.topics = new Map();
    this.prIndex = new Map();
    this.escalationMs = Number(options.escalationMs ?? 120000);
    this.conflictSweepOnRead = options.conflictSweepOnRead ?? true;
  }

  createTopic(input) {
    assertOrThrow(input && typeof input === "object", "invalid_topic", "topic input is required");
    assertOrThrow(typeof input.topicId === "string" && input.topicId.length > 0, "invalid_topic", "topicId is required");
    assertOrThrow(typeof input.goal === "string" && input.goal.length > 0, "invalid_topic", "goal is required");
    assertOrThrow(!this.topics.has(input.topicId), "topic_exists", `topic ${input.topicId} already exists`);

    const topic = createEmptyTopic(input);
    this.topics.set(topic.topicId, topic);
    keepHistory(topic, {
      event: "topic_created",
      at: topic.updatedAt,
      topicId: topic.topicId,
      revision: topic.revision
    });
    return this.getTopicOverview(topic.topicId);
  }

  registerAgent(topicId, input) {
    const topic = this.requireTopic(topicId);
    assertOrThrow(input && typeof input === "object", "invalid_agent", "agent payload is required");
    assertOrThrow(typeof input.agentId === "string" && input.agentId.length > 0, "invalid_agent", "agentId is required");
    assertOrThrow(typeof input.role === "string" && AGENT_ROLES.has(input.role), "invalid_agent", "role must be one of lead/worker/human/system");

    topic.agents.set(input.agentId, {
      agentId: input.agentId,
      role: input.role,
      laneId: input.laneId ?? null,
      status: input.status ?? "idle",
      lastSeenAt: nowIso()
    });
    topic.updatedAt = nowIso();
    keepHistory(topic, {
      event: "agent_registered",
      at: topic.updatedAt,
      agentId: input.agentId,
      role: input.role
    });
    return this.getTopicOverview(topicId);
  }

  ingestMessage(topicId, messageInput) {
    const topic = this.requireTopic(topicId);
    this.sweepConflictEscalations(topic);
    const message = normalizeMessage(topicId, messageInput);
    const sourceActor = requireRegisteredActor(topic, message.sourceAgentId, {
      codePrefix: "source_actor"
    });
    assertActorRole(sourceActor, message.sourceRole, { codePrefix: "source_actor" });
    assertActorActive(sourceActor, { codePrefix: "source_actor" });

    topic.messages.set(message.messageId, message);
    this.recordRoute(topic, message);
    keepHistory(topic, {
      event: "message_received",
      at: message.createdAt,
      type: message.type,
      messageId: message.messageId,
      sourceAgentId: message.sourceAgentId
    });

    const result = this.applyMessageSemantics(topic, message);
    topic.updatedAt = nowIso();

    return {
      messageId: message.messageId,
      state: message.state,
      result,
      revision: topic.revision,
      updatedAt: topic.updatedAt
    };
  }

  applyHumanDecision(topicId, holdId, input) {
    const topic = this.requireTopic(topicId);
    assertOrThrow(typeof holdId === "string" && holdId.length > 0, "invalid_hold", "holdId is required");
    const hold = topic.approvals.get(holdId);
    assertOrThrow(hold, "hold_not_found", `hold ${holdId} not found`);
    assertOrThrow(hold.status === "pending", "hold_finalized", `hold ${holdId} already finalized`);

    assertOrThrow(input && typeof input === "object", "invalid_decision", "decision payload is required");
    assertOrThrow(typeof input.decider === "string" && input.decider.length > 0, "invalid_decision", "decider is required");
    assertOrThrow(typeof input.approve === "boolean", "invalid_decision", "approve must be boolean");
    assertOrThrow(
      typeof input.interventionId === "string" && input.interventionId.length > 0,
      "intervention_id_required",
      "interventionId is required"
    );
    assertOrThrow(
      input.interventionId === holdId,
      "decision_intervention_mismatch",
      "interventionId must match holdId"
    );

    const deciderActor = requireRegisteredActor(topic, input.decider, {
      codePrefix: "decision_decider"
    });
    assertActorRole(deciderActor, "human", { codePrefix: "decision_decider" });
    assertActorActive(deciderActor, { codePrefix: "decision_decider" });

    hold.status = input.approve ? "approved" : "rejected";
    hold.decider = input.decider;
    hold.decidedAt = nowIso();
    keepHistory(topic, {
      event: "approval_decision",
      at: hold.decidedAt,
      holdId,
      decision: hold.status,
      decider: hold.decider
    });

    const message = topic.messages.get(hold.messageId);
    if (message) {
      if (!input.approve) {
        message.state = MESSAGE_STATE.REJECTED;
        topic.blockers.set(`approval_rejected:${holdId}`, {
          blockerId: `approval_rejected:${holdId}`,
          reason: `human rejected ${hold.gate}`,
          messageId: message.messageId,
          createdAt: hold.decidedAt
        });
      } else if (this.allHoldsApproved(topic, hold.messageId)) {
        this.releaseMessageAfterApprovals(topic, message);
      }
    }
    topic.updatedAt = nowIso();
    const holdEvidence = toApprovalEvidenceResource(topic, hold);
    return {
      holdId,
      interventionId: holdId,
      status: hold.status,
      messageId: hold.messageId,
      messageState: message?.state ?? null,
      revision: topic.revision,
      failure_reason: holdEvidence.failure_reason,
      evidence_anchor: holdEvidence.evidence_anchor
    };
  }

  getTopicOverview(topicId) {
    const topic = this.requireTopic(topicId);
    if (this.conflictSweepOnRead) {
      this.sweepConflictEscalations(topic);
    }
    const deliveryProjection = buildTopicDeliveryProjection(topic);
    const openConflicts = Array.from(topic.conflicts.values())
      .filter((conflict) => conflict.status === "unresolved")
      .map((conflict) => toConflictEvidenceResource(topic, conflict));
    const pendingApprovals = Array.from(topic.approvals.values())
      .filter((hold) => hold.status === "pending")
      .map((hold) => toApprovalEvidenceResource(topic, hold));
    const approvalDecisions = Array.from(topic.approvals.values())
      .filter((hold) => hold.status === "approved" || hold.status === "rejected")
      .map((hold) => toDecisionEvidenceResource(topic, hold));
    return {
      topicId: topic.topicId,
      revision: topic.revision,
      truth: deepClone(topic.truth),
      agents: Array.from(topic.agents.values()).map((agent) => deepClone(agent)),
      openConflicts: openConflicts.map((conflict) => deepClone(conflict)),
      pendingApprovals: pendingApprovals.map((hold) => deepClone(hold)),
      approvalDecisions: approvalDecisions.map((decision) => deepClone(decision)),
      mergeLifecycle: {
        state: deliveryProjection.merge_lifecycle_state,
        evidence_anchor: deepClone(deliveryProjection.evidence_anchor),
        closeout_explanation: deepClone(deliveryProjection.closeout_explanation)
      },
      deliveryProjection: deepClone(deliveryProjection),
      blockers: Array.from(topic.blockers.values()).map((blocker) => deepClone(blocker)),
      updatedAt: topic.updatedAt
    };
  }

  getCoarseObservability(topicId) {
    const topic = this.requireTopic(topicId);
    if (this.conflictSweepOnRead) {
      this.sweepConflictEscalations(topic);
    }
    const activeAgents = [];
    const blockedAgents = [];
    for (const agent of topic.agents.values()) {
      if (agent.status === "blocked") {
        blockedAgents.push(agent.agentId);
      } else {
        activeAgents.push(agent.agentId);
      }
    }
    return {
      topicId: topic.topicId,
      revision: topic.revision,
      activeAgents,
      blockedAgents,
      openConflictCount: Array.from(topic.conflicts.values()).filter((c) => c.status === "unresolved").length,
      pendingApprovalCount: Array.from(topic.approvals.values()).filter((h) => h.status === "pending").length,
      blockerCount: topic.blockers.size,
      riskFlags: Array.from(topic.riskFlags.values()),
      deliveryState: deepClone(topic.truth.deliveryState),
      updatedAt: topic.updatedAt
    };
  }

  listTopicEventProjection(topicId, input = {}) {
    const topic = this.requireTopic(topicId);
    const limit = parseLimit(input.limit, { codePrefix: "topic_events", defaultLimit: 20, maxLimit: 200 });
    const offset = parseOffsetCursor(input.cursor, { codePrefix: "topic_events" });
    const events = Array.from(topic.messages.values())
      .filter((message) => classifyProjectionPlane(message) === "control")
      .map((message) => toProjectionEvent(topicId, message))
      .sort(compareEventDesc);
    const items = events.slice(offset, offset + limit).map((event) => deepClone(event));
    const nextOffset = offset + items.length;
    return {
      projection: "control_plane_projection",
      cursor_scope: `topic:${topicId}:control`,
      topic_id: topicId,
      items,
      next_cursor: nextOffset < events.length ? `o:${nextOffset}` : null
    };
  }

  listRunTimelineProjection(runId, input = {}) {
    assertOrThrow(typeof runId === "string" && runId.length > 0, "run_id_required", "runId is required");
    const topicId = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const resolved = this.resolveTopicForRun(runId, topicId);
    const timeline = Array.from(resolved.topic.messages.values())
      .filter((message) => message.runId === runId && classifyProjectionPlane(message) === "execution")
      .map((message) => toProjectionEvent(resolved.topicId, message))
      .sort(compareEventAsc);
    return {
      projection: "execution_plane_projection",
      topic_id: resolved.topicId,
      run_id: runId,
      items: timeline.map((event) => deepClone(event))
    };
  }

  listRunFeedbackProjection(runId, input = {}) {
    assertOrThrow(typeof runId === "string" && runId.length > 0, "run_id_required", "runId is required");
    const topicId = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const resolved = this.resolveTopicForRun(runId, topicId);
    const items = resolved.topic.feedback
      .filter((feedback) => feedback.runId === runId)
      .map((feedback) => ({
        feedback_id: feedback.feedbackId,
        topic_id: resolved.topicId,
        run_id: runId,
        lane_id: feedback.laneId ?? null,
        source_agent_id: feedback.sourceAgentId,
        payload: deepClone(feedback.payload),
        at: feedback.createdAt
      }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      projection: "execution_plane_projection",
      topic_id: resolved.topicId,
      run_id: runId,
      items
    };
  }

  listRunHoldProjection(runId, input = {}) {
    assertOrThrow(typeof runId === "string" && runId.length > 0, "run_id_required", "runId is required");
    const topicId = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const resolved = this.resolveTopicForRun(runId, topicId);
    const items = [];
    for (const hold of resolved.topic.approvals.values()) {
      const message = resolved.topic.messages.get(hold.messageId);
      if (!message || message.runId !== runId) {
        continue;
      }
      items.push({
        hold_id: hold.holdId,
        gate: hold.gate,
        status: hold.status,
        topic_id: resolved.topicId,
        run_id: runId,
        message_id: hold.messageId,
        created_at: hold.createdAt,
        decided_at: hold.decidedAt ?? null,
        decider: hold.decider ?? null
      });
    }
    items.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return {
      projection: "execution_plane_projection",
      topic_id: resolved.topicId,
      run_id: runId,
      items
    };
  }

  listDebugEventsProjection(input = {}) {
    const topicFilter = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const runFilter = typeof input.runId === "string" && input.runId.trim().length > 0 ? input.runId.trim() : null;
    const limit = parseLimit(input.limit, { codePrefix: "debug_events", defaultLimit: 50, maxLimit: 500 });
    assertOrThrow(topicFilter || runFilter, "debug_filter_required", "debug events require topicId or runId");

    let explanationProjection = null;
    let topics = topicFilter ? [this.requireTopic(topicFilter)] : Array.from(this.topics.values());
    if (!topicFilter && runFilter) {
      const resolved = this.resolveTopicForRun(runFilter);
      topics = [resolved.topic];
      explanationProjection = buildRunExplanationProjection(resolved.topic, runFilter);
    } else if (topicFilter) {
      explanationProjection = buildRunExplanationProjection(topics[0], runFilter);
    }
    const events = [];
    for (const topic of topics) {
      for (const message of topic.messages.values()) {
        if (runFilter && message.runId !== runFilter) {
          continue;
        }
        const projected = toProjectionEvent(topic.topicId, message);
        const plane = classifyProjectionPlane(message) === "control" ? "control_projection" : "execution_projection";
        events.push({
          ...projected,
          projection_scope: plane,
          join_key: {
            topic_id: projected.topic_id,
            run_id: projected.run_id,
            message_id: projected.message_id,
            trace_id: projected.trace_id
          }
        });
      }
    }
    events.sort(compareEventDesc);
    return {
      projection: "cross_plane_debug_join",
      topic_id: topicFilter,
      run_id: runFilter,
      explanation_projection: explanationProjection ? deepClone(explanationProjection) : null,
      items: events.slice(0, limit).map((event) => deepClone(event))
    };
  }

  listDebugHistoryAggregationProjection(input = {}) {
    const topicFilter = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const runFilter = typeof input.runId === "string" && input.runId.trim().length > 0 ? input.runId.trim() : null;
    const limit = parseLimit(input.limit, { codePrefix: "debug_history", defaultLimit: 50, maxLimit: 500 });
    const offset = parseOffsetCursor(input.cursor, { codePrefix: "debug_history" });
    assertOrThrow(topicFilter || runFilter, "debug_history_filter_required", "debug history requires topicId or runId");

    let topics = [];
    let explanationProjection = null;
    if (topicFilter) {
      topics = [this.requireTopic(topicFilter)];
      if (runFilter) {
        this.resolveTopicForRun(runFilter, topicFilter);
      }
      explanationProjection = buildRunExplanationProjection(topics[0], runFilter);
    } else {
      const resolved = this.resolveTopicForRun(runFilter);
      topics = [resolved.topic];
      explanationProjection = buildRunExplanationProjection(resolved.topic, runFilter);
    }

    const entries = [];
    for (const topic of topics) {
      for (const message of topic.messages.values()) {
        if (runFilter && message.runId !== runFilter) {
          continue;
        }
        const projected = toProjectionEvent(topic.topicId, message);
        const projectionScope = classifyProjectionPlane(message) === "control" ? "control_projection" : "execution_projection";
        entries.push({
          entry_id: `msg:${projected.event_id}`,
          source: "message_projection",
          projection_scope: projectionScope,
          at: projected.at,
          event_type: projected.event_type,
          message_type: projected.message_type,
          topic_id: projected.topic_id,
          run_id: projected.run_id,
          lane_id: projected.lane_id,
          debug_anchor: {
            topic_id: projected.topic_id,
            run_id: projected.run_id,
            lane_id: projected.lane_id,
            message_id: projected.message_id,
            trace_id: projected.trace_id,
            hold_id: null,
            blocker_id: null,
            conflict_id: null,
            pr_id: null
          }
        });
      }

      topic.history.forEach((event, index) => {
        const relatedMessage =
          typeof event.messageId === "string" && event.messageId.length > 0 ? topic.messages.get(event.messageId) : null;
        const runId =
          typeof event.runId === "string" && event.runId.length > 0 ? event.runId : relatedMessage?.runId ?? null;
        if (runFilter && runId !== runFilter) {
          return;
        }
        const laneId =
          typeof event.laneId === "string" && event.laneId.length > 0 ? event.laneId : relatedMessage?.laneId ?? null;
        const at = typeof event.at === "string" && event.at.length > 0 ? event.at : topic.updatedAt;
        const traceIdRaw = relatedMessage?.payload?.trace_id ?? relatedMessage?.payload?.traceId ?? null;
        entries.push({
          entry_id: `hist:${topic.topicId}:${index}`,
          source: "topic_history",
          projection_scope: "history_projection",
          at,
          event_type: typeof event.event === "string" && event.event.length > 0 ? event.event : "history_event",
          message_type: null,
          topic_id: topic.topicId,
          run_id: runId,
          lane_id: laneId,
          debug_anchor: {
            topic_id: topic.topicId,
            run_id: runId,
            lane_id: laneId,
            message_id: event.messageId ?? null,
            trace_id: typeof traceIdRaw === "string" ? traceIdRaw : null,
            hold_id: event.holdId ?? null,
            blocker_id: event.blockerId ?? null,
            conflict_id: event.conflictId ?? null,
            pr_id: event.prId ?? null
          }
        });
      });
    }

    entries.sort((a, b) => compareTimestampDesc(a.at, b.at, a.entry_id, b.entry_id));
    const items = entries.slice(offset, offset + limit).map((entry) => deepClone(entry));
    const nextOffset = offset + items.length;
    const scopeTopic = topicFilter ?? "derived_from_run";
    const scopeRun = runFilter ?? "all";
    return {
      projection: "cross_plane_debug_history_aggregation",
      cursor_scope: `debug_history:topic:${scopeTopic}:run:${scopeRun}`,
      topic_id: topicFilter,
      run_id: runFilter,
      explanation_projection: explanationProjection ? deepClone(explanationProjection) : null,
      items,
      next_cursor: nextOffset < entries.length ? `o:${nextOffset}` : null
    };
  }

  listTopicRunHistoryProjection(topicId, input = {}) {
    const topic = this.requireTopic(topicId);
    const limit = parseLimit(input.limit, { codePrefix: "run_history", defaultLimit: 20, maxLimit: 200 });
    const offset = parseOffsetCursor(input.cursor, { codePrefix: "run_history" });
    const runIds = new Set();
    for (const message of topic.messages.values()) {
      if (classifyProjectionPlane(message) !== "execution") {
        continue;
      }
      if (typeof message.runId === "string" && message.runId.length > 0) {
        runIds.add(message.runId);
      }
    }
    const summaries = Array.from(runIds.values())
      .map((runId) => collectRunSummary(topic, topicId, runId))
      .sort((a, b) => compareTimestampDesc(a.last_event_at, b.last_event_at, a.run_id, b.run_id));
    const items = summaries.slice(offset, offset + limit).map((item) => ({
      ...deepClone(item),
      explanation_projection: buildRunExplanationProjection(topic, item.run_id)
    }));
    const nextOffset = offset + items.length;
    return {
      projection: "execution_plane_projection",
      cursor_scope: `topic:${topicId}:run_history`,
      topic_id: topicId,
      items,
      next_cursor: nextOffset < summaries.length ? `o:${nextOffset}` : null
    };
  }

  getRunProjection(runId, input = {}) {
    assertOrThrow(typeof runId === "string" && runId.length > 0, "run_id_required", "runId is required");
    const topicId = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const resolved = this.resolveTopicForRun(runId, topicId);
    const summary = collectRunSummary(resolved.topic, resolved.topicId, runId);
    return {
      projection: "execution_plane_projection",
      ...deepClone(summary),
      explanation_projection: buildRunExplanationProjection(resolved.topic, runId),
      links: {
        timeline: `/v1/runs/${encodeURIComponent(runId)}/timeline`,
        replay: `/v1/runs/${encodeURIComponent(runId)}/replay`,
        feedback: `/v1/runs/${encodeURIComponent(runId)}/feedback`,
        holds: `/v1/runs/${encodeURIComponent(runId)}/holds`
      }
    };
  }

  replayRunEventProjection(runId, input = {}) {
    assertOrThrow(typeof runId === "string" && runId.length > 0, "run_id_required", "runId is required");
    const topicId = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const limit = parseLimit(input.limit, { codePrefix: "run_replay", defaultLimit: 50, maxLimit: 500 });
    const offset = parseOffsetCursor(input.cursor, { codePrefix: "run_replay" });
    const resolved = this.resolveTopicForRun(runId, topicId);
    const explanationProjection = buildRunExplanationProjection(resolved.topic, runId);
    const timeline = Array.from(resolved.topic.messages.values())
      .filter((message) => message.runId === runId && classifyProjectionPlane(message) === "execution")
      .map((message) => ({
        event: toProjectionEvent(resolved.topicId, message),
        closeoutProjection: buildMessageCloseoutProjection(resolved.topic, message)
      }))
      .sort((left, right) => compareEventAsc(left.event, right.event));
    const items = timeline.slice(offset, offset + limit).map((item) => ({
      ...deepClone(item.event),
      closeout_projection: deepClone(item.closeoutProjection),
      explanation_projection: deepClone(explanationProjection)
    }));
    const nextOffset = offset + items.length;
    return {
      projection: "execution_plane_projection",
      cursor_scope: `run:${resolved.topicId}:${runId}:replay`,
      topic_id: resolved.topicId,
      run_id: runId,
      explanation_projection: deepClone(explanationProjection),
      items,
      next_cursor: nextOffset < timeline.length ? `o:${nextOffset}` : null
    };
  }

  listTopicNotificationProjection(topicId, input = {}) {
    const topic = this.requireTopic(topicId);
    const limit = parseLimit(input.limit, { codePrefix: "topic_notifications", defaultLimit: 50, maxLimit: 500 });
    const offset = parseOffsetCursor(input.cursor, { codePrefix: "topic_notifications" });
    const deliveryProjection = buildTopicDeliveryProjection(topic);
    const notifications = topic.history
      .map((event, index) => toNotificationItem(topic, event, index, deliveryProjection))
      .sort((a, b) => compareTimestampDesc(a.at, b.at, a.notification_id, b.notification_id));
    const items = notifications.slice(offset, offset + limit).map((item) => deepClone(item));
    const nextOffset = offset + items.length;
    return {
      projection: "control_plane_projection",
      cursor_scope: `topic:${topicId}:notifications`,
      topic_id: topicId,
      delivery_projection: deepClone(deliveryProjection),
      items,
      next_cursor: nextOffset < notifications.length ? `o:${nextOffset}` : null
    };
  }

  listActorInboxProjection(actorId, input = {}) {
    assertOrThrow(typeof actorId === "string" && actorId.length > 0, "actor_id_required", "actorId is required");
    const topicFilter = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const limit = parseLimit(input.limit, { codePrefix: "inbox", defaultLimit: 50, maxLimit: 500 });
    const offset = parseOffsetCursor(input.cursor, { codePrefix: "inbox" });
    const topics = topicFilter
      ? [this.requireTopic(topicFilter)]
      : Array.from(this.topics.values()).filter((topic) => topic.agents.has(actorId));

    assertOrThrow(topics.length > 0, "actor_not_registered", `actor ${actorId} is not registered in any topic`);
    const items = [];
    for (const topic of topics) {
      const actor = topic.agents.get(actorId);
      if (!actor) {
        if (topicFilter) {
          throw new CoordinatorError("actor_not_registered", `actor ${actorId} is not registered in topic ${topic.topicId}`);
        }
        continue;
      }
      const ackMap = topic.integration.inboxAcks.get(actorId) ?? new Map();
      for (const item of buildInboxItemsForActor(topic, actor)) {
        const ack = ackMap.get(item.item_id) ?? null;
        items.push({
          ...item,
          acked: Boolean(ack),
          acknowledged_at: ack?.acked_at ?? null
        });
      }
    }

    items.sort((a, b) => compareTimestampDesc(a.created_at, b.created_at, a.item_id, b.item_id));
    const page = items.slice(offset, offset + limit).map((item) => deepClone(item));
    const nextOffset = offset + page.length;
    return {
      projection: "control_plane_projection",
      cursor_scope: topicFilter ? `actor:${actorId}:inbox:topic:${topicFilter}` : `actor:${actorId}:inbox`,
      actor_id: actorId,
      topic_id: topicFilter,
      items: page,
      next_cursor: nextOffset < items.length ? `o:${nextOffset}` : null
    };
  }

  ackActorInboxItems(actorId, input = {}) {
    assertOrThrow(typeof actorId === "string" && actorId.length > 0, "actor_id_required", "actorId is required");
    assertOrThrow(input && typeof input === "object" && !Array.isArray(input), "inbox_ack_invalid", "ack payload must be object");
    const items = Array.isArray(input.items) ? input.items : [];
    assertOrThrow(items.length > 0, "inbox_ack_items_required", "ack payload.items must be non-empty array");

    const ackedItems = [];
    for (const item of items) {
      assertOrThrow(item && typeof item === "object", "inbox_ack_item_invalid", "ack item must be object");
      const topicId = typeof item.topic_id === "string" && item.topic_id.length > 0 ? item.topic_id : null;
      const itemId = typeof item.item_id === "string" && item.item_id.length > 0 ? item.item_id : null;
      assertOrThrow(topicId, "inbox_ack_topic_required", "ack item.topic_id is required");
      assertOrThrow(itemId, "inbox_ack_item_id_required", "ack item.item_id is required");

      const topic = this.requireTopic(topicId);
      const actor = topic.agents.get(actorId);
      assertOrThrow(actor, "actor_not_registered", `actor ${actorId} is not registered in topic ${topicId}`);

      const actorAcks = topic.integration.inboxAcks.get(actorId) ?? new Map();
      const ackedAt = nowIso();
      actorAcks.set(itemId, {
        item_id: itemId,
        topic_id: topicId,
        actor_id: actorId,
        acked_at: ackedAt,
        note: typeof item.note === "string" ? item.note : null
      });
      topic.integration.inboxAcks.set(actorId, actorAcks);
      topic.updatedAt = ackedAt;
      ackedItems.push({
        item_id: itemId,
        topic_id: topicId,
        actor_id: actorId,
        acked_at: ackedAt
      });
    }

    return {
      projection: "control_plane_projection",
      actor_id: actorId,
      acked_items: ackedItems
    };
  }

  getShellCompatibilityContract(input = {}) {
    const topicId = typeof input.topicId === "string" && input.topicId.trim().length > 0 ? input.topicId.trim() : null;
    const contract = {
      projection: "integration_adaptor_contract",
      contract_version: "v1.1",
      adapter: "shell_v0a_compatibility_layer",
      owner: "apps/shell/scripts/dev-server.mjs",
      backend_contract_source: "/v1/*",
      adapter_routes: [
        "/api/v0a/shell-state",
        "/api/v0a/approvals/:approvalId/decision",
        "/api/v0a/interventions/:interventionId/action",
        "/api/v0a/intervention-points/:pointId/action"
      ],
      freeze_rule: "compatibility adapter must not define backend truth or new API nouns",
      compatibility_window: {
        policy: "bounded_bridge_window",
        legacy_surface: "/api/v0a/*",
        target_surface: "/v1/*",
        compatibility_scope: [
          "route translation only",
          "payload normalization only",
          "interventionId passthrough only"
        ],
        hard_boundary: "adapter is projection/adaptor only; backend truth remains in control/execution planes"
      },
      retirement: {
        status: "active_compatibility_layer",
        phase: "phase2_batch3_window_open",
        retirement_path: [
          {
            stage: "window_open",
            criteria: "legacy clients can still read/write through adapter but /v1 remains source contract"
          },
          {
            stage: "migration_only",
            criteria: "new clients use /v1 only; adapter serves compatibility-only traffic"
          },
          {
            stage: "retired",
            criteria: "adapter routes removed after reviewer+QA pass and zero required legacy callers"
          }
        ],
        exit_criteria: [
          "third-party consumer can complete operator flow with /v1 APIs",
          "batch2 reviewer and QA gates pass on integration surface",
          "batch3 reviewer and QA gates pass on compatibility window + debug history aggregation"
        ],
        next_action: "new backend contract only ships under /v1 namespace",
        debug_anchors: {
          compatibility_contract: "/v1/compatibility/shell-adapter",
          cross_plane_debug_history: "/v1/debug/history"
        }
      }
    };
    const backendDerivedProjection = {
      source_contract: "backend_truth_only",
      projection_surfaces: [
        "/v1/topics/:topicId/repo-binding",
        "/v1/topics/:topicId/prs",
        "/v1/topics/:topicId/notifications"
      ],
      lineage_anchors: {
        run_history: "/v1/topics/:topicId/run-history",
        run_replay: "/v1/runs/:runId/replay?topic_id=:topicId",
        debug_events: "/v1/debug/events?topic_id=:topicId",
        debug_history: "/v1/debug/history?topic_id=:topicId&run_id=:runId"
      }
    };
    if (!topicId) {
      return {
        ...contract,
        backend_derived_projection: backendDerivedProjection
      };
    }
    const topic = this.requireTopic(topicId);
    return {
      ...contract,
      backend_derived_projection: {
        ...backendDerivedProjection,
        topic_id: topicId,
        delivery_projection: deepClone(buildTopicDeliveryProjection(topic)),
        explanation_projection: deepClone(
          buildRunExplanationProjection(topic, buildTopicDeliveryProjection(topic).pr_writeback_ref.run_id ?? null)
        )
      }
    };
  }

  getTopicDeliveryProjection(topicId) {
    const topic = this.requireTopic(topicId);
    return deepClone(buildTopicDeliveryProjection(topic));
  }

  getTopicRepoBindingProjection(topicId) {
    const topic = this.requireTopic(topicId);
    const binding = topic.integration.repoBinding;
    if (!binding) {
      return null;
    }
    return deepClone(binding);
  }

  upsertTopicRepoBindingProjection(topicId, input) {
    const topic = this.requireTopic(topicId);
    assertOrThrow(input && typeof input === "object", "repo_binding_invalid", "repo binding payload must be object");
    const providerRef = parseProviderRef(input.provider_ref, { requireRepoRef: true });
    const defaultBranch =
      typeof input.default_branch === "string" && input.default_branch.trim().length > 0
        ? input.default_branch.trim()
        : null;
    const now = nowIso();
    const previous = topic.integration.repoBinding;
    const boundBy =
      typeof input.bound_by === "string" && input.bound_by.trim().length > 0 ? input.bound_by.trim() : "system";
    topic.integration.repoBinding = {
      topic_id: topicId,
      provider_ref: providerRef,
      default_branch: defaultBranch,
      bound_by: boundBy,
      linked_at: previous?.linked_at ?? now,
      updated_at: now
    };
    topic.updatedAt = now;
    keepHistory(topic, {
      event: "repo_binding_projection_upserted",
      at: now,
      topicId
    });
    return deepClone(topic.integration.repoBinding);
  }

  listTopicPrProjections(topicId) {
    const topic = this.requireTopic(topicId);
    return Array.from(topic.integration.prs.values())
      .map((item) => deepClone(item))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }

  createTopicPrProjection(topicId, input) {
    const topic = this.requireTopic(topicId);
    assertOrThrow(input && typeof input === "object", "pr_projection_invalid", "pr projection payload must be object");
    const providerRef = parseProviderRef(input.provider_ref, { requireRepoRef: true });
    const now = nowIso();
    const prId = generateId("pr");
    const item = {
      pr_id: prId,
      topic_id: topicId,
      provider_ref: providerRef,
      title: typeof input.title === "string" ? input.title : null,
      url: typeof input.url === "string" ? input.url : null,
      status: typeof input.status === "string" && input.status.length > 0 ? input.status : "open",
      head_sha: typeof input.head_sha === "string" ? input.head_sha : null,
      base_branch: typeof input.base_branch === "string" ? input.base_branch : null,
      created_at: now,
      updated_at: now,
      reviews: [],
      checks: []
    };
    topic.integration.prs.set(prId, item);
    this.prIndex.set(prId, { topicId });
    topic.updatedAt = now;
    keepHistory(topic, {
      event: "pr_projection_created",
      at: now,
      topicId,
      prId
    });
    return deepClone(item);
  }

  getPrProjection(prId) {
    const resolved = this.resolvePr(prId);
    const item = resolved.topic.integration.prs.get(prId);
    return deepClone(item);
  }

  updatePrProjection(prId, input) {
    const resolved = this.resolvePr(prId);
    const item = resolved.topic.integration.prs.get(prId);
    assertOrThrow(input && typeof input === "object", "pr_projection_invalid", "pr projection payload must be object");

    if (input.provider_ref !== undefined) {
      const patched = parseProviderRef(input.provider_ref, { requireRepoRef: false });
      item.provider_ref = {
        provider: patched.provider ?? item.provider_ref.provider,
        repo_ref: patched.repo_ref ?? item.provider_ref.repo_ref,
        pr_number: patched.pr_number ?? item.provider_ref.pr_number,
        pr_node_id: patched.pr_node_id ?? item.provider_ref.pr_node_id
      };
    }
    if (typeof input.title === "string" || input.title === null) {
      item.title = input.title;
    }
    if (typeof input.url === "string" || input.url === null) {
      item.url = input.url;
    }
    if (typeof input.status === "string" && input.status.length > 0) {
      item.status = input.status;
    }
    if (typeof input.head_sha === "string" || input.head_sha === null) {
      item.head_sha = input.head_sha;
    }
    if (typeof input.base_branch === "string" || input.base_branch === null) {
      item.base_branch = input.base_branch;
    }
    item.updated_at = nowIso();
    resolved.topic.updatedAt = item.updated_at;
    keepHistory(resolved.topic, {
      event: "pr_projection_updated",
      at: item.updated_at,
      topicId: resolved.topicId,
      prId
    });
    return deepClone(item);
  }

  appendPrReviewProjection(prId, input) {
    const resolved = this.resolvePr(prId);
    const item = resolved.topic.integration.prs.get(prId);
    assertOrThrow(input && typeof input === "object", "pr_review_invalid", "pr review payload must be object");
    const now = nowIso();
    const review = {
      review_id: generateId("review"),
      actor_id: typeof input.actor_id === "string" && input.actor_id.length > 0 ? input.actor_id : "unknown",
      state: typeof input.state === "string" && input.state.length > 0 ? input.state : "commented",
      summary: typeof input.summary === "string" ? input.summary : "",
      submitted_at: now
    };
    item.reviews.push(review);
    item.updated_at = now;
    resolved.topic.updatedAt = now;
    keepHistory(resolved.topic, {
      event: "pr_projection_review_appended",
      at: now,
      topicId: resolved.topicId,
      prId
    });
    return deepClone(review);
  }

  appendPrCheckProjection(prId, input) {
    const resolved = this.resolvePr(prId);
    const item = resolved.topic.integration.prs.get(prId);
    assertOrThrow(input && typeof input === "object", "pr_check_invalid", "pr check payload must be object");
    const now = nowIso();
    const check = {
      check_id: generateId("check"),
      name: typeof input.name === "string" && input.name.length > 0 ? input.name : "unnamed",
      status: typeof input.status === "string" && input.status.length > 0 ? input.status : "completed",
      conclusion: typeof input.conclusion === "string" ? input.conclusion : null,
      details: typeof input.details === "string" ? input.details : "",
      url: typeof input.url === "string" ? input.url : null,
      at: now
    };
    item.checks.push(check);
    item.updated_at = now;
    resolved.topic.updatedAt = now;
    keepHistory(resolved.topic, {
      event: "pr_projection_check_appended",
      at: now,
      topicId: resolved.topicId,
      prId
    });
    return deepClone(check);
  }

  listMessages(topicId, input = {}) {
    const topic = this.requireTopic(topicId);
    const route = typeof input.route === "string" && input.route.trim() ? input.route.trim() : null;
    if (!route) {
      return Array.from(topic.messages.values()).map((message) => deepClone(message));
    }
    const ids = topic.routes.get(route) ?? [];
    return ids.map((id) => deepClone(topic.messages.get(id))).filter(Boolean);
  }

  sweepConflictEscalations(topic, now = Date.now()) {
    for (const conflict of topic.conflicts.values()) {
      if (conflict.status !== "unresolved" || conflict.escalatedAt) {
        continue;
      }
      if (now < conflict.escalateAfterMs) {
        continue;
      }
      conflict.escalatedAt = nowIso();
      topic.riskFlags.add("conflict_timeout_escalation");
      topic.blockers.set(`conflict_timeout:${conflict.conflictId}`, {
        blockerId: `conflict_timeout:${conflict.conflictId}`,
        reason: "challenge unresolved beyond timeout",
        conflictId: conflict.conflictId,
        createdAt: conflict.escalatedAt
      });
      keepHistory(topic, {
        event: "conflict_timeout_escalated",
        at: conflict.escalatedAt,
        conflictId: conflict.conflictId
      });
    }
  }

  applyMessageSemantics(topic, message) {
    switch (message.type) {
      case "dispatch":
        return this.handleDispatch(topic, message);
      case "status_report":
        return this.handleStatusReport(topic, message);
      case "handoff_package":
        return this.handleHandoff(topic, message);
      case "challenge":
        return this.handleChallenge(topic, message);
      case "conflict_resolution":
        return this.handleConflictResolution(topic, message);
      case "shared_truth_proposal":
        return this.handleSharedTruthProposal(topic, message);
      case "merge_request":
        return this.handleMergeRequest(topic, message);
      case "blocker_escalation":
        return this.handleBlockerEscalation(topic, message);
      case "feedback_ingest":
        return this.handleFeedbackIngest(topic, message);
      default:
        throw new CoordinatorError("unsupported_message_type", `no handler for ${message.type}`);
    }
  }

  handleDispatch(topic, message) {
    assertOrThrow(message.sourceRole === "lead", "dispatch_requires_lead", "dispatch can only be issued by lead");
    assertOrThrow(
      typeof message.payload?.workerAgentId === "string" && message.payload.workerAgentId.length > 0,
      "dispatch_requires_worker",
      "dispatch payload.workerAgentId is required"
    );

    message.state = MESSAGE_STATE.PENDING_ACCEPT;
    topic.dispatches.set(message.messageId, {
      dispatchId: message.messageId,
      workerAgentId: message.payload.workerAgentId,
      status: "pending_accept",
      createdAt: message.createdAt
    });

    return {
      dispatchId: message.messageId,
      status: "pending_accept"
    };
  }

  handleStatusReport(topic, message) {
    const statusEvent = message.payload?.event;
    assertOrThrow(typeof statusEvent === "string" && statusEvent.length > 0, "status_event_required", "status_report payload.event is required");

    if (statusEvent === "dispatch_accepted") {
      const dispatchId = message.payload?.dispatchId;
      const dispatch = topic.dispatches.get(dispatchId);
      assertOrThrow(dispatch, "dispatch_not_found", `dispatch ${dispatchId} not found`);
      assertOrThrow(dispatch.workerAgentId === message.sourceAgentId, "dispatch_accept_forbidden", "only target worker can accept dispatch");
      dispatch.status = "active";
      dispatch.acceptedAt = message.createdAt;
      message.state = MESSAGE_STATE.ACCEPTED;
      return { dispatchId, status: "active" };
    }

    if (statusEvent === "handoff_ack") {
      const handoffId = message.payload?.handoffId;
      const handoff = topic.handoffs.get(handoffId);
      assertOrThrow(handoff, "handoff_not_found", `handoff ${handoffId} not found`);
      const allowedReceivers = collectHandoffReceivers(topic, handoff);
      assertOrThrow(allowedReceivers.size > 0, "handoff_receiver_undefined", "handoff target receiver is undefined");
      assertOrThrow(
        allowedReceivers.has(message.sourceAgentId),
        "handoff_ack_forbidden",
        "handoff_ack must be sent by the intended receiver"
      );
      const resolvedArtifacts = message.payload?.resolvedArtifacts;
      assertOrThrow(
        isAllArtifactsResolved(handoff, resolvedArtifacts),
        "handoff_artifacts_unresolved",
        "handoff_ack requires all referenced artifacts to be resolved"
      );

      handoff.status = "completed";
      handoff.acknowledgedBy = message.sourceAgentId;
      handoff.acknowledgedAt = message.createdAt;
      handoff.resolvedArtifacts = Array.isArray(resolvedArtifacts) ? [...resolvedArtifacts] : [];
      handoff.artifactsResolved = true;
      const handoffMessage = topic.messages.get(handoffId);
      if (handoffMessage) {
        handoffMessage.state = MESSAGE_STATE.CLOSED;
      }
      message.state = MESSAGE_STATE.ACCEPTED;
      return { handoffId, status: "completed" };
    }

    if (statusEvent === "agent_state") {
      const agent = topic.agents.get(message.sourceAgentId);
      if (agent) {
        agent.status = message.payload?.status ?? agent.status;
        agent.lastSeenAt = message.createdAt;
      }
      message.state = MESSAGE_STATE.ACCEPTED;
      return { agentId: message.sourceAgentId, status: agent?.status ?? "unknown" };
    }

    message.state = MESSAGE_STATE.ACCEPTED;
    return { statusEvent };
  }

  handleHandoff(topic, message) {
    const { toAgentId, toRole } = parseHandoffTarget(message.targetScope);
    message.state = MESSAGE_STATE.HANDOFF_PENDING;
    topic.handoffs.set(message.messageId, {
      handoffId: message.messageId,
      fromAgentId: message.sourceAgentId,
      toScope: message.targetScope,
      toAgentId,
      toRole,
      status: "handoff_pending",
      referencedArtifacts: message.referencedArtifacts,
      artifactsResolved: Array.isArray(message.referencedArtifacts) ? message.referencedArtifacts.length === 0 : true,
      createdAt: message.createdAt
    });
    return {
      handoffId: message.messageId,
      status: "handoff_pending"
    };
  }

  handleChallenge(topic, message) {
    const conflictId = message.payload?.conflictId ?? generateId("conflict");
    const scopes = Array.isArray(message.payload?.scopes) ? message.payload.scopes : [];
    const conflict = {
      conflictId,
      challengeMessageId: message.messageId,
      status: "unresolved",
      scopes,
      createdAt: message.createdAt,
      escalateAfterMs: Date.now() + this.escalationMs,
      escalatedAt: null,
      resolution: null
    };
    topic.conflicts.set(conflictId, conflict);
    topic.blockers.set(`conflict:${conflictId}`, {
      blockerId: `conflict:${conflictId}`,
      reason: "unresolved challenge",
      conflictId,
      createdAt: message.createdAt
    });
    message.state = MESSAGE_STATE.BLOCKED_CONFLICT;
    return {
      conflictId,
      status: "unresolved"
    };
  }

  handleConflictResolution(topic, message) {
    assertOrThrow(
      message.sourceRole === "lead" || message.sourceRole === "human",
      "resolution_requires_lead_or_human",
      "conflict_resolution can only be issued by lead or human"
    );
    const conflictId = message.payload?.conflictId;
    assertOrThrow(typeof conflictId === "string" && conflictId.length > 0, "conflict_required", "payload.conflictId is required");
    const conflict = topic.conflicts.get(conflictId);
    assertOrThrow(conflict, "conflict_not_found", `conflict ${conflictId} not found`);
    assertOrThrow(conflict.status === "unresolved", "conflict_already_closed", `conflict ${conflictId} already closed`);
    assertOrThrow(
      ["accept_side", "split_dispatch", "request_evidence", "escalate_human"].includes(message.payload?.outcome),
      "invalid_resolution_outcome",
      "payload.outcome must be one of accept_side/split_dispatch/request_evidence/escalate_human"
    );

    conflict.status = "resolved";
    conflict.resolution = {
      outcome: message.payload.outcome,
      by: message.sourceAgentId,
      at: message.createdAt,
      messageId: message.messageId,
      notes: message.payload?.notes ?? null
    };
    topic.blockers.delete(`conflict:${conflictId}`);
    topic.blockers.delete(`conflict_timeout:${conflictId}`);
    message.state = MESSAGE_STATE.CLOSED;
    return {
      conflictId,
      status: "resolved",
      outcome: conflict.resolution.outcome
    };
  }

  handleSharedTruthProposal(topic, message) {
    assertOrThrow(
      message.truthRevision !== null && Number.isFinite(message.truthRevision),
      "proposal_requires_revision",
      "shared_truth_proposal requires truthRevision"
    );
    assertOrThrow(message.truthRevision <= topic.revision, "revision_ahead", "proposal revision cannot be ahead of current revision");

    if (message.truthRevision < topic.revision) {
      message.state = MESSAGE_STATE.REJECTED;
      throw new CoordinatorError("stale_revision", "proposal uses stale truth revision", {
        expectedRevision: topic.revision,
        gotRevision: message.truthRevision
      });
    }

    const touchedScope = message.payload?.scope ?? null;
    for (const conflict of topic.conflicts.values()) {
      if (conflict.status === "unresolved" && conflictTouchesScope(conflict, touchedScope)) {
        message.state = MESSAGE_STATE.BLOCKED_CONFLICT;
        throw new CoordinatorError("unresolved_conflict", "proposal is blocked by unresolved conflict", {
          conflictId: conflict.conflictId
        });
      }
    }

    const gates = collectDynamicGates(message);
    if (gates.size > 0) {
      const holds = this.createApprovalHolds(topic, message, gates);
      message.state = MESSAGE_STATE.WAITING_GATE;
      return {
        status: "waiting_human_gate",
        holdIds: holds.map((hold) => hold.holdId)
      };
    }

    this.acceptSharedTruthProposal(topic, message);
    return {
      status: "accepted",
      revision: topic.revision
    };
  }

  handleMergeRequest(topic, message) {
    assertOrThrow(message.sourceRole === "worker", "merge_request_requires_worker", "merge_request must be issued by a worker");
    const handoffId = message.payload?.handoffId;
    assertOrThrow(
      typeof handoffId === "string" && handoffId.length > 0,
      "merge_request_requires_handoff",
      "merge_request payload.handoffId is required"
    );
    const handoff = topic.handoffs.get(handoffId);
    assertOrThrow(handoff, "handoff_not_found", `handoff ${handoffId} not found`);
    assertOrThrow(
      handoff.fromAgentId === message.sourceAgentId,
      "merge_request_handoff_owner_mismatch",
      "merge_request must be bound to handoff from the same worker"
    );
    assertOrThrow(
      handoff.status === "completed",
      "merge_request_requires_completed_handoff",
      "merge_request requires lead-accepted completed handoff package"
    );
    assertOrThrow(
      typeof handoff.acknowledgedBy === "string" && hasLeadRole(topic, handoff.acknowledgedBy),
      "merge_request_requires_lead_acceptance",
      "merge_request requires handoff acknowledgment by lead"
    );
    assertOrThrow(
      handoff.artifactsResolved === true,
      "merge_request_requires_resolved_artifacts",
      "merge_request requires resolved handoff artifacts"
    );

    const unresolvedConflicts = Array.from(topic.conflicts.values()).filter((conflict) => conflict.status === "unresolved");
    if (unresolvedConflicts.length > 0) {
      message.state = MESSAGE_STATE.BLOCKED_CONFLICT;
      return {
        status: "blocked_conflict",
        conflictIds: unresolvedConflicts.map((conflict) => conflict.conflictId)
      };
    }

    const gates = collectDynamicGates(message);
    const holds = this.createApprovalHolds(topic, message, gates);
    message.state = MESSAGE_STATE.MERGE_CANDIDATE;
    topic.truth.deliveryState.state = "awaiting_merge_gate";
    topic.truth.deliveryState.lastUpdatedAt = nowIso();

    return {
      status: "merge_candidate_waiting_human_gate",
      holdIds: holds.map((hold) => hold.holdId)
    };
  }

  handleBlockerEscalation(topic, message) {
    const blockerId = message.payload?.blockerId ?? generateId("blocker");
    topic.blockers.set(blockerId, {
      blockerId,
      reason: message.payload?.reason ?? "unspecified blocker",
      messageId: message.messageId,
      laneId: message.laneId,
      runId: message.runId,
      createdAt: message.createdAt
    });
    message.state = MESSAGE_STATE.ACCEPTED;
    return {
      blockerId
    };
  }

  handleFeedbackIngest(topic, message) {
    topic.feedback.push({
      feedbackId: message.payload?.feedbackId ?? generateId("feedback"),
      sourceAgentId: message.sourceAgentId,
      laneId: message.laneId,
      runId: message.runId,
      payload: deepClone(message.payload),
      createdAt: message.createdAt
    });
    if (topic.feedback.length > 2000) {
      topic.feedback.shift();
    }
    message.state = MESSAGE_STATE.ACCEPTED;
    return {
      feedbackCount: topic.feedback.length
    };
  }

  acceptSharedTruthProposal(topic, message) {
    const patch = message.payload?.patch;
    assertOrThrow(patch && typeof patch === "object", "proposal_requires_patch", "shared_truth_proposal payload.patch is required");
    topic.truth = deepMerge(topic.truth, patch);
    topic.revision += 1;
    topic.truth.deliveryState.lastUpdatedAt = nowIso();
    message.state = MESSAGE_STATE.ACCEPTED;
    keepHistory(topic, {
      event: "shared_truth_revision_advanced",
      at: nowIso(),
      messageId: message.messageId,
      revision: topic.revision
    });
  }

  createApprovalHolds(topic, message, gates) {
    const holds = [];
    for (const gate of gates.values()) {
      const holdId = generateId("hold");
      const hold = {
        holdId,
        gate,
        status: "pending",
        messageId: message.messageId,
        createdAt: nowIso(),
        decidedAt: null,
        decider: null
      };
      topic.approvals.set(holdId, hold);
      holds.push(hold);
    }
    topic.holdsByMessage.set(message.messageId, holds.map((hold) => hold.holdId));
    return holds;
  }

  allHoldsApproved(topic, messageId) {
    const holdIds = topic.holdsByMessage.get(messageId) ?? [];
    if (holdIds.length === 0) {
      return true;
    }
    return holdIds.every((holdId) => topic.approvals.get(holdId)?.status === "approved");
  }

  releaseMessageAfterApprovals(topic, message) {
    if (message.type === "shared_truth_proposal") {
      this.acceptSharedTruthProposal(topic, message);
      return;
    }
    if (message.type === "merge_request") {
      message.state = MESSAGE_STATE.MERGE_CANDIDATE;
      topic.truth.deliveryState.state = "pr_ready";
      topic.truth.deliveryState.prUrl = message.payload?.prUrl ?? null;
      topic.truth.deliveryState.lastUpdatedAt = nowIso();
      keepHistory(topic, {
        event: "delivery_state_updated",
        at: topic.truth.deliveryState.lastUpdatedAt,
        state: topic.truth.deliveryState.state,
        messageId: message.messageId
      });
      return;
    }
    message.state = MESSAGE_STATE.ACCEPTED;
  }

  resolveTopicForRun(runId, topicId = null) {
    if (topicId) {
      const topic = this.requireTopic(topicId);
      const hasRun = Array.from(topic.messages.values()).some((message) => message.runId === runId);
      assertOrThrow(hasRun, "run_not_found", `run ${runId} not found in topic ${topicId}`);
      return { topicId, topic };
    }

    let matched = null;
    for (const topic of this.topics.values()) {
      const hasRun = Array.from(topic.messages.values()).some((message) => message.runId === runId);
      if (!hasRun) {
        continue;
      }
      if (matched) {
        throw new CoordinatorError("run_ambiguous", `run ${runId} exists in multiple topics`, {
          runId,
          topicIds: [matched.topicId, topic.topicId]
        });
      }
      matched = { topicId: topic.topicId, topic };
    }
    assertOrThrow(matched, "run_not_found", `run ${runId} not found`);
    return matched;
  }

  resolvePr(prId) {
    assertOrThrow(typeof prId === "string" && prId.length > 0, "pr_id_required", "prId is required");
    const indexed = this.prIndex.get(prId);
    assertOrThrow(indexed, "pr_not_found", `pr ${prId} not found`);
    const topic = this.requireTopic(indexed.topicId);
    assertOrThrow(topic.integration.prs.has(prId), "pr_not_found", `pr ${prId} not found`);
    return {
      topicId: indexed.topicId,
      topic
    };
  }

  recordRoute(topic, message) {
    const key = routeKey(message);
    const existing = topic.routes.get(key) ?? [];
    existing.push(message.messageId);
    topic.routes.set(key, existing);
  }

  requireTopic(topicId) {
    assertOrThrow(typeof topicId === "string" && topicId.length > 0, "invalid_topic_id", "topicId is required");
    const topic = this.topics.get(topicId);
    assertOrThrow(topic, "topic_not_found", `topic ${topicId} not found`);
    return topic;
  }
}
