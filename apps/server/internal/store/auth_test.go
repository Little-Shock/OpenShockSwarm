package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestAuthSessionContractTracksEmailLoginAndLogout(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	initial := s.Snapshot()
	if initial.Auth.Session.Status != authSessionStatusSignedOut {
		t.Fatalf("initial auth status = %q, want %q", initial.Auth.Session.Status, authSessionStatusSignedOut)
	}
	if initial.Auth.Session.Email != "" || initial.Auth.Session.Role != "" {
		t.Fatalf("initial auth session = %#v, want signed-out session", initial.Auth.Session)
	}
	if len(initial.Auth.Session.Permissions) != 0 {
		t.Fatalf("signed-out permissions = %#v, want empty permissions", initial.Auth.Session.Permissions)
	}

	_, ownerSession, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}
	if ownerSession.Role != workspaceRoleOwner || !containsString(ownerSession.Permissions, "members.manage") {
		t.Fatalf("owner session = %#v, want owner permissions", ownerSession)
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
	if member.Status != workspaceMemberStatusInvited {
		t.Fatalf("member status after login = %q, want %q until recovery gates clear", member.Status, workspaceMemberStatusInvited)
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

func TestLoginChallengeContractRequiresChallengeAndConsumesReplay(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, challenge, err := s.RequestLoginChallenge(AuthLoginInput{Email: "mina@openshock.dev"})
	if err != nil {
		t.Fatalf("RequestLoginChallenge() error = %v", err)
	}
	if challenge.Kind != authChallengeKindLogin || challenge.Email != "mina@openshock.dev" || challenge.Status != authChallengeStatusPending {
		t.Fatalf("login challenge = %#v, want pending login challenge for mina", challenge)
	}

	if _, _, err := s.CompleteLoginWithChallenge(AuthLoginInput{
		Email:       "mina@openshock.dev",
		DeviceLabel: "Mina Browser",
	}, ""); !errorsIs(err, ErrAuthChallengeRequired) {
		t.Fatalf("CompleteLoginWithChallenge(missing challenge) error = %v, want %v", err, ErrAuthChallengeRequired)
	}

	nextState, session, err := s.CompleteLoginWithChallenge(AuthLoginInput{
		Email:       "mina@openshock.dev",
		DeviceLabel: "Mina Browser",
	}, challenge.ID)
	if err != nil {
		t.Fatalf("CompleteLoginWithChallenge() error = %v", err)
	}
	if session.Email != "mina@openshock.dev" || session.Role != workspaceRoleMember {
		t.Fatalf("challenge login session = %#v, want mina member", session)
	}
	if consumed := findAuthChallengeByID(nextState.Auth.Challenges, challenge.ID); consumed == nil || consumed.Status != authChallengeStatusConsumed {
		t.Fatalf("consumed login challenge = %#v, want consumed", consumed)
	}

	if _, _, err := s.CompleteLoginWithChallenge(AuthLoginInput{
		Email:       "mina@openshock.dev",
		DeviceLabel: "Mina Browser",
	}, challenge.ID); !errorsIs(err, ErrAuthChallengeConsumed) {
		t.Fatalf("CompleteLoginWithChallenge(reused challenge) error = %v, want %v", err, ErrAuthChallengeConsumed)
	}
}

func TestLoginChallengeContractRejectsCrossAccountReplay(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, challenge, err := s.RequestLoginChallenge(AuthLoginInput{Email: "mina@openshock.dev"})
	if err != nil {
		t.Fatalf("RequestLoginChallenge() error = %v", err)
	}

	if _, _, err := s.CompleteLoginWithChallenge(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}, challenge.ID); !errorsIs(err, ErrAuthChallengeNotFound) {
		t.Fatalf("CompleteLoginWithChallenge(cross-account replay) error = %v, want %v", err, ErrAuthChallengeNotFound)
	}
}

func TestRecoveryChallengeContractRejectsReplayCrossAccountAndExpiry(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}

	_, invited, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  workspaceRoleMember,
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}

	_, reviewerSession, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(reviewer) error = %v", err)
	}

	verifyChallengeState, verifyChallenge, err := s.RequestVerifyMemberEmailChallenge(AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestVerifyMemberEmailChallenge() error = %v", err)
	}
	verifyChallengeRecord := findAuthChallengeByID(verifyChallengeState.Auth.Challenges, verifyChallenge.ID)
	if verifyChallengeRecord == nil {
		t.Fatalf("verify challenge missing from state")
	}
	s.mu.Lock()
	verifyChallengeRecord.ExpiresAt = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
	for index := range s.state.Auth.Challenges {
		if s.state.Auth.Challenges[index].ID == verifyChallenge.ID {
			s.state.Auth.Challenges[index] = *verifyChallengeRecord
			break
		}
	}
	s.mu.Unlock()

	if _, _, _, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID}); !errorsIs(err, ErrAuthChallengeExpired) {
		t.Fatalf("VerifyMemberEmail(expired challenge) error = %v, want %v", err, ErrAuthChallengeExpired)
	}

	_, verifyChallenge, err = s.RequestVerifyMemberEmailChallenge(AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestVerifyMemberEmailChallenge(retry) error = %v", err)
	}
	if _, _, _, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID}); err != nil {
		t.Fatalf("VerifyMemberEmail() error = %v", err)
	}
	if _, _, _, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID}); !errorsIs(err, ErrAuthChallengeConsumed) {
		t.Fatalf("VerifyMemberEmail(reused challenge) error = %v, want %v", err, ErrAuthChallengeConsumed)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner reauth) error = %v", err)
	}
	if _, _, _, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: "mina@openshock.dev", ChallengeID: verifyChallenge.ID}); !errorsIs(err, ErrAuthChallengeNotFound) {
		t.Fatalf("VerifyMemberEmail(cross-account replay) error = %v, want %v", err, ErrAuthChallengeNotFound)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	}); err != nil {
		t.Fatalf("LoginWithEmail(reviewer restore) error = %v", err)
	}
	_, authorizeChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(AuthRecoveryInput{DeviceID: reviewerSession.DeviceID})
	if err != nil {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge() error = %v", err)
	}
	if _, _, _, _, err := s.AuthorizeAuthDevice(AuthRecoveryInput{DeviceID: reviewerSession.DeviceID, ChallengeID: authorizeChallenge.ID}); err != nil {
		t.Fatalf("AuthorizeAuthDevice() error = %v", err)
	}
	if _, _, _, _, err := s.AuthorizeAuthDevice(AuthRecoveryInput{DeviceID: reviewerSession.DeviceID, ChallengeID: authorizeChallenge.ID}); !errorsIs(err, ErrAuthChallengeConsumed) {
		t.Fatalf("AuthorizeAuthDevice(reused challenge) error = %v, want %v", err, ErrAuthChallengeConsumed)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner second reauth) error = %v", err)
	}
	if _, _, _, _, err := s.AuthorizeAuthDevice(AuthRecoveryInput{
		Email:       "mina@openshock.dev",
		DeviceID:    reviewerSession.DeviceID,
		ChallengeID: authorizeChallenge.ID,
	}); !errorsIs(err, ErrAuthChallengeNotFound) {
		t.Fatalf("AuthorizeAuthDevice(cross-account replay) error = %v, want %v", err, ErrAuthChallengeNotFound)
	}
}

func TestWorkspaceMemberContractEnforcesOwnerRoleAndRetainsLastOwner(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}

	if _, _, err := s.UpdateWorkspaceMember("member-larkspur", WorkspaceMemberUpdateInput{Role: workspaceRoleMember}); !errorsIs(err, ErrWorkspaceMustRetainOwner) {
		t.Fatalf("UpdateWorkspaceMember(last owner) error = %v, want %v", err, ErrWorkspaceMustRetainOwner)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "mina@openshock.dev",
		DeviceLabel: "Mina Browser",
	}); err != nil {
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

func TestAuthRecoveryContractTracksVerifyDeviceResetAndIdentityBinding(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}

	_, invited, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  workspaceRoleViewer,
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}
	if _, _, err := s.UpdateWorkspaceMember(invited.ID, WorkspaceMemberUpdateInput{Status: workspaceMemberStatusActive}); !errorsIs(err, ErrWorkspaceMemberActivationBlocked) {
		t.Fatalf("UpdateWorkspaceMember(activate before recovery) error = %v, want %v", err, ErrWorkspaceMemberActivationBlocked)
	}

	loginState, session, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail() error = %v", err)
	}
	if session.EmailVerificationStatus != authEmailVerificationPending {
		t.Fatalf("session email verification status = %q, want %q", session.EmailVerificationStatus, authEmailVerificationPending)
	}
	if session.DeviceAuthStatus != authDeviceStatusPending {
		t.Fatalf("session device auth status = %q, want %q", session.DeviceAuthStatus, authDeviceStatusPending)
	}
	member := findWorkspaceMemberByEmail(loginState.Auth.Members, invited.Email)
	if member == nil || member.Status != workspaceMemberStatusInvited {
		t.Fatalf("member after login = %#v, want invited until recovery gates clear", member)
	}

	_, verifyChallenge, err := s.RequestVerifyMemberEmailChallenge(AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestVerifyMemberEmailChallenge() error = %v", err)
	}
	verifyState, verifiedSession, verifiedMember, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID})
	if err != nil {
		t.Fatalf("VerifyMemberEmail() error = %v", err)
	}
	if verifiedSession.EmailVerificationStatus != authEmailVerificationVerified || verifiedMember.EmailVerifiedAt == "" {
		t.Fatalf("verified session/member = %#v / %#v, want verified with timestamp", verifiedSession, verifiedMember)
	}
	member = findWorkspaceMemberByEmail(verifyState.Auth.Members, invited.Email)
	if member == nil || member.EmailVerificationStatus != authEmailVerificationVerified {
		t.Fatalf("verify state member = %#v, want verified", member)
	}
	if member.Status != workspaceMemberStatusInvited {
		t.Fatalf("member status after verify = %q, want %q until device authorized", member.Status, workspaceMemberStatusInvited)
	}

	_, authorizeChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(AuthRecoveryInput{DeviceID: verifiedSession.DeviceID})
	if err != nil {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge() error = %v", err)
	}
	deviceState, deviceSession, deviceMember, device, err := s.AuthorizeAuthDevice(AuthRecoveryInput{DeviceID: verifiedSession.DeviceID, ChallengeID: authorizeChallenge.ID})
	if err != nil {
		t.Fatalf("AuthorizeAuthDevice() error = %v", err)
	}
	if device.Status != authDeviceStatusAuthorized || deviceSession.DeviceAuthStatus != authDeviceStatusAuthorized {
		t.Fatalf("authorized device/session = %#v / %#v, want authorized", device, deviceSession)
	}
	if !containsString(deviceMember.TrustedDeviceIDs, device.ID) {
		t.Fatalf("trusted devices = %#v, want %q", deviceMember.TrustedDeviceIDs, device.ID)
	}
	if deviceMember.Status != workspaceMemberStatusInvited {
		t.Fatalf("device member status = %q, want %q until owner activation", deviceMember.Status, workspaceMemberStatusInvited)
	}
	if deviceState.Workspace.DeviceAuth != "browser-approved" {
		t.Fatalf("workspace device auth = %q, want browser-approved", deviceState.Workspace.DeviceAuth)
	}

	if _, _, _, err := s.RequestPasswordReset(AuthRecoveryInput{Email: invited.Email}); !errorsIs(err, ErrWorkspaceMemberApprovalRequired) {
		t.Fatalf("RequestPasswordReset(invited) error = %v, want %v", err, ErrWorkspaceMemberApprovalRequired)
	}
	if _, _, _, err := s.BindExternalIdentity(AuthRecoveryInput{
		Email:    invited.Email,
		Provider: "github",
		Handle:   "@reviewer",
	}); !errorsIs(err, ErrWorkspaceMemberApprovalRequired) {
		t.Fatalf("BindExternalIdentity(invited) error = %v, want %v", err, ErrWorkspaceMemberApprovalRequired)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner reauth) error = %v", err)
	}

	activatedState, activatedMember, err := s.UpdateWorkspaceMember(invited.ID, WorkspaceMemberUpdateInput{Status: workspaceMemberStatusActive})
	if err != nil {
		t.Fatalf("UpdateWorkspaceMember(activate invited) error = %v", err)
	}
	if activatedMember.Status != workspaceMemberStatusActive {
		t.Fatalf("activated member status = %q, want %q", activatedMember.Status, workspaceMemberStatusActive)
	}
	member = findWorkspaceMemberByEmail(activatedState.Auth.Members, invited.Email)
	if member == nil || member.Status != workspaceMemberStatusActive {
		t.Fatalf("activated state member = %#v, want active", member)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	}); err != nil {
		t.Fatalf("LoginWithEmail(invited after activation) error = %v", err)
	}

	resetState, resetMember, resetChallenge, err := s.RequestPasswordReset(AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestPasswordReset() error = %v", err)
	}
	if resetMember.PasswordResetStatus != authPasswordResetPending || resetMember.PasswordResetRequestedAt == "" {
		t.Fatalf("reset member = %#v, want pending reset", resetMember)
	}
	if resetState.Auth.Session.Status != authSessionStatusActive || resetState.Auth.Session.Email != invited.Email {
		t.Fatalf("reset state session = %#v, want active scoped session during recovery start", resetState.Auth.Session)
	}
	if resetChallenge.Kind != authChallengeKindPasswordReset || resetChallenge.ID == "" || resetChallenge.Status != authChallengeStatusPending {
		t.Fatalf("reset challenge = %#v, want pending password reset challenge", resetChallenge)
	}
	member = findWorkspaceMemberByEmail(resetState.Auth.Members, invited.Email)
	if member == nil || member.PasswordResetStatus != authPasswordResetPending {
		t.Fatalf("reset state member = %#v, want pending reset", member)
	}
	if _, _, err := s.LogoutAuthSession(); err != nil {
		t.Fatalf("LogoutAuthSession(before complete reset) error = %v", err)
	}

	recoveredState, recoveredSession, recoveredMember, err := s.CompletePasswordReset(AuthRecoveryInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Laptop",
		ChallengeID: resetChallenge.ID,
	})
	if err != nil {
		t.Fatalf("CompletePasswordReset() error = %v", err)
	}
	if recoveredSession.AuthMethod != "password-reset" || recoveredSession.DeviceLabel != "Reviewer Laptop" {
		t.Fatalf("recovered session = %#v, want password-reset on Reviewer Laptop", recoveredSession)
	}
	if recoveredSession.MemberStatus != workspaceMemberStatusActive {
		t.Fatalf("recovered session member status = %q, want %q", recoveredSession.MemberStatus, workspaceMemberStatusActive)
	}
	if recoveredSession.DeviceAuthStatus != authDeviceStatusAuthorized || recoveredSession.RecoveryStatus != authRecoveryStatusRecovered {
		t.Fatalf("recovered session = %#v, want authorized recovered session", recoveredSession)
	}
	if recoveredMember.PasswordResetStatus != authPasswordResetCompleted || recoveredMember.PasswordResetCompletedAt == "" {
		t.Fatalf("recovered member = %#v, want completed reset", recoveredMember)
	}
	member = findWorkspaceMemberByEmail(recoveredState.Auth.Members, invited.Email)
	if member == nil || member.PasswordResetStatus != authPasswordResetCompleted {
		t.Fatalf("recovered state member = %#v, want completed reset", member)
	}
	if challenge := findAuthChallengeByID(recoveredState.Auth.Challenges, resetChallenge.ID); challenge == nil || challenge.Status != authChallengeStatusConsumed || challenge.ConsumedAt == "" {
		t.Fatalf("recovered state challenge = %#v, want consumed challenge", challenge)
	}
	if _, _, _, err := s.CompletePasswordReset(AuthRecoveryInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Laptop",
		ChallengeID: resetChallenge.ID,
	}); !errorsIs(err, ErrAuthChallengeConsumed) {
		t.Fatalf("CompletePasswordReset(reused challenge) error = %v, want %v", err, ErrAuthChallengeConsumed)
	}

	boundState, boundSession, boundMember, err := s.BindExternalIdentity(AuthRecoveryInput{
		Email:    invited.Email,
		Provider: "github",
		Handle:   "@reviewer",
	})
	if err != nil {
		t.Fatalf("BindExternalIdentity() error = %v", err)
	}
	if len(boundSession.LinkedIdentities) != 1 || boundSession.LinkedIdentities[0].Provider != "github" {
		t.Fatalf("bound session identities = %#v, want github binding", boundSession.LinkedIdentities)
	}
	member = findWorkspaceMemberByEmail(boundState.Auth.Members, invited.Email)
	if member == nil || len(boundMember.LinkedIdentities) != 1 || member.LinkedIdentities[0].Handle != "@reviewer" {
		t.Fatalf("bound member = %#v / state member = %#v, want @reviewer binding", boundMember, member)
	}
}

func TestAuthRecoveryContractFailsClosedForSignedOutAndUnknownDevice(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}

	_, invited, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  workspaceRoleMember,
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	}); err != nil {
		t.Fatalf("LoginWithEmail() error = %v", err)
	}

	_, authorizeChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(AuthRecoveryInput{Email: invited.Email, DeviceID: "device-missing"})
	if !errorsIs(err, ErrAuthDeviceNotFound) {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge(missing device) error = %v, want %v", err, ErrAuthDeviceNotFound)
	}
	if authorizeChallenge.ID != "" {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge(missing device) challenge = %#v, want empty", authorizeChallenge)
	}

	if _, _, _, _, err := s.AuthorizeAuthDevice(AuthRecoveryInput{Email: invited.Email, DeviceID: "device-missing", ChallengeID: "challenge-missing"}); !errorsIs(err, ErrAuthChallengeNotFound) {
		t.Fatalf("AuthorizeAuthDevice(missing challenge) error = %v, want %v", err, ErrAuthChallengeNotFound)
	}

	if _, _, err := s.LogoutAuthSession(); err != nil {
		t.Fatalf("LogoutAuthSession() error = %v", err)
	}

	if _, _, err := s.RequestVerifyMemberEmailChallenge(AuthRecoveryInput{Email: invited.Email}); !errorsIs(err, ErrAuthSessionRequired) {
		t.Fatalf("RequestVerifyMemberEmailChallenge(signed out) error = %v, want %v", err, ErrAuthSessionRequired)
	}

	if _, _, _, err := s.CompletePasswordReset(AuthRecoveryInput{Email: invited.Email, DeviceLabel: "Reviewer Laptop"}); !errorsIs(err, ErrAuthChallengeRequired) {
		t.Fatalf("CompletePasswordReset(missing challenge) error = %v, want %v", err, ErrAuthChallengeRequired)
	}
}

func TestSignedOutActiveMemberCannotRequestPasswordReset(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}

	_, invited, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  workspaceRoleMember,
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}

	_, session, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(reviewer phone) error = %v", err)
	}
	_, verifyChallenge, err := s.RequestVerifyMemberEmailChallenge(AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestVerifyMemberEmailChallenge() error = %v", err)
	}
	if _, _, _, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID}); err != nil {
		t.Fatalf("VerifyMemberEmail() error = %v", err)
	}
	_, authorizeChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(AuthRecoveryInput{DeviceID: session.DeviceID})
	if err != nil {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge() error = %v", err)
	}
	if _, _, _, _, err := s.AuthorizeAuthDevice(AuthRecoveryInput{DeviceID: session.DeviceID, ChallengeID: authorizeChallenge.ID}); err != nil {
		t.Fatalf("AuthorizeAuthDevice() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner reauth) error = %v", err)
	}
	if _, _, err := s.UpdateWorkspaceMember(invited.ID, WorkspaceMemberUpdateInput{Status: workspaceMemberStatusActive}); err != nil {
		t.Fatalf("UpdateWorkspaceMember(activate invited) error = %v", err)
	}

	if _, _, err := s.LogoutAuthSession(); err != nil {
		t.Fatalf("LogoutAuthSession() error = %v", err)
	}

	if _, _, _, err := s.RequestPasswordReset(AuthRecoveryInput{Email: invited.Email}); !errorsIs(err, ErrAuthSessionRequired) {
		t.Fatalf("RequestPasswordReset(signed out) error = %v, want %v", err, ErrAuthSessionRequired)
	}
}

func TestActiveManagedMemberRequiresApprovedDeviceForDirectLogin(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}

	_, invited, err := s.InviteWorkspaceMember(WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  workspaceRoleMember,
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}

	_, session, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(reviewer phone) error = %v", err)
	}
	_, verifyChallenge, err := s.RequestVerifyMemberEmailChallenge(AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestVerifyMemberEmailChallenge() error = %v", err)
	}
	if _, _, _, err := s.VerifyMemberEmail(AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID}); err != nil {
		t.Fatalf("VerifyMemberEmail() error = %v", err)
	}
	_, authorizeChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(AuthRecoveryInput{DeviceID: session.DeviceID})
	if err != nil {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge() error = %v", err)
	}
	if _, _, _, _, err := s.AuthorizeAuthDevice(AuthRecoveryInput{DeviceID: session.DeviceID, ChallengeID: authorizeChallenge.ID}); err != nil {
		t.Fatalf("AuthorizeAuthDevice() error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner reauth) error = %v", err)
	}
	if _, _, err := s.UpdateWorkspaceMember(invited.ID, WorkspaceMemberUpdateInput{Status: workspaceMemberStatusActive}); err != nil {
		t.Fatalf("UpdateWorkspaceMember(activate invited) error = %v", err)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Laptop",
	}); !errorsIs(err, ErrAuthTrustedDeviceRequired) {
		t.Fatalf("LoginWithEmail(reviewer laptop) error = %v, want %v", err, ErrAuthTrustedDeviceRequired)
	}

	snapshot := s.Snapshot()
	pendingDevice := findAuthDeviceByMemberAndLabel(snapshot.Auth.Devices, invited.ID, "Reviewer Laptop")
	if pendingDevice == nil || pendingDevice.Status != authDeviceStatusPending {
		t.Fatalf("pending device after blocked direct login = %#v, want pending laptop device", pendingDevice)
	}

	if _, _, err := s.LoginWithEmail(AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner approve laptop) error = %v", err)
	}
	_, approveLaptopChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(AuthRecoveryInput{
		MemberID:    invited.ID,
		DeviceLabel: "Reviewer Laptop",
	})
	if err != nil {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge(owner laptop approval) error = %v", err)
	}
	if _, _, _, approvedDevice, err := s.AuthorizeAuthDevice(AuthRecoveryInput{
		MemberID:    invited.ID,
		DeviceLabel: "Reviewer Laptop",
		ChallengeID: approveLaptopChallenge.ID,
	}); err != nil {
		t.Fatalf("AuthorizeAuthDevice(owner laptop approval) error = %v", err)
	} else if approvedDevice.Status != authDeviceStatusAuthorized {
		t.Fatalf("approved laptop device = %#v, want authorized", approvedDevice)
	}

	_, directSession, err := s.LoginWithEmail(AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Laptop",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(reviewer laptop after approval) error = %v", err)
	}
	if directSession.DeviceLabel != "Reviewer Laptop" || directSession.DeviceAuthStatus != authDeviceStatusAuthorized {
		t.Fatalf("direct session after approval = %#v, want authorized laptop session", directSession)
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

func findAuthChallengeByID(items []AuthChallenge, challengeID string) *AuthChallenge {
	for index := range items {
		if items[index].ID == challengeID {
			return &items[index]
		}
	}
	return nil
}

func findAuthDeviceByMemberAndLabel(items []AuthDevice, memberID, label string) *AuthDevice {
	for index := range items {
		if items[index].MemberID == memberID && items[index].Label == label {
			return &items[index]
		}
	}
	return nil
}

func errorsIs(err, target error) bool {
	return err != nil && target != nil && err.Error() == target.Error()
}
