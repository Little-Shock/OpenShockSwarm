package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerMailboxRoutes)
}

type CreateMailboxHandoffRequest struct {
	RoomID      string `json:"roomId"`
	FromAgentID string `json:"fromAgentId"`
	ToAgentID   string `json:"toAgentId"`
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	Kind        string `json:"kind,omitempty"`
}

type CreateGovernedMailboxHandoffRequest struct {
	RoomID string `json:"roomId"`
}

type UpdateMailboxHandoffRequest struct {
	Action                string `json:"action"`
	ActingAgentID         string `json:"actingAgentId"`
	Note                  string `json:"note"`
	ContinueGovernedRoute bool   `json:"continueGovernedRoute,omitempty"`
}

func registerMailboxRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/mailbox/governed", s.handleGovernedMailbox)
	mux.HandleFunc("/v1/mailbox", s.handleMailbox)
	mux.HandleFunc("/v1/mailbox/", s.handleMailboxRoutes)
}

func (s *Server) handleGovernedMailbox(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		if !s.requireSessionPermission(w, "run.execute") {
			return
		}

		var req CreateGovernedMailboxHandoffRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, handoff, suggestion, err := s.store.CreateGovernedHandoffForRoom(req.RoomID)
		if err != nil {
			writeMailboxError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"handoff":    sanitizeLivePayload(handoff),
			"suggestion": sanitizeLivePayload(suggestion),
			"state":      sanitizeLivePayload(nextState),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMailbox(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.Snapshot().Mailbox))
	case http.MethodPost:
		if !s.requireSessionPermission(w, "run.execute") {
			return
		}

		var req CreateMailboxHandoffRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, handoff, err := s.store.CreateHandoff(store.MailboxCreateInput{
			RoomID:      req.RoomID,
			FromAgentID: req.FromAgentID,
			ToAgentID:   req.ToAgentID,
			Title:       req.Title,
			Summary:     req.Summary,
			Kind:        req.Kind,
		})
		if err != nil {
			writeMailboxError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"handoff": sanitizeLivePayload(handoff),
			"state":   sanitizeLivePayload(nextState),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMailboxRoutes(w http.ResponseWriter, r *http.Request) {
	handoffID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/mailbox/"), "/")
	if handoffID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "handoff not found"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		handoff, ok := s.store.Handoff(handoffID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "handoff not found"})
			return
		}
		writeJSON(w, http.StatusOK, sanitizeLivePayload(handoff))
	case http.MethodPost:
		if !s.requireSessionPermission(w, "run.execute") {
			return
		}

		var req UpdateMailboxHandoffRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, handoff, err := s.store.AdvanceHandoff(handoffID, store.MailboxUpdateInput{
			Action:                req.Action,
			ActingAgentID:         req.ActingAgentID,
			Note:                  req.Note,
			ContinueGovernedRoute: req.ContinueGovernedRoute,
		})
		if err != nil {
			writeMailboxError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"handoff": sanitizeLivePayload(handoff),
			"state":   sanitizeLivePayload(nextState),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func writeMailboxError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrMailboxTitleRequired),
		errors.Is(err, store.ErrMailboxSummaryRequired),
		errors.Is(err, store.ErrMailboxGovernedRoomRequired),
		errors.Is(err, store.ErrMailboxFromAgentRequired),
		errors.Is(err, store.ErrMailboxToAgentRequired),
		errors.Is(err, store.ErrMailboxSameAgent),
		errors.Is(err, store.ErrMailboxActionInvalid),
		errors.Is(err, store.ErrMailboxTransitionInvalid),
		errors.Is(err, store.ErrMailboxBlockedNoteRequired),
		errors.Is(err, store.ErrMailboxCommentRequired),
		errors.Is(err, store.ErrMailboxActingAgentRequired):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrMailboxGovernedRouteNotReady):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrMailboxRoomNotFound),
		errors.Is(err, store.ErrMailboxAgentNotFound),
		errors.Is(err, store.ErrMailboxHandoffNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrMailboxActingAgentForbidden),
		errors.Is(err, store.ErrMailboxCommentAgentForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
