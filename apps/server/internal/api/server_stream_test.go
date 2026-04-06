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
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRoomMessageStreamPersistsConversation(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)

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
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
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
	reportedAt := time.Now().UTC().Format(time.RFC3339)

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
				"reportedAt":    reportedAt,
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

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/runtime/pairing", nil)
	if err != nil {
		t.Fatalf("NewRequest(DELETE) error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE pairing error = %v", err)
	}
	defer deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("delete pairing status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	workspaceAfterDelete := s.Snapshot().Workspace
	if workspaceAfterDelete.PairingStatus != "unpaired" {
		t.Fatalf("pairing status after delete = %q, want unpaired", workspaceAfterDelete.PairingStatus)
	}
	if workspaceAfterDelete.DeviceAuth != "revoked" {
		t.Fatalf("device auth after delete = %q, want revoked", workspaceAfterDelete.DeviceAuth)
	}

	restartedAfterDelete := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer restartedAfterDelete.Close()
	offlineResp, err := http.Get(restartedAfterDelete.URL + "/v1/runtime")
	if err != nil {
		t.Fatalf("GET runtime after delete error = %v", err)
	}
	defer offlineResp.Body.Close()
	var offlinePayload RuntimeSnapshotResponse
	if err := json.NewDecoder(offlineResp.Body).Decode(&offlinePayload); err != nil {
		t.Fatalf("Decode offline runtime payload error = %v", err)
	}
	if offlinePayload.State != "offline" {
		t.Fatalf("offline runtime state = %q, want offline", offlinePayload.State)
	}
}

func TestRuntimeRegistryTracksHeartbeatsAndPairingSelection(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	var mainDaemonURL string
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-main",
			DaemonURL:          mainDaemonURL,
			Machine:            "shock-main",
			DetectedCLI:        []string{"codex"},
			Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer mainDaemon.Close()
	mainDaemonURL = mainDaemon.URL

	var sidecarDaemonURL string
	sidecarDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-sidecar",
			DaemonURL:          sidecarDaemonURL,
			Machine:            "shock-sidecar",
			DetectedCLI:        []string{"claude"},
			Providers:          []store.RuntimeProvider{{ID: "claude", Label: "Claude Code CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer sidecarDaemon.Close()
	sidecarDaemonURL = sidecarDaemon.URL

	mainPayload := RuntimeSnapshotResponse{
		RuntimeID:          "shock-main",
		DaemonURL:          mainDaemonURL,
		Machine:            "shock-main",
		DetectedCLI:        []string{"codex"},
		Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
		State:              "online",
		WorkspaceRoot:      root,
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}
	sidecarPayload := RuntimeSnapshotResponse{
		RuntimeID:          "shock-sidecar",
		DaemonURL:          sidecarDaemonURL,
		Machine:            "shock-sidecar",
		DetectedCLI:        []string{"claude"},
		Providers:          []store.RuntimeProvider{{ID: "claude", Label: "Claude Code CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
		State:              "online",
		WorkspaceRoot:      root,
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     mainDaemonURL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	for _, payload := range []RuntimeSnapshotResponse{mainPayload, sidecarPayload} {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("Marshal heartbeat payload error = %v", err)
		}
		resp, err := http.Post(server.URL+"/v1/runtime/heartbeats", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("POST heartbeat error = %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("heartbeat status = %d, want %d", resp.StatusCode, http.StatusOK)
		}
	}

	pairBody, err := json.Marshal(map[string]any{"runtimeId": "shock-sidecar"})
	if err != nil {
		t.Fatalf("Marshal pairing body error = %v", err)
	}
	pairResp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(pairBody))
	if err != nil {
		t.Fatalf("POST runtime pairing error = %v", err)
	}
	defer pairResp.Body.Close()
	if pairResp.StatusCode != http.StatusOK {
		t.Fatalf("pairing status = %d, want %d", pairResp.StatusCode, http.StatusOK)
	}

	registryResp, err := http.Get(server.URL + "/v1/runtime/registry")
	if err != nil {
		t.Fatalf("GET runtime registry error = %v", err)
	}
	defer registryResp.Body.Close()
	if registryResp.StatusCode != http.StatusOK {
		t.Fatalf("registry status = %d, want %d", registryResp.StatusCode, http.StatusOK)
	}

	var registryPayload struct {
		PairedRuntime string                `json:"pairedRuntime"`
		PairingStatus string                `json:"pairingStatus"`
		Runtimes      []store.RuntimeRecord `json:"runtimes"`
	}
	if err := json.NewDecoder(registryResp.Body).Decode(&registryPayload); err != nil {
		t.Fatalf("Decode runtime registry error = %v", err)
	}
	if registryPayload.PairedRuntime != "shock-sidecar" {
		t.Fatalf("paired runtime = %q, want shock-sidecar", registryPayload.PairedRuntime)
	}
	if registryPayload.PairingStatus != "paired" {
		t.Fatalf("pairing status = %q, want paired", registryPayload.PairingStatus)
	}
	if len(registryPayload.Runtimes) < 2 {
		t.Fatalf("runtime registry = %#v, want at least two runtimes", registryPayload.Runtimes)
	}

	var sidecar *store.RuntimeRecord
	var main *store.RuntimeRecord
	for index := range registryPayload.Runtimes {
		switch registryPayload.Runtimes[index].ID {
		case "shock-sidecar":
			sidecar = &registryPayload.Runtimes[index]
		case "shock-main":
			main = &registryPayload.Runtimes[index]
		}
	}
	if sidecar == nil || sidecar.PairingState != "paired" || sidecar.DaemonURL != sidecarDaemonURL {
		t.Fatalf("sidecar runtime = %#v, want paired runtime record", sidecar)
	}
	if main == nil || main.PairingState != "available" {
		t.Fatalf("main runtime = %#v, want available runtime record", main)
	}
}

func TestRuntimePairingRejectsExplicitRuntimeWithoutDaemonURL(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	var mainDaemonURL string
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-main",
			DaemonURL:          mainDaemonURL,
			Machine:            "shock-main",
			DetectedCLI:        []string{"codex"},
			Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer mainDaemon.Close()
	mainDaemonURL = mainDaemon.URL

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:   "shock-main",
		DaemonURL:   mainDaemonURL,
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-sidecar",
		Machine:            "shock-sidecar",
		State:              "online",
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     mainDaemonURL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"runtimeId": "shock-sidecar"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime pairing error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("pairing status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode error payload error = %v", err)
	}
	if payload["error"] != "runtime shock-sidecar is not paired to a daemon" {
		t.Fatalf("error payload = %#v, want explicit daemon contract", payload)
	}

	snapshot := s.Snapshot()
	if snapshot.Workspace.PairedRuntime != "shock-main" || snapshot.Workspace.PairedRuntimeURL != mainDaemonURL {
		t.Fatalf("workspace pairing = %#v, want existing main pairing untouched", snapshot.Workspace)
	}

	var sidecar *store.RuntimeRecord
	for index := range snapshot.Runtimes {
		if snapshot.Runtimes[index].ID == "shock-sidecar" {
			sidecar = &snapshot.Runtimes[index]
			break
		}
	}
	if sidecar == nil || sidecar.Machine != "shock-sidecar" || sidecar.DaemonURL != "" {
		t.Fatalf("sidecar runtime = %#v, want registry untouched", sidecar)
	}
}

func TestRuntimePairingRejectsExplicitRuntimeIdentityMismatch(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	var mainDaemonURL string
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-main",
			DaemonURL:          mainDaemonURL,
			Machine:            "shock-main",
			DetectedCLI:        []string{"codex"},
			Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer mainDaemon.Close()
	mainDaemonURL = mainDaemon.URL

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     mainDaemonURL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"runtimeId": "shock-sidecar",
		"daemonUrl": mainDaemonURL,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime pairing error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("pairing status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode error payload error = %v", err)
	}
	if payload["error"] != "runtime shock-sidecar resolved to shock-main" {
		t.Fatalf("error payload = %#v, want explicit identity mismatch", payload)
	}

	snapshot := s.Snapshot()
	if snapshot.Workspace.PairedRuntime != "" || snapshot.Workspace.PairedRuntimeURL != "" {
		t.Fatalf("workspace pairing = %#v, want pairing to remain empty", snapshot.Workspace)
	}
}

func TestRuntimeSelectionExposesMultiRuntimeSurfaceAndDispatchesByRun(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	mainWorktreeHits := 0
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime":
			if err := json.NewEncoder(w).Encode(map[string]any{
				"machine":       "shock-main",
				"detectedCli":   []string{"codex"},
				"providers":     []map[string]any{{"id": "codex", "label": "Codex CLI", "mode": "direct-cli", "capabilities": []string{"conversation", "patch"}, "transport": "http bridge"}},
				"state":         "online",
				"workspaceRoot": root,
				"reportedAt":    "2026-04-06T12:40:00Z",
			}); err != nil {
				t.Fatalf("encode main runtime payload: %v", err)
			}
		case "/v1/worktrees/ensure":
			mainWorktreeHits++
			var req WorktreeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode main worktree request: %v", err)
			}
			if err := json.NewEncoder(w).Encode(WorktreeResponse{
				WorkspaceRoot: req.WorkspaceRoot,
				Branch:        req.Branch,
				WorktreeName:  req.WorktreeName,
				Path:          filepath.Join(root, ".openshock-worktrees", "main", req.WorktreeName),
				Created:       true,
				BaseRef:       req.BaseRef,
			}); err != nil {
				t.Fatalf("encode main worktree payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer mainDaemon.Close()

	sidecarWorktreeHits := 0
	sidecarDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime":
			if err := json.NewEncoder(w).Encode(map[string]any{
				"machine":       "shock-sidecar",
				"detectedCli":   []string{"claude"},
				"providers":     []map[string]any{{"id": "claude", "label": "Claude Code CLI", "mode": "direct-cli", "capabilities": []string{"conversation"}, "transport": "http bridge"}},
				"state":         "online",
				"workspaceRoot": root,
				"reportedAt":    "2026-04-06T12:41:00Z",
			}); err != nil {
				t.Fatalf("encode sidecar runtime payload: %v", err)
			}
		case "/v1/worktrees/ensure":
			sidecarWorktreeHits++
			var req WorktreeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode sidecar worktree request: %v", err)
			}
			if err := json.NewEncoder(w).Encode(WorktreeResponse{
				WorkspaceRoot: req.WorkspaceRoot,
				Branch:        req.Branch,
				WorktreeName:  req.WorktreeName,
				Path:          filepath.Join(root, ".openshock-worktrees", "sidecar", req.WorktreeName),
				Created:       true,
				BaseRef:       req.BaseRef,
			}); err != nil {
				t.Fatalf("encode sidecar worktree payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer sidecarDaemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   mainDaemon.URL,
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  "2026-04-06T12:40:00Z",
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   sidecarDaemon.URL,
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  "2026-04-06T12:41:00Z",
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(sidecar) error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	selectBody, err := json.Marshal(map[string]any{"machine": "shock-main"})
	if err != nil {
		t.Fatalf("Marshal() selection error = %v", err)
	}
	selectResp, err := http.Post(server.URL+"/v1/runtime/selection", "application/json", bytes.NewReader(selectBody))
	if err != nil {
		t.Fatalf("POST runtime selection error = %v", err)
	}
	defer selectResp.Body.Close()
	if selectResp.StatusCode != http.StatusOK {
		t.Fatalf("runtime selection status = %d, want %d", selectResp.StatusCode, http.StatusOK)
	}

	var selectionPayload struct {
		Selection RuntimeSelectionResponse `json:"selection"`
		State     store.State              `json:"state"`
	}
	if err := json.NewDecoder(selectResp.Body).Decode(&selectionPayload); err != nil {
		t.Fatalf("decode selection payload: %v", err)
	}
	if selectionPayload.Selection.SelectedRuntime != "shock-main" {
		t.Fatalf("selected runtime = %q, want shock-main", selectionPayload.Selection.SelectedRuntime)
	}
	if len(selectionPayload.Selection.Runtimes) < 2 {
		t.Fatalf("selection runtimes = %#v, want at least 2", selectionPayload.Selection.Runtimes)
	}

	runtimeResp, err := http.Get(server.URL + "/v1/runtime?machine=shock-sidecar")
	if err != nil {
		t.Fatalf("GET sidecar runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("sidecar runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}

	var runtimePayload RuntimeSnapshotResponse
	if err := json.NewDecoder(runtimeResp.Body).Decode(&runtimePayload); err != nil {
		t.Fatalf("decode sidecar runtime payload: %v", err)
	}
	if runtimePayload.Machine != "shock-sidecar" {
		t.Fatalf("runtime payload machine = %q, want shock-sidecar", runtimePayload.Machine)
	}

	issueBody, err := json.Marshal(map[string]any{
		"title":    "Dispatch To Preferred Runtime",
		"summary":  "verify run dispatch uses runtime preference",
		"owner":    "Claude Review Runner",
		"priority": "high",
	})
	if err != nil {
		t.Fatalf("Marshal() issue error = %v", err)
	}
	issueResp, err := http.Post(server.URL+"/v1/issues", "application/json", bytes.NewReader(issueBody))
	if err != nil {
		t.Fatalf("POST issue error = %v", err)
	}
	defer issueResp.Body.Close()
	if issueResp.StatusCode != http.StatusCreated {
		t.Fatalf("issue status = %d, want %d", issueResp.StatusCode, http.StatusCreated)
	}

	var issuePayload struct {
		RunID string      `json:"runId"`
		State store.State `json:"state"`
	}
	if err := json.NewDecoder(issueResp.Body).Decode(&issuePayload); err != nil {
		t.Fatalf("decode issue payload: %v", err)
	}

	run := findRunSnapshotByID(issuePayload.State, issuePayload.RunID)
	if run == nil {
		t.Fatalf("run %q missing from issue payload", issuePayload.RunID)
	}
	if run.Runtime != "shock-sidecar" || run.Machine != "shock-sidecar" {
		t.Fatalf("run scheduling = runtime %q machine %q, want shock-sidecar", run.Runtime, run.Machine)
	}
	if run.Provider != "Claude Code CLI" {
		t.Fatalf("run provider = %q, want Claude Code CLI", run.Provider)
	}
	if sidecarWorktreeHits != 1 || mainWorktreeHits != 0 {
		t.Fatalf("worktree routing hits = main %d sidecar %d, want main 0 sidecar 1", mainWorktreeHits, sidecarWorktreeHits)
	}
}

func TestRuntimeSelectionRejectsOfflineRuntime(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   "http://127.0.0.1:8090",
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-sidecar",
		DaemonURL:          "http://127.0.0.1:8091",
		Machine:            "shock-sidecar",
		DetectedCLI:        []string{"claude"},
		State:              "offline",
		ReportedAt:         time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat(sidecar) error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"machine": "shock-sidecar"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/selection", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime selection error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("selection status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error     string                   `json:"error"`
		Selection RuntimeSelectionResponse `json:"selection"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode selection error payload: %v", err)
	}
	if !strings.Contains(payload.Error, "offline") {
		t.Fatalf("selection error = %q, want offline wording", payload.Error)
	}
	if payload.Selection.SelectedRuntime != "shock-main" {
		t.Fatalf("selected runtime after failed switch = %q, want shock-main", payload.Selection.SelectedRuntime)
	}
}

func TestCreateIssueRejectsWhenAllRuntimesOffline(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	now := time.Now().UTC()
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: now.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-sidecar",
		DaemonURL:          "http://127.0.0.1:8091",
		Machine:            "shock-sidecar",
		State:              "online",
		ReportedAt:         now.Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat(sidecar online) error = %v", err)
	}

	offlineReportedAt := now.Add(-2 * time.Minute).Format(time.RFC3339)
	for _, runtimeID := range []string{"shock-main", "shock-sidecar"} {
		daemonURL := "http://127.0.0.1:8090"
		if runtimeID == "shock-sidecar" {
			daemonURL = "http://127.0.0.1:8091"
		}
		if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
			RuntimeID:          runtimeID,
			DaemonURL:          daemonURL,
			Machine:            runtimeID,
			State:              "online",
			ReportedAt:         offlineReportedAt,
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		}); err != nil {
			t.Fatalf("UpsertRuntimeHeartbeat(%s offline) error = %v", runtimeID, err)
		}
	}

	before := s.Snapshot()
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"title":    "all offline runtime probe",
		"summary":  "reject create scheduling when all runtimes offline",
		"owner":    "Claude Review Runner",
		"priority": "high",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/issues", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST issue error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("issue status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error string      `json:"error"`
		State store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode issue error payload: %v", err)
	}
	if payload.Error != store.ErrNoSchedulableRuntime.Error() {
		t.Fatalf("issue error = %q, want %q", payload.Error, store.ErrNoSchedulableRuntime.Error())
	}
	if payload.State.Workspace.PairingStatus != "degraded" {
		t.Fatalf("pairing status = %q, want degraded", payload.State.Workspace.PairingStatus)
	}
	if len(payload.State.Issues) != len(before.Issues) || len(payload.State.Runs) != len(before.Runs) || len(payload.State.Sessions) != len(before.Sessions) {
		t.Fatalf("issue create mutated payload state on failure: before issues/runs/sessions = %d/%d/%d after = %d/%d/%d", len(before.Issues), len(before.Runs), len(before.Sessions), len(payload.State.Issues), len(payload.State.Runs), len(payload.State.Sessions))
	}
	for _, machine := range payload.State.Machines {
		if machine.Name == "shock-main" || machine.Name == "shock-sidecar" {
			if machine.State != "offline" {
				t.Fatalf("machine %s state = %q, want offline", machine.Name, machine.State)
			}
		}
	}
}

func findRunSnapshotByID(state store.State, runID string) *store.Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}
