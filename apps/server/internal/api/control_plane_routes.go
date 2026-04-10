package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerControlPlaneRoutes)
}

type controlPlaneCommandRequest struct {
	Kind           string          `json:"kind"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Actor          string          `json:"actor,omitempty"`
	Payload        json.RawMessage `json:"payload"`
}

type controlPlaneIssueCreatePayload struct {
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Owner    string `json:"owner"`
	Priority string `json:"priority"`
}

type controlPlaneRunControlPayload struct {
	RunID  string `json:"runId"`
	Action string `json:"action"`
	Note   string `json:"note,omitempty"`
}

type controlPlaneRuntimeSelectionPayload struct {
	Machine string `json:"machine"`
}

func registerControlPlaneRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/control-plane/commands", s.handleControlPlaneCommands)
	mux.HandleFunc("/v1/control-plane/events", s.handleControlPlaneEvents)
	mux.HandleFunc("/v1/control-plane/debug/commands/", s.handleControlPlaneCommandDebug)
	mux.HandleFunc("/v1/control-plane/debug/rejections", s.handleControlPlaneRejections)
}

func (s *Server) handleControlPlaneCommands(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !s.requireSessionPermission(w, "run.execute") {
		return
	}

	var req controlPlaneCommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	payloadMap, input, err := decodeControlPlaneCommandRequest(req, currentAuthActor(s.store.Snapshot().Auth.Session))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	input.Payload = payloadMap

	result, err := s.store.SubmitControlPlaneCommand(input)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	status := http.StatusOK
	if result.Command.Status == "rejected" {
		switch result.Command.ErrorFamily {
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
		"command":   result.Command,
		"events":    result.Events,
		"rejection": result.Rejection,
		"deduped":   result.Deduped,
		"state":     result.State,
		"family":    result.Command.ErrorFamily,
		"error":     result.Command.ErrorMessage,
	})
}

func decodeControlPlaneCommandRequest(req controlPlaneCommandRequest, fallbackActor string) (map[string]any, store.ControlPlaneCommandInput, error) {
	payloadMap := map[string]any{}
	if len(req.Payload) > 0 {
		if err := json.Unmarshal(req.Payload, &payloadMap); err != nil {
			return nil, store.ControlPlaneCommandInput{}, err
		}
	}

	input := store.ControlPlaneCommandInput{
		Kind:           strings.TrimSpace(req.Kind),
		IdempotencyKey: strings.TrimSpace(req.IdempotencyKey),
		Actor:          defaultString(strings.TrimSpace(req.Actor), fallbackActor),
	}

	switch strings.TrimSpace(req.Kind) {
	case "issue.create":
		var payload controlPlaneIssueCreatePayload
		if len(req.Payload) > 0 {
			if err := json.Unmarshal(req.Payload, &payload); err != nil {
				return nil, store.ControlPlaneCommandInput{}, err
			}
		}
		input.IssueCreate = &store.CreateIssueInput{
			Title:    payload.Title,
			Summary:  payload.Summary,
			Owner:    payload.Owner,
			Priority: payload.Priority,
		}
	case "run.control":
		var payload controlPlaneRunControlPayload
		if len(req.Payload) > 0 {
			if err := json.Unmarshal(req.Payload, &payload); err != nil {
				return nil, store.ControlPlaneCommandInput{}, err
			}
		}
		input.RunControl = &store.ControlPlaneRunControlInput{
			RunID:  payload.RunID,
			Action: payload.Action,
			Note:   payload.Note,
		}
	case "runtime.selection.set":
		var payload controlPlaneRuntimeSelectionPayload
		if len(req.Payload) > 0 {
			if err := json.Unmarshal(req.Payload, &payload); err != nil {
				return nil, store.ControlPlaneCommandInput{}, err
			}
		}
		input.RuntimeSelection = &store.ControlPlaneRuntimeSelectionInput{Machine: payload.Machine}
	}

	return payloadMap, input, nil
}

func (s *Server) handleControlPlaneEvents(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cursor, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("cursor")))
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	writeJSON(w, http.StatusOK, s.store.ControlPlaneEvents(cursor, limit))
}

func (s *Server) handleControlPlaneCommandDebug(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	commandID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/control-plane/debug/commands/"), "/")
	if commandID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "command not found"})
		return
	}
	view, ok := s.store.ControlPlaneCommandDebug(commandID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "command not found"})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleControlPlaneRejections(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	commandID := strings.TrimSpace(r.URL.Query().Get("commandId"))
	family := strings.TrimSpace(r.URL.Query().Get("family"))
	writeJSON(w, http.StatusOK, s.store.ControlPlaneRejections(commandID, family, limit))
}
