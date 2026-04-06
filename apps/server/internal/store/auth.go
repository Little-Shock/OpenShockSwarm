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
	ErrWorkspaceMemberNotFound      = errors.New("workspace member not found")
	ErrWorkspaceMemberExists        = errors.New("workspace member already exists")
	ErrWorkspaceRoleInvalid         = errors.New("workspace role is invalid")
	ErrWorkspaceMemberStatusInvalid = errors.New("workspace member status is invalid")
	ErrWorkspaceRoleForbidden       = errors.New("current role cannot manage workspace members")
	ErrWorkspaceMemberSuspended     = errors.New("workspace member is suspended")
	ErrWorkspaceMustRetainOwner     = errors.New("workspace must retain at least one owner")
)

type AuthLoginInput struct {
	Email string
	Name  string
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

	return AuthSnapshot{
		Session: authSessionFromMember(members[0], now),
		Roles:   defaultWorkspaceRoles(),
		Members: members,
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
	return WorkspaceMember{
		ID:          id,
		Email:       normalizeEmail(email),
		Name:        strings.TrimSpace(name),
		Role:        role,
		Status:      status,
		Source:      source,
		AddedAt:     addedAt,
		LastSeenAt:  lastSeenAt,
		Permissions: permissionsForRole(role),
	}
}

func authSessionFromMember(member WorkspaceMember, signedInAt string) AuthSession {
	return AuthSession{
		ID:          "auth-session-current",
		MemberID:    member.ID,
		Email:       member.Email,
		Name:        member.Name,
		Role:        member.Role,
		Status:      authSessionStatusActive,
		AuthMethod:  "email-link",
		SignedInAt:  signedInAt,
		LastSeenAt:  member.LastSeenAt,
		Permissions: append([]string{}, member.Permissions...),
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
	defaults := defaultAuthSnapshot(time.Now().UTC().Format(time.RFC3339))

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
			s.state.Auth.Members[index].AddedAt = time.Now().UTC().Format(time.RFC3339)
		}
		s.state.Auth.Members[index].Permissions = permissionsForRole(role)
	}
	s.sortWorkspaceMembersLocked()

	if strings.TrimSpace(s.state.Auth.Session.Status) == "" &&
		strings.TrimSpace(s.state.Auth.Session.Email) == "" &&
		strings.TrimSpace(s.state.Auth.Session.MemberID) == "" {
		s.state.Auth.Session = defaults.Session
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

func (s *Store) LoginWithEmail(input AuthLoginInput) (State, AuthSession, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return State{}, AuthSession{}, ErrAuthEmailRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	index := s.findWorkspaceMemberByEmailLocked(email)
	if index == -1 {
		return State{}, AuthSession{}, ErrWorkspaceMemberNotFound
	}

	now := time.Now().UTC().Format(time.RFC3339)
	member := s.state.Auth.Members[index]
	if member.Status == workspaceMemberStatusSuspended {
		return State{}, AuthSession{}, ErrWorkspaceMemberSuspended
	}
	if member.Status == workspaceMemberStatusInvited {
		member.Status = workspaceMemberStatusActive
	}
	if name := strings.TrimSpace(input.Name); name != "" {
		member.Name = name
	}
	member.LastSeenAt = now
	member.Permissions = permissionsForRole(member.Role)
	s.state.Auth.Members[index] = member
	s.state.Auth.Session = authSessionFromMember(member, now)
	s.sortWorkspaceMembersLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, AuthSession{}, err
	}
	return cloneState(s.state), s.state.Auth.Session, nil
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
	s.state.Auth.Members[index] = member
	s.refreshAuthSessionLocked()
	s.sortWorkspaceMembersLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), member, nil
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
	s.state.Auth.Session = authSessionFromMember(member, defaultString(session.SignedInAt, member.LastSeenAt))
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
