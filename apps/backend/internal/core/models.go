package core

type Workspace struct {
	ID                   string                 `json:"id"`
	Name                 string                 `json:"name"`
	RepoBindings         []WorkspaceRepoBinding `json:"repoBindings"`
	DefaultRepoBindingID string                 `json:"defaultRepoBindingId,omitempty"`
}

type WorkspaceRepoBinding struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	Label       string `json:"label"`
	RepoPath    string `json:"repoPath"`
	IsDefault   bool   `json:"isDefault"`
	Status      string `json:"status"`
}

type RoomSummary struct {
	ID          string `json:"id"`
	IssueID     string `json:"issueId,omitempty"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	UnreadCount int    `json:"unreadCount"`
}

type RoomChannel struct {
	ID     string `json:"id"`
	RoomID string `json:"roomId"`
	Name   string `json:"name"`
}

type IssueSummary struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type Issue struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	Priority string `json:"priority"`
	Summary  string `json:"summary"`
	RepoPath string `json:"repoPath,omitempty"`
}

type Agent struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Status string `json:"status"`
}

type Runtime struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	Provider string `json:"provider"`
}

type RegisterRuntimeRequest struct {
	Name      string `json:"name"`
	Provider  string `json:"provider"`
	SlotCount int    `json:"slotCount"`
}

type RegisterRuntimeResponse struct {
	Runtime Runtime `json:"runtime"`
}

type RuntimeHeartbeatRequest struct {
	Status       string `json:"status"`
	CurrentRunID string `json:"currentRunId,omitempty"`
}

type RuntimeHeartbeatResponse struct {
	RuntimeID string `json:"runtimeId"`
	Status    string `json:"status"`
}

type Message struct {
	ID        string `json:"id"`
	ActorType string `json:"actorType"`
	ActorName string `json:"actorName"`
	Body      string `json:"body"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"createdAt"`
}

type EventFrame struct {
	CurrentTarget         string `json:"currentTarget"`
	SourceTarget          string `json:"sourceTarget"`
	SourceMessageID       string `json:"sourceMessageId"`
	RequestedBy           string `json:"requestedBy,omitempty"`
	RelatedIssueID        string `json:"relatedIssueId,omitempty"`
	RelatedTaskID         string `json:"relatedTaskId,omitempty"`
	RecentMessagesSummary string `json:"recentMessagesSummary,omitempty"`
	ExpectedAction        string `json:"expectedAction,omitempty"`
	ContextSummary        string `json:"contextSummary,omitempty"`
}

type AgentSession struct {
	ID               string `json:"id"`
	RoomID           string `json:"roomId"`
	AgentID          string `json:"agentId"`
	ProviderThreadID string `json:"providerThreadId,omitempty"`
	Status           string `json:"status"`
	LastMessageID    string `json:"lastMessageId,omitempty"`
	CurrentTurnID    string `json:"currentTurnId,omitempty"`
	UpdatedAt        string `json:"updatedAt"`
}

type AgentTurn struct {
	ID               string     `json:"id"`
	SessionID        string     `json:"sessionId"`
	RoomID           string     `json:"roomId"`
	AgentID          string     `json:"agentId"`
	Sequence         int        `json:"sequence"`
	TriggerMessageID string     `json:"triggerMessageId"`
	IntentType       string     `json:"intentType"`
	WakeupMode       string     `json:"wakeupMode,omitempty"`
	EventFrame       EventFrame `json:"eventFrame"`
	Status           string     `json:"status"`
	CreatedAt        string     `json:"createdAt"`
}

type AgentTurnExecution struct {
	Turn           AgentTurn    `json:"turn"`
	Session        AgentSession `json:"session"`
	Room           RoomSummary  `json:"room"`
	TriggerMessage Message      `json:"triggerMessage"`
	Messages       []Message    `json:"messages"`
}

type AgentWait struct {
	ID                string `json:"id"`
	SessionID         string `json:"sessionId"`
	RoomID            string `json:"roomId"`
	AgentID           string `json:"agentId"`
	BlockingMessageID string `json:"blockingMessageId"`
	Status            string `json:"status"`
	CreatedAt         string `json:"createdAt"`
	ResolvedAt        string `json:"resolvedAt,omitempty"`
}

type HandoffRecord struct {
	ID               string `json:"id"`
	RoomID           string `json:"roomId"`
	FromSessionID    string `json:"fromSessionId"`
	FromAgentID      string `json:"fromAgentId"`
	ToAgentID        string `json:"toAgentId"`
	TriggerMessageID string `json:"triggerMessageId"`
	Status           string `json:"status"`
	AcceptedTurnID   string `json:"acceptedTurnId,omitempty"`
	CreatedAt        string `json:"createdAt"`
}

type Task struct {
	ID              string `json:"id"`
	IssueID         string `json:"issueId"`
	Title           string `json:"title"`
	Description     string `json:"description,omitempty"`
	Status          string `json:"status"`
	AssigneeAgentID string `json:"assigneeAgentId"`
	BranchName      string `json:"branchName"`
	RunCount        int    `json:"runCount"`
}

type Run struct {
	ID            string `json:"id"`
	TaskID        string `json:"taskId"`
	AgentID       string `json:"agentId"`
	IssueID       string `json:"issueId,omitempty"`
	BranchName    string `json:"branchName,omitempty"`
	BaseBranch    string `json:"baseBranch,omitempty"`
	RepoPath      string `json:"repoPath,omitempty"`
	Instruction   string `json:"instruction,omitempty"`
	RuntimeID     string `json:"runtimeId"`
	Status        string `json:"status"`
	Title         string `json:"title"`
	OutputPreview string `json:"outputPreview"`
}

type RunClaimRequest struct {
	RuntimeID string `json:"runtimeId"`
}

type RunClaimResponse struct {
	Claimed bool `json:"claimed"`
	Run     *Run `json:"run"`
}

type RunEventRequest struct {
	RuntimeID     string         `json:"runtimeId"`
	EventType     string         `json:"eventType"`
	OutputPreview string         `json:"outputPreview,omitempty"`
	Message       string         `json:"message,omitempty"`
	Stream        string         `json:"stream,omitempty"`
	ToolCall      *ToolCallInput `json:"toolCall,omitempty"`
}

type RunEventResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"`
}

type RunOutputChunk struct {
	ID        string `json:"id"`
	RunID     string `json:"runId"`
	Sequence  int    `json:"sequence"`
	Stream    string `json:"stream"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type ToolCallInput struct {
	ToolName  string `json:"toolName"`
	Arguments string `json:"arguments,omitempty"`
	Status    string `json:"status,omitempty"`
}

type ToolCall struct {
	ID        string `json:"id"`
	RunID     string `json:"runId"`
	Sequence  int    `json:"sequence"`
	ToolName  string `json:"toolName"`
	Arguments string `json:"arguments,omitempty"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

type MergeAttempt struct {
	ID            string `json:"id"`
	IssueID       string `json:"issueId"`
	TaskID        string `json:"taskId"`
	SourceRunID   string `json:"sourceRunId,omitempty"`
	SourceBranch  string `json:"sourceBranch"`
	TargetBranch  string `json:"targetBranch"`
	RepoPath      string `json:"repoPath,omitempty"`
	Status        string `json:"status"`
	RuntimeID     string `json:"runtimeId"`
	ResultSummary string `json:"resultSummary,omitempty"`
}

type MergeClaimRequest struct {
	RuntimeID string `json:"runtimeId"`
}

type MergeClaimResponse struct {
	Claimed      bool          `json:"claimed"`
	MergeAttempt *MergeAttempt `json:"mergeAttempt"`
}

type MergeEventRequest struct {
	RuntimeID     string `json:"runtimeId"`
	EventType     string `json:"eventType"`
	ResultSummary string `json:"resultSummary,omitempty"`
}

type MergeEventResponse struct {
	MergeAttemptID string `json:"mergeAttemptId"`
	Status         string `json:"status"`
}

type AgentTurnClaimRequest struct {
	RuntimeID string `json:"runtimeId"`
}

type AgentTurnClaimResponse struct {
	Claimed   bool                `json:"claimed"`
	AgentTurn *AgentTurnExecution `json:"agentTurn"`
}

type AgentTurnCompleteRequest struct {
	RuntimeID       string `json:"runtimeId"`
	ResultMessageID string `json:"resultMessageId,omitempty"`
}

type AgentTurnCompleteResponse struct {
	AgentTurnID string `json:"agentTurnId"`
	Status      string `json:"status"`
}

type IntegrationBranch struct {
	ID            string   `json:"id"`
	IssueID       string   `json:"issueId"`
	Name          string   `json:"name"`
	Status        string   `json:"status"`
	MergedTaskIDs []string `json:"mergedTaskIds"`
}

type DeliveryPR struct {
	ID           string `json:"id"`
	IssueID      string `json:"issueId"`
	Title        string `json:"title"`
	Status       string `json:"status"`
	ExternalPRID string `json:"externalPrId,omitempty"`
	ExternalURL  string `json:"externalUrl,omitempty"`
}

type RepoWebhookRequest struct {
	EventID      string `json:"eventId"`
	Provider     string `json:"provider"`
	ExternalPRID string `json:"externalPrId"`
	Status       string `json:"status"`
}

type RepoWebhookResponse struct {
	DeliveryPRID string `json:"deliveryPrId"`
	Status       string `json:"status"`
	Replayed     bool   `json:"replayed"`
}

type InboxItem struct {
	ID                string `json:"id"`
	Title             string `json:"title"`
	Kind              string `json:"kind"`
	Severity          string `json:"severity"`
	Summary           string `json:"summary"`
	RelatedEntityType string `json:"relatedEntityType,omitempty"`
	RelatedEntityID   string `json:"relatedEntityId,omitempty"`
	PrimaryActionType string `json:"primaryActionType,omitempty"`
}

type BootstrapResponse struct {
	Workspace      Workspace      `json:"workspace"`
	DefaultRoomID  string         `json:"defaultRoomId"`
	DefaultIssueID string         `json:"defaultIssueId"`
	Rooms          []RoomSummary  `json:"rooms"`
	Agents         []Agent        `json:"agents"`
	Runtimes       []Runtime      `json:"runtimes"`
	IssueSummaries []IssueSummary `json:"issueSummaries"`
}

type RoomDetailResponse struct {
	Workspace         Workspace          `json:"workspace"`
	Room              RoomSummary        `json:"room"`
	Channel           RoomChannel        `json:"channel"`
	Messages          []Message          `json:"messages"`
	AgentSessions     []AgentSession     `json:"agentSessions"`
	AgentTurns        []AgentTurn        `json:"agentTurns"`
	AgentWaits        []AgentWait        `json:"agentWaits"`
	HandoffRecords    []HandoffRecord    `json:"handoffRecords"`
	Issue             *Issue             `json:"issue,omitempty"`
	Tasks             []Task             `json:"tasks"`
	Runs              []Run              `json:"runs"`
	RunOutputChunks   []RunOutputChunk   `json:"runOutputChunks"`
	ToolCalls         []ToolCall         `json:"toolCalls"`
	MergeAttempts     []MergeAttempt     `json:"mergeAttempts"`
	IntegrationBranch *IntegrationBranch `json:"integrationBranch,omitempty"`
	DeliveryPR        *DeliveryPR        `json:"deliveryPr"`
}

type IssueDetailResponse struct {
	Workspace         Workspace         `json:"workspace"`
	Issue             Issue             `json:"issue"`
	Room              RoomSummary       `json:"room"`
	Channel           RoomChannel       `json:"channel"`
	Messages          []Message         `json:"messages"`
	AgentSessions     []AgentSession    `json:"agentSessions"`
	AgentTurns        []AgentTurn       `json:"agentTurns"`
	AgentWaits        []AgentWait       `json:"agentWaits"`
	HandoffRecords    []HandoffRecord   `json:"handoffRecords"`
	Tasks             []Task            `json:"tasks"`
	Runs              []Run             `json:"runs"`
	RunOutputChunks   []RunOutputChunk  `json:"runOutputChunks"`
	ToolCalls         []ToolCall        `json:"toolCalls"`
	MergeAttempts     []MergeAttempt    `json:"mergeAttempts"`
	IntegrationBranch IntegrationBranch `json:"integrationBranch"`
	DeliveryPR        *DeliveryPR       `json:"deliveryPr"`
}

type TaskBoardResponse struct {
	Columns []string `json:"columns"`
	Tasks   []Task   `json:"tasks"`
}

type InboxResponse struct {
	Items []InboxItem `json:"items"`
}

type ActionRequest struct {
	ActorType      string         `json:"actorType"`
	ActorID        string         `json:"actorId"`
	ActionType     string         `json:"actionType"`
	TargetType     string         `json:"targetType"`
	TargetID       string         `json:"targetId"`
	Payload        map[string]any `json:"payload"`
	IdempotencyKey string         `json:"idempotencyKey"`
}

type ActionEntity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type ActionResponse struct {
	ActionID         string         `json:"actionId"`
	Status           string         `json:"status"`
	ResultCode       string         `json:"resultCode"`
	ResultMessage    string         `json:"resultMessage"`
	AffectedEntities []ActionEntity `json:"affectedEntities"`
}
