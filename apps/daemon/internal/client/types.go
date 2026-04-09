package client

type Runtime struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	Provider string `json:"provider"`
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

type RoomSummary struct {
	ID      string `json:"id"`
	IssueID string `json:"issueId,omitempty"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
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

type ToolCallInput struct {
	ToolName  string `json:"toolName"`
	Arguments string `json:"arguments,omitempty"`
	Status    string `json:"status,omitempty"`
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
