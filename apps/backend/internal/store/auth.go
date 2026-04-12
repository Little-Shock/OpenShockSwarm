package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"openshock/backend/internal/core"
)

const (
	minPasswordLength = 8
	maxDisplayNameLen = 48
	maxUsernameLen    = 32
)

func (s *MemoryStore) RegisterMember(username, displayName, password string) (core.AuthTokenResponse, error) {
	normalizedUsername, err := normalizeUsername(username)
	if err != nil {
		return core.AuthTokenResponse{}, err
	}
	if len(strings.TrimSpace(password)) < minPasswordLength {
		return core.AuthTokenResponse{}, fmt.Errorf("password must be at least %d characters", minPasswordLength)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.memberIDsByUsername[normalizedUsername]; exists {
		return core.AuthTokenResponse{}, ErrConflict
	}

	now := time.Now().UTC().Format(time.RFC3339)
	s.nextMemberID++
	memberID := fmt.Sprintf("member_%03d", s.nextMemberID)
	member := core.Member{
		ID:          memberID,
		Username:    normalizedUsername,
		DisplayName: normalizeDisplayName(displayName, normalizedUsername),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	passwordHash, err := hashPassword(password)
	if err != nil {
		return core.AuthTokenResponse{}, err
	}

	s.grantMemberWorkspaceAccessLocked(memberID, s.defaultWorkspaceID)

	token, session, err := s.createAuthSessionLocked(memberID, now)
	if err != nil {
		return core.AuthTokenResponse{}, err
	}

	s.members[memberID] = member
	s.memberIDsByUsername[normalizedUsername] = memberID
	s.passwordHashes[memberID] = passwordHash

	return core.AuthTokenResponse{
		SessionToken: token,
		Session:      session,
		Member:       member,
	}, nil
}

func (s *MemoryStore) LoginMember(username, password string) (core.AuthTokenResponse, error) {
	normalizedUsername, err := normalizeUsername(username)
	if err != nil {
		return core.AuthTokenResponse{}, ErrUnauthorized
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	memberID, exists := s.memberIDsByUsername[normalizedUsername]
	if !exists {
		return core.AuthTokenResponse{}, ErrUnauthorized
	}
	passwordHash, exists := s.passwordHashes[memberID]
	if !exists || !verifyPassword(passwordHash, password) {
		return core.AuthTokenResponse{}, ErrUnauthorized
	}

	now := time.Now().UTC().Format(time.RFC3339)
	token, session, err := s.createAuthSessionLocked(memberID, now)
	if err != nil {
		return core.AuthTokenResponse{}, err
	}

	member, ok := s.members[memberID]
	if !ok {
		return core.AuthTokenResponse{}, ErrUnauthorized
	}

	return core.AuthTokenResponse{
		SessionToken: token,
		Session:      session,
		Member:       member,
	}, nil
}

func (s *MemoryStore) LookupMemberBySessionToken(token string) (core.Member, core.AuthSession, bool) {
	resolvedToken := strings.TrimSpace(token)
	if resolvedToken == "" {
		return core.Member{}, core.AuthSession{}, false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.authSessions[resolvedToken]
	if !ok {
		return core.Member{}, core.AuthSession{}, false
	}
	member, ok := s.members[session.MemberID]
	if !ok {
		delete(s.authSessions, resolvedToken)
		return core.Member{}, core.AuthSession{}, false
	}
	if !s.memberHasWorkspaceAccessLocked(session.MemberID, session.ActiveWorkspaceID) {
		session.ActiveWorkspaceID = s.defaultAccessibleWorkspaceForMemberLocked(session.MemberID)
	}

	session.LastSeenAt = time.Now().UTC().Format(time.RFC3339)
	s.authSessions[resolvedToken] = session
	return member, session, true
}

func (s *MemoryStore) LogoutSession(token string) bool {
	resolvedToken := strings.TrimSpace(token)
	if resolvedToken == "" {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.authSessions[resolvedToken]; !ok {
		return false
	}
	delete(s.authSessions, resolvedToken)
	return true
}

func (s *MemoryStore) UpdateMemberDisplayName(memberID, displayName string) (core.Member, error) {
	normalizedMemberID := strings.TrimSpace(memberID)
	if normalizedMemberID == "" {
		return core.Member{}, ErrNotFound
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	member, ok := s.members[normalizedMemberID]
	if !ok {
		return core.Member{}, ErrNotFound
	}
	nextDisplayName := normalizeDisplayName(displayName, "")
	if strings.TrimSpace(nextDisplayName) == "" {
		return core.Member{}, errors.New("displayName is required")
	}

	member.DisplayName = nextDisplayName
	member.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.members[normalizedMemberID] = member

	return member, nil
}

func (s *MemoryStore) createAuthSessionLocked(memberID, now string) (string, core.AuthSession, error) {
	s.nextAuthSessionID++
	session := core.AuthSession{
		ID:                fmt.Sprintf("session_%03d", s.nextAuthSessionID),
		MemberID:          memberID,
		ActiveWorkspaceID: s.defaultAccessibleWorkspaceForMemberLocked(memberID),
		CreatedAt:         now,
		LastSeenAt:        now,
	}

	for attempts := 0; attempts < 4; attempts++ {
		token, err := newSessionToken()
		if err != nil {
			return "", core.AuthSession{}, err
		}
		if _, exists := s.authSessions[token]; exists {
			continue
		}
		s.authSessions[token] = session
		return token, session, nil
	}

	return "", core.AuthSession{}, errors.New("failed to allocate unique session token")
}

func (s *MemoryStore) SetActiveWorkspaceForSession(token, workspaceID string) (core.AuthSession, error) {
	resolvedToken := strings.TrimSpace(token)
	resolvedWorkspaceID := strings.TrimSpace(workspaceID)
	if resolvedToken == "" || resolvedWorkspaceID == "" {
		return core.AuthSession{}, ErrNotFound
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.authSessions[resolvedToken]
	if !ok {
		return core.AuthSession{}, ErrUnauthorized
	}
	if _, ok := s.workspaceIndexByIDLocked(resolvedWorkspaceID); !ok {
		return core.AuthSession{}, ErrNotFound
	}
	if !s.memberHasWorkspaceAccessLocked(session.MemberID, resolvedWorkspaceID) {
		return core.AuthSession{}, ErrUnauthorized
	}

	session.ActiveWorkspaceID = resolvedWorkspaceID
	session.LastSeenAt = time.Now().UTC().Format(time.RFC3339)
	s.authSessions[resolvedToken] = session
	return session, nil
}

func normalizeUsername(value string) (string, error) {
	username := strings.ToLower(strings.TrimSpace(value))
	if username == "" {
		return "", errors.New("username is required")
	}
	if len(username) > maxUsernameLen {
		return "", fmt.Errorf("username cannot exceed %d characters", maxUsernameLen)
	}
	for _, ch := range username {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' || ch == '.' {
			continue
		}
		return "", errors.New("username can only contain lowercase letters, digits, '.', '_' and '-'")
	}
	return username, nil
}

func normalizeDisplayName(value, fallback string) string {
	trimmed := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if trimmed == "" {
		trimmed = strings.TrimSpace(fallback)
	}
	if len(trimmed) > maxDisplayNameLen {
		return trimmed[:maxDisplayNameLen]
	}
	return trimmed
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	buffer := make([]byte, 0, len(salt)+len(password))
	buffer = append(buffer, salt...)
	buffer = append(buffer, password...)
	digest := sha256.Sum256(buffer)
	return fmt.Sprintf("%s$%s", hex.EncodeToString(salt), hex.EncodeToString(digest[:])), nil
}

func verifyPassword(encodedHash, password string) bool {
	parts := strings.Split(strings.TrimSpace(encodedHash), "$")
	if len(parts) != 2 {
		return false
	}

	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	buffer := make([]byte, 0, len(salt)+len(password))
	buffer = append(buffer, salt...)
	buffer = append(buffer, password...)
	digest := sha256.Sum256(buffer)
	return subtle.ConstantTimeCompare(expected, digest[:]) == 1
}

func newSessionToken() (string, error) {
	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(tokenBytes), nil
}
