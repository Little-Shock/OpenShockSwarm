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

  const v1ChannelContextMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/context$/);
  if (method === "GET" && v1ChannelContextMatch) {
    return {
      route: "V1_GET_CHANNEL_CONTEXT",
      channelId: v1ChannelContextMatch[1]
    };
  }
  if (method === "PUT" && v1ChannelContextMatch) {
    return {
      route: "V1_PUT_CHANNEL_CONTEXT",
      channelId: v1ChannelContextMatch[1]
    };
  }

  const v1ChannelRepoBindingMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/repo-binding$/);
  if (method === "GET" && v1ChannelRepoBindingMatch) {
    return {
      route: "V1_GET_CHANNEL_REPO_BINDING",
      channelId: v1ChannelRepoBindingMatch[1]
    };
  }
  if (method === "PUT" && v1ChannelRepoBindingMatch) {
    return {
      route: "V1_PUT_CHANNEL_REPO_BINDING",
      channelId: v1ChannelRepoBindingMatch[1]
    };
  }

  const v1ChannelNotificationEndpointMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/notification-endpoint$/);
  if (method === "GET" && v1ChannelNotificationEndpointMatch) {
    return {
      route: "V1_GET_CHANNEL_NOTIFICATION_ENDPOINT",
      channelId: v1ChannelNotificationEndpointMatch[1]
    };
  }
  if (method === "PUT" && v1ChannelNotificationEndpointMatch) {
    return {
      route: "V1_PUT_CHANNEL_NOTIFICATION_ENDPOINT",
      channelId: v1ChannelNotificationEndpointMatch[1]
    };
  }

  const v1ChannelOrchestrationUpgradeMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/orchestration-upgrade$/);
  if (method === "GET" && v1ChannelOrchestrationUpgradeMatch) {
    return {
      route: "V1_GET_CHANNEL_ORCHESTRATION_UPGRADE",
      channelId: v1ChannelOrchestrationUpgradeMatch[1]
    };
  }
  if (method === "PUT" && v1ChannelOrchestrationUpgradeMatch) {
    return {
      route: "V1_PUT_CHANNEL_ORCHESTRATION_UPGRADE",
      channelId: v1ChannelOrchestrationUpgradeMatch[1]
    };
  }

  const v1ChannelExternalMemoryProviderMatch = pathName.match(
    /^\/v1\/channels\/([^/]+)\/external-memory-provider$/
  );
  if (method === "GET" && v1ChannelExternalMemoryProviderMatch) {
    return {
      route: "V1_GET_CHANNEL_EXTERNAL_MEMORY_PROVIDER",
      channelId: v1ChannelExternalMemoryProviderMatch[1]
    };
  }
  if (method === "PUT" && v1ChannelExternalMemoryProviderMatch) {
    return {
      route: "V1_PUT_CHANNEL_EXTERNAL_MEMORY_PROVIDER",
      channelId: v1ChannelExternalMemoryProviderMatch[1]
    };
  }

  const v1ChannelMemoryViewerMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory-viewer$/);
  if (method === "GET" && v1ChannelMemoryViewerMatch) {
    return {
      route: "V1_GET_CHANNEL_MEMORY_VIEWER",
      channelId: v1ChannelMemoryViewerMatch[1]
    };
  }

  const v1ChannelMemorySearchMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory\/search$/);
  if (method === "POST" && v1ChannelMemorySearchMatch) {
    return {
      route: "V1_POST_CHANNEL_MEMORY_SEARCH",
      channelId: v1ChannelMemorySearchMatch[1]
    };
  }

  const v1ChannelMemoryWriteMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory\/write$/);
  if (method === "POST" && v1ChannelMemoryWriteMatch) {
    return {
      route: "V1_POST_CHANNEL_MEMORY_WRITE",
      channelId: v1ChannelMemoryWriteMatch[1]
    };
  }

  const v1ChannelMemoryFeedbackMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory\/feedback$/);
  if (method === "POST" && v1ChannelMemoryFeedbackMatch) {
    return {
      route: "V1_POST_CHANNEL_MEMORY_FEEDBACK",
      channelId: v1ChannelMemoryFeedbackMatch[1]
    };
  }

  const v1ChannelMemoryPromoteMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory\/promote$/);
  if (method === "POST" && v1ChannelMemoryPromoteMatch) {
    return {
      route: "V1_POST_CHANNEL_MEMORY_PROMOTE",
      channelId: v1ChannelMemoryPromoteMatch[1]
    };
  }

  const v1ChannelMemoryForgetMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory\/forget$/);
  if (method === "POST" && v1ChannelMemoryForgetMatch) {
    return {
      route: "V1_POST_CHANNEL_MEMORY_FORGET",
      channelId: v1ChannelMemoryForgetMatch[1]
    };
  }

  const v1ChannelMemoryItemMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/memory\/([^/]+)$/);
  if (method === "GET" && v1ChannelMemoryItemMatch) {
    return {
      route: "V1_GET_CHANNEL_MEMORY_ITEM",
      channelId: v1ChannelMemoryItemMatch[1],
      memoryId: v1ChannelMemoryItemMatch[2]
    };
  }

  const v1ChannelAuditTrailMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/audit-trail$/);
  if (method === "GET" && v1ChannelAuditTrailMatch) {
    return {
      route: "V1_GET_CHANNEL_AUDIT_TRAIL",
      channelId: v1ChannelAuditTrailMatch[1]
    };
  }

  const v1ChannelWorkAssignmentsMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/work-assignments$/);
  if (method === "GET" && v1ChannelWorkAssignmentsMatch) {
    return {
      route: "V1_GET_CHANNEL_WORK_ASSIGNMENTS",
      channelId: v1ChannelWorkAssignmentsMatch[1]
    };
  }

  const v1ChannelWorkAssignmentUpsertMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/work-assignments\/([^/]+)$/);
  if (method === "PUT" && v1ChannelWorkAssignmentUpsertMatch) {
    return {
      route: "V1_PUT_CHANNEL_WORK_ASSIGNMENT",
      channelId: v1ChannelWorkAssignmentUpsertMatch[1],
      agentId: v1ChannelWorkAssignmentUpsertMatch[2]
    };
  }

  const v1ChannelOperatorActionsMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/operator-actions$/);
  if (method === "GET" && v1ChannelOperatorActionsMatch) {
    return {
      route: "V1_GET_CHANNEL_OPERATOR_ACTIONS",
      channelId: v1ChannelOperatorActionsMatch[1]
    };
  }
  if (method === "POST" && v1ChannelOperatorActionsMatch) {
    return {
      route: "V1_POST_CHANNEL_OPERATOR_ACTION",
      channelId: v1ChannelOperatorActionsMatch[1]
    };
  }

  const v1ChannelRecentActionsMatch = pathName.match(/^\/v1\/channels\/([^/]+)\/recent-actions$/);
  if (method === "GET" && v1ChannelRecentActionsMatch) {
    return {
      route: "V1_GET_CHANNEL_RECENT_ACTIONS",
      channelId: v1ChannelRecentActionsMatch[1]
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
  const v1TopicStatusMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/status$/);
  if (method === "GET" && v1TopicStatusMatch) {
    return { route: "V1_GET_TOPIC_STATUS", topicId: v1TopicStatusMatch[1] };
  }

  const v1TopicStateMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/topic-state$/);
  if (method === "GET" && v1TopicStateMatch) {
    return { route: "V1_GET_TOPIC_STATE", topicId: v1TopicStateMatch[1] };
  }

  const v1TopicMergeLifecycleMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/merge-lifecycle$/);
  if (method === "GET" && v1TopicMergeLifecycleMatch) {
    return { route: "V1_GET_TOPIC_MERGE_LIFECYCLE", topicId: v1TopicMergeLifecycleMatch[1] };
  }

  const v1TopicTaskAllocationMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/task-allocation$/);
  if (method === "GET" && v1TopicTaskAllocationMatch) {
    return { route: "V1_GET_TOPIC_TASK_ALLOCATION", topicId: v1TopicTaskAllocationMatch[1] };
  }

  const v1TopicControlConsumerMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/control-plane-consumer$/);
  if (method === "GET" && v1TopicControlConsumerMatch) {
    return { route: "V1_GET_TOPIC_CONTROL_PLANE_CONSUMER", topicId: v1TopicControlConsumerMatch[1] };
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

  const v1TopicExecutionInboxMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/execution-inbox$/);
  if (method === "GET" && v1TopicExecutionInboxMatch) {
    return { route: "V1_GET_TOPIC_EXECUTION_INBOX", topicId: v1TopicExecutionInboxMatch[1] };
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

  const v1ExecutionRunEventsMatch = pathName.match(/^\/v1\/execution\/runs\/([^/]+)\/events$/);
  if (method === "GET" && v1ExecutionRunEventsMatch) {
    return { route: "V1_GET_EXECUTION_RUN_EVENTS", runId: v1ExecutionRunEventsMatch[1] };
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

  if (method === "GET" && pathName === "/v1/runtime/registry") {
    return { route: "V1_GET_RUNTIME_REGISTRY" };
  }

  if (method === "GET" && pathName === "/v1/runtime/machines") {
    return { route: "V1_GET_RUNTIME_MACHINES" };
  }

  const v1RuntimeMachineMatch = pathName.match(/^\/v1\/runtime\/machines\/([^/]+)$/);
  if (method === "GET" && v1RuntimeMachineMatch) {
    return { route: "V1_GET_RUNTIME_MACHINE", machineId: v1RuntimeMachineMatch[1] };
  }
  if (method === "PUT" && v1RuntimeMachineMatch) {
    return { route: "V1_PUT_RUNTIME_MACHINE", machineId: v1RuntimeMachineMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/runtime/agents") {
    return { route: "V1_GET_RUNTIME_AGENTS" };
  }

  if (method === "GET" && pathName === "/v1/runtime/recovery-actions") {
    return { route: "V1_GET_RUNTIME_RECOVERY_ACTIONS" };
  }

  const v1RuntimeAgentMatch = pathName.match(/^\/v1\/runtime\/agents\/([^/]+)$/);
  if (method === "GET" && v1RuntimeAgentMatch) {
    return { route: "V1_GET_RUNTIME_AGENT", agentId: v1RuntimeAgentMatch[1] };
  }
  if (method === "PUT" && v1RuntimeAgentMatch) {
    return { route: "V1_PUT_RUNTIME_AGENT", agentId: v1RuntimeAgentMatch[1] };
  }

  const v1RuntimeAgentPairingMatch = pathName.match(/^\/v1\/runtime\/agents\/([^/]+)\/pairing$/);
  if (method === "PUT" && v1RuntimeAgentPairingMatch) {
    return { route: "V1_PUT_RUNTIME_AGENT_PAIRING", agentId: v1RuntimeAgentPairingMatch[1] };
  }

  const v1RuntimeAgentHeartbeatMatch = pathName.match(/^\/v1\/runtime\/agents\/([^/]+)\/heartbeat$/);
  if (method === "POST" && v1RuntimeAgentHeartbeatMatch) {
    return { route: "V1_POST_RUNTIME_AGENT_HEARTBEAT", agentId: v1RuntimeAgentHeartbeatMatch[1] };
  }

  const v1RuntimeAgentAssignmentMatch = pathName.match(/^\/v1\/runtime\/agents\/([^/]+)\/assignment$/);
  if (method === "PUT" && v1RuntimeAgentAssignmentMatch) {
    return { route: "V1_PUT_RUNTIME_AGENT_ASSIGNMENT", agentId: v1RuntimeAgentAssignmentMatch[1] };
  }

  const v1RuntimeAgentRecoveryActionMatch = pathName.match(/^\/v1\/runtime\/agents\/([^/]+)\/recovery-actions$/);
  if (method === "POST" && v1RuntimeAgentRecoveryActionMatch) {
    return { route: "V1_POST_RUNTIME_AGENT_RECOVERY_ACTION", agentId: v1RuntimeAgentRecoveryActionMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/runtime/worktree-claims") {
    return { route: "V1_GET_RUNTIME_WORKTREE_CLAIMS" };
  }

  const v1RuntimeWorktreeClaimMatch = pathName.match(/^\/v1\/runtime\/worktree-claims\/([^/]+)$/);
  if (method === "PUT" && v1RuntimeWorktreeClaimMatch) {
    return { route: "V1_PUT_RUNTIME_WORKTREE_CLAIM", claimKey: v1RuntimeWorktreeClaimMatch[1] };
  }

  const v1RuntimeWorktreeReleaseMatch = pathName.match(/^\/v1\/runtime\/worktree-claims\/([^/]+)\/release$/);
  if (method === "POST" && v1RuntimeWorktreeReleaseMatch) {
    return { route: "V1_POST_RUNTIME_WORKTREE_RELEASE", claimKey: v1RuntimeWorktreeReleaseMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/runtime/deploy-runtime") {
    return { route: "V1_GET_RUNTIME_DEPLOY_RUNTIME" };
  }
  if (method === "PUT" && pathName === "/v1/runtime/deploy-runtime") {
    return { route: "V1_PUT_RUNTIME_DEPLOY_RUNTIME" };
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

function serializeRuntimeMachine(machine) {
  return {
    machine_id: machine.machineId,
    runtime_id: machine.runtimeId,
    status: machine.status,
    liveness: machine.liveness ?? "unknown",
    capabilities: deepClone(machine.capabilities ?? []),
    paired_by: machine.pairedBy ?? null,
    registered_at: machine.registeredAt ?? null,
    paired_at: machine.pairedAt ?? null,
    last_seen_at: machine.lastSeenAt ?? null,
    updated_at: machine.updatedAt ?? null
  };
}

function serializeRuntimeAgent(agent) {
  return {
    agent_id: agent.agentId,
    machine_id: agent.machineId,
    runtime_id: agent.runtimeId,
    owner_operator_id: agent.ownerOperatorId ?? null,
    assigned_channel_id: agent.assignedChannelId ?? null,
    assigned_thread_id: agent.assignedThreadId ?? null,
    assigned_workitem_id: agent.assignedWorkitemId ?? null,
    status: agent.status,
    pairing_state: agent.pairingState ?? "unknown",
    liveness: agent.liveness ?? "unknown",
    registered_at: agent.registeredAt ?? null,
    paired_at: agent.pairedAt ?? null,
    last_seen_at: agent.lastSeenAt ?? null,
    updated_at: agent.updatedAt ?? null
  };
}

function serializeRuntimeWorktreeClaim(claim) {
  return {
    claim_key: claim.claimKey,
    agent_id: claim.agentId,
    owner_operator_id: claim.ownerOperatorId ?? null,
    assigned_channel_id: claim.assignedChannelId ?? null,
    assigned_thread_id: claim.assignedThreadId ?? null,
    assigned_workitem_id: claim.assignedWorkitemId ?? null,
    machine_id: claim.machineId,
    runtime_id: claim.runtimeId,
    repo_ref: claim.repoRef,
    branch: claim.branch,
    lane_id: claim.laneId ?? null,
    claim_status: claim.claimStatus ?? "active",
    holder_liveness: claim.holderLiveness ?? "unknown",
    reclaimed_from_agent_id: claim.reclaimedFromAgentId ?? null,
    claimed_at: claim.claimedAt ?? null,
    last_heartbeat_at: claim.lastHeartbeatAt ?? null,
    updated_at: claim.updatedAt ?? null
  };
}

function serializeRuntimeRecoveryAction(action) {
  return {
    action_id: action.actionId,
    action: action.action,
    status: action.status ?? "applied",
    operator_id: action.operatorId ?? null,
    agent_id: action.agentId ?? null,
    channel_id: action.channelId ?? null,
    thread_id: action.threadId ?? null,
    workitem_id: action.workitemId ?? null,
    reason: action.reason ?? null,
    at: action.at ?? null,
    result: {
      agent: action.result?.agent ? serializeRuntimeAgent(action.result.agent) : null,
      claim: action.result?.claim ? serializeRuntimeWorktreeClaim(action.result.claim) : null
    }
  };
}

function serializeRuntimeDeployRuntimeContract(input = {}) {
  return {
    projection: "runtime_deploy_runtime_contract",
    contract_version: input.contractVersion ?? "v1.stage5a",
    owner_operator_id: input.ownerOperatorId ?? null,
    hosted_access: {
      hosted_entry_url: input.hostedAccess?.hostedEntryUrl ?? null,
      non_local_access: input.hostedAccess?.nonLocalAccess !== false,
      access_mode: input.hostedAccess?.accessMode ?? "hosted_web",
      login_state: input.hostedAccess?.loginState ?? "unknown",
      session_binding: input.hostedAccess?.sessionBinding ?? "unstable",
      auth_provider: input.hostedAccess?.authProvider ?? null,
      status: input.hostedAccess?.status ?? "not_ready",
      updated_at: input.hostedAccess?.updatedAt ?? null,
      updated_by: input.hostedAccess?.updatedBy ?? null
    },
    deployment: {
      deployment_id: input.deployment?.deploymentId ?? null,
      target_ref: input.deployment?.targetRef ?? null,
      release_channel: input.deployment?.releaseChannel ?? "stable",
      runtime_version: input.deployment?.runtimeVersion ?? null,
      status: input.deployment?.status ?? "not_deployed",
      health_endpoint: input.deployment?.healthEndpoint ?? "/health",
      readiness_endpoint: input.deployment?.readinessEndpoint ?? "/runtime/smoke",
      updated_at: input.deployment?.updatedAt ?? null,
      updated_by: input.deployment?.updatedBy ?? null
    },
    environment: {
      environment_id: input.environment?.environmentId ?? null,
      config_profile: input.environment?.configProfile ?? null,
      config_refs: deepClone(input.environment?.configRefs ?? []),
      secret_refs: deepClone(input.environment?.secretRefs ?? []),
      release_ref: input.environment?.releaseRef ?? null,
      recovery_ref: input.environment?.recoveryRef ?? null,
      upgrade_ref: input.environment?.upgradeRef ?? null,
      handoff_ref: input.environment?.handoffRef ?? null,
      updated_at: input.environment?.updatedAt ?? null,
      updated_by: input.environment?.updatedBy ?? null
    },
    health_readiness: {
      health_status: input.healthReadiness?.healthStatus ?? "unknown",
      readiness_status: input.healthReadiness?.readinessStatus ?? "not_ready",
      checked_at: input.healthReadiness?.checkedAt ?? null,
      check_ref: input.healthReadiness?.checkRef ?? null,
      notes: input.healthReadiness?.notes ?? null,
      updated_at: input.healthReadiness?.updatedAt ?? null,
      updated_by: input.healthReadiness?.updatedBy ?? null
    },
    release_recovery_upgrade_handoff: {
      status: input.releaseRecoveryUpgradeHandoff?.status ?? "draft",
      release_ref: input.releaseRecoveryUpgradeHandoff?.releaseRef ?? null,
      recovery_ref: input.releaseRecoveryUpgradeHandoff?.recoveryRef ?? null,
      upgrade_ref: input.releaseRecoveryUpgradeHandoff?.upgradeRef ?? null,
      handoff_ref: input.releaseRecoveryUpgradeHandoff?.handoffRef ?? null,
      runbook_ref: input.releaseRecoveryUpgradeHandoff?.runbookRef ?? null,
      last_drill_at: input.releaseRecoveryUpgradeHandoff?.lastDrillAt ?? null,
      updated_at: input.releaseRecoveryUpgradeHandoff?.updatedAt ?? null,
      updated_by: input.releaseRecoveryUpgradeHandoff?.updatedBy ?? null
    },
    write_anchors: {
      deploy_runtime_upsert: input.writeAnchors?.deployRuntimeUpsert ?? "/v1/runtime/deploy-runtime",
      runtime_recovery_action:
        input.writeAnchors?.runtimeRecoveryAction ?? "/v1/runtime/agents/:agentId/recovery-actions"
    },
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? "/v1/runtime/deploy-runtime",
      latest: {
        deploy_runtime: input.auditAnchor?.latest?.deployRuntime
          ? {
              audit_id: input.auditAnchor.latest.deployRuntime.auditId ?? null,
              action: input.auditAnchor.latest.deployRuntime.action ?? null,
              at: input.auditAnchor.latest.deployRuntime.at ?? null,
              operator_id: input.auditAnchor.latest.deployRuntime.operatorId ?? null
            }
          : null
      }
    },
    timeline_anchor: {
      runtime_config: input.timelineAnchor?.runtimeConfig ?? "/runtime/config",
      runtime_smoke: input.timelineAnchor?.runtimeSmoke ?? "/runtime/smoke",
      health: input.timelineAnchor?.health ?? "/health",
      runtime_registry: input.timelineAnchor?.runtimeRegistry ?? "/v1/runtime/registry",
      runtime_recovery_actions: input.timelineAnchor?.runtimeRecoveryActions ?? "/v1/runtime/recovery-actions"
    },
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelContextContract(input = {}) {
  const channelId = input.channelId;
  return {
    projection: "channel_context_contract",
    contract_version: "v1.stage4a1",
    channel_id: channelId,
    project_aligned_entry: true,
    owner_operator_id: input.ownerOperatorId ?? null,
    workspace: {
      workspace_id: input.workspace?.workspaceId ?? "workspace_default",
      root_path: input.workspace?.rootPath ?? null,
      model: "folder_root_under_channel"
    },
    context: {
      baseline_ref: input.context?.baselineRef ?? null,
      fixed_directory: input.context?.fixedDirectory ?? null,
      doc_paths: deepClone(input.context?.docPaths ?? []),
      runtime_entries: deepClone(input.context?.runtimeEntries ?? []),
      rule_entries: deepClone(input.context?.ruleEntries ?? []),
      hosted_access: input.context?.hostedAccess
        ? {
            hosted_web_url: input.context.hostedAccess.hostedWebUrl ?? null,
            access_mode: input.context.hostedAccess.accessMode ?? "hosted_web",
            non_local_access_enabled: input.context.hostedAccess.nonLocalAccessEnabled === true,
            stable_login_state: input.context.hostedAccess.stableLoginState ?? "pending",
            login_provider: input.context.hostedAccess.loginProvider ?? null,
            session_ttl_minutes: input.context.hostedAccess.sessionTtlMinutes ?? null,
            updated_at: input.context.hostedAccess.updatedAt ?? null,
            updated_by: input.context.hostedAccess.updatedBy ?? null
          }
        : null
    },
    governance: {
      auth_identity: input.governance?.authIdentity
        ? {
            identity_id: input.governance.authIdentity.identityId ?? null,
            provider: input.governance.authIdentity.provider ?? null,
            subject_ref: input.governance.authIdentity.subjectRef ?? null,
            github_login: input.governance.authIdentity.githubLogin ?? null,
            status: input.governance.authIdentity.status ?? "bound",
            bound_at: input.governance.authIdentity.boundAt ?? null,
            updated_at: input.governance.authIdentity.updatedAt ?? null,
            updated_by: input.governance.authIdentity.updatedBy ?? null
          }
        : null,
      member: input.governance?.member
        ? {
            member_id: input.governance.member.memberId ?? null,
            role: input.governance.member.role ?? null,
            status: input.governance.member.status ?? null,
            joined_at: input.governance.member.joinedAt ?? null,
            updated_at: input.governance.member.updatedAt ?? null,
            updated_by: input.governance.member.updatedBy ?? null
          }
        : null,
      github_installation: input.governance?.githubInstallation
        ? {
            installation_id: input.governance.githubInstallation.installationId ?? null,
            provider: input.governance.githubInstallation.provider ?? null,
            workspace_id: input.governance.githubInstallation.workspaceId ?? null,
            status: input.governance.githubInstallation.status ?? null,
            authorized_repos: deepClone(input.governance.githubInstallation.authorizedRepos ?? []),
            installed_at: input.governance.githubInstallation.installedAt ?? null,
            removed_at: input.governance.githubInstallation.removedAt ?? null,
            updated_at: input.governance.githubInstallation.updatedAt ?? null,
            updated_by: input.governance.githubInstallation.updatedBy ?? null
          }
        : null,
      sandbox_profile: input.governance?.sandboxProfile
        ? {
            profile: input.governance.sandboxProfile.profile ?? null,
            updated_at: input.governance.sandboxProfile.updatedAt ?? null,
            updated_by: input.governance.sandboxProfile.updatedBy ?? null
          }
        : null,
      secrets_binding: input.governance?.secretsBinding
        ? {
            allowed_secret_refs: deepClone(input.governance.secretsBinding.allowedSecretRefs ?? []),
            approval_required: input.governance.secretsBinding.approvalRequired === true,
            injection_mode: input.governance.secretsBinding.injectionMode ?? "explicit",
            updated_at: input.governance.secretsBinding.updatedAt ?? null,
            updated_by: input.governance.secretsBinding.updatedBy ?? null
          }
        : null,
      skill_policy_plugin: input.governance?.skillPolicyPlugin
        ? {
            enabled: input.governance.skillPolicyPlugin.enabled !== false,
            scope: input.governance.skillPolicyPlugin.scope ?? "channel",
            registry: {
              skill_refs: deepClone(input.governance.skillPolicyPlugin.registry?.skillRefs ?? []),
              policy_refs: deepClone(input.governance.skillPolicyPlugin.registry?.policyRefs ?? []),
              plugin_refs: deepClone(input.governance.skillPolicyPlugin.registry?.pluginRefs ?? [])
            },
            bindings: deepClone(input.governance.skillPolicyPlugin.bindings ?? []).map((item) => ({
              binding_id: item.bindingId ?? null,
              plugin_ref: item.pluginRef ?? null,
              skill_ref: item.skillRef ?? null,
              policy_ref: item.policyRef ?? null,
              enabled: item.enabled !== false,
              scope: item.scope ?? "channel"
            })),
            updated_at: input.governance.skillPolicyPlugin.updatedAt ?? null,
            updated_by: input.governance.skillPolicyPlugin.updatedBy ?? null
          }
        : null,
      token_quota_context: input.governance?.tokenQuotaContext
        ? {
            token_used: input.governance.tokenQuotaContext.tokenUsed ?? 0,
            token_limit: input.governance.tokenQuotaContext.tokenLimit ?? null,
            quota_state: input.governance.tokenQuotaContext.quotaState ?? "healthy",
            context_tokens: input.governance.tokenQuotaContext.contextTokens ?? 0,
            context_window_tokens: input.governance.tokenQuotaContext.contextWindowTokens ?? null,
            recall_source: input.governance.tokenQuotaContext.recallSource ?? null,
            recall_hits: input.governance.tokenQuotaContext.recallHits ?? 0,
            degrade_reason: input.governance.tokenQuotaContext.degradeReason ?? null,
            updated_at: input.governance.tokenQuotaContext.updatedAt ?? null,
            updated_by: input.governance.tokenQuotaContext.updatedBy ?? null
          }
        : null,
      digital_twin: input.governance?.digitalTwin
        ? {
            twin_id: input.governance.digitalTwin.twinId ?? null,
            agent_id: input.governance.digitalTwin.agentId ?? null,
            persona_ref: input.governance.digitalTwin.personaRef ?? null,
            mode: input.governance.digitalTwin.mode ?? "advisory",
            status: input.governance.digitalTwin.status ?? "active",
            memory_scope: input.governance.digitalTwin.memoryScope ?? "channel",
            updated_at: input.governance.digitalTwin.updatedAt ?? null,
            updated_by: input.governance.digitalTwin.updatedBy ?? null
          }
        : null,
      operational_capability: input.governance?.operationalCapability
        ? {
            enabled: input.governance.operationalCapability.enabled !== false,
            capability_level: input.governance.operationalCapability.capabilityLevel ?? "managed",
            operation_modes: deepClone(input.governance.operationalCapability.operationModes ?? []),
            human_escalation_required: input.governance.operationalCapability.humanEscalationRequired !== false,
            timeline_evidence_required: input.governance.operationalCapability.timelineEvidenceRequired !== false,
            audit_evidence_required: input.governance.operationalCapability.auditEvidenceRequired !== false,
            updated_at: input.governance.operationalCapability.updatedAt ?? null,
            updated_by: input.governance.operationalCapability.updatedBy ?? null
          }
        : null,
      permission_matrix: deepClone(input.governance?.permissionMatrix ?? {}),
      state_graph: deepClone(input.governance?.stateGraph ?? {})
    },
    notification_endpoint: input.notificationEndpoint
      ? {
          browser_push: {
            enabled: Boolean(input.notificationEndpoint.browserPush?.enabled),
            endpoint_ref: input.notificationEndpoint.browserPush?.endpointRef ?? null,
            updated_at: input.notificationEndpoint.browserPush?.updatedAt ?? null,
            updated_by: input.notificationEndpoint.browserPush?.updatedBy ?? null
          },
          email: {
            enabled: Boolean(input.notificationEndpoint.email?.enabled),
            endpoint_ref: input.notificationEndpoint.email?.endpointRef ?? null,
            updated_at: input.notificationEndpoint.email?.updatedAt ?? null,
            updated_by: input.notificationEndpoint.email?.updatedBy ?? null
          }
        }
      : null,
    notification_routing_rules: {
      inbox: {
        delivery: input.notificationRoutingRules?.inbox?.delivery ?? "always",
        events: deepClone(input.notificationRoutingRules?.inbox?.events ?? ["all"])
      },
      browser_push: {
        delivery: input.notificationRoutingRules?.browserPush?.delivery ?? "allowlist",
        events: deepClone(
          input.notificationRoutingRules?.browserPush?.events ?? [
            "blocked",
            "approval_required",
            "mention",
            "pr_review_pending"
          ]
        )
      },
      email: {
        delivery: input.notificationRoutingRules?.email?.delivery ?? "allowlist_with_high_priority_fallback",
        events: deepClone(
          input.notificationRoutingRules?.email?.events ?? [
            "invite",
            "verify",
            "reset_password",
            "high_priority_escalation"
          ]
        )
      }
    },
    approval_contract: input.approvalContract
      ? {
          source: input.approvalContract.source ?? "v1_approval_hold_truth",
          trigger_events: deepClone(input.approvalContract.triggerEvents ?? []),
          anchors: {
            inbox: input.approvalContract.anchors?.inbox ?? "/v1/inbox/:actorId?topic_id=:topicId",
            approval_holds:
              input.approvalContract.anchors?.approvalHolds ??
              "/v1/topics/:topicId/approval-holds?status=:status",
            approval_decisions:
              input.approvalContract.anchors?.approvalDecisions ??
              "/v1/topics/:topicId/approval-holds/:holdId/decisions",
            run_timeline:
              input.approvalContract.anchors?.runTimeline ??
              "/v1/runs/:runId/timeline?topic_id=:topicId",
            channel_audit_trail:
              input.approvalContract.anchors?.channelAuditTrail ??
              `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`
          }
        }
      : null,
    external_memory_provider: input.externalMemoryProvider
      ? {
          provider_id: input.externalMemoryProvider.providerId ?? null,
          provider_type: input.externalMemoryProvider.providerType ?? null,
          status: input.externalMemoryProvider.status ?? "disabled",
          read_scopes: deepClone(input.externalMemoryProvider.readScopes ?? []),
          write_scopes: deepClone(input.externalMemoryProvider.writeScopes ?? []),
          recall_policy: deepClone(input.externalMemoryProvider.recallPolicy ?? null),
          retention_policy: deepClone(input.externalMemoryProvider.retentionPolicy ?? null),
          sharing_policy: deepClone(input.externalMemoryProvider.sharingPolicy ?? null),
          capabilities: deepClone(input.externalMemoryProvider.capabilities ?? {})
        }
      : null,
    repo_binding: input.repoBinding
      ? {
          topic_id: input.repoBinding.topicId ?? null,
          provider_ref: deepClone(input.repoBinding.providerRef ?? null),
          default_branch: input.repoBinding.defaultBranch ?? null,
          fixed_directory: input.repoBinding.fixedDirectory ?? null,
          workspace_installation_id: input.repoBinding.workspaceInstallationId ?? null,
          authorization_scope: input.repoBinding.authorizationScope ?? "workspace_installation",
          updated_at: input.repoBinding.updatedAt ?? null,
          updated_by: input.repoBinding.updatedBy ?? null
        }
      : null,
    write_anchors: {
      context_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      auth_identity_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      member_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      github_installation_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      skill_policy_plugin_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      token_quota_context_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      hosted_access_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      digital_twin_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      operational_capability_upsert: `/v1/channels/${encodeURIComponent(channelId)}/context`,
      orchestration_upgrade_upsert: `/v1/channels/${encodeURIComponent(channelId)}/orchestration-upgrade`,
      repo_binding_upsert: `/v1/channels/${encodeURIComponent(channelId)}/repo-binding`,
      notification_endpoint_upsert: `/v1/channels/${encodeURIComponent(channelId)}/notification-endpoint`,
      external_memory_provider_upsert: `/v1/channels/${encodeURIComponent(channelId)}/external-memory-provider`,
      memory_viewer: `/v1/channels/${encodeURIComponent(channelId)}/memory-viewer`,
      memory_search: `/v1/channels/${encodeURIComponent(channelId)}/memory/search`,
      memory_get: `/v1/channels/${encodeURIComponent(channelId)}/memory/:memoryId`,
      memory_write: `/v1/channels/${encodeURIComponent(channelId)}/memory/write`,
      memory_feedback: `/v1/channels/${encodeURIComponent(channelId)}/memory/feedback`,
      memory_promote: `/v1/channels/${encodeURIComponent(channelId)}/memory/promote`,
      memory_forget: `/v1/channels/${encodeURIComponent(channelId)}/memory/forget`,
      topic_repo_binding: "/v1/topics/:topicId/repo-binding",
      work_assignment: `/v1/channels/${encodeURIComponent(channelId)}/work-assignments/:agentId`,
      operator_action: `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
      recent_actions: `/v1/channels/${encodeURIComponent(channelId)}/recent-actions`,
      audit_trail: `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`
    },
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`,
      latest: {
        auth_identity: input.auditAnchor?.latest?.authIdentity
          ? {
              audit_id: input.auditAnchor.latest.authIdentity.auditId ?? null,
              action: input.auditAnchor.latest.authIdentity.action ?? null,
              at: input.auditAnchor.latest.authIdentity.at ?? null
            }
          : null,
        member: input.auditAnchor?.latest?.member
          ? {
              audit_id: input.auditAnchor.latest.member.auditId ?? null,
              action: input.auditAnchor.latest.member.action ?? null,
              at: input.auditAnchor.latest.member.at ?? null
            }
          : null,
        github_installation: input.auditAnchor?.latest?.githubInstallation
          ? {
              audit_id: input.auditAnchor.latest.githubInstallation.auditId ?? null,
              action: input.auditAnchor.latest.githubInstallation.action ?? null,
              at: input.auditAnchor.latest.githubInstallation.at ?? null
            }
          : null,
        sandbox_profile: input.auditAnchor?.latest?.sandboxProfile
          ? {
              audit_id: input.auditAnchor.latest.sandboxProfile.auditId ?? null,
              action: input.auditAnchor.latest.sandboxProfile.action ?? null,
              at: input.auditAnchor.latest.sandboxProfile.at ?? null
            }
          : null,
        secrets_binding: input.auditAnchor?.latest?.secretsBinding
          ? {
              audit_id: input.auditAnchor.latest.secretsBinding.auditId ?? null,
              action: input.auditAnchor.latest.secretsBinding.action ?? null,
              at: input.auditAnchor.latest.secretsBinding.at ?? null
            }
          : null,
        skill_policy_plugin: input.auditAnchor?.latest?.skillPolicyPlugin
          ? {
              audit_id: input.auditAnchor.latest.skillPolicyPlugin.auditId ?? null,
              action: input.auditAnchor.latest.skillPolicyPlugin.action ?? null,
              at: input.auditAnchor.latest.skillPolicyPlugin.at ?? null
            }
          : null,
        token_quota_context: input.auditAnchor?.latest?.tokenQuotaContext
          ? {
              audit_id: input.auditAnchor.latest.tokenQuotaContext.auditId ?? null,
              action: input.auditAnchor.latest.tokenQuotaContext.action ?? null,
              at: input.auditAnchor.latest.tokenQuotaContext.at ?? null
            }
          : null,
        hosted_access: input.auditAnchor?.latest?.hostedAccess
          ? {
              audit_id: input.auditAnchor.latest.hostedAccess.auditId ?? null,
              action: input.auditAnchor.latest.hostedAccess.action ?? null,
              at: input.auditAnchor.latest.hostedAccess.at ?? null
            }
          : null,
        digital_twin: input.auditAnchor?.latest?.digitalTwin
          ? {
              audit_id: input.auditAnchor.latest.digitalTwin.auditId ?? null,
              action: input.auditAnchor.latest.digitalTwin.action ?? null,
              at: input.auditAnchor.latest.digitalTwin.at ?? null
            }
          : null,
        operational_capability: input.auditAnchor?.latest?.operationalCapability
          ? {
              audit_id: input.auditAnchor.latest.operationalCapability.auditId ?? null,
              action: input.auditAnchor.latest.operationalCapability.action ?? null,
              at: input.auditAnchor.latest.operationalCapability.at ?? null
            }
          : null,
        multi_agent_orchestration: input.auditAnchor?.latest?.multiAgentOrchestration
          ? {
              audit_id: input.auditAnchor.latest.multiAgentOrchestration.auditId ?? null,
              action: input.auditAnchor.latest.multiAgentOrchestration.action ?? null,
              at: input.auditAnchor.latest.multiAgentOrchestration.at ?? null
            }
          : null,
        upgrade_arbitration: input.auditAnchor?.latest?.upgradeArbitration
          ? {
              audit_id: input.auditAnchor.latest.upgradeArbitration.auditId ?? null,
              action: input.auditAnchor.latest.upgradeArbitration.action ?? null,
              at: input.auditAnchor.latest.upgradeArbitration.at ?? null
            }
          : null,
        human_upgrade_chain: input.auditAnchor?.latest?.humanUpgradeChain
          ? {
              audit_id: input.auditAnchor.latest.humanUpgradeChain.auditId ?? null,
              action: input.auditAnchor.latest.humanUpgradeChain.action ?? null,
              at: input.auditAnchor.latest.humanUpgradeChain.at ?? null
            }
          : null,
        repo_binding: input.auditAnchor?.latest?.repoBinding
          ? {
              audit_id: input.auditAnchor.latest.repoBinding.auditId ?? null,
              action: input.auditAnchor.latest.repoBinding.action ?? null,
              at: input.auditAnchor.latest.repoBinding.at ?? null
            }
          : null
        ,
        notification_endpoint: input.auditAnchor?.latest?.notificationEndpoint
          ? {
              audit_id: input.auditAnchor.latest.notificationEndpoint.auditId ?? null,
              action: input.auditAnchor.latest.notificationEndpoint.action ?? null,
              at: input.auditAnchor.latest.notificationEndpoint.at ?? null
            }
          : null
        ,
        external_memory_provider: input.auditAnchor?.latest?.externalMemoryProvider
          ? {
              audit_id: input.auditAnchor.latest.externalMemoryProvider.auditId ?? null,
              action: input.auditAnchor.latest.externalMemoryProvider.action ?? null,
              at: input.auditAnchor.latest.externalMemoryProvider.at ?? null
            }
          : null
      }
    },
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelNotificationApprovalContract(input = {}) {
  const channelId = input.channelId;
  return {
    projection: "channel_notification_approval_contract",
    contract_version: "v1.stage4a2",
    channel_id: channelId,
    owner_operator_id: input.ownerOperatorId ?? null,
    notification_endpoint: {
      browser_push: {
        enabled: Boolean(input.notificationEndpoint?.browserPush?.enabled),
        endpoint_ref: input.notificationEndpoint?.browserPush?.endpointRef ?? null,
        updated_at: input.notificationEndpoint?.browserPush?.updatedAt ?? null,
        updated_by: input.notificationEndpoint?.browserPush?.updatedBy ?? null
      },
      email: {
        enabled: Boolean(input.notificationEndpoint?.email?.enabled),
        endpoint_ref: input.notificationEndpoint?.email?.endpointRef ?? null,
        updated_at: input.notificationEndpoint?.email?.updatedAt ?? null,
        updated_by: input.notificationEndpoint?.email?.updatedBy ?? null
      }
    },
    routing_rules: {
      inbox: {
        delivery: input.routingRules?.inbox?.delivery ?? "always",
        events: deepClone(input.routingRules?.inbox?.events ?? ["all"])
      },
      browser_push: {
        delivery: input.routingRules?.browserPush?.delivery ?? "allowlist",
        events: deepClone(
          input.routingRules?.browserPush?.events ?? [
            "blocked",
            "approval_required",
            "mention",
            "pr_review_pending"
          ]
        )
      },
      email: {
        delivery: input.routingRules?.email?.delivery ?? "allowlist_with_high_priority_fallback",
        events: deepClone(
          input.routingRules?.email?.events ?? [
            "invite",
            "verify",
            "reset_password",
            "high_priority_escalation"
          ]
        )
      }
    },
    approval_contract: {
      source: input.approvalContract?.source ?? "v1_approval_hold_truth",
      trigger_events: deepClone(input.approvalContract?.triggerEvents ?? []),
      anchors: {
        inbox: input.approvalContract?.anchors?.inbox ?? "/v1/inbox/:actorId?topic_id=:topicId",
        approval_holds:
          input.approvalContract?.anchors?.approvalHolds ??
          "/v1/topics/:topicId/approval-holds?status=:status",
        approval_decisions:
          input.approvalContract?.anchors?.approvalDecisions ??
          "/v1/topics/:topicId/approval-holds/:holdId/decisions",
        run_timeline:
          input.approvalContract?.anchors?.runTimeline ??
          "/v1/runs/:runId/timeline?topic_id=:topicId",
        channel_audit_trail:
          input.approvalContract?.anchors?.channelAuditTrail ??
          `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`
      }
    },
    write_anchors: {
      notification_endpoint_upsert:
        input.writeAnchors?.notificationEndpointUpsert ??
        `/v1/channels/${encodeURIComponent(channelId)}/notification-endpoint`,
      approval_decision:
        input.writeAnchors?.approvalDecision ?? "/v1/topics/:topicId/approval-holds/:holdId/decisions"
    },
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`,
      latest: {
        notification_endpoint: input.auditAnchor?.latest?.notificationEndpoint
          ? {
              audit_id: input.auditAnchor.latest.notificationEndpoint.auditId ?? null,
              action: input.auditAnchor.latest.notificationEndpoint.action ?? null,
              at: input.auditAnchor.latest.notificationEndpoint.at ?? null
            }
          : null
      }
    },
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelOrchestrationUpgradeContract(input = {}) {
  const channelId = input.channelId;
  return {
    projection: "channel_orchestration_upgrade_contract",
    contract_version: input.contractVersion ?? "v1.stage4c",
    channel_id: channelId,
    owner_operator_id: input.ownerOperatorId ?? null,
    multi_agent_orchestration: input.multiAgentOrchestration
      ? {
          orchestration_id: input.multiAgentOrchestration.orchestrationId ?? null,
          mode: input.multiAgentOrchestration.mode ?? "handoff_graph",
          status: input.multiAgentOrchestration.status ?? "draft",
          plan_ref: input.multiAgentOrchestration.planRef ?? null,
          participant_agent_ids: deepClone(input.multiAgentOrchestration.participantAgentIds ?? []),
          participants: deepClone(input.multiAgentOrchestration.participants ?? []).map((item) => ({
            agent_id: item.agentId ?? null,
            role: item.role ?? "worker",
            duty: item.duty ?? null,
            required: item.required !== false
          })),
          dependency_edges: deepClone(input.multiAgentOrchestration.dependencyEdges ?? []).map((item) => ({
            from_agent_id: item.fromAgentId ?? null,
            to_agent_id: item.toAgentId ?? null,
            handoff_required: item.handoffRequired !== false,
            condition: item.condition ?? null
          })),
          quorum: {
            min_success_count: input.multiAgentOrchestration.quorum?.minSuccessCount ?? 1,
            max_parallel_agents: input.multiAgentOrchestration.quorum?.maxParallelAgents ?? 1,
            stop_on_blocked: input.multiAgentOrchestration.quorum?.stopOnBlocked !== false,
            stop_on_failure_count: input.multiAgentOrchestration.quorum?.stopOnFailureCount ?? 1
          },
          stop_conditions: deepClone(input.multiAgentOrchestration.stopConditions ?? []),
          escalation_triggers: deepClone(input.multiAgentOrchestration.escalationTriggers ?? []),
          evidence_anchors: {
            topic_state: input.multiAgentOrchestration.evidenceAnchors?.topicState ?? "/v1/topics/:topicId/topic-state",
            run_timeline:
              input.multiAgentOrchestration.evidenceAnchors?.runTimeline ??
              "/v1/runs/:runId/timeline?topic_id=:topicId",
            execution_inbox:
              input.multiAgentOrchestration.evidenceAnchors?.executionInbox ??
              "/v1/topics/:topicId/execution-inbox?actor_id=:actorId",
            topic_inbox: input.multiAgentOrchestration.evidenceAnchors?.topicInbox ?? "/v1/inbox/:actorId?topic_id=:topicId",
            recent_actions:
              input.multiAgentOrchestration.evidenceAnchors?.recentActions ??
              `/v1/channels/${encodeURIComponent(channelId)}/recent-actions`,
            operator_actions:
              input.multiAgentOrchestration.evidenceAnchors?.operatorActions ??
              `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
            audit_trail:
              input.multiAgentOrchestration.evidenceAnchors?.auditTrail ??
              `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`
          },
          updated_at: input.multiAgentOrchestration.updatedAt ?? null,
          updated_by: input.multiAgentOrchestration.updatedBy ?? null
        }
      : null,
    upgrade_arbitration: input.upgradeArbitration
      ? {
          arbitration_id: input.upgradeArbitration.arbitrationId ?? null,
          status: input.upgradeArbitration.status ?? "pending",
          reason: input.upgradeArbitration.reason ?? null,
          candidate_paths: deepClone(input.upgradeArbitration.candidatePaths ?? []).map((item) => ({
            path_id: item.pathId ?? null,
            target_mode: item.targetMode ?? null,
            reason: item.reason ?? null,
            evidence_refs: deepClone(item.evidenceRefs ?? [])
          })),
          selected_path_id: input.upgradeArbitration.selectedPathId ?? null,
          human_upgrade_chain: input.upgradeArbitration.humanUpgradeChain
            ? {
                escalation_id: input.upgradeArbitration.humanUpgradeChain.escalationId ?? null,
                status: input.upgradeArbitration.humanUpgradeChain.status ?? "pending",
                approval_required: input.upgradeArbitration.humanUpgradeChain.approvalRequired !== false,
                approval_id: input.upgradeArbitration.humanUpgradeChain.approvalId ?? null,
                approved_by: input.upgradeArbitration.humanUpgradeChain.approvedBy ?? null,
                approved_at: input.upgradeArbitration.humanUpgradeChain.approvedAt ?? null,
                rollback_allowed: input.upgradeArbitration.humanUpgradeChain.rollbackAllowed !== false,
                rollback_ref: input.upgradeArbitration.humanUpgradeChain.rollbackRef ?? null,
                operator_action_ref:
                  input.upgradeArbitration.humanUpgradeChain.operatorActionRef ??
                  `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
                approval_hold_ref:
                  input.upgradeArbitration.humanUpgradeChain.approvalHoldRef ??
                  "/v1/topics/:topicId/approval-holds?status=:status",
                decision_ref:
                  input.upgradeArbitration.humanUpgradeChain.decisionRef ??
                  "/v1/topics/:topicId/approval-holds/:holdId/decisions"
              }
            : null,
          updated_at: input.upgradeArbitration.updatedAt ?? null,
          updated_by: input.upgradeArbitration.updatedBy ?? null
        }
      : null,
    write_anchors: {
      orchestration_upgrade_upsert:
        input.writeAnchors?.orchestrationUpgradeUpsert ??
        `/v1/channels/${encodeURIComponent(channelId)}/orchestration-upgrade`,
      operator_action: input.writeAnchors?.operatorAction ?? `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
      approval_decision: input.writeAnchors?.approvalDecision ?? "/v1/topics/:topicId/approval-holds/:holdId/decisions"
    },
    timeline_anchor: {
      recent_actions:
        input.timelineAnchor?.recentActions ?? `/v1/channels/${encodeURIComponent(channelId)}/recent-actions`,
      operator_actions:
        input.timelineAnchor?.operatorActions ?? `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
      run_timeline: input.timelineAnchor?.runTimeline ?? "/v1/runs/:runId/timeline?topic_id=:topicId",
      execution_inbox: input.timelineAnchor?.executionInbox ?? "/v1/topics/:topicId/execution-inbox?actor_id=:actorId",
      topic_inbox: input.timelineAnchor?.topicInbox ?? "/v1/inbox/:actorId?topic_id=:topicId",
      approval_holds: input.timelineAnchor?.approvalHolds ?? "/v1/topics/:topicId/approval-holds?status=:status",
      approval_decisions:
        input.timelineAnchor?.approvalDecisions ?? "/v1/topics/:topicId/approval-holds/:holdId/decisions"
    },
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`,
      latest: {
        multi_agent_orchestration: input.auditAnchor?.latest?.multiAgentOrchestration
          ? {
              audit_id: input.auditAnchor.latest.multiAgentOrchestration.auditId ?? null,
              action: input.auditAnchor.latest.multiAgentOrchestration.action ?? null,
              at: input.auditAnchor.latest.multiAgentOrchestration.at ?? null
            }
          : null,
        upgrade_arbitration: input.auditAnchor?.latest?.upgradeArbitration
          ? {
              audit_id: input.auditAnchor.latest.upgradeArbitration.auditId ?? null,
              action: input.auditAnchor.latest.upgradeArbitration.action ?? null,
              at: input.auditAnchor.latest.upgradeArbitration.at ?? null
            }
          : null,
        human_upgrade_chain: input.auditAnchor?.latest?.humanUpgradeChain
          ? {
              audit_id: input.auditAnchor.latest.humanUpgradeChain.auditId ?? null,
              action: input.auditAnchor.latest.humanUpgradeChain.action ?? null,
              at: input.auditAnchor.latest.humanUpgradeChain.at ?? null
            }
          : null
      }
    },
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelExternalMemoryProviderContract(input = {}) {
  const channelId = input.channelId;
  return {
    projection: "channel_external_memory_provider_contract",
    contract_version: input.contractVersion ?? "v1.stage4b",
    channel_id: channelId,
    owner_operator_id: input.ownerOperatorId ?? null,
    external_memory_provider: input.externalMemoryProvider
      ? {
          provider_id: input.externalMemoryProvider.providerId ?? null,
          provider_type: input.externalMemoryProvider.providerType ?? null,
          status: input.externalMemoryProvider.status ?? "disabled",
          read_scopes: deepClone(input.externalMemoryProvider.readScopes ?? []),
          write_scopes: deepClone(input.externalMemoryProvider.writeScopes ?? []),
          recall_policy: deepClone(input.externalMemoryProvider.recallPolicy ?? null),
          retention_policy: deepClone(input.externalMemoryProvider.retentionPolicy ?? null),
          sharing_policy: deepClone(input.externalMemoryProvider.sharingPolicy ?? null),
          capabilities: deepClone(input.externalMemoryProvider.capabilities ?? {})
        }
      : null,
    write_anchors: {
      provider_upsert:
        input.writeAnchors?.providerUpsert ??
        `/v1/channels/${encodeURIComponent(channelId)}/external-memory-provider`,
      memory_search:
        input.writeAnchors?.memorySearch ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/search`,
      memory_get:
        input.writeAnchors?.memoryGet ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/:memoryId`,
      memory_write:
        input.writeAnchors?.memoryWrite ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/write`,
      memory_feedback:
        input.writeAnchors?.memoryFeedback ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/feedback`,
      memory_promote:
        input.writeAnchors?.memoryPromote ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/promote`,
      memory_forget:
        input.writeAnchors?.memoryForget ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/forget`
    },
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`,
      latest: {
        external_memory_provider: input.auditAnchor?.latest?.externalMemoryProvider
          ? {
              audit_id: input.auditAnchor.latest.externalMemoryProvider.auditId ?? null,
              action: input.auditAnchor.latest.externalMemoryProvider.action ?? null,
              at: input.auditAnchor.latest.externalMemoryProvider.at ?? null
            }
          : null,
        memory_write: input.auditAnchor?.latest?.memoryWrite
          ? {
              audit_id: input.auditAnchor.latest.memoryWrite.auditId ?? null,
              action: input.auditAnchor.latest.memoryWrite.action ?? null,
              at: input.auditAnchor.latest.memoryWrite.at ?? null
            }
          : null,
        memory_feedback: input.auditAnchor?.latest?.memoryFeedback
          ? {
              audit_id: input.auditAnchor.latest.memoryFeedback.auditId ?? null,
              action: input.auditAnchor.latest.memoryFeedback.action ?? null,
              at: input.auditAnchor.latest.memoryFeedback.at ?? null
            }
          : null,
        memory_promote: input.auditAnchor?.latest?.memoryPromote
          ? {
              audit_id: input.auditAnchor.latest.memoryPromote.auditId ?? null,
              action: input.auditAnchor.latest.memoryPromote.action ?? null,
              at: input.auditAnchor.latest.memoryPromote.at ?? null
            }
          : null,
        memory_forget: input.auditAnchor?.latest?.memoryForget
          ? {
              audit_id: input.auditAnchor.latest.memoryForget.auditId ?? null,
              action: input.auditAnchor.latest.memoryForget.action ?? null,
              at: input.auditAnchor.latest.memoryForget.at ?? null
            }
          : null
      }
    },
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelMemoryEntry(input = {}) {
  return {
    memory_id: input.memoryId ?? null,
    provider_memory_id: input.providerMemoryId ?? null,
    scope: input.scope ?? null,
    content: input.content ?? null,
    source_action: input.sourceAction ?? "memory_write",
    source_ref: input.sourceRef ?? null,
    status: input.status ?? "active",
    feedback: input.feedback
      ? {
          verdict: input.feedback.verdict ?? null,
          note: input.feedback.note ?? null,
          updated_at: input.feedback.updatedAt ?? null,
          updated_by: input.feedback.updatedBy ?? null
        }
      : null,
    promoted_at: input.promotedAt ?? null,
    forgotten_at: input.forgottenAt ?? null,
    created_at: input.createdAt ?? null,
    created_by: input.createdBy ?? null,
    updated_at: input.updatedAt ?? null,
    updated_by: input.updatedBy ?? null
  };
}

function serializeChannelMemoryViewerProjection(input = {}) {
  const channelId = input.channelId;
  return {
    projection: "memory_viewer_projection",
    contract_version: "v1.stage4b",
    channel_id: channelId,
    owner_operator_id: input.ownerOperatorId ?? null,
    external_memory_provider: serializeChannelExternalMemoryProviderContract({
      channelId,
      ownerOperatorId: input.ownerOperatorId,
      externalMemoryProvider: input.provider,
      writeAnchors: input.writeAnchors,
      auditAnchor: input.auditAnchor,
      updatedAt: input.updatedAt
    }).external_memory_provider,
    items: (input.items ?? []).map((entry) => serializeChannelMemoryEntry(entry)),
    summary: {
      total_entries: input.summary?.totalEntries ?? 0,
      active_entries: input.summary?.activeEntries ?? 0,
      forgotten_entries: input.summary?.forgottenEntries ?? 0
    },
    write_anchors: {
      memory_write: input.writeAnchors?.memoryWrite ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/write`,
      memory_feedback:
        input.writeAnchors?.memoryFeedback ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/feedback`,
      memory_promote:
        input.writeAnchors?.memoryPromote ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/promote`,
      memory_forget: input.writeAnchors?.memoryForget ?? `/v1/channels/${encodeURIComponent(channelId)}/memory/forget`
    },
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? `/v1/channels/${encodeURIComponent(channelId)}/audit-trail`,
      latest: {
        external_memory_provider: input.auditAnchor?.latest?.externalMemoryProvider
          ? {
              audit_id: input.auditAnchor.latest.externalMemoryProvider.auditId ?? null,
              action: input.auditAnchor.latest.externalMemoryProvider.action ?? null,
              at: input.auditAnchor.latest.externalMemoryProvider.at ?? null
            }
          : null,
        memory_write: input.auditAnchor?.latest?.memoryWrite
          ? {
              audit_id: input.auditAnchor.latest.memoryWrite.auditId ?? null,
              action: input.auditAnchor.latest.memoryWrite.action ?? null,
              at: input.auditAnchor.latest.memoryWrite.at ?? null
            }
          : null,
        memory_feedback: input.auditAnchor?.latest?.memoryFeedback
          ? {
              audit_id: input.auditAnchor.latest.memoryFeedback.auditId ?? null,
              action: input.auditAnchor.latest.memoryFeedback.action ?? null,
              at: input.auditAnchor.latest.memoryFeedback.at ?? null
            }
          : null,
        memory_promote: input.auditAnchor?.latest?.memoryPromote
          ? {
              audit_id: input.auditAnchor.latest.memoryPromote.auditId ?? null,
              action: input.auditAnchor.latest.memoryPromote.action ?? null,
              at: input.auditAnchor.latest.memoryPromote.at ?? null
            }
          : null,
        memory_forget: input.auditAnchor?.latest?.memoryForget
          ? {
              audit_id: input.auditAnchor.latest.memoryForget.auditId ?? null,
              action: input.auditAnchor.latest.memoryForget.action ?? null,
              at: input.auditAnchor.latest.memoryForget.at ?? null
            }
          : null
      }
    },
    next_cursor: input.nextCursor ?? null,
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelRepoBindingConfig(input = {}) {
  return {
    projection: "channel_repo_binding_config",
    contract_version: "v1.stage4a1",
    channel_id: input.channelId,
    owner_operator_id: input.ownerOperatorId ?? null,
    governance: {
      github_installation: input.governance?.githubInstallation
        ? {
            installation_id: input.governance.githubInstallation.installationId ?? null,
            workspace_id: input.governance.githubInstallation.workspaceId ?? null,
            status: input.governance.githubInstallation.status ?? null,
            authorized_repos: deepClone(input.governance.githubInstallation.authorizedRepos ?? [])
          }
        : null,
      permission_matrix: deepClone(input.governance?.permissionMatrix ?? {})
    },
    repo_binding: input.repoBinding
      ? {
          topic_id: input.repoBinding.topicId ?? null,
          provider_ref: deepClone(input.repoBinding.providerRef ?? null),
          default_branch: input.repoBinding.defaultBranch ?? null,
          fixed_directory: input.repoBinding.fixedDirectory ?? null,
          workspace_installation_id: input.repoBinding.workspaceInstallationId ?? null,
          authorization_scope: input.repoBinding.authorizationScope ?? "workspace_installation",
          updated_at: input.repoBinding.updatedAt ?? null,
          updated_by: input.repoBinding.updatedBy ?? null
        }
      : null,
    audit_anchor: {
      trail: input.auditAnchor?.trail ?? null,
      latest: {
        repo_binding: input.auditAnchor?.latest?.repoBinding
          ? {
              audit_id: input.auditAnchor.latest.repoBinding.auditId ?? null,
              action: input.auditAnchor.latest.repoBinding.action ?? null,
              at: input.auditAnchor.latest.repoBinding.at ?? null
            }
          : null
      }
    },
    updated_at: input.updatedAt ?? null
  };
}

function serializeChannelAuditEntry(entry) {
  return {
    audit_id: entry.auditId,
    channel_id: entry.channelId,
    actor_id: entry.actorId,
    action: entry.action,
    target: entry.target,
    at: entry.at,
    policy_snapshot: deepClone(entry.policySnapshot ?? {}),
    details: deepClone(entry.details ?? {})
  };
}

function serializeChannelWorkAssignment(item) {
  return {
    channel_id: item.channelId,
    owner_operator_id: item.ownerOperatorId ?? null,
    agent_id: item.agentId,
    assigned_channel_id: item.assignedChannelId ?? null,
    assigned_thread_id: item.assignedThreadId ?? null,
    assigned_workitem_id: item.assignedWorkitemId ?? null,
    default_duty: item.defaultDuty ?? null,
    assignment_note: item.assignmentNote ?? null,
    runtime_agent_status: item.runtimeAgentStatus ?? "unknown",
    pairing_state: item.pairingState ?? "unknown",
    machine_id: item.machineId ?? null,
    runtime_id: item.runtimeId ?? null,
    active_worktree_claim: item.activeWorktreeClaim
      ? {
          claim_key: item.activeWorktreeClaim.claimKey,
          repo_ref: item.activeWorktreeClaim.repoRef,
          branch: item.activeWorktreeClaim.branch,
          lane_id: item.activeWorktreeClaim.laneId ?? null
        }
      : null,
    status: item.status ?? "unknown",
    last_action_at: item.lastActionAt ?? null,
    assigned_at: item.assignedAt ?? null,
    updated_at: item.updatedAt ?? null
  };
}

function serializeChannelOperatorAction(item) {
  return {
    action_id: item.actionId,
    channel_id: item.channelId,
    owner_operator_id: item.ownerOperatorId ?? null,
    operator_id: item.operatorId ?? null,
    action_type: item.actionType,
    status: item.status ?? "accepted",
    agent_id: item.agentId ?? null,
    thread_id: item.threadId ?? null,
    workitem_id: item.workitemId ?? null,
    note: item.note ?? null,
    approval_id: item.approvalId ?? null,
    payload: deepClone(item.payload ?? {}),
    enforcement: deepClone(item.enforcement ?? null),
    target: item.target ?? null,
    at: item.at ?? null,
    policy_snapshot: deepClone(item.policySnapshot ?? {})
  };
}

function serializeChannelRecentAction(item) {
  return {
    recent_action_id: item.recentActionId,
    channel_id: item.channelId,
    owner_operator_id: item.ownerOperatorId ?? null,
    action: item.action,
    action_family: item.actionFamily,
    actor_id: item.actorId ?? null,
    target: item.target ?? null,
    at: item.at ?? null,
    operator_scope: {
      agent_id: item.operatorScope?.agentId ?? null,
      thread_id: item.operatorScope?.threadId ?? null,
      workitem_id: item.operatorScope?.workitemId ?? null
    },
    policy_snapshot: deepClone(item.policySnapshot ?? {}),
    details: deepClone(item.details ?? {})
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

function serializeTopicStatusReadModel(overview, coarseModel) {
  const mergeLifecycle = serializeMergeLifecycle(overview);
  return {
    topic_id: overview.topicId,
    revision: overview.revision,
    topic_state: serializeTopicState(overview),
    merge_lifecycle: mergeLifecycle,
    delivery_state: serializeDeliveryState(overview.truth.deliveryState),
    active_actor_count: Array.isArray(coarseModel.activeAgents) ? coarseModel.activeAgents.length : 0,
    blocked_actor_count: Array.isArray(coarseModel.blockedAgents) ? coarseModel.blockedAgents.length : 0,
    pending_approval_count: coarseModel.pendingApprovalCount,
    open_conflict_count: coarseModel.openConflictCount,
    blocker_count: coarseModel.blockerCount,
    risk_flags: deepClone(coarseModel.riskFlags),
    evidence_anchor: deepClone(mergeLifecycle.evidence_anchor),
    updated_at: overview.updatedAt
  };
}

function serializeTaskAllocationReadModel(overview) {
  const tasks = deepClone(overview.truth.taskAllocation ?? []);
  const assignedCount = tasks.filter((task) => {
    if (!task || typeof task !== "object") {
      return false;
    }
    const assigneeKeys = ["worker_actor_id", "workerActorId", "assignee_actor_id", "assigneeActorId", "assignee"];
    for (const key of assigneeKeys) {
      if (typeof task[key] === "string" && task[key].trim().length > 0) {
        return true;
      }
    }
    return false;
  }).length;

  return {
    topic_id: overview.topicId,
    revision: overview.revision,
    items: tasks,
    summary: {
      total_tasks: tasks.length,
      assigned_tasks: assignedCount,
      unassigned_tasks: tasks.length - assignedCount
    },
    evidence_anchor: {
      source: "server_owned",
      truth_path: "topic.truth.taskAllocation"
    },
    updated_at: overview.updatedAt
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
    code === "idempotency_key_conflict" ||
    code === "worktree_isolation_conflict"
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

      if (route.route === "V1_GET_CHANNEL_CONTEXT") {
        const context = coordinator.getChannelContextContract(route.channelId);
        sendJson(response, 200, {
          context: serializeChannelContextContract(context),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_CHANNEL_CONTEXT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_channel_context", "channel context payload must be object");
        const allowedFields = new Set([
          "operator_id",
          "workspace_id",
          "workspace_root",
          "baseline_ref",
          "fixed_directory",
          "doc_paths",
          "runtime_entries",
          "rule_entries",
          "auth_identity",
          "member",
          "github_installation",
          "sandbox_profile",
          "secrets_binding",
          "skill_policy_plugin",
          "token_quota_context",
          "hosted_access",
          "digital_twin",
          "operational_capability",
          "policy_snapshot"
        ]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_channel_context_field", `unsupported channel context field: ${key}`);
          }
        }
        if (body.auth_identity !== undefined) {
          assertObjectBody(body.auth_identity, "invalid_auth_identity", "auth_identity payload must be object");
          const allowedAuthIdentityFields = new Set(["identity_id", "provider", "subject_ref", "github_login", "status"]);
          for (const key of Object.keys(body.auth_identity)) {
            if (!allowedAuthIdentityFields.has(key)) {
              throw new CoordinatorError("invalid_auth_identity_field", `unsupported auth_identity field: ${key}`);
            }
          }
        }
        if (body.member !== undefined) {
          assertObjectBody(body.member, "invalid_member", "member payload must be object");
          const allowedMemberFields = new Set(["member_id", "role", "status"]);
          for (const key of Object.keys(body.member)) {
            if (!allowedMemberFields.has(key)) {
              throw new CoordinatorError("invalid_member_field", `unsupported member field: ${key}`);
            }
          }
        }
        if (body.github_installation !== undefined) {
          assertObjectBody(body.github_installation, "invalid_github_installation", "github_installation payload must be object");
          const allowedInstallationFields = new Set([
            "installation_id",
            "provider",
            "workspace_id",
            "status",
            "authorized_repos"
          ]);
          for (const key of Object.keys(body.github_installation)) {
            if (!allowedInstallationFields.has(key)) {
              throw new CoordinatorError("invalid_github_installation_field", `unsupported github_installation field: ${key}`);
            }
          }
        }
        if (body.sandbox_profile !== undefined) {
          if (typeof body.sandbox_profile !== "string" || body.sandbox_profile.trim().length === 0) {
            throw new CoordinatorError("invalid_sandbox_profile", "sandbox_profile must be non-empty string");
          }
        }
        if (body.secrets_binding !== undefined) {
          assertObjectBody(body.secrets_binding, "invalid_secrets_binding", "secrets_binding payload must be object");
          const allowedSecretsBindingFields = new Set(["allowed_secret_refs", "approval_required", "injection_mode"]);
          for (const key of Object.keys(body.secrets_binding)) {
            if (!allowedSecretsBindingFields.has(key)) {
              throw new CoordinatorError("invalid_secrets_binding_field", `unsupported secrets_binding field: ${key}`);
            }
          }
          if (!Array.isArray(body.secrets_binding.allowed_secret_refs)) {
            throw new CoordinatorError(
              "invalid_secrets_binding_refs",
              "secrets_binding.allowed_secret_refs must be string[]"
            );
          }
          if (
            body.secrets_binding.approval_required !== undefined &&
            typeof body.secrets_binding.approval_required !== "boolean"
          ) {
            throw new CoordinatorError(
              "invalid_secrets_binding_approval_required",
              "secrets_binding.approval_required must be boolean"
            );
          }
          if (
            body.secrets_binding.injection_mode !== undefined &&
            (typeof body.secrets_binding.injection_mode !== "string" ||
              body.secrets_binding.injection_mode.trim().length === 0)
          ) {
            throw new CoordinatorError("invalid_secrets_injection_mode", "secrets_binding.injection_mode must be string");
          }
        }
        if (body.skill_policy_plugin !== undefined) {
          assertObjectBody(body.skill_policy_plugin, "invalid_skill_policy_plugin", "skill_policy_plugin payload must be object");
          const allowedSkillPolicyPluginFields = new Set(["enabled", "scope", "registry", "bindings"]);
          for (const key of Object.keys(body.skill_policy_plugin)) {
            if (!allowedSkillPolicyPluginFields.has(key)) {
              throw new CoordinatorError(
                "invalid_skill_policy_plugin_field",
                `unsupported skill_policy_plugin field: ${key}`
              );
            }
          }
          if (body.skill_policy_plugin.enabled !== undefined && typeof body.skill_policy_plugin.enabled !== "boolean") {
            throw new CoordinatorError("invalid_skill_policy_plugin_enabled", "skill_policy_plugin.enabled must be boolean");
          }
          if (
            body.skill_policy_plugin.scope !== undefined &&
            (typeof body.skill_policy_plugin.scope !== "string" || body.skill_policy_plugin.scope.trim().length === 0)
          ) {
            throw new CoordinatorError("invalid_skill_policy_plugin_scope", "skill_policy_plugin.scope must be non-empty string");
          }
          if (body.skill_policy_plugin.registry !== undefined) {
            assertObjectBody(
              body.skill_policy_plugin.registry,
              "invalid_skill_policy_plugin_registry",
              "skill_policy_plugin.registry must be object"
            );
            const allowedRegistryFields = new Set(["skill_refs", "policy_refs", "plugin_refs"]);
            for (const key of Object.keys(body.skill_policy_plugin.registry)) {
              if (!allowedRegistryFields.has(key)) {
                throw new CoordinatorError(
                  "invalid_skill_policy_plugin_registry_field",
                  `unsupported skill_policy_plugin.registry field: ${key}`
                );
              }
            }
            const registryLists = ["skill_refs", "policy_refs", "plugin_refs"];
            for (const key of registryLists) {
              if (
                body.skill_policy_plugin.registry[key] !== undefined &&
                !Array.isArray(body.skill_policy_plugin.registry[key])
              ) {
                throw new CoordinatorError(
                  "invalid_skill_policy_plugin_registry_refs",
                  `skill_policy_plugin.registry.${key} must be string[]`
                );
              }
            }
          }
          if (body.skill_policy_plugin.bindings !== undefined) {
            if (!Array.isArray(body.skill_policy_plugin.bindings)) {
              throw new CoordinatorError("invalid_skill_policy_plugin_bindings", "skill_policy_plugin.bindings must be object[]");
            }
            for (const item of body.skill_policy_plugin.bindings) {
              assertObjectBody(item, "invalid_skill_policy_plugin_binding", "skill_policy_plugin binding must be object");
              const allowedBindingFields = new Set(["binding_id", "plugin_ref", "skill_ref", "policy_ref", "enabled", "scope"]);
              for (const key of Object.keys(item)) {
                if (!allowedBindingFields.has(key)) {
                  throw new CoordinatorError(
                    "invalid_skill_policy_plugin_binding_field",
                    `unsupported skill_policy_plugin.bindings field: ${key}`
                  );
                }
              }
              if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
                throw new CoordinatorError(
                  "invalid_skill_policy_plugin_binding_enabled",
                  "skill_policy_plugin binding enabled must be boolean"
                );
              }
              if (item.scope !== undefined && (typeof item.scope !== "string" || item.scope.trim().length === 0)) {
                throw new CoordinatorError(
                  "invalid_skill_policy_plugin_binding_scope",
                  "skill_policy_plugin binding scope must be non-empty string"
                );
              }
            }
          }
        }
        if (body.token_quota_context !== undefined) {
          assertObjectBody(body.token_quota_context, "invalid_token_quota_context", "token_quota_context payload must be object");
          const allowedTokenQuotaContextFields = new Set([
            "token_used",
            "token_limit",
            "quota_state",
            "context_tokens",
            "context_window_tokens",
            "recall_source",
            "recall_hits",
            "degrade_reason"
          ]);
          for (const key of Object.keys(body.token_quota_context)) {
            if (!allowedTokenQuotaContextFields.has(key)) {
              throw new CoordinatorError("invalid_token_quota_context_field", `unsupported token_quota_context field: ${key}`);
            }
          }
        }
        if (body.hosted_access !== undefined) {
          assertObjectBody(body.hosted_access, "invalid_hosted_access", "hosted_access payload must be object");
          const allowedHostedAccessFields = new Set([
            "hosted_web_url",
            "access_mode",
            "non_local_access_enabled",
            "stable_login_state",
            "login_provider",
            "session_ttl_minutes"
          ]);
          for (const key of Object.keys(body.hosted_access)) {
            if (!allowedHostedAccessFields.has(key)) {
              throw new CoordinatorError("invalid_hosted_access_field", `unsupported hosted_access field: ${key}`);
            }
          }
          if (
            body.hosted_access.hosted_web_url !== undefined &&
            (typeof body.hosted_access.hosted_web_url !== "string" || body.hosted_access.hosted_web_url.trim().length === 0)
          ) {
            throw new CoordinatorError("hosted_web_url_required", "hosted_access.hosted_web_url is required");
          }
          if (
            body.hosted_access.access_mode !== undefined &&
            (typeof body.hosted_access.access_mode !== "string" || body.hosted_access.access_mode.trim().length === 0)
          ) {
            throw new CoordinatorError("invalid_hosted_access_mode", "hosted_access.access_mode must be non-empty string");
          }
          if (
            body.hosted_access.non_local_access_enabled !== undefined &&
            typeof body.hosted_access.non_local_access_enabled !== "boolean"
          ) {
            throw new CoordinatorError(
              "invalid_non_local_access_enabled",
              "hosted_access.non_local_access_enabled must be boolean"
            );
          }
          if (
            body.hosted_access.stable_login_state !== undefined &&
            (typeof body.hosted_access.stable_login_state !== "string" ||
              body.hosted_access.stable_login_state.trim().length === 0)
          ) {
            throw new CoordinatorError(
              "invalid_stable_login_state",
              "hosted_access.stable_login_state must be non-empty string"
            );
          }
          if (
            body.hosted_access.login_provider !== undefined &&
            (typeof body.hosted_access.login_provider !== "string" || body.hosted_access.login_provider.trim().length === 0)
          ) {
            throw new CoordinatorError("invalid_hosted_access_field", "hosted_access.login_provider must be non-empty string");
          }
          if (
            body.hosted_access.session_ttl_minutes !== undefined &&
            body.hosted_access.session_ttl_minutes !== null &&
            (!Number.isInteger(body.hosted_access.session_ttl_minutes) || body.hosted_access.session_ttl_minutes <= 0)
          ) {
            throw new CoordinatorError(
              "invalid_session_ttl_minutes",
              "hosted_access.session_ttl_minutes must be positive integer"
            );
          }
        }
        if (body.digital_twin !== undefined) {
          assertObjectBody(body.digital_twin, "invalid_digital_twin", "digital_twin payload must be object");
          const allowedDigitalTwinFields = new Set([
            "twin_id",
            "agent_id",
            "persona_ref",
            "mode",
            "status",
            "memory_scope"
          ]);
          for (const key of Object.keys(body.digital_twin)) {
            if (!allowedDigitalTwinFields.has(key)) {
              throw new CoordinatorError("invalid_digital_twin_field", `unsupported digital_twin field: ${key}`);
            }
          }
          if (body.digital_twin.agent_id !== undefined && (typeof body.digital_twin.agent_id !== "string" || body.digital_twin.agent_id.trim().length === 0)) {
            throw new CoordinatorError("invalid_digital_twin_agent_id", "digital_twin.agent_id must be non-empty string");
          }
          if (body.digital_twin.mode !== undefined && (typeof body.digital_twin.mode !== "string" || body.digital_twin.mode.trim().length === 0)) {
            throw new CoordinatorError("invalid_digital_twin_mode", "digital_twin.mode must be non-empty string");
          }
          if (body.digital_twin.status !== undefined && (typeof body.digital_twin.status !== "string" || body.digital_twin.status.trim().length === 0)) {
            throw new CoordinatorError("invalid_digital_twin_status", "digital_twin.status must be non-empty string");
          }
          if (
            body.digital_twin.memory_scope !== undefined &&
            (typeof body.digital_twin.memory_scope !== "string" || body.digital_twin.memory_scope.trim().length === 0)
          ) {
            throw new CoordinatorError("invalid_digital_twin_memory_scope", "digital_twin.memory_scope must be non-empty string");
          }
        }
        if (body.operational_capability !== undefined) {
          assertObjectBody(
            body.operational_capability,
            "invalid_operational_capability",
            "operational_capability payload must be object"
          );
          const allowedOperationalCapabilityFields = new Set([
            "enabled",
            "capability_level",
            "operation_modes",
            "human_escalation_required",
            "timeline_evidence_required",
            "audit_evidence_required"
          ]);
          for (const key of Object.keys(body.operational_capability)) {
            if (!allowedOperationalCapabilityFields.has(key)) {
              throw new CoordinatorError(
                "invalid_operational_capability_field",
                `unsupported operational_capability field: ${key}`
              );
            }
          }
          if (
            body.operational_capability.enabled !== undefined &&
            typeof body.operational_capability.enabled !== "boolean"
          ) {
            throw new CoordinatorError(
              "invalid_operational_capability_enabled",
              "operational_capability.enabled must be boolean"
            );
          }
          if (
            body.operational_capability.capability_level !== undefined &&
            (typeof body.operational_capability.capability_level !== "string" ||
              body.operational_capability.capability_level.trim().length === 0)
          ) {
            throw new CoordinatorError(
              "invalid_operational_capability_level",
              "operational_capability.capability_level must be non-empty string"
            );
          }
          if (
            body.operational_capability.operation_modes !== undefined &&
            !Array.isArray(body.operational_capability.operation_modes)
          ) {
            throw new CoordinatorError(
              "invalid_operational_capability_modes",
              "operational_capability.operation_modes must be string[]"
            );
          }
          const booleanFields = [
            "human_escalation_required",
            "timeline_evidence_required",
            "audit_evidence_required"
          ];
          for (const key of booleanFields) {
            if (body.operational_capability[key] !== undefined && typeof body.operational_capability[key] !== "boolean") {
              throw new CoordinatorError(
                `invalid_operational_capability_${key}`,
                `operational_capability.${key} must be boolean`
              );
            }
          }
        }
        const context = coordinator.upsertChannelContextContract(route.channelId, {
          operatorId: body.operator_id,
          workspaceId: body.workspace_id,
          workspaceRoot: body.workspace_root,
          baselineRef: body.baseline_ref,
          fixedDirectory: body.fixed_directory,
          docPaths: body.doc_paths,
          runtimeEntries: body.runtime_entries,
          ruleEntries: body.rule_entries,
          authIdentity: body.auth_identity
            ? {
                identityId: body.auth_identity.identity_id,
                provider: body.auth_identity.provider,
                subjectRef: body.auth_identity.subject_ref,
                githubLogin: body.auth_identity.github_login,
                status: body.auth_identity.status
              }
            : undefined,
          member: body.member
            ? {
                memberId: body.member.member_id,
                role: body.member.role,
                status: body.member.status
              }
            : undefined,
          githubInstallation: body.github_installation
            ? {
                installationId: body.github_installation.installation_id,
                provider: body.github_installation.provider,
                workspaceId: body.github_installation.workspace_id,
                status: body.github_installation.status,
                authorizedRepos: body.github_installation.authorized_repos
              }
            : undefined,
          sandboxProfile: body.sandbox_profile,
          secretsBinding: body.secrets_binding
            ? {
                allowedSecretRefs: body.secrets_binding.allowed_secret_refs,
                approvalRequired: body.secrets_binding.approval_required,
                injectionMode: body.secrets_binding.injection_mode
              }
            : undefined,
          skillPolicyPlugin: body.skill_policy_plugin
            ? {
                enabled: body.skill_policy_plugin.enabled,
                scope: body.skill_policy_plugin.scope,
                registry: body.skill_policy_plugin.registry
                  ? {
                      skillRefs: body.skill_policy_plugin.registry.skill_refs,
                      policyRefs: body.skill_policy_plugin.registry.policy_refs,
                      pluginRefs: body.skill_policy_plugin.registry.plugin_refs
                    }
                  : undefined,
                bindings: Array.isArray(body.skill_policy_plugin.bindings)
                  ? body.skill_policy_plugin.bindings.map((item) => ({
                      bindingId: item.binding_id,
                      pluginRef: item.plugin_ref,
                      skillRef: item.skill_ref,
                      policyRef: item.policy_ref,
                      enabled: item.enabled,
                      scope: item.scope
                    }))
                  : undefined
              }
            : undefined,
          tokenQuotaContext: body.token_quota_context
            ? {
                tokenUsed: body.token_quota_context.token_used,
                tokenLimit: body.token_quota_context.token_limit,
                quotaState: body.token_quota_context.quota_state,
                contextTokens: body.token_quota_context.context_tokens,
                contextWindowTokens: body.token_quota_context.context_window_tokens,
                recallSource: body.token_quota_context.recall_source,
                recallHits: body.token_quota_context.recall_hits,
                degradeReason: body.token_quota_context.degrade_reason
              }
            : undefined,
          hostedAccess: body.hosted_access
            ? {
                hostedWebUrl: body.hosted_access.hosted_web_url,
                accessMode: body.hosted_access.access_mode,
                nonLocalAccessEnabled: body.hosted_access.non_local_access_enabled,
                stableLoginState: body.hosted_access.stable_login_state,
                loginProvider: body.hosted_access.login_provider,
                sessionTtlMinutes: body.hosted_access.session_ttl_minutes
              }
            : undefined,
          digitalTwin: body.digital_twin
            ? {
                twinId: body.digital_twin.twin_id,
                agentId: body.digital_twin.agent_id,
                personaRef: body.digital_twin.persona_ref,
                mode: body.digital_twin.mode,
                status: body.digital_twin.status,
                memoryScope: body.digital_twin.memory_scope
              }
            : undefined,
          operationalCapability: body.operational_capability
            ? {
                enabled: body.operational_capability.enabled,
                capabilityLevel: body.operational_capability.capability_level,
                operationModes: body.operational_capability.operation_modes,
                humanEscalationRequired: body.operational_capability.human_escalation_required,
                timelineEvidenceRequired: body.operational_capability.timeline_evidence_required,
                auditEvidenceRequired: body.operational_capability.audit_evidence_required
              }
            : undefined,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          context: serializeChannelContextContract(context),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_NOTIFICATION_ENDPOINT") {
        const contract = coordinator.getChannelNotificationEndpointContract(route.channelId);
        sendJson(response, 200, {
          notification_endpoint: serializeChannelNotificationApprovalContract(contract),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_CHANNEL_NOTIFICATION_ENDPOINT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_notification_endpoint", "notification endpoint payload must be object");
        const allowedFields = new Set(["operator_id", "browser_push", "email", "policy_snapshot"]);
        for (const key of Object.keys(body)) {
          if (key === "inbox") {
            throw new CoordinatorError(
              "invalid_notification_endpoint_layer",
              "inbox is server-owned truth and cannot be configured as endpoint"
            );
          }
          if (!allowedFields.has(key)) {
            throw new CoordinatorError(
              "invalid_notification_endpoint_field",
              `unsupported notification endpoint field: ${key}`
            );
          }
        }
        if (body.browser_push !== undefined) {
          assertObjectBody(
            body.browser_push,
            "invalid_notification_endpoint_layer",
            "browser_push payload must be object"
          );
          const allowedBrowserPushFields = new Set(["enabled", "endpoint_ref"]);
          for (const key of Object.keys(body.browser_push)) {
            if (!allowedBrowserPushFields.has(key)) {
              throw new CoordinatorError(
                "invalid_notification_endpoint_layer_field",
                `unsupported browser_push field: ${key}`
              );
            }
          }
        }
        if (body.email !== undefined) {
          assertObjectBody(body.email, "invalid_notification_endpoint_layer", "email payload must be object");
          const allowedEmailFields = new Set(["enabled", "endpoint_ref"]);
          for (const key of Object.keys(body.email)) {
            if (!allowedEmailFields.has(key)) {
              throw new CoordinatorError(
                "invalid_notification_endpoint_layer_field",
                `unsupported email field: ${key}`
              );
            }
          }
        }
        const contract = coordinator.upsertChannelNotificationEndpointContract(route.channelId, {
          operatorId: body.operator_id,
          browserPush: body.browser_push
            ? {
                enabled: body.browser_push.enabled,
                endpointRef: body.browser_push.endpoint_ref
              }
            : undefined,
          email: body.email
            ? {
                enabled: body.email.enabled,
                endpointRef: body.email.endpoint_ref
              }
            : undefined,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          notification_endpoint: serializeChannelNotificationApprovalContract(contract),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_ORCHESTRATION_UPGRADE") {
        const contract = coordinator.getChannelOrchestrationUpgradeContract(route.channelId);
        sendJson(response, 200, {
          orchestration_upgrade: serializeChannelOrchestrationUpgradeContract(contract),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_CHANNEL_ORCHESTRATION_UPGRADE") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_orchestration_upgrade", "orchestration upgrade payload must be object");
        const allowedFields = new Set([
          "operator_id",
          "multi_agent_orchestration",
          "upgrade_arbitration",
          "policy_snapshot"
        ]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_orchestration_upgrade_field", `unsupported orchestration upgrade field: ${key}`);
          }
        }
        if (body.multi_agent_orchestration === undefined && body.upgrade_arbitration === undefined) {
          throw new CoordinatorError(
            "invalid_orchestration_upgrade",
            "orchestration upgrade payload must include multi_agent_orchestration or upgrade_arbitration"
          );
        }
        if (body.multi_agent_orchestration !== undefined) {
          assertObjectBody(
            body.multi_agent_orchestration,
            "invalid_multi_agent_orchestration",
            "multi_agent_orchestration payload must be object"
          );
          const allowedOrchestrationFields = new Set([
            "orchestration_id",
            "mode",
            "status",
            "plan_ref",
            "participant_agent_ids",
            "participants",
            "dependency_edges",
            "quorum",
            "stop_conditions",
            "escalation_triggers"
          ]);
          for (const key of Object.keys(body.multi_agent_orchestration)) {
            if (!allowedOrchestrationFields.has(key)) {
              throw new CoordinatorError(
                "invalid_multi_agent_orchestration_field",
                `unsupported multi_agent_orchestration field: ${key}`
              );
            }
          }
          if (
            body.multi_agent_orchestration.participant_agent_ids !== undefined &&
            !Array.isArray(body.multi_agent_orchestration.participant_agent_ids)
          ) {
            throw new CoordinatorError(
              "invalid_multi_agent_orchestration_participant_agent_ids",
              "multi_agent_orchestration.participant_agent_ids must be string[]"
            );
          }
          if (body.multi_agent_orchestration.participants !== undefined) {
            if (!Array.isArray(body.multi_agent_orchestration.participants)) {
              throw new CoordinatorError(
                "invalid_multi_agent_orchestration_participants",
                "multi_agent_orchestration.participants must be object[]"
              );
            }
            for (const participant of body.multi_agent_orchestration.participants) {
              assertObjectBody(
                participant,
                "invalid_multi_agent_orchestration_participant",
                "multi_agent_orchestration participant must be object"
              );
              const allowedParticipantFields = new Set(["agent_id", "role", "duty", "required"]);
              for (const key of Object.keys(participant)) {
                if (!allowedParticipantFields.has(key)) {
                  throw new CoordinatorError(
                    "invalid_multi_agent_orchestration_participant_field",
                    `unsupported multi_agent_orchestration.participants field: ${key}`
                  );
                }
              }
            }
          }
          if (body.multi_agent_orchestration.dependency_edges !== undefined) {
            if (!Array.isArray(body.multi_agent_orchestration.dependency_edges)) {
              throw new CoordinatorError(
                "invalid_multi_agent_orchestration_dependency_edges",
                "multi_agent_orchestration.dependency_edges must be object[]"
              );
            }
            for (const edge of body.multi_agent_orchestration.dependency_edges) {
              assertObjectBody(
                edge,
                "invalid_multi_agent_orchestration_dependency_edge",
                "multi_agent_orchestration dependency edge must be object"
              );
              const allowedDependencyFields = new Set([
                "from_agent_id",
                "to_agent_id",
                "handoff_required",
                "condition"
              ]);
              for (const key of Object.keys(edge)) {
                if (!allowedDependencyFields.has(key)) {
                  throw new CoordinatorError(
                    "invalid_multi_agent_orchestration_dependency_edge_field",
                    `unsupported multi_agent_orchestration.dependency_edges field: ${key}`
                  );
                }
              }
            }
          }
          if (body.multi_agent_orchestration.quorum !== undefined) {
            assertObjectBody(
              body.multi_agent_orchestration.quorum,
              "invalid_multi_agent_orchestration_quorum",
              "multi_agent_orchestration.quorum must be object"
            );
            const allowedQuorumFields = new Set([
              "min_success_count",
              "max_parallel_agents",
              "stop_on_blocked",
              "stop_on_failure_count"
            ]);
            for (const key of Object.keys(body.multi_agent_orchestration.quorum)) {
              if (!allowedQuorumFields.has(key)) {
                throw new CoordinatorError(
                  "invalid_multi_agent_orchestration_quorum_field",
                  `unsupported multi_agent_orchestration.quorum field: ${key}`
                );
              }
            }
          }
          if (
            body.multi_agent_orchestration.stop_conditions !== undefined &&
            !Array.isArray(body.multi_agent_orchestration.stop_conditions)
          ) {
            throw new CoordinatorError(
              "invalid_multi_agent_orchestration_stop_conditions",
              "multi_agent_orchestration.stop_conditions must be string[]"
            );
          }
          if (
            body.multi_agent_orchestration.escalation_triggers !== undefined &&
            !Array.isArray(body.multi_agent_orchestration.escalation_triggers)
          ) {
            throw new CoordinatorError(
              "invalid_multi_agent_orchestration_escalation_triggers",
              "multi_agent_orchestration.escalation_triggers must be string[]"
            );
          }
        }
        if (body.upgrade_arbitration !== undefined) {
          assertObjectBody(body.upgrade_arbitration, "invalid_upgrade_arbitration", "upgrade_arbitration payload must be object");
          const allowedUpgradeFields = new Set([
            "arbitration_id",
            "status",
            "reason",
            "candidate_paths",
            "selected_path_id",
            "human_upgrade_chain"
          ]);
          for (const key of Object.keys(body.upgrade_arbitration)) {
            if (!allowedUpgradeFields.has(key)) {
              throw new CoordinatorError("invalid_upgrade_arbitration_field", `unsupported upgrade_arbitration field: ${key}`);
            }
          }
          if (body.upgrade_arbitration.candidate_paths !== undefined) {
            if (!Array.isArray(body.upgrade_arbitration.candidate_paths)) {
              throw new CoordinatorError(
                "invalid_upgrade_arbitration_candidate_paths",
                "upgrade_arbitration.candidate_paths must be object[]"
              );
            }
            for (const item of body.upgrade_arbitration.candidate_paths) {
              assertObjectBody(
                item,
                "invalid_upgrade_arbitration_candidate_path",
                "upgrade_arbitration candidate path must be object"
              );
              const allowedCandidateFields = new Set(["path_id", "target_mode", "reason", "evidence_refs"]);
              for (const key of Object.keys(item)) {
                if (!allowedCandidateFields.has(key)) {
                  throw new CoordinatorError(
                    "invalid_upgrade_arbitration_candidate_path_field",
                    `unsupported upgrade_arbitration.candidate_paths field: ${key}`
                  );
                }
              }
              if (item.evidence_refs !== undefined && !Array.isArray(item.evidence_refs)) {
                throw new CoordinatorError(
                  "invalid_upgrade_arbitration_evidence_refs",
                  "upgrade_arbitration evidence_refs must be string[]"
                );
              }
            }
          }
          if (body.upgrade_arbitration.human_upgrade_chain !== undefined && body.upgrade_arbitration.human_upgrade_chain !== null) {
            assertObjectBody(
              body.upgrade_arbitration.human_upgrade_chain,
              "invalid_human_upgrade_chain",
              "human_upgrade_chain payload must be object"
            );
            const allowedHumanChainFields = new Set([
              "escalation_id",
              "status",
              "approval_required",
              "approval_id",
              "approved_by",
              "approved_at",
              "rollback_allowed",
              "rollback_ref",
              "operator_action_ref",
              "approval_hold_ref",
              "decision_ref"
            ]);
            for (const key of Object.keys(body.upgrade_arbitration.human_upgrade_chain)) {
              if (!allowedHumanChainFields.has(key)) {
                throw new CoordinatorError(
                  "invalid_human_upgrade_chain_field",
                  `unsupported human_upgrade_chain field: ${key}`
                );
              }
            }
          }
        }
        const contract = coordinator.upsertChannelOrchestrationUpgradeContract(route.channelId, {
          operatorId: body.operator_id,
          multiAgentOrchestration: body.multi_agent_orchestration
            ? {
                orchestrationId: body.multi_agent_orchestration.orchestration_id,
                mode: body.multi_agent_orchestration.mode,
                status: body.multi_agent_orchestration.status,
                planRef: body.multi_agent_orchestration.plan_ref,
                participantAgentIds: body.multi_agent_orchestration.participant_agent_ids,
                participants: Array.isArray(body.multi_agent_orchestration.participants)
                  ? body.multi_agent_orchestration.participants.map((item) => ({
                      agentId: item.agent_id,
                      role: item.role,
                      duty: item.duty,
                      required: item.required
                    }))
                  : undefined,
                dependencyEdges: Array.isArray(body.multi_agent_orchestration.dependency_edges)
                  ? body.multi_agent_orchestration.dependency_edges.map((item) => ({
                      fromAgentId: item.from_agent_id,
                      toAgentId: item.to_agent_id,
                      handoffRequired: item.handoff_required,
                      condition: item.condition
                    }))
                  : undefined,
                quorum: body.multi_agent_orchestration.quorum
                  ? {
                      minSuccessCount: body.multi_agent_orchestration.quorum.min_success_count,
                      maxParallelAgents: body.multi_agent_orchestration.quorum.max_parallel_agents,
                      stopOnBlocked: body.multi_agent_orchestration.quorum.stop_on_blocked,
                      stopOnFailureCount: body.multi_agent_orchestration.quorum.stop_on_failure_count
                    }
                  : undefined,
                stopConditions: body.multi_agent_orchestration.stop_conditions,
                escalationTriggers: body.multi_agent_orchestration.escalation_triggers
              }
            : undefined,
          upgradeArbitration: body.upgrade_arbitration
            ? {
                arbitrationId: body.upgrade_arbitration.arbitration_id,
                status: body.upgrade_arbitration.status,
                reason: body.upgrade_arbitration.reason,
                candidatePaths: Array.isArray(body.upgrade_arbitration.candidate_paths)
                  ? body.upgrade_arbitration.candidate_paths.map((item) => ({
                      pathId: item.path_id,
                      targetMode: item.target_mode,
                      reason: item.reason,
                      evidenceRefs: item.evidence_refs
                    }))
                  : undefined,
                selectedPathId: body.upgrade_arbitration.selected_path_id,
                humanUpgradeChain:
                  body.upgrade_arbitration.human_upgrade_chain === null
                    ? null
                    : body.upgrade_arbitration.human_upgrade_chain
                      ? {
                          escalationId: body.upgrade_arbitration.human_upgrade_chain.escalation_id,
                          status: body.upgrade_arbitration.human_upgrade_chain.status,
                          approvalRequired: body.upgrade_arbitration.human_upgrade_chain.approval_required,
                          approvalId: body.upgrade_arbitration.human_upgrade_chain.approval_id,
                          approvedBy: body.upgrade_arbitration.human_upgrade_chain.approved_by,
                          approvedAt: body.upgrade_arbitration.human_upgrade_chain.approved_at,
                          rollbackAllowed: body.upgrade_arbitration.human_upgrade_chain.rollback_allowed,
                          rollbackRef: body.upgrade_arbitration.human_upgrade_chain.rollback_ref,
                          operatorActionRef: body.upgrade_arbitration.human_upgrade_chain.operator_action_ref,
                          approvalHoldRef: body.upgrade_arbitration.human_upgrade_chain.approval_hold_ref,
                          decisionRef: body.upgrade_arbitration.human_upgrade_chain.decision_ref
                        }
                      : undefined
              }
            : undefined,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          orchestration_upgrade: serializeChannelOrchestrationUpgradeContract(contract),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_EXTERNAL_MEMORY_PROVIDER") {
        const contract = coordinator.getChannelExternalMemoryProviderContract(route.channelId);
        sendJson(response, 200, {
          external_memory_provider: serializeChannelExternalMemoryProviderContract(contract),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_CHANNEL_EXTERNAL_MEMORY_PROVIDER") {
        const body = await readJsonBody(request);
        assertObjectBody(
          body,
          "invalid_external_memory_provider",
          "external memory provider payload must be object"
        );
        const allowedFields = new Set([
          "operator_id",
          "provider_id",
          "provider_type",
          "status",
          "read_scopes",
          "write_scopes",
          "recall_policy",
          "retention_policy",
          "sharing_policy",
          "policy_snapshot"
        ]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError(
              "invalid_external_memory_provider_field",
              `unsupported external memory provider field: ${key}`
            );
          }
        }
        if (body.read_scopes !== undefined && !Array.isArray(body.read_scopes)) {
          throw new CoordinatorError("invalid_external_memory_read_scopes", "read_scopes must be string[]");
        }
        if (body.write_scopes !== undefined && !Array.isArray(body.write_scopes)) {
          throw new CoordinatorError("invalid_external_memory_write_scopes", "write_scopes must be string[]");
        }
        if (
          body.recall_policy !== undefined &&
          (!body.recall_policy || typeof body.recall_policy !== "object" || Array.isArray(body.recall_policy))
        ) {
          throw new CoordinatorError("invalid_memory_recall_policy", "recall_policy must be object");
        }
        if (
          body.retention_policy !== undefined &&
          (!body.retention_policy ||
            typeof body.retention_policy !== "object" ||
            Array.isArray(body.retention_policy))
        ) {
          throw new CoordinatorError("invalid_memory_retention_policy", "retention_policy must be object");
        }
        if (
          body.sharing_policy !== undefined &&
          (!body.sharing_policy || typeof body.sharing_policy !== "object" || Array.isArray(body.sharing_policy))
        ) {
          throw new CoordinatorError("invalid_memory_sharing_policy", "sharing_policy must be object");
        }
        const contract = coordinator.upsertChannelExternalMemoryProviderContract(route.channelId, {
          operatorId: body.operator_id,
          providerId: body.provider_id,
          providerType: body.provider_type,
          status: body.status,
          readScopes: body.read_scopes,
          writeScopes: body.write_scopes,
          recallPolicy: body.recall_policy,
          retentionPolicy: body.retention_policy,
          sharingPolicy: body.sharing_policy,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          external_memory_provider: serializeChannelExternalMemoryProviderContract(contract),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CHANNEL_MEMORY_SEARCH") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_memory_search", "memory search payload must be object");
        const allowedFields = new Set(["scope", "query", "include_forgotten", "limit"]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_memory_search_field", `unsupported memory search field: ${key}`);
          }
        }
        const projection = coordinator.searchChannelMemory(route.channelId, {
          scope: body.scope,
          query: body.query,
          includeForgotten: body.include_forgotten === true,
          limit: body.limit
        });
        sendJson(response, 200, {
          memory_search: {
            channel_id: projection.channelId,
            owner_operator_id: projection.ownerOperatorId,
            external_memory_provider: serializeChannelExternalMemoryProviderContract({
              channelId: projection.channelId,
              ownerOperatorId: projection.ownerOperatorId,
              externalMemoryProvider: projection.provider
            }).external_memory_provider,
            items: projection.items.map((item) => serializeChannelMemoryEntry(item)),
            updated_at: projection.updatedAt
          },
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CHANNEL_MEMORY_WRITE") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_memory_write", "memory write payload must be object");
        const allowedFields = new Set(["operator_id", "scope", "content", "source_ref", "policy_snapshot"]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_memory_write_field", `unsupported memory write field: ${key}`);
          }
        }
        const written = coordinator.writeChannelMemoryEntry(route.channelId, {
          operatorId: body.operator_id,
          scope: body.scope,
          content: body.content,
          sourceRef: body.source_ref,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          memory: serializeChannelMemoryEntry(written.memory),
          audit_anchor: serializeChannelExternalMemoryProviderContract({
            channelId: written.channelId,
            ownerOperatorId: written.ownerOperatorId,
            externalMemoryProvider: written.provider,
            auditAnchor: written.auditAnchor
          }).audit_anchor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CHANNEL_MEMORY_FEEDBACK") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_memory_feedback", "memory feedback payload must be object");
        const allowedFields = new Set(["operator_id", "memory_id", "verdict", "note", "policy_snapshot"]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_memory_feedback_field", `unsupported memory feedback field: ${key}`);
          }
        }
        const feedback = coordinator.feedbackChannelMemoryEntry(route.channelId, {
          operatorId: body.operator_id,
          memoryId: body.memory_id,
          verdict: body.verdict,
          note: body.note,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          memory: serializeChannelMemoryEntry(feedback.memory),
          audit_anchor: serializeChannelExternalMemoryProviderContract({
            channelId: feedback.channelId,
            ownerOperatorId: feedback.ownerOperatorId,
            auditAnchor: feedback.auditAnchor
          }).audit_anchor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CHANNEL_MEMORY_PROMOTE") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_memory_promote", "memory promote payload must be object");
        const allowedFields = new Set(["operator_id", "memory_id", "policy_snapshot"]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_memory_promote_field", `unsupported memory promote field: ${key}`);
          }
        }
        const promoted = coordinator.promoteChannelMemoryEntry(route.channelId, {
          operatorId: body.operator_id,
          memoryId: body.memory_id,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          memory: serializeChannelMemoryEntry(promoted.memory),
          audit_anchor: serializeChannelExternalMemoryProviderContract({
            channelId: promoted.channelId,
            ownerOperatorId: promoted.ownerOperatorId,
            auditAnchor: promoted.auditAnchor
          }).audit_anchor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CHANNEL_MEMORY_FORGET") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_memory_forget", "memory forget payload must be object");
        const allowedFields = new Set(["operator_id", "memory_id", "policy_snapshot"]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_memory_forget_field", `unsupported memory forget field: ${key}`);
          }
        }
        const forgotten = coordinator.forgetChannelMemoryEntry(route.channelId, {
          operatorId: body.operator_id,
          memoryId: body.memory_id,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          memory: serializeChannelMemoryEntry(forgotten.memory),
          audit_anchor: serializeChannelExternalMemoryProviderContract({
            channelId: forgotten.channelId,
            ownerOperatorId: forgotten.ownerOperatorId,
            auditAnchor: forgotten.auditAnchor
          }).audit_anchor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_MEMORY_ITEM") {
        const projection = coordinator.getChannelMemoryEntry(route.channelId, route.memoryId, {
          scope: parsedUrl.searchParams.get("scope")
        });
        sendJson(response, 200, {
          memory: serializeChannelMemoryEntry(projection.memory),
          external_memory_provider: serializeChannelExternalMemoryProviderContract({
            channelId: projection.channelId,
            ownerOperatorId: projection.ownerOperatorId,
            externalMemoryProvider: projection.provider
          }).external_memory_provider,
          audit_anchor: serializeChannelExternalMemoryProviderContract({
            channelId: projection.channelId,
            ownerOperatorId: projection.ownerOperatorId,
            auditAnchor: projection.auditAnchor
          }).audit_anchor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_MEMORY_VIEWER") {
        const viewer = coordinator.listChannelMemoryViewerProjection(route.channelId, {
          scope: parsedUrl.searchParams.get("scope"),
          includeForgotten: parsedUrl.searchParams.get("include_forgotten") === "true",
          limit: parsedUrl.searchParams.get("limit"),
          cursor: parsedUrl.searchParams.get("cursor")
        });
        sendJson(response, 200, {
          memory_viewer: serializeChannelMemoryViewerProjection(viewer),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_REPO_BINDING") {
        const config = coordinator.getChannelRepoBindingConfig(route.channelId);
        sendJson(response, 200, {
          repo_binding: serializeChannelRepoBindingConfig(config),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_CHANNEL_REPO_BINDING") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_repo_binding_config", "repo binding config payload must be object");
        const allowedFields = new Set([
          "operator_id",
          "topic_id",
          "provider_ref",
          "default_branch",
          "fixed_directory",
          "workspace_installation_id",
          "policy_snapshot"
        ]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_repo_binding_config_field", `unsupported repo binding config field: ${key}`);
          }
        }
        const config = coordinator.upsertChannelRepoBindingConfig(route.channelId, {
          operatorId: body.operator_id,
          topicId: body.topic_id,
          providerRef: body.provider_ref,
          defaultBranch: body.default_branch,
          fixedDirectory: body.fixed_directory,
          workspaceInstallationId: body.workspace_installation_id,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          repo_binding: serializeChannelRepoBindingConfig(config),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_AUDIT_TRAIL") {
        const auditTrail = coordinator.listChannelAuditTrail(route.channelId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          projection: "control_plane_audit_projection",
          channel_id: auditTrail.channelId,
          owner_operator_id: auditTrail.ownerOperatorId,
          items: auditTrail.items.map((item) => serializeChannelAuditEntry(item)),
          next_cursor: auditTrail.nextCursor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_WORK_ASSIGNMENTS") {
        const assignmentProjection = coordinator.listChannelWorkAssignments(route.channelId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          projection: "channel_work_assignment_projection",
          contract_version: "v1.stage2.batch2",
          channel_id: assignmentProjection.channelId,
          owner_operator_id: assignmentProjection.ownerOperatorId,
          items: assignmentProjection.items.map((item) => serializeChannelWorkAssignment(item)),
          summary: {
            total_assignments: assignmentProjection.summary.totalAssignments,
            assigned_count: assignmentProjection.summary.assignedCount,
            channel_assigned_count: assignmentProjection.summary.channelAssignedCount
          },
          next_cursor: assignmentProjection.nextCursor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_CHANNEL_WORK_ASSIGNMENT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_work_assignment_payload", "work assignment payload must be object");
        const allowedFields = new Set([
          "operator_id",
          "thread_id",
          "workitem_id",
          "default_duty",
          "note",
          "policy_snapshot"
        ]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_work_assignment_field", `unsupported work assignment field: ${key}`);
          }
        }
        const assignment = coordinator.upsertChannelWorkAssignment(route.channelId, route.agentId, {
          operatorId: body.operator_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id,
          defaultDuty: body.default_duty,
          note: body.note,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          projection: "channel_work_assignment_projection",
          contract_version: "v1.stage2.batch2",
          work_assignment: serializeChannelWorkAssignment(assignment),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_OPERATOR_ACTIONS") {
        const actions = coordinator.listChannelOperatorActions(route.channelId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          projection: "channel_operator_action_projection",
          contract_version: "v1.stage2.batch2",
          channel_id: actions.channelId,
          owner_operator_id: actions.ownerOperatorId,
          items: actions.items.map((item) => serializeChannelOperatorAction(item)),
          next_cursor: actions.nextCursor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_CHANNEL_OPERATOR_ACTION") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_operator_action_payload", "operator action payload must be object");
        const allowedFields = new Set([
          "operator_id",
          "action_type",
          "agent_id",
          "thread_id",
          "workitem_id",
          "note",
          "payload",
          "policy_snapshot"
        ]);
        for (const key of Object.keys(body)) {
          if (!allowedFields.has(key)) {
            throw new CoordinatorError("invalid_operator_action_field", `unsupported operator action field: ${key}`);
          }
        }
        const action = coordinator.appendChannelOperatorAction(route.channelId, {
          operatorId: body.operator_id,
          actionType: body.action_type,
          agentId: body.agent_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id,
          note: body.note,
          payload: body.payload,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          projection: "channel_operator_action_projection",
          contract_version: "v1.stage2.batch2",
          action: serializeChannelOperatorAction(action),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_CHANNEL_RECENT_ACTIONS") {
        const recentActions = coordinator.listChannelRecentActions(route.channelId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          projection: "channel_recent_actions_projection",
          contract_version: "v1.stage2.batch2",
          channel_id: recentActions.channelId,
          owner_operator_id: recentActions.ownerOperatorId,
          items: recentActions.items.map((item) => serializeChannelRecentAction(item)),
          summary: {
            total: recentActions.summary.total,
            operator_action_count: recentActions.summary.operatorActionCount,
            work_assignment_count: recentActions.summary.workAssignmentCount
          },
          next_cursor: recentActions.nextCursor,
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

      if (route.route === "V1_GET_TOPIC_STATUS") {
        const overview = coordinator.getTopicOverview(route.topicId);
        const coarse = coordinator.getCoarseObservability(route.topicId);
        sendJson(response, 200, {
          status: serializeTopicStatusReadModel(overview, coarse),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_STATE") {
        const overview = coordinator.getTopicOverview(route.topicId);
        sendJson(response, 200, {
          topic_state: serializeTopicState(overview),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_MERGE_LIFECYCLE") {
        const overview = coordinator.getTopicOverview(route.topicId);
        sendJson(response, 200, {
          merge_lifecycle: serializeMergeLifecycle(overview),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_TASK_ALLOCATION") {
        const overview = coordinator.getTopicOverview(route.topicId);
        sendJson(response, 200, {
          task_allocation: serializeTaskAllocationReadModel(overview),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_CONTROL_PLANE_CONSUMER") {
        const overview = coordinator.getTopicOverview(route.topicId);
        const coarse = coordinator.getCoarseObservability(route.topicId);
        const messageRoute =
          typeof parsedUrl.searchParams.get("route") === "string" && parsedUrl.searchParams.get("route").trim().length > 0
            ? parsedUrl.searchParams.get("route").trim()
            : "topic";
        const approvalStatus =
          typeof parsedUrl.searchParams.get("approval_status") === "string" &&
          parsedUrl.searchParams.get("approval_status").trim().length > 0
            ? parsedUrl.searchParams.get("approval_status").trim()
            : "pending";
        const topicIdEncoded = encodeURIComponent(route.topicId);
        const mergeLifecycle = serializeMergeLifecycle(overview);

        sendJson(response, 200, {
          projection: "control_plane_consumer_projection",
          contract_version: "v1.stage1",
          topic_id: route.topicId,
          topic_status: serializeTopicStatusReadModel(overview, coarse),
          topic_state: serializeTopicState(overview),
          merge_lifecycle: mergeLifecycle,
          task_allocation: serializeTaskAllocationReadModel(overview),
          topic_messages: {
            route: messageRoute,
            items: coordinator.listMessages(route.topicId, { route: messageRoute })
          },
          approval_holds: {
            status: approvalStatus,
            items: coordinator
              .listApprovalHolds(route.topicId, { status: approvalStatus })
              .map((hold) => serializeApprovalHoldResource(hold))
          },
          approval_decisions: {
            items: overview.approvalDecisions.map((decision) => serializeDecisionResource(decision))
          },
          intervention_queue: {
            open_conflicts: overview.openConflicts.map((conflict) => serializeConflictResource(conflict)),
            blockers: deepClone(overview.blockers)
          },
          closeout_clues: deepClone(mergeLifecycle.closeout_explanation),
          write_anchors: {
            actor_upsert: `/v1/topics/${topicIdEncoded}/actors/:actorId`,
            topic_messages: `/v1/topics/${topicIdEncoded}/messages`,
            approval_holds: `/v1/topics/${topicIdEncoded}/approval-holds?status=:status`,
            approval_decisions: `/v1/topics/${topicIdEncoded}/approval-holds/:holdId/decisions`
          },
          projection_meta: integrationProjectionMeta({
            resource: "control_plane_consumer_projection",
            sourcePlane: "control_plane_projection",
            topicId: route.topicId
          }),
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
            request_id: requestId,
            projection_meta: integrationProjectionMeta({
              resource: "topic_debug_history_projection",
              sourcePlane: "control_plane_debug_history_projection",
              topicId: route.topicId
            })
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
          request_id: requestId,
          projection_meta: integrationProjectionMeta({
            resource: "topic_debug_history_projection",
            sourcePlane: "control_plane_debug_history_projection",
            topicId: route.topicId
          })
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
          request_id: requestId,
          projection_meta: integrationProjectionMeta({
            resource: "topic_debug_rejection_projection",
            sourcePlane: "control_plane_rejection_projection",
            topicId: route.topicId
          })
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

      if (route.route === "V1_GET_TOPIC_EXECUTION_INBOX") {
        const result = coordinator.getTopicExecutionInboxConsumerProjection(route.topicId, {
          actorId: parsedUrl.searchParams.get("actor_id"),
          runId: parsedUrl.searchParams.get("run_id"),
          runCursor: parsedUrl.searchParams.get("run_cursor"),
          runLimit: parsedUrl.searchParams.get("run_limit"),
          inboxCursor: parsedUrl.searchParams.get("inbox_cursor"),
          inboxLimit: parsedUrl.searchParams.get("inbox_limit")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "execution_inbox_consumer_projection",
            sourcePlane: "cross_plane_consumer_projection",
            topicId: route.topicId,
            runId: result.selected_run_id ?? null
          })
        });
        return;
      }

      if (route.route === "V1_GET_TOPIC_NOTIFICATIONS") {
        const result = coordinator.listTopicNotificationProjection(route.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "notification_projection",
            sourcePlane: "control_plane_projection",
            topicId: route.topicId
          })
        });
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
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "run_timeline_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
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
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "run_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
        return;
      }

      if (route.route === "V1_GET_EXECUTION_RUN_DEBUG") {
        const result = coordinator.getExecutionRunDebugEvidenceProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "execution_run_debug_evidence_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
        return;
      }

      if (route.route === "V1_GET_EXECUTION_RUN_EVENTS") {
        const result = coordinator.listExecutionRunEventsProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id"),
          afterSequence: parsedUrl.searchParams.get("after_sequence"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "execution_run_event_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
        return;
      }

      if (route.route === "V1_GET_RUN_FEEDBACK") {
        const result = coordinator.listRunFeedbackProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "run_feedback_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
        return;
      }

      if (route.route === "V1_GET_RUN_HOLDS") {
        const result = coordinator.listRunHoldProjection(route.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "run_hold_projection",
            sourcePlane: "execution_plane_projection",
            topicId: result.topic_id ?? null,
            runId: route.runId
          })
        });
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
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "inbox_projection",
            sourcePlane: "control_plane_projection",
            topicId: result.topic_id ?? null
          })
        });
        return;
      }

      if (route.route === "V1_POST_INBOX_ACKS") {
        const body = await readJsonBody(request);
        const result = coordinator.ackActorInboxItems(route.actorId, body);
        sendJson(response, 200, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "inbox_ack_projection",
            sourcePlane: "control_plane_projection",
            topicId: result.acked_items?.[0]?.topic_id ?? null
          })
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_REGISTRY") {
        const registry = coordinator.getRuntimeRegistry();
        sendJson(response, 200, {
          projection: "single_operator_runtime_registry",
          contract_version: registry.contractVersion,
          mode: registry.mode,
          liveness_timeout_ms: registry.livenessTimeoutMs,
          summary: {
            machine_count: registry.summary.machineCount,
            agent_count: registry.summary.agentCount,
            online_agent_count: registry.summary.onlineAgentCount,
            offline_agent_count: registry.summary.offlineAgentCount,
            active_worktree_claim_count: registry.summary.activeWorktreeClaimCount
          },
          machines: registry.machines.map((machine) => serializeRuntimeMachine(machine)),
          agents: registry.agents.map((agent) => serializeRuntimeAgent(agent)),
          worktree_claims: registry.worktreeClaims.map((claim) => serializeRuntimeWorktreeClaim(claim)),
          projection_meta: integrationProjectionMeta({
            resource: "runtime_registry_projection",
            sourcePlane: "operator_runtime_projection"
          }),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_DEPLOY_RUNTIME") {
        const contract = coordinator.getRuntimeDeployRuntimeContract();
        sendJson(response, 200, {
          deploy_runtime: serializeRuntimeDeployRuntimeContract(contract),
          projection_meta: integrationProjectionMeta({
            resource: "runtime_deploy_runtime_projection",
            sourcePlane: "operator_runtime_projection"
          }),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_RUNTIME_DEPLOY_RUNTIME") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_deploy_runtime", "runtime deploy-runtime payload must be object");
        const contract = coordinator.upsertRuntimeDeployRuntimeContract({
          ...body,
          operatorId: body.operator_id,
          hostedAccess: body.hosted_access,
          healthReadiness: body.health_readiness,
          releaseRecoveryUpgradeHandoff: body.release_recovery_upgrade_handoff,
          policySnapshot: body.policy_snapshot
        });
        sendJson(response, 200, {
          deploy_runtime: serializeRuntimeDeployRuntimeContract(contract),
          projection_meta: integrationProjectionMeta({
            resource: "runtime_deploy_runtime_projection",
            sourcePlane: "operator_runtime_projection"
          }),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_MACHINES") {
        const items = coordinator.listRuntimeMachines().map((machine) => serializeRuntimeMachine(machine));
        const page = paginate(items, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: "runtime:machines"
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_MACHINE") {
        const machine = coordinator.getRuntimeMachine(route.machineId);
        sendJson(response, 200, {
          machine: serializeRuntimeMachine(machine),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_RUNTIME_MACHINE") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_machine", "runtime machine payload must be object");
        const machine = coordinator.upsertRuntimeMachine(route.machineId, {
          runtimeId: body.runtime_id,
          status: body.status,
          capabilities: body.capabilities,
          pairedBy: body.paired_by
        });
        sendJson(response, 200, {
          machine: serializeRuntimeMachine(machine),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_AGENTS") {
        const items = coordinator.listRuntimeAgents().map((agent) => serializeRuntimeAgent(agent));
        const page = paginate(items, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: "runtime:agents"
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_RECOVERY_ACTIONS") {
        const actions = coordinator.listRuntimeRecoveryActions({
          operatorId: parsedUrl.searchParams.get("operator_id"),
          channelId: parsedUrl.searchParams.get("channel_id"),
          agentId: parsedUrl.searchParams.get("agent_id"),
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, {
          projection: "runtime_recovery_actions_projection",
          mode: "single_human_multi_agent",
          operator_id: parsedUrl.searchParams.get("operator_id") ?? null,
          channel_id: parsedUrl.searchParams.get("channel_id") ?? null,
          items: actions.items.map((item) => serializeRuntimeRecoveryAction(item)),
          next_cursor: actions.nextCursor,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_AGENT") {
        const agent = coordinator.getRuntimeAgent(route.agentId);
        sendJson(response, 200, {
          agent: serializeRuntimeAgent(agent),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_RUNTIME_AGENT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_agent", "runtime agent payload must be object");
        const agent = coordinator.upsertRuntimeAgent(route.agentId, {
          machineId: body.machine_id,
          status: body.status,
          operatorId: body.operator_id,
          channelId: body.channel_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id
        });
        sendJson(response, 200, {
          agent: serializeRuntimeAgent(agent),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_RUNTIME_AGENT_PAIRING") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_pairing", "runtime pairing payload must be object");
        const agent = coordinator.pairRuntimeAgent(route.agentId, {
          machineId: body.machine_id,
          status: body.status,
          operatorId: body.operator_id,
          channelId: body.channel_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id
        });
        sendJson(response, 200, {
          pairing: {
            agent: serializeRuntimeAgent(agent),
            paired_at: agent.pairedAt ?? null
          },
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_RUNTIME_AGENT_HEARTBEAT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_heartbeat", "runtime heartbeat payload must be object");
        const agent = coordinator.heartbeatRuntimeAgent(route.agentId, {
          status: body.status,
          operatorId: body.operator_id,
          channelId: body.channel_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id
        });
        sendJson(response, 200, {
          heartbeat: {
            agent: serializeRuntimeAgent(agent),
            heartbeat_at: agent.lastSeenAt ?? null
          },
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_RUNTIME_AGENT_ASSIGNMENT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_assignment", "runtime assignment payload must be object");
        const agent = coordinator.enforceRuntimeAssignment(route.agentId, {
          operatorId: body.operator_id,
          channelId: body.channel_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id,
          status: body.status
        });
        sendJson(response, 200, {
          assignment: {
            agent: serializeRuntimeAgent(agent),
            assigned_at: agent.updatedAt ?? null
          },
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_RUNTIME_AGENT_RECOVERY_ACTION") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_recovery_action", "runtime recovery payload must be object");
        const action = coordinator.triggerRuntimeRecoveryAction(route.agentId, {
          action: body.action,
          reason: body.reason,
          operatorId: body.operator_id,
          channelId: body.channel_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id,
          claimKey: body.claim_key,
          repoRef: body.repo_ref,
          branch: body.branch,
          laneId: body.lane_id,
          status: body.status
        });
        sendJson(response, 200, {
          recovery_action: serializeRuntimeRecoveryAction(action),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_GET_RUNTIME_WORKTREE_CLAIMS") {
        const items = coordinator.listRuntimeWorktreeClaims().map((claim) => serializeRuntimeWorktreeClaim(claim));
        const page = paginate(items, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsePageLimit(parsedUrl.searchParams),
          scope: "runtime:worktree_claims"
        });
        sendJson(response, 200, {
          items: page.items,
          page: page.page,
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_PUT_RUNTIME_WORKTREE_CLAIM") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_worktree_claim", "worktree claim payload must be object");
        const claim = coordinator.claimRuntimeWorktree(route.claimKey, {
          agentId: body.agent_id,
          repoRef: body.repo_ref,
          branch: body.branch,
          laneId: body.lane_id,
          operatorId: body.operator_id,
          channelId: body.channel_id,
          threadId: body.thread_id,
          workitemId: body.workitem_id
        });
        sendJson(response, 200, {
          claim: serializeRuntimeWorktreeClaim(claim),
          request_id: requestId
        });
        return;
      }

      if (route.route === "V1_POST_RUNTIME_WORKTREE_RELEASE") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_worktree_release", "worktree release payload must be object");
        const release = coordinator.releaseRuntimeWorktree(route.claimKey, {
          agentId: body.agent_id
        });
        sendJson(response, 200, {
          release: {
            claim_key: release.claimKey,
            released_by: release.releasedBy,
            released_at: release.releasedAt
          },
          request_id: requestId
        });
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
