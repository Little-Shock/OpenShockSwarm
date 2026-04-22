import type { Issue, PhaseZeroState, PlannerQueueItem, RunDetail, RunHistoryPage } from "@/lib/phase-zero-types";

const LIVE_TRUTH_QUESTION_BURST = /\?{2,}/;
const LIVE_TRUTH_E2E_RESIDUE = /\bE2E\b.*\b20\d{6,}\b/i;
const LIVE_TRUTH_PLACEHOLDER_RESIDUE = /\bplaceholder\b|\bfixture\b|\btest-only\b/i;
const LIVE_TRUTH_MOCK_RESIDUE = /本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace/;
const LIVE_TRUTH_INTERNAL_PATH_RESIDUE = /[A-Za-z]:\\|\/tmp\/openshock|\/home\/lark\/OpenShock|\.openshock-worktrees|\.slock\//;
const RUNTIME_SCHEDULER_FALLBACK_STATE = /^当前 fallback state 仍按 workspace selection 指向 (.+)。$/;
const RUNTIME_SCHEDULER_OWNER_SUMMARY = /^已按 (.+) 的设置选择 (.+)，当前有 (\d+) 个运行任务。$/;
const RUNTIME_SCHEDULER_SELECTED_SUMMARY = /^当前继续使用 (.+)，当前有 (\d+) 个运行任务。$/;
const RUNTIME_SCHEDULER_FAILOVER_SUMMARY = /^(.+?) 当前不可用，已切换到 (.+)，当前有 (\d+) 个运行任务。$/;
const RUNTIME_SCHEDULER_LEAST_LOADED_SUMMARY = /^当前已选择 (.+)，当前有 (\d+) 个运行任务。$/;
const RUNTIME_SCHEDULER_OWNER_REASON = /^按 owner runtime preference 选中；当前承载 (\d+) 条 active lease。$/;
const RUNTIME_SCHEDULER_SELECTED_REASON = /^沿用当前 selection；当前承载 (\d+) 条 active lease。$/;
const RUNTIME_SCHEDULER_FAILOVER_REASON = /^承接 `?([^`；]+)`? 的 failover；当前承载 (\d+) 条 active lease。$/;
const RUNTIME_SCHEDULER_PRESSURE_REASON = /^按 lease 压力选中；当前承载 (\d+) 条 active lease。$/;
const RUNTIME_SCHEDULER_STATE_REASON = /^当前 `?([^`，]+)`?，(?:未进入可调度状态|不可调度)。$/;
const RUNTIME_SCHEDULER_PREFERRED_SKIP = /^preferred runtime 当前不可调度，已被 failover 跳过。$/;
const RUNTIME_SCHEDULER_ACTIVE_LEASE = /^当前承载 (\d+) 条 active lease。$/;
const RUNTIME_SCHEDULER_UNAVAILABLE = /^当前没有可调度 runtime。$/;
const RUNTIME_SCHEDULER_OPEN_LANE = /^当前可接新 lane。$/;
const RUNTIME_SCHEDULER_UNPAIRED = /^未配对 daemon，当前不可调度。$/;
const RUNTIME_SCHEDULER_TIMELINE_FAILOVER = /^Runtime 已 failover 到 (.+)$/;
const RUNTIME_SCHEDULER_TIMELINE_ASSIGNED = /^Runtime 已分配到 (.+)$/;
const CUSTOMER_FACING_LITERAL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["blocked / review / release gate 优先推送", "优先推送阻塞、评审和发布门事件"],
  ["evidence ready / synthesis blocked / reviewer feedback 优先推送", "优先推送证据就绪、综合阻塞和复核反馈"],
  ["只推高优先级与显式 review 事件", "只推高优先级与显式评审事件"],
  ["Owner / Member / Viewer", "所有者 / 成员 / 访客"],
  ["Architect", "架构"],
  ["Developer", "开发"],
  ["Reviewer", "评审"],
  ["PM", "产品"],
  ["QA", "测试"],
  ["exact-head verdict", "精确审阅结论"],
  ["verify / release evidence", "验证 / 发布证据"],
  ["scope / final response", "目标收敛 / 最终回复"],
  ["shape / split", "拆解 / 分派"],
  ["issue -> branch", "事项 -> 分支"],
  ["review / blocker", "评审 / 阻塞"],
  ["test / release gate", "测试 / 发布闸口"],
  ["scope / final synthesis", "范围 / 最终结论"],
  ["intake -> evidence", "接收 -> 证据"],
  ["evidence -> synthesis", "证据 -> 归纳"],
  ["review / publish", "复核 / 发布"],
  ["publish / closeout", "发布 / 收尾"],
];

type WorkspaceSnapshot = PhaseZeroState["workspace"];
type Channel = PhaseZeroState["channels"][number];
type Message = PhaseZeroState["channelMessages"][string][number];
type DirectMessage = PhaseZeroState["directMessages"][number];
type MessageSurfaceEntry = PhaseZeroState["followedThreads"][number];
type SearchResult = PhaseZeroState["quickSearchEntries"][number];
type LiveIssue = PhaseZeroState["issues"][number];
type Room = PhaseZeroState["rooms"][number];
type Topic = Room["topic"];
type Run = PhaseZeroState["runs"][number];
type RunHistoryEntry = RunHistoryPage["items"][number];
type ToolCall = Run["toolCalls"][number];
type RunEvent = Run["timeline"][number];
type Agent = PhaseZeroState["agents"][number];
type RuntimeRecord = PhaseZeroState["runtimes"][number];
type InboxItem = PhaseZeroState["inbox"][number];
type AgentHandoff = PhaseZeroState["mailbox"][number];
type RoomAgentWait = PhaseZeroState["roomAgentWaits"][number];
type MailboxMessage = AgentHandoff["messages"][number];
type PullRequest = PhaseZeroState["pullRequests"][number];
type PullRequestConversationEntry = NonNullable<PullRequest["conversation"]>[number];
type Session = PhaseZeroState["sessions"][number];
type RuntimeLease = PhaseZeroState["runtimeLeases"][number];
type RuntimeScheduler = PhaseZeroState["runtimeScheduler"];
type RuntimeSchedulerCandidate = RuntimeScheduler["candidates"][number];
type MemoryArtifact = PhaseZeroState["memory"][number];
type CredentialProfile = PhaseZeroState["credentials"][number];
type PlannerQueueRecord = PlannerQueueItem;

export function buildBoardColumns(issueList: Issue[]) {
  return [
    { title: "阻塞排队", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "blocked") },
    { title: "待处理", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "queued") },
    { title: "进行中", accent: "var(--shock-yellow)", cards: issueList.filter((issue) => issue.state === "running") },
    { title: "已暂停", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "paused") },
    { title: "待评审", accent: "var(--shock-lime)", cards: issueList.filter((issue) => issue.state === "review") },
    { title: "已完成", accent: "white", cards: issueList.filter((issue) => issue.state === "done") },
  ];
}

export function hrefTargetLabel(href?: string) {
  const trimmed = href?.trim() || "";
  if (trimmed === "") {
    return "";
  }
  if (trimmed.startsWith("/rooms/") && trimmed.includes("/runs/")) {
    return "执行详情";
  }
  if (trimmed.startsWith("/rooms/") && trimmed.includes("?tab=pr")) {
    return "讨论间 PR";
  }
  if (trimmed.startsWith("/rooms/") && trimmed.includes("?tab=run")) {
    return "讨论间执行面";
  }
  if (trimmed.startsWith("/rooms/") && trimmed.includes("?tab=context")) {
    return "讨论间上下文";
  }
  if (trimmed.startsWith("/rooms/") && trimmed.includes("?tab=topic")) {
    return "讨论间话题";
  }
  if (trimmed.startsWith("/rooms/")) {
    return "进入讨论间";
  }
  if (trimmed.startsWith("/runs/")) {
    return "执行详情";
  }
  if (trimmed.startsWith("/issues/")) {
    return "事项详情";
  }
  if (trimmed.startsWith("/topics/")) {
    return "话题详情";
  }
  if (trimmed.startsWith("/pull-requests/")) {
    return "交付详情";
  }
  if (trimmed.startsWith("/setup") || trimmed.startsWith("/settings")) {
    return "设置";
  }
  if (trimmed.startsWith("/access")) {
    return "账号中心";
  }
  if (trimmed.startsWith("/mailbox") && trimmed.includes("handoffId=")) {
    return "当前交接";
  }
  if (trimmed.startsWith("/mailbox")) {
    return "交接箱";
  }
  if (trimmed.startsWith("/inbox") && trimmed.includes("handoffId=")) {
    return "收件箱定位";
  }
  if (trimmed.startsWith("/inbox")) {
    return "收件箱";
  }
  if (trimmed.startsWith("/profiles/agent/") || trimmed.startsWith("/agents/")) {
    return "智能体详情";
  }
  if (trimmed.startsWith("/memory")) {
    return "记忆中心";
  }
  return "";
}

export function governanceSuggestedHandoffHrefLabel(status: string | undefined, href: string | undefined) {
  const trimmed = href?.trim() || "";
  if (trimmed === "") {
    return "";
  }
  if (trimmed.startsWith("/mailbox") && !trimmed.includes("handoffId=")) {
    switch ((status || "").trim()) {
      case "ready":
        return "交接建议";
      case "blocked":
        return "待处理升级";
      default:
        return "交接箱";
    }
  }
  return hrefTargetLabel(trimmed);
}

export function governanceEscalationRoomHrefLabel(href: string | undefined) {
  return hrefTargetLabel(href);
}

export function pullRequestDeliveryHrefLabel(gateId: string | undefined, href: string | undefined) {
  const trimmed = href?.trim() || "";
  if (trimmed === "") {
    return "";
  }
  if (trimmed.startsWith("/settings") && (gateId || "").trim() === "notification-delivery") {
    return "通知设置";
  }
  return hrefTargetLabel(trimmed);
}

export function buildGlobalStats(state: PhaseZeroState) {
  const activeRuns = state.runs.filter((run) => run.status === "running" || run.status === "review").length;
  const blockedCount = state.runs.filter((run) => run.status === "blocked" || run.status === "paused").length;

  return [
    { label: "活跃执行", value: String(activeRuns).padStart(2, "0"), tone: "yellow" as const },
    { label: "阻塞", value: String(blockedCount).padStart(2, "0"), tone: "pink" as const },
    { label: "收件箱", value: String(state.inbox.length).padStart(2, "0"), tone: "lime" as const },
  ];
}

export function buildRunHistoryEntries(state: PhaseZeroState, roomId?: string): RunHistoryEntry[] {
  const roomsById = new Map(state.rooms.map((room) => [room.id, room]));
  const issuesByKey = new Map(state.issues.map((issue) => [issue.key, issue]));
  const sessionsByRunId = new Map(state.sessions.map((session) => [session.activeRunId, session]));

  return [...state.runs]
    .filter((run) => (!roomId ? true : run.roomId === roomId))
    .reverse()
    .flatMap((run) => {
      const room = roomsById.get(run.roomId);
      const issue = issuesByKey.get(run.issueKey);
      if (!room || !issue) {
        return [];
      }
      return [
        {
          run: sanitizeRun(run),
          room: sanitizeRoom(room),
          issue: sanitizeIssue(issue),
          session: sanitizeSession(
            sessionsByRunId.get(run.id) ?? {
              id: `session-${run.id}`,
              issueKey: run.issueKey,
              roomId: run.roomId,
              topicId: run.topicId,
              activeRunId: run.id,
              status: run.status,
              followThread: run.followThread,
              controlNote: run.controlNote,
              runtime: run.runtime,
              machine: run.machine,
              provider: run.provider,
              branch: run.branch,
              worktree: run.worktree,
              worktreePath: run.worktreePath ?? "",
              summary: run.summary || "补建的 Session 上下文。",
              updatedAt: run.startedAt,
              memoryPaths: buildDefaultSessionMemoryPaths(run.roomId, run.issueKey),
            }
          ),
          isCurrent: room.runId === run.id,
        },
      ];
    });
}

function buildDefaultSessionMemoryPaths(roomId: string, issueKey: string) {
  const paths = [
    "MEMORY.md",
    "notes/channels.md",
    "notes/operating-rules.md",
    "notes/skills.md",
    "notes/work-log.md",
  ];
  if (roomId.trim()) {
    paths.push(`notes/rooms/${roomId}.md`);
  }
  if (issueKey.trim()) {
    paths.push(`decisions/${issueKey.toLowerCase()}.md`);
  }
  return paths;
}

function asArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function asRecord<T>(value: Record<string, T[]> | null | undefined) {
  return value && typeof value === "object" ? value : {};
}

export function sanitizePhaseZeroState(state: PhaseZeroState): PhaseZeroState {
  const auth = state.auth ?? { session: { id: "", status: "signed_out", preferences: {}, permissions: [] }, roles: [], members: [] };
  return {
    ...state,
    workspace: sanitizeWorkspace(state.workspace),
    auth: {
      ...auth,
      session: {
        ...auth.session,
        preferences: auth.session?.preferences ?? {},
        linkedIdentities: asArray(auth.session?.linkedIdentities),
        permissions: asArray(auth.session?.permissions),
      },
      roles: asArray(auth.roles),
      members: asArray(auth.members).map((member) => ({
        ...member,
        preferences: member.preferences ?? {},
        linkedIdentities: asArray(member.linkedIdentities),
        trustedDeviceIds: asArray(member.trustedDeviceIds),
        permissions: asArray(member.permissions),
      })),
      devices: asArray(auth.devices),
    },
    channels: asArray(state.channels).map(sanitizeChannel),
    channelMessages: mapRecord(asRecord(state.channelMessages), sanitizeMessage),
    directMessages: asArray(state.directMessages).map(sanitizeDirectMessage),
    directMessageMessages: mapRecord(asRecord(state.directMessageMessages), sanitizeMessage),
    followedThreads: asArray(state.followedThreads).map(sanitizeMessageSurfaceEntry),
    savedLaterItems: asArray(state.savedLaterItems).map(sanitizeMessageSurfaceEntry),
    quickSearchEntries: asArray(state.quickSearchEntries).map(sanitizeSearchResult),
    issues: asArray(state.issues).map(sanitizeIssue),
    rooms: asArray(state.rooms).map(sanitizeRoom),
    roomMessages: mapRecord(asRecord(state.roomMessages), sanitizeMessage),
    runs: asArray(state.runs).map(sanitizeRun),
    agents: asArray(state.agents).map(sanitizeAgent),
    machines: asArray(state.machines),
    runtimes: asArray(state.runtimes).map(sanitizeRuntimeRecord),
    inbox: asArray(state.inbox).map(sanitizeInboxItem),
    mailbox: asArray(state.mailbox).map(sanitizeAgentHandoff),
    roomAgentWaits: asArray(state.roomAgentWaits).map(sanitizeRoomAgentWait),
    pullRequests: asArray(state.pullRequests).map(sanitizePullRequest),
    sessions: asArray(state.sessions).map(sanitizeSession),
    runtimeLeases: asArray(state.runtimeLeases).map(sanitizeRuntimeLease),
    runtimeScheduler: sanitizeRuntimeScheduler(
      state.runtimeScheduler ?? {
        selectedRuntime: "",
        preferredRuntime: "",
        assignedRuntime: "",
        assignedMachine: "",
        strategy: "unavailable",
        summary: "",
        candidates: [],
      }
    ),
    guards: asArray(state.guards),
    memory: asArray(state.memory).map(sanitizeMemoryArtifact),
    credentials: asArray(state.credentials).map(sanitizeCredentialProfile),
  };
}

export function sanitizePlannerQueue(items: PlannerQueueItem[]) {
  return items.map(sanitizePlannerQueueItem);
}

function mapRecord<T>(record: Record<string, T[] | null | undefined>, sanitize: (item: T) => T) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, asArray(value).map(sanitize)]));
}

function sanitizeWorkspace(workspace: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...workspace,
    name: sanitizeDisplayText(workspace.name, "当前工作区名称还没同步。"),
    repo: sanitizeDisplayText(workspace.repo, "当前仓库信息还没同步。"),
    repoUrl: sanitizeDisplayText(workspace.repoUrl, ""),
    branch: sanitizeDisplayText(workspace.branch, "待整理分支"),
    repoProvider: sanitizeDisplayText(workspace.repoProvider, "待整理仓库提供方"),
    repoBindingStatus: sanitizeDisplayText(workspace.repoBindingStatus, "当前绑定状态正在整理中。"),
    repoAuthMode: sanitizeDisplayText(workspace.repoAuthMode, "当前认证模式正在整理中。"),
    plan: sanitizeDisplayText(workspace.plan, "当前工作区计划正在整理中。"),
    pairedRuntime: sanitizeDisplayText(workspace.pairedRuntime, "当前运行环境还没同步。"),
    pairedRuntimeUrl: sanitizeDisplayText(workspace.pairedRuntimeUrl, ""),
    pairingStatus: sanitizeDisplayText(workspace.pairingStatus, "当前配对状态正在整理中。"),
    deviceAuth: sanitizeDisplayText(workspace.deviceAuth, "当前设备认证状态正在整理中。"),
    browserPush: sanitizeDisplayText(workspace.browserPush, "当前浏览器推送策略正在整理中。"),
    memoryMode: sanitizeDisplayText(workspace.memoryMode, "当前记忆模式正在整理中。"),
    repoBinding: {
      ...workspace.repoBinding,
      repo: sanitizeDisplayText(workspace.repoBinding?.repo ?? "", "当前仓库信息还没同步。"),
      repoUrl: sanitizeDisplayText(workspace.repoBinding?.repoUrl ?? "", ""),
      branch: sanitizeDisplayText(workspace.repoBinding?.branch ?? "", "待整理分支"),
      provider: sanitizeDisplayText(workspace.repoBinding?.provider ?? "", "待整理仓库提供方"),
      bindingStatus: sanitizeDisplayText(workspace.repoBinding?.bindingStatus ?? "", ""),
      authMode: sanitizeDisplayText(workspace.repoBinding?.authMode ?? "", ""),
      detectedAt: sanitizeDisplayText(workspace.repoBinding?.detectedAt ?? "", ""),
      syncedAt: sanitizeDisplayText(workspace.repoBinding?.syncedAt ?? "", ""),
    },
    githubInstallation: {
      ...workspace.githubInstallation,
      provider: sanitizeDisplayText(workspace.githubInstallation?.provider ?? "", ""),
      preferredAuthMode: sanitizeDisplayText(workspace.githubInstallation?.preferredAuthMode ?? "", ""),
      installationId: sanitizeDisplayText(workspace.githubInstallation?.installationId ?? "", ""),
      installationUrl: sanitizeDisplayText(workspace.githubInstallation?.installationUrl ?? "", ""),
      missing: sanitizeTextLines(workspace.githubInstallation?.missing ?? [], ""),
      connectionMessage: sanitizeDisplayText(workspace.githubInstallation?.connectionMessage ?? "", ""),
      syncedAt: sanitizeDisplayText(workspace.githubInstallation?.syncedAt ?? "", ""),
    },
    onboarding: sanitizeWorkspaceOnboarding(workspace.onboarding),
    governance: sanitizeWorkspaceGovernance(workspace.governance),
  };
}

function sanitizeWorkspaceOnboarding(onboarding: WorkspaceSnapshot["onboarding"]): WorkspaceSnapshot["onboarding"] {
  return {
    ...onboarding,
    status: sanitizeDisplayText(onboarding?.status ?? "", ""),
    templateId: sanitizeDisplayText(onboarding?.templateId ?? "", ""),
    currentStep: sanitizeDisplayText(onboarding?.currentStep ?? "", ""),
    completedSteps: sanitizeTextLines(onboarding?.completedSteps ?? [], ""),
    resumeUrl: sanitizeDisplayText(onboarding?.resumeUrl ?? "", ""),
    updatedAt: sanitizeDisplayText(onboarding?.updatedAt ?? "", ""),
    materialization: {
      ...onboarding?.materialization,
      label: sanitizeDisplayText(onboarding?.materialization?.label ?? "", ""),
      channels: sanitizeTextLines(onboarding?.materialization?.channels ?? [], ""),
      roles: sanitizeOnboardingRoleLabels(onboarding?.materialization?.roles ?? []),
      agents: sanitizeOnboardingAgentLabels(onboarding?.materialization?.agents ?? []),
      notificationPolicy: sanitizeDisplayText(onboarding?.materialization?.notificationPolicy ?? "", ""),
      notes: sanitizeTextLines(onboarding?.materialization?.notes ?? [], ""),
    },
  };
}

function sanitizeOnboardingRoleLabels(lines: string[]) {
  return lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }
    switch (trimmed) {
      case "Owner / Member / Viewer":
        return ["所有者", "成员", "访客"];
      case "PM":
        return ["目标"];
      case "Architect":
        return ["边界"];
      case "Developer":
        return ["实现"];
      case "Reviewer":
      case "Peer Reviewer":
        return ["评审"];
      case "QA":
        return ["验证"];
      case "Research Lead":
      case "Lead Operator":
        return ["方向"];
      case "Collector":
      case "Field Collector":
        return ["采集"];
      case "Synthesizer":
        return ["归纳"];
      case "Owner":
        return ["所有者"];
      case "Member":
        return ["成员"];
      case "Viewer":
        return ["访客"];
    }

    const sanitized = sanitizeDisplayText(trimmed, "");
    switch (sanitized) {
      case "所有者 / 成员 / 访客":
        return ["所有者", "成员", "访客"];
      case "目标":
      case "边界":
      case "实现":
      case "评审":
      case "验证":
      case "方向":
      case "采集":
      case "归纳":
      case "所有者":
      case "成员":
      case "访客":
        return [sanitized];
      default:
        return [sanitized];
    }
  });
}

function sanitizeOnboardingAgentLabels(lines: string[]) {
  return lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }
    switch (trimmed) {
      case "Codex Dockmaster":
      case "Spec Captain":
        return "需求智能体";
      case "Build Pilot":
        return "开发智能体";
      case "Claude Review Runner":
      case "Review Runner":
      case "Reviewer":
      case "Peer Reviewer":
        return "评审智能体";
      case "Memory Clerk":
      case "QA Relay":
        return "测试智能体";
      case "Lead Operator":
      case "Research Lead":
        return "总控智能体";
      case "Collector":
      case "Field Collector":
        return "采集智能体";
      case "Synthesizer":
        return "归纳智能体";
    }

    const sanitized = sanitizeDisplayText(trimmed, "");
    switch (sanitized) {
      case "需求智能体":
      case "开发智能体":
      case "评审智能体":
      case "测试智能体":
      case "总控智能体":
      case "采集智能体":
      case "归纳智能体":
        return [sanitized];
      default:
        return [sanitized];
    }
  });
}

function sanitizeWorkspaceGovernance(
  governance?: WorkspaceSnapshot["governance"]
): WorkspaceSnapshot["governance"] {
  const safeGovernance = governance ?? {
    templateId: "",
    label: "",
    summary: "",
    configuredTopology: [],
    deliveryDelegationMode: "formal-handoff",
    teamTopology: [],
    handoffRules: [],
    routingPolicy: {
      status: "",
      summary: "",
      defaultRoute: "",
      rules: [],
      suggestedHandoff: {
        status: "",
        reason: "",
        roomId: "",
        issueKey: "",
        fromLaneId: "",
        fromLaneLabel: "",
        fromAgentId: "",
        fromAgent: "",
        toLaneId: "",
        toLaneLabel: "",
        toAgentId: "",
        toAgent: "",
        draftTitle: "",
        draftSummary: "",
        handoffId: "",
        href: "",
        hrefLabel: "",
      },
    },
    escalationSla: {
      status: "",
      summary: "",
      timeoutMinutes: 0,
      retryBudget: 0,
      activeEscalations: 0,
      breachedEscalations: 0,
      nextEscalation: "",
      queue: [],
      rollup: [],
    },
    notificationPolicy: {
      status: "",
      summary: "",
      browserPush: "",
      targets: [],
      escalationChannel: "",
    },
    responseAggregation: {
      status: "",
      summary: "",
      sources: [],
      finalResponse: "",
      aggregator: "",
      decisionPath: [],
      overrideTrace: [],
      auditTrail: [],
    },
    humanOverride: {
      status: "",
      summary: "",
      href: "",
    },
    walkthrough: [],
    stats: {
      openHandoffs: 0,
      blockedEscalations: 0,
      reviewGates: 0,
      humanOverrideGates: 0,
      slaBreaches: 0,
      aggregationSources: 0,
    },
  };
  const suggestedHrefLabelFallback = governanceSuggestedHandoffHrefLabel(
    safeGovernance.routingPolicy?.suggestedHandoff?.status ?? "",
    safeGovernance.routingPolicy?.suggestedHandoff?.href ?? ""
  );
  const suggestedHrefLabel =
    sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.hrefLabel ?? "", suggestedHrefLabelFallback) ||
    suggestedHrefLabelFallback;

  return {
    ...safeGovernance,
    label: sanitizeDisplayText(safeGovernance.label ?? "", "当前协作流程正在整理中。"),
    summary: sanitizeDisplayText(safeGovernance.summary ?? "", "当前协作摘要正在整理中。"),
    deliveryDelegationMode: sanitizeDisplayText(safeGovernance.deliveryDelegationMode ?? "", "formal-handoff"),
    configuredTopology: (safeGovernance.configuredTopology ?? []).map((lane) => {
      const safeLane = lane ?? {
        id: "",
        label: "",
        role: "",
        defaultAgent: "",
        lane: "",
      };
      return {
        ...safeLane,
        id: sanitizeDisplayText(safeLane.id, "lane"),
        label: sanitizeDisplayText(safeLane.label, "未命名分工"),
        role: sanitizeDisplayText(safeLane.role, "当前职责正在整理中。"),
        defaultAgent: sanitizeDisplayText(safeLane.defaultAgent ?? "", ""),
        lane: sanitizeDisplayText(safeLane.lane ?? "", ""),
      };
    }),
    teamTopology: (safeGovernance.teamTopology ?? []).map((lane) => {
      const safeLane = lane ?? {
        id: "",
        label: "",
        role: "",
        defaultAgent: "",
        lane: "",
        status: "",
        summary: "",
      };
      return {
        ...safeLane,
        label: sanitizeDisplayText(safeLane.label, "未命名分工"),
        role: sanitizeDisplayText(safeLane.role, "当前职责正在整理中。"),
        defaultAgent: sanitizeDisplayText(safeLane.defaultAgent ?? "", ""),
        lane: sanitizeDisplayText(safeLane.lane ?? "", ""),
        summary: sanitizeDisplayText(safeLane.summary, "当前分工正在整理中。"),
      };
    }),
    handoffRules: (safeGovernance.handoffRules ?? []).map((rule) => {
      const safeRule = rule ?? {
        id: "",
        label: "",
        status: "",
        summary: "",
        href: "",
      };
      return {
        ...safeRule,
        label: sanitizeDisplayText(safeRule.label, "未命名规则"),
        summary: sanitizeDisplayText(safeRule.summary, "当前规则正在整理中。"),
        href: sanitizeDisplayText(safeRule.href ?? "", ""),
      };
    }),
    routingPolicy: {
      ...safeGovernance.routingPolicy,
      summary: sanitizeDisplayText(safeGovernance.routingPolicy?.summary, "当前安排正在整理中。"),
      defaultRoute: sanitizeDisplayText(safeGovernance.routingPolicy?.defaultRoute ?? "", ""),
      suggestedHandoff: {
        ...(safeGovernance.routingPolicy?.suggestedHandoff ?? {
          status: "",
          reason: "",
          roomId: "",
          issueKey: "",
          fromLaneId: "",
          fromLaneLabel: "",
          fromAgentId: "",
          fromAgent: "",
          toLaneId: "",
          toLaneLabel: "",
          toAgentId: "",
          toAgent: "",
          draftTitle: "",
          draftSummary: "",
          handoffId: "",
          href: "",
          hrefLabel: "",
        }),
        reason: sanitizeDisplayText(
          safeGovernance.routingPolicy?.suggestedHandoff?.reason ?? "",
          "当前下一步建议正在整理中。"
        ),
        roomId: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.roomId ?? "", ""),
        issueKey: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.issueKey ?? "", ""),
        fromLaneId: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.fromLaneId ?? "", ""),
        fromLaneLabel: sanitizeDisplayText(
          safeGovernance.routingPolicy?.suggestedHandoff?.fromLaneLabel ?? "",
          ""
        ),
        fromAgentId: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.fromAgentId ?? "", ""),
        fromAgent: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.fromAgent ?? "", ""),
        toLaneId: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.toLaneId ?? "", ""),
        toLaneLabel: sanitizeDisplayText(
          safeGovernance.routingPolicy?.suggestedHandoff?.toLaneLabel ?? "",
          ""
        ),
        toAgentId: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.toAgentId ?? "", ""),
        toAgent: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.toAgent ?? "", ""),
        draftTitle: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.draftTitle ?? "", ""),
        draftSummary: sanitizeDisplayText(
          safeGovernance.routingPolicy?.suggestedHandoff?.draftSummary ?? "",
          ""
        ),
        handoffId: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.handoffId ?? "", ""),
        href: sanitizeDisplayText(safeGovernance.routingPolicy?.suggestedHandoff?.href ?? "", ""),
        hrefLabel: suggestedHrefLabel,
      },
      rules: (safeGovernance.routingPolicy?.rules ?? []).map((rule) => {
        const safeRoute = rule ?? {
          id: "",
          trigger: "",
          fromLane: "",
          toLane: "",
          policy: "",
          summary: "",
          status: "",
        };
        return {
          ...safeRoute,
          trigger: sanitizeDisplayText(safeRoute.trigger, "trigger"),
          fromLane: sanitizeDisplayText(safeRoute.fromLane, "未命名来源"),
          toLane: sanitizeDisplayText(safeRoute.toLane, "未命名目标"),
          policy: sanitizeDisplayText(safeRoute.policy, "当前安排正在整理中。"),
          summary: sanitizeDisplayText(safeRoute.summary, "当前安排正在整理中。"),
        };
      }),
    },
    escalationSla: {
      ...safeGovernance.escalationSla,
      summary: sanitizeDisplayText(safeGovernance.escalationSla?.summary, "当前时限正在整理中。"),
      nextEscalation: sanitizeDisplayText(safeGovernance.escalationSla?.nextEscalation ?? "", ""),
      queue: (safeGovernance.escalationSla?.queue ?? []).map((entry) => {
        const safeEntry = entry ?? {
          id: "",
          label: "",
          status: "",
          source: "",
          owner: "",
          summary: "",
          nextStep: "",
          href: "",
          timeLabel: "",
          elapsedMinutes: 0,
          thresholdMinutes: 0,
        };
        return {
          ...safeEntry,
          label: sanitizeDisplayText(safeEntry.label, "未命名待处理事项"),
          status: sanitizeDisplayText(safeEntry.status, "pending"),
          source: sanitizeDisplayText(safeEntry.source, "当前状态"),
          owner: sanitizeDisplayText(safeEntry.owner ?? "", ""),
          summary: sanitizeDisplayText(safeEntry.summary, "当前待处理事项正在整理中。"),
          nextStep: sanitizeDisplayText(safeEntry.nextStep, "当前下一步正在整理中。"),
          href: sanitizeDisplayText(safeEntry.href ?? "", ""),
          timeLabel: sanitizeDisplayText(safeEntry.timeLabel ?? "", ""),
        };
      }),
      rollup: (safeGovernance.escalationSla?.rollup ?? []).map((entry) => {
        const safeEntry = entry ?? {
          roomId: "",
          roomTitle: "",
          status: "",
          escalationCount: 0,
          blockedCount: 0,
          currentOwner: "",
          currentLane: "",
          latestSource: "",
          latestLabel: "",
          latestSummary: "",
          nextRouteStatus: "",
          nextRouteLabel: "",
          nextRouteSummary: "",
          nextRouteHref: "",
          nextRouteHrefLabel: "",
          href: "",
          hrefLabel: "",
        };
        const nextRouteHrefLabelFallback = governanceSuggestedHandoffHrefLabel(
          safeEntry.nextRouteStatus ?? "",
          safeEntry.nextRouteHref ?? ""
        );
        const nextRouteHrefLabel =
          sanitizeDisplayText(safeEntry.nextRouteHrefLabel ?? "", nextRouteHrefLabelFallback) || nextRouteHrefLabelFallback;
        const hrefLabelFallback = governanceEscalationRoomHrefLabel(safeEntry.href ?? "");
        const hrefLabel = sanitizeDisplayText(safeEntry.hrefLabel ?? "", hrefLabelFallback) || hrefLabelFallback;

        return {
          ...safeEntry,
          roomId: sanitizeDisplayText(safeEntry.roomId, ""),
          roomTitle: sanitizeDisplayText(safeEntry.roomTitle, "未命名讨论间"),
          status: sanitizeDisplayText(safeEntry.status, "pending"),
          currentOwner: sanitizeDisplayText(safeEntry.currentOwner ?? "", ""),
          currentLane: sanitizeDisplayText(safeEntry.currentLane ?? "", ""),
          latestSource: sanitizeDisplayText(safeEntry.latestSource ?? "", "当前状态"),
          latestLabel: sanitizeDisplayText(safeEntry.latestLabel ?? "", "未命名待处理事项"),
          latestSummary: sanitizeDisplayText(safeEntry.latestSummary ?? "", "当前讨论间提醒正在整理中。"),
          nextRouteStatus: sanitizeDisplayText(safeEntry.nextRouteStatus ?? "", "pending"),
          nextRouteLabel: sanitizeDisplayText(safeEntry.nextRouteLabel ?? "", ""),
          nextRouteSummary: sanitizeDisplayText(safeEntry.nextRouteSummary ?? "", "当前下一步安排正在整理中。"),
          nextRouteHref: sanitizeDisplayText(safeEntry.nextRouteHref ?? "", ""),
          nextRouteHrefLabel,
          href: sanitizeDisplayText(safeEntry.href ?? "", ""),
          hrefLabel,
        };
      }),
    },
    notificationPolicy: {
      ...safeGovernance.notificationPolicy,
      summary: sanitizeDisplayText(safeGovernance.notificationPolicy?.summary, "当前提醒设置正在整理中。"),
      browserPush: sanitizeDisplayText(safeGovernance.notificationPolicy?.browserPush ?? "", ""),
      escalationChannel: sanitizeDisplayText(safeGovernance.notificationPolicy?.escalationChannel ?? "", ""),
      targets: (safeGovernance.notificationPolicy?.targets ?? []).map((target) => sanitizeDisplayText(target, "target")),
    },
    responseAggregation: {
      ...safeGovernance.responseAggregation,
      summary: sanitizeDisplayText(safeGovernance.responseAggregation?.summary, "当前最终回复正在整理中。"),
      finalResponse: sanitizeDisplayText(safeGovernance.responseAggregation?.finalResponse ?? "", "等待当前事项收口。"),
      aggregator: sanitizeDisplayText(safeGovernance.responseAggregation?.aggregator ?? "", ""),
      sources: (safeGovernance.responseAggregation?.sources ?? []).map((source) => sanitizeDisplayText(source, "当前来源")),
      decisionPath: (safeGovernance.responseAggregation?.decisionPath ?? []).map((item) => sanitizeDisplayText(item, "当前步骤")),
      overrideTrace: (safeGovernance.responseAggregation?.overrideTrace ?? []).map((item) => sanitizeDisplayText(item, "人工处理记录")),
      auditTrail: (safeGovernance.responseAggregation?.auditTrail ?? []).map((entry) => {
        const safeEntry = entry ?? {
          id: "",
          label: "",
          status: "",
          actor: "",
          summary: "",
          occurredAt: "",
        };
        return {
          ...safeEntry,
          label: sanitizeDisplayText(safeEntry.label, "未命名记录"),
          actor: sanitizeDisplayText(safeEntry.actor ?? "", ""),
          summary: sanitizeDisplayText(safeEntry.summary, "当前记录正在整理中。"),
          occurredAt: sanitizeDisplayText(safeEntry.occurredAt ?? "", ""),
        };
      }),
    },
    humanOverride: {
      ...safeGovernance.humanOverride,
      summary: sanitizeDisplayText(safeGovernance.humanOverride?.summary, "当前人工处理状态正在整理中。"),
      href: sanitizeDisplayText(safeGovernance.humanOverride?.href ?? "", ""),
    },
    walkthrough: (safeGovernance.walkthrough ?? []).map((step) => {
      const safeStep = step ?? {
        id: "",
        label: "",
        status: "",
        summary: "",
        detail: "",
        href: "",
      };
      return {
        ...safeStep,
        label: sanitizeDisplayText(safeStep.label, "未命名步骤"),
        summary: sanitizeDisplayText(safeStep.summary, "当前步骤正在整理中。"),
        detail: sanitizeDisplayText(safeStep.detail ?? "", ""),
        href: sanitizeDisplayText(safeStep.href ?? "", ""),
      };
    }),
    stats: {
      openHandoffs: safeGovernance.stats?.openHandoffs ?? 0,
      blockedEscalations: safeGovernance.stats?.blockedEscalations ?? 0,
      reviewGates: safeGovernance.stats?.reviewGates ?? 0,
      humanOverrideGates: safeGovernance.stats?.humanOverrideGates ?? 0,
      slaBreaches: safeGovernance.stats?.slaBreaches ?? 0,
      aggregationSources: safeGovernance.stats?.aggregationSources ?? 0,
    },
  };
}

function sanitizeChannel(channel: Channel): Channel {
  return {
    ...channel,
    name: sanitizeDisplayText(channel.name, "待整理频道"),
    summary: sanitizeDisplayText(channel.summary, "当前频道摘要正在整理中。"),
    purpose: sanitizeDisplayText(channel.purpose, "频道说明还没同步。"),
  };
}

function sanitizeMessage(message: Message): Message {
  return {
    ...message,
    speaker: sanitizeDisplayText(message.speaker, fallbackSpeaker(message.role)),
    message: sanitizeDisplayText(message.message, "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。"),
  };
}

function sanitizeDirectMessage(message: DirectMessage): DirectMessage {
  return {
    ...message,
    name: sanitizeDisplayText(message.name, "待整理私信"),
    summary: sanitizeDisplayText(message.summary, "当前私聊摘要还没同步。"),
    purpose: sanitizeDisplayText(message.purpose, "私聊说明还没同步。"),
    counterpart: sanitizeDisplayText(message.counterpart, "当前对端身份正在整理中。"),
  };
}

function sanitizeMessageSurfaceEntry(item: MessageSurfaceEntry): MessageSurfaceEntry {
  return {
    ...item,
    channelLabel: sanitizeDisplayText(item.channelLabel, "待整理频道"),
    title: sanitizeDisplayText(item.title, "待整理消息"),
    summary: sanitizeDisplayText(item.summary, "当前消息摘要正在整理中。"),
    note: sanitizeDisplayText(item.note, "当前标注正在整理中。"),
  };
}

function sanitizeSearchResult(item: SearchResult): SearchResult {
  return {
    ...item,
    title: sanitizeDisplayText(item.title, "待整理结果"),
    summary: sanitizeDisplayText(item.summary, "当前搜索摘要正在整理中。"),
    meta: sanitizeDisplayText(item.meta, "当前搜索元信息正在整理中。"),
    keywords: sanitizeDisplayText(item.keywords, "search"),
  };
}

function sanitizeIssue(issue: LiveIssue): LiveIssue {
  return {
    ...issue,
    title: sanitizeDisplayText(issue.title, "待整理任务"),
    summary: sanitizeDisplayText(issue.summary, "这条任务的上下文正在整理，先回到讨论间确认当前状态。"),
    owner: sanitizeDisplayText(issue.owner, "当前处理人正在整理中。"),
    checklist: sanitizeTextLines(issue.checklist, "当前事项清单正在整理中。"),
    pullRequest: sanitizeDisplayText(issue.pullRequest, "待整理 PR"),
  };
}

function sanitizeRoom(room: Room): Room {
  return {
    ...room,
    title: sanitizeDisplayText(room.title, "待整理讨论间"),
    summary: sanitizeDisplayText(room.summary, "当前讨论间的标题和摘要正在整理，先确认最新执行状态。"),
    topic: sanitizeTopic(room.topic),
  };
}

function sanitizeTopic(topic: Topic): Topic {
  return {
    ...topic,
    title: sanitizeDisplayText(topic.title, "待整理话题"),
    owner: sanitizeDisplayText(topic.owner, "当前处理人正在整理中。"),
    summary: sanitizeDisplayText(topic.summary, "当前话题摘要还没同步。"),
  };
}

function sanitizeRun(run: Run): Run {
  return {
    ...run,
    provider: sanitizeDisplayText(run.provider, ""),
    branch: sanitizeDisplayText(run.branch, "待整理分支"),
    worktree: sanitizeDisplayText(run.worktree, "当前 worktree 名称正在整理中。"),
    worktreePath: sanitizeDisplayText(run.worktreePath ?? "", "当前 worktree 路径正在整理中。"),
    owner: sanitizeDisplayText(run.owner, "当前处理人正在整理中。"),
    summary: sanitizeDisplayText(run.summary, "当前执行摘要还没同步。"),
    nextAction: sanitizeDisplayText(run.nextAction, "等待当前执行更新。"),
    pullRequest: sanitizeDisplayText(run.pullRequest, "待整理 PR"),
    credentialProfileIds: sanitizeTextLines(run.credentialProfileIds ?? [], ""),
    stdout: sanitizeTextLines(run.stdout, "这条执行日志包含测试残留或乱码，已在当前工作区隐藏。"),
    stderr: sanitizeTextLines(run.stderr, "这条执行日志包含测试残留或乱码，已在当前工作区隐藏。"),
    toolCalls: run.toolCalls.map(sanitizeToolCall),
    timeline: run.timeline.map(sanitizeRunEvent),
  };
}

function sanitizeRunHistoryEntry(entry: RunHistoryEntry): RunHistoryEntry {
  return {
    ...entry,
    run: sanitizeRun(entry.run),
    room: sanitizeRoom(entry.room),
    issue: sanitizeIssue(entry.issue),
    session: sanitizeSession(entry.session),
  };
}

export function sanitizeRunHistoryPage(page: RunHistoryPage): RunHistoryPage {
  return {
    ...page,
    items: page.items.map(sanitizeRunHistoryEntry),
  };
}

export function sanitizeRunDetail(detail: RunDetail): RunDetail {
  return {
    ...detail,
    run: sanitizeRun(detail.run),
    room: sanitizeRoom(detail.room),
    issue: sanitizeIssue(detail.issue),
    session: sanitizeSession(detail.session),
    recoveryAudit: sanitizeRunRecoveryAudit(detail.recoveryAudit),
    history: detail.history.map(sanitizeRunHistoryEntry),
  };
}

function sanitizeToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    summary: sanitizeDisplayText(call.summary, "当前工具调用摘要正在整理中。"),
    result: sanitizeDisplayText(call.result, "当前工具调用结果正在整理中。"),
  };
}

function sanitizeRunEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    label: sanitizeDisplayText(event.label, "当前时间线事件正在整理中。"),
  };
}

function sanitizeAgent(agent: Agent): Agent {
  return {
    ...agent,
    name: sanitizeDisplayText(agent.name, "OpenShock 智能体"),
    description: sanitizeDisplayText(agent.description, "当前智能体摘要正在整理中。"),
    lane: sanitizeDisplayText(agent.lane, "待整理当前事项"),
    role: sanitizeDisplayText(agent.role, "当前角色正在整理中。"),
    prompt: sanitizeDisplayText(agent.prompt, "当前智能体提示词正在整理中。"),
    operatingInstructions: sanitizeDisplayText(agent.operatingInstructions, "操作说明正在整理中。"),
    provider: sanitizeDisplayText(agent.provider, ""),
    providerPreference: sanitizeDisplayText(agent.providerPreference, ""),
    runtimePreference: sanitizeDisplayText(agent.runtimePreference, ""),
    recallPolicy: sanitizeDisplayText(agent.recallPolicy, ""),
    memorySpaces: sanitizeTextLines(agent.memorySpaces, ""),
    credentialProfileIds: sanitizeTextLines(agent.credentialProfileIds ?? [], ""),
    profileAudit: agent.profileAudit.map((entry) => ({
      ...entry,
      updatedBy: sanitizeDisplayText(entry.updatedBy, "系统"),
      summary: sanitizeDisplayText(entry.summary, "当前档案变更摘要正在整理中。"),
      changes: entry.changes.map((change) => ({
        ...change,
        field: sanitizeDisplayText(change.field, "字段"),
        previous: sanitizeDisplayText(change.previous, ""),
        current: sanitizeDisplayText(change.current, ""),
      })),
    })),
  };
}

function sanitizeRuntimeRecord(runtime: RuntimeRecord): RuntimeRecord {
  return {
    ...runtime,
    workspaceRoot: sanitizeDisplayText(runtime.workspaceRoot, "当前 runtime 工作区路径已隐藏。"),
  };
}

function sanitizeInboxItem(item: InboxItem): InboxItem {
  const actionFallback = inboxItemActionLabel(item.href);
  return {
    ...item,
    title: sanitizeDisplayText(item.title, "待整理信号"),
    room: sanitizeDisplayText(item.room, "待整理讨论间"),
    summary: sanitizeDisplayText(item.summary, "这条决策信号的摘要正在整理中。"),
    action: sanitizeDisplayText(item.action, actionFallback) || actionFallback,
  };
}

function inboxItemActionLabel(href?: string) {
  return hrefTargetLabel(href);
}

function sanitizePullRequest(item: PullRequest): PullRequest {
  return {
    ...item,
    label: sanitizeDisplayText(item.label, "待整理 PR"),
    title: sanitizeDisplayText(item.title, "待整理 PR"),
    branch: sanitizeDisplayText(item.branch, "待整理分支"),
    baseBranch: sanitizeDisplayText(item.baseBranch ?? "", "当前 base 分支正在整理中。"),
    author: sanitizeDisplayText(item.author, "当前作者正在整理中。"),
    provider: sanitizeDisplayText(item.provider ?? "", ""),
    reviewSummary: sanitizeDisplayText(item.reviewSummary, "当前 review 摘要正在整理中。"),
    conversation: item.conversation?.map(sanitizePullRequestConversationEntry),
  };
}

function sanitizeAgentHandoff(item: AgentHandoff): AgentHandoff {
  const kindLabelFallback = agentHandoffKindLabel(item.kind);
  return {
    ...item,
    kindLabel: sanitizeDisplayText(item.kindLabel ?? "", kindLabelFallback) || kindLabelFallback,
    parentHandoffId: sanitizeDisplayText(item.parentHandoffId ?? "", ""),
    title: sanitizeDisplayText(item.title, "待整理交接"),
    summary: sanitizeDisplayText(item.summary, "当前交接摘要正在整理中。"),
    fromAgent: sanitizeDisplayText(item.fromAgent, "来源智能体"),
    toAgent: sanitizeDisplayText(item.toAgent, "目标智能体"),
    lastAction: sanitizeDisplayText(item.lastAction, "等待交接同步。"),
    lastNote: sanitizeDisplayText(item.lastNote ?? "", ""),
    autoFollowup: item.autoFollowup
      ? {
          ...item.autoFollowup,
          status: sanitizeDisplayText(item.autoFollowup.status ?? "", ""),
          summary: sanitizeDisplayText(item.autoFollowup.summary ?? "", "当前自动接棒摘要正在整理中。"),
          updatedAt: sanitizeDisplayText(item.autoFollowup.updatedAt ?? "", ""),
        }
      : undefined,
    messages: item.messages.map(sanitizeMailboxMessage),
  };
}

function agentHandoffKindLabel(kind?: string) {
  switch ((kind ?? "").trim()) {
    case "room-auto":
      return "房间接棒";
    case "governed":
      return "自动交接";
    case "delivery-closeout":
      return "交付收尾";
    case "delivery-reply":
      return "补充回复";
    default:
      return "手动交接";
  }
}

function sanitizeRoomAgentWait(item: RoomAgentWait): RoomAgentWait {
  return {
    ...item,
    agent: sanitizeDisplayText(item.agent, "当前等待中的智能体"),
    blockingMessageId: sanitizeDisplayText(item.blockingMessageId ?? "", ""),
  };
}

function sanitizeMailboxMessage(item: MailboxMessage): MailboxMessage {
  return {
    ...item,
    authorName: sanitizeDisplayText(item.authorName, "OpenShock 智能体"),
    body: sanitizeDisplayText(item.body, "当前 mailbox 消息正在整理中。"),
  };
}

function sanitizePullRequestConversationEntry(item: PullRequestConversationEntry): PullRequestConversationEntry {
  return {
    ...item,
    author: sanitizeDisplayText(item.author, "GitHub"),
    summary: sanitizeDisplayText(item.summary, "当前 PR 对话摘要正在整理中。"),
    body: sanitizeDisplayText(item.body ?? "", "当前 PR 对话内容正在整理中。"),
    path: sanitizeDisplayText(item.path ?? "", ""),
  };
}

function sanitizeSession(session: Session): Session {
  return {
    ...session,
    recovery: session.recovery
      ? {
          ...session.recovery,
          summary: sanitizeDisplayText(session.recovery.summary ?? "", "当前恢复摘要正在整理中。"),
          preview: sanitizeDisplayText(session.recovery.preview ?? "", "当前恢复预览正在整理中。"),
          replayAnchor: sanitizeDisplayText(session.recovery.replayAnchor ?? "", ""),
          lastSource: sanitizeDisplayText(session.recovery.lastSource ?? "", ""),
          lastError: sanitizeDisplayText(session.recovery.lastError ?? "", ""),
          events: (session.recovery.events ?? []).map((event) => ({
            ...event,
            status: sanitizeDisplayText(event.status ?? "", ""),
            source: sanitizeDisplayText(event.source ?? "", ""),
            summary: sanitizeDisplayText(event.summary ?? "", "当前恢复事件摘要正在整理中。"),
          })),
        }
      : undefined,
    controlNote: sanitizeDisplayText(session.controlNote ?? "", "当前执行备注还没同步。"),
    provider: sanitizeDisplayText(session.provider, ""),
    branch: sanitizeDisplayText(session.branch, "待整理分支"),
    worktree: sanitizeDisplayText(session.worktree, "当前 worktree 名称正在整理中。"),
    worktreePath: sanitizeDisplayText(session.worktreePath, "当前 worktree 路径正在整理中。"),
    summary: sanitizeDisplayText(session.summary, "当前会话摘要正在整理中。"),
    memoryPaths: sanitizeTextLines(session.memoryPaths, "当前 session 记忆路径正在整理中。"),
  };
}

function sanitizeRunRecoveryAudit(item: RunDetail["recoveryAudit"]): RunDetail["recoveryAudit"] {
  const sanitizeHandoffFollowup = (followup: NonNullable<RunDetail["recoveryAudit"]["handoffAutoFollowup"]>) => ({
    ...followup,
    kind: sanitizeDisplayText(followup.kind ?? "", ""),
    handoffId: sanitizeDisplayText(followup.handoffId ?? "", ""),
    toAgentId: sanitizeDisplayText(followup.toAgentId ?? "", ""),
    toAgent: sanitizeDisplayText(followup.toAgent ?? "", ""),
    status: sanitizeDisplayText(followup.status ?? "", ""),
    summary: sanitizeDisplayText(followup.summary ?? "", "交接继续摘要正在整理中。"),
    lastAction: sanitizeDisplayText(followup.lastAction ?? "", "交接继续动作正在整理中。"),
  });

  return {
    ...item,
    status: sanitizeDisplayText(item.status ?? "", ""),
    source: sanitizeDisplayText(item.source ?? "", ""),
    summary: sanitizeDisplayText(item.summary ?? "", "当前恢复摘要正在整理中。"),
    preview: sanitizeDisplayText(item.preview ?? "", "当前恢复预览正在整理中。"),
    sessionReplay: sanitizeDisplayText(item.sessionReplay ?? "", ""),
    handoffAutoFollowup: item.handoffAutoFollowup ? sanitizeHandoffFollowup(item.handoffAutoFollowup) : undefined,
    roomAutoFollowup: item.roomAutoFollowup ? sanitizeHandoffFollowup(item.roomAutoFollowup) : undefined,
    runtimeReplay: item.runtimeReplay
      ? {
          ...item.runtimeReplay,
          replayAnchor: sanitizeDisplayText(item.runtimeReplay.replayAnchor ?? "", ""),
          status: sanitizeDisplayText(item.runtimeReplay.status ?? "", ""),
          summary: sanitizeDisplayText(item.runtimeReplay.summary ?? "", "当前执行回放摘要正在整理中。"),
          closeoutReason: sanitizeDisplayText(item.runtimeReplay.closeoutReason ?? "", ""),
        }
      : undefined,
  };
}

function sanitizeRuntimeLease(item: RuntimeLease): RuntimeLease {
  return {
    ...item,
    branch: sanitizeDisplayText(item.branch ?? "", "待整理分支"),
    worktreeName: sanitizeDisplayText(item.worktreeName ?? "", "当前 worktree 名称正在整理中。"),
    worktreePath: sanitizeDisplayText(item.worktreePath ?? "", "当前 worktree 路径正在整理中。"),
    cwd: sanitizeDisplayText(item.cwd ?? "", "当前工作目录正在整理中。"),
    summary: sanitizeDisplayText(item.summary ?? "", "当前 runtime lease 摘要正在整理中。"),
  };
}

function sanitizeRuntimeScheduler(item: RuntimeScheduler): RuntimeScheduler {
  return {
    ...item,
    selectedRuntime: sanitizeDisplayText(item.selectedRuntime ?? "", ""),
    preferredRuntime: sanitizeDisplayText(item.preferredRuntime ?? "", "当前首选运行环境正在整理中。"),
    assignedRuntime: sanitizeDisplayText(item.assignedRuntime ?? "", "当前分配运行环境正在整理中。"),
    assignedMachine: sanitizeDisplayText(item.assignedMachine ?? "", "当前分配机器正在整理中。"),
    failoverFrom: sanitizeDisplayText(item.failoverFrom ?? "", ""),
    summary: sanitizeDisplayText(item.summary ?? "", "当前运行环境调度摘要正在整理中。"),
    candidates: (item.candidates ?? []).map(sanitizeRuntimeSchedulerCandidate),
  };
}

function sanitizeRuntimeSchedulerCandidate(item: RuntimeSchedulerCandidate): RuntimeSchedulerCandidate {
  return {
    ...item,
    runtime: sanitizeDisplayText(item.runtime ?? "", "待整理运行环境"),
    machine: sanitizeDisplayText(item.machine ?? "", "待整理机器"),
    reason: sanitizeDisplayText(item.reason ?? "", "当前安排原因正在整理中。"),
  };
}

function sanitizePlannerQueueItem(item: PlannerQueueRecord): PlannerQueueRecord {
  return {
    ...item,
    issueKey: sanitizeDisplayText(item.issueKey, "待整理 issue"),
    summary: sanitizeDisplayText(item.summary, "当前 planner queue 摘要正在整理中。"),
    owner: sanitizeDisplayText(item.owner, "待整理处理人"),
    agentName: sanitizeDisplayText(item.agentName ?? "", ""),
    provider: sanitizeDisplayText(item.provider, "待整理 provider"),
    runtime: sanitizeDisplayText(item.runtime, "待整理 runtime"),
    machine: sanitizeDisplayText(item.machine, "待整理 machine"),
    worktreePath: sanitizeDisplayText(item.worktreePath ?? "", "当前 worktree 路径正在整理中。"),
    pullRequestLabel: sanitizeDisplayText(item.pullRequestLabel ?? "", ""),
    reviewDecision: sanitizeDisplayText(item.reviewDecision ?? "", ""),
    gates: (item.gates ?? []).map((gate) => ({
      ...gate,
      title: sanitizeDisplayText(gate.title, "待整理 gate"),
      summary: sanitizeDisplayText(gate.summary, "当前 planner gate 摘要正在整理中。"),
      href: sanitizeDisplayText(gate.href, ""),
    })),
    autoMerge: {
      ...item.autoMerge,
      reason: sanitizeDisplayText(item.autoMerge.reason, "当前 auto-merge guard 正在整理中。"),
      requiresPermission: sanitizeDisplayText(item.autoMerge.requiresPermission ?? "", ""),
      reviewDecision: sanitizeDisplayText(item.autoMerge.reviewDecision ?? "", ""),
    },
  };
}

function sanitizeMemoryArtifact(item: MemoryArtifact): MemoryArtifact {
  return {
    ...item,
    scope: sanitizeDisplayText(item.scope, "memory:current"),
    path: sanitizeDisplayText(item.path, "notes/current-artifact.md"),
    summary: sanitizeDisplayText(item.summary, "当前记忆摘要正在整理中。"),
    latestSource: sanitizeDisplayText(item.latestSource ?? "", ""),
    latestActor: sanitizeDisplayText(item.latestActor ?? "", ""),
    lastCorrectionBy: sanitizeDisplayText(item.lastCorrectionBy ?? "", ""),
    lastCorrectionNote: sanitizeDisplayText(item.lastCorrectionNote ?? "", ""),
    forgottenBy: sanitizeDisplayText(item.forgottenBy ?? "", ""),
    forgetReason: sanitizeDisplayText(item.forgetReason ?? "", ""),
    governance: item.governance
      ? {
          ...item.governance,
          mode: sanitizeDisplayText(item.governance.mode ?? "", ""),
          escalation: sanitizeDisplayText(item.governance.escalation ?? "", ""),
        }
      : item.governance,
  };
}

function sanitizeCredentialProfile(item: CredentialProfile): CredentialProfile {
  return {
    ...item,
    label: sanitizeDisplayText(item.label, "credential"),
    summary: sanitizeDisplayText(item.summary, "当前 credential 摘要正在整理中。"),
    secretKind: sanitizeDisplayText(item.secretKind, "opaque-secret"),
    secretStatus: sanitizeDisplayText(item.secretStatus, "configured"),
    updatedBy: sanitizeDisplayText(item.updatedBy, "系统"),
    lastUsedBy: sanitizeDisplayText(item.lastUsedBy ?? "", ""),
    audit: (item.audit ?? []).map((entry) => ({
      ...entry,
      action: sanitizeDisplayText(entry.action, "updated"),
      summary: sanitizeDisplayText(entry.summary, "当前 credential audit 正在整理中。"),
      updatedBy: sanitizeDisplayText(entry.updatedBy, "系统"),
    })),
  };
}

function sanitizeTextLines(lines: string[], fallback: string) {
  return lines.map((line) => sanitizeDisplayText(line, fallback));
}

function sanitizeDisplayText(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const rewritten = rewriteCustomerFacingText(trimmed);
  return looksLikeLiveTruthLeak(rewritten) ? fallback : rewritten;
}

export function rewriteCustomerFacingText(value: string) {
  if (!value) {
    return value;
  }
  let next = value;
  for (const [from, to] of CUSTOMER_FACING_LITERAL_REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  next = next.replace(RUNTIME_SCHEDULER_FALLBACK_STATE, "当前仍指向工作区默认运行环境 $1。");
  next = next.replace(RUNTIME_SCHEDULER_OWNER_SUMMARY, "已按 $1 偏好安排到 $2，当前有 $3 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_SELECTED_SUMMARY, "继续使用 $1，当前有 $2 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_FAILOVER_SUMMARY, "$1 当前不可用，已切到 $2，当前有 $3 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_LEAST_LOADED_SUMMARY, "已安排到 $1，当前有 $2 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_OWNER_REASON, "按智能体偏好安排，当前有 $1 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_SELECTED_REASON, "沿用当前选择，当前有 $1 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_FAILOVER_REASON, "承接 $1 的切换，当前有 $2 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_PRESSURE_REASON, "按当前压力安排，当前有 $1 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_STATE_REASON, (_match, state: string) => `当前${runtimeSchedulerStateLabel(state)}，暂不可调度。`);
  next = next.replace(RUNTIME_SCHEDULER_PREFERRED_SKIP, "首选运行环境暂不可调度，已跳过。");
  next = next.replace(RUNTIME_SCHEDULER_ACTIVE_LEASE, "当前有 $1 条执行。");
  next = next.replace(RUNTIME_SCHEDULER_UNAVAILABLE, "当前没有可用运行环境。");
  next = next.replace(RUNTIME_SCHEDULER_OPEN_LANE, "可以接新事项。");
  next = next.replace(RUNTIME_SCHEDULER_UNPAIRED, "还没配对，暂不可调度。");
  next = next.replace(RUNTIME_SCHEDULER_TIMELINE_FAILOVER, "运行环境已切到 $1");
  next = next.replace(RUNTIME_SCHEDULER_TIMELINE_ASSIGNED, "运行环境已分配到 $1");
  return next;
}

function runtimeSchedulerStateLabel(state: string) {
  switch (state.trim()) {
    case "offline":
      return "离线";
    case "stale":
      return "心跳过期";
    default:
      return state.trim();
  }
}

function looksLikeLiveTruthLeak(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    LIVE_TRUTH_QUESTION_BURST.test(trimmed) ||
    LIVE_TRUTH_E2E_RESIDUE.test(trimmed) ||
    LIVE_TRUTH_PLACEHOLDER_RESIDUE.test(trimmed) ||
    LIVE_TRUTH_MOCK_RESIDUE.test(trimmed) ||
    LIVE_TRUTH_INTERNAL_PATH_RESIDUE.test(trimmed)
  );
}

function fallbackSpeaker(role: Message["role"]) {
  switch (role) {
    case "human":
      return "工作区成员";
    case "agent":
      return "OpenShock 智能体";
    default:
      return "系统";
  }
}
