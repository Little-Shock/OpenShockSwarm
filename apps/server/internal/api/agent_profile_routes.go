package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerAgentProfileRoutes)
}

func registerAgentProfileRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/agents/", s.handleAgentRoutes)
}

type AgentProfileUpdateRequest struct {
	Role                  string   `json:"role"`
	Avatar                string   `json:"avatar"`
	Prompt                string   `json:"prompt"`
	OperatingInstructions string   `json:"operatingInstructions"`
	ProviderPreference    string   `json:"providerPreference"`
	ModelPreference       string   `json:"modelPreference"`
	RecallPolicy          string   `json:"recallPolicy"`
	RuntimePreference     string   `json:"runtimePreference"`
	MemorySpaces          []string `json:"memorySpaces"`
}

func (s *Server) handleAgentRoutes(w http.ResponseWriter, r *http.Request) {
	agentID := strings.TrimPrefix(r.URL.Path, "/v1/agents/")
	if strings.TrimSpace(agentID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		agent, ok := s.store.Agent(agentID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusOK, agent)
	case http.MethodPatch:
		if !s.requireSessionPermission(w, "workspace.manage") {
			return
		}

		var req AgentProfileUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		snapshot := s.store.Snapshot()
		nextState, agent, err := s.store.UpdateAgentProfile(agentID, store.AgentProfileUpdateInput{
			Role:                  req.Role,
			Avatar:                req.Avatar,
			Prompt:                req.Prompt,
			OperatingInstructions: req.OperatingInstructions,
			ProviderPreference:    req.ProviderPreference,
			ModelPreference:       req.ModelPreference,
			RecallPolicy:          req.RecallPolicy,
			RuntimePreference:     req.RuntimePreference,
			MemorySpaces:          req.MemorySpaces,
			UpdatedBy:             currentAuthActor(snapshot.Auth.Session),
		})
		if err != nil {
			writeAgentProfileError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"agent":  agent,
			"state":  nextState,
			"center": s.store.MemoryCenter(),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func writeAgentProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrAgentNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrAgentRoleRequired),
		errors.Is(err, store.ErrAgentAvatarRequired),
		errors.Is(err, store.ErrAgentPromptRequired),
		errors.Is(err, store.ErrAgentProviderPreferenceRequired),
		errors.Is(err, store.ErrAgentModelPreferenceRequired),
		errors.Is(err, store.ErrAgentRuntimePreferenceRequired),
		errors.Is(err, store.ErrAgentRecallPolicyInvalid),
		errors.Is(err, store.ErrAgentMemoryBindingRequired),
		errors.Is(err, store.ErrAgentMemorySpaceInvalid),
		errors.Is(err, store.ErrAgentRuntimePreferenceInvalid),
		errors.Is(err, store.ErrAgentProviderPreferenceInvalid),
		errors.Is(err, store.ErrAgentModelPreferenceInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
