export type AppTab = "chat" | "rooms" | "inbox" | "board";

export type Priority = "critical" | "high" | "medium";
export type RunStatus = "queued" | "running" | "paused" | "blocked" | "review" | "done";
export type PresenceState = "running" | "idle" | "blocked";
export type MachineState = "online" | "busy" | "offline";
export type InboxKind = "blocked" | "approval" | "review" | "status";
export type PullRequestStatus = "draft" | "open" | "in_review" | "changes_requested" | "merged";
export type DestructiveGuardStatus = "approval_required" | "blocked" | "ready";
export type DestructiveGuardRisk = "destructive_git" | "filesystem_write" | "secret_scope";
export type SandboxProfile = "trusted" | "restricted";
export type SandboxDecisionStatus = "idle" | "allowed" | "denied" | "approval_required" | "overridden";
export type SandboxActionKind = "command" | "network" | "tool";

export type SandboxPolicy = {
  profile: SandboxProfile;
  allowedHosts?: string[];
  allowedCommands?: string[];
  allowedTools?: string[];
  updatedAt?: string;
  updatedBy?: string;
};

export type SandboxDecision = {
  status: SandboxDecisionStatus;
  kind?: SandboxActionKind;
  target?: string;
  reason?: string;
  requestedBy?: string;
  overrideBy?: string;
  checkedAt?: string;
  retryHint?: string;
};

export type WorkspaceSnapshot = {
  name: string;
  repo: string;
  repoUrl: string;
  branch: string;
  repoProvider: string;
  repoBindingStatus: string;
  repoAuthMode: string;
  plan: string;
  quota?: WorkspaceQuotaSnapshot;
  usage?: WorkspaceUsageSnapshot;
  pairedRuntime: string;
  pairedRuntimeUrl: string;
  pairingStatus: string;
  deviceAuth: string;
  lastPairedAt: string;
  browserPush: string;
  memoryMode: string;
  sandbox: SandboxPolicy;
  repoBinding: WorkspaceRepoBindingSnapshot;
  githubInstallation: WorkspaceGitHubInstallSnapshot;
  onboarding: WorkspaceOnboardingSnapshot;
};

export type WorkspaceRepoBindingSnapshot = {
  repo: string;
  repoUrl: string;
  branch: string;
  provider: string;
  bindingStatus: string;
  authMode: string;
  detectedAt?: string;
  syncedAt?: string;
};

export type WorkspaceGitHubInstallSnapshot = {
  provider: string;
  preferredAuthMode?: string;
  connectionReady: boolean;
  appConfigured: boolean;
  appInstalled: boolean;
  installationId?: string;
  installationUrl?: string;
  missing?: string[];
  connectionMessage?: string;
  syncedAt?: string;
};

export type WorkspaceOnboardingSnapshot = {
  status: string;
  templateId?: string;
  currentStep?: string;
  completedSteps?: string[];
  resumeUrl?: string;
  materialization?: WorkspaceOnboardingMaterialization;
  updatedAt?: string;
};

export type WorkspaceOnboardingMaterialization = {
  label?: string;
  channels?: string[];
  roles?: string[];
  agents?: string[];
  notificationPolicy?: string;
  notes?: string[];
};

export type WorkspaceMemberPreferences = {
  preferredAgentId?: string;
  startRoute?: string;
  updatedAt?: string;
};

export type WorkspaceQuotaSnapshot = {
  usedMachines: number;
  maxMachines: number;
  usedAgents: number;
  maxAgents: number;
  usedChannels: number;
  maxChannels: number;
  usedRooms: number;
  maxRooms: number;
  messageHistoryDays: number;
  runLogDays: number;
  memoryDraftDays: number;
  status: string;
  warning?: string;
};

export type WorkspaceUsageSnapshot = {
  windowLabel: string;
  totalTokens: number;
  runCount: number;
  messageCount: number;
  refreshedAt: string;
  warning?: string;
};

export type AuthSession = {
  id: string;
  memberId?: string;
  email?: string;
  name?: string;
  role?: string;
  status: string;
  authMethod?: string;
  signedInAt?: string;
  lastSeenAt?: string;
  deviceId?: string;
  deviceLabel?: string;
  deviceAuthStatus?: string;
  emailVerificationStatus?: string;
  emailVerifiedAt?: string;
  passwordResetStatus?: string;
  passwordResetRequestedAt?: string;
  passwordResetCompletedAt?: string;
  recoveryStatus?: string;
  githubIdentity?: AuthExternalIdentity;
  preferences: WorkspaceMemberPreferences;
  linkedIdentities?: AuthExternalIdentity[];
  permissions: string[];
};

export type WorkspaceRole = {
  id: string;
  label: string;
  summary: string;
  permissions: string[];
};

export type WorkspaceMember = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  source?: string;
  addedAt?: string;
  lastSeenAt?: string;
  recoveryEmail?: string;
  emailVerificationStatus?: string;
  emailVerifiedAt?: string;
  passwordResetStatus?: string;
  passwordResetRequestedAt?: string;
  passwordResetCompletedAt?: string;
  recoveryStatus?: string;
  githubIdentity?: AuthExternalIdentity;
  preferences: WorkspaceMemberPreferences;
  linkedIdentities?: AuthExternalIdentity[];
  trustedDeviceIds?: string[];
  permissions: string[];
};

export type AuthExternalIdentity = {
  provider: string;
  handle: string;
  status: string;
  boundAt?: string;
};

export type AuthDevice = {
  id: string;
  memberId: string;
  label: string;
  status: string;
  requestedAt?: string;
  authorizedAt?: string;
  lastSeenAt?: string;
};

export type AuthSnapshot = {
  session: AuthSession;
  roles: WorkspaceRole[];
  members: WorkspaceMember[];
  devices?: AuthDevice[];
};

export type Channel = {
  id: string;
  name: string;
  summary: string;
  unread: number;
  purpose: string;
};

export type DirectMessage = {
  id: string;
  name: string;
  summary: string;
  purpose: string;
  unread: number;
  presence: PresenceState;
  counterpart: string;
  messageIds: string[];
};

export type Message = {
  id: string;
  speaker: string;
  role: "human" | "agent" | "system";
  tone: "human" | "agent" | "paper" | "blocked" | "system";
  message: string;
  time: string;
};

export type MessageSurfaceEntry = {
  id: string;
  channelId: string;
  messageId: string;
  channelLabel: string;
  title: string;
  summary: string;
  note: string;
  updatedAt: string;
  unread: number;
};

export type SearchResultKind = "channel" | "dm" | "room" | "issue" | "run" | "agent" | "followed" | "saved";

export type SearchResult = {
  id: string;
  kind: SearchResultKind;
  title: string;
  summary: string;
  meta: string;
  href: string;
  keywords: string;
  order: number;
};

export type Issue = {
  id: string;
  key: string;
  title: string;
  summary: string;
  state: RunStatus;
  priority: Priority;
  owner: string;
  roomId: string;
  runId: string;
  pullRequest: string;
  checklist: string[];
};

export type Topic = {
  id: string;
  title: string;
  status: RunStatus;
  owner: string;
  summary: string;
};

export type Room = {
  id: string;
  issueKey: string;
  title: string;
  unread: number;
  summary: string;
  boardCount: number;
  topic: Topic;
  runId: string;
  messageIds: string[];
  usage?: RoomUsageSnapshot;
};

export type RoomUsageSnapshot = {
  windowLabel: string;
  messageCount: number;
  humanTurns: number;
  agentTurns: number;
  totalTokens: number;
  refreshedAt: string;
  warning?: string;
};

export type RunEvent = {
  id: string;
  label: string;
  at: string;
  tone: "paper" | "yellow" | "lime" | "pink";
};

export type GuardBoundary = {
  label: string;
  value: string;
};

export type DestructiveGuard = {
  id: string;
  title: string;
  summary: string;
  status: DestructiveGuardStatus;
  risk: DestructiveGuardRisk;
  scope: string;
  roomId?: string;
  runId?: string;
  inboxItemId?: string;
  approvalRequired: boolean;
  boundaries: GuardBoundary[];
};

export type ToolCall = {
  id: string;
  tool: string;
  summary: string;
  result: string;
};

export type Run = {
  id: string;
  issueKey: string;
  roomId: string;
  topicId: string;
  status: RunStatus;
  followThread?: boolean;
  controlNote?: string;
  runtime: string;
  machine: string;
  provider: string;
  branch: string;
  worktree: string;
  worktreePath?: string;
  owner: string;
  startedAt: string;
  duration: string;
  summary: string;
  approvalRequired: boolean;
  sandbox: SandboxPolicy;
  sandboxDecision: SandboxDecision;
  stdout: string[];
  stderr: string[];
  toolCalls: ToolCall[];
  timeline: RunEvent[];
  usage?: RunUsageSnapshot;
  nextAction: string;
  pullRequest: string;
};

export type RunUsageSnapshot = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCallCount: number;
  contextWindow: number;
  budgetStatus: string;
  refreshedAt: string;
  warning?: string;
};

export type AgentStatus = {
  id: string;
  name: string;
  description: string;
  mood: string;
  state: PresenceState;
  lane: string;
  role: string;
  avatar: string;
  prompt: string;
  operatingInstructions: string;
  provider: string;
  providerPreference: string;
  modelPreference: string;
  recallPolicy: string;
  runtimePreference: string;
  memorySpaces: string[];
  sandbox: SandboxPolicy;
  recentRunIds: string[];
  profileAudit: Array<{
    id: string;
    updatedAt: string;
    updatedBy: string;
    summary: string;
    changes: Array<{
      field: string;
      previous: string;
      current: string;
    }>;
  }>;
};

export type MachineStatus = {
  id: string;
  name: string;
  state: MachineState;
  cli: string;
  shell: string;
  os: string;
  lastHeartbeat: string;
};

export type RuntimeProviderStatus = {
  id: string;
  label: string;
  mode: string;
  capabilities: string[];
  models: string[];
  transport: string;
  ready?: boolean;
  status?: string;
  statusMessage?: string;
  checkedAt?: string;
};

export type RuntimeRegistryRecord = {
  id: string;
  machine: string;
  daemonUrl: string;
  detectedCli: string[];
  providers: RuntimeProviderStatus[];
  shell: string;
  state: string;
  pairingState: string;
  workspaceRoot: string;
  reportedAt: string;
  lastHeartbeatAt: string;
  heartbeatIntervalSeconds?: number;
  heartbeatTimeoutSeconds?: number;
};

export type RuntimeLeaseRecord = {
  leaseId: string;
  sessionId?: string;
  runId?: string;
  roomId?: string;
  runtime: string;
  machine: string;
  owner?: string;
  provider?: string;
  status?: string;
  branch?: string;
  worktreeName?: string;
  worktreePath?: string;
  cwd?: string;
  summary?: string;
};

export type RuntimeSchedulerCandidate = {
  runtime: string;
  machine: string;
  state: string;
  pairingState: string;
  schedulable: boolean;
  selected: boolean;
  preferred: boolean;
  assigned: boolean;
  activeLeaseCount: number;
  reason?: string;
};

export type RuntimeScheduler = {
  selectedRuntime: string;
  preferredRuntime: string;
  assignedRuntime: string;
  assignedMachine: string;
  strategy: string;
  failoverFrom?: string;
  summary: string;
  candidates: RuntimeSchedulerCandidate[];
};

export type InboxItem = {
  id: string;
  title: string;
  kind: InboxKind;
  room: string;
  time: string;
  summary: string;
  action: string;
  href: string;
  guardId?: string;
};

export type InboxDecision =
  | "approved"
  | "deferred"
  | "resolved"
  | "merged"
  | "changes_requested";

export type ApprovalCenterDeliveryStatus =
  | "ready"
  | "suppressed"
  | "blocked"
  | "unrouted";

export type ApprovalCenterItem = {
  id: string;
  kind: InboxKind;
  priority: "critical" | "high" | "info";
  room: string;
  roomId?: string;
  runId?: string;
  guardId?: string;
  title: string;
  summary: string;
  action: string;
  href: string;
  time: string;
  unread: boolean;
  decisionOptions: InboxDecision[];
  deliveryStatus: ApprovalCenterDeliveryStatus;
  deliveryTargets: number;
  blockedDeliveries: number;
};

export type ApprovalCenterState = {
  openCount: number;
  approvalCount: number;
  blockedCount: number;
  reviewCount: number;
  unreadCount: number;
  recentCount: number;
  signals: ApprovalCenterItem[];
  recent: ApprovalCenterItem[];
};

export type PullRequest = {
  id: string;
  number: number;
  label: string;
  title: string;
  status: PullRequestStatus;
  issueKey: string;
  roomId: string;
  runId: string;
  branch: string;
  baseBranch?: string;
  author: string;
  provider?: string;
  url?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  reviewSummary: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  issueKey: string;
  roomId: string;
  topicId: string;
  activeRunId: string;
  status: RunStatus;
  followThread?: boolean;
  controlNote?: string;
  runtime: string;
  machine: string;
  provider: string;
  branch: string;
  worktree: string;
  worktreePath: string;
  summary: string;
  updatedAt: string;
  memoryPaths: string[];
};

export type MemoryGovernance = {
  mode?: string;
  requiresReview?: boolean;
  escalation?: string;
};

export type MemoryArtifact = {
  id: string;
  scope: string;
  kind: string;
  path: string;
  summary: string;
  updatedAt: string;
  version?: number;
  latestWrite?: string;
  latestSource?: string;
  latestActor?: string;
  digest?: string;
  sizeBytes?: number;
  governance?: MemoryGovernance;
};

export type SetupStep = {
  id: string;
  title: string;
  status: "done" | "active" | "pending";
  summary: string;
  detail: string;
  href: string;
};

export type SettingsSection = {
  id: string;
  title: string;
  summary: string;
  value: string;
};

export type PhaseZeroState = {
  workspace: WorkspaceSnapshot;
  auth: AuthSnapshot;
  channels: Channel[];
  channelMessages: Record<string, Message[]>;
  directMessages: DirectMessage[];
  directMessageMessages: Record<string, Message[]>;
  followedThreads: MessageSurfaceEntry[];
  savedLaterItems: MessageSurfaceEntry[];
  quickSearchEntries: SearchResult[];
  issues: Issue[];
  rooms: Room[];
  roomMessages: Record<string, Message[]>;
  runs: Run[];
  agents: AgentStatus[];
  machines: MachineStatus[];
  runtimes: RuntimeRegistryRecord[];
  inbox: InboxItem[];
  pullRequests: PullRequest[];
  sessions: Session[];
  runtimeLeases: RuntimeLeaseRecord[];
  runtimeScheduler: RuntimeScheduler;
  guards: DestructiveGuard[];
  memory: MemoryArtifact[];
};

export const workspace: WorkspaceSnapshot = {
  name: "OpenShock 作战台",
  repo: "Larkspur-Wang/OpenShock",
  repoUrl: "https://github.com/Larkspur-Wang/OpenShock",
  branch: "main",
  repoProvider: "github",
  repoBindingStatus: "bound",
  repoAuthMode: "local-git-origin",
  plan: "本地协作基线",
  quota: {
    usedMachines: 2,
    maxMachines: 4,
    usedAgents: 3,
    maxAgents: 8,
    usedChannels: 3,
    maxChannels: 12,
    usedRooms: 3,
    maxRooms: 16,
    messageHistoryDays: 30,
    runLogDays: 14,
    memoryDraftDays: 90,
    status: "healthy",
    warning: "当前还是本地协作基线阶段，先把配额、保留周期和使用情况看清楚。",
  },
  usage: {
    windowLabel: "过去 24h",
    totalTokens: 13418,
    runCount: 3,
    messageCount: 13,
    refreshedAt: "2026-04-08T11:02:00Z",
    warning: "当前先以使用观察为主，等团队稳定后再决定是否增加更重的计费流程。",
  },
  pairedRuntime: "shock-main",
  pairedRuntimeUrl: "http://127.0.0.1:8090",
  pairingStatus: "paired",
  deviceAuth: "browser-approved",
  lastPairedAt: "刚刚",
  browserPush: "只推高优先级",
  memoryMode: "MEMORY.md + notes/ + decisions/",
  sandbox: {
    profile: "restricted",
    allowedHosts: ["github.com", "api.openai.com"],
    allowedCommands: ["git status", "pnpm test"],
    allowedTools: ["read_file", "rg"],
    updatedAt: "2026-04-08T11:02:00Z",
    updatedBy: "Larkspur",
  },
  repoBinding: {
    repo: "Larkspur-Wang/OpenShock",
    repoUrl: "https://github.com/Larkspur-Wang/OpenShock",
    branch: "main",
    provider: "github",
    bindingStatus: "bound",
    authMode: "local-git-origin",
    syncedAt: "2026-04-07T05:35:00Z",
  },
  githubInstallation: {
    provider: "github",
    preferredAuthMode: "github-app",
    connectionReady: false,
    appConfigured: false,
    appInstalled: false,
    connectionMessage: "当前还没有完成 GitHub App 安装，先沿用本地仓库绑定继续推进。",
    syncedAt: "2026-04-07T05:35:00Z",
  },
  onboarding: {
    status: "in_progress",
    templateId: "delivery-ops",
    currentStep: "repo-binding",
    completedSteps: ["workspace-created", "member-seeded"],
    resumeUrl: "/setup",
    updatedAt: "2026-04-07T05:35:00Z",
  },
};

export const auth: AuthSnapshot = {
  session: {
    id: "auth-session-current",
    memberId: "member-larkspur",
    email: "larkspur@openshock.dev",
    name: "Larkspur",
    role: "owner",
    status: "active",
    authMethod: "email-link",
    signedInAt: "2026-04-07T04:12:00Z",
    lastSeenAt: "2026-04-07T05:35:00Z",
    githubIdentity: {
      provider: "github",
      handle: "@larkspur",
      status: "bound",
      boundAt: "2026-04-07T05:35:00Z",
    },
    preferences: {
      preferredAgentId: "agent-codex-dockmaster",
      startRoute: "/setup",
      updatedAt: "2026-04-07T05:35:00Z",
    },
    permissions: [
      "workspace.manage",
      "members.manage",
      "repo.admin",
      "runtime.manage",
      "issue.create",
      "room.reply",
      "run.execute",
      "inbox.review",
      "inbox.decide",
      "memory.read",
      "memory.write",
      "pull_request.read",
      "pull_request.review",
      "pull_request.merge",
    ],
  },
  roles: [
    {
      id: "owner",
      label: "Owner",
      summary: "可以管理 workspace、成员、repo/runtime 绑定，并批准或合并关键动作。",
      permissions: [
        "workspace.manage",
        "members.manage",
        "repo.admin",
        "runtime.manage",
        "issue.create",
        "room.reply",
        "run.execute",
        "inbox.review",
        "inbox.decide",
        "memory.read",
        "memory.write",
        "pull_request.read",
        "pull_request.review",
        "pull_request.merge",
      ],
    },
    {
      id: "member",
      label: "Member",
      summary: "可以参与 issue / room / run / review，但不能改 roster 或 workspace 级配置。",
      permissions: [
        "issue.create",
        "room.reply",
        "run.execute",
        "inbox.review",
        "memory.read",
        "pull_request.read",
        "pull_request.review",
      ],
    },
    {
      id: "viewer",
      label: "Viewer",
      summary: "只读查看控制面和历史记录，不做破坏性变更。",
      permissions: ["room.read", "run.read", "inbox.read", "memory.read", "pull_request.read"],
    },
  ],
  members: [
    {
      id: "member-larkspur",
      email: "larkspur@openshock.dev",
      name: "Larkspur",
      role: "owner",
      status: "active",
      source: "seed",
      addedAt: "2026-04-07T04:10:00Z",
      lastSeenAt: "2026-04-07T05:35:00Z",
      githubIdentity: {
        provider: "github",
        handle: "@larkspur",
        status: "bound",
        boundAt: "2026-04-07T05:35:00Z",
      },
      preferences: {
        preferredAgentId: "agent-codex-dockmaster",
        startRoute: "/setup",
        updatedAt: "2026-04-07T05:35:00Z",
      },
      permissions: [
        "workspace.manage",
        "members.manage",
        "repo.admin",
        "runtime.manage",
        "issue.create",
        "room.reply",
        "run.execute",
        "inbox.review",
        "inbox.decide",
        "memory.read",
        "memory.write",
        "pull_request.read",
        "pull_request.review",
        "pull_request.merge",
      ],
    },
    {
      id: "member-mina",
      email: "mina@openshock.dev",
      name: "Mina",
      role: "member",
      status: "active",
      source: "seed",
      addedAt: "2026-04-07T04:10:00Z",
      lastSeenAt: "2026-04-07T05:18:00Z",
      preferences: {
        startRoute: "/access",
      },
      permissions: [
        "issue.create",
        "room.reply",
        "run.execute",
        "inbox.review",
        "memory.read",
        "pull_request.read",
        "pull_request.review",
      ],
    },
    {
      id: "member-longwen",
      email: "longwen@openshock.dev",
      name: "Longwen",
      role: "viewer",
      status: "active",
      source: "seed",
      addedAt: "2026-04-07T04:10:00Z",
      lastSeenAt: "2026-04-07T05:05:00Z",
      preferences: {
        startRoute: "/access",
      },
      permissions: ["room.read", "run.read", "inbox.read", "memory.read", "pull_request.read"],
    },
  ],
};

export const tabs: Array<{ id: AppTab; label: string; href: string }> = [
  { id: "chat", label: "频道", href: "/chat/all" },
  { id: "inbox", label: "收件箱", href: "/inbox" },
  { id: "board", label: "任务板", href: "/board" },
];

export const utilityLinks = [
  { id: "setup", label: "配置", href: "/setup" },
  { id: "issues", label: "需求", href: "/issues" },
  { id: "runs", label: "执行", href: "/runs" },
  { id: "agents", label: "公民", href: "/agents" },
  { id: "memory", label: "记忆", href: "/memory" },
  { id: "access", label: "身份", href: "/access" },
  { id: "settings", label: "设置", href: "/settings" },
];

export const channels: Channel[] = [
  {
    id: "all",
    name: "#all",
    summary: "轻松聊天、公屏唠嗑、快速交接都在这里。",
    unread: 5,
    purpose: "这是全局闲聊频道，所有轻量讨论先落在这里，不在这里直接干活。",
  },
  {
    id: "roadmap",
    name: "#roadmap",
    summary: "路线、优先级、产品分歧和排期讨论都在这里。",
    unread: 2,
    purpose: "路线图先在这里吵清楚，确认后再升级成真正的讨论间。",
  },
  {
    id: "announcements",
    name: "#announcements",
    summary: "版本、Runtime 变化和制度公告，尽量低噪音。",
    unread: 0,
    purpose: "这里只做广播，不让讨论蔓延成新的上下文黑洞。",
  },
];

export const channelMessages: Record<string, Message[]> = {
  all: [
    {
      id: "msg-all-1",
      speaker: "Mina",
      role: "human",
      tone: "human",
      message: "前台一定要轻。频道就是频道，严肃工作一律升级成讨论间。",
      time: "09:12",
    },
    {
      id: "msg-all-2",
      speaker: "Codex Dockmaster",
      role: "agent",
      tone: "agent",
      message: "运行环境在线状态已经同步。下一步是把真实执行和审批链路拉进前台。",
      time: "09:16",
    },
    {
      id: "msg-all-3",
      speaker: "系统",
      role: "system",
      tone: "system",
      message: "OPS-12 已经升级成讨论间，因为它开始涉及运行环境、分支和 PR 收口。",
      time: "09:17",
    },
  ],
  roadmap: [
    {
      id: "msg-roadmap-1",
      speaker: "Longwen",
      role: "human",
      tone: "human",
      message: "默认入口必须聊天优先。任务板只能是辅助视图，不许反客为主。",
      time: "10:04",
    },
    {
      id: "msg-roadmap-2",
      speaker: "Claude Review Runner",
      role: "agent",
      tone: "agent",
      message: "Inbox 现在更像决策驾驶舱，不像一个冷冰冰的告警后台了。",
      time: "10:07",
    },
  ],
  announcements: [
    {
      id: "msg-ann-1",
      speaker: "系统",
      role: "system",
      tone: "system",
      message: "第 0 阶段壳层已上线。频道、讨论间、看板、收件箱和配置页都已经有独立路由。",
      time: "11:02",
    },
  ],
};

export const issues: Issue[] = [
  {
    id: "issue-runtime",
    key: "OPS-12",
    title: "打通运行环境心跳与机器在线状态",
    summary: "把运行环境状态、最近心跳和本机 CLI 执行能力真实带进壳层和讨论间。",
    state: "running",
    priority: "critical",
    owner: "Codex Dockmaster",
    roomId: "room-runtime",
    runId: "run_runtime_01",
    pullRequest: "PR #18",
    checklist: [
      "左下角展示机器在线 / 忙碌 / 离线",
      "执行详情必须带出分支和工作树",
      "approval_required 必须对人类可见",
    ],
  },
  {
    id: "issue-inbox",
    key: "OPS-19",
    title: "把 Inbox 做成人类决策中心",
    summary: "把 blocked、approval、review 三类事件统一成一个人类干预面板。",
    state: "review",
    priority: "high",
    owner: "Claude Review Runner",
    roomId: "room-inbox",
    runId: "run_inbox_01",
    pullRequest: "PR #22",
    checklist: [
      "按事件类型统一卡片语气和动作文案",
      "每张卡都能直接回到房间或执行详情",
      "浏览器 Push 只给高优先级事件",
    ],
  },
  {
    id: "issue-memory",
    key: "OPS-27",
    title: "落地文件级记忆写回",
    summary: "把 run 摘要写回 MEMORY.md、notes/、decisions/，但不提前引入沉重的 memory OS。",
    state: "blocked",
    priority: "high",
    owner: "Memory Clerk",
    roomId: "room-memory",
    runId: "run_memory_01",
    pullRequest: "PR draft",
    checklist: [
      "把执行摘要写入 MEMORY.md",
      "策略冲突必须经由 Inbox 升级，而不是静默覆盖",
      "房间笔记必须保持人类可检查",
    ],
  },
];

export const rooms: Room[] = [
  {
    id: "room-runtime",
    issueKey: "OPS-12",
    title: "运行环境讨论间",
    unread: 3,
    summary: "把运行环境状态、当前执行和人工干预都收进一个讨论间。",
    boardCount: 4,
    runId: "run_runtime_01",
    messageIds: ["msg-room-1", "msg-room-2", "msg-room-3"],
    topic: {
      id: "topic-runtime",
      title: "把运行环境卡片和执行元信息接进前端",
      status: "running",
      owner: "Codex Dockmaster",
      summary: "壳层正在推进中。智能体正在把机器在线状态、分支和执行详情接进前端。",
    },
    usage: {
      windowLabel: "过去 6h",
      messageCount: 3,
      humanTurns: 1,
      agentTurns: 1,
      totalTokens: 6130,
      refreshedAt: "2026-04-08T11:02:00Z",
      warning: "房间 usage 仍在可读范围，消息密度与 run cost 可以继续并排观察。",
    },
  },
  {
    id: "room-inbox",
    issueKey: "OPS-19",
    title: "Inbox 讨论间",
    unread: 1,
    summary: "把 blocked、approval 和 review 三种提示统一收进一个人类决策面。",
    boardCount: 3,
    runId: "run_inbox_01",
    messageIds: ["msg-room-4", "msg-room-5"],
    topic: {
      id: "topic-inbox",
      title: "收紧审批卡片与升级文案",
      status: "review",
      owner: "Claude Review Runner",
      summary: "文案已经准备好，正在等产品确认后合并。",
    },
    usage: {
      windowLabel: "过去 6h",
      messageCount: 2,
      humanTurns: 1,
      agentTurns: 1,
      totalTokens: 4972,
      refreshedAt: "2026-04-08T11:02:00Z",
      warning: "这间房已进入 review；下一条消息优先围绕 blocker / no-blocker，而不是继续扩 scope。",
    },
  },
  {
    id: "room-memory",
    issueKey: "OPS-27",
    title: "记忆写回讨论间",
    unread: 4,
    summary: "让 MEMORY.md 和 decisions/ 真正可用，但不假装我们已经有完整 memory OS。",
    boardCount: 2,
    runId: "run_memory_01",
    messageIds: ["msg-room-6", "msg-room-7"],
    topic: {
      id: "topic-memory",
      title: "解决写回策略冲突",
      status: "blocked",
      owner: "Memory Clerk",
      summary: "智能体在写回房间笔记前，需要一个正式的优先级规则。",
    },
    usage: {
      windowLabel: "过去 6h",
      messageCount: 2,
      humanTurns: 0,
      agentTurns: 1,
      totalTokens: 2488,
      refreshedAt: "2026-04-08T11:02:00Z",
      warning: "这间房当前是 blocked 态；继续追加消息前先确认是否该升级到 Inbox。",
    },
  },
];

export const roomMessages: Record<string, Message[]> = {
  "room-runtime": [
    {
      id: "msg-room-1",
      speaker: "Codex Dockmaster",
      role: "agent",
      tone: "agent",
      message: "左下角状态区已经接上，下一步把执行详情和机器心跳带进房间。",
      time: "09:20",
    },
    {
      id: "msg-room-2",
      speaker: "Longwen",
      role: "human",
      tone: "human",
      message: "机器和智能体的状态必须常驻可见，它们不是设置项，而是协作者。",
      time: "09:23",
    },
    {
      id: "msg-room-3",
      speaker: "系统",
      role: "system",
      tone: "system",
      message: "run_runtime_01 已经在 shock-main 上进入实时执行。",
      time: "09:26",
    },
  ],
  "room-inbox": [
    {
      id: "msg-room-4",
      speaker: "Claude Review Runner",
      role: "agent",
      tone: "agent",
      message: "审批卡片现在都会回到房间和执行详情，不再掉进孤立的弹窗里。",
      time: "10:01",
    },
    {
      id: "msg-room-5",
      speaker: "Mina",
      role: "human",
      tone: "human",
      message: "动作文案要冷静，不要官僚化，更不能像告警系统在尖叫。",
      time: "10:08",
    },
  ],
  "room-memory": [
    {
      id: "msg-room-6",
      speaker: "Memory Clerk",
      role: "agent",
      tone: "blocked",
      message: "阻塞：房间笔记和用户偏好发生冲突。我需要优先级规则，才能安全写回。",
      time: "10:31",
    },
    {
      id: "msg-room-7",
      speaker: "系统",
      role: "system",
      tone: "system",
      message: "已创建 Inbox 项：请决定写回范围和优先级。",
      time: "10:33",
    },
  ],
};

export const runs: Run[] = [
  {
    id: "run_runtime_01",
    issueKey: "OPS-12",
    roomId: "room-runtime",
    topicId: "topic-runtime",
    status: "running",
    runtime: "shock-main",
    machine: "shock-main",
    provider: "Codex CLI",
    branch: "feat/runtime-state-shell",
    worktree: "wt-runtime-shell",
    owner: "Codex Dockmaster",
    startedAt: "09:26",
    duration: "24m",
    summary: "把 runtime 心跳、讨论间上下文和分支元信息同步进主壳层。",
    approvalRequired: false,
    sandbox: {
      profile: "restricted",
      allowedHosts: ["github.com", "api.openai.com"],
      allowedCommands: ["git status", "pnpm test"],
      allowedTools: ["read_file", "rg"],
      updatedAt: "2026-04-08T09:26:00Z",
      updatedBy: "Codex Dockmaster",
    },
    sandboxDecision: {
      status: "approval_required",
      kind: "command",
      target: "git push --force",
      reason: "当前受限策略没有放行这次操作，需要管理员确认后再试。",
      requestedBy: "Codex Dockmaster",
      checkedAt: "2026-04-08T09:45:00Z",
      retryHint: "保持目标不变，等有管理权限的人确认后再重试。",
    },
    stdout: [
      "[09:26:11] 正在克隆 worktree wt-runtime-shell",
      "[09:27:08] 已在 shock-main 上发现 codex 与 claude code",
      "[09:31:42] 已将 runtime 卡片渲染到主壳左侧栏",
      "[09:36:03] 已把 run 元数据接到讨论间上下文面板",
      "[09:44:55] 正在准备 PR 摘要与评审清单",
    ],
    stderr: [],
    toolCalls: [
      { id: "tool-1", tool: "git worktree add", summary: "为 OPS-12 创建隔离 lane", result: "成功" },
      { id: "tool-2", tool: "codex", summary: "更新壳层布局与路由接线", result: "成功" },
    ],
    timeline: [
      { id: "ev-1", label: "事项已分配给智能体", at: "09:24", tone: "paper" },
      { id: "ev-2", label: "工作树已创建", at: "09:26", tone: "yellow" },
      { id: "ev-3", label: "运行环境心跳已可见", at: "09:33", tone: "lime" },
      { id: "ev-4", label: "PR 摘要生成中", at: "09:46", tone: "paper" },
    ],
    usage: {
      promptTokens: 4368,
      completionTokens: 1212,
      totalTokens: 5580,
      toolCallCount: 2,
      contextWindow: 16000,
      budgetStatus: "watch",
      refreshedAt: "2026-04-08T11:02:00Z",
      warning: "这条 Run 当前已用 5580 tokens；继续拉长协作前先看 context headroom。",
    },
    nextAction: "等视觉核对通过后发起 PR。",
    pullRequest: "PR #18",
  },
  {
    id: "run_inbox_01",
    issueKey: "OPS-19",
    roomId: "room-inbox",
    topicId: "topic-inbox",
    status: "review",
    runtime: "shock-sidecar",
    machine: "shock-sidecar",
    provider: "Claude Code CLI",
    branch: "feat/inbox-decision-cards",
    worktree: "wt-inbox-cards",
    owner: "Claude Review Runner",
    startedAt: "09:58",
    duration: "18m",
    summary: "把批准、阻塞和评审卡片收成一个人类决策收件箱。",
    approvalRequired: false,
    sandbox: {
      profile: "trusted",
      allowedHosts: [],
      allowedCommands: [],
      allowedTools: [],
      updatedAt: "2026-04-08T09:58:00Z",
      updatedBy: "Claude Review Runner",
    },
    sandboxDecision: {
      status: "idle",
    },
    stdout: [
      "[09:58:03] 已打开讨论间上下文",
      "[10:01:14] 已重写批准卡片语气",
      "[10:06:48] 已把 Inbox 卡片接到执行详情和房间视图",
      "[10:12:30] 等待产品文案核对",
    ],
    stderr: [],
    toolCalls: [
      { id: "tool-3", tool: "claude-code", summary: "重写 Inbox 卡片文案层级", result: "成功" },
    ],
    timeline: [
      { id: "ev-5", label: "执行已启动", at: "09:58", tone: "yellow" },
      { id: "ev-6", label: "房间跳转已接通", at: "10:06", tone: "lime" },
      { id: "ev-7", label: "已发起评审", at: "10:12", tone: "paper" },
    ],
    usage: {
      promptTokens: 3540,
      completionTokens: 1062,
      totalTokens: 4602,
      toolCallCount: 1,
      contextWindow: 32000,
      budgetStatus: "healthy",
      refreshedAt: "2026-04-08T11:02:00Z",
      warning: "当前 token 与上下文余量仍健康，可继续沿讨论间、执行和 PR 收口。",
    },
    nextAction: "等待人类确认语气与通知默认值。",
    pullRequest: "PR #22",
  },
  {
    id: "run_memory_01",
    issueKey: "OPS-27",
    roomId: "room-memory",
    topicId: "topic-memory",
    status: "blocked",
    runtime: "shock-main",
    machine: "shock-main",
    provider: "Codex CLI",
    branch: "feat/memory-writeback",
    worktree: "wt-memory-writeback",
    owner: "Memory Clerk",
    startedAt: "10:27",
    duration: "11m",
    summary: "把执行摘要写回 MEMORY.md，同时保留可检查的房间上下文。",
    approvalRequired: true,
    sandbox: {
      profile: "restricted",
      allowedHosts: ["github.com"],
      allowedCommands: ["git status"],
      allowedTools: ["read_file"],
      updatedAt: "2026-04-08T10:27:00Z",
      updatedBy: "Memory Clerk",
    },
    sandboxDecision: {
      status: "denied",
      kind: "network",
      target: "mem0.dev",
      reason: "restricted sandbox 未允许这个 network target；先补 host allowlist，再 retry。",
      requestedBy: "Memory Clerk",
      checkedAt: "2026-04-08T10:31:00Z",
      retryHint: "更新 run / agent / workspace 的 allowed hosts 后重试。",
    },
    stdout: [
      "[10:27:02] 已打开 MEMORY.md",
      "[10:30:44] 已收集房间笔记和用户记忆范围",
      "[10:31:10] 发现房间笔记与用户笔记优先级冲突",
    ],
    stderr: ["[10:31:11] 写回已暂停：缺少房间与用户优先级策略"],
    toolCalls: [
      { id: "tool-4", tool: "codex", summary: "尝试为 MEMORY.md 规划写回策略", result: "阻塞" },
    ],
    timeline: [
      { id: "ev-8", label: "执行已启动", at: "10:27", tone: "yellow" },
      { id: "ev-9", label: "检测到冲突", at: "10:31", tone: "pink" },
      { id: "ev-10", label: "已创建 Inbox 升级项", at: "10:33", tone: "paper" },
    ],
    usage: {
      promptTokens: 2824,
      completionTokens: 412,
      totalTokens: 3236,
      toolCallCount: 1,
      contextWindow: 16000,
      budgetStatus: "healthy",
      refreshedAt: "2026-04-08T11:02:00Z",
      warning: "当前执行虽未逼近 token 上限，但仍被人工批准闸门锁住。",
    },
    nextAction: "先定优先级规则，再恢复写回。",
    pullRequest: "草稿 PR",
  },
];

export const agents: AgentStatus[] = [
  {
    id: "agent-codex-dockmaster",
    name: "Codex Dockmaster",
    description: "负责壳层基础设施、运行环境状态，以及执行真相的前台可见性。",
    mood: "正在接入运行环境卡片",
    state: "running",
    lane: "OPS-12",
    role: "平台架构",
    avatar: "control-tower",
    prompt: "先给出当前真实状态，再给最短可执行动作。",
    operatingInstructions: "对共享壳层和运行环境真相保持谨慎，不把陈旧状态当成当前真相。",
    provider: "Codex CLI",
    providerPreference: "Codex CLI",
    modelPreference: "gpt-5.3-codex",
    recallPolicy: "governed-first",
    runtimePreference: "shock-main",
    memorySpaces: ["workspace", "issue-room", "topic"],
    sandbox: {
      profile: "restricted",
      allowedHosts: ["github.com", "api.openai.com"],
      allowedCommands: ["git status", "pnpm test"],
      allowedTools: ["read_file", "rg"],
      updatedAt: "2026-04-08T09:20:00Z",
      updatedBy: "Larkspur",
    },
    recentRunIds: ["run_runtime_01"],
    profileAudit: [],
  },
  {
    id: "agent-claude-review-runner",
    name: "Claude Review Runner",
    description: "负责语气、评审清晰度和 Inbox 的可读性。",
    mood: "等待产品核对",
    state: "idle",
    lane: "OPS-19",
    role: "评审协调",
    avatar: "review-lantern",
    prompt: "优先给出当前版本的评审结论和本轮范围内的阻塞项。",
    operatingInstructions: "把当前真实状态和过期窗口分开，不把旧阻塞项带回当前分支。", 
    provider: "Claude Code CLI",
    providerPreference: "Claude Code CLI",
    modelPreference: "claude-sonnet-4",
    recallPolicy: "balanced",
    runtimePreference: "shock-sidecar",
    memorySpaces: ["workspace", "issue-room"],
    sandbox: {
      profile: "trusted",
      allowedHosts: [],
      allowedCommands: [],
      allowedTools: [],
      updatedAt: "2026-04-08T09:48:00Z",
      updatedBy: "Larkspur",
    },
    recentRunIds: ["run_inbox_01"],
    profileAudit: [],
  },
  {
    id: "agent-memory-clerk",
    name: "Memory Clerk",
    description: "维护文件级记忆的可追踪、可检查和可恢复。",
    mood: "等待策略输入",
    state: "blocked",
    lane: "OPS-27",
    role: "Memory Steward",
    avatar: "ledger-stack",
    prompt: "把 next-run injection、promotion 和 version audit 保持成可解释真值。",
    operatingInstructions: "任何 memory write 先过 governance，再决定是否 promotion 或 escalation。",
    provider: "Codex CLI",
    providerPreference: "Codex CLI",
    modelPreference: "gpt-5.1-codex-mini",
    recallPolicy: "agent-first",
    runtimePreference: "shock-main",
    memorySpaces: ["workspace", "user", "room-notes", "topic"],
    sandbox: {
      profile: "restricted",
      allowedHosts: ["github.com"],
      allowedCommands: ["git status"],
      allowedTools: ["read_file"],
      updatedAt: "2026-04-08T10:20:00Z",
      updatedBy: "Larkspur",
    },
    recentRunIds: ["run_memory_01"],
    profileAudit: [],
  },
];

export const machines: MachineStatus[] = [
  { id: "machine-main", name: "shock-main", state: "busy", cli: "Codex + Claude Code", shell: "pwsh", os: "Windows 11", lastHeartbeat: "8 秒前" },
  { id: "machine-sidecar", name: "shock-sidecar", state: "online", cli: "Codex", shell: "zsh", os: "macOS", lastHeartbeat: "21 秒前" },
];

export const guards: DestructiveGuard[] = [
  {
    id: "guard-runtime-destructive-git",
    title: "Destructive Git Cleanup Guard",
    summary: "这次请求会删除过时 branch / worktree；系统先把动作停在 approval_required，不会直接执行。",
    status: "approval_required",
    risk: "destructive_git",
    scope: "当前 repo 清理",
    roomId: "room-runtime",
    runId: "run_runtime_01",
    inboxItemId: "inbox-approval-runtime",
    approvalRequired: true,
    boundaries: [
      { label: "Action", value: "git branch -D / git worktree remove / clean stale files" },
      { label: "Sandbox", value: "只允许当前 workspace root；越界写入继续被拦截" },
      { label: "Secrets", value: "GitHub token / workspace secret 在批准前不会注入" },
    ],
  },
  {
    id: "guard-memory-boundary",
    title: "Cross-scope Write Boundary",
    summary: "写回同时命中 room / workspace / user memory；系统先阻断跨 scope 写入，等待人类确认优先级规则。",
    status: "blocked",
    risk: "filesystem_write",
    scope: "记忆写回",
    roomId: "room-memory",
    runId: "run_memory_01",
    inboxItemId: "inbox-blocked-memory",
    approvalRequired: true,
    boundaries: [
      { label: "Target", value: "MEMORY.md / notes/work-log.md / notes/rooms/room-memory.md" },
      { label: "Sandbox", value: "跨 scope 写入先 blocked，不会直接落盘" },
      { label: "Secrets", value: "用户私有记忆与后续 credential scope 保持封闭" },
    ],
  },
];

export const runtimes: RuntimeRegistryRecord[] = [
  {
    id: "runtime-shock-main",
    machine: "shock-main",
    daemonUrl: "http://127.0.0.1:8090",
    detectedCli: ["codex", "claude"],
    providers: [
      {
        id: "codex",
        label: "Codex CLI",
        mode: "native",
        capabilities: ["exec", "review", "apply-patch"],
        models: ["gpt-5.2", "gpt-5.3-codex", "gpt-5.1-codex-mini"],
        transport: "stdio",
        ready: true,
        status: "ready",
        statusMessage: "Codex CLI 已就绪，可直接发送。",
        checkedAt: "8 秒前",
      },
      {
        id: "claude",
        label: "Claude Code CLI",
        mode: "native",
        capabilities: ["exec", "review"],
        models: ["claude-sonnet-4", "claude-opus-4.1"],
        transport: "stdio",
        ready: false,
        status: "auth_required",
        statusMessage: "Claude Code CLI 还没有登录，请先在本机完成登录。",
        checkedAt: "8 秒前",
      },
    ],
    shell: "pwsh",
    state: "busy",
    pairingState: "paired",
    workspaceRoot: "/home/lark/OpenShock",
    reportedAt: "8 秒前",
    lastHeartbeatAt: "8 秒前",
    heartbeatIntervalSeconds: 15,
    heartbeatTimeoutSeconds: 45,
  },
  {
    id: "runtime-shock-sidecar",
    machine: "shock-sidecar",
    daemonUrl: "http://127.0.0.1:8091",
    detectedCli: ["codex"],
    providers: [
      {
        id: "codex",
        label: "Codex CLI",
        mode: "native",
        capabilities: ["exec", "review"],
        models: ["gpt-5.2", "gpt-5.3-codex", "gpt-5.1-codex-mini"],
        transport: "stdio",
        ready: true,
        status: "ready",
        statusMessage: "Codex CLI 已就绪，可直接发送。",
        checkedAt: "21 秒前",
      },
    ],
    shell: "zsh",
    state: "online",
    pairingState: "available",
    workspaceRoot: "/home/lark/OpenShock",
    reportedAt: "21 秒前",
    lastHeartbeatAt: "21 秒前",
    heartbeatIntervalSeconds: 15,
    heartbeatTimeoutSeconds: 45,
  },
];

export const inboxItems: InboxItem[] = [
  {
    id: "inbox-approval-runtime",
    title: "破坏性 Git 清理需要批准",
    kind: "approval",
    room: "Runtime 心跳讨论间",
    time: "2 分钟前",
    summary: "这个 Run 想在视觉核对通过后清理过时分支。",
    action: "查看批准",
    href: "/runs/run_runtime_01",
    guardId: "guard-runtime-destructive-git",
  },
  {
    id: "inbox-blocked-memory",
    title: "Memory Clerk 被记忆优先级阻塞",
    kind: "blocked",
    room: "记忆写回讨论间",
    time: "7 分钟前",
    summary: "写回前需要先确定 topic、房间、工作区、用户和 agent 的优先级规则。",
    action: "解除阻塞",
    href: "/runs/run_memory_01",
    guardId: "guard-memory-boundary",
  },
  {
    id: "inbox-review-copy",
    title: "Inbox 决策中心已经可以评审",
    kind: "review",
    room: "Inbox 讨论间",
    time: "12 分钟前",
    summary: "智能体已经准备好最终卡片文案和路由跳转。",
    action: "打开评审",
    href: "/runs/run_inbox_01",
  },
  {
    id: "inbox-status-shell",
    title: "Runtime lane 完成第一轮壳层接线",
    kind: "status",
    room: "Runtime 心跳讨论间",
    time: "18 分钟前",
    summary: "机器状态和 Run 元数据已经在主壳里可见。",
    action: "打开房间",
    href: "/rooms/room-runtime",
  },
];

export const pullRequests: PullRequest[] = [
  {
    id: "pr-runtime-18",
    number: 18,
    label: "PR #18",
    title: "运行环境：在讨论间展示心跳与泳道状态",
    status: "in_review",
    issueKey: "OPS-12",
    roomId: "room-runtime",
    runId: "run_runtime_01",
    branch: "feat/runtime-state-shell",
    author: "Codex Dockmaster",
    url: "https://github.com/Larkspur-Wang/OpenShock/pull/18",
    reviewSummary: "等待产品确认 destructive git cleanup 的审批边界。",
    updatedAt: "2 分钟前",
  },
  {
    id: "pr-inbox-22",
    number: 22,
    label: "PR #22",
    title: "收件箱：统一审批、阻塞与评审卡片",
    status: "in_review",
    issueKey: "OPS-19",
    roomId: "room-inbox",
    runId: "run_inbox_01",
    branch: "feat/inbox-decision-cards",
    author: "Claude Review Runner",
    url: "https://github.com/Larkspur-Wang/OpenShock/pull/22",
    reviewSummary: "等待人类确认卡片语气和默认动作。",
    updatedAt: "12 分钟前",
  },
  {
    id: "pr-memory-draft",
    number: 27,
    label: "草稿 PR",
    title: "记忆：把执行摘要写回 MEMORY.md",
    status: "draft",
    issueKey: "OPS-27",
    roomId: "room-memory",
    runId: "run_memory_01",
    branch: "feat/memory-writeback",
    author: "Memory Clerk",
    url: "https://github.com/Larkspur-Wang/OpenShock/pull/27",
    reviewSummary: "等待记忆优先级规则敲定后再进入评审。",
    updatedAt: "7 分钟前",
  },
];

export const setupSteps: SetupStep[] = [
  {
    id: "setup-identity",
    title: "身份与工作区",
    status: "done",
    summary: "邮箱优先的身份体系已经就绪。",
    detail: "工作区已经创建完成，浏览器会话可用，GitHub 可以作为代码身份接入。",
    href: "/settings",
  },
  {
    id: "setup-repo",
    title: "GitHub 仓库绑定",
    status: "done",
    summary: "本地 repo 已接入工作区，GitHub 真连接状态可探测。",
    detail: "当前先从本地 git origin 绑定仓库，再根据 gh CLI 认证状态判断是否具备进入真实远端 PR 的条件。",
    href: "/issues",
  },
  {
    id: "setup-runtime",
    title: "执行守护进程与运行环境配对",
    status: "active",
    summary: "本地机器已经配对并持续上报心跳。",
    detail: "shock-main 在线，Codex 与 Claude Code 都已被发现，前台可以读取实时运行环境状态。",
    href: "/rooms/room-runtime",
  },
  {
    id: "setup-pr",
    title: "PR 收口链路",
    status: "pending",
    summary: "本地收口已跑通，真实 GitHub 写回还差最后一段。",
    detail: "讨论间、Run、Inbox 和本地 PR 状态都已经打通，但远端 PR 创建和 GitHub 写回仍然在下一轮。",
    href: "/board",
  },
];

export const settingsSections: SettingsSection[] = [
  { id: "settings-auth", title: "账号身份", summary: "邮箱是主身份，GitHub 是连接进来的代码身份。", value: "邮箱优先 / GitHub 已连接" },
  { id: "settings-sandbox", title: "本地可信沙盒", summary: "高风险动作要升级审批，普通编码继承本地 CLI 策略。", value: "破坏性 Git / 强删 => approval_required" },
  { id: "settings-memory", title: "记忆模式", summary: "Phase 0 先坚持文件记忆；外部插件 provider 还没有进入当前主线。", value: "MEMORY.md / notes/ / decisions/" },
  { id: "settings-notify", title: "通知默认值", summary: "Inbox 接收全部事件，浏览器 Push 只保留高信号。", value: "浏览器 Push => 仅紧急" },
];

export function getChannelById(channelId: string) {
  return channels.find((channel) => channel.id === channelId);
}

export function getRoomById(roomId: string) {
  return rooms.find((room) => room.id === roomId);
}

export function getIssueByKey(issueKey: string) {
  return issues.find((issue) => issue.key.toLowerCase() === issueKey.toLowerCase());
}

export function getIssueByRoomId(roomId: string) {
  return issues.find((issue) => issue.roomId === roomId);
}

export function getRunById(runId: string) {
  return runs.find((run) => run.id === runId);
}

export function getAgentById(agentId: string) {
  return agents.find((agent) => agent.id === agentId);
}

export function getMessagesForChannel(channelId: string) {
  return channelMessages[channelId] ?? [];
}

export function getMessagesForRoom(roomId: string) {
  return roomMessages[roomId] ?? [];
}

export function getRunsForAgent(agentId: string) {
  const agent = getAgentById(agentId);
  return runs.filter((run) => agent?.recentRunIds.includes(run.id));
}

function buildBoardColumns(issueList: Issue[]) {
  return [
    { title: "阻塞排队", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "blocked") },
    { title: "待处理", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "queued") },
    { title: "进行中", accent: "var(--shock-yellow)", cards: issueList.filter((issue) => issue.state === "running") },
    { title: "已暂停", accent: "var(--shock-paper)", cards: issueList.filter((issue) => issue.state === "paused") },
    { title: "待评审", accent: "var(--shock-lime)", cards: issueList.filter((issue) => issue.state === "review") },
    { title: "已完成", accent: "white", cards: issueList.filter((issue) => issue.state === "done") },
  ];
}

export function getBoardColumns() {
  return buildBoardColumns(issues);
}

function buildGlobalStats(state: PhaseZeroState) {
  const activeRuns = state.runs.filter((run) => run.status === "running" || run.status === "review").length;
  const blockedCount = state.runs.filter((run) => run.status === "blocked" || run.status === "paused").length;

  return [
    { label: "活跃执行", value: String(activeRuns).padStart(2, "0"), tone: "yellow" as const },
    { label: "阻塞", value: String(blockedCount).padStart(2, "0"), tone: "pink" as const },
    { label: "收件箱", value: String(state.inbox.length).padStart(2, "0"), tone: "lime" as const },
  ];
}

export function getGlobalStats() {
  return buildGlobalStats(fallbackState);
}

export const fallbackState: PhaseZeroState = {
  workspace,
  auth,
  channels,
  channelMessages,
  directMessages: [],
  directMessageMessages: {},
  followedThreads: [],
  savedLaterItems: [],
  quickSearchEntries: [],
  issues,
  rooms,
  roomMessages,
  runs,
  agents,
  machines,
  runtimes,
  inbox: inboxItems,
  pullRequests,
  sessions: [],
  runtimeLeases: [],
  runtimeScheduler: {
    selectedRuntime: workspace.pairedRuntime,
    preferredRuntime: workspace.pairedRuntime,
    assignedRuntime: workspace.pairedRuntime,
    assignedMachine: workspace.pairedRuntime,
    strategy: "selected_runtime",
    summary: "当前 fallback state 仍按 workspace selection 指向 shock-main。",
    candidates: [],
  },
  guards,
  memory: [],
};
