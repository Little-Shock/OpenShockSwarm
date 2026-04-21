package store

import (
	"path/filepath"
	"testing"
)

func TestWorkspaceConfigAndMemberPreferencesPersistAcrossReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	nextState, workspace, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		BrowserPush: "全部 live 事件",
		MemoryMode:  "governed-first / durable truth",
		Sandbox: &SandboxPolicy{
			Profile:         sandboxProfileRestricted,
			AllowedHosts:    []string{"github.com", "api.github.com"},
			AllowedCommands: []string{"git status"},
			AllowedTools:    []string{"read_file", "search"},
		},
		Onboarding: &WorkspaceOnboardingSnapshot{
			Status:         workspaceOnboardingReady,
			TemplateID:     "research-team",
			CurrentStep:    "identity-proof",
			CompletedSteps: []string{"workspace-created", "repo-bound", "agent-profile"},
			ResumeURL:      "/setup?resume=tkt-37",
		},
		Governance: &WorkspaceGovernanceConfigInput{
			DeliveryDelegationMode: governanceDeliveryDelegationModeAutoComplete,
			TeamTopology: []WorkspaceGovernanceLaneConfig{
				{ID: "lead", Label: "Research Lead", Role: "方向与验收", DefaultAgent: "Lead Operator", Lane: "scope / final synthesis"},
				{ID: "collector", Label: "Field Collector", Role: "一线证据收集", DefaultAgent: "Collector", Lane: "intake -> evidence"},
				{ID: "synthesizer", Label: "Synthesizer", Role: "归纳与草案", DefaultAgent: "Synthesizer", Lane: "evidence -> synthesis"},
				{ID: "reviewer", Label: "Peer Reviewer", Role: "交叉复核", DefaultAgent: "Claude Review Runner", Lane: "review / challenge"},
				{ID: "publisher", Label: "Publisher", Role: "发布与归档", DefaultAgent: "Lead Operator", Lane: "publish / closeout"},
			},
		},
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}
	if workspace.Onboarding.TemplateID != "research-team" || workspace.MemoryMode != "governed-first / durable truth" {
		t.Fatalf("workspace update = %#v, want persisted onboarding + memory mode", workspace)
	}
	if workspace.Sandbox.Profile != sandboxProfileRestricted || len(workspace.Sandbox.AllowedHosts) != 2 {
		t.Fatalf("workspace sandbox = %#v, want restricted sandbox policy", workspace.Sandbox)
	}
	if workspace.Onboarding.Materialization.Label != "研究团队" || len(workspace.Onboarding.Materialization.Channels) != 3 {
		t.Fatalf("workspace onboarding materialization = %#v, want persisted research-team package", workspace.Onboarding.Materialization)
	}
	if len(workspace.Governance.ConfiguredTopology) != 5 || workspace.Governance.ConfiguredTopology[1].Label != "Field Collector" {
		t.Fatalf("workspace governance configured topology = %#v, want persisted custom topology", workspace.Governance.ConfiguredTopology)
	}
	if workspace.Governance.DeliveryDelegationMode != governanceDeliveryDelegationModeAutoComplete {
		t.Fatalf("workspace governance mode = %q, want %q", workspace.Governance.DeliveryDelegationMode, governanceDeliveryDelegationModeAutoComplete)
	}
	if nextState.Workspace.Onboarding.ResumeURL != "/setup?resume=tkt-37" {
		t.Fatalf("state workspace onboarding = %#v, want resume url", nextState.Workspace.Onboarding)
	}
	if len(nextState.Workspace.Governance.TeamTopology) != 5 || nextState.Workspace.Governance.TeamTopology[4].ID != "publisher" {
		t.Fatalf("state governance topology = %#v, want derived custom topology", nextState.Workspace.Governance.TeamTopology)
	}
	if nextState.Workspace.Governance.DeliveryDelegationMode != governanceDeliveryDelegationModeAutoComplete {
		t.Fatalf("state governance mode = %q, want %q", nextState.Workspace.Governance.DeliveryDelegationMode, governanceDeliveryDelegationModeAutoComplete)
	}

	updatedState, member, err := s.UpdateWorkspaceMemberPreferences("member-larkspur", WorkspaceMemberPreferencesInput{
		PreferredAgentID: "agent-codex-dockmaster",
		StartRoute:       "/settings",
		GitHubHandle:     "@durable-owner",
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceMemberPreferences() error = %v", err)
	}
	if member.Preferences.StartRoute != "/settings" || member.GitHubIdentity.Handle != "@durable-owner" {
		t.Fatalf("member preferences = %#v, want persisted route + github handle", member)
	}
	if updatedState.Auth.Session.Preferences.StartRoute != "/settings" || updatedState.Auth.Session.GitHubIdentity.Handle != "@durable-owner" {
		t.Fatalf("session preferences = %#v, want refreshed session truth", updatedState.Auth.Session)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reloaded) error = %v", err)
	}

	snapshot := reloaded.Snapshot()
	if snapshot.Workspace.BrowserPush != "全部 live 事件" || snapshot.Workspace.MemoryMode != "governed-first / durable truth" {
		t.Fatalf("reloaded workspace = %#v, want persisted browser/memory mode", snapshot.Workspace)
	}
	if snapshot.Workspace.Sandbox.Profile != sandboxProfileRestricted || len(snapshot.Workspace.Sandbox.AllowedTools) != 2 {
		t.Fatalf("reloaded workspace sandbox = %#v, want persisted sandbox policy", snapshot.Workspace.Sandbox)
	}
	if snapshot.Workspace.Onboarding.TemplateID != "research-team" || snapshot.Workspace.Onboarding.Status != workspaceOnboardingReady {
		t.Fatalf("reloaded onboarding = %#v, want research-team ready", snapshot.Workspace.Onboarding)
	}
	if snapshot.Workspace.Onboarding.Materialization.NotificationPolicy == "" || len(snapshot.Workspace.Onboarding.Materialization.Notes) == 0 {
		t.Fatalf("reloaded onboarding materialization = %#v, want durable template package", snapshot.Workspace.Onboarding.Materialization)
	}
	if snapshot.Workspace.Governance.TemplateID != "research-team" || len(snapshot.Workspace.Governance.TeamTopology) != 5 {
		t.Fatalf("reloaded governance = %#v, want research-team custom governance snapshot", snapshot.Workspace.Governance)
	}
	if snapshot.Workspace.Governance.Label == "" || snapshot.Workspace.Governance.Summary == "" {
		t.Fatalf("reloaded governance = %#v, want populated governance label + summary", snapshot.Workspace.Governance)
	}
	if len(snapshot.Workspace.Governance.ConfiguredTopology) != 5 || snapshot.Workspace.Governance.ConfiguredTopology[4].ID != "publisher" {
		t.Fatalf("reloaded configured topology = %#v, want persisted publisher lane", snapshot.Workspace.Governance.ConfiguredTopology)
	}
	if snapshot.Workspace.Governance.DeliveryDelegationMode != governanceDeliveryDelegationModeAutoComplete {
		t.Fatalf("reloaded governance mode = %q, want %q", snapshot.Workspace.Governance.DeliveryDelegationMode, governanceDeliveryDelegationModeAutoComplete)
	}

	reloadedMember := findWorkspaceMemberByEmail(snapshot.Auth.Members, "larkspur@openshock.dev")
	if reloadedMember == nil {
		t.Fatalf("reloaded member missing")
	}
	if reloadedMember.Preferences.PreferredAgentID != "agent-codex-dockmaster" || reloadedMember.GitHubIdentity.Handle != "@durable-owner" {
		t.Fatalf("reloaded member = %#v, want persisted preferences + github identity", reloadedMember)
	}
	if snapshot.Auth.Session.Preferences.StartRoute != "/settings" || snapshot.Auth.Session.GitHubIdentity.Handle != "@durable-owner" {
		t.Fatalf("reloaded session = %#v, want persisted session config", snapshot.Auth.Session)
	}
}

func TestWorkspaceMemberPreferencesRejectUnknownAgent(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.UpdateWorkspaceMemberPreferences("member-larkspur", WorkspaceMemberPreferencesInput{
		PreferredAgentID: "agent-missing",
	}); !errorsIs(err, ErrWorkspacePreferredAgentNotFound) {
		t.Fatalf("UpdateWorkspaceMemberPreferences(unknown agent) error = %v, want %v", err, ErrWorkspacePreferredAgentNotFound)
	}
}

func TestFreshWorkspaceConfigMaterializesCustomGovernanceAgents(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Onboarding: &WorkspaceOnboardingSnapshot{
			Status:     workspaceOnboardingReady,
			TemplateID: "dev-team",
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig(onboarding) error = %v", err)
	}

	nextState, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: []WorkspaceGovernanceLaneConfig{
				{ID: "architect", Label: "Architect", Role: "网站信息架构与边界", DefaultAgent: "Codex Dockmaster", Lane: "scope / IA"},
				{ID: "developer", Label: "Developer", Role: "页面实现与交互收口", DefaultAgent: "Build Pilot", Lane: "build / polish"},
				{ID: "reviewer", Label: "Reviewer", Role: "exact-head 复核", DefaultAgent: "Claude Review Runner", Lane: "review / copy"},
				{ID: "qa", Label: "QA", Role: "跨端验证与演示确认", DefaultAgent: "Memory Clerk", Lane: "verify / demo"},
			},
		},
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceConfig(governance) error = %v", err)
	}

	for _, agentID := range []string{
		"agent-codex-dockmaster",
		"agent-build-pilot",
		"agent-claude-review-runner",
		"agent-memory-clerk",
	} {
		if _, ok := findAgentByID(nextState.Agents, agentID); !ok {
			t.Fatalf("fresh governance agents = %#v, want %s materialized", nextState.Agents, agentID)
		}
	}
}

func TestWorkspaceConfigNormalizesCompletedBootstrapToDone(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	nextState, workspace, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Onboarding: &WorkspaceOnboardingSnapshot{
			Status:         workspaceOnboardingReady,
			TemplateID:     "dev-team",
			CurrentStep:    "bootstrap-finished",
			CompletedSteps: []string{"workspace-created", "template-selected", "bootstrap-finished"},
			ResumeURL:      "/onboarding?template=dev-team",
		},
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	if workspace.Onboarding.Status != workspaceOnboardingDone || workspace.Onboarding.CurrentStep != "bootstrap-finished" {
		t.Fatalf("workspace onboarding = %#v, want normalized done/bootstrap-finished", workspace.Onboarding)
	}
	if workspace.Onboarding.ResumeURL != "/chat/all" {
		t.Fatalf("workspace onboarding resume = %q, want /chat/all after completion", workspace.Onboarding.ResumeURL)
	}
	if got := workspace.Onboarding.Materialization.Agents; len(got) != 4 || got[0] != "Codex Dockmaster" || got[1] != "Build Pilot" || got[2] != "Claude Review Runner" || got[3] != "Memory Clerk" {
		t.Fatalf("workspace onboarding agents = %#v, want concrete dev-team starter agents", got)
	}
	if nextState.Workspace.Onboarding.Status != workspaceOnboardingDone {
		t.Fatalf("state onboarding = %#v, want done after normalization", nextState.Workspace.Onboarding)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reloaded) error = %v", err)
	}

	snapshot := reloaded.Snapshot()
	if snapshot.Workspace.Onboarding.Status != workspaceOnboardingDone || snapshot.Workspace.Onboarding.ResumeURL != "/chat/all" {
		t.Fatalf("reloaded onboarding = %#v, want durable done state with chat resume", snapshot.Workspace.Onboarding)
	}
}
