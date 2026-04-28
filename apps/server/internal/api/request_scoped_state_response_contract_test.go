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
