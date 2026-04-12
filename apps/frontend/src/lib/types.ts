export type Workspace = {
  id: string;
  name: string;
  repoBindings: WorkspaceRepoBinding[];
  defaultRepoBindingId?: string;
};

export type WorkspacesResponse = {
  workspaces: Workspace[];
  currentWorkspaceId: string;
};

export type WorkspaceResponse = {
  workspace: Workspace;
};

export type WorkspaceRepoBinding = {
  id: string;
  workspaceId: string;
  label: string;
  repoPath: string;
  isDefault: boolean;
  status: string;
};

export type RoomSummary = {
  id: string;
  issueId?: string;
  directAgentId?: string;
  kind: "issue" | "discussion" | "direct_message";
  title: string;
  unreadCount: number;
};

export type RoomChannel = {
  id: string;
  roomId: string;
  name: string;
};

export type IssueSummary = {
  id: string;
  title: string;
  status: string;
};

export type Issue = IssueSummary & {
  priority: string;
  summary: string;
  repoPath?: string;
};

export type Agent = {
  id: string;
  name: string;
  prompt: string;
};

export type AgentsResponse = {
  agents: Agent[];
};

export type AgentMutationResponse = {
  agent: Agent;
};

export type AgentDetailResponse = {
  workspace: Workspace;
  agent: Agent;
  rooms: RoomSummary[];
  messages: Message[];
  agentSessions: AgentSession[];
  agentTurns: AgentTurn[];
  agentTurnOutputChunks: AgentTurnOutputChunk[];
  agentTurnToolCalls: AgentTurnToolCall[];
  handoffRecords: HandoffRecord[];
};

export type AgentDeleteResponse = {
  deleted: boolean;
  agentId: string;
};

export type Runtime = {
  id: string;
  name: string;
  status: string;
  provider: string;
};

export type Message = {
  id: string;
  actorType: string;
  actorName: string;
  body: string;
  kind: string;
  createdAt: string;
};

export type EventFrame = {
  currentTarget: string;
  sourceTarget: string;
  sourceMessageId: string;
  requestedBy?: string;
  relatedIssueId?: string;
  relatedTaskId?: string;
  recentMessagesSummary?: string;
  expectedAction?: string;
  contextSummary?: string;
};

export type AgentSession = {
  id: string;
  roomId: string;
  agentId: string;
  joinedRoom?: boolean;
  providerThreadId?: string;
  appServerThreadId?: string;
  status: string;
  lastMessageId?: string;
  currentTurnId?: string;
  updatedAt: string;
};

export type AgentTurn = {
  id: string;
  sessionId: string;
  roomId: string;
  agentId: string;
  sequence: number;
  triggerMessageId: string;
  intentType: string;
  wakeupMode?: string;
  eventFrame: EventFrame;
  status: string;
  createdAt: string;
};

export type AgentTurnOutputChunk = {
  id: string;
  turnId: string;
  sequence: number;
  stream: string;
  content: string;
  createdAt: string;
};

export type AgentTurnToolCall = {
  id: string;
  turnId: string;
  sequence: number;
  toolName: string;
  arguments?: string;
  status: string;
  createdAt: string;
};

export type HandoffRecord = {
  id: string;
  roomId: string;
  fromSessionId: string;
  fromAgentId: string;
  toAgentId: string;
  triggerMessageId: string;
  status: string;
  acceptedTurnId?: string;
  createdAt: string;
};

export type Task = {
  id: string;
  issueId: string;
  title: string;
  description?: string;
  status: string;
  assigneeAgentId: string;
  branchName: string;
  runCount: number;
};

export type Run = {
  id: string;
  taskId: string;
  agentId: string;
  issueId?: string;
  branchName?: string;
  baseBranch?: string;
  repoPath?: string;
  instruction?: string;
  runtimeId: string;
  status: string;
  title: string;
  outputPreview: string;
};

export type RunOutputChunk = {
  id: string;
  runId: string;
  sequence: number;
  stream: string;
  content: string;
  createdAt: string;
};

export type ToolCall = {
  id: string;
  runId: string;
  sequence: number;
  toolName: string;
  arguments?: string;
  status: string;
  createdAt: string;
};

export type MergeAttempt = {
  id: string;
  issueId: string;
  taskId: string;
  sourceRunId?: string;
  sourceBranch: string;
  targetBranch: string;
  repoPath?: string;
  status: string;
  runtimeId: string;
  resultSummary?: string;
};

export type IntegrationBranch = {
  id: string;
  issueId: string;
  name: string;
  status: string;
  mergedTaskIds: string[];
};

export type DeliveryPR = {
  id: string;
  issueId: string;
  title: string;
  status: string;
  externalPrId?: string;
  externalUrl?: string;
};

export type InboxItem = {
  id: string;
  title: string;
  kind: string;
  severity: string;
  summary: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  primaryActionType?: string;
};

export type BootstrapResponse = {
  workspace: Workspace;
  defaultRoomId: string;
  defaultIssueId: string;
  rooms: RoomSummary[];
  directRooms: RoomSummary[];
  agents: Agent[];
  runtimes: Runtime[];
  issueSummaries: IssueSummary[];
};

export type RoomDetailResponse = {
  workspace: Workspace;
  room: RoomSummary;
  channel: RoomChannel;
  messages: Message[];
  agentSessions: AgentSession[];
  agentTurns: AgentTurn[];
  agentTurnOutputChunks: AgentTurnOutputChunk[];
  agentTurnToolCalls: AgentTurnToolCall[];
  handoffRecords: HandoffRecord[];
  issue?: Issue;
  tasks: Task[];
  runs: Run[];
  runOutputChunks: RunOutputChunk[];
  toolCalls: ToolCall[];
  mergeAttempts: MergeAttempt[];
  integrationBranch?: IntegrationBranch;
  deliveryPr: DeliveryPR | null;
};

export type RoomReadResponse = {
  room: RoomSummary;
};

export type IssueDetailResponse = {
  workspace: Workspace;
  issue: Issue;
  room: RoomSummary;
  channel: RoomChannel;
  messages: Message[];
  agentSessions: AgentSession[];
  agentTurns: AgentTurn[];
  agentTurnOutputChunks: AgentTurnOutputChunk[];
  agentTurnToolCalls: AgentTurnToolCall[];
  handoffRecords: HandoffRecord[];
  tasks: Task[];
  runs: Run[];
  runOutputChunks: RunOutputChunk[];
  toolCalls: ToolCall[];
  mergeAttempts: MergeAttempt[];
  integrationBranch: IntegrationBranch;
  deliveryPr: DeliveryPR | null;
};

export type TaskBoardResponse = {
  columns: string[];
  tasks: Task[];
};

export type InboxResponse = {
  items: InboxItem[];
};

export type ActionRequest = {
  actorType: "member" | "agent" | "system";
  actorId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type ActionEntity = {
  type: string;
  id: string;
};

export type ActionResponse = {
  actionId: string;
  status: string;
  resultCode: string;
  resultMessage: string;
  affectedEntities: ActionEntity[];
};

export type Member = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  id: string;
  memberId: string;
  activeWorkspaceId?: string;
  createdAt: string;
  lastSeenAt: string;
};

export type AuthTokenResponse = {
  sessionToken: string;
  session: AuthSession;
  member: Member;
};

export type AuthSessionStateResponse = {
  authenticated: boolean;
  session?: AuthSession;
  member?: Member;
};

export type AuthLogoutResponse = {
  loggedOut: boolean;
};

export type AuthProfileResponse = {
  member: Member;
};
