package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerTopicRoutes)
}

func registerTopicRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/topics/", s.handleTopicRoutes)
}

type TopicGuidanceUpdateRequest struct {
	Summary string `json:"summary"`
}

func (s *Server) handleTopicRoutes(w http.ResponseWriter, r *http.Request) {
	topicID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/topics/"), "/")
	if strings.TrimSpace(topicID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "topic not found"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		snapshot := s.store.Snapshot()
		for _, room := range snapshot.Rooms {
			if room.Topic.ID != topicID {
				continue
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"topic": room.Topic,
				"room":  room,
				"state": snapshot,
			})
			return
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "topic not found"})
	case http.MethodPatch:
		if !s.requireSessionPermission(w, "room.reply") {
			return
		}

		var req TopicGuidanceUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		snapshot := s.store.Snapshot()
		nextState, room, err := s.store.UpdateTopicGuidance(topicID, store.TopicGuidanceUpdateInput{
			Summary:   req.Summary,
			UpdatedBy: currentAuthActor(snapshot.Auth.Session),
		})
		if err != nil {
			writeTopicGuidanceError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"topic": room.Topic,
			"room":  room,
			"state": nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func writeTopicGuidanceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrTopicNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrTopicGuidanceRequired):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
