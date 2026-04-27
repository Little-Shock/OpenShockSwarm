package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func (s *Server) requireWorkspaceMemberReadAccess(w http.ResponseWriter, r *http.Request, memberID string) bool {
	session := s.currentRequestAuthSession(r)
	if strings.TrimSpace(session.Status) != authSessionStatusActive {
		writeAuthError(w, store.ErrAuthSessionRequired)
		return false
	}
	if session.MemberID == memberID || authSessionHasPermission(session, "members.manage") {
		return true
	}
	writeAuthError(w, store.ErrWorkspaceRoleForbidden)
	return false
}

type AuthSessionRequest struct {
	Email       string `json:"email"`
	Name        string `json:"name"`
	DeviceID    string `json:"deviceId"`
	DeviceLabel string `json:"deviceLabel"`
	AuthMethod  string `json:"authMethod"`
	ChallengeID string `json:"challengeId"`
}

type WorkspaceMemberRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

type WorkspaceMemberUpdateRequest struct {
	Role   string `json:"role"`
	Status string `json:"status"`
}

type WorkspaceMemberPreferencesRequest struct {
	PreferredAgentID string `json:"preferredAgentId"`
	StartRoute       string `json:"startRoute"`
	GitHubHandle     string `json:"githubHandle"`
}

type AuthRecoveryRequest struct {
	Action      string `json:"action"`
	Email       string `json:"email"`
	Name        string `json:"name"`
	MemberID    string `json:"memberId"`
	DeviceID    string `json:"deviceId"`
	DeviceLabel string `json:"deviceLabel"`
	ChallengeID string `json:"challengeId"`
	Provider    string `json:"provider"`
	Handle      string `json:"handle"`
}

func (s *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.currentRequestAuthSession(r))
	case http.MethodPost:
		var req AuthSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, session, err := s.store.CompleteLoginWithChallenge(store.AuthLoginInput{
			Email:       req.Email,
			Name:        req.Name,
			DeviceID:    req.DeviceID,
			DeviceLabel: req.DeviceLabel,
			AuthMethod:  req.AuthMethod,
		}, req.ChallengeID)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		token := s.writeRequestAuthToken(w, r, session)
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "state": s.sanitizedStateSnapshotForSession(nextState, session), "token": token})
	case http.MethodDelete:
		if headerToken, ok := requestAuthHeaderToken(r); ok {
			s.revokeRequestAuthToken(headerToken)
			if cookieToken, cookieOK := requestAuthCookieToken(r); cookieOK && cookieToken == headerToken {
				clearRequestAuthToken(w, r)
			}
			session := signedOutRequestAuthSession()
			nextState := s.store.Snapshot()
			writeJSON(w, http.StatusOK, map[string]any{"session": session, "state": s.sanitizedStateSnapshotForSession(nextState, session)})
			return
		}
		if cookieToken, ok := requestAuthCookieToken(r); ok {
			s.revokeRequestAuthToken(cookieToken)
		}
		nextState, session, err := s.store.LogoutAuthSession()
		if err != nil {
			writeAuthError(w, err)
			return
		}
		clearRequestAuthToken(w, r)
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "state": s.sanitizedStateSnapshotForSession(nextState, session)})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleWorkspaceMembers(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v1/workspace/members" {
		switch r.Method {
		case http.MethodGet:
			if !s.requireRequestSessionPermission(w, r, "members.manage") {
				return
			}
			auth := s.store.Snapshot().Auth
			auth.Session = s.currentRequestAuthSession(r)
			writeJSON(w, http.StatusOK, auth)
		case http.MethodPost:
			var req WorkspaceMemberRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			nextState, member, err := s.store.InviteWorkspaceMemberAs(s.currentRequestAuthSession(r), store.WorkspaceMemberUpsertInput{
				Email: req.Email,
				Name:  req.Name,
				Role:  req.Role,
			})
			if err != nil {
				writeAuthError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"member": member, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
		return
	}

	memberID := strings.TrimPrefix(r.URL.Path, "/v1/workspace/members/")
	if strings.TrimSpace(memberID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace member not found"})
		return
	}
	preferencesRoute := false
	if strings.HasSuffix(memberID, "/preferences") {
		preferencesRoute = true
		memberID = strings.TrimSuffix(memberID, "/preferences")
	}
	memberID = strings.TrimSpace(memberID)
	if memberID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace member not found"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		if preferencesRoute {
			if !s.requireWorkspaceMemberReadAccess(w, r, memberID) {
				return
			}
			member, ok := s.store.WorkspaceMember(memberID)
			if !ok {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace member not found"})
				return
			}
			writeJSON(w, http.StatusOK, member.Preferences)
			return
		}
		if !s.requireWorkspaceMemberReadAccess(w, r, memberID) {
			return
		}
		member, ok := s.store.WorkspaceMember(memberID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace member not found"})
			return
		}
		writeJSON(w, http.StatusOK, member)
	case http.MethodPatch:
		if preferencesRoute {
			var req WorkspaceMemberPreferencesRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			nextState, member, err := s.store.UpdateWorkspaceMemberPreferencesAs(s.currentRequestAuthSession(r), memberID, store.WorkspaceMemberPreferencesInput{
				PreferredAgentID: req.PreferredAgentID,
				StartRoute:       req.StartRoute,
				GitHubHandle:     req.GitHubHandle,
			})
			if err != nil {
				writeAuthError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"member": member, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
			return
		}
		var req WorkspaceMemberUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, member, err := s.store.UpdateWorkspaceMemberAs(s.currentRequestAuthSession(r), memberID, store.WorkspaceMemberUpdateInput{
			Role:   req.Role,
			Status: req.Status,
		})
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"member": member, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleAuthRecovery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var req AuthRecoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	input := store.AuthRecoveryInput{
		Email:       req.Email,
		MemberID:    req.MemberID,
		DeviceID:    req.DeviceID,
		DeviceLabel: req.DeviceLabel,
		ChallengeID: req.ChallengeID,
		Provider:    req.Provider,
		Handle:      req.Handle,
	}
	requestSession := s.currentStrictRequestAuthSession(r)

	switch req.Action {
	case "request_login_challenge":
		nextState, challenge, err := s.store.RequestLoginChallenge(store.AuthLoginInput{
			Email: req.Email,
			Name:  req.Name,
		})
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"challenge": challenge, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
	case "request_verify_email_challenge":
		nextState, challenge, err := s.store.RequestVerifyMemberEmailChallengeAs(requestSession, input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"challenge": challenge, "state": s.sanitizedStateSnapshotForSession(nextState, requestSession)})
	case "verify_email":
		nextState, session, member, err := s.store.VerifyMemberEmailAs(requestSession, input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "state": s.sanitizedStateSnapshotForSession(nextState, session)})
	case "request_authorize_device_challenge":
		nextState, challenge, err := s.store.RequestAuthorizeAuthDeviceChallengeAs(requestSession, input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"challenge": challenge, "state": s.sanitizedStateSnapshotForSession(nextState, requestSession)})
	case "authorize_device":
		nextState, session, member, device, err := s.store.AuthorizeAuthDeviceAs(requestSession, input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "device": device, "state": s.sanitizedStateSnapshotForSession(nextState, session)})
	case "request_password_reset":
		nextState, member, challenge, err := s.store.RequestPasswordResetAs(requestSession, input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"member": member, "challenge": challenge, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
	case "complete_password_reset":
		nextState, session, member, err := s.store.CompletePasswordReset(input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		token := s.writeRequestAuthToken(w, r, session)
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "state": s.sanitizedStateSnapshotForSession(nextState, session), "token": token})
	case "bind_external_identity":
		nextState, session, member, err := s.store.BindExternalIdentityAs(requestSession, input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "state": s.sanitizedStateSnapshotForSession(nextState, session)})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported recovery action"})
	}
}

func writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrAuthEmailRequired),
		errors.Is(err, store.ErrAuthChallengeRequired),
		errors.Is(err, store.ErrAuthDeviceRequired),
		errors.Is(err, store.ErrAuthIdentityProviderRequired),
		errors.Is(err, store.ErrAuthIdentityHandleRequired),
		errors.Is(err, store.ErrWorkspaceRoleInvalid),
		errors.Is(err, store.ErrWorkspaceMemberStatusInvalid),
		errors.Is(err, store.ErrWorkspaceOnboardingStatusInvalid),
		errors.Is(err, store.ErrWorkspaceResumeURLInvalid),
		errors.Is(err, store.ErrWorkspaceStartRouteInvalid),
		errors.Is(err, store.ErrWorkspacePreferredAgentNotFound):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAuthSessionRequired):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAuthEmailVerificationRequired),
		errors.Is(err, store.ErrAuthDeviceAuthorizationRequired),
		errors.Is(err, store.ErrAuthTrustedDeviceRequired),
		errors.Is(err, store.ErrWorkspaceRoleForbidden),
		errors.Is(err, store.ErrWorkspaceMemberApprovalRequired),
		errors.Is(err, store.ErrWorkspaceMemberActivationBlocked),
		errors.Is(err, store.ErrWorkspaceMemberSuspended):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceMemberNotFound),
		errors.Is(err, store.ErrAuthChallengeNotFound),
		errors.Is(err, store.ErrAuthDeviceNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceMemberExists),
		errors.Is(err, store.ErrAuthChallengeExpired),
		errors.Is(err, store.ErrAuthChallengeConsumed),
		errors.Is(err, store.ErrWorkspaceMustRetainOwner),
		errors.Is(err, store.ErrFreshBootstrapOwnerClaimUnavailable):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
