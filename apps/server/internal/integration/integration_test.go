//go:build integration

package integration

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const integrationAuthTokenHeader = "X-OpenShock-Auth-Token"

func TestPhaseZeroLoopThroughDaemon(t *testing.T) {
	projectRoot := projectRoot(t)
	repoRoot := createTempGitRepo(t)
	prependCLIToPath(t, writeFakeClaudeCLI(t))
	prependCLIToPath(t, writeFakeGitWrapper(t))
	prependCLIToPath(t, writeFakeGitHubCLI(t))

	daemonPort := freePort(t)
	serverPort := freePort(t)
	daemonURL := "http://127.0.0.1:" + daemonPort
	serverURL := "http://127.0.0.1:" + serverPort

	daemon := startProcess(t,
		filepath.Join(projectRoot, "apps", "daemon"),
		nil,
		"go", "run", "./cmd/openshock-daemon",
		"--workspace-root", repoRoot,
		"--addr", "127.0.0.1:"+daemonPort,
	)
	waitForHealth(t, daemonURL+"/healthz", daemon)

	serverEnv := []string{
		"OPENSHOCK_SERVER_ADDR=127.0.0.1:" + serverPort,
		"OPENSHOCK_DAEMON_URL=" + daemonURL,
		"OPENSHOCK_WORKSPACE_ROOT=" + repoRoot,
		"OPENSHOCK_STATE_FILE=" + filepath.Join(repoRoot, "data", "phase0", "state.json"),
	}
	server := startProcess(t,
		filepath.Join(projectRoot, "apps", "server"),
		serverEnv,
		"go", "run", "./cmd/openshock-server",
	)
	waitForHealth(t, serverURL+"/healthz", server)

	loginChallenge := postJSON(t, serverURL+"/v1/auth/recovery", map[string]any{
		"action": "request_login_challenge",
		"email":  "larkspur@openshock.dev",
	}, http.StatusOK, "")
	loginChallengePayload, ok := loginChallenge["challenge"].(map[string]any)
	if !ok {
		t.Fatalf("login challenge payload malformed: %#v", loginChallenge["challenge"])
	}
	login := postJSON(t, serverURL+"/v1/auth/session", map[string]any{
		"email":       "larkspur@openshock.dev",
		"deviceLabel": "Owner Browser",
		"challengeId": stringField(t, loginChallengePayload, "id"),
	}, http.StatusOK, "")
	authToken := stringField(t, login, "token")
	session, ok := login["session"].(map[string]any)
	if !ok {
		t.Fatalf("login session payload malformed: %#v", login["session"])
	}
	if stringField(t, session, "emailVerificationStatus") != "verified" {
		verifyChallenge := postJSON(t, serverURL+"/v1/auth/recovery", map[string]any{
			"action": "request_verify_email_challenge",
			"email":  "larkspur@openshock.dev",
		}, http.StatusOK, authToken)
		verifyChallengePayload, ok := verifyChallenge["challenge"].(map[string]any)
		if !ok {
			t.Fatalf("verify challenge payload malformed: %#v", verifyChallenge["challenge"])
		}
		postJSON(t, serverURL+"/v1/auth/recovery", map[string]any{
			"action":      "verify_email",
			"email":       "larkspur@openshock.dev",
			"challengeId": stringField(t, verifyChallengePayload, "id"),
		}, http.StatusOK, authToken)
	}
	if stringField(t, session, "deviceAuthStatus") != "authorized" {
		authorizeChallenge := postJSON(t, serverURL+"/v1/auth/recovery", map[string]any{
			"action":   "request_authorize_device_challenge",
			"deviceId": stringField(t, session, "deviceId"),
		}, http.StatusOK, authToken)
		authorizeChallengePayload, ok := authorizeChallenge["challenge"].(map[string]any)
		if !ok {
			t.Fatalf("authorize challenge payload malformed: %#v", authorizeChallenge["challenge"])
		}
		postJSON(t, serverURL+"/v1/auth/recovery", map[string]any{
			"action":      "authorize_device",
			"deviceId":    stringField(t, session, "deviceId"),
			"challengeId": stringField(t, authorizeChallengePayload, "id"),
		}, http.StatusOK, authToken)
	}

	pairing := postJSON(t, serverURL+"/v1/runtime/pairing", map[string]any{
		"daemonUrl": daemonURL,
	}, http.StatusOK, authToken)
	pairingState, ok := pairing["state"].(map[string]any)
	if !ok {
		t.Fatalf("pairing state payload malformed: %#v", pairing["state"])
	}
	workspace, ok := pairingState["workspace"].(map[string]any)
	if !ok {
		t.Fatalf("pairing workspace payload malformed: %#v", pairingState["workspace"])
	}
	if stringField(t, workspace, "pairedRuntime") == "" {
		t.Fatalf("pairedRuntime should not be empty after pairing")
	}

	repoBinding := postJSON(t, serverURL+"/v1/repo/binding", map[string]any{}, http.StatusOK, authToken)
	binding, ok := repoBinding["binding"].(map[string]any)
	if !ok {
		t.Fatalf("repo binding payload malformed: %#v", repoBinding["binding"])
	}
	if stringField(t, binding, "repo") != "example/integration-loop" {
		t.Fatalf("bound repo = %q, want example/integration-loop", stringField(t, binding, "repo"))
	}
	if stringField(t, binding, "provider") != "github" {
		t.Fatalf("bound provider = %q, want github", stringField(t, binding, "provider"))
	}
	if stringField(t, binding, "authMode") != "local-git-origin" {
		t.Fatalf("bound auth mode = %q, want local-git-origin", stringField(t, binding, "authMode"))
	}
	githubConnection := getJSON(t, serverURL+"/v1/github/connection", authToken)
	if stringField(t, githubConnection, "repo") != "example/integration-loop" {
		t.Fatalf("github connection repo = %q, want example/integration-loop", stringField(t, githubConnection, "repo"))
	}
	if remoteConfigured, ok := githubConnection["remoteConfigured"].(bool); !ok || !remoteConfigured {
		t.Fatalf("github connection remoteConfigured = %#v, want true", githubConnection["remoteConfigured"])
	}

	createIssue := map[string]any{
		"title":    "Integration Loop",
		"summary":  "verify issue room run pr inbox memory",
		"owner":    "Claude Review Runner",
		"priority": "critical",
	}
	created := postJSON(t, serverURL+"/v1/issues", createIssue, http.StatusCreated, authToken)
	roomID := stringField(t, created, "roomId")
	runID := stringField(t, created, "runId")
	sessionID := stringField(t, created, "sessionId")

	if _, err := exec.LookPath("claude"); err == nil {
		streamResp := postStream(t, serverURL+"/v1/rooms/"+roomID+"/messages/stream", map[string]any{
			"provider": "claude",
			"prompt":   "请只回复两行：stream-ready 和 done",
		}, http.StatusOK, authToken)

		streamText := strings.ToLower(strings.Join(streamResp.deltas, " ") + " " + streamResp.output)
		if !strings.Contains(streamText, "stream-ready") {
			t.Fatalf("stream output = %q, want substring stream-ready", streamText)
		}

		stateAfterStream := getJSON(t, serverURL+"/v1/state", authToken)
		roomMessagesRaw, ok := stateAfterStream["roomMessages"].(map[string]any)
		if !ok {
			t.Fatalf("roomMessages payload malformed: %#v", stateAfterStream["roomMessages"])
		}
		messageList, ok := roomMessagesRaw[roomID].([]any)
		if !ok || len(messageList) < 3 {
			t.Fatalf("expected persisted room messages after stream, got %#v", roomMessagesRaw[roomID])
		}
	}

	prCreated := postJSON(t, serverURL+"/v1/rooms/"+roomID+"/pull-request", map[string]any{}, http.StatusOK, authToken)
	pullRequestID := stringField(t, prCreated, "pullRequestId")

	postJSON(t, serverURL+"/v1/pull-requests/"+pullRequestID, map[string]any{
		"status": "merged",
	}, http.StatusOK, authToken)

	state := getJSON(t, serverURL+"/v1/state", authToken)
	issue := findByField(t, state["issues"], "roomId", roomID)
	run := findByField(t, state["runs"], "id", runID)
	runSession := findByField(t, state["sessions"], "id", sessionID)
	pullRequest := findByField(t, state["pullRequests"], "id", pullRequestID)

	if stringField(t, issue, "state") != "done" {
		t.Fatalf("issue state = %q, want done", stringField(t, issue, "state"))
	}
	if stringField(t, run, "status") != "done" {
		t.Fatalf("run status = %q, want done", stringField(t, run, "status"))
	}
	if stringField(t, pullRequest, "status") != "merged" {
		t.Fatalf("pull request status = %q, want merged", stringField(t, pullRequest, "status"))
	}

	memoryPaths := stringSliceField(t, runSession, "memoryPaths")
	if len(memoryPaths) < 4 {
		t.Fatalf("session memory paths = %#v, want >= 4 entries", memoryPaths)
	}

	decisionPath := filepath.Join(repoRoot, "decisions", strings.ToLower(stringField(t, issue, "key"))+".md")
	body, err := os.ReadFile(decisionPath)
	if err != nil {
		t.Fatalf("read decision file: %v", err)
	}
	content := string(body)
	if !strings.Contains(content, "- Current: merged") {
		t.Fatalf("decision file missing merged status:\n%s", content)
	}

	roomNotePath := filepath.Join(repoRoot, "notes", "rooms", roomID+".md")
	roomBody, err := os.ReadFile(roomNotePath)
	if err != nil {
		t.Fatalf("read room note: %v", err)
	}
	roomContent := string(roomBody)
	if !strings.Contains(roomContent, "Pull Request Created") || !strings.Contains(roomContent, "Pull Request Status Updated") {
		t.Fatalf("room note missing PR lifecycle entries:\n%s", roomContent)
	}

	memoryPath := filepath.Join(repoRoot, "MEMORY.md")
	memoryBody, err := os.ReadFile(memoryPath)
	if err != nil {
		t.Fatalf("read workspace memory: %v", err)
	}
	memoryContent := string(memoryBody)
	if !strings.Contains(memoryContent, "Issue Created") || !strings.Contains(memoryContent, "Worktree Ready") || !strings.Contains(memoryContent, "Pull Request Created") || !strings.Contains(memoryContent, "Pull Request Status Updated") {
		t.Fatalf("workspace memory missing lifecycle writeback:\n%s", memoryContent)
	}

	memoryArtifact := findByField(t, state["memory"], "path", "MEMORY.md")
	if !strings.Contains(stringField(t, memoryArtifact, "summary"), "Pull Request Status Updated") {
		t.Fatalf("workspace memory artifact summary = %q, want latest writeback", stringField(t, memoryArtifact, "summary"))
	}
	decisionArtifact := findByField(t, state["memory"], "path", filepath.ToSlash(filepath.Join("decisions", strings.ToLower(stringField(t, issue, "key"))+".md")))
	if !strings.Contains(stringField(t, decisionArtifact, "summary"), "merged") {
		t.Fatalf("decision artifact summary = %q, want merged writeback", stringField(t, decisionArtifact, "summary"))
	}

	deleteReq, err := http.NewRequestWithContext(context.Background(), http.MethodDelete, serverURL+"/v1/runtime/pairing", nil)
	if err != nil {
		t.Fatalf("new delete pairing request: %v", err)
	}
	deleteReq.Header.Set(integrationAuthTokenHeader, authToken)
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete pairing: %v", err)
	}
	defer deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(deleteResp.Body)
		t.Fatalf("delete pairing status = %d, want %d, body=%s", deleteResp.StatusCode, http.StatusOK, string(payload))
	}

	runtimeAfterDelete := getJSON(t, serverURL+"/v1/runtime", authToken)
	if stringField(t, runtimeAfterDelete, "state") != "offline" {
		t.Fatalf("runtime state after delete = %q, want offline", stringField(t, runtimeAfterDelete, "state"))
	}
}

func TestConcurrentBrowserAuthWalkthroughStaysRequestScoped(t *testing.T) {
	projectRoot := projectRoot(t)
	repoRoot := createTempGitRepo(t)
	serverPort := freePort(t)
	serverURL := "http://127.0.0.1:" + serverPort

	serverEnv := []string{
		"OPENSHOCK_SERVER_ADDR=127.0.0.1:" + serverPort,
		"OPENSHOCK_WORKSPACE_ROOT=" + repoRoot,
		"OPENSHOCK_STATE_FILE=" + filepath.Join(repoRoot, "data", "request-scoped-auth", "state.json"),
	}
	server := startProcess(t,
		filepath.Join(projectRoot, "apps", "server"),
		serverEnv,
		"go", "run", "./cmd/openshock-server",
	)
	waitForHealth(t, serverURL+"/healthz", server)

	ownerClient := newBrowserClient(t)
	ownerSession := loginReadyBrowserSession(t, ownerClient, serverURL, "larkspur@openshock.dev", "Owner Browser")
	if stringField(t, ownerSession, "email") != "larkspur@openshock.dev" || stringField(t, ownerSession, "role") != "owner" {
		t.Fatalf("owner browser session = %#v, want owner session", ownerSession)
	}

	memberList := getJSONWithClient(t, ownerClient, serverURL+"/v1/workspace/members", "")
	memberEntries, ok := memberList["members"].([]any)
	if !ok {
		t.Fatalf("workspace members payload malformed: %#v", memberList["members"])
	}
	var memberPayload map[string]any
	for _, item := range memberEntries {
		candidate, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("workspace members item malformed: %#v", item)
		}
		if stringField(t, candidate, "email") == "mina@openshock.dev" {
			memberPayload = candidate
			break
		}
	}
	if memberPayload == nil {
		memberInvite := doJSONWithClient(t, ownerClient, http.MethodPost, serverURL+"/v1/workspace/members", map[string]any{
			"email": "mina@openshock.dev",
			"name":  "Mina",
			"role":  "member",
		}, http.StatusCreated, "")
		invited, ok := memberInvite["member"].(map[string]any)
		if !ok {
			t.Fatalf("member invite payload malformed: %#v", memberInvite["member"])
		}
		memberPayload = invited
	}
	memberID := stringField(t, memberPayload, "id")

	memberClient := newBrowserClient(t)
	memberSession := loginReadyBrowserSession(t, memberClient, serverURL, "mina@openshock.dev", "Mina Browser")
	if stringField(t, memberSession, "email") != "mina@openshock.dev" || stringField(t, memberSession, "role") != "member" {
		t.Fatalf("member browser session = %#v, want mina member session", memberSession)
	}

	ownerPreferences := doJSONWithClient(t, ownerClient, http.MethodPatch, serverURL+"/v1/workspace/members/member-larkspur/preferences", map[string]any{
		"startRoute":   "/mailbox",
		"githubHandle": "@owner-browser",
	}, http.StatusOK, "")
	ownerState, ok := ownerPreferences["state"].(map[string]any)
	if !ok {
		t.Fatalf("owner preference state payload malformed: %#v", ownerPreferences["state"])
	}
	ownerAuth, ok := ownerState["auth"].(map[string]any)
	if !ok {
		t.Fatalf("owner preference auth payload malformed: %#v", ownerState["auth"])
	}
	ownerStateSession, ok := ownerAuth["session"].(map[string]any)
	if !ok {
		t.Fatalf("owner preference session payload malformed: %#v", ownerAuth["session"])
	}
	if stringField(t, ownerStateSession, "email") != "larkspur@openshock.dev" {
		t.Fatalf("owner preference session email = %q, want larkspur@openshock.dev", stringField(t, ownerStateSession, "email"))
	}
	ownerPreferencesMap, ok := ownerStateSession["preferences"].(map[string]any)
	if !ok {
		t.Fatalf("owner preference session preferences malformed: %#v", ownerStateSession["preferences"])
	}
	if stringField(t, ownerPreferencesMap, "startRoute") != "/mailbox" {
		t.Fatalf("owner preference startRoute = %q, want /mailbox", stringField(t, ownerPreferencesMap, "startRoute"))
	}

	memberPreferences := doJSONWithClient(t, memberClient, http.MethodPatch, serverURL+"/v1/workspace/members/"+memberID+"/preferences", map[string]any{
		"startRoute":   "/rooms",
		"githubHandle": "@mina-browser",
	}, http.StatusOK, "")
	memberState, ok := memberPreferences["state"].(map[string]any)
	if !ok {
		t.Fatalf("member preference state payload malformed: %#v", memberPreferences["state"])
	}
	memberAuth, ok := memberState["auth"].(map[string]any)
	if !ok {
		t.Fatalf("member preference auth payload malformed: %#v", memberState["auth"])
	}
	memberStateSession, ok := memberAuth["session"].(map[string]any)
	if !ok {
		t.Fatalf("member preference session payload malformed: %#v", memberAuth["session"])
	}
	if stringField(t, memberStateSession, "email") != "mina@openshock.dev" {
		t.Fatalf("member preference session email = %q, want mina@openshock.dev", stringField(t, memberStateSession, "email"))
	}
	memberPreferencesMap, ok := memberStateSession["preferences"].(map[string]any)
	if !ok {
		t.Fatalf("member preference session preferences malformed: %#v", memberStateSession["preferences"])
	}
	if stringField(t, memberPreferencesMap, "startRoute") != "/rooms" {
		t.Fatalf("member preference startRoute = %q, want /rooms", stringField(t, memberPreferencesMap, "startRoute"))
	}

	roomID := "room-runtime"

	logoutPayload := doJSONWithClient(t, memberClient, http.MethodDelete, serverURL+"/v1/auth/session", nil, http.StatusOK, "")
	logoutSession, ok := logoutPayload["session"].(map[string]any)
	if !ok {
		t.Fatalf("logout session payload malformed: %#v", logoutPayload["session"])
	}
	if stringField(t, logoutSession, "status") != "signed_out" {
		t.Fatalf("logout session status = %q, want signed_out", stringField(t, logoutSession, "status"))
	}

	memberSignedOutState := getJSONWithClient(t, memberClient, serverURL+"/v1/state", "")
	memberSignedOutAuth, ok := memberSignedOutState["auth"].(map[string]any)
	if !ok {
		t.Fatalf("member signed-out auth payload malformed: %#v", memberSignedOutState["auth"])
	}
	memberSignedOutSession, ok := memberSignedOutAuth["session"].(map[string]any)
	if !ok {
		t.Fatalf("member signed-out session payload malformed: %#v", memberSignedOutAuth["session"])
	}
	if stringField(t, memberSignedOutSession, "status") != "signed_out" {
		t.Fatalf("member signed-out state session = %#v, want signed_out session", memberSignedOutSession)
	}

	ownerCurrentSession := getJSONWithClient(t, ownerClient, serverURL+"/v1/auth/session", "")
	if stringField(t, ownerCurrentSession, "email") != "larkspur@openshock.dev" {
		t.Fatalf("owner current session email = %q, want larkspur@openshock.dev", stringField(t, ownerCurrentSession, "email"))
	}
	ownerCurrentPreferences, ok := ownerCurrentSession["preferences"].(map[string]any)
	if !ok {
		t.Fatalf("owner current session preferences malformed: %#v", ownerCurrentSession["preferences"])
	}
	if stringField(t, ownerCurrentPreferences, "startRoute") != "/mailbox" {
		t.Fatalf("owner current startRoute = %q, want /mailbox", stringField(t, ownerCurrentPreferences, "startRoute"))
	}
	ownerIdentity, ok := ownerCurrentSession["githubIdentity"].(map[string]any)
	if !ok {
		t.Fatalf("owner current github identity malformed: %#v", ownerCurrentSession["githubIdentity"])
	}
	if stringField(t, ownerIdentity, "handle") != "@owner-browser" {
		t.Fatalf("owner current github handle = %q, want @owner-browser", stringField(t, ownerIdentity, "handle"))
	}

	ownerCurrentState := getJSONWithClient(t, ownerClient, serverURL+"/v1/state", "")
	ownerCurrentAuth, ok := ownerCurrentState["auth"].(map[string]any)
	if !ok {
		t.Fatalf("owner current auth payload malformed: %#v", ownerCurrentState["auth"])
	}
	ownerStateSession, ok = ownerCurrentAuth["session"].(map[string]any)
	if !ok {
		t.Fatalf("owner current state session payload malformed: %#v", ownerCurrentAuth["session"])
	}
	if stringField(t, ownerStateSession, "email") != "larkspur@openshock.dev" {
		t.Fatalf("owner current state session email = %q, want larkspur@openshock.dev", stringField(t, ownerStateSession, "email"))
	}

	memberRoomResp, err := memberClient.Get(serverURL + "/v1/rooms/" + roomID)
	if err != nil {
		t.Fatalf("GET /v1/rooms/%s member signed-out error = %v", roomID, err)
	}
	defer memberRoomResp.Body.Close()
	if memberRoomResp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(memberRoomResp.Body)
		t.Fatalf("GET /v1/rooms/%s member signed-out status = %d, want %d, body=%s", roomID, memberRoomResp.StatusCode, http.StatusNotFound, string(body))
	}

	ownerRoomResp, err := ownerClient.Get(serverURL + "/v1/rooms/" + roomID)
	if err != nil {
		t.Fatalf("GET /v1/rooms/%s owner active error = %v", roomID, err)
	}
	defer ownerRoomResp.Body.Close()
	if ownerRoomResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(ownerRoomResp.Body)
		t.Fatalf("GET /v1/rooms/%s owner active status = %d, want %d, body=%s", roomID, ownerRoomResp.StatusCode, http.StatusOK, string(body))
	}
}

func writeFakeClaudeCLI(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	script := `#!/bin/sh
args="$*"
case "$args" in
  "auth status")
    printf '{"loggedIn":true,"authMethod":"test","apiProvider":"firstParty"}\n'
    ;;
  *stream-ready*)
    printf 'stream-ready\ndone\n'
    ;;
  *)
    printf 'integration-ready\n'
    ;;
esac
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude cli: %v", err)
	}
	return dir
}

func writeFakeGitHubCLI(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	statePath := filepath.Join(dir, "gh-state")
	if err := os.WriteFile(statePath, []byte("open"), 0o644); err != nil {
		t.Fatalf("write fake gh state: %v", err)
	}
	t.Setenv("OPENSHOCK_FAKE_GH_STATE", statePath)

	path := filepath.Join(dir, "gh")
	script := `#!/bin/sh
state_file="${OPENSHOCK_FAKE_GH_STATE:?}"
command="$1"
subcommand="$2"

if [ "$command" = "auth" ] && [ "$subcommand" = "status" ]; then
  printf 'github.com\n  ✓ Logged in\n'
  exit 0
fi

if [ "$command" = "pr" ] && [ "$subcommand" = "create" ]; then
  printf 'open' > "$state_file"
  printf 'https://github.com/example/integration-loop/pull/101\n'
  exit 0
fi

if [ "$command" = "pr" ] && [ "$subcommand" = "merge" ]; then
  printf 'merged' > "$state_file"
  printf 'merged\n'
  exit 0
fi

if [ "$command" = "pr" ] && [ "$subcommand" = "view" ]; then
  state="$(cat "$state_file" 2>/dev/null || printf 'open')"
  if [ "$state" = "merged" ]; then
    printf '{"number":101,"title":"Integration Loop","url":"https://github.com/example/integration-loop/pull/101","state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","headRefName":"feat/integration-loop","baseRefName":"main","updatedAt":"2026-04-06T11:24:00Z","mergedAt":"2026-04-06T11:24:00Z","author":{"login":"ClaudeReviewRunner"}}\n'
  else
    printf '{"number":101,"title":"Integration Loop","url":"https://github.com/example/integration-loop/pull/101","state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","headRefName":"feat/integration-loop","baseRefName":"main","updatedAt":"2026-04-06T11:20:00Z","mergedAt":"","author":{"login":"ClaudeReviewRunner"}}\n'
  fi
  exit 0
fi

printf 'unsupported gh invocation: %s\n' "$*" >&2
exit 1
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake gh cli: %v", err)
	}
	return dir
}

func writeFakeGitWrapper(t *testing.T) string {
	t.Helper()

	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatalf("LookPath(git): %v", err)
	}
	t.Setenv("OPENSHOCK_REAL_GIT", realGit)

	dir := t.TempDir()
	path := filepath.Join(dir, "git")
	script := `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "push" ]; then
    exit 0
  fi
done
exec "${OPENSHOCK_REAL_GIT:?}" "$@"
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake git wrapper: %v", err)
	}
	return dir
}

func prependCLIToPath(t *testing.T, dir string) {
	t.Helper()
	current := os.Getenv("PATH")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+current)
}

type streamResponse struct {
	deltas []string
	output string
}

func projectRoot(t *testing.T) string {
	t.Helper()

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	return filepath.Clean(filepath.Join(wd, "..", "..", "..", ".."))
}

func createTempGitRepo(t *testing.T) string {
	t.Helper()

	root := t.TempDir()
	runGit(t, root, "init", "-b", "main")
	runGit(t, root, "config", "user.name", "OpenShock Test")
	runGit(t, root, "config", "user.email", "openshock@example.com")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# integration\n"), 0o644); err != nil {
		t.Fatalf("write README.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "SOUL.md"), []byte("# SOUL.md\n\n[ROOT_DIRECTIVE: TEST]\n"), 0o644); err != nil {
		t.Fatalf("write SOUL.md: %v", err)
	}
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "init")
	runGit(t, root, "remote", "add", "origin", "https://github.com/example/integration-loop.git")
	return root
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("git %s failed: %v\nstderr: %s", strings.Join(args, " "), err, stderr.String())
	}
	return strings.TrimSpace(stdout.String())
}

func newBrowserClient(t *testing.T) *http.Client {
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

func freePort(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("free port: %v", err)
	}
	defer listener.Close()
	return fmt.Sprintf("%d", listener.Addr().(*net.TCPAddr).Port)
}

func startProcess(t *testing.T, dir string, env []string, args ...string) *exec.Cmd {
	t.Helper()

	if len(args) == 0 {
		t.Fatal("startProcess requires at least one arg")
	}
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		t.Fatalf("start %s: %v", strings.Join(args, " "), err)
	}

	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		done := make(chan struct{})
		go func() {
			_ = cmd.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
	})

	return cmd
}

func waitForHealth(t *testing.T, url string, cmd *exec.Cmd) {
	t.Helper()

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			t.Fatalf("process exited before health check became ready: %s", url)
		}
		time.Sleep(300 * time.Millisecond)
	}
	t.Fatalf("health check not ready: %s", url)
}

func getJSON(t *testing.T, url, authToken string) map[string]any {
	t.Helper()

	return getJSONWithClient(t, nil, url, authToken)
}

func getJSONWithClient(t *testing.T, client *http.Client, url, authToken string) map[string]any {
	t.Helper()

	if client == nil {
		client = http.DefaultClient
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new GET %s: %v", url, err)
	}
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set(integrationAuthTokenHeader, authToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET %s status = %d body=%s", url, resp.StatusCode, string(body))
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode GET %s: %v", url, err)
	}
	return payload
}

func postJSON(t *testing.T, url string, body map[string]any, wantStatus int, authToken string) map[string]any {
	t.Helper()

	return doJSONWithClient(t, nil, http.MethodPost, url, body, wantStatus, authToken)
}

func doJSONWithClient(t *testing.T, client *http.Client, method, url string, body map[string]any, wantStatus int, authToken string) map[string]any {
	t.Helper()

	if client == nil {
		client = http.DefaultClient
	}

	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal %s: %v", url, err)
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, url, reader)
	if err != nil {
		t.Fatalf("new request %s %s: %v", method, url, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set(integrationAuthTokenHeader, authToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != wantStatus {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("%s %s status = %d, want %d, body=%s", method, url, resp.StatusCode, wantStatus, string(payload))
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode %s %s: %v", method, url, err)
	}
	return payload
}

func loginReadyBrowserSession(t *testing.T, client *http.Client, serverURL, email, deviceLabel string) map[string]any {
	t.Helper()

	loginChallenge := doJSONWithClient(t, client, http.MethodPost, serverURL+"/v1/auth/recovery", map[string]any{
		"action": "request_login_challenge",
		"email":  email,
	}, http.StatusOK, "")
	loginChallengePayload, ok := loginChallenge["challenge"].(map[string]any)
	if !ok {
		t.Fatalf("login challenge payload malformed: %#v", loginChallenge["challenge"])
	}

	login := doJSONWithClient(t, client, http.MethodPost, serverURL+"/v1/auth/session", map[string]any{
		"email":       email,
		"deviceLabel": deviceLabel,
		"challengeId": stringField(t, loginChallengePayload, "id"),
	}, http.StatusOK, "")
	session, ok := login["session"].(map[string]any)
	if !ok {
		t.Fatalf("login session payload malformed: %#v", login["session"])
	}

	if stringField(t, session, "emailVerificationStatus") != "verified" {
		verifyChallenge := doJSONWithClient(t, client, http.MethodPost, serverURL+"/v1/auth/recovery", map[string]any{
			"action": "request_verify_email_challenge",
			"email":  email,
		}, http.StatusOK, "")
		verifyChallengePayload, ok := verifyChallenge["challenge"].(map[string]any)
		if !ok {
			t.Fatalf("verify challenge payload malformed: %#v", verifyChallenge["challenge"])
		}
		doJSONWithClient(t, client, http.MethodPost, serverURL+"/v1/auth/recovery", map[string]any{
			"action":      "verify_email",
			"email":       email,
			"challengeId": stringField(t, verifyChallengePayload, "id"),
		}, http.StatusOK, "")
		session = getJSONWithClient(t, client, serverURL+"/v1/auth/session", "")
	}

	if stringField(t, session, "deviceAuthStatus") != "authorized" {
		authorizeChallenge := doJSONWithClient(t, client, http.MethodPost, serverURL+"/v1/auth/recovery", map[string]any{
			"action":   "request_authorize_device_challenge",
			"deviceId": stringField(t, session, "deviceId"),
		}, http.StatusOK, "")
		authorizeChallengePayload, ok := authorizeChallenge["challenge"].(map[string]any)
		if !ok {
			t.Fatalf("authorize challenge payload malformed: %#v", authorizeChallenge["challenge"])
		}
		doJSONWithClient(t, client, http.MethodPost, serverURL+"/v1/auth/recovery", map[string]any{
			"action":      "authorize_device",
			"deviceId":    stringField(t, session, "deviceId"),
			"challengeId": stringField(t, authorizeChallengePayload, "id"),
		}, http.StatusOK, "")
	}

	return getJSONWithClient(t, client, serverURL+"/v1/auth/session", "")
}

func postStream(t *testing.T, url string, body map[string]any, wantStatus int, authToken string) streamResponse {
	t.Helper()

	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal %s: %v", url, err)
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		t.Fatalf("new request %s: %v", url, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set(integrationAuthTokenHeader, authToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != wantStatus {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST %s status = %d, want %d, body=%s", url, resp.StatusCode, wantStatus, string(payload))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var result streamResponse
	for scanner.Scan() {
		var payload map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &payload); err != nil {
			t.Fatalf("decode stream %s: %v", url, err)
		}
		if delta, _ := payload["delta"].(string); delta != "" {
			result.deltas = append(result.deltas, delta)
		}
		if output, _ := payload["output"].(string); output != "" {
			result.output = output
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner stream %s: %v", url, err)
	}
	return result
}

func stringField(t *testing.T, payload map[string]any, field string) string {
	t.Helper()
	value, ok := payload[field].(string)
	if !ok {
		t.Fatalf("field %q is not a string: %#v", field, payload[field])
	}
	return value
}

func stringSliceField(t *testing.T, payload map[string]any, field string) []string {
	t.Helper()
	raw, ok := payload[field].([]any)
	if !ok {
		t.Fatalf("field %q is not a []any: %#v", field, payload[field])
	}
	values := make([]string, 0, len(raw))
	for _, item := range raw {
		text, ok := item.(string)
		if !ok {
			t.Fatalf("field %q contains non-string value: %#v", field, item)
		}
		values = append(values, text)
	}
	return values
}

func findByField(t *testing.T, raw any, field, want string) map[string]any {
	t.Helper()
	items, ok := raw.([]any)
	if !ok {
		t.Fatalf("payload is not an array: %#v", raw)
	}
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("array item is not an object: %#v", item)
		}
		if value, _ := entry[field].(string); value == want {
			return entry
		}
	}
	t.Fatalf("no entry found with %s=%s", field, want)
	return nil
}
