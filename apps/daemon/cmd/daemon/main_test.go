package main

import (
	"strings"
	"testing"

	"openshock/daemon/internal/client"
)

func TestParseAgentTurnReplyStructured(t *testing.T) {
	reply := parseAgentTurnReply("KIND: clarification_request\nBODY:\n请先确认是否允许我修改 billing 模块。")

	if reply.Kind != "clarification_request" {
		t.Fatalf("expected clarification_request kind, got %q", reply.Kind)
	}
	if reply.Body != "请先确认是否允许我修改 billing 模块。" {
		t.Fatalf("unexpected reply body: %q", reply.Body)
	}
}

func TestParseAgentTurnReplyStructuredNoResponse(t *testing.T) {
	reply := parseAgentTurnReply("KIND: no_response\nBODY:\n")

	if reply.Kind != "no_response" {
		t.Fatalf("expected no_response kind, got %q", reply.Kind)
	}
	if reply.Body != "" {
		t.Fatalf("expected empty body for no_response, got %q", reply.Body)
	}
}

func TestParseAgentTurnReplyFallsBackToMessage(t *testing.T) {
	reply := parseAgentTurnReply("我已理解目标。\n- 先检查上下文\n- 再给出计划")

	if reply.Kind != "message" {
		t.Fatalf("expected fallback kind message, got %q", reply.Kind)
	}
	if reply.Body == "" {
		t.Fatal("expected fallback body to preserve original content")
	}
}

func TestBuildAgentTurnInstructionUsesChatFirstPrompt(t *testing.T) {
	instruction := buildAgentTurnInstruction(client.AgentTurnExecution{
		Turn: client.AgentTurn{
			ID:         "turn_001",
			RoomID:     "room_001",
			AgentID:    "agent_shell",
			IntentType: "visible_message_response",
			WakeupMode: "direct_message",
			EventFrame: client.EventFrame{
				CurrentTarget:         "room:room_001",
				ContextSummary:        "Respond in room:room_001 for trigger message msg_001.",
				RecentMessagesSummary: "Sarah[message]: @agent_shell 有人吗？",
				ExpectedAction:        "visible_message_response",
			},
		},
		Room: client.RoomSummary{ID: "room_001", Title: "Announcements"},
		TriggerMessage: client.Message{
			ID:        "msg_001",
			ActorType: "member",
			ActorName: "Sarah",
			Kind:      "message",
			Body:      "@agent_shell 有人吗？",
		},
		Messages: []client.Message{
			{ActorName: "Sarah", Kind: "message", Body: "@agent_shell 有人吗？"},
		},
	})

	for _, expected := range []string{
		"KIND: <message|clarification_request|handoff|summary|no_response>",
		"Lifecycle:",
		"This workspace persists across turns",
		"Workspace contract:",
		"Read MEMORY.md first",
		"Read CURRENT_TURN.md for this turn's exact trigger",
		"notes/room-context.md",
		"notes/work-log.md",
		"update MEMORY.md before you stop",
		"Wakeup mode: direct_message.",
		"Mode-specific first step:",
		"First decide whether this message needs your reply.",
		"natural language",
		"Reply contract:",
		"Mention signals in trigger: @agent_shell",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected instruction to contain %q, got:\n%s", expected, instruction)
		}
	}
	if strings.Contains(instruction, "plan|") {
		t.Fatalf("did not expect old plan-based reply format in instruction:\n%s", instruction)
	}
}

func TestBuildAgentTurnInstructionClarificationFollowupMode(t *testing.T) {
	instruction := buildAgentTurnInstruction(client.AgentTurnExecution{
		Turn: client.AgentTurn{
			ID:         "turn_002",
			RoomID:     "room_001",
			AgentID:    "agent_shell",
			IntentType: "clarification_followup",
			WakeupMode: "clarification_followup",
		},
		Room: client.RoomSummary{ID: "room_001", Title: "Announcements"},
		TriggerMessage: client.Message{
			ID:        "msg_002",
			ActorType: "member",
			ActorName: "Sarah",
			Kind:      "message",
			Body:      "可以改 billing guard，继续。",
		},
	})

	for _, expected := range []string{
		"Wakeup mode: clarification_followup.",
		"the human is replying after your earlier blocking clarification request",
		"Do not repeat the old blocker unless it still remains unresolved.",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected clarification prompt to contain %q, got:\n%s", expected, instruction)
		}
	}
}

func TestBuildAgentTurnInstructionHandoffMode(t *testing.T) {
	instruction := buildAgentTurnInstruction(client.AgentTurnExecution{
		Turn: client.AgentTurn{
			ID:         "turn_003",
			RoomID:     "room_001",
			AgentID:    "agent_guardian",
			IntentType: "handoff_response",
			WakeupMode: "handoff_response",
		},
		Room: client.RoomSummary{ID: "room_001", Title: "Announcements"},
		TriggerMessage: client.Message{
			ID:        "msg_003",
			ActorType: "agent",
			ActorName: "agent_shell",
			Kind:      "handoff",
			Body:      "@agent_guardian 这里需要你接手。",
		},
	})

	for _, expected := range []string{
		"Wakeup mode: handoff_response.",
		"another agent explicitly asked you to take over or continue the thread",
		"Start from the assumption that takeover is expected.",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected handoff prompt to contain %q, got:\n%s", expected, instruction)
		}
	}
}
