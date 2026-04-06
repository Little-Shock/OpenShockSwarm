package github

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
)

func TestVerifyWebhookSignatureAcceptsValidHMAC(t *testing.T) {
	body := []byte(`{"action":"opened"}`)
	signature := webhookSignature("super-secret", body)
	if err := VerifyWebhookSignature("super-secret", body, signature); err != nil {
		t.Fatalf("VerifyWebhookSignature() error = %v", err)
	}
}

func TestVerifyWebhookSignatureRejectsBadSignature(t *testing.T) {
	body := []byte(`{"action":"opened"}`)
	err := VerifyWebhookSignature("super-secret", body, "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if !errors.Is(err, ErrInvalidWebhookSignature) {
		t.Fatalf("VerifyWebhookSignature() error = %v, want ErrInvalidWebhookSignature", err)
	}
}

func TestNormalizeWebhookEventRecognizesMergedPullRequest(t *testing.T) {
	payload := []byte(`{"action":"closed","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"merge-bot"},"pull_request":{"number":58,"title":"merge runtime","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/58","state":"closed","merged":true,"head":{"ref":"feat/runtime","sha":"abc123"},"base":{"ref":"main"}}}`)
	event, err := NormalizeWebhookEvent("delivery-merge", "pull_request", payload)
	if err != nil {
		t.Fatalf("NormalizeWebhookEvent() error = %v", err)
	}
	if event.Kind != "merge" || event.PullRequestState != "merged" {
		t.Fatalf("event = %#v, want merge/merged", event)
	}
}

func TestNormalizeWebhookEventNormalizesReviewDecision(t *testing.T) {
	payload := []byte(`{"action":"submitted","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"review-bot"},"pull_request":{"number":42,"title":"runtime: surface heartbeat","html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42","state":"open","merged":false,"head":{"ref":"feat/runtime-shell","sha":"abc123"},"base":{"ref":"main"}},"review":{"state":"changes_requested","body":"needs changes"}}`)
	event, err := NormalizeWebhookEvent("delivery-review", "pull_request_review", payload)
	if err != nil {
		t.Fatalf("NormalizeWebhookEvent() error = %v", err)
	}
	if event.Kind != "review" || event.ReviewDecision != "CHANGES_REQUESTED" || event.PullRequestNumber != 42 {
		t.Fatalf("event = %#v, want normalized review decision", event)
	}
}

func TestNormalizeWebhookEventIgnoresIssueCommentWithoutPullRequest(t *testing.T) {
	payload := []byte(`{"action":"created","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"comment-bot"},"issue":{"number":7,"title":"plain issue"},"comment":{"body":"hello"}}`)
	_, err := NormalizeWebhookEvent("delivery-comment", "issue_comment", payload)
	var ignored *IgnoredWebhookEventError
	if !errors.As(err, &ignored) {
		t.Fatalf("NormalizeWebhookEvent() error = %v, want IgnoredWebhookEventError", err)
	}
}

func TestNormalizeWebhookEventNormalizesCheckRun(t *testing.T) {
	payload := []byte(`{"action":"completed","repository":{"full_name":"Larkspur-Wang/OpenShock"},"sender":{"login":"checks-bot"},"check_run":{"name":"ci / unit","status":"completed","conclusion":"success","head_sha":"abc123","pull_requests":[{"number":42,"html_url":"https://github.com/Larkspur-Wang/OpenShock/pull/42"}]}}`)
	event, err := NormalizeWebhookEvent("delivery-check", "check_run", payload)
	if err != nil {
		t.Fatalf("NormalizeWebhookEvent() error = %v", err)
	}
	if event.Kind != "check" || event.CheckConclusion != "success" || event.PullRequestNumber != 42 {
		t.Fatalf("event = %#v, want normalized check run", event)
	}
}

func webhookSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
