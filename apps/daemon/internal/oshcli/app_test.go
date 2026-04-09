package oshcli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"openshock/daemon/internal/client"
)

func TestRoomPostBuildsActionRequest(t *testing.T) {
	stub := &stubSubmitter{
		resp: client.ActionResponse{
			ActionID:      "action_201",
			Status:        "completed",
			ResultCode:    "room_message_posted",
			ResultMessage: "ok",
		},
	}
	app := &App{
		newClient: func(string) actionSubmitter { return stub },
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"room", "post",
		"--api-base-url", "http://example.test",
		"--issue", "issue_101",
		"--body", "Need human input",
		"--actor-id", "agent_shell",
		"--idempotency-key", "room-post-1",
	}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected exit 0, got %d with stderr %s", exitCode, stderr.String())
	}
	if stub.lastReq.ActionType != "RoomMessage.post" || stub.lastReq.TargetID != "issue_101" {
		t.Fatalf("unexpected action request: %#v", stub.lastReq)
	}
	if stub.lastReq.Payload["body"] != "Need human input" {
		t.Fatalf("unexpected payload: %#v", stub.lastReq.Payload)
	}

	var resp client.ActionResponse
	if err := json.Unmarshal(stdout.Bytes(), &resp); err != nil {
		t.Fatalf("invalid stdout json: %v", err)
	}
	if resp.ActionID != "action_201" {
		t.Fatalf("unexpected action response: %#v", resp)
	}
}

func TestActionSubmitParsesPayloadJSON(t *testing.T) {
	stub := &stubSubmitter{resp: client.ActionResponse{ActionID: "action_202", Status: "completed"}}
	app := &App{
		newClient: func(string) actionSubmitter { return stub },
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"action", "submit",
		"--actor-type", "agent",
		"--actor-id", "agent_lead",
		"--action-type", "Task.assign",
		"--target-type", "task",
		"--target-id", "task_101",
		"--idempotency-key", "assign-1",
		"--payload-json", `{"agentId":"agent_shell"}`,
	}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected exit 0, got %d with stderr %s", exitCode, stderr.String())
	}
	if stub.lastReq.Payload["agentId"] != "agent_shell" {
		t.Fatalf("unexpected payload: %#v", stub.lastReq.Payload)
	}
}

func TestTaskStatusSetBuildsActionRequest(t *testing.T) {
	stub := &stubSubmitter{resp: client.ActionResponse{ActionID: "action_203", Status: "completed"}}
	app := &App{
		newClient: func(string) actionSubmitter { return stub },
		now:       func() time.Time { return time.Unix(0, 123456789) },
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"task", "status", "set",
		"--task", "task_101",
		"--status", "in_progress",
		"--actor-id", "agent_shell",
	}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected exit 0, got %d with stderr %s", exitCode, stderr.String())
	}
	if stub.lastReq.ActionType != "Task.status.set" || stub.lastReq.TargetID != "task_101" {
		t.Fatalf("unexpected action request: %#v", stub.lastReq)
	}
	if stub.lastReq.Payload["status"] != "in_progress" {
		t.Fatalf("unexpected payload: %#v", stub.lastReq.Payload)
	}
	if stub.lastReq.IdempotencyKey != "task-status-task_101-123456789" {
		t.Fatalf("expected generated idempotency key, got %q", stub.lastReq.IdempotencyKey)
	}
}

func TestTaskMarkReadyBuildsActionRequest(t *testing.T) {
	stub := &stubSubmitter{resp: client.ActionResponse{ActionID: "action_204", Status: "completed"}}
	app := &App{
		newClient: func(string) actionSubmitter { return stub },
		now:       func() time.Time { return time.Unix(0, 987654321) },
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"task", "mark-ready",
		"--task", "task_101",
		"--actor-id", "agent_shell",
	}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected exit 0, got %d with stderr %s", exitCode, stderr.String())
	}
	if stub.lastReq.ActionType != "Task.mark_ready_for_integration" || stub.lastReq.TargetID != "task_101" {
		t.Fatalf("unexpected action request: %#v", stub.lastReq)
	}
	if stub.lastReq.IdempotencyKey != "task-mark-ready-task_101-987654321" {
		t.Fatalf("expected generated idempotency key, got %q", stub.lastReq.IdempotencyKey)
	}
}

func TestRunRequiresIdempotencyKey(t *testing.T) {
	app := &App{
		newClient: func(string) actionSubmitter { return &stubSubmitter{} },
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"run", "create",
		"--task", "task_101",
		"--actor-id", "agent_shell",
	}, &stdout, &stderr)

	if exitCode != 2 {
		t.Fatalf("expected exit 2, got %d", exitCode)
	}
	if !strings.Contains(stderr.String(), "idempotency-key is required") {
		t.Fatalf("unexpected stderr: %s", stderr.String())
	}
}

func TestSubmitFailureReturnsExitOne(t *testing.T) {
	app := &App{
		newClient: func(string) actionSubmitter {
			return &stubSubmitter{err: errors.New("boom")}
		},
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"delivery", "request",
		"--issue", "issue_101",
		"--actor-id", "agent_lead",
		"--idempotency-key", "delivery-1",
	}, &stdout, &stderr)

	if exitCode != 1 {
		t.Fatalf("expected exit 1, got %d", exitCode)
	}
	if !strings.Contains(stderr.String(), "submit action failed") {
		t.Fatalf("unexpected stderr: %s", stderr.String())
	}
}

type stubSubmitter struct {
	lastReq client.ActionRequest
	resp    client.ActionResponse
	err     error
}

func (s *stubSubmitter) SubmitAction(_ context.Context, req client.ActionRequest) (client.ActionResponse, error) {
	s.lastReq = req
	if s.err != nil {
		return client.ActionResponse{}, s.err
	}
	return s.resp, nil
}
