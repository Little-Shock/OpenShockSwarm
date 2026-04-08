package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestMutationRoutesRequireActiveAuthSession(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	if _, _, err := s.LogoutAuthSession(); err != nil {
		t.Fatalf("LogoutAuthSession() error = %v", err)
	}

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		permission string
	}{
		{name: "issue create", method: http.MethodPost, path: "/v1/issues", body: `{"title":"Blocked issue"}`, permission: "issue.create"},
		{name: "room reply", method: http.MethodPost, path: "/v1/rooms/room-runtime/messages", body: `{"prompt":"继续推进"}`, permission: "room.reply"},
		{name: "room reply stream", method: http.MethodPost, path: "/v1/rooms/room-runtime/messages/stream", body: `{"prompt":"继续推进"}`, permission: "room.reply"},
		{name: "run exec", method: http.MethodPost, path: "/v1/exec", body: `{"prompt":"继续推进"}`, permission: "run.execute"},
		{name: "run control", method: http.MethodPost, path: "/v1/runs/run_runtime_01/control", body: `{"action":"stop","note":"先暂停"}`, permission: "run.execute"},
		{name: "room pull request", method: http.MethodPost, path: "/v1/rooms/room-runtime/pull-request", body: `{}`, permission: "pull_request.review"},
		{name: "pull request merge", method: http.MethodPost, path: "/v1/pull-requests/pr-runtime-18", body: `{"status":"merged"}`, permission: "pull_request.merge"},
		{name: "inbox review", method: http.MethodPost, path: "/v1/inbox/inbox-review-copy", body: `{"decision":"changes_requested"}`, permission: "inbox.review"},
		{name: "inbox decide", method: http.MethodPost, path: "/v1/inbox/inbox-approval-runtime", body: `{"decision":"approved"}`, permission: "inbox.decide"},
		{name: "memory policy", method: http.MethodPost, path: "/v1/memory-center/policy", body: `{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`, permission: "memory.write"},
		{name: "memory promotion create", method: http.MethodPost, path: "/v1/memory-center/promotions", body: `{"memoryId":"memory-demo","kind":"skill","title":"demo","rationale":"demo"}`, permission: "memory.write"},
		{name: "memory promotion review", method: http.MethodPost, path: "/v1/memory-center/promotions/memory-promotion-demo/review", body: `{"status":"approved"}`, permission: "memory.write"},
		{name: "agent profile patch", method: http.MethodPatch, path: "/v1/agents/agent-codex-dockmaster", body: `{"role":"Platform Architect","avatar":"control-tower","prompt":"keep live truth first","operatingInstructions":"stay on current head","providerPreference":"Codex CLI","recallPolicy":"agent-first","memorySpaces":["workspace","user"]}`, permission: "workspace.manage"},
		{name: "repo binding", method: http.MethodPost, path: "/v1/repo/binding", body: `{"repo":"example/phase-zero","repoUrl":"https://github.com/example/phase-zero.git","branch":"main"}`, permission: "repo.admin"},
		{name: "github installation callback", method: http.MethodPost, path: "/v1/github/installation-callback", body: `{"installationId":"67890","setupAction":"install"}`, permission: "repo.admin"},
		{name: "runtime pairing", method: http.MethodPost, path: "/v1/runtime/pairing", body: `{"daemonUrl":"http://127.0.0.1:65531"}`, permission: "runtime.manage"},
		{name: "runtime unpair", method: http.MethodDelete, path: "/v1/runtime/pairing", body: "", permission: "runtime.manage"},
		{name: "runtime selection", method: http.MethodPost, path: "/v1/runtime/selection", body: `{"machine":"shock-main"}`, permission: "runtime.manage"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			// Snapshot carries time-derived runtime fields, so capture it per subtest.
			baseline := s.Snapshot()
			resp := doJSONRequest(t, http.DefaultClient, testCase.method, server.URL+testCase.path, testCase.body)
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("%s status = %d, want %d", testCase.path, resp.StatusCode, http.StatusUnauthorized)
			}

			var payload struct {
				Error      string            `json:"error"`
				Permission string            `json:"permission"`
				Session    store.AuthSession `json:"session"`
				State      store.State       `json:"state"`
			}
			decodeJSON(t, resp, &payload)

			if payload.Error != store.ErrAuthSessionRequired.Error() {
				t.Fatalf("error = %q, want %q", payload.Error, store.ErrAuthSessionRequired.Error())
			}
			if payload.Permission != testCase.permission {
				t.Fatalf("permission = %q, want %q", payload.Permission, testCase.permission)
			}
			if payload.Session.Status != "signed_out" {
				t.Fatalf("session = %#v, want signed_out", payload.Session)
			}
			if !reflect.DeepEqual(normalizeAuthGuardState(payload.State), normalizeAuthGuardState(baseline)) {
				t.Fatalf("state mutated on unauthorized %s", testCase.path)
			}
		})
	}
}

func TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{Email: "mina@openshock.dev"}); err != nil {
		t.Fatalf("LoginWithEmail(member) error = %v", err)
	}

	allowed := []struct {
		name   string
		method string
		path   string
		body   string
		verify func(t *testing.T, resp *http.Response)
	}{
		{
			name:   "issue create",
			method: http.MethodPost,
			path:   "/v1/issues",
			body:   `{"title":"Permissioned issue","summary":"member can create issue","owner":"Codex Dockmaster","priority":"high"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusCreated {
					t.Fatalf("POST /v1/issues status = %d, want %d", resp.StatusCode, http.StatusCreated)
				}
				var payload struct {
					RoomID string      `json:"roomId"`
					RunID  string      `json:"runId"`
					State  store.State `json:"state"`
				}
				decodeJSON(t, resp, &payload)
				if payload.RoomID == "" || payload.RunID == "" {
					t.Fatalf("issue create payload = %#v, want roomId/runId", payload)
				}
				if len(payload.State.Issues) == 0 || payload.State.Auth.Session.Email != "mina@openshock.dev" {
					t.Fatalf("issue create state = %#v, want member session + issues", payload.State.Auth.Session)
				}
			},
		},
		{
			name:   "room reply",
			method: http.MethodPost,
			path:   "/v1/rooms/room-runtime/messages",
			body:   `{"prompt":"继续推进 runtime 卡片"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST room reply status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Output string `json:"output"`
				}
				decodeJSON(t, resp, &payload)
				if !strings.Contains(payload.Output, "synthetic daemon output") {
					t.Fatalf("room reply output = %q, want daemon output", payload.Output)
				}
			},
		},
		{
			name:   "run execute",
			method: http.MethodPost,
			path:   "/v1/exec",
			body:   `{"prompt":"列出当前进度"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST /v1/exec status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload DaemonExecResponse
				decodeJSON(t, resp, &payload)
				if !strings.Contains(payload.Output, "synthetic daemon output") {
					t.Fatalf("exec payload = %#v, want daemon output", payload)
				}
			},
		},
		{
			name:   "run control",
			method: http.MethodPost,
			path:   "/v1/runs/run_runtime_01/control",
			body:   `{"action":"follow_thread","note":"沿当前 thread 收口"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST /v1/runs/run_runtime_01/control status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Run *store.Run `json:"run"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Run == nil || !payload.Run.FollowThread {
					t.Fatalf("run control payload = %#v, want follow-thread true", payload)
				}
			},
		},
		{
			name:   "pull request review",
			method: http.MethodPost,
			path:   "/v1/rooms/room-runtime/pull-request",
			body:   `{}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST /v1/rooms/room-runtime/pull-request status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					PullRequestID string      `json:"pullRequestId"`
					State         store.State `json:"state"`
				}
				decodeJSON(t, resp, &payload)
				if payload.PullRequestID != "pr-runtime-18" {
					t.Fatalf("pullRequestId = %q, want pr-runtime-18", payload.PullRequestID)
				}
				if _, ok := findPullRequestByID(payload.State, payload.PullRequestID); !ok {
					t.Fatalf("pull request %q missing from state", payload.PullRequestID)
				}
			},
		},
		{
			name:   "inbox review",
			method: http.MethodPost,
			path:   "/v1/inbox/inbox-review-copy",
			body:   `{"decision":"changes_requested"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST /v1/inbox/inbox-review-copy status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					State store.State `json:"state"`
				}
				decodeJSON(t, resp, &payload)
				if _, ok := findInboxByID(t, payload.State.Inbox, "inbox-review-copy"); ok {
					t.Fatalf("review inbox item still present after member review")
				}
			},
		},
	}

	for _, testCase := range allowed {
		t.Run("member can "+testCase.name, func(t *testing.T) {
			resp := doJSONRequest(t, http.DefaultClient, testCase.method, server.URL+testCase.path, testCase.body)
			defer resp.Body.Close()
			testCase.verify(t, resp)
		})
	}

	forbidden := []struct {
		name       string
		method     string
		path       string
		body       string
		permission string
	}{
		{name: "pull request merge", method: http.MethodPost, path: "/v1/pull-requests/pr-runtime-18", body: `{"status":"merged"}`, permission: "pull_request.merge"},
		{name: "inbox decide", method: http.MethodPost, path: "/v1/inbox/inbox-approval-runtime", body: `{"decision":"approved"}`, permission: "inbox.decide"},
		{name: "memory policy", method: http.MethodPost, path: "/v1/memory-center/policy", body: `{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`, permission: "memory.write"},
		{name: "memory promotion create", method: http.MethodPost, path: "/v1/memory-center/promotions", body: `{"memoryId":"memory-demo","kind":"skill","title":"demo","rationale":"demo"}`, permission: "memory.write"},
		{name: "memory promotion review", method: http.MethodPost, path: "/v1/memory-center/promotions/memory-promotion-demo/review", body: `{"status":"approved"}`, permission: "memory.write"},
		{name: "agent profile patch", method: http.MethodPatch, path: "/v1/agents/agent-codex-dockmaster", body: `{"role":"Platform Architect","avatar":"control-tower","prompt":"keep live truth first","operatingInstructions":"stay on current head","providerPreference":"Codex CLI","recallPolicy":"agent-first","memorySpaces":["workspace","user"]}`, permission: "workspace.manage"},
		{name: "repo binding", method: http.MethodPost, path: "/v1/repo/binding", body: `{"repo":"example/phase-zero","repoUrl":"https://github.com/example/phase-zero.git","branch":"main"}`, permission: "repo.admin"},
		{name: "github installation callback", method: http.MethodPost, path: "/v1/github/installation-callback", body: `{"installationId":"67890","setupAction":"install"}`, permission: "repo.admin"},
		{name: "runtime pairing", method: http.MethodPost, path: "/v1/runtime/pairing", body: `{"daemonUrl":"http://127.0.0.1:65531"}`, permission: "runtime.manage"},
		{name: "runtime unpair", method: http.MethodDelete, path: "/v1/runtime/pairing", body: "", permission: "runtime.manage"},
		{name: "runtime selection", method: http.MethodPost, path: "/v1/runtime/selection", body: `{"machine":"shock-main"}`, permission: "runtime.manage"},
	}

	for _, testCase := range forbidden {
		t.Run("member cannot "+testCase.name, func(t *testing.T) {
			baseline := s.Snapshot()
			resp := doJSONRequest(t, http.DefaultClient, testCase.method, server.URL+testCase.path, testCase.body)
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("%s status = %d, want %d", testCase.path, resp.StatusCode, http.StatusForbidden)
			}

			var payload struct {
				Error      string            `json:"error"`
				Permission string            `json:"permission"`
				Session    store.AuthSession `json:"session"`
				State      store.State       `json:"state"`
			}
			decodeJSON(t, resp, &payload)

			if payload.Error != `permission "`+testCase.permission+`" required` {
				t.Fatalf("error = %q, want permission denial for %q", payload.Error, testCase.permission)
			}
			if payload.Permission != testCase.permission {
				t.Fatalf("permission = %q, want %q", payload.Permission, testCase.permission)
			}
			if payload.Session.Role != "member" || payload.Session.Email != "mina@openshock.dev" {
				t.Fatalf("session = %#v, want member session", payload.Session)
			}
			if !reflect.DeepEqual(normalizeAuthGuardState(payload.State), normalizeAuthGuardState(baseline)) {
				t.Fatalf("state mutated on forbidden %s", testCase.path)
			}
		})
	}
}

func TestViewerRoleCannotMutateProtectedSurfaces(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{Email: "longwen@openshock.dev"}); err != nil {
		t.Fatalf("LoginWithEmail(viewer) error = %v", err)
	}

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		permission string
	}{
		{name: "issue create", method: http.MethodPost, path: "/v1/issues", body: `{"title":"Viewer blocked issue"}`, permission: "issue.create"},
		{name: "room reply", method: http.MethodPost, path: "/v1/rooms/room-runtime/messages", body: `{"prompt":"viewer should not reply"}`, permission: "room.reply"},
		{name: "run execute", method: http.MethodPost, path: "/v1/exec", body: `{"prompt":"viewer should not exec"}`, permission: "run.execute"},
		{name: "run control", method: http.MethodPost, path: "/v1/runs/run_runtime_01/control", body: `{"action":"stop","note":"viewer should not stop"}`, permission: "run.execute"},
		{name: "pull request review", method: http.MethodPost, path: "/v1/rooms/room-runtime/pull-request", body: `{}`, permission: "pull_request.review"},
		{name: "pull request merge", method: http.MethodPost, path: "/v1/pull-requests/pr-runtime-18", body: `{"status":"merged"}`, permission: "pull_request.merge"},
		{name: "inbox review", method: http.MethodPost, path: "/v1/inbox/inbox-review-copy", body: `{"decision":"changes_requested"}`, permission: "inbox.review"},
		{name: "inbox decide", method: http.MethodPost, path: "/v1/inbox/inbox-approval-runtime", body: `{"decision":"approved"}`, permission: "inbox.decide"},
		{name: "memory policy", method: http.MethodPost, path: "/v1/memory-center/policy", body: `{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`, permission: "memory.write"},
		{name: "memory promotion create", method: http.MethodPost, path: "/v1/memory-center/promotions", body: `{"memoryId":"memory-demo","kind":"skill","title":"demo","rationale":"demo"}`, permission: "memory.write"},
		{name: "memory promotion review", method: http.MethodPost, path: "/v1/memory-center/promotions/memory-promotion-demo/review", body: `{"status":"approved"}`, permission: "memory.write"},
		{name: "agent profile patch", method: http.MethodPatch, path: "/v1/agents/agent-codex-dockmaster", body: `{"role":"Platform Architect","avatar":"control-tower","prompt":"keep live truth first","operatingInstructions":"stay on current head","providerPreference":"Codex CLI","recallPolicy":"agent-first","memorySpaces":["workspace","user"]}`, permission: "workspace.manage"},
		{name: "repo binding", method: http.MethodPost, path: "/v1/repo/binding", body: `{"repo":"example/phase-zero","repoUrl":"https://github.com/example/phase-zero.git","branch":"main"}`, permission: "repo.admin"},
		{name: "github installation callback", method: http.MethodPost, path: "/v1/github/installation-callback", body: `{"installationId":"67890","setupAction":"install"}`, permission: "repo.admin"},
		{name: "runtime pairing", method: http.MethodPost, path: "/v1/runtime/pairing", body: `{"daemonUrl":"http://127.0.0.1:65531"}`, permission: "runtime.manage"},
		{name: "runtime unpair", method: http.MethodDelete, path: "/v1/runtime/pairing", body: "", permission: "runtime.manage"},
		{name: "runtime selection", method: http.MethodPost, path: "/v1/runtime/selection", body: `{"machine":"shock-main"}`, permission: "runtime.manage"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			baseline := s.Snapshot()
			resp := doJSONRequest(t, http.DefaultClient, testCase.method, server.URL+testCase.path, testCase.body)
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("%s status = %d, want %d", testCase.path, resp.StatusCode, http.StatusForbidden)
			}

			var payload struct {
				Error      string            `json:"error"`
				Permission string            `json:"permission"`
				Session    store.AuthSession `json:"session"`
				State      store.State       `json:"state"`
			}
			decodeJSON(t, resp, &payload)

			if payload.Error != `permission "`+testCase.permission+`" required` {
				t.Fatalf("error = %q, want permission denial for %q", payload.Error, testCase.permission)
			}
			if payload.Permission != testCase.permission {
				t.Fatalf("permission = %q, want %q", payload.Permission, testCase.permission)
			}
			if payload.Session.Role != "viewer" || payload.Session.Email != "longwen@openshock.dev" {
				t.Fatalf("session = %#v, want viewer session", payload.Session)
			}
			if !reflect.DeepEqual(normalizeAuthGuardState(payload.State), normalizeAuthGuardState(baseline)) {
				t.Fatalf("state mutated on forbidden %s", testCase.path)
			}
		})
	}
}

func newAuthGuardTestServer(t *testing.T, root string) (*store.Store, *fakeGitHubClient, *httptest.Server, func()) {
	t.Helper()

	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/worktrees/ensure":
			var req WorktreeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode worktree request: %v", err)
			}
			writeJSON(w, http.StatusOK, WorktreeResponse{
				WorkspaceRoot: req.WorkspaceRoot,
				Branch:        req.Branch,
				WorktreeName:  req.WorktreeName,
				Path:          filepath.Join(root, ".openshock-worktrees", req.WorktreeName),
				Created:       true,
				BaseRef:       req.BaseRef,
			})
		case "/v1/exec":
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Output:   "synthetic daemon output",
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Duration: "42ms",
			})
		default:
			http.NotFound(w, r)
		}
	}))

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:     "shock-main",
		DaemonURL:     daemon.URL,
		Machine:       "shock-main",
		DetectedCLI:   []string{"codex"},
		State:         "online",
		ReportedAt:    reportedAt,
		WorkspaceRoot: root,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	github := &fakeGitHubClient{
		synced: map[int]githubsvc.PullRequest{
			18: {
				Number:         18,
				URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/18",
				Title:          "runtime: surface heartbeat and lane state in discussion room",
				State:          "OPEN",
				HeadRefName:    "feat/runtime-state-shell",
				BaseRefName:    "main",
				Author:         "Codex Dockmaster",
				ReviewDecision: "APPROVED",
			},
			22: {
				Number:         22,
				URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/22",
				Title:          "inbox: unify approval, blocked, and review cards",
				State:          "OPEN",
				HeadRefName:    "feat/inbox-decision-cards",
				BaseRefName:    "main",
				Author:         "Claude Review Runner",
				ReviewDecision: "CHANGES_REQUESTED",
			},
		},
		merged: githubsvc.PullRequest{
			Number:      18,
			URL:         "https://github.com/Larkspur-Wang/OpenShock/pull/18",
			Title:       "runtime: surface heartbeat and lane state in discussion room",
			State:       "MERGED",
			Merged:      true,
			HeadRefName: "feat/runtime-state-shell",
			BaseRefName: "main",
			Author:      "Codex Dockmaster",
		},
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())

	cleanup := func() {
		daemon.Close()
	}

	return s, github, server, cleanup
}

func doJSONRequest(t *testing.T, client *http.Client, method, url, body string) *http.Response {
	t.Helper()

	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}

	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("NewRequest(%s %s) error = %v", method, url, err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s error = %v", method, url, err)
	}
	return resp
}

func normalizeAuthGuardState(state store.State) store.State {
	state.Workspace.PairingStatus = ""
	for index := range state.Machines {
		state.Machines[index].State = ""
		state.Machines[index].LastHeartbeat = ""
	}
	for index := range state.Runtimes {
		state.Runtimes[index].State = ""
		state.Runtimes[index].PairingState = ""
	}
	return state
}
