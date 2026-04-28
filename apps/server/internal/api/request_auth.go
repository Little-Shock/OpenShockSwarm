package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

const (
	authTokenHeaderName        = "X-OpenShock-Auth-Token"
	authTokenCookieName        = "openshock_auth"
	authDeviceStatusPending    = "pending"
	authSessionStatusSignedOut = "signed_out"
)

var (
	requestAuthTokenTTL = 30 * 24 * time.Hour
	requestAuthTimeNow  = func() time.Time { return time.Now().UTC() }
)

type authRequestBinding struct {
	MemberID    string
	Email       string
	DeviceID    string
	DeviceLabel string
	AuthMethod  string
	SignedInAt  string
	ExpiresAt   time.Time
}

func newAuthRequestToken() string {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return "auth-token-" + hex.EncodeToString(bytes[:])
}

func signedOutRequestAuthSession() store.AuthSession {
	return store.AuthSession{
		ID:          "auth-session-current",
		Status:      authSessionStatusSignedOut,
		Preferences: store.WorkspaceMemberPreferences{},
		Permissions: []string{},
	}
}

func (s *Server) requestScopedStateSnapshot(snapshot store.State, r *http.Request) store.State {
	snapshot.Auth.Session = s.resolveRequestAuthSessionFromSnapshot(snapshot, r)
	return snapshot
}

func (s *Server) runtimeAwareStateSnapshotForRequest(r *http.Request) store.State {
	return s.requestScopedStateSnapshot(s.runtimeAwareStateSnapshot(), r)
}

func (s *Server) sanitizedLiveStateSnapshotForRequest(r *http.Request) store.State {
	return sanitizeLiveState(s.runtimeAwareStateSnapshotForRequest(r))
}

func (s *Server) sanitizedStateSnapshotForSession(snapshot store.State, session store.AuthSession) store.State {
	snapshot.Auth.Session = session
	return sanitizeLiveState(snapshot)
}

func (s *Server) sanitizedStateSnapshotForRequest(snapshot store.State, r *http.Request) store.State {
	return sanitizeLiveState(s.requestScopedStateSnapshot(snapshot, r))
}

func (s *Server) currentRequestAuthSession(r *http.Request) store.AuthSession {
	return s.resolveRequestAuthSession(r)
}

func (s *Server) currentStrictRequestAuthSession(r *http.Request) store.AuthSession {
	if token, ok := requestAuthToken(r); ok {
		if session, found := s.resolveRequestAuthSessionByToken(token); found {
			return session
		}
		return signedOutRequestAuthSession()
	}
	return signedOutRequestAuthSession()
}

func (s *Server) currentRequestAuthActor(r *http.Request) string {
	return currentAuthActor(s.currentRequestAuthSession(r))
}

func (s *Server) requireRequestSessionPermission(w http.ResponseWriter, r *http.Request, permission string) bool {
	session := s.resolveRequestAuthSession(r)
	payload := map[string]any{
		"permission": permission,
		"session":    session,
	}

	if strings.TrimSpace(session.Status) != authSessionStatusActive {
		payload["error"] = store.ErrAuthSessionRequired.Error()
		writeJSON(w, http.StatusUnauthorized, payload)
		return false
	}

	if readinessError := authSessionPermissionReadinessError(session); readinessError != "" {
		payload["error"] = readinessError
		writeJSON(w, http.StatusForbidden, payload)
		return false
	}

	if !authSessionHasPermission(session, permission) {
		payload["error"] = "permission " + `"` + permission + `"` + " required"
		writeJSON(w, http.StatusForbidden, payload)
		return false
	}

	return true
}

func requestAuthCookieSecure(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	forwardedProto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	if strings.EqualFold(forwardedProto, "https") {
		return true
	}
	return strings.Contains(strings.ToLower(r.Header.Get("Forwarded")), "proto=https")
}

func requestAuthBindingExpired(binding authRequestBinding) bool {
	return !binding.ExpiresAt.IsZero() && !requestAuthTimeNow().Before(binding.ExpiresAt)
}

func (s *Server) issueRequestAuthToken(session store.AuthSession) (string, time.Time, error) {
	token := newAuthRequestToken()
	expiresAt := requestAuthTimeNow().Add(requestAuthTokenTTL)

	s.authTokenMu.Lock()
	defer s.authTokenMu.Unlock()
	s.authTokens[token] = authRequestBinding{
		MemberID:    strings.TrimSpace(session.MemberID),
		Email:       strings.TrimSpace(session.Email),
		DeviceID:    strings.TrimSpace(session.DeviceID),
		DeviceLabel: strings.TrimSpace(session.DeviceLabel),
		AuthMethod:  strings.TrimSpace(session.AuthMethod),
		SignedInAt:  strings.TrimSpace(session.SignedInAt),
		ExpiresAt:   expiresAt,
	}
	if err := s.persistRequestAuthTokensLocked(); err != nil {
		delete(s.authTokens, token)
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

func (s *Server) revokeRequestAuthToken(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	s.authTokenMu.Lock()
	defer s.authTokenMu.Unlock()
	previous, existed := s.authTokens[token]
	delete(s.authTokens, token)
	if err := s.persistRequestAuthTokensLocked(); err != nil {
		if existed {
			s.authTokens[token] = previous
		}
		return err
	}
	return nil
}

func (s *Server) writeRequestAuthToken(w http.ResponseWriter, r *http.Request, session store.AuthSession) (string, error) {
	token, expiresAt, err := s.issueRequestAuthToken(session)
	if err != nil {
		return "", err
	}
	maxAge := int(requestAuthTokenTTL / time.Second)
	if maxAge < 0 {
		maxAge = 0
	}
	http.SetCookie(w, &http.Cookie{
		Name:     authTokenCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   requestAuthCookieSecure(r),
		Expires:  expiresAt,
		MaxAge:   maxAge,
		SameSite: http.SameSiteLaxMode,
	})
	return token, nil
}

func clearRequestAuthToken(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authTokenCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   requestAuthCookieSecure(r),
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		SameSite: http.SameSiteLaxMode,
	})
}

func requestAuthHeaderToken(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	if token := strings.TrimSpace(r.Header.Get(authTokenHeaderName)); token != "" {
		return token, true
	}
	return "", false
}

func requestAuthCookieToken(r *http.Request) (string, bool) {
	if r == nil {
		return "", false
	}
	if cookie, err := r.Cookie(authTokenCookieName); err == nil {
		if token := strings.TrimSpace(cookie.Value); token != "" {
			return token, true
		}
	}
	return "", false
}

func requestAuthToken(r *http.Request) (string, bool) {
	if token, ok := requestAuthHeaderToken(r); ok {
		return token, true
	}
	return requestAuthCookieToken(r)
}

func (s *Server) resolveRequestAuthSession(r *http.Request) store.AuthSession {
	return s.resolveRequestAuthSessionFromSnapshot(s.store.Snapshot(), r)
}

func (s *Server) resolveRequestAuthSessionFromSnapshot(snapshot store.State, r *http.Request) store.AuthSession {
	if token, ok := requestAuthToken(r); ok {
		if session, found := s.resolveRequestAuthSessionByTokenFromSnapshot(snapshot, token); found {
			return session
		}
		return signedOutRequestAuthSession()
	}
	return signedOutRequestAuthSession()
}

func (s *Server) resolveRequestAuthSessionByToken(token string) (store.AuthSession, bool) {
	return s.resolveRequestAuthSessionByTokenFromSnapshot(s.store.Snapshot(), token)
}

func (s *Server) resolveRequestAuthSessionByTokenFromSnapshot(snapshot store.State, token string) (store.AuthSession, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return store.AuthSession{}, false
	}
	s.authTokenMu.RLock()
	binding, ok := s.authTokens[token]
	s.authTokenMu.RUnlock()
	if !ok {
		return store.AuthSession{}, false
	}
	if requestAuthBindingExpired(binding) {
		_ = s.revokeRequestAuthToken(token)
		return store.AuthSession{}, false
	}
	return requestAuthSessionFromBinding(snapshot, binding), true
}

func requestAuthSessionFromBinding(snapshot store.State, binding authRequestBinding) store.AuthSession {
	member, ok := requestAuthMemberFromBinding(snapshot.Auth.Members, binding)
	if !ok || strings.EqualFold(strings.TrimSpace(member.Status), "suspended") {
		return signedOutRequestAuthSession()
	}

	session := store.AuthSession{
		ID:                       "auth-session-current",
		MemberID:                 member.ID,
		Email:                    member.Email,
		Name:                     member.Name,
		Role:                     member.Role,
		MemberStatus:             member.Status,
		Status:                   authSessionStatusActive,
		AuthMethod:               defaultString(strings.TrimSpace(binding.AuthMethod), "email-link"),
		SignedInAt:               defaultString(strings.TrimSpace(binding.SignedInAt), member.LastSeenAt),
		LastSeenAt:               member.LastSeenAt,
		EmailVerificationStatus:  member.EmailVerificationStatus,
		EmailVerifiedAt:          member.EmailVerifiedAt,
		PasswordResetStatus:      member.PasswordResetStatus,
		PasswordResetRequestedAt: member.PasswordResetRequestedAt,
		PasswordResetCompletedAt: member.PasswordResetCompletedAt,
		RecoveryStatus:           member.RecoveryStatus,
		GitHubIdentity:           member.GitHubIdentity,
		Preferences:              member.Preferences,
		LinkedIdentities:         append([]store.AuthExternalIdentity{}, member.LinkedIdentities...),
		Permissions:              append([]string{}, member.Permissions...),
	}

	if device, ok := requestAuthDeviceFromBinding(snapshot.Auth.Devices, binding, member.ID); ok {
		session.DeviceID = device.ID
		session.DeviceLabel = device.Label
		session.DeviceAuthStatus = device.Status
		session.RecoveryStatus = deriveRequestSessionRecoveryStatus(member, device.Status, session.AuthMethod)
		return session
	}

	session.DeviceID = strings.TrimSpace(binding.DeviceID)
	session.DeviceLabel = defaultString(strings.TrimSpace(binding.DeviceLabel), "Current Device")
	session.DeviceAuthStatus = authDeviceStatusPending
	session.RecoveryStatus = deriveRequestSessionRecoveryStatus(member, authDeviceStatusPending, session.AuthMethod)
	return session
}

func requestAuthMemberFromBinding(members []store.WorkspaceMember, binding authRequestBinding) (store.WorkspaceMember, bool) {
	memberID := strings.TrimSpace(binding.MemberID)
	email := normalizeRequestAuthEmail(binding.Email)
	for _, member := range members {
		if memberID != "" && member.ID == memberID {
			return member, true
		}
	}
	for _, member := range members {
		if email != "" && normalizeRequestAuthEmail(member.Email) == email {
			return member, true
		}
	}
	return store.WorkspaceMember{}, false
}

func requestAuthDeviceFromBinding(devices []store.AuthDevice, binding authRequestBinding, memberID string) (store.AuthDevice, bool) {
	deviceID := strings.TrimSpace(binding.DeviceID)
	deviceLabel := strings.TrimSpace(binding.DeviceLabel)

	if deviceID != "" {
		for _, device := range devices {
			if device.ID == deviceID && device.MemberID == memberID {
				return device, true
			}
		}
	}
	if memberID != "" && deviceLabel != "" {
		for _, device := range devices {
			if device.MemberID == memberID && device.Label == deviceLabel {
				return device, true
			}
		}
	}
	return store.AuthDevice{}, false
}

func deriveRequestSessionRecoveryStatus(member store.WorkspaceMember, deviceStatus, authMethod string) string {
	switch {
	case member.PasswordResetStatus == "pending":
		return "reset_pending"
	case member.EmailVerificationStatus != authSessionEmailVerificationVerified:
		return "verification_required"
	case deviceStatus != authSessionDeviceStatusAuthorized:
		return "device_approval_required"
	case strings.EqualFold(strings.TrimSpace(member.Status), "invited"):
		return "approval_required"
	case strings.EqualFold(strings.TrimSpace(authMethod), "password-reset"):
		return "recovered"
	default:
		return "ready"
	}
}

func normalizeRequestAuthEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
