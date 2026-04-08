package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestAuthSessionRouteSupportsLoginAndLogout(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
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
	if initial.Status != "active" || initial.Email != "larkspur@openshock.dev" || initial.Role != "owner" {
		t.Fatalf("initial auth session = %#v, want owner session", initial)
	}

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"mina@openshock.dev"}`)))
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

	var deletePayload struct {
		Session store.AuthSession `json:"session"`
		State   store.State       `json:"state"`
	}
	decodeJSON(t, deleteResp, &deletePayload)
	if deletePayload.Session.Status != "signed_out" || deletePayload.State.Auth.Session.Status != "signed_out" {
		t.Fatalf("delete payload = %#v, want signed_out session", deletePayload)
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

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"mina@openshock.dev"}`)))
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
	if memberDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/workspace/members/member-larkspur status = %d, want %d", memberDetailResp.StatusCode, http.StatusOK)
	}

	var member store.WorkspaceMember
	decodeJSON(t, memberDetailResp, &member)
	if member.Email != "larkspur@openshock.dev" || member.Role != "owner" {
		t.Fatalf("member detail = %#v, want larkspur owner", member)
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

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev"}`)))
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
	if authMember == nil || authMember.Status != "active" || authMember.Role != "member" {
		t.Fatalf("reviewer member after login = %#v, want active member", authMember)
	}

	restoreOwnerResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"larkspur@openshock.dev"}`)))
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

	blockedLoginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/session suspended reviewer error = %v", err)
	}
	if blockedLoginResp.StatusCode != http.StatusForbidden {
		t.Fatalf("POST /v1/auth/session suspended reviewer status = %d, want %d", blockedLoginResp.StatusCode, http.StatusForbidden)
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

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)))
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

	verifyResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev"}`)))
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

	authorizeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","deviceId":"`+loginPayload.Session.DeviceID+`"}`)))
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

	resetResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"request_password_reset","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery request_password_reset error = %v", err)
	}
	if resetResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/recovery request_password_reset status = %d, want %d", resetResp.StatusCode, http.StatusOK)
	}

	var resetPayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, resetResp, &resetPayload)
	if resetPayload.Member.PasswordResetStatus != "pending" {
		t.Fatalf("reset payload member = %#v, want pending reset", resetPayload.Member)
	}

	completeResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"complete_password_reset","email":"reviewer@openshock.dev","deviceLabel":"Reviewer Laptop"}`)))
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

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"reviewer@openshock.dev","deviceLabel":"Reviewer Phone"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	unknownDeviceResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"authorize_device","email":"reviewer@openshock.dev","deviceId":"device-missing"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery authorize_device unknown error = %v", err)
	}
	if unknownDeviceResp.StatusCode != http.StatusNotFound {
		t.Fatalf("POST /v1/auth/recovery authorize_device unknown status = %d, want %d", unknownDeviceResp.StatusCode, http.StatusNotFound)
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

	signedOutResp, err := http.Post(server.URL+"/v1/auth/recovery", "application/json", bytes.NewReader([]byte(`{"action":"verify_email","email":"reviewer@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/recovery verify_email signed out error = %v", err)
	}
	if signedOutResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST /v1/auth/recovery verify_email signed out status = %d, want %d", signedOutResp.StatusCode, http.StatusUnauthorized)
	}
}

func TestStateRouteExposesAuthContract(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
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
	if auth.Session.Status != "active" || len(auth.Members) < 3 || len(auth.Roles) != 3 {
		t.Fatalf("state auth payload malformed: %#v", auth)
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

func findWorkspaceMember(items []store.WorkspaceMember, memberID string) *store.WorkspaceMember {
	for index := range items {
		if items[index].ID == memberID {
			return &items[index]
		}
	}
	return nil
}
