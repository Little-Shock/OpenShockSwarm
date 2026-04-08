package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	notificationChannelBrowserPush = "browser_push"
	notificationChannelEmail       = "email"

	notificationPreferenceInherit  = "inherit"
	notificationPreferenceAll      = "all"
	notificationPreferenceCritical = "critical"
	notificationPreferenceMute     = "mute"

	notificationSubscriberStatusReady   = "ready"
	notificationSubscriberStatusPending = "pending"
	notificationSubscriberStatusBlocked = "blocked"

	notificationDeliveryStatusReady      = "ready"
	notificationDeliveryStatusSuppressed = "suppressed"
	notificationDeliveryStatusBlocked    = "blocked"
	notificationDeliveryStatusUnrouted   = "unrouted"

	notificationPriorityCritical = "critical"
	notificationPriorityHigh     = "high"
	notificationPriorityInfo     = "info"
)

var (
	ErrNotificationChannelInvalid          = errors.New("notification channel is invalid")
	ErrNotificationTargetRequired          = errors.New("notification target is required")
	ErrNotificationPreferenceInvalid       = errors.New("notification preference is invalid")
	ErrNotificationPolicyInvalid           = errors.New("notification policy is invalid")
	ErrNotificationSubscriberNotFound      = errors.New("notification subscriber not found")
	ErrNotificationSubscriberStatusInvalid = errors.New("notification subscriber status is invalid")
)

type NotificationPolicy struct {
	BrowserPush string `json:"browserPush"`
	Email       string `json:"email"`
	UpdatedAt   string `json:"updatedAt"`
}

type NotificationSubscriber struct {
	ID                  string `json:"id"`
	Channel             string `json:"channel"`
	Target              string `json:"target"`
	Label               string `json:"label"`
	Preference          string `json:"preference"`
	EffectivePreference string `json:"effectivePreference"`
	Status              string `json:"status"`
	Source              string `json:"source"`
	CreatedAt           string `json:"createdAt"`
	UpdatedAt           string `json:"updatedAt"`
	LastDeliveredAt     string `json:"lastDeliveredAt,omitempty"`
	LastError           string `json:"lastError,omitempty"`
}

type NotificationDelivery struct {
	ID           string `json:"id"`
	InboxItemID  string `json:"inboxItemId"`
	SignalKind   string `json:"signalKind"`
	Priority     string `json:"priority"`
	Channel      string `json:"channel"`
	SubscriberID string `json:"subscriberId"`
	Status       string `json:"status"`
	Reason       string `json:"reason"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	Href         string `json:"href"`
	CreatedAt    string `json:"createdAt"`
}

type ApprovalCenterItem struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	Priority          string   `json:"priority"`
	Room              string   `json:"room"`
	RoomID            string   `json:"roomId,omitempty"`
	RunID             string   `json:"runId,omitempty"`
	GuardID           string   `json:"guardId,omitempty"`
	Title             string   `json:"title"`
	Summary           string   `json:"summary"`
	Action            string   `json:"action"`
	Href              string   `json:"href"`
	Time              string   `json:"time"`
	Unread            bool     `json:"unread"`
	DecisionOptions   []string `json:"decisionOptions"`
	DeliveryStatus    string   `json:"deliveryStatus"`
	DeliveryTargets   int      `json:"deliveryTargets"`
	BlockedDeliveries int      `json:"blockedDeliveries"`
}

type ApprovalCenterState struct {
	OpenCount     int                  `json:"openCount"`
	ApprovalCount int                  `json:"approvalCount"`
	BlockedCount  int                  `json:"blockedCount"`
	ReviewCount   int                  `json:"reviewCount"`
	UnreadCount   int                  `json:"unreadCount"`
	RecentCount   int                  `json:"recentCount"`
	Signals       []ApprovalCenterItem `json:"signals"`
	Recent        []ApprovalCenterItem `json:"recent"`
}

type NotificationCenter struct {
	Policy         NotificationPolicy       `json:"policy"`
	Subscribers    []NotificationSubscriber `json:"subscribers"`
	Deliveries     []NotificationDelivery   `json:"deliveries"`
	ApprovalCenter ApprovalCenterState      `json:"approvalCenter"`
	Worker         NotificationFanoutRun    `json:"worker"`
}

type NotificationPolicyInput struct {
	BrowserPush string
	Email       string
}

type NotificationSubscriberUpsertInput struct {
	ID         string
	Channel    string
	Target     string
	Label      string
	Preference string
	Status     string
	Source     string
}

type notificationStateFile struct {
	Policy      NotificationPolicy       `json:"policy"`
	Subscribers []NotificationSubscriber `json:"subscribers"`
}

func defaultNotificationCenter(now string) NotificationCenter {
	return NotificationCenter{
		Policy: NotificationPolicy{
			BrowserPush: notificationPreferenceCritical,
			Email:       notificationPreferenceCritical,
			UpdatedAt:   now,
		},
		Subscribers: []NotificationSubscriber{},
		Deliveries:  []NotificationDelivery{},
		ApprovalCenter: ApprovalCenterState{
			Signals: []ApprovalCenterItem{},
			Recent:  []ApprovalCenterItem{},
		},
		Worker: NotificationFanoutRun{
			Receipts: []NotificationFanoutReceipt{},
		},
	}
}

func defaultNotificationState(now, browserPushLabel string) notificationStateFile {
	center := defaultNotificationCenter(now)
	center.Policy.BrowserPush = inferBrowserPushPreference(browserPushLabel)
	return notificationStateFile{
		Policy:      center.Policy,
		Subscribers: []NotificationSubscriber{},
	}
}

func inferBrowserPushPreference(label string) string {
	text := strings.TrimSpace(strings.ToLower(label))
	switch {
	case strings.Contains(text, "全部"), strings.Contains(text, "all"):
		return notificationPreferenceAll
	case strings.Contains(text, "静默"), strings.Contains(text, "mute"):
		return notificationPreferenceMute
	case strings.Contains(text, "高优先级"), strings.Contains(text, "critical"):
		return notificationPreferenceCritical
	default:
		return notificationPreferenceCritical
	}
}

func browserPushPolicyLabel(preference string) string {
	switch preference {
	case notificationPreferenceAll:
		return "推全部 live 通知"
	case notificationPreferenceMute:
		return "保持静默"
	default:
		return "只推高优先级"
	}
}

func normalizeNotificationPolicy(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case notificationPreferenceAll:
		return notificationPreferenceAll, nil
	case notificationPreferenceCritical:
		return notificationPreferenceCritical, nil
	case notificationPreferenceMute:
		return notificationPreferenceMute, nil
	default:
		return "", ErrNotificationPolicyInvalid
	}
}

func normalizeNotificationPreference(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", notificationPreferenceInherit:
		return notificationPreferenceInherit, nil
	case notificationPreferenceAll:
		return notificationPreferenceAll, nil
	case notificationPreferenceCritical:
		return notificationPreferenceCritical, nil
	case notificationPreferenceMute:
		return notificationPreferenceMute, nil
	default:
		return "", ErrNotificationPreferenceInvalid
	}
}

func normalizeNotificationChannel(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case notificationChannelBrowserPush:
		return notificationChannelBrowserPush, nil
	case notificationChannelEmail:
		return notificationChannelEmail, nil
	default:
		return "", ErrNotificationChannelInvalid
	}
}

func normalizeNotificationSubscriberStatus(value, channel string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "":
		if channel == notificationChannelBrowserPush {
			return notificationSubscriberStatusPending, nil
		}
		return notificationSubscriberStatusReady, nil
	case notificationSubscriberStatusReady:
		return notificationSubscriberStatusReady, nil
	case notificationSubscriberStatusPending:
		return notificationSubscriberStatusPending, nil
	case notificationSubscriberStatusBlocked:
		return notificationSubscriberStatusBlocked, nil
	default:
		return "", ErrNotificationSubscriberStatusInvalid
	}
}

func defaultNotificationSubscriberSource(channel string) string {
	if channel == notificationChannelBrowserPush {
		return "browser-registration"
	}
	return "workspace-email"
}

func defaultNotificationSubscriberLabel(channel, target string) string {
	if channel == notificationChannelBrowserPush {
		return defaultString(strings.TrimPrefix(target, "https://"), "Browser Push")
	}
	return target
}

func effectiveNotificationPreference(policy NotificationPolicy, channel, preference string) string {
	if preference != notificationPreferenceInherit {
		return preference
	}
	if channel == notificationChannelBrowserPush {
		return policy.BrowserPush
	}
	return policy.Email
}

func notificationPriorityForInboxKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "approval", "blocked":
		return notificationPriorityCritical
	case "review":
		return notificationPriorityHigh
	default:
		return notificationPriorityInfo
	}
}

func decisionOptionsForInboxKind(kind string) []string {
	switch strings.TrimSpace(kind) {
	case "approval":
		return []string{"approved", "deferred"}
	case "blocked":
		return []string{"resolved", "deferred"}
	case "review":
		return []string{"merged", "changes_requested"}
	default:
		return nil
	}
}

func parseInboxTargetIDs(href string) (roomID, runID string) {
	trimmed := strings.Trim(strings.TrimSpace(href), "/")
	if trimmed == "" {
		return "", ""
	}

	parts := strings.Split(trimmed, "/")
	if len(parts) >= 2 && parts[0] == "rooms" {
		roomID = parts[1]
	}
	if len(parts) >= 4 && parts[2] == "runs" {
		runID = parts[3]
	}
	return roomID, runID
}

func shouldDeliverNotification(preference, priority string) bool {
	switch preference {
	case notificationPreferenceAll:
		return true
	case notificationPreferenceCritical:
		return priority == notificationPriorityCritical
	default:
		return false
	}
}

func notificationSuppressionReason(preference, priority string) string {
	switch preference {
	case notificationPreferenceMute:
		return "subscriber preference is mute"
	case notificationPreferenceCritical:
		return fmt.Sprintf("effective preference %q suppresses %q signal", preference, priority)
	default:
		return "signal suppressed by notification policy"
	}
}

func (s *Store) notificationStatePathLocked() string {
	return filepath.Join(filepath.Dir(s.path), "notifications.json")
}

func (s *Store) loadNotificationStateLocked() (notificationStateFile, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	defaults := defaultNotificationState(now, s.state.Workspace.BrowserPush)

	body, err := os.ReadFile(s.notificationStatePathLocked())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s.normalizeNotificationStateLocked(defaults), nil
		}
		return notificationStateFile{}, err
	}
	if strings.TrimSpace(string(body)) == "" {
		return s.normalizeNotificationStateLocked(defaults), nil
	}

	var state notificationStateFile
	if err := json.Unmarshal(body, &state); err != nil {
		return notificationStateFile{}, err
	}
	return s.normalizeNotificationStateLocked(state), nil
}

func (s *Store) saveNotificationStateLocked(state notificationStateFile) error {
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	path := s.notificationStatePathLocked()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
}

func (s *Store) normalizeNotificationStateLocked(state notificationStateFile) notificationStateFile {
	now := time.Now().UTC().Format(time.RFC3339)
	defaults := defaultNotificationState(now, s.state.Workspace.BrowserPush)

	if strings.TrimSpace(state.Policy.BrowserPush) == "" {
		state.Policy.BrowserPush = defaults.Policy.BrowserPush
	}
	if strings.TrimSpace(state.Policy.Email) == "" {
		state.Policy.Email = defaults.Policy.Email
	}
	if strings.TrimSpace(state.Policy.UpdatedAt) == "" {
		state.Policy.UpdatedAt = defaults.Policy.UpdatedAt
	}
	if normalized, err := normalizeNotificationPolicy(state.Policy.BrowserPush); err == nil {
		state.Policy.BrowserPush = normalized
	} else {
		state.Policy.BrowserPush = defaults.Policy.BrowserPush
	}
	if normalized, err := normalizeNotificationPolicy(state.Policy.Email); err == nil {
		state.Policy.Email = normalized
	} else {
		state.Policy.Email = defaults.Policy.Email
	}

	normalizedSubscribers := make([]NotificationSubscriber, 0, len(state.Subscribers))
	for _, item := range state.Subscribers {
		channel, err := normalizeNotificationChannel(item.Channel)
		if err != nil {
			continue
		}
		target := strings.TrimSpace(item.Target)
		if target == "" {
			continue
		}
		preference, err := normalizeNotificationPreference(item.Preference)
		if err != nil {
			preference = notificationPreferenceInherit
		}
		status, err := normalizeNotificationSubscriberStatus(item.Status, channel)
		if err != nil {
			status = notificationSubscriberStatusPending
		}

		if strings.TrimSpace(item.ID) == "" {
			item.ID = fmt.Sprintf("notification-%s", slugify(channel+"-"+target))
		}
		item.Channel = channel
		item.Target = target
		item.Preference = preference
		item.EffectivePreference = effectiveNotificationPreference(state.Policy, channel, preference)
		item.Status = status
		item.Label = defaultString(strings.TrimSpace(item.Label), defaultNotificationSubscriberLabel(channel, target))
		item.Source = defaultString(strings.TrimSpace(item.Source), defaultNotificationSubscriberSource(channel))
		item.CreatedAt = defaultString(strings.TrimSpace(item.CreatedAt), now)
		item.UpdatedAt = defaultString(strings.TrimSpace(item.UpdatedAt), now)
		normalizedSubscribers = append(normalizedSubscribers, item)
	}
	sort.Slice(normalizedSubscribers, func(i, j int) bool {
		if normalizedSubscribers[i].Channel == normalizedSubscribers[j].Channel {
			return normalizedSubscribers[i].Target < normalizedSubscribers[j].Target
		}
		return normalizedSubscribers[i].Channel < normalizedSubscribers[j].Channel
	})
	state.Subscribers = normalizedSubscribers
	return state
}

func buildNotificationCenter(snapshot State, state notificationStateFile, worker NotificationFanoutRun) NotificationCenter {
	deliveries := make([]NotificationDelivery, 0, len(snapshot.Inbox)*max(1, len(state.Subscribers)))
	now := time.Now().UTC().Format(time.RFC3339)

	for _, inboxItem := range snapshot.Inbox {
		priority := notificationPriorityForInboxKind(inboxItem.Kind)
		for _, subscriber := range state.Subscribers {
			status := notificationDeliveryStatusReady
			reason := "subscriber ready for delivery"
			switch {
			case subscriber.Status != notificationSubscriberStatusReady:
				status = notificationDeliveryStatusBlocked
				reason = fmt.Sprintf("subscriber status %q blocks delivery", subscriber.Status)
			case !shouldDeliverNotification(subscriber.EffectivePreference, priority):
				status = notificationDeliveryStatusSuppressed
				reason = notificationSuppressionReason(subscriber.EffectivePreference, priority)
			}
			deliveries = append(deliveries, NotificationDelivery{
				ID:           fmt.Sprintf("delivery-%s-%s", inboxItem.ID, subscriber.ID),
				InboxItemID:  inboxItem.ID,
				SignalKind:   inboxItem.Kind,
				Priority:     priority,
				Channel:      subscriber.Channel,
				SubscriberID: subscriber.ID,
				Status:       status,
				Reason:       reason,
				Title:        inboxItem.Title,
				Body:         inboxItem.Summary,
				Href:         inboxItem.Href,
				CreatedAt:    now,
			})
		}
	}

	approval := ApprovalCenterState{
		Signals: []ApprovalCenterItem{},
		Recent:  []ApprovalCenterItem{},
	}
	roomUnread := make(map[string]int, len(snapshot.Rooms))
	roomUnreadByTitle := make(map[string]int, len(snapshot.Rooms))
	for _, room := range snapshot.Rooms {
		roomUnread[room.ID] = room.Unread
		roomUnreadByTitle[room.Title] = room.Unread
	}
	for _, inboxItem := range snapshot.Inbox {
		signal := ApprovalCenterItem{
			ID:              inboxItem.ID,
			Kind:            inboxItem.Kind,
			Priority:        notificationPriorityForInboxKind(inboxItem.Kind),
			Room:            inboxItem.Room,
			GuardID:         inboxItem.GuardID,
			Title:           inboxItem.Title,
			Summary:         inboxItem.Summary,
			Action:          inboxItem.Action,
			Href:            inboxItem.Href,
			Time:            inboxItem.Time,
			DecisionOptions: decisionOptionsForInboxKind(inboxItem.Kind),
			DeliveryStatus:  notificationDeliveryStatusUnrouted,
		}
		signal.RoomID, signal.RunID = parseInboxTargetIDs(inboxItem.Href)
		if signal.RoomID != "" {
			signal.Unread = roomUnread[signal.RoomID] > 0
		} else {
			signal.Unread = roomUnreadByTitle[inboxItem.Room] > 0
		}
		for _, delivery := range deliveries {
			if delivery.InboxItemID != inboxItem.ID {
				continue
			}
			switch delivery.Status {
			case notificationDeliveryStatusReady:
				signal.DeliveryTargets++
			case notificationDeliveryStatusBlocked:
				signal.BlockedDeliveries++
			}
		}

		switch {
		case signal.DeliveryTargets > 0:
			signal.DeliveryStatus = notificationDeliveryStatusReady
		case signal.BlockedDeliveries > 0:
			signal.DeliveryStatus = notificationDeliveryStatusBlocked
		case len(deliveries) > 0:
			signal.DeliveryStatus = notificationDeliveryStatusSuppressed
		}

		if inboxItem.Kind == "status" {
			approval.Recent = append(approval.Recent, signal)
			approval.RecentCount++
			continue
		}

		switch inboxItem.Kind {
		case "approval":
			approval.ApprovalCount++
		case "blocked":
			approval.BlockedCount++
		case "review":
			approval.ReviewCount++
		}
		approval.OpenCount++
		if signal.Unread {
			approval.UnreadCount++
		}
		approval.Signals = append(approval.Signals, signal)
	}

	return NotificationCenter{
		Policy:         state.Policy,
		Subscribers:    state.Subscribers,
		Deliveries:     deliveries,
		ApprovalCenter: approval,
		Worker:         worker,
	}
}

func (s *Store) NotificationCenter() NotificationCenter {
	snapshot := s.Snapshot()

	s.mu.RLock()
	state, err := s.loadNotificationStateLocked()
	fanoutState, fanoutErr := s.loadNotificationFanoutStateLocked()
	s.mu.RUnlock()
	if err != nil || fanoutErr != nil {
		now := time.Now().UTC().Format(time.RFC3339)
		state = defaultNotificationState(now, snapshot.Workspace.BrowserPush)
		fanoutState = defaultNotificationFanoutState()
	}
	return buildNotificationCenter(snapshot, state, fanoutState.LastRun)
}

func (s *Store) NotificationSubscriber(subscriberID string) (NotificationSubscriber, bool) {
	s.mu.RLock()
	state, err := s.loadNotificationStateLocked()
	s.mu.RUnlock()
	if err != nil {
		return NotificationSubscriber{}, false
	}
	for _, item := range state.Subscribers {
		if item.ID == subscriberID {
			return item, true
		}
	}
	return NotificationSubscriber{}, false
}

func (s *Store) UpdateNotificationPolicy(input NotificationPolicyInput) (State, NotificationPolicy, NotificationCenter, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadNotificationStateLocked()
	if err != nil {
		return State{}, NotificationPolicy{}, NotificationCenter{}, err
	}
	fanoutState, err := s.loadNotificationFanoutStateLocked()
	if err != nil {
		return State{}, NotificationPolicy{}, NotificationCenter{}, err
	}

	updated := false
	if strings.TrimSpace(input.BrowserPush) != "" {
		value, err := normalizeNotificationPolicy(input.BrowserPush)
		if err != nil {
			return State{}, NotificationPolicy{}, NotificationCenter{}, err
		}
		state.Policy.BrowserPush = value
		s.state.Workspace.BrowserPush = browserPushPolicyLabel(value)
		updated = true
	}
	if strings.TrimSpace(input.Email) != "" {
		value, err := normalizeNotificationPolicy(input.Email)
		if err != nil {
			return State{}, NotificationPolicy{}, NotificationCenter{}, err
		}
		state.Policy.Email = value
		updated = true
	}
	if updated {
		state.Policy.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	state = s.normalizeNotificationStateLocked(state)
	if err := s.saveNotificationStateLocked(state); err != nil {
		return State{}, NotificationPolicy{}, NotificationCenter{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, NotificationPolicy{}, NotificationCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, state.Policy, buildNotificationCenter(snapshot, state, fanoutState.LastRun), nil
}

func (s *Store) UpsertNotificationSubscriber(input NotificationSubscriberUpsertInput) (State, NotificationSubscriber, NotificationCenter, bool, error) {
	channel, err := normalizeNotificationChannel(input.Channel)
	if err != nil {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, err
	}
	target := strings.TrimSpace(input.Target)
	if target == "" {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, ErrNotificationTargetRequired
	}
	preference, err := normalizeNotificationPreference(input.Preference)
	if err != nil {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, err
	}
	status, err := normalizeNotificationSubscriberStatus(input.Status, channel)
	if err != nil {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadNotificationStateLocked()
	if err != nil {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, err
	}
	fanoutState, err := s.loadNotificationFanoutStateLocked()
	if err != nil {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	index := -1
	if id := strings.TrimSpace(input.ID); id != "" {
		for candidate := range state.Subscribers {
			if state.Subscribers[candidate].ID == id {
				index = candidate
				break
			}
		}
	}
	if index == -1 {
		for candidate := range state.Subscribers {
			item := state.Subscribers[candidate]
			if item.Channel == channel && strings.EqualFold(item.Target, target) {
				index = candidate
				break
			}
		}
	}

	created := index == -1
	subscriber := NotificationSubscriber{
		ID:         defaultString(strings.TrimSpace(input.ID), fmt.Sprintf("notification-%s", slugify(channel+"-"+target))),
		Channel:    channel,
		Target:     target,
		Label:      defaultString(strings.TrimSpace(input.Label), defaultNotificationSubscriberLabel(channel, target)),
		Preference: preference,
		Status:     status,
		Source:     defaultString(strings.TrimSpace(input.Source), defaultNotificationSubscriberSource(channel)),
		UpdatedAt:  now,
	}

	if created {
		subscriber.CreatedAt = now
		state.Subscribers = append(state.Subscribers, subscriber)
	} else {
		existing := state.Subscribers[index]
		subscriber.ID = existing.ID
		subscriber.CreatedAt = defaultString(existing.CreatedAt, now)
		subscriber.LastDeliveredAt = existing.LastDeliveredAt
		subscriber.LastError = existing.LastError
		state.Subscribers[index] = subscriber
	}

	state = s.normalizeNotificationStateLocked(state)
	if err := s.saveNotificationStateLocked(state); err != nil {
		return State{}, NotificationSubscriber{}, NotificationCenter{}, false, err
	}

	snapshot := cloneState(s.state)
	center := buildNotificationCenter(snapshot, state, fanoutState.LastRun)
	for _, item := range state.Subscribers {
		if item.ID == subscriber.ID {
			return snapshot, item, center, created, nil
		}
	}
	return snapshot, NotificationSubscriber{}, center, created, ErrNotificationSubscriberNotFound
}

func max(left, right int) int {
	if left > right {
		return left
	}
	return right
}
