package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerMessageSurfaceRoutes)
}

func registerMessageSurfaceRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/direct-messages", s.handleDirectMessages)
	mux.HandleFunc("/v1/direct-messages/", s.handleDirectMessageRoutes)
	mux.HandleFunc("/v1/message-surface/collections", s.handleMessageSurfaceCollections)
}

type DirectMessageRequest struct {
	Prompt           string `json:"prompt"`
	ReplyToMessageID string `json:"replyToMessageId,omitempty"`
}

type MessageSurfaceCollectionRequest struct {
	Kind      string `json:"kind"`
	ChannelID string `json:"channelId"`
	MessageID string `json:"messageId"`
	Enabled   bool   `json:"enabled"`
}

func (s *Server) handleDirectMessages(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.sanitizedLiveStateSnapshotForRequest(r).DirectMessages)
}

func (s *Server) handleDirectMessageRoutes(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/direct-messages/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 1 && r.Method == http.MethodGet {
		dmID := strings.TrimSpace(parts[0])
		if dmID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "direct message not found"})
			return
		}
		snapshot := s.sanitizedLiveStateSnapshotForRequest(r)
		for _, dm := range snapshot.DirectMessages {
			if dm.ID == dmID {
				writeJSON(w, http.StatusOK, map[string]any{
					"directMessage": dm,
					"messages":      snapshot.DirectMessageMessages[dmID],
				})
				return
			}
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "direct message not found"})
		return
	}
	if len(parts) != 2 || parts[1] != "messages" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "direct message route not found"})
		return
	}
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "room.reply") {
		return
	}

	var req DirectMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
		return
	}

	nextState, err := s.store.AppendDirectMessageConversation(parts[0], req.Prompt, s.currentRequestAuthActor(r), req.ReplyToMessageID)
	if err != nil {
		writeMessageSurfaceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": s.sanitizedStateSnapshotForRequest(nextState, r)})
}

func (s *Server) handleMessageSurfaceCollections(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "room.reply") {
		return
	}

	var req MessageSurfaceCollectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	nextState, entry, err := s.store.UpdateMessageSurfaceCollection(store.MessageSurfaceCollectionUpdateInput{
		Kind:      req.Kind,
		ChannelID: req.ChannelID,
		MessageID: req.MessageID,
		Enabled:   req.Enabled,
	})
	if err != nil {
		writeMessageSurfaceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": entry, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
}

func writeMessageSurfaceError(w http.ResponseWriter, err error) {
	switch err.Error() {
	case "direct message not found", "message surface target not found":
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case "unsupported collection kind":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
}
