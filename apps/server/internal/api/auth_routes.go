package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type AuthSessionRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
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
			Email: req.Email,
			Name:  req.Name,
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

func writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrAuthEmailRequired),
		errors.Is(err, store.ErrWorkspaceRoleInvalid),
		errors.Is(err, store.ErrWorkspaceMemberStatusInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAuthSessionRequired):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceRoleForbidden),
		errors.Is(err, store.ErrWorkspaceMemberSuspended):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceMemberNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrWorkspaceMemberExists),
		errors.Is(err, store.ErrWorkspaceMustRetainOwner):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
