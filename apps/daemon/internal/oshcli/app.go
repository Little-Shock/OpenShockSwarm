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
		writeTopLevelHelp(stderr)
		return 2
	}
	if isHelpToken(args[0]) {
		writeTopLevelHelp(stderr)
		return 0
	}

	switch args[0] {
	case "action":
		return a.runAction(ctx, args[1:], stdout, stderr)
	case "room":
		return a.runRoom(ctx, args[1:], stdout, stderr)
	case "send-message":
		return a.runSendMessage(ctx, args[1:], stdout, stderr)
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
	if len(args) == 0 || isHelpToken(args[0]) {
		writeActionHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}
	if args[0] != "submit" {
		writeActionHelp(stderr)
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
	if len(args) == 0 || isHelpToken(args[0]) {
		writeRoomHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}
	if args[0] != "post" {
		writeRoomHelp(stderr)
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

func (a *App) runSendMessage(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeSendMessageHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}

	fs := flag.NewFlagSet("send-message", flag.ContinueOnError)
	fs.SetOutput(stderr)

	baseURL := fs.String("api-base-url", defaultAPIBaseURL(), "OpenShock backend base URL")
	roomID := fs.String("room", "", "Room id")
	body := fs.String("body", "", "Visible message body")
	kind := fs.String("kind", "message", "Visible message kind: message or summary")
	actorType := fs.String("actor-type", "agent", "Actor type")
	actorID := fs.String("actor-id", "", "Actor id")
	idempotencyKey := fs.String("idempotency-key", "", "Idempotency key")

	if err := fs.Parse(args); err != nil {
		return 2
	}

	normalizedKind := strings.ToLower(strings.TrimSpace(*kind))
	switch normalizedKind {
	case "message", "summary":
	default:
		fmt.Fprintln(stderr, "send-message kind must be message or summary")
		return 2
	}

	req, err := buildActionRequest(
		*actorType,
		*actorID,
		"RoomMessage.post",
		"room",
		*roomID,
		a.defaultIdempotencyKey(*idempotencyKey, "send-message", *roomID),
		map[string]any{
			"body": *body,
			"kind": normalizedKind,
		},
	)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) runTask(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeTaskHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}

	switch args[0] {
	case "create", "claim", "assign", "status", "mark-ready":
	default:
		writeTaskHelp(stderr)
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
			a.defaultIdempotencyKey(*idempotencyKey, "task-create", *issueID),
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
	case "claim":
		fs := flag.NewFlagSet("task claim", flag.ContinueOnError)
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
			"Task.assign",
			"task",
			*taskID,
			a.defaultIdempotencyKey(*idempotencyKey, "task-claim", *taskID),
			map[string]any{"agentId": *actorID},
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
			a.defaultIdempotencyKey(*idempotencyKey, "task-assign", *taskID),
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
	if len(args) == 0 || isHelpToken(args[0]) {
		writeRunHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}
	if args[0] != "create" {
		writeRunHelp(stderr)
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

	req, err := buildActionRequest(
		*actorType,
		*actorID,
		"Run.create",
		"task",
		*taskID,
		a.defaultIdempotencyKey(*idempotencyKey, "run-create", *taskID),
		map[string]any{},
	)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 2
	}
	return a.submit(ctx, *baseURL, req, stdout, stderr)
}

func (a *App) runGit(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeGitHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}
	if args[0] != "request-merge" && args[0] != "approve-merge" {
		writeGitHelp(stderr)
		return 2
	}

	switch args[0] {
	case "request-merge":
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

		req, err := buildActionRequest(
			*actorType,
			*actorID,
			"GitIntegration.merge.request",
			"task",
			*taskID,
			a.defaultIdempotencyKey(*idempotencyKey, "merge-request", *taskID),
			map[string]any{},
		)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
		return a.submit(ctx, *baseURL, req, stdout, stderr)
	case "approve-merge":
		fs := flag.NewFlagSet("git approve-merge", flag.ContinueOnError)
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
			"GitIntegration.merge.approve",
			"task",
			*taskID,
			a.defaultIdempotencyKey(*idempotencyKey, "merge-approve", *taskID),
			map[string]any{},
		)
		if err != nil {
			fmt.Fprintln(stderr, err.Error())
			return 2
		}
		return a.submit(ctx, *baseURL, req, stdout, stderr)
	default:
		fmt.Fprintf(stderr, "unsupported git command %q\n", args[0])
		return 2
	}
}

func (a *App) runDelivery(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeDeliveryHelp(stderr)
		return boolToExitCode(len(args) == 0, 2, 0)
	}
	if args[0] != "request" {
		writeDeliveryHelp(stderr)
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

	req, err := buildActionRequest(
		*actorType,
		*actorID,
		"DeliveryPR.create.request",
		"issue",
		*issueID,
		a.defaultIdempotencyKey(*idempotencyKey, "delivery-request", *issueID),
		map[string]any{},
	)
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

func isHelpToken(value string) bool {
	trimmed := strings.TrimSpace(value)
	return trimmed == "-h" || trimmed == "--help" || trimmed == "help"
}

func boolToExitCode(condition bool, whenTrue, whenFalse int) int {
	if condition {
		return whenTrue
	}
	return whenFalse
}

func writeTopLevelHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock <action|room|send-message|task|run|git|delivery> ...")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "common commands:")
	fmt.Fprintln(w, "  openshock action submit ...")
	fmt.Fprintln(w, "  openshock room post ...")
	fmt.Fprintln(w, "  openshock send-message ...")
	fmt.Fprintln(w, "  openshock task create ...")
	fmt.Fprintln(w, "  openshock task claim ...")
	fmt.Fprintln(w, "  openshock task assign ...")
	fmt.Fprintln(w, "  openshock task status set ...")
	fmt.Fprintln(w, "  openshock task mark-ready ...")
	fmt.Fprintln(w, "  openshock run create ...")
	fmt.Fprintln(w, "  openshock git request-merge ...")
	fmt.Fprintln(w, "  openshock git approve-merge ...")
	fmt.Fprintln(w, "  openshock delivery request ...")
}

func writeActionHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock action submit ...")
}

func writeRoomHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock room post ...")
}

func writeSendMessageHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock send-message --room <room_id> --body \"<message>\" --actor-id <agent_id> [--kind message|summary]")
}

func writeTaskHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock task <create|claim|assign|status|mark-ready> ...")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "common commands:")
	fmt.Fprintln(w, "  openshock task create ...")
	fmt.Fprintln(w, "  openshock task claim ...")
	fmt.Fprintln(w, "  openshock task assign ...")
	fmt.Fprintln(w, "  openshock task status set ...")
	fmt.Fprintln(w, "  openshock task mark-ready ...")
}

func writeRunHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock run create ...")
}

func writeGitHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock git <request-merge|approve-merge> ...")
}

func writeDeliveryHelp(w io.Writer) {
	fmt.Fprintln(w, "usage: openshock delivery request ...")
}
