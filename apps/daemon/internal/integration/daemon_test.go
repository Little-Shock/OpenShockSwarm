//go:build integration

package integration

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/api"
	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
)

func TestDaemonRuntimeAndWorktreeLoop(t *testing.T) {
	repoRoot := createTempGitRepo(t)
	prependCLIToPath(t, writeFakeClaudeCLI(t))
	server := httptest.NewServer(api.New(runtime.NewService("daemon-test", repoRoot), repoRoot).Handler())
	defer server.Close()

	healthz := getJSON(t, server.URL+"/healthz")
	if ok, _ := healthz["ok"].(bool); !ok {
		t.Fatalf("healthz ok = %#v, want true", healthz["ok"])
	}

	runtimePayload := getJSON(t, server.URL+"/v1/runtime")
	if runtimePayload["machine"] != "daemon-test" {
		t.Fatalf("machine = %#v, want daemon-test", runtimePayload["machine"])
	}
	if strings.TrimSpace(runtimePayload["workspaceRoot"].(string)) == "" {
		t.Fatalf("workspaceRoot should not be empty")
	}

	body := map[string]any{
		"workspaceRoot": repoRoot,
		"branch":        "feat/daemon-integration",
		"worktreeName":  "wt-daemon-integration",
		"baseRef":       "HEAD",
	}
	first := postJSON(t, server.URL+"/v1/worktrees/ensure", body, http.StatusOK)
	if created, _ := first["created"].(bool); !created {
		t.Fatalf("first ensure should create worktree, got %#v", first["created"])
	}

	worktreePath, _ := first["path"].(string)
	if worktreePath == "" {
		t.Fatalf("worktree path should not be empty")
	}
	if _, err := os.Stat(worktreePath); err != nil {
		t.Fatalf("expected worktree path %q to exist: %v", worktreePath, err)
	}

	second := postJSON(t, server.URL+"/v1/worktrees/ensure", body, http.StatusOK)
	if created, _ := second["created"].(bool); created {
		t.Fatalf("second ensure should reuse existing worktree")
	}

	execBody := map[string]any{
		"provider": "claude",
		"prompt":   "Reply exactly: daemon-ready",
		"cwd":      repoRoot,
	}
	payload := postJSON(t, server.URL+"/v1/exec", execBody, http.StatusOK)
	output, _ := payload["output"].(string)
	if !strings.Contains(strings.ToLower(output), "daemon-ready") {
		t.Fatalf("daemon exec output = %q, want substring daemon-ready", output)
	}

	streamBody := map[string]any{
		"provider": "claude",
		"prompt":   "Reply exactly with two lines: daemon-stream then ok",
		"cwd":      repoRoot,
	}
	streamData, err := json.Marshal(streamBody)
	if err != nil {
		t.Fatalf("marshal stream body: %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/exec/stream", "application/json", bytes.NewReader(streamData))
	if err != nil {
		t.Fatalf("POST /v1/exec/stream: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var chunks []string
	var doneOutput string
	for scanner.Scan() {
		var payload map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &payload); err != nil {
			t.Fatalf("decode stream payload: %v", err)
		}
		if delta, _ := payload["delta"].(string); delta != "" {
			chunks = append(chunks, delta)
		}
		if payloadType, _ := payload["type"].(string); payloadType == "done" {
			doneOutput, _ = payload["output"].(string)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}
	streamOutput := strings.ToLower(strings.Join(chunks, " ") + " " + doneOutput)
	if !strings.Contains(streamOutput, "daemon-stream") {
		t.Fatalf("daemon stream output = %q, want substring daemon-stream", streamOutput)
	}
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

func writeFakeClaudeCLI(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	script := `#!/bin/sh
args="$*"
case "$args" in
  *daemon-stream*)
    printf 'daemon-stream\nok\n'
    ;;
  *)
    printf 'daemon-ready\n'
    ;;
esac
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude cli: %v", err)
	}
	return dir
}

func prependCLIToPath(t *testing.T, dir string) {
	t.Helper()
	current := os.Getenv("PATH")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+current)
}

func getJSON(t *testing.T, url string) map[string]any {
	t.Helper()

	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s status = %d", url, resp.StatusCode)
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
	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != wantStatus {
		t.Fatalf("POST %s status = %d, want %d", url, resp.StatusCode, wantStatus)
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode POST %s: %v", url, err)
	}
	return payload
}
