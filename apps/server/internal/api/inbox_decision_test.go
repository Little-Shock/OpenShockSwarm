package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestInboxDecisionRouteApprovesApprovalItem(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	body, err := json.Marshal(map[string]string{"decision": "approved"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/inbox/inbox-approval-runtime", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST inbox decision error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("approval status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	run := findRunByID(payload.State, "run_runtime_01")
	if run == nil {
		t.Fatalf("run_runtime_01 missing from state")
	}
	if run.Status != "running" {
		t.Fatalf("run status = %q, want running", run.Status)
	}
	if run.ApprovalRequired {
		t.Fatalf("approvalRequired = true, want false")
	}
	if !strings.Contains(run.NextAction, "批准") {
		t.Fatalf("nextAction = %q, want approval language", run.NextAction)
	}
	if _, ok := findInboxByID(t, payload.State.Inbox, "inbox-approval-runtime"); ok {
		t.Fatalf("approval inbox item still present after approval")
	}
	statusItem, ok := findInboxByTitle(payload.State.Inbox, "高风险动作已批准")
	if !ok || statusItem.Kind != "status" {
		t.Fatalf("status inbox item missing: %#v", payload.State.Inbox)
	}

	decisionPath := filepath.Join(root, "decisions", "ops-12.md")
	decisionBody, err := os.ReadFile(decisionPath)
	if err != nil {
		t.Fatalf("read decision file: %v", err)
	}
	if !strings.Contains(string(decisionBody), "- Current: approved") {
		t.Fatalf("decision file missing approved state:\n%s", string(decisionBody))
	}
}

func TestInboxDecisionRouteResolvesBlockedItem(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	body, err := json.Marshal(map[string]string{"decision": "resolved"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/inbox/inbox-blocked-memory", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST inbox decision error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("blocked resolve status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	run := findRunByID(payload.State, "run_memory_01")
	if run == nil {
		t.Fatalf("run_memory_01 missing from state")
	}
	if run.Status != "running" {
		t.Fatalf("run status = %q, want running", run.Status)
	}
	if _, ok := findInboxByID(t, payload.State.Inbox, "inbox-blocked-memory"); ok {
		t.Fatalf("blocked inbox item still present after resolve")
	}
	statusItem, ok := findInboxByTitle(payload.State.Inbox, "阻塞已解除")
	if !ok || statusItem.Kind != "status" {
		t.Fatalf("resolved status inbox item missing: %#v", payload.State.Inbox)
	}

	decisionPath := filepath.Join(root, "decisions", "ops-27.md")
	decisionBody, err := os.ReadFile(decisionPath)
	if err != nil {
		t.Fatalf("read decision file: %v", err)
	}
	if !strings.Contains(string(decisionBody), "- Current: resolved") {
		t.Fatalf("decision file missing resolved state:\n%s", string(decisionBody))
	}

	assertMemoryArtifactSummary(t, payload.State.Memory, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")), "resolved")
}

func TestInboxDecisionRouteSyncsReviewItem(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: &fakeGitHubClient{
			synced: map[int]githubsvc.PullRequest{
				22: {
					Number:         22,
					URL:            "https://github.com/Larkspur-Wang/OpenShock/pull/22",
					Title:          "inbox: unify approval, blocked, and review cards",
					State:          "OPEN",
					HeadRefName:    "feat/inbox-decision-cards",
					BaseRefName:    "main",
					Author:         "ClaudeReviewRunner",
					ReviewDecision: "CHANGES_REQUESTED",
				},
			},
		},
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]string{"decision": "changes_requested"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/inbox/inbox-review-copy", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST inbox review decision error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("review decision status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if _, ok := findInboxByID(t, payload.State.Inbox, "inbox-review-copy"); ok {
		t.Fatalf("old review inbox item still present after review sync")
	}
	pullRequest, ok := findPullRequestByID(payload.State, "pr-inbox-22")
	if !ok {
		t.Fatalf("pr-inbox-22 missing from state")
	}
	if pullRequest.Status != "changes_requested" {
		t.Fatalf("pull request status = %q, want changes_requested", pullRequest.Status)
	}
	issue := findIssueByRoomID(payload.State, "room-inbox")
	if issue == nil {
		t.Fatalf("OPS-19 missing from state")
	}
	if issue.State != "blocked" {
		t.Fatalf("issue state = %q, want blocked", issue.State)
	}
	blockedItem, ok := findInboxByTitle(payload.State.Inbox, "PR #22 需要补充修改")
	if !ok || blockedItem.Kind != "blocked" {
		t.Fatalf("changes requested inbox item missing: %#v", payload.State.Inbox)
	}
}

func TestInboxDecisionRouteReturnsFailureContractForReviewSyncFailure(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        &fakeGitHubClient{syncErr: errors.New("synthetic github sync failure")},
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]string{"decision": "changes_requested"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/inbox/inbox-review-copy", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST inbox review decision error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("review sync failure status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error         string      `json:"error"`
		Operation     string      `json:"operation"`
		RoomID        string      `json:"roomId"`
		PullRequestID string      `json:"pullRequestId"`
		State         store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Error != "synthetic github sync failure" || payload.Operation != "sync" || payload.RoomID != "room-inbox" || payload.PullRequestID != "pr-inbox-22" {
		t.Fatalf("review sync failure payload = %#v, want failure contract fields populated", payload)
	}
	pullRequest, ok := findPullRequestByID(payload.State, payload.PullRequestID)
	if !ok {
		t.Fatalf("pull request %q missing from failure payload", payload.PullRequestID)
	}
	if pullRequest.Status != "changes_requested" || !strings.Contains(pullRequest.ReviewSummary, "PR #22 同步失败：synthetic github sync failure") {
		t.Fatalf("pull request failure surface = %#v, want GitHub failure semantics", pullRequest)
	}
	run := findRunByID(payload.State, "run_inbox_01")
	if run == nil {
		t.Fatalf("run_inbox_01 missing from failure payload")
	}
	if run.Status != "blocked" || !strings.Contains(run.NextAction, "重试同步") {
		t.Fatalf("run failure state = %#v, want blocked + retry guidance", run)
	}
	if _, ok := findInboxByID(t, payload.State.Inbox, "inbox-review-copy"); ok {
		t.Fatalf("stale review inbox item remained after review sync failure")
	}
	blockedItem, ok := findInboxByTitle(payload.State.Inbox, "PR #22 同步失败")
	if !ok || blockedItem.Kind != "blocked" {
		t.Fatalf("blocked inbox item missing from failure payload: %#v", payload.State.Inbox)
	}
}

func findInboxByID(t *testing.T, items []store.InboxItem, inboxItemID string) (store.InboxItem, bool) {
	t.Helper()
	for _, item := range items {
		if item.ID == inboxItemID {
			return item, true
		}
	}
	return store.InboxItem{}, false
}

func findInboxByTitle(items []store.InboxItem, title string) (store.InboxItem, bool) {
	for _, item := range items {
		if item.Title == title {
			return item, true
		}
	}
	return store.InboxItem{}, false
}
