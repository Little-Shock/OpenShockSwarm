package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestAuthSessionRouteSupportsLoginAndLogout(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	initialResp, err := http.Get(server.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session error = %v", err)
	}
	if initialResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session status = %d, want %d", initialResp.StatusCode, http.StatusOK)
	}

	var initial store.AuthSession
	decodeJSON(t, initialResp, &initial)
	if initial.Status != "signed_out" || initial.Email != "" || initial.Role != "" {
		t.Fatalf("initial auth session = %#v, want signed_out session", initial)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"mina@openshock.dev"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}
	authCookie := authCookieFromResponse(loginResp)
	if authCookie == nil {
		t.Fatalf("login response missing %s cookie", authTokenCookieName)
	}
	if !authCookie.HttpOnly || authCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("login cookie = %#v, want HttpOnly + SameSiteLax", authCookie)
	}
	if authCookie.Secure {
		t.Fatalf("login cookie = %#v, want insecure cookie on plain http test server", authCookie)
	}
	if authCookie.MaxAge <= 0 || authCookie.Expires.IsZero() {
		t.Fatalf("login cookie = %#v, want positive lifetime", authCookie)
	}

	var loginPayload struct {
		Session store.AuthSession `json:"session"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, loginResp, &loginPayload)
	if loginPayload.Session.Email != "mina@openshock.dev" || loginPayload.Session.Role != "member" {
		t.Fatalf("login payload session = %#v, want mina member", loginPayload.Session)
	}
	if !containsPermission(loginPayload.Session.Permissions, "run.execute") || containsPermission(loginPayload.Session.Permissions, "members.manage") {
		t.Fatalf("member permissions = %#v, want run.execute without members.manage", loginPayload.Session.Permissions)
	}
	if loginPayload.State.Auth.Session.Email != "mina@openshock.dev" {
		t.Fatalf("state auth session = %#v, want mina", loginPayload.State.Auth.Session)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}
	clearCookie := authCookieFromResponse(deleteResp)
	if clearCookie == nil {
		t.Fatalf("logout response missing %s cookie", authTokenCookieName)
	}
	if clearCookie.MaxAge >= 0 || clearCookie.Value != "" {
		t.Fatalf("logout cookie = %#v, want cleared cookie", clearCookie)
	}

	var deletePayload struct {
		Session store.AuthSession `json:"session"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, deleteResp, &deletePayload)
	if deletePayload.Session.Status != "signed_out" || deletePayload.State.Auth.Session.Status != "signed_out" {
		t.Fatalf("delete payload = %#v, want signed_out session", deletePayload)
	}
}

func TestAuthSessionRouteFailsClosedWithoutChallenge(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"mina@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/session without challenge error = %v", err)
	}
	if loginResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST /v1/auth/session without challenge status = %d, want %d", loginResp.StatusCode, http.StatusBadRequest)
	}

	var payload map[string]string
	decodeJSON(t, loginResp, &payload)
	if payload["error"] != store.ErrAuthChallengeRequired.Error() {
		t.Fatalf("POST /v1/auth/session without challenge payload = %#v, want %q", payload, store.ErrAuthChallengeRequired.Error())
	}
}

func TestLoginChallengeRouteIssuesOneTimeChallengeForKnownMember(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_login_challenge","email":"mina@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_login_challenge error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery request_login_challenge status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Challenge store.AuthChallenge `json:"challenge"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Challenge.ID == "" || payload.Challenge.Kind != "login" || payload.Challenge.Status != "pending" {
		t.Fatalf("request_login_challenge payload = %#v, want pending login challenge", payload)
	}
}

func TestRecoveryChallengeRoutesConsumeVerifyAndAuthorizeOnce(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var loginPayload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, loginResp, &loginPayload)

	verifyChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action": "request_verify_email_challenge",
		"email":  "reviewer@openshock.dev",
	})
	verifyResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev","challengeId":"`+verifyChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery verify_email error = %v", err)
	}
	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery verify_email status = %d, want %d", verifyResp.StatusCode, http.StatusOK)
	}

	verifyReplayResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev","challengeId":"`+verifyChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery verify_email replay error = %v", err)
	}
	if verifyReplayResp.StatusCode != http.StatusConflict {
		t.Fatalf("POST /v1/auth/recovery verify_email replay status = %d, want %d", verifyReplayResp.StatusCode, http.StatusConflict)
	}

	authorizeChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action":   "request_authorize_device_challenge",
		"deviceId": loginPayload.Session.DeviceID,
	})
	authorizeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","deviceId":"`+loginPayload.Session.DeviceID+`","challengeId":"`+authorizeChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery authorize_device error = %v", err)
	}
	if authorizeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery authorize_device status = %d, want %d", authorizeResp.StatusCode, http.StatusOK)
	}

	authorizeReplayResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","deviceId":"`+loginPayload.Session.DeviceID+`","challengeId":"`+authorizeChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery authorize_device replay error = %v", err)
	}
	if authorizeReplayResp.StatusCode != http.StatusConflict {
		t.Fatalf("POST /v1/auth/recovery authorize_device replay status = %d, want %d", authorizeReplayResp.StatusCode, http.StatusConflict)
	}
}

func TestRequestScopedAuthSessionUsesCookieAndExpiresTokensFailClosed(t *testing.T) {
	previousNow := requestAuthTimeNow
	previousTTL := requestAuthTokenTTL
	baseTime := time.Date(2026, 4, 27, 12, 0, 0, 0, time.UTC)
	requestAuthTimeNow = func() time.Time { return baseTime }
	requestAuthTokenTTL = 90 * time.Second
	t.Cleanup(func() {
		requestAuthTimeNow = previousNow
		requestAuthTokenTTL = previousTTL
	})

	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	memberClient := plainContractHTTPClient()
	memberLoginResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}

	memberCookie := authCookieFromResponse(memberLoginResp)
	if memberCookie == nil {
		t.Fatalf("member login response missing %s cookie", authTokenCookieName)
	}
	if memberCookie.MaxAge != int((90*time.Second)/time.Second) {
		t.Fatalf("member login cookie = %#v, want MaxAge 90", memberCookie)
	}
	if !memberCookie.Expires.Equal(baseTime.Add(90 * time.Second)) {
		t.Fatalf("member login cookie = %#v, want expiry %s", memberCookie, baseTime.Add(90*time.Second).Format(time.RFC3339))
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	memberSessionReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new GET /v1/auth/session member cookie request error = %v", err)
	}
	memberSessionReq.Header.Set("Cookie", authTokenCookieName+"="+memberCookie.Value)
	memberSessionResp, err := memberClient.Do(memberSessionReq)
	if err != nil {
		t.Fatalf("GET /v1/auth/session member cookie error = %v", err)
	}
	if memberSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session member cookie status = %d, want %d", memberSessionResp.StatusCode, http.StatusOK)
	}

	var memberSession store.AuthSession
	decodeJSON(t, memberSessionResp, &memberSession)
	if memberSession.Email != "mina@openshock.dev" || memberSession.Role != "member" {
		t.Fatalf("member cookie session = %#v, want mina member", memberSession)
	}

	requestAuthTimeNow = func() time.Time { return baseTime.Add(91 * time.Second) }

	expiredSessionReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new GET /v1/auth/session expired cookie request error = %v", err)
	}
	expiredSessionReq.Header.Set("Cookie", authTokenCookieName+"="+memberCookie.Value)
	expiredSessionResp, err := memberClient.Do(expiredSessionReq)
	if err != nil {
		t.Fatalf("GET /v1/auth/session expired cookie error = %v", err)
	}
	if expiredSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session expired cookie status = %d, want %d", expiredSessionResp.StatusCode, http.StatusOK)
	}

	var expiredSession store.AuthSession
	decodeJSON(t, expiredSessionResp, &expiredSession)
	if expiredSession.Status != "signed_out" || expiredSession.Email != "" {
		t.Fatalf("expired cookie session = %#v, want signed_out", expiredSession)
	}
}

func TestAuthSessionRouteMarksCookieSecureWhenForwardedHTTPS(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	client := plainContractHTTPClient()
	req := newContractAuthSessionRequest(t, client, server.URL, `{"email":"mina@openshock.dev"}`)
	req.Header.Set("X-Forwarded-Proto", "https")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/auth/session forwarded request error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session forwarded request status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	authCookie := authCookieFromResponse(resp)
	if authCookie == nil {
		t.Fatalf("forwarded login response missing %s cookie", authTokenCookieName)
	}
	if !authCookie.Secure {
		t.Fatalf("forwarded login cookie = %#v, want secure cookie", authCookie)
	}
}

func TestFreshBootstrapOwnerClaimRouteFailsClosedAfterWorkStarts(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	backingStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	snapshot := backingStore.Snapshot()
	snapshot.Issues = append(snapshot.Issues, store.Issue{
		ID:    "issue-bootstrap-claim",
		Key:   "OPS-1",
		Title: "Bootstrap work already started",
		State: "queued",
	})

	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(state dir) error = %v", err)
	}
	stateBody, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent(state) error = %v", err)
	}
	if err := os.WriteFile(statePath, stateBody, 0o644); err != nil {
		t.Fatalf("os.WriteFile(state) error = %v", err)
	}

	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	loginResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_login_challenge","email":"alice@example.com"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery fresh bootstrap claim error = %v", err)
	}
	if loginResp.StatusCode != http.StatusConflict {
		t.Fatalf("POST /v1/auth/recovery fresh bootstrap claim status = %d, want %d", loginResp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, loginResp, &payload)
	if payload.Error != store.ErrFreshBootstrapOwnerClaimUnavailable.Error() {
		t.Fatalf("fresh bootstrap claim payload = %#v, want %q", payload, store.ErrFreshBootstrapOwnerClaimUnavailable.Error())
	}
}

func TestAuthSessionRouteRequiresApprovedDeviceForManagedActiveMember(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	var invitePayload struct {
		Member store.WorkspaceMember `json:"member"`
	}
	decodeJSON(t, inviteResp, &invitePayload)

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer phone error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer phone status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var loginPayload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, loginResp, &loginPayload)

	verifyChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action": "request_verify_email_challenge",
		"email":  "reviewer@openshock.dev",
	})
	verifyResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev","challengeId":"`+verifyChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery verify_email error = %v", err)
	}
	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery verify_email status = %d, want %d", verifyResp.StatusCode, http.StatusOK)
	}

	authorizeChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action":   "request_authorize_device_challenge",
		"deviceId": loginPayload.Session.DeviceID,
	})
	authorizeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","deviceId":"`+loginPayload.Session.DeviceID+`","challengeId":"`+authorizeChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery authorize_device error = %v", err)
	}
	if authorizeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery authorize_device status = %d, want %d", authorizeResp.StatusCode, http.StatusOK)
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	activateReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/"+invitePayload.Member.ID, bytes.NewReader([]byte(`{"status":"active"}`)))
	if err != nil {
		t.Fatalf("new PATCH workspace member activate request error = %v", err)
	}
	activateReq.Header.Set("Content-Type", "application/json")
	activateResp, err := http.DefaultClient.Do(activateReq)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace/members/{id} activate error = %v", err)
	}
	if activateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace/members/{id} activate status = %d, want %d", activateResp.StatusCode, http.StatusOK)
	}

	laptopLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Laptop"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer laptop error = %v", err)
	}
	if laptopLoginResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/auth/session reviewer laptop status = %d, want %d", laptopLoginResp.StatusCode, http.StatusForbidden)
	}

	var blockedPayload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, laptopLoginResp, &blockedPayload)
	if blockedPayload.Error != store.ErrAuthTrustedDeviceRequired.Error() {
		t.Fatalf("blocked direct login payload = %#v, want %q", blockedPayload, store.ErrAuthTrustedDeviceRequired.Error())
	}

	ownerLoginResp, err = postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner relogin error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner relogin status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	approveLaptopChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action":      "request_authorize_device_challenge",
		"memberId":    invitePayload.Member.ID,
		"deviceLabel": "Reviewer Laptop",
	})
	approveLaptopResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","memberId":"`+invitePayload.Member.ID+`","deviceLabel":"Reviewer Laptop","challengeId":"`+approveLaptopChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery approve laptop error = %v", err)
	}
	if approveLaptopResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery approve laptop status = %d, want %d", approveLaptopResp.StatusCode, http.StatusOK)
	}

	laptopLoginResp, err = postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Laptop"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer laptop approved error = %v", err)
	}
	if laptopLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer laptop approved status = %d, want %d", laptopLoginResp.StatusCode, http.StatusOK)
	}

	var approvedLoginPayload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, laptopLoginResp, &approvedLoginPayload)
	if approvedLoginPayload.Session.DeviceLabel != "Reviewer Laptop" || approvedLoginPayload.Session.DeviceAuthStatus != "authorized" {
		t.Fatalf("approved laptop login payload = %#v, want authorized laptop session", approvedLoginPayload)
	}
}

func TestWorkspaceMembersRoutesEnforceOwnerRoleContract(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	rosterResp, err := http.Get(server.URL + "/v1/workspace/members")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members error = %v", err)
	}
	if rosterResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/workspace/members status = %d, want %d", rosterResp.StatusCode, http.StatusOK)
	}

	var roster store.AuthSnapshot
	decodeJSON(t, rosterResp, &roster)
	if len(roster.Members) < 3 || len(roster.Roles) != 3 {
		t.Fatalf("workspace member roster malformed: %#v", roster)
	}

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"viewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	var invitePayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, inviteResp, &invitePayload)
	if invitePayload.Member.Status != "invited" || invitePayload.Member.Role != "viewer" {
		t.Fatalf("invite payload member = %#v, want invited viewer", invitePayload.Member)
	}

	lastOwnerReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-larkspur", bytes.NewReader([]byte(`{"role":"member"}`)))
	if err != nil {
		t.Fatalf("new PATCH member-larkspur request error = %v", err)
	}
	lastOwnerReq.Header.Set("Content-Type", "application/json")
	lastOwnerResp, err := http.DefaultClient.Do(lastOwnerReq)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace/members/member-larkspur error = %v", err)
	}
	if lastOwnerResp.StatusCode != http.StatusConflict {
		t.Fatalf("PATCH /v1/workspace/members/member-larkspur status = %d, want %d", lastOwnerResp.StatusCode, http.StatusConflict)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"mina@openshock.dev"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member login error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member login status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	memberInviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"blocked@openshock.dev","name":"Blocked","role":"viewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members as member error = %v", err)
	}
	if memberInviteResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/workspace/members as member status = %d, want %d", memberInviteResp.StatusCode, http.StatusForbidden)
	}

	memberDetailResp, err := http.Get(server.URL + "/v1/workspace/members/member-larkspur")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members/member-larkspur error = %v", err)
	}
	if memberDetailResp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /v1/workspace/members/member-larkspur status = %d, want %d", memberDetailResp.StatusCode, http.StatusForbidden)
	}
}

func TestWorkspaceMemberReadRoutesRequireActiveSessionAndAllowSelfOrOwner(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	rosterResp, err := http.Get(server.URL + "/v1/workspace/members")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members signed out error = %v", err)
	}
	if rosterResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET /v1/workspace/members signed out status = %d, want %d", rosterResp.StatusCode, http.StatusUnauthorized)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"mina@openshock.dev"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member login error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member login status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	selfResp, err := http.Get(server.URL + "/v1/workspace/members/member-mina")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members/member-mina error = %v", err)
	}
	if selfResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/workspace/members/member-mina status = %d, want %d", selfResp.StatusCode, http.StatusOK)
	}

	var member store.WorkspaceMember
	decodeJSON(t, selfResp, &member)
	if member.Email != "mina@openshock.dev" || member.Role != "member" {
		t.Fatalf("member detail = %#v, want mina member", member)
	}

	selfPreferencesResp, err := http.Get(server.URL + "/v1/workspace/members/member-mina/preferences")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members/member-mina/preferences error = %v", err)
	}
	if selfPreferencesResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/workspace/members/member-mina/preferences status = %d, want %d", selfPreferencesResp.StatusCode, http.StatusOK)
	}

	otherResp, err := http.Get(server.URL + "/v1/workspace/members/member-larkspur")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members/member-larkspur as member error = %v", err)
	}
	if otherResp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /v1/workspace/members/member-larkspur as member status = %d, want %d", otherResp.StatusCode, http.StatusForbidden)
	}

	otherPreferencesResp, err := http.Get(server.URL + "/v1/workspace/members/member-larkspur/preferences")
	if err != nil {
		t.Fatalf("GET /v1/workspace/members/member-larkspur/preferences as member error = %v", err)
	}
	if otherPreferencesResp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /v1/workspace/members/member-larkspur/preferences as member status = %d, want %d", otherPreferencesResp.StatusCode, http.StatusForbidden)
	}
}

func TestWorkspaceMemberRoutesReflectRoleAndStatusMutationsInSessionContract(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"viewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	var invitePayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, inviteResp, &invitePayload)
	if invitePayload.Member.Role != "viewer" || invitePayload.Member.Status != "invited" {
		t.Fatalf("invite payload member = %#v, want invited viewer", invitePayload.Member)
	}

	roleReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/"+invitePayload.Member.ID, bytes.NewReader([]byte(`{"role":"member"}`)))
	if err != nil {
		t.Fatalf("new PATCH role request error = %v", err)
	}
	roleReq.Header.Set("Content-Type", "application/json")

	roleResp, err := http.DefaultClient.Do(roleReq)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace/members/:id role error = %v", err)
	}
	if roleResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace/members/:id role status = %d, want %d", roleResp.StatusCode, http.StatusOK)
	}

	var rolePayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, roleResp, &rolePayload)
	if rolePayload.Member.Role != "member" || rolePayload.Member.Status != "invited" {
		t.Fatalf("role payload member = %#v, want invited member", rolePayload.Member)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer login error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer login status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var loginPayload struct {
		Session store.AuthSession `json:"session"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, loginResp, &loginPayload)
	if loginPayload.Session.Email != "reviewer@openshock.dev" || loginPayload.Session.Role != "member" {
		t.Fatalf("login payload session = %#v, want reviewer member", loginPayload.Session)
	}
	if !containsPermission(loginPayload.Session.Permissions, "run.execute") || containsPermission(loginPayload.Session.Permissions, "members.manage") {
		t.Fatalf("login payload permissions = %#v, want member permissions without members.manage", loginPayload.Session.Permissions)
	}

	authMember := findWorkspaceMember(loginPayload.State.Auth.Members, invitePayload.Member.ID)
	if authMember == nil || authMember.Status != "invited" || authMember.Role != "member" {
		t.Fatalf("reviewer member after login = %#v, want invited member until recovery gates clear", authMember)
	}

	restoreOwnerResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner restore error = %v", err)
	}
	if restoreOwnerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner restore status = %d, want %d", restoreOwnerResp.StatusCode, http.StatusOK)
	}

	suspendReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/"+invitePayload.Member.ID, bytes.NewReader([]byte(`{"status":"suspended"}`)))
	if err != nil {
		t.Fatalf("new PATCH suspended request error = %v", err)
	}
	suspendReq.Header.Set("Content-Type", "application/json")

	suspendResp, err := http.DefaultClient.Do(suspendReq)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace/members/:id suspended error = %v", err)
	}
	if suspendResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace/members/:id suspended status = %d, want %d", suspendResp.StatusCode, http.StatusOK)
	}

	var suspendPayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, suspendResp, &suspendPayload)
	if suspendPayload.Member.Status != "suspended" {
		t.Fatalf("suspend payload member = %#v, want suspended", suspendPayload.Member)
	}

	blockedLoginResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_login_challenge","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery suspended reviewer error = %v", err)
	}
	if blockedLoginResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/auth/recovery suspended reviewer status = %d, want %d", blockedLoginResp.StatusCode, http.StatusForbidden)
	}
}

func TestAuthRecoveryRoutesProductizeVerifyDeviceResetAndIdentityLifecycle(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"viewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var loginPayload struct {
		Session store.AuthSession `json:"session"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, loginResp, &loginPayload)
	if loginPayload.Session.EmailVerificationStatus != "pending" || loginPayload.Session.DeviceAuthStatus != "pending" {
		t.Fatalf("login payload session = %#v, want pending verify/device", loginPayload.Session)
	}

	verifyChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action": "request_verify_email_challenge",
		"email":  "reviewer@openshock.dev",
	})
	verifyResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev","challengeId":"`+verifyChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery verify_email error = %v", err)
	}
	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery verify_email status = %d, want %d", verifyResp.StatusCode, http.StatusOK)
	}

	var verifyPayload struct {
		Session store.AuthSession     `json:"session"`
		Member  store.WorkspaceMember `json:"member"`
		State   store.State           `json:"state"`
	}
	decodeJSON(t, verifyResp, &verifyPayload)
	if verifyPayload.Session.EmailVerificationStatus != "verified" || verifyPayload.Member.EmailVerifiedAt == "" {
		t.Fatalf("verify payload = %#v, want verified email", verifyPayload)
	}
	if verifyPayload.Member.Status != "invited" {
		t.Fatalf("verify payload member status = %q, want invited until device authorized", verifyPayload.Member.Status)
	}

	authorizeChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action":   "request_authorize_device_challenge",
		"deviceId": loginPayload.Session.DeviceID,
	})
	authorizeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","deviceId":"`+loginPayload.Session.DeviceID+`","challengeId":"`+authorizeChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery authorize_device error = %v", err)
	}
	if authorizeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery authorize_device status = %d, want %d", authorizeResp.StatusCode, http.StatusOK)
	}

	var authorizePayload struct {
		Session store.AuthSession `json:"session"`
		Device  store.AuthDevice  `json:"device"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, authorizeResp, &authorizePayload)
	if authorizePayload.Session.DeviceAuthStatus != "authorized" || authorizePayload.Device.Status != "authorized" {
		t.Fatalf("authorize payload = %#v, want authorized device", authorizePayload)
	}
	if authorizePayload.Session.MemberStatus != "invited" {
		t.Fatalf("authorize session member status = %q, want invited until owner activation", authorizePayload.Session.MemberStatus)
	}
	if member := findWorkspaceMember(authorizePayload.State.Auth.Members, authorizePayload.Session.MemberID); member == nil || member.Status != "invited" {
		t.Fatalf("authorized member = %#v, want invited until owner activation", member)
	}

	resetResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_password_reset","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_password_reset error = %v", err)
	}
	if resetResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/auth/recovery request_password_reset status = %d, want %d", resetResp.StatusCode, http.StatusForbidden)
	}

	var blockedResetPayload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, resetResp, &blockedResetPayload)
	if blockedResetPayload.Error != store.ErrWorkspaceMemberApprovalRequired.Error() {
		t.Fatalf("blocked reset payload = %#v, want %q", blockedResetPayload, store.ErrWorkspaceMemberApprovalRequired.Error())
	}

	blockedBindResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"bind_external_identity","email":"reviewer@openshock.dev","provider":"github","handle":"@reviewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery bind_external_identity invited error = %v", err)
	}
	if blockedBindResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/auth/recovery bind_external_identity invited status = %d, want %d", blockedBindResp.StatusCode, http.StatusForbidden)
	}

	var blockedBindPayload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, blockedBindResp, &blockedBindPayload)
	if blockedBindPayload.Error != store.ErrWorkspaceMemberApprovalRequired.Error() {
		t.Fatalf("blocked bind payload = %#v, want %q", blockedBindPayload, store.ErrWorkspaceMemberApprovalRequired.Error())
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner relogin error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner relogin status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	activateReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/"+authorizePayload.Session.MemberID, bytes.NewReader([]byte(`{"status":"active"}`)))
	if err != nil {
		t.Fatalf("new PATCH workspace member request error = %v", err)
	}
	activateReq.Header.Set("Content-Type", "application/json")
	activateResp, err := http.DefaultClient.Do(activateReq)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace/members/{id} activate error = %v", err)
	}
	if activateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace/members/{id} activate status = %d, want %d", activateResp.StatusCode, http.StatusOK)
	}

	var activatePayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, activateResp, &activatePayload)
	if activatePayload.Member.Status != "active" {
		t.Fatalf("activate payload member = %#v, want active", activatePayload.Member)
	}

	loginResp, err = postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer relogin error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer relogin status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var reloginPayload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, loginResp, &reloginPayload)
	if reloginPayload.Session.MemberStatus != "active" || reloginPayload.Session.DeviceAuthStatus != "authorized" {
		t.Fatalf("reviewer relogin payload = %#v, want active authorized reviewer", reloginPayload)
	}

	resetResp, err = http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_password_reset","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_password_reset active reviewer error = %v", err)
	}
	if resetResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery request_password_reset active reviewer status = %d, want %d", resetResp.StatusCode, http.StatusOK)
	}

	var resetPayload struct {
		Member    store.WorkspaceMember `json:"member"`
		Challenge store.AuthChallenge   `json:"challenge"`
		State     store.State           `json:"state"`
	}
	decodeJSON(t, resetResp, &resetPayload)
	if resetPayload.Member.PasswordResetStatus != "pending" {
		t.Fatalf("reset payload member = %#v, want pending reset", resetPayload.Member)
	}
	if resetPayload.State.Auth.Session.Status != "active" || resetPayload.State.Auth.Session.Email != "reviewer@openshock.dev" {
		t.Fatalf("reset payload state session = %#v, want active scoped recovery start", resetPayload.State.Auth.Session)
	}
	if resetPayload.Challenge.Kind != "password_reset" || resetPayload.Challenge.ID == "" || resetPayload.Challenge.Status != "pending" {
		t.Fatalf("reset payload challenge = %#v, want pending password reset challenge", resetPayload.Challenge)
	}
	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session before complete reset error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session before complete reset error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session before complete reset status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	completeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"complete_password_reset","email":"reviewer@openshock.dev","deviceLabel":"Reviewer Laptop","challengeId":"`+resetPayload.Challenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery complete_password_reset error = %v", err)
	}
	if completeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery complete_password_reset status = %d, want %d", completeResp.StatusCode, http.StatusOK)
	}

	var completePayload struct {
		Session store.AuthSession     `json:"session"`
		Member  store.WorkspaceMember `json:"member"`
		State   store.State           `json:"state"`
	}
	decodeJSON(t, completeResp, &completePayload)
	if completePayload.Session.AuthMethod != "password-reset" || completePayload.Session.DeviceLabel != "Reviewer Laptop" {
		t.Fatalf("complete payload session = %#v, want password-reset on Reviewer Laptop", completePayload.Session)
	}
	if completePayload.Session.RecoveryStatus != "recovered" || completePayload.Member.PasswordResetStatus != "completed" {
		t.Fatalf("complete payload = %#v, want recovered completed reset", completePayload)
	}

	reusedChallengeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"complete_password_reset","email":"reviewer@openshock.dev","deviceLabel":"Reviewer Laptop","challengeId":"`+resetPayload.Challenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery complete_password_reset reused challenge error = %v", err)
	}
	if reusedChallengeResp.StatusCode != http.StatusConflict {
		t.Fatalf("POST /v1/auth/recovery complete_password_reset reused challenge status = %d, want %d", reusedChallengeResp.StatusCode, http.StatusConflict)
	}

	bindResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"bind_external_identity","email":"reviewer@openshock.dev","provider":"github","handle":"@reviewer"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery bind_external_identity error = %v", err)
	}
	if bindResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery bind_external_identity status = %d, want %d", bindResp.StatusCode, http.StatusOK)
	}

	var bindPayload struct {
		Session store.AuthSession     `json:"session"`
		Member  store.WorkspaceMember `json:"member"`
		State   store.State           `json:"state"`
	}
	decodeJSON(t, bindResp, &bindPayload)
	if len(bindPayload.Session.LinkedIdentities) != 1 || bindPayload.Session.LinkedIdentities[0].Handle != "@reviewer" {
		t.Fatalf("bind payload session identities = %#v, want @reviewer", bindPayload.Session.LinkedIdentities)
	}
	member := findWorkspaceMember(bindPayload.State.Auth.Members, bindPayload.Member.ID)
	if member == nil || len(member.LinkedIdentities) != 1 {
		t.Fatalf("state member after identity bind = %#v, want one identity", member)
	}
}

func TestAuthRecoveryRoutesFailClosedForSignedOutAndUnknownDevice(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	unknownDeviceResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_authorize_device_challenge","email":"reviewer@openshock.dev","deviceId":"device-missing"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_authorize_device_challenge unknown error = %v", err)
	}
	if unknownDeviceResp.StatusCode != http.StatusNotFound {
		t.Fatalf("POST /v1/auth/recovery request_authorize_device_challenge unknown status = %d, want %d", unknownDeviceResp.StatusCode, http.StatusNotFound)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	signedOutResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_verify_email_challenge","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_verify_email_challenge signed out error = %v", err)
	}
	if signedOutResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST /v1/auth/recovery request_verify_email_challenge signed out status = %d, want %d", signedOutResp.StatusCode, http.StatusUnauthorized)
	}

	missingChallengeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"complete_password_reset","email":"reviewer@openshock.dev","deviceLabel":"Reviewer Laptop"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery complete_password_reset missing challenge error = %v", err)
	}
	if missingChallengeResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST /v1/auth/recovery complete_password_reset missing challenge status = %d, want %d", missingChallengeResp.StatusCode, http.StatusBadRequest)
	}
}

func TestAuthRecoveryRoutesAllowSignedOutPasswordResetForActiveMember(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	var invitePayload struct {
		Member store.WorkspaceMember `json:"member"`
	}
	decodeJSON(t, inviteResp, &invitePayload)

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer phone error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer phone status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var loginPayload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, loginResp, &loginPayload)

	verifyChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action": "request_verify_email_challenge",
		"email":  "reviewer@openshock.dev",
	})
	verifyResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev","challengeId":"`+verifyChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery verify_email error = %v", err)
	}
	if verifyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery verify_email status = %d, want %d", verifyResp.StatusCode, http.StatusOK)
	}

	authorizeChallenge := requestContractRecoveryChallenge(t, http.DefaultClient, server.URL, map[string]string{
		"action":   "request_authorize_device_challenge",
		"deviceId": loginPayload.Session.DeviceID,
	})
	authorizeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","deviceId":"`+loginPayload.Session.DeviceID+`","challengeId":"`+authorizeChallenge.ID+`"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery authorize_device error = %v", err)
	}
	if authorizeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery authorize_device status = %d, want %d", authorizeResp.StatusCode, http.StatusOK)
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	activateReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/"+invitePayload.Member.ID, bytes.NewReader([]byte(`{"status":"active"}`)))
	if err != nil {
		t.Fatalf("new PATCH workspace member activate request error = %v", err)
	}
	activateReq.Header.Set("Content-Type", "application/json")
	activateResp, err := http.DefaultClient.Do(activateReq)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace/members/{id} activate error = %v", err)
	}
	if activateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace/members/{id} activate status = %d, want %d", activateResp.StatusCode, http.StatusOK)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	resetResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_password_reset","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_password_reset signed out error = %v", err)
	}
	if resetResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST /v1/auth/recovery request_password_reset signed out status = %d, want %d", resetResp.StatusCode, http.StatusUnauthorized)
	}

	var blockedPayload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, resetResp, &blockedPayload)
	if blockedPayload.Error != store.ErrAuthSessionRequired.Error() {
		t.Fatalf("signed-out reset payload = %#v, want %q", blockedPayload, store.ErrAuthSessionRequired.Error())
	}
}

func TestStateRouteExposesAuthContract(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload map[string]json.RawMessage
	decodeJSON(t, resp, &payload)
	if len(payload["auth"]) == 0 {
		t.Fatalf("state payload missing auth field: %#v", payload)
	}

	var auth store.AuthSnapshot
	if err := json.Unmarshal(payload["auth"], &auth); err != nil {
		t.Fatalf("json.Unmarshal(auth) error = %v", err)
	}
	if auth.Session.Status != "signed_out" || len(auth.Roles) != 3 {
		t.Fatalf("state auth payload malformed: %#v", auth)
	}
	if len(auth.Members) != 0 || len(auth.Devices) != 0 || len(auth.Challenges) != 0 {
		t.Fatalf("signed-out state should redact auth internals, got %#v", auth)
	}

	var state store.State
	if err := json.Unmarshal(payload["state"], &state); err == nil {
		t.Fatalf("state payload unexpectedly nested full state: %#v", state)
	}

	var workspace store.WorkspaceSnapshot
	if err := json.Unmarshal(payload["workspace"], &workspace); err != nil {
		t.Fatalf("json.Unmarshal(workspace) error = %v", err)
	}
	if workspace.Name == "" || workspace.Onboarding.ResumeURL == "" {
		t.Fatalf("workspace bootstrap = %#v, want public bootstrap fields", workspace)
	}
	if workspace.Repo != "" || workspace.Branch != "" || workspace.PairedRuntime != "" {
		t.Fatalf("signed-out workspace leaked private live truth: %#v", workspace)
	}

	for _, key := range []string{
		"channels",
		"issues",
		"rooms",
		"runs",
		"agents",
		"machines",
		"inbox",
		"mailbox",
		"pullRequests",
		"sessions",
		"memory",
	} {
		if len(payload[key]) == 0 {
			t.Fatalf("state payload missing %s field", key)
		}
		var items []json.RawMessage
		if err := json.Unmarshal(payload[key], &items); err != nil {
			t.Fatalf("json.Unmarshal(%s) error = %v", key, err)
		}
		if len(items) != 0 {
			t.Fatalf("signed-out %s should be redacted, got %d items", key, len(items))
		}
	}
	if raw, ok := payload["credentials"]; ok && len(raw) > 0 {
		var items []json.RawMessage
		if err := json.Unmarshal(raw, &items); err != nil {
			t.Fatalf("json.Unmarshal(credentials) error = %v", err)
		}
		if len(items) != 0 {
			t.Fatalf("signed-out credentials should be redacted, got %d items", len(items))
		}
	}
}

func TestStateRouteRedactsAuthContractForActiveMemberView(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"mina@openshock.dev"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member login error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member login status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	resp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload map[string]json.RawMessage
	decodeJSON(t, resp, &payload)

	var auth store.AuthSnapshot
	if err := json.Unmarshal(payload["auth"], &auth); err != nil {
		t.Fatalf("json.Unmarshal(auth) error = %v", err)
	}
	if auth.Session.Status != "active" || auth.Session.MemberID != "member-mina" {
		t.Fatalf("member state session = %#v, want active mina session", auth.Session)
	}
	if len(auth.Members) != 1 || auth.Members[0].ID != "member-mina" {
		t.Fatalf("member state members = %#v, want only current member", auth.Members)
	}
	for _, device := range auth.Devices {
		if device.MemberID != "member-mina" {
			t.Fatalf("member state devices = %#v, want only mina devices", auth.Devices)
		}
	}
	for _, challenge := range auth.Challenges {
		if challenge.MemberID != "member-mina" {
			t.Fatalf("member state challenges = %#v, want only mina challenges", auth.Challenges)
		}
	}
}

func TestAuthSessionLoginResponseRedactsUnreadyMemberState(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members reviewer error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members reviewer status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session owner error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session owner status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer login error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer login status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Session store.AuthSession `json:"session"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, loginResp, &payload)

	if payload.Session.Email != "reviewer@openshock.dev" {
		t.Fatalf("reviewer login session = %#v, want reviewer session", payload.Session)
	}
	if payload.State.Auth.Session.Email != "reviewer@openshock.dev" {
		t.Fatalf("login response state session = %#v, want reviewer session", payload.State.Auth.Session)
	}
	if payload.State.Workspace.Repo != "" || payload.State.Workspace.Branch != "" || payload.State.Workspace.PairedRuntime != "" {
		t.Fatalf("unready login state leaked workspace private truth: %#v", payload.State.Workspace)
	}
	if len(payload.State.Channels) != 0 || len(payload.State.Rooms) != 0 || len(payload.State.Runs) != 0 || len(payload.State.Inbox) != 0 {
		t.Fatalf("unready login state leaked private surfaces: %#v", payload.State)
	}
}

func TestAuthRecoveryRoutesFailClosedForCrossAccountMutation(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	reviewerInviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members reviewer error = %v", err)
	}
	if reviewerInviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members reviewer status = %d, want %d", reviewerInviteResp.StatusCode, http.StatusCreated)
	}

	victimInviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"victim@openshock.dev","name":"Victim","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members victim error = %v", err)
	}
	if victimInviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members victim status = %d, want %d", victimInviteResp.StatusCode, http.StatusCreated)
	}

	victimLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"victim@openshock.dev","deviceLabel":"Victim Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session victim login error = %v", err)
	}
	if victimLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session victim login status = %d, want %d", victimLoginResp.StatusCode, http.StatusOK)
	}

	var victimLoginPayload struct {
		Session store.AuthSession `json:"session"`
	}
	decodeJSON(t, victimLoginResp, &victimLoginPayload)

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session after victim login error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session after victim login status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	reviewerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer login error = %v", err)
	}
	if reviewerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer login status = %d, want %d", reviewerLoginResp.StatusCode, http.StatusOK)
	}

	for _, body := range []string{
		`{"action":"request_verify_email_challenge","email":"victim@openshock.dev"}`,
		`{"action":"request_authorize_device_challenge","email":"victim@openshock.dev","deviceId":"` + victimLoginPayload.Session.DeviceID + `"}`,
		`{"action":"request_password_reset","email":"victim@openshock.dev"}`,
		`{"action":"bind_external_identity","email":"victim@openshock.dev","provider":"github","handle":"@victim"}`,
	} {
		resp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(body)))
		if err != nil {
			t.Fatalf("POST /v1/auth/recovery cross-account error = %v", err)
		}
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("POST /v1/auth/recovery cross-account status = %d, want %d for %s", resp.StatusCode, http.StatusForbidden, body)
		}
	}
}

func TestRequestScopedAuthSessionSeparatesConcurrentClients(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	memberLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}

	var memberLoginPayload struct {
		Session store.AuthSession `json:"session"`
		Token   string            `json:"token"`
	}
	decodeJSON(t, memberLoginResp, &memberLoginPayload)
	if memberLoginPayload.Token == "" || memberLoginPayload.Session.Email != "mina@openshock.dev" {
		t.Fatalf("member login payload = %#v, want mina token", memberLoginPayload)
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	var ownerLoginPayload struct {
		Session store.AuthSession `json:"session"`
		Token   string            `json:"token"`
	}
	decodeJSON(t, ownerLoginResp, &ownerLoginPayload)
	if ownerLoginPayload.Token == "" || ownerLoginPayload.Session.Email != "larkspur@openshock.dev" {
		t.Fatalf("owner login payload = %#v, want owner token", ownerLoginPayload)
	}

	memberSessionReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new GET /v1/auth/session member request error = %v", err)
	}
	memberSessionReq.Header.Set(authTokenHeaderName, memberLoginPayload.Token)
	memberSessionResp, err := http.DefaultClient.Do(memberSessionReq)
	if err != nil {
		t.Fatalf("GET /v1/auth/session member token error = %v", err)
	}
	if memberSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session member token status = %d, want %d", memberSessionResp.StatusCode, http.StatusOK)
	}
	var memberSession store.AuthSession
	decodeJSON(t, memberSessionResp, &memberSession)
	if memberSession.Email != "mina@openshock.dev" || memberSession.Role != "member" {
		t.Fatalf("member token session = %#v, want mina member", memberSession)
	}

	ownerSessionReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new GET /v1/auth/session owner request error = %v", err)
	}
	ownerSessionReq.Header.Set(authTokenHeaderName, ownerLoginPayload.Token)
	ownerSessionResp, err := http.DefaultClient.Do(ownerSessionReq)
	if err != nil {
		t.Fatalf("GET /v1/auth/session owner token error = %v", err)
	}
	if ownerSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session owner token status = %d, want %d", ownerSessionResp.StatusCode, http.StatusOK)
	}
	var ownerSession store.AuthSession
	decodeJSON(t, ownerSessionResp, &ownerSession)
	if ownerSession.Email != "larkspur@openshock.dev" || ownerSession.Role != "owner" {
		t.Fatalf("owner token session = %#v, want owner session", ownerSession)
	}

	blockedReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-larkspur/preferences", bytes.NewReader([]byte(`{"startRoute":"/settings"}`)))
	if err != nil {
		t.Fatalf("new PATCH owner preferences as member error = %v", err)
	}
	blockedReq.Header.Set("Content-Type", "application/json")
	blockedReq.Header.Set(authTokenHeaderName, memberLoginPayload.Token)
	blockedResp, err := http.DefaultClient.Do(blockedReq)
	if err != nil {
		t.Fatalf("PATCH owner preferences as member error = %v", err)
	}
	if blockedResp.StatusCode != http.StatusForbidden {
		t.Fatalf("PATCH owner preferences as member status = %d, want %d", blockedResp.StatusCode, http.StatusForbidden)
	}

	selfReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-mina/preferences", bytes.NewReader([]byte(`{"startRoute":"/chat/all"}`)))
	if err != nil {
		t.Fatalf("new PATCH self preferences request error = %v", err)
	}
	selfReq.Header.Set("Content-Type", "application/json")
	selfReq.Header.Set(authTokenHeaderName, memberLoginPayload.Token)
	selfResp, err := http.DefaultClient.Do(selfReq)
	if err != nil {
		t.Fatalf("PATCH self preferences error = %v", err)
	}
	if selfResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH self preferences status = %d, want %d", selfResp.StatusCode, http.StatusOK)
	}

	var selfPayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, selfResp, &selfPayload)
	if selfPayload.Member.Preferences.StartRoute != "/chat/all" {
		t.Fatalf("self preferences = %#v, want /chat/all", selfPayload.Member.Preferences)
	}
	if selfPayload.State.Auth.Session.Email != "mina@openshock.dev" {
		t.Fatalf("self preference state session = %#v, want mina", selfPayload.State.Auth.Session)
	}
}

func TestRequestScopedAuthGuardsOwnerOnlyNotificationPolicyRoute(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	inviteResp, err := http.Post(server.URL+"/v1/workspace/members", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","name":"Reviewer","role":"member"}`)))
	if err != nil {
		t.Fatalf("POST /v1/workspace/members reviewer error = %v", err)
	}
	if inviteResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/workspace/members reviewer status = %d, want %d", inviteResp.StatusCode, http.StatusCreated)
	}

	memberClient := plainContractHTTPClient()
	memberLoginResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session reviewer login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session reviewer login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}

	var memberLoginPayload struct {
		Token string `json:"token"`
	}
	decodeJSON(t, memberLoginResp, &memberLoginPayload)
	if memberLoginPayload.Token == "" {
		t.Fatalf("reviewer login payload missing token: %#v", memberLoginPayload)
	}

	ownerClient := plainContractHTTPClient()
	ownerLoginResp, err := postContractAuthSessionJSON(t, ownerClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/notifications/policy", bytes.NewReader([]byte(`{"browserPush":"enabled","email":"mentions_only"}`)))
	if err != nil {
		t.Fatalf("new POST /v1/notifications/policy reviewer request error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(authTokenHeaderName, memberLoginPayload.Token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/notifications/policy reviewer token error = %v", err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/notifications/policy reviewer token status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
}

func TestRequestScopedStateStreamSeparatesConcurrentClients(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	memberLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}

	var memberLoginPayload struct {
		Token string `json:"token"`
	}
	decodeJSON(t, memberLoginResp, &memberLoginPayload)
	if memberLoginPayload.Token == "" {
		t.Fatalf("member login payload missing token: %#v", memberLoginPayload)
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	var ownerLoginPayload struct {
		Token string `json:"token"`
	}
	decodeJSON(t, ownerLoginResp, &ownerLoginPayload)
	if ownerLoginPayload.Token == "" {
		t.Fatalf("owner login payload missing token: %#v", ownerLoginPayload)
	}

	memberReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/state/stream", nil)
	if err != nil {
		t.Fatalf("new GET /v1/state/stream member request error = %v", err)
	}
	memberReq.Header.Set(authTokenHeaderName, memberLoginPayload.Token)
	memberResp, err := http.DefaultClient.Do(memberReq)
	if err != nil {
		t.Fatalf("GET /v1/state/stream member token error = %v", err)
	}
	defer memberResp.Body.Close()
	if memberResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state/stream member token status = %d, want %d", memberResp.StatusCode, http.StatusOK)
	}

	ownerReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/state/stream", nil)
	if err != nil {
		t.Fatalf("new GET /v1/state/stream owner request error = %v", err)
	}
	ownerReq.Header.Set(authTokenHeaderName, ownerLoginPayload.Token)
	ownerResp, err := http.DefaultClient.Do(ownerReq)
	if err != nil {
		t.Fatalf("GET /v1/state/stream owner token error = %v", err)
	}
	defer ownerResp.Body.Close()
	if ownerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state/stream owner token status = %d, want %d", ownerResp.StatusCode, http.StatusOK)
	}

	memberSnapshot := decodeSnapshotFrame(t, readStateStreamFrame(t, bufio.NewReader(memberResp.Body)))
	ownerSnapshot := decodeSnapshotFrame(t, readStateStreamFrame(t, bufio.NewReader(ownerResp.Body)))
	if memberSnapshot.State.Auth.Session.Email != "mina@openshock.dev" || memberSnapshot.State.Auth.Session.Role != "member" {
		t.Fatalf("member stream auth session = %#v, want mina member", memberSnapshot.State.Auth.Session)
	}
	if ownerSnapshot.State.Auth.Session.Email != "larkspur@openshock.dev" || ownerSnapshot.State.Auth.Session.Role != "owner" {
		t.Fatalf("owner stream auth session = %#v, want owner", ownerSnapshot.State.Auth.Session)
	}
	if memberSnapshot.State.Auth.Session.MemberID == ownerSnapshot.State.Auth.Session.MemberID {
		t.Fatalf("stream sessions unexpectedly collapsed: member=%#v owner=%#v", memberSnapshot.State.Auth.Session, ownerSnapshot.State.Auth.Session)
	}
}

func TestRequestScopedBrowserCookiesSeparateConcurrentClients(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	memberClient := contractBrowserClient(t)
	ownerClient := contractBrowserClient(t)

	memberLoginResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member browser login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member browser login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}
	if authCookie := authCookieFromResponse(memberLoginResp); authCookie == nil || strings.TrimSpace(authCookie.Value) == "" {
		t.Fatalf("member browser login missing auth cookie: %#v", authCookie)
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, ownerClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner browser login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner browser login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}
	if authCookie := authCookieFromResponse(ownerLoginResp); authCookie == nil || strings.TrimSpace(authCookie.Value) == "" {
		t.Fatalf("owner browser login missing auth cookie: %#v", authCookie)
	}

	memberSessionResp, err := memberClient.Get(server.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session member browser error = %v", err)
	}
	if memberSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session member browser status = %d, want %d", memberSessionResp.StatusCode, http.StatusOK)
	}
	var memberSession store.AuthSession
	decodeJSON(t, memberSessionResp, &memberSession)
	if memberSession.Email != "mina@openshock.dev" || memberSession.Role != "member" {
		t.Fatalf("member browser session = %#v, want mina member", memberSession)
	}

	ownerSessionResp, err := ownerClient.Get(server.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session owner browser error = %v", err)
	}
	if ownerSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session owner browser status = %d, want %d", ownerSessionResp.StatusCode, http.StatusOK)
	}
	var ownerSession store.AuthSession
	decodeJSON(t, ownerSessionResp, &ownerSession)
	if ownerSession.Email != "larkspur@openshock.dev" || ownerSession.Role != "owner" {
		t.Fatalf("owner browser session = %#v, want owner session", ownerSession)
	}

	memberPreferencesReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-mina/preferences", bytes.NewReader([]byte(`{"startRoute":"/rooms","githubHandle":"@mina-browser"}`)))
	if err != nil {
		t.Fatalf("new PATCH member browser preferences request error = %v", err)
	}
	memberPreferencesReq.Header.Set("Content-Type", "application/json")
	memberPreferencesResp, err := memberClient.Do(memberPreferencesReq)
	if err != nil {
		t.Fatalf("PATCH member browser preferences error = %v", err)
	}
	if memberPreferencesResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH member browser preferences status = %d, want %d", memberPreferencesResp.StatusCode, http.StatusOK)
	}
	var memberPreferencesPayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, memberPreferencesResp, &memberPreferencesPayload)
	if memberPreferencesPayload.Member.Preferences.StartRoute != "/rooms" || memberPreferencesPayload.Member.GitHubIdentity.Handle != "@mina-browser" {
		t.Fatalf("member browser preference payload = %#v, want /rooms + @mina-browser", memberPreferencesPayload.Member)
	}
	if memberPreferencesPayload.State.Auth.Session.Email != "mina@openshock.dev" || memberPreferencesPayload.State.Auth.Session.Preferences.StartRoute != "/rooms" {
		t.Fatalf("member browser preference session = %#v, want scoped mina /rooms session", memberPreferencesPayload.State.Auth.Session)
	}

	ownerPreferencesReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-larkspur/preferences", bytes.NewReader([]byte(`{"startRoute":"/mailbox","githubHandle":"@owner-browser"}`)))
	if err != nil {
		t.Fatalf("new PATCH owner browser preferences request error = %v", err)
	}
	ownerPreferencesReq.Header.Set("Content-Type", "application/json")
	ownerPreferencesResp, err := ownerClient.Do(ownerPreferencesReq)
	if err != nil {
		t.Fatalf("PATCH owner browser preferences error = %v", err)
	}
	if ownerPreferencesResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH owner browser preferences status = %d, want %d", ownerPreferencesResp.StatusCode, http.StatusOK)
	}
	var ownerPreferencesPayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, ownerPreferencesResp, &ownerPreferencesPayload)
	if ownerPreferencesPayload.Member.Preferences.StartRoute != "/mailbox" || ownerPreferencesPayload.Member.GitHubIdentity.Handle != "@owner-browser" {
		t.Fatalf("owner browser preference payload = %#v, want /mailbox + @owner-browser", ownerPreferencesPayload.Member)
	}
	if ownerPreferencesPayload.State.Auth.Session.Email != "larkspur@openshock.dev" || ownerPreferencesPayload.State.Auth.Session.Preferences.StartRoute != "/mailbox" {
		t.Fatalf("owner browser preference session = %#v, want scoped owner /mailbox session", ownerPreferencesPayload.State.Auth.Session)
	}

	memberSessionResp, err = memberClient.Get(server.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session member browser after prefs error = %v", err)
	}
	if memberSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session member browser after prefs status = %d, want %d", memberSessionResp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, memberSessionResp, &memberSession)
	if memberSession.Email != "mina@openshock.dev" || memberSession.Preferences.StartRoute != "/rooms" || memberSession.GitHubIdentity.Handle != "@mina-browser" {
		t.Fatalf("member browser session after prefs = %#v, want retained mina browser preferences", memberSession)
	}

	ownerSessionResp, err = ownerClient.Get(server.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session owner browser after prefs error = %v", err)
	}
	if ownerSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session owner browser after prefs status = %d, want %d", ownerSessionResp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, ownerSessionResp, &ownerSession)
	if ownerSession.Email != "larkspur@openshock.dev" || ownerSession.Preferences.StartRoute != "/mailbox" || ownerSession.GitHubIdentity.Handle != "@owner-browser" {
		t.Fatalf("owner browser session after prefs = %#v, want retained owner browser preferences", ownerSession)
	}
}

func TestRequestScopedBrowserSessionsPersistAcrossServerReloadPerClient(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")

	memberClient := contractBrowserClient(t)
	ownerClient := contractBrowserClient(t)

	memberLoginResp, err := postContractAuthSessionJSON(t, memberClient, server.URL, `{"email":"mina@openshock.dev","deviceLabel":"Mina Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session member browser login error = %v", err)
	}
	if memberLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session member browser login status = %d, want %d", memberLoginResp.StatusCode, http.StatusOK)
	}

	ownerLoginResp, err := postContractAuthSessionJSON(t, ownerClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner browser login error = %v", err)
	}
	if ownerLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner browser login status = %d, want %d", ownerLoginResp.StatusCode, http.StatusOK)
	}

	memberPreferencesReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-mina/preferences", bytes.NewReader([]byte(`{"startRoute":"/rooms","githubHandle":"@mina-reload"}`)))
	if err != nil {
		t.Fatalf("new PATCH member reload preferences request error = %v", err)
	}
	memberPreferencesReq.Header.Set("Content-Type", "application/json")
	memberPreferencesResp, err := memberClient.Do(memberPreferencesReq)
	if err != nil {
		t.Fatalf("PATCH member reload preferences error = %v", err)
	}
	if memberPreferencesResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH member reload preferences status = %d, want %d", memberPreferencesResp.StatusCode, http.StatusOK)
	}
	memberPreferencesResp.Body.Close()

	ownerPreferencesReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-larkspur/preferences", bytes.NewReader([]byte(`{"startRoute":"/mailbox","githubHandle":"@owner-reload"}`)))
	if err != nil {
		t.Fatalf("new PATCH owner reload preferences request error = %v", err)
	}
	ownerPreferencesReq.Header.Set("Content-Type", "application/json")
	ownerPreferencesResp, err := ownerClient.Do(ownerPreferencesReq)
	if err != nil {
		t.Fatalf("PATCH owner reload preferences error = %v", err)
	}
	if ownerPreferencesResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH owner reload preferences status = %d, want %d", ownerPreferencesResp.StatusCode, http.StatusOK)
	}
	ownerPreferencesResp.Body.Close()

	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:              "http://127.0.0.1:65531",
		WorkspaceRoot:          root,
		InternalWorkerSecret:   contractInternalWorkerSecret,
		RuntimeHeartbeatSecret: contractRuntimeHeartbeatSecret,
	}).Handler())

	memberSessionResp, err := memberClient.Get(reloadedServer.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session member reload error = %v", err)
	}
	if memberSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session member reload status = %d, want %d", memberSessionResp.StatusCode, http.StatusOK)
	}
	var memberSession store.AuthSession
	decodeJSON(t, memberSessionResp, &memberSession)
	if memberSession.Email != "mina@openshock.dev" || memberSession.Preferences.StartRoute != "/rooms" || memberSession.GitHubIdentity.Handle != "@mina-reload" {
		t.Fatalf("member reload session = %#v, want retained member browser session", memberSession)
	}

	ownerSessionResp, err := ownerClient.Get(reloadedServer.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session owner reload error = %v", err)
	}
	if ownerSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session owner reload status = %d, want %d", ownerSessionResp.StatusCode, http.StatusOK)
	}
	var ownerSession store.AuthSession
	decodeJSON(t, ownerSessionResp, &ownerSession)
	if ownerSession.Email != "larkspur@openshock.dev" || ownerSession.Preferences.StartRoute != "/mailbox" || ownerSession.GitHubIdentity.Handle != "@owner-reload" {
		t.Fatalf("owner reload session = %#v, want retained owner browser session", ownerSession)
	}

	logoutReq, err := http.NewRequest(http.MethodDelete, reloadedServer.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session owner reload request error = %v", err)
	}
	logoutResp, err := ownerClient.Do(logoutReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session owner reload error = %v", err)
	}
	if logoutResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session owner reload status = %d, want %d", logoutResp.StatusCode, http.StatusOK)
	}
	logoutResp.Body.Close()

	reloadedServer.Close()

	reloadedStoreAgain, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(second reload) error = %v", err)
	}
	reloadedServerAgain := httptest.NewServer(New(reloadedStoreAgain, http.DefaultClient, Config{
		DaemonURL:              "http://127.0.0.1:65531",
		WorkspaceRoot:          root,
		InternalWorkerSecret:   contractInternalWorkerSecret,
		RuntimeHeartbeatSecret: contractRuntimeHeartbeatSecret,
	}).Handler())
	defer reloadedServerAgain.Close()

	memberSessionResp, err = memberClient.Get(reloadedServerAgain.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session member second reload error = %v", err)
	}
	if memberSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session member second reload status = %d, want %d", memberSessionResp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, memberSessionResp, &memberSession)
	if memberSession.Email != "mina@openshock.dev" || memberSession.Preferences.StartRoute != "/rooms" || memberSession.GitHubIdentity.Handle != "@mina-reload" {
		t.Fatalf("member second reload session = %#v, want retained member browser session", memberSession)
	}

	ownerSessionResp, err = ownerClient.Get(reloadedServerAgain.URL + "/v1/auth/session")
	if err != nil {
		t.Fatalf("GET /v1/auth/session owner second reload error = %v", err)
	}
	if ownerSessionResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/auth/session owner second reload status = %d, want %d", ownerSessionResp.StatusCode, http.StatusOK)
	}
	var signedOutOwnerSession store.AuthSession
	decodeJSON(t, ownerSessionResp, &signedOutOwnerSession)
	if signedOutOwnerSession.Status != "signed_out" || signedOutOwnerSession.Email != "" {
		t.Fatalf("owner second reload session = %#v, want signed_out after persisted revoke", signedOutOwnerSession)
	}
}

func TestInvalidTokenPrivateReadsFailClosedAcrossMailboxPullRequestRoomAndRun(t *testing.T) {
	root := t.TempDir()
	_, server := newSignedOutContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	loginResp, err := postContractAuthSessionJSON(t, http.DefaultClient, server.URL, `{"email":"larkspur@openshock.dev","deviceLabel":"Owner Browser"}`)
	if err != nil {
		t.Fatalf("POST /v1/auth/session owner login error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session owner login status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	createResp, err := http.Post(server.URL+"/v1/mailbox", "application/json", bytes.NewReader([]byte(`{"roomId":"room-runtime","fromAgentId":"agent-codex-dockmaster","toAgentId":"agent-claude-review-runner","title":"接住 reviewer lane","summary":"请你正式接住 reviewer lane。","kind":"governed"}`)))
	if err != nil {
		t.Fatalf("POST /v1/mailbox error = %v", err)
	}
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)
	if createPayload.Handoff.ID == "" {
		t.Fatalf("mailbox create payload missing handoff id: %#v", createPayload)
	}

	for _, endpoint := range []string{
		"/v1/mailbox/" + createPayload.Handoff.ID,
		"/v1/pull-requests/pr-runtime-18",
		"/v1/pull-requests/pr-runtime-18/detail",
		"/v1/rooms/room-runtime",
		"/v1/runs/run_runtime_01/detail",
	} {
		resp, err := http.Get(server.URL + endpoint)
		if err != nil {
			t.Fatalf("GET %s while signed in error = %v", endpoint, err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s while signed in status = %d, want %d", endpoint, resp.StatusCode, http.StatusOK)
		}
		resp.Body.Close()
	}

	mailboxListResp, err := http.Get(server.URL + "/v1/mailbox")
	if err != nil {
		t.Fatalf("GET /v1/mailbox while signed in error = %v", err)
	}
	if mailboxListResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox while signed in status = %d, want %d", mailboxListResp.StatusCode, http.StatusOK)
	}
	var mailbox []store.AgentHandoff
	decodeJSON(t, mailboxListResp, &mailbox)
	if len(mailbox) == 0 {
		t.Fatalf("signed-in mailbox unexpectedly empty")
	}

	pullRequestsResp, err := http.Get(server.URL + "/v1/pull-requests")
	if err != nil {
		t.Fatalf("GET /v1/pull-requests while signed in error = %v", err)
	}
	if pullRequestsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/pull-requests while signed in status = %d, want %d", pullRequestsResp.StatusCode, http.StatusOK)
	}
	var pullRequests []store.PullRequest
	decodeJSON(t, pullRequestsResp, &pullRequests)
	if len(pullRequests) == 0 {
		t.Fatalf("signed-in pull requests unexpectedly empty")
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/auth/session", nil)
	if err != nil {
		t.Fatalf("new DELETE /v1/auth/session request error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE /v1/auth/session error = %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE /v1/auth/session status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}
	deleteResp.Body.Close()

	signedOutClient := plainContractHTTPClient()
	invalidToken := "auth-token-invalid"

	signedOutMailboxReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/mailbox", nil)
	if err != nil {
		t.Fatalf("new GET /v1/mailbox invalid token request error = %v", err)
	}
	signedOutMailboxReq.Header.Set(authTokenHeaderName, invalidToken)
	signedOutMailboxResp, err := signedOutClient.Do(signedOutMailboxReq)
	if err != nil {
		t.Fatalf("GET /v1/mailbox signed out error = %v", err)
	}
	if signedOutMailboxResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/mailbox signed out status = %d, want %d", signedOutMailboxResp.StatusCode, http.StatusOK)
	}
	var signedOutMailbox []store.AgentHandoff
	decodeJSON(t, signedOutMailboxResp, &signedOutMailbox)
	if len(signedOutMailbox) != 0 {
		t.Fatalf("signed-out mailbox should be redacted, got %#v", signedOutMailbox)
	}

	signedOutPullRequestsReq, err := http.NewRequest(http.MethodGet, server.URL+"/v1/pull-requests", nil)
	if err != nil {
		t.Fatalf("new GET /v1/pull-requests invalid token request error = %v", err)
	}
	signedOutPullRequestsReq.Header.Set(authTokenHeaderName, invalidToken)
	signedOutPullRequestsResp, err := signedOutClient.Do(signedOutPullRequestsReq)
	if err != nil {
		t.Fatalf("GET /v1/pull-requests signed out error = %v", err)
	}
	if signedOutPullRequestsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/pull-requests signed out status = %d, want %d", signedOutPullRequestsResp.StatusCode, http.StatusOK)
	}
	var signedOutPullRequests []store.PullRequest
	decodeJSON(t, signedOutPullRequestsResp, &signedOutPullRequests)
	if len(signedOutPullRequests) != 0 {
		t.Fatalf("signed-out pull requests should be redacted, got %#v", signedOutPullRequests)
	}

	for _, endpoint := range []string{
		"/v1/mailbox/" + createPayload.Handoff.ID,
		"/v1/pull-requests/pr-runtime-18",
		"/v1/pull-requests/pr-runtime-18/detail",
		"/v1/rooms/room-runtime",
		"/v1/runs/run_runtime_01/detail",
	} {
		req, err := http.NewRequest(http.MethodGet, server.URL+endpoint, nil)
		if err != nil {
			t.Fatalf("new GET %s invalid token request error = %v", endpoint, err)
		}
		req.Header.Set(authTokenHeaderName, invalidToken)
		resp, err := signedOutClient.Do(req)
		if err != nil {
			t.Fatalf("GET %s signed out error = %v", endpoint, err)
		}
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("GET %s signed out status = %d, want %d", endpoint, resp.StatusCode, http.StatusNotFound)
		}
		resp.Body.Close()
	}
}

func containsPermission(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func authCookieFromResponse(resp *http.Response) *http.Cookie {
	if resp == nil {
		return nil
	}
	for _, cookie := range resp.Cookies() {
		if cookie != nil && cookie.Name == authTokenCookieName {
			return cookie
		}
	}
	for _, header := range resp.Header.Values("Set-Cookie") {
		if !strings.HasPrefix(header, authTokenCookieName+"=") {
			continue
		}
		parsed := (&http.Response{Header: http.Header{"Set-Cookie": []string{header}}}).Cookies()
		for _, cookie := range parsed {
			if cookie != nil && cookie.Name == authTokenCookieName {
				return cookie
			}
		}
	}
	return nil
}

func contractBrowserClient(t *testing.T) *http.Client {
	t.Helper()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	return &http.Client{
		Jar:       jar,
		Transport: http.DefaultTransport,
	}
}

func findWorkspaceMember(items []store.WorkspaceMember, memberID string) *store.WorkspaceMember {
	for index := range items {
		if items[index].ID == memberID {
			return &items[index]
		}
	}
	return nil
}
