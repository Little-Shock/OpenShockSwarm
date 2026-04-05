package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRoomMessageStreamPersistsConversation(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Streaming Ready",
		Summary:  "verify room streaming flow",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(created.RunID, created.SessionID, store.LaneBinding{
		Branch:       created.Branch,
		WorktreeName: created.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", created.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec/stream" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		events := []DaemonStreamEvent{
			{Type: "start", Provider: "claude", Command: []string{"claude", "--bare"}},
			{Type: "stdout", Provider: "claude", Delta: "第一行输出\n"},
			{Type: "stdout", Provider: "claude", Delta: "第二行输出"},
			{Type: "done", Provider: "claude", Output: "第一行输出\n第二行输出", Duration: "1.2s"},
		}
		for _, event := range events {
			if err := json.NewEncoder(w).Encode(event); err != nil {
				t.Fatalf("encode event: %v", err)
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "给我一个两行结论",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var events []DaemonStreamEvent
	for scanner.Scan() {
		var event DaemonStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}

	if len(events) < 4 {
		t.Fatalf("expected stream events, got %#v", events)
	}
	last := events[len(events)-1]
	if last.Type != "state" || last.State == nil {
		t.Fatalf("last event = %#v, want state with payload", last)
	}

	detail, ok := s.RoomDetail(created.RoomID)
	if !ok {
		t.Fatalf("RoomDetail(%q) not found", created.RoomID)
	}
	if len(detail.Messages) < 3 {
		t.Fatalf("expected persisted conversation messages, got %#v", detail.Messages)
	}
	agentMessage := detail.Messages[len(detail.Messages)-1].Message
	if !strings.Contains(agentMessage, "第一行输出") || !strings.Contains(agentMessage, "第二行输出") {
		t.Fatalf("agent message = %q, want streamed output", agentMessage)
	}
}
