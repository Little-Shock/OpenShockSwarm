package actions

import (
	"errors"
	"fmt"
	"strings"

	"openshock/backend/internal/core"
)

var ErrInvalidAction = errors.New("invalid action")

type Store interface {
	NextActionID() string
	LookupActionResult(idempotencyKey string) (core.ActionResponse, bool)
	SaveActionResult(idempotencyKey string, resp core.ActionResponse)
	PostRoomMessage(targetID, actorType, actorName, kind, body string) core.ActionResponse
	CreateIssue(title, summary, priority string) core.ActionResponse
	CreateDiscussionRoom(title, summary string) core.ActionResponse
	BindWorkspaceRepoAction(workspaceID, repoPath, label string, makeDefault bool, actorID string) (core.ActionResponse, error)
	CreateTask(issueID, title, description, assigneeAgentID string) core.ActionResponse
	AssignTask(taskID, agentID string) (core.ActionResponse, error)
	SetTaskStatus(taskID, status, actorID string) (core.ActionResponse, error)
	MarkTaskReadyForIntegration(taskID string) (core.ActionResponse, error)
	CreateRun(taskID string) (core.ActionResponse, error)
	ApproveRun(runID, actorID string) (core.ActionResponse, error)
	CancelRun(runID, actorID string) (core.ActionResponse, error)
	RequestMerge(taskID string) (core.ActionResponse, error)
	ApproveMerge(taskID, actorID string) (core.ActionResponse, error)
	CreateDeliveryPR(issueID, actorID string) (core.ActionResponse, error)
}

type Gateway struct {
	store Store
}

func NewGateway(store Store) *Gateway {
	return &Gateway{store: store}
}

func (g *Gateway) Submit(req core.ActionRequest) (core.ActionResponse, error) {
	if strings.TrimSpace(req.ActorType) == "" || strings.TrimSpace(req.ActionType) == "" {
		return core.ActionResponse{}, ErrInvalidAction
	}
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return core.ActionResponse{}, fmt.Errorf("%w: idempotency key is required", ErrInvalidAction)
	}
	if resp, ok := g.store.LookupActionResult(req.IdempotencyKey); ok {
		return resp, nil
	}

	var resp core.ActionResponse
	var err error

	switch req.ActionType {
	case "Issue.create":
		title, _ := req.Payload["title"].(string)
		summary, _ := req.Payload["summary"].(string)
		priority, _ := req.Payload["priority"].(string)
		if strings.TrimSpace(title) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: title is required", ErrInvalidAction)
		}
		if strings.TrimSpace(priority) == "" {
			priority = "medium"
		}
		resp = g.store.CreateIssue(title, summary, priority)
	case "Room.create":
		title, _ := req.Payload["title"].(string)
		summary, _ := req.Payload["summary"].(string)
		kind, _ := req.Payload["kind"].(string)
		if strings.TrimSpace(title) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: title is required", ErrInvalidAction)
		}
		normalizedKind := strings.TrimSpace(kind)
		if normalizedKind == "" {
			normalizedKind = "discussion"
		}
		if normalizedKind != "discussion" {
			return core.ActionResponse{}, fmt.Errorf("%w: issue rooms must be created via Issue.create", ErrInvalidAction)
		}
		resp = g.store.CreateDiscussionRoom(title, summary)
	case "Workspace.bind_repo":
		repoPath, _ := req.Payload["repoPath"].(string)
		label, _ := req.Payload["label"].(string)
		makeDefault, _ := req.Payload["makeDefault"].(bool)
		if strings.TrimSpace(repoPath) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: repoPath is required", ErrInvalidAction)
		}
		resp, err = g.store.BindWorkspaceRepoAction(req.TargetID, repoPath, label, makeDefault, req.ActorID)
	case "Issue.bind_repo":
		return core.ActionResponse{}, errors.New("Issue.bind_repo has been removed; use Workspace.bind_repo instead")
	case "RoomMessage.post":
		body, _ := req.Payload["body"].(string)
		kind, _ := req.Payload["kind"].(string)
		if strings.TrimSpace(body) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: body is required", ErrInvalidAction)
		}
		resp = g.store.PostRoomMessage(req.TargetID, req.ActorType, req.ActorID, kind, body)
	case "Task.create":
		title, _ := req.Payload["title"].(string)
		description, _ := req.Payload["description"].(string)
		assignee, _ := req.Payload["assigneeAgentId"].(string)
		if strings.TrimSpace(title) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: title is required", ErrInvalidAction)
		}
		resp = g.store.CreateTask(req.TargetID, title, description, assignee)
	case "Task.assign":
		agentID, _ := req.Payload["agentId"].(string)
		if strings.TrimSpace(agentID) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: agentId is required", ErrInvalidAction)
		}
		resp, err = g.store.AssignTask(req.TargetID, agentID)
	case "Task.status.set":
		status, _ := req.Payload["status"].(string)
		if strings.TrimSpace(status) == "" {
			return core.ActionResponse{}, fmt.Errorf("%w: status is required", ErrInvalidAction)
		}
		resp, err = g.store.SetTaskStatus(req.TargetID, status, req.ActorID)
	case "Task.mark_ready_for_integration":
		resp, err = g.store.MarkTaskReadyForIntegration(req.TargetID)
	case "Run.create":
		resp, err = g.store.CreateRun(req.TargetID)
	case "Run.approve":
		resp, err = g.store.ApproveRun(req.TargetID, req.ActorID)
	case "Run.cancel":
		resp, err = g.store.CancelRun(req.TargetID, req.ActorID)
	case "GitIntegration.merge.request":
		resp, err = g.store.RequestMerge(req.TargetID)
	case "GitIntegration.merge.approve":
		resp, err = g.store.ApproveMerge(req.TargetID, req.ActorID)
	case "DeliveryPR.create.request":
		resp, err = g.store.CreateDeliveryPR(req.TargetID, req.ActorID)
	default:
		return core.ActionResponse{}, fmt.Errorf("%w: unsupported action type %q", ErrInvalidAction, req.ActionType)
	}

	if err != nil {
		return core.ActionResponse{}, err
	}

	resp.ActionID = g.store.NextActionID()
	g.store.SaveActionResult(req.IdempotencyKey, resp)
	return resp, nil
}
