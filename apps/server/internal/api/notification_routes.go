package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type NotificationPolicyRequest struct {
	BrowserPush string `json:"browserPush"`
	Email       string `json:"email"`
}

type NotificationSubscriberRequest struct {
	ID         string `json:"id,omitempty"`
	Channel    string `json:"channel"`
	Target     string `json:"target"`
	Label      string `json:"label"`
	Preference string `json:"preference"`
	Status     string `json:"status"`
	Source     string `json:"source"`
}

func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/v1/notifications":
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, s.store.NotificationCenter())
	case r.URL.Path == "/v1/notifications/policy":
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, s.store.NotificationCenter().Policy)
		case http.MethodPost:
			var req NotificationPolicyRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			nextState, policy, notifications, err := s.store.UpdateNotificationPolicy(store.NotificationPolicyInput{
				BrowserPush: req.BrowserPush,
				Email:       req.Email,
			})
			if err != nil {
				writeNotificationError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"policy": policy, "notifications": notifications, "state": nextState})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	case r.URL.Path == "/v1/notifications/subscribers":
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, s.store.NotificationCenter().Subscribers)
		case http.MethodPost:
			var req NotificationSubscriberRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			nextState, subscriber, notifications, created, err := s.store.UpsertNotificationSubscriber(store.NotificationSubscriberUpsertInput{
				ID:         req.ID,
				Channel:    req.Channel,
				Target:     req.Target,
				Label:      req.Label,
				Preference: req.Preference,
				Status:     req.Status,
				Source:     req.Source,
			})
			if err != nil {
				writeNotificationError(w, err)
				return
			}
			status := http.StatusOK
			if created {
				status = http.StatusCreated
			}
			writeJSON(w, status, map[string]any{"subscriber": subscriber, "notifications": notifications, "state": nextState})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	case strings.HasPrefix(r.URL.Path, "/v1/notifications/subscribers/"):
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		subscriberID := strings.TrimPrefix(r.URL.Path, "/v1/notifications/subscribers/")
		if strings.TrimSpace(subscriberID) == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "notification subscriber not found"})
			return
		}
		subscriber, ok := s.store.NotificationSubscriber(subscriberID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "notification subscriber not found"})
			return
		}
		writeJSON(w, http.StatusOK, subscriber)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (s *Server) handleApprovalCenter(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.NotificationCenter().ApprovalCenter)
}

func writeNotificationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotificationChannelInvalid),
		errors.Is(err, store.ErrNotificationTargetRequired),
		errors.Is(err, store.ErrNotificationPreferenceInvalid),
		errors.Is(err, store.ErrNotificationPolicyInvalid),
		errors.Is(err, store.ErrNotificationSubscriberStatusInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrNotificationSubscriberNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
