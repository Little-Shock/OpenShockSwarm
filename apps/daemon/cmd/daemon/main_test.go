package main

import (
	"os"
	"path/filepath"
	"testing"

	"openshock/daemon/internal/client"
)

func TestParseAgentTurnReplyStructured(t *testing.T) {
	reply := parseAgentTurnReply("RESULT: handoff\nBODY:\n@agent_guardian 请你接手风险评审。")

	if reply.Kind != "handoff" {
		t.Fatalf("expected handoff kind, got %q", reply.Kind)
	}
	if reply.Body != "@agent_guardian 请你接手风险评审。" {
		t.Fatalf("unexpected reply body: %q", reply.Body)
	}
}

func TestParseAgentTurnReplyStructuredNoResponse(t *testing.T) {
	reply := parseAgentTurnReply("RESULT: no_response\nBODY:\n")

	if reply.Kind != "no_response" {
		t.Fatalf("expected no_response kind, got %q", reply.Kind)
	}
	if reply.Body != "" {
		t.Fatalf("expected empty body for no_response, got %q", reply.Body)
	}
}

func TestParseAgentTurnReplyMapsLegacyMessageToDone(t *testing.T) {
	reply := parseAgentTurnReply("KIND: message\nBODY:\n我已理解目标。\n- 先检查上下文\n- 再给出计划")

	if reply.Kind != "done" {
		t.Fatalf("expected legacy message kind to map to done, got %q", reply.Kind)
	}
	if reply.Body == "" {
		t.Fatal("expected fallback body to preserve original content")
	}
}

func TestParseAgentTurnReplyFallsBackToDone(t *testing.T) {
	reply := parseAgentTurnReply("我已理解目标。\n- 先检查上下文\n- 再给出计划")

	if reply.Kind != "done" {
		t.Fatalf("expected fallback kind done, got %q", reply.Kind)
	}
	if reply.Body == "" {
		t.Fatal("expected fallback body to preserve original content")
	}
}

func TestAgentTurnReplyKindNeedsVisiblePostOnlyForHandoffOrBlocked(t *testing.T) {
	for _, tc := range []struct {
		kind string
		want bool
	}{
		{kind: "done", want: false},
		{kind: "no_response", want: false},
		{kind: "handoff", want: true},
		{kind: "blocked", want: true},
	} {
		if got := shouldPostVisibleAgentReply(tc.kind); got != tc.want {
			t.Fatalf("kind %q expected visible post=%v, got %v", tc.kind, tc.want, got)
		}
	}
}

func TestPrepareSessionCodexHomeCopiesProviderConfigAndAuth(t *testing.T) {
	base := t.TempDir()
	if err := os.WriteFile(filepath.Join(base, "config.toml"), []byte("model_provider = \"codex-for-me\"\n"), 0o600); err != nil {
		t.Fatalf("failed to seed config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(base, "auth.json"), []byte("{\"token\":\"demo\"}\n"), 0o600); err != nil {
		t.Fatalf("failed to seed auth: %v", err)
	}

	target := prepareSessionCodexHome(base, client.AgentSession{
		ID:               "agent_session_123",
		ProviderThreadID: "provider_thread_agent_session_123",
		AgentID:          "agent_shell",
		RoomID:           "room_001",
	})
	if target == "" {
		t.Fatal("expected session codex home path")
	}
	expectedDir := filepath.Join(base, "sessions", "agents", "agent_shell", "rooms", "room_001")
	if target != expectedDir {
		t.Fatalf("expected session codex home path %s, got %s", expectedDir, target)
	}

	for _, name := range []string{"config.toml", "auth.json"} {
		data, err := os.ReadFile(filepath.Join(target, name))
		if err != nil {
			t.Fatalf("expected %s to be copied: %v", name, err)
		}
		if len(data) == 0 {
			t.Fatalf("expected %s to be non-empty", name)
		}
	}
}

func TestWorkerCodexHomeReturnsEmptyWhenBaseUnset(t *testing.T) {
	if got := workerCodexHome("", 1); got != "" {
		t.Fatalf("expected empty worker codex home when base is unset, got %q", got)
	}
}

func TestPrepareSessionCodexHomeReturnsEmptyWhenBaseUnset(t *testing.T) {
	if got := prepareSessionCodexHome("", client.AgentSession{ID: "agent_session_123"}); got != "" {
		t.Fatalf("expected empty session codex home when base is unset, got %q", got)
	}
}

func TestResolveResumeThreadIDPrefersWorkspaceState(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	if err := writeWorkspaceSessionMetadata(dir, client.AgentSession{
		ID:                "agent_session_123",
		AppServerThreadID: "thread_backend_old",
	}, "", "", "", "", ""); err != nil {
		t.Fatalf("writeWorkspaceSessionMetadata returned error: %v", err)
	}
	if err := writeAppServerThreadID(dir, "thread_workspace_new"); err != nil {
		t.Fatalf("writeAppServerThreadID returned error: %v", err)
	}

	threadID := resolveResumeThreadID("thread_backend_old", dir)
	if threadID != "thread_workspace_new" {
		t.Fatalf("expected workspace thread id to win, got %q", threadID)
	}
}

func TestResolveResumeThreadIDFallsBackToSessionState(t *testing.T) {
	threadID := resolveResumeThreadID("thread_backend_only", t.TempDir())
	if threadID != "thread_backend_only" {
		t.Fatalf("expected backend session thread id fallback, got %q", threadID)
	}
}

func TestPersistAgentTurnThreadStateClearsWorkspaceThreadOnFailure(t *testing.T) {
	dir := t.TempDir()
	if err := writeWorkspaceSessionMetadata(dir, client.AgentSession{
		ID:                "agent_session_123",
		AppServerThreadID: "thread_stale_001",
	}, "", "", "", "", ""); err != nil {
		t.Fatalf("writeWorkspaceSessionMetadata returned error: %v", err)
	}

	if err := persistAgentTurnThreadState(dir, "thread_new_001", assertError("boom")); err != nil {
		t.Fatalf("persistAgentTurnThreadState returned error: %v", err)
	}
	if _, err := readAppServerThreadID(dir); err == nil {
		t.Fatal("expected failed execution to clear workspace app-server thread id")
	}
}

type assertedError string

func (e assertedError) Error() string { return string(e) }

func assertError(message string) error { return assertedError(message) }
