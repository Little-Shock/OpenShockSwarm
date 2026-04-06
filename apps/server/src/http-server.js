import http from "node:http";
import { URL } from "node:url";
import { CoordinatorError } from "./errors.js";
import { buildRuntimeConfig, seedSampleFixture } from "./runtime-fixtures.js";

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
  const v1TopicEventsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/events$/);
  if (method === "GET" && v1TopicEventsMatch) {
    return { route: "GET_V1_TOPIC_EVENTS", topicId: v1TopicEventsMatch[1] };
  }

  const v1TopicRunHistoryMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/run-history$/);
  if (method === "GET" && v1TopicRunHistoryMatch) {
    return { route: "GET_V1_TOPIC_RUN_HISTORY", topicId: v1TopicRunHistoryMatch[1] };
  }

  const v1TopicNotificationsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/notifications$/);
  if (method === "GET" && v1TopicNotificationsMatch) {
    return { route: "GET_V1_TOPIC_NOTIFICATIONS", topicId: v1TopicNotificationsMatch[1] };
  }

  const v1TopicRepoBindingMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/repo-binding$/);
  if (method === "GET" && v1TopicRepoBindingMatch) {
    return { route: "GET_V1_TOPIC_REPO_BINDING", topicId: v1TopicRepoBindingMatch[1] };
  }
  if (method === "PUT" && v1TopicRepoBindingMatch) {
    return { route: "PUT_V1_TOPIC_REPO_BINDING", topicId: v1TopicRepoBindingMatch[1] };
  }

  const v1TopicPrsMatch = pathName.match(/^\/v1\/topics\/([^/]+)\/prs$/);
  if (method === "GET" && v1TopicPrsMatch) {
    return { route: "GET_V1_TOPIC_PRS", topicId: v1TopicPrsMatch[1] };
  }
  if (method === "POST" && v1TopicPrsMatch) {
    return { route: "POST_V1_TOPIC_PRS", topicId: v1TopicPrsMatch[1] };
  }

  const v1RunsTimelineMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/timeline$/);
  if (method === "GET" && v1RunsTimelineMatch) {
    return { route: "GET_V1_RUN_TIMELINE", runId: v1RunsTimelineMatch[1] };
  }

  const v1RunsReplayMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/replay$/);
  if (method === "GET" && v1RunsReplayMatch) {
    return { route: "GET_V1_RUN_REPLAY", runId: v1RunsReplayMatch[1] };
  }

  const v1RunMatch = pathName.match(/^\/v1\/runs\/([^/]+)$/);
  if (method === "GET" && v1RunMatch) {
    return { route: "GET_V1_RUN", runId: v1RunMatch[1] };
  }

  const v1RunsFeedbackMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/feedback$/);
  if (method === "GET" && v1RunsFeedbackMatch) {
    return { route: "GET_V1_RUN_FEEDBACK", runId: v1RunsFeedbackMatch[1] };
  }

  const v1RunsHoldsMatch = pathName.match(/^\/v1\/runs\/([^/]+)\/holds$/);
  if (method === "GET" && v1RunsHoldsMatch) {
    return { route: "GET_V1_RUN_HOLDS", runId: v1RunsHoldsMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/debug/events") {
    return { route: "GET_V1_DEBUG_EVENTS" };
  }

  if (method === "GET" && pathName === "/v1/debug/history") {
    return { route: "GET_V1_DEBUG_HISTORY" };
  }

  const v1InboxMatch = pathName.match(/^\/v1\/inbox\/([^/]+)$/);
  if (method === "GET" && v1InboxMatch) {
    return { route: "GET_V1_INBOX", actorId: v1InboxMatch[1] };
  }

  const v1InboxAckMatch = pathName.match(/^\/v1\/inbox\/([^/]+)\/acks$/);
  if (method === "POST" && v1InboxAckMatch) {
    return { route: "POST_V1_INBOX_ACKS", actorId: v1InboxAckMatch[1] };
  }

  if (method === "GET" && pathName === "/v1/compatibility/shell-adapter") {
    return { route: "GET_V1_SHELL_COMPATIBILITY" };
  }

  const v1PrMatch = pathName.match(/^\/v1\/prs\/([^/]+)$/);
  if (method === "GET" && v1PrMatch) {
    return { route: "GET_V1_PR", prId: v1PrMatch[1] };
  }
  if (method === "PATCH" && v1PrMatch) {
    return { route: "PATCH_V1_PR", prId: v1PrMatch[1] };
  }

  const v1PrReviewMatch = pathName.match(/^\/v1\/prs\/([^/]+)\/reviews$/);
  if (method === "POST" && v1PrReviewMatch) {
    return { route: "POST_V1_PR_REVIEW", prId: v1PrReviewMatch[1] };
  }

  const v1PrChecksMatch = pathName.match(/^\/v1\/prs\/([^/]+)\/checks$/);
  if (method === "POST" && v1PrChecksMatch) {
    return { route: "POST_V1_PR_CHECK", prId: v1PrChecksMatch[1] };
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
      route: "POST_APPROVAL_DECISION",
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

  return http.createServer(async (request, response) => {
    try {
      if (!request.url || !request.method) {
        throw new CoordinatorError("bad_request", "request must include method and url");
      }

      const parsedUrl = new URL(request.url, "http://localhost");
      const match = matchRoute(request.method, parsedUrl.pathname);
      if (!match) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }

      if (match.route === "GET_HEALTH") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (match.route === "GET_RUNTIME_CONFIG") {
        sendJson(response, 200, runtimeConfig);
        return;
      }

      if (match.route === "POST_RUNTIME_FIXTURE_SEED") {
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

      if (match.route === "POST_RUNTIME_DAEMON_EVENT") {
        const body = await readJsonBody(request);
        assertObjectBody(body, "invalid_runtime_daemon_event_payload", "runtime daemon event payload must be a JSON object");
        for (const field of Object.keys(body)) {
          if (!RUNTIME_DAEMON_ALLOWED_FIELDS.has(field)) {
            throw new CoordinatorError(
              "runtime_daemon_event_field_forbidden",
              `runtime daemon event does not allow field: ${field}`
            );
          }
        }
        if (typeof body.topicId !== "string" || body.topicId.trim().length === 0) {
          throw new CoordinatorError("runtime_daemon_event_topic_required", "runtime daemon event requires topicId");
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

      if (match.route === "GET_RUNTIME_SMOKE") {
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

      if (match.route === "GET_V1_TOPIC_EVENTS") {
        const result = coordinator.listTopicEventProjection(match.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_TOPIC_RUN_HISTORY") {
        const result = coordinator.listTopicRunHistoryProjection(match.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_TOPIC_NOTIFICATIONS") {
        const result = coordinator.listTopicNotificationProjection(match.topicId, {
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_RUN_TIMELINE") {
        const result = coordinator.listRunTimelineProjection(match.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_RUN_REPLAY") {
        const result = coordinator.replayRunEventProjection(match.runId, {
          topicId: parsedUrl.searchParams.get("topic_id"),
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_RUN") {
        const result = coordinator.getRunProjection(match.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_RUN_FEEDBACK") {
        const result = coordinator.listRunFeedbackProjection(match.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_RUN_HOLDS") {
        const result = coordinator.listRunHoldProjection(match.runId, {
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_DEBUG_EVENTS") {
        const result = coordinator.listDebugEventsProjection({
          topicId: parsedUrl.searchParams.get("topic_id"),
          runId: parsedUrl.searchParams.get("run_id"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_DEBUG_HISTORY") {
        const result = coordinator.listDebugHistoryAggregationProjection({
          topicId: parsedUrl.searchParams.get("topic_id"),
          runId: parsedUrl.searchParams.get("run_id"),
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_INBOX") {
        const result = coordinator.listActorInboxProjection(match.actorId, {
          topicId: parsedUrl.searchParams.get("topic_id"),
          cursor: parsedUrl.searchParams.get("cursor"),
          limit: parsedUrl.searchParams.get("limit")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "POST_V1_INBOX_ACKS") {
        const body = await readJsonBody(request);
        const result = coordinator.ackActorInboxItems(match.actorId, body);
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_SHELL_COMPATIBILITY") {
        const result = coordinator.getShellCompatibilityContract({
          topicId: parsedUrl.searchParams.get("topic_id")
        });
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_V1_TOPIC_REPO_BINDING") {
        const result = coordinator.getTopicRepoBindingProjection(match.topicId);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(match.topicId);
        sendJson(response, 200, {
          projection_meta: integrationProjectionMeta({
            resource: "repo_binding",
            sourcePlane: "control_plane_projection",
            topicId: match.topicId
          }),
          topic_id: match.topicId,
          repo_binding: result,
          delivery_projection: deliveryProjection
        });
        return;
      }

      if (match.route === "PUT_V1_TOPIC_REPO_BINDING") {
        const body = await readJsonBody(request);
        const result = coordinator.upsertTopicRepoBindingProjection(match.topicId, body);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(match.topicId);
        sendJson(response, 200, {
          ...result,
          delivery_projection: deliveryProjection,
          projection_meta: integrationProjectionMeta({
            resource: "repo_binding",
            sourcePlane: "control_plane_projection",
            topicId: match.topicId
          })
        });
        return;
      }

      if (match.route === "GET_V1_TOPIC_PRS") {
        const result = coordinator.listTopicPrProjections(match.topicId);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(match.topicId);
        sendJson(response, 200, {
          projection_meta: integrationProjectionMeta({
            resource: "pr_projection",
            sourcePlane: "control_plane_projection",
            topicId: match.topicId
          }),
          topic_id: match.topicId,
          delivery_projection: deliveryProjection,
          items: result
        });
        return;
      }

      if (match.route === "POST_V1_TOPIC_PRS") {
        const body = await readJsonBody(request);
        const result = coordinator.createTopicPrProjection(match.topicId, body);
        const deliveryProjection = coordinator.getTopicDeliveryProjection(match.topicId);
        sendJson(response, 201, {
          ...result,
          delivery_projection: deliveryProjection,
          projection_meta: integrationProjectionMeta({
            resource: "pr_projection",
            sourcePlane: "control_plane_projection",
            topicId: match.topicId,
            prId: result.pr_id
          })
        });
        return;
      }

      if (match.route === "GET_V1_PR") {
        const result = coordinator.getPrProjection(match.prId);
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
            prId: match.prId
          })
        });
        return;
      }

      if (match.route === "PATCH_V1_PR") {
        const body = await readJsonBody(request);
        const result = coordinator.updatePrProjection(match.prId, body);
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
            prId: match.prId
          })
        });
        return;
      }

      if (match.route === "POST_V1_PR_REVIEW") {
        const body = await readJsonBody(request);
        const result = coordinator.appendPrReviewProjection(match.prId, body);
        sendJson(response, 201, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "pr_review_projection",
            sourcePlane: "control_plane_projection",
            prId: match.prId
          })
        });
        return;
      }

      if (match.route === "POST_V1_PR_CHECK") {
        const body = await readJsonBody(request);
        const result = coordinator.appendPrCheckProjection(match.prId, body);
        sendJson(response, 201, {
          ...result,
          projection_meta: integrationProjectionMeta({
            resource: "pr_check_projection",
            sourcePlane: "execution_plane_projection",
            prId: match.prId
          })
        });
        return;
      }

      if (match.route === "POST_TOPICS") {
        const body = await readJsonBody(request);
        const topic = coordinator.createTopic(body);
        sendJson(response, 201, topic);
        return;
      }

      if (match.route === "POST_TOPIC_AGENT") {
        const body = await readJsonBody(request);
        const topic = coordinator.registerAgent(match.topicId, body);
        sendJson(response, 200, topic);
        return;
      }

      if (match.route === "POST_TOPIC_MESSAGE") {
        const body = await readJsonBody(request);
        const result = coordinator.ingestMessage(match.topicId, body);
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "POST_APPROVAL_DECISION") {
        const body = await readJsonBody(request);
        const result = coordinator.applyHumanDecision(match.topicId, match.holdId, body);
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_TOPIC_OVERVIEW") {
        const result = coordinator.getTopicOverview(match.topicId);
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_TOPIC_COARSE") {
        const result = coordinator.getCoarseObservability(match.topicId);
        sendJson(response, 200, result);
        return;
      }

      if (match.route === "GET_TOPIC_MESSAGES") {
        const route = parsedUrl.searchParams.get("route");
        const result = coordinator.listMessages(match.topicId, { route });
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
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
