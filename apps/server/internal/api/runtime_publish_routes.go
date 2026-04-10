package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerRuntimePublishRoutes)
}

type runtimePublishRequest struct {
	RuntimeID      string         `json:"runtimeId"`
	RunID          string         `json:"runId"`
	SessionID      string         `json:"sessionId,omitempty"`
	RoomID         string         `json:"roomId,omitempty"`
	Cursor         int            `json:"cursor"`
	Phase          string         `json:"phase"`
	Status         string         `json:"status"`
	Summary        string         `json:"summary"`
	IdempotencyKey string         `json:"idempotencyKey,omitempty"`
	FailureAnchor  string         `json:"failureAnchor,omitempty"`
	CloseoutReason string         `json:"closeoutReason,omitempty"`
	EvidenceLines  []string       `json:"evidenceLines,omitempty"`
	Payload        map[string]any `json:"payload,omitempty"`
	OccurredAt     string         `json:"occurredAt,omitempty"`
}

func registerRuntimePublishRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/runtime/publish", s.handleRuntimePublish)
	mux.HandleFunc("/v1/runtime/publish/replay", s.handleRuntimePublishReplay)
}

func (s *Server) handleRuntimePublish(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		afterSequence, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("cursor")))
		limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
		runID := strings.TrimSpace(r.URL.Query().Get("runId"))
		runtimeID := strings.TrimSpace(r.URL.Query().Get("runtimeId"))
		page := s.store.RuntimePublishRecords(afterSequence, limit, runID, runtimeID)
		writeJSON(w, http.StatusOK, map[string]any{
			"items":        sanitizeLivePayload(page.Items),
			"nextSequence": page.NextSequence,
			"hasMore":      page.HasMore,
		})
	case http.MethodPost:
		if !runtimeManageGuard(s, w) {
			return
		}
		var req runtimePublishRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		result, err := s.store.PublishRuntimeEvent(store.RuntimePublishInput{
			RuntimeID:      req.RuntimeID,
			RunID:          req.RunID,
			SessionID:      req.SessionID,
			RoomID:         req.RoomID,
			Cursor:         req.Cursor,
			Phase:          req.Phase,
			Status:         req.Status,
			Summary:        req.Summary,
			IdempotencyKey: req.IdempotencyKey,
			FailureAnchor:  req.FailureAnchor,
			CloseoutReason: req.CloseoutReason,
			EvidenceLines:  req.EvidenceLines,
			Payload:        req.Payload,
			OccurredAt:     req.OccurredAt,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		status := http.StatusAccepted
		if result.Deduped {
			status = http.StatusOK
		}
		if result.ErrorFamily != "" {
			switch result.ErrorFamily {
			case "not_found":
				status = http.StatusNotFound
			case "conflict":
				status = http.StatusConflict
			case "boundary_rejection":
				status = http.StatusUnprocessableEntity
			default:
				status = http.StatusInternalServerError
			}
		}
		writeJSON(w, status, map[string]any{
			"record":  sanitizeLivePayload(result.Record),
			"replay":  sanitizeLivePayload(result.Replay),
			"deduped": result.Deduped,
			"family":  result.ErrorFamily,
			"error":   result.ErrorMessage,
			"state":   result.State,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleRuntimePublishReplay(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	runID := strings.TrimSpace(r.URL.Query().Get("runId"))
	if runID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "runId is required"})
		return
	}
	packet, ok := s.store.RuntimeReplayEvidence(runID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "runtime replay not found"})
		return
	}
	writeJSON(w, http.StatusOK, sanitizeLivePayload(packet))
}
