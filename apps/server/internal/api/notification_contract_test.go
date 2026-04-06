package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestNotificationRoutesExposeApprovalCenterAndPersistPolicy(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	initialResp, err := http.Get(server.URL + "/v1/notifications")
	if err != nil {
		t.Fatalf("GET /v1/notifications error = %v", err)
	}
	if initialResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/notifications status = %d, want %d", initialResp.StatusCode, http.StatusOK)
	}

	var initial store.NotificationCenter
	decodeJSON(t, initialResp, &initial)
	if initial.Policy.BrowserPush != "critical" || initial.Policy.Email != "critical" {
		t.Fatalf("initial notification policy = %#v, want critical/critical defaults", initial.Policy)
	}
	if initial.ApprovalCenter.OpenCount != 3 || initial.ApprovalCenter.ApprovalCount != 1 || initial.ApprovalCenter.BlockedCount != 1 || initial.ApprovalCenter.ReviewCount != 1 {
		t.Fatalf("initial approval center counts malformed: %#v", initial.ApprovalCenter)
	}
	reviewSignal, ok := findApprovalSignal(initial.ApprovalCenter, "review")
	if !ok || len(reviewSignal.DecisionOptions) != 2 || reviewSignal.DeliveryStatus != "unrouted" {
		t.Fatalf("review signal malformed before subscriber contract: %#v", reviewSignal)
	}

	body, err := json.Marshal(NotificationPolicyRequest{
		BrowserPush: "all",
		Email:       "critical",
	})
	if err != nil {
		t.Fatalf("Marshal(NotificationPolicyRequest) error = %v", err)
	}

	policyResp, err := http.Post(server.URL+"/v1/notifications/policy", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/notifications/policy error = %v", err)
	}
	if policyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/notifications/policy status = %d, want %d", policyResp.StatusCode, http.StatusOK)
	}

	var policyPayload struct {
		Policy        store.NotificationPolicy `json:"policy"`
		Notifications store.NotificationCenter `json:"notifications"`
		State         store.State              `json:"state"`
	}
	decodeJSON(t, policyResp, &policyPayload)
	if policyPayload.Policy.BrowserPush != "all" || policyPayload.State.Workspace.BrowserPush != "推全部 live 通知" {
		t.Fatalf("policy payload malformed: %#v", policyPayload)
	}
	if policyPayload.Notifications.Policy.BrowserPush != "all" {
		t.Fatalf("notification center did not reflect updated policy: %#v", policyPayload.Notifications)
	}

	subscriberBody, err := json.Marshal(NotificationSubscriberRequest{
		Channel:    "browser_push",
		Target:     "https://push.example/devices/main-browser",
		Label:      "Main Browser",
		Preference: "inherit",
		Status:     "ready",
	})
	if err != nil {
		t.Fatalf("Marshal(NotificationSubscriberRequest) error = %v", err)
	}

	subscriberResp, err := http.Post(server.URL+"/v1/notifications/subscribers", "application/json", bytes.NewReader(subscriberBody))
	if err != nil {
		t.Fatalf("POST /v1/notifications/subscribers error = %v", err)
	}
	if subscriberResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/notifications/subscribers status = %d, want %d", subscriberResp.StatusCode, http.StatusCreated)
	}

	var subscriberPayload struct {
		Subscriber    store.NotificationSubscriber `json:"subscriber"`
		Notifications store.NotificationCenter     `json:"notifications"`
		State         store.State                  `json:"state"`
	}
	decodeJSON(t, subscriberResp, &subscriberPayload)
	if subscriberPayload.Subscriber.EffectivePreference != "all" || subscriberPayload.Subscriber.Status != "ready" {
		t.Fatalf("subscriber payload malformed: %#v", subscriberPayload.Subscriber)
	}
	if ready := countDeliveriesForSubscriber(subscriberPayload.Notifications.Deliveries, subscriberPayload.Subscriber.ID, "ready"); ready != len(subscriberPayload.State.Inbox) {
		t.Fatalf("ready deliveries = %d, want one ready delivery per inbox item (%d)", ready, len(subscriberPayload.State.Inbox))
	}

	approvalResp, err := http.Get(server.URL + "/v1/approval-center")
	if err != nil {
		t.Fatalf("GET /v1/approval-center error = %v", err)
	}
	if approvalResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/approval-center status = %d, want %d", approvalResp.StatusCode, http.StatusOK)
	}

	var approvalCenter store.ApprovalCenterState
	decodeJSON(t, approvalResp, &approvalCenter)
	reviewSignal, ok = findApprovalSignal(approvalCenter, "review")
	if !ok || reviewSignal.DeliveryStatus != "ready" || reviewSignal.DeliveryTargets != 1 {
		t.Fatalf("review signal after subscriber contract malformed: %#v", reviewSignal)
	}
}

func TestNotificationSubscriberUpsertRecomputesDeliveryContract(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	body, err := json.Marshal(NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "critical",
		Status:     "ready",
	})
	if err != nil {
		t.Fatalf("Marshal(NotificationSubscriberRequest) error = %v", err)
	}

	createResp, err := http.Post(server.URL+"/v1/notifications/subscribers", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/notifications/subscribers create error = %v", err)
	}
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var created struct {
		Subscriber    store.NotificationSubscriber `json:"subscriber"`
		Notifications store.NotificationCenter     `json:"notifications"`
		State         store.State                  `json:"state"`
	}
	decodeJSON(t, createResp, &created)
	criticalSignals := countInboxKinds(created.State.Inbox, "approval", "blocked")
	if countDeliveriesForSubscriber(created.Notifications.Deliveries, created.Subscriber.ID, "ready") != criticalSignals {
		t.Fatalf("critical subscriber should only route approval + blocked deliveries: %#v", created.Notifications.Deliveries)
	}
	if countDeliveriesForSubscriber(created.Notifications.Deliveries, created.Subscriber.ID, "suppressed") != len(created.State.Inbox)-criticalSignals {
		t.Fatalf("critical subscriber should suppress review + status deliveries: %#v", created.Notifications.Deliveries)
	}

	updateBody, err := json.Marshal(NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "all",
		Status:     "ready",
	})
	if err != nil {
		t.Fatalf("Marshal(NotificationSubscriberRequest update) error = %v", err)
	}

	updateResp, err := http.Post(server.URL+"/v1/notifications/subscribers", "application/json", bytes.NewReader(updateBody))
	if err != nil {
		t.Fatalf("POST /v1/notifications/subscribers update error = %v", err)
	}
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("update status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}

	var updated struct {
		Subscriber    store.NotificationSubscriber `json:"subscriber"`
		Notifications store.NotificationCenter     `json:"notifications"`
		State         store.State                  `json:"state"`
	}
	decodeJSON(t, updateResp, &updated)
	if updated.Subscriber.ID != created.Subscriber.ID || updated.Subscriber.EffectivePreference != "all" {
		t.Fatalf("subscriber upsert should preserve id and update effective preference: before=%#v after=%#v", created.Subscriber, updated.Subscriber)
	}
	if countDeliveriesForSubscriber(updated.Notifications.Deliveries, updated.Subscriber.ID, "ready") != len(updated.State.Inbox) {
		t.Fatalf("updated subscriber should route all seeded inbox deliveries: %#v", updated.Notifications.Deliveries)
	}
}

func TestNotificationRoutesRejectUnsupportedMethodsAndExposeSubscriberDetail(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/notifications", "application/json", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		t.Fatalf("POST /v1/notifications error = %v", err)
	}
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST /v1/notifications status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}

	subscriberBody, err := json.Marshal(NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "notify@openshock.dev",
		Label:      "Notify Inbox",
		Preference: "critical",
		Status:     "ready",
	})
	if err != nil {
		t.Fatalf("Marshal(NotificationSubscriberRequest) error = %v", err)
	}

	createResp, err := http.Post(server.URL+"/v1/notifications/subscribers", "application/json", bytes.NewReader(subscriberBody))
	if err != nil {
		t.Fatalf("POST /v1/notifications/subscribers error = %v", err)
	}
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/notifications/subscribers status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var created struct {
		Subscriber store.NotificationSubscriber `json:"subscriber"`
	}
	decodeJSON(t, createResp, &created)

	detailResp, err := http.Get(server.URL + "/v1/notifications/subscribers/" + created.Subscriber.ID)
	if err != nil {
		t.Fatalf("GET /v1/notifications/subscribers/:id error = %v", err)
	}
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET subscriber detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}

	var detail store.NotificationSubscriber
	decodeJSON(t, detailResp, &detail)
	if detail.ID != created.Subscriber.ID || detail.Target != "notify@openshock.dev" {
		t.Fatalf("subscriber detail malformed: %#v", detail)
	}
}

func findApprovalSignal(center store.ApprovalCenterState, kind string) (store.ApprovalCenterItem, bool) {
	for _, item := range center.Signals {
		if item.Kind == kind {
			return item, true
		}
	}
	return store.ApprovalCenterItem{}, false
}

func countDeliveriesForSubscriber(deliveries []store.NotificationDelivery, subscriberID, status string) int {
	count := 0
	for _, item := range deliveries {
		if item.SubscriberID == subscriberID && item.Status == status {
			count++
		}
	}
	return count
}

func countInboxKinds(items []store.InboxItem, kinds ...string) int {
	count := 0
	for _, item := range items {
		for _, kind := range kinds {
			if item.Kind == kind {
				count++
				break
			}
		}
	}
	return count
}
