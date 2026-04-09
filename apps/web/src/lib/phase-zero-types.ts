export type AppTab = "chat" | "rooms" | "inbox" | "board";

export type Priority = "critical" | "high" | "medium";
export type RunStatus = "queued" | "running" | "paused" | "blocked" | "review" | "done";
export type PresenceState = "running" | "idle" | "blocked";
export type MachineState = "online" | "busy" | "offline";
export type InboxKind = "blocked" | "approval" | "review" | "status";
export type PullRequestStatus = "draft" | "open" | "in_review" | "changes_requested" | "merged";
export type DestructiveGuardStatus = "approval_required" | "blocked" | "ready";
export type DestructiveGuardRisk = "destructive_git" | "filesystem_write" | "secret_scope";

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
  repoBinding: WorkspaceRepoBindingSnapshot;
  githubInstallation: WorkspaceGitHubInstallSnapshot;
  onboarding: WorkspaceOnboardingSnapshot;
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
  tone: "human" | "agent" | "blocked" | "system";
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

export type SearchResultKind = "channel" | "dm" | "room" | "topic" | "issue" | "run" | "agent" | "followed" | "saved";

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

export type RunHistoryEntry = {
  run: Run;
  room: Room;
  issue: Issue;
  session: Session;
  isCurrent: boolean;
};

export type RunHistoryPage = {
  items: RunHistoryEntry[];
  nextCursor?: string;
  totalCount: number;
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
  handoffId?: string;
};

export type MailboxMessageKind = "request" | "ack" | "blocked" | "complete";

export type MailboxMessage = {
  id: string;
  handoffId: string;
  kind: MailboxMessageKind;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type HandoffStatus = "requested" | "acknowledged" | "blocked" | "completed";

export type AgentHandoff = {
  id: string;
  title: string;
  summary: string;
  status: HandoffStatus;
  issueKey: string;
  roomId: string;
  runId: string;
  fromAgentId: string;
  fromAgent: string;
  toAgentId: string;
  toAgent: string;
  inboxItemId?: string;
  requestedAt: string;
  updatedAt: string;
  lastAction: string;
  lastNote?: string;
  messages: MailboxMessage[];
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
  templateId?: string;
  templateLabel?: string;
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

export type PullRequestConversationEntry = {
  id: string;
  kind: "review" | "comment" | "review_comment" | "review_thread";
  action: string;
  author: string;
  summary: string;
  body?: string;
  reviewDecision?: string;
  reviewState?: string;
  threadStatus?: string;
  path?: string;
  line?: number;
  url?: string;
  updatedAt?: string;
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
  reviewDecision?: string;
  reviewSummary: string;
  conversation?: PullRequestConversationEntry[];
  updatedAt: string;
};

export type PullRequestDetail = {
  pullRequest: PullRequest;
  room: Room;
  run: Run;
  issue: Issue;
  conversation: PullRequestConversationEntry[];
  relatedInbox: InboxItem[];
  delivery: PullRequestDeliveryEntry;
};

export type PullRequestDeliveryEntry = {
  status: "ready" | "warning" | "blocked";
  releaseReady: boolean;
  summary: string;
  gates: PullRequestDeliveryGate[];
  templates: PullRequestDeliveryTemplate[];
  handoffNote: PullRequestDeliveryHandoffNote;
  evidence: PullRequestDeliveryEvidence[];
};

export type PullRequestDeliveryGate = {
  id: string;
  label: string;
  status: "ready" | "warning" | "blocked";
  summary: string;
  href?: string;
};

export type PullRequestDeliveryTemplate = {
  templateId?: string;
  label: string;
  status: "ready" | "warning" | "blocked";
  readyDeliveries: number;
  blockedDeliveries: number;
  sentReceipts: number;
  failedReceipts: number;
  href?: string;
};

export type PullRequestDeliveryHandoffNote = {
  title: string;
  summary: string;
  lines: string[];
};

export type PullRequestDeliveryEvidence = {
  id: string;
  label: string;
  value: string;
  summary: string;
  href?: string;
};

export type RunDetail = {
  run: Run;
  room: Room;
  issue: Issue;
  session: Session;
  history: RunHistoryEntry[];
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
  correctionCount?: number;
  lastCorrectionAt?: string;
  lastCorrectionBy?: string;
  lastCorrectionNote?: string;
  forgotten?: boolean;
  forgottenAt?: string;
  forgottenBy?: string;
  forgetReason?: string;
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
  mailbox: AgentHandoff[];
  pullRequests: PullRequest[];
  sessions: Session[];
  runtimeLeases: RuntimeLeaseRecord[];
  runtimeScheduler: RuntimeScheduler;
  guards: DestructiveGuard[];
  memory: MemoryArtifact[];
};
