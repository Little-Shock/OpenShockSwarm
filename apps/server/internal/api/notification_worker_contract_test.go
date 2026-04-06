package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestNotificationFanoutWorkerDispatchesReadyBrowserPushAndEmailDeliveries(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	browserID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "browser_push",
		Target:     "https://push.example/devices/main-browser",
		Label:      "Main Browser",
		Preference: "all",
		Status:     "ready",
	})
	emailID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "all",
		Status:     "ready",
	})

	notificationsResp, err := http.Get(server.URL + "/v1/notifications")
	if err != nil {
		t.Fatalf("GET /v1/notifications error = %v", err)
	}
	if notificationsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/notifications status = %d, want %d", notificationsResp.StatusCode, http.StatusOK)
	}

	var notifications store.NotificationCenter
	decodeJSON(t, notificationsResp, &notifications)
	wantReady := countDeliveriesForSubscriber(notifications.Deliveries, browserID, "ready") +
		countDeliveriesForSubscriber(notifications.Deliveries, emailID, "ready")

	fanoutResp, err := http.Post(server.URL+"/v1/notifications/fanout", "application/json", bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("POST /v1/notifications/fanout error = %v", err)
	}
	if fanoutResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/notifications/fanout status = %d, want %d", fanoutResp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Worker store.NotificationFanoutRun `json:"worker"`
	}
	decodeJSON(t, fanoutResp, &payload)
	if payload.Worker.Attempted != wantReady || payload.Worker.Delivered != wantReady || payload.Worker.Failed != 0 {
		t.Fatalf("fanout summary = %#v, want attempted=delivered=%d failed=0", payload.Worker, wantReady)
	}
	if len(payload.Worker.Receipts) != wantReady {
		t.Fatalf("fanout receipts = %d, want %d", len(payload.Worker.Receipts), wantReady)
	}

	for _, receipt := range payload.Worker.Receipts {
		if receipt.Status != "sent" || receipt.DeliveredAt == "" || receipt.PayloadPath == "" {
			t.Fatalf("fanout receipt malformed: %#v", receipt)
		}
		body, err := os.ReadFile(filepath.Join(root, "data", filepath.FromSlash(receipt.PayloadPath)))
		if err != nil {
			t.Fatalf("ReadFile(%q) error = %v", receipt.PayloadPath, err)
		}
		if !bytes.Contains(body, []byte(`"deliveryId"`)) || !bytes.Contains(body, []byte(`"target"`)) {
			t.Fatalf("fanout payload %q missing contract fields: %s", receipt.PayloadPath, string(body))
		}
	}

	assertNotificationSubscriberDelivered(t, server.URL, browserID)
	assertNotificationSubscriberDelivered(t, server.URL, emailID)
}

func TestNotificationFanoutWorkerFailsClosedForInvalidEmailTarget(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	emailID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "not-an-email",
		Label:      "Broken Email",
		Preference: "all",
		Status:     "ready",
	})
	browserID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "browser_push",
		Target:     "https://push.example/devices/pending-browser",
		Label:      "Pending Browser",
		Preference: "all",
		Status:     "pending",
	})

	notificationsResp, err := http.Get(server.URL + "/v1/notifications")
	if err != nil {
		t.Fatalf("GET /v1/notifications error = %v", err)
	}
	if notificationsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/notifications status = %d, want %d", notificationsResp.StatusCode, http.StatusOK)
	}

	var notifications store.NotificationCenter
	decodeJSON(t, notificationsResp, &notifications)
	wantAttempted := countDeliveriesForSubscriber(notifications.Deliveries, emailID, "ready")
	if blocked := countDeliveriesForSubscriber(notifications.Deliveries, browserID, "blocked"); blocked == 0 {
		t.Fatalf("pending browser subscriber should expose blocked deliveries: %#v", notifications.Deliveries)
	}

	fanoutResp, err := http.Post(server.URL+"/v1/notifications/fanout", "application/json", bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("POST /v1/notifications/fanout error = %v", err)
	}
	if fanoutResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/notifications/fanout status = %d, want %d", fanoutResp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Worker store.NotificationFanoutRun `json:"worker"`
	}
	decodeJSON(t, fanoutResp, &payload)
	if payload.Worker.Attempted != wantAttempted || payload.Worker.Delivered != 0 || payload.Worker.Failed != wantAttempted {
		t.Fatalf("fanout failure summary = %#v, want attempted=failed=%d delivered=0", payload.Worker, wantAttempted)
	}
	for _, receipt := range payload.Worker.Receipts {
		if receipt.Status != "failed" || !strings.Contains(receipt.Error, "invalid") {
			t.Fatalf("fanout failure receipt malformed: %#v", receipt)
		}
	}

	invalidEmail := fetchNotificationSubscriber(t, server.URL, emailID)
	if invalidEmail.LastDeliveredAt != "" || !strings.Contains(invalidEmail.LastError, "invalid") {
		t.Fatalf("invalid email subscriber should retain LastError without LastDeliveredAt: %#v", invalidEmail)
	}

	pendingBrowser := fetchNotificationSubscriber(t, server.URL, browserID)
	if pendingBrowser.LastDeliveredAt != "" || pendingBrowser.LastError != "" || pendingBrowser.Status != "pending" {
		t.Fatalf("pending browser subscriber should remain unattempted: %#v", pendingBrowser)
	}
}

func createNotificationSubscriber(t *testing.T, baseURL string, input NotificationSubscriberRequest) string {
	t.Helper()

	body, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("Marshal(NotificationSubscriberRequest) error = %v", err)
	}

	resp, err := http.Post(baseURL+"/v1/notifications/subscribers", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/notifications/subscribers error = %v", err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/notifications/subscribers status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}

	var payload struct {
		Subscriber store.NotificationSubscriber `json:"subscriber"`
	}
	decodeJSON(t, resp, &payload)
	return payload.Subscriber.ID
}

func fetchNotificationSubscriber(t *testing.T, baseURL, subscriberID string) store.NotificationSubscriber {
	t.Helper()

	resp, err := http.Get(baseURL + "/v1/notifications/subscribers/" + subscriberID)
	if err != nil {
		t.Fatalf("GET /v1/notifications/subscribers/:id error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/notifications/subscribers/:id status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var subscriber store.NotificationSubscriber
	decodeJSON(t, resp, &subscriber)
	return subscriber
}

func assertNotificationSubscriberDelivered(t *testing.T, baseURL, subscriberID string) {
	t.Helper()

	subscriber := fetchNotificationSubscriber(t, baseURL, subscriberID)
	if subscriber.LastDeliveredAt == "" || subscriber.LastError != "" {
		t.Fatalf("subscriber delivery state malformed: %#v", subscriber)
	}
}
