package actions

import (
	"testing"

	"openshock/backend/internal/core"
	"openshock/backend/internal/store"
	"openshock/backend/internal/testsupport/scenario"
)

func bindGatewayWorkspaceRepo(t *testing.T, s *store.MemoryStore) string {
	t.Helper()

	repoPath := "/tmp/openshock-demo-repo"
	if err := s.BindWorkspaceRepo("ws_01", repoPath, "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	return repoPath
}

func mustCreateGatewayTestAgent(t *testing.T, s *store.MemoryStore, agentID string) {
	t.Helper()

	name := agentID
	if agentID == "agent_shell" {
		name = "Shell_Runner"
	}
	if _, err := s.CreateAgentWithID(agentID, name, "test fixture prompt"); err != nil {
		t.Fatalf("create test agent returned error: %v", err)
	}
}

func TestSubmitCreatesTask(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "agent",
		ActorID:        "agent_lead",
		ActionType:     "Task.create",
		TargetType:     "issue",
		TargetID:       "issue_101",
		IdempotencyKey: "task-create-1",
		Payload: map[string]any{
			"title":           "Write regression test for observer leak",
			"description":     "Add a focused test for stale frame retention.",
			"assigneeAgentId": "agent_systems",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.Status != "completed" {
		t.Fatalf("expected completed status, got %q", resp.Status)
	}
	if len(resp.AffectedEntities) == 0 || resp.AffectedEntities[0].Type != "task" {
		t.Fatalf("expected task entity in response, got %#v", resp.AffectedEntities)
	}
}

func TestSubmitCreatesIssue(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Issue.create",
		TargetType:     "workspace",
		TargetID:       "ws_01",
		IdempotencyKey: "issue-create-1",
		Payload: map[string]any{
			"title":    "Harden claim retry path",
			"summary":  "Retries currently duplicate work under reconnect.",
			"priority": "high",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "issue_created" {
		t.Fatalf("expected issue_created result code, got %q", resp.ResultCode)
	}
}

func TestSubmitCreatesDiscussionRoom(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Room.create",
		TargetType:     "workspace",
		TargetID:       "ws_01",
		IdempotencyKey: "room-create-1",
		Payload: map[string]any{
			"kind":    "discussion",
			"title":   "Architecture",
			"summary": "Cross-cutting design discussion.",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "room_created" {
		t.Fatalf("expected room_created result code, got %q", resp.ResultCode)
	}
	if len(resp.AffectedEntities) == 0 || resp.AffectedEntities[0].Type != "room" {
		t.Fatalf("expected room entity in response, got %#v", resp.AffectedEntities)
	}
}

func TestSubmitAddsAgentToRoom(t *testing.T) {
	s := store.NewMemoryStore()
	mustCreateGatewayTestAgent(t, s, "agent_shell")
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "RoomAgent.add",
		TargetType:     "room",
		TargetID:       "room_001",
		IdempotencyKey: "room-agent-add-1",
		Payload: map[string]any{
			"agentId": "agent_shell",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "room_agent_already_joined" {
		t.Fatalf("expected room_agent_already_joined result code, got %q", resp.ResultCode)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].AgentID != "agent_shell" {
		t.Fatalf("expected joined agent session, got %#v", detail.AgentSessions)
	}
}

func TestSubmitRemovesAgentFromRoom(t *testing.T) {
	s := store.NewMemoryStore()
	mustCreateGatewayTestAgent(t, s, "agent_shell")
	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add agent to room returned error: %v", err)
	}
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "RoomAgent.remove",
		TargetType:     "room",
		TargetID:       "room_001",
		IdempotencyKey: "room-agent-remove-1",
		Payload: map[string]any{
			"agentId": "agent_shell",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "room_agent_removed" {
		t.Fatalf("expected room_agent_removed result code, got %q", resp.ResultCode)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].JoinedRoom {
		t.Fatalf("expected room session to remain but leave joined state, got %#v", detail.AgentSessions)
	}
}

func TestSubmitBindsWorkspaceRepo(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Workspace.bind_repo",
		TargetType:     "workspace",
		TargetID:       "ws_01",
		IdempotencyKey: "workspace-bind-repo-1",
		Payload: map[string]any{
			"repoPath": "/tmp/openshock-demo-repo",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "workspace_repo_bound" {
		t.Fatalf("expected workspace_repo_bound result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if detail.Issue.RepoPath != "/tmp/openshock-demo-repo" {
		t.Fatalf("expected repo path to be bound, got %#v", detail.Issue)
	}
	if detail.Workspace.DefaultRepoBindingID == "" || len(detail.Workspace.RepoBindings) != 1 {
		t.Fatalf("expected workspace repo binding to be present, got %#v", detail.Workspace)
	}
}

func TestSubmitRejectsIssueRepoBinding(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	_, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Issue.bind_repo",
		TargetType:     "issue",
		TargetID:       "issue_101",
		IdempotencyKey: "issue-bind-repo-removed-1",
		Payload: map[string]any{
			"repoPath": "/tmp/openshock-demo-repo",
		},
	})
	if err == nil {
		t.Fatal("expected Issue.bind_repo to be rejected")
	}
}

func TestSubmitSetsTaskStatus(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "Task.status.set",
		TargetType:     "task",
		TargetID:       "task_guard",
		IdempotencyKey: "task-status-set-1",
		Payload: map[string]any{
			"status": "blocked",
		},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "task_status_updated" {
		t.Fatalf("expected task_status_updated result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	found := false
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "blocked" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected task_guard status to update, got %#v", detail.Tasks)
	}
}

func TestSubmitMergeRequestRequiresApproval(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "agent",
		ActorID:        "agent_guardian",
		ActionType:     "GitIntegration.merge.request",
		TargetType:     "task",
		TargetID:       "task_guard",
		IdempotencyKey: "merge-request-1",
		Payload:        map[string]any{},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.Status != "approval_required" {
		t.Fatalf("expected approval_required status, got %q", resp.Status)
	}
}

func TestSubmitUsesIdempotencyKey(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	req := core.ActionRequest{
		ActorType:      "agent",
		ActorID:        "agent_lead",
		ActionType:     "Task.create",
		TargetType:     "issue",
		TargetID:       "issue_101",
		IdempotencyKey: "task-create-idempotent",
		Payload: map[string]any{
			"title":           "Write retry guard",
			"description":     "Prevent double-enqueue on reconnect.",
			"assigneeAgentId": "agent_systems",
		},
	}

	first, err := gateway.Submit(req)
	if err != nil {
		t.Fatalf("first submit returned error: %v", err)
	}
	second, err := gateway.Submit(req)
	if err != nil {
		t.Fatalf("second submit returned error: %v", err)
	}
	if first.ActionID != second.ActionID {
		t.Fatalf("expected action ids to match for idempotent replay, got %q and %q", first.ActionID, second.ActionID)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	count := 0
	for _, task := range detail.Tasks {
		if task.Title == "Write retry guard" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly one created task after replay, got %d", count)
	}
}

func TestSubmitCreatesDeliveryPR(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)
	bindGatewayWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	attemptA, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected task_guard merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attemptA.ID, "rt_local", "succeeded", "merged guard task"); err != nil {
		t.Fatalf("ingest merge returned error: %v", err)
	}

	if _, err := s.RequestMerge("task_review"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_review", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	attemptB, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected task_review merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attemptB.ID, "rt_local", "succeeded", "merged review task"); err != nil {
		t.Fatalf("ingest merge returned error: %v", err)
	}

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "DeliveryPR.create.request",
		TargetType:     "issue",
		TargetID:       "issue_101",
		IdempotencyKey: "delivery-pr-create-1",
		Payload:        map[string]any{},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "delivery_pr_created" {
		t.Fatalf("expected delivery_pr_created result code, got %q", resp.ResultCode)
	}
}

func TestSubmitApprovesMerge(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)
	bindGatewayWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}

	resp, err := gateway.Submit(core.ActionRequest{
		ActorType:      "member",
		ActorID:        "Sarah",
		ActionType:     "GitIntegration.merge.approve",
		TargetType:     "task",
		TargetID:       "task_guard",
		IdempotencyKey: "merge-approve-1",
		Payload:        map[string]any{},
	})
	if err != nil {
		t.Fatalf("submit returned error: %v", err)
	}
	if resp.ResultCode != "merge_attempt_queued" {
		t.Fatalf("expected merge_attempt_queued result code, got %q", resp.ResultCode)
	}
}

func TestSubmitRejectsMissingIdempotencyKey(t *testing.T) {
	s := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	gateway := NewGateway(s)

	_, err := gateway.Submit(core.ActionRequest{
		ActorType:  "agent",
		ActorID:    "agent_lead",
		ActionType: "RoomMessage.post",
		TargetType: "issue",
		TargetID:   "issue_101",
		Payload: map[string]any{
			"body": "Need a human decision here.",
		},
	})
	if err == nil {
		t.Fatal("expected an error for missing idempotency key")
	}
}
