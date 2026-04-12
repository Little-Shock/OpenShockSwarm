package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"openshock/backend/internal/core"
	"openshock/backend/internal/store"
)

const sessionHeaderName = "X-OpenShock-Session"

func (a *API) handleAuthRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.AuthRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	resp, err := a.store.RegisterMember(req.Username, req.DisplayName, req.Password)
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, store.ErrConflict) {
			code = http.StatusConflict
		}
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.AuthLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	resp, err := a.store.LoginMember(req.Username, req.Password)
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, store.ErrUnauthorized) {
			code = http.StatusUnauthorized
		}
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	member, session, ok := a.memberFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusOK, core.AuthSessionStateResponse{Authenticated: false})
		return
	}

	writeJSON(w, http.StatusOK, core.AuthSessionStateResponse{
		Authenticated: true,
		Session:       &session,
		Member:        &member,
	})
}

func (a *API) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	token := sessionTokenFromRequest(r)
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "member session is required"})
		return
	}
	if !a.store.LogoutSession(token) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
		return
	}
	writeJSON(w, http.StatusOK, core.AuthLogoutResponse{LoggedOut: true})
}

func (a *API) handleAuthProfile(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		member, _, ok := a.memberFromRequest(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "member session is required"})
			return
		}
		writeJSON(w, http.StatusOK, core.AuthProfileResponse{Member: member})
	case http.MethodPatch:
		member, _, ok := a.memberFromRequest(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "member session is required"})
			return
		}

		var req core.AuthProfileUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
			return
		}

		updated, err := a.store.UpdateMemberDisplayName(member.ID, req.DisplayName)
		if err != nil {
			code := http.StatusBadRequest
			if errors.Is(err, store.ErrNotFound) {
				code = http.StatusNotFound
			}
			writeJSON(w, code, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, core.AuthProfileResponse{Member: updated})
	default:
		writeMethodNotAllowed(w)
	}
}

func (a *API) memberFromRequest(r *http.Request) (core.Member, core.AuthSession, bool) {
	token := sessionTokenFromRequest(r)
	if token == "" {
		return core.Member{}, core.AuthSession{}, false
	}
	return a.store.LookupMemberBySessionToken(token)
}

func (a *API) workspaceIDFromRequest(r *http.Request) string {
	_, session, ok := a.memberFromRequest(r)
	if ok && strings.TrimSpace(session.ActiveWorkspaceID) != "" {
		return strings.TrimSpace(session.ActiveWorkspaceID)
	}
	return a.store.WorkspaceID()
}

func (a *API) workspaceIDForActionTarget(req core.ActionRequest) (string, bool) {
	switch strings.TrimSpace(req.TargetType) {
	case "workspace":
		workspaceID := strings.TrimSpace(req.TargetID)
		return workspaceID, workspaceID != ""
	case "room":
		return a.store.WorkspaceIDForRoom(req.TargetID)
	case "issue":
		return a.store.WorkspaceIDForIssue(req.TargetID)
	case "task":
		return a.store.WorkspaceIDForTask(req.TargetID)
	case "run":
		return a.store.WorkspaceIDForRun(req.TargetID)
	case "merge_attempt":
		return a.store.WorkspaceIDForMergeAttempt(req.TargetID)
	case "delivery_pr":
		if issueID, ok := a.store.IssueIDForDeliveryPR(req.TargetID); ok {
			return a.store.WorkspaceIDForIssue(issueID)
		}
	}
	return "", false
}

func sessionTokenFromRequest(r *http.Request) string {
	if token := strings.TrimSpace(r.Header.Get(sessionHeaderName)); token != "" {
		return token
	}

	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(authHeader) > len("Bearer ") && strings.EqualFold(authHeader[:len("Bearer ")], "Bearer ") {
		return strings.TrimSpace(authHeader[len("Bearer "):])
	}

	return ""
}
