package store

import (
	"os"
	"strings"
	"time"
)

const (
	bootstrapModeSeed  = "seed"
	bootstrapModeFresh = "fresh"
)

func bootstrapModeFromEnv() string {
	switch strings.TrimSpace(strings.ToLower(os.Getenv("OPENSHOCK_BOOTSTRAP_MODE"))) {
	case bootstrapModeFresh:
		return bootstrapModeFresh
	default:
		return bootstrapModeSeed
	}
}

func (s *Store) freshBootstrap() bool {
	return strings.EqualFold(strings.TrimSpace(s.bootstrapMode), bootstrapModeFresh)
}

func freshBootstrapDaemonURL() string {
	if value := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENSHOCK_DAEMON_URL")), "/"); value != "" {
		return value
	}
	return "http://127.0.0.1:8090"
}

func freshState(workspaceRoot string) State {
	now := time.Now().UTC().Format(time.RFC3339)
	seed := seedState()
	daemonURL := freshBootstrapDaemonURL()

	owner := newWorkspaceMember(
		"member-owner",
		"owner@openshock.local",
		"Workspace Owner",
		workspaceRoleOwner,
		workspaceMemberStatusInvited,
		"fresh-bootstrap",
		now,
		now,
	)
	owner.Preferences.StartRoute = "/chat/all"
	owner.Preferences.UpdatedAt = now

	session := signedOutAuthSession()
	session.Preferences = owner.Preferences

	runtimeProviders := append([]RuntimeProvider{}, seed.Runtimes[0].Providers...)

	return State{
		Workspace: WorkspaceSnapshot{
			Name:          "新的 OpenShock 工作区",
			Plan:          "Fresh Workspace",
			PairingStatus: workspacePairingUnpaired,
			DeviceAuth:    workspaceDeviceAuthLabel(session.DeviceAuthStatus),
			BrowserPush:   "只推高优先级",
			MemoryMode:    "MEMORY.md + notes/ + decisions/",
			Sandbox:       defaultSandboxPolicy(now),
			RepoBinding: WorkspaceRepoBindingSnapshot{
				Provider:      "github",
				BindingStatus: "pending",
				AuthMode:      "local-git-origin",
				SyncedAt:      now,
			},
			GitHubInstallation: WorkspaceGitHubInstallSnapshot{
				Provider:          "github",
				PreferredAuthMode: "github-app",
				ConnectionMessage: "这是一个全新的工作区，请先完成仓库、GitHub 和运行环境设置。",
				SyncedAt:          now,
			},
			Onboarding: WorkspaceOnboardingSnapshot{
				Status:         workspaceOnboardingNotStarted,
				TemplateID:     "blank-custom",
				CurrentStep:    "account",
				CompletedSteps: []string{},
				ResumeURL:      "/onboarding",
				Materialization: WorkspaceOnboardingMaterialization{
					Label:              "空白自定义",
					Channels:           []string{"#all"},
					Roles:              []string{"Owner"},
					Agents:             []string{"启动智能体"},
					NotificationPolicy: "只推高优先级与显式 review 事件",
					Notes:              []string{"这是一个全新的空白工作区，当前没有历史消息和历史房间。"},
				},
				UpdatedAt: now,
			},
		},
		Channels: []Channel{
			{
				ID:      "all",
				Name:    "#all",
				Summary: "全新工作区的默认频道，当前还没有历史消息。",
				Unread:  0,
				Purpose: "先在这里完成第一轮频道对话；后续再扩展正式频道。",
			},
		},
		ChannelMessages: map[string][]Message{
			"all": {},
		},
		DirectMessages:        []DirectMessage{},
		DirectMessageMessages: map[string][]Message{},
		FollowedThreads:       []MessageSurfaceEntry{},
		SavedLaterItems:       []MessageSurfaceEntry{},
		QuickSearchEntries:    []SearchResult{},
		Issues:                []Issue{},
		Rooms:                 []Room{},
		RoomMessages:          map[string][]Message{},
		Runs:                  []Run{},
		Agents: []Agent{
			{
				ID:                    "agent-starter",
				Name:                  "启动智能体",
				Description:           "从空工作区开始配置你的第一个智能体。",
				Mood:                  "等待你配置",
				State:                 "idle",
				Lane:                  "workspace-bootstrap",
				Role:                  "工作区搭建",
				Avatar:                "starter-spark",
				Prompt:                "先完成当前 workspace 的基础配置，再开始执行。",
				OperatingInstructions: "没有 room / issue 时先停在 setup，不提前制造历史执行痕迹。",
				Provider:              "Codex CLI",
				ProviderPreference:    "Codex CLI",
				ModelPreference:       "gpt-5.3-codex",
				RecallPolicy:          agentRecallPolicyBalanced,
				RuntimePreference:     "shock-main",
				MemorySpaces:          []string{"workspace"},
				RecentRunIDs:          []string{},
				ProfileAudit:          []AgentProfileAuditEntry{},
				Sandbox:               defaultSandboxPolicy(now),
			},
		},
		Machines: []Machine{},
		Runtimes: []RuntimeRecord{
			normalizeRuntimeRecord(RuntimeRecord{
				ID:              "shock-main",
				Machine:         "shock-main",
				DaemonURL:       daemonURL,
				DetectedCLI:     []string{"codex", "claude"},
				Providers:       runtimeProviders,
				Shell:           "bash",
				State:           runtimeStateOnline,
				WorkspaceRoot:   strings.TrimSpace(workspaceRoot),
				ReportedAt:      now,
				LastHeartbeatAt: now,
			}, now),
		},
		Inbox:         []InboxItem{},
		Mailbox:       []AgentHandoff{},
		PullRequests:  []PullRequest{},
		Sessions:      []Session{},
		RuntimeLeases: []RuntimeLease{},
		Guards:        []DestructiveGuard{},
		Auth: AuthSnapshot{
			Session: session,
			Roles:   defaultWorkspaceRoles(),
			Members: []WorkspaceMember{owner},
			Devices: []AuthDevice{},
		},
		Memory:         []MemoryArtifact{},
		MemoryVersions: map[string][]MemoryArtifactVersion{},
		Credentials:    []CredentialProfile{},
	}
}
