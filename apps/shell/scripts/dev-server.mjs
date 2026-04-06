import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.SHELL_PORT || 4173);
const apiUpstream = process.env.SHELL_API_UPSTREAM || "http://127.0.0.1:7070";
const configuredApiBase = process.env.SHELL_API_BASE_URL || "";
const operatorAgentId = process.env.SHELL_OPERATOR_AGENT_ID || "shell_operator";

const mimeByExt = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const FIXED_INTERVENTION_POINTS = [
  { id: "lead_plan", name: "Lead Plan", owner: "lead" },
  { id: "worker_dispatch", name: "Worker Dispatch", owner: "lead" },
  { id: "merge_closeout", name: "Merge Closeout", owner: "human" },
];

const server = http.createServer(async (req, res) => {
  try {
    const route = matchRoute(req.url || "/");

    if (route.kind === "runtime-config") {
      return writeRuntimeConfig(res);
    }

    if (route.kind === "shell-state") {
      return writeShellState(res);
    }

    if (route.kind === "approval-decision") {
      return handleApprovalDecision(req, res, route.approvalId);
    }

    if (route.kind === "intervention-action") {
      return handleInterventionAction(req, res, route.interventionId);
    }

    if (route.kind === "intervention-point-action") {
      return handleInterventionPointAction(req, res, route.pointId);
    }

    if (route.kind === "proxy-api") {
      return proxyApi(req, res, route.pathWithQuery);
    }

    if (route.kind === "asset") {
      return writeAsset(res, route.filePath);
    }

    return writeJson(res, 404, { error: "Not found" });
  } catch (error) {
    return writeJson(res, 500, { error: String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`OpenShock integrated shell listening on http://${host}:${port}`);
  console.log(`API upstream: ${apiUpstream}`);
});

function matchRoute(rawUrl) {
  const url = new URL(rawUrl, "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/runtime-config.js") {
    return { kind: "runtime-config" };
  }

  if (pathname === "/api/v0a/shell-state" && url.search.length === 0) {
    return { kind: "shell-state" };
  }

  const approvalDecisionMatch = pathname.match(/^\/api\/v0a\/approvals\/([^/]+)\/decision$/);
  if (approvalDecisionMatch) {
    return { kind: "approval-decision", approvalId: decodeURIComponent(approvalDecisionMatch[1]) };
  }

  const interventionActionMatch = pathname.match(/^\/api\/v0a\/interventions\/([^/]+)\/action$/);
  if (interventionActionMatch) {
    return { kind: "intervention-action", interventionId: decodeURIComponent(interventionActionMatch[1]) };
  }

  const interventionPointActionMatch = pathname.match(/^\/api\/v0a\/intervention-points\/([^/]+)\/action$/);
  if (interventionPointActionMatch) {
    return { kind: "intervention-point-action", pointId: decodeURIComponent(interventionPointActionMatch[1]) };
  }

  if (pathname.startsWith("/api/")) {
    return { kind: "proxy-api", pathWithQuery: `${pathname}${url.search}` };
  }

  if (pathname === "/" || pathname === "/index.html") {
    return { kind: "asset", filePath: path.resolve(root, "index.html") };
  }

  if (pathname === "/styles.css" || pathname.startsWith("/src/")) {
    return { kind: "asset", filePath: path.resolve(root, pathname.slice(1)) };
  }

  return { kind: "missing" };
}

async function writeAsset(res, filePath) {
  const safeRoot = `${root}${path.sep}`;
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(safeRoot)) {
    return writeJson(res, 403, { error: "Forbidden" });
  }
  const data = await fs.readFile(normalized);
  const extension = path.extname(normalized);
  const mime = mimeByExt.get(extension) || "application/octet-stream";
  res.writeHead(200, { "content-type": mime });
  res.end(data);
}

function writeRuntimeConfig(res) {
  const apiBaseUrl = configuredApiBase || `http://${host}:${port}`;
  const payload = `window.OPENSHOCK_SHELL_CONFIG = ${JSON.stringify({ apiBaseUrl })};`;
  res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
  res.end(payload);
}

async function writeShellState(res) {
  try {
    const topicId = await resolveConsumerTopicId();
    const encodedTopicId = encodeURIComponent(topicId);
    const [topicRead, topicStatusRead, topicStateRead, mergeLifecycleRead, taskAllocationRead, holdsRead, messages, runHistory] =
      await Promise.all([
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/status`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/topic-state`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/merge-lifecycle`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/task-allocation`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/approval-holds?status=pending&limit=50`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/messages?route=topic`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/run-history?limit=20`),
      ]);
    const payload = buildShellStatePayload({
      topicId,
      topic: topicRead?.topic ?? null,
      status: topicStatusRead?.status ?? null,
      topicState: topicStateRead?.topic_state ?? null,
      mergeLifecycle: mergeLifecycleRead?.merge_lifecycle ?? null,
      taskAllocation: taskAllocationRead?.task_allocation ?? null,
      approvalHolds: Array.isArray(holdsRead?.items) ? holdsRead.items : [],
      messages: Array.isArray(messages) ? messages : [],
      runHistory: Array.isArray(runHistory?.items) ? runHistory.items : [],
    });
    return writeJson(res, 200, payload);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleApprovalDecision(req, res, approvalId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const decision = normalizeDecision(input.decision);
    if (!decision) {
      return writeJson(res, 400, { error: "invalid_decision", message: "decision must be approve or reject" });
    }

    const topicId = await resolveConsumerTopicId();
    const encodedTopicId = encodeURIComponent(topicId);
    const operator = normalizeOperator(input.operator);
    await fetchUpstreamJson(`/v1/topics/${encodedTopicId}/actors/${encodeURIComponent(operator)}`, {
      method: "PUT",
      body: {
        role: "human",
        status: "active",
      },
    });
    const idempotencyKey = resolveIdempotencyKey(req, `approval:${topicId}:${approvalId}:${decision}`);
    const result = await fetchUpstreamJson(
      `/v1/topics/${encodedTopicId}/approval-holds/${encodeURIComponent(approvalId)}/decisions`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
        body: {
          decider_actor_id: operator,
          approve: decision === "approve",
          intervention_point: approvalId,
        },
      },
    );
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleInterventionAction(req, res, interventionId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const action = normalizeText(input.action);
    if (!action) {
      return writeJson(res, 400, { error: "invalid_action", message: "action is required" });
    }

    const topicId = await resolveConsumerTopicId();
    const encodedTopicId = encodeURIComponent(topicId);
    const operator = normalizeOperator(input.operator);
    await fetchUpstreamJson(`/v1/topics/${encodedTopicId}/actors/${encodeURIComponent(operator)}`, {
      method: "PUT",
      body: {
        role: "human",
        status: "active",
      },
    });
    const result = await fetchUpstreamJson(`/v1/topics/${encodedTopicId}/messages`, {
      method: "POST",
      body: {
        type: "status_report",
        sourceAgentId: operator,
        sourceRole: "human",
        targetScope: "topic",
        payload: {
          event: "shell_intervention_action",
          interventionId,
          action,
          note: normalizeNote(input.note),
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleInterventionPointAction(req, res, pointId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const action = normalizeInterventionPointAction(input.action);
    if (!action) {
      return writeJson(res, 400, { error: "invalid_action", message: "action must be approve, hold, or escalate" });
    }

    const topicId = await resolveConsumerTopicId();
    const encodedTopicId = encodeURIComponent(topicId);
    const operator = normalizeOperator(input.operator);
    await fetchUpstreamJson(`/v1/topics/${encodedTopicId}/actors/${encodeURIComponent(operator)}`, {
      method: "PUT",
      body: {
        role: "human",
        status: "active",
      },
    });
    const result = await fetchUpstreamJson(`/v1/topics/${encodedTopicId}/messages`, {
      method: "POST",
      body: {
        type: "status_report",
        sourceAgentId: operator,
        sourceRole: "human",
        targetScope: "topic",
        payload: {
          event: "shell_intervention_point_action",
          pointId,
          action,
          note: normalizeNote(input.note),
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function proxyApi(req, res, pathWithQuery) {
  const upstreamUrl = new URL(pathWithQuery, apiUpstream).toString();
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  const body = await readBody(req);
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });
  } catch (error) {
    return writeJson(res, 502, { error: `upstream unavailable: ${String(error)}` });
  }

  const text = await upstreamResponse.text();
  const responseHeaders = {
    "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
  };
  res.writeHead(upstreamResponse.status, responseHeaders);
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const body = await readBody(req);
  if (body.length === 0) {
    return {};
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new LocalRouteError(400, {
      error: "invalid_json",
      message: "request body must be valid JSON",
    });
  }
}

class LocalRouteError extends Error {
  constructor(statusCode, payload) {
    super(payload?.error || "local_route_error");
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

class UpstreamHttpError extends Error {
  constructor(statusCode, payload) {
    super(`upstream_http_${statusCode}`);
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

class UpstreamUnavailableError extends Error {
  constructor(original) {
    super("upstream_unavailable");
    this.original = original;
  }
}

async function fetchUpstreamJson(pathWithQuery, options = {}) {
  const url = new URL(pathWithQuery, apiUpstream).toString();
  const headers = {};
  if (options.headers && typeof options.headers === "object") {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof value === "string" && value.length > 0) {
        headers[key] = value;
      }
    }
  }
  const request = {
    method: options.method || "GET",
    headers,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    request.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, request);
  } catch (error) {
    throw new UpstreamUnavailableError(error);
  }
  const text = await response.text();
  const parsed = safeJsonParse(text);
  if (!response.ok) {
    throw new UpstreamHttpError(response.status, parsed || { error: "upstream_error", message: text });
  }
  return parsed || {};
}

function writeUpstreamError(res, error) {
  if (error instanceof LocalRouteError) {
    return writeJson(res, error.statusCode, error.payload);
  }
  if (error instanceof UpstreamHttpError) {
    return writeJson(res, error.statusCode, error.payload);
  }
  if (error instanceof UpstreamUnavailableError) {
    return writeJson(res, 502, { error: `upstream unavailable: ${String(error.original)}` });
  }
  return writeJson(res, 500, { error: String(error) });
}

function safeJsonParse(text) {
  if (!text || text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function resolveConsumerTopicId() {
  const topics = await fetchUpstreamJson("/v1/topics?limit=1");
  const firstTopic = Array.isArray(topics?.items) ? topics.items[0] : null;
  const topicId = typeof firstTopic?.topic_id === "string" ? firstTopic.topic_id.trim() : "";
  if (topicId.length === 0) {
    throw new LocalRouteError(502, {
      error: "consumer_topic_unavailable",
      message: "no topic available from /v1/topics",
    });
  }
  return topicId;
}

function normalizeDecision(decision) {
  if (decision === "approve" || decision === "reject") {
    return decision;
  }
  return null;
}

function normalizeInterventionPointAction(action) {
  if (action === "approve" || action === "hold" || action === "escalate") {
    return action;
  }
  return null;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOperator(value) {
  const normalized = normalizeText(value);
  return normalized || operatorAgentId;
}

function normalizeNote(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function resolveIdempotencyKey(req, fallbackPrefix) {
  const raw =
    req.headers?.["idempotency-key"] ||
    req.headers?.["Idempotency-Key"] ||
    req.headers?.["x-idempotency-key"] ||
    "";
  if (typeof raw === "string") {
    const normalized = raw.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return `${fallbackPrefix}:${Date.now()}`;
}

function buildShellStatePayload({
  topicId,
  topic,
  status,
  topicState,
  mergeLifecycle,
  taskAllocation,
  approvalHolds,
  messages,
  runHistory,
}) {
  const now = Date.now();
  const normalizedTopicState = normalizeTopicState(topicState, status);
  const normalizedStatus = normalizeStatus(status, normalizedTopicState);
  const normalizedMergeLifecycle = normalizeMergeLifecycle(mergeLifecycle, normalizedStatus);
  const normalizedTaskAllocation = normalizeTaskAllocation(taskAllocation);
  const normalizedApprovals = normalizeApprovalHolds(approvalHolds);
  const normalizedMessages = normalizeMessages(messages);
  const normalizedRunHistory = normalizeRunHistory(runHistory);
  const actors = normalizeTopicActors(topic);
  const leadAgent = actors.find((agent) => normalizeText(agent?.role) === "lead");

  const activeActorCount = Number(normalizedStatus.active_actor_count || 0);
  const blockedActorCount = Number(normalizedStatus.blocked_actor_count || 0);
  const coarseModel = {
    revision: normalizedTopicState.revision,
    activeAgents: Array.from({ length: Math.max(0, activeActorCount) }, (_, index) => `active_${index}`),
    blockedAgents: Array.from({ length: Math.max(0, blockedActorCount) }, (_, index) => `blocked_${index}`),
    pendingApprovalCount: Number(normalizedTopicState.pending_approval_count || 0),
    openConflictCount: Number(normalizedTopicState.open_conflict_count || 0),
    blockerCount: Number(normalizedTopicState.blocker_count || 0),
    riskFlags: Array.isArray(normalizedStatus.risk_flags) ? normalizedStatus.risk_flags : [],
    deliveryState: {
      state: normalizedMergeLifecycle.delivery?.state || "unknown",
      prUrl: normalizedMergeLifecycle.delivery?.pr_url || null,
      lastUpdatedAt: normalizedStatus.updated_at || topic?.updated_at || new Date().toISOString(),
    },
  };

  const openConflicts = Array.isArray(topic?.open_conflicts) ? topic.open_conflicts : [];
  const blockers = Array.isArray(topic?.blockers) ? topic.blockers : [];

  return {
    generatedAt: new Date().toISOString(),
    topics: [
      {
        id: topicId,
        title: topic?.goal || "Integrated runtime topic",
        revision: Number(normalizedTopicState.revision || topic?.revision || 0),
        leadAgent: leadAgent?.actor_id || leadAgent?.agentId || "n/a",
        status: computeTopicStatus({ pendingApprovals: normalizedApprovals, blockers, openConflicts }),
        pendingApprovals: normalizedApprovals.length,
        deliveryState: normalizedMergeLifecycle.delivery?.state || "unknown",
        riskLevel: computeRiskLevel({ blockers, openConflicts }),
      },
    ],
    agents: mapAgents(actors, now),
    delivery: [
      {
        topicId,
        stage: normalizedMergeLifecycle.stage || "unknown",
        prState: normalizedMergeLifecycle.delivery?.pr_url ? "open" : "none",
        nextGate: normalizedApprovals.length > 0 ? "human_gate_pending" : "none",
        updatedAt: coarseModel.deliveryState.lastUpdatedAt,
      },
    ],
    approvals: normalizedApprovals.map((hold) => ({
      id: hold.holdId,
      gateType: hold.gate,
      topicId,
      runId: "runtime",
      requestedBy: "server",
      createdAt: hold.createdAt,
      note: `gate ${hold.gate}`,
      status: hold.status,
    })),
    interventionPoints: buildInterventionPoints(topicId, normalizedMessages, coarseModel, normalizedApprovals.length),
    interventions: buildInterventions(topicId, blockers, openConflicts),
    observability: {
      metrics: buildMetrics(coarseModel, blockers, openConflicts),
      events: buildEvents(
        topicId,
        normalizedMessages,
        blockers,
        openConflicts,
        normalizedRunHistory,
        normalizedTaskAllocation,
      ),
    },
  };
}

function normalizeTopicActors(topic) {
  if (!topic || typeof topic !== "object") {
    return [];
  }
  if (Array.isArray(topic.agents)) {
    return topic.agents;
  }
  if (Array.isArray(topic.actor_registry)) {
    return topic.actor_registry;
  }
  return [];
}

function normalizeTopicState(topicState, status) {
  const source = topicState && typeof topicState === "object" ? topicState : status?.topic_state ?? {};
  return {
    revision: Number(source?.revision || status?.revision || 0),
    merge_stage: normalizeText(source?.merge_stage) || "unknown",
    open_conflict_count: Number(source?.open_conflict_count || status?.open_conflict_count || 0),
    pending_approval_count: Number(source?.pending_approval_count || status?.pending_approval_count || 0),
    blocker_count: Number(source?.blocker_count || status?.blocker_count || 0),
  };
}

function normalizeStatus(status, topicState) {
  const source = status && typeof status === "object" ? status : {};
  return {
    revision: Number(source.revision || topicState.revision || 0),
    active_actor_count: Number(source.active_actor_count || 0),
    blocked_actor_count: Number(source.blocked_actor_count || 0),
    open_conflict_count: Number(source.open_conflict_count || topicState.open_conflict_count || 0),
    pending_approval_count: Number(source.pending_approval_count || topicState.pending_approval_count || 0),
    blocker_count: Number(source.blocker_count || topicState.blocker_count || 0),
    risk_flags: Array.isArray(source.risk_flags) ? source.risk_flags : [],
    delivery_state: source.delivery_state && typeof source.delivery_state === "object" ? source.delivery_state : {},
    updated_at: source.updated_at || null,
  };
}

function normalizeMergeLifecycle(mergeLifecycle, status) {
  const source = mergeLifecycle && typeof mergeLifecycle === "object" ? mergeLifecycle : {};
  return {
    stage: normalizeText(source.stage) || normalizeText(status?.topic_state?.merge_stage) || "unknown",
    delivery: {
      state: normalizeText(source?.delivery?.state || status?.delivery_state?.state) || "unknown",
      pr_url: source?.delivery?.pr_url || status?.delivery_state?.pr_url || null,
    },
  };
}

function normalizeTaskAllocation(taskAllocation) {
  const items = Array.isArray(taskAllocation?.items) ? taskAllocation.items : [];
  return {
    summary: {
      total_tasks: Number(taskAllocation?.summary?.total_tasks || items.length),
      assigned_tasks: Number(taskAllocation?.summary?.assigned_tasks || 0),
      unassigned_tasks: Number(taskAllocation?.summary?.unassigned_tasks || Math.max(0, items.length)),
    },
  };
}

function normalizeApprovalHolds(approvalHolds) {
  if (!Array.isArray(approvalHolds)) {
    return [];
  }
  return approvalHolds.map((hold) => ({
    holdId: normalizeText(hold?.hold_id || hold?.holdId),
    gate: normalizeText(hold?.gate) || "approval_hold",
    status: normalizeText(hold?.status) || "pending",
    createdAt: hold?.created_at || hold?.createdAt || new Date().toISOString(),
  }));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map((message) => ({
    ...message,
    createdAt: message?.createdAt || message?.created_at || message?.at || new Date().toISOString(),
  }));
}

function normalizeRunHistory(runHistory) {
  if (!Array.isArray(runHistory)) {
    return [];
  }
  return runHistory.map((item) => ({
    runId: normalizeText(item?.run_id || item?.runId),
    state: normalizeText(item?.state) || "unknown",
    summary: normalizeText(item?.summary) || "run_history",
    updatedAt: item?.updated_at || item?.updatedAt || item?.at || new Date().toISOString(),
  }));
}

function mapAgents(agents, nowMs) {
  if (!Array.isArray(agents)) {
    return [];
  }
  return agents.map((agent) => ({
    displayName: agent.agentId || agent.actor_id || "unknown_actor",
    role: agent.role || "unknown",
    status: agent.status || "unknown",
    currentLane: agent.laneId || agent.lane_id || "topic",
    lastHeartbeatSec: secondsSince(agent.lastSeenAt || agent.last_seen_at, nowMs),
    blockedOn: (agent.status || "").toLowerCase() === "blocked" ? "coordinator_blocker" : null,
  }));
}

function secondsSince(timestamp, nowMs) {
  const parsed = Date.parse(timestamp || "");
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const diff = Math.floor((nowMs - parsed) / 1000);
  if (!Number.isFinite(diff) || diff < 0) {
    return 0;
  }
  return diff;
}

function computeTopicStatus({ pendingApprovals, blockers, openConflicts }) {
  if ((blockers?.length || 0) > 0 || (openConflicts?.length || 0) > 0) {
    return "blocked";
  }
  if ((pendingApprovals?.length || 0) > 0) {
    return "approval_required";
  }
  return "active";
}

function computeRiskLevel({ blockers, openConflicts }) {
  const blockerCount = blockers?.length || 0;
  const conflictCount = openConflicts?.length || 0;
  if (blockerCount > 0 || conflictCount > 0) {
    return "high";
  }
  return "low";
}

function buildInterventionPoints(topicId, messages, coarse, pendingApprovalCount) {
  const latestByPoint = new Map();
  for (const message of messages) {
    if (message?.type !== "status_report") {
      continue;
    }
    const payload = message.payload || {};
    if (payload.event !== "shell_intervention_point_action") {
      continue;
    }
    if (typeof payload.pointId !== "string" || payload.pointId.length === 0) {
      continue;
    }
    const previous = latestByPoint.get(payload.pointId);
    if (!previous || Date.parse(previous.createdAt) < Date.parse(message.createdAt)) {
      latestByPoint.set(payload.pointId, {
        action: payload.action,
        note: payload.note,
        createdAt: message.createdAt,
      });
    }
  }

  return FIXED_INTERVENTION_POINTS.map((point) => {
    const latest = latestByPoint.get(point.id);
    return {
      id: point.id,
      name: point.name,
      topicId,
      owner: point.owner,
      status: latest?.action ? mapInterventionPointStatus(latest.action) : defaultPointStatus(point.id, coarse, pendingApprovalCount),
      note: latest?.note || defaultPointNote(point.id, coarse),
      allowedActions: ["approve", "hold", "escalate"],
    };
  });
}

function defaultPointStatus(pointId, coarse, pendingApprovalCount) {
  if (pointId === "lead_plan") {
    return Number(coarse?.revision || 0) > 1 ? "approved" : "pending";
  }
  if (pointId === "worker_dispatch") {
    const activeAgents = Array.isArray(coarse?.activeAgents) ? coarse.activeAgents.length : 0;
    return activeAgents >= 2 ? "active" : "pending";
  }
  if (pointId === "merge_closeout") {
    if (pendingApprovalCount > 0 || coarse?.deliveryState?.state === "awaiting_merge_gate") {
      return "pending";
    }
    if (coarse?.deliveryState?.state === "pr_ready") {
      return "approved";
    }
  }
  return "pending";
}

function defaultPointNote(pointId, coarse) {
  if (pointId === "merge_closeout") {
    return `delivery=${coarse?.deliveryState?.state || "unknown"}`;
  }
  return "runtime-linked";
}

function mapInterventionPointStatus(action) {
  if (action === "approve") {
    return "approved";
  }
  if (action === "hold") {
    return "hold";
  }
  if (action === "escalate") {
    return "blocked";
  }
  return "pending";
}

function buildInterventions(topicId, blockers, openConflicts) {
  const interventions = [];
  for (const blocker of blockers || []) {
    interventions.push({
      id: blocker.blockerId || `blocker_${interventions.length + 1}`,
      type: "blocker",
      topicId,
      runId: blocker.runId || "runtime",
      requestedBy: blocker.messageId || "coordinator",
      createdAt: blocker.createdAt || new Date().toISOString(),
      note: blocker.reason || "runtime blocker",
      status: "pending",
      recommendedActions: ["request_report", "reroute"],
    });
  }
  for (const conflict of openConflicts || []) {
    interventions.push({
      id: conflict.conflictId || `conflict_${interventions.length + 1}`,
      type: "conflict",
      topicId,
      runId: "runtime",
      requestedBy: conflict.challengeMessageId || "coordinator",
      createdAt: conflict.createdAt || new Date().toISOString(),
      note: "unresolved challenge",
      status: "pending",
      recommendedActions: ["request_report", "escalate"],
    });
  }
  return interventions;
}

function buildMetrics(coarse, blockers, openConflicts) {
  const activeAgents = Array.isArray(coarse?.activeAgents) ? coarse.activeAgents.length : 0;
  const blockedAgents = Array.isArray(coarse?.blockedAgents) ? coarse.blockedAgents.length : 0;
  const pendingApprovals = Number(coarse?.pendingApprovalCount || 0);
  const blockerCount = Number(coarse?.blockerCount || (blockers?.length || 0));
  const conflictCount = Number(coarse?.openConflictCount || (openConflicts?.length || 0));

  return [
    {
      label: "Active Agents",
      value: String(activeAgents),
      delta: blockedAgents > 0 ? `${blockedAgents} blocked` : "all clear",
      trend: blockedAgents > 0 ? "down" : "flat",
    },
    {
      label: "Pending Approvals",
      value: String(pendingApprovals),
      delta: pendingApprovals > 0 ? "human gate waiting" : "none",
      trend: pendingApprovals > 0 ? "up" : "flat",
    },
    {
      label: "Blockers",
      value: String(blockerCount),
      delta: conflictCount > 0 ? `${conflictCount} open conflicts` : "stable",
      trend: blockerCount > 0 || conflictCount > 0 ? "up" : "flat",
    },
  ];
}

function buildEvents(topicId, messages, blockers, openConflicts, runHistory, taskAllocation) {
  const timeline = [];
  for (const message of messages || []) {
    const eventName = normalizeText(message?.payload?.event);
    timeline.push({
      at: message.createdAt || new Date().toISOString(),
      topicId,
      message: eventName
        ? `${message.type} (${eventName}) · ${message.state}`
        : `${message.type} · ${message.state}`,
      severity: deriveSeverity(message),
    });
  }
  for (const blocker of blockers || []) {
    timeline.push({
      at: blocker.createdAt || new Date().toISOString(),
      topicId,
      message: `blocker · ${blocker.reason || "runtime blocker"}`,
      severity: "warning",
    });
  }
  for (const conflict of openConflicts || []) {
    timeline.push({
      at: conflict.createdAt || new Date().toISOString(),
      topicId,
      message: `conflict · ${conflict.conflictId}`,
      severity: "warning",
    });
  }
  for (const runItem of runHistory || []) {
    timeline.push({
      at: runItem.updatedAt || new Date().toISOString(),
      topicId,
      message: `run_history · ${runItem.runId || "unknown"} · ${runItem.state}`,
      severity: runItem.state === "failed" ? "warning" : "info",
    });
  }
  if (taskAllocation?.summary) {
    timeline.push({
      at: new Date().toISOString(),
      topicId,
      message: `task_allocation · total=${taskAllocation.summary.total_tasks} assigned=${taskAllocation.summary.assigned_tasks}`,
      severity: "info",
    });
  }

  timeline.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return timeline.slice(0, 20);
}

function deriveSeverity(message) {
  if (message?.state === "rejected" || message?.state === "blocked_conflict") {
    return "warning";
  }
  if (message?.type === "blocker_escalation" || message?.type === "challenge") {
    return "warning";
  }
  return "info";
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
