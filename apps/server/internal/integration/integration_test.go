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
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPhaseZeroLoopThroughDaemon(t *testing.T) {
	projectRoot := projectRoot(t)
	repoRoot := createTempGitRepo(t)

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

	pairing := postJSON(t, serverURL+"/v1/runtime/pairing", map[string]any{
		"daemonUrl": daemonURL,
	}, http.StatusOK)
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

	createIssue := map[string]any{
		"title":    "Integration Loop",
		"summary":  "verify issue room run pr inbox memory",
		"owner":    "Claude Review Runner",
		"priority": "critical",
	}
	created := postJSON(t, serverURL+"/v1/issues", createIssue, http.StatusCreated)
	roomID := stringField(t, created, "roomId")
	runID := stringField(t, created, "runId")
	sessionID := stringField(t, created, "sessionId")

	if _, err := exec.LookPath("claude"); err == nil {
		streamResp := postStream(t, serverURL+"/v1/rooms/"+roomID+"/messages/stream", map[string]any{
			"provider": "claude",
			"prompt":   "请只回复两行：stream-ready 和 done",
		}, http.StatusOK)

		streamText := strings.ToLower(strings.Join(streamResp.deltas, " ") + " " + streamResp.output)
		if !strings.Contains(streamText, "stream-ready") {
			t.Fatalf("stream output = %q, want substring stream-ready", streamText)
		}

		stateAfterStream := getJSON(t, serverURL+"/v1/state")
		roomMessagesRaw, ok := stateAfterStream["roomMessages"].(map[string]any)
		if !ok {
			t.Fatalf("roomMessages payload malformed: %#v", stateAfterStream["roomMessages"])
		}
		messageList, ok := roomMessagesRaw[roomID].([]any)
		if !ok || len(messageList) < 3 {
			t.Fatalf("expected persisted room messages after stream, got %#v", roomMessagesRaw[roomID])
		}
	}

	prCreated := postJSON(t, serverURL+"/v1/rooms/"+roomID+"/pull-request", map[string]any{}, http.StatusOK)
	pullRequestID := stringField(t, prCreated, "pullRequestId")

	postJSON(t, serverURL+"/v1/pull-requests/"+pullRequestID, map[string]any{
		"status": "merged",
	}, http.StatusOK)

	state := getJSON(t, serverURL+"/v1/state")
	issue := findByField(t, state["issues"], "roomId", roomID)
	run := findByField(t, state["runs"], "id", runID)
	session := findByField(t, state["sessions"], "id", sessionID)
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

	memoryPaths := stringSliceField(t, session, "memoryPaths")
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

func getJSON(t *testing.T, url string) map[string]any {
	t.Helper()

	resp, err := http.Get(url)
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

func postJSON(t *testing.T, url string, body map[string]any, wantStatus int) map[string]any {
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
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != wantStatus {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST %s status = %d, want %d, body=%s", url, resp.StatusCode, wantStatus, string(payload))
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode POST %s: %v", url, err)
	}
	return payload
}

func postStream(t *testing.T, url string, body map[string]any, wantStatus int) streamResponse {
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
