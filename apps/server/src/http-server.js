import http from "node:http";
import { URL } from "node:url";
import { CoordinatorError } from "./errors.js";
import { MESSAGE_TYPES } from "./protocol.js";
import { buildRuntimeConfig, seedSampleFixture } from "./runtime-fixtures.js";
import { deepClone, generateId, nowIso } from "./utils.js";

const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_DEBUG_PAGE_LIMIT = 100;

const RUNTIME_DAEMON_EVENT_TYPES = new Set([
  "feedback_ingest",
  "blocker_escalation",
  "status_report"
]);

const RUNTIME_DAEMON_ALLOWED_FIELDS = new Set([
  "topicId",
  "type",
  "laneId",
  "runId",
  "payload"
]);

const COMMAND_INTENT_ALLOWED_FIELDS = new Set([
  "command_id",
  "command_type",
  "source_actor_id",
  "target_scope",
  "lane_id",
  "run_id",
  "truth_revision",
  "referenced_artifacts",
  "payload",
  "correlation_id"
]);

const CONTROL_EVENT_TYPES = new Set([
  "topic_created",
  "actor_upserted",
  "command_accepted",
  "command_rejected",
  "dispatch_created",
  "dispatch_rejected",
  "hold_created",
  "hold_decided",
  "hold_decision_rejected",
  "conflict_opened",
  "conflict_resolved",
  "conflict_resolution_rejected",
  "blocker_added",
  "delivery_updated",
  "delivery_update_rejected",
  "pr_writeback_updated",
  "pr_writeback_rejected"
]);

const IDEMPOTENCY_REQUIRED_ROUTES = new Set([
  "V1_POST_TOPICS",
  "V1_POST_TOPIC_COMMAND",
  "V1_POST_APPROVAL_DECISION",
  "V1_POST_TOPIC_DISPATCH",
  "V1_POST_CONFLICT_RESOLUTION",
  "V1_PUT_TOPIC_DELIVERY",
  "V1_PUT_TOPIC_PR_WRITEBACK"
]);

const DELIVERY_SERVER_OWNED_FIELDS = new Set(["run_id", "checkpoint_ref", "artifact_refs", "closeout_lineage", "merge_lifecycle_stage"]);
const PR_WRITEBACK_SERVER_OWNED_FIELDS = new Set(["run_id", "checkpoint_ref", "artifact_refs", "closeout_lineage", "merge_lifecycle_stage"]);

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new CoordinatorError("invalid_json", "request body must be valid JSON");
  }
}

function matchRoute(method, pathName) {
  if (method === "POST" && pathName === "/v1/topics") {
    return { route: "V1_POST_TOPICS" };
  }

  if (method === "GET" && pathName === "/v1/topics") {
    return { route: "V1_GET_TOPICS" };
  }

  const v1TopicMatch = pathName.match(/^\/v1\/topics\/([^/]+)$/);
  if (method === "GET" && v1TopicMatch) {
    return { route: "V1_GET_TOPIC", topicId: v1TopicMatch[1] };
  }

  const v1TopicActorsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/actors$/);
  if (method === "GET" && v1TopicActorsMatch) {
    return { route: "V1_GET_TOPIC_ACTORS", topicId: v1TopicActorsMatch[1] };
  }

  const v1TopicActorUpsertMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/actors\/([^/]+)$/);
  if (method === "GET" && v1TopicActorUpsertMatch) {
    return {
      route: "V1_GET_TOPIC_ACTOR",
      topicId: v1TopicActorUpsertMatch[1],
      actorId: v1TopicActorUpsertMatch[2]
    };
  }
  if (method === "PUT" && v1TopicActorUpsertMatch) {
    return {
      route: "V1_PUT_TOPIC_ACTOR",
      topicId: v1TopicActorUpsertMatch[1],
      actorId: v1TopicActorUpsertMatch[2]
    };
  }

  const v1TopicCommandsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/commands$/);
  if (method === "POST" && v1TopicCommandsMatch) {
    return { route: "V1_POST_TOPIC_COMMAND", topicId: v1TopicCommandsMatch[1] };
  }

  const v1TopicMessagesMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/messages$/);
  if (method === "POST" && v1TopicMessagesMatch) {
    return { route: "V1_POST_TOPIC_MESSAGE", topicId: v1TopicMessagesMatch[1] };
  }
  if (method === "GET" && v1TopicMessagesMatch) {
    return { route: "V1_GET_TOPIC_MESSAGES", topicId: v1TopicMessagesMatch[1] };
  }

  const v1TopicEventsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/events$/);
  if (method === "GET" && v1TopicEventsMatch) {
    return { route: "V1_GET_TOPIC_EVENTS", topicId: v1TopicEventsMatch[1] };
  }

  const v1TopicStateGraphMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/state-graph$/);
  if (method === "GET" && v1TopicStateGraphMatch) {
    return { route: "V1_GET_TOPIC_STATE_GRAPH", topicId: v1TopicStateGraphMatch[1] };
  }

  const v1TopicDispatchesMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/dispatches$/);
  if (method === "GET" && v1TopicDispatchesMatch) {
    return { route: "V1_GET_TOPIC_DISPATCHES", topicId: v1TopicDispatchesMatch[1] };
  }
  if (method === "POST" && v1TopicDispatchesMatch) {
    return { route: "V1_POST_TOPIC_DISPATCH", topicId: v1TopicDispatchesMatch[1] };
  }

  const v1TopicDispatchMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/dispatches\/([^/]+)$/);
  if (method === "GET" && v1TopicDispatchMatch) {
    return {
      route: "V1_GET_TOPIC_DISPATCH",
      topicId: v1TopicDispatchMatch[1],
      dispatchId: v1TopicDispatchMatch[2]
    };
  }

  const v1TopicConflictsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/conflicts$/);
  if (method === "GET" && v1TopicConflictsMatch) {
    return { route: "V1_GET_TOPIC_CONFLICTS", topicId: v1TopicConflictsMatch[1] };
  }

  const v1TopicConflictMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/conflicts\/([^/]+)$/);
  if (method === "GET" && v1TopicConflictMatch) {
    return {
      route: "V1_GET_TOPIC_CONFLICT",
      topicId: v1TopicConflictMatch[1],
      conflictId: v1TopicConflictMatch[2]
    };
  }

  const v1TopicConflictResolutionMatch = pathName.match(
    /^\/v1\/topics\/([^/]+)\/conflicts\/([^/]+)\/resolutions$/
  );
  if (method === "POST" && v1TopicConflictResolutionMatch) {
    return {
      route: "V1_POST_CONFLICT_RESOLUTION",
      topicId: v1TopicConflictResolutionMatch[1],
      conflictId: v1TopicConflictResolutionMatch[2]
    };
  }

  const v1TopicApprovalHoldsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/approval-holds$/);
  if (method === "GET" && v1TopicApprovalHoldsMatch) {
    return { route: "V1_GET_APPROVAL_HOLDS", topicId: v1TopicApprovalHoldsMatch[1] };
  }

  const v1TopicApprovalHoldMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/approval-holds\/([^/]+)$/);
  if (method === "GET" && v1TopicApprovalHoldMatch) {
    return {
      route: "V1_GET_APPROVAL_HOLD",
      topicId: v1TopicApprovalHoldMatch[1],
      holdId: v1TopicApprovalHoldMatch[2]
    };
  }

  const v1TopicApprovalDecisionsMatch = pathName.match(
    /^\/v1\/topics\/([^/]+)\/approval-holds\/([^/]+)\/decisions$/
  );
  if (method === "GET" && v1TopicApprovalDecisionsMatch) {
    return {
      route: "V1_GET_APPROVAL_DECISIONS",
      topicId: v1TopicApprovalDecisionsMatch[1],
      holdId: v1TopicApprovalDecisionsMatch[2]
    };
  }

  const v1TopicApprovalDecisionMatch = pathName.match(
    /^\/v1\/topics\/([^/]+)\/approval-holds\/([^/]+)\/decisions$/
  );
  if (method === "POST" && v1TopicApprovalDecisionMatch) {
    return {
      route: "V1_POST_APPROVAL_DECISION",
      topicId: v1TopicApprovalDecisionMatch[1],
      holdId: v1TopicApprovalDecisionMatch[2]
    };
  }

  const v1TopicCoarseMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/coarse$/);
  if (method === "GET" && v1TopicCoarseMatch) {
    return { route: "V1_GET_TOPIC_COARSE", topicId: v1TopicCoarseMatch[1] };
  }

  const v1TopicDeliveryMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/delivery$/);
  if (method === "GET" && v1TopicDeliveryMatch) {
    return { route: "V1_GET_TOPIC_DELIVERY", topicId: v1TopicDeliveryMatch[1] };
  }
  if (method === "PUT" && v1TopicDeliveryMatch) {
    return { route: "V1_PUT_TOPIC_DELIVERY", topicId: v1TopicDeliveryMatch[1] };
  }

  const v1TopicPrWritebackMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/pr-writeback$/);
  if (method === "GET" && v1TopicPrWritebackMatch) {
    return { route: "V1_GET_TOPIC_PR_WRITEBACK", topicId: v1TopicPrWritebackMatch[1] };
  }
  if (method === "PUT" && v1TopicPrWritebackMatch) {
    return { route: "V1_PUT_TOPIC_PR_WRITEBACK", topicId: v1TopicPrWritebackMatch[1] };
  }

  const v1TopicDebugHistoryMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/debug\/history$/);
  if (method === "GET" && v1TopicDebugHistoryMatch) {
    return { route: "V1_GET_TOPIC_DEBUG_HISTORY", topicId: v1TopicDebugHistoryMatch[1] };
  }

  const v1TopicDebugRejectionsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/debug\/rejections$/);
  if (method === "GET" && v1TopicDebugRejectionsMatch) {
    return { route: "V1_GET_TOPIC_DEBUG_REJECTIONS", topicId: v1TopicDebugRejectionsMatch[1] };
  }

  const v1TopicRunHistoryMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/run-history$/);
  if (method === "GET" && v1TopicRunHistoryMatch) {
    return { route: "V1_GET_TOPIC_RUN_HISTORY", topicId: v1TopicRunHistoryMatch[1] };
  }

  const v1TopicNotificationsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/notifications$/);
  if (method === "GET" && v1TopicNotificationsMatch) {
    return { route: "V1_GET_TOPIC_NOTIFICATIONS", topicId: v1TopicNotificationsMatch[1] };
  }

  const v1TopicRepoBindingMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/repo-binding$/);
  if (method === "GET" && v1TopicRepoBindingMatch) {
    return { route: "V1_GET_TOPIC_REPO_BINDING", topicId: v1TopicRepoBindingMatch[1] };
  }
  if (method === "PUT" && v1TopicRepoBindingMatch) {
    return { route: "V1_PUT_TOPIC_REPO_BINDING", topicId: v1TopicRepoBindingMatch[1] };
  }

  const v1TopicPrsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/prs$/);
  if (method === "GET" && v1TopicPrsMatch) {
    return { route: "V1_GET_TOPIC_PRS", topicId: v1TopicPrsMatch[1] };
  }
  if (method === "POST" && v1TopicPrsMatch) {
    return { route: "V1_POST_TOPIC_PRS", topicId: v1TopicPrsMatch[1] };
  }

  const v1ExecutionRunDebugMatch = pathName.match(/^\/v1\/execution\/runs\/([^/]+)\/debug$/);
  if (method === "GET" && v1ExecutionRunDebugMatch) {
    return { route: "V1_GET_EXECUTION_RUN_DEBUG", runId: v1ExecutionRunDebugMatch[1] };
  }

  const v1RunsTimelineMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/timeline$/);
  if (method === "GET" && v1RunsTimelineMatch) {
    return { route: "V1_GET_RUN_TIMELINE", runId: v1RunsTimelineMatch[1] };
  }

  const v1RunsReplayMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/replay$/);
  if (method === "GET" && v1RunsReplayMatch) {
    return { route: "V1_GET_RUN_REPLAY", runId: v1RunsReplayMatch[1] };
  }

  const v1RunMatch = pathName.match(/^\/v1\/runs\/([^/]+)$/);
  if (method === "GET" && v1RunMatch) {
    return { route: "V1_GET_RUN", runId: v1RunMatch[1] };
  }

  const v1RunsFeedbackMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/feedback$/);
  if (method === "GET" && v1RunsFeedbackMatch) {
    return { route: "V1_GET_RUN_FEEDBACK", runId: v1RunsFeedbackMatch[1] };
  }

  const v1RunsHoldsMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/holds$/);
  if (method === "GET" && v1RunsHoldsMatch) {
    return { route: "V1_GET_RUN_HOLDS", runId: v1RunsHoldsMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/debug/events") {
    return { route: "V1_GET_DEBUG_EVENTS" };
  }

  if (method === "GET" && pathName === "/v1/debug/history") {
    return { route: "V1_GET_DEBUG_HISTORY" };
  }

  if (method === "GET" && pathName === "/v1/compatibility/shell-adapter") {
    return { route: "V1_GET_SHELL_ADAPTER_COMPATIBILITY" };
  }

  const v1PrMatch = pathName.match(/^\/v1\/prs\/([^/]+)$/);
  if (method === "GET" && v1PrMatch) {
    return { route: "V1_GET_PR", prId: v1PrMatch[1] };
  }
  if (method === "PATCH" && v1PrMatch) {
    return { route: "V1_PATCH_PR", prId: v1PrMatch[1] };
  }

  const v1PrReviewMatch = pathName.match(/^\/v1\/prs\/([^/]+)\/reviews$/);
  if (method === "POST" && v1PrReviewMatch) {
    return { route: "V1_POST_PR_REVIEW", prId: v1PrReviewMatch[1] };
  }

  const v1PrChecksMatch = pathName.match(/^\/v1\/prs\/([^/]+)\/checks$/);
  if (method === "POST" && v1PrChecksMatch) {
    return { route: "V1_POST_PR_CHECK", prId: v1PrChecksMatch[1] };
  }

  const v1InboxMatch = pathName.match(/^\/v1\/inbox\/([^/]+)$/);
  if (method === "GET" && v1InboxMatch) {
    return { route: "V1_GET_INBOX", actorId: v1InboxMatch[1] };
  }

  const v1InboxAckMatch = pathName.match(/^\/v1\/inbox\/([^/]+)\/acks$/);
  if (method === "POST" && v1InboxAckMatch) {
    return { route: "V1_POST_INBOX_ACKS", actorId: v1InboxAckMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/compatibility/shell-adapter") {
    return { route: "V1_GET_SHELL_ADAPTER_COMPATIBILITY" };
  }

  if (method === "GET" && pathName === "/runtime/config") {
    return { route: "GET_RUNTIME_CONFIG" };
  }

  if (method === "POST" && pathName === "/runtime/fixtures/seed") {
    return { route: "POST_RUNTIME_FIXTURE_SEED" };
  }

  if (method === "POST" && pathName === "/runtime/daemon/events") {
    return { route: "POST_RUNTIME_DAEMON_EVENT" };
  }

  if (method === "GET" && pathName === "/runtime/smoke") {
    return { route: "GET_RUNTIME_SMOKE" };
  }

  const topicMessageMatch = pathName.match(/^\/topics\/([^/]+)\/messages$/);
  if (method === "POST" && topicMessageMatch) {
    return { route: "POST_TOPIC_MESSAGE", topicId: topicMessageMatch[1] };
  }

  const topicOverviewMatch = pathName.match(/^\/topics\/([^/]+)\/overview$/);
  if (method === "GET" && topicOverviewMatch) {
    return { route: "GET_TOPIC_OVERVIEW", topicId: topicOverviewMatch[1] };
  }

  const topicCoarseMatch = pathName.match(/^\/topics\/([^/]+)\/coarse$/);
  if (method === "GET" && topicCoarseMatch) {
    return { route: "GET_TOPIC_COARSE", topicId: topicCoarseMatch[1] };
  }

  const topicListMessagesMatch = pathName.match(/^\/topics\/([^/]+)\/messages$/);
  if (method === "GET" && topicListMessagesMatch) {
    return { route: "GET_TOPIC_MESSAGES", topicId: topicListMessagesMatch[1] };
  }

  const topicAgentsMatch = pathName.match(/^\/topics\/([^/]+)\/agents$/);
  if (method === "POST" && topicAgentsMatch) {
    return { route: "POST_TOPIC_AGENT", topicId: topicAgentsMatch[1] };
  }

  const approvalDecisionMatch = pathName.match(/^\/topics\/([^/]+)\/approvals\/([^/]+)\/decision$/);
  if (method === "POST" && approvalDecisionMatch) {
    return {
      route: "POST_APPROVAL_DECISION_LEGACY",
      topicId: approvalDecisionMatch[1],
      holdId: approvalDecisionMatch[2]
    };
  }

  if (method === "POST" && pathName === "/topics") {
    return { route: "POST_TOPICS" };
  }

  if (method === "GET" && pathName === "/health") {
    return { route: "GET_HEALTH" };
  }

  return null;
}

function parsePort(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function parseWorkerAgentIds(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function assertObjectBody(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoordinatorError(code, message);
  }
}

function integrationProjectionMeta({ resource, sourcePlane, topicId = null, runId = null, prId = null }) {
  return {
    projection_kind: "integration_adaptor_projection",
    resource,
    source_plane: sourcePlane,
    server_owned_truth: false,
    topic_id: topicId,
    run_id: runId,
    pr_id: prId
  };
}

function getSingleHeader(request, name) {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  return raw;
}

function parsePageLimit(searchParams, fallback = DEFAULT_PAGE_LIMIT) {
  const raw = searchParams.get("limit");
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_PAGE_LIMIT) {
    throw new CoordinatorError(
      "invalid_pagination_limit",
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`
    );
  }
  return parsed;
}

function encodeCursor(scope, index) {
  return Buffer.from(JSON.stringify({ scope, index }), "utf8").toString("base64url");
}

function decodeCursor(rawCursor, expectedScope) {
  if (rawCursor === null) {
    return 0;
  }
  let decoded;
  try {
    const text = Buffer.from(rawCursor, "base64url").toString("utf8");
    decoded = JSON.parse(text);
  } catch {
    throw new CoordinatorError("invalid_cursor", "cursor is malformed");
  }

  if (!decoded || typeof decoded !== "object") {
    throw new CoordinatorError("invalid_cursor", "cursor is malformed");
  }
  if (decoded.scope !== expectedScope) {
    throw new CoordinatorError("invalid_cursor_scope", "cursor scope does not match endpoint");
  }
  if (!Number.isInteger(decoded.index) || decoded.index < 0) {
    throw new CoordinatorError("invalid_cursor", "cursor index is invalid");
  }
  return decoded.index;
}

function paginate(items, { cursor, limit, scope }) {
  const start = decodeCursor(cursor, scope);
  const end = Math.min(start + limit, items.length);
  const pageItems = items.slice(start, end);
  const hasMore = end < items.length;
  return {
    items: pageItems,
    page: {
      limit,
      next_cursor: hasMore ? encodeCursor(scope, end) : null,
      has_more: hasMore
    }
  };
}

function serializeDeliveryState(input) {
  return {
    state: input?.state ?? "not_started",
    pr_url: input?.prUrl ?? null,
    last_updated_at: input?.lastUpdatedAt ?? null
  };
}

function serializeActor(actor) {
  return {
    actor_id: actor.agentId,
    role: actor.role,
    status: actor.status,
    lane_id: actor.laneId ?? null,
    last_seen_at: actor.lastSeenAt ?? null
  };
}

function deriveMergeStage(truth = {}) {
  if (truth?.mergeIntent && typeof truth.mergeIntent === "object") {
    const stage = truth.mergeIntent.stage;
    if (typeof stage === "string" && stage.trim().length > 0) {
      return stage.trim();
    }
  }
  const deliveryState = truth?.deliveryState?.state ?? "not_started";
  return deliveryState;
}

function pickOptionalString(...values) {
  for (const value of values) {
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

function normalizeArtifactRefs(value, fallback = []) {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function resolveCloseoutLineage(truth = {}) {
  const mergeIntent = truth?.mergeIntent && typeof truth.mergeIntent === "object" ? truth.mergeIntent : {};
  const lineage =
    mergeIntent.deliveryReadyLineage && typeof mergeIntent.deliveryReadyLineage === "object"
      ? mergeIntent.deliveryReadyLineage
      : mergeIntent.lineage && typeof mergeIntent.lineage === "object"
        ? mergeIntent.lineage
        : {};

  const runId = pickOptionalString(lineage.runId, lineage.run_id, mergeIntent.runId, mergeIntent.run_id);
  const checkpointRef = pickOptionalString(
    lineage.checkpointRef,
    lineage.checkpoint_ref,
    lineage.checkpointId,
    lineage.checkpoint_id,
    mergeIntent.checkpointRef,
    mergeIntent.checkpoint_ref,
    mergeIntent.checkpointId,
    mergeIntent.checkpoint_id
  );
  const artifactRefs = normalizeArtifactRefs(
    lineage.artifactRefs ?? lineage.artifact_refs,
    normalizeArtifactRefs(mergeIntent.artifactRefs ?? mergeIntent.artifact_refs, truth?.stableArtifacts ?? [])
  );
  return {
    run_id: runId,
    checkpoint_ref: checkpointRef,
    artifact_refs: artifactRefs
  };
}

function normalizeIdList(source = [], key) {
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item[key];
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    })
    .filter(Boolean);
}

function buildMergeLifecycleEvidenceAnchor(input = {}) {
  return {
    source: "server_owned",
    merge_stage: pickOptionalString(input.mergeStage) ?? "not_started",
    delivery_state: input.deliveryState?.state ?? "not_started",
    pr_writeback_state: input.prWritebackState?.state ?? "not_started",
    closeout_lineage: deepClone(
      input.closeoutLineage ?? {
        run_id: null,
        checkpoint_ref: null,
        artifact_refs: []
      }
    ),
    pending_approval_ids: deepClone(input.pendingApprovalIds ?? []),
    open_conflict_ids: deepClone(input.openConflictIds ?? []),
    blocker_ids: deepClone(input.blockerIds ?? [])
  };
}

function buildCloseoutExplanation(input = {}) {
  const mergeStage = pickOptionalString(input.mergeStage) ?? "not_started";
  const deliveryState = input.deliveryState?.state ?? "not_started";
  const prWritebackState = input.prWritebackState?.state ?? "not_started";
  const pendingApprovalIds = Array.isArray(input.pendingApprovalIds) ? input.pendingApprovalIds : [];
  const openConflictIds = Array.isArray(input.openConflictIds) ? input.openConflictIds : [];
  const blockerIds = Array.isArray(input.blockerIds) ? input.blockerIds : [];
  const closeoutLineage = deepClone(
    input.closeoutLineage ?? {
      run_id: null,
      checkpoint_ref: null,
      artifact_refs: []
    }
  );

  let status = "in_progress";
  let reasonCode = "in_progress";
  let reasonDetail = "closeout is still progressing";

  if (deliveryState === "failed") {
    status = "failed";
    reasonCode = "delivery_failed";
    reasonDetail = "delivery state is failed";
  } else if (prWritebackState === "failed") {
    status = "failed";
    reasonCode = "pr_writeback_failed";
    reasonDetail = "pr writeback state is failed";
  } else if (blockerIds.some((item) => item.startsWith("approval_rejected:"))) {
    status = "failed";
    reasonCode = "approval_rejected";
    reasonDetail = "an approval hold was rejected";
  } else if (blockerIds.some((item) => item.startsWith("conflict_timeout:"))) {
    status = "failed";
    reasonCode = "conflict_timeout";
    reasonDetail = "an unresolved conflict escalated by timeout";
  } else if (openConflictIds.length > 0) {
    status = "waiting_gate";
    reasonCode = "unresolved_conflict";
    reasonDetail = "closeout is blocked by unresolved conflicts";
  } else if (pendingApprovalIds.length > 0 || mergeStage === "awaiting_merge_gate") {
    status = "waiting_gate";
    reasonCode = "pending_approval_gate";
    reasonDetail = "closeout is waiting for approval holds";
  } else if (deliveryState === "merged" || prWritebackState === "merged") {
    status = "closed";
    reasonCode = "closeout_merged";
    reasonDetail = "closeout reached merged state";
  } else if (mergeStage === "pr_ready" || deliveryState === "pr_ready" || prWritebackState === "pr_ready") {
    status = "closeout_ready";
    reasonCode = "closeout_ready";
    reasonDetail = "closeout is ready for downstream merge/writeback";
  }

  return {
    status,
    reason_code: reasonCode,
    reason_detail: reasonDetail,
    evidence_anchor: {
      source: "server_owned",
      merge_stage: mergeStage,
      delivery_state: deliveryState,
      pr_writeback_state: prWritebackState,
      closeout_lineage: closeoutLineage,
      pending_approval_ids: deepClone(pendingApprovalIds),
      open_conflict_ids: deepClone(openConflictIds),
      blocker_ids: deepClone(blockerIds)
    }
  };
}

function serializeTopicState(overview) {
  return {
    revision: overview.revision,
    merge_stage: deriveMergeStage(overview.truth),
    open_conflict_count: overview.openConflicts.length,
    pending_approval_count: overview.pendingApprovals.length,
    blocker_count: overview.blockers.length
  };
}

function serializeMergeLifecycle(overview) {
  const mergeStage = deriveMergeStage(overview.truth);
  const closeoutLineage = resolveCloseoutLineage(overview.truth);
  const pendingApprovalIds = normalizeIdList(overview.pendingApprovals, "holdId");
  const openConflictIds = normalizeIdList(overview.openConflicts, "conflictId");
  const blockerIds = normalizeIdList(overview.blockers, "blockerId");
  const evidenceAnchor = buildMergeLifecycleEvidenceAnchor({
    mergeStage,
    deliveryState: overview.truth.deliveryState,
    prWritebackState: overview.truth.prWriteback,
    closeoutLineage,
    pendingApprovalIds,
    openConflictIds,
    blockerIds
  });
  return {
    stage: mergeStage,
    merge_intent: deepClone(overview.truth.mergeIntent ?? null),
    delivery: serializeDeliveryState(overview.truth.deliveryState),
    pr_writeback: serializeDeliveryState(overview.truth.prWriteback),
    closeout_lineage: closeoutLineage,
    pending_approval_count: overview.pendingApprovals.length,
    evidence_anchor: evidenceAnchor,
    closeout_explanation: buildCloseoutExplanation({
      mergeStage,
      deliveryState: overview.truth.deliveryState,
      prWritebackState: overview.truth.prWriteback,
      closeoutLineage,
      pendingApprovalIds,
      openConflictIds,
      blockerIds
    })
  };
}

function serializeTopicOverview(overview) {
  return {
    topic_id: overview.topicId,
    revision: overview.revision,
    goal: overview.truth.goal,
    constraints: deepClone(overview.truth.constraints ?? []),
    topic_state: serializeTopicState(overview),
    task_allocation: deepClone(overview.truth.taskAllocation ?? []),
    merge_lifecycle: serializeMergeLifecycle(overview),
    delivery_state: serializeDeliveryState(overview.truth.deliveryState),
    open_conflicts: overview.openConflicts.map((conflict) => serializeConflictResource(conflict)),
    pending_approvals: overview.pendingApprovals.map((hold) => serializeApprovalHoldResource(hold)),
    blockers: deepClone(overview.blockers),
    actor_registry: overview.agents.map((agent) => serializeActor(agent)),
    agents: overview.agents.map((agent) => serializeActor(agent)),
    updated_at: overview.updatedAt
  };
}

function serializeTopicSummary(summary) {
  const mergeStage = deriveMergeStage({
    mergeIntent: summary.mergeIntent,
    deliveryState: summary.deliveryState
  });
  const closeoutLineage = resolveCloseoutLineage({
    mergeIntent: summary.mergeIntent,
    stableArtifacts: summary.stableArtifacts ?? []
  });
  const evidenceAnchor = buildMergeLifecycleEvidenceAnchor({
    mergeStage,
    deliveryState: summary.deliveryState,
    prWritebackState: summary.prWriteback,
    closeoutLineage,
    pendingApprovalIds: [],
    openConflictIds: [],
    blockerIds: []
  });
  return {
    topic_id: summary.topicId,
    revision: summary.revision,
    goal: summary.goal,
    constraints: deepClone(summary.constraints ?? []),
    topic_state: {
      revision: summary.revision,
      merge_stage: mergeStage,
      actor_count: summary.actorCount ?? 0
    },
    task_allocation_count: Array.isArray(summary.taskAllocation) ? summary.taskAllocation.length : 0,
    merge_lifecycle: {
      stage: mergeStage,
      merge_intent: deepClone(summary.mergeIntent ?? null),
      delivery: serializeDeliveryState(summary.deliveryState),
      pr_writeback: serializeDeliveryState(summary.prWriteback),
      closeout_lineage: closeoutLineage,
      evidence_anchor: evidenceAnchor,
      closeout_explanation: buildCloseoutExplanation({
        mergeStage,
        deliveryState: summary.deliveryState,
        prWritebackState: summary.prWriteback,
        closeoutLineage,
        pendingApprovalIds: [],
        openConflictIds: [],
        blockerIds: []
      })
    },
    delivery_state: serializeDeliveryState(summary.deliveryState),
    updated_at: summary.updatedAt
  };
}

function serializeCoarseReadModel(model) {
  return {
    topic_id: model.topicId,
    revision: model.revision,
    active_actors: deepClone(model.activeAgents),
    blocked_actors: deepClone(model.blockedAgents),
    open_conflict_count: model.openConflictCount,
    pending_approval_count: model.pendingApprovalCount,
    blocker_count: model.blockerCount,
    risk_flags: deepClone(model.riskFlags),
    delivery_state: serializeDeliveryState(model.deliveryState),
    updated_at: model.updatedAt
  };
}

function serializeDispatchResource(dispatch) {
  return {
    dispatch_id: dispatch.dispatchId,
    worker_actor_id: dispatch.workerAgentId,
    status: dispatch.status,
    created_at: dispatch.createdAt,
    accepted_at: dispatch.acceptedAt ?? null
  };
}

function serializeConflictResource(conflict) {
  const resolved = conflict.resolution && typeof conflict.resolution === "object" ? conflict.resolution : null;
  return {
    conflict_id: conflict.conflictId,
    related_command_id: conflict.challengeMessageId,
    status: conflict.status,
    scopes: deepClone(conflict.scopes ?? []),
    created_at: conflict.createdAt,
    escalated_at: conflict.escalatedAt ?? null,
    resolution: conflict.resolution ?? null,
    failure_reason: conflict.status === "unresolved" ? "unresolved_conflict" : null,
    evidence_anchor: {
      source: "server_owned",
      opened_by_command_id: conflict.challengeMessageId ?? null,
      resolution_command_id: resolved?.messageId ?? null,
      resolution_outcome: resolved?.outcome ?? null,
      resolution_at: resolved?.at ?? null
    }
  };
}

function serializeApprovalHoldResource(hold) {
  return {
    hold_id: hold.holdId,
    gate: hold.gate,
    status: hold.status,
    related_command_id: hold.messageId,
    decider_actor_id: hold.decider ?? null,
    created_at: hold.createdAt,
    decided_at: hold.decidedAt,
    failure_reason: hold.status === "rejected" ? "approval_rejected" : null,
    evidence_anchor: {
      source: "server_owned",
      gate: hold.gate,
      opened_by_command_id: hold.messageId ?? null,
      decision_status: hold.status,
      decider_actor_id: hold.decider ?? null,
      decided_at: hold.decidedAt ?? null
    }
  };
}

function serializeDecisionResource(decision) {
  return {
    decision_id: decision.decisionId,
    hold_id: decision.holdId,
    status: decision.status,
    decider_actor_id: decision.decider,
    gate: decision.gate,
    decided_at: decision.decidedAt,
    failure_reason: decision.status === "rejected" ? "approval_rejected" : null,
    evidence_anchor: {
      source: "server_owned",
      hold_id: decision.holdId,
      gate: decision.gate,
      decision_status: decision.status,
      decider_actor_id: decision.decider,
      decided_at: decision.decidedAt ?? null
    }
  };
}

function serializeDeliveryResource(delivery, input = {}) {
  const mergeLifecycleStage = typeof input.mergeLifecycleStage === "string" ? input.mergeLifecycleStage : null;
  const closeoutLineage =
    input.closeoutLineage && typeof input.closeoutLineage === "object"
      ? deepClone(input.closeoutLineage)
      : {
          run_id: null,
          checkpoint_ref: null,
          artifact_refs: []
        };
  const deliveryState = {
    state: delivery.state,
    prUrl: delivery.prUrl ?? null
  };
  const prWritebackState =
    input.prWritebackState && typeof input.prWritebackState === "object"
      ? input.prWritebackState
      : {
          state: "not_started",
          prUrl: null
        };
  const evidenceAnchor =
    input.evidenceAnchor && typeof input.evidenceAnchor === "object"
      ? deepClone(input.evidenceAnchor)
      : buildMergeLifecycleEvidenceAnchor({
          mergeStage: mergeLifecycleStage,
          deliveryState,
          prWritebackState,
          closeoutLineage,
          pendingApprovalIds: [],
          openConflictIds: [],
          blockerIds: []
        });
  const closeoutExplanation =
    input.closeoutExplanation && typeof input.closeoutExplanation === "object"
      ? deepClone(input.closeoutExplanation)
      : buildCloseoutExplanation({
          mergeStage: mergeLifecycleStage,
          deliveryState,
          prWritebackState,
          closeoutLineage,
          pendingApprovalIds: [],
          openConflictIds: [],
          blockerIds: []
        });
  return {
    state: delivery.state,
    pr_url: delivery.prUrl ?? null,
    last_updated_at: delivery.lastUpdatedAt,
    merge_lifecycle_stage: mergeLifecycleStage,
    closeout_lineage: closeoutLineage,
    evidence_anchor: evidenceAnchor,
    closeout_explanation: closeoutExplanation
  };
}

function resolveSourceActorRole(coordinator, topicId, sourceActorId, input = {}) {
  const actor = coordinator.resolveWriteActor(topicId, {
    agentId: sourceActorId,
    codePrefix: input.codePrefix ?? "actor",
    expectedRole: input.expectedRole,
    allowedRoles: input.allowedRoles
  });
  return actor.role;
}

function readCorrelationId(request, body = {}) {
  const headerCorrelation = getSingleHeader(request, "x-correlation-id");
  if (typeof headerCorrelation === "string" && headerCorrelation.trim().length > 0) {
    return headerCorrelation.trim();
  }
  if (typeof body.correlation_id === "string" && body.correlation_id.trim().length > 0) {
    return body.correlation_id.trim();
  }
  return null;
}

function classifyCoordinatorError(error) {
  const code = error.code ?? "internal_error";

  if (code === "internal_error") {
    return { family: "internal_failure", statusCode: 500, retryable: true };
  }

  if (code.includes("not_found")) {
    return { family: "not_found", statusCode: 404, retryable: false };
  }

  if (
    code === "topic_exists" ||
    code === "stale_revision" ||
    code === "hold_finalized" ||
    code === "conflict_already_closed" ||
    code === "idempotency_key_conflict"
  ) {
    return { family: "state_conflict", statusCode: 409, retryable: false };
  }

  if (
    code === "invalid_json" ||
    code === "bad_request" ||
    code.startsWith("invalid_") ||
    code === "idempotency_key_required" ||
    code.startsWith("idempotency_key_") ||
    code === "invalid_event_type" ||
    code === "invalid_debug_view" ||
    code.startsWith("runtime_daemon_event_") ||
    code.startsWith("runtime_fixture_")
  ) {
    return { family: "invalid_input", statusCode: 400, retryable: false };
  }

  return { family: "boundary_rejection", statusCode: 422, retryable: false };
}

function buildV1Error(error, context = {}) {
  const code = error instanceof CoordinatorError ? error.code : "internal_error";
  const message = error instanceof CoordinatorError ? error.message : error?.message ?? "unknown error";
  const details = error instanceof CoordinatorError ? error.details ?? {} : {};

  const classified = classifyCoordinatorError({ code });
  return {
    statusCode: classified.statusCode,
    payload: {
      error: {
        code,
        family: classified.family,
        message,
        details,
        retryable: classified.retryable,
        request_id: context.requestId,
        correlation_id: context.correlationId ?? null,
        related_command_id: context.relatedCommandId ?? null
      }
    }
  };
}

function buildIdempotencyFingerprint(body) {
  return JSON.stringify(body ?? {});
}

function parseOptionalTruthRevision(body) {
  if (body?.truth_revision === undefined || body?.truth_revision === null) {
    return null;
  }
  const revision = Number(body.truth_revision);
  if (!Number.isFinite(revision) || !Number.isInteger(revision) || revision < 1) {
    throw new CoordinatorError("invalid_truth_revision", "truth_revision must be a positive integer when provided");
  }
  body.truth_revision = revision;
  return revision;
}

function assertWriteRevision(coordinator, topicId, truthRevision) {
  if (truthRevision === null) {
    return null;
  }
  const current = coordinator.getTopicOverview(topicId).revision;
  if (truthRevision !== current) {
    throw new CoordinatorError("stale_revision", "write uses stale truth revision", {
      expectedRevision: current,
      gotRevision: truthRevision
    });
  }
  return current;
}

export function createHttpServer(coordinator, options = {}) {
  const fixtureFromEnv = {
    topicId: process.env.RUNTIME_SAMPLE_TOPIC_ID,
    goal: process.env.RUNTIME_SAMPLE_TOPIC_GOAL,
    leadAgentId: process.env.RUNTIME_SAMPLE_LEAD_AGENT_ID,
    workerAgentIds: parseWorkerAgentIds(process.env.RUNTIME_SAMPLE_WORKER_AGENT_IDS)
  };

  const runtimeConfig = buildRuntimeConfig({
    runtimeName: options.runtimeName ?? process.env.RUNTIME_NAME ?? undefined,
    serverPort: options.serverPort ?? parsePort(process.env.PORT),
    shellUrl: options.shellUrl ?? process.env.RUNTIME_SHELL_URL ?? null,
    daemonName: options.daemonName ?? process.env.RUNTIME_DAEMON_NAME ?? "openshock-daemon",
    fixture: {
      ...fixtureFromEnv,
      ...(options.fixture ?? {})
    }
  });

  const idempotencyStore = new Map();
  const controlEventsByTopic = new Map();
  const snapshotsByTopic = new Map();

  function getTopicEvents(topicId) {
    if (!controlEventsByTopic.has(topicId)) {
      controlEventsByTopic.set(topicId, []);
    }
    return controlEventsByTopic.get(topicId);
  }

  function getTopicSnapshots(topicId) {
    if (!snapshotsByTopic.has(topicId)) {
      snapshotsByTopic.set(topicId, []);
    }
    return snapshotsByTopic.get(topicId);
  }

  function appendControlEvent(topicId, eventInput) {
    if (!CONTROL_EVENT_TYPES.has(eventInput.event_type)) {
      throw new CoordinatorError("invalid_event_type", `unsupported event_type: ${eventInput.event_type}`);
    }
    const record = {
      event_id: eventInput.event_id ?? generateId("evt"),
      topic_id: topicId,
      event_type: eventInput.event_type,
      related_command_id: eventInput.related_command_id ?? null,
      related_resource_type: eventInput.related_resource_type ?? null,
      related_resource_id: eventInput.related_resource_id ?? null,
      result_state: eventInput.result_state ?? null,
      reason_code: eventInput.reason_code ?? null,
      reason_detail: eventInput.reason_detail ?? null,
      request_id: eventInput.request_id,
      correlation_id: eventInput.correlation_id ?? null,
      at: eventInput.at ?? nowIso()
    };
    if (eventInput.details !== undefined) {
      record.details = deepClone(eventInput.details);
    }

    getTopicEvents(topicId).push(record);
    return record;
  }

  function appendTopicSnapshot(topicId, context = {}) {
    const overview = coordinator.getTopicOverview(topicId);
    const snapshot = {
      snapshot_id: generateId("snapshot"),
      topic_id: topicId,
      snapshot_revision: overview.revision,
      request_id: context.requestId,
      correlation_id: context.correlationId ?? null,
      source_event_id: context.sourceEventId ?? null,
      at: nowIso(),
      projection: serializeTopicOverview(overview)
    };
    getTopicSnapshots(topicId).push(snapshot);
    return snapshot;
  }

  function ensureTopicExists(topicId) {
    coordinator.getTopicOverview(topicId);
  }

  function requireIdempotency(route, pathName, request, body) {
    if (!IDEMPOTENCY_REQUIRED_ROUTES.has(route)) {
      return null;
    }

    const rawKey = getSingleHeader(request, "idempotency-key");
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (key.length === 0) {
      throw new CoordinatorError("idempotency_key_required", "Idempotency-Key header is required");
    }

    const fingerprint = buildIdempotencyFingerprint(body);
    const storeKey = `${route}:${pathName}:${key}`;
    const existing = idempotencyStore.get(storeKey);
    if (!existing) {
      return {
        replay: null,
        storeKey,
        fingerprint
      };
    }

    if (existing.fingerprint !== fingerprint) {
      throw new CoordinatorError(
        "idempotency_key_conflict",
        "Idempotency-Key reuse with different payload is not allowed"
      );
    }

    return {
      replay: {
        statusCode: existing.statusCode,
        payload: deepClone(existing.payload)
      },
      storeKey,
      fingerprint
    };
  }

  function storeIdempotencyResult(context, statusCode, payload) {
    if (!context || !context.storeKey) {
      return;
    }
    idempotencyStore.set(context.storeKey, {
      fingerprint: context.fingerprint,
      statusCode,
      payload: deepClone(payload)
    });
  }

  function buildCommandIntent(body, topicId, commandId, sourceRole) {
    return {
      messageId: commandId,
      type: body.command_type,
      sourceAgentId: body.source_actor_id,
      sourceRole,
      targetScope: body.target_scope ?? "topic",
      laneId: body.lane_id ?? null,
      runId: body.run_id ?? null,
      truthRevision: body.truth_revision === undefined ? null : body.truth_revision,
      referencedArtifacts: Array.isArray(body.referenced_artifacts) ? body.referenced_artifacts : [],
      payload: body.payload ?? {},
      topicId
    };
  }

  function validateCommandIntentBody(body) {
    assertObjectBody(body, "invalid_command_intent", "command intent payload must be a JSON object");
    for (const key of Object.keys(body)) {
      if (!COMMAND_INTENT_ALLOWED_FIELDS.has(key)) {
        throw new CoordinatorError("invalid_command_field", `unsupported command field: ${key}`);
      }
    }
    if (typeof body.command_type !== "string" || !MESSAGE_TYPES.has(body.command_type)) {
      throw new CoordinatorError("invalid_command_type", "command_type must be a supported command enum");
    }
    if (typeof body.source_actor_id !== "string" || body.source_actor_id.trim().length === 0) {
      throw new CoordinatorError("invalid_command_source_actor", "source_actor_id is required");
    }
    if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) {
      throw new CoordinatorError("invalid_command_payload", "payload must be an object");
    }
    parseOptionalTruthRevision(body);
    if (
      body.referenced_artifacts !== undefined &&
      (!Array.isArray(body.referenced_artifacts) ||
        body.referenced_artifacts.some((artifact) => typeof artifact !== "string"))
    ) {
      throw new CoordinatorError("invalid_referenced_artifacts", "referenced_artifacts must be string[]");
    }
  }

  return http.createServer(async (request, response) => {
    let route = null;
    const requestId = generateId("req");
    let correlationId = null;
    let relatedCommandId = null;

    try {
      if (!request.url || !request.method) {
        throw new CoordinatorError("bad_request", "request must include method and url");
      }

      const parsedUrl = new URL(request.url, "http://localhost");
      route = matchRoute(request.method, parsedUrl.pathname);
      if (!route) {
        if (parsedUrl.pathname.startsWith("/v1/")) {
          const notFound = buildV1Error(new CoordinatorError("route_not_found", "route not found"), {
            requestId,
            correlationId,
            relatedCommandId
          });
          sendJson(response, notFound.statusCode, notFound.payload);
          return;
        }
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      if (route.route === "GET_HEALTH") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (route.route === "GET_RUNTIME_CONFIG") {
        sendJson(response, 200, runtimeConfig);
        return;
      }

      if (route.route === "POST_RUNTIME_FIXTURE_SEED") {
        const body = await readJsonBody(request);
        assertObjectBody(
          body,
          "invalid_runtime_fixture_seed_payload",
          "runtime fixture seed payload must be a JSON object"
        );
        if (Object.keys(body).length > 0) {
          throw new CoordinatorError(
            "runtime_fixture_override_forbidden",
            "runtime fixture seed does not accept request overrides"
          );
        }
        const result = seedSampleFixture(coordinator, runtimeConfig.sampleFixture);
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "POST_RUNTIME_DAEMON_EVENT") {
        const body = await readJsonBody(request);
        assertObjectBody(
          body,
          "invalid_runtime_daemon_event_payload",
          "runtime daemon event payload must be a JSON object"
        );
        for (const field of Object.keys(body)) {
          if (!RUNTIME_DAEMON_ALLOWED_FIELDS.has(field)) {
            throw new CoordinatorError(
              "runtime_daemon_event_field_forbidden",
              `runtime daemon event does not allow field: ${field}`
            );
          }
        }
        if (typeof body.topicId !== "string" || body.topicId.trim().length === 0) {
          throw new CoordinatorError(
            "runtime_daemon_event_topic_required",
            "runtime daemon event requires topicId"
          );
        }
        if (typeof body.type !== "string" || !RUNTIME_DAEMON_EVENT_TYPES.has(body.type)) {
          throw new CoordinatorError(
            "runtime_daemon_event_type_not_allowed",
            "runtime daemon event type must be one of feedback_ingest/blocker_escalation/status_report"
          );
        }
        coordinator.registerAgent(body.topicId, {
          agentId: runtimeConfig.daemonName,
          role: "system",
          status: "active"
        });
        const result = coordinator.ingestMessage(body.topicId, {
          type: body.type,
          sourceAgentId: runtimeConfig.daemonName,
          sourceRole: "system",
          targetScope: "topic",
          laneId: body.laneId ?? null,
          runId: body.runId ?? null,
          truthRevision: null,
          referencedArtifacts: [],
          payload: body.payload ?? {}
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "GET_RUNTIME_SMOKE") {
        let sampleTopicReady = false;
        let sampleTopicAgentCount = 0;
        try {
          const overview = coordinator.getTopicOverview(runtimeConfig.sampleFixture.topicId);
          sampleTopicReady = true;
          sampleTopicAgentCount = overview.agents.length;
        } catch (error) {
          if (!(error instanceof CoordinatorError) || error.code !== "topic_not_found") {
            throw error;
          }
        }
        sendJson(response, 200, {
          ok: true,
          runtime: runtimeConfig.runtimeName,
          serverReachable: true,
          sampleTopicId: runtimeConfig.sampleFixture.topicId,
          sampleTopicReady,
          sampleTopicAgentCount
        });
        return;
      }

      if (route.route === "POST_TOPICS") {
        const body = await readJsonBody(request);
        const topic = coordinator.createTopic(body);
        sendJson(response, 201, topic);
        return;
      }

      if (route.route === "POST_TOPIC_AGENT") {
        const body = await readJsonBody(request);
        const topic = coordinator.registerAgent(route.topicId, body);
        sendJson(response, 200, topic);
        return;
      }

      if (route.route === "POST_TOPIC_MESSAGE" || route.route === "V1_POST_TOPIC_MESSAGE") {
        const body = await readJsonBody(request);
        const result = coordinator.ingestMessage(route.topicId, body);
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "POST_APPROVAL_DECISION_LEGACY") {
        const body = await readJsonBody(request);
        const result = coordinator.applyHumanDecision(route.topicId, route.holdId, body);
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "GET_TOPIC_OVERVIEW") {
        const result = coordinator.getTopicOverview(route.topicId);
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "GET_TOPIC_COARSE") {
        const result = coordinator.getCoarseObservability(route.topicId);
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "GET_TOPIC_MESSAGES" || route.route === "V1_GET_TOPIC_MESSAGES") {
        const routingScope = parsedUrl.searchParams.get("route");
        const result = coordinator.listMessages(route.topicId, { route: routingScope });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_POST_TOPICS") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_topic_payload", "topic payload must be a JSON object");
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        if (typeof body.topic_id !== "string" || body.topic_id.trim().length === 0) {
          throw new CoordinatorError("invalid_topic_id", "topic_id is required");
        }
        if (typeof body.goal !== "string" || body.goal.trim().length === 0) {
          throw new CoordinatorError("invalid_topic_goal", "goal is required");
        }
        if (body.constraints !== undefined && !Array.isArray(body.constraints)) {
          throw new CoordinatorError("invalid_topic_constraints", "constraints must be an array when provided");
        }

        const overview = coordinator.createTopic({
          topicId: body.topic_id,
          goal: body.goal,
          constraints: body.constraints
        });

        const event = appendControlEvent(body.topic_id, {
          event_type: "topic_created",
          related_resource_type: "topic",
          related_resource_id: body.topic_id,
          result_state: "accepted",
          request_id: requestId,
          correlation_id: correlationId
        });
        appendTopicSnapshot(body.topic_id, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });

        const payload = {
          topic: serializeTopicOverview(overview),
          request_id: requestId,
          correlation_id: correlationId,
          event_id: event.event_id
        };
        storeIdempotencyResult(idempotency, 201, payload);
        sendJson(response, 201, payload);
        return;
      }

      if (route.route === "V1_GET_TOPICS") {
        const topics = coordinator.listTopics().map((item) => serializeTopicSummary(item));
        const page = paginate(topics, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: "topics"
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC") {
        const overview = coordinator.getTopicOverview(route.topicId);
        sendJson(response, 200, {
          topic: serializeTopicOverview(overview),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_ACTORS") {
        const actors = coordinator.listActors(route.topicId).map((agent) => serializeActor(agent));
        const page = paginate(actors, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: `topic:${route.topicId}:actors`
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_ACTOR") {
        const actor = coordinator.getActor(route.topicId, route.actorId);
        sendJson(response, 200, {
          actor: serializeActor(actor),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_STATE_GRAPH") {
        ensureTopicExists(route.topicId);
        sendJson(response, 200, {
          state_graph: coordinator.getResourceStateGraph(),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_DISPATCHES") {
        const dispatches = coordinator
          .listDispatches(route.topicId, { status: parsedUrl.searchParams.get("status") })
          .map((dispatch) => serializeDispatchResource(dispatch));
        const page = paginate(dispatches, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: `topic:${route.topicId}:dispatches:${parsedUrl.searchParams.get("status") ?? "all"}`
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_DISPATCH") {
        const dispatch = coordinator.getDispatch(route.topicId, route.dispatchId);
        sendJson(response, 200, {
          dispatch: serializeDispatchResource(dispatch),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_TOPIC_DISPATCH") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_dispatch_payload", "dispatch payload must be a JSON object");
        const truthRevision = parseOptionalTruthRevision(body);
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        if (typeof body.source_actor_id !== "string" || body.source_actor_id.trim().length === 0) {
          throw new CoordinatorError("invalid_dispatch_source_actor", "source_actor_id is required");
        }
        if (typeof body.worker_actor_id !== "string" || body.worker_actor_id.trim().length === 0) {
          throw new CoordinatorError("invalid_dispatch_worker_actor", "worker_actor_id is required");
        }
        if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) {
          throw new CoordinatorError("invalid_dispatch_payload_shape", "payload must be an object");
        }

        relatedCommandId =
          typeof body.dispatch_id === "string" && body.dispatch_id.trim().length > 0
            ? body.dispatch_id.trim()
            : generateId("dispatch");

        try {
          assertWriteRevision(coordinator, route.topicId, truthRevision);
          const sourceRole = resolveSourceActorRole(coordinator, route.topicId, body.source_actor_id);
          coordinator.ingestMessage(route.topicId, {
            messageId: relatedCommandId,
            type: "dispatch",
            sourceAgentId: body.source_actor_id,
            sourceRole,
            payload: {
              ...(body.payload ?? {}),
              workerAgentId: body.worker_actor_id
            }
          });
        } catch (error) {
          if (error instanceof CoordinatorError) {
            appendControlEvent(route.topicId, {
              event_type: "dispatch_rejected",
              related_command_id: relatedCommandId,
              related_resource_type: "dispatch",
              related_resource_id: relatedCommandId,
              result_state: "rejected",
              reason_code: error.code,
              reason_detail: error.message,
              request_id: requestId,
              correlation_id: correlationId
            });
          }
          throw error;
        }

        const event = appendControlEvent(route.topicId, {
          event_type: "dispatch_created",
          related_command_id: relatedCommandId,
          related_resource_type: "dispatch",
          related_resource_id: relatedCommandId,
          result_state: "pending_accept",
          request_id: requestId,
          correlation_id: correlationId
        });
        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });

        const payload = {
          dispatch: serializeDispatchResource(coordinator.getDispatch(route.topicId, relatedCommandId)),
          revision: coordinator.getTopicOverview(route.topicId).revision,
          event_id: event.event_id,
          request_id: requestId,
          correlation_id: correlationId
        };
        storeIdempotencyResult(idempotency, 202, payload);
        sendJson(response, 202, payload);
        return;
      }

      if (route.route === "V1_GET_TOPIC_CONFLICTS") {
        const conflicts = coordinator
          .listConflicts(route.topicId, { status: parsedUrl.searchParams.get("status") })
          .map((conflict) => serializeConflictResource(conflict));
        const page = paginate(conflicts, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: `topic:${route.topicId}:conflicts:${parsedUrl.searchParams.get("status") ?? "all"}`
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_CONFLICT") {
        const conflict = coordinator.getConflict(route.topicId, route.conflictId);
        sendJson(response, 200, {
          conflict: serializeConflictResource(conflict),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CONFLICT_RESOLUTION") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_conflict_resolution_payload", "conflict resolution payload must be a JSON object");
        const truthRevision = parseOptionalTruthRevision(body);
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        if (typeof body.source_actor_id !== "string" || body.source_actor_id.trim().length === 0) {
          throw new CoordinatorError("invalid_conflict_resolution_actor", "source_actor_id is required");
        }
        if (typeof body.outcome !== "string" || body.outcome.trim().length === 0) {
          throw new CoordinatorError("invalid_conflict_resolution_outcome", "outcome is required");
        }

        const resolutionCommandId = generateId("resolve");
        relatedCommandId = resolutionCommandId;
        try {
          assertWriteRevision(coordinator, route.topicId, truthRevision);
          const sourceRole = resolveSourceActorRole(coordinator, route.topicId, body.source_actor_id);
          coordinator.ingestMessage(route.topicId, {
            messageId: resolutionCommandId,
            type: "conflict_resolution",
            sourceAgentId: body.source_actor_id,
            sourceRole,
            payload: {
              conflictId: route.conflictId,
              outcome: body.outcome,
              notes: body.notes ?? null
            }
          });
        } catch (error) {
          if (error instanceof CoordinatorError) {
            appendControlEvent(route.topicId, {
              event_type: "conflict_resolution_rejected",
              related_command_id: resolutionCommandId,
              related_resource_type: "conflict",
              related_resource_id: route.conflictId,
              result_state: "rejected",
              reason_code: error.code,
              reason_detail: error.message,
              request_id: requestId,
              correlation_id: correlationId
            });
          }
          throw error;
        }

        const conflict = coordinator.getConflict(route.topicId, route.conflictId);
        const event = appendControlEvent(route.topicId, {
          event_type: "conflict_resolved",
          related_command_id: resolutionCommandId,
          related_resource_type: "conflict",
          related_resource_id: route.conflictId,
          result_state: conflict.status,
          request_id: requestId,
          correlation_id: correlationId
        });
        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });

        const payload = {
          conflict: serializeConflictResource(conflict),
          revision: coordinator.getTopicOverview(route.topicId).revision,
          event_id: event.event_id,
          request_id: requestId,
          correlation_id: correlationId
        };
        storeIdempotencyResult(idempotency, 200, payload);
        sendJson(response, 200, payload);
        return;
      }

      if (route.route === "V1_GET_APPROVAL_HOLDS") {
        const holds = coordinator
          .listApprovalHolds(route.topicId, { status: parsedUrl.searchParams.get("status") })
          .map((hold) => serializeApprovalHoldResource(hold));
        const page = paginate(holds, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: `topic:${route.topicId}:approval_holds:${parsedUrl.searchParams.get("status") ?? "all"}`
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_APPROVAL_HOLD") {
        const hold = coordinator.getApprovalHold(route.topicId, route.holdId);
        sendJson(response, 200, {
          hold: serializeApprovalHoldResource(hold),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_APPROVAL_DECISIONS") {
        const decisions = coordinator
          .getTopicOverview(route.topicId)
          .approvalDecisions.filter((decision) => decision.holdId === route.holdId)
          .map((decision) => serializeDecisionResource(decision));
        sendJson(response, 200, {
          items: decisions,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_TOPIC_ACTOR") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_actor_payload", "actor payload must be a JSON object");
        if (typeof body.role !== "string" || body.role.trim().length === 0) {
          throw new CoordinatorError("invalid_actor_role", "role is required");
        }

        const overview = coordinator.registerAgent(route.topicId, {
          agentId: route.actorId,
          role: body.role,
          status: body.status,
          laneId: body.lane_id ?? null
        });
        const actor = overview.agents.find((item) => item.agentId === route.actorId);

        const event = appendControlEvent(route.topicId, {
          event_type: "actor_upserted",
          related_resource_type: "actor",
          related_resource_id: route.actorId,
          result_state: "accepted",
          request_id: requestId,
          correlation_id: correlationId
        });
        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });

        sendJson(response, 200, {
          actor: actor ? serializeActor(actor) : null,
          request_id: requestId,
          correlation_id: correlationId,
          event_id: event.event_id
        });
        return;
      }

      if (route.route === "V1_POST_TOPIC_COMMAND") {
        const body = await readJsonBody(request);
        validateCommandIntentBody(body);
        correlationId = readCorrelationId(request, body);
        const truthRevision = body.truth_revision === undefined ? null : body.truth_revision;
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        relatedCommandId =
          typeof body.command_id === "string" && body.command_id.trim().length > 0
            ? body.command_id.trim()
            : generateId("cmd");

        let ingestResult;
        try {
          assertWriteRevision(coordinator, route.topicId, truthRevision);
          const sourceRole = resolveSourceActorRole(coordinator, route.topicId, body.source_actor_id);
          const commandIntent = buildCommandIntent(body, route.topicId, relatedCommandId, sourceRole);
          ingestResult = coordinator.ingestMessage(route.topicId, commandIntent);
        } catch (error) {
          if (error instanceof CoordinatorError) {
            appendControlEvent(route.topicId, {
              event_type: "command_rejected",
              related_command_id: relatedCommandId,
              related_resource_type: "command_intent",
              related_resource_id: relatedCommandId,
              result_state: "rejected",
              reason_code: error.code,
              reason_detail: error.message,
              request_id: requestId,
              correlation_id: correlationId
            });
          }
          throw error;
        }

        const accepted = appendControlEvent(route.topicId, {
          event_type: "command_accepted",
          related_command_id: relatedCommandId,
          related_resource_type: "command_intent",
          related_resource_id: relatedCommandId,
          result_state: ingestResult.state,
          request_id: requestId,
          correlation_id: correlationId
        });

        if (Array.isArray(ingestResult?.result?.holdIds)) {
          for (const holdId of ingestResult.result.holdIds) {
            appendControlEvent(route.topicId, {
              event_type: "hold_created",
              related_command_id: relatedCommandId,
              related_resource_type: "approval_hold",
              related_resource_id: holdId,
              result_state: "pending",
              request_id: requestId,
              correlation_id: correlationId
            });
          }
        }

        if (ingestResult?.result?.conflictId) {
          appendControlEvent(route.topicId, {
            event_type: "conflict_opened",
            related_command_id: relatedCommandId,
            related_resource_type: "conflict",
            related_resource_id: ingestResult.result.conflictId,
            result_state: "unresolved",
            request_id: requestId,
            correlation_id: correlationId
          });
        }

        if (ingestResult?.result?.blockerId) {
          appendControlEvent(route.topicId, {
            event_type: "blocker_added",
            related_command_id: relatedCommandId,
            related_resource_type: "blocker",
            related_resource_id: ingestResult.result.blockerId,
            result_state: "accepted",
            request_id: requestId,
            correlation_id: correlationId
          });
        }

        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: accepted.event_id
        });

        const payload = {
          command_intent: {
            command_id: relatedCommandId,
            topic_id: route.topicId,
            command_type: body.command_type,
            source_actor_id: body.source_actor_id,
            payload: deepClone(body.payload ?? {}),
            requested_at: nowIso()
          },
          outcome: {
            state: ingestResult.state,
            result: deepClone(ingestResult.result),
            revision: ingestResult.revision,
            updated_at: ingestResult.updatedAt
          },
          event_id: accepted.event_id,
          request_id: requestId,
          correlation_id: correlationId
        };
        storeIdempotencyResult(idempotency, 202, payload);
        sendJson(response, 202, payload);
        return;
      }

      if (route.route === "V1_GET_TOPIC_EVENTS") {
        const result = coordinator.listTopicEventProjection(route.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_POST_APPROVAL_DECISION") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_decision_payload", "decision payload must be a JSON object");
        const truthRevision = parseOptionalTruthRevision(body);
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        if (typeof body.decider_actor_id !== "string" || body.decider_actor_id.trim().length === 0) {
          throw new CoordinatorError("invalid_decider_actor", "decider_actor_id is required");
        }
        const interventionPoint =
          typeof body.intervention_point === "string" && body.intervention_point.trim().length > 0
            ? body.intervention_point.trim()
            : typeof body.intervention_id === "string" && body.intervention_id.trim().length > 0
              ? body.intervention_id.trim()
              : null;
        if (!interventionPoint) {
          throw new CoordinatorError("invalid_intervention_point", "intervention_point is required");
        }
        if (typeof body.approve !== "boolean") {
          throw new CoordinatorError("invalid_decision_approve", "approve must be boolean");
        }

        let decisionResult;
        try {
          assertWriteRevision(coordinator, route.topicId, truthRevision);
          decisionResult = coordinator.applyHumanDecision(route.topicId, route.holdId, {
            decider: body.decider_actor_id,
            interventionId: interventionPoint,
            approve: body.approve
          });
        } catch (error) {
          if (error instanceof CoordinatorError) {
            appendControlEvent(route.topicId, {
              event_type: "hold_decision_rejected",
              related_resource_type: "approval_hold",
              related_resource_id: route.holdId,
              reason_code: error.code,
              reason_detail: error.message,
              request_id: requestId,
              correlation_id: correlationId
            });
          }
          throw error;
        }

        const event = appendControlEvent(route.topicId, {
          event_type: "hold_decided",
          related_command_id: decisionResult.messageId ?? null,
          related_resource_type: "approval_hold",
          related_resource_id: route.holdId,
          result_state: decisionResult.status,
          request_id: requestId,
          correlation_id: correlationId
        });

        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });

        const payload = {
          decision: {
            hold_id: decisionResult.holdId,
            status: decisionResult.status,
            related_command_id: decisionResult.messageId,
            message_state: decisionResult.messageState,
            revision: decisionResult.revision
          },
          revision: coordinator.getTopicOverview(route.topicId).revision,
          event_id: event.event_id,
          request_id: requestId,
          correlation_id: correlationId
        };
        storeIdempotencyResult(idempotency, 200, payload);
        sendJson(response, 200, payload);
        return;
      }

      if (route.route === "V1_GET_TOPIC_COARSE") {
        const coarse = coordinator.getCoarseObservability(route.topicId);
        sendJson(response, 200, {
          coarse: serializeCoarseReadModel(coarse),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_DELIVERY") {
        const overview = coordinator.getTopicOverview(route.topicId);
        const delivery = overview.truth.deliveryState;
        const mergeLifecycle = serializeMergeLifecycle(overview);
        sendJson(response, 200, {
          delivery: serializeDeliveryResource(delivery, {
            mergeLifecycleStage: mergeLifecycle.stage,
            closeoutLineage: mergeLifecycle.closeout_lineage,
            prWritebackState: overview.truth.prWriteback,
            evidenceAnchor: mergeLifecycle.evidence_anchor,
            closeoutExplanation: mergeLifecycle.closeout_explanation
          }),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_TOPIC_DELIVERY") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_delivery_payload", "delivery payload must be a JSON object");
        const truthRevision = parseOptionalTruthRevision(body);
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        if (typeof body.source_actor_id !== "string" || body.source_actor_id.trim().length === 0) {
          throw new CoordinatorError("invalid_delivery_source_actor", "source_actor_id is required");
        }
        if (typeof body.state !== "string" || body.state.trim().length === 0) {
          throw new CoordinatorError("invalid_delivery_state", "state is required");
        }
        for (const field of Object.keys(body)) {
          if (DELIVERY_SERVER_OWNED_FIELDS.has(field)) {
            throw new CoordinatorError(
              "invalid_delivery_server_owned_field",
              `delivery payload does not allow server-owned field: ${field}`
            );
          }
        }

        relatedCommandId = generateId("delivery");
        let delivery;
        try {
          assertWriteRevision(coordinator, route.topicId, truthRevision);
          delivery = coordinator.writeDeliveryState(route.topicId, {
            sourceActorId: body.source_actor_id,
            state: body.state,
            prUrl: Object.prototype.hasOwnProperty.call(body, "pr_url") ? body.pr_url : undefined,
            note: body.note ?? null
          });
        } catch (error) {
          if (error instanceof CoordinatorError) {
            appendControlEvent(route.topicId, {
              event_type: "delivery_update_rejected",
              related_command_id: relatedCommandId,
              related_resource_type: "delivery",
              related_resource_id: route.topicId,
              result_state: "rejected",
              reason_code: error.code,
              reason_detail: error.message,
              request_id: requestId,
              correlation_id: correlationId
            });
          }
          throw error;
        }

        const event = appendControlEvent(route.topicId, {
          event_type: "delivery_updated",
          related_command_id: relatedCommandId,
          related_resource_type: "delivery",
          related_resource_id: route.topicId,
          result_state: delivery.state,
          request_id: requestId,
          correlation_id: correlationId
        });
        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });
        const overview = coordinator.getTopicOverview(route.topicId);
        const mergeLifecycle = serializeMergeLifecycle(overview);
        const payload = {
          delivery: serializeDeliveryResource(delivery, {
            mergeLifecycleStage: mergeLifecycle.stage,
            closeoutLineage: mergeLifecycle.closeout_lineage,
            prWritebackState: overview.truth.prWriteback,
            evidenceAnchor: mergeLifecycle.evidence_anchor,
            closeoutExplanation: mergeLifecycle.closeout_explanation
          }),
          revision: overview.revision,
          event_id: event.event_id,
          request_id: requestId,
          correlation_id: correlationId
        };
        storeIdempotencyResult(idempotency, 200, payload);
        sendJson(response, 200, payload);
        return;
      }

      if (route.route === "V1_GET_TOPIC_PR_WRITEBACK") {
        const overview = coordinator.getTopicOverview(route.topicId);
        const prWriteback = overview.truth.prWriteback;
        const mergeLifecycle = serializeMergeLifecycle(overview);
        sendJson(response, 200, {
          pr_writeback: serializeDeliveryResource(prWriteback, {
            mergeLifecycleStage: mergeLifecycle.stage,
            closeoutLineage: mergeLifecycle.closeout_lineage,
            prWritebackState: overview.truth.prWriteback,
            evidenceAnchor: mergeLifecycle.evidence_anchor,
            closeoutExplanation: mergeLifecycle.closeout_explanation
          }),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_TOPIC_PR_WRITEBACK") {
        const body = await readJsonBody(request);
        correlationId = readCorrelationId(request, body);
        assertObjectBody(body, "invalid_pr_writeback_payload", "pr_writeback payload must be a JSON object");
        const truthRevision = parseOptionalTruthRevision(body);
        const idempotency = requireIdempotency(route.route, parsedUrl.pathname, request, body);
        if (idempotency?.replay) {
          sendJson(response, idempotency.replay.statusCode, {
            ...idempotency.replay.payload,
            idempotent_replay: true
          });
          return;
        }

        if (typeof body.source_actor_id !== "string" || body.source_actor_id.trim().length === 0) {
          throw new CoordinatorError("invalid_pr_writeback_source_actor", "source_actor_id is required");
        }
        if (typeof body.pr_url !== "string" || body.pr_url.trim().length === 0) {
          throw new CoordinatorError("invalid_pr_writeback_url", "pr_url is required");
        }
        for (const field of Object.keys(body)) {
          if (PR_WRITEBACK_SERVER_OWNED_FIELDS.has(field)) {
            throw new CoordinatorError(
              "invalid_pr_writeback_server_owned_field",
              `pr_writeback payload does not allow server-owned field: ${field}`
            );
          }
        }

        relatedCommandId = generateId("prw");
        let prWriteback;
        try {
          assertWriteRevision(coordinator, route.topicId, truthRevision);
          prWriteback = coordinator.writePrWriteback(route.topicId, {
            sourceActorId: body.source_actor_id,
            prUrl: body.pr_url,
            state: body.state,
            note: body.note ?? null
          });
        } catch (error) {
          if (error instanceof CoordinatorError) {
            appendControlEvent(route.topicId, {
              event_type: "pr_writeback_rejected",
              related_command_id: relatedCommandId,
              related_resource_type: "pr_writeback",
              related_resource_id: route.topicId,
              result_state: "rejected",
              reason_code: error.code,
              reason_detail: error.message,
              request_id: requestId,
              correlation_id: correlationId
            });
          }
          throw error;
        }

        const event = appendControlEvent(route.topicId, {
          event_type: "pr_writeback_updated",
          related_command_id: relatedCommandId,
          related_resource_type: "pr_writeback",
          related_resource_id: route.topicId,
          result_state: prWriteback.state,
          request_id: requestId,
          correlation_id: correlationId
        });
        appendTopicSnapshot(route.topicId, {
          requestId,
          correlationId,
          sourceEventId: event.event_id
        });
        const overview = coordinator.getTopicOverview(route.topicId);
        const mergeLifecycle = serializeMergeLifecycle(overview);
        const payload = {
          pr_writeback: serializeDeliveryResource(prWriteback, {
            mergeLifecycleStage: mergeLifecycle.stage,
            closeoutLineage: mergeLifecycle.closeout_lineage,
            prWritebackState: overview.truth.prWriteback,
            evidenceAnchor: mergeLifecycle.evidence_anchor,
            closeoutExplanation: mergeLifecycle.closeout_explanation
          }),
          revision: overview.revision,
          event_id: event.event_id,
          request_id: requestId,
          correlation_id: correlationId
        };
        storeIdempotencyResult(idempotency, 200, payload);
        sendJson(response, 200, payload);
        return;
      }

      if (route.route === "V1_GET_TOPIC_DEBUG_HISTORY") {
        ensureTopicExists(route.topicId);
        const view = parsedUrl.searchParams.get("view") ?? "events";
        if (!["events", "snapshot"].includes(view)) {
          throw new CoordinatorError("invalid_debug_view", "view must be one of events|snapshot");
        }
        const cursor = parsedUrl.searchParams.get("cursor");
        const limit = parsePageLimit(parsedUrl.searchParams, DEFAULT_DEBUG_PAGE_LIMIT);

        if (view === "events") {
          const allEvents = getTopicEvents(route.topicId);
          const page = paginate(allEvents, {
            cursor,
            limit,
            scope: `topic:${route.topicId}:debug_history:events`
          });
          sendJson(response, 200, {
            view,
            items: deepClone(page.items),
            page: page.page,
            request_id: requestId
          });
          return;
        }

        const snapshots = getTopicSnapshots(route.topicId);
        if (snapshots.length === 0) {
          appendTopicSnapshot(route.topicId, { requestId, correlationId: null, sourceEventId: null });
        }
        const snapshotPage = paginate(getTopicSnapshots(route.topicId), {
          cursor,
          limit,
          scope: `topic:${route.topicId}:debug_history:snapshot`
        });
        sendJson(response, 200, {
          view,
          items: deepClone(snapshotPage.items),
          page: snapshotPage.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_DEBUG_REJECTIONS") {
        ensureTopicExists(route.topicId);
        const allEvents = getTopicEvents(route.topicId);
        const rejectionEvents = allEvents.filter(
          (eventItem) =>
            typeof eventItem.reason_code === "string" && eventItem.reason_code.length > 0
        );
        const page = paginate(rejectionEvents, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams, DEFAULT_DEBUG_PAGE_LIMIT),
          scope: `topic:${route.topicId}:debug_rejections`
        });
        sendJson(response, 200, {
          items: deepClone(page.items),
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_RUN_HISTORY") {
        const result = coordinator.listTopicRunHistoryProjection(route.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "run_history_projection",
            sourcePlane: "execution_plane_projection",
            topicId: route.topicId
          })
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_NOTIFICATIONS") {
        const result = coordinator.listTopicNotificationProjection(route.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_TOPIC_REPO_BINDING") {
        const result = coordinator.getTopicRepoBindingProjection(route.topicId);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(route.topicId);
        sendJson(response, 200, {
          projection_meta: integrationProjectionMeta({
            resource: "repo_binding",
            sourcePlane: "control_plane_projection",
            topicId: route.topicId
          }),
          topic_id: route.topicId,
          repo_binding: result,
          delivery_projection: deliveryProjection
        });
        return;
      }

      if (route.route === "V1_PUT_TOPIC_REPO_BINDING") {
        const body = await readJsonBody(request);
        const result = coordinator.upsertTopicRepoBindingProjection(route.topicId, body);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(route.topicId);
        sendJson(response, 200, {
          ...result,
          delivery_projection: deliveryProjection,
          projection_meta: integrationProjectionMeta({
            resource: "repo_binding",
            sourcePlane: "control_plane_projection",
            topicId: route.topicId
          })
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_PRS") {
        const result = coordinator.listTopicPrProjections(route.topicId);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(route.topicId);
        sendJson(response, 200, {
          projection_meta: integrationProjectionMeta({
            resource: "pr_projection",
            sourcePlane: "control_plane_projection",
            topicId: route.topicId
          }),
          topic_id: route.topicId,
          delivery_projection: deliveryProjection,
          items: result
        });
        return;
      }

      if (route.route === "V1_POST_TOPIC_PRS") {
        const body = await readJsonBody(request);
        const result = coordinator.createTopicPrProjection(route.topicId, body);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(route.topicId);
        sendJson(response, 201, {
          ...result,
          delivery_projection: deliveryProjection,
          projection_meta: integrationProjectionMeta({
            resource: "pr_projection",
            sourcePlane: "control_plane_projection",
            topicId: route.topicId,
            prId: result.pr_id
          })
        });
        return;
      }

      if (route.route === "V1_GET_PR") {
        const result = coordinator.getPrProjection(route.prId);
        const deliveryProjection =
          typeof result.topic_id === "string" && result.topic_id.length > 0
            ? coordinator.getTopicDeliveryProjection(result.topic_id)
            : null;
        sendJson(response, 200, {
          ...result,
          delivery_projection: deliveryProjection,
          projection_meta: integrationProjectionMeta({
            resource: "pr_projection",
            sourcePlane: "control_plane_projection",
            topicId: result.topic_id ?? null,
            prId: route.prId
          })
        });
        return;
      }

      if (route.route === "V1_PATCH_PR") {
        const body = await readJsonBody(request);
        const result = coordinator.updatePrProjection(route.prId, body);
        const deliveryProjection =
          typeof result.topic_id === "string" && result.topic_id.length > 0
            ? coordinator.getTopicDeliveryProjection(result.topic_id)
            : null;
        sendJson(response, 200, {
          ...result,
          delivery_projection: deliveryProjection,
          projection_meta: integrationProjectionMeta({
            resource: "pr_projection",
            sourcePlane: "control_plane_projection",
            topicId: result.topic_id ?? null,
            prId: route.prId
          })
        });
        return;
      }

      if (route.route === "V1_POST_PR_REVIEW") {
        const body = await readJsonBody(request);
        const result = coordinator.appendPrReviewProjection(route.prId, body);
        sendJson(response, 201, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "pr_review_projection",
            sourcePlane: "control_plane_projection",
            prId: route.prId
          })
        });
        return;
      }

      if (route.route === "V1_POST_PR_CHECK") {
        const body = await readJsonBody(request);
        const result = coordinator.appendPrCheckProjection(route.prId, body);
        sendJson(response, 201, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "pr_check_projection",
            sourcePlane: "execution_plane_projection",
            prId: route.prId
          })
        });
        return;
      }

      if (route.route === "V1_GET_RUN_TIMELINE") {
        const result = coordinator.listRunTimelineProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_RUN_REPLAY") {
        const result = coordinator.replayRunEventProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id"),
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "run_replay_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
        return;
      }

      if (route.route === "V1_GET_RUN") {
        const result = coordinator.getRunProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_EXECUTION_RUN_DEBUG") {
        const result = coordinator.getExecutionRunDebugEvidenceProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_RUN_FEEDBACK") {
        const result = coordinator.listRunFeedbackProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_RUN_HOLDS") {
        const result = coordinator.listRunHoldProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_DEBUG_EVENTS") {
        const result = coordinator.listDebugEventsProjection({
          topicId: parsedUrl.searchParams.get("topic_id"),
          runId: parsedUrl.searchParams.get("run_id"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "debug_event_projection",
            sourcePlane: "cross_plane_debug_join",
            topicId: result.topic_id ?? null,
            runId: result.run_id ?? null
          })
        });
        return;
      }

      if (route.route === "V1_GET_DEBUG_HISTORY") {
        try {
          const result = coordinator.listDebugHistoryAggregationProjection({
            topicId: parsedUrl.searchParams.get("topic_id"),
            runId: parsedUrl.searchParams.get("run_id"),
            cursor: parsedUrl.searchParams.get("cursor"),
            limit: parsedUrl.searchParams.get("limit")
          });
          sendJson(response, 200, {
            ...result,
            projection_meta: integrationProjectionMeta({
              resource: "debug_history_projection",
              sourcePlane: "cross_plane_debug_history_aggregation",
              topicId: result.topic_id ?? null,
              runId: result.run_id ?? null
            })
          });
        } catch (error) {
          if (error instanceof CoordinatorError) {
            sendJson(response, 400, {
              error: error.code,
              message: error.message,
              details: error.details ?? {}
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (route.route === "V1_GET_INBOX") {
        const result = coordinator.listActorInboxProjection(route.actorId, {
          topicId: parsedUrl.searchParams.get("topic_id"),
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_POST_INBOX_ACKS") {
        const body = await readJsonBody(request);
        const result = coordinator.ackActorInboxItems(route.actorId, body);
        sendJson(response, 200, result);
        return;
      }

      if (route.route === "V1_GET_SHELL_ADAPTER_COMPATIBILITY") {
        const result = coordinator.getShellCompatibilityContract({
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "shell_adapter_compatibility_projection",
            sourcePlane: "integration_adaptor_contract",
            topicId: result.backend_derived_projection?.topic_id ?? null
          })
        });
        return;
      }

      if (request.url.startsWith("/v1/")) {
        const notFound = buildV1Error(new CoordinatorError("route_not_found", "route not found"), {
          requestId,
          correlationId,
          relatedCommandId
        });
        sendJson(response, notFound.statusCode, notFound.payload);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (request.url?.startsWith("/v1/")) {
        const v1Error = buildV1Error(error, {
          requestId,
          correlationId,
          relatedCommandId
        });
        sendJson(response, v1Error.statusCode, v1Error.payload);
        return;
      }

      if (error instanceof CoordinatorError) {
        sendJson(response, 400, {
          error: error.code,
          message: error.message,
          details: error.details ?? {}
        });
        return;
      }

      sendJson(response, 500, {
        error: "internal_error",
        message: error?.message ?? "unknown error"
      });
    }
  });
}
