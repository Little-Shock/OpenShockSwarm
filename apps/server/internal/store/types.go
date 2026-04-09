package store

import "sync"

type WorkspaceSnapshot struct {
	Name               string                         `json:"name"`
	Repo               string                         `json:"repo"`
	RepoURL            string                         `json:"repoUrl"`
	Branch             string                         `json:"branch"`
	RepoProvider       string                         `json:"repoProvider"`
	RepoBindingStatus  string                         `json:"repoBindingStatus"`
	RepoAuthMode       string                         `json:"repoAuthMode"`
	Plan               string                         `json:"plan"`
	Quota              WorkspaceQuotaSnapshot         `json:"quota"`
	Usage              WorkspaceUsageSnapshot         `json:"usage"`
	PairedRuntime      string                         `json:"pairedRuntime"`
	PairedRuntimeURL   string                         `json:"pairedRuntimeUrl"`
	PairingStatus      string                         `json:"pairingStatus"`
	DeviceAuth         string                         `json:"deviceAuth"`
	LastPairedAt       string                         `json:"lastPairedAt"`
	BrowserPush        string                         `json:"browserPush"`
	MemoryMode         string                         `json:"memoryMode"`
	RepoBinding        WorkspaceRepoBindingSnapshot   `json:"repoBinding"`
	GitHubInstallation WorkspaceGitHubInstallSnapshot `json:"githubInstallation"`
	Onboarding         WorkspaceOnboardingSnapshot    `json:"onboarding"`
	Governance         WorkspaceGovernanceSnapshot    `json:"governance"`
}

type WorkspaceQuotaSnapshot struct {
	UsedMachines       int    `json:"usedMachines"`
	MaxMachines        int    `json:"maxMachines"`
	UsedAgents         int    `json:"usedAgents"`
	MaxAgents          int    `json:"maxAgents"`
	UsedChannels       int    `json:"usedChannels"`
	MaxChannels        int    `json:"maxChannels"`
	UsedRooms          int    `json:"usedRooms"`
	MaxRooms           int    `json:"maxRooms"`
	MessageHistoryDays int    `json:"messageHistoryDays"`
	RunLogDays         int    `json:"runLogDays"`
	MemoryDraftDays    int    `json:"memoryDraftDays"`
	Status             string `json:"status"`
	Warning            string `json:"warning,omitempty"`
}

type WorkspaceUsageSnapshot struct {
	WindowLabel  string `json:"windowLabel"`
	TotalTokens  int    `json:"totalTokens"`
	RunCount     int    `json:"runCount"`
	MessageCount int    `json:"messageCount"`
	RefreshedAt  string `json:"refreshedAt"`
	Warning      string `json:"warning,omitempty"`
}

type WorkspaceRepoBindingSnapshot struct {
	Repo          string `json:"repo"`
	RepoURL       string `json:"repoUrl"`
	Branch        string `json:"branch"`
	Provider      string `json:"provider"`
	BindingStatus string `json:"bindingStatus"`
	AuthMode      string `json:"authMode"`
	DetectedAt    string `json:"detectedAt,omitempty"`
	SyncedAt      string `json:"syncedAt,omitempty"`
}

type WorkspaceGitHubInstallSnapshot struct {
	Provider          string   `json:"provider"`
	PreferredAuthMode string   `json:"preferredAuthMode,omitempty"`
	ConnectionReady   bool     `json:"connectionReady"`
	AppConfigured     bool     `json:"appConfigured"`
	AppInstalled      bool     `json:"appInstalled"`
	InstallationID    string   `json:"installationId,omitempty"`
	InstallationURL   string   `json:"installationUrl,omitempty"`
	Missing           []string `json:"missing,omitempty"`
	ConnectionMessage string   `json:"connectionMessage,omitempty"`
	SyncedAt          string   `json:"syncedAt,omitempty"`
}

type WorkspaceOnboardingSnapshot struct {
	Status          string                             `json:"status"`
	TemplateID      string                             `json:"templateId,omitempty"`
	CurrentStep     string                             `json:"currentStep,omitempty"`
	CompletedSteps  []string                           `json:"completedSteps,omitempty"`
	ResumeURL       string                             `json:"resumeUrl,omitempty"`
	Materialization WorkspaceOnboardingMaterialization `json:"materialization"`
	UpdatedAt       string                             `json:"updatedAt,omitempty"`
}

type WorkspaceOnboardingMaterialization struct {
	Label              string   `json:"label,omitempty"`
	Channels           []string `json:"channels,omitempty"`
	Roles              []string `json:"roles,omitempty"`
	Agents             []string `json:"agents,omitempty"`
	NotificationPolicy string   `json:"notificationPolicy,omitempty"`
	Notes              []string `json:"notes,omitempty"`
}

type WorkspaceGovernanceSnapshot struct {
	TemplateID          string                           `json:"templateId,omitempty"`
	Label               string                           `json:"label,omitempty"`
	Summary             string                           `json:"summary,omitempty"`
	TeamTopology        []WorkspaceGovernanceLane        `json:"teamTopology,omitempty"`
	HandoffRules        []WorkspaceGovernanceRule        `json:"handoffRules,omitempty"`
	ResponseAggregation WorkspaceResponseAggregation     `json:"responseAggregation"`
	HumanOverride       WorkspaceHumanOverride           `json:"humanOverride"`
	Walkthrough         []WorkspaceGovernanceWalkthrough `json:"walkthrough,omitempty"`
	Stats               WorkspaceGovernanceStats         `json:"stats"`
}

type WorkspaceGovernanceLane struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Role         string `json:"role"`
	DefaultAgent string `json:"defaultAgent,omitempty"`
	Lane         string `json:"lane,omitempty"`
	Status       string `json:"status"`
	Summary      string `json:"summary"`
}

type WorkspaceGovernanceRule struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
	Href    string `json:"href,omitempty"`
}

type WorkspaceResponseAggregation struct {
	Status        string   `json:"status"`
	Summary       string   `json:"summary"`
	Sources       []string `json:"sources,omitempty"`
	FinalResponse string   `json:"finalResponse,omitempty"`
}

type WorkspaceHumanOverride struct {
	Status  string `json:"status"`
	Summary string `json:"summary"`
	Href    string `json:"href,omitempty"`
}

type WorkspaceGovernanceWalkthrough struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
	Detail  string `json:"detail,omitempty"`
	Href    string `json:"href,omitempty"`
}

type WorkspaceGovernanceStats struct {
	OpenHandoffs       int `json:"openHandoffs"`
	BlockedEscalations int `json:"blockedEscalations"`
	ReviewGates        int `json:"reviewGates"`
	HumanOverrideGates int `json:"humanOverrideGates"`
}

type Channel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Unread  int    `json:"unread"`
	Purpose string `json:"purpose"`
}

type DirectMessage struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Summary     string   `json:"summary"`
	Purpose     string   `json:"purpose"`
	Unread      int      `json:"unread"`
	Presence    string   `json:"presence"`
	Counterpart string   `json:"counterpart"`
	MessageIDs  []string `json:"messageIds"`
}

type Message struct {
	ID      string `json:"id"`
	Speaker string `json:"speaker"`
	Role    string `json:"role"`
	Tone    string `json:"tone"`
	Message string `json:"message"`
	Time    string `json:"time"`
}

type MessageSurfaceEntry struct {
	ID           string `json:"id"`
	ChannelID    string `json:"channelId"`
	MessageID    string `json:"messageId"`
	ChannelLabel string `json:"channelLabel"`
	Title        string `json:"title"`
	Summary      string `json:"summary"`
	Note         string `json:"note"`
	UpdatedAt    string `json:"updatedAt"`
	Unread       int    `json:"unread"`
}

type SearchResult struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Meta     string `json:"meta"`
	Href     string `json:"href"`
	Keywords string `json:"keywords"`
	Order    int    `json:"order"`
}

type Topic struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Status  string `json:"status"`
	Owner   string `json:"owner"`
	Summary string `json:"summary"`
}

type Issue struct {
	ID          string   `json:"id"`
	Key         string   `json:"key"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	State       string   `json:"state"`
	Priority    string   `json:"priority"`
	Owner       string   `json:"owner"`
	RoomID      string   `json:"roomId"`
	RunID       string   `json:"runId"`
	PullRequest string   `json:"pullRequest"`
	Checklist   []string `json:"checklist"`
}

type Room struct {
	ID         string            `json:"id"`
	IssueKey   string            `json:"issueKey"`
	Title      string            `json:"title"`
	Unread     int               `json:"unread"`
	Summary    string            `json:"summary"`
	BoardCount int               `json:"boardCount"`
	RunID      string            `json:"runId"`
	MessageIDs []string          `json:"messageIds"`
	Topic      Topic             `json:"topic"`
	Usage      RoomUsageSnapshot `json:"usage"`
}

type RoomUsageSnapshot struct {
	WindowLabel  string `json:"windowLabel"`
	MessageCount int    `json:"messageCount"`
	HumanTurns   int    `json:"humanTurns"`
	AgentTurns   int    `json:"agentTurns"`
	TotalTokens  int    `json:"totalTokens"`
	RefreshedAt  string `json:"refreshedAt"`
	Warning      string `json:"warning,omitempty"`
}

type RunEvent struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	At    string `json:"at"`
	Tone  string `json:"tone"`
}

type GuardBoundary struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type DestructiveGuard struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	Summary          string          `json:"summary"`
	Status           string          `json:"status"`
	Risk             string          `json:"risk"`
	Scope            string          `json:"scope"`
	RoomID           string          `json:"roomId,omitempty"`
	RunID            string          `json:"runId,omitempty"`
	InboxItemID      string          `json:"inboxItemId,omitempty"`
	ApprovalRequired bool            `json:"approvalRequired"`
	Boundaries       []GuardBoundary `json:"boundaries"`
}

type ToolCall struct {
	ID      string `json:"id"`
	Tool    string `json:"tool"`
	Summary string `json:"summary"`
	Result  string `json:"result"`
}

type Run struct {
	ID               string           `json:"id"`
	IssueKey         string           `json:"issueKey"`
	RoomID           string           `json:"roomId"`
	TopicID          string           `json:"topicId"`
	Status           string           `json:"status"`
	FollowThread     bool             `json:"followThread"`
	ControlNote      string           `json:"controlNote,omitempty"`
	Runtime          string           `json:"runtime"`
	Machine          string           `json:"machine"`
	Provider         string           `json:"provider"`
	Branch           string           `json:"branch"`
	Worktree         string           `json:"worktree"`
	WorktreePath     string           `json:"worktreePath"`
	Owner            string           `json:"owner"`
	StartedAt        string           `json:"startedAt"`
	Duration         string           `json:"duration"`
	Summary          string           `json:"summary"`
	ApprovalRequired bool             `json:"approvalRequired"`
	Stdout           []string         `json:"stdout"`
	Stderr           []string         `json:"stderr"`
	ToolCalls        []ToolCall       `json:"toolCalls"`
	Timeline         []RunEvent       `json:"timeline"`
	Usage            RunUsageSnapshot `json:"usage"`
	NextAction       string           `json:"nextAction"`
	PullRequest      string           `json:"pullRequest"`
}

type RunUsageSnapshot struct {
	PromptTokens     int    `json:"promptTokens"`
	CompletionTokens int    `json:"completionTokens"`
	TotalTokens      int    `json:"totalTokens"`
	ToolCallCount    int    `json:"toolCallCount"`
	ContextWindow    int    `json:"contextWindow"`
	BudgetStatus     string `json:"budgetStatus"`
	RefreshedAt      string `json:"refreshedAt"`
	Warning          string `json:"warning,omitempty"`
}

type Agent struct {
	ID                    string                   `json:"id"`
	Name                  string                   `json:"name"`
	Description           string                   `json:"description"`
	Mood                  string                   `json:"mood"`
	State                 string                   `json:"state"`
	Lane                  string                   `json:"lane"`
	Role                  string                   `json:"role"`
	Avatar                string                   `json:"avatar"`
	Prompt                string                   `json:"prompt"`
	OperatingInstructions string                   `json:"operatingInstructions"`
	Provider              string                   `json:"provider"`
	ProviderPreference    string                   `json:"providerPreference"`
	ModelPreference       string                   `json:"modelPreference,omitempty"`
	RecallPolicy          string                   `json:"recallPolicy"`
	RuntimePreference     string                   `json:"runtimePreference"`
	MemorySpaces          []string                 `json:"memorySpaces"`
	RecentRunIDs          []string                 `json:"recentRunIds"`
	ProfileAudit          []AgentProfileAuditEntry `json:"profileAudit"`
}

type AgentProfileAuditEntry struct {
	ID        string                    `json:"id"`
	UpdatedAt string                    `json:"updatedAt"`
	UpdatedBy string                    `json:"updatedBy"`
	Summary   string                    `json:"summary"`
	Changes   []AgentProfileAuditChange `json:"changes"`
}

type AgentProfileAuditChange struct {
	Field    string `json:"field"`
	Previous string `json:"previous"`
	Current  string `json:"current"`
}

type Machine struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	State         string `json:"state"`
	DaemonURL     string `json:"daemonUrl"`
	CLI           string `json:"cli"`
	Shell         string `json:"shell,omitempty"`
	OS            string `json:"os"`
	LastHeartbeat string `json:"lastHeartbeat"`
}

type RuntimeProvider struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	Mode         string   `json:"mode"`
	Capabilities []string `json:"capabilities"`
	// Models is a runtime-surfaced suggestion catalog for the UI. It is not a hard allowlist
	// unless the daemon starts deriving it from a real local source.
	Models    []string `json:"models,omitempty"`
	Transport string   `json:"transport"`
}

type RuntimeRecord struct {
	ID                 string            `json:"id"`
	Machine            string            `json:"machine"`
	DaemonURL          string            `json:"daemonUrl"`
	DetectedCLI        []string          `json:"detectedCli"`
	Providers          []RuntimeProvider `json:"providers"`
	Shell              string            `json:"shell,omitempty"`
	State              string            `json:"state"`
	PairingState       string            `json:"pairingState"`
	WorkspaceRoot      string            `json:"workspaceRoot"`
	ReportedAt         string            `json:"reportedAt"`
	LastHeartbeatAt    string            `json:"lastHeartbeatAt"`
	HeartbeatIntervalS int               `json:"heartbeatIntervalSeconds,omitempty"`
	HeartbeatTimeoutS  int               `json:"heartbeatTimeoutSeconds,omitempty"`
}

type RuntimeLease struct {
	LeaseID      string `json:"leaseId"`
	SessionID    string `json:"sessionId,omitempty"`
	RunID        string `json:"runId,omitempty"`
	RoomID       string `json:"roomId,omitempty"`
	Runtime      string `json:"runtime"`
	Machine      string `json:"machine"`
	Owner        string `json:"owner,omitempty"`
	Provider     string `json:"provider,omitempty"`
	Status       string `json:"status,omitempty"`
	Branch       string `json:"branch,omitempty"`
	WorktreeName string `json:"worktreeName,omitempty"`
	WorktreePath string `json:"worktreePath,omitempty"`
	Cwd          string `json:"cwd,omitempty"`
	Summary      string `json:"summary,omitempty"`
}

type RuntimeSchedulerCandidate struct {
	Runtime          string `json:"runtime"`
	Machine          string `json:"machine"`
	State            string `json:"state"`
	PairingState     string `json:"pairingState"`
	Schedulable      bool   `json:"schedulable"`
	Selected         bool   `json:"selected"`
	Preferred        bool   `json:"preferred"`
	Assigned         bool   `json:"assigned"`
	ActiveLeaseCount int    `json:"activeLeaseCount"`
	Reason           string `json:"reason,omitempty"`
}

type RuntimeScheduler struct {
	SelectedRuntime  string                      `json:"selectedRuntime"`
	PreferredRuntime string                      `json:"preferredRuntime"`
	AssignedRuntime  string                      `json:"assignedRuntime"`
	AssignedMachine  string                      `json:"assignedMachine"`
	Strategy         string                      `json:"strategy"`
	FailoverFrom     string                      `json:"failoverFrom,omitempty"`
	Summary          string                      `json:"summary"`
	Candidates       []RuntimeSchedulerCandidate `json:"candidates"`
}

type InboxItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Kind      string `json:"kind"`
	Room      string `json:"room"`
	Time      string `json:"time"`
	Summary   string `json:"summary"`
	Action    string `json:"action"`
	Href      string `json:"href"`
	GuardID   string `json:"guardId,omitempty"`
	HandoffID string `json:"handoffId,omitempty"`
}

type MailboxMessage struct {
	ID         string `json:"id"`
	HandoffID  string `json:"handoffId"`
	Kind       string `json:"kind"`
	AuthorID   string `json:"authorId"`
	AuthorName string `json:"authorName"`
	Body       string `json:"body"`
	CreatedAt  string `json:"createdAt"`
}

type AgentHandoff struct {
	ID          string           `json:"id"`
	Title       string           `json:"title"`
	Summary     string           `json:"summary"`
	Status      string           `json:"status"`
	IssueKey    string           `json:"issueKey"`
	RoomID      string           `json:"roomId"`
	RunID       string           `json:"runId"`
	FromAgentID string           `json:"fromAgentId"`
	FromAgent   string           `json:"fromAgent"`
	ToAgentID   string           `json:"toAgentId"`
	ToAgent     string           `json:"toAgent"`
	InboxItemID string           `json:"inboxItemId,omitempty"`
	RequestedAt string           `json:"requestedAt"`
	UpdatedAt   string           `json:"updatedAt"`
	LastAction  string           `json:"lastAction"`
	LastNote    string           `json:"lastNote,omitempty"`
	Messages    []MailboxMessage `json:"messages"`
}

type PullRequest struct {
	ID             string                         `json:"id"`
	Number         int                            `json:"number"`
	Label          string                         `json:"label"`
	Title          string                         `json:"title"`
	Status         string                         `json:"status"`
	IssueKey       string                         `json:"issueKey"`
	RoomID         string                         `json:"roomId"`
	RunID          string                         `json:"runId"`
	Branch         string                         `json:"branch"`
	BaseBranch     string                         `json:"baseBranch"`
	Author         string                         `json:"author"`
	Provider       string                         `json:"provider"`
	URL            string                         `json:"url"`
	ReviewDecision string                         `json:"reviewDecision"`
	ReviewSummary  string                         `json:"reviewSummary"`
	Conversation   []PullRequestConversationEntry `json:"conversation,omitempty"`
	UpdatedAt      string                         `json:"updatedAt"`
}

type PullRequestConversationEntry struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Action         string `json:"action"`
	Author         string `json:"author"`
	Summary        string `json:"summary"`
	Body           string `json:"body,omitempty"`
	ReviewDecision string `json:"reviewDecision,omitempty"`
	ReviewState    string `json:"reviewState,omitempty"`
	ThreadStatus   string `json:"threadStatus,omitempty"`
	Path           string `json:"path,omitempty"`
	Line           int    `json:"line,omitempty"`
	URL            string `json:"url,omitempty"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}

type PullRequestRemoteSnapshot struct {
	Number         int
	Title          string
	Status         string
	Branch         string
	BaseBranch     string
	Author         string
	Provider       string
	URL            string
	ReviewDecision string
	ReviewSummary  string
	UpdatedAt      string
}

type Session struct {
	ID           string   `json:"id"`
	IssueKey     string   `json:"issueKey"`
	RoomID       string   `json:"roomId"`
	TopicID      string   `json:"topicId"`
	ActiveRunID  string   `json:"activeRunId"`
	Status       string   `json:"status"`
	FollowThread bool     `json:"followThread"`
	ControlNote  string   `json:"controlNote,omitempty"`
	Runtime      string   `json:"runtime"`
	Machine      string   `json:"machine"`
	Provider     string   `json:"provider"`
	Branch       string   `json:"branch"`
	Worktree     string   `json:"worktree"`
	WorktreePath string   `json:"worktreePath"`
	Summary      string   `json:"summary"`
	UpdatedAt    string   `json:"updatedAt"`
	MemoryPaths  []string `json:"memoryPaths"`
}

type AuthSession struct {
	ID                       string                     `json:"id"`
	MemberID                 string                     `json:"memberId,omitempty"`
	Email                    string                     `json:"email,omitempty"`
	Name                     string                     `json:"name,omitempty"`
	Role                     string                     `json:"role,omitempty"`
	Status                   string                     `json:"status"`
	AuthMethod               string                     `json:"authMethod,omitempty"`
	SignedInAt               string                     `json:"signedInAt,omitempty"`
	LastSeenAt               string                     `json:"lastSeenAt,omitempty"`
	DeviceID                 string                     `json:"deviceId,omitempty"`
	DeviceLabel              string                     `json:"deviceLabel,omitempty"`
	DeviceAuthStatus         string                     `json:"deviceAuthStatus,omitempty"`
	EmailVerificationStatus  string                     `json:"emailVerificationStatus,omitempty"`
	EmailVerifiedAt          string                     `json:"emailVerifiedAt,omitempty"`
	PasswordResetStatus      string                     `json:"passwordResetStatus,omitempty"`
	PasswordResetRequestedAt string                     `json:"passwordResetRequestedAt,omitempty"`
	PasswordResetCompletedAt string                     `json:"passwordResetCompletedAt,omitempty"`
	RecoveryStatus           string                     `json:"recoveryStatus,omitempty"`
	GitHubIdentity           AuthExternalIdentity       `json:"githubIdentity,omitempty"`
	Preferences              WorkspaceMemberPreferences `json:"preferences"`
	LinkedIdentities         []AuthExternalIdentity     `json:"linkedIdentities,omitempty"`
	Permissions              []string                   `json:"permissions"`
}

type WorkspaceRole struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Summary     string   `json:"summary"`
	Permissions []string `json:"permissions"`
}

type WorkspaceMember struct {
	ID                       string                     `json:"id"`
	Email                    string                     `json:"email"`
	Name                     string                     `json:"name"`
	Role                     string                     `json:"role"`
	Status                   string                     `json:"status"`
	Source                   string                     `json:"source,omitempty"`
	AddedAt                  string                     `json:"addedAt,omitempty"`
	LastSeenAt               string                     `json:"lastSeenAt,omitempty"`
	RecoveryEmail            string                     `json:"recoveryEmail,omitempty"`
	EmailVerificationStatus  string                     `json:"emailVerificationStatus,omitempty"`
	EmailVerifiedAt          string                     `json:"emailVerifiedAt,omitempty"`
	PasswordResetStatus      string                     `json:"passwordResetStatus,omitempty"`
	PasswordResetRequestedAt string                     `json:"passwordResetRequestedAt,omitempty"`
	PasswordResetCompletedAt string                     `json:"passwordResetCompletedAt,omitempty"`
	RecoveryStatus           string                     `json:"recoveryStatus,omitempty"`
	GitHubIdentity           AuthExternalIdentity       `json:"githubIdentity,omitempty"`
	Preferences              WorkspaceMemberPreferences `json:"preferences"`
	LinkedIdentities         []AuthExternalIdentity     `json:"linkedIdentities,omitempty"`
	TrustedDeviceIDs         []string                   `json:"trustedDeviceIds,omitempty"`
	Permissions              []string                   `json:"permissions"`
}

type WorkspaceMemberPreferences struct {
	PreferredAgentID string `json:"preferredAgentId,omitempty"`
	StartRoute       string `json:"startRoute,omitempty"`
	UpdatedAt        string `json:"updatedAt,omitempty"`
}

type AuthExternalIdentity struct {
	Provider string `json:"provider"`
	Handle   string `json:"handle"`
	Status   string `json:"status"`
	BoundAt  string `json:"boundAt,omitempty"`
}

type AuthDevice struct {
	ID           string `json:"id"`
	MemberID     string `json:"memberId"`
	Label        string `json:"label"`
	Status       string `json:"status"`
	RequestedAt  string `json:"requestedAt,omitempty"`
	AuthorizedAt string `json:"authorizedAt,omitempty"`
	LastSeenAt   string `json:"lastSeenAt,omitempty"`
}

type AuthSnapshot struct {
	Session AuthSession       `json:"session"`
	Roles   []WorkspaceRole   `json:"roles"`
	Members []WorkspaceMember `json:"members"`
	Devices []AuthDevice      `json:"devices,omitempty"`
}

type MemoryGovernance struct {
	Mode           string `json:"mode"`
	RequiresReview bool   `json:"requiresReview"`
	Escalation     string `json:"escalation"`
}

type MemoryArtifactVersion struct {
	Version   int    `json:"version"`
	Summary   string `json:"summary"`
	UpdatedAt string `json:"updatedAt"`
	Source    string `json:"source"`
	Actor     string `json:"actor"`
	Digest    string `json:"digest,omitempty"`
	SizeBytes int    `json:"sizeBytes,omitempty"`
	Content   string `json:"content,omitempty"`
}

type MemoryArtifact struct {
	ID                 string           `json:"id"`
	Scope              string           `json:"scope"`
	Kind               string           `json:"kind"`
	Path               string           `json:"path"`
	Summary            string           `json:"summary"`
	UpdatedAt          string           `json:"updatedAt"`
	Version            int              `json:"version"`
	LatestWrite        string           `json:"latestWrite,omitempty"`
	LatestSource       string           `json:"latestSource,omitempty"`
	LatestActor        string           `json:"latestActor,omitempty"`
	Digest             string           `json:"digest,omitempty"`
	SizeBytes          int              `json:"sizeBytes,omitempty"`
	CorrectionCount    int              `json:"correctionCount,omitempty"`
	LastCorrectionAt   string           `json:"lastCorrectionAt,omitempty"`
	LastCorrectionBy   string           `json:"lastCorrectionBy,omitempty"`
	LastCorrectionNote string           `json:"lastCorrectionNote,omitempty"`
	Forgotten          bool             `json:"forgotten,omitempty"`
	ForgottenAt        string           `json:"forgottenAt,omitempty"`
	ForgottenBy        string           `json:"forgottenBy,omitempty"`
	ForgetReason       string           `json:"forgetReason,omitempty"`
	Governance         MemoryGovernance `json:"governance"`
}

type MemoryArtifactDetail struct {
	Artifact MemoryArtifact          `json:"artifact"`
	Content  string                  `json:"content,omitempty"`
	Versions []MemoryArtifactVersion `json:"versions"`
}

type State struct {
	Workspace             WorkspaceSnapshot                  `json:"workspace"`
	Channels              []Channel                          `json:"channels"`
	ChannelMessages       map[string][]Message               `json:"channelMessages"`
	DirectMessages        []DirectMessage                    `json:"directMessages,omitempty"`
	DirectMessageMessages map[string][]Message               `json:"directMessageMessages,omitempty"`
	FollowedThreads       []MessageSurfaceEntry              `json:"followedThreads,omitempty"`
	SavedLaterItems       []MessageSurfaceEntry              `json:"savedLaterItems,omitempty"`
	QuickSearchEntries    []SearchResult                     `json:"quickSearchEntries,omitempty"`
	Issues                []Issue                            `json:"issues"`
	Rooms                 []Room                             `json:"rooms"`
	RoomMessages          map[string][]Message               `json:"roomMessages"`
	Runs                  []Run                              `json:"runs"`
	Agents                []Agent                            `json:"agents"`
	Machines              []Machine                          `json:"machines"`
	Runtimes              []RuntimeRecord                    `json:"runtimes"`
	Inbox                 []InboxItem                        `json:"inbox"`
	Mailbox               []AgentHandoff                     `json:"mailbox"`
	PullRequests          []PullRequest                      `json:"pullRequests"`
	Sessions              []Session                          `json:"sessions"`
	RuntimeLeases         []RuntimeLease                     `json:"runtimeLeases,omitempty"`
	RuntimeScheduler      RuntimeScheduler                   `json:"runtimeScheduler"`
	Guards                []DestructiveGuard                 `json:"guards,omitempty"`
	Auth                  AuthSnapshot                       `json:"auth"`
	Memory                []MemoryArtifact                   `json:"memory"`
	MemoryVersions        map[string][]MemoryArtifactVersion `json:"memoryVersions,omitempty"`
}

type RoomDetail struct {
	Room     Room      `json:"room"`
	Messages []Message `json:"messages"`
}

type RunHistoryEntry struct {
	Run       Run     `json:"run"`
	Room      Room    `json:"room"`
	Issue     Issue   `json:"issue"`
	Session   Session `json:"session"`
	IsCurrent bool    `json:"isCurrent"`
}

type RunHistoryPage struct {
	Items      []RunHistoryEntry `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
	TotalCount int               `json:"totalCount"`
}

type RunDetail struct {
	Run     Run               `json:"run"`
	Room    Room              `json:"room"`
	Issue   Issue             `json:"issue"`
	Session Session           `json:"session"`
	History []RunHistoryEntry `json:"history"`
}

type PullRequestDetail struct {
	PullRequest  PullRequest                    `json:"pullRequest"`
	Room         Room                           `json:"room"`
	Run          Run                            `json:"run"`
	Issue        Issue                          `json:"issue"`
	Conversation []PullRequestConversationEntry `json:"conversation"`
	RelatedInbox []InboxItem                    `json:"relatedInbox"`
	Delivery     PullRequestDeliveryEntry       `json:"delivery"`
}

type PullRequestDeliveryEntry struct {
	Status       string                         `json:"status"`
	ReleaseReady bool                           `json:"releaseReady"`
	Summary      string                         `json:"summary"`
	Gates        []PullRequestDeliveryGate      `json:"gates"`
	Templates    []PullRequestDeliveryTemplate  `json:"templates"`
	HandoffNote  PullRequestDeliveryHandoffNote `json:"handoffNote"`
	Evidence     []PullRequestDeliveryEvidence  `json:"evidence"`
}

type PullRequestDeliveryGate struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
	Href    string `json:"href,omitempty"`
}

type PullRequestDeliveryTemplate struct {
	TemplateID        string `json:"templateId,omitempty"`
	Label             string `json:"label"`
	Status            string `json:"status"`
	ReadyDeliveries   int    `json:"readyDeliveries"`
	BlockedDeliveries int    `json:"blockedDeliveries"`
	SentReceipts      int    `json:"sentReceipts"`
	FailedReceipts    int    `json:"failedReceipts"`
	Href              string `json:"href,omitempty"`
}

type PullRequestDeliveryHandoffNote struct {
	Title   string   `json:"title"`
	Summary string   `json:"summary"`
	Lines   []string `json:"lines"`
}

type PullRequestDeliveryEvidence struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Value   string `json:"value"`
	Summary string `json:"summary"`
	Href    string `json:"href,omitempty"`
}

type CreateIssueInput struct {
	Title    string
	Summary  string
	Owner    string
	Priority string
}

type IssueCreationResult struct {
	State        State  `json:"state"`
	RoomID       string `json:"roomId"`
	RunID        string `json:"runId"`
	SessionID    string `json:"sessionId"`
	Branch       string `json:"branch"`
	WorktreeName string `json:"worktreeName"`
}

type LaneBinding struct {
	Branch       string
	WorktreeName string
	Path         string
}

type RuntimePairingInput struct {
	RuntimeID     string
	DaemonURL     string
	Machine       string
	DetectedCLI   []string
	Providers     []RuntimeProvider
	Shell         string
	State         string
	WorkspaceRoot string
	ReportedAt    string
}

type RuntimeHeartbeatInput struct {
	RuntimeID          string
	DaemonURL          string
	Machine            string
	DetectedCLI        []string
	Providers          []RuntimeProvider
	Shell              string
	State              string
	WorkspaceRoot      string
	ReportedAt         string
	HeartbeatIntervalS int
	HeartbeatTimeoutS  int
}

type RepoBindingInput struct {
	Repo       string
	RepoURL    string
	Branch     string
	Provider   string
	AuthMode   string
	DetectedAt string
	SyncedAt   string

	PreferredAuthMode string
	ConnectionReady   bool
	AppConfigured     bool
	AppInstalled      bool
	InstallationID    string
	InstallationURL   string
	Missing           []string
	ConnectionMessage string
}

type Store struct {
	mu            sync.RWMutex
	path          string
	workspaceRoot string
	state         State
	subscribers   map[int]chan State
	nextSubID     int
}
