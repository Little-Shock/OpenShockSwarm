//go:build integration

package integration

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"testing"
	"time"

	runtimepkg "github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
)

func TestDaemonContinuityHarnessAcrossRestart(t *testing.T) {
	repoRoot := createTempGitRepo(t)
	cliDir := writeFakeCodexCLI(t)

	recorder := newHeartbeatRecorder()
	controlPlane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/runtime/heartbeats" {
			http.NotFound(w, r)
			return
		}

		var payload runtimepkg.Heartbeat
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		recorder.Record(payload)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer controlPlane.Close()

	daemonBinary := buildDaemonBinary(t)
	firstAddr := reserveLocalAddr(t)
	first := startDaemonProcess(t, daemonBinary, repoRoot, firstAddr, controlPlane.URL, cliDir)

	sessionID := "session-runtime"
	runID := "run-runtime-01"
	roomID := "room-runtime"
	firstPrompt := "first codex turn"
	secondPrompt := "second codex turn"

	firstPayload := postJSON(t, first.baseURL()+"/v1/exec", map[string]any{
		"provider":  "codex",
		"prompt":    firstPrompt,
		"cwd":       repoRoot,
		"sessionId": sessionID,
		"runId":     runID,
		"roomId":    roomID,
	}, http.StatusOK)

	sessionDir := filepath.Join(repoRoot, ".openshock", "agent-sessions", sessionID)
	wantHome := filepath.Join(sessionDir, "codex-home")
	firstOutput, _ := firstPayload["output"].(string)
	if !strings.Contains(firstOutput, "home="+wantHome) {
		t.Fatalf("first exec output = %q, want session codex home %q", firstOutput, wantHome)
	}

	if !recorder.WaitForAtLeast(t, 1, 5*time.Second) {
		t.Fatalf("control plane did not receive heartbeat from first daemon process")
	}

	first.stop(t)

	secondAddr := reserveLocalAddr(t)
	second := startDaemonProcess(t, daemonBinary, repoRoot, secondAddr, controlPlane.URL, cliDir)
	defer second.stop(t)

	secondPayload := postJSON(t, second.baseURL()+"/v1/exec", map[string]any{
		"provider":      "codex",
		"prompt":        secondPrompt,
		"cwd":           repoRoot,
		"sessionId":     sessionID,
		"runId":         runID,
		"roomId":        roomID,
		"resumeSession": true,
	}, http.StatusOK)

	secondOutput, _ := secondPayload["output"].(string)
	if !strings.Contains(secondOutput, "home="+wantHome) {
		t.Fatalf("second exec output = %q, want reused session codex home %q", secondOutput, wantHome)
	}
	if !strings.Contains(secondOutput, "incoming=thread-001") {
		t.Fatalf("second exec output = %q, want persisted thread id", secondOutput)
	}
	if !strings.Contains(secondOutput, "args=exec resume --last") {
		t.Fatalf("second exec output = %q, want resume command", secondOutput)
	}

	currentTurn := readTextFile(t, filepath.Join(sessionDir, "CURRENT_TURN.md"))
	if !strings.Contains(currentTurn, secondPrompt) {
		t.Fatalf("CURRENT_TURN.md = %q, want second prompt", currentTurn)
	}
	if strings.Contains(currentTurn, firstPrompt) {
		t.Fatalf("CURRENT_TURN.md = %q, should not retain first prompt", currentTurn)
	}

	workLog := readTextFile(t, filepath.Join(sessionDir, "notes", "work-log.md"))
	if !strings.Contains(workLog, firstPrompt) || !strings.Contains(workLog, secondPrompt) {
		t.Fatalf("work-log = %q, want both prompts", workLog)
	}

	var sessionPayload struct {
		CodexHome         string `json:"codexHome,omitempty"`
		AppServerThreadID string `json:"appServerThreadId,omitempty"`
	}
	data, err := os.ReadFile(filepath.Join(sessionDir, "SESSION.json"))
	if err != nil {
		t.Fatalf("ReadFile(SESSION.json) error = %v", err)
	}
	if err := json.Unmarshal(data, &sessionPayload); err != nil {
		t.Fatalf("Unmarshal(SESSION.json) error = %v", err)
	}
	if sessionPayload.CodexHome != wantHome {
		t.Fatalf("SESSION.json codexHome = %q, want %q", sessionPayload.CodexHome, wantHome)
	}
	if sessionPayload.AppServerThreadID != "thread-001" {
		t.Fatalf("SESSION.json appServerThreadId = %q, want thread-001", sessionPayload.AppServerThreadID)
	}

	lastHeartbeat := recorder.Last()
	if lastHeartbeat.Machine != "daemon-system-test" {
		t.Fatalf("last heartbeat machine = %q, want daemon-system-test", lastHeartbeat.Machine)
	}
	if filepath.Clean(lastHeartbeat.WorkspaceRoot) != filepath.Clean(repoRoot) {
		t.Fatalf("last heartbeat workspaceRoot = %q, want %q", lastHeartbeat.WorkspaceRoot, repoRoot)
	}
}

type heartbeatRecorder struct {
	mu    sync.Mutex
	count int
	last  runtimepkg.Heartbeat
}

func newHeartbeatRecorder() *heartbeatRecorder {
	return &heartbeatRecorder{}
}

func (r *heartbeatRecorder) Record(payload runtimepkg.Heartbeat) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.count++
	r.last = payload
}

func (r *heartbeatRecorder) WaitForAtLeast(t *testing.T, want int, timeout time.Duration) bool {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		count := r.count
		r.mu.Unlock()
		if count >= want {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

func (r *heartbeatRecorder) Last() runtimepkg.Heartbeat {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.last
}

type daemonProcess struct {
	cmd    *exec.Cmd
	addr   string
	stdout bytes.Buffer
	stderr bytes.Buffer
}

func startDaemonProcess(t *testing.T, binaryPath, workspaceRoot, addr, controlURL, cliDir string) *daemonProcess {
	t.Helper()

	process := &daemonProcess{addr: addr}
	process.cmd = exec.Command(
		binaryPath,
		"--workspace-root", workspaceRoot,
		"--addr", addr,
		"--machine-name", "daemon-system-test",
		"--control-url", controlURL,
		"--heartbeat-interval", "100ms",
	)
	process.cmd.Env = prependPathEnv(cliDir)
	process.cmd.Stdout = &process.stdout
	process.cmd.Stderr = &process.stderr

	if err := process.cmd.Start(); err != nil {
		t.Fatalf("start daemon process: %v", err)
	}

	if err := waitForDaemonHealth(process.baseURL()+"/healthz", 5*time.Second); err != nil {
		process.stop(t)
		t.Fatalf("wait for daemon health: %v\nstderr:\n%s\nstdout:\n%s", err, process.stderr.String(), process.stdout.String())
	}

	return process
}

func (p *daemonProcess) baseURL() string {
	return "http://" + p.addr
}

func (p *daemonProcess) stop(t *testing.T) {
	t.Helper()

	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return
	}

	_ = p.cmd.Process.Kill()
	err := p.cmd.Wait()
	if err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			t.Fatalf("wait daemon process: %v", err)
		}
	}
}

func waitForDaemonHealth(url string, timeout time.Duration) error {
	client := &http.Client{Timeout: 200 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("daemon health endpoint %s not ready within %s", url, timeout)
}

func buildDaemonBinary(t *testing.T) string {
	t.Helper()

	moduleRoot := daemonModuleRoot(t)
	binaryPath := filepath.Join(t.TempDir(), daemonBinaryName())
	cmd := exec.Command("go", "build", "-o", binaryPath, "./cmd/openshock-daemon")
	cmd.Dir = moduleRoot

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("build daemon binary: %v\nstderr:\n%s\nstdout:\n%s", err, stderr.String(), stdout.String())
	}

	return binaryPath
}

func daemonModuleRoot(t *testing.T) string {
	t.Helper()

	_, file, _, ok := goruntime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func daemonBinaryName() string {
	if goruntime.GOOS == "windows" {
		return "openshock-daemon.exe"
	}
	return "openshock-daemon"
}

func reserveLocalAddr(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve local addr: %v", err)
	}
	defer listener.Close()
	return listener.Addr().String()
}

func prependPathEnv(dir string) []string {
	env := append([]string{}, os.Environ()...)
	pathKey := "PATH"
	if goruntime.GOOS == "windows" {
		pathKey = "Path"
	}

	prefix := pathKey + "="
	for index, item := range env {
		if strings.HasPrefix(item, prefix) {
			env[index] = prefix + dir + string(os.PathListSeparator) + strings.TrimPrefix(item, prefix)
			return env
		}
	}
	return append(env, prefix+dir)
}

func writeFakeCodexCLI(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "codex")
	unixScript := `#!/bin/sh
output_file=""
resume_mode=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then
    output_file="$arg"
  fi
  if [ "$arg" = "resume" ]; then
    resume_mode="1"
  fi
  prev="$arg"
done

if [ -z "$output_file" ]; then
  echo "missing --output-last-message" >&2
  exit 1
fi

if [ -z "$resume_mode" ] && [ -n "$OPENSHOCK_APP_SERVER_THREAD_ID_FILE" ]; then
  printf 'thread-001' > "$OPENSHOCK_APP_SERVER_THREAD_ID_FILE"
fi

message="home=$OPENSHOCK_CODEX_HOME|incoming=$OPENSHOCK_APP_SERVER_THREAD_ID|args=$*"
printf '%s\n' "$message" > "$output_file"
printf '%s\n' "$message"
`
	windowsScript := "@echo off\r\n" +
		"set \"output_file=\"\r\n" +
		"set \"resume_mode=\"\r\n" +
		":loop\r\n" +
		"if \"%~1\"==\"\" goto done\r\n" +
		"if \"%~1\"==\"--output-last-message\" (\r\n" +
		"  shift\r\n" +
		"  set \"output_file=%~1\"\r\n" +
		") else if \"%~1\"==\"resume\" (\r\n" +
		"  set \"resume_mode=1\"\r\n" +
		")\r\n" +
		"shift\r\n" +
		"goto loop\r\n" +
		":done\r\n" +
		"if \"%output_file%\"==\"\" (\r\n" +
		"  echo missing --output-last-message 1>&2\r\n" +
		"  exit /b 1\r\n" +
		")\r\n" +
		"if not defined resume_mode if defined OPENSHOCK_APP_SERVER_THREAD_ID_FILE > \"%OPENSHOCK_APP_SERVER_THREAD_ID_FILE%\" <nul set /p =thread-001\r\n" +
		"set \"message=home=%OPENSHOCK_CODEX_HOME%^|incoming=%OPENSHOCK_APP_SERVER_THREAD_ID%^|args=%*\"\r\n" +
		"> \"%output_file%\" echo %message%\r\n" +
		"echo %message%\r\n"

	if goruntime.GOOS == "windows" {
		path += ".cmd"
		if err := os.WriteFile(path, []byte(windowsScript), 0o755); err != nil {
			t.Fatalf("write fake codex cli: %v", err)
		}
		return dir
	}

	if err := os.WriteFile(path, []byte(unixScript), 0o755); err != nil {
		t.Fatalf("write fake codex cli: %v", err)
	}
	return dir
}

func readTextFile(t *testing.T, path string) string {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	return string(data)
}
