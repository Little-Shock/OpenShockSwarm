package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestMailboxRoutesCreateAndListLiveTruth(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	createBody, err := json.Marshal(map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "接住 reviewer lane",
		"summary":     "请你正式接住 reviewer lane，并在 mailbox 里显式回写 blocked / complete。",
	})
	if err != nil {
		t.Fatalf("Marshal(create handoff) error = %v", err)
	}

	createResp, err := http.Post(server.URL+"/v1/mailbox", "application/json", bytes.NewReader(createBody))
	if err != nil {
		t.Fatalf("POST /v1/mailbox error = %v", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, createResp, &createPayload)

	if createPayload.Handoff.Status != "requested" || createPayload.Handoff.ID == "" {
		t.Fatalf("handoff = %#v, want requested handoff with id", createPayload.Handoff)
	}
	inboxItem, ok := findInboxByID(t, createPayload.State.Inbox, createPayload.Handoff.InboxItemID)
	if !ok {
		t.Fatalf("inbox = %#v, want handoff inbox item", createPayload.State.Inbox)
	}
	if !strings.Contains(inboxItem.Href, "/inbox?") || !strings.Contains(inboxItem.Href, "handoffId="+createPayload.Handoff.ID) {
		t.Fatalf("inbox href = %q, want mailbox deep link into /inbox", inboxItem.Href)
	}

	listResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox error = %v", err)
	}
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox status = %d, want %d", listResp.StatusCode, http.StatusOK)
	}

	var handoffs []store.AgentHandoff
	decodeJSON(t, listResp, &handoffs)
	if len(handoffs) == 0 || handoffs[0].ID != createPayload.Handoff.ID {
		t.Fatalf("handoffs = %#v, want created handoff at front", handoffs)
	}

	detailResp, err := http.Get(server.URL + "/v1/mailbox/" + createPayload.Handoff.ID)
	if err != nil {
		t.Fatalf("GET /v1/mailbox/:id error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox/:id status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}

	var detail store.AgentHandoff
	decodeJSON(t, detailResp, &detail)
	if detail.ID != createPayload.Handoff.ID || detail.ToAgent != "Claude Review Runner" {
		t.Fatalf("detail = %#v, want created handoff detail", detail)
	}
}

func TestMailboxRoutesAdvanceLifecycleAndGuardrails(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	defer createResp.Body.Close()

	blockedWithoutNote := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer blockedWithoutNote.Body.Close()
	if blockedWithoutNote.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST blocked without note status = %d, want %d", blockedWithoutNote.StatusCode, http.StatusBadRequest)
	}

	ackResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackResp.Body.Close()
	if ackResp.StatusCode != http.StatusOK {
		t.Fatalf("POST acknowledged status = %d, want %d", ackResp.StatusCode, http.StatusOK)
	}

	var ackPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, ackResp, &ackPayload)
	if ackPayload.Handoff.Status != "acknowledged" {
		t.Fatalf("ack handoff = %#v, want acknowledged", ackPayload.Handoff)
	}
	run := findRunByID(ackPayload.State, "run_runtime_01")
	room := findRoomByID(ackPayload.State, "room-runtime")
	issue := findIssueByRoomID(ackPayload.State, "room-runtime")
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched after ack", run)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want topic owner switched after ack", room)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want issue owner switched after ack", issue)
	}

	forbiddenResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "wrong actor should fail",
	})
	defer forbiddenResp.Body.Close()
	if forbiddenResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST wrong actor status = %d, want %d", forbiddenResp.StatusCode, http.StatusForbidden)
	}

	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "等评论同步先收平。",
	})
	defer blockedResp.Body.Close()
	if blockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST blocked status = %d, want %d", blockedResp.StatusCode, http.StatusOK)
	}

	reaackResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer reaackResp.Body.Close()
	if reaackResp.StatusCode != http.StatusOK {
		t.Fatalf("POST re-acknowledged status = %d, want %d", reaackResp.StatusCode, http.StatusOK)
	}

	completeResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "review notes 已吸收，后面可以回到 PR 收口。",
	})
	defer completeResp.Body.Close()
	if completeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST completed status = %d, want %d", completeResp.StatusCode, http.StatusOK)
	}

	var completePayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, completeResp, &completePayload)
	if completePayload.Handoff.Status != "completed" {
		t.Fatalf("complete handoff = %#v, want completed", completePayload.Handoff)
	}
	completedInbox, ok := findInboxByID(t, completePayload.State.Inbox, completePayload.Handoff.InboxItemID)
	if !ok || !strings.Contains(completedInbox.Summary, "收口备注") {
		t.Fatalf("completed inbox item = %#v, want completion note reflected", completedInbox)
	}
}

func mustCreateMailboxHandoff(t *testing.T, serverURL string) (*http.Response, store.AgentHandoff) {
	t.Helper()

	resp := doMailboxRouteRequest(t, serverURL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "接住 reviewer lane",
		"summary":     "请你正式接住 reviewer lane，并在 mailbox 里显式回写 blocked / complete。",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create handoff status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}

	var payload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, resp, &payload)
	return resp, payload.Handoff
}

func doMailboxRouteRequest(t *testing.T, url string, payload map[string]string) *http.Response {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal(mailbox request) error = %v", err)
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s error = %v", url, err)
	}
	return resp
}
