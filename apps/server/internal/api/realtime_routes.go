package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerRealtimeRoutes)
}

func registerRealtimeRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/state/stream", s.handleStateStream)
}

type StateStreamPresence struct {
	OnlineMachines int `json:"onlineMachines"`
	BusyMachines   int `json:"busyMachines"`
	RunningAgents  int `json:"runningAgents"`
	BlockedAgents  int `json:"blockedAgents"`
	ActiveRuns     int `json:"activeRuns"`
	Unread         int `json:"unread"`
}

type StateStreamEvent struct {
	Type     string              `json:"type"`
	Sequence int                 `json:"sequence"`
	SentAt   string              `json:"sentAt"`
	Presence StateStreamPresence `json:"presence"`
	State    store.State         `json:"state"`
}

func (s *Server) handleStateStream(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	subID, updates := s.store.SubscribeState()
	defer s.store.UnsubscribeState(subID)

	sequence := 1
	if err := writeSSEEvent(w, flusher, "snapshot", buildStateStreamEvent(s.store.Snapshot(), sequence)); err != nil {
		return
	}

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case snapshot, ok := <-updates:
			if !ok {
				return
			}
			sequence++
			if err := writeSSEEvent(w, flusher, "snapshot", buildStateStreamEvent(snapshot, sequence)); err != nil {
				return
			}
		case <-keepalive.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func buildStateStreamEvent(snapshot store.State, sequence int) StateStreamEvent {
	return StateStreamEvent{
		Type:     "snapshot",
		Sequence: sequence,
		SentAt:   time.Now().UTC().Format(time.RFC3339),
		Presence: buildStateStreamPresence(snapshot),
		State:    snapshot,
	}
}

func buildStateStreamPresence(snapshot store.State) StateStreamPresence {
	presence := StateStreamPresence{}
	for _, machine := range snapshot.Machines {
		switch strings.ToLower(strings.TrimSpace(machine.State)) {
		case "busy":
			presence.BusyMachines++
		case "online":
			presence.OnlineMachines++
		}
	}
	for _, agent := range snapshot.Agents {
		switch strings.ToLower(strings.TrimSpace(agent.State)) {
		case "running":
			presence.RunningAgents++
		case "blocked":
			presence.BlockedAgents++
		}
	}
	for _, run := range snapshot.Runs {
		switch strings.ToLower(strings.TrimSpace(run.Status)) {
		case "running", "queued", "waiting":
			presence.ActiveRuns++
		}
	}
	for _, channel := range snapshot.Channels {
		presence.Unread += channel.Unread
	}
	for _, room := range snapshot.Rooms {
		presence.Unread += room.Unread
	}
	return presence
}

func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\n", event); err != nil {
		return err
	}
	for _, line := range strings.Split(string(body), "\n") {
		if _, err := fmt.Fprintf(w, "data: %s\n", line); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprint(w, "\n"); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}
