package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestGitHubWebhookRouteNormalizesPullRequestReviewEvent(t *testing.T) {
	server, _, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 42)
	defer server.Close()

	payload := []byte(`{"action":"submitted","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":42,"title":"runtime: surface heartbeat","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"review":{"state":"approved","body":"looks good"}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-42")
	req.Header.Set("X-GitHub-Event", "pull_request_review")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var response GitHubWebhookResponse
	decodeJSON(t, resp, &response)
	if response.Event == nil {
		t.Fatal("response.Event = nil, want normalized event")
	}
	if response.Event.Kind != "review" || response.Event.ReviewDecision != "APPROVED" {
		t.Fatalf("normalized review event = %#v, want review+APPROVED", response.Event)
	}
	if response.Event.Repository != "Larkspur-Wang/OpenShock" || response.Event.PullRequestNumber != 42 {
		t.Fatalf("normalized event missing repo/pr identity: %#v", response.Event)
	}
}

func TestGitHubWebhookRouteRejectsBadSignature(t *testing.T) {
	server := newGitHubWebhookTestServer(t, "super-secret")
	defer server.Close()

	payload := []byte(`{"action":"opened","repository":{"full_name":"Larkspur-Wang/OpenShock"},"pull_request":{"number":42,"title":"runtime: surface heartbeat","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-bad-signature")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("wrong-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	var body map[string]string
	decodeJSON(t, resp, &body)
	if body["error"] != githubsvc.ErrInvalidWebhookSignature.Error() {
		t.Fatalf("error = %q, want %q", body["error"], githubsvc.ErrInvalidWebhookSignature.Error())
	}
}

func TestGitHubWebhookRouteRejectsMalformedPayload(t *testing.T) {
	server := newGitHubWebhookTestServer(t, "super-secret")
	defer server.Close()

	payload := []byte(`{"action":`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-bad-json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestGitHubWebhookRouteIgnoresNonPullRequestIssueComment(t *testing.T) {
	server := newGitHubWebhookTestServer(t, "super-secret")
	defer server.Close()

	payload := []byte(`{"action":"created","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"comment-bot"},"issue":{"number":7,"title":"plain issue"},"comment":{"body":"not a pr"}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-ignore")
	req.Header.Set("X-GitHub-Event", "issue_comment")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	var response GitHubWebhookResponse
	decodeJSON(t, resp, &response)
	if !response.Ignored || !strings.Contains(response.Reason, "not attached to a pull request") {
		t.Fatalf("ignored response = %#v, want ignored reason", response)
	}
}

func TestGitHubWebhookRouteRequiresHeaders(t *testing.T) {
	server := newGitHubWebhookTestServer(t, "super-secret")
	defer server.Close()

	payload := []byte(`{}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestGitHubWebhookRouteSyncsReviewEventIntoState(t *testing.T) {
	server, tracked, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 42)
	defer server.Close()

	payload := []byte(`{"action":"submitted","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":42,"title":"runtime: surface heartbeat","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"review":{"state":"changes_requested","body":"needs tests"}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-review-sync")
	req.Header.Set("X-GitHub-Event", "pull_request_review")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var response struct {
		GitHubWebhookResponse
	}
	decodeJSON(t, resp, &response)
	if response.PullRequestID != tracked.PullRequestID || response.State == nil || response.Event == nil {
		t.Fatalf("response = %#v, want pull request + state + event", response)
	}

	pullRequest, ok := findPullRequestByID(*response.State, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from state", tracked.PullRequestID)
	}
	if pullRequest.Status != "changes_requested" || pullRequest.ReviewDecision != "CHANGES_REQUESTED" {
		t.Fatalf("pull request = %#v, want changes_requested + CHANGES_REQUESTED", pullRequest)
	}
	if !strings.Contains(pullRequest.ReviewSummary, "needs tests") {
		t.Fatalf("review summary = %q, want synced review body", pullRequest.ReviewSummary)
	}

	issue := findIssueByRoomID(*response.State, tracked.RoomID)
	room := findRoomByID(*response.State, tracked.RoomID)
	if issue == nil || room == nil {
		t.Fatalf("expected issue/room for tracked webhook sync")
	}
	if issue.State != "blocked" || room.Topic.Status != "blocked" {
		t.Fatalf("issue/room state = (%#v, %#v), want blocked", issue, room)
	}
	if countInboxItems(*response.State, "blocked", "PR #42 需要补充修改", "/rooms/"+tracked.RoomID) != 1 {
		t.Fatalf("blocked inbox surface malformed: %#v", response.State.Inbox)
	}
	if inboxHasKindAndHref(*response.State, "review", "/rooms/"+tracked.RoomID+"/runs/"+tracked.RunID) {
		t.Fatalf("stale review inbox item remained after webhook review sync: %#v", response.State.Inbox)
	}
}

func TestGitHubWebhookRouteSyncsMergeEventIntoDoneState(t *testing.T) {
	server, tracked, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 58)
	defer server.Close()

	payload := []byte(`{"action":"closed","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"merge-bot"},"pull_request":{"number":58,"title":"runtime: surface heartbeat","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/58","state":"closed","merged":true,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-merge-sync")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var response struct {
		GitHubWebhookResponse
	}
	decodeJSON(t, resp, &response)
	if response.State == nil {
		t.Fatalf("response state missing: %#v", response)
	}

	pullRequest, ok := findPullRequestByID(*response.State, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from state", tracked.PullRequestID)
	}
	if pullRequest.Status != "merged" {
		t.Fatalf("pull request status = %q, want merged", pullRequest.Status)
	}
	issue := findIssueByRoomID(*response.State, tracked.RoomID)
	run := findRunByID(*response.State, tracked.RunID)
	room := findRoomByID(*response.State, tracked.RoomID)
	if issue == nil || run == nil || room == nil {
		t.Fatalf("expected issue/run/room after merge webhook")
	}
	if issue.State != "done" || run.Status != "done" || room.Topic.Status != "done" {
		t.Fatalf("merge writeback malformed: issue=%#v run=%#v room=%#v", issue, run, room)
	}
	if countInboxItems(*response.State, "status", "PR #58 已合并", "/rooms/"+tracked.RoomID+"/runs/"+tracked.RunID) != 1 {
		t.Fatalf("merged inbox surface malformed: %#v", response.State.Inbox)
	}
}

func TestGitHubWebhookRouteSyncsReviewCommentIntoPullRequestConversation(t *testing.T) {
	server, tracked, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 42)
	defer server.Close()

	payload := []byte(`{"action":"created","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":42,"title":"Webhook Event Sync","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"comment":{"id":9001,"body":"please add PR detail backlinks","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42#discussion_r9001","path":"apps/web/src/components/stitch-board-inbox-views.tsx","line":612,"updated_at":"2026-04-09T01:25:00Z","user":{"login":"review-bot"}}}`)

	response := postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-review-comment", "pull_request_review_comment", payload)
	if response.State == nil {
		t.Fatal("response.State = nil, want updated state")
	}

	pullRequest, ok := findPullRequestByID(*response.State, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from state", tracked.PullRequestID)
	}

	entry, ok := findPullRequestConversationEntry(pullRequest, "review_comment:9001")
	if !ok {
		t.Fatalf("pull request conversation = %#v, want review_comment:9001", pullRequest.Conversation)
	}
	if entry.Kind != "review_comment" || entry.Author != "review-bot" {
		t.Fatalf("conversation entry = %#v, want review_comment by review-bot", entry)
	}
	if entry.Path != "apps/web/src/components/stitch-board-inbox-views.tsx" || entry.Line != 612 {
		t.Fatalf("conversation location = %#v, want stitched inbox path + line", entry)
	}
	if !strings.Contains(entry.Summary, "review comment") {
		t.Fatalf("conversation summary = %q, want review comment wording", entry.Summary)
	}
}

func TestGitHubWebhookRouteUpsertsRepeatedReviewCommentReplay(t *testing.T) {
	server, tracked, stateStore := newTrackedGitHubWebhookTestServer(t, "super-secret", 77)
	defer server.Close()

	payload := []byte(`{"action":"created","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":77,"title":"Webhook Event Sync","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/77","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"comment":{"id":9101,"body":"same review comment replay","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/77#discussion_r9101","path":"apps/server/internal/api/server.go","line":742,"updated_at":"2026-04-09T01:31:00Z","user":{"login":"review-bot"}}}`)

	postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-review-comment-r1", "pull_request_review_comment", payload)
	postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-review-comment-r2", "pull_request_review_comment", payload)

	snapshot := stateStore.Snapshot()
	pullRequest, ok := findPullRequestByID(snapshot, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from snapshot", tracked.PullRequestID)
	}
	if countPullRequestConversationEntries(pullRequest, "review_comment:9101") != 1 {
		t.Fatalf("pull request conversation = %#v, want exactly one replayed review comment entry", pullRequest.Conversation)
	}
}

func TestGitHubWebhookRouteSyncsReviewThreadResolutionIntoPullRequestConversation(t *testing.T) {
	server, tracked, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 66)
	defer server.Close()

	payload := []byte(`{"action":"resolved","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":66,"title":"Webhook Event Sync","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/66","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"thread":{"id":7001,"path":"apps/web/src/components/stitch-chat-room-views.tsx","line":1048,"resolved":true,"comments":[{"body":"looks good now","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/66#discussion_r7001","updated_at":"2026-04-09T01:42:00Z"}]}}`)

	response := postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-review-thread", "pull_request_review_thread", payload)
	if response.State == nil {
		t.Fatal("response.State = nil, want updated state")
	}

	pullRequest, ok := findPullRequestByID(*response.State, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from state", tracked.PullRequestID)
	}

	entry, ok := findPullRequestConversationEntry(pullRequest, "review_thread:7001")
	if !ok {
		t.Fatalf("pull request conversation = %#v, want review_thread:7001", pullRequest.Conversation)
	}
	if entry.ThreadStatus != "resolved" {
		t.Fatalf("conversation entry = %#v, want resolved thread status", entry)
	}
	if entry.Path != "apps/web/src/components/stitch-chat-room-views.tsx" || entry.Line != 1048 {
		t.Fatalf("conversation location = %#v, want PR thread location", entry)
	}
}

func TestGitHubWebhookRouteIgnoresUntrackedPullRequestEvents(t *testing.T) {
	server := newGitHubWebhookTestServer(t, "super-secret")
	defer server.Close()

	payload := []byte(`{"action":"submitted","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":404,"title":"missing pr","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/404","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"review":{"state":"approved","body":"looks good"}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-untracked")
	req.Header.Set("X-GitHub-Event", "pull_request_review")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	var response GitHubWebhookResponse
	decodeJSON(t, resp, &response)
	if !response.Ignored || !strings.Contains(response.Reason, "not tracked") {
		t.Fatalf("ignored response = %#v, want explicit untracked contract", response)
	}
	if response.Event == nil || response.Event.PullRequestNumber != 404 {
		t.Fatalf("ignored response missing normalized event: %#v", response)
	}
}

func TestGitHubWebhookRouteIgnoresCrossRepoPullRequestWithSameNumber(t *testing.T) {
	server, tracked, stateStore := newTrackedGitHubWebhookTestServer(t, "super-secret", 42)
	defer server.Close()

	payload := []byte(`{"action":"submitted","repository":{"full_name":"OtherOrg/OtherRepo"},"sender":{"login":"review-bot"},"pull_request":{"number":42,"title":"Other Repo PR","html_url":"https://github.com/OtherOrg/OtherRepo/pull/42","state":"open","merged":false,"head":{"ref":"feat/other","sha":"abc123"},"base":{"ref":"main"}},"review":{"state":"changes_requested","body":"wrong repo should be ignored"}}`)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", "delivery-cross-repo")
	req.Header.Set("X-GitHub-Event", "pull_request_review")
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature("super-secret", payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	var response GitHubWebhookResponse
	decodeJSON(t, resp, &response)
	if !response.Ignored || !strings.Contains(response.Reason, "not tracked") {
		t.Fatalf("ignored response = %#v, want explicit untracked contract", response)
	}

	snapshot := stateStore.Snapshot()
	pullRequest, ok := findPullRequestByID(snapshot, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from state", tracked.PullRequestID)
	}
	if pullRequest.URL != "https://github.com/Larkspur-Wang/OpenShock/pull/42" {
		t.Fatalf("pull request URL = %q, want original tracked URL", pullRequest.URL)
	}
	if pullRequest.Title != "Webhook Event Sync" {
		t.Fatalf("pull request title = %q, want original tracked title", pullRequest.Title)
	}
	if pullRequest.Status != "in_review" || pullRequest.ReviewDecision != "REVIEW_REQUIRED" {
		t.Fatalf("pull request = %#v, want original in_review review-required state", pullRequest)
	}
	if !strings.Contains(pullRequest.ReviewSummary, "远端 PR 已创建") {
		t.Fatalf("review summary = %q, want original tracked summary", pullRequest.ReviewSummary)
	}
}

func TestGitHubWebhookRoutePreservesBlockedSummaryWhenCommentArrives(t *testing.T) {
	server, tracked, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 66)
	defer server.Close()

	reviewPayload := []byte(`{"action":"submitted","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":66,"title":"runtime: surface heartbeat","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/66","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"review":{"state":"changes_requested","body":"needs tests"}}`)
	reviewResponse := postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-comment-block-review", "pull_request_review", reviewPayload)
	if reviewResponse.State == nil {
		t.Fatalf("review response missing state")
	}

	commentPayload := []byte(`{"action":"created","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"comment-bot"},"issue":{"number":66,"title":"runtime: surface heartbeat","pull_request":{"html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/66"}},"comment":{"body":"please also cover stale runtime"}}`)
	commentResponse := postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-comment-block-comment", "issue_comment", commentPayload)
	if commentResponse.State == nil {
		t.Fatalf("comment response missing state")
	}

	pullRequest, ok := findPullRequestByID(*commentResponse.State, tracked.PullRequestID)
	if !ok {
		t.Fatalf("tracked pull request %q missing from state", tracked.PullRequestID)
	}
	if pullRequest.Status != "changes_requested" || pullRequest.ReviewDecision != "CHANGES_REQUESTED" {
		t.Fatalf("pull request = %#v, want blocked review state preserved", pullRequest)
	}
	if !strings.Contains(pullRequest.ReviewSummary, "GitHub Review 要求补充修改") {
		t.Fatalf("review summary = %q, want blocked semantics preserved", pullRequest.ReviewSummary)
	}
	if strings.Contains(pullRequest.ReviewSummary, "please also cover stale runtime") {
		t.Fatalf("review summary = %q, want comment body not to overwrite blocked summary", pullRequest.ReviewSummary)
	}

	room := findRoomByID(*commentResponse.State, tracked.RoomID)
	run := findRunByID(*commentResponse.State, tracked.RunID)
	if room == nil || run == nil {
		t.Fatalf("expected room/run after blocked comment sync")
	}
	if room.Topic.Status != "blocked" || run.Status != "blocked" {
		t.Fatalf("room/run status = (%#v, %#v), want blocked", room, run)
	}
	if room.Topic.Summary != pullRequest.ReviewSummary || run.Summary != pullRequest.ReviewSummary {
		t.Fatalf("room/run summary = (%q, %q), want blocked summary", room.Topic.Summary, run.Summary)
	}
}

func TestGitHubWebhookRouteDoesNotDuplicateRepeatedCheckEvents(t *testing.T) {
	server, tracked, _ := newTrackedGitHubWebhookTestServer(t, "super-secret", 77)
	defer server.Close()

	payload := []byte(`{"action":"completed","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"checks-bot"},"check_run":{"name":"ci / unit","status":"completed","conclusion":"success","head_sha":"abc123","pull_requests":[{"number":77,"html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/77"}]}}`)

	first := postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-check-1", "check_run", payload)
	second := postGitHubWebhookEvent(t, server.URL, "super-secret", "delivery-check-2", "check_run", payload)

	if first.State == nil || second.State == nil {
		t.Fatalf("expected webhook state payloads for repeated check sync")
	}
	if countInboxItems(*second.State, "review", "PR #77 已准备评审", "/rooms/"+tracked.RoomID+"/runs/"+tracked.RunID) != 1 {
		t.Fatalf("review inbox duplicated after repeated check event: %#v", second.State.Inbox)
	}
	if countRoomMessages(*second.State, tracked.RoomID, "PR #77 已同步到 GitHub 当前状态：in_review。") != 1 {
		t.Fatalf("room sync message duplicated after repeated check event: %#v", second.State.RoomMessages[tracked.RoomID])
	}
	if len(second.State.Inbox) != len(first.State.Inbox) {
		t.Fatalf("inbox length changed after repeated check event: first=%d second=%d", len(first.State.Inbox), len(second.State.Inbox))
	}
}

func newGitHubWebhookTestServer(t *testing.T, secret string) *httptest.Server {
	t.Helper()

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	return httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:           "http://127.0.0.1:65531",
		WorkspaceRoot:       root,
		GitHubWebhookSecret: secret,
	}).Handler())
}

type trackedWebhookFixture struct {
	RoomID        string
	RunID         string
	PullRequestID string
}

func newTrackedGitHubWebhookTestServer(t *testing.T, secret string, pullRequestNumber int) (*httptest.Server, trackedWebhookFixture, *store.Store) {
	t.Helper()

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Webhook Event Sync",
		Summary:  "verify webhook writeback contract",
		Owner:    "Codex Dockmaster",
		Priority: "high",
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
	_, pullRequestID, err := s.CreatePullRequestFromRemote(created.RoomID, store.PullRequestRemoteSnapshot{
		Number:         pullRequestNumber,
		Title:          "Webhook Event Sync",
		Status:         "in_review",
		Branch:         created.Branch,
		BaseBranch:     "main",
		Author:         "CodexDockmaster",
		Provider:       "github",
		URL:            fmt.Sprintf("https://github.com/Larkspur-Wang/OpenShock/pull/%d", pullRequestNumber),
		ReviewDecision: "REVIEW_REQUIRED",
	})
	if err != nil {
		t.Fatalf("CreatePullRequestFromRemote() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:           "http://127.0.0.1:65531",
		WorkspaceRoot:       root,
		GitHubWebhookSecret: secret,
	}).Handler())

	return server, trackedWebhookFixture{
		RoomID:        created.RoomID,
		RunID:         created.RunID,
		PullRequestID: pullRequestID,
	}, s
}

func postGitHubWebhookEvent(t *testing.T, baseURL, secret, deliveryID, eventType string, payload []byte) GitHubWebhookResponse {
	t.Helper()

	req, err := http.NewRequest(http.MethodPost, baseURL+"/v1/github/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("X-GitHub-Delivery", deliveryID)
	req.Header.Set("X-GitHub-Event", eventType)
	req.Header.Set("X-Hub-Signature-256", githubWebhookSignature(secret, payload))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST webhook error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var response GitHubWebhookResponse
	decodeJSON(t, resp, &response)
	return response
}

func findPullRequestConversationEntry(pullRequest store.PullRequest, conversationID string) (store.PullRequestConversationEntry, bool) {
	for _, item := range pullRequest.Conversation {
		if item.ID == conversationID {
			return item, true
		}
	}
	return store.PullRequestConversationEntry{}, false
}

func countPullRequestConversationEntries(pullRequest store.PullRequest, conversationID string) int {
	count := 0
	for _, item := range pullRequest.Conversation {
		if item.ID == conversationID {
			count++
		}
	}
	return count
}

func githubWebhookSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
