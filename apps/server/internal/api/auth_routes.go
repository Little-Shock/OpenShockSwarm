package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type AuthSessionRequest struct {
	Email       string `json:"email"`
	Name        string `json:"name"`
	DeviceID    string `json:"deviceId"`
	DeviceLabel string `json:"deviceLabel"`
	AuthMethod  string `json:"authMethod"`
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

type AuthRecoveryRequest struct {
	Action      string `json:"action"`
	Email       string `json:"email"`
	MemberID    string `json:"memberId"`
	DeviceID    string `json:"deviceId"`
	DeviceLabel string `json:"deviceLabel"`
	Provider    string `json:"provider"`
	Handle      string `json:"handle"`
}

func (s *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.Snapshot().Auth.Session)
	case http.MethodPost:
		var req AuthSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, session, err := s.store.LoginWithEmail(store.AuthLoginInput{
			Email:       req.Email,
			Name:        req.Name,
			DeviceID:    req.DeviceID,
			DeviceLabel: req.DeviceLabel,
			AuthMethod:  req.AuthMethod,
		})
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "state": nextState})
	case http.MethodDelete:
		nextState, session, err := s.store.LogoutAuthSession()
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "state": nextState})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleWorkspaceMembers(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/v1/workspace/members" {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, s.store.Snapshot().Auth)
		case http.MethodPost:
			var req WorkspaceMemberRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			nextState, member, err := s.store.InviteWorkspaceMember(store.WorkspaceMemberUpsertInput{
				Email: req.Email,
				Name:  req.Name,
				Role:  req.Role,
			})
			if err != nil {
				writeAuthError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"member": member, "state": nextState})
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

	switch r.Method {
	case http.MethodGet:
		member, ok := s.store.WorkspaceMember(memberID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace member not found"})
			return
		}
		writeJSON(w, http.StatusOK, member)
	case http.MethodPatch:
		var req WorkspaceMemberUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, member, err := s.store.UpdateWorkspaceMember(memberID, store.WorkspaceMemberUpdateInput{
			Role:   req.Role,
			Status: req.Status,
		})
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"member": member, "state": nextState})
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
		Provider:    req.Provider,
		Handle:      req.Handle,
	}

	switch req.Action {
	case "verify_email":
		nextState, session, member, err := s.store.VerifyMemberEmail(input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "state": nextState})
	case "authorize_device":
		nextState, session, member, device, err := s.store.AuthorizeAuthDevice(input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "device": device, "state": nextState})
	case "request_password_reset":
		nextState, member, err := s.store.RequestPasswordReset(input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"member": member, "state": nextState})
	case "complete_password_reset":
		nextState, session, member, err := s.store.CompletePasswordReset(input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "state": nextState})
	case "bind_external_identity":
		nextState, session, member, err := s.store.BindExternalIdentity(input)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"session": session, "member": member, "state": nextState})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported recovery action"})
	}
}

func writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrAuthEmailRequired),
		errors.Is(err, store.ErrAuthDeviceRequired),
		errors.Is(err, store.ErrAuthIdentityProviderRequired),
		errors.Is(err, store.ErrAuthIdentityHandleRequired),
		errors.Is(err, store.ErrWorkspaceRoleInvalid),
		errors.Is(err, store.ErrWorkspaceMemberStatusInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAuthSessionRequired):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceRoleForbidden),
		errors.Is(err, store.ErrWorkspaceMemberSuspended):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceMemberNotFound),
		errors.Is(err, store.ErrAuthDeviceNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceMemberExists),
		errors.Is(err, store.ErrWorkspaceMustRetainOwner):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
