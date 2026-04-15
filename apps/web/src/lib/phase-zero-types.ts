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
  governance: WorkspaceGovernanceSnapshot;
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

export type WorkspaceGovernanceSnapshot = {
  templateId?: string;
  label?: string;
  summary?: string;
  configuredTopology?: WorkspaceGovernanceLaneConfig[];
  deliveryDelegationMode?: string;
  teamTopology: WorkspaceGovernanceLane[];
  handoffRules: WorkspaceGovernanceRule[];
  routingPolicy: WorkspaceGovernanceRoutingPolicy;
  escalationSla: WorkspaceGovernanceEscalationSLA;
  notificationPolicy: WorkspaceGovernanceNotificationPolicy;
  responseAggregation: WorkspaceResponseAggregation;
  humanOverride: WorkspaceHumanOverride;
  walkthrough: WorkspaceGovernanceWalkthrough[];
  stats: WorkspaceGovernanceStats;
};

export type WorkspaceGovernanceLaneConfig = {
  id: string;
  label: string;
  role: string;
  defaultAgent?: string;
  lane?: string;
};

export type WorkspaceGovernanceLane = {
  id: string;
  label: string;
  role: string;
  defaultAgent?: string;
  lane?: string;
  status: string;
  summary: string;
};

export type WorkspaceGovernanceRule = {
  id: string;
  label: string;
  status: string;
  summary: string;
  href?: string;
};

export type WorkspaceGovernanceRoutingPolicy = {
  status: string;
  summary: string;
  defaultRoute?: string;
  rules?: WorkspaceGovernanceRouteRule[];
  suggestedHandoff: WorkspaceGovernanceSuggestedHandoff;
};

export type WorkspaceGovernanceRouteRule = {
  id: string;
  trigger: string;
  fromLane: string;
  toLane: string;
  policy: string;
  summary: string;
  status: string;
};

export type WorkspaceGovernanceSuggestedHandoff = {
  status: string;
  reason: string;
  roomId?: string;
  issueKey?: string;
  fromLaneId?: string;
  fromLaneLabel?: string;
  fromAgentId?: string;
  fromAgent?: string;
  toLaneId?: string;
  toLaneLabel?: string;
  toAgentId?: string;
  toAgent?: string;
  draftTitle?: string;
  draftSummary?: string;
  handoffId?: string;
  href?: string;
};

export type WorkspaceGovernanceEscalationSLA = {
  status: string;
  summary: string;
  timeoutMinutes: number;
  retryBudget: number;
  activeEscalations: number;
  breachedEscalations: number;
  nextEscalation?: string;
  queue?: WorkspaceGovernanceEscalationQueueEntry[];
  rollup?: WorkspaceGovernanceEscalationRoomRollup[];
};

export type WorkspaceGovernanceEscalationQueueEntry = {
  id: string;
  label: string;
  status: string;
  source: string;
  owner?: string;
  summary: string;
  nextStep: string;
  href?: string;
  timeLabel?: string;
  elapsedMinutes: number;
  thresholdMinutes: number;
};

export type WorkspaceGovernanceEscalationRoomRollup = {
  roomId: string;
  roomTitle: string;
  status: string;
  escalationCount: number;
  blockedCount: number;
  currentOwner?: string;
  currentLane?: string;
  latestSource?: string;
  latestLabel?: string;
  latestSummary?: string;
  nextRouteStatus?: string;
  nextRouteLabel?: string;
  nextRouteSummary?: string;
  nextRouteHref?: string;
  href?: string;
};

export type WorkspaceGovernanceNotificationPolicy = {
  status: string;
  summary: string;
  browserPush?: string;
  targets?: string[];
  escalationChannel?: string;
};

export type WorkspaceResponseAggregationAuditEntry = {
  id: string;
  label: string;
  status: string;
  actor?: string;
  summary: string;
  occurredAt?: string;
};

export type WorkspaceResponseAggregation = {
  status: string;
  summary: string;
  sources?: string[];
  finalResponse?: string;
  aggregator?: string;
  decisionPath?: string[];
  overrideTrace?: string[];
  auditTrail?: WorkspaceResponseAggregationAuditEntry[];
};

export type WorkspaceHumanOverride = {
  status: string;
  summary: string;
  href?: string;
};

export type WorkspaceGovernanceWalkthrough = {
  id: string;
  label: string;
  status: string;
  summary: string;
  detail?: string;
  href?: string;
};

export type WorkspaceGovernanceStats = {
  openHandoffs: number;
  blockedEscalations: number;
  reviewGates: number;
  humanOverrideGates: number;
  slaBreaches: number;
  aggregationSources: number;
};

export type RuntimePublishRecord = {
  id: string;
  runtimeId: string;
  runId: string;
  sessionId?: string;
  roomId?: string;
  sequence: number;
  cursor: number;
  phase: string;
  status: string;
  summary: string;
  idempotencyKey?: string;
  failureAnchor?: string;
  closeoutReason?: string;
  evidenceLines?: string[];
  occurredAt: string;
};

export type RuntimeReplayEvidencePacket = {
  runId: string;
  sessionId?: string;
  roomId?: string;
  runtimeId: string;
  lastCursor: number;
  status: string;
  summary: string;
  failureAnchor?: string;
  closeoutReason?: string;
  replayAnchor?: string;
  events: RuntimePublishRecord[];
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
  sandbox: SandboxPolicy;
  sandboxDecision: SandboxDecision;
  stdout: string[];
  stderr: string[];
  toolCalls: ToolCall[];
  timeline: RunEvent[];
  usage?: RunUsageSnapshot;
  nextAction: string;
  pullRequest: string;
  credentialProfileIds?: string[];
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
  credentialProfileIds?: string[];
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
  fileStack?: Array<{
    path: string;
    kind: string;
    summary: string;
    scope?: string;
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

export type PlannerQueueGate = {
  kind: InboxKind;
  title: string;
  summary: string;
  href: string;
};

export type PlannerAutoMergeGuard = {
  status: string;
  reason: string;
  canRequest: boolean;
  canApply: boolean;
  requiresPermission?: string;
  reviewDecision?: string;
  pullRequestId?: string;
  roomId?: string;
  runId?: string;
};

export type PlannerQueueItem = {
  sessionId: string;
  issueKey: string;
  roomId: string;
  runId: string;
  status: RunStatus | string;
  summary: string;
  owner: string;
  agentId?: string;
  agentName?: string;
  provider: string;
  runtime: string;
  machine: string;
  worktreePath?: string;
  pullRequestId?: string;
  pullRequestLabel?: string;
  pullRequestStatus?: PullRequestStatus | string;
  reviewDecision?: string;
  approvalRequired: boolean;
  gates: PlannerQueueGate[];
  autoMerge: PlannerAutoMergeGuard;
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

export type MailboxMessageKind =
  | "request"
  | "ack"
  | "blocked"
  | "comment"
  | "complete"
  | "parent-progress"
  | "response-progress";

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

export type RoomAgentWait = {
  id: string;
  roomId: string;
  agentId: string;
  agent: string;
  blockingMessageId: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
};

export type AgentHandoff = {
  id: string;
  kind?: string;
  parentHandoffId?: string;
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
  mergeable?: string;
  mergeStateStatus?: string;
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
  delegation: PullRequestDeliveryDelegation;
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

export type PullRequestDeliveryDelegation = {
  status: "pending" | "ready" | "blocked" | "done";
  targetLane?: string;
  targetAgent?: string;
  summary: string;
  href?: string;
  inboxItemId?: string;
  handoffId?: string;
  handoffHref?: string;
  handoffStatus?: HandoffStatus;
  responseAttemptCount?: number;
  responseHandoffId?: string;
  responseHandoffHref?: string;
  responseHandoffStatus?: HandoffStatus;
  communication?: PullRequestDeliveryCommunicationEntry[];
};

export type PullRequestDeliveryCommunicationEntry = {
  id: string;
  handoffId: string;
  handoffKind: string;
  handoffLabel: string;
  handoffTitle: string;
  handoffStatus: HandoffStatus;
  messageKind: string;
  actor: string;
  summary: string;
  createdAt: string;
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
  continuityReady?: boolean;
  pendingTurn?: SessionPendingTurn;
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

export type SessionPendingTurn = {
  prompt?: string;
  provider?: string;
  status?: string;
  preview?: string;
  startedAt?: string;
  updatedAt?: string;
  resumeEligible?: boolean;
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

export type CredentialProfileAuditEntry = {
  id: string;
  action: string;
  summary: string;
  updatedAt: string;
  updatedBy: string;
};

export type CredentialProfile = {
  id: string;
  label: string;
  summary: string;
  secretKind: string;
  secretStatus: string;
  workspaceDefault: boolean;
  updatedAt: string;
  updatedBy: string;
  lastRotatedAt?: string;
  lastUsedAt?: string;
  lastUsedBy?: string;
  lastUsedRunId?: string;
  audit?: CredentialProfileAuditEntry[];
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
  roomAgentWaits: RoomAgentWait[];
  pullRequests: PullRequest[];
  sessions: Session[];
  runtimeLeases: RuntimeLeaseRecord[];
  runtimeScheduler: RuntimeScheduler;
  guards: DestructiveGuard[];
  memory: MemoryArtifact[];
  credentials: CredentialProfile[];
};
