package store

import (
	"path/filepath"
	"testing"
)

func TestAuthSessionContractTracksEmailLoginAndLogout(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	initial := s.Snapshot()
	if initial.Auth.Session.Status != authSessionStatusActive {
		t.Fatalf("initial auth status = %q, want %q", initial.Auth.Session.Status, authSessionStatusActive)
	}
	if initial.Auth.Session.Email != "larkspur@openshock.dev" || initial.Auth.Session.Role != workspaceRoleOwner {
		t.Fatalf("initial auth session = %#v, want owner session", initial.Auth.Session)
	}
	if !containsString(initial.Auth.Session.Permissions, "members.manage") {
		t.Fatalf("owner permissions = %#v, want members.manage", initial.Auth.Session.Permissions)
	}

	_, invited, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  workspaceRoleViewer,
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}
	if invited.Status != workspaceMemberStatusInvited {
		t.Fatalf("invited member status = %q, want %q", invited.Status, workspaceMemberStatusInvited)
	}

	nextState, session, err := s.LoginWithEmail(AuthLoginInput{Email: "reviewer@openshock.dev"})
	if err != nil {
		t.Fatalf("LoginWithEmail() error = %v", err)
	}
	if session.Email != "reviewer@openshock.dev" || session.Role != workspaceRoleViewer {
		t.Fatalf("login session = %#v, want reviewer viewer", session)
	}
	if session.Status != authSessionStatusActive {
		t.Fatalf("login session status = %q, want %q", session.Status, authSessionStatusActive)
	}
	if containsString(session.Permissions, "members.manage") {
		t.Fatalf("viewer permissions = %#v, should not include members.manage", session.Permissions)
	}
	if !containsString(session.Permissions, "memory.read") {
		t.Fatalf("viewer permissions = %#v, want memory.read", session.Permissions)
	}

	member := findWorkspaceMemberByEmail(nextState.Auth.Members, "reviewer@openshock.dev")
	if member == nil {
		t.Fatalf("workspace member reviewer@openshock.dev missing from roster")
	}
	if member.Status != workspaceMemberStatusActive {
		t.Fatalf("member status after login = %q, want %q", member.Status, workspaceMemberStatusActive)
	}
	if member.LastSeenAt == "" {
		t.Fatalf("member last seen missing after login: %#v", member)
	}

	loggedOutState, loggedOut, err := s.LogoutAuthSession()
	if err != nil {
		t.Fatalf("LogoutAuthSession() error = %v", err)
	}
	if loggedOut.Status != authSessionStatusSignedOut {
		t.Fatalf("logged out session status = %q, want %q", loggedOut.Status, authSessionStatusSignedOut)
	}
	if loggedOutState.Auth.Session.Email != "" || len(loggedOutState.Auth.Session.Permissions) != 0 {
		t.Fatalf("logged out state auth session = %#v, want empty signed out session", loggedOutState.Auth.Session)
	}
}

func TestAuthSessionPersistsAcrossStoreReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	first, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(first) error = %v", err)
	}

	loggedInState, loggedIn, err := first.LoginWithEmail(AuthLoginInput{Email: "mina@openshock.dev"})
	if err != nil {
		t.Fatalf("LoginWithEmail() error = %v", err)
	}
	if loggedIn.Email != "mina@openshock.dev" || loggedIn.Role != workspaceRoleMember {
		t.Fatalf("loggedIn session = %#v, want mina member", loggedIn)
	}
	if loggedInState.Auth.Session.Email != "mina@openshock.dev" {
		t.Fatalf("loggedIn state auth session = %#v, want mina", loggedInState.Auth.Session)
	}

	second, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(second) error = %v", err)
	}

	secondSnapshot := second.Snapshot()
	if secondSnapshot.Auth.Session.Email != "mina@openshock.dev" || secondSnapshot.Auth.Session.Status != authSessionStatusActive {
		t.Fatalf("reloaded auth session = %#v, want persisted active mina session", secondSnapshot.Auth.Session)
	}

	loggedOutState, _, err := second.LogoutAuthSession()
	if err != nil {
		t.Fatalf("LogoutAuthSession() error = %v", err)
	}
	if loggedOutState.Auth.Session.Status != authSessionStatusSignedOut {
		t.Fatalf("loggedOut state auth session = %#v, want signed_out", loggedOutState.Auth.Session)
	}

	third, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(third) error = %v", err)
	}

	thirdSnapshot := third.Snapshot()
	if thirdSnapshot.Auth.Session.Status != authSessionStatusSignedOut || thirdSnapshot.Auth.Session.Email != "" {
		t.Fatalf("reloaded signed-out session = %#v, want persisted signed_out session", thirdSnapshot.Auth.Session)
	}
}

func TestWorkspaceMemberContractEnforcesOwnerRoleAndRetainsLastOwner(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.UpdateWorkspaceMember("member-larkspur", WorkspaceMemberUpdateInput{Role: workspaceRoleMember}); !errorsIs(err, ErrWorkspaceMustRetainOwner) {
		t.Fatalf("UpdateWorkspaceMember(last owner) error = %v, want %v", err, ErrWorkspaceMustRetainOwner)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{Email: "mina@openshock.dev"}); err != nil {
		t.Fatalf("LoginWithEmail(member) error = %v", err)
	}

	if _, _, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "blocked@openshock.dev",
		Name:  "Blocked",
		Role:  workspaceRoleViewer,
	}); !errorsIs(err, ErrWorkspaceRoleForbidden) {
		t.Fatalf("InviteWorkspaceMember(member session) error = %v, want %v", err, ErrWorkspaceRoleForbidden)
	}

	if _, _, err := s.UpdateWorkspaceMember("member-longwen", WorkspaceMemberUpdateInput{Status: workspaceMemberStatusSuspended}); !errorsIs(err, ErrWorkspaceRoleForbidden) {
		t.Fatalf("UpdateWorkspaceMember(member session) error = %v, want %v", err, ErrWorkspaceRoleForbidden)
	}
}

func findWorkspaceMemberByEmail(items []WorkspaceMember, email string) *WorkspaceMember {
	for index := range items {
		if items[index].Email == email {
			return &items[index]
		}
	}
	return nil
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func errorsIs(err, target error) bool {
	return err != nil && target != nil && err.Error() == target.Error()
}
