package store

import (
	"strings"
	"testing"

	"openshock/backend/internal/core"
)

func TestBuildAgentTurnInstructionUsesChatFirstPrompt(t *testing.T) {
	instruction := buildAgentTurnInstruction(core.AgentTurnExecution{
		Turn: core.AgentTurn{
			ID:         "turn_001",
			RoomID:     "room_001",
			AgentID:    "agent_shell",
			IntentType: "visible_message_response",
			WakeupMode: "direct_message",
			EventFrame: core.EventFrame{
				CurrentTarget:         "room:room_001",
				ContextSummary:        "Respond in room:room_001 for trigger message msg_001.",
				RecentMessagesSummary: "Sarah[message]: @agent_shell 有人吗？",
				ExpectedAction:        "visible_message_response",
			},
		},
		AgentName:   "Shell_Runner",
		AgentPrompt: "执行型工程师，适合承担具体实现和命令执行工作，习惯边做边验证。",
		Room:        core.RoomSummary{ID: "room_101", IssueID: "issue_101", Title: "Announcements", Kind: "issue"},
		Issue: &core.Issue{
			ID:       "issue_101",
			Title:    "Fix memory leak in observer pipeline",
			Status:   "in_progress",
			Priority: "urgent",
			RepoPath: "/tmp/openshock-repo",
		},
		Tasks: []core.Task{
			{
				ID:              "task_guard",
				Title:           "Add retention guard around handoff queue",
				Status:          "in_progress",
				AssigneeAgentID: "agent_shell",
				BranchName:      "issue-101/task-guard",
				RunCount:        1,
			},
		},
		Runs: []core.Run{
			{
				ID:            "run_guard_01",
				TaskID:        "task_guard",
				Status:        "approval_required",
				AgentID:       "agent_shell",
				BranchName:    "issue-101/task-guard",
				OutputPreview: "Proposed patch touches guarded billing code. Awaiting approval.",
			},
		},
		MergeAttempts: []core.MergeAttempt{
			{
				ID:           "merge_101",
				TaskID:       "task_guard",
				Status:       "queued",
				SourceBranch: "issue-101/task-guard",
				TargetBranch: "issue-101/integration",
			},
		},
		IntegrationBranch: &core.IntegrationBranch{
			Name:          "issue-101/integration",
			Status:        "integrating",
			MergedTaskIDs: []string{"task_diag"},
		},
		TriggerMessage: core.Message{
			ID:        "msg_001",
			ActorType: "member",
			ActorName: "Sarah",
			Kind:      "message",
			Body:      "@agent_shell 有人吗？",
		},
		Messages: []core.Message{
			{ActorName: "Sarah", Kind: "message", Body: "@agent_shell 有人吗？"},
		},
	})

	for _, expected := range []string{
		"RESULT: <done|handoff|no_response>",
		"生命周期：",
		"这个工作区会在同一个 OpenShock agent session 的后续回合之间持续复用",
		"工作区约定：",
		"深入思考前先阅读 MEMORY.md",
		"阅读 CURRENT_TURN.md，确认本回合的精确触发原因和当前事实快照",
		"notes/room-context.md",
		"notes/work-log.md",
		"请在结束前更新 MEMORY.md",
		"系统工作流约定：",
		"`openshock`",
		"openshock task create --issue issue_101",
		"openshock task claim --task <task_id> --actor-id agent_shell",
		"openshock send-message --room room_001 --body",
		"openshock task status set --task <task_id> --status in_progress --actor-id agent_shell",
		"openshock run create --task <task_id> --actor-id agent_shell",
		"openshock git request-merge --task <task_id> --actor-id agent_shell",
		"openshock git approve-merge --task <task_id> --actor-id agent_shell",
		"openshock run create --task <task_id> --actor-id agent_shell",
		"openshock git request-merge --task <task_id> --actor-id agent_shell",
		"openshock git approve-merge --task <task_id> --actor-id agent_shell",
		"openshock delivery request --issue issue_101 --actor-id agent_shell",
		"高频用法速查：",
		"唤醒模式：direct_message。",
		"该模式下的第一步：",
		"先判断这条消息是否需要你可见地回复。",
		"如果当前触发主要是在找别的 agent，而你没有新增价值，默认使用 `no_response`。",
		"如果你只是学到了一点稳定上下文，但不需要改变房间里的共享认知，就只更新 MEMORY.md，不要发送可见消息。",
		"不要把“我先看一下”、“我先确认一下”、“我先复核一下”这类内部思考过程发到房间里。",
		"openshock send-message --room room_001 --body",
		"`send-message` 只发送需要告知相关人的事实、结论、阻塞或下一步。",
		"普通可见消息不会从最终 `RESULT` 自动转发到房间。",
		"自然语言",
		"回复契约：",
		"身份约定：",
		"你在房间界面里的名字是 `Shell_Runner`。",
		"Agent Prompt：",
		"执行型工程师，适合承担具体实现和命令执行工作，习惯边做边验证。",
		"这是你的职责边界，不只是风格建议。",
		"当前 Issue：issue_101 | Fix memory leak in observer pipeline | status=in_progress | priority=urgent",
		"默认 Repo：/tmp/openshock-repo",
		"task_guard | Add retention guard around handoff queue | status=in_progress | assignee=agent_shell | branch=issue-101/task-guard | 1 run",
		"run_guard_01 | task=task_guard | status=approval_required | branch=issue-101/task-guard",
		"Integration Branch：issue-101/integration | status=integrating | merged=task_diag",
		"merge_101 | task=task_guard | status=queued | issue-101/task-guard -> issue-101/integration",
		"触发消息中的 mention 信号：@agent_shell",
		"不要假设存在 `openshock issue show`、`openshock agent list` 之类未声明的只读命令。",
		"不要把 `openshock --help` 当成默认第一步",
		"--assignee-agent-id <agent_id>",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected instruction to contain %q, got:\n%s", expected, instruction)
		}
	}
	if strings.Contains(instruction, "plan|") {
		t.Fatalf("did not expect old plan-based reply format in instruction:\n%s", instruction)
	}
}

func TestBuildAgentTurnInstructionHandoffMode(t *testing.T) {
	instruction := buildAgentTurnInstruction(core.AgentTurnExecution{
		Turn: core.AgentTurn{
			ID:         "turn_003",
			RoomID:     "room_001",
			AgentID:    "agent_guardian",
			IntentType: "handoff_response",
			WakeupMode: "handoff_response",
		},
		AgentName:   "Guardian_Bot",
		AgentPrompt: "风险守门人。",
		Room:        core.RoomSummary{ID: "room_001", Title: "Announcements"},
		TriggerMessage: core.Message{
			ID:        "msg_003",
			ActorType: "agent",
			ActorName: "agent_shell",
			Kind:      "handoff",
			Body:      "@agent_guardian 这里需要你接手。",
		},
	})

	for _, expected := range []string{
		"唤醒模式：handoff_response。",
		"另一位 agent 明确要求你接手或继续这个线程",
		"默认这次唤醒意味着你被期待接手。",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected handoff prompt to contain %q, got:\n%s", expected, instruction)
		}
	}
}
