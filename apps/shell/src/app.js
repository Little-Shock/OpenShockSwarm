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
