package store

import (
	"path/filepath"
	"testing"
)

func TestNewFreshBootstrapStartsWithMinimalWorkspace(t *testing.T) {
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
	if len(snapshot.Channels) != 1 || snapshot.Channels[0].ID != "all" {
		t.Fatalf("fresh bootstrap channels = %#v, want one empty #all", snapshot.Channels)
	}
	if got := len(snapshot.ChannelMessages["all"]); got != 0 {
		t.Fatalf("fresh bootstrap #all messages = %d, want 0", got)
	}
	if len(snapshot.Agents) != 1 || snapshot.Agents[0].ID != "agent-starter" {
		t.Fatalf("fresh bootstrap agents = %#v, want one starter agent", snapshot.Agents)
	}
	if len(snapshot.Runtimes) != 1 || snapshot.Runtimes[0].ID != "shock-main" {
		t.Fatalf("fresh bootstrap runtimes = %#v, want one starter runtime", snapshot.Runtimes)
	}
	if snapshot.Workspace.Onboarding.TemplateID != "blank-custom" || snapshot.Workspace.Onboarding.Status != workspaceOnboardingNotStarted {
		t.Fatalf("fresh bootstrap onboarding = %#v, want blank-custom/not_started", snapshot.Workspace.Onboarding)
	}
	if snapshot.Auth.Session.Status != authSessionStatusSignedOut {
		t.Fatalf("fresh bootstrap session = %#v, want signed out", snapshot.Auth.Session)
	}
	if len(snapshot.Auth.Members) != 1 || snapshot.Auth.Members[0].Role != workspaceRoleOwner {
		t.Fatalf("fresh bootstrap members = %#v, want one owner", snapshot.Auth.Members)
	}
	if snapshot.Auth.Members[0].Source != "fresh-bootstrap" {
		t.Fatalf("fresh bootstrap member source = %q, want fresh-bootstrap", snapshot.Auth.Members[0].Source)
	}
	if got := snapshot.Auth.Members[0].Preferences.StartRoute; got != "/chat/all" {
		t.Fatalf("fresh bootstrap member start route = %q, want /chat/all", got)
	}
	if len(snapshot.Auth.Devices) != 0 {
		t.Fatalf("fresh bootstrap devices = %#v, want none before first login", snapshot.Auth.Devices)
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
		t.Fatalf("fresh login devices = %#v, want one pending device", nextState.Auth.Devices)
	}
}
