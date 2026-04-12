package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"

	"openshock/backend/internal/core"
	"openshock/backend/internal/store"
	"openshock/backend/internal/testsupport/scenario"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func looksLikeUUID(value string) bool {
	return uuidPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}

func TestAgentCRUDRoutesRequireMemberSession(t *testing.T) {
	server := httptest.NewServer(New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot())).Handler())
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/agents", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAgentCRUDRoutesEndToEnd(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	client := server.Client()
	sessionToken := ensureMemberSessionToken(t, client, server.URL, "Sarah")

	createBody, err := json.Marshal(core.AgentCreateRequest{
		Name:   "research_partner",
		Prompt: "会主动补齐上下文、记录不确定项，并把长信息压缩成便于团队决策的结构化摘要。",
	})
	if err != nil {
		t.Fatalf("failed to encode create payload: %v", err)
	}

	createReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/agents", bytes.NewReader(createBody))
	if err != nil {
		t.Fatalf("failed to build create request: %v", err)
	}
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set("X-OpenShock-Session", sessionToken)

	createResp, err := client.Do(createReq)
	if err != nil {
		t.Fatalf("create request failed: %v", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from create, got %d", createResp.StatusCode)
	}

	var created core.AgentResponse
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode create response: %v", err)
	}
	if !looksLikeUUID(created.Agent.ID) || created.Agent.Name != "research_partner" || created.Agent.Prompt == "" {
		t.Fatalf("unexpected created agent: %#v", created.Agent)
	}

	listReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/agents", nil)
	if err != nil {
		t.Fatalf("failed to build list request: %v", err)
	}
	listReq.Header.Set("X-OpenShock-Session", sessionToken)
	listResp, err := client.Do(listReq)
	if err != nil {
		t.Fatalf("list request failed: %v", err)
	}
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from list, got %d", listResp.StatusCode)
	}

	var listed core.AgentListResponse
	if err := json.NewDecoder(listResp.Body).Decode(&listed); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}
	foundCreated := false
	for _, agent := range listed.Agents {
		if agent.Name == "research_partner" {
			foundCreated = true
			break
		}
	}
	if !foundCreated {
		t.Fatalf("expected created agent in list, got %#v", listed.Agents)
	}

	updateBody, err := json.Marshal(core.AgentUpdateRequest{
		Name:   "research_partner",
		Prompt: "更新后的 agent prompt 应该被完整保留，前端会用多行输入框维护它。",
	})
	if err != nil {
		t.Fatalf("failed to encode update payload: %v", err)
	}

	updateReq, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/agents/"+created.Agent.ID, bytes.NewReader(updateBody))
	if err != nil {
		t.Fatalf("failed to build update request: %v", err)
	}
	updateReq.Header.Set("Content-Type", "application/json")
	updateReq.Header.Set("X-OpenShock-Session", sessionToken)

	updateResp, err := client.Do(updateReq)
	if err != nil {
		t.Fatalf("update request failed: %v", err)
	}
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from update, got %d", updateResp.StatusCode)
	}

	var updated core.AgentResponse
	if err := json.NewDecoder(updateResp.Body).Decode(&updated); err != nil {
		t.Fatalf("failed to decode update response: %v", err)
	}
	if updated.Agent.Prompt == "" {
		t.Fatalf("unexpected updated agent: %#v", updated.Agent)
	}

	renameBody, err := json.Marshal(core.AgentUpdateRequest{
		Name:   "renamed_partner",
		Prompt: "should fail",
	})
	if err != nil {
		t.Fatalf("failed to encode rename payload: %v", err)
	}
	renameReq, err := http.NewRequest(http.MethodPatch, server.URL+"/api/v1/agents/"+created.Agent.ID, bytes.NewReader(renameBody))
	if err != nil {
		t.Fatalf("failed to build rename request: %v", err)
	}
	renameReq.Header.Set("Content-Type", "application/json")
	renameReq.Header.Set("X-OpenShock-Session", sessionToken)
	renameResp, err := client.Do(renameReq)
	if err != nil {
		t.Fatalf("rename request failed: %v", err)
	}
	defer renameResp.Body.Close()
	if renameResp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 from rename attempt, got %d", renameResp.StatusCode)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/agents/"+created.Agent.ID, nil)
	if err != nil {
		t.Fatalf("failed to build delete request: %v", err)
	}
	deleteReq.Header.Set("X-OpenShock-Session", sessionToken)

	deleteResp, err := client.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete request failed: %v", err)
	}
	defer deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from delete, got %d", deleteResp.StatusCode)
	}

	var deleted core.AgentDeleteResponse
	if err := json.NewDecoder(deleteResp.Body).Decode(&deleted); err != nil {
		t.Fatalf("failed to decode delete response: %v", err)
	}
	if !deleted.Deleted || deleted.AgentID != created.Agent.ID {
		t.Fatalf("unexpected delete response: %#v", deleted)
	}

	blockedDeleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/agents/agent_shell", nil)
	if err != nil {
		t.Fatalf("failed to build blocked delete request: %v", err)
	}
	blockedDeleteReq.Header.Set("X-OpenShock-Session", sessionToken)

	blockedDeleteResp, err := client.Do(blockedDeleteReq)
	if err != nil {
		t.Fatalf("blocked delete request failed: %v", err)
	}
	defer blockedDeleteResp.Body.Close()
	if blockedDeleteResp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 from blocked delete, got %d", blockedDeleteResp.StatusCode)
	}
}

func TestGetAgentDetailReturnsWorkspaceWideObservability(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	directRoomID := ""
	for _, room := range backingStore.BootstrapForWorkspace("ws_01").DirectRooms {
		if room.DirectAgentID == "agent_shell" {
			directRoomID = room.ID
			break
		}
	}
	if directRoomID == "" {
		t.Fatal("expected seeded direct room for agent_shell")
	}

	if _, err := backingStore.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell please inspect the workspace discussion follow-up"); err != nil {
		t.Fatalf("post discussion message failed: %v", err)
	}
	if _, err := backingStore.PostRoomMessage(directRoomID, "member", "Sarah", "message", "Can you send me a private status update?"); err != nil {
		t.Fatalf("post direct message failed: %v", err)
	}

	execution, ok, err := backingStore.ClaimNextQueuedAgentTurn("rt_local")
	if err != nil {
		t.Fatalf("claim queued turn failed: %v", err)
	}
	if !ok {
		t.Fatal("expected claimed agent turn")
	}
	if execution.Turn.AgentID != "agent_shell" {
		t.Fatalf("expected claimed turn for agent_shell, got %s", execution.Turn.AgentID)
	}

	if _, err := backingStore.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "output", "status: collecting context", "session", nil); err != nil {
		t.Fatalf("ingest output failed: %v", err)
	}
	if _, err := backingStore.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "tool_call", "", "", &core.ToolCallInput{
		ToolName:  "shell.exec",
		Arguments: "{\"cmd\":\"pwd\"}",
		Status:    "completed",
	}); err != nil {
		t.Fatalf("ingest tool call failed: %v", err)
	}
	if _, err := backingStore.CompleteAgentTurn(execution.Turn.ID, "rt_local", "", "thread_agent_shell", false); err != nil {
		t.Fatalf("complete turn failed: %v", err)
	}

	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	client := server.Client()
	sessionToken := ensureMemberSessionToken(t, client, server.URL, "Sarah")
	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/agents/agent_shell", nil)
	if err != nil {
		t.Fatalf("failed to build detail request: %v", err)
	}
	req.Header.Set("X-OpenShock-Session", sessionToken)

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("detail request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from detail route, got %d", resp.StatusCode)
	}

	var detail core.AgentDetailResponse
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatalf("failed to decode detail response: %v", err)
	}

	if detail.Agent.ID != "agent_shell" {
		t.Fatalf("unexpected agent detail payload: %#v", detail.Agent)
	}
	if len(detail.AgentSessions) < 2 {
		t.Fatalf("expected sessions from multiple rooms, got %#v", detail.AgentSessions)
	}
	if len(detail.AgentTurns) < 2 {
		t.Fatalf("expected turns from multiple rooms, got %#v", detail.AgentTurns)
	}
	if len(detail.AgentTurnOutputChunks) == 0 {
		t.Fatalf("expected output chunks in agent detail, got %#v", detail.AgentTurnOutputChunks)
	}
	if len(detail.AgentTurnToolCalls) == 0 {
		t.Fatalf("expected tool calls in agent detail, got %#v", detail.AgentTurnToolCalls)
	}

	roomIDs := make([]string, 0, len(detail.Rooms))
	for _, room := range detail.Rooms {
		roomIDs = append(roomIDs, room.ID)
	}
	if !slices.Contains(roomIDs, "room_001") {
		t.Fatalf("expected discussion room in agent detail, got %#v", detail.Rooms)
	}
	if !slices.Contains(roomIDs, directRoomID) {
		t.Fatalf("expected direct room in agent detail, got %#v", detail.Rooms)
	}
	if len(detail.Messages) == 0 {
		t.Fatalf("expected trigger messages in agent detail, got %#v", detail.Messages)
	}
}
