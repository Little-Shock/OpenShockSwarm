package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"openshock/daemon/internal/client"
)

func TestPrepareAgentWorkspaceCreatesPersistentFilesAndReusesDirectory(t *testing.T) {
	root := t.TempDir()
	execution := client.AgentTurnExecution{
		Session: client.AgentSession{
			ID:               "agent_session_123",
			ProviderThreadID: "provider_thread_agent_session_123",
		},
		Turn: client.AgentTurn{
			ID:         "turn_001",
			Sequence:   1,
			RoomID:     "room_001",
			AgentID:    "agent_shell",
			IntentType: "visible_message_response",
			WakeupMode: "direct_message",
		},
		Room: client.RoomSummary{
			ID:    "room_001",
			Title: "Announcements",
		},
		TriggerMessage: client.Message{
			ID:        "msg_001",
			ActorName: "Sarah",
			Kind:      "message",
			Body:      "@agent_shell 有人吗？",
		},
		Messages: []client.Message{
			{ActorName: "Sarah", Kind: "message", Body: "@agent_shell 有人吗？"},
		},
	}

	dir, err := prepareAgentWorkspace(root, execution)
	if err != nil {
		t.Fatalf("prepareAgentWorkspace returned error: %v", err)
	}
	if filepath.Dir(dir) != root {
		t.Fatalf("expected workspace root %s, got %s", root, dir)
	}

	memoryPath := filepath.Join(dir, "MEMORY.md")
	if _, err := os.Stat(memoryPath); err != nil {
		t.Fatalf("expected MEMORY.md to exist: %v", err)
	}
	if err := os.WriteFile(memoryPath, []byte("persisted note\n"), 0o644); err != nil {
		t.Fatalf("failed to update memory file: %v", err)
	}

	execution.Turn.ID = "turn_002"
	execution.Turn.Sequence = 2
	execution.Turn.IntentType = "clarification_followup"
	execution.Turn.WakeupMode = "clarification_followup"
	execution.TriggerMessage.ID = "msg_002"
	execution.TriggerMessage.Body = "可以改，继续。"

	secondDir, err := prepareAgentWorkspace(root, execution)
	if err != nil {
		t.Fatalf("second prepareAgentWorkspace returned error: %v", err)
	}
	if secondDir != dir {
		t.Fatalf("expected workspace reuse, got first=%s second=%s", dir, secondDir)
	}

	memoryBytes, err := os.ReadFile(memoryPath)
	if err != nil {
		t.Fatalf("failed to read memory file: %v", err)
	}
	if string(memoryBytes) != "persisted note\n" {
		t.Fatalf("expected memory file to persist across turns, got %q", string(memoryBytes))
	}

	for _, expected := range []string{
		filepath.Join(dir, "SESSION.json"),
		filepath.Join(dir, "CURRENT_TURN.md"),
		filepath.Join(dir, "notes", "room-context.md"),
		filepath.Join(dir, "notes", "work-log.md"),
		filepath.Join(dir, "turns", "001-turn_001.md"),
		filepath.Join(dir, "turns", "002-turn_002.md"),
	} {
		if _, err := os.Stat(expected); err != nil {
			t.Fatalf("expected workspace artifact %s: %v", expected, err)
		}
	}

	currentTurn, err := os.ReadFile(filepath.Join(dir, "CURRENT_TURN.md"))
	if err != nil {
		t.Fatalf("failed to read current turn file: %v", err)
	}
	if !strings.Contains(string(currentTurn), "Wakeup mode: clarification_followup") {
		t.Fatalf("expected CURRENT_TURN.md to describe latest wakeup mode, got %q", string(currentTurn))
	}
	if !strings.Contains(string(currentTurn), "## Reply Contract") {
		t.Fatalf("expected CURRENT_TURN.md to include reply contract, got %q", string(currentTurn))
	}

	roomContext, err := os.ReadFile(filepath.Join(dir, "notes", "room-context.md"))
	if err != nil {
		t.Fatalf("failed to read room context note: %v", err)
	}
	if !strings.Contains(string(roomContext), "Wakeup mode: clarification_followup") {
		t.Fatalf("expected room context note to refresh wakeup mode, got %q", string(roomContext))
	}

	if err := appendAgentWorkspaceLog(dir, "turn_completed", execution, agentTurnReply{
		Kind: "message",
		Body: "我继续处理这件事。",
	}, nil); err != nil {
		t.Fatalf("appendAgentWorkspaceLog returned error: %v", err)
	}

	workLog, err := os.ReadFile(filepath.Join(dir, "notes", "work-log.md"))
	if err != nil {
		t.Fatalf("failed to read work log: %v", err)
	}
	for _, expected := range []string{
		"# OpenShock Agent Work Log",
		"turn_completed",
		"- Turn ID: turn_002",
		"- Wakeup mode: clarification_followup",
		"- Reply kind: message",
	} {
		if !strings.Contains(string(workLog), expected) {
			t.Fatalf("expected work log to contain %q, got %q", expected, string(workLog))
		}
	}
}
