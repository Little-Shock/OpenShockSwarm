package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestTopicRoutesExposeStandaloneTopicDetailAndGuidanceWriteback(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	detailResp, err := http.Get(server.URL + "/v1/topics/topic-runtime")
	if err != nil {
		t.Fatalf("GET /v1/topics/:id error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/topics/:id status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}

	var detailPayload struct {
		Topic store.Topic `json:"topic"`
		Room  store.Room  `json:"room"`
		State store.State `json:"state"`
	}
	decodeJSON(t, detailResp, &detailPayload)
	if detailPayload.Topic.ID != "topic-runtime" || detailPayload.Room.ID != "room-runtime" {
		t.Fatalf("detail payload = %#v, want topic-runtime in room-runtime", detailPayload)
	}

	summary := "先锁 runtime heartbeat truth，再决定是否继续收 PR surface。"
	updateResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/topics/topic-runtime", `{"summary":"`+summary+`"}`)
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/topics/:id status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}

	var updatePayload struct {
		Topic store.Topic `json:"topic"`
		Room  store.Room  `json:"room"`
		State store.State `json:"state"`
	}
	decodeJSON(t, updateResp, &updatePayload)

	if updatePayload.Topic.Summary != summary || updatePayload.Room.Summary != summary {
		t.Fatalf("updated topic payload = %#v, want updated summary", updatePayload)
	}
	run := findRunByID(updatePayload.State, "run_runtime_01")
	if run == nil || run.Summary != summary || run.NextAction != summary {
		t.Fatalf("run = %#v, want updated summary + nextAction", run)
	}
	session := findSessionByID(updatePayload.State, "session-runtime")
	if session == nil || session.Summary != summary {
		t.Fatalf("session = %#v, want updated summary", session)
	}
	messages := updatePayload.State.RoomMessages["room-runtime"]
	if len(messages) == 0 || !strings.Contains(messages[len(messages)-1].Message, "runtime heartbeat truth") {
		t.Fatalf("room messages = %#v, want appended topic guidance ledger entry", messages)
	}
}

func TestTopicGuidanceRouteRejectsBlankSummary(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/topics/topic-runtime", `{"summary":"   "}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("PATCH /v1/topics/:id blank summary status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	var payload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Error != store.ErrTopicGuidanceRequired.Error() {
		t.Fatalf("error = %q, want %q", payload.Error, store.ErrTopicGuidanceRequired.Error())
	}
}
