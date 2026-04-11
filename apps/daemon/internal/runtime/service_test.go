package runtime

import (
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"
	"time"
)

func TestBuildCommandClaudeUsesPrintMode(t *testing.T) {
	req := ExecRequest{
		Provider: "claude",
		Prompt:   "Reply exactly: daemon-ready",
		Cwd:      t.TempDir(),
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}

	if plan.command[0] != "claude" {
		t.Fatalf("claude command = %q, want claude", plan.command[0])
	}
	if !containsArg(plan.command, "--print") {
		t.Fatalf("claude command = %#v, want --print", plan.command)
	}
	if containsArg(plan.command, "--bare") {
		t.Fatalf("claude command = %#v, should not contain deprecated --bare", plan.command)
	}
	if !containsArg(plan.command, req.Prompt) {
		t.Fatalf("claude command = %#v, want prompt", plan.command)
	}
}

func TestBuildCommandClaudeFallsBackToClaudeCodeAlias(t *testing.T) {
	tmp := t.TempDir()
	writeExecutable(t, filepath.Join(tmp, "claude-code"))
	t.Setenv("PATH", tmp)

	req := ExecRequest{
		Provider: "claude",
		Prompt:   "alias fallback",
		Cwd:      tmp,
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}

	if plan.command[0] != "claude-code" {
		t.Fatalf("claude alias command = %q, want claude-code", plan.command[0])
	}

	providers := detectProviders()
	if len(providers) != 1 || providers[0].ID != "claude" {
		t.Fatalf("detectProviders() = %#v, want claude provider via alias", providers)
	}

	detected := detectCLI()
	if len(detected) != 1 || detected[0] != "claude-code" {
		t.Fatalf("detectCLI() = %#v, want claude-code alias", detected)
	}
}

func TestBuildCommandCodexUsesOutputFile(t *testing.T) {
	req := ExecRequest{
		Provider: "codex",
		Prompt:   "Reply exactly: daemon-ready",
		Cwd:      t.TempDir(),
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}
	defer os.Remove(plan.outputFile)

	if plan.command[0] != "codex" {
		t.Fatalf("codex command = %q, want codex", plan.command[0])
	}
	if !containsArg(plan.command, "--output-last-message") {
		t.Fatalf("codex command = %#v, want --output-last-message", plan.command)
	}
	if strings.TrimSpace(plan.outputFile) == "" {
		t.Fatalf("output file should not be empty")
	}
	if !plan.cleanupFile {
		t.Fatalf("cleanupFile = false, want true")
	}
}

func TestBuildCommandNormalizesProviderLabels(t *testing.T) {
	claudePlan, err := buildCommand(ExecRequest{
		Provider: "Claude Code CLI",
		Prompt:   "reply",
		Cwd:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("buildCommand() with Claude label error = %v", err)
	}
	if claudePlan.command[0] != "claude" {
		t.Fatalf("claude label command = %q, want claude", claudePlan.command[0])
	}

	codexPlan, err := buildCommand(ExecRequest{
		Provider: "Codex CLI",
		Prompt:   "reply",
		Cwd:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("buildCommand() with Codex label error = %v", err)
	}
	defer os.Remove(codexPlan.outputFile)
	if codexPlan.command[0] != "codex" {
		t.Fatalf("codex label command = %q, want codex", codexPlan.command[0])
	}
}

func TestSnapshotIncludesRuntimeRegistrationMetadata(t *testing.T) {
	service := NewService("shock-sidecar", t.TempDir(),
		WithRuntimeID("shock-sidecar"),
		WithDaemonURL("http://127.0.0.1:8091"),
		WithHeartbeatInterval(12*time.Second),
		WithHeartbeatTimeout(48*time.Second),
	)

	snapshot := service.Snapshot()
	if snapshot.RuntimeID != "shock-sidecar" {
		t.Fatalf("runtime id = %q, want shock-sidecar", snapshot.RuntimeID)
	}
	if snapshot.DaemonURL != "http://127.0.0.1:8091" {
		t.Fatalf("daemon url = %q, want http://127.0.0.1:8091", snapshot.DaemonURL)
	}
	if snapshot.HeartbeatIntervalS != 12 || snapshot.HeartbeatTimeoutS != 48 {
		t.Fatalf("heartbeat metadata = %#v, want interval=12 timeout=48", snapshot)
	}
}

func writeExecutable(t *testing.T, path string) {
	t.Helper()
	content := []byte("#!/bin/sh\nexit 0\n")
	if goruntime.GOOS == "windows" {
		path += ".cmd"
		content = []byte("@echo off\r\nexit /b 0\r\n")
	}
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatalf("write executable %s: %v", path, err)
	}
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
