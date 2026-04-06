package api

import (
	"errors"
	"io"
	"net/http"
	"strings"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type GitHubWebhookResponse struct {
	DeliveryID    string                            `json:"deliveryId,omitempty"`
	Event         *githubsvc.NormalizedWebhookEvent `json:"event,omitempty"`
	PullRequestID string                            `json:"pullRequestId,omitempty"`
	State         *store.State                      `json:"state,omitempty"`
	Ignored       bool                              `json:"ignored,omitempty"`
	Reason        string                            `json:"reason,omitempty"`
}

func (s *Server) handleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if strings.TrimSpace(s.githubWebhookSecret) == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "github webhook secret not configured"})
		return
	}

	deliveryID := strings.TrimSpace(r.Header.Get("X-GitHub-Delivery"))
	if deliveryID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing github webhook delivery id"})
		return
	}

	eventType := strings.TrimSpace(r.Header.Get("X-GitHub-Event"))
	if eventType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing github event type"})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid webhook body"})
		return
	}

	if err := githubsvc.VerifyWebhookSignature(s.githubWebhookSecret, body, r.Header.Get("X-Hub-Signature-256")); err != nil {
		switch {
		case errors.Is(err, githubsvc.ErrWebhookSecretNotConfigured):
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		case errors.Is(err, githubsvc.ErrMissingWebhookSignature), errors.Is(err, githubsvc.ErrInvalidWebhookSignature):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return
	}

	normalized, err := githubsvc.NormalizeWebhookEvent(deliveryID, eventType, body)
	if err != nil {
		var ignored *githubsvc.IgnoredWebhookEventError
		if errors.As(err, &ignored) {
			writeJSON(w, http.StatusAccepted, GitHubWebhookResponse{
				DeliveryID: deliveryID,
				Ignored:    true,
				Reason:     ignored.Error(),
			})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	nextState, pullRequestID, err := s.store.ApplyGitHubWebhookEvent(normalized)
	if err != nil {
		var ignored *store.IgnoredGitHubWebhookSyncError
		if errors.As(err, &ignored) {
			writeJSON(w, http.StatusAccepted, GitHubWebhookResponse{
				DeliveryID: deliveryID,
				Event:      &normalized,
				Ignored:    true,
				Reason:     ignored.Error(),
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, GitHubWebhookResponse{
		DeliveryID:    deliveryID,
		Event:         &normalized,
		PullRequestID: pullRequestID,
		State:         &nextState,
	})
}
