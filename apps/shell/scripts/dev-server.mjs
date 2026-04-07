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
const configuredOperatorId =
  typeof process.env.SHELL_OPERATOR_ID === "string" && process.env.SHELL_OPERATOR_ID.trim().length > 0
    ? process.env.SHELL_OPERATOR_ID.trim()
    : "";
const configuredChannelId =
  typeof process.env.SHELL_CHANNEL_ID === "string" && process.env.SHELL_CHANNEL_ID.trim().length > 0
    ? process.env.SHELL_CHANNEL_ID.trim()
    : "";
const configuredChannelCandidates =
  typeof process.env.SHELL_CHANNEL_CANDIDATES === "string" && process.env.SHELL_CHANNEL_CANDIDATES.trim().length > 0
    ? process.env.SHELL_CHANNEL_CANDIDATES
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : ["channel_stage4a1_review", "channel_open_shock_stage4a1"];

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

const STAGE4A2_NOTIFICATION_RULE_REFERENCE = {
  inbox: "all_events",
  browser_push: ["blocked", "approval_required", "mention", "pr_pending_review"],
  email: ["invite", "verify", "reset_password", "high_priority_escalation"],
};

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

    if (route.kind === "run-follow-up") {
      return handleRunFollowUp(req, res, route.runId);
    }

    if (route.kind === "operator-repo-binding-upsert") {
      return handleOperatorRepoBindingUpsert(req, res);
    }

    if (route.kind === "operator-channel-context-upsert") {
      return handleOperatorChannelContextUpsert(req, res);
    }

    if (route.kind === "workspace-governance-member-upsert") {
      return handleWorkspaceGovernanceMemberUpsert(req, res);
    }

    if (route.kind === "workspace-governance-github-identity-upsert") {
      return handleWorkspaceGovernanceGithubIdentityUpsert(req, res);
    }

    if (route.kind === "workspace-governance-github-installation-upsert") {
      return handleWorkspaceGovernanceGithubInstallationUpsert(req, res);
    }

    if (route.kind === "operator-agent-upsert") {
      return handleOperatorAgentUpsert(req, res, route.actorId);
    }

    if (route.kind === "operator-agent-assignment") {
      return handleOperatorAgentAssignment(req, res, route.actorId);
    }

    if (route.kind === "operator-agent-recovery-action") {
      return handleOperatorAgentRecoveryAction(req, res, route.actorId);
    }

    if (route.kind === "operator-action") {
      return handleOperatorAction(req, res);
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

  const runFollowUpMatch = pathname.match(/^\/api\/v0a\/runs\/([^/]+)\/follow-up$/);
  if (runFollowUpMatch) {
    return { kind: "run-follow-up", runId: decodeURIComponent(runFollowUpMatch[1]) };
  }

  if (pathname === "/api/v0a/operator/repo-binding" && url.search.length === 0) {
    return { kind: "operator-repo-binding-upsert" };
  }

  if (pathname === "/api/v0a/operator/channel-context" && url.search.length === 0) {
    return { kind: "operator-channel-context-upsert" };
  }

  if (pathname === "/api/v0a/workspace-governance/member-upsert" && url.search.length === 0) {
    return { kind: "workspace-governance-member-upsert" };
  }

  if (pathname === "/api/v0a/workspace-governance/github-identity-upsert" && url.search.length === 0) {
    return { kind: "workspace-governance-github-identity-upsert" };
  }

  if (pathname === "/api/v0a/workspace-governance/github-installation-upsert" && url.search.length === 0) {
    return { kind: "workspace-governance-github-installation-upsert" };
  }

  const operatorAgentUpsertMatch = pathname.match(/^\/api\/v0a\/operator\/agents\/([^/]+)\/upsert$/);
  if (operatorAgentUpsertMatch) {
    return { kind: "operator-agent-upsert", actorId: decodeURIComponent(operatorAgentUpsertMatch[1]) };
  }

  const operatorAgentAssignmentMatch = pathname.match(/^\/api\/v0a\/operator\/agents\/([^/]+)\/assignment$/);
  if (operatorAgentAssignmentMatch) {
    return { kind: "operator-agent-assignment", actorId: decodeURIComponent(operatorAgentAssignmentMatch[1]) };
  }

  const operatorAgentRecoveryMatch = pathname.match(/^\/api\/v0a\/operator\/agents\/([^/]+)\/recovery-actions$/);
  if (operatorAgentRecoveryMatch) {
    return { kind: "operator-agent-recovery-action", actorId: decodeURIComponent(operatorAgentRecoveryMatch[1]) };
  }

  if (pathname === "/api/v0a/operator/actions" && url.search.length === 0) {
    return { kind: "operator-action" };
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
    const [
      topicRead,
      topicStatusRead,
      topicStateRead,
      mergeLifecycleRead,
      taskAllocationRead,
      holdsRead,
      messages,
      runHistory,
      topicNotificationsRead,
      runtimeConfigRead,
      runtimeSmokeRead,
      repoBindingRead,
      actorListRead,
      controlEventsRead,
      runtimeRegistryRead,
      runtimeAgentsRead,
      runtimeWorktreeClaimsRead,
    ] = await Promise.all([
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/status`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/topic-state`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/merge-lifecycle`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/task-allocation`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/approval-holds?status=pending&limit=50`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/messages?route=topic`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/run-history?limit=20`),
        fetchOptionalUpstreamJson(`/v1/topics/${encodedTopicId}/notifications?limit=50`),
        fetchUpstreamJson("/runtime/config"),
        fetchUpstreamJson("/runtime/smoke"),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/repo-binding`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/actors?limit=100`),
        fetchUpstreamJson(`/v1/topics/${encodedTopicId}/events?limit=20`),
        fetchUpstreamJson("/v1/runtime/registry"),
        fetchUpstreamJson("/v1/runtime/agents?limit=200"),
        fetchUpstreamJson("/v1/runtime/worktree-claims?limit=200"),
      ]);
    const runtimeAgents = Array.isArray(runtimeAgentsRead?.items) ? runtimeAgentsRead.items : [];
    const runtimeWorktreeClaims = Array.isArray(runtimeWorktreeClaimsRead?.items)
      ? runtimeWorktreeClaimsRead.items
      : [];
    const scope = deriveOperatorScope({
      topicId,
      runtimeRegistry: runtimeRegistryRead ?? null,
      runtimeAgents,
    });
    const channelCandidates = buildChannelIdCandidates({
      scopeChannelId: scope.channelId,
      configuredChannelId,
      configuredChannelCandidates,
      topicRepoBindingProjection: repoBindingRead?.repo_binding ?? null,
    });
    const resolvedChannelContext = await resolveChannelContextFromCandidates(channelCandidates);
    const channelId = normalizeText(resolvedChannelContext.channelId);
    const effectiveScope = {
      ...scope,
      channelId,
    };
    const encodedChannelId = channelId ? encodeURIComponent(channelId) : "";
    const [
      channelRepoBindingRead,
      channelNotificationEndpointRead,
      channelAuditTrailRead,
      channelWorkAssignmentsRead,
      channelOperatorActionsRead,
      channelRecentActionsRead,
      recoveryActionsRead,
      channelExternalMemoryProviderRead,
    ] = await Promise.all([
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/repo-binding` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/notification-endpoint` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/audit-trail?limit=50` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/work-assignments?limit=100` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/operator-actions?limit=100` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/recent-actions?limit=100` : ""),
      fetchOptionalUpstreamJson(buildRuntimeRecoveryActionsPath(effectiveScope)),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/external-memory-provider` : ""),
    ]);
    const channelMemoryViewerRead = await resolveChannelMemoryViewerRead({
      channelId,
      encodedChannelId,
      channelExternalMemoryProviderRead,
    });
    const channelContextRead = resolvedChannelContext.contextRead;
    const workspaceId = resolveWorkspaceIdFromChannelContext(channelContextRead.payload?.context);
    const workspaceGovernanceProjection = buildWorkspaceGovernanceProjectionFromChannelTruth({
      workspaceId,
      channelContextRead,
      channelRepoBindingRead,
    });

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
      topicNotifications: Array.isArray(topicNotificationsRead.payload?.items) ? topicNotificationsRead.payload.items : [],
      runtimeConfig: runtimeConfigRead ?? null,
      runtimeSmoke: runtimeSmokeRead ?? null,
      repoBindingProjection: repoBindingRead?.repo_binding ?? null,
      channelContextContract: channelContextRead.payload?.context ?? null,
      channelNotificationEndpointContract: channelNotificationEndpointRead.payload?.notification_endpoint ?? null,
      channelExternalMemoryProviderContract:
        channelExternalMemoryProviderRead.payload?.external_memory_provider ?? null,
      channelMemoryViewerProjection: channelMemoryViewerRead.payload?.memory_viewer ?? null,
      channelRepoBindingConfig: channelRepoBindingRead.payload?.repo_binding ?? null,
      channelAuditTrail: Array.isArray(channelAuditTrailRead.payload?.items) ? channelAuditTrailRead.payload.items : [],
      channelWorkAssignments: Array.isArray(channelWorkAssignmentsRead.payload?.items)
        ? channelWorkAssignmentsRead.payload.items
        : [],
      channelOperatorActions: Array.isArray(channelOperatorActionsRead.payload?.items)
        ? channelOperatorActionsRead.payload.items
        : [],
      channelRecentActions: Array.isArray(channelRecentActionsRead.payload?.items)
        ? channelRecentActionsRead.payload.items
        : [],
      runtimeRecoveryActions: Array.isArray(recoveryActionsRead.payload?.items) ? recoveryActionsRead.payload.items : [],
      workspaceGovernance: workspaceGovernanceProjection,
      runtimeRegistry: runtimeRegistryRead ?? null,
      runtimeAgents,
      runtimeWorktreeClaims,
      scope: effectiveScope,
      channelSurface: {
        context_status: channelContextRead.status,
        notification_endpoint_status: channelNotificationEndpointRead.status,
        repo_binding_status: channelRepoBindingRead.status,
        audit_trail_status: channelAuditTrailRead.status,
        work_assignments_status: channelWorkAssignmentsRead.status,
        operator_actions_status: channelOperatorActionsRead.status,
        recent_actions_status: channelRecentActionsRead.status,
        recovery_actions_status: recoveryActionsRead.status,
        external_memory_provider_status: channelExternalMemoryProviderRead.status,
        memory_viewer_status: channelMemoryViewerRead.status,
      },
      actorRegistry: Array.isArray(actorListRead?.items) ? actorListRead.items : [],
      controlEvents: Array.isArray(controlEventsRead?.items) ? controlEventsRead.items : [],
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

async function handleRunFollowUp(req, res, runId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const normalizedRunId = normalizeText(runId);
    if (!normalizedRunId) {
      return writeJson(res, 400, { error: "invalid_run_id", message: "runId is required" });
    }

    const input = await readJsonBody(req);
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
          event: "shell_follow_up_request",
          runId: normalizedRunId,
          note: normalizeNote(input.note),
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleOperatorRepoBindingUpsert(req, res) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const repoRef = normalizeText(input.repo_ref);
    if (!repoRef) {
      return writeJson(res, 400, { error: "invalid_repo_ref", message: "repo_ref is required" });
    }
    const provider = normalizeText(input.provider) || "github";
    const defaultBranch = normalizeText(input.default_branch) || null;
    const scope = await resolveOperatorScope();
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId);
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const topicId = normalizeText(input.topic_id) || normalizeText(scope.topicId);
    if (!topicId) {
      return writeJson(res, 400, { error: "invalid_topic_id", message: "topic_id is required" });
    }
    const operator = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const fixedDirectory = normalizeText(input.fixed_directory) || null;
    const result = await fetchUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/repo-binding`, {
      method: "PUT",
      body: {
        operator_id: operator,
        topic_id: topicId,
        provider_ref: {
          provider,
          repo_ref: repoRef,
        },
        default_branch: defaultBranch,
        fixed_directory: fixedDirectory,
        policy_snapshot: {
          mode: "single_human_multi_agent",
          source: "shell_operator_console",
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleOperatorChannelContextUpsert(req, res) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const scope = await resolveOperatorScope();
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId);
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const operator = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const workspaceId = normalizeText(input.workspace_id) || null;
    const workspaceRoot = normalizeText(input.workspace_root) || null;
    const baselineRef = normalizeText(input.baseline_ref) || null;
    const fixedDirectory = normalizeText(input.fixed_directory) || null;
    const docPaths = normalizeStringArray(input.doc_paths);
    const runtimeEntries = normalizeStringArray(input.runtime_entries);
    const ruleEntries = normalizeStringArray(input.rule_entries);
    const result = await fetchUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/context`, {
      method: "PUT",
      body: {
        operator_id: operator,
        workspace_id: workspaceId,
        workspace_root: workspaceRoot,
        baseline_ref: baselineRef,
        fixed_directory: fixedDirectory,
        doc_paths: docPaths.length > 0 ? docPaths : undefined,
        runtime_entries: runtimeEntries.length > 0 ? runtimeEntries : undefined,
        rule_entries: ruleEntries.length > 0 ? ruleEntries : undefined,
        policy_snapshot: {
          mode: "single_human_multi_agent",
          boundary: "channel_aligned_entry",
          source: "shell_operator_console",
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleWorkspaceGovernanceMemberUpsert(req, res) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const scope = await resolveOperatorScope();
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId);
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const workspaceId = normalizeText(input.workspace_id) || null;
    const memberId = normalizeText(input.member_id);
    if (!memberId) {
      return writeJson(res, 400, { error: "invalid_member_id", message: "member_id is required" });
    }
    const role = normalizeText(input.role);
    if (!role) {
      return writeJson(res, 400, { error: "invalid_member_role", message: "role is required" });
    }
    const status = normalizeText(input.status) || "active";
    const operatorId = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const result = await fetchUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/context`, {
      method: "PUT",
      body: {
        operator_id: operatorId,
        workspace_id: workspaceId,
        member: {
          member_id: memberId,
          role,
          status,
        },
        policy_snapshot: {
          mode: "multi_human_governance_stage4a1",
          source: "shell_workspace_governance",
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleWorkspaceGovernanceGithubIdentityUpsert(req, res) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const scope = await resolveOperatorScope();
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId);
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const workspaceId = normalizeText(input.workspace_id) || null;
    const provider = normalizeText(input.provider) || "github";
    const githubLogin = normalizeText(input.github_login);
    const providerUserId = normalizeText(input.provider_user_id);
    if (!githubLogin && !providerUserId) {
      return writeJson(res, 400, {
        error: "invalid_identity",
        message: "github_login or provider_user_id is required",
      });
    }
    const operatorId = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const identityId = providerUserId || githubLogin;
    const result = await fetchUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/context`, {
      method: "PUT",
      body: {
        operator_id: operatorId,
        workspace_id: workspaceId,
        auth_identity: {
          identity_id: identityId,
          provider,
          subject_ref: providerUserId || identityId,
          github_login: githubLogin || null,
          status: "bound",
        },
        policy_snapshot: {
          mode: "multi_human_governance_stage4a1",
          source: "shell_workspace_governance",
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleWorkspaceGovernanceGithubInstallationUpsert(req, res) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const scope = await resolveOperatorScope();
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId);
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const workspaceId = normalizeText(input.workspace_id) || null;
    const installationId = normalizeText(input.installation_id);
    if (!installationId) {
      return writeJson(res, 400, { error: "invalid_installation_id", message: "installation_id is required" });
    }
    const status = normalizeText(input.status) || "installed";
    const operatorId = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const authorizedRepos = normalizeStringArray(input.authorized_repos);
    const result = await fetchUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/context`, {
      method: "PUT",
      body: {
        operator_id: operatorId,
        workspace_id: workspaceId,
        github_installation: {
          installation_id: installationId,
          provider: normalizeText(input.provider) || "github",
          workspace_id: workspaceId,
          status,
          authorized_repos: authorizedRepos,
        },
        policy_snapshot: {
          mode: "multi_human_governance_stage4a1",
          source: "shell_workspace_governance",
        },
      },
    });
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleOperatorAgentUpsert(req, res, actorId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const normalizedActorId = normalizeText(actorId);
    if (!normalizedActorId) {
      return writeJson(res, 400, { error: "invalid_actor_id", message: "actorId is required" });
    }
    const input = await readJsonBody(req);
    const role = normalizeText(input.role);
    if (!role) {
      return writeJson(res, 400, { error: "invalid_actor_role", message: "role is required" });
    }
    const status = normalizeText(input.status) || "active";
    const laneId = normalizeText(input.lane_id) || null;
    const topicId = await resolveConsumerTopicId();
    const encodedTopicId = encodeURIComponent(topicId);
    const result = await fetchUpstreamJson(
      `/v1/topics/${encodedTopicId}/actors/${encodeURIComponent(normalizedActorId)}`,
      {
        method: "PUT",
        body: {
          role,
          status,
          lane_id: laneId,
        },
      },
    );
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleOperatorAgentAssignment(req, res, actorId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const normalizedActorId = normalizeText(actorId);
    if (!normalizedActorId) {
      return writeJson(res, 400, { error: "invalid_actor_id", message: "actorId is required" });
    }
    const input = await readJsonBody(req);
    const scope = await resolveOperatorScope();
    const operatorId = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId);
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const threadId = normalizeText(input.thread_id) || normalizeText(scope.threadId) || null;
    const workitemId = normalizeText(input.workitem_id) || normalizeText(scope.workitemId) || null;
    const defaultDuty = normalizeText(input.default_duty) || null;
    const note = normalizeText(input.note) || null;
    const result = await fetchUpstreamJson(
      `/v1/channels/${encodeURIComponent(channelId)}/work-assignments/${encodeURIComponent(normalizedActorId)}`,
      {
        method: "PUT",
        body: {
          operator_id: operatorId,
          thread_id: threadId,
          workitem_id: workitemId,
          default_duty: defaultDuty,
          note,
          policy_snapshot: {
            mode: "single_human_multi_agent",
            source: "shell_operator_console",
          },
        },
      },
    );
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleOperatorAgentRecoveryAction(req, res, actorId) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const normalizedActorId = normalizeText(actorId);
    if (!normalizedActorId) {
      return writeJson(res, 400, { error: "invalid_actor_id", message: "actorId is required" });
    }
    const input = await readJsonBody(req);
    const action = normalizeText(input.action);
    if (!["resume", "rebind", "reclaim_worktree"].includes(action)) {
      return writeJson(res, 400, {
        error: "invalid_runtime_recovery_action",
        message: "action must be one of resume/rebind/reclaim_worktree",
      });
    }
    const scope = await resolveOperatorScope();
    const operatorId = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId) || null;
    const threadId = normalizeText(input.thread_id) || normalizeText(scope.threadId) || null;
    const workitemId = normalizeText(input.workitem_id) || normalizeText(scope.workitemId) || null;
    const reason = normalizeText(input.reason) || null;
    const claimKey = normalizeText(input.claim_key) || null;
    const repoRef = normalizeText(input.repo_ref) || null;
    const branch = normalizeText(input.branch) || null;
    const laneId = normalizeText(input.lane_id) || null;
    const status = normalizeText(input.status) || null;
    const result = await fetchUpstreamJson(
      `/v1/runtime/agents/${encodeURIComponent(normalizedActorId)}/recovery-actions`,
      {
        method: "POST",
        body: {
          action,
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId,
          reason,
          claim_key: claimKey,
          repo_ref: repoRef,
          branch,
          lane_id: laneId,
          status,
        },
      },
    );
    return writeJson(res, 200, result);
  } catch (error) {
    return writeUpstreamError(res, error);
  }
}

async function handleOperatorAction(req, res) {
  try {
    if (req.method !== "POST") {
      return writeJson(res, 405, { error: "method_not_allowed" });
    }
    const input = await readJsonBody(req);
    const actionType = normalizeOperatorActionType(input.action_type || input.action);
    if (!actionType) {
      return writeJson(res, 400, { error: "invalid_operator_action_type", message: "unsupported operator action type" });
    }

    const scope = await resolveOperatorScope();
    const operatorId = normalizeText(input.operator) || normalizeText(scope.operatorId) || normalizeOperator(input.operator);
    const channelId = normalizeText(input.channel_id) || normalizeText(scope.channelId) || "";
    if (!channelId) {
      return writeJson(res, 400, { error: "invalid_channel_id", message: "channel_id is required" });
    }
    const agentId = normalizeText(input.agent_id || input.target_agent_id) || null;
    const threadId = normalizeText(input.thread_id) || normalizeText(scope.threadId) || null;
    const workitemId = normalizeText(input.workitem_id) || normalizeText(scope.workitemId) || null;
    const result = await fetchUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/operator-actions`, {
      method: "POST",
      body: {
        operator_id: operatorId,
        action_type: actionType,
        agent_id: agentId,
        thread_id: threadId,
        workitem_id: workitemId,
        note: normalizeNote(input.note),
        payload: {
          run_id: normalizeText(input.run_id) || null,
        },
        policy_snapshot: {
          mode: "single_human_multi_agent",
          source: "shell_operator_console",
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

async function resolveOperatorScope() {
  const topicId = await resolveConsumerTopicId();
  const [runtimeRegistryRead, runtimeAgentsRead] = await Promise.all([
    fetchUpstreamJson("/v1/runtime/registry"),
    fetchUpstreamJson("/v1/runtime/agents?limit=200"),
  ]);
  const runtimeAgents = Array.isArray(runtimeAgentsRead?.items) ? runtimeAgentsRead.items : [];
  return deriveOperatorScope({
    topicId,
    runtimeRegistry: runtimeRegistryRead ?? null,
    runtimeAgents,
  });
}

function deriveOperatorScope({ topicId, runtimeRegistry, runtimeAgents }) {
  const mergedAgents = [];
  if (Array.isArray(runtimeRegistry?.agents)) {
    mergedAgents.push(...runtimeRegistry.agents);
  }
  if (Array.isArray(runtimeAgents)) {
    mergedAgents.push(...runtimeAgents);
  }

  let operatorId = configuredOperatorId;
  let channelId = configuredChannelId;
  let threadId = "";
  let workitemId = "";

  for (const item of mergedAgents) {
    const candidateOperatorId = normalizeText(item?.owner_operator_id || item?.operator_id);
    const candidateChannelId = normalizeText(item?.assigned_channel_id || item?.channel_id);
    const candidateThreadId = normalizeText(item?.assigned_thread_id || item?.thread_id);
    const candidateWorkitemId = normalizeText(item?.assigned_workitem_id || item?.workitem_id);
    if (!operatorId && candidateOperatorId) {
      operatorId = candidateOperatorId;
    }
    if (!channelId && candidateChannelId) {
      channelId = candidateChannelId;
    }
    if (!threadId && candidateThreadId) {
      threadId = candidateThreadId;
    }
    if (!workitemId && candidateWorkitemId) {
      workitemId = candidateWorkitemId;
    }
    if (operatorId && channelId && threadId && workitemId) {
      break;
    }
  }

  return {
    topicId: normalizeText(topicId),
    operatorId: operatorId || operatorAgentId,
    channelId: channelId || "",
    threadId: threadId || "",
    workitemId: workitemId || "",
  };
}

function buildRuntimeRecoveryActionsPath(scope) {
  const query = new URLSearchParams();
  query.set("limit", "50");
  const channelId = normalizeText(scope?.channelId);
  const operatorId = normalizeText(scope?.operatorId);
  if (channelId) {
    query.set("channel_id", channelId);
  }
  if (operatorId) {
    query.set("operator_id", operatorId);
  }
  return `/v1/runtime/recovery-actions?${query.toString()}`;
}

function buildChannelIdCandidates({ scopeChannelId, configuredChannelId, configuredChannelCandidates, topicRepoBindingProjection }) {
  const candidates = [];
  const fromScope = normalizeText(scopeChannelId);
  if (fromScope) {
    candidates.push(fromScope);
  }
  const fromConfigured = normalizeText(configuredChannelId);
  if (fromConfigured) {
    candidates.push(fromConfigured);
  }
  const fromTopicRepoBinding =
    normalizeText(topicRepoBindingProjection?.channel_id) ||
    normalizeText(topicRepoBindingProjection?.channelId) ||
    "";
  if (fromTopicRepoBinding) {
    candidates.push(fromTopicRepoBinding);
  }
  if (Array.isArray(configuredChannelCandidates)) {
    for (const candidate of configuredChannelCandidates) {
      const normalized = normalizeText(candidate);
      if (normalized) {
        candidates.push(normalized);
      }
    }
  }
  return Array.from(new Set(candidates));
}

async function resolveChannelContextFromCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { channelId: "", contextRead: { status: "skipped", payload: null, path: null } };
  }
  for (const candidate of candidates) {
    const channelId = normalizeText(candidate);
    if (!channelId) {
      continue;
    }
    const contextRead = await fetchOptionalUpstreamJson(`/v1/channels/${encodeURIComponent(channelId)}/context`);
    if (contextRead.status === "ok") {
      return { channelId, contextRead };
    }
  }
  return { channelId: "", contextRead: { status: "skipped", payload: null, path: null } };
}

async function resolveChannelMemoryViewerRead({ channelId, encodedChannelId, channelExternalMemoryProviderRead }) {
  const normalizedChannelId = normalizeText(channelId);
  if (!normalizedChannelId) {
    return { status: "skipped", payload: null, path: null };
  }
  if (channelExternalMemoryProviderRead?.status !== "ok") {
    return { status: "skipped", payload: null, path: null };
  }
  const providerContract =
    channelExternalMemoryProviderRead.payload?.external_memory_provider &&
    typeof channelExternalMemoryProviderRead.payload.external_memory_provider === "object"
      ? channelExternalMemoryProviderRead.payload.external_memory_provider
      : {};
  const provider =
    providerContract.external_memory_provider &&
    typeof providerContract.external_memory_provider === "object"
      ? providerContract.external_memory_provider
      : providerContract;
  const providerStatus = normalizeText(provider?.status);
  if (providerStatus && providerStatus !== "active") {
    return { status: "skipped", payload: null, path: null };
  }
  return fetchOptionalUpstreamJson(`/v1/channels/${encodedChannelId}/memory-viewer?limit=100`);
}

async function fetchOptionalUpstreamJson(pathWithQuery) {
  if (!normalizeText(pathWithQuery)) {
    return { status: "skipped", payload: null, path: null };
  }
  try {
    const payload = await fetchUpstreamJson(pathWithQuery);
    return { status: "ok", payload, path: pathWithQuery };
  } catch (error) {
    if (error instanceof UpstreamHttpError && error.statusCode === 404) {
      return { status: "missing", payload: error.payload || null, path: pathWithQuery };
    }
    throw error;
  }
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

function normalizeOperatorActionType(action) {
  const normalized = normalizeText(action);
  if (normalized === "request_report" || normalized === "follow_up" || normalized === "intervention" || normalized === "recovery") {
    return normalized;
  }
  return null;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function normalizeOperator(value) {
  const normalized = normalizeText(value);
  return normalized || configuredOperatorId || operatorAgentId;
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
  topicNotifications,
  runtimeConfig,
  runtimeSmoke,
  repoBindingProjection,
  channelContextContract,
  channelNotificationEndpointContract,
  channelExternalMemoryProviderContract,
  channelMemoryViewerProjection,
  channelRepoBindingConfig,
  channelAuditTrail,
  channelWorkAssignments,
  channelOperatorActions,
  channelRecentActions,
  runtimeRecoveryActions,
  workspaceGovernance,
  runtimeRegistry,
  runtimeAgents,
  runtimeWorktreeClaims,
  scope,
  channelSurface,
  actorRegistry,
  controlEvents,
}) {
  const now = Date.now();
  const normalizedTopicState = normalizeTopicState(topicState, status);
  const normalizedStatus = normalizeStatus(status, normalizedTopicState);
  const normalizedMergeLifecycle = normalizeMergeLifecycle(mergeLifecycle, normalizedStatus);
  const normalizedTaskAllocation = normalizeTaskAllocation(taskAllocation);
  const normalizedApprovals = normalizeApprovalHolds(approvalHolds);
  const normalizedMessages = normalizeMessages(messages);
  const normalizedRunHistory = normalizeRunHistory(runHistory);
  const normalizedTopicNotifications = normalizeTopicNotifications(topicNotifications);
  const actors = normalizeTopicActors(topic);
  const normalizedActorRegistry = normalizeActorRegistry(actorRegistry);
  const normalizedControlEvents = normalizeControlEvents(controlEvents);
  const normalizedRuntimeAgents = normalizeRuntimeAgents(runtimeAgents, runtimeRegistry);
  const normalizedRuntimeWorktreeClaims = normalizeRuntimeWorktreeClaims(runtimeWorktreeClaims);
  const normalizedRuntimeRecoveryActions = normalizeRuntimeRecoveryActions(runtimeRecoveryActions);
  const normalizedChannelAuditTrail = normalizeChannelAuditTrail(channelAuditTrail);
  const normalizedChannelWorkAssignments = normalizeChannelWorkAssignments(channelWorkAssignments);
  const normalizedChannelOperatorActions = normalizeChannelOperatorActions(channelOperatorActions);
  const normalizedChannelRecentActions = normalizeChannelRecentActions(channelRecentActions);
  const normalizedOperatorConsole = buildOperatorConsoleState({
    topicId,
    runtimeConfig,
    runtimeSmoke,
    topicRepoBindingProjection: repoBindingProjection,
    channelContextContract,
    channelNotificationEndpointContract,
    channelExternalMemoryProviderContract,
    channelMemoryViewerProjection,
    channelRepoBindingConfig,
    channelAuditTrail: normalizedChannelAuditTrail,
    channelWorkAssignments: normalizedChannelWorkAssignments,
    channelOperatorActions: normalizedChannelOperatorActions,
    channelRecentActions: normalizedChannelRecentActions,
    runtimeRecoveryActions: normalizedRuntimeRecoveryActions,
    workspaceGovernance,
    approvalHolds: normalizedApprovals,
    topicNotifications: normalizedTopicNotifications,
    runtimeRegistry,
    runtimeAgents: normalizedRuntimeAgents,
    runtimeWorktreeClaims: normalizedRuntimeWorktreeClaims,
    scope,
    channelSurface,
    actorRegistry: normalizedActorRegistry,
    controlEvents: normalizedControlEvents,
  });
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
    runs: normalizedRunHistory,
    operator_console: normalizedOperatorConsole,
    operatorConsole: normalizedOperatorConsole,
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

function normalizeTopicNotifications(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    notification_id: normalizeText(item?.notification_id || item?.notificationId) || null,
    kind: normalizeText(item?.kind) || "unknown",
    severity: normalizeText(item?.severity) || "info",
    summary: normalizeText(item?.summary) || null,
    at: item?.at || null,
  }));
}

function normalizeActorRegistry(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    actor_id: normalizeText(item?.actor_id || item?.actorId),
    role: normalizeText(item?.role) || "unknown",
    status: normalizeText(item?.status) || "unknown",
    lane_id: normalizeText(item?.lane_id || item?.laneId) || null,
    last_seen_at: item?.last_seen_at || item?.lastSeenAt || null,
  }));
}

function normalizeControlEvents(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    event_id: normalizeText(item?.event_id || item?.eventId),
    event_type: normalizeText(item?.event_type || item?.eventType) || "unknown",
    related_resource_type: normalizeText(item?.related_resource_type || item?.relatedResourceType) || null,
    related_resource_id: normalizeText(item?.related_resource_id || item?.relatedResourceId) || null,
    result_state: normalizeText(item?.result_state || item?.resultState) || null,
    reason_code: normalizeText(item?.reason_code || item?.reasonCode) || null,
    at: item?.at || item?.createdAt || new Date().toISOString(),
  }));
}

function buildOperatorConsoleState({
  topicId,
  runtimeConfig,
  runtimeSmoke,
  topicRepoBindingProjection,
  channelContextContract,
  channelNotificationEndpointContract,
  channelExternalMemoryProviderContract,
  channelMemoryViewerProjection,
  channelRepoBindingConfig,
  channelAuditTrail,
  channelWorkAssignments,
  channelOperatorActions,
  channelRecentActions,
  runtimeRecoveryActions,
  workspaceGovernance,
  runtimeRegistry,
  runtimeAgents,
  runtimeWorktreeClaims,
  scope,
  channelSurface,
  actorRegistry,
  controlEvents,
  approvalHolds,
  topicNotifications,
}) {
  const channelId = normalizeText(scope?.channelId) || null;
  const operatorId = normalizeText(scope?.operatorId) || operatorAgentId;
  const runtimeName = normalizeText(runtimeConfig?.runtimeName) || "openshock-runtime";
  const daemonName = normalizeText(runtimeConfig?.daemonName) || "openshock-daemon";
  const shellUrl = normalizeText(runtimeConfig?.shellUrl) || null;
  const serverPort = Number.isFinite(Number(runtimeConfig?.serverPort)) ? Number(runtimeConfig.serverPort) : null;
  const sampleTopicId = normalizeText(runtimeConfig?.sampleFixture?.topicId) || topicId;
  const sampleTopicReady = Boolean(runtimeSmoke?.sampleTopicReady);
  const sampleTopicAgentCount = Number(runtimeSmoke?.sampleTopicAgentCount || runtimeAgents.length || actorRegistry.length || 0);

  const contextWriteAnchors =
    channelContextContract?.write_anchors && typeof channelContextContract.write_anchors === "object"
      ? channelContextContract.write_anchors
      : {};
  const notificationWriteAnchors =
    channelNotificationEndpointContract?.write_anchors &&
    typeof channelNotificationEndpointContract.write_anchors === "object"
      ? channelNotificationEndpointContract.write_anchors
      : {};
  const mergedWriteAnchors = {
    ...contextWriteAnchors,
    ...notificationWriteAnchors,
  };
  const contextAuditAnchor =
    channelContextContract?.audit_anchor && typeof channelContextContract.audit_anchor === "object"
      ? channelContextContract.audit_anchor
      : null;
  const notificationAuditAnchor =
    channelNotificationEndpointContract?.audit_anchor &&
    typeof channelNotificationEndpointContract.audit_anchor === "object"
      ? channelNotificationEndpointContract.audit_anchor
      : null;
  const channelContract =
    (channelContextContract && typeof channelContextContract === "object") ||
    (channelNotificationEndpointContract && typeof channelNotificationEndpointContract === "object")
      ? {
          channel_id:
            normalizeText(channelContextContract?.channel_id) ||
            normalizeText(channelNotificationEndpointContract?.channel_id) ||
            channelId,
          owner_operator_id:
            normalizeText(channelContextContract?.owner_operator_id) ||
            normalizeText(channelNotificationEndpointContract?.owner_operator_id) ||
            operatorId,
          project_aligned_entry: Boolean(channelContextContract?.project_aligned_entry),
          workspace: channelContextContract?.workspace || null,
          context: channelContextContract?.context || null,
          governance: channelContextContract?.governance || null,
          notification_endpoint:
            channelContextContract?.notification_endpoint ||
            channelNotificationEndpointContract?.notification_endpoint ||
            null,
          notification_routing_rules:
            channelContextContract?.notification_routing_rules ||
            channelNotificationEndpointContract?.routing_rules ||
            null,
          approval_contract:
            channelContextContract?.approval_contract ||
            channelNotificationEndpointContract?.approval_contract ||
            null,
          write_anchors: mergedWriteAnchors,
          audit_anchor: contextAuditAnchor || notificationAuditAnchor,
          updated_at: channelContextContract?.updated_at || channelNotificationEndpointContract?.updated_at || null,
        }
      : null;

  const normalizedRepoBinding = normalizeOperatorRepoBinding({
    topicId,
    channelId,
    operatorId,
    channelRepoBindingConfig,
    topicRepoBindingProjection,
  });
  const normalizedWorkspaceGovernance = normalizeWorkspaceGovernance({
    workspaceGovernance,
    workspaceId: resolveWorkspaceIdFromChannelContext(channelContextContract),
    operatorId,
    repoBinding: normalizedRepoBinding,
  });
  normalizedWorkspaceGovernance.stage4a2 = buildStage4a2GovernanceProjection({
    channelContextContract: channelContract,
    channelAuditTrail,
    approvalHolds,
    topicNotifications,
    channelOperatorActions,
  });
  normalizedWorkspaceGovernance.stage4a2_governance = normalizedWorkspaceGovernance.stage4a2;
  normalizedWorkspaceGovernance.stage4b = buildStage4bGovernanceProjection({
    channelContextContract: channelContract,
    channelExternalMemoryProviderContract,
    channelMemoryViewerProjection,
    channelRecentActions,
    channelSurface,
  });
  normalizedWorkspaceGovernance.stage4b_governance = normalizedWorkspaceGovernance.stage4b;

  const auditEntries = buildAuditEntries({
    channelAuditTrail,
    controlEvents,
  });
  const contractWriteAnchors =
    channelContract?.write_anchors && typeof channelContract.write_anchors === "object"
      ? channelContract.write_anchors
      : {};

  return {
    scope: "single_human_multi_agent",
    layer: "channel -> workspace(root) -> repo/worktree -> agent",
    channel: {
      channel_id: channelId,
      status: channelSurface || null,
      context_contract: channelContract,
      project_aligned_entry: true,
    },
    workspace: {
      workspace_id: `single_operator_${topicId}`,
      operator_id: operatorId,
      default_topic_id: topicId,
      mode: "single_human_multi_agent",
      root_path: normalizeText(channelContract?.workspace?.root_path) || null,
    },
    runtime: {
      runtime_name: runtimeName,
      daemon_name: daemonName,
      shell_url: shellUrl,
      server_port: serverPort,
      sample_topic_id: sampleTopicId,
      pairing_status: sampleTopicReady ? "paired" : "pending_pairing",
      summary: runtimeRegistry?.summary || null,
    },
    machine: {
      machine_id: `${runtimeName}@single-machine`,
      status: sampleTopicReady ? "online" : "booting",
      sample_topic_ready: sampleTopicReady,
      sample_topic_agent_count: sampleTopicAgentCount,
    },
    repo_binding: normalizedRepoBinding,
    workspace_governance: normalizedWorkspaceGovernance,
    workspaceGovernance: normalizedWorkspaceGovernance,
    agents: actorRegistry,
    runtime_agents: runtimeAgents,
    work_assignments: channelWorkAssignments,
    worktree_claims: runtimeWorktreeClaims,
    recovery_actions: runtimeRecoveryActions,
    operator_actions: channelOperatorActions,
    recent_actions: channelRecentActions,
    audit_entries: auditEntries,
    write_anchors: {
      context_upsert: "/api/v0a/operator/channel-context",
      repo_binding_upsert: "/api/v0a/operator/repo-binding",
      governance_member_upsert: "/api/v0a/workspace-governance/member-upsert",
      governance_identity_upsert: "/api/v0a/workspace-governance/github-identity-upsert",
      governance_installation_upsert: "/api/v0a/workspace-governance/github-installation-upsert",
      notification_endpoint_upsert:
        normalizeText(contractWriteAnchors.notification_endpoint_upsert) ||
        normalizeText(contractWriteAnchors.context_upsert) ||
        null,
      sandbox_profile_upsert:
        normalizeText(contractWriteAnchors.sandbox_profile_upsert) ||
        normalizeText(contractWriteAnchors.context_upsert) ||
        null,
      secrets_binding_upsert:
        normalizeText(contractWriteAnchors.secrets_binding_upsert) ||
        normalizeText(contractWriteAnchors.context_upsert) ||
        null,
      approval_anchor: normalizeText(contractWriteAnchors.approval_decision) || null,
      agent_upsert: "/api/v0a/operator/agents/:actorId/upsert",
      assignment_enforce: "/api/v0a/operator/agents/:actorId/assignment",
      recovery_action: "/api/v0a/operator/agents/:actorId/recovery-actions",
      operator_action: "/api/v0a/operator/actions",
      contract: contractWriteAnchors,
    },
  };
}

function buildStage4a2GovernanceProjection({
  channelContextContract,
  channelAuditTrail,
  approvalHolds,
  topicNotifications,
  channelOperatorActions,
}) {
  const context = channelContextContract?.context && typeof channelContextContract.context === "object"
    ? channelContextContract.context
    : {};
  const governance = channelContextContract?.governance && typeof channelContextContract.governance === "object"
    ? channelContextContract.governance
    : {};
  const writeAnchors = channelContextContract?.write_anchors && typeof channelContextContract.write_anchors === "object"
    ? channelContextContract.write_anchors
    : {};
  const notificationEndpoints = normalizeStage4a2NotificationEndpoints(
    pickFirstDefinedValue([
      channelContextContract?.notification_endpoint,
      governance.notification_endpoints,
      governance.notificationEndpoints,
      governance.notification_endpoint,
      governance.notificationEndpoint,
      context.notification_endpoints,
      context.notificationEndpoints,
      context.notification_endpoint,
      context.notificationEndpoint,
    ]),
  );
  const routingRules = normalizeStage4a2RoutingRules(
    pickFirstDefinedValue([
      channelContextContract?.notification_routing_rules,
      governance.notification_routing,
      governance.notificationRouting,
      governance.notification_rules,
      governance.notificationRules,
      context.notification_routing,
      context.notificationRouting,
      context.notification_rules,
      context.notificationRules,
    ]),
  );
  const sandboxProfile = normalizeStage4a2SandboxProfile(
    pickFirstDefinedValue([
      governance.sandbox_profile,
      governance.sandboxProfile,
      context.sandbox_profile,
      context.sandboxProfile,
    ]),
  );
  const secretsBindings = normalizeStage4a2SecretsBindings(
    pickFirstDefinedValue([
      governance.secrets_bindings,
      governance.secretsBindings,
      governance.secrets_binding,
      governance.secretsBinding,
      context.secrets_bindings,
      context.secretsBindings,
      context.secrets_binding,
      context.secretsBinding,
    ]),
  );
  const usageNotes = buildStage4a2UsageNotes({
    context,
    sandboxProfile,
    secretsBindings,
  });
  const approvalContract = normalizeStage4a2ApprovalContract(
    pickFirstDefinedValue([
      channelContextContract?.approval_contract,
      governance.approval_contract,
      governance.approvalContract,
      context.approval_contract,
      context.approvalContract,
    ]),
  );
  const pendingApprovals = Array.isArray(approvalHolds)
    ? approvalHolds.filter((item) => normalizeText(item?.status) === "pending")
    : [];
  const latestEnforcement = findLatestStage4a2Enforcement(channelOperatorActions);
  const approvalStatus = pendingApprovals.length > 0 ? "approval_required" : "ready";
  const auditSummary = buildStage4a2AuditSummary({
    auditAnchor: channelContextContract?.audit_anchor,
    channelAuditTrail,
  });

  return {
    status: {
      notification_endpoints_status: notificationEndpoints.length > 0 ? "ok" : "pending",
      routing_rules_status: routingRules.length > 0 ? "ok" : "pending",
      approval_status: approvalStatus,
      sandbox_profile_status: sandboxProfile ? "ok" : "pending",
      secrets_bindings_status: secretsBindings.length > 0 ? "ok" : "pending",
      usage_notes_status: usageNotes.length > 0 ? "ok" : "pending",
    },
    notification: {
      endpoints: notificationEndpoints,
      routing_rules: routingRules,
      default_rule_matrix: STAGE4A2_NOTIFICATION_RULE_REFERENCE,
      recent_signal_summary: summarizeStage4a2NotificationSignals(topicNotifications),
      audit_anchor: auditSummary.notification,
      write_anchor:
        normalizeText(writeAnchors.notification_endpoint_upsert) ||
        normalizeText(writeAnchors.context_upsert) ||
        null,
    },
    approval: {
      status: approvalStatus,
      pending_count: pendingApprovals.length,
      pending_hold_ids: pendingApprovals
        .map((item) => normalizeText(item?.holdId || item?.hold_id))
        .filter((item) => item.length > 0),
      contract: approvalContract,
      audit_anchor: auditSummary.approval,
      write_anchor: normalizeText(writeAnchors.approval_decision) || null,
    },
    restricted_execution: {
      sandbox_profile: sandboxProfile,
      secrets_bindings: secretsBindings,
      usage_notes: usageNotes,
      latest_enforcement: latestEnforcement,
      cloud_sandbox: "not_in_scope",
      audit_anchor: auditSummary.restricted_execution,
      write_anchors: {
        sandbox_profile_upsert:
          normalizeText(writeAnchors.sandbox_profile_upsert) ||
          normalizeText(writeAnchors.context_upsert) ||
          null,
        secrets_binding_upsert:
          normalizeText(writeAnchors.secrets_binding_upsert) ||
          normalizeText(writeAnchors.context_upsert) ||
          null,
      },
    },
  };
}

function buildStage4bGovernanceProjection({
  channelContextContract,
  channelExternalMemoryProviderContract,
  channelMemoryViewerProjection,
  channelRecentActions,
  channelSurface,
}) {
  const context = channelContextContract?.context && typeof channelContextContract.context === "object"
    ? channelContextContract.context
    : {};
  const governance = channelContextContract?.governance && typeof channelContextContract.governance === "object"
    ? channelContextContract.governance
    : {};
  const writeAnchors = channelContextContract?.write_anchors && typeof channelContextContract.write_anchors === "object"
    ? channelContextContract.write_anchors
    : {};
  const auditAnchor = channelContextContract?.audit_anchor && typeof channelContextContract.audit_anchor === "object"
    ? channelContextContract.audit_anchor
    : {};
  const providerContract = normalizeStage4bExternalMemoryProviderContract(channelExternalMemoryProviderContract);
  const provider = normalizeStage4bExternalMemoryProvider(
    pickFirstDefinedValue([
      providerContract.external_memory_provider,
      channelMemoryViewerProjection?.external_memory_provider,
      channelContextContract?.external_memory_provider,
      context.external_memory_provider,
    ]),
  );
  const memoryViewer = normalizeStage4bMemoryViewer(channelMemoryViewerProjection);
  const skillPolicyPlugin = normalizeStage4bSkillPolicyPlugin(
    pickFirstDefinedValue([
      governance.skill_policy_plugin,
      governance.skillPolicyPlugin,
      context.skill_policy_plugin,
      context.skillPolicyPlugin,
    ]),
  );
  const tokenQuotaContext = normalizeStage4bTokenQuotaContext(
    pickFirstDefinedValue([
      governance.token_quota_context,
      governance.tokenQuotaContext,
      context.token_quota_context,
      context.tokenQuotaContext,
    ]),
  );
  const providerReadStatus = normalizeText(channelSurface?.external_memory_provider_status) || "skipped";
  const memoryViewerReadStatus = normalizeText(channelSurface?.memory_viewer_status) || "skipped";
  const providerStatus = normalizeText(provider?.status);
  const externalMemoryProviderStatus =
    providerReadStatus === "ok"
      ? provider
        ? providerStatus === "active"
          ? "ok"
          : providerStatus || "pending"
        : "pending"
      : providerReadStatus;
  const resolvedMemoryViewerStatus =
    memoryViewerReadStatus === "ok"
      ? "ok"
      : memoryViewerReadStatus === "skipped" && providerStatus && providerStatus !== "active"
        ? "provider_not_active"
        : memoryViewerReadStatus;
  const skillPolicyPluginStatus = skillPolicyPlugin ? "ok" : "pending";
  const tokenQuotaContextStatus = tokenQuotaContext ? "ok" : "pending";
  const providerAuditAnchor =
    normalizeStage4a2AuditAnchor(providerContract.audit_anchor?.latest?.external_memory_provider) ||
    normalizeStage4a2AuditAnchor(auditAnchor.latest?.external_memory_provider) ||
    null;
  const memoryWriteAuditAnchor =
    normalizeStage4a2AuditAnchor(memoryViewer.audit_anchor?.latest?.memory_write) ||
    normalizeStage4a2AuditAnchor(providerContract.audit_anchor?.latest?.memory_write) ||
    normalizeStage4a2AuditAnchor(auditAnchor.latest?.memory_write) ||
    null;
  const memoryFeedbackAuditAnchor =
    normalizeStage4a2AuditAnchor(memoryViewer.audit_anchor?.latest?.memory_feedback) ||
    normalizeStage4a2AuditAnchor(providerContract.audit_anchor?.latest?.memory_feedback) ||
    normalizeStage4a2AuditAnchor(auditAnchor.latest?.memory_feedback) ||
    null;
  const memoryPromoteAuditAnchor =
    normalizeStage4a2AuditAnchor(memoryViewer.audit_anchor?.latest?.memory_promote) ||
    normalizeStage4a2AuditAnchor(providerContract.audit_anchor?.latest?.memory_promote) ||
    normalizeStage4a2AuditAnchor(auditAnchor.latest?.memory_promote) ||
    null;
  const memoryForgetAuditAnchor =
    normalizeStage4a2AuditAnchor(memoryViewer.audit_anchor?.latest?.memory_forget) ||
    normalizeStage4a2AuditAnchor(providerContract.audit_anchor?.latest?.memory_forget) ||
    normalizeStage4a2AuditAnchor(auditAnchor.latest?.memory_forget) ||
    null;
  const skillPolicyPluginAuditAnchor = normalizeStage4a2AuditAnchor(auditAnchor.latest?.skill_policy_plugin);
  const tokenQuotaContextAuditAnchor = normalizeStage4a2AuditAnchor(auditAnchor.latest?.token_quota_context);
  const stage4bTimeline = summarizeStage4bTimeline(channelRecentActions);
  const auditReady = Boolean(
    providerAuditAnchor ||
      memoryWriteAuditAnchor ||
      memoryFeedbackAuditAnchor ||
      memoryPromoteAuditAnchor ||
      memoryForgetAuditAnchor ||
      skillPolicyPluginAuditAnchor ||
      tokenQuotaContextAuditAnchor,
  );
  const providerWriteAnchors =
    providerContract.write_anchors && typeof providerContract.write_anchors === "object"
      ? providerContract.write_anchors
      : {};
  const memoryViewerWriteAnchors =
    memoryViewer.write_anchors && typeof memoryViewer.write_anchors === "object"
      ? memoryViewer.write_anchors
      : {};
  const normalizedWriteAnchors = {
    external_memory_provider_upsert:
      normalizeText(writeAnchors.external_memory_provider_upsert) ||
      normalizeText(providerWriteAnchors.provider_upsert) ||
      null,
    memory_viewer: normalizeText(writeAnchors.memory_viewer) || null,
    memory_search: normalizeText(writeAnchors.memory_search) || normalizeText(providerWriteAnchors.memory_search) || null,
    memory_get: normalizeText(writeAnchors.memory_get) || normalizeText(providerWriteAnchors.memory_get) || null,
    memory_write:
      normalizeText(writeAnchors.memory_write) ||
      normalizeText(memoryViewerWriteAnchors.memory_write) ||
      normalizeText(providerWriteAnchors.memory_write) ||
      null,
    memory_feedback:
      normalizeText(writeAnchors.memory_feedback) ||
      normalizeText(memoryViewerWriteAnchors.memory_feedback) ||
      normalizeText(providerWriteAnchors.memory_feedback) ||
      null,
    memory_promote:
      normalizeText(writeAnchors.memory_promote) ||
      normalizeText(memoryViewerWriteAnchors.memory_promote) ||
      normalizeText(providerWriteAnchors.memory_promote) ||
      null,
    memory_forget:
      normalizeText(writeAnchors.memory_forget) ||
      normalizeText(memoryViewerWriteAnchors.memory_forget) ||
      normalizeText(providerWriteAnchors.memory_forget) ||
      null,
    skill_policy_plugin_upsert: normalizeText(writeAnchors.skill_policy_plugin_upsert) || null,
    token_quota_context_upsert: normalizeText(writeAnchors.token_quota_context_upsert) || null,
    timeline_anchor: normalizeText(writeAnchors.recent_actions) || null,
  };
  const timelineReady = stage4bTimeline.total > 0 || Boolean(normalizedWriteAnchors.timeline_anchor);

  return {
    status: {
      external_memory_provider_status: externalMemoryProviderStatus,
      memory_viewer_status: resolvedMemoryViewerStatus,
      skill_policy_plugin_status: skillPolicyPluginStatus,
      token_quota_context_status: tokenQuotaContextStatus,
      audit_status: auditReady ? "ok" : "pending",
      timeline_status: timelineReady ? "ok" : "pending",
    },
    external_memory_provider: {
      provider,
      write_anchors: {
        provider_upsert: normalizedWriteAnchors.external_memory_provider_upsert,
        memory_search: normalizedWriteAnchors.memory_search,
        memory_get: normalizedWriteAnchors.memory_get,
        memory_write: normalizedWriteAnchors.memory_write,
        memory_feedback: normalizedWriteAnchors.memory_feedback,
        memory_promote: normalizedWriteAnchors.memory_promote,
        memory_forget: normalizedWriteAnchors.memory_forget,
      },
      audit_anchor: {
        external_memory_provider: providerAuditAnchor,
        memory_write: memoryWriteAuditAnchor,
        memory_feedback: memoryFeedbackAuditAnchor,
        memory_promote: memoryPromoteAuditAnchor,
        memory_forget: memoryForgetAuditAnchor,
      },
    },
    memory_viewer: {
      summary: memoryViewer.summary,
      items: memoryViewer.items,
      write_anchors: {
        memory_viewer: normalizedWriteAnchors.memory_viewer,
        memory_write: normalizedWriteAnchors.memory_write,
        memory_feedback: normalizedWriteAnchors.memory_feedback,
        memory_promote: normalizedWriteAnchors.memory_promote,
        memory_forget: normalizedWriteAnchors.memory_forget,
      },
      audit_anchor: {
        memory_write: memoryWriteAuditAnchor,
        memory_feedback: memoryFeedbackAuditAnchor,
        memory_promote: memoryPromoteAuditAnchor,
        memory_forget: memoryForgetAuditAnchor,
      },
    },
    skill_policy_plugin: {
      value: skillPolicyPlugin,
      write_anchor: normalizedWriteAnchors.skill_policy_plugin_upsert,
      audit_anchor: skillPolicyPluginAuditAnchor,
    },
    token_quota_context: {
      value: tokenQuotaContext,
      write_anchor: normalizedWriteAnchors.token_quota_context_upsert,
      audit_anchor: tokenQuotaContextAuditAnchor,
    },
    timeline: {
      anchor: normalizedWriteAnchors.timeline_anchor,
      recent_actions: stage4bTimeline.actions,
      total: stage4bTimeline.total,
    },
  };
}

function normalizeStage4bExternalMemoryProviderContract(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const contract =
    raw.external_memory_provider && typeof raw.external_memory_provider === "object" ? raw.external_memory_provider : raw;
  return {
    external_memory_provider: contract.external_memory_provider || null,
    write_anchors: contract.write_anchors || {},
    audit_anchor: contract.audit_anchor || {},
  };
}

function normalizeStage4bExternalMemoryProvider(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    provider_id: normalizeText(raw.provider_id) || null,
    provider_type: normalizeText(raw.provider_type) || null,
    status: normalizeText(raw.status) || "disabled",
    read_scopes: normalizeStringArray(raw.read_scopes),
    write_scopes: normalizeStringArray(raw.write_scopes),
    recall_policy: raw.recall_policy && typeof raw.recall_policy === "object" ? raw.recall_policy : null,
    retention_policy: raw.retention_policy && typeof raw.retention_policy === "object" ? raw.retention_policy : null,
    sharing_policy: raw.sharing_policy && typeof raw.sharing_policy === "object" ? raw.sharing_policy : null,
    capabilities: raw.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {},
  };
}

function normalizeStage4bMemoryViewer(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      summary: {
        total_entries: 0,
        active_entries: 0,
        forgotten_entries: 0,
      },
      items: [],
      write_anchors: {},
      audit_anchor: {},
    };
  }
  return {
    summary: {
      total_entries: Number(raw.summary?.total_entries || 0),
      active_entries: Number(raw.summary?.active_entries || 0),
      forgotten_entries: Number(raw.summary?.forgotten_entries || 0),
    },
    items: Array.isArray(raw.items)
      ? raw.items.map((item) => ({
          memory_id: normalizeText(item?.memory_id) || null,
          provider_memory_id: normalizeText(item?.provider_memory_id) || null,
          scope: normalizeText(item?.scope) || null,
          content: normalizeText(item?.content) || null,
          source_action: normalizeText(item?.source_action) || null,
          source_ref: normalizeText(item?.source_ref) || null,
          status: normalizeText(item?.status) || "active",
          feedback:
            item?.feedback && typeof item.feedback === "object"
              ? {
                  verdict: normalizeText(item.feedback.verdict) || null,
                  note: normalizeText(item.feedback.note) || null,
                }
              : null,
          promoted_at: item?.promoted_at || null,
          forgotten_at: item?.forgotten_at || null,
          created_at: item?.created_at || null,
          updated_at: item?.updated_at || null,
        }))
      : [],
    write_anchors: raw.write_anchors && typeof raw.write_anchors === "object" ? raw.write_anchors : {},
    audit_anchor: raw.audit_anchor && typeof raw.audit_anchor === "object" ? raw.audit_anchor : {},
  };
}

function normalizeStage4bSkillPolicyPlugin(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const registry = raw.registry && typeof raw.registry === "object" ? raw.registry : {};
  return {
    enabled: raw.enabled !== false,
    scope: normalizeText(raw.scope) || null,
    registry: {
      skill_refs: normalizeStringArray(registry.skill_refs),
      policy_refs: normalizeStringArray(registry.policy_refs),
      plugin_refs: normalizeStringArray(registry.plugin_refs),
    },
    bindings: Array.isArray(raw.bindings)
      ? raw.bindings.map((item) => ({
          binding_id: normalizeText(item?.binding_id) || null,
          plugin_ref: normalizeText(item?.plugin_ref) || null,
          skill_ref: normalizeText(item?.skill_ref) || null,
          policy_ref: normalizeText(item?.policy_ref) || null,
          enabled: item?.enabled !== false,
          scope: normalizeText(item?.scope) || null,
        }))
      : [],
    updated_at: raw.updated_at || null,
    updated_by: normalizeText(raw.updated_by) || null,
  };
}

function normalizeStage4bTokenQuotaContext(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    token_used: Number(raw.token_used || 0),
    token_limit: raw.token_limit === null || raw.token_limit === undefined ? null : Number(raw.token_limit),
    quota_state: normalizeText(raw.quota_state) || "healthy",
    context_tokens: Number(raw.context_tokens || 0),
    context_window_tokens:
      raw.context_window_tokens === null || raw.context_window_tokens === undefined
        ? null
        : Number(raw.context_window_tokens),
    recall_source: normalizeText(raw.recall_source) || null,
    recall_hits: Number(raw.recall_hits || 0),
    degrade_reason: normalizeText(raw.degrade_reason) || null,
    updated_at: raw.updated_at || null,
    updated_by: normalizeText(raw.updated_by) || null,
  };
}

function summarizeStage4bTimeline(items) {
  if (!Array.isArray(items)) {
    return { total: 0, actions: [] };
  }
  const actions = [];
  for (const item of items) {
    const action = normalizeText(item?.action);
    if (!action) {
      continue;
    }
    if (
      !action.includes("memory") &&
      !action.includes("skill_policy_plugin") &&
      !action.includes("token_quota_context")
    ) {
      continue;
    }
    actions.push({
      action,
      at: item?.at || null,
    });
    if (actions.length >= 10) {
      break;
    }
  }
  return {
    total: actions.length,
    actions,
  };
}

function pickFirstDefinedValue(values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function normalizeStage4a2NotificationEndpoints(raw) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizeStage4a2NotificationEndpoint(item);
      if (normalized) {
        list.push(normalized);
      }
    }
    return list;
  }
  if (!raw || typeof raw !== "object") {
    return [];
  }
  if (Array.isArray(raw.items)) {
    return normalizeStage4a2NotificationEndpoints(raw.items);
  }
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      const normalized = normalizeStage4a2NotificationEndpoint(value, key);
      if (normalized) {
        list.push(normalized);
      }
      continue;
    }
    if (typeof value === "boolean") {
      const channel = normalizeStage4a2ChannelName(key);
      if (!channel) {
        continue;
      }
      list.push({
        channel,
        enabled: value,
        target: null,
        status: value ? "enabled" : "disabled",
      });
    }
  }
  return list;
}

function normalizeStage4a2NotificationEndpoint(raw, fallbackChannel = "") {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const channel = normalizeStage4a2ChannelName(
    raw.channel || raw.endpoint || raw.type || raw.kind || fallbackChannel,
  );
  if (!channel) {
    return null;
  }
  const status = normalizeText(raw.status);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : status !== "disabled";
  return {
    channel,
    enabled,
    target:
      normalizeText(
        raw.target ||
          raw.address ||
          raw.endpoint_ref ||
          raw.endpointRef ||
          raw.endpoint_id ||
          raw.endpointId ||
          raw.uri ||
          raw.url,
      ) || null,
    status: status || (enabled ? "enabled" : "disabled"),
  };
}

function normalizeStage4a2RoutingRules(raw) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const channel = normalizeStage4a2ChannelName(item?.channel || item?.endpoint || item?.kind);
      if (!channel) {
        continue;
      }
      list.push({
        channel,
        enabled: item?.enabled !== false,
        events: normalizeStringArray(item?.events || item?.triggers || item?.kinds),
        delivery: normalizeText(item?.delivery) || null,
      });
    }
    return list;
  }
  if (!raw || typeof raw !== "object") {
    return [];
  }
  if (Array.isArray(raw.items)) {
    return normalizeStage4a2RoutingRules(raw.items);
  }
  for (const [key, value] of Object.entries(raw)) {
    const channel = normalizeStage4a2ChannelName(key);
    if (!channel) {
      continue;
    }
    if (Array.isArray(value)) {
      list.push({
        channel,
        enabled: true,
        events: normalizeStringArray(value),
        delivery: null,
      });
      continue;
    }
    if (value && typeof value === "object") {
      list.push({
        channel,
        enabled: value.enabled !== false,
        events: normalizeStringArray(value.events || value.triggers || value.kinds),
        delivery: normalizeText(value.delivery) || null,
      });
      continue;
    }
  }
  return list;
}

function normalizeStage4a2ApprovalContract(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const anchors = raw.anchors && typeof raw.anchors === "object" ? raw.anchors : {};
  return {
    source: normalizeText(raw.source) || null,
    trigger_events: normalizeStringArray(raw.trigger_events || raw.triggerEvents),
    anchors: {
      inbox: normalizeText(anchors.inbox) || null,
      approval_holds: normalizeText(anchors.approval_holds || anchors.approvalHolds) || null,
      approval_decisions: normalizeText(anchors.approval_decisions || anchors.approvalDecisions) || null,
      run_timeline: normalizeText(anchors.run_timeline || anchors.runTimeline) || null,
      channel_audit_trail: normalizeText(anchors.channel_audit_trail || anchors.channelAuditTrail) || null,
    },
  };
}

function normalizeStage4a2SandboxProfile(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const profileId =
    normalizeText(raw.profile_id || raw.profileId || raw.profile || raw.id || raw.name) || null;
  const mode = normalizeText(raw.mode || raw.scope) || null;
  const commandAllow = normalizeStringArray(raw.allowed_commands || raw.command_allowlist || raw.commandAllowlist);
  const networkAllow = normalizeStringArray(raw.allowed_network || raw.network_allowlist || raw.networkAllowlist);
  const toolAllow = normalizeStringArray(raw.allowed_tools || raw.tool_allowlist || raw.toolAllowlist);
  const secretClasses = normalizeStringArray(raw.allowed_secret_classes || raw.secret_classes || raw.secretClasses);
  const approvalTriggers = normalizeStringArray(raw.approval_triggers || raw.approval_required_actions);
  if (
    !profileId &&
    !mode &&
    commandAllow.length === 0 &&
    networkAllow.length === 0 &&
    toolAllow.length === 0 &&
    secretClasses.length === 0 &&
    approvalTriggers.length === 0
  ) {
    return null;
  }
  return {
    profile_id: profileId,
    mode: mode || "restricted_local",
    allowed_commands: commandAllow,
    allowed_network: networkAllow,
    allowed_tools: toolAllow,
    allowed_secret_classes: secretClasses,
    approval_triggers: approvalTriggers,
  };
}

function normalizeStage4a2SecretsBindings(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => normalizeStage4a2SecretsBindingItem(item))
      .filter((item) => item !== null);
  }
  if (!raw || typeof raw !== "object") {
    return [];
  }
  if (Array.isArray(raw.items)) {
    return normalizeStage4a2SecretsBindings(raw.items);
  }
  if (Array.isArray(raw.allowed_secret_refs)) {
    const approvalRequired = raw.approval_required === true;
    const injectionMode = normalizeText(raw.injection_mode) || null;
    return raw.allowed_secret_refs
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => ({
        secret_class: item.trim(),
        status: approvalRequired ? "approval_required" : "bound",
        source: injectionMode,
        approval_required: approvalRequired,
        injection_mode: injectionMode,
      }));
  }
  const classes = normalizeStringArray(raw.secret_classes || raw.classes);
  if (classes.length > 0) {
    return classes.map((secretClass) => ({
      secret_class: secretClass,
      status: "bound",
      source: normalizeText(raw.source || raw.binding_source) || null,
    }));
  }
  return [];
}

function normalizeStage4a2SecretsBindingItem(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const secretClass =
    normalizeText(raw.secret_class || raw.secretClass || raw.class || raw.key) || null;
  if (!secretClass) {
    return null;
  }
  return {
    secret_class: secretClass,
    status: normalizeText(raw.status) || "bound",
    source: normalizeText(raw.source || raw.binding_source) || null,
    approval_required: raw.approval_required === true,
    injection_mode: normalizeText(raw.injection_mode) || null,
  };
}

function buildStage4a2UsageNotes({ context, sandboxProfile, secretsBindings }) {
  const notes = [];
  const ruleEntries = normalizeStringArray(context?.rule_entries || context?.ruleEntries);
  const runtimeEntries = normalizeStringArray(context?.runtime_entries || context?.runtimeEntries);
  for (const entry of ruleEntries) {
    notes.push(`rule:${entry}`);
  }
  for (const entry of runtimeEntries) {
    notes.push(`runtime:${entry}`);
  }
  if (sandboxProfile?.profile_id) {
    notes.push(`sandbox_profile:${sandboxProfile.profile_id}`);
  }
  if (secretsBindings.length > 0) {
    notes.push(
      `secrets:${secretsBindings.map((item) => item.secret_class).join(",")}`,
    );
  }
  return Array.from(new Set(notes));
}

function summarizeStage4a2NotificationSignals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      total: 0,
      blocked: 0,
      approval_required: 0,
      mention: 0,
      pr_pending_review: 0,
    };
  }
  const summary = {
    total: items.length,
    blocked: 0,
    approval_required: 0,
    mention: 0,
    pr_pending_review: 0,
  };
  for (const item of items) {
    const kind = normalizeText(item?.kind);
    if (!kind) {
      continue;
    }
    if (kind.includes("blocked")) {
      summary.blocked += 1;
    }
    if (kind.includes("approval")) {
      summary.approval_required += 1;
    }
    if (kind.includes("mention")) {
      summary.mention += 1;
    }
    if (kind.includes("pr") && kind.includes("review")) {
      summary.pr_pending_review += 1;
    }
  }
  return summary;
}

function findLatestStage4a2Enforcement(items) {
  if (!Array.isArray(items)) {
    return null;
  }
  for (const item of items) {
    const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
    const enforcementCandidate =
      (item?.enforcement && typeof item.enforcement === "object" ? item.enforcement : null) ||
      (payload?.enforcement && typeof payload.enforcement === "object" ? payload.enforcement : null);
    const enforcement = enforcementCandidate;
    if (!enforcement) {
      continue;
    }
    return {
      sandbox_profile: normalizeText(enforcement.sandbox_profile) || null,
      secrets_injection: enforcement.secrets_injection === true,
      secret_ref_count: Number(enforcement.secret_ref_count || 0),
      approval_required: enforcement.approval_required === true,
      approval_id: normalizeText(enforcement.approval_id) || null,
      injection_mode: normalizeText(enforcement.injection_mode) || null,
    };
  }
  return null;
}

function buildStage4a2AuditSummary({ auditAnchor, channelAuditTrail }) {
  const latest = auditAnchor?.latest && typeof auditAnchor.latest === "object" ? auditAnchor.latest : {};
  const notification =
    normalizeStage4a2AuditAnchor(latest.notification_endpoint) ||
    normalizeStage4a2AuditAnchor(latest.notification_routing) ||
    normalizeStage4a2AuditEntry(findLatestChannelAuditByKeyword(channelAuditTrail, ["notification"]));
  const approval =
    normalizeStage4a2AuditAnchor(latest.approval) ||
    normalizeStage4a2AuditAnchor(latest.approval_chain) ||
    normalizeStage4a2AuditEntry(findLatestChannelAuditByKeyword(channelAuditTrail, ["approval"]));
  const restrictedExecution =
    normalizeStage4a2AuditAnchor(latest.sandbox_profile) ||
    normalizeStage4a2AuditAnchor(latest.secrets_binding) ||
    normalizeStage4a2AuditEntry(findLatestChannelAuditByKeyword(channelAuditTrail, ["sandbox", "secret"]));
  return {
    notification,
    approval,
    restricted_execution: restrictedExecution,
  };
}

function findLatestChannelAuditByKeyword(items, keywords) {
  if (!Array.isArray(items)) {
    return null;
  }
  for (const item of items) {
    const action = normalizeText(item?.action);
    if (!action) {
      continue;
    }
    if (keywords.some((keyword) => action.includes(keyword))) {
      return item;
    }
  }
  return null;
}

function normalizeStage4a2AuditAnchor(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const auditId = normalizeText(raw.audit_id || raw.auditId);
  const action = normalizeText(raw.action);
  const at = raw.at || null;
  if (!auditId && !action && !at) {
    return null;
  }
  return {
    audit_id: auditId || null,
    action: action || null,
    at,
  };
}

function normalizeStage4a2AuditEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const auditId = normalizeText(raw.audit_id || raw.auditId);
  const action = normalizeText(raw.action);
  const at = raw.at || null;
  if (!auditId && !action && !at) {
    return null;
  }
  return {
    audit_id: auditId || null,
    action: action || null,
    at,
  };
}

function normalizeStage4a2ChannelName(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  return normalized.replaceAll("-", "_").replaceAll(" ", "_");
}

function normalizeRuntimeAgents(items, runtimeRegistry) {
  const merged = [];
  if (Array.isArray(runtimeRegistry?.agents)) {
    merged.push(...runtimeRegistry.agents);
  }
  if (Array.isArray(items)) {
    merged.push(...items);
  }
  const byId = new Map();
  for (const item of merged) {
    const agentId = normalizeText(item?.agent_id || item?.agentId);
    if (!agentId) {
      continue;
    }
    const previous = byId.get(agentId) || {};
    byId.set(agentId, {
      ...previous,
      agent_id: agentId,
      machine_id: normalizeText(item?.machine_id || previous.machine_id) || null,
      runtime_id: normalizeText(item?.runtime_id || previous.runtime_id) || null,
      owner_operator_id: normalizeText(item?.owner_operator_id || previous.owner_operator_id) || null,
      assigned_channel_id: normalizeText(item?.assigned_channel_id || previous.assigned_channel_id) || null,
      assigned_thread_id: normalizeText(item?.assigned_thread_id || previous.assigned_thread_id) || null,
      assigned_workitem_id: normalizeText(item?.assigned_workitem_id || previous.assigned_workitem_id) || null,
      status: normalizeText(item?.status || previous.status) || "unknown",
      pairing_state: normalizeText(item?.pairing_state || previous.pairing_state) || "unknown",
      liveness: normalizeText(item?.liveness || previous.liveness) || "unknown",
      updated_at: item?.updated_at || previous.updated_at || null,
      last_seen_at: item?.last_seen_at || previous.last_seen_at || null,
    });
  }
  return Array.from(byId.values()).sort((left, right) => left.agent_id.localeCompare(right.agent_id));
}

function normalizeRuntimeWorktreeClaims(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    claim_key: normalizeText(item?.claim_key) || "unknown_claim",
    agent_id: normalizeText(item?.agent_id) || null,
    owner_operator_id: normalizeText(item?.owner_operator_id) || null,
    assigned_channel_id: normalizeText(item?.assigned_channel_id) || null,
    assigned_thread_id: normalizeText(item?.assigned_thread_id) || null,
    assigned_workitem_id: normalizeText(item?.assigned_workitem_id) || null,
    repo_ref: normalizeText(item?.repo_ref) || null,
    branch: normalizeText(item?.branch) || null,
    lane_id: normalizeText(item?.lane_id) || null,
    claim_status: normalizeText(item?.claim_status) || "unknown",
    reclaimed_from_agent_id: normalizeText(item?.reclaimed_from_agent_id) || null,
    updated_at: item?.updated_at || item?.claimed_at || null,
  }));
}

function normalizeRuntimeRecoveryActions(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    action_id: normalizeText(item?.action_id) || "unknown_action",
    action: normalizeText(item?.action) || "unknown",
    status: normalizeText(item?.status) || "applied",
    operator_id: normalizeText(item?.operator_id) || null,
    agent_id: normalizeText(item?.agent_id) || null,
    channel_id: normalizeText(item?.channel_id) || null,
    thread_id: normalizeText(item?.thread_id) || null,
    workitem_id: normalizeText(item?.workitem_id) || null,
    reason: normalizeText(item?.reason) || null,
    at: item?.at || null,
    result: item?.result || null,
  }));
}

function normalizeChannelAuditTrail(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    audit_id: normalizeText(item?.audit_id) || "unknown_audit",
    channel_id: normalizeText(item?.channel_id) || null,
    actor_id: normalizeText(item?.actor_id) || null,
    action: normalizeText(item?.action) || "unknown_action",
    target: normalizeText(item?.target) || "channel",
    at: item?.at || null,
    policy_snapshot: item?.policy_snapshot || {},
    details: item?.details || {},
  }));
}

function normalizeChannelWorkAssignments(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    channel_id: normalizeText(item?.channel_id) || null,
    owner_operator_id: normalizeText(item?.owner_operator_id) || null,
    agent_id: normalizeText(item?.agent_id) || "unknown_agent",
    assigned_channel_id: normalizeText(item?.assigned_channel_id) || null,
    assigned_thread_id: normalizeText(item?.assigned_thread_id) || null,
    assigned_workitem_id: normalizeText(item?.assigned_workitem_id) || null,
    default_duty: normalizeText(item?.default_duty) || null,
    assignment_note: normalizeText(item?.assignment_note) || null,
    runtime_agent_status: normalizeText(item?.runtime_agent_status) || "unknown",
    pairing_state: normalizeText(item?.pairing_state) || "unknown",
    machine_id: normalizeText(item?.machine_id) || null,
    runtime_id: normalizeText(item?.runtime_id) || null,
    status: normalizeText(item?.status) || "unknown",
    last_action_at: item?.last_action_at || null,
    assigned_at: item?.assigned_at || null,
    updated_at: item?.updated_at || null,
  }));
}

function normalizeChannelOperatorActions(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    action_id: normalizeText(item?.action_id) || "unknown_action",
    channel_id: normalizeText(item?.channel_id) || null,
    owner_operator_id: normalizeText(item?.owner_operator_id) || null,
    operator_id: normalizeText(item?.operator_id) || null,
    action_type: normalizeText(item?.action_type) || "unknown",
    status: normalizeText(item?.status) || "accepted",
    agent_id: normalizeText(item?.agent_id) || null,
    thread_id: normalizeText(item?.thread_id) || null,
    workitem_id: normalizeText(item?.workitem_id) || null,
    note: normalizeText(item?.note) || null,
    payload: item?.payload && typeof item.payload === "object" ? item.payload : {},
    enforcement: item?.enforcement && typeof item.enforcement === "object" ? item.enforcement : null,
    target: normalizeText(item?.target) || null,
    at: item?.at || null,
    policy_snapshot: item?.policy_snapshot || {},
  }));
}

function normalizeChannelRecentActions(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    recent_action_id: normalizeText(item?.recent_action_id) || "unknown_recent_action",
    channel_id: normalizeText(item?.channel_id) || null,
    owner_operator_id: normalizeText(item?.owner_operator_id) || null,
    action: normalizeText(item?.action) || "unknown_action",
    action_family: normalizeText(item?.action_family) || "unknown",
    actor_id: normalizeText(item?.actor_id) || null,
    target: normalizeText(item?.target) || null,
    at: item?.at || null,
    operator_scope: {
      agent_id: normalizeText(item?.operator_scope?.agent_id) || null,
      thread_id: normalizeText(item?.operator_scope?.thread_id) || null,
      workitem_id: normalizeText(item?.operator_scope?.workitem_id) || null,
    },
    policy_snapshot: item?.policy_snapshot || {},
    details: item?.details || {},
  }));
}

function normalizeOperatorRepoBinding({ topicId, channelId, operatorId, channelRepoBindingConfig, topicRepoBindingProjection }) {
  if (channelRepoBindingConfig && typeof channelRepoBindingConfig === "object") {
    const inner = channelRepoBindingConfig.repo_binding || {};
    return {
      source: "channel",
      channel_id: normalizeText(channelRepoBindingConfig.channel_id) || channelId || null,
      owner_operator_id: normalizeText(channelRepoBindingConfig.owner_operator_id) || operatorId || null,
      topic_id: normalizeText(inner.topic_id) || topicId,
      provider: normalizeText(inner?.provider_ref?.provider) || "unknown",
      repo_ref: normalizeText(inner?.provider_ref?.repo_ref) || null,
      default_branch: normalizeText(inner.default_branch) || null,
      fixed_directory: normalizeText(inner.fixed_directory) || null,
      updated_at: inner.updated_at || channelRepoBindingConfig.updated_at || null,
      updated_by: normalizeText(inner.updated_by) || null,
    };
  }
  if (topicRepoBindingProjection && typeof topicRepoBindingProjection === "object") {
    return {
      source: "topic_projection",
      channel_id: channelId || null,
      owner_operator_id: operatorId || null,
      topic_id: normalizeText(topicRepoBindingProjection.topic_id) || topicId,
      provider: normalizeText(topicRepoBindingProjection?.provider_ref?.provider) || "unknown",
      repo_ref: normalizeText(topicRepoBindingProjection?.provider_ref?.repo_ref) || null,
      default_branch: normalizeText(topicRepoBindingProjection.default_branch) || null,
      fixed_directory: normalizeText(topicRepoBindingProjection.fixed_directory) || null,
      updated_at: topicRepoBindingProjection.updated_at || topicRepoBindingProjection.linked_at || null,
      updated_by: normalizeText(topicRepoBindingProjection.bound_by) || null,
    };
  }
  return null;
}

function resolveWorkspaceIdFromChannelContext(channelContextContract) {
  if (!channelContextContract || typeof channelContextContract !== "object") {
    return "";
  }
  const workspace = channelContextContract.workspace;
  if (workspace && typeof workspace === "object") {
    const fromWorkspace =
      normalizeText(workspace.workspace_id) ||
      normalizeText(workspace.workspaceId) ||
      normalizeText(workspace.id);
    if (fromWorkspace) {
      return fromWorkspace;
    }
  }
  return normalizeText(channelContextContract.workspace_id) || normalizeText(channelContextContract.workspaceId) || "";
}

function buildWorkspaceGovernanceProjectionFromChannelTruth({ workspaceId, channelContextRead, channelRepoBindingRead }) {
  const context = channelContextRead?.payload?.context;
  const governance = context?.governance && typeof context.governance === "object" ? context.governance : {};
  const member = governance.member && typeof governance.member === "object" ? governance.member : null;
  const authIdentity = governance.auth_identity && typeof governance.auth_identity === "object" ? governance.auth_identity : null;
  const githubInstallation =
    governance.github_installation && typeof governance.github_installation === "object" ? governance.github_installation : null;
  const repoBinding = channelRepoBindingRead?.payload?.repo_binding;
  const contextStatus = normalizeText(channelContextRead?.status) || "missing";
  const repoBindingStatus = normalizeText(channelRepoBindingRead?.status) || "missing";
  const contextOk = contextStatus === "ok";
  const repoBindingOk = repoBindingStatus === "ok";
  return {
    workspace_id: normalizeText(workspaceId) || null,
    members_status: contextOk ? (member ? "ok" : "pending") : contextStatus,
    members_source: normalizeText(channelContextRead?.path) || null,
    members_payload: { members: member ? [member] : [] },
    identities_status: contextOk ? (authIdentity ? "ok" : "pending") : contextStatus,
    identities_source: normalizeText(channelContextRead?.path) || null,
    identities_payload: { auth_identities: authIdentity ? [authIdentity] : [] },
    installations_status: contextOk ? (githubInstallation ? "ok" : "pending") : contextStatus,
    installations_source: normalizeText(channelContextRead?.path) || null,
    installations_payload: { github_installations: githubInstallation ? [githubInstallation] : [] },
    repo_bindings_status: repoBindingOk ? (repoBinding ? "ok" : "pending") : repoBindingStatus,
    repo_bindings_source: normalizeText(channelRepoBindingRead?.path) || null,
    repo_bindings_payload: { repo_bindings: repoBinding ? [repoBinding] : [] },
  };
}

function normalizeWorkspaceGovernance({ workspaceGovernance, workspaceId, operatorId, repoBinding }) {
  const normalizedWorkspaceId = normalizeText(workspaceGovernance?.workspace_id) || normalizeText(workspaceId) || null;
  const members = normalizeWorkspaceMembers(workspaceGovernance?.members_payload);
  const authIdentities = normalizeWorkspaceAuthIdentities(workspaceGovernance?.identities_payload);
  const githubInstallations = normalizeWorkspaceGithubInstallations(workspaceGovernance?.installations_payload);
  const repoBindings = normalizeWorkspaceRepoBindings(workspaceGovernance?.repo_bindings_payload);
  const repoBindingReady = Boolean(
    (Array.isArray(repoBindings) && repoBindings.length > 0) || normalizeText(repoBinding?.repo_ref),
  );
  const installed = githubInstallations.some((installation) => {
    const status = normalizeText(installation.status);
    return status !== "removed" && status !== "revoked";
  });
  return {
    workspace_id: normalizedWorkspaceId,
    owner_operator_id: normalizeText(operatorId) || null,
    status: {
      members_status: normalizeText(workspaceGovernance?.members_status) || "missing",
      identities_status: normalizeText(workspaceGovernance?.identities_status) || "missing",
      installations_status: normalizeText(workspaceGovernance?.installations_status) || "missing",
      repo_bindings_status: normalizeText(workspaceGovernance?.repo_bindings_status) || "missing",
    },
    source: {
      members: normalizeText(workspaceGovernance?.members_source) || null,
      identities: normalizeText(workspaceGovernance?.identities_source) || null,
      installations: normalizeText(workspaceGovernance?.installations_source) || null,
      repo_bindings: normalizeText(workspaceGovernance?.repo_bindings_source) || null,
    },
    chain: {
      identity_link_status: authIdentities.length > 0 ? "ready" : "pending",
      installation_status: installed ? "ready" : "pending",
      repo_binding_status: repoBindingReady ? "ready" : "pending",
    },
    members,
    auth_identities: authIdentities,
    github_installations: githubInstallations,
    repo_bindings: repoBindings,
  };
}

function normalizeWorkspaceMembers(payload) {
  const items = extractResourceItems(payload, ["members", "member"]);
  return items.map((item) => ({
    member_id:
      normalizeText(item?.member_id) ||
      normalizeText(item?.memberId) ||
      normalizeText(item?.actor_id) ||
      normalizeText(item?.user_id) ||
      normalizeText(item?.id) ||
      "unknown_member",
    role: normalizeText(item?.role) || "member",
    status: normalizeText(item?.status) || "active",
    invited_by: normalizeText(item?.invited_by) || normalizeText(item?.invitedBy) || null,
    invited_at: item?.invited_at || item?.invitedAt || null,
    joined_at: item?.joined_at || item?.joinedAt || null,
    updated_at: item?.updated_at || item?.updatedAt || null,
  }));
}

function normalizeWorkspaceAuthIdentities(payload) {
  const items = extractResourceItems(payload, ["auth_identities", "auth_identity", "identities"]);
  return items.map((item) => ({
    identity_id:
      normalizeText(item?.identity_id) ||
      normalizeText(item?.identityId) ||
      normalizeText(item?.provider_identity_id) ||
      normalizeText(item?.id) ||
      "unknown_identity",
    member_id: normalizeText(item?.member_id) || normalizeText(item?.memberId) || null,
    provider: normalizeText(item?.provider) || "github",
    github_login:
      normalizeText(item?.github_login) ||
      normalizeText(item?.githubLogin) ||
      normalizeText(item?.provider_login) ||
      normalizeText(item?.login) ||
      null,
    provider_user_id:
      normalizeText(item?.provider_user_id) ||
      normalizeText(item?.providerUserId) ||
      normalizeText(item?.github_user_id) ||
      normalizeText(item?.subject_ref) ||
      null,
    status: normalizeText(item?.status) || "linked",
    linked_at: item?.linked_at || item?.linkedAt || null,
    updated_at: item?.updated_at || item?.updatedAt || null,
  }));
}

function normalizeWorkspaceGithubInstallations(payload) {
  const items = extractResourceItems(payload, ["github_installations", "github_installation", "installations"]);
  return items.map((item) => ({
    installation_id:
      normalizeText(item?.installation_id) ||
      normalizeText(item?.installationId) ||
      normalizeText(item?.id) ||
      "unknown_installation",
    workspace_id: normalizeText(item?.workspace_id) || normalizeText(item?.workspaceId) || null,
    github_account_login:
      normalizeText(item?.github_account_login) ||
      normalizeText(item?.githubAccountLogin) ||
      normalizeText(item?.account_login) ||
      normalizeText(item?.account?.login) ||
      null,
    status: normalizeText(item?.status) || "installed",
    permission_scope: normalizeText(item?.permission_scope) || normalizeText(item?.permissionScope) || null,
    authorized_repos: normalizeStringArray(item?.authorized_repos),
    installed_at: item?.installed_at || item?.installedAt || null,
    updated_at: item?.updated_at || item?.updatedAt || null,
  }));
}

function normalizeWorkspaceRepoBindings(payload) {
  const items = extractResourceItems(payload, ["repo_bindings", "repo_binding"]);
  return items.map((item) => {
    const inner = item?.repo_binding && typeof item.repo_binding === "object" ? item.repo_binding : item;
    return {
      binding_id: normalizeText(inner?.binding_id) || normalizeText(inner?.bindingId) || normalizeText(inner?.id) || null,
      provider: normalizeText(inner?.provider_ref?.provider) || normalizeText(inner?.provider) || "unknown",
      repo_ref: normalizeText(inner?.provider_ref?.repo_ref) || normalizeText(inner?.repo_ref) || null,
      default_branch: normalizeText(inner?.default_branch) || normalizeText(inner?.defaultBranch) || null,
      workspace_installation_id:
        normalizeText(inner?.workspace_installation_id) || normalizeText(inner?.workspaceInstallationId) || null,
      authorization_scope: normalizeText(inner?.authorization_scope) || normalizeText(inner?.authorizationScope) || null,
      status: normalizeText(inner?.status) || normalizeText(item?.status) || "active",
      updated_at: inner?.updated_at || inner?.updatedAt || item?.updated_at || item?.updatedAt || null,
    };
  });
}

function extractResourceItems(payload, preferredKeys) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  return [];
}

function buildAuditEntries({ channelAuditTrail, controlEvents }) {
  if (Array.isArray(channelAuditTrail) && channelAuditTrail.length > 0) {
    return channelAuditTrail.slice(0, 50).map((item) => ({
      audit_id: item.audit_id || null,
      event_id: item.audit_id || null,
      source: "channel_audit_trail",
      actor_id: item.actor_id || null,
      action: item.action || "unknown_action",
      target: item.target || "channel",
      result_state: "accepted",
      reason_code: null,
      policy_snapshot: item.policy_snapshot || {},
      details: item.details || {},
      at: item.at,
    }));
  }
  return controlEvents.slice(0, 20).map((item) => ({
    audit_id: item.event_id || null,
    event_id: item.event_id || null,
    source: "control_event_projection",
    actor_id: null,
    action: item.event_type,
    target:
      item.related_resource_type && item.related_resource_id
        ? `${item.related_resource_type}:${item.related_resource_id}`
        : item.related_resource_type || "topic",
    result_state: item.result_state || "accepted",
    reason_code: item.reason_code || null,
    policy_snapshot: {},
    details: {},
    at: item.at,
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
