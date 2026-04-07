package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerMemoryRoutes)
}

func registerMemoryRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/memory", s.handleMemory)
	mux.HandleFunc("/v1/memory/", s.handleMemoryRoutes)
	mux.HandleFunc("/v1/memory-center", s.handleMemoryCenter)
	mux.HandleFunc("/v1/memory-center/policy", s.handleMemoryCenterPolicy)
	mux.HandleFunc("/v1/memory-center/promotions", s.handleMemoryCenterPromotions)
	mux.HandleFunc("/v1/memory-center/promotions/", s.handleMemoryCenterPromotionRoutes)
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Memory)
}

func (s *Server) handleMemoryRoutes(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	memoryID := strings.TrimPrefix(r.URL.Path, "/v1/memory/")
	if strings.TrimSpace(memoryID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
		return
	}

	detail, ok := s.store.MemoryDetail(memoryID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

type MemoryPolicyRequest struct {
	Mode                     string `json:"mode"`
	IncludeRoomNotes         bool   `json:"includeRoomNotes"`
	IncludeDecisionLedger    bool   `json:"includeDecisionLedger"`
	IncludeAgentMemory       bool   `json:"includeAgentMemory"`
	IncludePromotedArtifacts bool   `json:"includePromotedArtifacts"`
	MaxItems                 int    `json:"maxItems"`
}

type MemoryPromotionRequest struct {
	MemoryID      string `json:"memoryId"`
	SourceVersion int    `json:"sourceVersion"`
	Kind          string `json:"kind"`
	Title         string `json:"title"`
	Rationale     string `json:"rationale"`
}

type MemoryPromotionReviewRequest struct {
	Status     string `json:"status"`
	ReviewNote string `json:"reviewNote"`
}

func (s *Server) handleMemoryCenter(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.MemoryCenter())
}

func (s *Server) handleMemoryCenterPolicy(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.MemoryCenter().Policy)
	case http.MethodPost:
		if !s.requireSessionPermission(w, "memory.write") {
			return
		}

		var req MemoryPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		snapshot := s.store.Snapshot()
		nextState, policy, center, err := s.store.UpdateMemoryPolicy(store.MemoryPolicyInput{
			Mode:                     req.Mode,
			IncludeRoomNotes:         req.IncludeRoomNotes,
			IncludeDecisionLedger:    req.IncludeDecisionLedger,
			IncludeAgentMemory:       req.IncludeAgentMemory,
			IncludePromotedArtifacts: req.IncludePromotedArtifacts,
			MaxItems:                 req.MaxItems,
			UpdatedBy:                currentAuthActor(snapshot.Auth.Session),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"policy": policy,
			"center": center,
			"state":  nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMemoryCenterPromotions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.MemoryCenter().Promotions)
	case http.MethodPost:
		if !s.requireSessionPermission(w, "memory.write") {
			return
		}

		var req MemoryPromotionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		snapshot := s.store.Snapshot()
		nextState, promotion, center, err := s.store.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
			MemoryID:      req.MemoryID,
			SourceVersion: req.SourceVersion,
			Kind:          req.Kind,
			Title:         req.Title,
			Rationale:     req.Rationale,
			ProposedBy:    currentAuthActor(snapshot.Auth.Session),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"promotion": promotion,
			"center":    center,
			"state":     nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMemoryCenterPromotionRoutes(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/v1/memory-center/promotions/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/memory-center/promotions/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "review" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory promotion not found"})
		return
	}
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireSessionPermission(w, "memory.write") {
		return
	}

	var req MemoryPromotionReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	snapshot := s.store.Snapshot()
	nextState, promotion, center, err := s.store.ReviewMemoryPromotion(parts[0], store.MemoryPromotionReviewInput{
		Status:     req.Status,
		ReviewNote: req.ReviewNote,
		ReviewedBy: currentAuthActor(snapshot.Auth.Session),
	})
	if err != nil {
		writeMemoryError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"promotion": promotion,
		"center":    center,
		"state":     nextState,
	})
}

func currentAuthActor(session store.AuthSession) string {
	if strings.TrimSpace(session.Name) != "" {
		return strings.TrimSpace(session.Name)
	}
	if strings.TrimSpace(session.Email) != "" {
		return strings.TrimSpace(session.Email)
	}
	return "System"
}

func writeMemoryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrMemoryPolicyModeInvalid),
		errors.Is(err, store.ErrMemoryPolicyMaxItemsInvalid),
		errors.Is(err, store.ErrMemoryPromotionKindInvalid),
		errors.Is(err, store.ErrMemoryPromotionTitleRequired),
		errors.Is(err, store.ErrMemoryPromotionReviewInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrMemoryArtifactNotFound),
		errors.Is(err, store.ErrMemoryPromotionNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
