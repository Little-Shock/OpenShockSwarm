import type { Issue, PhaseZeroState, PlannerQueueItem, RunDetail, RunHistoryPage } from "@/lib/phase-zero-types";

const LIVE_TRUTH_QUESTION_BURST = /\?{2,}/;
const LIVE_TRUTH_E2E_RESIDUE = /\bE2E\b.*\b20\d{6,}\b/i;
const LIVE_TRUTH_PLACEHOLDER_RESIDUE = /\bplaceholder\b|\bfixture\b|\btest-only\b/i;
const LIVE_TRUTH_MOCK_RESIDUE = /本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace/;
const LIVE_TRUTH_INTERNAL_PATH_RESIDUE = /[A-Za-z]:\\|\/tmp\/openshock|\/home\/lark\/OpenShock|\.openshock-worktrees|\.slock\//;

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
    { title: "Backlog", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "blocked") },
    { title: "Todo", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "queued") },
    { title: "In Progress", accent: "var(--shock-yellow)", cards: issueList.filter((issue) => issue.state === "running") },
    { title: "Paused", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "paused") },
    { title: "In Review", accent: "var(--shock-lime)", cards: issueList.filter((issue) => issue.state === "review") },
    { title: "Done", accent: "white", cards: issueList.filter((issue) => issue.state === "done") },
  ];
}

export function buildGlobalStats(state: PhaseZeroState) {
  const activeRuns = state.runs.filter((run) => run.status === "running" || run.status === "review").length;
  const blockedCount = state.runs.filter((run) => run.status === "blocked" || run.status === "paused").length;

  return [
    { label: "活跃 Run", value: String(activeRuns).padStart(2, "0"), tone: "yellow" as const },
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

export function sanitizePhaseZeroState(state: PhaseZeroState): PhaseZeroState {
  return {
    ...state,
    workspace: sanitizeWorkspace(state.workspace),
    channels: state.channels.map(sanitizeChannel),
    channelMessages: mapRecord(state.channelMessages, sanitizeMessage),
    directMessages: state.directMessages.map(sanitizeDirectMessage),
    directMessageMessages: mapRecord(state.directMessageMessages, sanitizeMessage),
    followedThreads: state.followedThreads.map(sanitizeMessageSurfaceEntry),
    savedLaterItems: state.savedLaterItems.map(sanitizeMessageSurfaceEntry),
    quickSearchEntries: state.quickSearchEntries.map(sanitizeSearchResult),
    issues: state.issues.map(sanitizeIssue),
    rooms: state.rooms.map(sanitizeRoom),
    roomMessages: mapRecord(state.roomMessages, sanitizeMessage),
    runs: state.runs.map(sanitizeRun),
    agents: state.agents.map(sanitizeAgent),
    runtimes: state.runtimes.map(sanitizeRuntimeRecord),
    inbox: state.inbox.map(sanitizeInboxItem),
    mailbox: (state.mailbox ?? []).map(sanitizeAgentHandoff),
    pullRequests: state.pullRequests.map(sanitizePullRequest),
    sessions: state.sessions.map(sanitizeSession),
    runtimeLeases: state.runtimeLeases.map(sanitizeRuntimeLease),
    memory: state.memory.map(sanitizeMemoryArtifact),
    credentials: (state.credentials ?? []).map(sanitizeCredentialProfile),
  };
}

export function sanitizePlannerQueue(items: PlannerQueueItem[]) {
  return items.map(sanitizePlannerQueueItem);
}

function mapRecord<T>(record: Record<string, T[]>, sanitize: (item: T) => T) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.map(sanitize)]));
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
    governance: sanitizeWorkspaceGovernance(workspace.governance),
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
    summary: sanitizeDisplayText(safeGovernance.summary ?? "", "当前多 Agent 治理摘要正在整理中。"),
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
    summary: sanitizeDisplayText(issue.summary, "这条任务的上下文正在整理，先回到讨论间查看当前 live truth。"),
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
    title: sanitizeDisplayText(topic.title, "待整理 Topic"),
    summary: sanitizeDisplayText(topic.summary, "当前 Topic 的摘要正在整理中。"),
  };
}

function sanitizeRun(run: Run): Run {
  return {
    ...run,
    branch: sanitizeDisplayText(run.branch, "待整理分支"),
    worktree: sanitizeDisplayText(run.worktree, "当前 worktree 名称正在整理中。"),
    worktreePath: sanitizeDisplayText(run.worktreePath ?? "", "当前 worktree 路径正在整理中。"),
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
    description: sanitizeDisplayText(agent.description, "当前 Agent 摘要正在整理中。"),
    lane: sanitizeDisplayText(agent.lane, "待整理泳道"),
    credentialProfileIds: sanitizeTextLines(agent.credentialProfileIds ?? [], ""),
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
    title: sanitizeDisplayText(item.title, "待整理 PR"),
    branch: sanitizeDisplayText(item.branch, "待整理分支"),
    baseBranch: sanitizeDisplayText(item.baseBranch ?? "", "当前 base 分支正在整理中。"),
    reviewSummary: sanitizeDisplayText(item.reviewSummary, "当前 review 摘要正在整理中。"),
    conversation: item.conversation?.map(sanitizePullRequestConversationEntry),
  };
}

function sanitizeAgentHandoff(item: AgentHandoff): AgentHandoff {
  return {
    ...item,
    title: sanitizeDisplayText(item.title, "待整理交接"),
    summary: sanitizeDisplayText(item.summary, "当前 handoff 摘要正在整理中。"),
    fromAgent: sanitizeDisplayText(item.fromAgent, "来源 Agent"),
    toAgent: sanitizeDisplayText(item.toAgent, "目标 Agent"),
    lastAction: sanitizeDisplayText(item.lastAction, "等待 handoff 同步。"),
    lastNote: sanitizeDisplayText(item.lastNote ?? "", ""),
    messages: item.messages.map(sanitizeMailboxMessage),
  };
}

function sanitizeMailboxMessage(item: MailboxMessage): MailboxMessage {
  return {
    ...item,
    authorName: sanitizeDisplayText(item.authorName, "OpenShock Agent"),
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
    controlNote: sanitizeDisplayText(session.controlNote ?? "", "当前控制说明正在整理中。"),
    branch: sanitizeDisplayText(session.branch, "待整理分支"),
    worktree: sanitizeDisplayText(session.worktree, "当前 worktree 名称正在整理中。"),
    worktreePath: sanitizeDisplayText(session.worktreePath, "当前 worktree 路径正在整理中。"),
    summary: sanitizeDisplayText(session.summary, "当前会话摘要正在整理中。"),
    memoryPaths: sanitizeTextLines(session.memoryPaths, "当前 session 记忆路径正在整理中。"),
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
  };
}

function sanitizeCredentialProfile(item: CredentialProfile): CredentialProfile {
  return {
    ...item,
    label: sanitizeDisplayText(item.label, "credential"),
    summary: sanitizeDisplayText(item.summary, "当前 credential 摘要正在整理中。"),
    secretKind: sanitizeDisplayText(item.secretKind, "opaque-secret"),
    secretStatus: sanitizeDisplayText(item.secretStatus, "configured"),
    updatedBy: sanitizeDisplayText(item.updatedBy, "System"),
    lastUsedBy: sanitizeDisplayText(item.lastUsedBy ?? "", ""),
    audit: (item.audit ?? []).map((entry) => ({
      ...entry,
      action: sanitizeDisplayText(entry.action, "updated"),
      summary: sanitizeDisplayText(entry.summary, "当前 credential audit 正在整理中。"),
      updatedBy: sanitizeDisplayText(entry.updatedBy, "System"),
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
  return looksLikeLiveTruthLeak(trimmed) ? fallback : trimmed;
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
      return "Workspace Member";
    case "agent":
      return "OpenShock Agent";
    default:
      return "System";
  }
}
