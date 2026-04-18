import type { Issue, PhaseZeroState, PlannerQueueItem, RunDetail, RunHistoryPage } from "@/lib/phase-zero-types";

const LIVE_TRUTH_QUESTION_BURST = /\?{2,}/;
const LIVE_TRUTH_E2E_RESIDUE = /\bE2E\b.*\b20\d{6,}\b/i;
const LIVE_TRUTH_PLACEHOLDER_RESIDUE = /\bplaceholder\b|\bfixture\b|\btest-only\b/i;
const LIVE_TRUTH_MOCK_RESIDUE = /本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace/;
const LIVE_TRUTH_INTERNAL_PATH_RESIDUE = /[A-Za-z]:\\|\/tmp\/openshock|\/home\/lark\/OpenShock|\.openshock-worktrees|\.slock\//;
const CUSTOMER_FACING_LITERAL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["@Codex Dockmaster", "@主执行智能体"],
  ["Claude Review Runner", "评审智能体"],
  ["Codex Dockmaster", "主执行智能体"],
  ["Memory Clerk", "记忆智能体"],
  ["Spec Captain", "需求智能体"],
  ["Build Pilot", "开发智能体"],
  ["Review Runner", "评审智能体"],
  ["QA Relay", "测试智能体"],
  ["Lead Operator", "总控智能体"],
  ["Field Collector", "一线采集"],
  ["Research Lead", "研究负责人"],
  ["Peer Reviewer", "交叉复核"],
  ["Publisher", "发布收尾"],
  ["Synthesizer", "归纳智能体"],
  ["Collector", "采集智能体"],
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
  const paths = ["MEMORY.md", "notes/work-log.md"];
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
    name: sanitizeDisplayText(workspace.name, "当前工作区名称正在整理中。"),
    repo: sanitizeDisplayText(workspace.repo, "当前仓库真值正在整理中。"),
    repoUrl: sanitizeDisplayText(workspace.repoUrl, ""),
    branch: sanitizeDisplayText(workspace.branch, "待整理分支"),
    repoProvider: sanitizeDisplayText(workspace.repoProvider, "待整理仓库提供方"),
    repoBindingStatus: sanitizeDisplayText(workspace.repoBindingStatus, "当前绑定状态正在整理中。"),
    repoAuthMode: sanitizeDisplayText(workspace.repoAuthMode, "当前认证模式正在整理中。"),
    plan: sanitizeDisplayText(workspace.plan, "当前工作区计划正在整理中。"),
    pairedRuntime: sanitizeDisplayText(workspace.pairedRuntime, "当前 runtime 真值正在整理中。"),
    pairedRuntimeUrl: sanitizeDisplayText(workspace.pairedRuntimeUrl, ""),
    pairingStatus: sanitizeDisplayText(workspace.pairingStatus, "当前配对状态正在整理中。"),
    deviceAuth: sanitizeDisplayText(workspace.deviceAuth, "当前设备认证状态正在整理中。"),
    browserPush: sanitizeDisplayText(workspace.browserPush, "当前浏览器推送策略正在整理中。"),
    memoryMode: sanitizeDisplayText(workspace.memoryMode, "当前记忆模式正在整理中。"),
    repoBinding: {
      ...workspace.repoBinding,
      repo: sanitizeDisplayText(workspace.repoBinding?.repo ?? "", "当前仓库真值正在整理中。"),
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
      roles: sanitizeTextLines(onboarding?.materialization?.roles ?? [], ""),
      agents: sanitizeTextLines(onboarding?.materialization?.agents ?? [], ""),
      notificationPolicy: sanitizeDisplayText(onboarding?.materialization?.notificationPolicy ?? "", ""),
      notes: sanitizeTextLines(onboarding?.materialization?.notes ?? [], ""),
    },
  };
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

  return {
    ...safeGovernance,
    label: sanitizeDisplayText(safeGovernance.label ?? "", "当前治理链正在整理中。"),
    summary: sanitizeDisplayText(safeGovernance.summary ?? "", "当前多智能体治理摘要正在整理中。"),
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
        label: sanitizeDisplayText(safeLane.label, "未命名治理角色"),
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
        label: sanitizeDisplayText(safeLane.label, "未命名治理角色"),
        role: sanitizeDisplayText(safeLane.role, "当前职责正在整理中。"),
        defaultAgent: sanitizeDisplayText(safeLane.defaultAgent ?? "", ""),
        lane: sanitizeDisplayText(safeLane.lane ?? "", ""),
        summary: sanitizeDisplayText(safeLane.summary, "当前治理 lane 正在整理中。"),
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
        label: sanitizeDisplayText(safeRule.label, "未命名治理规则"),
        summary: sanitizeDisplayText(safeRule.summary, "当前治理规则正在整理中。"),
        href: sanitizeDisplayText(safeRule.href ?? "", ""),
      };
    }),
    routingPolicy: {
      ...safeGovernance.routingPolicy,
      summary: sanitizeDisplayText(safeGovernance.routingPolicy?.summary, "当前 routing policy 正在整理中。"),
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
        }),
        reason: sanitizeDisplayText(
          safeGovernance.routingPolicy?.suggestedHandoff?.reason ?? "",
          "当前 governed handoff 建议正在整理中。"
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
          policy: sanitizeDisplayText(safeRoute.policy, "当前路由策略正在整理中。"),
          summary: sanitizeDisplayText(safeRoute.summary, "当前 routing rule 正在整理中。"),
        };
      }),
    },
    escalationSla: {
      ...safeGovernance.escalationSla,
      summary: sanitizeDisplayText(safeGovernance.escalationSla?.summary, "当前 escalation SLA 正在整理中。"),
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
          label: sanitizeDisplayText(safeEntry.label, "未命名 escalation"),
          status: sanitizeDisplayText(safeEntry.status, "pending"),
          source: sanitizeDisplayText(safeEntry.source, "governance"),
          owner: sanitizeDisplayText(safeEntry.owner ?? "", ""),
          summary: sanitizeDisplayText(safeEntry.summary, "当前 escalation 条目正在整理中。"),
          nextStep: sanitizeDisplayText(safeEntry.nextStep, "当前 escalation 下一步正在整理中。"),
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
          href: "",
        };
        return {
          ...safeEntry,
          roomId: sanitizeDisplayText(safeEntry.roomId, ""),
          roomTitle: sanitizeDisplayText(safeEntry.roomTitle, "未命名讨论间"),
          status: sanitizeDisplayText(safeEntry.status, "pending"),
          currentOwner: sanitizeDisplayText(safeEntry.currentOwner ?? "", ""),
          currentLane: sanitizeDisplayText(safeEntry.currentLane ?? "", ""),
          latestSource: sanitizeDisplayText(safeEntry.latestSource ?? "", "governance"),
          latestLabel: sanitizeDisplayText(safeEntry.latestLabel ?? "", "未命名 escalation"),
          latestSummary: sanitizeDisplayText(safeEntry.latestSummary ?? "", "当前 room escalation 正在整理中。"),
          nextRouteStatus: sanitizeDisplayText(safeEntry.nextRouteStatus ?? "", "pending"),
          nextRouteLabel: sanitizeDisplayText(safeEntry.nextRouteLabel ?? "", ""),
          nextRouteSummary: sanitizeDisplayText(safeEntry.nextRouteSummary ?? "", "当前 governed route 正在整理中。"),
          nextRouteHref: sanitizeDisplayText(safeEntry.nextRouteHref ?? "", ""),
          href: sanitizeDisplayText(safeEntry.href ?? "", ""),
        };
      }),
    },
    notificationPolicy: {
      ...safeGovernance.notificationPolicy,
      summary: sanitizeDisplayText(safeGovernance.notificationPolicy?.summary, "当前 notification policy 正在整理中。"),
      browserPush: sanitizeDisplayText(safeGovernance.notificationPolicy?.browserPush ?? "", ""),
      escalationChannel: sanitizeDisplayText(safeGovernance.notificationPolicy?.escalationChannel ?? "", ""),
      targets: (safeGovernance.notificationPolicy?.targets ?? []).map((target) => sanitizeDisplayText(target, "target")),
    },
    responseAggregation: {
      ...safeGovernance.responseAggregation,
      summary: sanitizeDisplayText(safeGovernance.responseAggregation?.summary, "当前 response aggregation 正在整理中。"),
      finalResponse: sanitizeDisplayText(safeGovernance.responseAggregation?.finalResponse ?? "", "等待当前治理链收口。"),
      aggregator: sanitizeDisplayText(safeGovernance.responseAggregation?.aggregator ?? "", ""),
      sources: (safeGovernance.responseAggregation?.sources ?? []).map((source) => sanitizeDisplayText(source, "live source")),
      decisionPath: (safeGovernance.responseAggregation?.decisionPath ?? []).map((item) => sanitizeDisplayText(item, "live step")),
      overrideTrace: (safeGovernance.responseAggregation?.overrideTrace ?? []).map((item) => sanitizeDisplayText(item, "override trace")),
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
          label: sanitizeDisplayText(safeEntry.label, "未命名聚合审计"),
          actor: sanitizeDisplayText(safeEntry.actor ?? "", ""),
          summary: sanitizeDisplayText(safeEntry.summary, "当前 aggregation audit 正在整理中。"),
          occurredAt: sanitizeDisplayText(safeEntry.occurredAt ?? "", ""),
        };
      }),
    },
    humanOverride: {
      ...safeGovernance.humanOverride,
      summary: sanitizeDisplayText(safeGovernance.humanOverride?.summary, "当前 human override 状态正在整理中。"),
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
        label: sanitizeDisplayText(safeStep.label, "未命名治理步骤"),
        summary: sanitizeDisplayText(safeStep.summary, "当前治理步骤正在整理中。"),
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
    purpose: sanitizeDisplayText(channel.purpose, "当前频道说明正在整理中。"),
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
    summary: sanitizeDisplayText(message.summary, "当前私信摘要正在整理中。"),
    purpose: sanitizeDisplayText(message.purpose, "当前私信用途正在整理中。"),
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
    summary: sanitizeDisplayText(issue.summary, "这条任务的上下文正在整理，先回到讨论间查看当前真实状态。"),
    owner: sanitizeDisplayText(issue.owner, "当前负责人正在整理中。"),
    checklist: sanitizeTextLines(issue.checklist, "当前事项清单正在整理中。"),
    pullRequest: sanitizeDisplayText(issue.pullRequest, "待整理 PR"),
  };
}

function sanitizeRoom(room: Room): Room {
  return {
    ...room,
    title: sanitizeDisplayText(room.title, "待整理讨论间"),
    summary: sanitizeDisplayText(room.summary, "当前讨论间的标题和摘要正在整理，先查看最新执行真相。"),
    topic: sanitizeTopic(room.topic),
  };
}

function sanitizeTopic(topic: Topic): Topic {
  return {
    ...topic,
    title: sanitizeDisplayText(topic.title, "待整理话题"),
    owner: sanitizeDisplayText(topic.owner, "当前负责人正在整理中。"),
    summary: sanitizeDisplayText(topic.summary, "当前 Topic 的摘要正在整理中。"),
  };
}

function sanitizeRun(run: Run): Run {
  return {
    ...run,
    provider: sanitizeDisplayText(run.provider, ""),
    branch: sanitizeDisplayText(run.branch, "待整理分支"),
    worktree: sanitizeDisplayText(run.worktree, "当前 worktree 名称正在整理中。"),
    worktreePath: sanitizeDisplayText(run.worktreePath ?? "", "当前 worktree 路径正在整理中。"),
    owner: sanitizeDisplayText(run.owner, "当前负责人正在整理中。"),
    summary: sanitizeDisplayText(run.summary, "当前 Run 正在整理执行摘要。"),
    nextAction: sanitizeDisplayText(run.nextAction, "等待当前执行真相同步。"),
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
    lane: sanitizeDisplayText(agent.lane, "待整理泳道"),
    role: sanitizeDisplayText(agent.role, "当前角色正在整理中。"),
    prompt: sanitizeDisplayText(agent.prompt, "当前智能体提示词正在整理中。"),
    operatingInstructions: sanitizeDisplayText(agent.operatingInstructions, "当前操作说明正在整理中。"),
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
  return {
    ...item,
    title: sanitizeDisplayText(item.title, "待整理信号"),
    room: sanitizeDisplayText(item.room, "待整理讨论间"),
    summary: sanitizeDisplayText(item.summary, "这条决策信号的摘要正在整理中。"),
    action: sanitizeDisplayText(item.action, "查看详情"),
  };
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
  return {
    ...item,
    parentHandoffId: sanitizeDisplayText(item.parentHandoffId ?? "", ""),
    title: sanitizeDisplayText(item.title, "待整理交接"),
    summary: sanitizeDisplayText(item.summary, "当前 handoff 摘要正在整理中。"),
    fromAgent: sanitizeDisplayText(item.fromAgent, "来源智能体"),
    toAgent: sanitizeDisplayText(item.toAgent, "目标智能体"),
    lastAction: sanitizeDisplayText(item.lastAction, "等待 handoff 同步。"),
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
    controlNote: sanitizeDisplayText(session.controlNote ?? "", "当前控制说明正在整理中。"),
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
    summary: sanitizeDisplayText(followup.summary ?? "", "当前交接继续摘要正在整理中。"),
    lastAction: sanitizeDisplayText(followup.lastAction ?? "", "当前交接继续动作正在整理中。"),
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
          summary: sanitizeDisplayText(item.runtimeReplay.summary ?? "", "当前 runtime replay 摘要正在整理中。"),
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

function sanitizePlannerQueueItem(item: PlannerQueueRecord): PlannerQueueRecord {
  return {
    ...item,
    issueKey: sanitizeDisplayText(item.issueKey, "待整理 issue"),
    summary: sanitizeDisplayText(item.summary, "当前 planner queue 摘要正在整理中。"),
    owner: sanitizeDisplayText(item.owner, "待整理 owner"),
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
  return next;
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
