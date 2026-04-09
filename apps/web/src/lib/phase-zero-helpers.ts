import type { Issue, PhaseZeroState } from "@/lib/phase-zero-types";

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
type ToolCall = Run["toolCalls"][number];
type RunEvent = Run["timeline"][number];
type Agent = PhaseZeroState["agents"][number];
type RuntimeRecord = PhaseZeroState["runtimes"][number];
type InboxItem = PhaseZeroState["inbox"][number];
type PullRequest = PhaseZeroState["pullRequests"][number];
type PullRequestConversationEntry = NonNullable<PullRequest["conversation"]>[number];
type Session = PhaseZeroState["sessions"][number];
type RuntimeLease = PhaseZeroState["runtimeLeases"][number];
type MemoryArtifact = PhaseZeroState["memory"][number];

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
    pullRequests: state.pullRequests.map(sanitizePullRequest),
    sessions: state.sessions.map(sanitizeSession),
    runtimeLeases: state.runtimeLeases.map(sanitizeRuntimeLease),
    memory: state.memory.map(sanitizeMemoryArtifact),
  };
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
    stdout: sanitizeTextLines(run.stdout, "这条执行日志包含测试残留或乱码，已在当前工作区隐藏。"),
    stderr: sanitizeTextLines(run.stderr, "这条执行日志包含测试残留或乱码，已在当前工作区隐藏。"),
    toolCalls: run.toolCalls.map(sanitizeToolCall),
    timeline: run.timeline.map(sanitizeRunEvent),
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

function sanitizeMemoryArtifact(item: MemoryArtifact): MemoryArtifact {
  return {
    ...item,
    scope: sanitizeDisplayText(item.scope, "memory:current"),
    path: sanitizeDisplayText(item.path, "notes/current-artifact.md"),
    summary: sanitizeDisplayText(item.summary, "当前记忆摘要正在整理中。"),
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
