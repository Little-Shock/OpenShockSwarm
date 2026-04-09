package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerCredentialRoutes)
}

type CredentialProfileRequest struct {
	Label            string `json:"label"`
	Summary          string `json:"summary"`
	SecretKind       string `json:"secretKind"`
	SecretValue      string `json:"secretValue"`
	WorkspaceDefault bool   `json:"workspaceDefault"`
}

func registerCredentialRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/credentials", s.handleCredentials)
	mux.HandleFunc("/v1/credentials/", s.handleCredentialRoutes)
}

func (s *Server) handleCredentials(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.Snapshot().Credentials))
	case http.MethodPost:
		if !s.requireSessionPermission(w, "workspace.manage") {
			return
		}
		var req CredentialProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, profile, err := s.store.CreateCredentialProfile(store.CredentialProfileCreateInput{
			Label:            req.Label,
			Summary:          req.Summary,
			SecretKind:       req.SecretKind,
			SecretValue:      req.SecretValue,
			WorkspaceDefault: req.WorkspaceDefault,
			UpdatedBy:        currentAuthActor(s.store.Snapshot().Auth.Session),
		})
		if err != nil {
			writeCredentialProfileError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"credential": profile,
			"state":      nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleCredentialRoutes(w http.ResponseWriter, r *http.Request) {
	profileID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/credentials/"), "/")
	if profileID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "credential profile not found"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		for _, profile := range s.store.Snapshot().Credentials {
			if profile.ID == profileID {
				writeJSON(w, http.StatusOK, sanitizeLivePayload(profile))
				return
			}
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": store.ErrCredentialProfileNotFound.Error()})
	case http.MethodPatch:
		if !s.requireSessionPermission(w, "workspace.manage") {
			return
		}
		var req CredentialProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, profile, err := s.store.UpdateCredentialProfile(profileID, store.CredentialProfileUpdateInput{
			Label:            req.Label,
			Summary:          req.Summary,
			SecretKind:       req.SecretKind,
			SecretValue:      req.SecretValue,
			WorkspaceDefault: req.WorkspaceDefault,
			UpdatedBy:        currentAuthActor(s.store.Snapshot().Auth.Session),
		})
		if err != nil {
			writeCredentialProfileError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"credential": profile,
			"state":      nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func writeCredentialProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrCredentialProfileNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrCredentialProfileLabelRequired),
		errors.Is(err, store.ErrCredentialProfileKindRequired),
		errors.Is(err, store.ErrCredentialProfileSecretRequired),
		errors.Is(err, store.ErrCredentialProfileBindingInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
