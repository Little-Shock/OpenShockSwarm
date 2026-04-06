package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestPlannerQueueRouteReturnsAssignmentAndAutoMergeTruth(t *testing.T) {
	root := t.TempDir()
	_, server, created, pullRequestID := newPlannerTestServer(t, root, nil)
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/planner/queue")
	if err != nil {
		t.Fatalf("GET /v1/planner/queue error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/planner/queue status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload []store.PlannerQueueItem
	decodeJSON(t, resp, &payload)

	var found *store.PlannerQueueItem
	for index := range payload {
		if payload[index].SessionID == created.SessionID {
			found = &payload[index]
			break
		}
	}
	if found == nil {
		t.Fatalf("planner queue missing session %q: %#v", created.SessionID, payload)
	}
	if found.AgentID != "agent-codex-dockmaster" || found.PullRequestID != pullRequestID {
		t.Fatalf("planner queue item malformed: %#v", found)
	}
	if found.AutoMerge.Status != "ready" || !found.AutoMerge.CanApply || found.AutoMerge.ReviewDecision != "APPROVED" {
		t.Fatalf("auto-merge guard = %#v, want ready/canApply approved", found.AutoMerge)
	}
}

func TestPlannerSessionAssignmentRouteReassignsCurrentQueue(t *testing.T) {
	root := t.TempDir()
	_, server, created, _ := newPlannerTestServer(t, root, nil)
	defer server.Close()

	body, err := json.Marshal(map[string]any{"agentId": "agent-claude-review-runner"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/planner/sessions/"+created.SessionID+"/assignment", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST planner assignment error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST planner assignment status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Item  store.PlannerQueueItem `json:"item"`
		State store.State            `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Item.AgentID != "agent-claude-review-runner" || payload.Item.Owner != "Claude Review Runner" {
		t.Fatalf("planner assignment item = %#v, want claude-review-runner owner", payload.Item)
	}
	run := findRunByID(payload.State, created.RunID)
	if run == nil || run.Owner != "Claude Review Runner" || run.Status != "running" {
		t.Fatalf("assigned run = %#v, want Claude Review Runner/running", run)
	}
	session := findSessionByID(payload.State, created.SessionID)
	if session == nil || session.Status != "running" || !strings.Contains(session.Summary, "Claude Review Runner") {
		t.Fatalf("assigned session = %#v, want running summary mentioning Claude Review Runner", session)
	}
}

func TestPlannerSessionAssignmentRouteRejectsUnknownAgent(t *testing.T) {
	root := t.TempDir()
	_, server, created, _ := newPlannerTestServer(t, root, nil)
	defer server.Close()

	body, err := json.Marshal(map[string]any{"agentId": "agent-missing"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/planner/sessions/"+created.SessionID+"/assignment", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST planner assignment with missing agent error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("POST planner assignment with missing agent status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestPlannerAutoMergeRouteRequestMarksApprovalRequired(t *testing.T) {
	root := t.TempDir()
	_, server, created, pullRequestID := newPlannerTestServer(t, root, nil)
	defer server.Close()

	body, err := json.Marshal(map[string]any{"action": "request"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/planner/pull-requests/"+pullRequestID+"/auto-merge", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST auto-merge request error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST auto-merge request status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	var payload struct {
		State store.State          `json:"state"`
		Guard store.AutoMergeGuard `json:"guard"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Guard.Status != "approval_required" || !payload.Guard.CanApply {
		t.Fatalf("auto-merge request guard = %#v, want approval_required with explicit apply path", payload.Guard)
	}
	run := findRunByID(payload.State, created.RunID)
	if run == nil || !run.ApprovalRequired || !strings.Contains(run.NextAction, "显式确认") {
		t.Fatalf("run after auto-merge request = %#v, want approvalRequired true and explicit confirmation next action", run)
	}
	if !roomMessagesContain(payload.State, created.RoomID, "已对 PR #") {
		t.Fatalf("room messages missing auto-merge request: %#v", payload.State.RoomMessages[created.RoomID])
	}
}

func TestPlannerAutoMergeRouteAppliesMergeWhenOwnerHasPermission(t *testing.T) {
	root := t.TempDir()
	github := &fakeGitHubClient{
		merged: githubsvc.PullRequest{
			Number:         261,
			Title:          "planner: lock queue",
			URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/261",
			State:          "MERGED",
			Merged:         true,
			ReviewDecision: "APPROVED",
			HeadRefName:    "feat/planner-lock",
			BaseRefName:    "main",
			Author:         "CodexDockmaster",
			UpdatedAt:      "2026-04-06T07:00:00Z",
		},
	}
	_, server, created, pullRequestID := newPlannerTestServer(t, root, github)
	defer server.Close()

	body, err := json.Marshal(map[string]any{"action": "apply"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/planner/pull-requests/"+pullRequestID+"/auto-merge", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST auto-merge apply error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST auto-merge apply status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		State store.State          `json:"state"`
		Guard store.AutoMergeGuard `json:"guard"`
	}
	decodeJSON(t, resp, &payload)

	if len(github.mergeInputs) != 1 || github.mergeInputs[0].Number != 261 {
		t.Fatalf("merge inputs = %#v, want single merge for PR #261", github.mergeInputs)
	}
	if payload.Guard.Status != "merged" {
		t.Fatalf("auto-merge apply guard = %#v, want merged", payload.Guard)
	}
	pr, ok := findPullRequestByID(payload.State, pullRequestID)
	if !ok || pr.Status != "merged" {
		t.Fatalf("merged pull request = %#v, want merged", pr)
	}
	run := findRunByID(payload.State, created.RunID)
	if run == nil || run.Status != "done" {
		t.Fatalf("merged run = %#v, want done", run)
	}
}

func TestPlannerAutoMergeRouteRejectsApplyBeforeApproval(t *testing.T) {
	root := t.TempDir()
	s, server, _, pullRequestID := newPlannerTestServer(t, root, nil)
	defer server.Close()

	if _, err := s.SyncPullRequestFromRemote(pullRequestID, store.PullRequestRemoteSnapshot{
		Number:         261,
		Title:          "planner: lock queue",
		Status:         "in_review",
		Branch:         "feat/planner-lock",
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/261",
		ReviewDecision: "REVIEW_REQUIRED",
		ReviewSummary:  "等待 reviewer 最终判断。",
		UpdatedAt:      "刚刚",
	}); err != nil {
		t.Fatalf("SyncPullRequestFromRemote(review_required) error = %v", err)
	}

	req, err := json.Marshal(map[string]any{"action": "apply"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/planner/pull-requests/"+pullRequestID+"/auto-merge", "application/json", bytes.NewReader(req))
	if err != nil {
		t.Fatalf("POST auto-merge apply blocked error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("POST auto-merge apply blocked status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error string               `json:"error"`
		Guard store.AutoMergeGuard `json:"guard"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Guard.Status != "blocked" || !strings.Contains(payload.Error, "GitHub Review 尚未批准") {
		t.Fatalf("blocked auto-merge payload = %#v, want blocked with review waiting reason", payload)
	}
}

func newPlannerTestServer(t *testing.T, root string, github githubsvc.Client) (*store.Store, *httptest.Server, store.IssueCreationResult, string) {
	t.Helper()

	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Planner Queue Ready",
		Summary:  "verify planner queue / assignment / auto-merge contract",
		Owner:    "Codex Dockmaster",
		Priority: "critical",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}
	if _, err := s.AttachLane(created.RunID, created.SessionID, store.LaneBinding{
		Branch:       created.Branch,
		WorktreeName: created.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", created.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}
	nextState, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         261,
		Title:          "planner: lock queue",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/261",
		ReviewDecision: "REVIEW_REQUIRED",
		ReviewSummary:  "等待 reviewer 最终判断。",
		UpdatedAt:      "刚刚",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}
	if _, err := s.SyncPullRequestFromRemote(pullRequestID, store.PullRequestRemoteSnapshot{
		Number:         261,
		Title:          "planner: lock queue",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/261",
		ReviewDecision: "APPROVED",
		ReviewSummary:  "GitHub Review 已批准，等待最终合并。",
		UpdatedAt:      "刚刚",
	}); err != nil {
		t.Fatalf("SyncPullRequestFromRemote(approved) error = %v", err)
	}

	if github == nil {
		github = &fakeGitHubClient{
			merged: githubsvc.PullRequest{
				Number:         261,
				Title:          "planner: lock queue",
				URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/261",
				State:          "MERGED",
				Merged:         true,
				ReviewDecision: "APPROVED",
				HeadRefName:    created.Branch,
				BaseRefName:    "main",
				Author:         "CodexDockmaster",
				UpdatedAt:      "2026-04-06T07:00:00Z",
			},
		}
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        github,
	}).Handler())

	_ = nextState
	return s, server, created, pullRequestID
}
