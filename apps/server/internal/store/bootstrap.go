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

func freshBootstrapGovernanceTopology() []WorkspaceGovernanceLaneConfig {
	return []WorkspaceGovernanceLaneConfig{
		{ID: "pm", Label: "PM", Role: "目标与验收", DefaultAgent: "Codex Dockmaster", Lane: "目标确认 / 最终回复"},
		{ID: "architect", Label: "Architect", Role: "拆解与边界", DefaultAgent: "Codex Dockmaster", Lane: "拆解 / 边界"},
		{ID: "developer", Label: "Developer", Role: "实现与推进", DefaultAgent: "Build Pilot", Lane: "实现 / 提交"},
		{ID: "reviewer", Label: "Reviewer", Role: "评审与结论", DefaultAgent: "Claude Review Runner", Lane: "评审 / 回退"},
		{ID: "qa", Label: "QA", Role: "验证与交付确认", DefaultAgent: "Memory Clerk", Lane: "验证 / 交付"},
	}
}

func freshState(workspaceRoot string) State {
	now := time.Now().UTC().Format(time.RFC3339)
	seed := seedState()
	daemonURL := freshBootstrapDaemonURL()
	onboarding := defaultWorkspaceOnboarding(now)
	onboarding.Materialization = workspaceOnboardingMaterialization(onboarding.TemplateID)
	governanceTopology := freshBootstrapGovernanceTopology()

	owner := newWorkspaceMember(
		"member-owner",
		"owner@openshock.local",
		"Workspace Owner",
		workspaceRoleOwner,
		workspaceMemberStatusActive,
		"fresh-bootstrap",
		now,
		now,
	)
	owner.Preferences.StartRoute = "/chat/all"
	owner.Preferences.UpdatedAt = now
	device := newAuthDevice(owner.ID, "Local Browser", authDeviceStatusAuthorized, now, now, now)
	owner.TrustedDeviceIDs = []string{device.ID}

	session := authSessionFromMember(owner, now)
	session = hydrateSessionWithDevice(session, device, "local-bootstrap")

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
				ConnectionMessage: "先绑定仓库、接通 GitHub、配对运行环境，就能开始交接和交付。",
				SyncedAt:          now,
			},
			Onboarding: onboarding,
			Governance: WorkspaceGovernanceSnapshot{
				ConfiguredTopology:     governanceTopology,
				DeliveryDelegationMode: governanceDeliveryDelegationModeFormalHandoff,
			},
		},
		Channels: []Channel{
			{
				ID:      "all",
				Name:    "#all",
				Summary: "先在这里确认目标、同步阻塞，再把正式工作推进到讨论间。",
				Unread:  0,
				Purpose: "默认协作入口，先把目标和下一步说清楚。",
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
		Agents: []Agent{},
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
		Inbox:          []InboxItem{},
		Mailbox:        []AgentHandoff{},
		RoomAgentWaits: []RoomAgentWait{},
		PullRequests:   []PullRequest{},
		Sessions:       []Session{},
		RuntimeLeases:  []RuntimeLease{},
		Guards:         []DestructiveGuard{},
		Auth: AuthSnapshot{
			Session: session,
			Roles:   defaultWorkspaceRoles(),
			Members: []WorkspaceMember{owner},
			Devices: []AuthDevice{device},
		},
		Memory:         []MemoryArtifact{},
		MemoryVersions: map[string][]MemoryArtifactVersion{},
		Credentials:    []CredentialProfile{},
	}
}
