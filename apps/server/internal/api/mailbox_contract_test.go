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
		"kind":        "governed",
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
	if createPayload.Handoff.Kind != "governed" {
		t.Fatalf("handoff kind = %#v, want governed kind echoed back from create contract", createPayload.Handoff)
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

func TestMailboxRoutesCreateGovernedHandoffForRoom(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	mustPatchGovernedQATopology(t, server.URL)

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	defer createResp.Body.Close()
	ackResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackResp.Body.Close()
	completeResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 已完成，改由 cross-room governed route 直接起 QA 一棒。",
		"continueGovernedRoute": false,
	})
	defer completeResp.Body.Close()

	governedReq, err := http.NewRequest(http.MethodPost, server.URL+"/v1/mailbox/governed", bytes.NewReader([]byte(`{"roomId":"room-runtime"}`)))
	if err != nil {
		t.Fatalf("new POST /v1/mailbox/governed request error = %v", err)
	}
	governedReq.Header.Set("Content-Type", "application/json")

	governedResp, err := http.DefaultClient.Do(governedReq)
	if err != nil {
		t.Fatalf("POST /v1/mailbox/governed error = %v", err)
	}
	defer governedResp.Body.Close()
	if governedResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox/governed status = %d, want %d", governedResp.StatusCode, http.StatusCreated)
	}

	var governedPayload struct {
		Handoff    store.AgentHandoff                        `json:"handoff"`
		Suggestion store.WorkspaceGovernanceSuggestedHandoff `json:"suggestion"`
		State      store.State                               `json:"state"`
	}
	decodeJSON(t, governedResp, &governedPayload)

	if governedPayload.Suggestion.Status != "ready" || governedPayload.Suggestion.ToAgent != "Memory Clerk" {
		t.Fatalf("governed suggestion payload = %#v, want ready reviewer -> Memory Clerk route", governedPayload.Suggestion)
	}
	if governedPayload.Handoff.Kind != "governed" || governedPayload.Handoff.ToAgent != "Memory Clerk" || governedPayload.Handoff.Status != "requested" {
		t.Fatalf("governed handoff payload = %#v, want requested governed handoff to Memory Clerk", governedPayload.Handoff)
	}
	if governedPayload.State.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HandoffID != governedPayload.Handoff.ID {
		t.Fatalf("workspace suggested handoff = %#v, want active followup handoff after governed create", governedPayload.State.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}

	conflictResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/governed", map[string]string{"roomId": "room-runtime"})
	defer conflictResp.Body.Close()
	if conflictResp.StatusCode != http.StatusConflict {
		t.Fatalf("repeat POST /v1/mailbox/governed status = %d, want %d", conflictResp.StatusCode, http.StatusConflict)
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

func TestMailboxRoutesCommentPersistsFormalRepliesWithoutChangingLifecycle(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	defer createResp.Body.Close()

	emptyCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "comment",
		"actingAgentId": "agent-codex-dockmaster",
	})
	defer emptyCommentResp.Body.Close()
	if emptyCommentResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST empty comment status = %d, want %d", emptyCommentResp.StatusCode, http.StatusBadRequest)
	}

	forbiddenCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "comment",
		"actingAgentId": "agent-memory-clerk",
		"note":          "无关 agent 不应被允许插入 formal comment。",
	})
	defer forbiddenCommentResp.Body.Close()
	if forbiddenCommentResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST unrelated comment status = %d, want %d", forbiddenCommentResp.StatusCode, http.StatusForbidden)
	}

	sourceCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "comment",
		"actingAgentId": "agent-codex-dockmaster",
		"note":          "这里补充 reviewer context，先不要切状态。",
	})
	defer sourceCommentResp.Body.Close()
	if sourceCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST source comment status = %d, want %d", sourceCommentResp.StatusCode, http.StatusOK)
	}

	var sourceCommentPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, sourceCommentResp, &sourceCommentPayload)
	if sourceCommentPayload.Handoff.Status != "requested" {
		t.Fatalf("source comment handoff = %#v, want requested lifecycle preserved", sourceCommentPayload.Handoff)
	}
	sourceCommentMessage := sourceCommentPayload.Handoff.Messages[len(sourceCommentPayload.Handoff.Messages)-1]
	if sourceCommentMessage.Kind != "comment" || sourceCommentMessage.AuthorName != "Codex Dockmaster" {
		t.Fatalf("source comment message = %#v, want source-authored comment", sourceCommentMessage)
	}
	requestedInbox, ok := findInboxByID(t, sourceCommentPayload.State.Inbox, sourceCommentPayload.Handoff.InboxItemID)
	if !ok || requestedInbox.Kind != "status" || !strings.Contains(requestedInbox.Summary, "正式评论") {
		t.Fatalf("requested inbox item = %#v, want status inbox with comment summary", requestedInbox)
	}

	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "还缺 diff evidence。",
	})
	defer blockedResp.Body.Close()
	if blockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST blocked status = %d, want %d", blockedResp.StatusCode, http.StatusOK)
	}

	targetCommentResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "comment",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "我已经补看完 thread，但 blocker 还没解除。",
	})
	defer targetCommentResp.Body.Close()
	if targetCommentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST target comment status = %d, want %d", targetCommentResp.StatusCode, http.StatusOK)
	}

	var targetCommentPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, targetCommentResp, &targetCommentPayload)
	if targetCommentPayload.Handoff.Status != "blocked" || targetCommentPayload.Handoff.LastNote != "还缺 diff evidence。" {
		t.Fatalf("target comment handoff = %#v, want blocked lifecycle and blocker note preserved", targetCommentPayload.Handoff)
	}
	blockedInbox, ok := findInboxByID(t, targetCommentPayload.State.Inbox, targetCommentPayload.Handoff.InboxItemID)
	if !ok || blockedInbox.Kind != "blocked" {
		t.Fatalf("blocked inbox item = %#v, want blocked tone preserved after comment", blockedInbox)
	}
}

func TestMailboxRoutesCompletedCanAutoAdvanceGovernedRoute(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	mustPatchGovernedQATopology(t, server.URL)

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	defer createResp.Body.Close()

	ackResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackResp.Body.Close()
	if ackResp.StatusCode != http.StatusOK {
		t.Fatalf("POST acknowledged status = %d, want %d", ackResp.StatusCode, http.StatusOK)
	}

	completeResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeResp.Body.Close()
	if completeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST completed continue status = %d, want %d", completeResp.StatusCode, http.StatusOK)
	}

	var completePayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, completeResp, &completePayload)
	if completePayload.Handoff.Status != "completed" {
		t.Fatalf("complete handoff = %#v, want completed", completePayload.Handoff)
	}
	if len(completePayload.State.Mailbox) < 2 {
		t.Fatalf("mailbox = %#v, want followup handoff created", completePayload.State.Mailbox)
	}

	followup := completePayload.State.Mailbox[0]
	if followup.ID == handoff.ID ||
		followup.Status != "requested" ||
		followup.FromAgent != "Claude Review Runner" ||
		followup.ToAgent != "Memory Clerk" {
		t.Fatalf("followup handoff = %#v, want reviewer -> Memory Clerk followup", followup)
	}
	if completePayload.State.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "active" ||
		completePayload.State.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HandoffID != followup.ID {
		t.Fatalf("governance suggestion = %#v, want active followup pointer", completePayload.State.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
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

func doMailboxRouteRequest(t *testing.T, url string, payload any) *http.Response {
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

func mustPatchGovernedQATopology(t *testing.T, serverURL string) {
	t.Helper()

	req, err := http.NewRequest(http.MethodPatch, serverURL+"/v1/workspace", bytes.NewReader([]byte(`{
		"governance":{
			"teamTopology":[
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)))
	if err != nil {
		t.Fatalf("new PATCH /v1/workspace request error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
}
