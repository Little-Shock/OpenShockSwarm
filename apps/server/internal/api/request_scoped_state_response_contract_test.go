package api

import (
	"net/http"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRequestScopedMutationResponsesKeepCallerSessionAcrossSupportingFlows(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	memberClient := contractBrowserClient(t)
	ownerClient := contractBrowserClient(t)

	memberLoginResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member browser login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member browser login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}
	memberLoginResp.Body.Close()

	ownerLoginResp, err := postContractAuthSessionJSON(t, ownerClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner browser login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner browser login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}
	ownerLoginResp.Body.Close()

	topicResp := doJSONRequest(t, memberClient, http.MethodPatch, server.URL+"/v1/topics/topic-runtime", `{"summary":"先锁 runtime heartbeat truth，再继续推进。"}`)
	defer topicResp.Body.Close()
	if topicResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/topics/topic-runtime status = %d, want %d", topicResp.StatusCode, http.StatusOK)
	}

	var topicPayload struct {
		Room  store.Room  `json:"room"`
		State store.State `json:"state"`
	}
	decodeJSON(t, topicResp, &topicPayload)
	if topicPayload.Room.Topic.Summary != "先锁 runtime heartbeat truth，再继续推进。" {
		t.Fatalf("topic payload room = %#v, want updated topic summary", topicPayload.Room)
	}
	if topicPayload.State.Auth.Session.Email != "mina@openshock.dev" || topicPayload.State.Auth.Session.Role != "member" {
		t.Fatalf("topic response session = %#v, want scoped member session", topicPayload.State.Auth.Session)
	}

	memberRefreshResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member refresh login error = %v", err)
	}
	if memberRefreshResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member refresh login status = %d, want %d", memberRefreshResp.StatusCode, http.StatusOK)
	}
	memberRefreshResp.Body.Close()

	policyResp := doJSONRequest(t, ownerClient, http.MethodPost, server.URL+"/v1/memory-center/policy", `{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`)
	defer policyResp.Body.Close()
	if policyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/policy status = %d, want %d", policyResp.StatusCode, http.StatusOK)
	}

	var policyPayload struct {
		Policy store.MemoryInjectionPolicy `json:"policy"`
		State  store.State                 `json:"state"`
	}
	decodeJSON(t, policyResp, &policyPayload)
	if policyPayload.Policy.MaxItems != 8 || !policyPayload.Policy.IncludeAgentMemory {
		t.Fatalf("policy payload = %#v, want updated governed-first policy", policyPayload.Policy)
	}
	if policyPayload.State.Auth.Session.Email != "larkspur@openshock.dev" || policyPayload.State.Auth.Session.Role != "owner" {
		t.Fatalf("policy response session = %#v, want scoped owner session", policyPayload.State.Auth.Session)
	}
	if topicPayload.State.Auth.Session.MemberID == policyPayload.State.Auth.Session.MemberID {
		t.Fatalf("supporting flow sessions collapsed: topic=%#v policy=%#v", topicPayload.State.Auth.Session, policyPayload.State.Auth.Session)
	}
}

func TestRequestScopedRunMutationResponsesKeepCallerSessionAndFailClosed(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	memberClient := contractBrowserClient(t)
	ownerClient := contractBrowserClient(t)

	memberLoginResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member browser login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member browser login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}
	memberLoginResp.Body.Close()

	ownerLoginResp, err := postContractAuthSessionJSON(t, ownerClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner browser login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner browser login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}
	ownerLoginResp.Body.Close()

	controlResp := doJSONRequest(t, memberClient, http.MethodPost, server.URL+"/v1/runs/run_runtime_01/control", `{"action":"follow_thread","note":"继续沿当前线程推进。"}`)
	defer controlResp.Body.Close()
	if controlResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/runs/run_runtime_01/control status = %d, want %d", controlResp.StatusCode, http.StatusOK)
	}

	var controlPayload struct {
		Action string      `json:"action"`
		Run    *store.Run  `json:"run"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, controlResp, &controlPayload)
	if controlPayload.Action != "follow_thread" || controlPayload.Run == nil || !controlPayload.Run.FollowThread {
		t.Fatalf("run control payload = %#v, want follow_thread run update", controlPayload)
	}
	if controlPayload.State.Auth.Session.Email != "mina@openshock.dev" || controlPayload.State.Auth.Session.Role != "member" {
		t.Fatalf("run control response session = %#v, want scoped member session", controlPayload.State.Auth.Session)
	}

	sandboxResp := doJSONRequest(t, memberClient, http.MethodPatch, server.URL+"/v1/runs/run_runtime_01/sandbox", `{"profile":"restricted","allowedHosts":["github.com"],"allowedCommands":["git status"],"allowedTools":["read_file"]}`)
	defer sandboxResp.Body.Close()
	if sandboxResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/runs/run_runtime_01/sandbox status = %d, want %d", sandboxResp.StatusCode, http.StatusOK)
	}

	var sandboxPayload struct {
		Run     store.Run           `json:"run"`
		Sandbox store.SandboxPolicy `json:"sandbox"`
		State   store.State         `json:"state"`
	}
	decodeJSON(t, sandboxResp, &sandboxPayload)
	if sandboxPayload.Run.Sandbox.Profile != "restricted" || sandboxPayload.Sandbox.Profile != "restricted" {
		t.Fatalf("sandbox payload = %#v, want restricted policy", sandboxPayload)
	}
	if sandboxPayload.State.Auth.Session.Email != "mina@openshock.dev" || sandboxPayload.State.Auth.Session.Role != "member" {
		t.Fatalf("sandbox response session = %#v, want scoped member session", sandboxPayload.State.Auth.Session)
	}
	if controlPayload.State.Auth.Session.MemberID != sandboxPayload.State.Auth.Session.MemberID {
		t.Fatalf("run mutation sessions diverged: control=%#v sandbox=%#v", controlPayload.State.Auth.Session, sandboxPayload.State.Auth.Session)
	}

	signedOutClient := plainContractHTTPClient()
	signedOutControlResp := doJSONRequest(t, signedOutClient, http.MethodPost, server.URL+"/v1/runs/run_runtime_01/control", `{"action":"resume","note":"签出请求不应拿到 state。"}`)
	defer signedOutControlResp.Body.Close()
	assertAuthMutationFailsClosedWithoutState(t, signedOutControlResp, "/v1/runs/run_runtime_01/control")

	signedOutSandboxResp := doJSONRequest(t, signedOutClient, http.MethodPatch, server.URL+"/v1/runs/run_runtime_01/sandbox", `{"profile":"open"}`)
	defer signedOutSandboxResp.Body.Close()
	assertAuthMutationFailsClosedWithoutState(t, signedOutSandboxResp, "/v1/runs/run_runtime_01/sandbox")
}

func assertAuthMutationFailsClosedWithoutState(t *testing.T, resp *http.Response, endpoint string) {
	t.Helper()

	if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
		t.Fatalf("%s signed-out status = %d, want 401 or 403", endpoint, resp.StatusCode)
	}

	var payload map[string]any
	decodeJSON(t, resp, &payload)
	if _, ok := payload["state"]; ok {
		t.Fatalf("%s signed-out payload exposed state side channel: %#v", endpoint, payload)
	}
}
