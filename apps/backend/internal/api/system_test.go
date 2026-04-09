package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"openshock/backend/internal/core"
	"openshock/backend/internal/store"
)

func TestFirstRoundWorkflowE2E(t *testing.T) {
	backingStore := store.NewMemoryStore()
	if err := backingStore.BindWorkspaceRepo("ws_01", "/tmp/openshock-demo-repo", "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	client := server.Client()

	createIssue := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Issue.create",
		TargetType:     "workspace",
		TargetID:       "ws_01",
		IdempotencyKey: "e2e-issue-create",
		Payload: map[string]any{
			"title":    "Close the first executable loop",
			"summary":  "Prove issue creation, tasking, execution, human intervention, and integration updates.",
			"priority": "urgent",
		},
	})
	issueID := createIssue.AffectedEntities[0].ID

	taskA := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Task.create",
		TargetType:     "issue",
		TargetID:       issueID,
		IdempotencyKey: "e2e-task-a",
		Payload: map[string]any{
			"title":           "Build the happy-path patch",
			"description":     "One agent should carry the task through a full run.",
			"assigneeAgentId": "agent_systems",
		},
	})
	taskAID := taskA.AffectedEntities[0].ID

	taskB := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Task.create",
		TargetType:     "issue",
		TargetID:       issueID,
		IdempotencyKey: "e2e-task-b",
		Payload: map[string]any{
			"title":           "Exercise the human-approval path",
			"description":     "This task should stop for approval once before completing.",
			"assigneeAgentId": "agent_guardian",
		},
	})
	taskBID := taskB.AffectedEntities[0].ID

	runA := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Run.create",
		TargetType:     "task",
		TargetID:       taskAID,
		IdempotencyKey: "e2e-run-a",
		Payload:        map[string]any{},
	})
	runAID := runA.AffectedEntities[0].ID

	runB := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Run.create",
		TargetType:     "task",
		TargetID:       taskBID,
		IdempotencyKey: "e2e-run-b",
		Payload:        map[string]any{},
	})
	runBID := runB.AffectedEntities[0].ID

	runtimeResp := registerRuntime(t, client, server.URL, core.RegisterRuntimeRequest{
		Name:      "E2E Runtime",
		Provider:  "codex",
		SlotCount: 2,
	})

	claimA := claimSpecificRun(t, client, server.URL, runtimeResp.Runtime.ID, runAID)

	postRunEvent(t, client, server.URL, claimA.Run.ID, core.RunEventRequest{
		RuntimeID:     runtimeResp.Runtime.ID,
		EventType:     "started",
		OutputPreview: "started happy path run",
	})
	postRunEvent(t, client, server.URL, claimA.Run.ID, core.RunEventRequest{
		RuntimeID:     runtimeResp.Runtime.ID,
		EventType:     "completed",
		OutputPreview: "completed happy path run",
	})

	claimB := claimSpecificRun(t, client, server.URL, runtimeResp.Runtime.ID, runBID)

	postRunEvent(t, client, server.URL, claimB.Run.ID, core.RunEventRequest{
		RuntimeID:     runtimeResp.Runtime.ID,
		EventType:     "approval_required",
		OutputPreview: "touches guarded code paths",
	})

	detail := getIssue(t, client, server.URL, issueID)
	if countRunStatus(detail.Runs, "approval_required") != 1 {
		t.Fatalf("expected one run awaiting approval, got %#v", detail.Runs)
	}

	submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Run.approve",
		TargetType:     "run",
		TargetID:       runBID,
		IdempotencyKey: "e2e-run-approve",
		Payload:        map[string]any{},
	})

	claimApproved := claimSpecificRun(t, client, server.URL, runtimeResp.Runtime.ID, runBID)
	postRunEvent(t, client, server.URL, claimApproved.Run.ID, core.RunEventRequest{
		RuntimeID:     runtimeResp.Runtime.ID,
		EventType:     "completed",
		OutputPreview: "completed after human approval",
	})

	respA := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Task.mark_ready_for_integration",
		TargetType:     "task",
		TargetID:       taskAID,
		IdempotencyKey: "e2e-integrate-task-a",
		Payload:        map[string]any{},
	})
	if respA.ResultCode != "task_ready_for_integration" {
		t.Fatalf("expected task_ready_for_integration for task A, got %#v", respA)
	}
	respB := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Task.mark_ready_for_integration",
		TargetType:     "task",
		TargetID:       taskBID,
		IdempotencyKey: "e2e-integrate-task-b",
		Payload:        map[string]any{},
	})
	if respB.ResultCode != "task_ready_for_integration" {
		t.Fatalf("expected task_ready_for_integration for task B, got %#v", respB)
	}
	submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "GitIntegration.merge.approve",
		TargetType:     "task",
		TargetID:       taskAID,
		IdempotencyKey: "e2e-merge-approve-task-a",
		Payload:        map[string]any{},
	})
	submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "GitIntegration.merge.approve",
		TargetType:     "task",
		TargetID:       taskBID,
		IdempotencyKey: "e2e-merge-approve-task-b",
		Payload:        map[string]any{},
	})
	claimMergeAndSucceed(t, client, server.URL, runtimeResp.Runtime.ID, taskAID)
	claimMergeAndSucceed(t, client, server.URL, runtimeResp.Runtime.ID, taskBID)
	submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "DeliveryPR.create.request",
		TargetType:     "issue",
		TargetID:       issueID,
		IdempotencyKey: "e2e-delivery-pr",
		Payload:        map[string]any{},
	})
	postRepoWebhook(t, client, server.URL, core.RepoWebhookRequest{
		EventID:      "e2e-delivery-webhook",
		Provider:     "github",
		ExternalPRID: "gh_pr_102",
		Status:       "merged",
	})

	finalDetail := getIssue(t, client, server.URL, issueID)
	if countRunStatus(finalDetail.Runs, "completed") != 2 {
		t.Fatalf("expected both runs to complete, got %#v", finalDetail.Runs)
	}
	if !containsTask(finalDetail.Tasks, taskAID, "integrated") {
		t.Fatalf("expected task %s to be integrated, got %#v", taskAID, finalDetail.Tasks)
	}
	if !containsMergedTask(finalDetail.IntegrationBranch.MergedTaskIDs, taskAID) {
		t.Fatalf("expected integration branch to include task %s, got %#v", taskAID, finalDetail.IntegrationBranch.MergedTaskIDs)
	}
	if !containsMergedTask(finalDetail.IntegrationBranch.MergedTaskIDs, taskBID) {
		t.Fatalf("expected integration branch to include task %s, got %#v", taskBID, finalDetail.IntegrationBranch.MergedTaskIDs)
	}
	if finalDetail.IntegrationBranch.Status != "merged_to_main" {
		t.Fatalf("expected integration branch to become merged_to_main, got %q", finalDetail.IntegrationBranch.Status)
	}
	if finalDetail.DeliveryPR == nil || finalDetail.DeliveryPR.Status != "merged" {
		t.Fatalf("expected merged delivery PR, got %#v", finalDetail.DeliveryPR)
	}
	if finalDetail.Issue.Status != "done" {
		t.Fatalf("expected issue to move into done, got %q", finalDetail.Issue.Status)
	}
	if hasInboxItemForRun(getInbox(t, client, server.URL).Items, runBID) {
		t.Fatal("expected approval inbox item to be cleared after human approval")
	}
}

func TestTaskStatusSetActionUpdatesIssueDetail(t *testing.T) {
	server := httptest.NewServer(New(store.NewMemoryStore()).Handler())
	defer server.Close()

	client := server.Client()

	resp := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Task.status.set",
		TargetType:     "task",
		TargetID:       "task_guard",
		IdempotencyKey: "task-status-set-system",
		Payload: map[string]any{
			"status": "blocked",
		},
	})
	if resp.ResultCode != "task_status_updated" {
		t.Fatalf("expected task_status_updated result code, got %#v", resp)
	}

	detail := getIssue(t, client, server.URL, "issue_101")
	if !containsTask(detail.Tasks, "task_guard", "blocked") {
		t.Fatalf("expected task_guard to be blocked, got %#v", detail.Tasks)
	}
}

func TestRoomCreateActionCreatesDiscussionRoom(t *testing.T) {
	server := httptest.NewServer(New(store.NewMemoryStore()).Handler())
	defer server.Close()

	client := server.Client()

	resp := submitAction(t, client, server.URL, core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Room.create",
		TargetType:     "workspace",
		TargetID:       "ws_01",
		IdempotencyKey: "system-room-create",
		Payload: map[string]any{
			"kind":    "discussion",
			"title":   "Architecture",
			"summary": "Use this room for cross-cutting architecture discussion.",
		},
	})
	if resp.ResultCode != "room_created" {
		t.Fatalf("expected room_created result code, got %#v", resp)
	}

	roomID := resp.AffectedEntities[0].ID
	room := getRoom(t, client, server.URL, roomID)
	if room.Room.Kind != "discussion" {
		t.Fatalf("expected discussion room, got %#v", room.Room)
	}
	if room.Issue != nil || len(room.Tasks) != 0 || len(room.Runs) != 0 {
		t.Fatalf("expected chat-only discussion room detail, got %#v", room)
	}
}

func submitAction(t *testing.T, client *http.Client, baseURL string, req core.ActionRequest) core.ActionResponse {
	t.Helper()

	var resp core.ActionResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/actions", req, &resp)
	return resp
}

func registerRuntime(t *testing.T, client *http.Client, baseURL string, req core.RegisterRuntimeRequest) core.RegisterRuntimeResponse {
	t.Helper()

	var resp core.RegisterRuntimeResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/runtimes/register", req, &resp)
	return resp
}

func claimRun(t *testing.T, client *http.Client, baseURL, runtimeID string) core.RunClaimResponse {
	t.Helper()

	var resp core.RunClaimResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/runs/claim", core.RunClaimRequest{RuntimeID: runtimeID}, &resp)
	return resp
}

func claimSpecificRun(t *testing.T, client *http.Client, baseURL, runtimeID, wantedRunID string) core.RunClaimResponse {
	t.Helper()

	for attempt := 0; attempt < 6; attempt++ {
		claim := claimRun(t, client, baseURL, runtimeID)
		if !claim.Claimed || claim.Run == nil {
			t.Fatalf("expected a queued run while waiting for %s, got %#v", wantedRunID, claim)
		}
		if claim.Run.ID == wantedRunID {
			return claim
		}

		postRunEvent(t, client, baseURL, claim.Run.ID, core.RunEventRequest{
			RuntimeID:     runtimeID,
			EventType:     "completed",
			OutputPreview: "cleared seed run during e2e setup",
		})
	}

	t.Fatalf("failed to claim target run %s after draining unrelated queued work", wantedRunID)
	return core.RunClaimResponse{}
}

func postRunEvent(t *testing.T, client *http.Client, baseURL, runID string, req core.RunEventRequest) core.RunEventResponse {
	t.Helper()

	var resp core.RunEventResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/runs/"+runID+"/events", req, &resp)
	return resp
}

func claimMerge(t *testing.T, client *http.Client, baseURL, runtimeID string) core.MergeClaimResponse {
	t.Helper()

	var resp core.MergeClaimResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/merges/claim", core.MergeClaimRequest{RuntimeID: runtimeID}, &resp)
	return resp
}

func claimMergeAndSucceed(t *testing.T, client *http.Client, baseURL, runtimeID, wantedTaskID string) {
	t.Helper()

	for attempt := 0; attempt < 6; attempt++ {
		claim := claimMerge(t, client, baseURL, runtimeID)
		if !claim.Claimed || claim.MergeAttempt == nil {
			t.Fatalf("expected a queued merge while waiting for task %s, got %#v", wantedTaskID, claim)
		}

		postMergeEvent(t, client, baseURL, claim.MergeAttempt.ID, core.MergeEventRequest{
			RuntimeID:     runtimeID,
			EventType:     "started",
			ResultSummary: "started merge execution",
		})
		if claim.MergeAttempt.TaskID == wantedTaskID {
			postMergeEvent(t, client, baseURL, claim.MergeAttempt.ID, core.MergeEventRequest{
				RuntimeID:     runtimeID,
				EventType:     "succeeded",
				ResultSummary: "completed merge execution",
			})
			return
		}

		postMergeEvent(t, client, baseURL, claim.MergeAttempt.ID, core.MergeEventRequest{
			RuntimeID:     runtimeID,
			EventType:     "succeeded",
			ResultSummary: "cleared unrelated merge during e2e setup",
		})
	}

	t.Fatalf("failed to claim target merge for task %s after draining unrelated work", wantedTaskID)
}

func postMergeEvent(t *testing.T, client *http.Client, baseURL, mergeAttemptID string, req core.MergeEventRequest) core.MergeEventResponse {
	t.Helper()

	var resp core.MergeEventResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/merges/"+mergeAttemptID+"/events", req, &resp)
	return resp
}

func postRepoWebhook(t *testing.T, client *http.Client, baseURL string, req core.RepoWebhookRequest) core.RepoWebhookResponse {
	t.Helper()

	var resp core.RepoWebhookResponse
	doJSON(t, client, http.MethodPost, baseURL+"/api/v1/webhooks/repo", req, &resp)
	return resp
}

func getIssue(t *testing.T, client *http.Client, baseURL, issueID string) core.IssueDetailResponse {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/issues/"+issueID, nil)
	if err != nil {
		t.Fatalf("failed to build issue request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("issue request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from issue detail, got %d", resp.StatusCode)
	}

	var detail core.IssueDetailResponse
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatalf("failed to decode issue detail: %v", err)
	}
	return detail
}

func getRoom(t *testing.T, client *http.Client, baseURL, roomID string) core.RoomDetailResponse {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/rooms/"+roomID, nil)
	if err != nil {
		t.Fatalf("failed to build room request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("room request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from room detail, got %d", resp.StatusCode)
	}

	var detail core.RoomDetailResponse
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatalf("failed to decode room detail: %v", err)
	}
	return detail
}

func getInbox(t *testing.T, client *http.Client, baseURL string) core.InboxResponse {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/v1/inbox", nil)
	if err != nil {
		t.Fatalf("failed to build inbox request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("inbox request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from inbox, got %d", resp.StatusCode)
	}

	var inbox core.InboxResponse
	if err := json.NewDecoder(resp.Body).Decode(&inbox); err != nil {
		t.Fatalf("failed to decode inbox: %v", err)
	}
	return inbox
}

func doJSON(t *testing.T, client *http.Client, method, url string, payload any, out any) {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to encode payload: %v", err)
	}

	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 from %s, got %d", url, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
}

func countRunStatus(runs []core.Run, status string) int {
	count := 0
	for _, run := range runs {
		if run.Status == status {
			count++
		}
	}
	return count
}

func containsTask(tasks []core.Task, taskID, status string) bool {
	for _, task := range tasks {
		if task.ID == taskID && task.Status == status {
			return true
		}
	}
	return false
}

func containsMergedTask(taskIDs []string, taskID string) bool {
	for _, candidate := range taskIDs {
		if candidate == taskID {
			return true
		}
	}
	return false
}

func hasInboxItemForRun(items []core.InboxItem, runID string) bool {
	for _, item := range items {
		if item.RelatedEntityType == "run" && item.RelatedEntityID == runID {
			return true
		}
	}
	return false
}
