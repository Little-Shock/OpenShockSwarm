package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerPlannerRoutes)
}

func registerPlannerRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/planner/queue", s.handlePlannerQueue)
	mux.HandleFunc("/v1/planner/sessions/", s.handlePlannerSessionRoutes)
	mux.HandleFunc("/v1/planner/pull-requests/", s.handlePlannerPullRequestRoutes)
}

type PlannerAssignmentRequest struct {
	AgentID string `json:"agentId"`
}

type PullRequestAutoMergeRequest struct {
	Action string `json:"action"`
}

func (s *Server) handlePlannerQueue(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "run.execute") {
		return
	}
	writeJSON(w, http.StatusOK, s.store.PlannerQueue())
}

func (s *Server) handlePlannerSessionRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/planner/sessions/")
	if !strings.HasSuffix(path, "/assignment") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner session route not found"})
		return
	}
	sessionID := strings.TrimSuffix(path, "/assignment")
	sessionID = strings.TrimSuffix(sessionID, "/")
	if strings.TrimSpace(sessionID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner session not found"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if !s.requireRequestSessionPermission(w, r, "run.execute") {
		return
	}

	var req PlannerAssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	nextState, item, err := s.store.AssignSession(sessionID, store.SessionAssignmentInput{
		AgentID: req.AgentID,
	})
	if err != nil {
		writePlannerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item, "state": s.sanitizedStateSnapshotForRequest(nextState, r)})
}

func (s *Server) handlePlannerPullRequestRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/planner/pull-requests/")
	if !strings.HasSuffix(path, "/auto-merge") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner pull request route not found"})
		return
	}
	pullRequestID := strings.TrimSuffix(path, "/auto-merge")
	pullRequestID = strings.TrimSuffix(pullRequestID, "/")
	if strings.TrimSpace(pullRequestID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner pull request not found"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !s.requireRequestSessionPermission(w, r, "pull_request.read") {
			return
		}
		guard, ok := s.store.AutoMergeGuardForPullRequest(pullRequestID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner pull request not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"guard": guard})
	case http.MethodPost:
		var req PullRequestAutoMergeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		switch strings.TrimSpace(req.Action) {
		case "request":
			s.handlePlannerAutoMergeRequest(w, r, pullRequestID)
		case "apply":
			s.handlePlannerAutoMergeApply(w, r, pullRequestID)
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported auto-merge action"})
		}
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handlePlannerAutoMergeRequest(w http.ResponseWriter, r *http.Request, pullRequestID string) {
	if !s.requireRequestSessionPermission(w, r, "pull_request.review") {
		return
	}
	guard, ok := s.store.AutoMergeGuardForPullRequest(pullRequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner pull request not found"})
		return
	}
	if guard.Status == "blocked" || guard.Status == "merged" || guard.Status == "unavailable" {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": guard.Reason,
			"guard": guard,
			"state": s.sanitizedStateSnapshotForRequest(s.store.Snapshot(), r),
		})
		return
	}

	nextState, nextGuard, err := s.store.RequestAutoMerge(pullRequestID)
	if err != nil {
		writePlannerError(w, err)
		return
	}

	status := http.StatusOK
	if nextGuard.Status == "approval_required" {
		status = http.StatusAccepted
	}
	writeJSON(w, status, map[string]any{"state": s.sanitizedStateSnapshotForRequest(nextState, r), "guard": nextGuard})
}

func (s *Server) handlePlannerAutoMergeApply(w http.ResponseWriter, r *http.Request, pullRequestID string) {
	if !s.requireRequestSessionPermission(w, r, "pull_request.merge") {
		return
	}
	guard, ok := s.store.AutoMergeGuardForPullRequest(pullRequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner pull request not found"})
		return
	}
	if !guard.CanApply {
		status := http.StatusConflict
		if guard.Status == "approval_required" {
			status = http.StatusForbidden
		}
		writeJSON(w, status, map[string]any{
			"error": guard.Reason,
			"guard": guard,
			"state": s.sanitizedStateSnapshotForRequest(s.store.Snapshot(), r),
		})
		return
	}

	snapshot := s.store.Snapshot()
	item, ok := findPullRequest(snapshot, pullRequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "planner pull request not found"})
		return
	}

	remotePullRequest, err := s.github.MergePullRequest(s.workspaceRoot, githubsvc.MergePullRequestInput{
		Repo:   snapshot.Workspace.Repo,
		Number: item.Number,
	})
	if err != nil {
		nextState, appendErr := s.store.AppendGitHubPullRequestFailure(item.RoomID, "merge", item.Label, err.Error())
		if appendErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writePullRequestFailure(w, "merge", item.RoomID, pullRequestID, err, nextState)
		return
	}

	nextState, err := s.store.SyncPullRequestFromRemote(pullRequestID, mapGitHubPullRequest(remotePullRequest))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	nextGuard, _ := s.store.AutoMergeGuardForPullRequest(pullRequestID)
	writeJSON(w, http.StatusOK, map[string]any{"state": s.sanitizedStateSnapshotForRequest(nextState, r), "guard": nextGuard})
}

func writePlannerError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrPlannerSessionNotFound),
		errors.Is(err, store.ErrPlannerAgentNotFound),
		errors.Is(err, store.ErrPlannerPullRequestNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
}
