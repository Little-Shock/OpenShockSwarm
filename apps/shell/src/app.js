const runtimeConfig = resolveRuntimeConfig();

const ENDPOINTS = {
  state: toApiUrl(runtimeConfig.apiBaseUrl, "/api/v0a/shell-state"),
  approvalDecision: (approvalId) =>
    toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/approvals/${encodeURIComponent(approvalId)}/decision`),
  interventionAction: (interventionId) =>
    toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/interventions/${encodeURIComponent(interventionId)}/action`),
  interventionPointAction: (pointId) =>
    toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/intervention-points/${encodeURIComponent(pointId)}/action`),
  runFollowUp: (runId) => toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/runs/${encodeURIComponent(runId)}/follow-up`),
  operatorChannelContextUpsert: toApiUrl(runtimeConfig.apiBaseUrl, "/api/v0a/operator/channel-context"),
  operatorRepoBindingUpsert: toApiUrl(runtimeConfig.apiBaseUrl, "/api/v0a/operator/repo-binding"),
  workspaceGovernanceMemberUpsert: toApiUrl(runtimeConfig.apiBaseUrl, "/api/v0a/workspace-governance/member-upsert"),
  workspaceGovernanceIdentityUpsert: toApiUrl(
    runtimeConfig.apiBaseUrl,
    "/api/v0a/workspace-governance/github-identity-upsert",
  ),
  workspaceGovernanceInstallationUpsert: toApiUrl(
    runtimeConfig.apiBaseUrl,
    "/api/v0a/workspace-governance/github-installation-upsert",
  ),
  operatorAgentUpsert: (actorId) =>
    toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/operator/agents/${encodeURIComponent(actorId)}/upsert`),
  operatorAgentAssignment: (actorId) =>
    toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/operator/agents/${encodeURIComponent(actorId)}/assignment`),
  operatorAgentRecoveryAction: (actorId) =>
    toApiUrl(runtimeConfig.apiBaseUrl, `/api/v0a/operator/agents/${encodeURIComponent(actorId)}/recovery-actions`),
  operatorAction: toApiUrl(runtimeConfig.apiBaseUrl, "/api/v0a/operator/actions"),
};

const POLL_MS = 5000;

const dom = {
  refreshButton: document.getElementById("refresh-button"),
  lastUpdated: document.getElementById("last-updated"),
  metricCards: document.getElementById("metric-cards"),
  roomList: document.getElementById("room-list"),
  topicBody: document.getElementById("topic-table-body"),
  runList: document.getElementById("run-list"),
  inboxList: document.getElementById("inbox-list"),
  approvalList: document.getElementById("approval-list"),
  interventionList: document.getElementById("intervention-list"),
  interventionPointsList: document.getElementById("intervention-points-list"),
  eventFeed: document.getElementById("event-feed"),
  workspaceSummaryList: document.getElementById("workspace-summary-list"),
  workspaceGovernanceList: document.getElementById("workspace-governance-list"),
  repoBindingList: document.getElementById("repo-binding-list"),
  runtimeMachineList: document.getElementById("runtime-machine-list"),
  agentRegistryList: document.getElementById("agent-registry-list"),
  assignmentRecoveryList: document.getElementById("assignment-recovery-list"),
  operatorActionList: document.getElementById("operator-action-list"),
  recentActionList: document.getElementById("recent-action-list"),
  auditEntryList: document.getElementById("audit-entry-list"),
  actionTemplate: document.getElementById("queue-action-template"),
};

let loading = false;
let latestPayload = null;
let selectedTopicId = null;

dom.refreshButton.addEventListener("click", () => {
  void loadAndRender();
});

void loadAndRender();
window.setInterval(() => void loadAndRender(), POLL_MS);

async function loadAndRender() {
  if (loading) {
    return;
  }
  loading = true;
  dom.refreshButton.disabled = true;
  try {
    const payload = await requestJson(ENDPOINTS.state, { method: "GET" });
    render(payload);
  } catch (error) {
    renderError(error);
  } finally {
    loading = false;
    dom.refreshButton.disabled = false;
  }
}

function render(payload) {
  latestPayload = payload;
  const topics = Array.isArray(payload.topics) ? payload.topics : [];
  ensureSelectedTopic(topics);

  dom.lastUpdated.textContent = `Last updated: ${new Date(payload.generatedAt).toLocaleString()}`;
  renderMetrics(payload.observability?.metrics || []);
  renderRooms(topics);
  renderTopicWorkspace(topics);
  renderRuns(payload.runs || []);
  renderInbox(payload);
  renderApprovalQueue(payload.approvals || []);
  renderInterventionQueue(payload.interventions || []);
  renderCloseoutPoints(payload.interventionPoints || []);
  renderOperatorConsole(payload.operator_console || payload.operatorConsole || null, payload);
  renderEvents(payload.observability?.events || []);
}

function renderError(error) {
  dom.lastUpdated.textContent = `Last updated: failed (${String(error)}) [api=${runtimeConfig.apiBaseUrl}]`;
}

function ensureSelectedTopic(topics) {
  if (!Array.isArray(topics) || topics.length === 0) {
    selectedTopicId = null;
    return;
  }
  if (selectedTopicId && topics.some((topic) => topic.id === selectedTopicId)) {
    return;
  }
  selectedTopicId = topics[0].id;
}

function renderMetrics(metrics) {
  dom.metricCards.replaceChildren();
  for (const metric of metrics) {
    const card = document.createElement("article");
    card.className = "metric-card";

    const label = document.createElement("span");
    label.className = "metric-label";
    label.textContent = metric.label;

    const value = document.createElement("div");
    value.className = "metric-value";
    value.textContent = metric.value;

    const trend = document.createElement("div");
    trend.className =
      metric.trend === "up" ? "metric-trend-up" : metric.trend === "down" ? "metric-trend-down" : "";
    trend.textContent = metric.delta;

    card.append(label, value, trend);
    dom.metricCards.append(card);
  }
}

function renderRooms(topics) {
  dom.roomList.replaceChildren();
  if (!Array.isArray(topics) || topics.length === 0) {
    dom.roomList.textContent = "No room available.";
    return;
  }

  for (const topic of topics) {
    const card = queueCard({
      title: `Room ${topic.id}`,
      subtitle: `${topic.title} · lead ${topic.leadAgent}`,
      note: `status=${topic.status} · delivery=${topic.deliveryState} · pending=${topic.pendingApprovals}`,
      status: topic.id === selectedTopicId ? "active" : topic.status,
    });
    card.classList.add("room-card");
    card.addEventListener("click", () => {
      selectedTopicId = topic.id;
      if (latestPayload) {
        render(latestPayload);
      }
    });
    dom.roomList.append(card);
  }
}

function renderTopicWorkspace(topics) {
  dom.topicBody.replaceChildren();
  const topic = Array.isArray(topics) ? topics.find((item) => item.id === selectedTopicId) : null;
  if (!topic) {
    return;
  }

  const row = document.createElement("tr");
  row.append(
    cell(`Room ${topic.id}`),
    cell(`${topic.id} · ${topic.title}`),
    cell(String(topic.revision)),
    statusCell(topic.status),
    cell(topic.leadAgent),
    cell(String(topic.pendingApprovals)),
    cell(topic.deliveryState),
    cell(topic.riskLevel),
  );
  dom.topicBody.append(row);
}

function renderRuns(runs) {
  dom.runList.replaceChildren();
  const normalizedRuns = Array.isArray(runs) ? runs : [];
  if (normalizedRuns.length === 0) {
    dom.runList.textContent = "No runs in workspace.";
    return;
  }

  for (const run of normalizedRuns) {
    const runId = normalizeText(run.runId) || "unknown_run";
    const card = queueCard({
      title: `Run ${runId}`,
      subtitle: `${run.state || "unknown"} · ${formatTime(run.updatedAt)}`,
      note: run.summary || "run summary unavailable",
      status: run.state || "pending",
    });

    const actions = document.createElement("div");
    actions.className = "queue-actions";
    actions.append(
      queueAction("Request follow-up", async () => {
        await requestJson(ENDPOINTS.runFollowUp(runId), {
          method: "POST",
          body: {
            operator: "shell-operator",
            note: `follow-up requested from room ${selectedTopicId || "n/a"}`,
          },
        });
        await loadAndRender();
      }),
    );

    card.append(actions);
    dom.runList.append(card);
  }
}

function renderInbox(payload) {
  dom.inboxList.replaceChildren();

  const approvals = (payload.approvals || []).filter((item) => item.status === "pending");
  const interventions = (payload.interventions || []).filter((item) => item.status === "pending");
  const closeoutPoints = (payload.interventionPoints || []).filter(
    (item) => item.id === "merge_closeout" && (item.status === "pending" || item.status === "hold" || item.status === "blocked"),
  );

  if (approvals.length === 0 && interventions.length === 0 && closeoutPoints.length === 0) {
    dom.inboxList.textContent = "Inbox is clear.";
    return;
  }

  for (const approval of approvals) {
    dom.inboxList.append(
      queueCard({
        title: `Approval · ${approval.id}`,
        subtitle: `${approval.topicId} · ${approval.gateType}`,
        note: approval.note,
        status: approval.status,
      }),
    );
  }

  for (const intervention of interventions) {
    dom.inboxList.append(
      queueCard({
        title: `Intervention · ${intervention.id}`,
        subtitle: `${intervention.type} · run ${intervention.runId}`,
        note: intervention.note,
        status: intervention.status,
      }),
    );
  }

  for (const point of closeoutPoints) {
    dom.inboxList.append(
      queueCard({
        title: `Closeout gate · ${point.name}`,
        subtitle: `${point.topicId} · owner ${point.owner}`,
        note: point.note,
        status: point.status,
      }),
    );
  }
}

function renderApprovalQueue(approvals) {
  dom.approvalList.replaceChildren();
  const pending = approvals.filter((item) => item.status === "pending");
  if (pending.length === 0) {
    dom.approvalList.textContent = "No pending approvals.";
    return;
  }
  for (const approval of pending) {
    const card = queueCard({
      title: `${approval.gateType} · ${approval.topicId}`,
      subtitle: `Run ${approval.runId} · requested by ${approval.requestedBy} · ${formatTime(approval.createdAt)}`,
      note: approval.note,
    });
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    actions.append(
      queueAction("Approve", async () => {
        await requestJson(ENDPOINTS.approvalDecision(approval.id), {
          method: "POST",
          body: { decision: "approve", operator: "shell-operator", note: "approved from collaboration shell" },
        });
        await loadAndRender();
      }),
      queueAction("Reject", async () => {
        await requestJson(ENDPOINTS.approvalDecision(approval.id), {
          method: "POST",
          body: { decision: "reject", operator: "shell-operator", note: "rejected from collaboration shell" },
        });
        await loadAndRender();
      }),
    );
    card.append(actions);
    dom.approvalList.append(card);
  }
}

function renderInterventionQueue(interventions) {
  dom.interventionList.replaceChildren();
  const pending = interventions.filter((item) => item.status === "pending");
  if (pending.length === 0) {
    dom.interventionList.textContent = "No pending interventions.";
    return;
  }
  for (const intervention of pending) {
    const card = queueCard({
      title: `${intervention.type} · ${intervention.topicId}`,
      subtitle: `Run ${intervention.runId} · requested by ${intervention.requestedBy} · ${formatTime(
        intervention.createdAt,
      )}`,
      note: intervention.note,
    });
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    for (const action of intervention.recommendedActions) {
      actions.append(
        queueAction(actionLabel(action), async () => {
          await requestJson(ENDPOINTS.interventionAction(intervention.id), {
            method: "POST",
            body: { action, operator: "shell-operator", note: "action from collaboration shell" },
          });
          await loadAndRender();
        }),
      );
    }
    card.append(actions);
    dom.interventionList.append(card);
  }
}

function renderCloseoutPoints(points) {
  dom.interventionPointsList.replaceChildren();
  const closeoutAndGates = points.filter((point) =>
    ["lead_plan", "worker_dispatch", "merge_closeout"].includes(point.id),
  );

  if (closeoutAndGates.length === 0) {
    dom.interventionPointsList.textContent = "No closeout gate actions.";
    return;
  }

  for (const point of closeoutAndGates) {
    const card = queueCard({
      title: `${point.name} · ${point.topicId}`,
      subtitle: `Owner ${point.owner} · state ${point.status}`,
      note: point.note,
      status: point.status,
    });
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    for (const action of point.allowedActions) {
      actions.append(
        queueAction(interventionPointActionLabel(action), async () => {
          await requestJson(ENDPOINTS.interventionPointAction(point.id), {
            method: "POST",
            body: { action, operator: "shell-operator", note: "gate action from collaboration shell" },
          });
          await loadAndRender();
        }),
      );
    }
    card.append(actions);
    dom.interventionPointsList.append(card);
  }
}

function renderOperatorConsole(operatorConsole, payload) {
  renderWorkspaceSummary(operatorConsole, payload);
  renderWorkspaceGovernance(operatorConsole, payload);
  renderRepoBinding(operatorConsole, payload);
  renderRuntimeMachine(operatorConsole);
  renderAgentRegistry(operatorConsole, payload);
  renderAssignmentRecovery(operatorConsole, payload);
  renderOperatorActionLoop(operatorConsole, payload);
  renderRecentActions(operatorConsole);
  renderAuditEntries(operatorConsole);
}

function renderWorkspaceSummary(operatorConsole, payload) {
  dom.workspaceSummaryList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.workspaceSummaryList.textContent = "Operator workspace is unavailable.";
    return;
  }

  const workspace = operatorConsole.workspace || {};
  const channel = operatorConsole.channel || {};
  const channelStatus = channel.status || {};
  const channelContract = channel.context_contract || {};
  const topic = Array.isArray(payload?.topics) && payload.topics.length > 0 ? payload.topics[0] : null;
  const scopeDefaults = resolveOperatorScopeFromState(operatorConsole, payload);
  const topicId = normalizeText(workspace.default_topic_id) || normalizeText(topic?.id) || "unknown_topic";
  const channelId = normalizeText(channel.channel_id) || normalizeText(channelContract.channel_id) || "unbound_channel";
  const scope = normalizeText(operatorConsole.scope) || "single_human_multi_agent";
  const workspaceId = normalizeText(workspace.workspace_id) || `single_operator_${topicId}`;
  const operatorId = normalizeText(workspace.operator_id) || scopeDefaults.operatorId || "shell-operator";
  const contextStatus = normalizeText(channelStatus.context_status) || "unknown";
  const repoStatus = normalizeText(channelStatus.repo_binding_status) || "unknown";
  const auditStatus = normalizeText(channelStatus.audit_trail_status) || "unknown";

  const channelCard = queueCard({
    title: `Channel ${channelId}`,
    subtitle: "Layer: channel -> workspace(root) -> repo/worktree -> agent",
    note: `scope=${scope} · operator=${operatorId} · context=${contextStatus} · repo=${repoStatus} · audit=${auditStatus}`,
    status: contextStatus === "ok" ? "active" : "pending",
  });
  const channelActions = document.createElement("div");
  channelActions.className = "queue-actions";
  channelActions.append(
    queueAction("Upsert context", async () => {
      const channelInput = window.prompt("Channel ID", channelId === "unbound_channel" ? "" : channelId);
      if (channelInput === null) {
        return;
      }
      const normalizedChannelId = normalizeText(channelInput);
      if (!normalizedChannelId) {
        throw new Error("channel_id is required");
      }
      const workspaceRootInput = window.prompt(
        "Workspace root path",
        normalizeText(channelContract?.workspace?.root_path) || "/Users/atou/OpenShockSwarm",
      );
      if (workspaceRootInput === null) {
        return;
      }
      const workspaceRoot = normalizeText(workspaceRootInput);
      if (!workspaceRoot) {
        throw new Error("workspace_root is required");
      }
      const baselineInput = window.prompt(
        "Baseline ref",
        normalizeText(channelContract?.context?.baseline_ref) || "feat/initial-implementation@0116e37",
      );
      if (baselineInput === null) {
        return;
      }
      await requestJson(ENDPOINTS.operatorChannelContextUpsert, {
        method: "POST",
        body: {
          channel_id: normalizedChannelId,
          operator: operatorId,
          workspace_id: workspaceId,
          workspace_root: workspaceRoot,
          baseline_ref: normalizeText(baselineInput) || null,
        },
      });
      await loadAndRender();
    }),
  );
  channelCard.append(channelActions);

  const workspaceCard = queueCard({
    title: `Workspace ${workspaceId}`,
    subtitle: `Default topic ${topicId}`,
    note: `workspace_root=${normalizeText(workspace.root_path) || "n/a"}`,
    status: "idle",
  });

  dom.workspaceSummaryList.append(channelCard, workspaceCard);
}

function renderWorkspaceGovernance(operatorConsole, payload) {
  dom.workspaceGovernanceList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.workspaceGovernanceList.textContent = "Workspace governance is unavailable.";
    return;
  }

  const governance =
    (operatorConsole.workspace_governance && typeof operatorConsole.workspace_governance === "object"
      ? operatorConsole.workspace_governance
      : null) ||
    (operatorConsole.workspaceGovernance && typeof operatorConsole.workspaceGovernance === "object"
      ? operatorConsole.workspaceGovernance
      : null);
  if (!governance) {
    dom.workspaceGovernanceList.textContent = "Workspace governance truth is not projected yet.";
    return;
  }

  const scopeDefaults = resolveOperatorScopeFromState(operatorConsole, payload);
  const workspaceId =
    normalizeText(governance.workspace_id) || normalizeText(operatorConsole.workspace?.workspace_id) || "workspace_default";
  const governanceStatus = governance.status && typeof governance.status === "object" ? governance.status : {};
  const chain = governance.chain && typeof governance.chain === "object" ? governance.chain : {};
  const members = Array.isArray(governance.members) ? governance.members : [];
  const identities = Array.isArray(governance.auth_identities) ? governance.auth_identities : [];
  const installations = Array.isArray(governance.github_installations) ? governance.github_installations : [];
  const stage4a2 =
    (governance.stage4a2 && typeof governance.stage4a2 === "object" ? governance.stage4a2 : null) ||
    (governance.stage4a2_governance && typeof governance.stage4a2_governance === "object"
      ? governance.stage4a2_governance
      : null);
  const stage4b =
    (governance.stage4b && typeof governance.stage4b === "object" ? governance.stage4b : null) ||
    (governance.stage4b_governance && typeof governance.stage4b_governance === "object"
      ? governance.stage4b_governance
      : null);
  const stage4c =
    (governance.stage4c && typeof governance.stage4c === "object" ? governance.stage4c : null) ||
    (governance.stage4c_governance && typeof governance.stage4c_governance === "object"
      ? governance.stage4c_governance
      : null);
  const stage5a =
    (governance.stage5a && typeof governance.stage5a === "object" ? governance.stage5a : null) ||
    (governance.stage5a_hosted_workbench && typeof governance.stage5a_hosted_workbench === "object"
      ? governance.stage5a_hosted_workbench
      : null);
  const stage5b =
    (governance.stage5b && typeof governance.stage5b === "object" ? governance.stage5b : null) ||
    (governance.stage5b_hosted_workbench && typeof governance.stage5b_hosted_workbench === "object"
      ? governance.stage5b_hosted_workbench
      : null);
  const stage5c =
    (governance.stage5c && typeof governance.stage5c === "object" ? governance.stage5c : null) ||
    (governance.stage5c_hosted_runtime && typeof governance.stage5c_hosted_runtime === "object"
      ? governance.stage5c_hosted_runtime
      : null);
  const stage6a =
    (governance.stage6a && typeof governance.stage6a === "object" ? governance.stage6a : null) ||
    (governance.stage6a_hosted_onboarding_access && typeof governance.stage6a_hosted_onboarding_access === "object"
      ? governance.stage6a_hosted_onboarding_access
      : null);
  const stage6b =
    (governance.stage6b && typeof governance.stage6b === "object" ? governance.stage6b : null) ||
    (governance.stage6b_hosted_notification_recovery && typeof governance.stage6b_hosted_notification_recovery === "object"
      ? governance.stage6b_hosted_notification_recovery
      : null);
  const stage6c =
    (governance.stage6c && typeof governance.stage6c === "object" ? governance.stage6c : null) ||
    (governance.stage6c_hosted_plan_quota && typeof governance.stage6c_hosted_plan_quota === "object"
      ? governance.stage6c_hosted_plan_quota
      : null);
  const stage7a =
    (governance.stage7a && typeof governance.stage7a === "object" ? governance.stage7a : null) ||
    (governance.stage7a_hosted_billing_subscription &&
    typeof governance.stage7a_hosted_billing_subscription === "object"
      ? governance.stage7a_hosted_billing_subscription
      : null);
  const stage7b =
    (governance.stage7b && typeof governance.stage7b === "object" ? governance.stage7b : null) ||
    (governance.stage7b_hosted_billing_artifacts_discount &&
    typeof governance.stage7b_hosted_billing_artifacts_discount === "object"
      ? governance.stage7b_hosted_billing_artifacts_discount
      : null);

  const chainCard = queueCard({
    title: `Workspace ${workspaceId}`,
    subtitle: "identity -> installation -> repo binding",
    note: `identity=${normalizeText(chain.identity_link_status) || "pending"} · installation=${
      normalizeText(chain.installation_status) || "pending"
    } · repo_binding=${normalizeText(chain.repo_binding_status) || "pending"}`,
    status: normalizeText(chain.repo_binding_status) === "ready" ? "active" : "pending",
  });
  const chainActions = document.createElement("div");
  chainActions.className = "queue-actions";
  chainActions.append(
    queueAction("Upsert member", async () => {
      const memberIdInput = window.prompt("Member ID", "");
      if (memberIdInput === null) {
        return;
      }
      const memberId = normalizeText(memberIdInput);
      if (!memberId) {
        throw new Error("member_id is required");
      }
      const roleInput = window.prompt("Role (owner/admin/member/viewer)", "member");
      if (roleInput === null) {
        return;
      }
      const role = normalizeText(roleInput);
      if (!role) {
        throw new Error("role is required");
      }
      const statusInput = window.prompt("Status (invited/active/suspended)", "active");
      if (statusInput === null) {
        return;
      }
      await requestJson(ENDPOINTS.workspaceGovernanceMemberUpsert, {
        method: "POST",
        body: {
          channel_id: scopeDefaults.channelId,
          workspace_id: workspaceId,
          member_id: memberId,
          role,
          status: normalizeText(statusInput) || "active",
          operator: scopeDefaults.operatorId,
        },
      });
      await loadAndRender();
    }),
    queueAction("Link identity", async () => {
      const loginInput = window.prompt("GitHub login", "");
      if (loginInput === null) {
        return;
      }
      const githubLogin = normalizeText(loginInput);
      if (!githubLogin) {
        throw new Error("github_login is required");
      }
      const memberIdInput = window.prompt("Member ID (optional)", "");
      if (memberIdInput === null) {
        return;
      }
      const userIdInput = window.prompt("GitHub user ID (optional)", "");
      if (userIdInput === null) {
        return;
      }
      await requestJson(ENDPOINTS.workspaceGovernanceIdentityUpsert, {
        method: "POST",
        body: {
          channel_id: scopeDefaults.channelId,
          workspace_id: workspaceId,
          member_id: normalizeText(memberIdInput) || null,
          provider: "github",
          github_login: githubLogin,
          provider_user_id: normalizeText(userIdInput) || null,
          operator: scopeDefaults.operatorId,
        },
      });
      await loadAndRender();
    }),
    queueAction("Upsert installation", async () => {
      const installationInput = window.prompt("GitHub installation ID", "");
      if (installationInput === null) {
        return;
      }
      const installationId = normalizeText(installationInput);
      if (!installationId) {
        throw new Error("installation_id is required");
      }
      const repoInput = window.prompt("Authorized repos (comma-separated, optional)", "");
      if (repoInput === null) {
        return;
      }
      await requestJson(ENDPOINTS.workspaceGovernanceInstallationUpsert, {
        method: "POST",
        body: {
          channel_id: scopeDefaults.channelId,
          workspace_id: workspaceId,
          installation_id: installationId,
          provider: "github",
          authorized_repos: normalizeStringList(repoInput),
          status: "installed",
          operator: scopeDefaults.operatorId,
        },
      });
      await loadAndRender();
    }),
  );
  chainCard.append(chainActions);
  dom.workspaceGovernanceList.append(chainCard);

  const memberCard = queueCard({
    title: `Members ${members.length}`,
    subtitle: `status=${normalizeText(governanceStatus.members_status) || "unknown"}`,
    note:
      members.length > 0
        ? members
            .slice(0, 6)
            .map((member) => {
              const memberId = normalizeText(member.member_id) || "unknown_member";
              const role = normalizeText(member.role) || "unknown";
              const status = normalizeText(member.status) || "unknown";
              return `${memberId}:${role}/${status}`;
            })
            .join(" · ")
        : "No members projected.",
    status: members.length > 0 ? "active" : "pending",
  });
  dom.workspaceGovernanceList.append(memberCard);

  const identityCard = queueCard({
    title: `GitHub Identities ${identities.length}`,
    subtitle: `status=${normalizeText(governanceStatus.identities_status) || "unknown"}`,
    note:
      identities.length > 0
        ? identities
            .slice(0, 6)
            .map((identity) => normalizeText(identity.github_login || identity.identity_id) || "unknown_identity")
            .join(" · ")
        : "No linked identities projected.",
    status: identities.length > 0 ? "active" : "pending",
  });
  dom.workspaceGovernanceList.append(identityCard);

  const installationCard = queueCard({
    title: `Installations ${installations.length}`,
    subtitle: `status=${normalizeText(governanceStatus.installations_status) || "unknown"}`,
    note:
      installations.length > 0
        ? installations
            .slice(0, 6)
            .map((installation) => {
              const installationId = normalizeText(installation.installation_id) || "unknown_installation";
              const account =
                normalizeText(installation.github_account_login) ||
                normalizeText(installation.workspace_id) ||
                normalizeText(installation.provider) ||
                "unknown_installation";
              const status = normalizeText(installation.status) || "unknown";
              return `${account}#${installationId}:${status}`;
            })
            .join(" · ")
        : "No installations projected.",
    status: installations.length > 0 ? "active" : "pending",
  });
  dom.workspaceGovernanceList.append(installationCard);

  if (stage4a2) {
    const notification = stage4a2.notification && typeof stage4a2.notification === "object" ? stage4a2.notification : {};
    const approval = stage4a2.approval && typeof stage4a2.approval === "object" ? stage4a2.approval : {};
    const restrictedExecution =
      stage4a2.restricted_execution && typeof stage4a2.restricted_execution === "object"
        ? stage4a2.restricted_execution
        : {};
    const stage4a2Status = stage4a2.status && typeof stage4a2.status === "object" ? stage4a2.status : {};

    const notificationCard = queueCard({
      title: "Stage4A2 Notification Routing",
      subtitle:
        `endpoints=${normalizeText(stage4a2Status.notification_endpoints_status) || "pending"} · ` +
        `rules=${normalizeText(stage4a2Status.routing_rules_status) || "pending"}`,
      note:
        `${formatStage4a2NotificationEndpoints(notification.endpoints)} · ` +
        `${formatStage4a2RoutingRules(notification.routing_rules)} · ` +
        `${formatStage4a2AuditAnchor(notification.audit_anchor)}`,
      status:
        normalizeText(stage4a2Status.notification_endpoints_status) === "ok" &&
        normalizeText(stage4a2Status.routing_rules_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(notificationCard);

    const approvalCard = queueCard({
      title: "Stage4A2 Approval Chain",
      subtitle:
        `status=${normalizeText(approval.status) || normalizeText(stage4a2Status.approval_status) || "pending"} · ` +
        `pending=${Number(approval.pending_count || 0)}`,
      note: `${formatStage4a2ApprovalContract(approval.contract)} · ${formatStage4a2AuditAnchor(approval.audit_anchor)}`,
      status: normalizeText(approval.status) === "ready" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(approvalCard);

    const restrictedCard = queueCard({
      title: "Restricted Local Sandbox",
      subtitle:
        `sandbox=${normalizeText(stage4a2Status.sandbox_profile_status) || "pending"} · ` +
        `secrets=${normalizeText(stage4a2Status.secrets_bindings_status) || "pending"}`,
      note:
        `${formatStage4a2SandboxProfile(restrictedExecution.sandbox_profile)} · ` +
        `${formatStage4a2SecretsBindings(restrictedExecution.secrets_bindings)} · ` +
        `${formatStage4a2Enforcement(restrictedExecution.latest_enforcement)}`,
      status:
        normalizeText(stage4a2Status.sandbox_profile_status) === "ok" &&
        normalizeText(stage4a2Status.secrets_bindings_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(restrictedCard);

    const usageCard = queueCard({
      title: "Sandbox / Secrets Usage",
      subtitle: `status=${normalizeText(stage4a2Status.usage_notes_status) || "pending"}`,
      note: formatStage4a2UsageNotes(restrictedExecution.usage_notes),
      status: normalizeText(stage4a2Status.usage_notes_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(usageCard);
  }

  if (stage4b) {
    const stage4bStatus = stage4b.status && typeof stage4b.status === "object" ? stage4b.status : {};
    const provider =
      stage4b.external_memory_provider && typeof stage4b.external_memory_provider === "object"
        ? stage4b.external_memory_provider
        : {};
    const memoryViewer =
      stage4b.memory_viewer && typeof stage4b.memory_viewer === "object" ? stage4b.memory_viewer : {};
    const skillPolicyPlugin =
      stage4b.skill_policy_plugin && typeof stage4b.skill_policy_plugin === "object"
        ? stage4b.skill_policy_plugin
        : {};
    const tokenQuotaContext =
      stage4b.token_quota_context && typeof stage4b.token_quota_context === "object"
        ? stage4b.token_quota_context
        : {};
    const timeline = stage4b.timeline && typeof stage4b.timeline === "object" ? stage4b.timeline : {};

    const providerCard = queueCard({
      title: "Stage4B External Memory Provider",
      subtitle:
        `provider=${normalizeText(stage4bStatus.external_memory_provider_status) || "pending"} · ` +
        `viewer=${normalizeText(stage4bStatus.memory_viewer_status) || "pending"}`,
      note: `${formatStage4bProvider(provider.provider)} · ${formatStage4bProviderAnchors(provider.write_anchors)}`,
      status:
        normalizeText(stage4bStatus.external_memory_provider_status) === "ok" &&
        normalizeText(stage4bStatus.memory_viewer_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(providerCard);

    const memoryViewerCard = queueCard({
      title: "Stage4B Memory Viewer",
      subtitle: `status=${normalizeText(stage4bStatus.memory_viewer_status) || "pending"}`,
      note: `${formatStage4bMemoryViewer(memoryViewer)} · ${formatStage4bMemoryItems(memoryViewer.items)}`,
      status: normalizeText(stage4bStatus.memory_viewer_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(memoryViewerCard);

    const skillPolicyPluginCard = queueCard({
      title: "Stage4B Skill / Policy / Plugin",
      subtitle: `status=${normalizeText(stage4bStatus.skill_policy_plugin_status) || "pending"}`,
      note: `${formatStage4bSkillPolicyPlugin(skillPolicyPlugin.value)} · ${formatStage4bAuditAnchor(skillPolicyPlugin.audit_anchor)}`,
      status: normalizeText(stage4bStatus.skill_policy_plugin_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(skillPolicyPluginCard);

    const tokenQuotaCard = queueCard({
      title: "Stage4B Token / Quota / Context",
      subtitle:
        `status=${normalizeText(stage4bStatus.token_quota_context_status) || "pending"} · ` +
        `timeline=${normalizeText(stage4bStatus.timeline_status) || "pending"}`,
      note: `${formatStage4bTokenQuotaContext(tokenQuotaContext.value)} · ${formatStage4bTimeline(timeline)}`,
      status:
        normalizeText(stage4bStatus.token_quota_context_status) === "ok" &&
        normalizeText(stage4bStatus.timeline_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(tokenQuotaCard);
  }

  if (stage4c) {
    const stage4cStatus = stage4c.status && typeof stage4c.status === "object" ? stage4c.status : {};
    const digitalTwin = stage4c.digital_twin && typeof stage4c.digital_twin === "object" ? stage4c.digital_twin : {};
    const operationalCapability =
      stage4c.operational_capability && typeof stage4c.operational_capability === "object"
        ? stage4c.operational_capability
        : {};
    const orchestration = stage4c.orchestration && typeof stage4c.orchestration === "object" ? stage4c.orchestration : {};
    const upgrade = stage4c.upgrade && typeof stage4c.upgrade === "object" ? stage4c.upgrade : {};
    const timeline = stage4c.timeline && typeof stage4c.timeline === "object" ? stage4c.timeline : {};

    const digitalTwinCard = queueCard({
      title: "Stage4C Digital Twin",
      subtitle: `status=${normalizeText(stage4cStatus.digital_twin_status) || "pending"}`,
      note: `${formatStage4cDigitalTwin(digitalTwin.value)} · ${formatStage4bAuditAnchor(digitalTwin.audit_anchor)}`,
      status: normalizeText(stage4cStatus.digital_twin_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(digitalTwinCard);

    const operationalCapabilityCard = queueCard({
      title: "Stage4C Operational Capability",
      subtitle: `status=${normalizeText(stage4cStatus.operational_capability_status) || "pending"}`,
      note:
        `${formatStage4cOperationalCapability(operationalCapability.value)} · ` +
        `${formatStage4bAuditAnchor(operationalCapability.audit_anchor)}`,
      status: normalizeText(stage4cStatus.operational_capability_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(operationalCapabilityCard);

    const orchestrationCard = queueCard({
      title: "Stage4C Multi-Agent Orchestration",
      subtitle: `status=${normalizeText(stage4cStatus.orchestration_status) || "pending"}`,
      note: `${formatStage4cOrchestration(orchestration.value)} · ${formatStage4bAuditAnchor(orchestration.audit_anchor)}`,
      status: normalizeText(stage4cStatus.orchestration_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(orchestrationCard);

    const upgradeCard = queueCard({
      title: "Stage4C Upgrade Arbitration / Human Chain",
      subtitle:
        `arbitration=${normalizeText(stage4cStatus.upgrade_arbitration_status) || "pending"} · ` +
        `human_chain=${normalizeText(stage4cStatus.human_upgrade_chain_status) || "pending"}`,
      note:
        `${formatStage4cUpgrade(upgrade)} · ${formatStage4cTimeline(timeline)} · ` +
        `${formatStage4cEscalation(upgrade.latest_escalation)}`,
      status:
        normalizeText(stage4cStatus.upgrade_arbitration_status) === "ok" &&
        normalizeText(stage4cStatus.human_upgrade_chain_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(upgradeCard);
  }

  if (stage5a) {
    const stage5aStatus = stage5a.status && typeof stage5a.status === "object" ? stage5a.status : {};
    const hostedAccess = stage5a.hosted_access && typeof stage5a.hosted_access === "object" ? stage5a.hosted_access : {};
    const hostedWorkbench =
      stage5a.hosted_workbench && typeof stage5a.hosted_workbench === "object" ? stage5a.hosted_workbench : {};
    const deployRuntime = stage5a.deploy_runtime && typeof stage5a.deploy_runtime === "object" ? stage5a.deploy_runtime : {};
    const deliveryContract =
      stage5a.delivery_contract && typeof stage5a.delivery_contract === "object" ? stage5a.delivery_contract : {};

    const hostedAccessCard = queueCard({
      title: "Stage5A Hosted Access",
      subtitle:
        `hosted=${normalizeText(stage5aStatus.hosted_access_status) || "pending"} · ` +
        `non_local=${normalizeText(stage5aStatus.non_local_access_status) || "pending"} · ` +
        `login=${normalizeText(stage5aStatus.stable_login_status) || "pending"}`,
      note: formatStage5aHostedAccess(hostedAccess),
      status:
        normalizeText(stage5aStatus.hosted_access_status) === "ok" &&
        normalizeText(stage5aStatus.stable_login_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(hostedAccessCard);

    const hostedWorkbenchCard = queueCard({
      title: "Stage5A Hosted Workbench",
      subtitle:
        `home=${normalizeText(stage5aStatus.hosted_home_status) || "pending"} · ` +
        `inbox=${normalizeText(stage5aStatus.unified_inbox_status) || "pending"} · ` +
        `default_flow=${normalizeText(stage5aStatus.default_flow_status) || "pending"}`,
      note: formatStage5aHostedWorkbench(hostedWorkbench),
      status:
        normalizeText(stage5aStatus.hosted_home_status) === "ok" &&
        normalizeText(stage5aStatus.unified_inbox_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(hostedWorkbenchCard);

    const deployCard = queueCard({
      title: "Stage5A Deploy / Delivery Contract",
      subtitle:
        `deploy=${normalizeText(stage5aStatus.deploy_runtime_status) || "pending"} · ` +
        `delivery=${normalizeText(stage5aStatus.delivery_surface_status) || "pending"}`,
      note: `${formatStage5aDeployRuntime(deployRuntime)} · ${formatStage5aDeliveryContract(deliveryContract)}`,
      status:
        normalizeText(stage5aStatus.deploy_runtime_status) === "ok" &&
        normalizeText(stage5aStatus.delivery_surface_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(deployCard);
  }

  if (stage5b) {
    const stage5bStatus = stage5b.status && typeof stage5b.status === "object" ? stage5b.status : {};
    const hostedWorkbench =
      stage5b.hosted_multi_human_workbench && typeof stage5b.hosted_multi_human_workbench === "object"
        ? stage5b.hosted_multi_human_workbench
        : {};
    const defaultFlow = stage5b.default_flow && typeof stage5b.default_flow === "object" ? stage5b.default_flow : {};
    const unifiedInbox = stage5b.unified_inbox && typeof stage5b.unified_inbox === "object" ? stage5b.unified_inbox : {};
    const attentionRouting =
      stage5b.attention_routing && typeof stage5b.attention_routing === "object" ? stage5b.attention_routing : {};

    const hostedWorkbenchCard = queueCard({
      title: "Stage5B Hosted Multi-Human Workbench",
      subtitle:
        `status=${normalizeText(stage5bStatus.hosted_multi_human_workbench_status) || "pending"} · ` +
        `participants=${normalizeText(hostedWorkbench.participant_mode) || "multi_human"}`,
      note: formatStage5bHostedWorkbench(hostedWorkbench),
      status: normalizeText(stage5bStatus.hosted_multi_human_workbench_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(hostedWorkbenchCard);

    const defaultFlowCard = queueCard({
      title: "Stage5B Channel / Thread / Task Default Flow",
      subtitle: `status=${normalizeText(stage5bStatus.default_flow_status) || "pending"}`,
      note: formatStage5bDefaultFlow(defaultFlow),
      status: normalizeText(stage5bStatus.default_flow_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(defaultFlowCard);

    const inboxCard = queueCard({
      title: "Stage5B Unified Inbox / Attention Routing",
      subtitle:
        `inbox=${normalizeText(stage5bStatus.unified_inbox_status) || "pending"} · ` +
        `attention=${normalizeText(stage5bStatus.attention_routing_status) || "pending"}`,
      note: `${formatStage5bUnifiedInbox(unifiedInbox)} · ${formatStage5bAttentionRouting(attentionRouting)}`,
      status:
        normalizeText(stage5bStatus.unified_inbox_status) === "ok" &&
        normalizeText(stage5bStatus.attention_routing_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(inboxCard);
  }

  if (stage5c) {
    const stage5cStatus = stage5c.status && typeof stage5c.status === "object" ? stage5c.status : {};
    const hostedRuntimeEntry =
      stage5c.hosted_runtime_entry && typeof stage5c.hosted_runtime_entry === "object" ? stage5c.hosted_runtime_entry : {};
    const remoteDaemonPairing =
      stage5c.remote_daemon_pairing && typeof stage5c.remote_daemon_pairing === "object"
        ? stage5c.remote_daemon_pairing
        : {};
    const machineFleet = stage5c.machine_fleet && typeof stage5c.machine_fleet === "object" ? stage5c.machine_fleet : {};
    const deployRuntime = stage5c.deploy_runtime && typeof stage5c.deploy_runtime === "object" ? stage5c.deploy_runtime : {};
    const healthReadiness =
      stage5c.health_readiness && typeof stage5c.health_readiness === "object" ? stage5c.health_readiness : {};
    const releaseRecoveryUpgradeHandoff =
      stage5c.release_recovery_upgrade_handoff && typeof stage5c.release_recovery_upgrade_handoff === "object"
        ? stage5c.release_recovery_upgrade_handoff
        : {};
    const hostedControlVisibility =
      stage5c.hosted_control_visibility && typeof stage5c.hosted_control_visibility === "object"
        ? stage5c.hosted_control_visibility
        : {};

    const pairingCard = queueCard({
      title: "Stage5C Remote Daemon Pairing / Hosted Entry",
      subtitle:
        `pairing=${normalizeText(stage5cStatus.remote_daemon_pairing_status) || "pending"} · ` +
        `hosted=${normalizeText(hostedRuntimeEntry.hosted_access_status) || "pending"}`,
      note: `${formatStage5cHostedRuntimeEntry(hostedRuntimeEntry)} · ${formatStage5cRemotePairing(remoteDaemonPairing)}`,
      status: normalizeText(stage5cStatus.remote_daemon_pairing_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(pairingCard);

    const fleetCard = queueCard({
      title: "Stage5C Machine Fleet Visibility",
      subtitle:
        `fleet=${normalizeText(stage5cStatus.machine_fleet_status) || "pending"} · ` +
        `control=${normalizeText(stage5cStatus.hosted_runtime_control_visibility_status) || "pending"}`,
      note: `${formatStage5cMachineFleet(machineFleet)} · ${formatStage5cControlVisibility(hostedControlVisibility)}`,
      status:
        normalizeText(stage5cStatus.machine_fleet_status) === "ok" &&
        normalizeText(stage5cStatus.hosted_runtime_control_visibility_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(fleetCard);

    const lifecycleCard = queueCard({
      title: "Stage5C Recovery / Upgrade / Handoff",
      subtitle:
        `deploy=${normalizeText(stage5cStatus.deploy_runtime_status) || "pending"} · ` +
        `health=${normalizeText(stage5cStatus.health_readiness_status) || "pending"} · ` +
        `handoff=${normalizeText(stage5cStatus.release_recovery_upgrade_handoff_status) || "pending"}`,
      note:
        `${formatStage5cDeployRuntime(deployRuntime)} · ${formatStage5cHealthReadiness(healthReadiness)} · ` +
        `${formatStage5cReleaseRecoveryUpgradeHandoff(releaseRecoveryUpgradeHandoff)}`,
      status:
        normalizeText(stage5cStatus.deploy_runtime_status) === "ok" &&
        normalizeText(stage5cStatus.health_readiness_status) === "ok" &&
        normalizeText(stage5cStatus.release_recovery_upgrade_handoff_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(lifecycleCard);
  }

  if (stage6a) {
    const stage6aStatus = stage6a.status && typeof stage6a.status === "object" ? stage6a.status : {};
    const hostedOnboardingAccess =
      stage6a.hosted_onboarding_access && typeof stage6a.hosted_onboarding_access === "object"
        ? stage6a.hosted_onboarding_access
        : {};
    const inviteVerifyJoin =
      stage6a.invite_verify_join && typeof stage6a.invite_verify_join === "object" ? stage6a.invite_verify_join : {};
    const githubInstallRepoBinding =
      stage6a.github_install_repo_binding && typeof stage6a.github_install_repo_binding === "object"
        ? stage6a.github_install_repo_binding
        : {};
    const deviceAuthorizationRuntimeAttach =
      stage6a.device_authorization_runtime_attach && typeof stage6a.device_authorization_runtime_attach === "object"
        ? stage6a.device_authorization_runtime_attach
        : {};
    const stage5WorkbenchHandoff =
      stage6a.stage5_workbench_handoff && typeof stage6a.stage5_workbench_handoff === "object"
        ? stage6a.stage5_workbench_handoff
        : {};

    const onboardingCard = queueCard({
      title: "Stage6A Hosted Onboarding Access",
      subtitle:
        `entry=${normalizeText(stage6aStatus.hosted_onboarding_access_status) || "pending"} · ` +
        `invite/verify/join=${normalizeText(stage6aStatus.invite_verify_join_status) || "pending"}`,
      note: `${formatStage6aHostedOnboardingAccess(hostedOnboardingAccess)} · ${formatStage6aInviteVerifyJoin(inviteVerifyJoin)}`,
      status: normalizeText(stage6aStatus.hosted_onboarding_access_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(onboardingCard);

    const bindingAttachCard = queueCard({
      title: "Stage6A GitHub Install / Runtime Attach",
      subtitle:
        `binding=${normalizeText(stage6aStatus.github_install_repo_binding_status) || "pending"} · ` +
        `attach=${normalizeText(stage6aStatus.device_authorization_runtime_attach_status) || "pending"}`,
      note:
        `${formatStage6aGithubInstallRepoBinding(githubInstallRepoBinding)} · ` +
        `${formatStage6aDeviceAuthorizationRuntimeAttach(deviceAuthorizationRuntimeAttach)}`,
      status:
        normalizeText(stage6aStatus.github_install_repo_binding_status) === "ok" &&
        normalizeText(stage6aStatus.device_authorization_runtime_attach_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(bindingAttachCard);

    const handoffCard = queueCard({
      title: "Stage6A Stage5 Workbench Handoff",
      subtitle:
        `handoff=${normalizeText(stage6aStatus.stage5_workbench_handoff_status) || "pending"} · ` +
        `no_shadow_truth=${hostedOnboardingAccess.no_shadow_truth === true ? "ok" : "pending"}`,
      note: formatStage6aStage5WorkbenchHandoff(stage5WorkbenchHandoff),
      status: normalizeText(stage6aStatus.stage5_workbench_handoff_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(handoffCard);
  }

  if (stage6b) {
    const stage6bStatus = stage6b.status && typeof stage6b.status === "object" ? stage6b.status : {};
    const hostedNotificationRecovery =
      stage6b.hosted_notification_recovery && typeof stage6b.hosted_notification_recovery === "object"
        ? stage6b.hosted_notification_recovery
        : {};
    const notificationDelivery =
      stage6b.notification_delivery && typeof stage6b.notification_delivery === "object" ? stage6b.notification_delivery : {};
    const recoveryRouting =
      stage6b.recovery_routing && typeof stage6b.recovery_routing === "object" ? stage6b.recovery_routing : {};
    const hostedReentry = stage6b.hosted_reentry && typeof stage6b.hosted_reentry === "object" ? stage6b.hosted_reentry : {};

    const notificationCard = queueCard({
      title: "Stage6B Hosted Notification Reachability",
      subtitle:
        `entry=${normalizeText(stage6bStatus.hosted_notification_recovery_status) || "pending"} · ` +
        `invite/verify/reset=${normalizeText(stage6bStatus.invite_verify_reset_password_status) || "pending"}`,
      note:
        `${formatStage6bHostedNotificationRecovery(hostedNotificationRecovery)} · ` +
        `${formatStage6bNotificationDelivery(notificationDelivery)}`,
      status: normalizeText(stage6bStatus.hosted_notification_recovery_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(notificationCard);

    const recoveryRoutingCard = queueCard({
      title: "Stage6B Escalation / PR Ready / Agent Mailbox",
      subtitle:
        `blocked=${normalizeText(stage6bStatus.blocked_escalation_status) || "pending"} · ` +
        `approval/pr=${normalizeText(stage6bStatus.approval_required_pr_ready_status) || "pending"} · ` +
        `mailbox=${normalizeText(stage6bStatus.agent_mailbox_routing_status) || "pending"}`,
      note: formatStage6bRecoveryRouting(recoveryRouting),
      status:
        normalizeText(stage6bStatus.blocked_escalation_status) === "ok" &&
        normalizeText(stage6bStatus.approval_required_pr_ready_status) === "ok" &&
        normalizeText(stage6bStatus.agent_mailbox_routing_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(recoveryRoutingCard);

    const reentryCard = queueCard({
      title: "Stage6B Hosted Recovery Re-entry",
      subtitle:
        `reentry=${normalizeText(stage6bStatus.recovery_reentry_status) || "pending"} · ` +
        `no_shadow_truth=${hostedNotificationRecovery.no_shadow_truth === true ? "ok" : "pending"}`,
      note: formatStage6bHostedReentry(hostedReentry),
      status: normalizeText(stage6bStatus.recovery_reentry_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(reentryCard);
  }

  if (stage6c) {
    const stage6cStatus = stage6c.status && typeof stage6c.status === "object" ? stage6c.status : {};
    const hostedPlanQuota =
      stage6c.hosted_plan_quota && typeof stage6c.hosted_plan_quota === "object" ? stage6c.hosted_plan_quota : {};
    const planSubscriptionLimit =
      stage6c.workspace_plan_subscription_limit && typeof stage6c.workspace_plan_subscription_limit === "object"
        ? stage6c.workspace_plan_subscription_limit
        : {};
    const usageQuotaReadiness =
      stage6c.usage_quota_readiness && typeof stage6c.usage_quota_readiness === "object"
        ? stage6c.usage_quota_readiness
        : {};

    const planQuotaCard = queueCard({
      title: "Stage6C Hosted Plan / Quota Reachability",
      subtitle:
        `entry=${normalizeText(stage6cStatus.hosted_plan_quota_status) || "pending"} · ` +
        `plan=${normalizeText(stage6cStatus.workspace_plan_subscription_limit_status) || "pending"}`,
      note:
        `${formatStage6cHostedPlanQuota(hostedPlanQuota)} · ` +
        `${formatStage6cPlanSubscriptionLimit(planSubscriptionLimit)}`,
      status: normalizeText(stage6cStatus.hosted_plan_quota_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(planQuotaCard);

    const usageCard = queueCard({
      title: "Stage6C Usage / Quota / Readiness",
      subtitle:
        `usage=${normalizeText(stage6cStatus.usage_quota_readiness_status) || "pending"} · ` +
        `capacity=${normalizeText(stage6cStatus.remaining_capacity_status) || "pending"} · ` +
        `upgrade=${normalizeText(stage6cStatus.upgrade_readiness_status) || "pending"}`,
      note: formatStage6cUsageQuotaReadiness(usageQuotaReadiness),
      status:
        normalizeText(stage6cStatus.usage_quota_readiness_status) === "ok" &&
        normalizeText(stage6cStatus.remaining_capacity_status) === "ok" &&
        normalizeText(stage6cStatus.upgrade_readiness_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(usageCard);

    const guardrailCard = queueCard({
      title: "Stage6C No Shadow Billing Truth",
      subtitle:
        `no_shadow_truth=${hostedPlanQuota.no_shadow_truth === true ? "ok" : "pending"} · ` +
        `quota_state=${normalizeText(usageQuotaReadiness.quota_state) || "pending"}`,
      note:
        `truth_family=${formatStage6cTruthFamily(hostedPlanQuota.truth_family)} · ` +
        `block_reason=${normalizeText(usageQuotaReadiness.block_reason) || "none"} · ` +
        `upgrade_path=${normalizeText(usageQuotaReadiness.upgrade_path_ref) || "n/a"}`,
      status: hostedPlanQuota.no_shadow_truth === true ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(guardrailCard);
  }

  if (stage7a) {
    const stage7aStatus = stage7a.status && typeof stage7a.status === "object" ? stage7a.status : {};
    const hostedBillingSubscription =
      stage7a.hosted_billing_subscription && typeof stage7a.hosted_billing_subscription === "object"
        ? stage7a.hosted_billing_subscription
        : {};
    const checkoutPaymentSubscriptionActivation =
      stage7a.checkout_payment_subscription_activation &&
      typeof stage7a.checkout_payment_subscription_activation === "object"
        ? stage7a.checkout_payment_subscription_activation
        : {};
    const upgradePlanManage =
      stage7a.upgrade_plan_manage && typeof stage7a.upgrade_plan_manage === "object" ? stage7a.upgrade_plan_manage : {};
    const paymentRecovery = stage7a.payment_recovery && typeof stage7a.payment_recovery === "object" ? stage7a.payment_recovery : {};

    const billingCard = queueCard({
      title: "Stage7A Hosted Billing / Subscription Reachability",
      subtitle:
        `entry=${normalizeText(stage7aStatus.hosted_billing_subscription_status) || "pending"} · ` +
        `checkout=${normalizeText(stage7aStatus.checkout_payment_subscription_activation_status) || "pending"} · ` +
        `lifecycle=${normalizeText(stage7aStatus.subscription_lifecycle_recovery_status) || "pending"}`,
      note:
        `${formatStage7aHostedBillingSubscription(hostedBillingSubscription)} · ` +
        `${formatStage7aCheckoutActivation(checkoutPaymentSubscriptionActivation)}`,
      status: normalizeText(stage7aStatus.hosted_billing_subscription_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(billingCard);

    const upgradePlanManageCard = queueCard({
      title: "Stage7A Upgrade CTA / Plan Manage",
      subtitle:
        `upgrade=${normalizeText(stage7aStatus.upgrade_cta_status) || "pending"} · ` +
        `plan_manage=${normalizeText(stage7aStatus.plan_manage_status) || "pending"}`,
      note: formatStage7aUpgradePlanManage(upgradePlanManage),
      status:
        normalizeText(stage7aStatus.upgrade_cta_status) === "ok" &&
        normalizeText(stage7aStatus.plan_manage_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(upgradePlanManageCard);

    const paymentRecoveryCard = queueCard({
      title: "Stage7A Payment Pending / Failed Recovery",
      subtitle:
        `recovery=${normalizeText(stage7aStatus.payment_pending_failed_recovery_status) || "pending"} · ` +
        `lifecycle=${normalizeText(stage7aStatus.subscription_lifecycle_recovery_status) || "pending"}`,
      note: formatStage7aPaymentRecovery(paymentRecovery),
      status: normalizeText(stage7aStatus.payment_pending_failed_recovery_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(paymentRecoveryCard);

    const guardrailCard = queueCard({
      title: "Stage7A No Shadow Billing / Notification Truth",
      subtitle:
        `no_shadow_truth=${hostedBillingSubscription.no_shadow_truth === true ? "ok" : "pending"} · ` +
        `notify=${normalizeText(paymentRecovery.notification_delivery_status) || "pending"}`,
      note:
        `truth_family=${formatStage6cTruthFamily(hostedBillingSubscription.truth_family)} · ` +
        `block_reason=${normalizeText(upgradePlanManage.block_reason) || "none"} · ` +
        `remaining=${formatStage7aRemainingCapacity(upgradePlanManage.remaining_capacity)}`,
      status: hostedBillingSubscription.no_shadow_truth === true ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(guardrailCard);
  }

  if (stage7b) {
    const stage7bStatus = stage7b.status && typeof stage7b.status === "object" ? stage7b.status : {};
    const hostedBillingArtifactsDiscount =
      stage7b.hosted_billing_artifacts_discount && typeof stage7b.hosted_billing_artifacts_discount === "object"
        ? stage7b.hosted_billing_artifacts_discount
        : {};
    const workspaceInvoiceTaxReceipt =
      stage7b.workspace_invoice_tax_receipt && typeof stage7b.workspace_invoice_tax_receipt === "object"
        ? stage7b.workspace_invoice_tax_receipt
        : {};
    const couponPromotionDiscountApplication =
      stage7b.coupon_promotion_discount_application &&
      typeof stage7b.coupon_promotion_discount_application === "object"
        ? stage7b.coupon_promotion_discount_application
        : {};
    const documentReceiptInvoiceProjection =
      stage7b.document_receipt_invoice_projection && typeof stage7b.document_receipt_invoice_projection === "object"
        ? stage7b.document_receipt_invoice_projection
        : {};
    const discountTotalsProjection =
      stage7b.discount_totals_projection && typeof stage7b.discount_totals_projection === "object"
        ? stage7b.discount_totals_projection
        : {};

    const artifactsCard = queueCard({
      title: "Stage7B Hosted Billing Artifacts / Discount Reachability",
      subtitle:
        `entry=${normalizeText(stage7bStatus.hosted_billing_artifacts_discount_status) || "pending"} · ` +
        `invoice=${normalizeText(stage7bStatus.workspace_invoice_tax_receipt_status) || "pending"} · ` +
        `discount=${normalizeText(stage7bStatus.coupon_promotion_discount_application_status) || "pending"}`,
      note:
        `${formatStage7bHostedBillingArtifactsDiscount(hostedBillingArtifactsDiscount)} · ` +
        `${formatStage7bInvoiceTaxReceipt(workspaceInvoiceTaxReceipt)}`,
      status: normalizeText(stage7bStatus.hosted_billing_artifacts_discount_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(artifactsCard);

    const documentProjectionCard = queueCard({
      title: "Stage7B Document Readiness / Receipt Invoice Refs",
      subtitle:
        `document=${normalizeText(stage7bStatus.document_readiness_status) || "pending"} · ` +
        `refs=${normalizeText(stage7bStatus.receipt_invoice_refs_status) || "pending"}`,
      note: formatStage7bDocumentProjection(documentReceiptInvoiceProjection),
      status:
        normalizeText(stage7bStatus.document_readiness_status) === "ok" &&
        normalizeText(stage7bStatus.receipt_invoice_refs_status) === "ok"
          ? "active"
          : "pending",
    });
    dom.workspaceGovernanceList.append(documentProjectionCard);

    const discountProjectionCard = queueCard({
      title: "Stage7B Coupon Promotion / Discount Totals Projection",
      subtitle:
        `discount=${normalizeText(stage7bStatus.discount_state_totals_projection_status) || "pending"} · ` +
        `application=${normalizeText(stage7bStatus.coupon_promotion_discount_application_status) || "pending"}`,
      note:
        `${formatStage7bCouponPromotionDiscount(couponPromotionDiscountApplication)} · ` +
        `${formatStage7bDiscountTotalsProjection(discountTotalsProjection)}`,
      status: normalizeText(stage7bStatus.discount_state_totals_projection_status) === "ok" ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(discountProjectionCard);

    const guardrailCard = queueCard({
      title: "Stage7B No Shadow Billing / Notification Truth",
      subtitle:
        `no_shadow_truth=${hostedBillingArtifactsDiscount.no_shadow_truth === true ? "ok" : "pending"} · ` +
        `notify=${normalizeText(discountTotalsProjection.notification_delivery_status) || "pending"}`,
      note:
        `truth_family=${formatStage6cTruthFamily(hostedBillingArtifactsDiscount.truth_family)} · ` +
        `invoice_ref=${normalizeText(workspaceInvoiceTaxReceipt.invoice_ref) || "n/a"} · ` +
        `receipt_ref=${normalizeText(workspaceInvoiceTaxReceipt.receipt_ref) || "n/a"}`,
      status: hostedBillingArtifactsDiscount.no_shadow_truth === true ? "active" : "pending",
    });
    dom.workspaceGovernanceList.append(guardrailCard);
  }
}

function renderRepoBinding(operatorConsole, payload) {
  dom.repoBindingList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.repoBindingList.textContent = "Repo binding is unavailable.";
    return;
  }

  const scopeDefaults = resolveOperatorScopeFromState(operatorConsole, payload);
  const repoBinding = operatorConsole.repo_binding;
  const title = repoBinding?.repo_ref ? repoBinding.repo_ref : "Unbound repo";
  const subtitle = repoBinding?.provider
    ? `${repoBinding.provider} · ${repoBinding.default_branch || "branch not set"} · ${repoBinding.source || "unknown"}`
    : "repo binding missing";
  const note = repoBinding?.updated_at
    ? `updated ${formatTime(repoBinding.updated_at)} by ${repoBinding.updated_by || "unknown"}`
    : "upsert repo binding to enable operator workspace";

  const card = queueCard({
    title,
    subtitle,
    note,
    status: repoBinding?.repo_ref ? "active" : "pending",
  });

  const actions = document.createElement("div");
  actions.className = "queue-actions";
  actions.append(
    queueAction("Upsert binding", async () => {
      const repoRefInput = window.prompt("Repo ref (owner/repo)", repoBinding?.repo_ref || "");
      if (repoRefInput === null) {
        return;
      }
      const repoRef = normalizeText(repoRefInput);
      if (!repoRef) {
        throw new Error("repo_ref is required");
      }
      const branchInput = window.prompt("Default branch", repoBinding?.default_branch || "main");
      if (branchInput === null) {
        return;
      }
      const defaultBranch = normalizeText(branchInput);
      const providerInput = window.prompt("Provider", repoBinding?.provider || "github");
      if (providerInput === null) {
        return;
      }
      const provider = normalizeText(providerInput) || "github";
      const channelInput = window.prompt("Channel ID", scopeDefaults.channelId || "");
      if (channelInput === null) {
        return;
      }
      const channelId = normalizeText(channelInput);
      if (!channelId) {
        throw new Error("channel_id is required");
      }
      await requestJson(ENDPOINTS.operatorRepoBindingUpsert, {
        method: "POST",
        body: {
          provider,
          repo_ref: repoRef,
          default_branch: defaultBranch || null,
          channel_id: channelId,
          topic_id: scopeDefaults.topicId,
          operator: scopeDefaults.operatorId,
        },
      });
      await loadAndRender();
    }),
  );
  card.append(actions);
  dom.repoBindingList.append(card);
}

function renderRuntimeMachine(operatorConsole) {
  dom.runtimeMachineList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.runtimeMachineList.textContent = "Runtime and machine state unavailable.";
    return;
  }

  const runtime = operatorConsole.runtime || {};
  const machine = operatorConsole.machine || {};

  const runtimeCard = queueCard({
    title: normalizeText(runtime.runtime_name) || "runtime",
    subtitle: `daemon=${normalizeText(runtime.daemon_name) || "unknown"} · pairing=${
      normalizeText(runtime.pairing_status) || "unknown"
    }`,
    note: `shell=${normalizeText(runtime.shell_url) || "n/a"} · port=${
      Number.isFinite(Number(runtime.server_port)) ? Number(runtime.server_port) : "n/a"
    }`,
    status: normalizeText(runtime.pairing_status) || "pending",
  });

  const machineCard = queueCard({
    title: normalizeText(machine.machine_id) || "single-machine",
    subtitle: `status=${normalizeText(machine.status) || "unknown"} · sample_topic_ready=${
      machine.sample_topic_ready ? "yes" : "no"
    }`,
    note: `sample_topic_agent_count=${Number(machine.sample_topic_agent_count || 0)}`,
    status: normalizeText(machine.status) || "idle",
  });

  dom.runtimeMachineList.append(runtimeCard, machineCard);
}

function renderAgentRegistry(operatorConsole, payload) {
  dom.agentRegistryList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.agentRegistryList.textContent = "Agent registry unavailable.";
    return;
  }
  const agents = Array.isArray(operatorConsole.agents) ? operatorConsole.agents : [];
  if (agents.length === 0) {
    dom.agentRegistryList.textContent = "No agents registered.";
  } else {
    for (const agent of agents) {
      const actorId = normalizeText(agent.actor_id);
      if (!actorId) {
        continue;
      }
      const role = normalizeText(agent.role) || "worker";
      const status = normalizeText(agent.status) || "unknown";
      const laneId = normalizeText(agent.lane_id) || "unassigned";
      const note = agent.last_seen_at ? `last_seen=${formatTime(agent.last_seen_at)}` : "last_seen=n/a";
      const card = queueCard({
        title: actorId,
        subtitle: `role=${role} · status=${status} · lane=${laneId}`,
        note,
        status,
      });
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      actions.append(
        queueAction("Set active", async () => {
          await upsertAgent(actorId, role, "active", normalizeText(agent.lane_id) || null);
        }),
        queueAction("Set blocked", async () => {
          await upsertAgent(actorId, role, "blocked", normalizeText(agent.lane_id) || null);
        }),
        queueAction("Edit lane", async () => {
          const laneInput = window.prompt("Lane ID", normalizeText(agent.lane_id) || "");
          if (laneInput === null) {
            return;
          }
          const updatedLaneId = normalizeText(laneInput) || null;
          await upsertAgent(actorId, role, status, updatedLaneId);
        }),
      );
      card.append(actions);
      dom.agentRegistryList.append(card);
    }
  }

  const registrationCard = queueCard({
    title: "Register Agent",
    subtitle: "Add a new agent to current topic",
    note: "Single operator entry only",
    status: "pending",
  });
  const registrationActions = document.createElement("div");
  registrationActions.className = "queue-actions";
  registrationActions.append(
    queueAction("Add agent", async () => {
      const actorIdInput = window.prompt("Actor ID", "");
      if (actorIdInput === null) {
        return;
      }
      const actorId = normalizeText(actorIdInput);
      if (!actorId) {
        throw new Error("actor_id is required");
      }
      const roleInput = window.prompt("Role (lead/worker/human/system)", "worker");
      if (roleInput === null) {
        return;
      }
      const role = normalizeText(roleInput);
      if (!role) {
        throw new Error("role is required");
      }
      const laneInput = window.prompt("Lane ID (optional)", "");
      if (laneInput === null) {
        return;
      }
      const laneId = normalizeText(laneInput) || null;
      await upsertAgent(actorId, role, "active", laneId);
    }),
  );
  registrationCard.append(registrationActions);
  dom.agentRegistryList.append(registrationCard);
}

async function upsertAgent(actorId, role, status, laneId) {
  await requestJson(ENDPOINTS.operatorAgentUpsert(actorId), {
    method: "POST",
    body: {
      role,
      status,
      lane_id: laneId,
    },
  });
  await loadAndRender();
}

function renderAssignmentRecovery(operatorConsole, payload) {
  dom.assignmentRecoveryList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.assignmentRecoveryList.textContent = "Assignment and recovery state unavailable.";
    return;
  }

  const scopeDefaults = resolveOperatorScopeFromState(operatorConsole, payload);
  const runtimeAgents = Array.isArray(operatorConsole.runtime_agents) ? operatorConsole.runtime_agents : [];
  const runtimeAgentById = new Map();
  for (const runtimeAgent of runtimeAgents) {
    const runtimeAgentId = normalizeText(runtimeAgent.agent_id);
    if (runtimeAgentId) {
      runtimeAgentById.set(runtimeAgentId, runtimeAgent);
    }
  }
  const assignments = Array.isArray(operatorConsole.work_assignments) ? operatorConsole.work_assignments : [];
  const sourceItems =
    assignments.length > 0
      ? assignments
      : runtimeAgents.map((runtimeAgent) => ({
          agent_id: runtimeAgent.agent_id,
          assigned_channel_id: runtimeAgent.assigned_channel_id,
          assigned_thread_id: runtimeAgent.assigned_thread_id,
          assigned_workitem_id: runtimeAgent.assigned_workitem_id,
          status: runtimeAgent.status,
          runtime_agent_status: runtimeAgent.status,
        }));

  if (sourceItems.length === 0) {
    dom.assignmentRecoveryList.textContent = "No runtime agents available for assignment.";
    return;
  }

  for (const assignment of sourceItems) {
    const agentId = normalizeText(assignment.agent_id);
    if (!agentId) {
      continue;
    }
    const runtimeAgent = runtimeAgentById.get(agentId) || {};
    const assignedChannel = normalizeText(assignment.assigned_channel_id) || "unassigned";
    const assignedThread = normalizeText(assignment.assigned_thread_id) || "n/a";
    const assignedWorkitem = normalizeText(assignment.assigned_workitem_id) || "n/a";
    const status = normalizeText(assignment.status || assignment.runtime_agent_status || runtimeAgent.status) || "unknown";
    const liveness = normalizeText(runtimeAgent.liveness) || "unknown";
    const duty = normalizeText(assignment.default_duty) || "n/a";
    const card = queueCard({
      title: agentId,
      subtitle: `${assignedChannel} · ${assignedThread} · ${assignedWorkitem}`,
      note: `status=${status} · duty=${duty} · liveness=${liveness}`,
      status,
    });
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    actions.append(
      queueAction("Assign", async () => {
        const channelInput = window.prompt("Channel ID", assignedChannel === "unassigned" ? scopeDefaults.channelId : assignedChannel);
        if (channelInput === null) {
          return;
        }
        const channelId = normalizeText(channelInput);
        if (!channelId) {
          throw new Error("channel_id is required");
        }
        const threadInput = window.prompt("Thread ID", assignedThread === "n/a" ? scopeDefaults.threadId : assignedThread);
        if (threadInput === null) {
          return;
        }
        const workitemInput = window.prompt(
          "Workitem ID",
          assignedWorkitem === "n/a" ? scopeDefaults.workitemId : assignedWorkitem,
        );
        if (workitemInput === null) {
          return;
        }
        await requestJson(ENDPOINTS.operatorAgentAssignment(agentId), {
          method: "POST",
          body: {
            operator: scopeDefaults.operatorId,
            channel_id: channelId,
            thread_id: normalizeText(threadInput) || null,
            workitem_id: normalizeText(workitemInput) || null,
            note: "assignment from operator console",
          },
        });
        await loadAndRender();
      }),
      queueAction("Resume", async () => {
        await requestJson(ENDPOINTS.operatorAgentRecoveryAction(agentId), {
          method: "POST",
          body: {
            action: "resume",
            operator: scopeDefaults.operatorId,
            channel_id: normalizeText(assignment.assigned_channel_id) || scopeDefaults.channelId,
            thread_id: normalizeText(assignment.assigned_thread_id) || scopeDefaults.threadId || null,
            workitem_id: normalizeText(assignment.assigned_workitem_id) || scopeDefaults.workitemId || null,
            status: "running",
            reason: "operator_resume_from_console",
          },
        });
        await loadAndRender();
      }),
      queueAction("Rebind", async () => {
        const threadInput = window.prompt(
          "New thread ID",
          normalizeText(assignment.assigned_thread_id) || scopeDefaults.threadId,
        );
        if (threadInput === null) {
          return;
        }
        const workitemInput = window.prompt(
          "New workitem ID",
          normalizeText(assignment.assigned_workitem_id) || scopeDefaults.workitemId,
        );
        if (workitemInput === null) {
          return;
        }
        await requestJson(ENDPOINTS.operatorAgentRecoveryAction(agentId), {
          method: "POST",
          body: {
            action: "rebind",
            operator: scopeDefaults.operatorId,
            channel_id: normalizeText(assignment.assigned_channel_id) || scopeDefaults.channelId,
            thread_id: normalizeText(threadInput) || null,
            workitem_id: normalizeText(workitemInput) || null,
            reason: "operator_rebind_from_console",
          },
        });
        await loadAndRender();
      }),
      queueAction("Reclaim worktree", async () => {
        const claimInput = window.prompt("Claim key", "");
        if (claimInput === null) {
          return;
        }
        const claimKey = normalizeText(claimInput);
        if (!claimKey) {
          throw new Error("claim_key is required");
        }
        await requestJson(ENDPOINTS.operatorAgentRecoveryAction(agentId), {
          method: "POST",
          body: {
            action: "reclaim_worktree",
            operator: scopeDefaults.operatorId,
            channel_id: normalizeText(assignment.assigned_channel_id) || scopeDefaults.channelId,
            thread_id: normalizeText(assignment.assigned_thread_id) || scopeDefaults.threadId || null,
            workitem_id: normalizeText(assignment.assigned_workitem_id) || scopeDefaults.workitemId || null,
            claim_key: claimKey,
            reason: "operator_reclaim_from_console",
          },
        });
        await loadAndRender();
      }),
    );
    card.append(actions);
    dom.assignmentRecoveryList.append(card);
  }
}

function renderOperatorActionLoop(operatorConsole, payload) {
  dom.operatorActionList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.operatorActionList.textContent = "Operator action loop unavailable.";
    return;
  }

  const scopeDefaults = resolveOperatorScopeFromState(operatorConsole, payload);
  const loopCard = queueCard({
    title: "Action Loop",
    subtitle: `${scopeDefaults.channelId || "unbound_channel"} · ${scopeDefaults.threadId || "n/a"} · ${
      scopeDefaults.workitemId || "n/a"
    }`,
    note: "Actions are written through stable channel operator-action contract",
    status: "active",
  });
  const actions = document.createElement("div");
  actions.className = "queue-actions";
  actions.append(
    queueAction("Request report", async () => {
      const runInput = window.prompt("Run ID", "");
      if (runInput === null) {
        return;
      }
      const agentInput = window.prompt("Agent ID (optional)", "");
      if (agentInput === null) {
        return;
      }
      await sendOperatorAction(scopeDefaults, "request_report", {
        run_id: normalizeText(runInput) || null,
        agent_id: normalizeText(agentInput) || null,
        note: "request report from operator console",
      });
    }),
    queueAction("Follow up", async () => {
      await sendOperatorAction(scopeDefaults, "follow_up", {
        note: "follow-up from operator console",
      });
    }),
    queueAction("Intervention", async () => {
      await sendOperatorAction(scopeDefaults, "intervention", {
        note: "manual intervention from operator console",
      });
    }),
    queueAction("Recovery note", async () => {
      await sendOperatorAction(scopeDefaults, "recovery", {
        note: "recovery recorded from operator console",
      });
    }),
  );
  loopCard.append(actions);
  dom.operatorActionList.append(loopCard);

  const operatorActions = Array.isArray(operatorConsole.operator_actions) ? operatorConsole.operator_actions : [];
  if (operatorActions.length === 0) {
    dom.operatorActionList.append(
      queueCard({
        title: "No operator actions",
        subtitle: "channel operator-action projection",
        note: "No action recorded yet.",
        status: "idle",
      }),
    );
    return;
  }
  for (const item of operatorActions.slice(0, 8)) {
    const scope = [
      normalizeText(item.agent_id) || "n/a",
      normalizeText(item.thread_id) || "n/a",
      normalizeText(item.workitem_id) || "n/a",
    ].join(" · ");
    const card = queueCard({
      title: normalizeText(item.action_type) || "action",
      subtitle: `${scope} · operator=${normalizeText(item.operator_id) || "unknown"}`,
      note: `${normalizeText(item.note) || "no note"} · ${item.at ? formatTime(item.at) : "n/a"}`,
      status: normalizeText(item.status) || "accepted",
    });
    dom.operatorActionList.append(card);
  }
}

async function sendOperatorAction(scopeDefaults, action, extraBody = {}) {
  await requestJson(ENDPOINTS.operatorAction, {
    method: "POST",
    body: {
      action_type: action,
      operator: scopeDefaults.operatorId,
      channel_id: scopeDefaults.channelId || null,
      thread_id: scopeDefaults.threadId || null,
      workitem_id: scopeDefaults.workitemId || null,
      ...extraBody,
    },
  });
  await loadAndRender();
}

function renderRecentActions(operatorConsole) {
  dom.recentActionList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.recentActionList.textContent = "Recent actions unavailable.";
    return;
  }
  const entries = Array.isArray(operatorConsole.recent_actions) ? operatorConsole.recent_actions : [];
  if (entries.length === 0) {
    dom.recentActionList.textContent = "No recent actions yet.";
    return;
  }
  for (const entry of entries) {
    const scope = entry.operator_scope || {};
    const scopeText = [
      normalizeText(scope.agent_id) || "n/a",
      normalizeText(scope.thread_id) || "n/a",
      normalizeText(scope.workitem_id) || "n/a",
    ].join(" · ");
    const card = queueCard({
      title: normalizeText(entry.action) || "action",
      subtitle: `${normalizeText(entry.action_family) || "unknown"} · ${normalizeText(entry.target) || "target"}`,
      note: `${scopeText} · ${entry.at ? formatTime(entry.at) : "n/a"}`,
      status: normalizeText(entry.action_family) || "idle",
    });
    dom.recentActionList.append(card);
  }
}

function resolveOperatorScopeFromState(operatorConsole, payload) {
  const workspace = operatorConsole?.workspace || {};
  const workAssignments = Array.isArray(operatorConsole?.work_assignments) ? operatorConsole.work_assignments : [];
  const primaryAssignment = workAssignments[0] || {};
  const runtimeAgents = Array.isArray(operatorConsole?.runtime_agents) ? operatorConsole.runtime_agents : [];
  const primaryRuntimeAgent = runtimeAgents[0] || {};
  const topic = Array.isArray(payload?.topics) && payload.topics.length > 0 ? payload.topics[0] : null;
  return {
    topicId: normalizeText(workspace.default_topic_id) || normalizeText(topic?.id) || "",
    operatorId: normalizeText(workspace.operator_id) || "shell-operator",
    channelId:
      normalizeText(operatorConsole?.channel?.channel_id) ||
      normalizeText(primaryAssignment.assigned_channel_id) ||
      normalizeText(primaryRuntimeAgent.assigned_channel_id) ||
      "",
    threadId: normalizeText(primaryAssignment.assigned_thread_id) || normalizeText(primaryRuntimeAgent.assigned_thread_id) || "",
    workitemId:
      normalizeText(primaryAssignment.assigned_workitem_id) || normalizeText(primaryRuntimeAgent.assigned_workitem_id) || "",
  };
}

function renderAuditEntries(operatorConsole) {
  dom.auditEntryList.replaceChildren();
  if (!operatorConsole || typeof operatorConsole !== "object") {
    dom.auditEntryList.textContent = "Audit trail unavailable.";
    return;
  }
  const entries = Array.isArray(operatorConsole.audit_entries) ? operatorConsole.audit_entries : [];
  if (entries.length === 0) {
    dom.auditEntryList.textContent = "No audit entries yet.";
    return;
  }
  for (const entry of entries) {
    const target = normalizeText(entry.target) || "topic";
    const actor = normalizeText(entry.actor_id) || "unknown_actor";
    const reason = normalizeText(entry.reason_code) || "none";
    const at = entry.at ? formatTime(entry.at) : "n/a";
    const card = queueCard({
      title: normalizeText(entry.action) || "unknown_action",
      subtitle: `${target} · actor=${actor} · result=${normalizeText(entry.result_state) || "unknown"}`,
      note: `reason=${reason} · at=${at} · source=${normalizeText(entry.source) || "projection"}`,
      status: normalizeText(entry.result_state) || "idle",
    });
    dom.auditEntryList.append(card);
  }
}

function renderEvents(events) {
  dom.eventFeed.replaceChildren();
  for (const event of events) {
    const row = document.createElement("li");
    row.className = event.severity;
    row.textContent = `${formatTime(event.at)} · ${event.topicId} · ${event.message}`;
    dom.eventFeed.append(row);
  }
}

function formatStage4a2NotificationEndpoints(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "no notification endpoints projected";
  }
  return raw
    .slice(0, 6)
    .map((item) => {
      const channel = normalizeText(item?.channel) || "unknown";
      const enabled = item?.enabled === false ? "disabled" : "enabled";
      const target = normalizeText(item?.target);
      return `${channel}:${enabled}${target ? `(${target})` : ""}`;
    })
    .join(" · ");
}

function formatStage4a2RoutingRules(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "no routing rules projected";
  }
  return raw
    .slice(0, 6)
    .map((item) => {
      const channel = normalizeText(item?.channel) || "unknown";
      const enabled = item?.enabled === false ? "off" : "on";
      const events = Array.isArray(item?.events) ? item.events : [];
      const delivery = normalizeText(item?.delivery);
      return `${channel}:${enabled}${delivery ? `/${delivery}` : ""}[${events.slice(0, 4).join(",")}]`;
    })
    .join(" · ");
}

function formatStage4a2ApprovalContract(raw) {
  if (!raw || typeof raw !== "object") {
    return "approval contract pending";
  }
  const source = normalizeText(raw.source) || "v1_approval_hold_truth";
  const triggers = Array.isArray(raw.trigger_events) ? raw.trigger_events : [];
  return `source=${source} · triggers=${triggers.slice(0, 4).join(",") || "n/a"}`;
}

function formatStage4a2AuditAnchor(raw) {
  if (!raw || typeof raw !== "object") {
    return "approval audit anchor pending";
  }
  const action = normalizeText(raw.action) || "unknown_action";
  const auditId = normalizeText(raw.audit_id) || "n/a";
  const at = raw.at ? formatTime(raw.at) : "n/a";
  return `audit=${auditId} · action=${action} · at=${at}`;
}

function formatStage4a2SandboxProfile(raw) {
  if (!raw || typeof raw !== "object") {
    return "sandbox profile pending";
  }
  const profileId = normalizeText(raw.profile_id) || "unknown_profile";
  const mode = normalizeText(raw.mode) || "restricted_local";
  const secretClasses = Array.isArray(raw.allowed_secret_classes) ? raw.allowed_secret_classes : [];
  return `profile=${profileId} · mode=${mode} · secret_classes=${secretClasses.join(",") || "n/a"}`;
}

function formatStage4a2SecretsBindings(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "secrets bindings pending";
  }
  return raw
    .slice(0, 6)
    .map((item) => {
      const secretClass = normalizeText(item?.secret_class) || "unknown";
      const status = normalizeText(item?.status) || "bound";
      const injectionMode = normalizeText(item?.injection_mode);
      return `${secretClass}:${status}${injectionMode ? `(${injectionMode})` : ""}`;
    })
    .join(" · ");
}

function formatStage4a2Enforcement(raw) {
  if (!raw || typeof raw !== "object") {
    return "no enforcement evidence projected";
  }
  const profile = normalizeText(raw.sandbox_profile) || "n/a";
  const secretRefs = Number(raw.secret_ref_count || 0);
  const approvalRequired = raw.approval_required === true ? "yes" : "no";
  const approvalId = normalizeText(raw.approval_id) || "n/a";
  return `enforcement profile=${profile} · secret_refs=${secretRefs} · approval_required=${approvalRequired} · approval_id=${approvalId}`;
}

function formatStage4bProvider(raw) {
  if (!raw || typeof raw !== "object") {
    return "external memory provider pending";
  }
  const providerId = normalizeText(raw.provider_id) || "n/a";
  const providerType = normalizeText(raw.provider_type) || "n/a";
  const status = normalizeText(raw.status) || "unknown";
  const readScopes = Array.isArray(raw.read_scopes) ? raw.read_scopes : [];
  const writeScopes = Array.isArray(raw.write_scopes) ? raw.write_scopes : [];
  return `provider=${providerType}#${providerId}:${status} · read=[${readScopes.join(",") || "n/a"}] · write=[${
    writeScopes.join(",") || "n/a"
  }]`;
}

function formatStage4bProviderAnchors(raw) {
  if (!raw || typeof raw !== "object") {
    return "provider anchors pending";
  }
  const memorySearch = normalizeText(raw.memory_search) || "n/a";
  const memoryWrite = normalizeText(raw.memory_write) || "n/a";
  const memoryForget = normalizeText(raw.memory_forget) || "n/a";
  return `anchors search=${memorySearch} · write=${memoryWrite} · forget=${memoryForget}`;
}

function formatStage4bMemoryViewer(raw) {
  if (!raw || typeof raw !== "object") {
    return "memory viewer pending";
  }
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const totalEntries = Number(summary.total_entries || 0);
  const activeEntries = Number(summary.active_entries || 0);
  const forgottenEntries = Number(summary.forgotten_entries || 0);
  return `summary total=${totalEntries} · active=${activeEntries} · forgotten=${forgottenEntries}`;
}

function formatStage4bMemoryItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "no memory entries projected";
  }
  return raw
    .slice(0, 4)
    .map((item) => {
      const memoryId = normalizeText(item?.memory_id) || "memory";
      const scope = normalizeText(item?.scope) || "scope";
      const status = normalizeText(item?.status) || "unknown";
      return `${scope}/${memoryId}:${status}`;
    })
    .join(" · ");
}

function formatStage4bSkillPolicyPlugin(raw) {
  if (!raw || typeof raw !== "object") {
    return "skill/policy/plugin governance pending";
  }
  const enabled = raw.enabled === false ? "disabled" : "enabled";
  const scope = normalizeText(raw.scope) || "channel";
  const registry = raw.registry && typeof raw.registry === "object" ? raw.registry : {};
  const bindings = Array.isArray(raw.bindings) ? raw.bindings : [];
  const skillCount = Array.isArray(registry.skill_refs) ? registry.skill_refs.length : 0;
  const policyCount = Array.isArray(registry.policy_refs) ? registry.policy_refs.length : 0;
  const pluginCount = Array.isArray(registry.plugin_refs) ? registry.plugin_refs.length : 0;
  return `mode=${enabled} · scope=${scope} · skill=${skillCount} · policy=${policyCount} · plugin=${pluginCount} · bindings=${bindings.length}`;
}

function formatStage4bAuditAnchor(raw) {
  if (!raw || typeof raw !== "object") {
    return "audit anchor pending";
  }
  const action = normalizeText(raw.action) || "unknown_action";
  const auditId = normalizeText(raw.audit_id) || "n/a";
  const at = raw.at ? formatTime(raw.at) : "n/a";
  return `audit=${auditId} · action=${action} · at=${at}`;
}

function formatStage4bTokenQuotaContext(raw) {
  if (!raw || typeof raw !== "object") {
    return "token/quota/context pending";
  }
  const tokenUsed = Number(raw.token_used || 0);
  const tokenLimit = raw.token_limit === null || raw.token_limit === undefined ? "n/a" : Number(raw.token_limit);
  const quotaState = normalizeText(raw.quota_state) || "unknown";
  const contextTokens = Number(raw.context_tokens || 0);
  const windowTokens =
    raw.context_window_tokens === null || raw.context_window_tokens === undefined
      ? "n/a"
      : Number(raw.context_window_tokens);
  const recallSource = normalizeText(raw.recall_source) || "n/a";
  const recallHits = Number(raw.recall_hits || 0);
  const degradeReason = normalizeText(raw.degrade_reason) || "none";
  return (
    `token=${tokenUsed}/${tokenLimit} · quota=${quotaState} · context=${contextTokens}/${windowTokens} · ` +
    `recall=${recallSource}:${recallHits} · degrade=${degradeReason}`
  );
}

function formatStage4bTimeline(raw) {
  if (!raw || typeof raw !== "object") {
    return "timeline evidence pending";
  }
  const total = Number(raw.total || 0);
  const actions = Array.isArray(raw.recent_actions) ? raw.recent_actions : [];
  if (total === 0 || actions.length === 0) {
    return "no stage4b timeline evidence projected";
  }
  const summary = actions
    .slice(0, 4)
    .map((item) => normalizeText(item?.action) || "unknown_action")
    .join(",");
  const anchor = normalizeText(raw.anchor) || "n/a";
  return `timeline total=${total} · latest=${summary} · anchor=${anchor}`;
}

function formatStage4cDigitalTwin(raw) {
  if (!raw || typeof raw !== "object") {
    return "digital twin pending";
  }
  const twinId = normalizeText(raw.twin_id) || "n/a";
  const agentId = normalizeText(raw.agent_id) || "n/a";
  const mode = normalizeText(raw.mode) || "n/a";
  const status = normalizeText(raw.status) || "n/a";
  const memoryScope = normalizeText(raw.memory_scope) || "n/a";
  return `twin=${twinId} · agent=${agentId} · mode=${mode} · status=${status} · memory_scope=${memoryScope}`;
}

function formatStage4cOperationalCapability(raw) {
  if (!raw || typeof raw !== "object") {
    return "operational capability pending";
  }
  const enabled = raw.enabled === false ? "off" : "on";
  const capabilityLevel = normalizeText(raw.capability_level) || "n/a";
  const operationModes = Array.isArray(raw.operation_modes) ? raw.operation_modes : [];
  const escalation = raw.human_escalation_required === true ? "required" : "optional";
  return `mode=${enabled} · level=${capabilityLevel} · operation_modes=${operationModes.join(",") || "n/a"} · escalation=${escalation}`;
}

function formatStage4cOrchestration(raw) {
  if (!raw || typeof raw !== "object") {
    return "orchestration pending";
  }
  const orchestrationId = normalizeText(raw.orchestration_id) || "n/a";
  const mode = normalizeText(raw.mode) || "n/a";
  const status = normalizeText(raw.status) || "n/a";
  const planRef = normalizeText(raw.plan_ref) || "n/a";
  const participants = Array.isArray(raw.participant_agent_ids) ? raw.participant_agent_ids : [];
  const edges = Array.isArray(raw.dependency_edges) ? raw.dependency_edges : [];
  return `orchestration=${orchestrationId} · mode=${mode}/${status} · plan=${planRef} · participants=${participants.length} · edges=${edges.length}`;
}

function formatStage4cUpgrade(raw) {
  if (!raw || typeof raw !== "object") {
    return "upgrade governance pending";
  }
  const arbitration = raw.arbitration && typeof raw.arbitration === "object" ? raw.arbitration : null;
  const humanChain = raw.human_upgrade_chain && typeof raw.human_upgrade_chain === "object" ? raw.human_upgrade_chain : {};
  if (!arbitration) {
    return "upgrade arbitration pending";
  }
  const arbitrationId = normalizeText(arbitration.arbitration_id) || "n/a";
  const status = normalizeText(arbitration.status) || "n/a";
  const selectedPath = normalizeText(arbitration.selected_path_id) || "n/a";
  const candidatePaths = Array.isArray(arbitration.candidate_paths) ? arbitration.candidate_paths : [];
  const chainStatus = normalizeText(humanChain.status) || "n/a";
  const approval = humanChain.approval_required === true ? "required" : "optional";
  return `arbitration=${arbitrationId}:${status} · selected_path=${selectedPath} · candidates=${candidatePaths.length} · human_chain=${chainStatus}/${approval}`;
}

function formatStage4cEscalation(raw) {
  if (!raw || typeof raw !== "object") {
    return "no human escalation evidence projected";
  }
  const actionType = normalizeText(raw.action_type) || "unknown_action";
  const approvalId = normalizeText(raw.approval_id) || "n/a";
  const at = raw.at ? formatTime(raw.at) : "n/a";
  return `latest_escalation=${actionType} · approval_id=${approvalId} · at=${at}`;
}

function formatStage4cTimeline(raw) {
  if (!raw || typeof raw !== "object") {
    return "timeline evidence pending";
  }
  const total = Number(raw.total || 0);
  const actions = Array.isArray(raw.recent_actions) ? raw.recent_actions : [];
  if (total === 0 || actions.length === 0) {
    return "no stage4c timeline evidence projected";
  }
  const summary = actions
    .slice(0, 4)
    .map((item) => normalizeText(item?.action) || "unknown_action")
    .join(",");
  const anchor = normalizeText(raw.anchor) || "n/a";
  const operatorAnchor = normalizeText(raw.operator_actions_anchor) || "n/a";
  return `timeline total=${total} · latest=${summary} · recent=${anchor} · operator=${operatorAnchor}`;
}

function formatStage4a2UsageNotes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "usage notes pending";
  }
  return raw.slice(0, 6).join(" · ");
}

function formatStage5aHostedAccess(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted access pending";
  }
  const entryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const nonLocal = raw.non_local_access === true ? "yes" : "no";
  const loginState = normalizeText(raw.login_state) || "pending";
  const channelId = normalizeText(raw.channel_id) || "unbound_channel";
  return `entry=${entryUrl} · non_local=${nonLocal} · login=${loginState} · channel=${channelId}`;
}

function formatStage5aHostedWorkbench(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted workbench pending";
  }
  const home = raw.home && typeof raw.home === "object" ? raw.home : {};
  const inbox = raw.unified_inbox && typeof raw.unified_inbox === "object" ? raw.unified_inbox : {};
  const flow = raw.default_flow && typeof raw.default_flow === "object" ? raw.default_flow : {};
  return (
    `home=${normalizeText(home.hosted_home_url) || "n/a"} · ` +
    `inbox approvals=${Number(inbox.pending_approvals || 0)} notifications=${Number(
      inbox.notification_signals?.total || 0,
    )} interventions=${Number(inbox.intervention_actions || 0)} · ` +
    `flow=${normalizeText(flow.channel_id) || "n/a"}/${normalizeText(flow.thread_id) || "n/a"}/${normalizeText(
      flow.task_id,
    ) || "n/a"}`
  );
}

function formatStage5aDeployRuntime(raw) {
  if (!raw || typeof raw !== "object") {
    return "deploy runtime pending";
  }
  const runtimeName = normalizeText(raw.runtime_name) || "runtime";
  const daemonName = normalizeText(raw.daemon_name) || "daemon";
  const shellUrl = normalizeText(raw.shell_url) || "n/a";
  const ready = raw.sample_topic_ready === true ? "ready" : "pending";
  return `runtime=${runtimeName} · daemon=${daemonName} · shell=${shellUrl} · readiness=${ready}`;
}

function formatStage5aDeliveryContract(raw) {
  if (!raw || typeof raw !== "object") {
    return "delivery contract pending";
  }
  const localRoot = normalizeText(raw.local_entry_root) || "n/a";
  const hostedEntry = normalizeText(raw.hosted_entry_url) || "n/a";
  const adapterEntry = normalizeText(raw.adapter_entry) || "/api/v0a/shell-state";
  const singlePath = raw.single_delivery_path === true ? "yes" : "no";
  return `local=${localRoot} · hosted=${hostedEntry} · adapter=${adapterEntry} · single_path=${singlePath}`;
}

function formatStage5bHostedWorkbench(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted multi-human workbench pending";
  }
  const hostedHomeUrl = normalizeText(raw.hosted_home_url) || normalizeText(raw.hosted_web_url) || "n/a";
  const channelId = normalizeText(raw.channel_id) || "unbound_channel";
  const source = normalizeText(raw.source) || "channel_context_projection";
  return `home=${hostedHomeUrl} · channel=${channelId} · source=${source}`;
}

function formatStage5bDefaultFlow(raw) {
  if (!raw || typeof raw !== "object") {
    return "default flow pending";
  }
  const topicId = normalizeText(raw.topic_id) || "n/a";
  const channelId = normalizeText(raw.channel_id) || "n/a";
  const threadId = normalizeText(raw.thread_id) || "n/a";
  const taskId = normalizeText(raw.task_id) || "n/a";
  const source = normalizeText(raw.assignment_source) || "channel_projection";
  const agentCount = Number(raw.assigned_agents_count || 0);
  return `flow=${topicId}/${channelId}/${threadId}/${taskId} · assigned_agents=${agentCount} · source=${source}`;
}

function formatStage5bUnifiedInbox(raw) {
  if (!raw || typeof raw !== "object") {
    return "unified inbox pending";
  }
  const actorId = normalizeText(raw.actor_id) || "n/a";
  const topicId = normalizeText(raw.topic_id) || "n/a";
  const total = Number(raw.total_items || 0);
  const pending = Number(raw.pending_items || 0);
  const acked = Number(raw.acked_items || 0);
  return `actor=${actorId} · topic=${topicId} · total=${total} · pending=${pending} · acked=${acked}`;
}

function formatStage5bAttentionRouting(raw) {
  if (!raw || typeof raw !== "object") {
    return "attention routing pending";
  }
  const approvals = Number(raw.pending_approval_holds || 0);
  const conflicts = Number(raw.unresolved_conflicts || 0);
  const blockers = Number(raw.active_blockers || 0);
  const required = Number(raw.attention_required_total || approvals + conflicts + blockers);
  return `approvals=${approvals} · conflicts=${conflicts} · blockers=${blockers} · attention_required=${required}`;
}

function formatStage5cHostedRuntimeEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted runtime entry pending";
  }
  const hostedEntryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const channelId = normalizeText(raw.channel_id) || "unbound_channel";
  const source = normalizeText(raw.source) || "runtime_projection";
  const hostedAccessStatus = normalizeText(raw.hosted_access_status) || "pending";
  return `entry=${hostedEntryUrl} · channel=${channelId} · hosted=${hostedAccessStatus} · source=${source}`;
}

function formatStage5cRemotePairing(raw) {
  if (!raw || typeof raw !== "object") {
    return "remote daemon pairing pending";
  }
  const totalAgents = Number(raw.total_agents || 0);
  const pairedAgents = Number(raw.paired_agents || 0);
  const onlineAgents = Number(raw.online_agents || 0);
  const channelBoundAgents = Number(raw.channel_bound_agents || 0);
  const pendingIds = Array.isArray(raw.pending_pairing_agent_ids) ? raw.pending_pairing_agent_ids : [];
  return (
    `agents=${pairedAgents}/${totalAgents} paired · online=${onlineAgents} · channel_bound=${channelBoundAgents}` +
    (pendingIds.length > 0 ? ` · pending=${pendingIds.slice(0, 4).join(",")}` : "")
  );
}

function formatStage5cMachineFleet(raw) {
  if (!raw || typeof raw !== "object") {
    return "machine fleet pending";
  }
  const machineCount = Number(raw.machine_count || 0);
  const onlineMachineCount = Number(raw.online_machine_count || 0);
  const activeClaims = Number(raw.active_worktree_claim_count || 0);
  const reclaimedClaims = Number(raw.reclaimed_worktree_claim_count || 0);
  const totalAgents = Number(raw.total_runtime_agents || 0);
  return (
    `machines=${onlineMachineCount}/${machineCount} online · runtime_agents=${totalAgents} · ` +
    `claims active=${activeClaims} reclaimed=${reclaimedClaims}`
  );
}

function formatStage5cControlVisibility(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted control visibility pending";
  }
  const noShadowTruth = raw.no_shadow_truth === true ? "yes" : "no";
  const runtimeName = normalizeText(raw.runtime_name) || "runtime";
  const daemonName = normalizeText(raw.daemon_name) || "daemon";
  const sampleReady = raw.sample_topic_ready === true ? "yes" : "no";
  return `runtime=${runtimeName} · daemon=${daemonName} · sample_topic_ready=${sampleReady} · no_shadow_truth=${noShadowTruth}`;
}

function formatStage5cDeployRuntime(raw) {
  if (!raw || typeof raw !== "object") {
    return "deploy runtime pending";
  }
  const deploymentStatus = normalizeText(raw.deployment_status) || "not_deployed";
  const runtimeVersion = normalizeText(raw.runtime_version) || "n/a";
  const targetRef = normalizeText(raw.target_ref) || "n/a";
  const releaseChannel = normalizeText(raw.release_channel) || "n/a";
  return `deploy=${deploymentStatus} · version=${runtimeVersion} · target=${targetRef} · channel=${releaseChannel}`;
}

function formatStage5cHealthReadiness(raw) {
  if (!raw || typeof raw !== "object") {
    return "health/readiness pending";
  }
  const healthStatus = normalizeText(raw.health_status) || "unknown";
  const readinessStatus = normalizeText(raw.readiness_status) || "not_ready";
  const checkRef = normalizeText(raw.check_ref) || "n/a";
  return `health=${healthStatus} · readiness=${readinessStatus} · check_ref=${checkRef}`;
}

function formatStage5cReleaseRecoveryUpgradeHandoff(raw) {
  if (!raw || typeof raw !== "object") {
    return "release/recovery/upgrade/handoff pending";
  }
  const lifecycleStatus = normalizeText(raw.lifecycle_status) || "draft";
  const releaseRef = normalizeText(raw.release_ref) || "n/a";
  const recoveryRef = normalizeText(raw.recovery_ref) || "n/a";
  const upgradeRef = normalizeText(raw.upgrade_ref) || "n/a";
  const handoffRef = normalizeText(raw.handoff_ref) || "n/a";
  const latestRecoveryAction = raw.latest_recovery_action && typeof raw.latest_recovery_action === "object"
    ? raw.latest_recovery_action
    : null;
  const actionSummary = latestRecoveryAction
    ? `${normalizeText(latestRecoveryAction.action) || "action"}:${normalizeText(latestRecoveryAction.status) || "unknown"}`
    : "none";
  return (
    `lifecycle=${lifecycleStatus} · release=${releaseRef} · recovery=${recoveryRef} · ` +
    `upgrade=${upgradeRef} · handoff=${handoffRef} · latest_recovery_action=${actionSummary}`
  );
}

function formatStage6aHostedOnboardingAccess(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted onboarding access pending";
  }
  const entryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const hostedStatus = normalizeText(raw.hosted_access_status) || "pending";
  const source = normalizeText(raw.source) || "stage5_truth_fan_in";
  return `entry=${entryUrl} · hosted=${hostedStatus} · source=${source}`;
}

function formatStage6aInviteVerifyJoin(raw) {
  if (!raw || typeof raw !== "object") {
    return "invite/verify/join pending";
  }
  const invited = Number(raw.invited_member_count || 0);
  const verified = Number(raw.verified_identity_count || 0);
  const joined = Number(raw.joined_member_count || 0);
  return `invited=${invited} · verified=${verified} · joined=${joined}`;
}

function formatStage6aGithubInstallRepoBinding(raw) {
  if (!raw || typeof raw !== "object") {
    return "github install/repo binding pending";
  }
  const installations = Number(raw.active_installation_count || 0);
  const repoBindings = Number(raw.active_repo_binding_count || 0);
  const installChain = normalizeText(raw.installation_chain_status) || "pending";
  const repoChain = normalizeText(raw.repo_binding_chain_status) || "pending";
  return `installations=${installations}(${installChain}) · repo_bindings=${repoBindings}(${repoChain})`;
}

function formatStage6aDeviceAuthorizationRuntimeAttach(raw) {
  if (!raw || typeof raw !== "object") {
    return "device authorization/runtime attach pending";
  }
  const pairing = normalizeText(raw.remote_daemon_pairing_status) || "pending";
  const fleet = normalizeText(raw.machine_fleet_status) || "pending";
  const control = normalizeText(raw.hosted_runtime_control_visibility_status) || "pending";
  return `pairing=${pairing} · fleet=${fleet} · control=${control}`;
}

function formatStage6aStage5WorkbenchHandoff(raw) {
  if (!raw || typeof raw !== "object") {
    return "stage5 workbench handoff pending";
  }
  const hostedWorkbenchUrl = normalizeText(raw.hosted_workbench_url) || "n/a";
  const topicId = normalizeText(raw.topic_id) || "n/a";
  const channelId = normalizeText(raw.channel_id) || "n/a";
  const threadId = normalizeText(raw.thread_id) || "n/a";
  const taskId = normalizeText(raw.task_id) || "n/a";
  return (
    `workbench=${hostedWorkbenchUrl} · topic=${topicId} · channel=${channelId} · ` +
    `thread=${threadId} · task=${taskId}`
  );
}

function formatStage6bHostedNotificationRecovery(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted notification/recovery pending";
  }
  const entryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const hostedStatus = normalizeText(raw.hosted_access_status) || "pending";
  const source = normalizeText(raw.source) || "stage6b_truth_fan_in";
  return `entry=${entryUrl} · hosted=${hostedStatus} · source=${source}`;
}

function formatStage6bNotificationDelivery(raw) {
  if (!raw || typeof raw !== "object") {
    return "notification delivery pending";
  }
  const inbox = normalizeText(raw.inbox_endpoint_status) || "disabled";
  const browserPush = normalizeText(raw.browser_push_endpoint_status) || "disabled";
  const email = normalizeText(raw.email_endpoint_status) || "disabled";
  const rules = Number(raw.routing_rule_count || 0);
  const endpoints = Number(raw.endpoint_count || 0);
  return `inbox=${inbox} · browser_push=${browserPush} · email=${email} · endpoints=${endpoints} · routing_rules=${rules}`;
}

function formatStage6bRecoveryRouting(raw) {
  if (!raw || typeof raw !== "object") {
    return "recovery routing pending";
  }
  const contractVersion = normalizeText(raw.contract_version) || "v1.stage6b";
  const blocked = Number(raw.blocked_signal_count || 0);
  const approval = Number(raw.approval_required_signal_count || 0);
  const prReady = Number(raw.pr_pending_review_signal_count || 0);
  const mailbox = normalizeText(raw.agent_mailbox_actor_id) || "n/a";
  const pending = Number(raw.agent_mailbox_pending_items || 0);
  const attention = Number(raw.attention_required_total || 0);
  const prRef = normalizeText(raw.pr_ready_mailbox_ref) || "/v1/topics/:topicId/prs";
  const mailboxRef = normalizeText(raw.agent_mailbox_ref) || "/v1/topics/:topicId/execution-inbox?actor_id=:actorId";
  return (
    `contract=${contractVersion} · blocked=${blocked} · approval_required=${approval} · pr_pending_review=${prReady} · ` +
    `mailbox=${mailbox} pending=${pending} attention=${attention} · pr_ref=${prRef} · mailbox_ref=${mailboxRef}`
  );
}

function formatStage6bHostedReentry(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted re-entry pending";
  }
  const recoveryUrl = normalizeText(raw.hosted_recovery_url) || "n/a";
  const channelId = normalizeText(raw.channel_id) || "n/a";
  const topicId = normalizeText(raw.topic_id) || "n/a";
  const threadId = normalizeText(raw.thread_id) || "n/a";
  const taskId = normalizeText(raw.task_id) || "n/a";
  const runAnchor = normalizeText(raw.run_timeline_anchor) || "n/a";
  const prSurface = normalizeText(raw.pr_reentry_surface) || "n/a";
  return (
    `recovery=${recoveryUrl} · room=${channelId}/${threadId}/${taskId} · topic=${topicId} · ` +
    `run=${runAnchor} · pr=${prSurface}`
  );
}

function formatStage6cHostedPlanQuota(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted plan/quota pending";
  }
  const entryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const hostedStatus = normalizeText(raw.hosted_access_status) || "pending";
  const source = normalizeText(raw.source) || "stage6c_truth_fan_in";
  return `entry=${entryUrl} · hosted=${hostedStatus} · source=${source}`;
}

function formatStage6cPlanSubscriptionLimit(raw) {
  if (!raw || typeof raw !== "object") {
    return "workspace plan/subscription/limit pending";
  }
  const planRef = normalizeText(raw.plan_ref) || "n/a";
  const subscriptionStatus = normalizeText(raw.subscription_status) || "pending";
  const limitStatus = normalizeText(raw.limit_status) || "pending";
  const tokenLimit = raw.token_limit === null || raw.token_limit === undefined ? "n/a" : Number(raw.token_limit);
  const tokenUsed = raw.token_used === null || raw.token_used === undefined ? "n/a" : Number(raw.token_used);
  const channelId = normalizeText(raw.channel_id) || "n/a";
  return (
    `plan=${planRef} · subscription=${subscriptionStatus} · limit=${limitStatus} · ` +
    `token=${tokenUsed}/${tokenLimit} · channel=${channelId}`
  );
}

function formatStage6cUsageQuotaReadiness(raw) {
  if (!raw || typeof raw !== "object") {
    return "usage/quota/readiness pending";
  }
  const usageStatus = normalizeText(raw.usage_status) || "pending";
  const quotaState = normalizeText(raw.quota_state) || "pending";
  const remaining =
    raw.remaining_capacity === null || raw.remaining_capacity === undefined ? "n/a" : Number(raw.remaining_capacity);
  const capacity =
    raw.capacity_limit === null || raw.capacity_limit === undefined ? "n/a" : Number(raw.capacity_limit);
  const blockReason = normalizeText(raw.block_reason) || "none";
  const upgradeReadiness = normalizeText(raw.upgrade_readiness) || "pending";
  const contextTokens = raw.context_tokens === null || raw.context_tokens === undefined ? "n/a" : Number(raw.context_tokens);
  const windowTokens =
    raw.context_window_tokens === null || raw.context_window_tokens === undefined
      ? "n/a"
      : Number(raw.context_window_tokens);
  return (
    `usage=${usageStatus} · quota=${quotaState} · remaining=${remaining}/${capacity} · ` +
    `block=${blockReason} · upgrade=${upgradeReadiness} · context=${contextTokens}/${windowTokens}`
  );
}

function formatStage6cTruthFamily(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "pending";
  }
  return raw.join(",");
}

function formatStage7aHostedBillingSubscription(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted billing/subscription pending";
  }
  const entryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const hostedStatus = normalizeText(raw.hosted_access_status) || "pending";
  const source = normalizeText(raw.source) || "stage7a_truth_fan_in";
  return `entry=${entryUrl} · hosted=${hostedStatus} · source=${source}`;
}

function formatStage7aCheckoutActivation(raw) {
  if (!raw || typeof raw !== "object") {
    return "checkout/payment/subscription activation pending";
  }
  const workspaceId = normalizeText(raw.workspace_id) || "n/a";
  const planRef = normalizeText(raw.plan_ref) || "n/a";
  const checkoutStatus = normalizeText(raw.checkout_status) || "pending";
  const paymentMethodStatus = normalizeText(raw.payment_method_status) || "pending";
  const activationStatus = normalizeText(raw.subscription_activation_status) || "pending";
  const checkoutUrl = normalizeText(raw.checkout_url) || "n/a";
  const paymentMethodRef = normalizeText(raw.payment_method_ref) || "n/a";
  return (
    `workspace=${workspaceId} · plan=${planRef} · checkout=${checkoutStatus} · ` +
    `payment_method=${paymentMethodStatus} · activation=${activationStatus} · ` +
    `checkout_url=${checkoutUrl} · method_ref=${paymentMethodRef}`
  );
}

function formatStage7aUpgradePlanManage(raw) {
  if (!raw || typeof raw !== "object") {
    return "upgrade CTA / plan manage pending";
  }
  const upgradeStatus = normalizeText(raw.upgrade_cta_status) || "pending";
  const planManageStatus = normalizeText(raw.plan_manage_status) || "pending";
  const upgradeRef = normalizeText(raw.upgrade_cta_ref) || "n/a";
  const planManageUrl = normalizeText(raw.plan_manage_url) || "n/a";
  const planRef = normalizeText(raw.plan_ref) || "n/a";
  const subscriptionStatus = normalizeText(raw.subscription_status) || "pending";
  const quotaState = normalizeText(raw.quota_state) || "pending";
  const remaining = formatStage7aRemainingCapacity(raw.remaining_capacity);
  const blockReason = normalizeText(raw.block_reason) || "none";
  return (
    `upgrade=${upgradeStatus} ref=${upgradeRef} · plan_manage=${planManageStatus} url=${planManageUrl} · ` +
    `plan=${planRef} subscription=${subscriptionStatus} · quota=${quotaState} remaining=${remaining} block=${blockReason}`
  );
}

function formatStage7aPaymentRecovery(raw) {
  if (!raw || typeof raw !== "object") {
    return "payment pending/failed recovery pending";
  }
  const renewal = normalizeText(raw.renewal_status) || "pending";
  const cancelStatus = normalizeText(raw.cancel_status) || "pending";
  const resumeStatus = normalizeText(raw.resume_status) || "pending";
  const graceRecovery = normalizeText(raw.grace_recovery_status) || "pending";
  const paymentPending = normalizeText(raw.payment_pending_status) || "pending";
  const paymentFailed = normalizeText(raw.payment_failed_status) || "pending";
  const notify = normalizeText(raw.notification_delivery_status) || "pending";
  return (
    `renewal=${renewal} · cancel=${cancelStatus} · resume=${resumeStatus} · grace=${graceRecovery} · ` +
    `payment_pending=${paymentPending} · payment_failed=${paymentFailed} · notify=${notify}`
  );
}

function formatStage7aRemainingCapacity(raw) {
  if (raw === null || raw === undefined) {
    return "n/a";
  }
  return String(Number(raw));
}

function formatStage7bHostedBillingArtifactsDiscount(raw) {
  if (!raw || typeof raw !== "object") {
    return "hosted billing artifacts/discount pending";
  }
  const entryUrl = normalizeText(raw.hosted_entry_url) || "n/a";
  const hostedStatus = normalizeText(raw.hosted_access_status) || "pending";
  const source = normalizeText(raw.source) || "stage7b_truth_fan_in";
  return `entry=${entryUrl} · hosted=${hostedStatus} · source=${source}`;
}

function formatStage7bInvoiceTaxReceipt(raw) {
  if (!raw || typeof raw !== "object") {
    return "workspace invoice/tax/receipt pending";
  }
  const workspaceId = normalizeText(raw.workspace_id) || "n/a";
  const planRef = normalizeText(raw.plan_ref) || "n/a";
  const invoiceStatus = normalizeText(raw.invoice_status) || "pending";
  const taxStatus = normalizeText(raw.tax_profile_status) || "pending";
  const receiptStatus = normalizeText(raw.receipt_export_status) || "pending";
  const invoiceRef = normalizeText(raw.invoice_ref) || "n/a";
  const receiptRef = normalizeText(raw.receipt_ref) || "n/a";
  const totalAmount = formatStage7bMoney(raw.total_amount, raw.currency);
  return (
    `workspace=${workspaceId} · plan=${planRef} · invoice=${invoiceStatus} · tax=${taxStatus} · ` +
    `receipt=${receiptStatus} · total=${totalAmount} · invoice_ref=${invoiceRef} · receipt_ref=${receiptRef}`
  );
}

function formatStage7bCouponPromotionDiscount(raw) {
  if (!raw || typeof raw !== "object") {
    return "coupon/promotion/discount application pending";
  }
  const couponStatus = normalizeText(raw.coupon_status) || "pending";
  const promotionStatus = normalizeText(raw.promotion_status) || "pending";
  const discountStatus = normalizeText(raw.discount_application_status) || "pending";
  const discountState = normalizeText(raw.discount_state) || "pending";
  const couponRef = normalizeText(raw.coupon_ref) || "n/a";
  const promotionRef = normalizeText(raw.promotion_ref) || "n/a";
  const discountRef = normalizeText(raw.discount_ref) || "n/a";
  return (
    `coupon=${couponStatus} · promotion=${promotionStatus} · application=${discountStatus} · state=${discountState} · ` +
    `coupon_ref=${couponRef} · promotion_ref=${promotionRef} · discount_ref=${discountRef}`
  );
}

function formatStage7bDocumentProjection(raw) {
  if (!raw || typeof raw !== "object") {
    return "document readiness / refs pending";
  }
  const documentReadiness = normalizeText(raw.document_readiness_status) || "pending";
  const refsStatus = normalizeText(raw.receipt_invoice_refs_status) || "pending";
  const invoiceRef = normalizeText(raw.invoice_ref) || "n/a";
  const receiptRef = normalizeText(raw.receipt_ref) || "n/a";
  const receiptExportRef = normalizeText(raw.receipt_export_ref) || "n/a";
  return (
    `document=${documentReadiness} · refs=${refsStatus} · invoice_ref=${invoiceRef} · ` +
    `receipt_ref=${receiptRef} · receipt_export_ref=${receiptExportRef}`
  );
}

function formatStage7bDiscountTotalsProjection(raw) {
  if (!raw || typeof raw !== "object") {
    return "discount state / totals projection pending";
  }
  const discountStateStatus = normalizeText(raw.discount_state_status) || "pending";
  const totalsStatus = normalizeText(raw.totals_projection_status) || "pending";
  const discountState = normalizeText(raw.discount_state) || "pending";
  const subtotalAmount = formatStage7bMoney(raw.subtotal_amount, raw.currency);
  const taxAmount = formatStage7bMoney(raw.tax_amount, raw.currency);
  const discountAmount = formatStage7bMoney(raw.discount_amount, raw.currency);
  const totalAmount = formatStage7bMoney(raw.total_amount, raw.currency);
  const quotaState = normalizeText(raw.quota_state) || "pending";
  return (
    `state=${discountStateStatus}/${discountState} · totals=${totalsStatus} · ` +
    `subtotal=${subtotalAmount} tax=${taxAmount} discount=${discountAmount} total=${totalAmount} · quota=${quotaState}`
  );
}

function formatStage7bMoney(value, currency) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "n/a";
  }
  const normalizedCurrency = normalizeText(currency) || "usd";
  return `${Number(value)} ${normalizedCurrency.toUpperCase()}`;
}

function queueCard({ title, subtitle, note, status = "pending" }) {
  const wrapper = document.createElement("article");
  wrapper.className = "queue-card";

  const header = document.createElement("header");
  const titleNode = document.createElement("h3");
  titleNode.textContent = title;
  const badge = document.createElement("span");
  badge.className = `badge ${statusBadgeClass(status)}`;
  badge.textContent = status;
  header.append(titleNode, badge);

  const meta = document.createElement("p");
  meta.className = "queue-meta";
  meta.textContent = subtitle;

  const noteNode = document.createElement("p");
  noteNode.className = "queue-meta";
  noteNode.textContent = note;

  wrapper.append(header, meta, noteNode);
  return wrapper;
}

function queueAction(label, handler) {
  const fragment = dom.actionTemplate.content.cloneNode(true);
  const button = fragment.querySelector("button");
  button.textContent = label;
  button.addEventListener("click", () => {
    void withButtonDisabled(button, handler);
  });
  return button;
}

async function withButtonDisabled(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    console.error(error);
    dom.lastUpdated.textContent = `Last action failed (${String(error)}) [api=${runtimeConfig.apiBaseUrl}]`;
  } finally {
    button.disabled = false;
  }
}

function statusCell(status) {
  const element = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${statusBadgeClass(status)}`;
  badge.textContent = status;
  element.append(badge);
  return element;
}

function statusBadgeClass(status) {
  if (
    status === "running" ||
    status === "active" ||
    status === "approved" ||
    status === "online" ||
    status === "paired" ||
    status === "accepted"
  ) {
    return "badge-running";
  }
  if (
    status === "blocked" ||
    status === "approval_required" ||
    status === "hold" ||
    status === "rejected" ||
    status === "failed"
  ) {
    return "badge-blocked";
  }
  if (status === "pending" || status === "open" || status === "waiting" || status === "booting") {
    return "badge-pending";
  }
  return "badge-idle";
}

function cell(text) {
  const element = document.createElement("td");
  element.textContent = text;
  return element;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function actionLabel(action) {
  switch (action) {
    case "pause":
      return "Pause run";
    case "resume":
      return "Resume run";
    case "reroute":
      return "Reroute plan";
    case "request_report":
      return "Request follow-up";
    default:
      return action;
  }
}

function interventionPointActionLabel(action) {
  switch (action) {
    case "approve":
      return "Approve gate";
    case "hold":
      return "Hold gate";
    case "escalate":
      return "Escalate";
    default:
      return action;
  }
}

async function requestJson(url, { method, body }) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = safeParseJson(text);
  if (!response.ok) {
    const reason = normalizeText(parsed?.error) || normalizeText(parsed?.message) || normalizeText(text) || "request_failed";
    throw new Error(`${method} ${url} failed: ${response.status} ${reason}`);
  }
  if (parsed && typeof parsed === "object") {
    return parsed;
  }
  return {};
}

function resolveRuntimeConfig() {
  const defaults = { apiBaseUrl: window.location.origin };
  const fromWindow = window.OPENSHOCK_SHELL_CONFIG;
  if (!fromWindow || typeof fromWindow !== "object") {
    return defaults;
  }
  if (!fromWindow.apiBaseUrl || typeof fromWindow.apiBaseUrl !== "string") {
    return defaults;
  }
  return { apiBaseUrl: fromWindow.apiBaseUrl };
}

function toApiUrl(baseUrl, pathname) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${pathname}`;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeStringList(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function safeParseJson(text) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
