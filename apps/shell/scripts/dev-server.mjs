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
      channelAuditTrailRead,
      channelWorkAssignmentsRead,
      channelOperatorActionsRead,
      channelRecentActionsRead,
      recoveryActionsRead,
    ] = await Promise.all([
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/repo-binding` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/audit-trail?limit=50` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/work-assignments?limit=100` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/operator-actions?limit=100` : ""),
      fetchOptionalUpstreamJson(channelId ? `/v1/channels/${encodedChannelId}/recent-actions?limit=100` : ""),
      fetchOptionalUpstreamJson(buildRuntimeRecoveryActionsPath(effectiveScope)),
    ]);
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
      runtimeConfig: runtimeConfigRead ?? null,
      runtimeSmoke: runtimeSmokeRead ?? null,
      repoBindingProjection: repoBindingRead?.repo_binding ?? null,
      channelContextContract: channelContextRead.payload?.context ?? null,
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
        repo_binding_status: channelRepoBindingRead.status,
        audit_trail_status: channelAuditTrailRead.status,
        work_assignments_status: channelWorkAssignmentsRead.status,
        operator_actions_status: channelOperatorActionsRead.status,
        recent_actions_status: channelRecentActionsRead.status,
        recovery_actions_status: recoveryActionsRead.status,
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
  runtimeConfig,
  runtimeSmoke,
  repoBindingProjection,
  channelContextContract,
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
    channelRepoBindingConfig,
    channelAuditTrail: normalizedChannelAuditTrail,
    channelWorkAssignments: normalizedChannelWorkAssignments,
    channelOperatorActions: normalizedChannelOperatorActions,
    channelRecentActions: normalizedChannelRecentActions,
    runtimeRecoveryActions: normalizedRuntimeRecoveryActions,
    workspaceGovernance,
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
  const channelId = normalizeText(scope?.channelId) || null;
  const operatorId = normalizeText(scope?.operatorId) || operatorAgentId;
  const runtimeName = normalizeText(runtimeConfig?.runtimeName) || "openshock-runtime";
  const daemonName = normalizeText(runtimeConfig?.daemonName) || "openshock-daemon";
  const shellUrl = normalizeText(runtimeConfig?.shellUrl) || null;
  const serverPort = Number.isFinite(Number(runtimeConfig?.serverPort)) ? Number(runtimeConfig.serverPort) : null;
  const sampleTopicId = normalizeText(runtimeConfig?.sampleFixture?.topicId) || topicId;
  const sampleTopicReady = Boolean(runtimeSmoke?.sampleTopicReady);
  const sampleTopicAgentCount = Number(runtimeSmoke?.sampleTopicAgentCount || runtimeAgents.length || actorRegistry.length || 0);

  const channelContract =
    channelContextContract && typeof channelContextContract === "object"
      ? {
          channel_id: normalizeText(channelContextContract.channel_id) || channelId,
          owner_operator_id: normalizeText(channelContextContract.owner_operator_id) || operatorId,
          project_aligned_entry: Boolean(channelContextContract.project_aligned_entry),
          workspace: channelContextContract.workspace || null,
          context: channelContextContract.context || null,
          updated_at: channelContextContract.updated_at || null,
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

  const auditEntries = buildAuditEntries({
    channelAuditTrail,
    controlEvents,
  });

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
      agent_upsert: "/api/v0a/operator/agents/:actorId/upsert",
      assignment_enforce: "/api/v0a/operator/agents/:actorId/assignment",
      recovery_action: "/api/v0a/operator/agents/:actorId/recovery-actions",
      operator_action: "/api/v0a/operator/actions",
    },
  };
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
