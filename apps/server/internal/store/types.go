package store

import "sync"

type WorkspaceSnapshot struct {
	Name              string `json:"name"`
	Repo              string `json:"repo"`
	RepoURL           string `json:"repoUrl"`
	Branch            string `json:"branch"`
	RepoProvider      string `json:"repoProvider"`
	RepoBindingStatus string `json:"repoBindingStatus"`
	RepoAuthMode      string `json:"repoAuthMode"`
	Plan              string `json:"plan"`
	PairedRuntime     string `json:"pairedRuntime"`
	PairedRuntimeURL  string `json:"pairedRuntimeUrl"`
	PairingStatus     string `json:"pairingStatus"`
	DeviceAuth        string `json:"deviceAuth"`
	LastPairedAt      string `json:"lastPairedAt"`
	BrowserPush       string `json:"browserPush"`
	MemoryMode        string `json:"memoryMode"`
}

type Channel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Unread  int    `json:"unread"`
	Purpose string `json:"purpose"`
}

type Message struct {
	ID      string `json:"id"`
	Speaker string `json:"speaker"`
	Role    string `json:"role"`
	Tone    string `json:"tone"`
	Message string `json:"message"`
	Time    string `json:"time"`
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
	ID         string   `json:"id"`
	IssueKey   string   `json:"issueKey"`
	Title      string   `json:"title"`
	Unread     int      `json:"unread"`
	Summary    string   `json:"summary"`
	BoardCount int      `json:"boardCount"`
	RunID      string   `json:"runId"`
	MessageIDs []string `json:"messageIds"`
	Topic      Topic    `json:"topic"`
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
	ID               string     `json:"id"`
	IssueKey         string     `json:"issueKey"`
	RoomID           string     `json:"roomId"`
	TopicID          string     `json:"topicId"`
	Status           string     `json:"status"`
	FollowThread     bool       `json:"followThread"`
	ControlNote      string     `json:"controlNote,omitempty"`
	Runtime          string     `json:"runtime"`
	Machine          string     `json:"machine"`
	Provider         string     `json:"provider"`
	Branch           string     `json:"branch"`
	Worktree         string     `json:"worktree"`
	WorktreePath     string     `json:"worktreePath"`
	Owner            string     `json:"owner"`
	StartedAt        string     `json:"startedAt"`
	Duration         string     `json:"duration"`
	Summary          string     `json:"summary"`
	ApprovalRequired bool       `json:"approvalRequired"`
	Stdout           []string   `json:"stdout"`
	Stderr           []string   `json:"stderr"`
	ToolCalls        []ToolCall `json:"toolCalls"`
	Timeline         []RunEvent `json:"timeline"`
	NextAction       string     `json:"nextAction"`
	PullRequest      string     `json:"pullRequest"`
}

type Agent struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Mood              string   `json:"mood"`
	State             string   `json:"state"`
	Lane              string   `json:"lane"`
	Provider          string   `json:"provider"`
	RuntimePreference string   `json:"runtimePreference"`
	MemorySpaces      []string `json:"memorySpaces"`
	RecentRunIDs      []string `json:"recentRunIds"`
}

type Machine struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	State         string `json:"state"`
	DaemonURL     string `json:"daemonUrl"`
	CLI           string `json:"cli"`
	OS            string `json:"os"`
	LastHeartbeat string `json:"lastHeartbeat"`
}

type RuntimeProvider struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	Mode         string   `json:"mode"`
	Capabilities []string `json:"capabilities"`
	Transport    string   `json:"transport"`
}

type RuntimeRecord struct {
	ID                 string            `json:"id"`
	Machine            string            `json:"machine"`
	DaemonURL          string            `json:"daemonUrl"`
	DetectedCLI        []string          `json:"detectedCli"`
	Providers          []RuntimeProvider `json:"providers"`
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
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Room    string `json:"room"`
	Time    string `json:"time"`
	Summary string `json:"summary"`
	Action  string `json:"action"`
	Href    string `json:"href"`
	GuardID string `json:"guardId,omitempty"`
}

type PullRequest struct {
	ID             string `json:"id"`
	Number         int    `json:"number"`
	Label          string `json:"label"`
	Title          string `json:"title"`
	Status         string `json:"status"`
	IssueKey       string `json:"issueKey"`
	RoomID         string `json:"roomId"`
	RunID          string `json:"runId"`
	Branch         string `json:"branch"`
	BaseBranch     string `json:"baseBranch"`
	Author         string `json:"author"`
	Provider       string `json:"provider"`
	URL            string `json:"url"`
	ReviewDecision string `json:"reviewDecision"`
	ReviewSummary  string `json:"reviewSummary"`
	UpdatedAt      string `json:"updatedAt"`
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
	ID                       string                 `json:"id"`
	MemberID                 string                 `json:"memberId,omitempty"`
	Email                    string                 `json:"email,omitempty"`
	Name                     string                 `json:"name,omitempty"`
	Role                     string                 `json:"role,omitempty"`
	Status                   string                 `json:"status"`
	AuthMethod               string                 `json:"authMethod,omitempty"`
	SignedInAt               string                 `json:"signedInAt,omitempty"`
	LastSeenAt               string                 `json:"lastSeenAt,omitempty"`
	DeviceID                 string                 `json:"deviceId,omitempty"`
	DeviceLabel              string                 `json:"deviceLabel,omitempty"`
	DeviceAuthStatus         string                 `json:"deviceAuthStatus,omitempty"`
	EmailVerificationStatus  string                 `json:"emailVerificationStatus,omitempty"`
	EmailVerifiedAt          string                 `json:"emailVerifiedAt,omitempty"`
	PasswordResetStatus      string                 `json:"passwordResetStatus,omitempty"`
	PasswordResetRequestedAt string                 `json:"passwordResetRequestedAt,omitempty"`
	PasswordResetCompletedAt string                 `json:"passwordResetCompletedAt,omitempty"`
	RecoveryStatus           string                 `json:"recoveryStatus,omitempty"`
	LinkedIdentities         []AuthExternalIdentity `json:"linkedIdentities,omitempty"`
	Permissions              []string               `json:"permissions"`
}

type WorkspaceRole struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Summary     string   `json:"summary"`
	Permissions []string `json:"permissions"`
}

type WorkspaceMember struct {
	ID                       string                 `json:"id"`
	Email                    string                 `json:"email"`
	Name                     string                 `json:"name"`
	Role                     string                 `json:"role"`
	Status                   string                 `json:"status"`
	Source                   string                 `json:"source,omitempty"`
	AddedAt                  string                 `json:"addedAt,omitempty"`
	LastSeenAt               string                 `json:"lastSeenAt,omitempty"`
	RecoveryEmail            string                 `json:"recoveryEmail,omitempty"`
	EmailVerificationStatus  string                 `json:"emailVerificationStatus,omitempty"`
	EmailVerifiedAt          string                 `json:"emailVerifiedAt,omitempty"`
	PasswordResetStatus      string                 `json:"passwordResetStatus,omitempty"`
	PasswordResetRequestedAt string                 `json:"passwordResetRequestedAt,omitempty"`
	PasswordResetCompletedAt string                 `json:"passwordResetCompletedAt,omitempty"`
	RecoveryStatus           string                 `json:"recoveryStatus,omitempty"`
	LinkedIdentities         []AuthExternalIdentity `json:"linkedIdentities,omitempty"`
	TrustedDeviceIDs         []string               `json:"trustedDeviceIds,omitempty"`
	Permissions              []string               `json:"permissions"`
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
	ID           string           `json:"id"`
	Scope        string           `json:"scope"`
	Kind         string           `json:"kind"`
	Path         string           `json:"path"`
	Summary      string           `json:"summary"`
	UpdatedAt    string           `json:"updatedAt"`
	Version      int              `json:"version"`
	LatestWrite  string           `json:"latestWrite,omitempty"`
	LatestSource string           `json:"latestSource,omitempty"`
	LatestActor  string           `json:"latestActor,omitempty"`
	Digest       string           `json:"digest,omitempty"`
	SizeBytes    int              `json:"sizeBytes,omitempty"`
	Governance   MemoryGovernance `json:"governance"`
}

type MemoryArtifactDetail struct {
	Artifact MemoryArtifact          `json:"artifact"`
	Content  string                  `json:"content,omitempty"`
	Versions []MemoryArtifactVersion `json:"versions"`
}

type State struct {
	Workspace        WorkspaceSnapshot                  `json:"workspace"`
	Channels         []Channel                          `json:"channels"`
	ChannelMessages  map[string][]Message               `json:"channelMessages"`
	Issues           []Issue                            `json:"issues"`
	Rooms            []Room                             `json:"rooms"`
	RoomMessages     map[string][]Message               `json:"roomMessages"`
	Runs             []Run                              `json:"runs"`
	Agents           []Agent                            `json:"agents"`
	Machines         []Machine                          `json:"machines"`
	Runtimes         []RuntimeRecord                    `json:"runtimes"`
	Inbox            []InboxItem                        `json:"inbox"`
	PullRequests     []PullRequest                      `json:"pullRequests"`
	Sessions         []Session                          `json:"sessions"`
	RuntimeLeases    []RuntimeLease                     `json:"runtimeLeases,omitempty"`
	RuntimeScheduler RuntimeScheduler                   `json:"runtimeScheduler"`
	Guards           []DestructiveGuard                 `json:"guards,omitempty"`
	Auth             AuthSnapshot                       `json:"auth"`
	Memory           []MemoryArtifact                   `json:"memory"`
	MemoryVersions   map[string][]MemoryArtifactVersion `json:"memoryVersions,omitempty"`
}

type RoomDetail struct {
	Room     Room      `json:"room"`
	Messages []Message `json:"messages"`
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
}

type Store struct {
	mu            sync.RWMutex
	path          string
	workspaceRoot string
	state         State
	subscribers   map[int]chan State
	nextSubID     int
}
