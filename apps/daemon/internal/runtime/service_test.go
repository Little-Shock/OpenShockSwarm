package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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

func writeExecutable(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
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
