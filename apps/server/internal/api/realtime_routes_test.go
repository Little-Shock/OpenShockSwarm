package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestStateStreamEmitsInitialSnapshotAndUpdates(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/state/stream", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET state stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("state stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("state stream content-type = %q, want text/event-stream", contentType)
	}

	reader := bufio.NewReader(resp.Body)
	first := readStateStreamEvent(t, reader)
	if first.Type != "snapshot" || first.Sequence != 1 {
		t.Fatalf("first event = %#v, want snapshot seq=1", first)
	}
	if first.Presence.Unread == 0 {
		t.Fatalf("first presence = %#v, want seeded unread truth", first.Presence)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-realtime",
		DaemonURL:          "http://127.0.0.1:8092",
		Machine:            "shock-realtime",
		DetectedCLI:        []string{"codex"},
		State:              "busy",
		WorkspaceRoot:      root,
		ReportedAt:         reportedAt,
		HeartbeatIntervalS: 12,
		HeartbeatTimeoutS:  48,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat() error = %v", err)
	}

	second := readStateStreamEvent(t, reader)
	if second.Type != "snapshot" || second.Sequence != 2 {
		t.Fatalf("second event = %#v, want snapshot seq=2", second)
	}
	if second.Presence.BusyMachines == 0 {
		t.Fatalf("second presence = %#v, want busy machine truth", second.Presence)
	}
	if !stateHasRuntime(second.State, "shock-realtime") {
		t.Fatalf("second state runtimes = %#v, want shock-realtime", second.State.Runtimes)
	}
}

func readStateStreamEvent(t *testing.T, reader *bufio.Reader) StateStreamEvent {
	t.Helper()

	var event string
	var data strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("ReadString() error = %v", err)
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		switch {
		case strings.HasPrefix(line, ":"):
			continue
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
		case strings.HasPrefix(line, "data: "):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(line, "data: "))
		}
	}

	if event != "snapshot" {
		t.Fatalf("event name = %q, want snapshot", event)
	}

	var payload StateStreamEvent
	if err := json.Unmarshal([]byte(data.String()), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	return payload
}

func stateHasRuntime(snapshot store.State, runtimeID string) bool {
	for _, item := range snapshot.Runtimes {
		if item.ID == runtimeID || item.Machine == runtimeID {
			return true
		}
	}
	return false
}
