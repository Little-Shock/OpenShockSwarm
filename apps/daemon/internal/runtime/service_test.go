package runtime

import (
	"fmt"
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

func TestAnnotateProviderStatusesUsesAuthTruth(t *testing.T) {
	tmp := t.TempDir()
	writeExecutableWithContent(t, filepath.Join(tmp, "codex"), "#!/bin/sh\nprintf 'Logged in using an API key\\n'\n")
	writeExecutableWithContent(t, filepath.Join(tmp, "claude"), "#!/bin/sh\nprintf '{\"loggedIn\":false,\"authMethod\":\"none\",\"apiProvider\":\"firstParty\"}\\n'\nexit 1\n")
	t.Setenv("PATH", tmp)

	providers := annotateProviderStatuses([]Provider{
		{ID: "codex", Label: "Codex CLI"},
		{ID: "claude", Label: "Claude Code CLI"},
	})

	if len(providers) != 2 {
		t.Fatalf("providers length = %d, want 2", len(providers))
	}
	if !providers[0].Ready || providers[0].Status != providerStatusReady {
		t.Fatalf("codex provider = %#v, want ready status", providers[0])
	}
	if providers[1].Ready || providers[1].Status != providerStatusAuthRequired {
		t.Fatalf("claude provider = %#v, want auth_required status", providers[1])
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

func writeExecutableWithContent(t *testing.T, path string, unixContent string) {
	t.Helper()
	content := []byte(unixContent)
	if goruntime.GOOS == "windows" {
		commandName := filepath.Base(path)
		if !strings.HasSuffix(strings.ToLower(commandName), ".cmd") {
			path += ".cmd"
		}
		content = []byte(fmt.Sprintf("@echo off\r\nif \"%s\"==\"codex\" (\r\n  echo Logged in using an API key\r\n  exit /b 0\r\n)\r\nif \"%s\"==\"claude\" (\r\n  echo {\"loggedIn\":false,\"authMethod\":\"none\",\"apiProvider\":\"firstParty\"}\r\n  exit /b 1\r\n)\r\n", commandName, commandName))
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
