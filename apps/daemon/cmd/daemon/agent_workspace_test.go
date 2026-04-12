package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"openshock/daemon/internal/client"
)

func TestPrepareAgentWorkspaceCreatesPersistentFilesAndReusesDirectory(t *testing.T) {
	root := t.TempDir()
	execution := client.AgentTurnExecution{
		Session: client.AgentSession{
			ID:               "agent_session_123",
			ProviderThreadID: "provider_thread_agent_session_123",
			AgentID:          "agent_shell",
			RoomID:           "room_001",
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
	expectedDir := filepath.Join(root, "agents", "agent_shell", "rooms", "room_001")
	if dir != expectedDir {
		t.Fatalf("expected workspace dir %s, got %s", expectedDir, dir)
	}

	memoryPath := filepath.Join(root, "agents", "agent_shell", "MEMORY.md")
	if _, err := os.Stat(memoryPath); err != nil {
		t.Fatalf("expected MEMORY.md to exist: %v", err)
	}
	if err := os.WriteFile(memoryPath, []byte("persisted note\n"), 0o644); err != nil {
		t.Fatalf("failed to update memory file: %v", err)
	}

	execution.Turn.ID = "turn_002"
	execution.Turn.Sequence = 2
	execution.Turn.IntentType = "handoff_response"
	execution.Turn.WakeupMode = "handoff_response"
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
	} {
		if _, err := os.Stat(expected); err != nil {
			t.Fatalf("expected workspace artifact %s: %v", expected, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "turns")); !os.IsNotExist(err) {
		t.Fatalf("expected turns directory to be absent, got err=%v", err)
	}

	currentTurn, err := os.ReadFile(filepath.Join(dir, "CURRENT_TURN.md"))
	if err != nil {
		t.Fatalf("failed to read current turn file: %v", err)
	}
	if !strings.Contains(string(currentTurn), "唤醒模式：handoff_response") {
		t.Fatalf("expected CURRENT_TURN.md to describe latest wakeup mode, got %q", string(currentTurn))
	}
	for _, expected := range []string{
		"# 当前回合",
		"本文件只记录本回合的事实快照；回复契约、决策规则和 CLI 用法以系统 prompt 为准。",
		"## 触发消息",
		"## 最近消息",
	} {
		if !strings.Contains(string(currentTurn), expected) {
			t.Fatalf("expected CURRENT_TURN.md to contain %q, got %q", expected, string(currentTurn))
		}
	}
	for _, unexpected := range []string{
		"## 结束契约",
		"RESULT: <done|handoff|no_response>",
		"高频用法速查",
		"当前 Agent Prompt：",
		"这是你的职责边界，不是风格建议。",
		"openshock send-message --room",
	} {
		if strings.Contains(string(currentTurn), unexpected) {
			t.Fatalf("expected CURRENT_TURN.md to avoid %q, got %q", unexpected, string(currentTurn))
		}
	}

	roomContext, err := os.ReadFile(filepath.Join(dir, "notes", "room-context.md"))
	if err != nil {
		t.Fatalf("failed to read room context note: %v", err)
	}
	if !strings.Contains(string(roomContext), "唤醒模式：handoff_response") {
		t.Fatalf("expected room context note to refresh wakeup mode, got %q", string(roomContext))
	}
	for _, unexpected := range []string{
		"高频用法速查",
		"openshock send-message --room",
		"不要把 `openshock --help` 当成默认第一步",
	} {
		if strings.Contains(string(roomContext), unexpected) {
			t.Fatalf("expected room context note to stay factual without %q, got %q", unexpected, string(roomContext))
		}
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
		"# OpenShock Agent 工作日志",
		"turn_completed",
		"- 回合 ID：turn_002",
		"- 唤醒模式：handoff_response",
		"- 回复类型：message",
	} {
		if !strings.Contains(string(workLog), expected) {
			t.Fatalf("expected work log to contain %q, got %q", expected, string(workLog))
		}
	}

	if _, err := readAppServerThreadID(dir); err == nil {
		t.Fatal("expected no app-server thread id before it is written")
	}
	if err := writeAppServerThreadID(dir, "thread_appserver_001"); err != nil {
		t.Fatalf("writeAppServerThreadID returned error: %v", err)
	}
	threadID, err := readAppServerThreadID(dir)
	if err != nil {
		t.Fatalf("readAppServerThreadID returned error: %v", err)
	}
	if threadID != "thread_appserver_001" {
		t.Fatalf("expected persisted app-server thread id, got %q", threadID)
	}
}

func TestDefaultAgentMemoryIncludesRoleBoundary(t *testing.T) {
	memory := defaultAgentMemory(client.AgentTurnExecution{
		Turn: client.AgentTurn{
			AgentID: "agent_qa",
			RoomID:  "room_qa",
		},
		AgentName:   "QA",
		AgentPrompt: "你需要按质量保障和验收进行工作，不负责产品方向定义。",
		Session: client.AgentSession{
			AgentID:          "agent_qa",
			RoomID:           "room_qa",
			ProviderThreadID: "provider_thread_agent_session_qa",
		},
	})

	for _, expected := range []string{
		"## Agent",
		"Agent 名称：QA",
		"Agent ID：agent_qa",
		"Session 房间：room_qa",
	} {
		if !strings.Contains(memory, expected) {
			t.Fatalf("expected default memory to contain %q, got %q", expected, memory)
		}
	}
	for _, unexpected := range []string{
		"Agent Prompt：",
		"这是当前 agent 的职责边界",
		"优先不回复，只更新记忆",
	} {
		if strings.Contains(memory, unexpected) {
			t.Fatalf("expected default memory to avoid %q, got %q", unexpected, memory)
		}
	}
}

func TestWriteAppServerThreadIDClearsWhenEmpty(t *testing.T) {
	dir := t.TempDir()
	if err := writeWorkspaceSessionMetadata(dir, client.AgentSession{
		ID:                "agent_session_123",
		AppServerThreadID: "thread_stale_001",
	}, "", "", "", "", ""); err != nil {
		t.Fatalf("writeWorkspaceSessionMetadata returned error: %v", err)
	}

	if err := writeAppServerThreadID(dir, ""); err != nil {
		t.Fatalf("writeAppServerThreadID returned error: %v", err)
	}
	if _, err := readAppServerThreadID(dir); err == nil {
		t.Fatal("expected cleared app-server thread id to be unreadable")
	}
}

func TestWriteWorkspaceSessionMetadataPreservesClearedLocalAppServerThreadID(t *testing.T) {
	dir := t.TempDir()
	if err := writeWorkspaceSessionMetadata(dir, client.AgentSession{
		ID:                "agent_session_123",
		AppServerThreadID: "thread_original_local",
	}, "", "", "", "", ""); err != nil {
		t.Fatalf("writeWorkspaceSessionMetadata returned error: %v", err)
	}
	if err := writeAppServerThreadID(dir, ""); err != nil {
		t.Fatalf("writeAppServerThreadID returned error: %v", err)
	}

	if err := writeWorkspaceSessionMetadata(dir, client.AgentSession{
		ID:                "agent_session_123",
		AppServerThreadID: "thread_backend_stale",
	}, "room_005", "all", "agent_001", "turn_002", "direct_message"); err != nil {
		t.Fatalf("writeWorkspaceSessionMetadata returned error: %v", err)
	}

	if _, err := readAppServerThreadID(dir); err == nil {
		t.Fatal("expected cleared local app-server thread id to stay cleared")
	}
}

func TestAppendFileLockedPreservesUTF8UnderConcurrentWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "work-log.md")
	if err := os.WriteFile(path, []byte("# OpenShock Agent 工作日志\n"), 0o644); err != nil {
		t.Fatalf("failed to seed work log: %v", err)
	}

	const writers = 24
	const repeats = 32

	var wg sync.WaitGroup
	wg.Add(writers)

	for i := range writers {
		go func(index int) {
			defer wg.Done()

			entry := fmt.Sprintf(
				"\n## writer-%02d\n- 内容：%s\n",
				index,
				strings.Repeat(fmt.Sprintf("并发写入-%02d-", index), repeats),
			)
			if err := appendFileLocked(path, []byte(entry)); err != nil {
				t.Errorf("appendFileLocked returned error for writer %d: %v", index, err)
			}
		}(i)
	}

	wg.Wait()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read work log: %v", err)
	}
	if !utf8.Valid(data) {
		t.Fatalf("expected concurrent appends to preserve utf-8, got %q", string(data))
	}
	for i := range writers {
		marker := fmt.Sprintf("## writer-%02d", i)
		if count := strings.Count(string(data), marker); count != 1 {
			t.Fatalf("expected marker %q exactly once, got %d in %q", marker, count, string(data))
		}
	}
}
