package store

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	authSessionStatusActive    = "active"
	authSessionStatusSignedOut = "signed_out"

	authEmailVerificationPending  = "pending"
	authEmailVerificationVerified = "verified"

	authPasswordResetIdle      = "idle"
	authPasswordResetPending   = "pending"
	authPasswordResetCompleted = "completed"

	authRecoveryStatusReady                  = "ready"
	authRecoveryStatusVerificationRequired   = "verification_required"
	authRecoveryStatusDeviceApprovalRequired = "device_approval_required"
	authRecoveryStatusPasswordResetPending   = "reset_pending"
	authRecoveryStatusRecovered              = "recovered"

	authDeviceStatusPending    = "pending"
	authDeviceStatusAuthorized = "authorized"

	workspaceMemberStatusActive    = "active"
	workspaceMemberStatusInvited   = "invited"
	workspaceMemberStatusSuspended = "suspended"

	workspaceRoleOwner  = "owner"
	workspaceRoleMember = "member"
	workspaceRoleViewer = "viewer"
)

var (
	ErrAuthEmailRequired            = errors.New("email is required")
	ErrAuthSessionRequired          = errors.New("auth session required")
	ErrAuthDeviceRequired           = errors.New("device id or label is required")
	ErrAuthDeviceNotFound           = errors.New("auth device not found")
	ErrAuthIdentityProviderRequired = errors.New("external identity provider is required")
	ErrAuthIdentityHandleRequired   = errors.New("external identity handle is required")
	ErrWorkspaceMemberNotFound      = errors.New("workspace member not found")
	ErrWorkspaceMemberExists        = errors.New("workspace member already exists")
	ErrWorkspaceRoleInvalid         = errors.New("workspace role is invalid")
	ErrWorkspaceMemberStatusInvalid = errors.New("workspace member status is invalid")
	ErrWorkspaceRoleForbidden       = errors.New("current role cannot manage workspace members")
	ErrWorkspaceMemberSuspended     = errors.New("workspace member is suspended")
	ErrWorkspaceMustRetainOwner     = errors.New("workspace must retain at least one owner")
)

type AuthLoginInput struct {
	Email       string
	Name        string
	DeviceID    string
	DeviceLabel string
	AuthMethod  string
}

type AuthRecoveryInput struct {
	Email       string
	MemberID    string
	DeviceID    string
	DeviceLabel string
	Provider    string
	Handle      string
}

type WorkspaceMemberUpsertInput struct {
	Email string
	Name  string
	Role  string
}

type WorkspaceMemberUpdateInput struct {
	Role   string
	Status string
}

func defaultAuthSnapshot(now string) AuthSnapshot {
	members := []WorkspaceMember{
		newWorkspaceMember("member-larkspur", "larkspur@openshock.dev", "Larkspur", workspaceRoleOwner, workspaceMemberStatusActive, "seed", now, now),
		newWorkspaceMember("member-mina", "mina@openshock.dev", "Mina", workspaceRoleMember, workspaceMemberStatusActive, "seed", now, now),
		newWorkspaceMember("member-longwen", "longwen@openshock.dev", "Longwen", workspaceRoleViewer, workspaceMemberStatusActive, "seed", now, now),
	}
	devices := []AuthDevice{
		newAuthDevice(members[0].ID, "Owner Browser", authDeviceStatusAuthorized, now, now, now),
		newAuthDevice(members[1].ID, "Mina Browser", authDeviceStatusAuthorized, now, now, now),
		newAuthDevice(members[2].ID, "Longwen Browser", authDeviceStatusAuthorized, now, now, now),
	}
	for index := range members {
		members[index].TrustedDeviceIDs = []string{devices[index].ID}
	}

	session := authSessionFromMember(members[0], now)
	session = hydrateSessionWithDevice(session, devices[0], "email-link")

	return AuthSnapshot{
		Session: session,
		Roles:   defaultWorkspaceRoles(),
		Members: members,
		Devices: devices,
	}
}

func defaultWorkspaceRoles() []WorkspaceRole {
	return []WorkspaceRole{
		{
			ID:          workspaceRoleOwner,
			Label:       "Owner",
			Summary:     "可以管理 workspace、成员、repo/runtime 绑定，并批准或合并关键动作。",
			Permissions: permissionsForRole(workspaceRoleOwner),
		},
		{
			ID:          workspaceRoleMember,
			Label:       "Member",
			Summary:     "可以参与 issue / room / run / review，但不能改 roster 或 workspace 级配置。",
			Permissions: permissionsForRole(workspaceRoleMember),
		},
		{
			ID:          workspaceRoleViewer,
			Label:       "Viewer",
			Summary:     "只读查看控制面和历史真值，不做破坏性变更。",
			Permissions: permissionsForRole(workspaceRoleViewer),
		},
	}
}

func permissionsForRole(role string) []string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case workspaceRoleOwner:
		return []string{
			"workspace.manage",
			"members.manage",
			"repo.admin",
			"runtime.manage",
			"issue.create",
			"room.reply",
			"run.execute",
			"inbox.review",
			"inbox.decide",
			"memory.read",
			"memory.write",
			"pull_request.read",
			"pull_request.review",
			"pull_request.merge",
		}
	case workspaceRoleMember:
		return []string{
			"issue.create",
			"room.reply",
			"run.execute",
			"inbox.review",
			"memory.read",
			"pull_request.read",
			"pull_request.review",
		}
	default:
		return []string{
			"room.read",
			"run.read",
			"inbox.read",
			"memory.read",
			"pull_request.read",
		}
	}
}

func newWorkspaceMember(id, email, name, role, status, source, addedAt, lastSeenAt string) WorkspaceMember {
	verificationStatus := authEmailVerificationVerified
	verifiedAt := addedAt
	if status == workspaceMemberStatusInvited {
		verificationStatus = authEmailVerificationPending
		verifiedAt = ""
	}

	return WorkspaceMember{
		ID:                      id,
		Email:                   normalizeEmail(email),
		Name:                    strings.TrimSpace(name),
		Role:                    role,
		Status:                  status,
		Source:                  source,
		AddedAt:                 addedAt,
		LastSeenAt:              lastSeenAt,
		RecoveryEmail:           normalizeEmail(email),
		EmailVerificationStatus: verificationStatus,
		EmailVerifiedAt:         verifiedAt,
		PasswordResetStatus:     authPasswordResetIdle,
		RecoveryStatus:          deriveMemberRecoveryStatus(verificationStatus, authPasswordResetIdle),
		GitHubIdentity:          AuthExternalIdentity{},
		Preferences:             defaultWorkspaceMemberPreferences(),
		LinkedIdentities:        []AuthExternalIdentity{},
		TrustedDeviceIDs:        []string{},
		Permissions:             permissionsForRole(role),
	}
}

func authSessionFromMember(member WorkspaceMember, signedInAt string) AuthSession {
	return AuthSession{
		ID:                       "auth-session-current",
		MemberID:                 member.ID,
		Email:                    member.Email,
		Name:                     member.Name,
		Role:                     member.Role,
		Status:                   authSessionStatusActive,
		AuthMethod:               "email-link",
		SignedInAt:               signedInAt,
		LastSeenAt:               member.LastSeenAt,
		EmailVerificationStatus:  member.EmailVerificationStatus,
		EmailVerifiedAt:          member.EmailVerifiedAt,
		PasswordResetStatus:      member.PasswordResetStatus,
		PasswordResetRequestedAt: member.PasswordResetRequestedAt,
		PasswordResetCompletedAt: member.PasswordResetCompletedAt,
		RecoveryStatus:           member.RecoveryStatus,
		GitHubIdentity:           member.GitHubIdentity,
		Preferences:              member.Preferences,
		LinkedIdentities:         append([]AuthExternalIdentity{}, member.LinkedIdentities...),
		Permissions:              append([]string{}, member.Permissions...),
	}
}

func newAuthDevice(memberID, label, status, requestedAt, authorizedAt, lastSeenAt string) AuthDevice {
	return AuthDevice{
		ID:           "device-" + slugify(memberID+"-"+label),
		MemberID:     memberID,
		Label:        defaultAuthDeviceLabel(label),
		Status:       status,
		RequestedAt:  requestedAt,
		AuthorizedAt: authorizedAt,
		LastSeenAt:   lastSeenAt,
	}
}

func signedOutAuthSession() AuthSession {
	return AuthSession{
		ID:          "auth-session-current",
		Status:      authSessionStatusSignedOut,
		Permissions: []string{},
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func defaultAuthDeviceLabel(label string) string {
	if strings.TrimSpace(label) == "" {
		return "Current Browser"
	}
	return strings.TrimSpace(label)
}

func workspaceDeviceAuthLabel(status string) string {
	switch status {
	case authDeviceStatusAuthorized:
		return "browser-approved"
	case authDeviceStatusPending:
		return "pending-approval"
	default:
		return "未授权"
	}
}

func deriveMemberRecoveryStatus(verificationStatus, passwordResetStatus string) string {
	switch {
	case passwordResetStatus == authPasswordResetPending:
		return authRecoveryStatusPasswordResetPending
	case verificationStatus != authEmailVerificationVerified:
		return authRecoveryStatusVerificationRequired
	default:
		return authRecoveryStatusReady
	}
}

func deriveSessionRecoveryStatus(member WorkspaceMember, deviceStatus, authMethod string) string {
	switch {
	case authMethod == "password-reset":
		return authRecoveryStatusRecovered
	case member.PasswordResetStatus == authPasswordResetPending:
		return authRecoveryStatusPasswordResetPending
	case member.EmailVerificationStatus != authEmailVerificationVerified:
		return authRecoveryStatusVerificationRequired
	case deviceStatus != authDeviceStatusAuthorized:
		return authRecoveryStatusDeviceApprovalRequired
	default:
		return authRecoveryStatusReady
	}
}

func hydrateSessionWithDevice(session AuthSession, device AuthDevice, authMethod string) AuthSession {
	session.AuthMethod = defaultString(strings.TrimSpace(authMethod), session.AuthMethod)
	session.DeviceID = device.ID
	session.DeviceLabel = device.Label
	session.DeviceAuthStatus = device.Status
	session.RecoveryStatus = deriveSessionRecoveryStatus(
		WorkspaceMember{
			EmailVerificationStatus: session.EmailVerificationStatus,
			PasswordResetStatus:     session.PasswordResetStatus,
		},
		device.Status,
		session.AuthMethod,
	)
	return session
}

func (s *Store) ensureAuthDevicesLocked(now string) {
	if s.state.Auth.Devices == nil {
		s.state.Auth.Devices = []AuthDevice{}
	}
	for index := range s.state.Auth.Members {
		member := s.state.Auth.Members[index]
		if len(member.TrustedDeviceIDs) == 0 && member.Status == workspaceMemberStatusActive {
			device := newAuthDevice(member.ID, member.Name+" Browser", authDeviceStatusAuthorized, now, now, defaultString(member.LastSeenAt, now))
			if s.findAuthDeviceByIDLocked(device.ID) == -1 {
				s.state.Auth.Devices = append(s.state.Auth.Devices, device)
			}
			s.state.Auth.Members[index].TrustedDeviceIDs = appendUniqueString(s.state.Auth.Members[index].TrustedDeviceIDs, device.ID)
		}
	}
}

func (s *Store) findAuthDeviceByIDLocked(deviceID string) int {
	for index := range s.state.Auth.Devices {
		if s.state.Auth.Devices[index].ID == deviceID {
			return index
		}
	}
	return -1
}

func (s *Store) findAuthDeviceByMemberAndLabelLocked(memberID, label string) int {
	label = defaultAuthDeviceLabel(label)
	for index := range s.state.Auth.Devices {
		if s.state.Auth.Devices[index].MemberID == memberID && s.state.Auth.Devices[index].Label == label {
			return index
		}
	}
	return -1
}

func (s *Store) currentAuthDeviceLocked() (AuthDevice, bool) {
	session := s.state.Auth.Session
	if strings.TrimSpace(session.DeviceID) != "" {
		if index := s.findAuthDeviceByIDLocked(session.DeviceID); index != -1 {
			return s.state.Auth.Devices[index], true
		}
	}
	if strings.TrimSpace(session.MemberID) != "" && strings.TrimSpace(session.DeviceLabel) != "" {
		if index := s.findAuthDeviceByMemberAndLabelLocked(session.MemberID, session.DeviceLabel); index != -1 {
			return s.state.Auth.Devices[index], true
		}
	}
	return AuthDevice{}, false
}

func (s *Store) upsertAuthDeviceLocked(memberID, deviceID, label, now string, authorize bool) AuthDevice {
	if strings.TrimSpace(deviceID) != "" {
		if index := s.findAuthDeviceByIDLocked(deviceID); index != -1 {
			device := s.state.Auth.Devices[index]
			device.LastSeenAt = now
			if authorize {
				device.Status = authDeviceStatusAuthorized
				device.AuthorizedAt = now
			}
			s.state.Auth.Devices[index] = device
			return device
		}
	}

	if index := s.findAuthDeviceByMemberAndLabelLocked(memberID, label); index != -1 {
		device := s.state.Auth.Devices[index]
		device.LastSeenAt = now
		if authorize {
			device.Status = authDeviceStatusAuthorized
			device.AuthorizedAt = now
		}
		s.state.Auth.Devices[index] = device
		return device
	}

	status := authDeviceStatusPending
	authorizedAt := ""
	if authorize {
		status = authDeviceStatusAuthorized
		authorizedAt = now
	}

	device := newAuthDevice(memberID, label, status, now, authorizedAt, now)
	s.state.Auth.Devices = append(s.state.Auth.Devices, device)
	return device
}

func appendUniqueString(items []string, candidate string) []string {
	for _, item := range items {
		if item == candidate {
			return items
		}
	}
	return append(items, candidate)
}

func normalizeWorkspaceRole(role string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case workspaceRoleOwner:
		return workspaceRoleOwner, nil
	case workspaceRoleMember:
		return workspaceRoleMember, nil
	case workspaceRoleViewer:
		return workspaceRoleViewer, nil
	default:
		return "", ErrWorkspaceRoleInvalid
	}
}

func normalizeWorkspaceMemberStatus(status string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case workspaceMemberStatusActive:
		return workspaceMemberStatusActive, nil
	case workspaceMemberStatusInvited:
		return workspaceMemberStatusInvited, nil
	case workspaceMemberStatusSuspended:
		return workspaceMemberStatusSuspended, nil
	default:
		return "", ErrWorkspaceMemberStatusInvalid
	}
}

func defaultWorkspaceMemberName(email string) string {
	local := strings.TrimSpace(strings.Split(normalizeEmail(email), "@")[0])
	if local == "" {
		return "Workspace Member"
	}
	return strings.ToUpper(local[:1]) + local[1:]
}

func (s *Store) ensureAuthConsistency() {
	now := time.Now().UTC().Format(time.RFC3339)
	defaults := defaultAuthSnapshot(now)

	if len(s.state.Auth.Roles) == 0 {
		s.state.Auth.Roles = defaults.Roles
	}
	if len(s.state.Auth.Members) == 0 {
		s.state.Auth.Members = defaults.Members
	}

	for index := range s.state.Auth.Members {
		role, err := normalizeWorkspaceRole(s.state.Auth.Members[index].Role)
		if err != nil {
			role = workspaceRoleViewer
		}
		s.state.Auth.Members[index].Role = role
		status, err := normalizeWorkspaceMemberStatus(s.state.Auth.Members[index].Status)
		if err != nil {
			status = workspaceMemberStatusActive
		}
		s.state.Auth.Members[index].Status = status
		s.state.Auth.Members[index].Email = normalizeEmail(s.state.Auth.Members[index].Email)
		if strings.TrimSpace(s.state.Auth.Members[index].ID) == "" {
			s.state.Auth.Members[index].ID = "member-" + slugify(s.state.Auth.Members[index].Email)
		}
		if strings.TrimSpace(s.state.Auth.Members[index].Name) == "" {
			s.state.Auth.Members[index].Name = defaultWorkspaceMemberName(s.state.Auth.Members[index].Email)
		}
		if strings.TrimSpace(s.state.Auth.Members[index].AddedAt) == "" {
			s.state.Auth.Members[index].AddedAt = now
		}
		if strings.TrimSpace(s.state.Auth.Members[index].RecoveryEmail) == "" {
			s.state.Auth.Members[index].RecoveryEmail = s.state.Auth.Members[index].Email
		}
		if strings.TrimSpace(s.state.Auth.Members[index].EmailVerificationStatus) == "" {
			if s.state.Auth.Members[index].Status == workspaceMemberStatusInvited {
				s.state.Auth.Members[index].EmailVerificationStatus = authEmailVerificationPending
			} else {
				s.state.Auth.Members[index].EmailVerificationStatus = authEmailVerificationVerified
			}
		}
		if s.state.Auth.Members[index].EmailVerificationStatus == authEmailVerificationVerified && strings.TrimSpace(s.state.Auth.Members[index].EmailVerifiedAt) == "" {
			s.state.Auth.Members[index].EmailVerifiedAt = defaultString(s.state.Auth.Members[index].AddedAt, now)
		}
		if strings.TrimSpace(s.state.Auth.Members[index].PasswordResetStatus) == "" {
			s.state.Auth.Members[index].PasswordResetStatus = authPasswordResetIdle
		}
		if strings.TrimSpace(s.state.Auth.Members[index].RecoveryStatus) == "" {
			s.state.Auth.Members[index].RecoveryStatus = deriveMemberRecoveryStatus(
				s.state.Auth.Members[index].EmailVerificationStatus,
				s.state.Auth.Members[index].PasswordResetStatus,
			)
		}
		if s.state.Auth.Members[index].LinkedIdentities == nil {
			s.state.Auth.Members[index].LinkedIdentities = []AuthExternalIdentity{}
		}
		if s.state.Auth.Members[index].TrustedDeviceIDs == nil {
			s.state.Auth.Members[index].TrustedDeviceIDs = []string{}
		}
		syncWorkspaceMemberDefaults(&s.state.Auth.Members[index])
		s.state.Auth.Members[index].Permissions = permissionsForRole(role)
	}
	s.sortWorkspaceMembersLocked()
	s.ensureAuthDevicesLocked(now)

	if strings.TrimSpace(s.state.Auth.Session.Status) == "" &&
		strings.TrimSpace(s.state.Auth.Session.Email) == "" &&
		strings.TrimSpace(s.state.Auth.Session.MemberID) == "" {
		s.state.Auth.Session = defaults.Session
		s.state.Workspace.DeviceAuth = workspaceDeviceAuthLabel(defaults.Session.DeviceAuthStatus)
		return
	}

	s.refreshAuthSessionLocked()
}

func (s *Store) AuthSnapshot() AuthSnapshot {
	return s.Snapshot().Auth
}

func (s *Store) WorkspaceMember(memberID string) (WorkspaceMember, bool) {
	snapshot := s.Snapshot()
	for _, member := range snapshot.Auth.Members {
		if member.ID == memberID {
			return member, true
		}
	}
	return WorkspaceMember{}, false
}

func (s *Store) loginWithEmailLocked(input AuthLoginInput, now string) (WorkspaceMember, AuthSession, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return WorkspaceMember{}, AuthSession{}, ErrAuthEmailRequired
	}

	index := s.findWorkspaceMemberByEmailLocked(email)
	if index == -1 {
		return WorkspaceMember{}, AuthSession{}, ErrWorkspaceMemberNotFound
	}
	member := s.state.Auth.Members[index]
	if member.Status == workspaceMemberStatusSuspended {
		return WorkspaceMember{}, AuthSession{}, ErrWorkspaceMemberSuspended
	}
	if member.Status == workspaceMemberStatusInvited {
		member.Status = workspaceMemberStatusActive
	}
	if name := strings.TrimSpace(input.Name); name != "" {
		member.Name = name
	}
	member.LastSeenAt = now
	member.Permissions = permissionsForRole(member.Role)
	authMethod := defaultString(strings.TrimSpace(input.AuthMethod), "email-link")
	device := s.upsertAuthDeviceLocked(member.ID, input.DeviceID, input.DeviceLabel, now, authMethod == "password-reset")
	if authMethod == "password-reset" {
		member.PasswordResetStatus = authPasswordResetCompleted
		member.PasswordResetCompletedAt = now
		member.TrustedDeviceIDs = appendUniqueString(member.TrustedDeviceIDs, device.ID)
	}
	member.RecoveryStatus = deriveMemberRecoveryStatus(member.EmailVerificationStatus, member.PasswordResetStatus)
	s.state.Auth.Members[index] = member
	session := authSessionFromMember(member, now)
	session = hydrateSessionWithDevice(session, device, authMethod)
	session.RecoveryStatus = deriveSessionRecoveryStatus(member, device.Status, session.AuthMethod)
	s.state.Auth.Session = session
	s.state.Workspace.DeviceAuth = workspaceDeviceAuthLabel(device.Status)
	s.sortWorkspaceMembersLocked()

	return member, session, nil
}

func (s *Store) LoginWithEmail(input AuthLoginInput) (State, AuthSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	_, session, err := s.loginWithEmailLocked(input, now)
	if err != nil {
		return State{}, AuthSession{}, err
	}

	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, err
	}
	return cloneState(s.state), session, nil
}

func (s *Store) LogoutAuthSession() (State, AuthSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.state.Auth.Session = signedOutAuthSession()
	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, err
	}
	return cloneState(s.state), s.state.Auth.Session, nil
}

func (s *Store) InviteWorkspaceMember(input WorkspaceMemberUpsertInput) (State, WorkspaceMember, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return State{}, WorkspaceMember{}, ErrAuthEmailRequired
	}
	role, err := normalizeWorkspaceRole(input.Role)
	if err != nil {
		return State{}, WorkspaceMember{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.requireWorkspaceMemberPermissionLocked("members.manage"); err != nil {
		return State{}, WorkspaceMember{}, err
	}
	if s.findWorkspaceMemberByEmailLocked(email) != -1 {
		return State{}, WorkspaceMember{}, ErrWorkspaceMemberExists
	}

	now := time.Now().UTC().Format(time.RFC3339)
	member := newWorkspaceMember(
		"member-"+slugify(email),
		email,
		defaultString(strings.TrimSpace(input.Name), defaultWorkspaceMemberName(email)),
		role,
		workspaceMemberStatusInvited,
		"owner-invite",
		now,
		"",
	)
	s.state.Auth.Members = append(s.state.Auth.Members, member)
	s.sortWorkspaceMembersLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), member, nil
}

func (s *Store) UpdateWorkspaceMember(memberID string, input WorkspaceMemberUpdateInput) (State, WorkspaceMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.requireWorkspaceMemberPermissionLocked("members.manage"); err != nil {
		return State{}, WorkspaceMember{}, err
	}

	index := s.findWorkspaceMemberByIDLocked(memberID)
	if index == -1 {
		return State{}, WorkspaceMember{}, ErrWorkspaceMemberNotFound
	}

	member := s.state.Auth.Members[index]
	role := member.Role
	status := member.Status
	var err error
	if strings.TrimSpace(input.Role) != "" {
		role, err = normalizeWorkspaceRole(input.Role)
		if err != nil {
			return State{}, WorkspaceMember{}, err
		}
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err = normalizeWorkspaceMemberStatus(input.Status)
		if err != nil {
			return State{}, WorkspaceMember{}, err
		}
	}

	if member.Role == workspaceRoleOwner && (role != workspaceRoleOwner || status != workspaceMemberStatusActive) && s.activeWorkspaceOwnerCountLocked() == 1 {
		return State{}, WorkspaceMember{}, ErrWorkspaceMustRetainOwner
	}

	member.Role = role
	member.Status = status
	member.Permissions = permissionsForRole(role)
	member.RecoveryStatus = deriveMemberRecoveryStatus(member.EmailVerificationStatus, member.PasswordResetStatus)
	s.state.Auth.Members[index] = member
	s.refreshAuthSessionLocked()
	s.sortWorkspaceMembersLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), member, nil
}

func (s *Store) VerifyMemberEmail(input AuthRecoveryInput) (State, AuthSession, WorkspaceMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(s.state.Auth.Session.Status) != authSessionStatusActive {
		return State{}, AuthSession{}, WorkspaceMember{}, ErrAuthSessionRequired
	}

	memberIndex, err := s.findWorkspaceMemberForRecoveryLocked(input)
	if err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	member := s.state.Auth.Members[memberIndex]
	member.EmailVerificationStatus = authEmailVerificationVerified
	member.EmailVerifiedAt = now
	member.RecoveryStatus = deriveMemberRecoveryStatus(member.EmailVerificationStatus, member.PasswordResetStatus)
	s.state.Auth.Members[memberIndex] = member
	s.refreshAuthSessionLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), s.state.Auth.Session, member, nil
}

func (s *Store) AuthorizeAuthDevice(input AuthRecoveryInput) (State, AuthSession, WorkspaceMember, AuthDevice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(s.state.Auth.Session.Status) != authSessionStatusActive {
		return State{}, AuthSession{}, WorkspaceMember{}, AuthDevice{}, ErrAuthSessionRequired
	}

	memberIndex, err := s.findWorkspaceMemberForRecoveryLocked(input)
	if err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, AuthDevice{}, err
	}

	deviceID := strings.TrimSpace(input.DeviceID)
	if deviceID == "" {
		deviceID = strings.TrimSpace(s.state.Auth.Session.DeviceID)
	}
	if deviceID == "" && strings.TrimSpace(input.DeviceLabel) != "" {
		if index := s.findAuthDeviceByMemberAndLabelLocked(s.state.Auth.Members[memberIndex].ID, input.DeviceLabel); index != -1 {
			deviceID = s.state.Auth.Devices[index].ID
		}
	}
	if deviceID == "" {
		return State{}, AuthSession{}, WorkspaceMember{}, AuthDevice{}, ErrAuthDeviceRequired
	}

	deviceIndex := s.findAuthDeviceByIDLocked(deviceID)
	if deviceIndex == -1 {
		return State{}, AuthSession{}, WorkspaceMember{}, AuthDevice{}, ErrAuthDeviceNotFound
	}

	now := time.Now().UTC().Format(time.RFC3339)
	device := s.state.Auth.Devices[deviceIndex]
	device.Status = authDeviceStatusAuthorized
	device.AuthorizedAt = now
	device.LastSeenAt = now
	s.state.Auth.Devices[deviceIndex] = device

	member := s.state.Auth.Members[memberIndex]
	member.TrustedDeviceIDs = appendUniqueString(member.TrustedDeviceIDs, device.ID)
	member.RecoveryStatus = deriveMemberRecoveryStatus(member.EmailVerificationStatus, member.PasswordResetStatus)
	s.state.Auth.Members[memberIndex] = member
	s.refreshAuthSessionLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, AuthDevice{}, err
	}
	return cloneState(s.state), s.state.Auth.Session, member, device, nil
}

func (s *Store) RequestPasswordReset(input AuthRecoveryInput) (State, WorkspaceMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	memberIndex, err := s.findWorkspaceMemberForRecoveryLocked(input)
	if err != nil {
		return State{}, WorkspaceMember{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	member := s.state.Auth.Members[memberIndex]
	member.PasswordResetStatus = authPasswordResetPending
	member.PasswordResetRequestedAt = now
	member.RecoveryStatus = deriveMemberRecoveryStatus(member.EmailVerificationStatus, member.PasswordResetStatus)
	s.state.Auth.Members[memberIndex] = member
	s.refreshAuthSessionLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), member, nil
}

func (s *Store) CompletePasswordReset(input AuthRecoveryInput) (State, AuthSession, WorkspaceMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	memberIndex, err := s.findWorkspaceMemberForRecoveryLocked(input)
	if err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	member := s.state.Auth.Members[memberIndex]
	member.PasswordResetStatus = authPasswordResetCompleted
	member.PasswordResetCompletedAt = now
	member.RecoveryStatus = authRecoveryStatusRecovered
	s.state.Auth.Members[memberIndex] = member

	member, session, err := s.loginWithEmailLocked(AuthLoginInput{
		Email:       member.Email,
		Name:        member.Name,
		DeviceID:    input.DeviceID,
		DeviceLabel: input.DeviceLabel,
		AuthMethod:  "password-reset",
	}, now)
	if err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}
	s.state.Auth.Members[memberIndex] = member
	s.state.Auth.Session = session

	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), session, member, nil
}

func (s *Store) BindExternalIdentity(input AuthRecoveryInput) (State, AuthSession, WorkspaceMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(s.state.Auth.Session.Status) != authSessionStatusActive {
		return State{}, AuthSession{}, WorkspaceMember{}, ErrAuthSessionRequired
	}
	if strings.TrimSpace(input.Provider) == "" {
		return State{}, AuthSession{}, WorkspaceMember{}, ErrAuthIdentityProviderRequired
	}
	if strings.TrimSpace(input.Handle) == "" {
		return State{}, AuthSession{}, WorkspaceMember{}, ErrAuthIdentityHandleRequired
	}

	memberIndex, err := s.findWorkspaceMemberForRecoveryLocked(input)
	if err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	member := s.state.Auth.Members[memberIndex]
	binding := AuthExternalIdentity{
		Provider: strings.TrimSpace(input.Provider),
		Handle:   strings.TrimSpace(input.Handle),
		Status:   "bound",
		BoundAt:  now,
	}
	replaced := false
	for index := range member.LinkedIdentities {
		if strings.EqualFold(member.LinkedIdentities[index].Provider, binding.Provider) {
			member.LinkedIdentities[index] = binding
			replaced = true
			break
		}
	}
	if !replaced {
		member.LinkedIdentities = append(member.LinkedIdentities, binding)
	}
	if strings.EqualFold(binding.Provider, "github") {
		member.GitHubIdentity = binding
	}
	syncWorkspaceMemberDefaults(&member)
	s.state.Auth.Members[memberIndex] = member
	s.refreshAuthSessionLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), s.state.Auth.Session, member, nil
}

func (s *Store) refreshAuthSessionLocked() {
	session := s.state.Auth.Session
	if session.Status == authSessionStatusSignedOut {
		s.state.Auth.Session = signedOutAuthSession()
		return
	}

	index := s.findWorkspaceMemberForSessionLocked(session.MemberID, session.Email)
	if index == -1 {
		s.state.Auth.Session = signedOutAuthSession()
		return
	}

	member := s.state.Auth.Members[index]
	if member.Status == workspaceMemberStatusSuspended {
		s.state.Auth.Session = signedOutAuthSession()
		return
	}

	if member.LastSeenAt == "" {
		member.LastSeenAt = time.Now().UTC().Format(time.RFC3339)
		s.state.Auth.Members[index] = member
	}
	nextSession := authSessionFromMember(member, defaultString(session.SignedInAt, member.LastSeenAt))
	nextSession.AuthMethod = defaultString(session.AuthMethod, "email-link")
	if device, ok := s.currentAuthDeviceLocked(); ok {
		nextSession = hydrateSessionWithDevice(nextSession, device, nextSession.AuthMethod)
	} else {
		nextSession.DeviceLabel = defaultAuthDeviceLabel(session.DeviceLabel)
		nextSession.DeviceAuthStatus = authDeviceStatusPending
		nextSession.RecoveryStatus = deriveSessionRecoveryStatus(member, nextSession.DeviceAuthStatus, nextSession.AuthMethod)
	}
	s.state.Auth.Session = nextSession
	if strings.TrimSpace(s.state.Auth.Session.DeviceAuthStatus) != "" {
		s.state.Workspace.DeviceAuth = workspaceDeviceAuthLabel(s.state.Auth.Session.DeviceAuthStatus)
	}
}

func (s *Store) findWorkspaceMemberForRecoveryLocked(input AuthRecoveryInput) (int, error) {
	if strings.TrimSpace(input.MemberID) != "" {
		if index := s.findWorkspaceMemberByIDLocked(input.MemberID); index != -1 {
			return index, nil
		}
		return -1, ErrWorkspaceMemberNotFound
	}
	if normalizeEmail(input.Email) != "" {
		if index := s.findWorkspaceMemberByEmailLocked(input.Email); index != -1 {
			return index, nil
		}
		return -1, ErrWorkspaceMemberNotFound
	}
	if strings.TrimSpace(s.state.Auth.Session.MemberID) != "" || strings.TrimSpace(s.state.Auth.Session.Email) != "" {
		if index := s.findWorkspaceMemberForSessionLocked(s.state.Auth.Session.MemberID, s.state.Auth.Session.Email); index != -1 {
			return index, nil
		}
	}
	return -1, ErrWorkspaceMemberNotFound
}

func (s *Store) requireWorkspaceMemberPermissionLocked(permission string) error {
	if strings.TrimSpace(s.state.Auth.Session.Status) != authSessionStatusActive {
		return ErrAuthSessionRequired
	}
	for _, granted := range s.state.Auth.Session.Permissions {
		if granted == permission {
			return nil
		}
	}
	return ErrWorkspaceRoleForbidden
}

func (s *Store) activeWorkspaceOwnerCountLocked() int {
	count := 0
	for _, member := range s.state.Auth.Members {
		if member.Role == workspaceRoleOwner && member.Status == workspaceMemberStatusActive {
			count++
		}
	}
	return count
}

func (s *Store) findWorkspaceMemberByEmailLocked(email string) int {
	email = normalizeEmail(email)
	for index := range s.state.Auth.Members {
		if normalizeEmail(s.state.Auth.Members[index].Email) == email {
			return index
		}
	}
	return -1
}

func (s *Store) findWorkspaceMemberByIDLocked(memberID string) int {
	for index := range s.state.Auth.Members {
		if s.state.Auth.Members[index].ID == memberID {
			return index
		}
	}
	return -1
}

func (s *Store) findWorkspaceMemberForSessionLocked(memberID, email string) int {
	if strings.TrimSpace(memberID) != "" {
		if index := s.findWorkspaceMemberByIDLocked(memberID); index != -1 {
			return index
		}
	}
	if normalizeEmail(email) != "" {
		return s.findWorkspaceMemberByEmailLocked(email)
	}
	return -1
}

func (s *Store) sortWorkspaceMembersLocked() {
	roleRank := map[string]int{
		workspaceRoleOwner:  0,
		workspaceRoleMember: 1,
		workspaceRoleViewer: 2,
	}
	sort.SliceStable(s.state.Auth.Members, func(i, j int) bool {
		left := s.state.Auth.Members[i]
		right := s.state.Auth.Members[j]
		if roleRank[left.Role] != roleRank[right.Role] {
			return roleRank[left.Role] < roleRank[right.Role]
		}
		return strings.ToLower(fmt.Sprintf("%s:%s", left.Name, left.Email)) < strings.ToLower(fmt.Sprintf("%s:%s", right.Name, right.Email))
	})
}
