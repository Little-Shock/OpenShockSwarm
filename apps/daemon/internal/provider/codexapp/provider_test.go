package codexapp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"openshock/daemon/internal/acp"
	"openshock/daemon/internal/provider"
)

func TestExecuteStreamsEventsAndCapturesLastMessage(t *testing.T) {
	repoPath := t.TempDir()
	binPath := writeFakeAppServerCodexBinary(t)

	executor, err := NewExecutor(Options{CodexBinPath: binPath, CodexHome: t.TempDir()})
	if err != nil {
		t.Fatalf("NewExecutor returned error: %v", err)
	}
	defer executor.Close()

	var events []acp.Event
	result, err := executor.Execute(context.Background(), provider.ExecuteRequest{
		RepoPath:     repoPath,
		Instruction:  "Please inspect the repo",
		CodexBinPath: binPath,
		SandboxMode:  "danger-full-access",
	}, func(event acp.Event) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result.ProviderThreadID != "thread_fake_start" {
		t.Fatalf("expected thread_fake_start, got %#v", result)
	}
	if result.ProviderTurnID != "turn_fake" {
		t.Fatalf("expected turn_fake, got %#v", result)
	}
	if strings.TrimSpace(result.LastMessage) != "hello from app-server" {
		t.Fatalf("unexpected last message: %#v", result)
	}

	sessionOutput := false
	commandOutput := false
	toolCall := false
	for _, event := range events {
		if event.Kind == acp.EventStdoutChunk && event.Stream == "session" && strings.Contains(event.Content, "hello") {
			sessionOutput = true
		}
		if event.Kind == acp.EventStdoutChunk && event.Stream == "stdout" && strings.Contains(event.Content, "git status output") {
			commandOutput = true
		}
		if event.Kind == acp.EventToolCall && event.ToolCall != nil && event.ToolCall.ToolName == "shell" && strings.Contains(event.ToolCall.Arguments, "git status") {
			toolCall = true
		}
	}
	if !sessionOutput || !commandOutput || !toolCall {
		t.Fatalf("expected app-server events to be normalized, got %#v", events)
	}
}

func TestExecuteResumesExistingThread(t *testing.T) {
	repoPath := t.TempDir()
	binPath := writeFakeAppServerCodexBinary(t)

	executor, err := NewExecutor(Options{CodexBinPath: binPath, CodexHome: t.TempDir()})
	if err != nil {
		t.Fatalf("NewExecutor returned error: %v", err)
	}
	defer executor.Close()

	result, err := executor.Execute(context.Background(), provider.ExecuteRequest{
		RepoPath:       repoPath,
		Instruction:    "Continue the previous thread",
		CodexBinPath:   binPath,
		SandboxMode:    "danger-full-access",
		ResumeThreadID: "thread_existing_123",
	}, nil)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result.ProviderThreadID != "thread_existing_123" {
		t.Fatalf("expected resumed thread id, got %#v", result)
	}
}

func TestExecuteFallsBackToFreshThreadWhenResumedThreadStalls(t *testing.T) {
	repoPath := t.TempDir()
	binPath := writeFakeAppServerCodexBinaryWithResumeStall(t)

	executor, err := NewExecutor(Options{
		CodexBinPath:       binPath,
		CodexHome:          t.TempDir(),
		ResumeStallTimeout: 50 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewExecutor returned error: %v", err)
	}
	defer executor.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	result, err := executor.Execute(ctx, provider.ExecuteRequest{
		RepoPath:       repoPath,
		Instruction:    "Continue after a stale thread",
		CodexBinPath:   binPath,
		SandboxMode:    "danger-full-access",
		ResumeThreadID: "thread_existing_123",
	}, nil)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result.ProviderThreadID != "thread_fresh_after_retry" {
		t.Fatalf("expected fallback to fresh thread, got %#v", result)
	}
	if strings.TrimSpace(result.LastMessage) != "fresh thread recovered" {
		t.Fatalf("expected fresh thread message after retry, got %#v", result)
	}
}

func writeFakeAppServerCodexBinary(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "codex")
	content := `#!/bin/sh
if [ "$1" != "app-server" ]; then
  echo "unexpected command: $*" >&2
  exit 1
fi

active_thread=""
while IFS= read -r line; do
  id="$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"id":%s,"result":{"userAgent":"fake-app-server"}}\n' "$id"
      ;;
    *'"method":"thread/start"'*)
      active_thread="thread_fake_start"
      printf '{"id":%s,"result":{"thread":{"id":"%s"}}}\n' "$id" "$active_thread"
      printf '{"method":"thread/started","params":{"thread":{"id":"%s"}}}\n' "$active_thread"
      ;;
    *'"method":"thread/resume"'*)
      active_thread="$(printf '%s\n' "$line" | sed -n 's/.*"threadId":"\([^"]*\)".*/\1/p')"
      if [ -z "$active_thread" ]; then
        active_thread="thread_existing_123"
      fi
      printf '{"id":%s,"result":{"thread":{"id":"%s"}}}\n' "$id" "$active_thread"
      ;;
    *'"method":"turn/start"'*)
      printf '{"id":%s,"result":{"turn":{"id":"turn_fake"}}}\n' "$id"
      printf '{"method":"item/started","params":{"threadId":"%s","turnId":"turn_fake","item":{"type":"commandExecution","id":"cmd_1","command":"git status","status":"inProgress"}}}\n' "$active_thread"
      printf '{"method":"item/commandExecution/outputDelta","params":{"threadId":"%s","turnId":"turn_fake","itemId":"cmd_1","delta":"git status output"}}\n' "$active_thread"
      printf '{"method":"item/completed","params":{"threadId":"%s","turnId":"turn_fake","item":{"type":"commandExecution","id":"cmd_1","command":"git status","status":"completed","aggregatedOutput":"git status output"}}}\n' "$active_thread"
      printf '{"method":"item/agentMessage/delta","params":{"threadId":"%s","turnId":"turn_fake","itemId":"msg_1","delta":"hello"}}\n' "$active_thread"
      printf '{"method":"item/completed","params":{"threadId":"%s","turnId":"turn_fake","item":{"type":"agentMessage","id":"msg_1","text":"hello from app-server"}}}\n' "$active_thread"
      printf '{"method":"turn/completed","params":{"threadId":"%s","turn":{"id":"turn_fake"}}}\n' "$active_thread"
      ;;
  esac
done
`
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("failed to write fake codex binary: %v", err)
	}
	return path
}

func writeFakeAppServerCodexBinaryWithResumeStall(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "codex")
	content := `#!/bin/sh
if [ "$1" != "app-server" ]; then
  echo "unexpected command: $*" >&2
  exit 1
fi

active_thread=""
while IFS= read -r line; do
  id="$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"id":%s,"result":{"userAgent":"fake-app-server"}}\n' "$id"
      ;;
    *'"method":"thread/resume"'*)
      active_thread="thread_existing_123"
      printf '{"id":%s,"result":{"thread":{"id":"%s"}}}\n' "$id" "$active_thread"
      ;;
    *'"method":"thread/start"'*)
      active_thread="thread_fresh_after_retry"
      printf '{"id":%s,"result":{"thread":{"id":"%s"}}}\n' "$id" "$active_thread"
      ;;
    *'"method":"turn/start"'*)
      if [ "$active_thread" = "thread_existing_123" ]; then
        printf '{"id":%s,"result":{"turn":{"id":"turn_stalled"}}}\n' "$id"
        sleep 5
      else
        printf '{"id":%s,"result":{"turn":{"id":"turn_fresh"}}}\n' "$id"
        printf '{"method":"item/completed","params":{"threadId":"%s","turnId":"turn_fresh","item":{"type":"agentMessage","id":"msg_1","text":"fresh thread recovered"}}}\n' "$active_thread"
        printf '{"method":"turn/completed","params":{"threadId":"%s","turn":{"id":"turn_fresh"}}}\n' "$active_thread"
      fi
      ;;
  esac
done
`
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("failed to write fake codex binary: %v", err)
	}
	return path
}
