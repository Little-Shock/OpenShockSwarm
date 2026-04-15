package api

import (
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestBuildRoomExecPromptIncludesRoomRunAndRecentContext(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{
			ID:    "room-runtime",
			Title: "Runtime Lane",
			Topic: store.Topic{
				ID:      "topic-runtime",
				Title:   "Pairing Recovery",
				Summary: "收紧 daemon continuity",
			},
		}},
		Runs: []store.Run{{
			ID:           "run_runtime_01",
			RoomID:       "room-runtime",
			Status:       "running",
			Provider:     "Codex CLI",
			Branch:       "feat/runtime-continuity",
			Worktree:     "wt-runtime-continuity",
			WorktreePath: "/tmp/runtime-continuity",
		}},
		Issues: []store.Issue{{
			ID:     "issue-runtime",
			Key:    "OPS-12",
			Title:  "Recover runtime continuity",
			Owner:  "Codex Dockmaster",
			State:  "running",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{
			{
				ID:                 "agent-codex-dockmaster",
				Name:               "Codex Dockmaster",
				Role:               "Platform Architect",
				Lane:               "OPS-12",
				ProviderPreference: "codex",
				Prompt:             "优先收紧 continuity 和运行链路，不要空谈。",
			},
			{
				ID:                 "agent-claude-review-runner",
				Name:               "Claude Review Runner",
				Role:               "Review Runner",
				Lane:               "OPS-19",
				ProviderPreference: "claude",
			},
		},
		RoomMessages: map[string][]store.Message{
			"room-runtime": {
				{Speaker: "Larkspur", Role: "human", Message: "先把 continuity 做扎实。"},
				{Speaker: "Codex Dockmaster", Role: "agent", Message: "我已经接到当前 worktree，会继续沿着这条 lane 推进。"},
			},
		},
	}

	prompt := buildRoomExecPrompt(snapshot, "room-runtime", "codex", "继续把 session continuity 做实")

	for _, expected := range []string{
		"你正在 OpenShock 的讨论间里继续当前工作线程。",
		"- 房间：Runtime Lane (room-runtime)",
		"- Topic：Pairing Recovery",
		"- Issue：OPS-12 | Recover runtime continuity | owner=Codex Dockmaster | state=running",
		"- Run：run_runtime_01 | status=running | provider=Codex CLI | branch=feat/runtime-continuity | worktree=wt-runtime-continuity",
		"- 当前接手：Codex Dockmaster | role=Platform Architect | lane=OPS-12 | provider=codex",
		"- 当前智能体要求：优先收紧 continuity 和运行链路，不要空谈。",
		"- 工作目录：/tmp/runtime-continuity",
		"- Larkspur[human]: 先把 continuity 做扎实。",
		"- Codex Dockmaster[agent]: 我已经接到当前 worktree，会继续沿着这条 lane 推进。",
		"本轮用户消息：",
		"继续把 session continuity 做实",
		"读取边界：",
		"- 默认只围当前 room / run / worktree 和当前接手智能体的记忆继续推进。",
		"- 如果需要补上下文，先看当前工作目录里的 MEMORY.md、notes/work-log.md 和当前 room 对应笔记，再决定是否继续扩展。",
		"- 不要主动去翻别的 room、别的 issue、别的 worktree，或其他智能体的记忆空间。",
		"- 只有用户明确要求，或当前回合必须排查系统级问题时，才扩大读取范围；扩大后必须在公开回复里同步原因。",
		"- 先在内部判断这条消息是否需要公开回复、是否需要你接手，再决定输出。",
		"- 公开消息只能通过 SEND_PUBLIC_MESSAGE 这个封装返回；不要把正文裸写出来。",
		"- 先判断这条消息是否真的需要一个可见回复。",
		"- 默认控制在 1 到 3 句；先直接回答，再补下一步。",
		"- 如果只是内部继续执行，不要为了刷存在感发公开消息；优先 KIND: no_response。",
		"- 除非用户明确要求，不要长篇分点，不要复述系统背景。",
		"- 如果要回复，第一句必须像团队成员在聊天里说话，不要写成报告。",
		"- 如果本轮要接手、推进或同步结果，在第一句自然说清楚，不要写内部思考过程。",
		"- 本轮请以 Codex Dockmaster 的身份回应，不要替多个智能体同时发言。",
		"- 默认只在当前 room、当前 run、当前 worktree 和你自己的职责范围内判断与行动。",
		"- 不要主动扩散去翻其他 room、其他 agent 或其他工作空间；只有用户明确要求，或必须排查系统级问题且会在公开回复里说明原因时，才扩大范围。",
		"- 如果只是拿到了稳定上下文，但不需要改变房间里的共享认知，优先静默继续推进，不要为了说明自己看过而发消息。",
		"SEND_PUBLIC_MESSAGE",
		"KIND: message | summary | clarification_request | handoff | no_response",
		"CLAIM: keep | take",
		"- 如果这轮其实不需要你可见回复，就返回 SEND_PUBLIC_MESSAGE，KIND: no_response，BODY 留空。",
		"- 如果你要回复，就返回 SEND_PUBLIC_MESSAGE，KIND: message，然后在 BODY 写自然中文；系统只会展示 BODY。",
		"- 如果你只缺一个继续推进所必需的信息，就返回 KIND: clarification_request，然后在 BODY 里只问那一个问题。",
		"- 如果你只是做简短收尾或状态同步，就返回 KIND: summary；只写 1 到 2 句必要同步，不要重复房间背景。",
		"- 只有你准备继续承担这条房间后续工作时，才把 CLAIM 设为 take；只是被点名答一句时保持 CLAIM: keep。",
		"- 如果要把当前线程交给别人继续，也可以返回 KIND: handoff，然后在 BODY 里用 @agent_id 点名接手人；系统会自动把它记成正式交接。",
		"- handoff 正文只写一句短交棒，不要把上下文再讲一遍。",
		"- 如果这轮应该交给别的智能体继续，在正文最后单独追加一行：OPENSHOCK_HANDOFF: <agent_id> | <title> | <summary>",
		"  - agent-claude-review-runner | Claude Review Runner | Review Runner | lane=OPS-19",
		"- 不要把打算做的事说成已经做完。",
		"如果需要改代码或执行命令，默认围绕当前工作目录继续进行。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected room prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
	if strings.Contains(prompt, "agent-codex-dockmaster | Codex Dockmaster") {
		t.Fatalf("room prompt should not include current owner in handoff catalog, got:\n%s", prompt)
	}
}

func TestBuildRoomExecPromptFallsBackToRawPromptWhenRoomMissing(t *testing.T) {
	raw := "只回复一句话"
	if got := buildRoomExecPrompt(store.State{}, "missing-room", "codex", raw); got != raw {
		t.Fatalf("buildRoomExecPrompt() = %q, want %q", got, raw)
	}
}

func TestBuildRoomExecPromptIncludesClarificationFollowupHint(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			Title:    "Runtime Lane",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				Owner: "Codex Dockmaster",
			},
		}},
		Runs: []store.Run{{
			ID:     "run_runtime_01",
			RoomID: "room-runtime",
			Owner:  "Codex Dockmaster",
		}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			Owner:  "Codex Dockmaster",
			State:  "paused",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{{
			ID:   "agent-codex-dockmaster",
			Name: "Codex Dockmaster",
		}},
		RoomMessages: map[string][]store.Message{
			"room-runtime": {
				{Speaker: "Codex Dockmaster", Role: "agent", Tone: "blocked", Message: "请先确认是否允许我改 billing guard。"},
			},
		},
	}

	prompt := buildRoomExecPrompt(snapshot, "room-runtime", "codex", "可以改，只限当前 guard。")
	for _, expected := range []string{
		"当前触发提醒：",
		"- 你上一轮刚提出过阻塞性澄清，先判断这条新消息是否已经补齐关键信息。",
		"- 如果阻塞已解除，不要重复原问题，直接继续推进。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected clarification followup prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildRoomExecPromptIncludesInterruptedPendingTurnHint(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			Title:    "Runtime Lane",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				ID:      "topic-runtime",
				Title:   "Pairing Recovery",
				Owner:   "Codex Dockmaster",
				Summary: "收紧 daemon continuity",
			},
		}},
		Runs: []store.Run{{
			ID:           "run_runtime_01",
			RoomID:       "room-runtime",
			Status:       "running",
			Provider:     "Codex CLI",
			Owner:        "Codex Dockmaster",
			Branch:       "feat/runtime-continuity",
			Worktree:     "wt-runtime-continuity",
			WorktreePath: "/tmp/runtime-continuity",
		}},
		Issues: []store.Issue{{
			ID:     "issue-runtime",
			Key:    "OPS-12",
			Title:  "Recover runtime continuity",
			Owner:  "Codex Dockmaster",
			State:  "running",
			RoomID: "room-runtime",
		}},
		Sessions: []store.Session{{
			ID:              "session-runtime",
			IssueKey:        "OPS-12",
			RoomID:          "room-runtime",
			TopicID:         "topic-runtime",
			ActiveRunID:     "run_runtime_01",
			Status:          "running",
			Provider:        "Codex CLI",
			Branch:          "feat/runtime-continuity",
			Worktree:        "wt-runtime-continuity",
			WorktreePath:    "/tmp/runtime-continuity",
			Summary:         "等待恢复",
			UpdatedAt:       "2026-04-15T00:00:00Z",
			ContinuityReady: false,
			PendingTurn: &store.SessionPendingTurn{
				Provider:       "codex",
				Status:         "interrupted",
				Preview:        "我先接住当前 continuity，已经完成第一段检查。",
				ResumeEligible: true,
			},
		}},
		Agents: []store.Agent{{
			ID:                 "agent-codex-dockmaster",
			Name:               "Codex Dockmaster",
			Role:               "Platform Architect",
			Lane:               "OPS-12",
			ProviderPreference: "codex",
		}},
	}

	prompt := buildRoomExecPrompt(snapshot, "room-runtime", "codex", "继续刚才中断的那一拍。")
	for _, expected := range []string{
		"恢复提醒：",
		"上一次流式执行在公开连接断开后中断",
		"第一段检查",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected interrupted pending-turn prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildRoomExecPromptUsesExplicitRoomWaitForClarificationFollowup(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			Title:    "Runtime Lane",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				Owner: "Codex Dockmaster",
			},
		}},
		Runs: []store.Run{{
			ID:       "run_runtime_01",
			RoomID:   "room-runtime",
			Owner:    "Codex Dockmaster",
			Provider: "Codex CLI",
		}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			Owner:  "Codex Dockmaster",
			State:  "paused",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{{
			ID:                 "agent-codex-dockmaster",
			Name:               "Codex Dockmaster",
			Role:               "Architect",
			Lane:               "OPS-12",
			ProviderPreference: "codex",
		}},
		RoomMessages: map[string][]store.Message{
			"room-runtime": {
				{ID: "msg-clarify", Speaker: "Codex Dockmaster", Role: "agent", Tone: "blocked", Message: "请先确认是否允许我改 billing guard。"},
				{ID: "msg-system", Speaker: "System", Role: "system", Tone: "system", Message: "系统记录：等待人工补充。"},
			},
		},
		RoomAgentWaits: []store.RoomAgentWait{{
			ID:                "room-wait-1",
			RoomID:            "room-runtime",
			AgentID:           "agent-codex-dockmaster",
			Agent:             "Codex Dockmaster",
			BlockingMessageID: "msg-clarify",
			Status:            "waiting_reply",
			CreatedAt:         "2026-04-12T00:00:00Z",
		}},
	}

	agent, wakeupMode, ok := resolveRoomTurnAgent(snapshot, "room-runtime", "可以改，只限当前 guard。")
	if !ok || wakeupMode != "clarification_followup" || agent.Name != "Codex Dockmaster" {
		t.Fatalf("resolveRoomTurnAgent() = (%#v, %q, %v), want Codex clarification followup", agent, wakeupMode, ok)
	}

	prompt := buildRoomExecPrompt(snapshot, "room-runtime", "codex", "可以改，只限当前 guard。")
	for _, expected := range []string{
		"当前触发提醒：",
		"- 你上一轮刚提出过阻塞性澄清，先判断这条新消息是否已经补齐关键信息。",
		"- 如果阻塞已解除，不要重复原问题，直接继续推进。",
		"- 本轮请以 Codex Dockmaster 的身份回应，不要替多个智能体同时发言。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected explicit room wait prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildRoomExecPromptIncludesMentionResponseHint(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			Title:    "Runtime Lane",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				Owner: "Codex Dockmaster",
			},
		}},
		Runs: []store.Run{{
			ID:       "run_runtime_01",
			RoomID:   "room-runtime",
			Owner:    "Codex Dockmaster",
			Provider: "Codex CLI",
		}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			Owner:  "Codex Dockmaster",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{
			{
				ID:                 "agent-codex-dockmaster",
				Name:               "Codex Dockmaster",
				Role:               "Architect",
				Lane:               "OPS-12",
				ProviderPreference: "codex",
			},
			{
				ID:                 "agent-claude-review-runner",
				Name:               "Claude Review Runner",
				Role:               "Review Runner",
				Lane:               "OPS-19",
				ProviderPreference: "claude",
			},
		},
	}

	prompt := buildRoomExecPrompt(snapshot, "room-runtime", "claude", "@agent-claude-review-runner 帮我继续复核恢复链路。")
	for _, expected := range []string{
		"- 当前接手：Codex Dockmaster | role=Architect | lane=OPS-12 | provider=codex",
		"- 本轮响应：Claude Review Runner | role=Review Runner | lane=OPS-19 | provider=claude",
		"当前触发提醒：",
		"- 这条消息明确点名了 Claude Review Runner，默认由他直接回应。",
		"- 被点名不等于自动接手；只有准备继续负责后续工作时，才显式 CLAIM: take。",
		"- 如果只是被点名答一句，不要顺手写成长段接手宣言。",
		"- 本轮请以 Claude Review Runner 的身份回应，不要替多个智能体同时发言。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected mention-response prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildRoomAutoFollowupPromptKeepsReplyShortAndConcrete(t *testing.T) {
	prompt := buildRoomAutoFollowupPrompt("Claude Review Runner", "继续复核恢复链路")

	for _, expected := range []string{
		"你刚刚已经接住当前房间的正式交棒",
		"继续复核恢复链路",
		"Claude Review Runner",
		"用 1 到 2 句给当前判断和下一步",
		"不要重复“我已接手”这类铺垫",
		"这轮不要继续转交别人",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected auto followup prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
	if strings.Contains(prompt, "先自然说明你已接手") {
		t.Fatalf("auto followup prompt should avoid repeated ownership narration, got:\n%s", prompt)
	}
}

func TestResolveRoomExecProviderPrefersCurrentOwnerAgent(t *testing.T) {
	state := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				Owner: "Claude Review Runner",
			},
		}},
		Runs: []store.Run{{
			ID:     "run_runtime_01",
			RoomID: "room-runtime",
			Owner:  "Claude Review Runner",
		}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			Owner:  "Claude Review Runner",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{
			{
				ID:                 "agent-claude-review-runner",
				Name:               "Claude Review Runner",
				ProviderPreference: "claude",
				RecentRunIDs:       []string{"run_runtime_01"},
			},
			{
				ID:                 "agent-codex-dockmaster",
				Name:               "Codex Dockmaster",
				ProviderPreference: "codex",
			},
		},
		Workspace: store.WorkspaceSnapshot{
			PairedRuntime: "shock-main",
		},
		Runtimes: []store.RuntimeRecord{{
			ID:          "shock-main",
			Machine:     "shock-main",
			State:       "online",
			DetectedCLI: []string{"codex", "claude"},
			Providers: []store.RuntimeProvider{
				{ID: "codex", Label: "Codex CLI", Ready: true},
				{ID: "claude", Label: "Claude", Ready: true},
			},
		}},
	}

	if got := resolveRoomExecProvider(state, "room-runtime", ""); got != "claude" {
		t.Fatalf("resolveRoomExecProvider() = %q, want claude", got)
	}
}

func TestResolveRoomTurnExecProviderPrefersMentionedAgent(t *testing.T) {
	state := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				Owner: "Codex Dockmaster",
			},
		}},
		Runs: []store.Run{{
			ID:     "run_runtime_01",
			RoomID: "room-runtime",
			Owner:  "Codex Dockmaster",
		}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			Owner:  "Codex Dockmaster",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{
			{
				ID:                 "agent-codex-dockmaster",
				Name:               "Codex Dockmaster",
				ProviderPreference: "codex",
			},
			{
				ID:                 "agent-claude-review-runner",
				Name:               "Claude Review Runner",
				ProviderPreference: "claude",
			},
		},
		Workspace: store.WorkspaceSnapshot{
			PairedRuntime: "shock-main",
		},
		Runtimes: []store.RuntimeRecord{{
			ID:          "shock-main",
			Machine:     "shock-main",
			State:       "online",
			DetectedCLI: []string{"codex", "claude"},
			Providers: []store.RuntimeProvider{
				{ID: "codex", Label: "Codex CLI", Ready: true},
				{ID: "claude", Label: "Claude", Ready: true},
			},
		}},
	}

	if got := resolveRoomTurnExecProvider(state, "room-runtime", "", "@agent-claude-review-runner 你来复核。"); got != "claude" {
		t.Fatalf("resolveRoomTurnExecProvider() = %q, want claude for mentioned agent", got)
	}
}

func TestResolveRoomTurnAgentPrefersCurrentOwnerOverStaleRecentRunIDs(t *testing.T) {
	state := store.State{
		Rooms: []store.Room{{
			ID:       "room-runtime",
			IssueKey: "OPS-12",
			RunID:    "run_runtime_01",
			Topic: store.Topic{
				Owner: "青岚策展",
			},
		}},
		Runs: []store.Run{{
			ID:     "run_runtime_01",
			RoomID: "room-runtime",
			Owner:  "青岚策展",
		}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			Owner:  "青岚策展",
			RoomID: "room-runtime",
		}},
		Agents: []store.Agent{
			{
				ID:                 "agent-claude-review-runner",
				Name:               "折光交互",
				ProviderPreference: "claude",
				RecentRunIDs:       []string{"run_runtime_01"},
			},
			{
				ID:                 "agent-memory-clerk",
				Name:               "青岚策展",
				ProviderPreference: "codex",
				RecentRunIDs:       []string{"run_runtime_01"},
			},
		},
	}

	agent, wakeupMode, ok := resolveRoomTurnAgent(state, "room-runtime", "继续把影片资料和验收点收一下。")
	if !ok || wakeupMode != "direct_message" || agent.Name != "青岚策展" {
		t.Fatalf("resolveRoomTurnAgent() = (%#v, %q, %v), want 青岚策展 direct owner", agent, wakeupMode, ok)
	}

	prompt := buildRoomExecPrompt(state, "room-runtime", "codex", "继续把影片资料和验收点收一下。")
	if !strings.Contains(prompt, "- 本轮请以 青岚策展 的身份回应，不要替多个智能体同时发言。") {
		t.Fatalf("expected room prompt to prefer current owner, got:\n%s", prompt)
	}
}

func TestParseRoomResponseDirectivesSupportsReplyEnvelope(t *testing.T) {
	directives := parseRoomResponseDirectives("SEND_PUBLIC_MESSAGE\nKIND: message\nCLAIM: keep\nBODY:\n我先接住这一拍。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核 | 请补最后确认。")
	if directives.ReplyKind != "message" || directives.SuppressReply {
		t.Fatalf("directives = %#v, want message envelope", directives)
	}
	if directives.ClaimMode != "keep" {
		t.Fatalf("claim mode = %q, want keep", directives.ClaimMode)
	}
	if directives.DisplayOutput != "我先接住这一拍。" {
		t.Fatalf("display output = %q, want stripped body", directives.DisplayOutput)
	}
	if directives.Handoff == nil || directives.Handoff.ToAgentID != "agent-claude-review-runner" {
		t.Fatalf("handoff = %#v, want parsed handoff", directives.Handoff)
	}
}

func TestParseRoomResponseDirectivesSupportsNoResponse(t *testing.T) {
	directives := parseRoomResponseDirectives("SEND_PUBLIC_MESSAGE\nKIND: no_response\nBODY:")
	if directives.ReplyKind != "no_response" || !directives.SuppressReply {
		t.Fatalf("directives = %#v, want suppress no_response", directives)
	}
	if directives.DisplayOutput != "" || directives.Handoff != nil {
		t.Fatalf("directives = %#v, want empty visible output", directives)
	}
}

func TestParseRoomResponseDirectivesSupportsCaseInsensitiveEnvelope(t *testing.T) {
	directives := parseRoomResponseDirectives("send_public_message\nkind: SuMmArY\nclaim: TaKe\nbody: 先同步当前结论。")
	if directives.ReplyKind != "summary" || directives.SuppressReply {
		t.Fatalf("directives = %#v, want normalized summary envelope", directives)
	}
	if directives.ClaimMode != "take" {
		t.Fatalf("claim mode = %q, want take", directives.ClaimMode)
	}
	if directives.DisplayOutput != "先同步当前结论。" {
		t.Fatalf("display output = %q, want case-insensitive body parse", directives.DisplayOutput)
	}
}

func TestParseRoomResponseDirectivesStripsInternalProtocolAndToolLeak(t *testing.T) {
	directives := parseRoomResponseDirectives("SEND_PUBLIC_MESSAGE\nKIND: message\nCLAIM: keep\nBODY:\n工具调用：\ngit status\n结果：\n当前工作区干净，我继续推进。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核 | 请补最后确认。")
	if directives.DisplayOutput != "当前工作区干净，我继续推进。" {
		t.Fatalf("display output = %q, want only visible public sentence", directives.DisplayOutput)
	}
}

func TestParseRoomResponseDirectivesCompressesLowSignalOwnershipLead(t *testing.T) {
	directives := parseRoomResponseDirectives("SEND_PUBLIC_MESSAGE\nKIND: message\nCLAIM: take\nBODY:\n我来接这条复核，先把恢复链路和副作用看完，再回写结论。")
	if directives.DisplayOutput != "先把恢复链路和副作用看完，再回写结论。" {
		t.Fatalf("display output = %q, want ownership lead removed", directives.DisplayOutput)
	}
}

func TestParseRoomResponseDirectivesCapsVisibleSentenceBudgetByReplyKind(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		expect string
	}{
		{
			name:   "message",
			input:  "SEND_PUBLIC_MESSAGE\nKIND: message\nBODY:\n先看恢复链路。再补测试。最后回写结论。第四句不用公开。",
			expect: "先看恢复链路。再补测试。最后回写结论。",
		},
		{
			name:   "summary",
			input:  "SEND_PUBLIC_MESSAGE\nKIND: summary\nBODY:\n先同步当前结论。下一步继续复核。第三句不用保留。",
			expect: "先同步当前结论。下一步继续复核。",
		},
		{
			name:   "clarification",
			input:  "SEND_PUBLIC_MESSAGE\nKIND: clarification_request\nBODY:\n请先确认是否允许我改 billing guard？如果允许我就继续。",
			expect: "请先确认是否允许我改 billing guard？",
		},
		{
			name:   "handoff",
			input:  "SEND_PUBLIC_MESSAGE\nKIND: handoff\nBODY:\n@agent-claude-review-runner 你继续复核恢复链路。补完后再同步到房间。",
			expect: "@agent-claude-review-runner 你继续复核恢复链路。",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			directives := parseRoomResponseDirectives(testCase.input)
			if directives.DisplayOutput != testCase.expect {
				t.Fatalf("display output = %q, want %q", directives.DisplayOutput, testCase.expect)
			}
		})
	}
}

func TestBuildChannelExecPromptConstrainsScopeAndPublicSurface(t *testing.T) {
	snapshot := store.State{
		Channels: []store.Channel{{
			ID:   "all",
			Name: "#all",
		}},
		ChannelMessages: map[string][]store.Message{
			"all": {
				{Speaker: "Larkspur", Role: "human", Message: "@agent-codex-dockmaster 帮我同步一下当前进展。"},
			},
		},
	}

	prompt := buildChannelExecPrompt(snapshot, "all", "codex", "同步一下现在做到哪了。")

	for _, expected := range []string{
		"你正在 OpenShock 的频道里发一条公开消息。",
		"- 频道：#all (all)",
		"- Provider：codex",
		"- 默认只基于当前频道上下文和这次触发消息判断，不要为了凑回复去扩散查其他频道、讨论间或智能体上下文。",
		"- 只有用户明确要求，或你必须在公开消息里同步跨范围核对结果时，才扩大判断范围。",
		"- 如果这轮不需要公屏回复，就返回 SEND_PUBLIC_MESSAGE，KIND: no_response，BODY 留空。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected channel prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildChannelExecPromptIncludesPublicValueAndReadBoundary(t *testing.T) {
	snapshot := store.State{
		Channels: []store.Channel{{
			ID:   "all",
			Name: "#all",
		}},
		ChannelMessages: map[string][]store.Message{
			"all": {
				{Speaker: "Larkspur", Role: "human", Message: "先看下当前状态。"},
				{Speaker: "Codex Dockmaster", Role: "agent", Message: "我先同步一个简短结论。"},
			},
		},
	}

	prompt := buildChannelExecPrompt(snapshot, "all", "codex", "继续同步当前结果")

	for _, expected := range []string{
		"你正在 OpenShock 的频道里发一条公开消息。",
		"频道只展示对团队当前会话有价值的有效信息，不展示你的内部执行过程。",
		"- 频道：#all (all)",
		"- Provider：codex",
		"- Larkspur[human]: 先看下当前状态。",
		"- Codex Dockmaster[agent]: 我先同步一个简短结论。",
		"读取边界：",
		"- 频道回复默认只基于当前频道会话和这次触发消息判断，不主动扩展到别的 room、别的 issue 或别的智能体上下文。",
		"- 如果没有新增判断、结论、唯一阻塞问题或下一步动作，就不要为了刷存在感发公屏消息。",
		"- 只有会话里对别人有用的当前判断、简短结论、唯一阻塞问题，才值得发到公屏。",
		"- 不要公开暴露工具调用、命令、函数参数、内部协议、思考过程、旁白或自我解释。",
		"KIND: message | summary | clarification_request | no_response",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected channel prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildRoomAutoFollowupPromptPrefersSilentContinuation(t *testing.T) {
	prompt := buildRoomAutoFollowupPrompt("Claude Review Runner", "继续复核恢复链路")

	for _, expected := range []string{
		"你刚刚已经接住当前房间的正式交棒",
		"默认继续沿当前 room / run / worktree 内部推进",
		"如果只是内部继续执行，优先返回 KIND: no_response。",
		"用 1 到 2 句给当前判断和下一步，不要重复“我已接手”这类铺垫。",
		"请直接以 Claude Review Runner 的身份继续推进。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected auto followup prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestInferRoomHandoffDirectiveFromVisibleBody(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{ID: "room-runtime", IssueKey: "OPS-12", RunID: "run_runtime_01"}},
		Runs:  []store.Run{{ID: "run_runtime_01", RoomID: "room-runtime", Owner: "Codex Dockmaster"}},
		Issues: []store.Issue{{
			Key:    "OPS-12",
			RoomID: "room-runtime",
			Owner:  "Codex Dockmaster",
		}},
		Agents: []store.Agent{
			{ID: "agent-codex-dockmaster", Name: "Codex Dockmaster"},
			{ID: "agent-claude-review-runner", Name: "Claude Review Runner"},
		},
	}

	directive, ok := inferRoomHandoffDirective(snapshot, "room-runtime", "@agent-claude-review-runner 你接着复核恢复链路和副作用。")
	if !ok {
		t.Fatalf("inferRoomHandoffDirective() = false, want true")
	}
	if directive.ToAgentID != "agent-claude-review-runner" {
		t.Fatalf("directive = %#v, want target agent", directive)
	}
	if !strings.Contains(directive.Summary, "复核恢复链路") || strings.Contains(directive.Summary, "@agent-claude-review-runner") {
		t.Fatalf("directive = %#v, want cleaned summary", directive)
	}
}
