package oshcli

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"openshock/daemon/internal/client"
)

func TestRunShowsTopLevelHelp(t *testing.T) {
	app := NewApp()
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	exitCode := app.Run(context.Background(), []string{"--help"}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected top-level help to exit 0, got %d stderr=%q", exitCode, stderr.String())
	}
	for _, expected := range []string{
		"usage: openshock <action|room|send-message|task|run|git|delivery> ...",
		"send-message",
		"task create",
		"task status set",
		"run create",
	} {
		if !strings.Contains(stderr.String(), expected) {
			t.Fatalf("expected top-level help to contain %q, got %q", expected, stderr.String())
		}
	}
}

func TestRunShowsTaskHelp(t *testing.T) {
	app := NewApp()
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	exitCode := app.Run(context.Background(), []string{"task", "--help"}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected task help to exit 0, got %d stderr=%q", exitCode, stderr.String())
	}
	for _, expected := range []string{
		"usage: openshock task <create|claim|assign|status|mark-ready> ...",
		"openshock task create",
		"openshock task claim",
		"openshock task status set",
	} {
		if !strings.Contains(stderr.String(), expected) {
			t.Fatalf("expected task help to contain %q, got %q", expected, stderr.String())
		}
	}
}

func TestRunShowsRoomHelp(t *testing.T) {
	app := NewApp()
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	exitCode := app.Run(context.Background(), []string{"room", "--help"}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected room help to exit 0, got %d stderr=%q", exitCode, stderr.String())
	}
	if !strings.Contains(stderr.String(), "usage: openshock room post ...") {
		t.Fatalf("expected room help to describe room post, got %q", stderr.String())
	}
}

func TestRunSendMessageSubmitsRoomMessagePost(t *testing.T) {
	app := NewApp()
	recorder := &recordingSubmitter{
		resp: client.ActionResponse{ActionID: "action_001", Status: "completed"},
	}
	app.newClient = func(baseURL string) actionSubmitter {
		recorder.baseURL = baseURL
		return recorder
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	exitCode := app.Run(context.Background(), []string{
		"send-message",
		"--api-base-url", "http://example.test",
		"--room", "room_001",
		"--body", "这条信息需要同步给房间成员。",
		"--actor-id", "agent_shell",
		"--kind", "summary",
		"--idempotency-key", "send-message-1",
	}, &stdout, &stderr)

	if exitCode != 0 {
		t.Fatalf("expected send-message to exit 0, got %d stderr=%q", exitCode, stderr.String())
	}
	if recorder.baseURL != "http://example.test" {
		t.Fatalf("expected explicit api base url to be used, got %q", recorder.baseURL)
	}
	if recorder.req.ActionType != "RoomMessage.post" || recorder.req.TargetType != "room" || recorder.req.TargetID != "room_001" {
		t.Fatalf("unexpected action request: %#v", recorder.req)
	}
	if recorder.req.ActorID != "agent_shell" || recorder.req.ActorType != "agent" {
		t.Fatalf("unexpected actor payload: %#v", recorder.req)
	}
	if recorder.req.Payload["body"] != "这条信息需要同步给房间成员。" || recorder.req.Payload["kind"] != "summary" {
		t.Fatalf("unexpected payload: %#v", recorder.req.Payload)
	}
	if recorder.req.IdempotencyKey != "send-message-1" {
		t.Fatalf("unexpected idempotency key: %#v", recorder.req)
	}

	var resp client.ActionResponse
	if err := json.Unmarshal(stdout.Bytes(), &resp); err != nil {
		t.Fatalf("expected json response, got err=%v stdout=%q", err, stdout.String())
	}
	if resp.ActionID != "action_001" {
		t.Fatalf("unexpected action response: %#v", resp)
	}
}

func TestRunSendMessageRejectsHandoffKind(t *testing.T) {
	app := NewApp()
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	exitCode := app.Run(context.Background(), []string{
		"send-message",
		"--room", "room_001",
		"--body", "@agent_guardian 请接手。",
		"--actor-id", "agent_shell",
		"--kind", "handoff",
		"--idempotency-key", "send-message-2",
	}, &stdout, &stderr)

	if exitCode != 2 {
		t.Fatalf("expected invalid send-message kind to exit 2, got %d stderr=%q", exitCode, stderr.String())
	}
	if !strings.Contains(stderr.String(), "send-message kind must be message or summary") {
		t.Fatalf("expected validation error for handoff kind, got %q", stderr.String())
	}
}

type recordingSubmitter struct {
	baseURL string
	req     client.ActionRequest
	resp    client.ActionResponse
}

func (r *recordingSubmitter) SubmitAction(_ context.Context, req client.ActionRequest) (client.ActionResponse, error) {
	r.req = req
	return r.resp, nil
}
