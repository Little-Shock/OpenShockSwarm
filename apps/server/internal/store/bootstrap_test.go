package store

import (
	"path/filepath"
	"testing"
)

func hasChannelWithID(channels []Channel, channelID string) bool {
	for _, channel := range channels {
		if channel.ID == channelID {
			return true
		}
	}
	return false
}

func TestNewFreshBootstrapStartsWithGuidedWorkspace(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	store, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	snapshot := store.Snapshot()
	if len(snapshot.Issues) != 0 || len(snapshot.Rooms) != 0 || len(snapshot.Runs) != 0 {
		t.Fatalf("fresh bootstrap should not seed work artifacts: issues=%d rooms=%d runs=%d", len(snapshot.Issues), len(snapshot.Rooms), len(snapshot.Runs))
	}
	if len(snapshot.PullRequests) != 0 || len(snapshot.Inbox) != 0 || len(snapshot.Mailbox) != 0 {
		t.Fatalf("fresh bootstrap should not seed collaboration history: prs=%d inbox=%d mailbox=%d", len(snapshot.PullRequests), len(snapshot.Inbox), len(snapshot.Mailbox))
	}
	if len(snapshot.Channels) != 4 {
		t.Fatalf("fresh bootstrap channels = %#v, want #all plus dev-team channels", snapshot.Channels)
	}
	for _, channelID := range []string{"all", "shiproom", "review-lane", "ops-watch"} {
		if !hasChannelWithID(snapshot.Channels, channelID) {
			t.Fatalf("fresh bootstrap channels = %#v, want %s materialized", snapshot.Channels, channelID)
		}
	}
	if got := len(snapshot.ChannelMessages["all"]); got != 0 {
		t.Fatalf("fresh bootstrap #all messages = %d, want 0", got)
	}
	for _, agentID := range []string{
		"agent-codex-dockmaster",
		"agent-build-pilot",
		"agent-claude-review-runner",
		"agent-memory-clerk",
	} {
		if _, ok := findAgentByID(snapshot.Agents, agentID); !ok {
			t.Fatalf("fresh bootstrap agents = %#v, want %s materialized", snapshot.Agents, agentID)
		}
	}
	if len(snapshot.Runtimes) != 1 || snapshot.Runtimes[0].ID != "shock-main" {
		t.Fatalf("fresh bootstrap runtimes = %#v, want one starter runtime", snapshot.Runtimes)
	}
	if snapshot.Workspace.Onboarding.TemplateID != "dev-team" || snapshot.Workspace.Onboarding.Status != workspaceOnboardingInProgress {
		t.Fatalf("fresh bootstrap onboarding = %#v, want dev-team/in_progress", snapshot.Workspace.Onboarding)
	}
	if got := snapshot.Workspace.Onboarding.Materialization.Channels; len(got) != 4 || got[0] != "#all" || got[1] != "#shiproom" || got[2] != "#review-lane" || got[3] != "#ops-watch" {
		t.Fatalf("fresh bootstrap onboarding channels = %#v, want #all + guided dev-team package", got)
	}
	if got := snapshot.Workspace.Onboarding.Materialization.Agents; len(got) != 4 || got[0] != "Codex Dockmaster" || got[1] != "Build Pilot" || got[2] != "Claude Review Runner" || got[3] != "Memory Clerk" {
		t.Fatalf("fresh bootstrap onboarding agents = %#v, want concrete dev-team starter agents", got)
	}
	if len(snapshot.Workspace.Governance.ConfiguredTopology) != 5 || snapshot.Workspace.Governance.ConfiguredTopology[0].DefaultAgent != "Codex Dockmaster" {
		t.Fatalf("fresh bootstrap governance = %#v, want concrete dev-team topology", snapshot.Workspace.Governance)
	}
	if snapshot.Auth.Session.Status != authSessionStatusActive {
		t.Fatalf("fresh bootstrap session = %#v, want active local owner session", snapshot.Auth.Session)
	}
	if len(snapshot.Auth.Members) != 1 || snapshot.Auth.Members[0].Role != workspaceRoleOwner {
		t.Fatalf("fresh bootstrap members = %#v, want one owner", snapshot.Auth.Members)
	}
	if snapshot.Auth.Members[0].Source != "fresh-bootstrap" {
		t.Fatalf("fresh bootstrap member source = %q, want fresh-bootstrap", snapshot.Auth.Members[0].Source)
	}
	if snapshot.Auth.Members[0].Status != workspaceMemberStatusActive {
		t.Fatalf("fresh bootstrap member status = %q, want active", snapshot.Auth.Members[0].Status)
	}
	if got := snapshot.Auth.Members[0].Preferences.StartRoute; got != "/chat/all" {
		t.Fatalf("fresh bootstrap member start route = %q, want /chat/all", got)
	}
	if snapshot.Workspace.DeviceAuth != workspaceDeviceAuthLabel(authDeviceStatusAuthorized) {
		t.Fatalf("fresh bootstrap workspace device auth = %q, want browser-approved", snapshot.Workspace.DeviceAuth)
	}
	if len(snapshot.Auth.Devices) != 1 || snapshot.Auth.Devices[0].Status != authDeviceStatusAuthorized {
		t.Fatalf("fresh bootstrap devices = %#v, want one authorized local device", snapshot.Auth.Devices)
	}
	if snapshot.Auth.Session.MemberID != "member-owner" || snapshot.Auth.Session.Email != "owner@openshock.local" {
		t.Fatalf("fresh bootstrap session identity = %#v, want local owner identity", snapshot.Auth.Session)
	}
	if snapshot.Auth.Session.AuthMethod != "local-bootstrap" || snapshot.Auth.Session.DeviceAuthStatus != authDeviceStatusAuthorized {
		t.Fatalf("fresh bootstrap session auth/device = %#v, want local-bootstrap + authorized", snapshot.Auth.Session)
	}
	if !sessionHasPermission(snapshot.Auth.Session, "workspace.manage") || !sessionHasPermission(snapshot.Auth.Session, "issue.create") {
		t.Fatalf("fresh bootstrap session permissions = %#v, want owner permissions", snapshot.Auth.Session.Permissions)
	}
}

func TestFreshBootstrapFirstLoginClaimsPlaceholderOwner(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	store, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	store.mu.Lock()
	store.state.Issues = append(store.state.Issues, Issue{
		ID:    "issue-bootstrap-claim",
		Key:   "OPS-1",
		Title: "Bootstrap work already started",
		State: "queued",
	})
	store.mu.Unlock()

	nextState, session, err := store.LoginWithEmail(AuthLoginInput{
		Email:       "alice@example.com",
		Name:        "Alice",
		DeviceLabel: "Alice Browser",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail() error = %v", err)
	}

	if session.Status != authSessionStatusActive || session.Email != "alice@example.com" || session.MemberID != "member-owner" {
		t.Fatalf("fresh login session = %#v, want claimed owner session", session)
	}
	if session.EmailVerificationStatus != authEmailVerificationPending || session.DeviceAuthStatus != authDeviceStatusPending {
		t.Fatalf("fresh login verification/device status = %#v, want pending/pending", session)
	}
	if len(nextState.Auth.Members) != 1 {
		t.Fatalf("fresh login members = %#v, want one claimed owner", nextState.Auth.Members)
	}
	member := nextState.Auth.Members[0]
	if member.Email != "alice@example.com" || member.Name != "Alice" || member.Source != "browser-registration" {
		t.Fatalf("fresh login member = %#v, want claimed registration owner", member)
	}
	if len(nextState.Auth.Devices) != 1 || nextState.Auth.Devices[0].Status != authDeviceStatusPending {
		t.Fatalf("fresh login devices = %#v, want one pending claimed device", nextState.Auth.Devices)
	}
	if len(nextState.Issues) != 1 || nextState.Issues[0].ID != "issue-bootstrap-claim" {
		t.Fatalf("fresh login should preserve started work artifacts, got %#v", nextState.Issues)
	}
}
