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

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemon.URL,
		Machine:     "shock-test",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  "2026-04-05T12:00:00Z",
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
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

func TestRuntimePairingPersistsWorkspaceBinding(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime":
			payload := map[string]any{
				"machine":       "shock-browser",
				"detectedCli":   []string{"codex", "claude"},
				"providers":     []map[string]any{{"id": "claude", "label": "Claude Code CLI", "mode": "direct-cli", "capabilities": []string{"conversation"}, "transport": "http bridge"}},
				"state":         "online",
				"workspaceRoot": root,
				"reportedAt":    "2026-04-05T12:00:00Z",
			}
			if err := json.NewEncoder(w).Encode(payload); err != nil {
				t.Fatalf("encode runtime payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"daemonUrl": daemon.URL})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST pairing error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pairing status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	snapshot := s.Snapshot().Workspace
	if snapshot.PairedRuntime != "shock-browser" {
		t.Fatalf("paired runtime = %q, want shock-browser", snapshot.PairedRuntime)
	}
	if snapshot.PairedRuntimeURL != daemon.URL {
		t.Fatalf("paired runtime url = %q, want %q", snapshot.PairedRuntimeURL, daemon.URL)
	}
	if snapshot.PairingStatus != "paired" {
		t.Fatalf("pairing status = %q, want paired", snapshot.PairingStatus)
	}
	if snapshot.DeviceAuth != "browser-approved" {
		t.Fatalf("device auth = %q, want browser-approved", snapshot.DeviceAuth)
	}

	restarted := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer restarted.Close()

	runtimeResp, err := http.Get(restarted.URL + "/v1/runtime")
	if err != nil {
		t.Fatalf("GET restarted runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("restarted runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}
}
