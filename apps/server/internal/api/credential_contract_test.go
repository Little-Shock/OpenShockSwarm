package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestCredentialProfileRoutePersistsEncryptedVaultWithoutLeakingPlaintext(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	secretValue := "ghp_live_truth_secret_demo"
	createResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/credentials",
		`{"label":"GitHub App","summary":"repo sync secret","secretKind":"github-app","secretValue":"`+secretValue+`","workspaceDefault":true}`,
	)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/credentials status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var payload struct {
		Credential store.CredentialProfile `json:"credential"`
		State      store.State             `json:"state"`
	}
	decodeJSON(t, createResp, &payload)
	if payload.Credential.Label != "GitHub App" || payload.Credential.SecretStatus != "configured" {
		t.Fatalf("created credential = %#v, want configured GitHub App", payload.Credential)
	}
	if len(payload.State.Credentials) != 1 {
		t.Fatalf("state credentials = %#v, want exactly one credential", payload.State.Credentials)
	}

	stateBody, err := os.ReadFile(filepath.Join(root, "data", "state.json"))
	if err != nil {
		t.Fatalf("ReadFile(state.json) error = %v", err)
	}
	if strings.Contains(string(stateBody), secretValue) {
		t.Fatalf("state.json leaked plaintext secret: %s", secretValue)
	}

	vaultBody, err := os.ReadFile(filepath.Join(root, "data", "credentials.vault.json"))
	if err != nil {
		t.Fatalf("ReadFile(credentials.vault.json) error = %v", err)
	}
	if strings.Contains(string(vaultBody), secretValue) {
		t.Fatalf("credentials.vault.json leaked plaintext secret: %s", secretValue)
	}
	if !strings.Contains(string(vaultBody), "ciphertext") {
		t.Fatalf("credentials.vault.json = %s, want ciphertext field", string(vaultBody))
	}

	keyBody, err := os.ReadFile(filepath.Join(root, "data", "credentials.vault.key"))
	if err != nil {
		t.Fatalf("ReadFile(credentials.vault.key) error = %v", err)
	}
	if len(strings.TrimSpace(string(keyBody))) == 0 {
		t.Fatalf("credentials.vault.key is empty")
	}

	stateResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer stateResp.Body.Close()
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", stateResp.StatusCode, http.StatusOK)
	}
	var snapshot store.State
	decodeJSON(t, stateResp, &snapshot)
	if len(snapshot.Credentials) != 1 || snapshot.Credentials[0].Label != "GitHub App" {
		t.Fatalf("snapshot credentials = %#v, want GitHub App metadata", snapshot.Credentials)
	}
	if snapshot.Credentials[0].LastUsedRunID != "" {
		t.Fatalf("snapshot credential usage should be empty before exec: %#v", snapshot.Credentials[0])
	}
}

func TestRunCredentialBindingAndExecRecordSecretScopeGuardAndAudit(t *testing.T) {
	root := t.TempDir()
	s, _, server, cleanup := newAuthGuardTestServer(t, root)
	defer cleanup()
	defer server.Close()

	if s.Snapshot().Auth.Session.Email != "larkspur@openshock.dev" {
		t.Fatalf("unexpected seeded auth session: %#v", s.Snapshot().Auth.Session)
	}

	createResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/credentials",
		`{"label":"Runtime Token","summary":"run scoped token","secretKind":"api-token","secretValue":"runtime-secret-demo","workspaceDefault":false}`,
	)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/credentials status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var created struct {
		Credential store.CredentialProfile `json:"credential"`
	}
	decodeJSON(t, createResp, &created)

	bindResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPatch,
		server.URL+"/v1/runs/run_runtime_01/credentials",
		`{"credentialProfileIds":["`+created.Credential.ID+`"]}`,
	)
	defer bindResp.Body.Close()
	if bindResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/runs/run_runtime_01/credentials status = %d, want %d", bindResp.StatusCode, http.StatusOK)
	}

	var bindPayload struct {
		Run   store.Run   `json:"run"`
		State store.State `json:"state"`
	}
	decodeJSON(t, bindResp, &bindPayload)
	if len(bindPayload.Run.CredentialProfileIDs) != 1 || bindPayload.Run.CredentialProfileIDs[0] != created.Credential.ID {
		t.Fatalf("run credential binding = %#v, want direct bound credential", bindPayload.Run.CredentialProfileIDs)
	}
	if !stateHasCredentialGuard(bindPayload.State, "run_runtime_01", "Runtime Token") {
		t.Fatalf("state guards = %#v, want secret scope guard for run_runtime_01", bindPayload.State.Guards)
	}

	execResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/exec",
		`{"prompt":"continue with current secret scope","runId":"run_runtime_01"}`,
	)
	defer execResp.Body.Close()
	if execResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/exec status = %d, want %d", execResp.StatusCode, http.StatusOK)
	}

	stateResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer stateResp.Body.Close()
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", stateResp.StatusCode, http.StatusOK)
	}
	var snapshot store.State
	decodeJSON(t, stateResp, &snapshot)
	if !stateHasCredentialGuard(snapshot, "run_runtime_01", "Runtime Token") {
		t.Fatalf("snapshot guards = %#v, want secret scope guard after exec", snapshot.Guards)
	}
	if snapshot.Credentials[0].LastUsedRunID != "run_runtime_01" || snapshot.Credentials[0].LastUsedBy != "Larkspur" {
		t.Fatalf("credential audit = %#v, want last used on run_runtime_01 by Larkspur", snapshot.Credentials[0])
	}
}

func stateHasCredentialGuard(snapshot store.State, runID, wantLabel string) bool {
	for _, guard := range snapshot.Guards {
		if guard.RunID != runID || guard.Risk != "secret_scope" {
			continue
		}
		for _, boundary := range guard.Boundaries {
			if boundary.Label == "Profiles" && strings.Contains(boundary.Value, wantLabel) {
				return true
			}
		}
	}
	return false
}
