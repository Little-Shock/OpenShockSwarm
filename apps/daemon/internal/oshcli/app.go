package oshcli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"openshock/daemon/internal/client"
)

type actionSubmitter interface {
	SubmitAction(ctx context.Context, req client.ActionRequest) (client.ActionResponse, error)
}

type App struct {
	newClient func(baseURL string) actionSubmitter
	now       func() time.Time
}

func NewApp() *App {
	return &App{
		newClient: func(baseURL string) actionSubmitter {
			return client.New(baseURL)
		},
		now: time.Now,
	}
}

func (a *App) Run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: openshock <action|room|task|run|git|delivery> ...")
		return 2
	}

	switch args[0] {
	case "action":
		return a.runAction(ctx, args[1:], stdout, stderr)
	case "room":
		return a.runRoom(ctx, args[1:], stdout, stderr)
	case "task":
		return a.runTask(ctx, args[1:], stdout, stderr)
	case "run":
		return a.runRun(ctx, args[1:], stdout, stderr)
	case "git":
		return a.runGit(ctx, args[1:], stdout, stderr)
	case "delivery":
		return a.runDelivery(ctx, args[1:], stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unsupported command %q\n", args[0])
		return 2
	}
}

func (a *App) runAction(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "submit" {
		fmt.Fprintln(stderr, "usage: openshock action submit ...")
		return 2
	}

	fs := flag.NewFlagSet("action submit", flag.ContinueOnError)
	fs.SetOutput(stderr)

	baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
	actorType := fs.String("actor-type", "", "Actor type")
	actorID := fs.String("actor-id", "", "Actor id")
	actionType := fs.String("action-type", "", "Action type")
	targetType := fs.String("target-type", "", "Target type")
	targetID := fs.String("target-id", "", "Target id")
	payloadJSON := fs.String("payload-json", "{}", "JSON payload object")
	idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}

	payload, err := parsePayload(*payloadJSON)
	if err != nil {
		fmt.Fprintf(stderr, "invalid payload-json: %v\n", err)
		return 2
	}

	req, err := buildActionRequest(*actorType, *actorID, *actionType, *targetType, *targetID, *idempotencyKey, payload)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) runRoom(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "post" {
		fmt.Fprintln(stderr, "usage: openshock room post ...")
		return 2
	}

	fs := flag.NewFlagSet("room post", flag.ContinueOnError)
	fs.SetOutput(stderr)

	baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
	issueID := fs.String("issue", "", "Issue id")
	body := fs.String("body", "", "Message body")
	actorType := fs.String("actor-type", "agent", "Actor type")
	actorID := fs.String("actor-id", "", "Actor id")
	idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}

	req, err := buildActionRequest(
		*actorType,
		*actorID,
		"RoomMessage.post",
		"issue",
		*issueID,
		*idempotencyKey,
		map[string]any{"body": *body},
	)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) runTask(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: openshock task <create|assign|status|mark-ready> ...")
		return 2
	}

	switch args[0] {
	case "create":
		fs := flag.NewFlagSet("task create", flag.ContinueOnError)
		fs.SetOutput(stderr)

		baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
		issueID := fs.String("issue", "", "Issue id")
		title := fs.String("title", "", "Task title")
		description := fs.String("description", "", "Task description")
		assigneeAgentID := fs.String("assignee-agent-id", "", "Assignee agent id")
		actorType := fs.String("actor-type", "agent", "Actor type")
		actorID := fs.String("actor-id", "", "Actor id")
		idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

		if err := fs.Parse(args[1:]); err != nil {
			return 2
		}

		req, err := buildActionRequest(
			*actorType,
			*actorID,
			"Task.create",
			"issue",
			*issueID,
			*idempotencyKey,
			map[string]any{
				"title":           *title,
				"description":     *description,
				"assigneeAgentId": *assigneeAgentID,
			},
		)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
		return a.submit(ctx, *baseURL, req, stdout, stderr)
	case "assign":
		fs := flag.NewFlagSet("task assign", flag.ContinueOnError)
		fs.SetOutput(stderr)

		baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
		taskID := fs.String("task", "", "Task id")
		agentID := fs.String("agent-id", "", "Agent id")
		actorType := fs.String("actor-type", "agent", "Actor type")
		actorID := fs.String("actor-id", "", "Actor id")
		idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

		if err := fs.Parse(args[1:]); err != nil {
			return 2
		}

		req, err := buildActionRequest(
			*actorType,
			*actorID,
			"Task.assign",
			"task",
			*taskID,
			*idempotencyKey,
			map[string]any{"agentId": *agentID},
		)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
		return a.submit(ctx, *baseURL, req, stdout, stderr)
	case "status":
		if len(args) < 2 || args[1] != "set" {
			fmt.Fprintln(stderr, "usage: openshock task status set ...")
			return 2
		}

		fs := flag.NewFlagSet("task status set", flag.ContinueOnError)
		fs.SetOutput(stderr)

		baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
		taskID := fs.String("task", "", "Task id")
		status := fs.String("status", "", "Task status")
		actorType := fs.String("actor-type", "agent", "Actor type")
		actorID := fs.String("actor-id", "", "Actor id")
		idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

		if err := fs.Parse(args[2:]); err != nil {
			return 2
		}

		req, err := buildActionRequest(
			*actorType,
			*actorID,
			"Task.status.set",
			"task",
			*taskID,
			a.defaultIdempotencyKey(*idempotencyKey, "task-status", *taskID),
			map[string]any{"status": *status},
		)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
		return a.submit(ctx, *baseURL, req, stdout, stderr)
	case "mark-ready":
		fs := flag.NewFlagSet("task mark-ready", flag.ContinueOnError)
		fs.SetOutput(stderr)

		baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
		taskID := fs.String("task", "", "Task id")
		actorType := fs.String("actor-type", "agent", "Actor type")
		actorID := fs.String("actor-id", "", "Actor id")
		idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

		if err := fs.Parse(args[1:]); err != nil {
			return 2
		}

		req, err := buildActionRequest(
			*actorType,
			*actorID,
			"Task.mark_ready_for_integration",
			"task",
			*taskID,
			a.defaultIdempotencyKey(*idempotencyKey, "task-mark-ready", *taskID),
			map[string]any{},
		)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
		return a.submit(ctx, *baseURL, req, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unsupported task command %q\n", args[0])
		return 2
	}
}

func (a *App) runRun(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "create" {
		fmt.Fprintln(stderr, "usage: openshock run create ...")
		return 2
	}

	fs := flag.NewFlagSet("run create", flag.ContinueOnError)
	fs.SetOutput(stderr)

	baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
	taskID := fs.String("task", "", "Task id")
	actorType := fs.String("actor-type", "agent", "Actor type")
	actorID := fs.String("actor-id", "", "Actor id")
	idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}

	req, err := buildActionRequest(*actorType, *actorID, "Run.create", "task", *taskID, *idempotencyKey, map[string]any{})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) runGit(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "request-merge" {
		fmt.Fprintln(stderr, "usage: openshock git request-merge ...")
		return 2
	}

	fs := flag.NewFlagSet("git request-merge", flag.ContinueOnError)
	fs.SetOutput(stderr)

	baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
	taskID := fs.String("task", "", "Task id")
	actorType := fs.String("actor-type", "agent", "Actor type")
	actorID := fs.String("actor-id", "", "Actor id")
	idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}

	req, err := buildActionRequest(*actorType, *actorID, "GitIntegration.merge.request", "task", *taskID, *idempotencyKey, map[string]any{})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) runDelivery(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "request" {
		fmt.Fprintln(stderr, "usage: openshock delivery request ...")
		return 2
	}

	fs := flag.NewFlagSet("delivery request", flag.ContinueOnError)
	fs.SetOutput(stderr)

	baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
	issueID := fs.String("issue", "", "Issue id")
	actorType := fs.String("actor-type", "agent", "Actor type")
	actorID := fs.String("actor-id", "", "Actor id")
	idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}

	req, err := buildActionRequest(*actorType, *actorID, "DeliveryPR.create.request", "issue", *issueID, *idempotencyKey, map[string]any{})
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) submit(ctx context.Context, baseURL string, req client.ActionRequest, stdout, stderr io.Writer) int {
	resp, err := a.newClient(baseURL).SubmitAction(ctx, req)
	if err != nil {
		fmt.Fprintf(stderr, "submit action failed: %v\n", err)
		return 1
	}

	if err := json.NewEncoder(stdout).Encode(resp); err != nil {
		fmt.Fprintf(stderr, "encode response failed: %v\n", err)
		return 1
	}
	return 0
}

func buildActionRequest(actorType, actorID, actionType, targetType, targetID, idempotencyKey string, payload map[string]any) (client.ActionRequest, error) {
	if strings.TrimSpace(actorType) == "" {
		return client.ActionRequest{}, fmt.Errorf("actor-type is required")
	}
	if strings.TrimSpace(actorID) == "" {
		return client.ActionRequest{}, fmt.Errorf("actor-id is required")
	}
	if strings.TrimSpace(actionType) == "" {
		return client.ActionRequest{}, fmt.Errorf("action-type is required")
	}
	if strings.TrimSpace(targetType) == "" {
		return client.ActionRequest{}, fmt.Errorf("target-type is required")
	}
	if strings.TrimSpace(targetID) == "" {
		return client.ActionRequest{}, fmt.Errorf("target-id is required")
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return client.ActionRequest{}, fmt.Errorf("idempotency-key is required")
	}
	if payload == nil {
		payload = map[string]any{}
	}

	return client.ActionRequest{
		ActorType:      actorType,
		ActorID:        actorID,
		ActionType:     actionType,
		TargetType:     targetType,
		TargetID:       targetID,
		Payload:        payload,
		IdempotencyKey: idempotencyKey,
	}, nil
}

func parsePayload(payloadJSON string) (map[string]any, error) {
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (a *App) defaultIdempotencyKey(explicit, prefix, targetID string) string {
	value := strings.TrimSpace(explicit)
	if value != "" {
		return value
	}

	parts := []string{prefix}
	if trimmedTarget := strings.TrimSpace(targetID); trimmedTarget != "" {
		parts = append(parts, trimmedTarget)
	}
	now := time.Now
	if a != nil && a.now != nil {
		now = a.now
	}
	parts = append(parts, fmt.Sprintf("%d", now().UnixNano()))
	return strings.Join(parts, "-")
}

func defaultAPIBaseURL() string {
	value := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(getenv("OPENSHOCK_API_BASE_URL")), "/"))
	if value == "" {
		return "http://localhost:8080"
	}
	return value
}

var getenv = func(key string) string {
	return os.Getenv(key)
}
