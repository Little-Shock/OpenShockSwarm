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

	payload := postNotificationFanout(t, server.URL)
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

	payload := postNotificationFanout(t, server.URL)
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

func TestNotificationFanoutWorkerDoesNotRedeliverSentDeliveriesOnRepeatedRun(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "browser_push",
		Target:     "https://push.example/devices/main-browser",
		Label:      "Main Browser",
		Preference: "all",
		Status:     "ready",
	})
	createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "all",
		Status:     "ready",
	})

	firstRun := postNotificationFanout(t, server.URL)
	if firstRun.Worker.Attempted == 0 || firstRun.Worker.Delivered != firstRun.Worker.Attempted || firstRun.Worker.Failed != 0 {
		t.Fatalf("initial fanout summary = %#v", firstRun.Worker)
	}

	secondRun := postNotificationFanout(t, server.URL)
	if secondRun.Worker.Attempted != 0 || secondRun.Worker.Delivered != 0 || secondRun.Worker.Failed != 0 {
		t.Fatalf("repeated fanout should be idempotent, got %#v", secondRun.Worker)
	}
	if len(secondRun.Worker.Receipts) != 0 {
		t.Fatalf("repeated fanout receipts = %#v, want empty", secondRun.Worker.Receipts)
	}

	afterRepeat := fetchNotificationCenter(t, server.URL)
	if afterRepeat.Worker.Attempted != 0 || afterRepeat.Worker.Delivered != 0 || afterRepeat.Worker.Failed != 0 {
		t.Fatalf("notification center latest run after repeated fanout = %#v, want zeroed latest run", afterRepeat.Worker)
	}
}

func TestNotificationFanoutWorkerRejectsMissingInternalWorkerSecret(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/notifications/fanout", "application/json", bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("POST /v1/notifications/fanout error = %v", err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST /v1/notifications/fanout status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	var payload map[string]string
	decodeJSON(t, resp, &payload)
	if payload["error"] != "internal worker authentication failed" {
		t.Fatalf("fanout auth payload = %#v, want authentication failure", payload)
	}
}

func TestNotificationRoutesFailClosedWhenNotificationSidecarsAreCorrupt(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	subscriberID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "all",
		Status:     "ready",
	})

	if err := os.WriteFile(filepath.Join(root, "data", "notifications.json"), []byte("{broken"), 0o644); err != nil {
		t.Fatalf("WriteFile(notifications.json) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "data", "notification-fanout.json"), []byte("{broken"), 0o644); err != nil {
		t.Fatalf("WriteFile(notification-fanout.json) error = %v", err)
	}

	for _, endpoint := range []string{
		"/v1/notifications",
		"/v1/notifications/subscribers",
		"/v1/notifications/subscribers/" + subscriberID,
		"/v1/approval-center",
	} {
		resp, err := http.Get(server.URL + endpoint)
		if err != nil {
			t.Fatalf("GET %s error = %v", endpoint, err)
		}
		if resp.StatusCode != http.StatusInternalServerError {
			t.Fatalf("GET %s status = %d, want %d", endpoint, resp.StatusCode, http.StatusInternalServerError)
		}
		var payload map[string]string
		decodeJSON(t, resp, &payload)
		if payload["error"] == "" {
			t.Fatalf("GET %s error payload = %#v, want explicit error", endpoint, payload)
		}
	}
}

func TestNotificationFanoutWorkerExposesRetryableLatestRunInNotificationCenter(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	emailID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "broken-email-target",
		Label:      "Broken Email",
		Preference: "all",
		Status:     "ready",
	})

	firstRun := postNotificationFanout(t, server.URL)
	if firstRun.Worker.Attempted == 0 || firstRun.Worker.Failed != firstRun.Worker.Attempted || firstRun.Worker.Delivered != 0 {
		t.Fatalf("initial failed fanout summary = %#v", firstRun.Worker)
	}

	afterFailure := fetchNotificationCenter(t, server.URL)
	if afterFailure.Worker.Attempted != firstRun.Worker.Attempted || afterFailure.Worker.Failed != firstRun.Worker.Failed {
		t.Fatalf("notification center should expose latest failed worker run: %#v", afterFailure.Worker)
	}
	if len(afterFailure.Worker.Receipts) != len(firstRun.Worker.Receipts) || afterFailure.Worker.Receipts[0].Status != "failed" {
		t.Fatalf("notification center worker receipts malformed after failure: %#v", afterFailure.Worker)
	}
	failedSubscriber := fetchNotificationSubscriber(t, server.URL, emailID)
	if failedSubscriber.LastDeliveredAt != "" || !strings.Contains(failedSubscriber.LastError, "invalid") {
		t.Fatalf("failed email subscriber should retain explicit lastError: %#v", failedSubscriber)
	}

	updateSubscriberPayload(t, server.URL, NotificationSubscriberRequest{
		ID:         emailID,
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "all",
		Status:     "ready",
	})

	secondRun := postNotificationFanout(t, server.URL)
	if secondRun.Worker.Attempted == 0 || secondRun.Worker.Delivered != secondRun.Worker.Attempted || secondRun.Worker.Failed != 0 {
		t.Fatalf("retry fanout summary = %#v", secondRun.Worker)
	}

	afterRetry := fetchNotificationCenter(t, server.URL)
	if afterRetry.Worker.Delivered != secondRun.Worker.Delivered || afterRetry.Worker.Failed != 0 {
		t.Fatalf("notification center should expose latest retry worker run: %#v", afterRetry.Worker)
	}
	for _, receipt := range afterRetry.Worker.Receipts {
		if receipt.Status != "sent" || receipt.DeliveredAt == "" {
			t.Fatalf("retry receipt malformed: %#v", receipt)
		}
	}

	retriedSubscriber := fetchNotificationSubscriber(t, server.URL, emailID)
	if retriedSubscriber.LastDeliveredAt == "" || retriedSubscriber.LastError != "" || retriedSubscriber.Target != "ops@openshock.dev" {
		t.Fatalf("retried email subscriber should clear error and record delivery: %#v", retriedSubscriber)
	}
}

func TestNotificationFanoutWorkerRoutesIdentityTemplatesIntoUnifiedDeliveryChain(t *testing.T) {
	root := t.TempDir()
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	emailID := createNotificationSubscriber(t, server.URL, NotificationSubscriberRequest{
		Channel:    "email",
		Target:     "ops@openshock.dev",
		Label:      "Ops Oncall",
		Preference: "critical",
		Status:     "ready",
	})

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"viewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	afterInvite := fetchNotificationCenter(t, server.URL)
	if _, ok := findApprovalSignalByTemplate(afterInvite.ApprovalCenter.Recent, "auth_invite"); !ok {
		t.Fatalf("invite template missing from approval recent: %#v", afterInvite.ApprovalCenter.Recent)
	}
	inviteDelivery, ok := findDeliveryByTemplate(afterInvite.Deliveries, emailID, "auth_invite")
	if !ok || inviteDelivery.Status != "ready" {
		t.Fatalf("invite delivery malformed: %#v", afterInvite.Deliveries)
	}

	inviteRun := postNotificationFanout(t, server.URL)
	assertFanoutReceiptForTemplate(t, root, inviteRun.Worker, emailID, "auth_invite")

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner reauth) error = %v", err)
	}
	if _, _, _, err := s.RequestPasswordReset(store.AuthRecoveryInput{Email: "mina@openshock.dev"}); err != nil {
		t.Fatalf("RequestPasswordReset(mina) error = %v", err)
	}
	if _, _, err := s.LoginWithEmail(store.AuthLoginInput{
		Email:       "reviewer@openshock.dev",
		DeviceLabel: "Reviewer Phone",
	}); err != nil {
		t.Fatalf("LoginWithEmail(reviewer restore) error = %v", err)
	}

	afterRecovery := fetchNotificationCenter(t, server.URL)
	if _, ok := findApprovalSignalByTemplate(afterRecovery.ApprovalCenter.Recent, "auth_verify_email"); !ok {
		t.Fatalf("verify template missing from approval recent: %#v", afterRecovery.ApprovalCenter.Recent)
	}
	if _, ok := findApprovalSignalByTemplate(afterRecovery.ApprovalCenter.Recent, "auth_password_reset"); !ok {
		t.Fatalf("password reset template missing from approval recent: %#v", afterRecovery.ApprovalCenter.Recent)
	}
	if _, ok := findApprovalSignalByTemplate(afterRecovery.ApprovalCenter.Signals, "auth_blocked_recovery"); !ok {
		t.Fatalf("blocked recovery template missing from approval signals: %#v", afterRecovery.ApprovalCenter.Signals)
	}

	for _, templateID := range []string{"auth_verify_email", "auth_password_reset", "auth_blocked_recovery"} {
		delivery, ok := findDeliveryByTemplate(afterRecovery.Deliveries, emailID, templateID)
		if !ok || delivery.Status != "ready" {
			t.Fatalf("template %q delivery malformed: %#v", templateID, afterRecovery.Deliveries)
		}
	}

	recoveryRun := postNotificationFanout(t, server.URL)
	for _, templateID := range []string{"auth_verify_email", "auth_password_reset", "auth_blocked_recovery"} {
		assertFanoutReceiptForTemplate(t, root, recoveryRun.Worker, emailID, templateID)
	}
}

func createNotificationSubscriber(t *testing.T, baseURL string, input NotificationSubscriberRequest) string {
	t.Helper()

	payload := updateSubscriberPayload(t, baseURL, input)
	return payload.Subscriber.ID
}

func updateSubscriberPayload(t *testing.T, baseURL string, input NotificationSubscriberRequest) struct {
	Subscriber store.NotificationSubscriber `json:"subscriber"`
} {
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
		if strings.TrimSpace(input.ID) == "" {
			t.Fatalf("POST /v1/notifications/subscribers status = %d, want %d", resp.StatusCode, http.StatusCreated)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("POST /v1/notifications/subscribers status = %d, want %d or %d", resp.StatusCode, http.StatusCreated, http.StatusOK)
		}
	}

	var payload struct {
		Subscriber store.NotificationSubscriber `json:"subscriber"`
	}
	decodeJSON(t, resp, &payload)
	return payload
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

func fetchNotificationCenter(t *testing.T, baseURL string) store.NotificationCenter {
	t.Helper()

	resp, err := http.Get(baseURL + "/v1/notifications")
	if err != nil {
		t.Fatalf("GET /v1/notifications error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/notifications status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var center store.NotificationCenter
	decodeJSON(t, resp, &center)
	return center
}

func postNotificationFanout(t *testing.T, baseURL string) struct {
	Worker store.NotificationFanoutRun `json:"worker"`
} {
	t.Helper()

	req, err := http.NewRequest(http.MethodPost, baseURL+"/v1/notifications/fanout", bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("NewRequest(POST /v1/notifications/fanout) error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-OpenShock-Worker-Secret", contractInternalWorkerSecret)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/notifications/fanout error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/notifications/fanout status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Worker store.NotificationFanoutRun `json:"worker"`
	}
	decodeJSON(t, resp, &payload)
	return payload
}

func findApprovalSignalByTemplate(items []store.ApprovalCenterItem, templateID string) (store.ApprovalCenterItem, bool) {
	for _, item := range items {
		if item.TemplateID == templateID {
			return item, true
		}
	}
	return store.ApprovalCenterItem{}, false
}

func findDeliveryByTemplate(deliveries []store.NotificationDelivery, subscriberID, templateID string) (store.NotificationDelivery, bool) {
	for _, delivery := range deliveries {
		if delivery.SubscriberID == subscriberID && delivery.TemplateID == templateID {
			return delivery, true
		}
	}
	return store.NotificationDelivery{}, false
}

func assertFanoutReceiptForTemplate(t *testing.T, root string, run store.NotificationFanoutRun, subscriberID, templateID string) {
	t.Helper()

	for _, receipt := range run.Receipts {
		if receipt.SubscriberID != subscriberID || receipt.TemplateID != templateID {
			continue
		}
		if receipt.Status != "sent" || receipt.DeliveredAt == "" || receipt.PayloadPath == "" {
			t.Fatalf("receipt for template %q malformed: %#v", templateID, receipt)
		}
		body, err := os.ReadFile(filepath.Join(root, "data", filepath.FromSlash(receipt.PayloadPath)))
		if err != nil {
			t.Fatalf("ReadFile(%q) error = %v", receipt.PayloadPath, err)
		}
		if !bytes.Contains(body, []byte(`"templateId": "`+templateID+`"`)) || !bytes.Contains(body, []byte(`"templateLabel"`)) {
			t.Fatalf("fanout payload %q missing template fields: %s", receipt.PayloadPath, string(body))
		}
		return
	}

	t.Fatalf("no receipt found for subscriber %q template %q in %#v", subscriberID, templateID, run.Receipts)
}
