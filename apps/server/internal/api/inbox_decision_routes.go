package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type InboxDecisionRequest struct {
	Decision string `json:"decision"`
}

type inboxReviewFailureError struct {
	cause         error
	operation     string
	roomID        string
	pullRequestID string
	state         store.State
}

func (e *inboxReviewFailureError) Error() string {
	return e.cause.Error()
}

func (e *inboxReviewFailureError) Unwrap() error {
	return e.cause
}

func (s *Server) handleInboxRoutes(w http.ResponseWriter, r *http.Request) {
	inboxItemID := strings.TrimPrefix(r.URL.Path, "/v1/inbox/")
	if inboxItemID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "inbox item not found"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var req InboxDecisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	snapshot := s.store.Snapshot()
	item, ok := findInboxItem(snapshot, inboxItemID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "inbox item not found"})
		return
	}

	var (
		nextState store.State
		err       error
	)

	switch strings.TrimSpace(item.Kind) {
	case "approval", "blocked":
		nextState, err = s.store.ApplyInboxDecision(inboxItemID, req.Decision)
	case "review":
		nextState, err = s.applyReviewInboxDecision(snapshot, item, req.Decision)
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("inbox item kind %q does not support decisions", item.Kind)})
		return
	}
	if err != nil {
		var reviewFailure *inboxReviewFailureError
		if errors.As(err, &reviewFailure) {
			writePullRequestFailure(w, reviewFailure.operation, reviewFailure.roomID, reviewFailure.pullRequestID, reviewFailure.cause, reviewFailure.state)
			return
		}
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": nextState})
}

func (s *Server) applyReviewInboxDecision(snapshot store.State, item store.InboxItem, decision string) (store.State, error) {
	pullRequest, ok := findPullRequestForInboxItem(snapshot, item)
	if !ok {
		return store.State{}, fmt.Errorf("pull request not found for inbox item")
	}

	var (
		remotePullRequest githubsvc.PullRequest
		err               error
		operation         = "sync"
	)

	switch strings.TrimSpace(decision) {
	case "merged":
		operation = "merge"
		remotePullRequest, err = s.github.MergePullRequest(s.workspaceRoot, githubsvc.MergePullRequestInput{
			Repo:   snapshot.Workspace.Repo,
			Number: pullRequest.Number,
		})
	case "changes_requested":
		remotePullRequest, err = s.github.SyncPullRequest(s.workspaceRoot, githubsvc.SyncPullRequestInput{
			Repo:   snapshot.Workspace.Repo,
			Number: pullRequest.Number,
		})
	default:
		return store.State{}, fmt.Errorf("unsupported review decision %q", decision)
	}
	if err != nil {
		nextState, appendErr := s.store.AppendGitHubPullRequestFailure(pullRequest.RoomID, operation, pullRequest.Label, err.Error())
		if appendErr != nil {
			return store.State{}, err
		}
		return nextState, &inboxReviewFailureError{
			cause:         err,
			operation:     operation,
			roomID:        pullRequest.RoomID,
			pullRequestID: pullRequest.ID,
			state:         nextState,
		}
	}

	remoteSnapshot := mapGitHubPullRequest(remotePullRequest)
	changed := reviewDecisionChangesPullRequest(pullRequest, remoteSnapshot)

	nextState, err := s.store.SyncPullRequestFromRemote(pullRequest.ID, remoteSnapshot)
	if err != nil {
		return store.State{}, err
	}
	if !changed {
		return nextState, nil
	}
	return s.store.RemoveInboxItem(item.ID)
}

func reviewDecisionChangesPullRequest(current store.PullRequest, remote store.PullRequestRemoteSnapshot) bool {
	nextStatus := current.Status
	if text := strings.TrimSpace(remote.Status); text != "" {
		nextStatus = text
	}
	nextReviewDecision := current.ReviewDecision
	if text := strings.TrimSpace(remote.ReviewDecision); text != "" || current.ReviewDecision != "" {
		nextReviewDecision = strings.TrimSpace(remote.ReviewDecision)
	}
	nextSummary := defaultString(strings.TrimSpace(remote.ReviewSummary), summarizeRemotePullRequestStatus(nextStatus, nextReviewDecision))
	nextTitle := defaultString(strings.TrimSpace(remote.Title), current.Title)
	nextURL := current.URL
	if text := strings.TrimSpace(remote.URL); text != "" {
		nextURL = text
	}
	return current.Status != nextStatus || current.ReviewDecision != nextReviewDecision || current.ReviewSummary != nextSummary || current.Title != nextTitle || current.URL != nextURL
}

func findInboxItem(snapshot store.State, inboxItemID string) (store.InboxItem, bool) {
	for _, item := range snapshot.Inbox {
		if item.ID == inboxItemID {
			return item, true
		}
	}
	return store.InboxItem{}, false
}

func findPullRequestForInboxItem(snapshot store.State, item store.InboxItem) (store.PullRequest, bool) {
	for _, pullRequest := range snapshot.PullRequests {
		if strings.Contains(item.Href, pullRequest.RunID) || strings.Contains(item.Href, pullRequest.RoomID) {
			return pullRequest, true
		}
	}
	return store.PullRequest{}, false
}

func summarizeRemotePullRequestStatus(status, reviewDecision string) string {
	switch strings.TrimSpace(status) {
	case "merged":
		return "PR 已在 GitHub 合并，Issue 与讨论间进入完成状态。"
	case "changes_requested":
		return "GitHub Review 要求补充修改，等待 follow-up run。"
	case "draft":
		return "远端草稿 PR 已创建，等待进入正式评审。"
	default:
		switch strings.TrimSpace(reviewDecision) {
		case "APPROVED":
			return "GitHub Review 已批准，等待最终合并。"
		case "CHANGES_REQUESTED":
			return "GitHub Review 要求补充修改，等待 follow-up run。"
		default:
			return "远端 PR 已创建，等待 GitHub Review 或合并。"
		}
	}
}
