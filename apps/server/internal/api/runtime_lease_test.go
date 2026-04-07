package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRoomMessageRouteUsesRunWorktreePathAndLeaseMetadata(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		writeJSON(w, http.StatusOK, map[string]any{"provider": seen.Provider, "output": "lease-ok"})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, lanePath := createLeaseTestIssue(t, s, root, daemon.URL, "Room Lease Path", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"provider": "codex",
		"prompt":   "confirm worktree cwd",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("room message status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	if seen.Cwd != lanePath {
		t.Fatalf("daemon cwd = %q, want %q", seen.Cwd, lanePath)
	}
	if seen.LeaseID != created.SessionID || seen.RunID != created.RunID || seen.RoomID != created.RoomID {
		t.Fatalf("lease metadata = %#v, want session/run/room from created lane", seen)
	}
}

func TestRuntimeRegistryIncludesDerivedLeases(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	created, lanePath := createLeaseTestIssue(t, s, root, "http://127.0.0.1:8090", "Registry Lease Truth", "Codex Dockmaster")

	resp, err := http.Get(server.URL + "/v1/runtime/registry")
	if err != nil {
		t.Fatalf("GET runtime registry error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("registry status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		PairedRuntime string                `json:"pairedRuntime"`
		Runtimes      []store.RuntimeRecord `json:"runtimes"`
		Leases        []store.RuntimeLease  `json:"leases"`
	}
	decodeJSON(t, resp, &payload)

	if payload.PairedRuntime != "shock-main" {
		t.Fatalf("paired runtime = %q, want shock-main", payload.PairedRuntime)
	}
	var lease *store.RuntimeLease
	for index := range payload.Leases {
		if payload.Leases[index].SessionID == created.SessionID {
			lease = &payload.Leases[index]
			break
		}
	}
	if lease == nil {
		t.Fatalf("runtime registry leases missing session %q: %#v", created.SessionID, payload.Leases)
	}
	if lease.Runtime != "shock-main" || lease.WorktreePath != lanePath || lease.Cwd != lanePath {
		t.Fatalf("lease payload = %#v, want shock-main with lane path %q", lease, lanePath)
	}
}

func TestRuntimeRegistryExposesSchedulerFailoverTruth(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

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
	for _, runtime := range []struct {
		id        string
		daemonURL string
	}{
		{id: "shock-sidecar", daemonURL: "http://127.0.0.1:8091"},
		{id: "shock-spare", daemonURL: "http://127.0.0.1:8092"},
	} {
		if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
			RuntimeID:          runtime.id,
			DaemonURL:          runtime.daemonURL,
			Machine:            runtime.id,
			State:              "online",
			ReportedAt:         now.Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		}); err != nil {
			t.Fatalf("UpsertRuntimeHeartbeat(%s) error = %v", runtime.id, err)
		}
	}
	if _, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Runtime Load For Registry",
		Summary:  "occupy sidecar so registry can expose least-loaded failover",
		Owner:    "Claude Review Runner",
		Priority: "high",
	}); err != nil {
		t.Fatalf("CreateIssue(sidecar load) error = %v", err)
	}
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-main",
		DaemonURL:          "http://127.0.0.1:8090",
		Machine:            "shock-main",
		State:              "online",
		ReportedAt:         now.Add(-2 * time.Minute).Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat(shock-main offline) error = %v", err)
	}

	resp, err := http.Get(server.URL + "/v1/runtime/registry")
	if err != nil {
		t.Fatalf("GET runtime registry error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("registry status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Leases           []store.RuntimeLease   `json:"leases"`
		RuntimeScheduler store.RuntimeScheduler `json:"runtimeScheduler"`
	}
	decodeJSON(t, resp, &payload)

	if payload.RuntimeScheduler.Strategy != "failover" {
		t.Fatalf("scheduler strategy = %q, want failover", payload.RuntimeScheduler.Strategy)
	}
	if payload.RuntimeScheduler.AssignedRuntime != "shock-spare" {
		t.Fatalf("scheduler assigned runtime = %q, want shock-spare", payload.RuntimeScheduler.AssignedRuntime)
	}
	if payload.RuntimeScheduler.FailoverFrom != "shock-main" {
		t.Fatalf("scheduler failoverFrom = %q, want shock-main", payload.RuntimeScheduler.FailoverFrom)
	}
	if len(payload.Leases) == 0 {
		t.Fatalf("registry leases missing from payload")
	}
	var sidecarLease *store.RuntimeLease
	for index := range payload.Leases {
		if payload.Leases[index].Runtime == "shock-sidecar" {
			sidecarLease = &payload.Leases[index]
			break
		}
	}
	if sidecarLease == nil {
		t.Fatalf("registry leases missing active sidecar lease: %#v", payload.Leases)
	}
}

func TestRoomMessageRouteReturnsConflictStateWhenDaemonLeaseBlocksExec(t *testing.T) {
	root := t.TempDir()
	conflictAt := time.Now().UTC().Format(time.RFC3339Nano)
	var seen ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "runtime lease conflict: " + seen.Cwd + " is already held by session-other",
			"conflict": daemonLeaseConflict{
				LeaseID:    "session-other",
				RunID:      "run_other_01",
				SessionID:  "session-other",
				RoomID:     "room-other",
				Operation:  "exec",
				Key:        seen.Cwd,
				Cwd:        seen.Cwd,
				AcquiredAt: conflictAt,
			},
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, lanePath := createLeaseTestIssue(t, s, root, daemon.URL, "Exec Conflict", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{"provider": "codex", "prompt": "hit conflict"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("room conflict status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error    string              `json:"error"`
		Conflict daemonLeaseConflict `json:"conflict"`
		State    store.State         `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Conflict.Cwd != lanePath || payload.Conflict.SessionID != "session-other" {
		t.Fatalf("conflict payload = %#v, want cwd %q held by session-other", payload.Conflict, lanePath)
	}
	room, run, issue, ok := findRoomRunIssue(payload.State, created.RoomID)
	if !ok {
		t.Fatalf("room/run/issue not found in conflict state")
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" || issue.State != "blocked" {
		t.Fatalf("conflict state = room %#v run %#v issue %#v, want blocked", room, run, issue)
	}
	if seen.Cwd != lanePath || seen.LeaseID != created.SessionID {
		t.Fatalf("daemon request = %#v, want lane path and created session lease", seen)
	}
}

func TestCreateIssueEndpointReturnsConflictStateWhenWorktreeLeaseBlocksLane(t *testing.T) {
	root := t.TempDir()
	var ensured WorktreeRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/worktrees/ensure" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&ensured); err != nil {
			t.Fatalf("decode ensure payload: %v", err)
		}
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "runtime lease conflict: " + ensured.WorktreeName + " is already held by session-other",
			"conflict": daemonLeaseConflict{
				LeaseID:       "session-other",
				RunID:         "run_other_01",
				SessionID:     "session-other",
				RoomID:        "room-other",
				Operation:     "worktree",
				Key:           ensured.WorkspaceRoot + "::" + ensured.WorktreeName,
				WorkspaceRoot: ensured.WorkspaceRoot,
				WorktreeName:  ensured.WorktreeName,
				AcquiredAt:    time.Now().UTC().Format(time.RFC3339Nano),
			},
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()
	pairMainRuntime(t, s, daemon.URL)

	body, err := json.Marshal(map[string]any{
		"title":    "Lease Blocked Lane",
		"summary":  "verify create issue conflict surfaces 409",
		"owner":    "Codex Dockmaster",
		"priority": "critical",
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
		t.Fatalf("create issue conflict status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error    string              `json:"error"`
		RoomID   string              `json:"roomId"`
		Conflict daemonLeaseConflict `json:"conflict"`
		State    store.State         `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if ensured.LeaseID == "" || ensured.SessionID == "" || ensured.RunID == "" || ensured.RoomID == "" {
		t.Fatalf("ensure lease metadata missing: %#v", ensured)
	}
	if ensured.LeaseID != ensured.SessionID {
		t.Fatalf("ensure lease id = %q, want session id %q", ensured.LeaseID, ensured.SessionID)
	}
	if payload.RoomID == "" || payload.Conflict.Operation != "worktree" {
		t.Fatalf("create issue conflict payload = %#v, want roomId + worktree conflict", payload)
	}
	room, run, issue, ok := findRoomRunIssue(payload.State, payload.RoomID)
	if !ok {
		t.Fatalf("conflict room %q missing from state", payload.RoomID)
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" || issue.State != "blocked" {
		t.Fatalf("create issue conflict state = room %#v run %#v issue %#v, want blocked", room, run, issue)
	}
}

func pairMainRuntime(t *testing.T, s *store.Store, daemonURL string) {
	t.Helper()
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemonURL,
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}
}

func createLeaseTestIssue(t *testing.T, s *store.Store, root, daemonURL, title, owner string) (store.IssueCreationResult, string) {
	t.Helper()
	pairMainRuntime(t, s, daemonURL)

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    title,
		Summary:  "verify runtime lease contract",
		Owner:    owner,
		Priority: "critical",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	lanePath := filepath.Join(root, ".openshock-worktrees", created.WorktreeName)
	if _, err := s.AttachLane(created.RunID, created.SessionID, store.LaneBinding{
		Branch:       created.Branch,
		WorktreeName: created.WorktreeName,
		Path:         lanePath,
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}
	return created, lanePath
}
