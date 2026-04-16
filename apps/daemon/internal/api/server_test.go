package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
)

func TestExecConflictGuardRejectsSameCwdAndAllowsDifferentCwd(t *testing.T) {
	root := t.TempDir()
	otherCwd := filepath.Join(root, "other")
	if err := os.MkdirAll(otherCwd, 0o755); err != nil {
		t.Fatalf("MkdirAll(otherCwd) error = %v", err)
	}
	prependDaemonCLIPath(t, writeDaemonClaudeCLI(t))

	server := httptest.NewServer(New(runtime.NewService("daemon-test", root), root).Handler())
	defer server.Close()

	firstBody, err := json.Marshal(map[string]any{
		"provider":  "claude",
		"prompt":    "hold-lease",
		"cwd":       root,
		"leaseId":   "session-a",
		"sessionId": "session-a",
		"runId":     "run-a",
	})
	if err != nil {
		t.Fatalf("Marshal(firstBody) error = %v", err)
	}
	firstResp, err := http.Post(server.URL+"/v1/exec/stream", "application/json", bytes.NewReader(firstBody))
	if err != nil {
		t.Fatalf("POST first stream exec error = %v", err)
	}
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first stream status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(firstResp.Body)
	if !scanner.Scan() {
		t.Fatalf("expected at least one stream event, scanner err = %v", scanner.Err())
	}

	conflictBody, err := json.Marshal(map[string]any{
		"provider":  "claude",
		"prompt":    "should-conflict",
		"cwd":       root,
		"leaseId":   "session-b",
		"sessionId": "session-b",
		"runId":     "run-b",
	})
	if err != nil {
		t.Fatalf("Marshal(conflictBody) error = %v", err)
	}
	conflictResp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(conflictBody))
	if err != nil {
		t.Fatalf("POST conflicting exec error = %v", err)
	}
	defer conflictResp.Body.Close()
	if conflictResp.StatusCode != http.StatusConflict {
		t.Fatalf("conflict status = %d, want %d", conflictResp.StatusCode, http.StatusConflict)
	}

	var conflictPayload struct {
		Error    string              `json:"error"`
		Conflict daemonLeaseConflict `json:"conflict"`
	}
	if err := json.NewDecoder(conflictResp.Body).Decode(&conflictPayload); err != nil {
		t.Fatalf("Decode conflict payload error = %v", err)
	}
	if conflictPayload.Conflict.Cwd != filepath.Clean(root) && conflictPayload.Conflict.Cwd != root {
		t.Fatalf("conflict cwd = %q, want %q", conflictPayload.Conflict.Cwd, root)
	}
	if conflictPayload.Conflict.SessionID != "session-a" {
		t.Fatalf("conflict payload = %#v, want session-a holder", conflictPayload)
	}

	otherBody, err := json.Marshal(map[string]any{
		"provider":  "claude",
		"prompt":    "other-cwd",
		"cwd":       otherCwd,
		"leaseId":   "session-c",
		"sessionId": "session-c",
		"runId":     "run-c",
	})
	if err != nil {
		t.Fatalf("Marshal(otherBody) error = %v", err)
	}
	otherResp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(otherBody))
	if err != nil {
		t.Fatalf("POST other exec error = %v", err)
	}
	defer otherResp.Body.Close()
	if otherResp.StatusCode != http.StatusOK {
		t.Fatalf("other exec status = %d, want %d", otherResp.StatusCode, http.StatusOK)
	}

	var otherPayload map[string]any
	if err := json.NewDecoder(otherResp.Body).Decode(&otherPayload); err != nil {
		t.Fatalf("Decode other payload error = %v", err)
	}
	if output, _ := otherPayload["output"].(string); !strings.Contains(output, "daemon-ready") {
		t.Fatalf("other exec payload = %#v, want daemon-ready output", otherPayload)
	}

	for scanner.Scan() {
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}
}

func TestExecConflictGuardAllowsSameLeaseHolderReentry(t *testing.T) {
	root := t.TempDir()
	prependDaemonCLIPath(t, writeDaemonClaudeCLI(t))

	server := httptest.NewServer(New(runtime.NewService("daemon-test", root), root).Handler())
	defer server.Close()

	firstBody, err := json.Marshal(map[string]any{
		"provider":  "claude",
		"prompt":    "hold-lease",
		"cwd":       root,
		"leaseId":   "session-a",
		"sessionId": "session-a",
		"runId":     "run-a",
	})
	if err != nil {
		t.Fatalf("Marshal(firstBody) error = %v", err)
	}
	firstResp, err := http.Post(server.URL+"/v1/exec/stream", "application/json", bytes.NewReader(firstBody))
	if err != nil {
		t.Fatalf("POST first stream exec error = %v", err)
	}
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first stream status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(firstResp.Body)
	if !scanner.Scan() {
		t.Fatalf("expected at least one stream event, scanner err = %v", scanner.Err())
	}

	reentrantBody, err := json.Marshal(map[string]any{
		"provider":  "claude",
		"prompt":    "same-holder",
		"cwd":       root,
		"leaseId":   "session-a",
		"sessionId": "session-a",
		"runId":     "run-a",
	})
	if err != nil {
		t.Fatalf("Marshal(reentrantBody) error = %v", err)
	}
	reentrantResp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(reentrantBody))
	if err != nil {
		t.Fatalf("POST reentrant exec error = %v", err)
	}
	defer reentrantResp.Body.Close()
	if reentrantResp.StatusCode != http.StatusOK {
		t.Fatalf("reentrant exec status = %d, want %d", reentrantResp.StatusCode, http.StatusOK)
	}

	var reentrantPayload map[string]any
	if err := json.NewDecoder(reentrantResp.Body).Decode(&reentrantPayload); err != nil {
		t.Fatalf("Decode reentrant payload error = %v", err)
	}
	if output, _ := reentrantPayload["output"].(string); !strings.Contains(output, "daemon-ready") {
		t.Fatalf("reentrant exec payload = %#v, want daemon-ready output", reentrantPayload)
	}

	for scanner.Scan() {
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}
}

func TestExecRoutePersistsSessionWorkspaceEnvelope(t *testing.T) {
	root := t.TempDir()
	prependDaemonCLIPath(t, writeDaemonClaudeCLI(t))

	server := httptest.NewServer(New(runtime.NewService("daemon-test", root), root).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"provider":  "claude",
		"prompt":    "persist current turn",
		"cwd":       t.TempDir(),
		"sessionId": "session-runtime",
		"runId":     "run-runtime-01",
		"roomId":    "room-runtime",
	})
	if err != nil {
		t.Fatalf("Marshal(body) error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/exec", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/exec error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/exec status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	sessionDir := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	if _, err := os.Stat(filepath.Join(sessionDir, "SESSION.json")); err != nil {
		t.Fatalf("Stat(SESSION.json) error = %v", err)
	}
	currentTurn, err := os.ReadFile(filepath.Join(sessionDir, "CURRENT_TURN.md"))
	if err != nil {
		t.Fatalf("ReadFile(CURRENT_TURN.md) error = %v", err)
	}
	if !strings.Contains(string(currentTurn), "persist current turn") {
		t.Fatalf("CURRENT_TURN.md = %q, want prompt", string(currentTurn))
	}
}

func writeDaemonClaudeCLI(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	script := `#!/bin/sh
args="$*"
case "$args" in
  *hold-lease*)
    sleep 1
    printf 'held-lease\n'
    ;;
  *)
    printf 'daemon-ready\n'
    ;;
esac
`
	if goruntime.GOOS == "windows" {
		cmdPath := filepath.Join(dir, "claude.cmd")
		cmdScript := "@echo off\r\nset args=%*\r\necho %args% | findstr /c:\"hold-lease\" >nul\r\nif %errorlevel%==0 (\r\n  powershell -NoProfile -Command \"Start-Sleep -Seconds 1\"\r\n  echo held-lease\r\n) else (\r\n  echo daemon-ready\r\n)\r\n"
		if err := os.WriteFile(cmdPath, []byte(cmdScript), 0o755); err != nil {
			t.Fatalf("write fake claude cmd: %v", err)
		}
		return dir
	}
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude cli: %v", err)
	}
	return dir
}

func prependDaemonCLIPath(t *testing.T, dir string) {
	t.Helper()
	current := os.Getenv("PATH")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+current)
}
