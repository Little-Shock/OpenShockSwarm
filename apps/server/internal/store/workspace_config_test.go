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
		Onboarding: &WorkspaceOnboardingSnapshot{
			Status:         workspaceOnboardingReady,
			TemplateID:     "research-team",
			CurrentStep:    "identity-proof",
			CompletedSteps: []string{"workspace-created", "repo-bound", "agent-profile"},
			ResumeURL:      "/setup?resume=tkt-37",
		},
	})
	if err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}
	if workspace.Onboarding.TemplateID != "research-team" || workspace.MemoryMode != "governed-first / durable truth" {
		t.Fatalf("workspace update = %#v, want persisted onboarding + memory mode", workspace)
	}
	if nextState.Workspace.Onboarding.ResumeURL != "/setup?resume=tkt-37" {
		t.Fatalf("state workspace onboarding = %#v, want resume url", nextState.Workspace.Onboarding)
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
	if snapshot.Workspace.Onboarding.TemplateID != "research-team" || snapshot.Workspace.Onboarding.Status != workspaceOnboardingReady {
		t.Fatalf("reloaded onboarding = %#v, want research-team ready", snapshot.Workspace.Onboarding)
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
