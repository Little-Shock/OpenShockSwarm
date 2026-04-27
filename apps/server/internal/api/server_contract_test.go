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
	"net/url"
	"path/filepath"
	"strings"
	"sync"
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

const (
	contractInternalWorkerSecret   = "contract-worker-secret"
	contractRuntimeHeartbeatSecret = "contract-runtime-heartbeat-secret"
)

var (
	contractAuthTransportOnce sync.Once
	contractAuthCookiesMu     sync.RWMutex
	contractAuthCookies       = map[string]string{}
)

type contractAuthTransport struct {
	base http.RoundTripper
}

func (t contractAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	next := req
	if value := registeredContractAuthCookie(contractAuthBaseURL(req.URL)); value != "" && !requestHasExplicitContractAuth(req) {
		cloned := req.Clone(req.Context())
		cloned.Header = req.Header.Clone()
		cloned.Header.Add("Cookie", authTokenCookieName+"="+value)
		next = cloned
	}

	resp, err := t.base.RoundTrip(next)
	if err != nil {
		return nil, err
	}
	if next.Method == http.MethodDelete && next.URL != nil && next.URL.Path == "/v1/auth/session" && resp.StatusCode == http.StatusOK {
		clearContractAuthCookie(contractAuthBaseURL(next.URL))
	}
	recordContractAuthCookies(contractAuthBaseURL(next.URL), resp.Cookies(), resp.Header.Values("Set-Cookie"))
	return resp, nil
}

func ensureContractAuthTransport() {
	contractAuthTransportOnce.Do(func() {
		base := http.DefaultClient.Transport
		if base == nil {
			base = http.DefaultTransport
		}
		http.DefaultClient.Transport = contractAuthTransport{base: base}
	})
}

func contractAuthBaseURL(value *url.URL) string {
	if value == nil {
		return ""
	}
	return value.Scheme + "://" + value.Host
}

func requestHasExplicitContractAuth(req *http.Request) bool {
	if req == nil {
		return false
	}
	if strings.TrimSpace(req.Header.Get(authTokenHeaderName)) != "" {
		return true
	}
	return strings.Contains(req.Header.Get("Cookie"), authTokenCookieName+"=")
}

func registeredContractAuthCookie(baseURL string) string {
	contractAuthCookiesMu.RLock()
	defer contractAuthCookiesMu.RUnlock()
	return strings.TrimSpace(contractAuthCookies[baseURL])
}

func recordContractAuthCookies(baseURL string, cookies []*http.Cookie, headers []string) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return
	}
	contractAuthCookiesMu.Lock()
	defer contractAuthCookiesMu.Unlock()
	for _, header := range headers {
		if !strings.HasPrefix(header, authTokenCookieName+"=") {
			continue
		}
		value := header[len(authTokenCookieName)+1:]
		if separator := strings.Index(value, ";"); separator >= 0 {
			value = value[:separator]
		}
		value = strings.TrimSpace(value)
		lowerHeader := strings.ToLower(header)
		if value == "" || strings.Contains(lowerHeader, "max-age=0") || strings.Contains(lowerHeader, "max-age=-1") {
			delete(contractAuthCookies, baseURL)
			return
		}
		contractAuthCookies[baseURL] = value
		return
	}
	for _, cookie := range cookies {
		if cookie == nil || cookie.Name != authTokenCookieName {
			continue
		}
		if strings.TrimSpace(cookie.Value) == "" || cookie.MaxAge < 0 {
			delete(contractAuthCookies, baseURL)
			continue
		}
		contractAuthCookies[baseURL] = strings.TrimSpace(cookie.Value)
	}
}

func clearContractAuthCookie(baseURL string) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return
	}
	contractAuthCookiesMu.Lock()
	defer contractAuthCookiesMu.Unlock()
	delete(contractAuthCookies, baseURL)
}

func plainContractHTTPClient() *http.Client {
	return &http.Client{Transport: http.DefaultTransport}
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
	req.Header.Set("Access-Control-Request-Headers", "Content-Type, X-OpenShock-Auth-Token")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS /v1/workspace/members/:id error = %v", err)
	}
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS /v1/workspace/members/:id status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if allowOrigin := resp.Header.Get("Access-Control-Allow-Origin"); allowOrigin != "http://127.0.0.1:3000" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want request origin echoed", allowOrigin)
	}
	if allowMethods := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(allowMethods, http.MethodPatch) {
		t.Fatalf("Access-Control-Allow-Methods = %q, want PATCH included", allowMethods)
	}
	if allowHeaders := resp.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(allowHeaders, "Content-Type") || !strings.Contains(allowHeaders, authTokenHeaderName) {
		t.Fatalf("Access-Control-Allow-Headers = %q, want Content-Type and %s included", allowHeaders, authTokenHeaderName)
	}
	if allowCredentials := resp.Header.Get("Access-Control-Allow-Credentials"); allowCredentials != "true" {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want true", allowCredentials)
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

func TestRuntimeBridgeCheckReturnsFastRuntimeReadiness(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, RuntimeSnapshotResponse{
			RuntimeID: "shock-main",
			DaemonURL: "http://127.0.0.1:65531",
			Machine:   "shock-main",
			Providers: []store.RuntimeProvider{
				{
					ID:     "codex",
					Label:  "Codex CLI",
					Ready:  true,
					Status: "ready",
				},
			},
			State: "online",
		})
	}))
	defer daemon.Close()

	_, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"provider": "codex",
		"prompt":   "confirm bridge",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/runtime/bridge-check", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/runtime/bridge-check error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bridge check status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload DaemonExecResponse
	decodeJSON(t, resp, &payload)
	if payload.Provider != "codex" || len(payload.Command) != 2 || payload.Command[0] != "runtime" {
		t.Fatalf("bridge check metadata = %#v, want runtime bridge-check payload", payload)
	}
	if !strings.Contains(payload.Output, "Codex CLI 已连接") || !strings.Contains(payload.Output, "shock-main 在线") {
		t.Fatalf("bridge check output = %q, want ready runtime summary", payload.Output)
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
			mustLoginReadyOwner(t, s)
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
			mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	mustLoginReadyOwner(t, s)
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
		DaemonURL:              "http://127.0.0.1:8090",
		WorkspaceRoot:          root,
		RuntimeHeartbeatSecret: contractRuntimeHeartbeatSecret,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	heartbeatResp, err := doRuntimeHeartbeatRequest(server.URL, heartbeatBody, contractRuntimeHeartbeatSecret)
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

func TestRuntimeHeartbeatsRejectWhenSharedSecretIsNotConfigured(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:8090",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(RuntimeSnapshotResponse{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("Marshal() heartbeat error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/runtime/heartbeats", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/runtime/heartbeats error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("heartbeat status = %d, want %d", resp.StatusCode, http.StatusServiceUnavailable)
	}

	var payload map[string]string
	decodeJSON(t, resp, &payload)
	if payload["error"] != "runtime heartbeat secret not configured" {
		t.Fatalf("payload = %#v, want missing secret error", payload)
	}
}

func TestRuntimeHeartbeatsRejectMissingSharedSecretWhenConfigured(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	mustLoginReadyOwner(t, s)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:              "http://127.0.0.1:8090",
		WorkspaceRoot:          root,
		RuntimeHeartbeatSecret: "runtime-heartbeat-secret",
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(RuntimeSnapshotResponse{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("Marshal() heartbeat error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/runtime/heartbeats", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/runtime/heartbeats error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("heartbeat status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	var payload map[string]string
	decodeJSON(t, resp, &payload)
	if payload["error"] != "runtime heartbeat authentication failed" {
		t.Fatalf("payload = %#v, want authentication failure", payload)
	}
}

func TestRuntimeHeartbeatsAcceptBearerSharedSecretWhenConfigured(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:              "http://127.0.0.1:8090",
		WorkspaceRoot:          root,
		RuntimeHeartbeatSecret: "runtime-heartbeat-secret",
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(RuntimeSnapshotResponse{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("Marshal() heartbeat error = %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/runtime/heartbeats", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer runtime-heartbeat-secret")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/runtime/heartbeats error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("heartbeat status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
}

func TestRuntimeReadSurfacesRequireRuntimeManagePermission(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "mina@openshock.dev",
		DeviceLabel: "Mina Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(member) error = %v", err)
	}
	mustEstablishContractBrowserSession(t, server.URL, "mina@openshock.dev", "Mina Browser")

	for _, path := range []string{
		"/v1/runtime",
		"/v1/runtime/pairing",
		"/v1/runtime/registry",
		"/v1/runtime/selection",
	} {
		resp, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatalf("GET %s error = %v", path, err)
		}
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("GET %s status = %d, want %d", path, resp.StatusCode, http.StatusForbidden)
		}

		var payload map[string]any
		decodeJSON(t, resp, &payload)
		resp.Body.Close()
		if payload["permission"] != "runtime.manage" {
			t.Fatalf("GET %s permission = %#v, want runtime.manage", path, payload["permission"])
		}
	}
}

func TestCollectionReadSurfacesRespectSanitizedSessionReadiness(t *testing.T) {
	root := t.TempDir()
	_, signedOutServer := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer signedOutServer.Close()

	signedOutIssuesResp, err := http.Get(signedOutServer.URL + "/v1/issues")
	if err != nil {
		t.Fatalf("GET /v1/issues signed out error = %v", err)
	}
	defer signedOutIssuesResp.Body.Close()
	if signedOutIssuesResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/issues signed out status = %d, want %d", signedOutIssuesResp.StatusCode, http.StatusOK)
	}
	var signedOutIssues []store.Issue
	decodeJSON(t, signedOutIssuesResp, &signedOutIssues)
	if len(signedOutIssues) != 0 {
		t.Fatalf("signed out issues = %#v, want empty", signedOutIssues)
	}

	signedOutWorkspaceResp, err := http.Get(signedOutServer.URL + "/v1/workspace")
	if err != nil {
		t.Fatalf("GET /v1/workspace signed out error = %v", err)
	}
	defer signedOutWorkspaceResp.Body.Close()
	if signedOutWorkspaceResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/workspace signed out status = %d, want %d", signedOutWorkspaceResp.StatusCode, http.StatusOK)
	}
	var signedOutWorkspace store.WorkspaceSnapshot
	decodeJSON(t, signedOutWorkspaceResp, &signedOutWorkspace)
	if signedOutWorkspace.Repo != "" || signedOutWorkspace.PairedRuntimeURL != "" {
		t.Fatalf("signed out workspace = %#v, want repo/runtime url redacted", signedOutWorkspace)
	}

	signedOutMemoryResp, err := http.Get(signedOutServer.URL + "/v1/memory")
	if err != nil {
		t.Fatalf("GET /v1/memory signed out error = %v", err)
	}
	defer signedOutMemoryResp.Body.Close()
	if signedOutMemoryResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET /v1/memory signed out status = %d, want %d", signedOutMemoryResp.StatusCode, http.StatusUnauthorized)
	}

	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	if _, _, err := s.InviteWorkspaceMember(store.WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  "member",
	}); err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}
	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "reviewer@openshock.dev",
		DeviceLabel: "Reviewer Phone",
	}); err != nil {
		t.Fatalf("LoginWithEmail(invited reviewer) error = %v", err)
	}
	mustEstablishContractBrowserSession(t, server.URL, "reviewer@openshock.dev", "Reviewer Phone")

	unreadyIssuesResp, err := http.Get(server.URL + "/v1/issues")
	if err != nil {
		t.Fatalf("GET /v1/issues unready session error = %v", err)
	}
	defer unreadyIssuesResp.Body.Close()
	if unreadyIssuesResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/issues unready session status = %d, want %d", unreadyIssuesResp.StatusCode, http.StatusOK)
	}
	var unreadyIssues []store.Issue
	decodeJSON(t, unreadyIssuesResp, &unreadyIssues)
	if len(unreadyIssues) != 0 {
		t.Fatalf("unready issues = %#v, want empty", unreadyIssues)
	}

	unreadyDMResp, err := http.Get(server.URL + "/v1/direct-messages")
	if err != nil {
		t.Fatalf("GET /v1/direct-messages unready session error = %v", err)
	}
	defer unreadyDMResp.Body.Close()
	if unreadyDMResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/direct-messages unready session status = %d, want %d", unreadyDMResp.StatusCode, http.StatusOK)
	}
	var unreadyDMs []store.DirectMessage
	decodeJSON(t, unreadyDMResp, &unreadyDMs)
	if len(unreadyDMs) != 0 {
		t.Fatalf("unready direct messages = %#v, want empty", unreadyDMs)
	}

	unreadyMemoryResp, err := http.Get(server.URL + "/v1/memory")
	if err != nil {
		t.Fatalf("GET /v1/memory unready session error = %v", err)
	}
	defer unreadyMemoryResp.Body.Close()
	if unreadyMemoryResp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /v1/memory unready session status = %d, want %d", unreadyMemoryResp.StatusCode, http.StatusForbidden)
	}
}

func TestStateRouteRefreshesStalePairedRuntimeFromDaemon(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	mustLoginReadyOwner(t, s)

	staleReportedAt := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: staleReportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	staleSnapshot := s.RuntimeSnapshot(time.Now())
	if staleSnapshot.Workspace.PairingStatus != "degraded" {
		t.Fatalf("stale pairing status = %q, want degraded", staleSnapshot.Workspace.PairingStatus)
	}

	var runtimeProbeHits int
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		runtimeProbeHits++
		writeJSON(w, http.StatusOK, RuntimeSnapshotResponse{
			RuntimeID:   "shock-main",
			DaemonURL:   "http://127.0.0.1:8090",
			Machine:     "shock-main",
			DetectedCLI: []string{"codex"},
			State:       "online",
			ReportedAt:  time.Now().UTC().Format(time.RFC3339),
		})
	}))
	defer daemon.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

	stateResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer stateResp.Body.Close()
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("state status = %d, want %d", stateResp.StatusCode, http.StatusOK)
	}

	var payload store.State
	decodeJSON(t, stateResp, &payload)
	if payload.Workspace.PairingStatus != "paired" {
		t.Fatalf("workspace pairing status = %q, want paired", payload.Workspace.PairingStatus)
	}
	runtimeRecord, ok := findRuntimeRecord(payload, "shock-main")
	if !ok {
		t.Fatalf("runtime registry missing refreshed shock-main: %#v", payload.Runtimes)
	}
	if runtimeRecord.State != "online" {
		t.Fatalf("runtime state = %q, want online", runtimeRecord.State)
	}
	if runtimeProbeHits == 0 {
		t.Fatal("expected state route to probe paired daemon at least once")
	}

	recovered := s.RuntimeSnapshot(time.Now())
	if recovered.Workspace.PairingStatus != "paired" {
		t.Fatalf("recovered pairing status = %q, want paired", recovered.Workspace.PairingStatus)
	}
}

func TestCreatePullRequestRouteCreatesGitHubBackedPullRequest(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	mustLoginReadyOwner(t, s)
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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	mustLoginReadyOwner(t, s)
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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	mustLoginReadyOwner(t, s)
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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	if len(payload.State.Inbox) == 0 || payload.State.Inbox[0].Title != "GitHub PR 创建失败" || payload.State.Inbox[0].Action != "执行详情" {
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
	mustLoginReadyOwner(t, s)
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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	mustLoginReadyOwner(t, s)
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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	if gateByID["review-merge"].Href != "" {
		t.Fatalf("review gate href = %#v, want empty self-link", gateByID["review-merge"])
	}
	if gateByID["run-usage"].HrefLabel != "执行详情" {
		t.Fatalf("run usage gate href label = %#v, want explicit run-detail CTA", gateByID["run-usage"])
	}
	if gateByID["workspace-quota"].HrefLabel != "设置" {
		t.Fatalf("workspace quota gate href label = %#v, want explicit settings CTA", gateByID["workspace-quota"])
	}
	if gateByID["notification-delivery"].Status != "ready" {
		t.Fatalf("notification gate = %#v, want ready", gateByID["notification-delivery"])
	}
	if gateByID["notification-delivery"].HrefLabel != "通知设置" {
		t.Fatalf("notification gate href label = %#v, want explicit notification settings CTA", gateByID["notification-delivery"])
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
	if evidenceByID["room-pr-tab"].HrefLabel != "讨论间 PR" {
		t.Fatalf("room pr evidence href label = %#v, want explicit room-pr CTA", evidenceByID["room-pr-tab"])
	}
	if evidenceByID["remote-pr"].HrefLabel != "远端 PR" {
		t.Fatalf("remote pr evidence href label = %#v, want explicit remote-pr CTA", evidenceByID["remote-pr"])
	}
	if evidenceByID["review-conversation"].HrefLabel != "PR 详情" {
		t.Fatalf("review conversation evidence href label = %#v, want explicit pr-detail CTA", evidenceByID["review-conversation"])
	}
	if evidenceByID["notification-templates"].HrefLabel != "通知设置" {
		t.Fatalf("notification template evidence href label = %#v, want explicit notification-settings CTA", evidenceByID["notification-templates"])
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
		detail.Delivery.Delegation.TargetAgent != "Codex Dockmaster" ||
		detail.Delivery.Delegation.InboxItemID != "inbox-delivery-delegation-pr-runtime-18" {
		t.Fatalf("detail delegation = %#v, want ready Codex Dockmaster delivery delegate", detail.Delivery.Delegation)
	}
	if detail.Delivery.Delegation.HandoffID == "" || detail.Delivery.Delegation.HandoffStatus != "requested" {
		t.Fatalf("detail delegation = %#v, want auto-created requested closeout handoff", detail.Delivery.Delegation)
	}
	if detail.Delivery.Delegation.HrefLabel != "交付详情" {
		t.Fatalf("detail delegation href label = %#v, want explicit delivery-detail CTA", detail.Delivery.Delegation)
	}
	if detail.Delivery.Delegation.HandoffHrefLabel != "交接详情" {
		t.Fatalf("detail delegation handoff href label = %#v, want explicit handoff-detail CTA", detail.Delivery.Delegation)
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
	if closeoutEvidence.HrefLabel != "交付详情" {
		t.Fatalf("governed closeout evidence href label = %#v, want explicit delivery-detail CTA", closeoutEvidence)
	}
	delegateEvidence, ok := evidenceByID["delivery-delegate"]
	if !ok || delegateEvidence.Value != "Codex Dockmaster" {
		t.Fatalf("detail delivery evidence = %#v, want delivery delegate evidence", detail.Delivery.Evidence)
	}
	if delegateEvidence.HrefLabel != "交付详情" {
		t.Fatalf("delivery delegate evidence href label = %#v, want explicit delivery-detail CTA", delegateEvidence)
	}

	relatedDelegation := false
	for _, item := range detail.RelatedInbox {
		if item.ID == "inbox-delivery-delegation-pr-runtime-18" {
			relatedDelegation = true
			if item.Href != "/pull-requests/pr-runtime-18" || !strings.Contains(item.Summary, "Codex Dockmaster") {
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
		closeoutHandoff.ToAgent != "Codex Dockmaster" ||
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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
	if blockedDetail.Delivery.Delegation.ResponseHandoffHrefLabel != "回复详情" {
		t.Fatalf("blocked response href label = %#v, want explicit response-detail CTA", blockedDetail.Delivery.Delegation)
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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

func TestDelegatedBlockedResponseReflectsInParentRoomTrace(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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

	responseBlockNote := "source 也卡住了：release owner 还没签字。"
	responseBlockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          responseBlockNote,
	})
	defer responseBlockedResp.Body.Close()
	if responseBlockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST blocked response handoff status = %d, want %d", responseBlockedResp.StatusCode, http.StatusOK)
	}

	responseBlockedDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET response blocked detail error = %v", err)
	}
	defer responseBlockedDetailResp.Body.Close()
	if responseBlockedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET response blocked detail status = %d, want %d", responseBlockedDetailResp.StatusCode, http.StatusOK)
	}
	var responseBlockedDetail store.PullRequestDetail
	decodeJSON(t, responseBlockedDetailResp, &responseBlockedDetail)
	if responseBlockedDetail.Delivery.Delegation.ResponseHandoffStatus != "blocked" ||
		!strings.Contains(responseBlockedDetail.Delivery.Delegation.Summary, responseBlockNote) {
		t.Fatalf("response blocked delegation = %#v, want blocked response summary", responseBlockedDetail.Delivery.Delegation)
	}

	mailboxResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox after blocked response error = %v", err)
	}
	defer mailboxResp.Body.Close()
	if mailboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox after blocked response status = %d, want %d", mailboxResp.StatusCode, http.StatusOK)
	}
	var mailboxAfterBlockedResponse []store.AgentHandoff
	decodeJSON(t, mailboxResp, &mailboxAfterBlockedResponse)
	parentBlockedResponse := findMailboxHandoffByID(mailboxAfterBlockedResponse, delegatedHandoff.ID)
	if parentBlockedResponse == nil ||
		parentBlockedResponse.LastNote != blockNote ||
		!strings.Contains(parentBlockedResponse.LastAction, responseBlockNote) ||
		!strings.Contains(parentBlockedResponse.LastAction, "当前也 blocked") {
		t.Fatalf("parent handoff after blocked response = %#v, want blocked response guidance", parentBlockedResponse)
	}

	inboxResp, err := http.Get(server.URL + "/v1/inbox")
	if err != nil {
		t.Fatalf("GET /v1/inbox after blocked response error = %v", err)
	}
	defer inboxResp.Body.Close()
	if inboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/inbox after blocked response status = %d, want %d", inboxResp.StatusCode, http.StatusOK)
	}
	var inboxAfterBlockedResponse []store.InboxItem
	decodeJSON(t, inboxResp, &inboxAfterBlockedResponse)
	parentBlockedResponseInbox := findInboxItemByIDContract(inboxAfterBlockedResponse, delegatedHandoff.InboxItemID)
	if parentBlockedResponseInbox == nil ||
		!strings.Contains(parentBlockedResponseInbox.Summary, blockNote) ||
		!strings.Contains(parentBlockedResponseInbox.Summary, responseBlockNote) {
		t.Fatalf("parent inbox after blocked response = %#v, want blocker + blocked response summary", parentBlockedResponseInbox)
	}

	stateResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state after blocked response error = %v", err)
	}
	defer stateResp.Body.Close()
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state after blocked response status = %d, want %d", stateResp.StatusCode, http.StatusOK)
	}
	var stateAfterBlockedResponse store.State
	decodeJSON(t, stateResp, &stateAfterBlockedResponse)
	if !roomMessagesContain(stateAfterBlockedResponse, "room-runtime", "[Mailbox Sync]") ||
		!roomMessagesContain(stateAfterBlockedResponse, "room-runtime", responseBlockNote) ||
		!roomMessagesContain(stateAfterBlockedResponse, "room-runtime", "当前也 blocked") {
		t.Fatalf("room messages after blocked response = %#v, want blocked response room trace", stateAfterBlockedResponse.RoomMessages["room-runtime"])
	}

	runResp, err := http.Get(server.URL + "/v1/runs")
	if err != nil {
		t.Fatalf("GET /v1/runs after blocked response error = %v", err)
	}
	defer runResp.Body.Close()
	if runResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runs after blocked response status = %d, want %d", runResp.StatusCode, http.StatusOK)
	}
	var runsAfterBlockedResponse []store.Run
	decodeJSON(t, runResp, &runsAfterBlockedResponse)
	runAfterBlockedResponse := findRunByIDContract(runsAfterBlockedResponse, delegatedHandoff.RunID)
	if runAfterBlockedResponse == nil || !strings.Contains(runAfterBlockedResponse.NextAction, responseBlockNote) {
		t.Fatalf("run after blocked response = %#v, want blocked response next action", runAfterBlockedResponse)
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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
		detail.Delivery.Delegation.TargetAgent != "Codex Dockmaster" ||
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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

	targetComment := "Codex Dockmaster 已收到 checklist，会按这个顺序补最终 release note 和 receipt。"
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

func TestDeliveryDelegationCommunicationThreadRoute(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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

	detailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET initial detail error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET initial detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}
	var initialDetail store.PullRequestDetail
	decodeJSON(t, detailResp, &initialDetail)
	if len(initialDetail.Delivery.Delegation.Communication) != 1 ||
		initialDetail.Delivery.Delegation.Communication[0].HandoffLabel != "Parent Closeout" ||
		initialDetail.Delivery.Delegation.Communication[0].MessageKind != "request" {
		t.Fatalf("initial communication = %#v, want parent request thread entry", initialDetail.Delivery.Delegation.Communication)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	blockedParentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          blockNote,
	})
	defer blockedParentResp.Body.Close()
	if blockedParentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated closeout blocked status = %d, want %d", blockedParentResp.StatusCode, http.StatusOK)
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
		t.Fatalf("blocked detail = %#v, want response handoff id", blockedDetail.Delivery.Delegation)
	}

	sourceComment := "source 说明：release receipt checklist 正在补。"
	responseCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "comment",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          sourceComment,
	})
	defer responseCommentResp.Body.Close()
	if responseCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response comment status = %d, want %d", responseCommentResp.StatusCode, http.StatusOK)
	}
	responseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer responseAckResp.Body.Close()
	if responseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response acknowledged status = %d, want %d", responseAckResp.StatusCode, http.StatusOK)
	}
	responseCompleteNote := "release receipt checklist 已补齐，请重新接住 delivery closeout。"
	responseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          responseCompleteNote,
	})
	defer responseCompleteResp.Body.Close()
	if responseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response completed status = %d, want %d", responseCompleteResp.StatusCode, http.StatusOK)
	}
	parentAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.ToAgentID,
	})
	defer parentAckResp.Body.Close()
	if parentAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST parent acknowledged status = %d, want %d", parentAckResp.StatusCode, http.StatusOK)
	}

	finalDetailResp, err := http.Get(server.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET final detail error = %v", err)
	}
	defer finalDetailResp.Body.Close()
	if finalDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET final detail status = %d, want %d", finalDetailResp.StatusCode, http.StatusOK)
	}
	var finalDetail store.PullRequestDetail
	decodeJSON(t, finalDetailResp, &finalDetail)
	if len(finalDetail.Delivery.Delegation.Communication) < 8 {
		t.Fatalf("final communication = %#v, want unified parent + reply thread", finalDetail.Delivery.Delegation.Communication)
	}

	blockedIndex := -1
	replyRequestIndex := -1
	replyCommentIndex := -1
	parentAckIndex := -1
	replyProgressIndex := -1
	for index, entry := range finalDetail.Delivery.Delegation.Communication {
		switch {
		case entry.HandoffLabel == "Parent Closeout" && entry.MessageKind == "blocked" && strings.Contains(entry.Summary, blockNote):
			blockedIndex = index
		case entry.HandoffLabel == "Unblock Reply x1" && entry.MessageKind == "request":
			replyRequestIndex = index
			if !strings.Contains(entry.Href, responseHandoffID) {
				t.Fatalf("reply request entry = %#v, want child mailbox href", entry)
			}
		case entry.HandoffLabel == "Unblock Reply x1" && entry.MessageKind == "comment" && strings.Contains(entry.Summary, sourceComment):
			replyCommentIndex = index
		case entry.HandoffLabel == "Parent Closeout" && entry.MessageKind == "ack":
			parentAckIndex = index
		case entry.HandoffLabel == "Unblock Reply x1" && entry.MessageKind == "parent-progress" && strings.Contains(entry.Summary, "已重新 acknowledge 主 closeout"):
			replyProgressIndex = index
		}
	}
	if blockedIndex == -1 || replyRequestIndex == -1 || replyCommentIndex == -1 || parentAckIndex == -1 || replyProgressIndex == -1 {
		t.Fatalf("final communication = %#v, want blocked/request/comment/ack/parent-progress entries", finalDetail.Delivery.Delegation.Communication)
	}
	if !(blockedIndex < replyRequestIndex && replyRequestIndex < replyCommentIndex && replyCommentIndex < parentAckIndex && parentAckIndex < replyProgressIndex) {
		t.Fatalf("final communication order = %#v, want chronological parent->reply->parent sync thread", finalDetail.Delivery.Delegation.Communication)
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
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
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
		detail.Delivery.Delegation.TargetAgent != "Codex Dockmaster" ||
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

func TestAutoCompleteDeliveryDelegationDoesNotPolluteCrossRoomGovernanceSnapshot(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"deliveryDelegationMode": "auto-complete",
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	baselineState := readStateSnapshot(t, server.URL)
	secondRoomID := findAlternateGovernanceRoomID(baselineState, "room-runtime")
	if secondRoomID == "" {
		t.Fatalf("baseline rooms = %#v, want second room outside current hot rollup", baselineState.Rooms)
	}

	secondRoomResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      secondRoomID,
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-memory-clerk",
		"title":       "保持第二个 room 继续冒烟",
		"summary":     "验证 runtime room auto-closeout 后，cross-room rollup 不会被 delivery sidecar 污染。",
	})
	defer secondRoomResp.Body.Close()
	if secondRoomResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST second room mailbox status = %d, want %d", secondRoomResp.StatusCode, http.StatusCreated)
	}

	afterSecondRoom := readStateSnapshot(t, server.URL)
	secondRoomRollup := findEscalationRoomRollupByRoomID(afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup, secondRoomID)
	if secondRoomRollup == nil || secondRoomRollup.Status != "active" {
		t.Fatalf("second room rollup = %#v, want active second-room hot entry", afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup)
	}
	if runtimeRollup := findEscalationRoomRollupByRoomID(afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup, "room-runtime"); runtimeRollup != nil {
		t.Fatalf("pre-runtime rollup = %#v, want room-runtime absent before auto-closeout chain", afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup)
	}
	expectedRollupCount := len(afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup)

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST runtime mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
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
	if qaHandoff.RoomID != "room-runtime" || qaHandoff.ToAgent != "Memory Clerk" {
		t.Fatalf("qa handoff = %#v, want room-runtime QA followup", qaHandoff)
	}

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
		"note":          "QA 验证完成，按 auto-complete 直接收口 delivery delegate。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	finalState := readStateSnapshot(t, server.URL)
	if runtimeRollup := findEscalationRoomRollupByRoomID(finalState.Workspace.Governance.EscalationSLA.Rollup, "room-runtime"); runtimeRollup != nil {
		t.Fatalf("final rollup = %#v, want room-runtime cleared from cross-room rollup after auto-complete closeout", finalState.Workspace.Governance.EscalationSLA.Rollup)
	}
	finalSecondRoomRollup := findEscalationRoomRollupByRoomID(finalState.Workspace.Governance.EscalationSLA.Rollup, secondRoomID)
	if finalSecondRoomRollup == nil || finalSecondRoomRollup.Status != "active" || finalSecondRoomRollup.EscalationCount != 1 {
		t.Fatalf("final second-room rollup = %#v, want other hot room stay active and unchanged", finalState.Workspace.Governance.EscalationSLA.Rollup)
	}
	if len(finalState.Workspace.Governance.EscalationSLA.Rollup) != expectedRollupCount {
		t.Fatalf("final rollup count = %#v, want cross-room rollup count unchanged after runtime auto-closeout", finalState.Workspace.Governance.EscalationSLA.Rollup)
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
		detail.Delivery.Delegation.HandoffID != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "auto-complete") {
		t.Fatalf("detail delegation = %#v, want auto-complete done without formal handoff", detail.Delivery.Delegation)
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
			t.Fatalf("mailbox = %#v, want no delivery-closeout sidecar after auto-complete", mailbox)
		}
	}
}

func TestAutoCompleteDeliveryDelegationKeepsBlockedRuntimeRoomHotButMarksRouteDoneInGovernanceSnapshot(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"deliveryDelegationMode": "auto-complete",
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	baselineState := readStateSnapshot(t, server.URL)
	secondRoomID := findAlternateGovernanceRoomID(baselineState, "room-runtime")
	if secondRoomID == "" {
		t.Fatalf("baseline rooms = %#v, want second room outside current hot rollup", baselineState.Rooms)
	}

	secondRoomResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      secondRoomID,
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-memory-clerk",
		"title":       "保持第二个 room 继续冒烟",
		"summary":     "验证 runtime room 仍有 blocker 时，auto-complete 只把 route 收到 done，不会污染 cross-room rollup。",
	})
	defer secondRoomResp.Body.Close()
	if secondRoomResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST second room mailbox status = %d, want %d", secondRoomResp.StatusCode, http.StatusCreated)
	}
	afterSecondRoom := readStateSnapshot(t, server.URL)
	expectedBaselineHotRooms := len(afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup)

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST runtime mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
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
	if qaHandoff.RoomID != "room-runtime" || qaHandoff.ToAgent != "Memory Clerk" {
		t.Fatalf("qa handoff = %#v, want room-runtime QA followup", qaHandoff)
	}

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}

	if _, err := s.AppendSystemRoomMessage("room-runtime", "System", "CLI 连接失败，等待人工处理。", "blocked"); err != nil {
		t.Fatalf("AppendSystemRoomMessage() error = %v", err)
	}
	blockedState := readStateSnapshot(t, server.URL)
	runtimeBlockedRollup := findEscalationRoomRollupByRoomID(blockedState.Workspace.Governance.EscalationSLA.Rollup, "room-runtime")
	if runtimeBlockedRollup == nil ||
		runtimeBlockedRollup.Status != "blocked" ||
		runtimeBlockedRollup.BlockedCount < 1 ||
		runtimeBlockedRollup.NextRouteStatus != "active" {
		t.Fatalf("blocked runtime rollup = %#v, want blocked hot room with active QA route", blockedState.Workspace.Governance.EscalationSLA.Rollup)
	}
	if runtimeBlockedRollup.HrefLabel != "收件箱定位" {
		t.Fatalf("blocked runtime rollup room action = %#v, want explicit focused-handoff CTA", runtimeBlockedRollup)
	}
	if runtimeBlockedRollup.NextRouteHrefLabel != "收件箱定位" {
		t.Fatalf("blocked runtime rollup next-route action = %#v, want explicit active handoff CTA", runtimeBlockedRollup)
	}

	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，按 auto-complete 直接收口 delivery delegate。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	finalState := readStateSnapshot(t, server.URL)
	runtimeFinalRollup := findEscalationRoomRollupByRoomID(finalState.Workspace.Governance.EscalationSLA.Rollup, "room-runtime")
	if runtimeFinalRollup == nil ||
		runtimeFinalRollup.Status != "blocked" ||
		runtimeFinalRollup.BlockedCount < 1 ||
		runtimeFinalRollup.NextRouteStatus != "done" ||
		runtimeFinalRollup.NextRouteLabel != "交付详情" ||
		!strings.Contains(runtimeFinalRollup.NextRouteHref, "/pull-requests/pr-runtime-18") {
		t.Fatalf("final runtime rollup = %#v, want blocked room kept hot with done delivery route", finalState.Workspace.Governance.EscalationSLA.Rollup)
	}
	if runtimeFinalRollup.NextRouteHrefLabel != "交付详情" {
		t.Fatalf("final runtime rollup next-route action = %#v, want explicit delivery detail CTA", runtimeFinalRollup)
	}
	if runtimeFinalRollup.HrefLabel == "" {
		t.Fatalf("final runtime rollup room action = %#v, want explicit room-side action label", runtimeFinalRollup)
	}
	finalSecondRoomRollup := findEscalationRoomRollupByRoomID(finalState.Workspace.Governance.EscalationSLA.Rollup, secondRoomID)
	if finalSecondRoomRollup == nil || finalSecondRoomRollup.Status != "active" || finalSecondRoomRollup.EscalationCount != 1 {
		t.Fatalf("final second-room rollup = %#v, want other hot room stay active and unchanged", finalState.Workspace.Governance.EscalationSLA.Rollup)
	}
	if len(finalState.Workspace.Governance.EscalationSLA.Rollup) != expectedBaselineHotRooms+1 {
		t.Fatalf("final rollup count = %#v, want runtime blocker added on top of baseline hot rooms", finalState.Workspace.Governance.EscalationSLA.Rollup)
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
		detail.Delivery.Delegation.HandoffID != "" ||
		detail.Delivery.Delegation.ResponseHandoffID != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "auto-complete") {
		t.Fatalf("detail delegation = %#v, want auto-complete done without formal handoff even while room stays blocked", detail.Delivery.Delegation)
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
		if item.RoomID == "room-runtime" && (item.Kind == "delivery-closeout" || item.Kind == "delivery-reply") {
			t.Fatalf("mailbox = %#v, want no runtime delivery sidecar even when room remains blocked", mailbox)
		}
	}
}

func TestAutoCompleteDeliveryDelegationDoesNotPolluteCrossRoomGovernanceSnapshotAfterServerReload(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"deliveryDelegationMode": "auto-complete",
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	baselineState := readStateSnapshot(t, server.URL)
	secondRoomID := findAlternateGovernanceRoomID(baselineState, "room-runtime")
	if secondRoomID == "" {
		t.Fatalf("baseline rooms = %#v, want second room outside current hot rollup", baselineState.Rooms)
	}

	secondRoomResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      secondRoomID,
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-memory-clerk",
		"title":       "保持第二个 room 继续冒烟",
		"summary":     "验证 runtime room auto-closeout 后，server reload 也不会把 delivery sidecar 污染进 cross-room rollup。",
	})
	defer secondRoomResp.Body.Close()
	if secondRoomResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST second room mailbox status = %d, want %d", secondRoomResp.StatusCode, http.StatusCreated)
	}

	afterSecondRoom := readStateSnapshot(t, server.URL)
	expectedRollupCount := len(afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup)

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST runtime mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
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
		"note":          "QA 验证完成，按 auto-complete 直接收口 delivery delegate。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}

	server.Close()
	_, reloadedServer := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer reloadedServer.Close()

	reloadedState := readStateSnapshot(t, reloadedServer.URL)
	if runtimeRollup := findEscalationRoomRollupByRoomID(reloadedState.Workspace.Governance.EscalationSLA.Rollup, "room-runtime"); runtimeRollup != nil {
		t.Fatalf("reloaded rollup = %#v, want room-runtime absent after server reload", reloadedState.Workspace.Governance.EscalationSLA.Rollup)
	}
	reloadedSecondRoomRollup := findEscalationRoomRollupByRoomID(reloadedState.Workspace.Governance.EscalationSLA.Rollup, secondRoomID)
	if reloadedSecondRoomRollup == nil || reloadedSecondRoomRollup.Status != "active" || reloadedSecondRoomRollup.EscalationCount != 1 {
		t.Fatalf("reloaded second-room rollup = %#v, want other hot room remain active after server reload", reloadedState.Workspace.Governance.EscalationSLA.Rollup)
	}
	if len(reloadedState.Workspace.Governance.EscalationSLA.Rollup) != expectedRollupCount {
		t.Fatalf("reloaded rollup count = %#v, want cross-room rollup count unchanged after server reload", reloadedState.Workspace.Governance.EscalationSLA.Rollup)
	}

	detailResp, err := http.Get(reloadedServer.URL + "/v1/pull-requests/pr-runtime-18/detail")
	if err != nil {
		t.Fatalf("GET reloaded detail error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET reloaded detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}
	var detail store.PullRequestDetail
	decodeJSON(t, detailResp, &detail)
	if detail.Delivery.Delegation.Status != "done" ||
		detail.Delivery.Delegation.HandoffID != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "auto-complete") {
		t.Fatalf("reloaded detail delegation = %#v, want auto-complete done without formal handoff after reload", detail.Delivery.Delegation)
	}

	mailboxResp, err := http.Get(reloadedServer.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET reloaded mailbox error = %v", err)
	}
	defer mailboxResp.Body.Close()
	if mailboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET reloaded mailbox status = %d, want %d", mailboxResp.StatusCode, http.StatusOK)
	}
	var mailbox []store.AgentHandoff
	decodeJSON(t, mailboxResp, &mailbox)
	for _, item := range mailbox {
		if item.RoomID == "room-runtime" && (item.Kind == "delivery-closeout" || item.Kind == "delivery-reply") {
			t.Fatalf("reloaded mailbox = %#v, want no delivery sidecar after server reload", mailbox)
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

func TestRunDetailRouteBuildsRecoveryAuditFromInterruptedSessionAndFollowupTruth(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.MarkRoomConversationInterrupted("room-runtime", "继续把这条 continuity 往前推。", "codex", "我先接住当前 continuity，已经完成第一段检查。"); err != nil {
		t.Fatalf("MarkRoomConversationInterrupted() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(store.MailboxCreateInput{
		Kind:        "room-auto",
		RoomID:      "room-runtime",
		Title:       "继续复核恢复链路",
		Summary:     "请把恢复链路和副作用复核完。",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if handoff.ID == "" {
		t.Fatalf("room-auto handoff missing: %#v", handoff)
	}
	if _, _, err := s.UpdateRoomAutoHandoffFollowup(handoff.ID, "blocked", "当前还未登录模型服务"); err != nil {
		t.Fatalf("UpdateRoomAutoHandoffFollowup() error = %v", err)
	}
	if _, err := s.PublishRuntimeEvent(store.RuntimePublishInput{
		RuntimeID:      "shock-main",
		RunID:          "run_runtime_01",
		SessionID:      "session-runtime-01",
		RoomID:         "room-runtime",
		Cursor:         1,
		Phase:          "closeout",
		Status:         "blocked",
		Summary:        "runtime closeout captured blocked recovery",
		CloseoutReason: "pending_turn_interrupted",
	}); err != nil {
		t.Fatalf("PublishRuntimeEvent() error = %v", err)
	}
	mustLoginReadyOwner(t, s)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	if detail.RecoveryAudit.Status != "interrupted" || detail.RecoveryAudit.Source != "session.pending_turn" {
		t.Fatalf("run detail recovery audit = %#v, want interrupted session source", detail.RecoveryAudit)
	}
	if !detail.RecoveryAudit.ResumeEligible || !strings.Contains(detail.RecoveryAudit.Preview, "第一段检查") {
		t.Fatalf("run detail recovery audit = %#v, want resume eligible preview", detail.RecoveryAudit)
	}
	if detail.RecoveryAudit.HandoffAutoFollowup == nil || detail.RecoveryAudit.HandoffAutoFollowup.Kind != "room-auto" || detail.RecoveryAudit.HandoffAutoFollowup.Status != "blocked" {
		t.Fatalf("run detail generic handoff followup = %#v, want blocked room-auto followup", detail.RecoveryAudit.HandoffAutoFollowup)
	}
	if detail.RecoveryAudit.RoomAutoFollowup == nil || detail.RecoveryAudit.RoomAutoFollowup.Status != "blocked" {
		t.Fatalf("run detail room-auto followup = %#v, want blocked followup", detail.RecoveryAudit.RoomAutoFollowup)
	}
	if !strings.Contains(detail.RecoveryAudit.RoomAutoFollowup.Summary, "未登录模型服务") {
		t.Fatalf("run detail room-auto followup = %#v, want blocked summary", detail.RecoveryAudit.RoomAutoFollowup)
	}
	if detail.RecoveryAudit.RuntimeReplay == nil || detail.RecoveryAudit.RuntimeReplay.ReplayAnchor != "/v1/runtime/publish/replay?runId=run_runtime_01" {
		t.Fatalf("run detail runtime replay = %#v, want runtime replay anchor", detail.RecoveryAudit.RuntimeReplay)
	}
	if detail.RecoveryAudit.RuntimeReplay.LastCursor != 1 || detail.RecoveryAudit.RuntimeReplay.CloseoutReason != "pending_turn_interrupted" {
		t.Fatalf("run detail runtime replay = %#v, want closeout cursor/reason", detail.RecoveryAudit.RuntimeReplay)
	}
}

func TestRunDetailRouteBuildsRecoveryAuditFromFormalHandoffFollowupTruth(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(store.MailboxCreateInput{
		Kind:        "governed",
		RoomID:      "room-runtime",
		Title:       "继续 reviewer lane",
		Summary:     "请正式接住 reviewer lane，并把恢复链路继续收口。",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
	})
	if err != nil {
		t.Fatalf("CreateHandoff(governed) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(handoff.ID, store.MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged) error = %v", err)
	}
	if _, _, err := s.UpdateRoomAutoHandoffFollowup(handoff.ID, "blocked", "当前还未登录模型服务"); err != nil {
		t.Fatalf("UpdateRoomAutoHandoffFollowup(governed blocked) error = %v", err)
	}
	mustLoginReadyOwner(t, s)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	if detail.RecoveryAudit.HandoffAutoFollowup == nil || detail.RecoveryAudit.HandoffAutoFollowup.Kind != "governed" {
		t.Fatalf("run detail generic handoff followup = %#v, want governed followup", detail.RecoveryAudit.HandoffAutoFollowup)
	}
	if detail.RecoveryAudit.HandoffAutoFollowup.Status != "blocked" || !strings.Contains(detail.RecoveryAudit.HandoffAutoFollowup.Summary, "未登录模型服务") {
		t.Fatalf("run detail generic handoff followup = %#v, want blocked summary", detail.RecoveryAudit.HandoffAutoFollowup)
	}
	if detail.RecoveryAudit.RoomAutoFollowup != nil {
		t.Fatalf("run detail room-auto alias = %#v, want nil for governed followup", detail.RecoveryAudit.RoomAutoFollowup)
	}
}

func TestRunDetailRouteRecoveryAuditReadIsSideEffectFree(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.MarkRoomConversationInterrupted("room-runtime", "继续把这条 continuity 往前推。", "codex", "我先接住当前 continuity，已经完成第一段检查。"); err != nil {
		t.Fatalf("MarkRoomConversationInterrupted() error = %v", err)
	}
	before := s.Snapshot()
	mustLoginReadyOwner(t, s)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

	for index := 0; index < 2; index++ {
		resp, err := http.Get(server.URL + "/v1/runs/run_runtime_01/detail")
		if err != nil {
			t.Fatalf("GET run detail error = %v", err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET run detail status = %d, want %d", resp.StatusCode, http.StatusOK)
		}
		resp.Body.Close()
	}

	after := s.Snapshot()
	beforeRun := findRunSnapshotByID(before, "run_runtime_01")
	afterRun := findRunSnapshotByID(after, "run_runtime_01")
	if beforeRun == nil || afterRun == nil {
		t.Fatalf("run snapshots missing: before=%#v after=%#v", beforeRun, afterRun)
	}
	if len(afterRun.Timeline) != len(beforeRun.Timeline) {
		t.Fatalf("run timeline mutated after repeated detail reads: before=%#v after=%#v", beforeRun.Timeline, afterRun.Timeline)
	}
	if len(after.RoomMessages["room-runtime"]) != len(before.RoomMessages["room-runtime"]) {
		t.Fatalf("room messages mutated after repeated detail reads: before=%#v after=%#v", before.RoomMessages["room-runtime"], after.RoomMessages["room-runtime"])
	}
	if len(after.Inbox) != len(before.Inbox) {
		t.Fatalf("inbox mutated after repeated detail reads: before=%#v after=%#v", before.Inbox, after.Inbox)
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
	mustLoginReadyOwner(t, s)

	github := &fakeGitHubClient{syncErr: errors.New("github api timeout")}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	if len(payload.State.Inbox) == 0 || payload.State.Inbox[0].Title != "PR #88 同步失败" || payload.State.Inbox[0].Kind != "blocked" || payload.State.Inbox[0].Action != "执行详情" {
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
	mustLoginReadyOwner(t, s)

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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	mustLoginReadyOwner(t, s)

	github := &fakeGitHubClient{syncErr: errors.New("github api timeout")}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	mustLoginReadyOwner(t, s)
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
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

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
	if len(payload.State.Inbox) == 0 || payload.State.Inbox[0].Title != "PR #96 合并失败" || payload.State.Inbox[0].Kind != "blocked" || payload.State.Inbox[0].Action != "执行详情" {
		t.Fatalf("merge failure inbox malformed: %#v", payload.State.Inbox)
	}
	if inboxHasKindAndHref(payload.State, "review", "/rooms/"+created.RoomID+"/runs/"+created.RunID) {
		t.Fatalf("stale review inbox item remained after merge failure escalation: %#v", payload.State.Inbox)
	}
	if !roomMessagesContain(payload.State, created.RoomID, "PR #96 合并失败：merge blocked by branch protections") {
		t.Fatalf("room messages missing GitHub merge failure escalation: %#v", payload.State.RoomMessages[created.RoomID])
	}
}

func newSignedOutContractTestServer(t *testing.T, root, daemonURL string) (*store.Store, *httptest.Server) {
	t.Helper()
	ensureContractAuthTransport()

	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:              daemonURL,
		WorkspaceRoot:          root,
		InternalWorkerSecret:   contractInternalWorkerSecret,
		RuntimeHeartbeatSecret: contractRuntimeHeartbeatSecret,
	}).Handler())
	clearContractAuthCookie(server.URL)
	return s, server
}

func newContractTestServer(t *testing.T, root, daemonURL string) (*store.Store, *httptest.Server) {
	t.Helper()

	s, server := newSignedOutContractTestServer(t, root, daemonURL)
	mustLoginReadyOwner(t, s)
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")
	return s, server
}

func mustEstablishContractBrowserSession(t *testing.T, serverURL, email, deviceLabel string) store.AuthSession {
	t.Helper()
	ensureContractAuthTransport()
	clearContractAuthCookie(serverURL)

	resp, err := postContractAuthSessionJSON(t, http.DefaultClient, serverURL, `{"email":"`+email+`","deviceLabel":"`+deviceLabel+`"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session contract browser login error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session contract browser login status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, resp, &payload)
	if registeredContractAuthCookie(serverURL) == "" {
		t.Fatalf("contract browser login did not persist %s cookie for %s", authTokenCookieName, serverURL)
	}
	return payload.Session
}

func requestContractLoginChallenge(t *testing.T, client *http.Client, serverURL, email string) store.AuthChallenge {
	t.Helper()
	if client == nil {
		client = http.DefaultClient
	}

	body, err := json.Marshal(map[string]string{
		"action": "request_login_challenge",
		"email":  email,
	})
	if err != nil {
		t.Fatalf("Marshal(request_login_challenge) error = %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, serverURL+"/v1/auth/recovery", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest(request_login_challenge) error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_login_challenge error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery request_login_challenge status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Challenge store.AuthChallenge `json:"challenge"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Challenge.ID == "" {
		t.Fatalf("request_login_challenge payload = %#v, want challenge id", payload)
	}
	return payload.Challenge
}

func requestContractRecoveryChallenge(t *testing.T, client *http.Client, serverURL string, body map[string]string) store.AuthChallenge {
	t.Helper()
	if client == nil {
		client = http.DefaultClient
	}

	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("Marshal(%s) error = %v", body["action"], err)
	}

	req, err := http.NewRequest(http.MethodPost, serverURL+"/v1/auth/recovery", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("NewRequest(%s) error = %v", body["action"], err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery %s error = %v", body["action"], err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery %s status = %d, want %d", body["action"], resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Challenge store.AuthChallenge `json:"challenge"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Challenge.ID == "" {
		t.Fatalf("%s payload = %#v, want challenge id", body["action"], payload)
	}
	return payload.Challenge
}

func newContractAuthSessionRequest(t *testing.T, client *http.Client, serverURL, raw string) *http.Request {
	t.Helper()
	if client == nil {
		client = http.DefaultClient
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("Unmarshal(auth session payload) error = %v", err)
	}
	if _, ok := payload["challengeId"]; !ok {
		if email, ok := payload["email"].(string); ok && strings.TrimSpace(email) != "" {
			payload["challengeId"] = requestContractLoginChallenge(t, client, serverURL, email).ID
		}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal(auth session payload) error = %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, serverURL+"/v1/auth/session", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest(auth session) error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return req
}

func postContractAuthSessionJSON(t *testing.T, client *http.Client, serverURL, raw string) (*http.Response, error) {
	t.Helper()
	if client == nil {
		client = http.DefaultClient
	}
	return client.Do(newContractAuthSessionRequest(t, client, serverURL, raw))
}

func mustLoginReadyOwner(t *testing.T, s *store.Store) {
	t.Helper()
	_, session, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}
	if session.EmailVerificationStatus != "verified" {
		_, challenge, err := s.RequestVerifyMemberEmailChallenge(store.AuthRecoveryInput{Email: session.Email})
		if err != nil {
			t.Fatalf("RequestVerifyMemberEmailChallenge(owner) error = %v", err)
		}
		if _, nextSession, _, err := s.VerifyMemberEmail(store.AuthRecoveryInput{Email: session.Email, ChallengeID: challenge.ID}); err != nil {
			t.Fatalf("VerifyMemberEmail(owner) error = %v", err)
		} else {
			session = nextSession
		}
	}
	if session.DeviceAuthStatus != "authorized" {
		_, challenge, err := s.RequestAuthorizeAuthDeviceChallenge(store.AuthRecoveryInput{
			DeviceID:    session.DeviceID,
			DeviceLabel: session.DeviceLabel,
		})
		if err != nil {
			t.Fatalf("RequestAuthorizeAuthDeviceChallenge(owner) error = %v", err)
		}
		if _, nextSession, _, _, err := s.AuthorizeAuthDevice(store.AuthRecoveryInput{
			DeviceID:    session.DeviceID,
			DeviceLabel: session.DeviceLabel,
			ChallengeID: challenge.ID,
		}); err != nil {
			t.Fatalf("AuthorizeAuthDevice(owner) error = %v", err)
		} else {
			session = nextSession
		}
	}
	if session.MemberStatus != "active" {
		t.Fatalf("owner session = %#v, want ready active owner", session)
	}
}

func doRuntimeHeartbeatRequest(serverURL string, body []byte, secret string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, serverURL+"/v1/runtime/heartbeats", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(secret) != "" {
		req.Header.Set("X-OpenShock-Runtime-Secret", secret)
	}
	return http.DefaultClient.Do(req)
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
