package store

import "sync"

type WorkspaceSnapshot struct {
	Name             string `json:"name"`
	Repo             string `json:"repo"`
	RepoURL          string `json:"repoUrl"`
	Branch           string `json:"branch"`
	Plan             string `json:"plan"`
	PairedRuntime    string `json:"pairedRuntime"`
	PairedRuntimeURL string `json:"pairedRuntimeUrl"`
	PairingStatus    string `json:"pairingStatus"`
	DeviceAuth       string `json:"deviceAuth"`
	LastPairedAt     string `json:"lastPairedAt"`
	BrowserPush      string `json:"browserPush"`
	MemoryMode       string `json:"memoryMode"`
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
	CLI           string `json:"cli"`
	OS            string `json:"os"`
	LastHeartbeat string `json:"lastHeartbeat"`
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
}

type PullRequest struct {
	ID            string `json:"id"`
	Number        int    `json:"number"`
	Label         string `json:"label"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	IssueKey      string `json:"issueKey"`
	RoomID        string `json:"roomId"`
	RunID         string `json:"runId"`
	Branch        string `json:"branch"`
	Author        string `json:"author"`
	ReviewSummary string `json:"reviewSummary"`
	UpdatedAt     string `json:"updatedAt"`
}

type Session struct {
	ID           string   `json:"id"`
	IssueKey     string   `json:"issueKey"`
	RoomID       string   `json:"roomId"`
	TopicID      string   `json:"topicId"`
	ActiveRunID  string   `json:"activeRunId"`
	Status       string   `json:"status"`
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

type MemoryArtifact struct {
	ID        string `json:"id"`
	Scope     string `json:"scope"`
	Kind      string `json:"kind"`
	Path      string `json:"path"`
	Summary   string `json:"summary"`
	UpdatedAt string `json:"updatedAt"`
}

type State struct {
	Workspace       WorkspaceSnapshot    `json:"workspace"`
	Channels        []Channel            `json:"channels"`
	ChannelMessages map[string][]Message `json:"channelMessages"`
	Issues          []Issue              `json:"issues"`
	Rooms           []Room               `json:"rooms"`
	RoomMessages    map[string][]Message `json:"roomMessages"`
	Runs            []Run                `json:"runs"`
	Agents          []Agent              `json:"agents"`
	Machines        []Machine            `json:"machines"`
	Inbox           []InboxItem          `json:"inbox"`
	PullRequests    []PullRequest        `json:"pullRequests"`
	Sessions        []Session            `json:"sessions"`
	Memory          []MemoryArtifact     `json:"memory"`
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
	DaemonURL   string
	Machine     string
	DetectedCLI []string
	State       string
	ReportedAt  string
}

type Store struct {
	mu            sync.RWMutex
	path          string
	workspaceRoot string
	state         State
}
