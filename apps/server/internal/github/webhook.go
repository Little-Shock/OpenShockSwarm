package github

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrWebhookSecretNotConfigured = errors.New("github webhook secret not configured")
	ErrMissingWebhookSignature    = errors.New("missing github webhook signature")
	ErrMalformedWebhookSignature  = errors.New("malformed github webhook signature")
	ErrInvalidWebhookSignature    = errors.New("invalid github webhook signature")
)

type IgnoredWebhookEventError struct {
	Reason string
}

func (e *IgnoredWebhookEventError) Error() string {
	return e.Reason
}

type NormalizedWebhookEvent struct {
	DeliveryID        string `json:"deliveryId"`
	Event             string `json:"event"`
	Kind              string `json:"kind"`
	Action            string `json:"action"`
	Repository        string `json:"repository"`
	Sender            string `json:"sender,omitempty"`
	PullRequestNumber int    `json:"pullRequestNumber,omitempty"`
	PullRequestTitle  string `json:"pullRequestTitle,omitempty"`
	PullRequestURL    string `json:"pullRequestUrl,omitempty"`
	PullRequestState  string `json:"pullRequestState,omitempty"`
	PullRequestMerged bool   `json:"pullRequestMerged,omitempty"`
	ReviewState       string `json:"reviewState,omitempty"`
	ReviewDecision    string `json:"reviewDecision,omitempty"`
	CommentBody       string `json:"commentBody,omitempty"`
	CheckName         string `json:"checkName,omitempty"`
	CheckStatus       string `json:"checkStatus,omitempty"`
	CheckConclusion   string `json:"checkConclusion,omitempty"`
	HeadBranch        string `json:"headBranch,omitempty"`
	BaseBranch        string `json:"baseBranch,omitempty"`
	CommitSHA         string `json:"commitSha,omitempty"`
}

type webhookRepository struct {
	FullName string `json:"full_name"`
}

type webhookSender struct {
	Login string `json:"login"`
}

type webhookBranchRef struct {
	Ref string `json:"ref"`
	SHA string `json:"sha"`
}

type webhookPullRequest struct {
	Number  int              `json:"number"`
	Title   string           `json:"title"`
	HTMLURL string           `json:"html_url"`
	State   string           `json:"state"`
	Merged  bool             `json:"merged"`
	Head    webhookBranchRef `json:"head"`
	Base    webhookBranchRef `json:"base"`
}

type webhookReferencedPullRequest struct {
	Number  int    `json:"number"`
	HTMLURL string `json:"html_url"`
}

func VerifyWebhookSignature(secret string, body []byte, signature string) error {
	if strings.TrimSpace(secret) == "" {
		return ErrWebhookSecretNotConfigured
	}

	signed := strings.TrimSpace(signature)
	if signed == "" {
		return ErrMissingWebhookSignature
	}

	parts := strings.SplitN(signed, "=", 2)
	if len(parts) != 2 || !strings.EqualFold(strings.TrimSpace(parts[0]), "sha256") {
		return ErrMalformedWebhookSignature
	}

	provided, err := hex.DecodeString(strings.TrimSpace(parts[1]))
	if err != nil || len(provided) != sha256.Size {
		return ErrMalformedWebhookSignature
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return ErrInvalidWebhookSignature
	}
	return nil
}

func NormalizeWebhookEvent(deliveryID, eventType string, payload []byte) (NormalizedWebhookEvent, error) {
	switch strings.TrimSpace(eventType) {
	case "pull_request":
		return normalizePullRequestEvent(deliveryID, eventType, payload)
	case "pull_request_review":
		return normalizePullRequestReviewEvent(deliveryID, eventType, payload)
	case "issue_comment":
		return normalizeIssueCommentEvent(deliveryID, eventType, payload)
	case "check_run":
		return normalizeCheckRunEvent(deliveryID, eventType, payload)
	case "check_suite":
		return normalizeCheckSuiteEvent(deliveryID, eventType, payload)
	default:
		return NormalizedWebhookEvent{}, &IgnoredWebhookEventError{Reason: fmt.Sprintf("unsupported github event %q", strings.TrimSpace(eventType))}
	}
}

func normalizePullRequestEvent(deliveryID, eventType string, payload []byte) (NormalizedWebhookEvent, error) {
	var body struct {
		Action      string             `json:"action"`
		Repository  webhookRepository  `json:"repository"`
		Sender      webhookSender      `json:"sender"`
		PullRequest webhookPullRequest `json:"pull_request"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return NormalizedWebhookEvent{}, fmt.Errorf("decode github webhook payload: %w", err)
	}

	event := newPullRequestBackedEvent(deliveryID, eventType, body.Repository.FullName, body.Action, body.Sender.Login, body.PullRequest)
	if event.Kind != "merge" {
		event.Kind = "pull_request"
	}
	if err := validateNormalizedEvent(event, false); err != nil {
		return NormalizedWebhookEvent{}, err
	}
	return event, nil
}

func normalizePullRequestReviewEvent(deliveryID, eventType string, payload []byte) (NormalizedWebhookEvent, error) {
	var body struct {
		Action      string             `json:"action"`
		Repository  webhookRepository  `json:"repository"`
		Sender      webhookSender      `json:"sender"`
		PullRequest webhookPullRequest `json:"pull_request"`
		Review      struct {
			State string `json:"state"`
			Body  string `json:"body"`
		} `json:"review"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return NormalizedWebhookEvent{}, fmt.Errorf("decode github webhook payload: %w", err)
	}

	event := newPullRequestBackedEvent(deliveryID, eventType, body.Repository.FullName, body.Action, body.Sender.Login, body.PullRequest)
	event.Kind = "review"
	event.ReviewState = strings.ToLower(strings.TrimSpace(body.Review.State))
	event.ReviewDecision = normalizeReviewDecision(body.Review.State)
	event.CommentBody = strings.TrimSpace(body.Review.Body)
	if err := validateNormalizedEvent(event, true); err != nil {
		return NormalizedWebhookEvent{}, err
	}
	return event, nil
}

func normalizeIssueCommentEvent(deliveryID, eventType string, payload []byte) (NormalizedWebhookEvent, error) {
	var body struct {
		Action     string            `json:"action"`
		Repository webhookRepository `json:"repository"`
		Sender     webhookSender     `json:"sender"`
		Issue      struct {
			Number      int    `json:"number"`
			Title       string `json:"title"`
			PullRequest *struct {
				HTMLURL string `json:"html_url"`
			} `json:"pull_request"`
		} `json:"issue"`
		Comment struct {
			Body string `json:"body"`
		} `json:"comment"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return NormalizedWebhookEvent{}, fmt.Errorf("decode github webhook payload: %w", err)
	}
	if body.Issue.PullRequest == nil {
		return NormalizedWebhookEvent{}, &IgnoredWebhookEventError{Reason: "issue_comment is not attached to a pull request"}
	}

	event := NormalizedWebhookEvent{
		DeliveryID:        strings.TrimSpace(deliveryID),
		Event:             strings.TrimSpace(eventType),
		Kind:              "comment",
		Action:            strings.TrimSpace(body.Action),
		Repository:        strings.TrimSpace(body.Repository.FullName),
		Sender:            strings.TrimSpace(body.Sender.Login),
		PullRequestNumber: body.Issue.Number,
		PullRequestTitle:  strings.TrimSpace(body.Issue.Title),
		PullRequestURL:    strings.TrimSpace(body.Issue.PullRequest.HTMLURL),
		CommentBody:       strings.TrimSpace(body.Comment.Body),
	}
	if err := validateNormalizedEvent(event, false); err != nil {
		return NormalizedWebhookEvent{}, err
	}
	return event, nil
}

func normalizeCheckRunEvent(deliveryID, eventType string, payload []byte) (NormalizedWebhookEvent, error) {
	var body struct {
		Action     string            `json:"action"`
		Repository webhookRepository `json:"repository"`
		Sender     webhookSender     `json:"sender"`
		CheckRun   struct {
			Name         string                         `json:"name"`
			Status       string                         `json:"status"`
			Conclusion   string                         `json:"conclusion"`
			HeadSHA      string                         `json:"head_sha"`
			PullRequests []webhookReferencedPullRequest `json:"pull_requests"`
		} `json:"check_run"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return NormalizedWebhookEvent{}, fmt.Errorf("decode github webhook payload: %w", err)
	}

	pr, err := referencedPullRequest(body.CheckRun.PullRequests, "check_run")
	if err != nil {
		return NormalizedWebhookEvent{}, err
	}

	event := NormalizedWebhookEvent{
		DeliveryID:        strings.TrimSpace(deliveryID),
		Event:             strings.TrimSpace(eventType),
		Kind:              "check",
		Action:            strings.TrimSpace(body.Action),
		Repository:        strings.TrimSpace(body.Repository.FullName),
		Sender:            strings.TrimSpace(body.Sender.Login),
		PullRequestNumber: pr.Number,
		PullRequestURL:    strings.TrimSpace(pr.HTMLURL),
		CheckName:         strings.TrimSpace(body.CheckRun.Name),
		CheckStatus:       strings.ToLower(strings.TrimSpace(body.CheckRun.Status)),
		CheckConclusion:   strings.ToLower(strings.TrimSpace(body.CheckRun.Conclusion)),
		CommitSHA:         strings.TrimSpace(body.CheckRun.HeadSHA),
	}
	if err := validateNormalizedEvent(event, false); err != nil {
		return NormalizedWebhookEvent{}, err
	}
	return event, nil
}

func normalizeCheckSuiteEvent(deliveryID, eventType string, payload []byte) (NormalizedWebhookEvent, error) {
	var body struct {
		Action     string            `json:"action"`
		Repository webhookRepository `json:"repository"`
		Sender     webhookSender     `json:"sender"`
		CheckSuite struct {
			HeadBranch   string                         `json:"head_branch"`
			HeadSHA      string                         `json:"head_sha"`
			Status       string                         `json:"status"`
			Conclusion   string                         `json:"conclusion"`
			PullRequests []webhookReferencedPullRequest `json:"pull_requests"`
		} `json:"check_suite"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return NormalizedWebhookEvent{}, fmt.Errorf("decode github webhook payload: %w", err)
	}

	pr, err := referencedPullRequest(body.CheckSuite.PullRequests, "check_suite")
	if err != nil {
		return NormalizedWebhookEvent{}, err
	}

	event := NormalizedWebhookEvent{
		DeliveryID:        strings.TrimSpace(deliveryID),
		Event:             strings.TrimSpace(eventType),
		Kind:              "check",
		Action:            strings.TrimSpace(body.Action),
		Repository:        strings.TrimSpace(body.Repository.FullName),
		Sender:            strings.TrimSpace(body.Sender.Login),
		PullRequestNumber: pr.Number,
		PullRequestURL:    strings.TrimSpace(pr.HTMLURL),
		CheckName:         "check_suite",
		CheckStatus:       strings.ToLower(strings.TrimSpace(body.CheckSuite.Status)),
		CheckConclusion:   strings.ToLower(strings.TrimSpace(body.CheckSuite.Conclusion)),
		HeadBranch:        strings.TrimSpace(body.CheckSuite.HeadBranch),
		CommitSHA:         strings.TrimSpace(body.CheckSuite.HeadSHA),
	}
	if err := validateNormalizedEvent(event, false); err != nil {
		return NormalizedWebhookEvent{}, err
	}
	return event, nil
}

func referencedPullRequest(items []webhookReferencedPullRequest, eventType string) (webhookReferencedPullRequest, error) {
	if len(items) == 0 {
		return webhookReferencedPullRequest{}, &IgnoredWebhookEventError{Reason: fmt.Sprintf("%s is not attached to a pull request", strings.TrimSpace(eventType))}
	}
	if items[0].Number <= 0 {
		return webhookReferencedPullRequest{}, fmt.Errorf("%s payload missing pull request number", strings.TrimSpace(eventType))
	}
	return items[0], nil
}

func newPullRequestBackedEvent(deliveryID, eventType, repository, action, sender string, pullRequest webhookPullRequest) NormalizedWebhookEvent {
	kind := "pull_request"
	if strings.EqualFold(strings.TrimSpace(action), "closed") && pullRequest.Merged {
		kind = "merge"
	}
	return NormalizedWebhookEvent{
		DeliveryID:        strings.TrimSpace(deliveryID),
		Event:             strings.TrimSpace(eventType),
		Kind:              kind,
		Action:            strings.TrimSpace(action),
		Repository:        strings.TrimSpace(repository),
		Sender:            strings.TrimSpace(sender),
		PullRequestNumber: pullRequest.Number,
		PullRequestTitle:  strings.TrimSpace(pullRequest.Title),
		PullRequestURL:    strings.TrimSpace(pullRequest.HTMLURL),
		PullRequestState:  normalizePullRequestState(pullRequest.State, pullRequest.Merged),
		PullRequestMerged: pullRequest.Merged,
		HeadBranch:        strings.TrimSpace(pullRequest.Head.Ref),
		BaseBranch:        strings.TrimSpace(pullRequest.Base.Ref),
		CommitSHA:         strings.TrimSpace(pullRequest.Head.SHA),
	}
}

func validateNormalizedEvent(event NormalizedWebhookEvent, requireReviewState bool) error {
	if event.DeliveryID == "" {
		return fmt.Errorf("missing github webhook delivery id")
	}
	if event.Event == "" {
		return fmt.Errorf("missing github event type")
	}
	if event.Action == "" {
		return fmt.Errorf("%s payload missing action", event.Event)
	}
	if event.Repository == "" {
		return fmt.Errorf("%s payload missing repository full name", event.Event)
	}
	if event.PullRequestNumber <= 0 {
		return fmt.Errorf("%s payload missing pull request number", event.Event)
	}
	if requireReviewState && event.ReviewState == "" {
		return fmt.Errorf("%s payload missing review state", event.Event)
	}
	return nil
}

func normalizePullRequestState(state string, merged bool) string {
	if merged {
		return "merged"
	}
	return strings.ToLower(strings.TrimSpace(state))
}

func normalizeReviewDecision(state string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(state), " ", "_"))
}
