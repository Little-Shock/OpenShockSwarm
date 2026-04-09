package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"openshock/backend/internal/store"
)

func bindAPITestWorkspaceRepo(t *testing.T, s *store.MemoryStore) string {
	t.Helper()

	repoPath := "/tmp/openshock-demo-repo"
	if err := s.BindWorkspaceRepo("ws_01", repoPath, "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	return repoPath
}

func requestAPITestMerge(t *testing.T, api *API, taskID, idempotencyKey string) {
	t.Helper()

	body := []byte(`{"actorType":"agent","actorId":"agent_shell","actionType":"GitIntegration.merge.request","targetType":"task","targetId":"` + taskID + `","idempotencyKey":"` + idempotencyKey + `","payload":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected merge request to succeed, got %d with body %s", rec.Code, rec.Body.String())
	}
}

func TestBootstrapHandler(t *testing.T) {
	api := New(store.NewMemoryStore())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload["defaultIssueId"] != "issue_101" {
		t.Fatalf("expected defaultIssueId issue_101, got %#v", payload["defaultIssueId"])
	}
	if payload["defaultRoomId"] != "room_001" {
		t.Fatalf("expected defaultRoomId room_001, got %#v", payload["defaultRoomId"])
	}
}

func TestActionEndpointCreatesMessage(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"agent","actorId":"agent_lead","actionType":"RoomMessage.post","targetType":"issue","targetId":"issue_101","idempotencyKey":"message-1","payload":{"body":"Need owner input on the guard branch."}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload["status"] != "completed" {
		t.Fatalf("expected completed status, got %#v", payload["status"])
	}
}

func TestActionEndpointCreatesDiscussionRoom(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"Room.create","targetType":"workspace","targetId":"ws_01","idempotencyKey":"room-create-1","payload":{"kind":"discussion","title":"Architecture","summary":"Cross-cutting design discussion."}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		ResultCode       string `json:"resultCode"`
		AffectedEntities []struct {
			Type string `json:"type"`
			ID   string `json:"id"`
		} `json:"affectedEntities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.ResultCode != "room_created" {
		t.Fatalf("expected room_created result code, got %#v", payload.ResultCode)
	}
	if len(payload.AffectedEntities) != 1 || payload.AffectedEntities[0].Type != "room" {
		t.Fatalf("expected created room entity, got %#v", payload.AffectedEntities)
	}

	detail, err := api.store.RoomDetail(payload.AffectedEntities[0].ID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if detail.Room.Kind != "discussion" || detail.Issue != nil {
		t.Fatalf("expected discussion room detail, got room=%#v issue=%#v", detail.Room, detail.Issue)
	}
}

func TestActionEndpointCreatesAgentTurnFromMention(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-1","payload":{"body":"@agent_shell please prepare a plan"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
}

func TestActionEndpointRejectsIssueRepoBinding(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"Issue.bind_repo","targetType":"issue","targetId":"issue_101","idempotencyKey":"issue-bind-repo-removed-api","payload":{"repoPath":"/tmp/openshock-demo-repo"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d with body %s", rec.Code, rec.Body.String())
	}
}

func TestActionEndpointCreatesAgentTurnFromInstructionKind(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-2","payload":{"kind":"instruction","body":"@agent_shell please prepare a plan"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if lastMessage.Kind != "instruction" {
		t.Fatalf("expected message kind to remain instruction, got %#v", lastMessage)
	}
}

func TestActionEndpointCreatesAgentTurnFromPlainHumanMessageWithoutMention(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-1","payload":{"body":"有人吗？我想确认一下这里下一步怎么推进。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected visible message turn for agent_guardian, got %#v", detail.AgentTurns[0])
	}
}

func TestActionEndpointCreatesVisibleMessageTurnForNeutralPlainMessage(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-2","payload":{"body":"我刚把文档同步好了。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one agent turn for neutral plain message, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected visible message turn for neutral plain message, got %#v", detail.AgentTurns[0])
	}
}

func TestActionEndpointCreatesVisibleMessageTurnFromInstructionWithoutMention(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-2","payload":{"kind":"instruction","body":"有人在看这个房间吗？"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected visible message turn for ordinary instruction, got %#v", detail.AgentTurns[0])
	}
}

func TestActionEndpointAgentPlainMessageDoesNotCreateVisibleMessageTurn(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"actorType":"agent","actorId":"agent_shell","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-3","payload":{"body":"我先同步一下当前进度。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 0 {
		t.Fatalf("expected no queued agent turn for agent-authored plain message, got %#v", detail.AgentTurns)
	}
}

func TestIssueDetailReturns404(t *testing.T) {
	api := New(store.NewMemoryStore())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/issue_missing", nil)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestRoomDetailReturnsDiscussionRoom(t *testing.T) {
	api := New(store.NewMemoryStore())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/room_002", nil)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Room struct {
			ID    string `json:"id"`
			Kind  string `json:"kind"`
			Title string `json:"title"`
		} `json:"room"`
		Tasks []any `json:"tasks"`
		Issue any   `json:"issue"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Room.Kind != "discussion" || payload.Room.Title != "Roadmap" {
		t.Fatalf("unexpected room payload: %#v", payload.Room)
	}
	if payload.Issue != nil {
		t.Fatalf("expected no issue payload for discussion room, got %#v", payload.Issue)
	}
	if len(payload.Tasks) != 0 {
		t.Fatalf("expected no tasks for discussion room, got %#v", payload.Tasks)
	}
}

func TestRegisterRuntimeEndpoint(t *testing.T) {
	api := New(store.NewMemoryStore())
	body := []byte(`{"name":"Daemon Runner","provider":"codex","slotCount":2}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runtimes/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Runtime struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Status   string `json:"status"`
			Provider string `json:"provider"`
		} `json:"runtime"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Runtime.Name != "Daemon Runner" {
		t.Fatalf("expected registered runtime name, got %#v", payload.Runtime.Name)
	}
}

func TestClaimRunEndpoint(t *testing.T) {
	backingStore := store.NewMemoryStore()
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	body := []byte(`{"runtimeId":"rt_local"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Claimed bool `json:"claimed"`
		Run     *struct {
			ID         string `json:"id"`
			Status     string `json:"status"`
			RuntimeID  string `json:"runtimeId"`
			BranchName string `json:"branchName"`
			BaseBranch string `json:"baseBranch"`
		} `json:"run"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if !payload.Claimed || payload.Run == nil {
		t.Fatalf("expected a claimed run, got %#v", payload)
	}
	if payload.Run.Status != "running" {
		t.Fatalf("expected running status after claim, got %q", payload.Run.Status)
	}
	if payload.Run.RuntimeID != "rt_local" {
		t.Fatalf("expected runtime id to be assigned, got %q", payload.Run.RuntimeID)
	}
	if payload.Run.BranchName == "" || payload.Run.BaseBranch == "" {
		t.Fatalf("expected run claim to include branch metadata, got %#v", payload.Run)
	}
}

func TestRunEventEndpointUpdatesRun(t *testing.T) {
	backingStore := store.NewMemoryStore()
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/runs/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	body := []byte(`{"runtimeId":"rt_local","eventType":"completed","outputPreview":"Guard patch applied cleanly."}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/run_guard_01/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		RunID  string `json:"runId"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Status != "completed" {
		t.Fatalf("expected completed status, got %q", payload.Status)
	}
}

func TestRunToolCallEventEndpointUpdatesRun(t *testing.T) {
	backingStore := store.NewMemoryStore()
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/runs/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	body := []byte(`{"runtimeId":"rt_local","eventType":"tool_call","toolCall":{"toolName":"openshock","arguments":"{\"command\":\"task create\"}","status":"completed"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/run_review_01/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	found := false
	for _, toolCall := range detail.ToolCalls {
		if toolCall.RunID == "run_review_01" && toolCall.ToolName == "openshock" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected tool call to be recorded, got %#v", detail.ToolCalls)
	}
}

func TestClaimMergeEndpoint(t *testing.T) {
	backingStore := store.NewMemoryStore()
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	requestAPITestMerge(t, api, "task_guard", "merge-request-claim")
	mergeBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_guard","idempotencyKey":"merge-approve-claim","payload":{}}`)
	mergeReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(mergeBody))
	mergeReq.Header.Set("Content-Type", "application/json")
	mergeRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(mergeRec, mergeReq)

	body := []byte(`{"runtimeId":"rt_local"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/merges/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Claimed      bool `json:"claimed"`
		MergeAttempt *struct {
			ID           string `json:"id"`
			Status       string `json:"status"`
			SourceBranch string `json:"sourceBranch"`
			TargetBranch string `json:"targetBranch"`
		} `json:"mergeAttempt"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if !payload.Claimed || payload.MergeAttempt == nil {
		t.Fatalf("expected a claimed merge attempt, got %#v", payload)
	}
	if payload.MergeAttempt.SourceBranch == "" || payload.MergeAttempt.TargetBranch == "" {
		t.Fatalf("expected merge claim to include branch metadata, got %#v", payload.MergeAttempt)
	}
}

func TestClaimAgentTurnEndpoint(t *testing.T) {
	api := New(store.NewMemoryStore())

	messageBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"turn-claim-1","payload":{"body":"@agent_shell please prepare a plan"}}`)
	messageReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(messageBody))
	messageReq.Header.Set("Content-Type", "application/json")
	messageRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(messageRec, messageReq)

	body := []byte(`{"runtimeId":"rt_local"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent-turns/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Claimed   bool `json:"claimed"`
		AgentTurn *struct {
			Session struct {
				ID               string `json:"id"`
				ProviderThreadID string `json:"providerThreadId"`
			} `json:"session"`
			Turn struct {
				ID         string `json:"id"`
				AgentID    string `json:"agentId"`
				WakeupMode string `json:"wakeupMode"`
				Status     string `json:"status"`
				EventFrame struct {
					CurrentTarget   string `json:"currentTarget"`
					SourceMessageID string `json:"sourceMessageId"`
					RequestedBy     string `json:"requestedBy"`
				} `json:"eventFrame"`
			} `json:"turn"`
		} `json:"agentTurn"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if !payload.Claimed || payload.AgentTurn == nil || payload.AgentTurn.Turn.AgentID != "agent_shell" {
		t.Fatalf("unexpected agent turn claim payload: %#v", payload)
	}
	if payload.AgentTurn.Session.ProviderThreadID == "" {
		t.Fatalf("expected claimed agent turn to expose provider thread id, got %#v", payload.AgentTurn.Session)
	}
	if payload.AgentTurn.Turn.EventFrame.CurrentTarget == "" || payload.AgentTurn.Turn.EventFrame.SourceMessageID == "" {
		t.Fatalf("expected claimed agent turn to expose event frame, got %#v", payload.AgentTurn.Turn.EventFrame)
	}
	if payload.AgentTurn.Turn.EventFrame.RequestedBy != "Sarah" {
		t.Fatalf("expected event frame requester Sarah, got %#v", payload.AgentTurn.Turn.EventFrame)
	}
	if payload.AgentTurn.Turn.WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", payload.AgentTurn.Turn)
	}
}

func TestIssueDetailEndpointIncludesAgentObservability(t *testing.T) {
	api := New(store.NewMemoryStore())

	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"issue","targetId":"issue_101","idempotencyKey":"issue-observability-1","payload":{"body":"@agent_shell please review the issue and reply"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	api.Handler().ServeHTTP(rec, req)

	detailReq := httptest.NewRequest(http.MethodGet, "/api/v1/issues/issue_101", nil)
	detailRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(detailRec, detailReq)

	if detailRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", detailRec.Code, detailRec.Body.String())
	}

	var payload struct {
		AgentSessions []struct {
			ProviderThreadID string `json:"providerThreadId"`
		} `json:"agentSessions"`
		AgentTurns []struct {
			WakeupMode string `json:"wakeupMode"`
			EventFrame struct {
				RelatedIssueID string `json:"relatedIssueId"`
				ExpectedAction string `json:"expectedAction"`
			} `json:"eventFrame"`
		} `json:"agentTurns"`
	}
	if err := json.Unmarshal(detailRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if len(payload.AgentSessions) != 1 || payload.AgentSessions[0].ProviderThreadID == "" {
		t.Fatalf("expected issue detail agent session observability, got %#v", payload.AgentSessions)
	}
	if len(payload.AgentTurns) != 1 || payload.AgentTurns[0].EventFrame.RelatedIssueID != "issue_101" {
		t.Fatalf("expected issue detail event frame observability, got %#v", payload.AgentTurns)
	}
	if payload.AgentTurns[0].EventFrame.ExpectedAction != "visible_message_response" {
		t.Fatalf("expected event frame expected action to match turn intent, got %#v", payload.AgentTurns[0].EventFrame)
	}
	if payload.AgentTurns[0].WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", payload.AgentTurns[0])
	}
}

func TestMergeEventEndpointUpdatesAttempt(t *testing.T) {
	backingStore := store.NewMemoryStore()
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	requestAPITestMerge(t, api, "task_guard", "merge-request-event")
	mergeBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_guard","idempotencyKey":"merge-approve-event","payload":{}}`)
	mergeReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(mergeBody))
	mergeReq.Header.Set("Content-Type", "application/json")
	mergeRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(mergeRec, mergeReq)

	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/merges/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	body := []byte(`{"runtimeId":"rt_local","eventType":"succeeded","resultSummary":"merged cleanly"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/merges/merge_101/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		MergeAttemptID string `json:"mergeAttemptId"`
		Status         string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Status != "succeeded" {
		t.Fatalf("expected succeeded status, got %q", payload.Status)
	}
}

func TestRepoWebhookEndpointUpdatesDeliveryPR(t *testing.T) {
	backingStore := store.NewMemoryStore()
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)

	requestAPITestMerge(t, api, "task_guard", "repo-webhook-request-1")
	requestAPITestMerge(t, api, "task_review", "repo-webhook-request-2")
	for _, body := range [][]byte{
		[]byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_guard","idempotencyKey":"repo-webhook-merge-1","payload":{}}`),
		[]byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_review","idempotencyKey":"repo-webhook-merge-2","payload":{}}`),
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		api.Handler().ServeHTTP(rec, req)
	}

	storeRef := api.store
	attemptA, claimed, err := storeRef.ClaimNextQueuedMerge("rt_local")
	if err != nil || !claimed {
		t.Fatalf("failed to claim first merge attempt: %v %#v", err, attemptA)
	}
	if _, err := storeRef.IngestMergeEvent(attemptA.ID, "rt_local", "succeeded", "merged task guard"); err != nil {
		t.Fatalf("failed to ingest first merge event: %v", err)
	}
	attemptB, claimed, err := storeRef.ClaimNextQueuedMerge("rt_local")
	if err != nil || !claimed {
		t.Fatalf("failed to claim second merge attempt: %v %#v", err, attemptB)
	}
	if _, err := storeRef.IngestMergeEvent(attemptB.ID, "rt_local", "succeeded", "merged task review"); err != nil {
		t.Fatalf("failed to ingest second merge event: %v", err)
	}
	if _, err := storeRef.CreateDeliveryPR("issue_101", "Sarah"); err != nil {
		t.Fatalf("failed to create delivery pr: %v", err)
	}

	body := []byte(`{"eventId":"evt_repo_101","provider":"github","externalPrId":"gh_pr_102","status":"merged"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/repo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		DeliveryPRID string `json:"deliveryPrId"`
		Status       string `json:"status"`
		Replayed     bool   `json:"replayed"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Status != "merged" || payload.Replayed {
		t.Fatalf("unexpected repo webhook response: %#v", payload)
	}
}
