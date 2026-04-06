package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestReadOnlySurfaceEndpointsServeSnapshotAndRejectMutations(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	getTests := []struct {
		name   string
		path   string
		verify func(t *testing.T, response *http.Response)
	}{
		{
			name: "state",
			path: "/v1/state",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload store.State
				decodeJSON(t, response, &payload)
				if payload.Workspace.Name == "" || len(payload.Issues) == 0 || len(payload.Inbox) == 0 {
					t.Fatalf("state payload missing seeded data: %#v", payload.Workspace)
				}
			},
		},
		{
			name: "workspace",
			path: "/v1/workspace",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload store.WorkspaceSnapshot
				decodeJSON(t, response, &payload)
				if payload.Name == "" || payload.Repo == "" {
					t.Fatalf("workspace payload missing repo identity: %#v", payload)
				}
			},
		},
		{
			name: "channels",
			path: "/v1/channels",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.Channel
				decodeJSON(t, response, &payload)
				if len(payload) == 0 {
					t.Fatalf("channels payload empty")
				}
			},
		},
		{
			name: "issues",
			path: "/v1/issues",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.Issue
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].Key == "" {
					t.Fatalf("issues payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "rooms",
			path: "/v1/rooms",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.Room
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].Topic.ID == "" {
					t.Fatalf("rooms payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "runs",
			path: "/v1/runs",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.Run
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].ID == "" {
					t.Fatalf("runs payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "agents",
			path: "/v1/agents",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.Agent
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].Name == "" {
					t.Fatalf("agents payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "sessions",
			path: "/v1/sessions",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.Session
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].ActiveRunID == "" {
					t.Fatalf("sessions payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "inbox",
			path: "/v1/inbox",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.InboxItem
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].Href == "" {
					t.Fatalf("inbox payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "memory",
			path: "/v1/memory",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.MemoryArtifact
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].Path == "" {
					t.Fatalf("memory payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "pull requests",
			path: "/v1/pull-requests",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload []store.PullRequest
				decodeJSON(t, response, &payload)
				if len(payload) == 0 || payload[0].ID == "" {
					t.Fatalf("pull requests payload malformed: %#v", payload)
				}
			},
		},
		{
			name: "runtime",
			path: "/v1/runtime",
			verify: func(t *testing.T, response *http.Response) {
				t.Helper()
				var payload RuntimeSnapshotResponse
				decodeJSON(t, response, &payload)
				if payload.State == "" {
					t.Fatalf("runtime payload missing state: %#v", payload)
				}
			},
		},
	}

	for _, testCase := range getTests {
		t.Run("GET "+testCase.name, func(t *testing.T) {
			resp, err := http.Get(server.URL + testCase.path)
			if err != nil {
				t.Fatalf("GET %s error = %v", testCase.path, err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("GET %s status = %d, want %d", testCase.path, resp.StatusCode, http.StatusOK)
			}
			testCase.verify(t, resp)
		})
	}

	methodGuardPaths := []string{
		"/v1/state",
		"/v1/workspace",
		"/v1/channels",
		"/v1/rooms",
		"/v1/runs",
		"/v1/agents",
		"/v1/sessions",
		"/v1/inbox",
		"/v1/memory",
		"/v1/pull-requests",
		"/v1/runtime",
	}

	for _, path := range methodGuardPaths {
		t.Run("POST "+path+" rejects mutation", func(t *testing.T) {
			resp, err := http.Post(server.URL+path, "application/json", bytes.NewReader([]byte("{}")))
			if err != nil {
				t.Fatalf("POST %s error = %v", path, err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("POST %s status = %d, want %d", path, resp.StatusCode, http.StatusMethodNotAllowed)
			}
		})
	}
}

func TestDetailEndpointsReturnRequestedEntities(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	snapshot := s.Snapshot()
	roomID := snapshot.Rooms[0].ID
	runID := snapshot.Runs[0].ID
	sessionID := snapshot.Sessions[0].ID

	roomResp, err := http.Get(server.URL + "/v1/rooms/" + roomID)
	if err != nil {
		t.Fatalf("GET room detail error = %v", err)
	}
	defer roomResp.Body.Close()
	if roomResp.StatusCode != http.StatusOK {
		t.Fatalf("room detail status = %d, want %d", roomResp.StatusCode, http.StatusOK)
	}
	var roomDetail store.RoomDetail
	decodeJSON(t, roomResp, &roomDetail)
	if roomDetail.Room.ID != roomID || len(roomDetail.Messages) == 0 {
		t.Fatalf("room detail malformed: %#v", roomDetail)
	}

	runResp, err := http.Get(server.URL + "/v1/runs/" + runID)
	if err != nil {
		t.Fatalf("GET run detail error = %v", err)
	}
	defer runResp.Body.Close()
	if runResp.StatusCode != http.StatusOK {
		t.Fatalf("run detail status = %d, want %d", runResp.StatusCode, http.StatusOK)
	}
	var run store.Run
	decodeJSON(t, runResp, &run)
	if run.ID != runID || run.RoomID == "" {
		t.Fatalf("run detail malformed: %#v", run)
	}

	sessionResp, err := http.Get(server.URL + "/v1/sessions/" + sessionID)
	if err != nil {
		t.Fatalf("GET session detail error = %v", err)
	}
	defer sessionResp.Body.Close()
	if sessionResp.StatusCode != http.StatusOK {
		t.Fatalf("session detail status = %d, want %d", sessionResp.StatusCode, http.StatusOK)
	}
	var session store.Session
	decodeJSON(t, sessionResp, &session)
	if session.ID != sessionID || session.ActiveRunID == "" {
		t.Fatalf("session detail malformed: %#v", session)
	}
}

func TestCreateIssueEndpointCreatesLinkedLaneState(t *testing.T) {
	root := t.TempDir()
	expectedPath := filepath.Join(root, ".openshock-worktrees", "wt-ship-phase-zero-server-shell")
	var ensured WorktreeRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/worktrees/ensure" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			t.Fatalf("ensure worktree method = %s, want POST", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(&ensured); err != nil {
			t.Fatalf("decode ensure worktree payload: %v", err)
		}
		writeJSON(w, http.StatusOK, WorktreeResponse{
			WorkspaceRoot: ensured.WorkspaceRoot,
			Branch:        ensured.Branch,
			WorktreeName:  ensured.WorktreeName,
			Path:          expectedPath,
			Created:       true,
			BaseRef:       ensured.BaseRef,
		})
	}))
	defer daemon.Close()

	_, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"title":    "Ship Phase Zero Server Shell",
		"summary":  "verify issue room run linkage",
		"owner":    "Codex Dockmaster",
		"priority": "critical",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/issues", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/issues error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create issue status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}

	var payload struct {
		RoomID    string      `json:"roomId"`
		RunID     string      `json:"runId"`
		SessionID string      `json:"sessionId"`
		State     store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.RoomID == "" || payload.RunID == "" || payload.SessionID == "" {
		t.Fatalf("create issue identifiers missing: %#v", payload)
	}
	if ensured.WorkspaceRoot != root || ensured.BaseRef != "HEAD" {
		t.Fatalf("ensure worktree payload = %#v, want workspace root %q and base ref HEAD", ensured, root)
	}

	var createdRun *store.Run
	for index := range payload.State.Runs {
		if payload.State.Runs[index].ID == payload.RunID {
			createdRun = &payload.State.Runs[index]
			break
		}
	}
	if createdRun == nil {
		t.Fatalf("run %q missing from response state", payload.RunID)
	}
	if createdRun.WorktreePath != expectedPath || createdRun.RoomID != payload.RoomID {
		t.Fatalf("run lane not attached: %#v", createdRun)
	}

	var createdSession *store.Session
	for index := range payload.State.Sessions {
		if payload.State.Sessions[index].ID == payload.SessionID {
			createdSession = &payload.State.Sessions[index]
			break
		}
	}
	if createdSession == nil {
		t.Fatalf("session %q missing from response state", payload.SessionID)
	}
	if createdSession.WorktreePath != expectedPath || createdSession.ActiveRunID != payload.RunID {
		t.Fatalf("session lane not attached: %#v", createdSession)
	}
}

func TestExecRouteProxiesDaemonMetadata(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		if req.Provider != "codex" || req.Prompt == "" {
			t.Fatalf("unexpected exec payload: %#v", req)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"provider": "codex",
			"command":  []string{"codex", "exec", "--json"},
			"output":   "bridge online",
			"duration": "842ms",
		})
	}))
	defer daemon.Close()

	_, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"provider": "codex",
		"prompt":   "confirm bridge",
		"cwd":      root,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/exec error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("exec status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload DaemonExecResponse
	decodeJSON(t, resp, &payload)
	if payload.Provider != "codex" || payload.Duration != "842ms" {
		t.Fatalf("exec metadata missing: %#v", payload)
	}
	if len(payload.Command) == 0 || payload.Command[0] != "codex" || payload.Output != "bridge online" {
		t.Fatalf("exec payload malformed: %#v", payload)
	}
}

func newContractTestServer(t *testing.T, root, daemonURL string) (*store.Store, *httptest.Server) {
	t.Helper()

	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemonURL,
		WorkspaceRoot: root,
	}).Handler())
	return s, server
}

func decodeJSON(t *testing.T, response *http.Response, target any) {
	t.Helper()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode json error = %v", err)
	}
}
