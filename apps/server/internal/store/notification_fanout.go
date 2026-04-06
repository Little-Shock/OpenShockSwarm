package store

import (
	"encoding/json"
	"fmt"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	notificationFanoutReceiptStatusSent   = "sent"
	notificationFanoutReceiptStatusFailed = "failed"
)

type NotificationFanoutReceipt struct {
	ID           string `json:"id"`
	DeliveryID   string `json:"deliveryId"`
	InboxItemID  string `json:"inboxItemId"`
	SubscriberID string `json:"subscriberId"`
	Channel      string `json:"channel"`
	Status       string `json:"status"`
	AttemptedAt  string `json:"attemptedAt"`
	DeliveredAt  string `json:"deliveredAt,omitempty"`
	PayloadPath  string `json:"payloadPath,omitempty"`
	Error        string `json:"error,omitempty"`
}

type NotificationFanoutRun struct {
	RanAt     string                      `json:"ranAt"`
	Attempted int                         `json:"attempted"`
	Delivered int                         `json:"delivered"`
	Failed    int                         `json:"failed"`
	Receipts  []NotificationFanoutReceipt `json:"receipts"`
}

type notificationFanoutStateFile struct {
	Receipts []NotificationFanoutReceipt `json:"receipts"`
}

type notificationFanoutPayload struct {
	DeliveryID   string `json:"deliveryId"`
	InboxItemID  string `json:"inboxItemId"`
	SubscriberID string `json:"subscriberId"`
	Channel      string `json:"channel"`
	Target       string `json:"target"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	Href         string `json:"href"`
	Priority     string `json:"priority"`
	AttemptedAt  string `json:"attemptedAt"`
}

func (s *Store) notificationFanoutStatePathLocked() string {
	return filepath.Join(filepath.Dir(s.path), "notification-fanout.json")
}

func (s *Store) notificationFanoutOutboxRootLocked() string {
	return filepath.Join(filepath.Dir(s.path), "notification-outbox")
}

func (s *Store) loadNotificationFanoutStateLocked() (notificationFanoutStateFile, error) {
	body, err := os.ReadFile(s.notificationFanoutStatePathLocked())
	if err != nil {
		if os.IsNotExist(err) {
			return notificationFanoutStateFile{Receipts: []NotificationFanoutReceipt{}}, nil
		}
		return notificationFanoutStateFile{}, err
	}
	if strings.TrimSpace(string(body)) == "" {
		return notificationFanoutStateFile{Receipts: []NotificationFanoutReceipt{}}, nil
	}

	var state notificationFanoutStateFile
	if err := json.Unmarshal(body, &state); err != nil {
		return notificationFanoutStateFile{}, err
	}
	if state.Receipts == nil {
		state.Receipts = []NotificationFanoutReceipt{}
	}
	return state, nil
}

func (s *Store) saveNotificationFanoutStateLocked(state notificationFanoutStateFile) error {
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.notificationFanoutStatePathLocked(), body, 0o644)
}

func (s *Store) DispatchNotificationFanout() (State, NotificationCenter, NotificationFanoutRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadNotificationStateLocked()
	if err != nil {
		return State{}, NotificationCenter{}, NotificationFanoutRun{}, err
	}
	fanoutState, err := s.loadNotificationFanoutStateLocked()
	if err != nil {
		return State{}, NotificationCenter{}, NotificationFanoutRun{}, err
	}

	snapshot := cloneState(s.state)
	center := buildNotificationCenter(snapshot, state)
	now := time.Now().UTC().Format(time.RFC3339)
	run := NotificationFanoutRun{
		RanAt:    now,
		Receipts: []NotificationFanoutReceipt{},
	}

	for _, delivery := range center.Deliveries {
		if delivery.Status != notificationDeliveryStatusReady {
			continue
		}

		run.Attempted++
		receipt := NotificationFanoutReceipt{
			ID:           fmt.Sprintf("fanout-%s", delivery.ID),
			DeliveryID:   delivery.ID,
			InboxItemID:  delivery.InboxItemID,
			SubscriberID: delivery.SubscriberID,
			Channel:      delivery.Channel,
			AttemptedAt:  now,
		}

		index := -1
		for candidate := range state.Subscribers {
			if state.Subscribers[candidate].ID == delivery.SubscriberID {
				index = candidate
				break
			}
		}

		if index == -1 {
			run.Failed++
			receipt.Status = notificationFanoutReceiptStatusFailed
			receipt.Error = "notification subscriber not found"
			fanoutState.Receipts = replaceNotificationFanoutReceipt(fanoutState.Receipts, receipt)
			run.Receipts = append(run.Receipts, receipt)
			continue
		}

		subscriber := state.Subscribers[index]
		payloadPath, err := s.writeNotificationFanoutPayloadLocked(subscriber, delivery, now)
		if err != nil {
			run.Failed++
			subscriber.LastError = err.Error()
			receipt.Status = notificationFanoutReceiptStatusFailed
			receipt.Error = err.Error()
		} else {
			run.Delivered++
			subscriber.LastDeliveredAt = now
			subscriber.LastError = ""
			receipt.Status = notificationFanoutReceiptStatusSent
			receipt.DeliveredAt = now
			receipt.PayloadPath = payloadPath
		}

		state.Subscribers[index] = subscriber
		fanoutState.Receipts = replaceNotificationFanoutReceipt(fanoutState.Receipts, receipt)
		run.Receipts = append(run.Receipts, receipt)
	}

	state = s.normalizeNotificationStateLocked(state)
	if err := s.saveNotificationStateLocked(state); err != nil {
		return State{}, NotificationCenter{}, NotificationFanoutRun{}, err
	}
	if err := s.saveNotificationFanoutStateLocked(fanoutState); err != nil {
		return State{}, NotificationCenter{}, NotificationFanoutRun{}, err
	}

	return cloneState(s.state), buildNotificationCenter(snapshot, state), run, nil
}

func replaceNotificationFanoutReceipt(items []NotificationFanoutReceipt, next NotificationFanoutReceipt) []NotificationFanoutReceipt {
	for index := range items {
		if items[index].DeliveryID == next.DeliveryID {
			items[index] = next
			return items
		}
	}
	return append(items, next)
}

func (s *Store) writeNotificationFanoutPayloadLocked(subscriber NotificationSubscriber, delivery NotificationDelivery, attemptedAt string) (string, error) {
	if err := validateNotificationFanoutTarget(subscriber.Channel, subscriber.Target); err != nil {
		return "", err
	}

	payload := notificationFanoutPayload{
		DeliveryID:   delivery.ID,
		InboxItemID:  delivery.InboxItemID,
		SubscriberID: delivery.SubscriberID,
		Channel:      delivery.Channel,
		Target:       subscriber.Target,
		Title:        delivery.Title,
		Body:         delivery.Body,
		Href:         delivery.Href,
		Priority:     delivery.Priority,
		AttemptedAt:  attemptedAt,
	}
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}

	relativePath := filepath.ToSlash(filepath.Join("notification-outbox", subscriber.Channel, delivery.ID+".json"))
	absolutePath := filepath.Join(filepath.Dir(s.path), filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(absolutePath, body, 0o644); err != nil {
		return "", err
	}
	return relativePath, nil
}

func validateNotificationFanoutTarget(channel, target string) error {
	switch channel {
	case notificationChannelBrowserPush:
		if strings.HasPrefix(strings.TrimSpace(target), "https://") {
			return nil
		}
		return fmt.Errorf("browser push target %q must be an https endpoint", target)
	case notificationChannelEmail:
		if _, err := mail.ParseAddress(strings.TrimSpace(target)); err == nil {
			return nil
		}
		return fmt.Errorf("email target %q is invalid", target)
	default:
		return ErrNotificationChannelInvalid
	}
}
