package api

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type fakeGitHubClient struct {
	status      githubsvc.Status
	createInput githubsvc.CreatePullRequestInput
	syncInputs  []githubsvc.SyncPullRequestInput
	mergeInputs []githubsvc.MergePullRequestInput
	createErr   error
	syncErr     error
	mergeErr    error
	created     githubsvc.PullRequest
	synced      map[int]githubsvc.PullRequest
	merged      githubsvc.PullRequest
}

func (f *fakeGitHubClient) Probe(_ string) (githubsvc.Status, error) {
	return f.status, nil
}

func (f *fakeGitHubClient) CreatePullRequest(_ string, input githubsvc.CreatePullRequestInput) (githubsvc.PullRequest, error) {
	f.createInput = input
	if f.createErr != nil {
		return githubsvc.PullRequest{}, f.createErr
	}
	return f.created, nil
}

func (f *fakeGitHubClient) SyncPullRequest(_ string, input githubsvc.SyncPullRequestInput) (githubsvc.PullRequest, error) {
	f.syncInputs = append(f.syncInputs, input)
	if f.syncErr != nil {
		return githubsvc.PullRequest{}, f.syncErr
	}
	if value, ok := f.synced[input.Number]; ok {
		return value, nil
	}
	return githubsvc.PullRequest{}, nil
}

func (f *fakeGitHubClient) MergePullRequest(_ string, input githubsvc.MergePullRequestInput) (githubsvc.PullRequest, error) {
	f.mergeInputs = append(f.mergeInputs, input)
	if f.mergeErr != nil {
		return githubsvc.PullRequest{}, f.mergeErr
	}
	return f.merged, nil
}

type fakeGitHubExecRunner struct {
	outputs map[string]string
}

func (f fakeGitHubExecRunner) LookPath(file string) (string, error) {
	return "", errors.New(file + " not found")
}

func (f fakeGitHubExecRunner) CombinedOutput(name string, args ...string) ([]byte, error) {
	key := name
	if len(args) > 0 {
		key += " " + strings.Join(args, " ")
	}
	if value, ok := f.outputs[key]; ok {
		return []byte(value), nil
	}
	return nil, errors.New("missing fake output for " + key)
}

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
				if payload.Workspace.Quota.MaxAgents == 0 || payload.Workspace.Usage.TotalTokens == 0 {
					t.Fatalf("state payload missing usage/quota observability: %#v", payload.Workspace)
				}
				if len(payload.Runs) == 0 || payload.Runs[0].Usage.TotalTokens == 0 {
					t.Fatalf("state payload missing run usage truth: %#v", payload.Runs)
				}
				if len(payload.Rooms) == 0 || payload.Rooms[0].Usage.MessageCount == 0 {
					t.Fatalf("state payload missing room usage truth: %#v", payload.Rooms)
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
				if payload.Quota.MaxAgents == 0 || payload.Quota.MessageHistoryDays == 0 {
					t.Fatalf("workspace payload missing quota truth: %#v", payload)
				}
				if payload.Usage.TotalTokens == 0 || payload.Usage.MessageCount == 0 {
					t.Fatalf("workspace payload missing usage truth: %#v", payload)
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
				if len(payload) == 0 || payload[0].Path == "" || payload[0].Version < 1 || payload[0].Governance.Mode == "" {
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

func TestWorkspaceMembersCORSPreflightAllowsPatch(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	req, err := http.NewRequest(http.MethodOptions, server.URL+"/v1/workspace/members/member-larkspur", nil)
	if err != nil {
		t.Fatalf("new OPTIONS /v1/workspace/members/:id request error = %v", err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodPatch)
	req.Header.Set("Access-Control-Request-Headers", "Content-Type")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS /v1/workspace/members/:id error = %v", err)
	}
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS /v1/workspace/members/:id status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if allowOrigin := resp.Header.Get("Access-Control-Allow-Origin"); allowOrigin != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", allowOrigin)
	}
	if allowMethods := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(allowMethods, http.MethodPatch) {
		t.Fatalf("Access-Control-Allow-Methods = %q, want PATCH included", allowMethods)
	}
	if allowHeaders := resp.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(allowHeaders, "Content-Type") {
		t.Fatalf("Access-Control-Allow-Headers = %q, want Content-Type included", allowHeaders)
	}
}

func TestMemoryDetailRouteExposesContentAndVersions(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/memory")
	if err != nil {
		t.Fatalf("GET /v1/memory error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var artifacts []store.MemoryArtifact
	decodeJSON(t, resp, &artifacts)
	workspaceArtifact := findMemoryArtifactByPath(artifacts, "MEMORY.md")
	if workspaceArtifact == nil {
		t.Fatalf("workspace memory artifact missing from list: %#v", artifacts)
	}

	detailResp, err := http.Get(server.URL + "/v1/memory/" + workspaceArtifact.ID)
	if err != nil {
		t.Fatalf("GET /v1/memory/%s error = %v", workspaceArtifact.ID, err)
	}
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory/%s status = %d, want %d", workspaceArtifact.ID, detailResp.StatusCode, http.StatusOK)
	}

	var detail store.MemoryArtifactDetail
	decodeJSON(t, detailResp, &detail)
	if detail.Artifact.ID != workspaceArtifact.ID || len(detail.Versions) == 0 {
		t.Fatalf("memory detail malformed: %#v", detail)
	}
	if !strings.Contains(detail.Content, "# OpenShock Workspace Memory") {
		t.Fatalf("memory detail content missing workspace scaffold:\n%s", detail.Content)
	}
	if detail.Versions[len(detail.Versions)-1].Version < 1 || detail.Versions[len(detail.Versions)-1].Source == "" {
		t.Fatalf("memory detail versions malformed: %#v", detail.Versions)
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

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemon.URL,
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

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

	roomNotePath := filepath.ToSlash(filepath.Join("notes", "rooms", payload.RoomID+".md"))
	decisionPath := filepath.ToSlash(filepath.Join("decisions", "ops-28.md"))
	assertMemoryArtifactSummary(t, payload.State.Memory, "MEMORY.md", "Worktree Ready")
	assertMemoryArtifactSummary(t, payload.State.Memory, filepath.ToSlash(filepath.Join("notes", "work-log.md")), "Worktree Ready")
	assertMemoryArtifactSummary(t, payload.State.Memory, roomNotePath, "Worktree Ready")
	assertMemoryArtifactSummary(t, payload.State.Memory, decisionPath, "queued")
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

func TestRuntimePairingColdStartPrefersCurrentDaemonTruth(t *testing.T) {
	testCases := []struct {
		name        string
		reportedAge time.Duration
	}{
		{name: "offline window", reportedAge: 2 * time.Hour},
		{name: "stale window", reportedAge: 30 * time.Second},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			statePath := filepath.Join(root, "data", "state.json")

			s, err := store.New(statePath, root)
			if err != nil {
				t.Fatalf("store.New() error = %v", err)
			}
			if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
				RuntimeID:  "shock-main",
				DaemonURL:  "http://127.0.0.1:8090",
				Machine:    "shock-main",
				State:      "online",
				ReportedAt: time.Now().UTC().Add(-tc.reportedAge).Format(time.RFC3339),
			}); err != nil {
				t.Fatalf("UpdateRuntimePairing() error = %v", err)
			}

			var execHits int
			daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/v1/exec":
					execHits++
					writeJSON(w, http.StatusOK, DaemonExecResponse{
						Provider: "codex",
						Command:  []string{"codex", "exec"},
						Output:   "bridge online",
						Duration: "120ms",
					})
				default:
					http.NotFound(w, r)
				}
			}))
			defer daemon.Close()

			server := httptest.NewServer(New(s, http.DefaultClient, Config{
				DaemonURL:     daemon.URL,
				WorkspaceRoot: root,
			}).Handler())
			defer server.Close()

			pairingResp, err := http.Get(server.URL + "/v1/runtime/pairing")
			if err != nil {
				t.Fatalf("GET /v1/runtime/pairing error = %v", err)
			}
			defer pairingResp.Body.Close()
			if pairingResp.StatusCode != http.StatusOK {
				t.Fatalf("pairing status = %d, want %d", pairingResp.StatusCode, http.StatusOK)
			}
			var pairing PairingStatusResponse
			decodeJSON(t, pairingResp, &pairing)
			if pairing.DaemonURL != daemon.URL {
				t.Fatalf("pairing daemon url = %q, want %q", pairing.DaemonURL, daemon.URL)
			}

			body, err := json.Marshal(map[string]any{
				"provider": "codex",
				"prompt":   "cold start bridge",
				"cwd":      root,
			})
			if err != nil {
				t.Fatalf("Marshal() error = %v", err)
			}
			execResp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(body))
			if err != nil {
				t.Fatalf("POST /v1/exec error = %v", err)
			}
			defer execResp.Body.Close()
			if execResp.StatusCode != http.StatusOK {
				t.Fatalf("exec status = %d, want %d", execResp.StatusCode, http.StatusOK)
			}
			if execHits != 1 {
				t.Fatalf("exec hits = %d, want 1", execHits)
			}
		})
	}
}

func TestRuntimeHeartbeatsKeepPairingAndExecAligned(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	var execHits int
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/exec":
			execHits++
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "bridge online",
				Duration: "98ms",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:8090",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	heartbeatBody, err := json.Marshal(RuntimeSnapshotResponse{
		RuntimeID:  "shock-main",
		DaemonURL:  daemon.URL,
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("Marshal() heartbeat error = %v", err)
	}
	heartbeatResp, err := http.Post(server.URL+"/v1/runtime/heartbeats", "application/json", bytes.NewReader(heartbeatBody))
	if err != nil {
		t.Fatalf("POST /v1/runtime/heartbeats error = %v", err)
	}
	defer heartbeatResp.Body.Close()
	if heartbeatResp.StatusCode != http.StatusOK {
		t.Fatalf("heartbeat status = %d, want %d", heartbeatResp.StatusCode, http.StatusOK)
	}

	pairingResp, err := http.Get(server.URL + "/v1/runtime/pairing")
	if err != nil {
		t.Fatalf("GET /v1/runtime/pairing error = %v", err)
	}
	defer pairingResp.Body.Close()
	if pairingResp.StatusCode != http.StatusOK {
		t.Fatalf("pairing status = %d, want %d", pairingResp.StatusCode, http.StatusOK)
	}
	var pairing PairingStatusResponse
	decodeJSON(t, pairingResp, &pairing)
	if pairing.DaemonURL != daemon.URL {
		t.Fatalf("pairing daemon url = %q, want %q", pairing.DaemonURL, daemon.URL)
	}

	body, err := json.Marshal(map[string]any{
		"provider": "codex",
		"prompt":   "heartbeat bridge",
		"cwd":      root,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	execResp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/exec error = %v", err)
	}
	defer execResp.Body.Close()
	if execResp.StatusCode != http.StatusOK {
		t.Fatalf("exec status = %d, want %d", execResp.StatusCode, http.StatusOK)
	}
	if execHits != 1 {
		t.Fatalf("exec hits = %d, want 1", execHits)
	}
}

func TestCreatePullRequestRouteCreatesGitHubBackedPullRequest(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Ship Real PR Loop",
		Summary:  "verify github-backed create",
		Owner:    "Codex Dockmaster",
		Priority: "critical",
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

	github := &fakeGitHubClient{
		created: githubsvc.PullRequest{
			Number:         52,
			URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/52",
			Title:          "Ship Real PR Loop",
			State:          "OPEN",
			HeadRefName:    created.Branch,
			BaseRefName:    "main",
			Author:         "CodexDockmaster",
			ReviewDecision: "REVIEW_REQUIRED",
		},
	}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/pull-request", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatalf("POST create pull request error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create pull request status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		PullRequestID string      `json:"pullRequestId"`
		State         store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.PullRequestID != "pr-52" {
		t.Fatalf("pullRequestId = %q, want pr-52", payload.PullRequestID)
	}
	if github.createInput.Repo != s.Snapshot().Workspace.Repo {
		t.Fatalf("github create repo = %q, want %q", github.createInput.Repo, s.Snapshot().Workspace.Repo)
	}
	if github.createInput.BaseBranch != "main" || github.createInput.HeadBranch != created.Branch {
		t.Fatalf("github create branches = %#v, want base main and head %q", github.createInput, created.Branch)
	}

	pr, ok := findPullRequestByID(payload.State, payload.PullRequestID)
	if !ok {
		t.Fatalf("pull request %q missing from response state", payload.PullRequestID)
	}
	if pr.Number != 52 || pr.Provider != "github" || pr.URL == "" || pr.BaseBranch != "main" {
		t.Fatalf("pull request payload malformed: %#v", pr)
	}
	if pr.Status != "in_review" || pr.ReviewSummary == "" {
		t.Fatalf("pull request status = %#v, want github-backed review state", pr)
	}
}

func TestCreatePullRequestRouteUsesGitHubAppEffectiveAuthWhenGHCLIIsMissing(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "App Auth PR Create",
		Summary:  "verify github app create path",
		Owner:    "Codex Dockmaster",
		Priority: "critical",
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

	var createPayload struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Head  string `json:"head"`
		Base  string `json:"base"`
	}
	githubAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodPost && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls":
			if got := r.Header.Get("Authorization"); got != "Bearer app-install-token" {
				t.Fatalf("create auth header = %q, want installation token", got)
			}
			if err := json.NewDecoder(r.Body).Decode(&createPayload); err != nil {
				t.Fatalf("decode create payload: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"number": 52})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/52":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     52,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/52",
				"title":      "App Auth PR Create",
				"state":      "open",
				"draft":      false,
				"merged":     false,
				"updated_at": "2026-04-06T11:20:00Z",
				"head":       map[string]any{"ref": created.Branch},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"repository": map[string]any{
						"pullRequest": map[string]any{
							"reviewDecision": "REVIEW_REQUIRED",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer githubAPI.Close()

	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID", "67890")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", githubAPI.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", githubAPI.URL+"/graphql")

	github := githubsvc.NewService(fakeGitHubExecRunner{
		outputs: map[string]string{
			"git -C " + root + " remote get-url origin":            "https://github.com/Larkspur-Wang/OpenShock.git",
			"git -C " + root + " rev-parse --abbrev-ref HEAD":      "main",
			"git -C " + root + " push -u origin " + created.Branch: "branch pushed",
		},
	})
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/pull-request", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatalf("POST create pull request error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create pull request status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		PullRequestID string      `json:"pullRequestId"`
		State         store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if createPayload.Head != created.Branch || createPayload.Base != "main" {
		t.Fatalf("create payload branches = %#v, want branch %q -> main", createPayload, created.Branch)
	}
	if payload.PullRequestID != "pr-52" {
		t.Fatalf("pullRequestId = %q, want pr-52", payload.PullRequestID)
	}
	pr, ok := findPullRequestByID(payload.State, payload.PullRequestID)
	if !ok || pr.Status != "in_review" || pr.ReviewDecision != "REVIEW_REQUIRED" {
		t.Fatalf("pull request payload = %#v, want github-app backed review state", pr)
	}
}

func TestCreatePullRequestRouteEscalatesBlockedOnGitHubCreateFailure(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Blocked PR Create",
		Summary:  "verify create failure escalation",
		Owner:    "Codex Dockmaster",
		Priority: "critical",
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

	github := &fakeGitHubClient{createErr: errors.New("gh auth missing")}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/pull-request", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatalf("POST create pull request error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("create pull request status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error     string      `json:"error"`
		Operation string      `json:"operation"`
		RoomID    string      `json:"roomId"`
		State     store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Error != "gh auth missing" || payload.Operation != "create" || payload.RoomID != created.RoomID {
		t.Fatalf("create failure payload = %#v, want error/operation/roomId populated", payload)
	}
	if _, ok := findPullRequestByID(payload.State, "pr-52"); ok {
		t.Fatalf("unexpected GitHub-backed pull request created on failure: %#v", payload.State.PullRequests)
	}
	if pr := findPullRequestByRoomID(payload.State, created.RoomID); pr != nil {
		t.Fatalf("pull request for room %q = %#v, want none created on failure", created.RoomID, pr)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	session := findSessionByID(payload.State, created.SessionID)
	issue := findIssueByRoomID(payload.State, created.RoomID)
	if room == nil || run == nil || session == nil || issue == nil {
		t.Fatalf("expected room/run/session/issue after escalation")
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" || session.Status != "blocked" || issue.State != "blocked" {
		t.Fatalf("blocked escalation missing from state: room=%#v run=%#v session=%#v issue=%#v", room, run, session, issue)
	}
	if !strings.Contains(run.NextAction, "PR 创建") || !strings.Contains(run.Summary, "GitHub PR 创建失败") {
		t.Fatalf("run escalation malformed: %#v", run)
	}
	if len(payload.State.Inbox) == 0 || payload.State.Inbox[0].Title != "GitHub PR 创建失败" || payload.State.Inbox[0].Action != "处理 GitHub 阻塞" {
		t.Fatalf("inbox escalation malformed: %#v", payload.State.Inbox)
	}
	if !roomMessagesContain(payload.State, created.RoomID, "GitHub PR 创建失败：gh auth missing") {
		t.Fatalf("room messages missing GitHub create failure escalation: %#v", payload.State.RoomMessages[created.RoomID])
	}
}

func TestPullRequestRouteSyncsAndMergesRemoteState(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Sync Remote PR",
		Summary:  "verify sync and merge",
		Owner:    "Codex Dockmaster",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         73,
		Title:          "Sync Remote PR",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/73",
		ReviewDecision: "REVIEW_REQUIRED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}

	github := &fakeGitHubClient{
		synced: map[int]githubsvc.PullRequest{
			73: {
				Number:         73,
				URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/73",
				Title:          "Sync Remote PR",
				State:          "OPEN",
				HeadRefName:    created.Branch,
				BaseRefName:    "main",
				Author:         "CodexDockmaster",
				ReviewDecision: "CHANGES_REQUESTED",
			},
		},
		merged: githubsvc.PullRequest{
			Number:         73,
			URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/73",
			Title:          "Sync Remote PR",
			State:          "MERGED",
			HeadRefName:    created.Branch,
			BaseRefName:    "main",
			Author:         "CodexDockmaster",
			ReviewDecision: "APPROVED",
			Merged:         true,
		},
	}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	getResp, err := http.Get(server.URL + "/v1/pull-requests/" + pullRequestID)
	if err != nil {
		t.Fatalf("GET pull request error = %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("GET pull request status = %d, want %d", getResp.StatusCode, http.StatusOK)
	}

	var synced store.PullRequest
	decodeJSON(t, getResp, &synced)
	if synced.Status != "changes_requested" || synced.ReviewDecision != "CHANGES_REQUESTED" {
		t.Fatalf("synced pull request = %#v, want changes_requested from remote review decision", synced)
	}

	body, err := json.Marshal(map[string]any{"status": "merged"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	mergeResp, err := http.Post(server.URL+"/v1/pull-requests/"+pullRequestID, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST merge pull request error = %v", err)
	}
	defer mergeResp.Body.Close()
	if mergeResp.StatusCode != http.StatusOK {
		t.Fatalf("merge pull request status = %d, want %d", mergeResp.StatusCode, http.StatusOK)
	}

	var mergedPayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, mergeResp, &mergedPayload)
	mergedPR, ok := findPullRequestByID(mergedPayload.State, pullRequestID)
	if !ok {
		t.Fatalf("merged pull request %q missing from response state", pullRequestID)
	}
	if mergedPR.Status != "merged" {
		t.Fatalf("merged pull request status = %q, want merged", mergedPR.Status)
	}
	issue := findIssueByRoomID(mergedPayload.State, created.RoomID)
	if issue == nil || issue.State != "done" {
		t.Fatalf("issue state after merge = %#v, want done", issue)
	}
}

func TestPullRequestDetailRouteReturnsConversationAndBacklinks(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "PR Detail Route",
		Summary:  "verify PR detail backlinks",
		Owner:    "Codex Dockmaster",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         91,
		Title:          "PR Detail Route",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/91",
		ReviewDecision: "APPROVED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}
	if _, _, err := s.ApplyGitHubWebhookEvent(githubsvc.NormalizedWebhookEvent{
		DeliveryID:        "delivery-pr-detail",
		Event:             "pull_request_review_comment",
		Kind:              "review_comment",
		Action:            "created",
		Sender:            "review-bot",
		Repository:        "Larkspur-Wang/OpenShock",
		PullRequestNumber: 91,
		PullRequestTitle:  "PR Detail Route",
		PullRequestURL:    "https://github.com/Larkspur-Wang/OpenShock/pull/91",
		ConversationKey:   "review_comment:9101",
		ConversationURL:   "https://github.com/Larkspur-Wang/OpenShock/pull/91#discussion_r9101",
		ConversationPath:  "apps/server/internal/api/server.go",
		ConversationLine:  742,
		ConversationAt:    "2026-04-09T01:49:00Z",
		CommentBody:       "please add PR detail route",
	}); err != nil {
		t.Fatalf("ApplyGitHubWebhookEvent() error = %v", err)
	}
	if _, _, _, _, err := s.UpsertNotificationSubscriber(store.NotificationSubscriberUpsertInput{
		Channel:    "browser_push",
		Target:     "https://ops.example.test/review-console",
		Label:      "Review Console",
		Preference: "all",
		Status:     "ready",
		Source:     "contract-test",
	}); err != nil {
		t.Fatalf("UpsertNotificationSubscriber() error = %v", err)
	}
	if _, _, run, err := s.DispatchNotificationFanout(); err != nil {
		t.Fatalf("DispatchNotificationFanout() error = %v", err)
	} else if run.Delivered == 0 {
		t.Fatalf("DispatchNotificationFanout() delivered = %d, want > 0", run.Delivered)
	}

	github := &fakeGitHubClient{
		synced: map[int]githubsvc.PullRequest{
			91: {
				Number:           91,
				URL:              "https://github.com/Larkspur-Wang/OpenShock/pull/91",
				Title:            "PR Detail Route",
				State:            "OPEN",
				Mergeable:        "MERGEABLE",
				MergeStateStatus: "CLEAN",
				HeadRefName:      created.Branch,
				BaseRefName:      "main",
				Author:           "CodexDockmaster",
				ReviewDecision:   "APPROVED",
			},
		},
	}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/pull-requests/" + pullRequestID + "/detail")
	if err != nil {
		t.Fatalf("GET pull request detail error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET pull request detail status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var detail store.PullRequestDetail
	decodeJSON(t, resp, &detail)
	if detail.PullRequest.ID != pullRequestID {
		t.Fatalf("detail pull request = %#v, want %q", detail.PullRequest, pullRequestID)
	}
	if detail.PullRequest.Mergeable != "MERGEABLE" || detail.PullRequest.MergeStateStatus != "CLEAN" {
		t.Fatalf("detail pull request safety = %#v, want MERGEABLE/CLEAN", detail.PullRequest)
	}
	if detail.Room.ID != created.RoomID || detail.Run.ID != created.RunID || detail.Issue.RoomID != created.RoomID {
		t.Fatalf("detail backlinks malformed: %#v", detail)
	}
	if len(detail.Conversation) != 1 || detail.Conversation[0].ID != "review_comment:9101" {
		t.Fatalf("detail conversation = %#v, want one review_comment entry", detail.Conversation)
	}
	if len(detail.RelatedInbox) == 0 {
		t.Fatalf("detail related inbox = %#v, want PR-linked inbox card", detail.RelatedInbox)
	}
	if detail.RelatedInbox[0].Href != "/rooms/"+created.RoomID+"?tab=pr" {
		t.Fatalf("detail related inbox = %#v, want PR workbench deep link first", detail.RelatedInbox)
	}
	if detail.Delivery.Status != "ready" || !detail.Delivery.ReleaseReady {
		t.Fatalf("detail delivery gate status = %#v, want ready + releaseReady", detail.Delivery)
	}
	if len(detail.Delivery.Gates) != 4 {
		t.Fatalf("detail delivery gates = %#v, want 4 gates", detail.Delivery.Gates)
	}
	gateByID := map[string]store.PullRequestDeliveryGate{}
	for _, gate := range detail.Delivery.Gates {
		gateByID[gate.ID] = gate
	}
	if gateByID["review-merge"].Status != "ready" {
		t.Fatalf("review gate = %#v, want ready", gateByID["review-merge"])
	}
	if gateByID["notification-delivery"].Status != "ready" {
		t.Fatalf("notification gate = %#v, want ready", gateByID["notification-delivery"])
	}
	if len(detail.Delivery.Templates) == 0 {
		t.Fatalf("detail delivery templates = %#v, want review notification template", detail.Delivery.Templates)
	}
	template := detail.Delivery.Templates[0]
	if template.TemplateID != "ops_review" || template.Status != "ready" || template.ReadyDeliveries == 0 || template.SentReceipts == 0 {
		t.Fatalf("detail delivery template = %#v, want ready ops_review delivery with sent receipt", template)
	}
	if detail.Delivery.HandoffNote.Title == "" || len(detail.Delivery.HandoffNote.Lines) < 4 {
		t.Fatalf("detail handoff note = %#v, want populated operator handoff note", detail.Delivery.HandoffNote)
	}
	evidenceByID := map[string]store.PullRequestDeliveryEvidence{}
	for _, item := range detail.Delivery.Evidence {
		evidenceByID[item.ID] = item
	}
	for _, evidenceID := range []string{"release-contract", "remote-pr", "review-conversation", "notification-templates"} {
		if _, ok := evidenceByID[evidenceID]; !ok {
			t.Fatalf("detail delivery evidence missing %q in %#v", evidenceID, detail.Delivery.Evidence)
		}
	}
}

func TestPullRequestDetailRouteReflectsGovernedCloseout(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	mustPatchGovernedQATopology(t, server.URL)

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	defer createResp.Body.Close()

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}

	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}

	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	followup := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+followup.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}

	closeoutNote := "QA 验证完成，可以进入 PR delivery closeout。"
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+followup.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          closeoutNote,
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	resp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET governed closeout detail error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET governed closeout detail status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var detail store.PullRequestDetail
	decodeJSON(t, resp, &detail)
	if !strings.Contains(detail.Delivery.HandoffNote.Summary, "governed closeout") {
		t.Fatalf("detail handoff note summary = %q, want governed closeout summary", detail.Delivery.HandoffNote.Summary)
	}
	if detail.Delivery.Delegation.Status != "ready" ||
		detail.Delivery.Delegation.TargetAgent != "Spec Captain" ||
		detail.Delivery.Delegation.InboxItemID != "inbox-delivery-delegation-pr-runtime-18" {
		t.Fatalf("detail delegation = %#v, want ready Spec Captain delivery delegate", detail.Delivery.Delegation)
	}
	if detail.Delivery.Delegation.HandoffID == "" || detail.Delivery.Delegation.HandoffStatus != "requested" {
		t.Fatalf("detail delegation = %#v, want auto-created requested closeout handoff", detail.Delivery.Delegation)
	}
	noteLines := strings.Join(detail.Delivery.HandoffNote.Lines, "\n")
	if !strings.Contains(noteLines, closeoutNote) || !strings.Contains(noteLines, "governed route 已到 done") {
		t.Fatalf("detail handoff note lines = %#v, want closeout note + done hint", detail.Delivery.HandoffNote.Lines)
	}

	evidenceByID := map[string]store.PullRequestDeliveryEvidence{}
	for _, item := range detail.Delivery.Evidence {
		evidenceByID[item.ID] = item
	}
	closeoutEvidence, ok := evidenceByID["governed-closeout"]
	if !ok || closeoutEvidence.Href != "/pull-requests/pr-runtime-18" || !strings.Contains(closeoutEvidence.Summary, closeoutNote) {
		t.Fatalf("detail delivery evidence = %#v, want governed closeout evidence", detail.Delivery.Evidence)
	}
	delegateEvidence, ok := evidenceByID["delivery-delegate"]
	if !ok || delegateEvidence.Value != "Spec Captain" {
		t.Fatalf("detail delivery evidence = %#v, want delivery delegate evidence", detail.Delivery.Evidence)
	}

	relatedDelegation := false
	for _, item := range detail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedDelegation = true
			if item.Href != "/pull-requests/pr-runtime-18" || !strings.Contains(item.Summary, "Spec Captain") {
				t.Fatalf("delegation inbox item = %#v, want PR delivery delegation backlink", item)
			}
		}
	}
	if !relatedDelegation {
		t.Fatalf("detail related inbox = %#v, want delivery delegation inbox signal", detail.RelatedInbox)
	}
	handoffResp, err := http.Get(server.URL + "/v1/mailbox/" + detail.Delivery.Delegation.HandoffID)
	if err != nil {
		t.Fatalf("GET delegated closeout handoff error = %v", err)
	}
	defer handoffResp.Body.Close()
	if handoffResp.StatusCode != http.StatusOK {
		t.Fatalf("GET delegated closeout handoff status = %d, want %d", handoffResp.StatusCode, http.StatusOK)
	}

	var closeoutHandoff store.AgentHandoff
	decodeJSON(t, handoffResp, &closeoutHandoff)
	if closeoutHandoff.Kind != "delivery-closeout" ||
		closeoutHandoff.FromAgent != "Memory Clerk" ||
		closeoutHandoff.ToAgent != "Spec Captain" ||
		closeoutHandoff.Status != "requested" {
		t.Fatalf("closeout handoff = %#v, want requested delivery-closeout handoff", closeoutHandoff)
	}
}

func TestDelegatedCloseoutHandoffLifecycleReflectsInPullRequestDetail(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)
	handoff := createPayload.Handoff

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}

	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}
	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeQAResp, &qaCompletePayload)
	delegatedHandoff := qaCompletePayload.State.Mailbox[0]
	if delegatedHandoff.Kind != "delivery-closeout" {
		t.Fatalf("delegated handoff = %#v, want delivery-closeout handoff", delegatedHandoff)
	}

	detailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET detail error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}
	var detail store.PullRequestDetail
	decodeJSON(t, detailResp, &detail)
	if detail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("detail delegation = %#v, want auto-created delegated handoff", detail.Delivery.Delegation)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+detail.Delivery.Delegation.HandoffID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          blockNote,
	})
	defer blockedResp.Body.Close()
	if blockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated blocked status = %d, want %d", blockedResp.StatusCode, http.StatusOK)
	}

	blockedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET blocked detail error = %v", err)
	}
	defer blockedDetailResp.Body.Close()
	if blockedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET blocked detail status = %d, want %d", blockedDetailResp.StatusCode, http.StatusOK)
	}
	var blockedDetail store.PullRequestDetail
	decodeJSON(t, blockedDetailResp, &blockedDetail)
	if blockedDetail.Delivery.Delegation.Status != "blocked" ||
		blockedDetail.Delivery.Delegation.HandoffStatus != "blocked" ||
		!strings.Contains(blockedDetail.Delivery.Delegation.Summary, blockNote) {
		t.Fatalf("blocked delegation = %#v, want blocked summary with blocker note", blockedDetail.Delivery.Delegation)
	}
	if blockedDetail.Delivery.Delegation.ResponseHandoffID == "" ||
		blockedDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" {
		t.Fatalf("blocked delegation = %#v, want auto-created unblock response handoff", blockedDetail.Delivery.Delegation)
	}
	relatedBlocked := false
	for _, item := range blockedDetail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedBlocked = true
			if item.Kind != "blocked" || !strings.Contains(item.Summary, blockNote) || !strings.Contains(item.Summary, "unblock response handoff") {
				t.Fatalf("blocked delegation inbox item = %#v, want blocked signal with blocker note", item)
			}
		}
	}
	if !relatedBlocked {
		t.Fatalf("blocked related inbox = %#v, want delivery delegation signal", blockedDetail.RelatedInbox)
	}

	responseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+blockedDetail.Delivery.Delegation.ResponseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer responseAckResp.Body.Close()
	if responseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delivery reply acknowledged status = %d, want %d", responseAckResp.StatusCode, http.StatusOK)
	}
	responseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+blockedDetail.Delivery.Delegation.ResponseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          "release receipt checklist 已补齐，请重新接住 delivery closeout。",
	})
	defer responseCompleteResp.Body.Close()
	if responseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delivery reply completed status = %d, want %d", responseCompleteResp.StatusCode, http.StatusOK)
	}

	responseDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET response detail error = %v", err)
	}
	defer responseDetailResp.Body.Close()
	if responseDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET response detail status = %d, want %d", responseDetailResp.StatusCode, http.StatusOK)
	}
	var responseDetail store.PullRequestDetail
	decodeJSON(t, responseDetailResp, &responseDetail)
	if responseDetail.Delivery.Delegation.Status != "blocked" ||
		responseDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(responseDetail.Delivery.Delegation.Summary, "重新 acknowledge final delivery closeout") {
		t.Fatalf("response detail delegation = %#v, want blocked delegation with completed response handoff", responseDetail.Delivery.Delegation)
	}
	mailboxAfterResponseResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox after response completion error = %v", err)
	}
	defer mailboxAfterResponseResp.Body.Close()
	if mailboxAfterResponseResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox after response completion status = %d, want %d", mailboxAfterResponseResp.StatusCode, http.StatusOK)
	}
	var mailboxAfterResponse []store.AgentHandoff
	decodeJSON(t, mailboxAfterResponseResp, &mailboxAfterResponse)
	parentAfterResponse := findMailboxHandoffByID(mailboxAfterResponse, delegatedHandoff.ID)
	if parentAfterResponse == nil || !hasMailboxMessageContract(parentAfterResponse.Messages, "response-progress", "release receipt checklist 已补齐") {
		t.Fatalf("parent handoff after response completion = %#v, want response-progress timeline entry", parentAfterResponse)
	}

	ackDelegatedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+detail.Delivery.Delegation.HandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.ToAgentID,
	})
	defer ackDelegatedResp.Body.Close()
	if ackDelegatedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated re-ack status = %d, want %d", ackDelegatedResp.StatusCode, http.StatusOK)
	}
	reAckDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET re-ack detail error = %v", err)
	}
	defer reAckDetailResp.Body.Close()
	if reAckDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET re-ack detail status = %d, want %d", reAckDetailResp.StatusCode, http.StatusOK)
	}
	var reAckDetail store.PullRequestDetail
	decodeJSON(t, reAckDetailResp, &reAckDetail)
	if reAckDetail.Delivery.Delegation.Status != "ready" ||
		reAckDetail.Delivery.Delegation.HandoffStatus != "acknowledged" ||
		reAckDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(reAckDetail.Delivery.Delegation.Summary, "第 1 轮") ||
		!strings.Contains(reAckDetail.Delivery.Delegation.Summary, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("re-ack delegation = %#v, want resumed delivery delegation with preserved response history", reAckDetail.Delivery.Delegation)
	}
	relatedResumed := false
	for _, item := range reAckDetail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedResumed = true
			if item.Kind != "status" || !strings.Contains(item.Summary, "第 1 轮") || !strings.Contains(item.Summary, "已重新 acknowledge final delivery closeout") {
				t.Fatalf("re-ack delegation inbox item = %#v, want resumed delivery delegation signal with preserved response history", item)
			}
		}
	}
	if !relatedResumed {
		t.Fatalf("re-ack related inbox = %#v, want resumed delivery delegation signal", reAckDetail.RelatedInbox)
	}

	mailboxResumeResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox after parent resume error = %v", err)
	}
	defer mailboxResumeResp.Body.Close()
	if mailboxResumeResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox after parent resume status = %d, want %d", mailboxResumeResp.StatusCode, http.StatusOK)
	}
	var mailboxAfterResume []store.AgentHandoff
	decodeJSON(t, mailboxResumeResp, &mailboxAfterResume)
	parentResume := findMailboxHandoffByID(mailboxAfterResume, delegatedHandoff.ID)
	if parentResume == nil ||
		!strings.Contains(parentResume.LastAction, "第 1 轮") ||
		!strings.Contains(parentResume.LastAction, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("parent handoff after delegated resume = %#v, want preserved response history in mailbox", parentResume)
	}
	if !hasMailboxMessageContract(parentResume.Messages, "response-progress", "release receipt checklist 已补齐") {
		t.Fatalf("parent handoff messages after delegated resume = %#v, want preserved response-progress history", parentResume.Messages)
	}

	inboxResumeResp, err := http.Get(server.URL + "/v1/inbox")
	if err != nil {
		t.Fatalf("GET /v1/inbox after parent resume error = %v", err)
	}
	defer inboxResumeResp.Body.Close()
	if inboxResumeResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/inbox after parent resume status = %d, want %d", inboxResumeResp.StatusCode, http.StatusOK)
	}
	var inboxAfterResume []store.InboxItem
	decodeJSON(t, inboxResumeResp, &inboxAfterResume)
	parentResumeInbox := findInboxItemByIDContract(inboxAfterResume, delegatedHandoff.InboxItemID)
	if parentResumeInbox == nil ||
		!strings.Contains(parentResumeInbox.Summary, "第 1 轮") ||
		!strings.Contains(parentResumeInbox.Summary, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("parent inbox after delegated resume = %#v, want preserved response history summary", parentResumeInbox)
	}
	responseResume := findMailboxHandoffByID(mailboxAfterResume, blockedDetail.Delivery.Delegation.ResponseHandoffID)
	if responseResume == nil ||
		!strings.Contains(responseResume.LastAction, "已重新 acknowledge 主 closeout") ||
		!strings.Contains(responseResume.LastAction, "第 1 轮") {
		t.Fatalf("response handoff after delegated resume = %#v, want child ledger synced to parent acknowledged", responseResume)
	}
	responseResumeLastMessage := responseResume.Messages[len(responseResume.Messages)-1]
	if responseResumeLastMessage.Kind != "parent-progress" ||
		!strings.Contains(responseResumeLastMessage.Body, "已重新 acknowledge 主 closeout") {
		t.Fatalf("response handoff messages after delegated resume = %#v, want latest parent-progress ledger entry", responseResume.Messages)
	}
	responseResumeInbox := findInboxItemByIDContract(inboxAfterResume, responseResume.InboxItemID)
	if responseResumeInbox == nil ||
		!strings.Contains(responseResumeInbox.Summary, "已重新 acknowledge 主 closeout") ||
		!strings.Contains(responseResumeInbox.Summary, "第 1 轮") {
		t.Fatalf("response inbox after delegated resume = %#v, want child inbox synced to parent acknowledged", responseResumeInbox)
	}

	runResumeResp, err := http.Get(server.URL + "/v1/runs")
	if err != nil {
		t.Fatalf("GET /v1/runs after parent resume error = %v", err)
	}
	defer runResumeResp.Body.Close()
	if runResumeResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runs after parent resume status = %d, want %d", runResumeResp.StatusCode, http.StatusOK)
	}
	var runsAfterResume []store.Run
	decodeJSON(t, runResumeResp, &runsAfterResume)
	runAfterResume := findRunByIDContract(runsAfterResume, delegatedHandoff.RunID)
	if runAfterResume == nil ||
		!strings.Contains(runAfterResume.NextAction, "第 1 轮") ||
		!strings.Contains(runAfterResume.NextAction, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("run after delegated resume = %#v, want preserved response history next action", runAfterResume)
	}
	completeDelegatedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+detail.Delivery.Delegation.HandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          "最终 delivery closeout 已收口，等待 merge / release receipt。",
	})
	defer completeDelegatedResp.Body.Close()
	if completeDelegatedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated completed status = %d, want %d", completeDelegatedResp.StatusCode, http.StatusOK)
	}

	completedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET completed detail error = %v", err)
	}
	defer completedDetailResp.Body.Close()
	if completedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET completed detail status = %d, want %d", completedDetailResp.StatusCode, http.StatusOK)
	}
	var completedDetail store.PullRequestDetail
	decodeJSON(t, completedDetailResp, &completedDetail)
	if completedDetail.Delivery.Delegation.Status != "done" ||
		completedDetail.Delivery.Delegation.HandoffStatus != "completed" ||
		completedDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(completedDetail.Delivery.Delegation.Summary, "第 1 轮") ||
		!strings.Contains(completedDetail.Delivery.Delegation.Summary, "也已完成 final delivery closeout") {
		t.Fatalf("completed delegation = %#v, want done/completed handoff state with preserved response history", completedDetail.Delivery.Delegation)
	}
	relatedDone := false
	for _, item := range completedDetail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedDone = true
			if item.Kind != "status" || !strings.Contains(item.Title, "已完成") || !strings.Contains(item.Summary, "第 1 轮") || !strings.Contains(item.Summary, "也已完成 final delivery closeout") {
				t.Fatalf("completed delegation inbox item = %#v, want completed delivery delegation signal with preserved response history", item)
			}
		}
	}
	if !relatedDone {
		t.Fatalf("completed related inbox = %#v, want delivery delegation signal", completedDetail.RelatedInbox)
	}

	mailboxCompletedResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox after parent completion error = %v", err)
	}
	defer mailboxCompletedResp.Body.Close()
	if mailboxCompletedResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox after parent completion status = %d, want %d", mailboxCompletedResp.StatusCode, http.StatusOK)
	}
	var mailboxAfterParentComplete []store.AgentHandoff
	decodeJSON(t, mailboxCompletedResp, &mailboxAfterParentComplete)
	parentCompleted := findMailboxHandoffByID(mailboxAfterParentComplete, delegatedHandoff.ID)
	if parentCompleted == nil ||
		!strings.Contains(parentCompleted.LastAction, "第 1 轮") ||
		!strings.Contains(parentCompleted.LastAction, "也已完成 final delivery closeout") {
		t.Fatalf("parent handoff after delegated completion = %#v, want preserved completion history in mailbox", parentCompleted)
	}
	if !hasMailboxMessageContract(parentCompleted.Messages, "response-progress", "release receipt checklist 已补齐") {
		t.Fatalf("parent handoff messages after delegated completion = %#v, want preserved response-progress history", parentCompleted.Messages)
	}

	inboxCompletedResp, err := http.Get(server.URL + "/v1/inbox")
	if err != nil {
		t.Fatalf("GET /v1/inbox after parent completion error = %v", err)
	}
	defer inboxCompletedResp.Body.Close()
	if inboxCompletedResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/inbox after parent completion status = %d, want %d", inboxCompletedResp.StatusCode, http.StatusOK)
	}
	var inboxAfterParentComplete []store.InboxItem
	decodeJSON(t, inboxCompletedResp, &inboxAfterParentComplete)
	parentCompletedInbox := findInboxItemByIDContract(inboxAfterParentComplete, delegatedHandoff.InboxItemID)
	if parentCompletedInbox == nil ||
		!strings.Contains(parentCompletedInbox.Summary, "第 1 轮") ||
		!strings.Contains(parentCompletedInbox.Summary, "也已完成 final delivery closeout") {
		t.Fatalf("parent inbox after delegated completion = %#v, want preserved completion history summary", parentCompletedInbox)
	}
	responseCompleted := findMailboxHandoffByID(mailboxAfterParentComplete, blockedDetail.Delivery.Delegation.ResponseHandoffID)
	if responseCompleted == nil ||
		!strings.Contains(responseCompleted.LastAction, "已完成主 closeout") ||
		!strings.Contains(responseCompleted.LastAction, "第 1 轮") {
		t.Fatalf("response handoff after delegated completion = %#v, want child ledger synced to parent completion", responseCompleted)
	}
	responseCompletedLastMessage := responseCompleted.Messages[len(responseCompleted.Messages)-1]
	if responseCompletedLastMessage.Kind != "parent-progress" ||
		!strings.Contains(responseCompletedLastMessage.Body, "已完成主 closeout") {
		t.Fatalf("response handoff messages after delegated completion = %#v, want completion parent-progress ledger entry", responseCompleted.Messages)
	}
	responseCompletedInbox := findInboxItemByIDContract(inboxAfterParentComplete, responseCompleted.InboxItemID)
	if responseCompletedInbox == nil ||
		!strings.Contains(responseCompletedInbox.Summary, "已完成主 closeout") ||
		!strings.Contains(responseCompletedInbox.Summary, "第 1 轮") {
		t.Fatalf("response inbox after delegated completion = %#v, want child inbox synced to parent completion", responseCompletedInbox)
	}

	runCompletedResp, err := http.Get(server.URL + "/v1/runs")
	if err != nil {
		t.Fatalf("GET /v1/runs after parent completion error = %v", err)
	}
	defer runCompletedResp.Body.Close()
	if runCompletedResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runs after parent completion status = %d, want %d", runCompletedResp.StatusCode, http.StatusOK)
	}
	var runsAfterParentComplete []store.Run
	decodeJSON(t, runCompletedResp, &runsAfterParentComplete)
	runAfterParentComplete := findRunByIDContract(runsAfterParentComplete, delegatedHandoff.RunID)
	if runAfterParentComplete == nil ||
		!strings.Contains(runAfterParentComplete.NextAction, "第 1 轮") ||
		!strings.Contains(runAfterParentComplete.NextAction, "也已完成 final delivery closeout") {
		t.Fatalf("run after delegated completion = %#v, want preserved completion history next action", runAfterParentComplete)
	}
}

func TestDelegatedCloseoutResponseRetryAttemptsReflectInPullRequestDetail(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}

	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeQAResp, &qaCompletePayload)
	delegatedHandoff := qaCompletePayload.State.Mailbox[0]
	if delegatedHandoff.Kind != "delivery-closeout" {
		t.Fatalf("delegated handoff = %#v, want delivery-closeout handoff", delegatedHandoff)
	}

	firstBlockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          "第一轮 blocker：release 文案待确认。",
	})
	defer firstBlockedResp.Body.Close()
	if firstBlockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST first delegated blocked status = %d, want %d", firstBlockedResp.StatusCode, http.StatusOK)
	}

	firstBlockedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET first blocked detail error = %v", err)
	}
	defer firstBlockedDetailResp.Body.Close()
	if firstBlockedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET first blocked detail status = %d, want %d", firstBlockedDetailResp.StatusCode, http.StatusOK)
	}
	var firstBlockedDetail store.PullRequestDetail
	decodeJSON(t, firstBlockedDetailResp, &firstBlockedDetail)
	if firstBlockedDetail.Delivery.Delegation.ResponseAttemptCount != 1 ||
		firstBlockedDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" {
		t.Fatalf("first blocked delegation = %#v, want first response attempt requested", firstBlockedDetail.Delivery.Delegation)
	}
	firstResponseHandoffID := firstBlockedDetail.Delivery.Delegation.ResponseHandoffID

	firstResponseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+firstResponseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer firstResponseAckResp.Body.Close()
	if firstResponseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST first delivery reply acknowledged status = %d, want %d", firstResponseAckResp.StatusCode, http.StatusOK)
	}
	firstResponseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+firstResponseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          "第一轮 unblock response 已补齐。",
	})
	defer firstResponseCompleteResp.Body.Close()
	if firstResponseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST first delivery reply completed status = %d, want %d", firstResponseCompleteResp.StatusCode, http.StatusOK)
	}

	reAckDelegatedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.ToAgentID,
	})
	defer reAckDelegatedResp.Body.Close()
	if reAckDelegatedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated re-ack status = %d, want %d", reAckDelegatedResp.StatusCode, http.StatusOK)
	}
	secondBlockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          "第二轮 blocker：release owner 还没签字。",
	})
	defer secondBlockedResp.Body.Close()
	if secondBlockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST second delegated blocked status = %d, want %d", secondBlockedResp.StatusCode, http.StatusOK)
	}

	secondBlockedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET second blocked detail error = %v", err)
	}
	defer secondBlockedDetailResp.Body.Close()
	if secondBlockedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET second blocked detail status = %d, want %d", secondBlockedDetailResp.StatusCode, http.StatusOK)
	}
	var secondBlockedDetail store.PullRequestDetail
	decodeJSON(t, secondBlockedDetailResp, &secondBlockedDetail)
	if secondBlockedDetail.Delivery.Delegation.ResponseAttemptCount != 2 ||
		secondBlockedDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" ||
		secondBlockedDetail.Delivery.Delegation.ResponseHandoffID == firstResponseHandoffID ||
		!strings.Contains(secondBlockedDetail.Delivery.Delegation.Summary, "第 2 轮") {
		t.Fatalf("second blocked delegation = %#v, want second response retry surfaced", secondBlockedDetail.Delivery.Delegation)
	}

	secondResponseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+secondBlockedDetail.Delivery.Delegation.ResponseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer secondResponseAckResp.Body.Close()
	if secondResponseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST second delivery reply acknowledged status = %d, want %d", secondResponseAckResp.StatusCode, http.StatusOK)
	}
	secondResponseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+secondBlockedDetail.Delivery.Delegation.ResponseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          "第二轮 unblock response 已补齐，请重新接住。",
	})
	defer secondResponseCompleteResp.Body.Close()
	if secondResponseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST second delivery reply completed status = %d, want %d", secondResponseCompleteResp.StatusCode, http.StatusOK)
	}

	secondResponseDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET second response detail error = %v", err)
	}
	defer secondResponseDetailResp.Body.Close()
	if secondResponseDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET second response detail status = %d, want %d", secondResponseDetailResp.StatusCode, http.StatusOK)
	}
	var secondResponseDetail store.PullRequestDetail
	decodeJSON(t, secondResponseDetailResp, &secondResponseDetail)
	if secondResponseDetail.Delivery.Delegation.Status != "blocked" ||
		secondResponseDetail.Delivery.Delegation.ResponseAttemptCount != 2 ||
		secondResponseDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(secondResponseDetail.Delivery.Delegation.Summary, "第 2 轮") {
		t.Fatalf("second response detail delegation = %#v, want completed second retry response", secondResponseDetail.Delivery.Delegation)
	}
}

func TestDelegatedResponseCommentsReflectInPullRequestDetail(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}
	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeQAResp, &qaCompletePayload)
	delegatedHandoff := qaCompletePayload.State.Mailbox[0]

	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          "需要先确认最终 release 文案，再继续 closeout。",
	})
	defer blockedResp.Body.Close()
	if blockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated blocked status = %d, want %d", blockedResp.StatusCode, http.StatusOK)
	}

	blockedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET blocked detail error = %v", err)
	}
	defer blockedDetailResp.Body.Close()
	if blockedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET blocked detail status = %d, want %d", blockedDetailResp.StatusCode, http.StatusOK)
	}
	var blockedDetail store.PullRequestDetail
	decodeJSON(t, blockedDetailResp, &blockedDetail)
	responseHandoffID := blockedDetail.Delivery.Delegation.ResponseHandoffID
	if responseHandoffID == "" {
		t.Fatalf("blocked delegation = %#v, want response handoff", blockedDetail.Delivery.Delegation)
	}

	sourceComment := "source 说明：release receipt checklist 正在补。"
	sourceCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "comment",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          sourceComment,
	})
	defer sourceCommentResp.Body.Close()
	if sourceCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST source comment response handoff status = %d, want %d", sourceCommentResp.StatusCode, http.StatusOK)
	}

	sourceDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET source comment detail error = %v", err)
	}
	defer sourceDetailResp.Body.Close()
	if sourceDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET source comment detail status = %d, want %d", sourceDetailResp.StatusCode, http.StatusOK)
	}
	var sourceDetail store.PullRequestDetail
	decodeJSON(t, sourceDetailResp, &sourceDetail)
	if sourceDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" ||
		!strings.Contains(sourceDetail.Delivery.Delegation.Summary, sourceComment) {
		t.Fatalf("source comment delegation = %#v, want response comment sync", sourceDetail.Delivery.Delegation)
	}

	targetComment := "target 回应：等 owner 签字后我会重新接住。"
	targetCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "comment",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          targetComment,
	})
	defer targetCommentResp.Body.Close()
	if targetCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST target comment response handoff status = %d, want %d", targetCommentResp.StatusCode, http.StatusOK)
	}

	targetDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET target comment detail error = %v", err)
	}
	defer targetDetailResp.Body.Close()
	if targetDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET target comment detail status = %d, want %d", targetDetailResp.StatusCode, http.StatusOK)
	}
	var targetDetail store.PullRequestDetail
	decodeJSON(t, targetDetailResp, &targetDetail)
	if targetDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" ||
		!strings.Contains(targetDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("target comment delegation = %#v, want latest target response comment sync", targetDetail.Delivery.Delegation)
	}

	responseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer responseAckResp.Body.Close()
	if responseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response acknowledged status = %d, want %d", responseAckResp.StatusCode, http.StatusOK)
	}

	responseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          "release receipt checklist 已补齐，请重新接住 delivery closeout。",
	})
	defer responseCompleteResp.Body.Close()
	if responseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response completed status = %d, want %d", responseCompleteResp.StatusCode, http.StatusOK)
	}

	responseCompletedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET response completed detail error = %v", err)
	}
	defer responseCompletedDetailResp.Body.Close()
	if responseCompletedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET response completed detail status = %d, want %d", responseCompletedDetailResp.StatusCode, http.StatusOK)
	}
	var responseCompletedDetail store.PullRequestDetail
	decodeJSON(t, responseCompletedDetailResp, &responseCompletedDetail)
	if !strings.Contains(responseCompletedDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("response completed delegation = %#v, want latest target response comment preserved", responseCompletedDetail.Delivery.Delegation)
	}

	parentAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.ToAgentID,
	})
	defer parentAckResp.Body.Close()
	if parentAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST parent acknowledged after response comment status = %d, want %d", parentAckResp.StatusCode, http.StatusOK)
	}

	parentResumedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET parent resumed detail error = %v", err)
	}
	defer parentResumedDetailResp.Body.Close()
	if parentResumedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET parent resumed detail status = %d, want %d", parentResumedDetailResp.StatusCode, http.StatusOK)
	}
	var parentResumedDetail store.PullRequestDetail
	decodeJSON(t, parentResumedDetailResp, &parentResumedDetail)
	if !strings.Contains(parentResumedDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("parent resumed delegation = %#v, want latest target response comment preserved", parentResumedDetail.Delivery.Delegation)
	}

	parentCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          "最终 delivery closeout 已收口，等待 merge / release receipt。",
	})
	defer parentCompleteResp.Body.Close()
	if parentCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST parent completed after response comment status = %d, want %d", parentCompleteResp.StatusCode, http.StatusOK)
	}

	parentCompletedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET parent completed detail error = %v", err)
	}
	defer parentCompletedDetailResp.Body.Close()
	if parentCompletedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET parent completed detail status = %d, want %d", parentCompletedDetailResp.StatusCode, http.StatusOK)
	}
	var parentCompletedDetail store.PullRequestDetail
	decodeJSON(t, parentCompletedDetailResp, &parentCompletedDetail)
	if !strings.Contains(parentCompletedDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("parent completed delegation = %#v, want latest target response comment preserved", parentCompletedDetail.Delivery.Delegation)
	}
}

func TestDelegatedResponseProgressReflectsInParentMailboxAndRun(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}
	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeQAResp, &qaCompletePayload)
	delegatedHandoff := qaCompletePayload.State.Mailbox[0]

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          blockNote,
	})
	defer blockedResp.Body.Close()
	if blockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated blocked status = %d, want %d", blockedResp.StatusCode, http.StatusOK)
	}

	blockedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET blocked detail error = %v", err)
	}
	defer blockedDetailResp.Body.Close()
	if blockedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET blocked detail status = %d, want %d", blockedDetailResp.StatusCode, http.StatusOK)
	}
	var blockedDetail store.PullRequestDetail
	decodeJSON(t, blockedDetailResp, &blockedDetail)
	responseHandoffID := blockedDetail.Delivery.Delegation.ResponseHandoffID
	if responseHandoffID == "" {
		t.Fatalf("blocked delegation = %#v, want response handoff", blockedDetail.Delivery.Delegation)
	}

	sourceComment := "source 说明：release receipt checklist 正在补。"
	sourceCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "comment",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          sourceComment,
	})
	defer sourceCommentResp.Body.Close()
	if sourceCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST source comment response handoff status = %d, want %d", sourceCommentResp.StatusCode, http.StatusOK)
	}

	mailboxResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox after response comment error = %v", err)
	}
	defer mailboxResp.Body.Close()
	if mailboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox after response comment status = %d, want %d", mailboxResp.StatusCode, http.StatusOK)
	}
	var mailboxAfterComment []store.AgentHandoff
	decodeJSON(t, mailboxResp, &mailboxAfterComment)
	parentComment := findMailboxHandoffByID(mailboxAfterComment, delegatedHandoff.ID)
	if parentComment == nil ||
		parentComment.LastNote != blockNote ||
		!strings.Contains(parentComment.LastAction, sourceComment) ||
		!strings.Contains(parentComment.LastAction, "重新 acknowledge 主 closeout") {
		t.Fatalf("parent handoff after response comment = %#v, want mirrored resume guidance", parentComment)
	}

	inboxCommentResp, err := http.Get(server.URL + "/v1/inbox")
	if err != nil {
		t.Fatalf("GET /v1/inbox after response comment error = %v", err)
	}
	defer inboxCommentResp.Body.Close()
	if inboxCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/inbox after response comment status = %d, want %d", inboxCommentResp.StatusCode, http.StatusOK)
	}
	var inboxAfterComment []store.InboxItem
	decodeJSON(t, inboxCommentResp, &inboxAfterComment)
	parentCommentInbox := findInboxItemByIDContract(inboxAfterComment, delegatedHandoff.InboxItemID)
	if parentCommentInbox == nil ||
		!strings.Contains(parentCommentInbox.Summary, blockNote) ||
		!strings.Contains(parentCommentInbox.Summary, sourceComment) {
		t.Fatalf("parent inbox after response comment = %#v, want blocker + response progress summary", parentCommentInbox)
	}
	stateCommentResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state after response comment error = %v", err)
	}
	defer stateCommentResp.Body.Close()
	if stateCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state after response comment status = %d, want %d", stateCommentResp.StatusCode, http.StatusOK)
	}
	var stateAfterComment store.State
	decodeJSON(t, stateCommentResp, &stateAfterComment)
	if !roomMessagesContain(stateAfterComment, "room-runtime", "[Mailbox Sync]") ||
		!roomMessagesContain(stateAfterComment, "room-runtime", sourceComment) {
		t.Fatalf("room messages after response comment = %#v, want room sync trace for child response comment", stateAfterComment.RoomMessages["room-runtime"])
	}

	runCommentResp, err := http.Get(server.URL + "/v1/runs")
	if err != nil {
		t.Fatalf("GET /v1/runs after response comment error = %v", err)
	}
	defer runCommentResp.Body.Close()
	if runCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runs after response comment status = %d, want %d", runCommentResp.StatusCode, http.StatusOK)
	}
	var runsAfterComment []store.Run
	decodeJSON(t, runCommentResp, &runsAfterComment)
	runAfterComment := findRunByIDContract(runsAfterComment, delegatedHandoff.RunID)
	if runAfterComment == nil || !strings.Contains(runAfterComment.NextAction, sourceComment) {
		t.Fatalf("run after response comment = %#v, want response progress next action", runAfterComment)
	}

	responseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer responseAckResp.Body.Close()
	if responseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response acknowledged status = %d, want %d", responseAckResp.StatusCode, http.StatusOK)
	}

	completeNote := "release receipt checklist 已补齐，请重新接住 delivery closeout。"
	responseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          completeNote,
	})
	defer responseCompleteResp.Body.Close()
	if responseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response completed status = %d, want %d", responseCompleteResp.StatusCode, http.StatusOK)
	}

	mailboxCompleteResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox after response completion error = %v", err)
	}
	defer mailboxCompleteResp.Body.Close()
	if mailboxCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox after response completion status = %d, want %d", mailboxCompleteResp.StatusCode, http.StatusOK)
	}
	var mailboxAfterComplete []store.AgentHandoff
	decodeJSON(t, mailboxCompleteResp, &mailboxAfterComplete)
	parentComplete := findMailboxHandoffByID(mailboxAfterComplete, delegatedHandoff.ID)
	if parentComplete == nil ||
		parentComplete.LastNote != blockNote ||
		!strings.Contains(parentComplete.LastAction, completeNote) ||
		!strings.Contains(parentComplete.LastAction, "重新 acknowledge 主 closeout") {
		t.Fatalf("parent handoff after response completion = %#v, want resume-after-response signal", parentComplete)
	}

	inboxCompleteResp, err := http.Get(server.URL + "/v1/inbox")
	if err != nil {
		t.Fatalf("GET /v1/inbox after response completion error = %v", err)
	}
	defer inboxCompleteResp.Body.Close()
	if inboxCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/inbox after response completion status = %d, want %d", inboxCompleteResp.StatusCode, http.StatusOK)
	}
	var inboxAfterComplete []store.InboxItem
	decodeJSON(t, inboxCompleteResp, &inboxAfterComplete)
	parentCompleteInbox := findInboxItemByIDContract(inboxAfterComplete, delegatedHandoff.InboxItemID)
	if parentCompleteInbox == nil ||
		!strings.Contains(parentCompleteInbox.Summary, blockNote) ||
		!strings.Contains(parentCompleteInbox.Summary, completeNote) {
		t.Fatalf("parent inbox after response completion = %#v, want completion progress summary", parentCompleteInbox)
	}
	stateCompleteResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state after response completion error = %v", err)
	}
	defer stateCompleteResp.Body.Close()
	if stateCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state after response completion status = %d, want %d", stateCompleteResp.StatusCode, http.StatusOK)
	}
	var stateAfterComplete store.State
	decodeJSON(t, stateCompleteResp, &stateAfterComplete)
	if !roomMessagesContain(stateAfterComplete, "room-runtime", sourceComment) ||
		!roomMessagesContain(stateAfterComplete, "room-runtime", completeNote) {
		t.Fatalf("room messages after response completion = %#v, want preserved room sync trace for child response progress", stateAfterComplete.RoomMessages["room-runtime"])
	}

	runCompleteResp, err := http.Get(server.URL + "/v1/runs")
	if err != nil {
		t.Fatalf("GET /v1/runs after response completion error = %v", err)
	}
	defer runCompleteResp.Body.Close()
	if runCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runs after response completion status = %d, want %d", runCompleteResp.StatusCode, http.StatusOK)
	}
	var runsAfterComplete []store.Run
	decodeJSON(t, runCompleteResp, &runsAfterComplete)
	runAfterComplete := findRunByIDContract(runsAfterComplete, delegatedHandoff.RunID)
	if runAfterComplete == nil || !strings.Contains(runAfterComplete.NextAction, completeNote) {
		t.Fatalf("run after response completion = %#v, want completion resume next action", runAfterComplete)
	}
}

func TestSignalOnlyDeliveryDelegationPolicySkipsDelegatedCloseoutHandoff(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"deliveryDelegationMode": "signal-only",
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}
	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	detailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET detail error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}
	var detail store.PullRequestDetail
	decodeJSON(t, detailResp, &detail)
	if detail.Delivery.Delegation.Status != "ready" ||
		detail.Delivery.Delegation.TargetAgent != "Spec Captain" ||
		detail.Delivery.Delegation.HandoffID != "" ||
		detail.Delivery.Delegation.HandoffStatus != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "signal-only") {
		t.Fatalf("detail delegation = %#v, want signal-only delegate without formal handoff", detail.Delivery.Delegation)
	}

	relatedDelegation := false
	for _, item := range detail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedDelegation = true
			if item.Kind != "status" || !strings.Contains(item.Summary, "signal-only") {
				t.Fatalf("delegation inbox item = %#v, want signal-only delivery delegation signal", item)
			}
		}
	}
	if !relatedDelegation {
		t.Fatalf("detail related inbox = %#v, want delivery delegation inbox signal", detail.RelatedInbox)
	}

	mailboxResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET mailbox error = %v", err)
	}
	defer mailboxResp.Body.Close()
	if mailboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET mailbox status = %d, want %d", mailboxResp.StatusCode, http.StatusOK)
	}
	var mailbox []store.AgentHandoff
	decodeJSON(t, mailboxResp, &mailbox)
	for _, item := range mailbox {
		if item.Kind == "delivery-closeout" && item.RoomID == "room-runtime" {
			t.Fatalf("mailbox = %#v, want no auto-created delegated closeout handoff", mailbox)
		}
	}
}

func TestDelegatedCloseoutCommentsSyncToPullRequestDetailAndInbox(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)
	handoff := createPayload.Handoff

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}
	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeQAResp, &qaCompletePayload)
	delegatedHandoff := qaCompletePayload.State.Mailbox[0]
	if delegatedHandoff.Kind != "delivery-closeout" {
		t.Fatalf("delegated handoff = %#v, want delivery-closeout handoff", delegatedHandoff)
	}

	sourceComment := "QA 已补充 release receipt checklist，先按这个清单收最终 operator closeout。"
	sourceCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "comment",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          sourceComment,
	})
	defer sourceCommentResp.Body.Close()
	if sourceCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST source comment status = %d, want %d", sourceCommentResp.StatusCode, http.StatusOK)
	}

	sourceDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET source-comment detail error = %v", err)
	}
	defer sourceDetailResp.Body.Close()
	if sourceDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET source-comment detail status = %d, want %d", sourceDetailResp.StatusCode, http.StatusOK)
	}
	var sourceDetail store.PullRequestDetail
	decodeJSON(t, sourceDetailResp, &sourceDetail)
	if sourceDetail.Delivery.Delegation.Status != "ready" ||
		sourceDetail.Delivery.Delegation.HandoffStatus != "requested" ||
		!strings.Contains(sourceDetail.Delivery.Delegation.Summary, sourceComment) {
		t.Fatalf("source-comment detail delegation = %#v, want requested summary with source comment", sourceDetail.Delivery.Delegation)
	}

	targetComment := "Spec Captain 已收到 checklist，会按这个顺序补最终 release note 和 receipt。"
	targetCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "comment",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          targetComment,
	})
	defer targetCommentResp.Body.Close()
	if targetCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST target comment status = %d, want %d", targetCommentResp.StatusCode, http.StatusOK)
	}

	targetDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET target-comment detail error = %v", err)
	}
	defer targetDetailResp.Body.Close()
	if targetDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET target-comment detail status = %d, want %d", targetDetailResp.StatusCode, http.StatusOK)
	}
	var targetDetail store.PullRequestDetail
	decodeJSON(t, targetDetailResp, &targetDetail)
	if targetDetail.Delivery.Delegation.Status != "ready" ||
		targetDetail.Delivery.Delegation.HandoffStatus != "requested" ||
		!strings.Contains(targetDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("target-comment detail delegation = %#v, want requested summary with target comment", targetDetail.Delivery.Delegation)
	}

	relatedComment := false
	for _, item := range targetDetail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedComment = true
			if !strings.Contains(item.Summary, targetComment) {
				t.Fatalf("target-comment inbox item = %#v, want latest target comment", item)
			}
		}
	}
	if !relatedComment {
		t.Fatalf("target-comment related inbox = %#v, want delivery delegation inbox signal", targetDetail.RelatedInbox)
	}
}

func TestAutoCompleteDeliveryDelegationPolicyMarksCloseoutDoneWithoutHandoff(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"deliveryDelegationMode": "auto-complete",
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Spec Captain","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Spec Captain","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}
	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}
	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed continue status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}
	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	detailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET detail error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}
	var detail store.PullRequestDetail
	decodeJSON(t, detailResp, &detail)
	if detail.Delivery.Delegation.Status != "done" ||
		detail.Delivery.Delegation.TargetAgent != "Spec Captain" ||
		detail.Delivery.Delegation.HandoffID != "" ||
		detail.Delivery.Delegation.HandoffStatus != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "auto-complete") {
		t.Fatalf("detail delegation = %#v, want auto-complete delegate without formal handoff", detail.Delivery.Delegation)
	}
	if !strings.Contains(detail.Delivery.HandoffNote.Summary, "auto-closeout policy") {
		t.Fatalf("detail handoff note = %#v, want auto-closeout policy summary", detail.Delivery.HandoffNote)
	}

	relatedDelegation := false
	for _, item := range detail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedDelegation = true
			if item.Kind != "status" || !strings.Contains(item.Summary, "auto-complete") {
				t.Fatalf("delegation inbox item = %#v, want auto-complete delivery delegation signal", item)
			}
		}
	}
	if !relatedDelegation {
		t.Fatalf("detail related inbox = %#v, want delivery delegation inbox signal", detail.RelatedInbox)
	}

	mailboxResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET mailbox error = %v", err)
	}
	defer mailboxResp.Body.Close()
	if mailboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET mailbox status = %d, want %d", mailboxResp.StatusCode, http.StatusOK)
	}
	var mailbox []store.AgentHandoff
	decodeJSON(t, mailboxResp, &mailbox)
	for _, item := range mailbox {
		if item.Kind == "delivery-closeout" && item.RoomID == "room-runtime" {
			t.Fatalf("mailbox = %#v, want no auto-created delegated closeout handoff", mailbox)
		}
	}
}

func TestRunHistoryRouteSupportsIncrementalFetchAndRoomFilter(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	firstResp, err := http.Get(server.URL + "/v1/runs/history?limit=2")
	if err != nil {
		t.Fatalf("GET run history error = %v", err)
	}
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("GET run history status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	var firstPage store.RunHistoryPage
	decodeJSON(t, firstResp, &firstPage)
	if len(firstPage.Items) != 2 || firstPage.TotalCount < 5 || firstPage.NextCursor == "" {
		t.Fatalf("first history page malformed: %#v", firstPage)
	}
	if firstPage.Items[0].Session.ActiveRunID != firstPage.Items[0].Run.ID || len(firstPage.Items[0].Session.MemoryPaths) == 0 {
		t.Fatalf("first history item missing resume context: %#v", firstPage.Items[0])
	}

	secondResp, err := http.Get(server.URL + "/v1/runs/history?limit=2&cursor=" + firstPage.NextCursor)
	if err != nil {
		t.Fatalf("GET second run history page error = %v", err)
	}
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("GET second run history page status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var secondPage store.RunHistoryPage
	decodeJSON(t, secondResp, &secondPage)
	if len(secondPage.Items) == 0 {
		t.Fatalf("second history page empty: %#v", secondPage)
	}
	if secondPage.Items[0].Run.ID == firstPage.Items[0].Run.ID {
		t.Fatalf("history cursor did not advance: first=%#v second=%#v", firstPage.Items, secondPage.Items)
	}

	roomResp, err := http.Get(server.URL + "/v1/runs/history?roomId=room-runtime&limit=5")
	if err != nil {
		t.Fatalf("GET room run history error = %v", err)
	}
	defer roomResp.Body.Close()
	if roomResp.StatusCode != http.StatusOK {
		t.Fatalf("GET room run history status = %d, want %d", roomResp.StatusCode, http.StatusOK)
	}

	var roomPage store.RunHistoryPage
	decodeJSON(t, roomResp, &roomPage)
	if len(roomPage.Items) < 2 {
		t.Fatalf("room history should include current + prior run: %#v", roomPage)
	}
	if roomPage.Items[0].Run.ID != "run_runtime_01" || !roomPage.Items[0].IsCurrent {
		t.Fatalf("room history current entry = %#v, want current runtime run first", roomPage.Items[0])
	}
	if roomPage.Items[1].Run.ID != "run_runtime_00" || roomPage.Items[1].IsCurrent {
		t.Fatalf("room history prior entry = %#v, want prior runtime run second", roomPage.Items[1])
	}
}

func TestRunDetailRouteReturnsResumeContextAndRoomHistory(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/runs/run_runtime_01/detail")
	if err != nil {
		t.Fatalf("GET run detail envelope error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET run detail envelope status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var detail store.RunDetail
	decodeJSON(t, resp, &detail)
	if detail.Run.ID != "run_runtime_01" || detail.Room.ID != "room-runtime" || detail.Issue.Key != "OPS-12" {
		t.Fatalf("run detail backlinks malformed: %#v", detail)
	}
	if detail.Session.ActiveRunID != detail.Run.ID || detail.Session.Worktree != detail.Run.Worktree || len(detail.Session.MemoryPaths) == 0 {
		t.Fatalf("run detail resume context malformed: %#v", detail.Session)
	}
	if len(detail.History) < 2 {
		t.Fatalf("run detail history too short: %#v", detail.History)
	}
	if detail.History[0].Run.ID != "run_runtime_01" || !detail.History[0].IsCurrent {
		t.Fatalf("run detail current history entry = %#v, want current run first", detail.History[0])
	}
	if detail.History[1].Run.ID != "run_runtime_00" {
		t.Fatalf("run detail prior history entry = %#v, want prior runtime run", detail.History[1])
	}
}

func TestPullRequestRouteEscalatesBlockedOnGitHubSyncFailure(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Sync Failure Escalation",
		Summary:  "verify sync failure escalation",
		Owner:    "Codex Dockmaster",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         88,
		Title:          "Sync Failure Escalation",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/88",
		ReviewDecision: "REVIEW_REQUIRED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}

	github := &fakeGitHubClient{syncErr: errors.New("github api timeout")}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/pull-requests/" + pullRequestID)
	if err != nil {
		t.Fatalf("GET pull request error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("GET pull request status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error         string      `json:"error"`
		Operation     string      `json:"operation"`
		RoomID        string      `json:"roomId"`
		PullRequestID string      `json:"pullRequestId"`
		State         store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Error != "github api timeout" || payload.Operation != "sync" || payload.RoomID != created.RoomID || payload.PullRequestID != pullRequestID {
		t.Fatalf("sync failure payload = %#v, want error/operation/ids populated", payload)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	if room == nil || run == nil {
		t.Fatalf("expected room/run after sync escalation")
	}
	pr, ok := findPullRequestByID(payload.State, pullRequestID)
	if !ok {
		t.Fatalf("pull request %q missing from sync failure payload", pullRequestID)
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" {
		t.Fatalf("sync escalation did not block room/run: room=%#v run=%#v", room, run)
	}
	if pr.Status != "changes_requested" || pr.ReviewDecision != "" || !strings.Contains(pr.ReviewSummary, "PR #88 同步失败：github api timeout") {
		t.Fatalf("sync failure pull request = %#v, want blocked GitHub failure semantics", pr)
	}
	if !strings.Contains(run.NextAction, "重试同步") {
		t.Fatalf("run next action = %q, want GitHub sync retry guidance", run.NextAction)
	}
	if len(payload.State.Inbox) == 0 || payload.State.Inbox[0].Title != "PR #88 同步失败" || payload.State.Inbox[0].Kind != "blocked" || payload.State.Inbox[0].Action != "处理 GitHub 阻塞" {
		t.Fatalf("sync failure inbox malformed: %#v", payload.State.Inbox)
	}
	if inboxHasKindAndHref(payload.State, "review", "/rooms/"+created.RoomID+"/runs/"+created.RunID) {
		t.Fatalf("stale review inbox item remained after sync failure escalation: %#v", payload.State.Inbox)
	}
	if !roomMessagesContain(payload.State, created.RoomID, "PR #88 同步失败：github api timeout") {
		t.Fatalf("room messages missing GitHub sync failure escalation: %#v", payload.State.RoomMessages[created.RoomID])
	}
}

func TestPullRequestRouteEscalatesBlockedOnGitHubAppReviewDecisionSyncFailure(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "App Review Decision Sync Failure",
		Summary:  "verify github app review decision failure escalates blocked sync",
		Owner:    "Codex Dockmaster",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         188,
		Title:          "App Review Decision Sync Failure",
		Status:         "changes_requested",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/188",
		ReviewDecision: "CHANGES_REQUESTED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}

	githubAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/188":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     188,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/188",
				"title":      "App Review Decision Sync Failure",
				"state":      "open",
				"draft":      false,
				"merged":     false,
				"updated_at": "2026-04-06T14:12:00Z",
				"head":       map[string]any{"ref": created.Branch},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "graphql review decision timeout"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer githubAPI.Close()

	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID", "67890")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", githubAPI.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", githubAPI.URL+"/graphql")

	github := githubsvc.NewService(fakeGitHubExecRunner{
		outputs: map[string]string{
			"git -C " + root + " remote get-url origin":       "https://github.com/Larkspur-Wang/OpenShock.git",
			"git -C " + root + " rev-parse --abbrev-ref HEAD": "main",
		},
	})
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/pull-requests/" + pullRequestID)
	if err != nil {
		t.Fatalf("GET pull request error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("GET pull request status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error         string      `json:"error"`
		Operation     string      `json:"operation"`
		RoomID        string      `json:"roomId"`
		PullRequestID string      `json:"pullRequestId"`
		State         store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Error != "graphql review decision timeout" || payload.Operation != "sync" || payload.RoomID != created.RoomID || payload.PullRequestID != pullRequestID {
		t.Fatalf("sync failure payload = %#v, want graphql sync error with ids populated", payload)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	if room == nil || run == nil {
		t.Fatalf("expected room/run after app review decision sync escalation")
	}
	pr, ok := findPullRequestByID(payload.State, pullRequestID)
	if !ok {
		t.Fatalf("pull request %q missing from sync failure payload", pullRequestID)
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" {
		t.Fatalf("sync escalation did not block room/run: room=%#v run=%#v", room, run)
	}
	if pr.Status != "changes_requested" || pr.ReviewDecision != "" || !strings.Contains(pr.ReviewSummary, "PR #188 同步失败：graphql review decision timeout") {
		t.Fatalf("sync failure pull request = %#v, want blocked GitHub failure semantics preserved", pr)
	}
	if !roomMessagesContain(payload.State, created.RoomID, "PR #188 同步失败：graphql review decision timeout") {
		t.Fatalf("room messages missing GitHub app review decision sync failure escalation: %#v", payload.State.RoomMessages[created.RoomID])
	}
}

func TestPullRequestRouteSyncFailureIsIdempotentAcrossRepeatedReads(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Sync Failure Idempotency",
		Summary:  "verify repeated read does not duplicate blocked evidence",
		Owner:    "Codex Dockmaster",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         108,
		Title:          "Sync Failure Idempotency",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/108",
		ReviewDecision: "REVIEW_REQUIRED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}

	github := &fakeGitHubClient{syncErr: errors.New("github api timeout")}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	firstResp, err := http.Get(server.URL + "/v1/pull-requests/" + pullRequestID)
	if err != nil {
		t.Fatalf("first GET pull request error = %v", err)
	}
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusBadGateway {
		t.Fatalf("first GET pull request status = %d, want %d", firstResp.StatusCode, http.StatusBadGateway)
	}

	secondResp, err := http.Get(server.URL + "/v1/pull-requests/" + pullRequestID)
	if err != nil {
		t.Fatalf("second GET pull request error = %v", err)
	}
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusBadGateway {
		t.Fatalf("second GET pull request status = %d, want %d", secondResp.StatusCode, http.StatusBadGateway)
	}

	var firstPayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, firstResp, &firstPayload)

	var secondPayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &secondPayload)

	firstRoom := findRoomByID(firstPayload.State, created.RoomID)
	secondRoom := findRoomByID(secondPayload.State, created.RoomID)
	firstRun := findRunByID(firstPayload.State, created.RunID)
	secondRun := findRunByID(secondPayload.State, created.RunID)
	if firstRoom == nil || secondRoom == nil || firstRun == nil || secondRun == nil {
		t.Fatalf("expected room/run snapshots after repeated sync failure")
	}

	if countRoomMessages(secondPayload.State, created.RoomID, "PR #108 同步失败：github api timeout") != 1 {
		t.Fatalf("room messages duplicated after repeated read: %#v", secondPayload.State.RoomMessages[created.RoomID])
	}
	if countInboxItems(secondPayload.State, "blocked", "PR #108 同步失败", "/rooms/"+created.RoomID+"/runs/"+created.RunID) != 1 {
		t.Fatalf("blocked inbox items duplicated after repeated read: %#v", secondPayload.State.Inbox)
	}
	if secondRoom.Unread != firstRoom.Unread || secondRoom.Unread != 1 {
		t.Fatalf("room unread after repeated read = %d (first=%d), want stable 1", secondRoom.Unread, firstRoom.Unread)
	}
	if len(secondPayload.State.RoomMessages[created.RoomID]) != len(firstPayload.State.RoomMessages[created.RoomID]) {
		t.Fatalf("room messages length changed after repeated read: first=%d second=%d", len(firstPayload.State.RoomMessages[created.RoomID]), len(secondPayload.State.RoomMessages[created.RoomID]))
	}
	if len(secondPayload.State.Inbox) != len(firstPayload.State.Inbox) {
		t.Fatalf("inbox length changed after repeated read: first=%d second=%d", len(firstPayload.State.Inbox), len(secondPayload.State.Inbox))
	}
	if len(secondRun.Timeline) != len(firstRun.Timeline) || countRunTimelineLabels(secondRun.Timeline, "PR #108 同步失败") != 1 {
		t.Fatalf("run timeline duplicated after repeated read: first=%#v second=%#v", firstRun.Timeline, secondRun.Timeline)
	}
	if len(secondRun.Stderr) != len(firstRun.Stderr) {
		t.Fatalf("run stderr duplicated after repeated read: first=%#v second=%#v", firstRun.Stderr, secondRun.Stderr)
	}
}

func TestPullRequestRouteEscalatesBlockedOnGitHubMergeFailure(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Merge Failure Escalation",
		Summary:  "verify merge failure escalation",
		Owner:    "Codex Dockmaster",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         96,
		Title:          "Merge Failure Escalation",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/96",
		ReviewDecision: "APPROVED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}

	github := &fakeGitHubClient{mergeErr: errors.New("merge blocked by branch protections")}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"status": "merged"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/pull-requests/"+pullRequestID, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST merge pull request error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("POST merge pull request status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error         string      `json:"error"`
		Operation     string      `json:"operation"`
		RoomID        string      `json:"roomId"`
		PullRequestID string      `json:"pullRequestId"`
		State         store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Error != "merge blocked by branch protections" || payload.Operation != "merge" || payload.RoomID != created.RoomID || payload.PullRequestID != pullRequestID {
		t.Fatalf("merge failure payload = %#v, want error/operation/ids populated", payload)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	if room == nil || run == nil {
		t.Fatalf("expected room/run after merge escalation")
	}
	pr, ok := findPullRequestByID(payload.State, pullRequestID)
	if !ok {
		t.Fatalf("pull request %q missing from merge failure payload", pullRequestID)
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" {
		t.Fatalf("merge escalation did not block room/run: room=%#v run=%#v", room, run)
	}
	if pr.Status != "changes_requested" || pr.ReviewDecision != "" || !strings.Contains(pr.ReviewSummary, "PR #96 合并失败：merge blocked by branch protections") {
		t.Fatalf("merge failure pull request = %#v, want blocked GitHub failure semantics", pr)
	}
	if pr.MergeStateStatus != "BLOCKED" {
		t.Fatalf("merge failure safety truth = %#v, want mergeStateStatus BLOCKED", pr)
	}
	if !strings.Contains(run.NextAction, "重试合并") {
		t.Fatalf("run next action = %q, want GitHub merge retry guidance", run.NextAction)
	}
	if len(payload.State.Inbox) == 0 || payload.State.Inbox[0].Title != "PR #96 合并失败" || payload.State.Inbox[0].Kind != "blocked" || payload.State.Inbox[0].Action != "处理 GitHub 阻塞" {
		t.Fatalf("merge failure inbox malformed: %#v", payload.State.Inbox)
	}
	if inboxHasKindAndHref(payload.State, "review", "/rooms/"+created.RoomID+"/runs/"+created.RunID) {
		t.Fatalf("stale review inbox item remained after merge failure escalation: %#v", payload.State.Inbox)
	}
	if !roomMessagesContain(payload.State, created.RoomID, "PR #96 合并失败：merge blocked by branch protections") {
		t.Fatalf("room messages missing GitHub merge failure escalation: %#v", payload.State.RoomMessages[created.RoomID])
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

func testGitHubAppPrivateKeyPEM(t *testing.T) string {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}

	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}))
}

func assertMemoryArtifactSummary(t *testing.T, items []store.MemoryArtifact, path, want string) {
	t.Helper()
	for _, item := range items {
		if item.Path != path {
			continue
		}
		if item.UpdatedAt == "" || !strings.Contains(item.Summary, want) {
			t.Fatalf("memory artifact %q = %#v, want UpdatedAt set and summary containing %q", path, item, want)
		}
		return
	}
	t.Fatalf("memory artifact %q missing", path)
}

func findMemoryArtifactByPath(items []store.MemoryArtifact, path string) *store.MemoryArtifact {
	for index := range items {
		if items[index].Path == path {
			return &items[index]
		}
	}
	return nil
}

func findPullRequestByID(state store.State, pullRequestID string) (store.PullRequest, bool) {
	for _, item := range state.PullRequests {
		if item.ID == pullRequestID {
			return item, true
		}
	}
	return store.PullRequest{}, false
}

func findIssueByRoomID(state store.State, roomID string) *store.Issue {
	for index := range state.Issues {
		if state.Issues[index].RoomID == roomID {
			return &state.Issues[index]
		}
	}
	return nil
}

func findPullRequestByRoomID(state store.State, roomID string) *store.PullRequest {
	for index := range state.PullRequests {
		if state.PullRequests[index].RoomID == roomID {
			return &state.PullRequests[index]
		}
	}
	return nil
}

func findRoomByID(state store.State, roomID string) *store.Room {
	for index := range state.Rooms {
		if state.Rooms[index].ID == roomID {
			return &state.Rooms[index]
		}
	}
	return nil
}

func findRunByID(state store.State, runID string) *store.Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}

func findRunByIDContract(runs []store.Run, runID string) *store.Run {
	for index := range runs {
		if runs[index].ID == runID {
			return &runs[index]
		}
	}
	return nil
}

func findMailboxHandoffByID(mailbox []store.AgentHandoff, handoffID string) *store.AgentHandoff {
	for index := range mailbox {
		if mailbox[index].ID == handoffID {
			return &mailbox[index]
		}
	}
	return nil
}

func findInboxItemByIDContract(inbox []store.InboxItem, inboxID string) *store.InboxItem {
	for index := range inbox {
		if inbox[index].ID == inboxID {
			return &inbox[index]
		}
	}
	return nil
}

func hasMailboxMessageContract(items []store.MailboxMessage, kind, needle string) bool {
	for _, item := range items {
		if item.Kind != kind {
			continue
		}
		if strings.Contains(item.Body, needle) {
			return true
		}
	}
	return false
}

func findSessionByID(state store.State, sessionID string) *store.Session {
	for index := range state.Sessions {
		if state.Sessions[index].ID == sessionID {
			return &state.Sessions[index]
		}
	}
	return nil
}

func roomMessagesContain(state store.State, roomID, needle string) bool {
	for _, item := range state.RoomMessages[roomID] {
		if strings.Contains(item.Message, needle) {
			return true
		}
	}
	return false
}

func inboxHasKindAndHref(state store.State, kind, href string) bool {
	for _, item := range state.Inbox {
		if item.Kind == kind && item.Href == href {
			return true
		}
	}
	return false
}

func countInboxItems(state store.State, kind, title, href string) int {
	count := 0
	for _, item := range state.Inbox {
		if item.Kind == kind && item.Title == title && item.Href == href {
			count++
		}
	}
	return count
}

func countRoomMessages(state store.State, roomID, needle string) int {
	count := 0
	for _, item := range state.RoomMessages[roomID] {
		if strings.Contains(item.Message, needle) {
			count++
		}
	}
	return count
}

func countRunTimelineLabels(items []store.RunEvent, label string) int {
	count := 0
	for _, item := range items {
		if item.Label == label {
			count++
		}
	}
	return count
}
