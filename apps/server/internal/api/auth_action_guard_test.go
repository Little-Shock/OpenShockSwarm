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

	logoutReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("NewRequest(DELETE /v1/auth/session) error = %v", err)
	}
	logoutResp, err := http.DefaultClient.Do(logoutReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session error = %v", err)
	}
	logoutResp.Body.Close()
	if logoutResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session status = %d, want %d", logoutResp.StatusCode, http.StatusOK)
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
		{name: "direct message reply", method: http.MethodPost, path: "/v1/direct-messages/dm-mina/messages", body: `{"prompt":"继续这条 DM"}`, permission: "room.reply"},
		{name: "message surface collection", method: http.MethodPost, path: "/v1/message-surface/collections", body: `{"kind":"followed","channelId":"roadmap","messageId":"msg-roadmap-1","enabled":true}`, permission: "room.reply"},
		{name: "topic guidance", method: http.MethodPatch, path: "/v1/topics/topic-runtime", body: `{"summary":"继续沿当前 topic 收单值"}`, permission: "room.reply"},
		{name: "room reply stream", method: http.MethodPost, path: "/v1/rooms/room-runtime/messages/stream", body: `{"prompt":"继续推进"}`, permission: "room.reply"},
		{name: "run exec", method: http.MethodPost, path: "/v1/exec", body: `{"prompt":"继续推进"}`, permission: "run.execute"},
		{name: "run control", method: http.MethodPost, path: "/v1/runs/run_runtime_01/control", body: `{"action":"stop","note":"先暂停"}`, permission: "run.execute"},
		{name: "planner assignment", method: http.MethodPost, path: "/v1/planner/sessions/session-runtime/assignment", body: `{"agentId":"agent-claude-review-runner"}`, permission: "run.execute"},
		{name: "run sandbox patch", method: http.MethodPatch, path: "/v1/runs/run_runtime_01/sandbox", body: `{"profile":"restricted","allowedHosts":["github.com"],"allowedCommands":["git status"],"allowedTools":["read_file"]}`, permission: "run.execute"},
		{name: "run sandbox check", method: http.MethodPost, path: "/v1/runs/run_runtime_01/sandbox", body: `{"kind":"command","target":"git push --force"}`, permission: "run.execute"},
		{name: "room pull request", method: http.MethodPost, path: "/v1/rooms/room-runtime/pull-request", body: `{}`, permission: "pull_request.review"},
		{name: "planner auto merge request", method: http.MethodPost, path: "/v1/planner/pull-requests/pr-runtime-18/auto-merge", body: `{"action":"request"}`, permission: "pull_request.review"},
		{name: "planner auto merge apply", method: http.MethodPost, path: "/v1/planner/pull-requests/pr-runtime-18/auto-merge", body: `{"action":"apply"}`, permission: "pull_request.merge"},
		{name: "pull request merge", method: http.MethodPost, path: "/v1/pull-requests/pr-runtime-18", body: `{"status":"merged"}`, permission: "pull_request.merge"},
		{name: "inbox review", method: http.MethodPost, path: "/v1/inbox/inbox-review-copy", body: `{"decision":"changes_requested"}`, permission: "inbox.review"},
		{name: "inbox decide", method: http.MethodPost, path: "/v1/inbox/inbox-approval-runtime", body: `{"decision":"approved"}`, permission: "inbox.decide"},
		{name: "mailbox create", method: http.MethodPost, path: "/v1/mailbox", body: `{"roomId":"room-runtime","fromAgentId":"agent-codex-dockmaster","toAgentId":"agent-claude-review-runner","title":"接住 reviewer lane","summary":"请你正式接住 reviewer lane。"}`, permission: "run.execute"},
		{name: "mailbox advance", method: http.MethodPost, path: "/v1/mailbox/handoff-demo", body: `{"action":"acknowledged","actingAgentId":"agent-claude-review-runner"}`, permission: "run.execute"},
		{name: "memory policy", method: http.MethodPost, path: "/v1/memory-center/policy", body: `{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`, permission: "memory.write"},
		{name: "memory providers", method: http.MethodPost, path: "/v1/memory-center/providers", body: `{"providers":[{"id":"workspace-file","kind":"workspace-file","label":"Workspace File Memory","enabled":true,"readScopes":["workspace","issue-room","room-notes","decision-ledger","agent","promoted-ledger"],"writeScopes":["workspace","issue-room","room-notes","decision-ledger","agent"],"recallPolicy":"governed-first","retentionPolicy":"保留版本、人工纠偏和提升 ledger。","sharingPolicy":"workspace-governed","summary":"Primary file-backed memory."}]}`, permission: "memory.write"},
		{name: "memory provider health check", method: http.MethodPost, path: "/v1/memory-center/providers/check", body: `{"providerId":"search-sidecar"}`, permission: "memory.write"},
		{name: "memory provider recovery", method: http.MethodPost, path: "/v1/memory-center/providers/search-sidecar/recover", body: "", permission: "memory.write"},
		{name: "memory cleanup", method: http.MethodPost, path: "/v1/memory-center/cleanup", body: "", permission: "memory.write"},
		{name: "memory feedback", method: http.MethodPost, path: "/v1/memory/memory-demo/feedback", body: `{"summary":"Human Correction","note":"纠正旧记忆"}`, permission: "memory.write"},
		{name: "memory forget", method: http.MethodPost, path: "/v1/memory/memory-demo/forget", body: `{"reason":"撤销这条过期记忆"}`, permission: "memory.write"},
		{name: "memory promotion create", method: http.MethodPost, path: "/v1/memory-center/promotions", body: `{"memoryId":"memory-demo","kind":"skill","title":"demo","rationale":"demo"}`, permission: "memory.write"},
		{name: "memory promotion review", method: http.MethodPost, path: "/v1/memory-center/promotions/memory-promotion-demo/review", body: `{"status":"approved"}`, permission: "memory.write"},
		{name: "credential create", method: http.MethodPost, path: "/v1/credentials", body: `{"label":"GitHub App","summary":"repo sync","secretKind":"github-app","secretValue":"super-secret","workspaceDefault":true}`, permission: "workspace.manage"},
		{name: "notification policy", method: http.MethodPost, path: "/v1/notifications/policy", body: `{"browserPush":"all","email":"critical"}`, permission: "workspace.manage"},
		{name: "notification subscriber", method: http.MethodPost, path: "/v1/notifications/subscribers", body: `{"channel":"email","target":"ops@openshock.dev","label":"Ops Oncall","preference":"critical","status":"ready"}`, permission: "workspace.manage"},
		{name: "agent profile patch", method: http.MethodPatch, path: "/v1/agents/agent-codex-dockmaster", body: `{"role":"Platform Architect","avatar":"control-tower","prompt":"keep live truth first","operatingInstructions":"stay on current head","providerPreference":"Codex CLI","modelPreference":"gpt-5.3-codex","recallPolicy":"agent-first","runtimePreference":"shock-main","memorySpaces":["workspace","user"]}`, permission: "workspace.manage"},
		{name: "run credential binding", method: http.MethodPatch, path: "/v1/runs/run_runtime_01/credentials", body: `{"credentialProfileIds":[]}`, permission: "run.execute"},
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
			if !reflect.DeepEqual(payload.State, store.State{}) {
				t.Fatalf("unauthorized payload leaked state on %s: %#v", testCase.path, payload.State)
			}
			if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
				t.Fatalf("store state mutated on unauthorized %s", testCase.path)
			}
		})
	}
}

func TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	mustLoginAuthGuardSession(t, s, server.URL, "mina@openshock.dev", "Mina Browser")

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
			name:   "direct message reply",
			method: http.MethodPost,
			path:   "/v1/direct-messages/dm-mina/messages",
			body:   `{"prompt":"继续保留这条 DM。"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST direct message reply status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					State store.State `json:"state"`
				}
				decodeJSON(t, resp, &payload)
				messages := payload.State.DirectMessageMessages["dm-mina"]
				if len(messages) == 0 || messages[len(messages)-1].Speaker != "Mina" {
					t.Fatalf("direct message payload = %#v, want appended Mina reply", messages)
				}
			},
		},
		{
			name:   "message surface collection",
			method: http.MethodPost,
			path:   "/v1/message-surface/collections",
			body:   `{"kind":"followed","channelId":"roadmap","messageId":"msg-roadmap-1","enabled":true}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST message surface collection status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Entry store.MessageSurfaceEntry `json:"entry"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Entry.ChannelID != "roadmap" || payload.Entry.MessageID != "msg-roadmap-1" {
					t.Fatalf("message surface payload = %#v, want roadmap followed entry", payload.Entry)
				}
			},
		},
		{
			name:   "topic guidance",
			method: http.MethodPatch,
			path:   "/v1/topics/topic-runtime",
			body:   `{"summary":"先锁 runtime heartbeat truth，再决定是否继续收 PR surface。"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("PATCH /v1/topics/topic-runtime status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Topic store.Topic `json:"topic"`
					State store.State `json:"state"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Topic.ID != "topic-runtime" || payload.Topic.Summary == "" {
					t.Fatalf("topic guidance payload = %#v, want updated topic", payload)
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
			name:   "run credential binding",
			method: http.MethodPatch,
			path:   "/v1/runs/run_runtime_01/credentials",
			body:   `{"credentialProfileIds":[]}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("PATCH /v1/runs/run_runtime_01/credentials status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Run *store.Run `json:"run"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Run == nil {
					t.Fatalf("run credential binding payload = %#v, want run", payload)
				}
			},
		},
		{
			name:   "run sandbox patch",
			method: http.MethodPatch,
			path:   "/v1/runs/run_runtime_01/sandbox",
			body:   `{"profile":"restricted","allowedHosts":["github.com"],"allowedCommands":["git status"],"allowedTools":["read_file"]}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("PATCH /v1/runs/run_runtime_01/sandbox status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Run     store.Run           `json:"run"`
					Sandbox store.SandboxPolicy `json:"sandbox"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Run.Sandbox.Profile != "restricted" || len(payload.Sandbox.AllowedCommands) != 1 {
					t.Fatalf("sandbox patch payload = %#v, want restricted policy", payload)
				}
			},
		},
		{
			name:   "run sandbox check",
			method: http.MethodPost,
			path:   "/v1/runs/run_runtime_01/sandbox",
			body:   `{"kind":"tool","target":"read_file"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("POST /v1/runs/run_runtime_01/sandbox status = %d, want %d", resp.StatusCode, http.StatusOK)
				}
				var payload struct {
					Run      store.Run             `json:"run"`
					Decision store.SandboxDecision `json:"decision"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Decision.Status != "allowed" || payload.Run.SandboxDecision.Status != "allowed" {
					t.Fatalf("sandbox check payload = %#v, want allowed decision", payload)
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
		{
			name:   "mailbox create",
			method: http.MethodPost,
			path:   "/v1/mailbox",
			body:   `{"roomId":"room-runtime","fromAgentId":"agent-codex-dockmaster","toAgentId":"agent-claude-review-runner","title":"接住 reviewer lane","summary":"请你正式接住 reviewer lane。"}`,
			verify: func(t *testing.T, resp *http.Response) {
				if resp.StatusCode != http.StatusCreated {
					t.Fatalf("POST /v1/mailbox status = %d, want %d", resp.StatusCode, http.StatusCreated)
				}
				var payload struct {
					Handoff store.AgentHandoff `json:"handoff"`
					State   store.State        `json:"state"`
				}
				decodeJSON(t, resp, &payload)
				if payload.Handoff.Status != "requested" || payload.Handoff.ToAgentID != "agent-claude-review-runner" {
					t.Fatalf("mailbox create payload = %#v, want requested handoff to Claude", payload)
				}
				if _, ok := findInboxByID(t, payload.State.Inbox, payload.Handoff.InboxItemID); !ok {
					t.Fatalf("mailbox inbox item missing: %#v", payload.State.Inbox)
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
		{name: "memory providers", method: http.MethodPost, path: "/v1/memory-center/providers", body: `{"providers":[{"id":"workspace-file","kind":"workspace-file","label":"Workspace File Memory","enabled":true,"readScopes":["workspace","issue-room","room-notes","decision-ledger","agent","promoted-ledger"],"writeScopes":["workspace","issue-room","room-notes","decision-ledger","agent"],"recallPolicy":"governed-first","retentionPolicy":"保留版本、人工纠偏和提升 ledger。","sharingPolicy":"workspace-governed","summary":"Primary file-backed memory."}]}`, permission: "memory.write"},
		{name: "memory provider health check", method: http.MethodPost, path: "/v1/memory-center/providers/check", body: `{"providerId":"search-sidecar"}`, permission: "memory.write"},
		{name: "memory provider recovery", method: http.MethodPost, path: "/v1/memory-center/providers/search-sidecar/recover", body: "", permission: "memory.write"},
		{name: "memory cleanup", method: http.MethodPost, path: "/v1/memory-center/cleanup", body: "", permission: "memory.write"},
		{name: "memory feedback", method: http.MethodPost, path: "/v1/memory/memory-demo/feedback", body: `{"summary":"Human Correction","note":"纠正旧记忆"}`, permission: "memory.write"},
		{name: "memory forget", method: http.MethodPost, path: "/v1/memory/memory-demo/forget", body: `{"reason":"撤销这条过期记忆"}`, permission: "memory.write"},
		{name: "memory promotion create", method: http.MethodPost, path: "/v1/memory-center/promotions", body: `{"memoryId":"memory-demo","kind":"skill","title":"demo","rationale":"demo"}`, permission: "memory.write"},
		{name: "memory promotion review", method: http.MethodPost, path: "/v1/memory-center/promotions/memory-promotion-demo/review", body: `{"status":"approved"}`, permission: "memory.write"},
		{name: "credential create", method: http.MethodPost, path: "/v1/credentials", body: `{"label":"GitHub App","summary":"repo sync","secretKind":"github-app","secretValue":"super-secret","workspaceDefault":true}`, permission: "workspace.manage"},
		{name: "notification policy", method: http.MethodPost, path: "/v1/notifications/policy", body: `{"browserPush":"all","email":"critical"}`, permission: "workspace.manage"},
		{name: "notification subscriber", method: http.MethodPost, path: "/v1/notifications/subscribers", body: `{"channel":"email","target":"ops@openshock.dev","label":"Ops Oncall","preference":"critical","status":"ready"}`, permission: "workspace.manage"},
		{name: "agent profile patch", method: http.MethodPatch, path: "/v1/agents/agent-codex-dockmaster", body: `{"role":"Platform Architect","avatar":"control-tower","prompt":"keep live truth first","operatingInstructions":"stay on current head","providerPreference":"Codex CLI","modelPreference":"gpt-5.3-codex","recallPolicy":"agent-first","runtimePreference":"shock-main","memorySpaces":["workspace","user"]}`, permission: "workspace.manage"},
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
			if !reflect.DeepEqual(payload.State, store.State{}) {
				t.Fatalf("forbidden payload leaked state on %s: %#v", testCase.path, payload.State)
			}
			if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
				t.Fatalf("store state mutated on forbidden %s", testCase.path)
			}
		})
	}

	t.Run("member cannot sandbox override without workspace manage", func(t *testing.T) {
		baseline := s.Snapshot()
		resp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/runs/run_runtime_01/sandbox", `{"kind":"command","target":"git push --force","override":true}`)
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("POST sandbox override status = %d, want %d", resp.StatusCode, http.StatusForbidden)
		}

		var payload struct {
			Error      string            `json:"error"`
			Permission string            `json:"permission"`
			Session    store.AuthSession `json:"session"`
			State      store.State       `json:"state"`
		}
		decodeJSON(t, resp, &payload)

		if payload.Error != `permission "workspace.manage" required for sandbox override` {
			t.Fatalf("error = %q, want sandbox override workspace.manage denial", payload.Error)
		}
		if payload.Permission != "workspace.manage" {
			t.Fatalf("permission = %q, want workspace.manage", payload.Permission)
		}
		if payload.Session.Role != "member" || payload.Session.Email != "mina@openshock.dev" {
			t.Fatalf("session = %#v, want member session", payload.Session)
		}
		if !reflect.DeepEqual(payload.State, store.State{}) {
			t.Fatalf("sandbox override denial leaked state: %#v", payload.State)
		}
		if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
			t.Fatalf("store state mutated on forbidden sandbox override")
		}
	})
}

func TestMutationRoutesRequireVerifiedEmailAndAuthorizedDevice(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	_, invited, err := s.InviteWorkspaceMember(store.WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  "member",
	})
	if err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}

	_, session, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       invited.Email,
		DeviceLabel: "Reviewer Phone",
	})
	if err != nil {
		t.Fatalf("LoginWithEmail(invited member) error = %v", err)
	}
	mustEstablishContractBrowserSession(t, server.URL, invited.Email, "Reviewer Phone")
	if session.EmailVerificationStatus != "pending" || session.DeviceAuthStatus != "pending" {
		t.Fatalf("session = %#v, want pending verify/device", session)
	}

	baseline := s.Snapshot()
	resp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/issues", `{"title":"Blocked pending member issue"}`)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/issues pending email status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	var blockedByEmail struct {
		Error      string            `json:"error"`
		Permission string            `json:"permission"`
		Session    store.AuthSession `json:"session"`
		State      store.State       `json:"state"`
	}
	decodeJSON(t, resp, &blockedByEmail)

	if blockedByEmail.Error != "email verification required" {
		t.Fatalf("pending email error = %q, want %q", blockedByEmail.Error, "email verification required")
	}
	if blockedByEmail.Permission != "issue.create" {
		t.Fatalf("pending email permission = %q, want %q", blockedByEmail.Permission, "issue.create")
	}
	if blockedByEmail.Session.Email != invited.Email || blockedByEmail.Session.EmailVerificationStatus != "pending" {
		t.Fatalf("pending email session = %#v, want invited pending session", blockedByEmail.Session)
	}
	if !reflect.DeepEqual(blockedByEmail.State, store.State{}) {
		t.Fatalf("pending email payload leaked state: %#v", blockedByEmail.State)
	}
	if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
		t.Fatalf("store state mutated on pending email denial")
	}

	_, verifyChallenge, err := s.RequestVerifyMemberEmailChallenge(store.AuthRecoveryInput{Email: invited.Email})
	if err != nil {
		t.Fatalf("RequestVerifyMemberEmailChallenge() error = %v", err)
	}
	_, verifiedSession, _, err := s.VerifyMemberEmail(store.AuthRecoveryInput{Email: invited.Email, ChallengeID: verifyChallenge.ID})
	if err != nil {
		t.Fatalf("VerifyMemberEmail() error = %v", err)
	}
	if verifiedSession.EmailVerificationStatus != "verified" || verifiedSession.DeviceAuthStatus != "pending" {
		t.Fatalf("verified session = %#v, want verified email + pending device", verifiedSession)
	}

	baseline = s.Snapshot()
	resp = doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/issues", `{"title":"Blocked pending device issue"}`)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/issues pending device status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	var blockedByDevice struct {
		Error      string            `json:"error"`
		Permission string            `json:"permission"`
		Session    store.AuthSession `json:"session"`
		State      store.State       `json:"state"`
	}
	decodeJSON(t, resp, &blockedByDevice)

	if blockedByDevice.Error != "device authorization required" {
		t.Fatalf("pending device error = %q, want %q", blockedByDevice.Error, "device authorization required")
	}
	if blockedByDevice.Permission != "issue.create" {
		t.Fatalf("pending device permission = %q, want %q", blockedByDevice.Permission, "issue.create")
	}
	if blockedByDevice.Session.Email != invited.Email || blockedByDevice.Session.DeviceAuthStatus != "pending" {
		t.Fatalf("pending device session = %#v, want invited pending device session", blockedByDevice.Session)
	}
	if !reflect.DeepEqual(blockedByDevice.State, store.State{}) {
		t.Fatalf("pending device payload leaked state: %#v", blockedByDevice.State)
	}
	if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
		t.Fatalf("store state mutated on pending device denial")
	}

	_, authorizeChallenge, err := s.RequestAuthorizeAuthDeviceChallenge(store.AuthRecoveryInput{
		Email:    invited.Email,
		DeviceID: session.DeviceID,
	})
	if err != nil {
		t.Fatalf("RequestAuthorizeAuthDeviceChallenge() error = %v", err)
	}
	_, authorizedSession, _, device, err := s.AuthorizeAuthDevice(store.AuthRecoveryInput{
		Email:       invited.Email,
		DeviceID:    session.DeviceID,
		ChallengeID: authorizeChallenge.ID,
	})
	if err != nil {
		t.Fatalf("AuthorizeAuthDevice() error = %v", err)
	}
	if authorizedSession.DeviceAuthStatus != "authorized" || device.Status != "authorized" {
		t.Fatalf("authorized session/device = %#v / %#v, want authorized device", authorizedSession, device)
	}
	if authorizedSession.MemberStatus != "invited" {
		t.Fatalf("authorized session member status = %q, want invited until owner activation", authorizedSession.MemberStatus)
	}

	baseline = s.Snapshot()
	resp = doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/issues", `{"title":"Blocked pending owner approval issue"}`)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/issues pending owner approval status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	var blockedByApproval struct {
		Error      string            `json:"error"`
		Permission string            `json:"permission"`
		Session    store.AuthSession `json:"session"`
		State      store.State       `json:"state"`
	}
	decodeJSON(t, resp, &blockedByApproval)

	if blockedByApproval.Error != store.ErrWorkspaceMemberApprovalRequired.Error() {
		t.Fatalf("pending approval error = %q, want %q", blockedByApproval.Error, store.ErrWorkspaceMemberApprovalRequired.Error())
	}
	if blockedByApproval.Session.MemberStatus != "invited" {
		t.Fatalf("pending approval session = %#v, want invited member status", blockedByApproval.Session)
	}
	if !reflect.DeepEqual(blockedByApproval.State, store.State{}) {
		t.Fatalf("pending approval payload leaked state: %#v", blockedByApproval.State)
	}
	if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
		t.Fatalf("store state mutated on pending owner approval denial")
	}

	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner reauth) error = %v", err)
	}
	if _, _, err := s.UpdateWorkspaceMember(invited.ID, store.WorkspaceMemberUpdateInput{Status: "active"}); err != nil {
		t.Fatalf("UpdateWorkspaceMember(activate invited) error = %v", err)
	}
	mustLoginAuthGuardSession(t, s, server.URL, invited.Email, "Reviewer Phone")

	resp = doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/issues", `{"title":"Ready member issue","summary":"recovery gates cleared","owner":"Reviewer","priority":"medium"}`)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/issues ready member status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}

	var allowed struct {
		RoomID string      `json:"roomId"`
		RunID  string      `json:"runId"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &allowed)
	if allowed.RoomID == "" || allowed.RunID == "" {
		t.Fatalf("ready member payload = %#v, want roomId/runId", allowed)
	}
	if allowed.State.Auth.Session.Email != invited.Email || allowed.State.Auth.Session.DeviceAuthStatus != "authorized" {
		t.Fatalf("ready member session = %#v, want authorized invited session", allowed.State.Auth.Session)
	}
}

func TestMemberRoleCanAdvanceMailboxLifecycle(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	mustLoginAuthGuardSession(t, s, server.URL, "mina@openshock.dev", "Mina Browser")

	nextState, handoff, err := s.CreateHandoff(store.MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "接住 reviewer lane",
		Summary:     "请你正式接住 reviewer lane。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if len(nextState.Mailbox) == 0 {
		t.Fatalf("mailbox = %#v, want seeded handoff before route advance", nextState.Mailbox)
	}

	resp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/mailbox/"+handoff.ID, `{"action":"acknowledged","actingAgentId":"agent-claude-review-runner"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/mailbox/%s status = %d, want %d", handoff.ID, resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Handoff.Status != "acknowledged" {
		t.Fatalf("handoff = %#v, want acknowledged", payload.Handoff)
	}
	run := findRunByID(payload.State, "run_runtime_01")
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched after member mailbox advance", run)
	}
}

func TestViewerRoleCannotMutateProtectedSurfaces(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	mustLoginAuthGuardSession(t, s, server.URL, "longwen@openshock.dev", "Longwen Browser")

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		permission string
	}{
		{name: "issue create", method: http.MethodPost, path: "/v1/issues", body: `{"title":"Viewer blocked issue"}`, permission: "issue.create"},
		{name: "room reply", method: http.MethodPost, path: "/v1/rooms/room-runtime/messages", body: `{"prompt":"viewer should not reply"}`, permission: "room.reply"},
		{name: "direct message reply", method: http.MethodPost, path: "/v1/direct-messages/dm-mina/messages", body: `{"prompt":"viewer should not DM"}`, permission: "room.reply"},
		{name: "message surface collection", method: http.MethodPost, path: "/v1/message-surface/collections", body: `{"kind":"followed","channelId":"roadmap","messageId":"msg-roadmap-1","enabled":true}`, permission: "room.reply"},
		{name: "topic guidance", method: http.MethodPatch, path: "/v1/topics/topic-runtime", body: `{"summary":"viewer should not guide topic"}`, permission: "room.reply"},
		{name: "run execute", method: http.MethodPost, path: "/v1/exec", body: `{"prompt":"viewer should not exec"}`, permission: "run.execute"},
		{name: "run control", method: http.MethodPost, path: "/v1/runs/run_runtime_01/control", body: `{"action":"stop","note":"viewer should not stop"}`, permission: "run.execute"},
		{name: "run sandbox patch", method: http.MethodPatch, path: "/v1/runs/run_runtime_01/sandbox", body: `{"profile":"restricted","allowedHosts":["github.com"],"allowedCommands":["git status"],"allowedTools":["read_file"]}`, permission: "run.execute"},
		{name: "run sandbox check", method: http.MethodPost, path: "/v1/runs/run_runtime_01/sandbox", body: `{"kind":"command","target":"git push --force"}`, permission: "run.execute"},
		{name: "pull request review", method: http.MethodPost, path: "/v1/rooms/room-runtime/pull-request", body: `{}`, permission: "pull_request.review"},
		{name: "pull request merge", method: http.MethodPost, path: "/v1/pull-requests/pr-runtime-18", body: `{"status":"merged"}`, permission: "pull_request.merge"},
		{name: "inbox review", method: http.MethodPost, path: "/v1/inbox/inbox-review-copy", body: `{"decision":"changes_requested"}`, permission: "inbox.review"},
		{name: "inbox decide", method: http.MethodPost, path: "/v1/inbox/inbox-approval-runtime", body: `{"decision":"approved"}`, permission: "inbox.decide"},
		{name: "mailbox create", method: http.MethodPost, path: "/v1/mailbox", body: `{"roomId":"room-runtime","fromAgentId":"agent-codex-dockmaster","toAgentId":"agent-claude-review-runner","title":"接住 reviewer lane","summary":"请你正式接住 reviewer lane。"}`, permission: "run.execute"},
		{name: "mailbox advance", method: http.MethodPost, path: "/v1/mailbox/handoff-demo", body: `{"action":"acknowledged","actingAgentId":"agent-claude-review-runner"}`, permission: "run.execute"},
		{name: "memory policy", method: http.MethodPost, path: "/v1/memory-center/policy", body: `{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`, permission: "memory.write"},
		{name: "memory providers", method: http.MethodPost, path: "/v1/memory-center/providers", body: `{"providers":[{"id":"workspace-file","kind":"workspace-file","label":"Workspace File Memory","enabled":true,"readScopes":["workspace","issue-room","room-notes","decision-ledger","agent","promoted-ledger"],"writeScopes":["workspace","issue-room","room-notes","decision-ledger","agent"],"recallPolicy":"governed-first","retentionPolicy":"保留版本、人工纠偏和提升 ledger。","sharingPolicy":"workspace-governed","summary":"Primary file-backed memory."}]}`, permission: "memory.write"},
		{name: "memory provider health check", method: http.MethodPost, path: "/v1/memory-center/providers/check", body: `{"providerId":"search-sidecar"}`, permission: "memory.write"},
		{name: "memory provider recovery", method: http.MethodPost, path: "/v1/memory-center/providers/search-sidecar/recover", body: "", permission: "memory.write"},
		{name: "memory cleanup", method: http.MethodPost, path: "/v1/memory-center/cleanup", body: "", permission: "memory.write"},
		{name: "memory feedback", method: http.MethodPost, path: "/v1/memory/memory-demo/feedback", body: `{"summary":"Human Correction","note":"纠正旧记忆"}`, permission: "memory.write"},
		{name: "memory forget", method: http.MethodPost, path: "/v1/memory/memory-demo/forget", body: `{"reason":"撤销这条过期记忆"}`, permission: "memory.write"},
		{name: "memory promotion create", method: http.MethodPost, path: "/v1/memory-center/promotions", body: `{"memoryId":"memory-demo","kind":"skill","title":"demo","rationale":"demo"}`, permission: "memory.write"},
		{name: "memory promotion review", method: http.MethodPost, path: "/v1/memory-center/promotions/memory-promotion-demo/review", body: `{"status":"approved"}`, permission: "memory.write"},
		{name: "credential create", method: http.MethodPost, path: "/v1/credentials", body: `{"label":"GitHub App","summary":"repo sync","secretKind":"github-app","secretValue":"super-secret","workspaceDefault":true}`, permission: "workspace.manage"},
		{name: "notification policy", method: http.MethodPost, path: "/v1/notifications/policy", body: `{"browserPush":"all","email":"critical"}`, permission: "workspace.manage"},
		{name: "notification subscriber", method: http.MethodPost, path: "/v1/notifications/subscribers", body: `{"channel":"email","target":"ops@openshock.dev","label":"Ops Oncall","preference":"critical","status":"ready"}`, permission: "workspace.manage"},
		{name: "agent profile patch", method: http.MethodPatch, path: "/v1/agents/agent-codex-dockmaster", body: `{"role":"Platform Architect","avatar":"control-tower","prompt":"keep live truth first","operatingInstructions":"stay on current head","providerPreference":"Codex CLI","modelPreference":"gpt-5.3-codex","recallPolicy":"agent-first","runtimePreference":"shock-main","memorySpaces":["workspace","user"]}`, permission: "workspace.manage"},
		{name: "run credential binding", method: http.MethodPatch, path: "/v1/runs/run_runtime_01/credentials", body: `{"credentialProfileIds":[]}`, permission: "run.execute"},
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
			if !reflect.DeepEqual(payload.State, store.State{}) {
				t.Fatalf("forbidden payload leaked state on %s: %#v", testCase.path, payload.State)
			}
			if !reflect.DeepEqual(normalizeAuthGuardState(s.Snapshot()), normalizeAuthGuardState(baseline)) {
				t.Fatalf("store state mutated on forbidden %s", testCase.path)
			}
		})
	}
}

func newAuthGuardTestServer(t *testing.T, root string) (*store.Store, *fakeGitHubClient, *httptest.Server, func()) {
	t.Helper()
	ensureContractAuthTransport()

	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
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
	clearContractAuthCookie(server.URL)

	cleanup := func() {
		daemon.Close()
	}

	return s, github, server, cleanup
}

func mustLoginAuthGuardSession(t *testing.T, s *store.Store, serverURL, email, deviceLabel string) store.AuthSession {
	t.Helper()
	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       email,
		DeviceLabel: deviceLabel,
	}); err != nil {
		t.Fatalf("LoginWithEmail(%s) error = %v", email, err)
	}
	return mustEstablishContractBrowserSession(t, serverURL, email, deviceLabel)
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
	body, err := json.Marshal(state)
	if err == nil {
		var normalized store.State
		if unmarshalErr := json.Unmarshal(body, &normalized); unmarshalErr == nil {
			state = normalized
		}
	}
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
