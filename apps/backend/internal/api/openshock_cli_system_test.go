package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"openshock/backend/internal/store"
	"openshock/backend/internal/testsupport/scenario"
)

func TestOpenShockCLICreatesTaskAndRoomMessage(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	cliDir := daemonModuleDir(t)

	taskResp := runOpenShockCLI(t, cliDir,
		"task", "create",
		"--api-base-url", server.URL,
		"--issue", "issue_101",
		"--title", "CLI created task",
		"--description", "Created by OpenShock CLI E2E.",
		"--assignee-agent-id", "agent_shell",
		"--actor-id", "agent_shell",
		"--idempotency-key", "cli-task-create-1",
	)
	if taskResp.ResultCode != "task_created" {
		t.Fatalf("expected task_created result code, got %#v", taskResp)
	}

	messageResp := runOpenShockCLI(t, cliDir,
		"room", "post",
		"--api-base-url", server.URL,
		"--issue", "issue_101",
		"--body", "CLI says integration is ready for review.",
		"--actor-id", "agent_shell",
		"--idempotency-key", "cli-room-post-1",
	)
	if messageResp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", messageResp)
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	taskFound := false
	messageFound := false
	for _, task := range detail.Tasks {
		if task.Title == "CLI created task" && task.AssigneeAgentID == "agent_shell" {
			taskFound = true
		}
	}
	for _, message := range detail.Messages {
		if message.ActorName == "Shell_Runner" && strings.Contains(message.Body, "integration is ready for review") {
			messageFound = true
		}
	}
	if !taskFound {
		t.Fatalf("expected CLI-created task to exist, got %#v", detail.Tasks)
	}
	if !messageFound {
		t.Fatalf("expected CLI-created room message to exist, got %#v", detail.Messages)
	}
}

func TestOpenShockCLIDrivesRunAndMergeRequest(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	if err := backingStore.BindWorkspaceRepo("ws_01", "/tmp/openshock-demo-repo", "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	cliDir := daemonModuleDir(t)

	runResp := runOpenShockCLI(t, cliDir,
		"run", "create",
		"--api-base-url", server.URL,
		"--task", "task_guard",
		"--actor-id", "agent_shell",
		"--idempotency-key", "cli-run-create-1",
	)
	if runResp.ResultCode != "run_created" {
		t.Fatalf("expected run_created result code, got %#v", runResp)
	}

	mergeResp := runOpenShockCLI(t, cliDir,
		"git", "request-merge",
		"--api-base-url", server.URL,
		"--task", "task_guard",
		"--actor-id", "agent_shell",
		"--idempotency-key", "cli-merge-request-1",
	)
	if mergeResp.ResultCode != "merge_requires_review" {
		t.Fatalf("expected merge_requires_review result code, got %#v", mergeResp)
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	runQueued := false
	taskReady := false
	for _, run := range detail.Runs {
		if run.ID == runResp.AffectedEntities[0].ID && run.Status == "queued" {
			runQueued = true
		}
	}
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "ready_for_integration" {
			taskReady = true
		}
	}
	if !runQueued {
		t.Fatalf("expected CLI-created run to be queued, got %#v", detail.Runs)
	}
	if !taskReady {
		t.Fatalf("expected task_guard to be ready_for_integration after merge request, got %#v", detail.Tasks)
	}
}

func TestOpenShockCLIUpdatesTaskStatus(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	cliDir := daemonModuleDir(t)

	statusResp := runOpenShockCLI(t, cliDir,
		"task", "status", "set",
		"--api-base-url", server.URL,
		"--task", "task_review",
		"--status", "in_progress",
		"--actor-id", "agent_guardian",
	)
	if statusResp.ResultCode != "task_status_updated" {
		t.Fatalf("expected task_status_updated result code, got %#v", statusResp)
	}

	readyResp := runOpenShockCLI(t, cliDir,
		"task", "mark-ready",
		"--api-base-url", server.URL,
		"--task", "task_review",
		"--actor-id", "agent_guardian",
	)
	if readyResp.ResultCode != "task_ready_for_integration" {
		t.Fatalf("expected task_ready_for_integration result code, got %#v", readyResp)
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	found := false
	for _, task := range detail.Tasks {
		if task.ID == "task_review" && task.Status == "ready_for_integration" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected task_review to be ready_for_integration, got %#v", detail.Tasks)
	}
}

func runOpenShockCLI(t *testing.T, cliDir string, args ...string) cliActionResponse {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmdArgs := append([]string{"run", "./cmd/openshock"}, args...)
	cmd := exec.CommandContext(ctx, "go", cmdArgs...)
	cmd.Dir = cliDir
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("openshock cli timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("openshock cli failed: %v\n%s", err, string(output))
	}

	var resp cliActionResponse
	if err := json.Unmarshal(output, &resp); err != nil {
		t.Fatalf("failed to decode cli response: %v\n%s", err, string(output))
	}
	return resp
}

type cliActionResponse struct {
	ActionID         string `json:"actionId"`
	Status           string `json:"status"`
	ResultCode       string `json:"resultCode"`
	ResultMessage    string `json:"resultMessage"`
	AffectedEntities []struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	} `json:"affectedEntities"`
}
