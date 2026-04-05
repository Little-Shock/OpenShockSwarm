package store

import "time"

func seedState() State {
	now := time.Now().UTC().Format(time.RFC3339)
	return State{
		Workspace: WorkspaceSnapshot{
			Name:              "OpenShock 作战台",
			Repo:              "Larkspur-Wang/OpenShock",
			RepoURL:           "https://github.com/Larkspur-Wang/OpenShock",
			Branch:            "main",
			RepoProvider:      "github",
			RepoBindingStatus: "bound",
			RepoAuthMode:      "local-git-origin",
			Plan:              "Builder P0",
			PairedRuntime:     "shock-main",
			PairedRuntimeURL:  "http://127.0.0.1:8090",
			PairingStatus:     "paired",
			DeviceAuth:        "browser-approved",
			LastPairedAt:      now,
			BrowserPush:       "只推高优先级",
			MemoryMode:        "MEMORY.md + notes/ + decisions/",
		},
		Channels: []Channel{
			{ID: "all", Name: "#all", Summary: "轻松聊天、公屏唠嗑、快速交接都在这里。", Unread: 5, Purpose: "这是全局闲聊频道，所有轻量讨论先落在这里，不在这里直接干活。"},
			{ID: "roadmap", Name: "#roadmap", Summary: "路线、优先级、产品分歧和排期讨论都在这里。", Unread: 2, Purpose: "路线图先在这里吵清楚，确认后再升级成真正的讨论间。"},
			{ID: "announcements", Name: "#announcements", Summary: "版本、Runtime 变化和制度公告，尽量低噪音。", Unread: 0, Purpose: "这里只做广播，不让讨论蔓延成新的上下文黑洞。"},
		},
		ChannelMessages: map[string][]Message{
			"all": {
				{ID: "msg-all-1", Speaker: "Mina", Role: "human", Tone: "human", Message: "前台一定要轻。频道就是频道，严肃工作一律升级成讨论间。", Time: "09:12"},
				{ID: "msg-all-2", Speaker: "Codex Dockmaster", Role: "agent", Tone: "agent", Message: "Runtime 在线状态已经同步。下一步是把真实 Run 和审批链路拉进前台。", Time: "09:16"},
				{ID: "msg-all-3", Speaker: "System", Role: "system", Tone: "system", Message: "OPS-12 已经升级成讨论间，因为它开始涉及 runtime、branch 和 PR 收口。", Time: "09:17"},
			},
			"roadmap": {
				{ID: "msg-roadmap-1", Speaker: "Longwen", Role: "human", Tone: "human", Message: "默认入口必须聊天优先。任务板只能是辅助视图，不许反客为主。", Time: "10:04"},
				{ID: "msg-roadmap-2", Speaker: "Claude Review Runner", Role: "agent", Tone: "agent", Message: "Inbox 现在更像决策驾驶舱，不像一个冷冰冰的告警后台了。", Time: "10:07"},
			},
			"announcements": {
				{ID: "msg-ann-1", Speaker: "System", Role: "system", Tone: "system", Message: "Phase 0 主壳已经就位。下一步是把真实状态流和房间执行链路接通。", Time: "11:02"},
			},
		},
		Issues: []Issue{
			{ID: "issue-runtime", Key: "OPS-12", Title: "打通 runtime 心跳与机器在线状态", Summary: "把 runtime 状态、最近 heartbeat 和本机 CLI 执行能力真实带进壳层和讨论间。", State: "running", Priority: "critical", Owner: "Codex Dockmaster", RoomID: "room-runtime", RunID: "run_runtime_01", PullRequest: "PR #18", Checklist: []string{"左下角展示机器在线 / 忙碌 / 离线", "Run 详情必须带出 branch 和 worktree", "approval_required 必须对人类可见"}},
			{ID: "issue-inbox", Key: "OPS-19", Title: "把 Inbox 做成人类决策中心", Summary: "把 blocked、approval、review 三类事件统一成一个人类干预面板。", State: "review", Priority: "high", Owner: "Claude Review Runner", RoomID: "room-inbox", RunID: "run_inbox_01", PullRequest: "PR #22", Checklist: []string{"按事件类型统一卡片语气和动作文案", "每张卡都能直接回到房间或 Run", "浏览器 Push 只给高优先级事件"}},
			{ID: "issue-memory", Key: "OPS-27", Title: "落地文件级记忆写回", Summary: "把 run 摘要写回 MEMORY.md、notes/、decisions/，但不提前引入沉重的 memory OS。", State: "blocked", Priority: "high", Owner: "Memory Clerk", RoomID: "room-memory", RunID: "run_memory_01", PullRequest: "草稿 PR", Checklist: []string{"把 Run 摘要写入 MEMORY.md", "策略冲突必须经由 Inbox 升级，而不是静默覆盖", "房间笔记必须保持人类可检查"}},
		},
		Rooms: []Room{
			{ID: "room-runtime", IssueKey: "OPS-12", Title: "Runtime 讨论间", Unread: 3, Summary: "把 runtime 状态、活跃 Run 和人类干预都收进一个讨论间。", BoardCount: 4, RunID: "run_runtime_01", MessageIDs: []string{"msg-room-1", "msg-room-2", "msg-room-3"}, Topic: Topic{ID: "topic-runtime", Title: "把 runtime 卡片和 Run 元信息接进前端", Status: "running", Owner: "Codex Dockmaster", Summary: "壳层正在推进中。Agent 正在把机器在线状态、branch 和 Run 详情接进前端。"}},
			{ID: "room-inbox", IssueKey: "OPS-19", Title: "Inbox 讨论间", Unread: 1, Summary: "把 blocked、approval 和 review 三种提示统一收进一个人类决策面。", BoardCount: 3, RunID: "run_inbox_01", MessageIDs: []string{"msg-room-4", "msg-room-5"}, Topic: Topic{ID: "topic-inbox", Title: "收紧审批卡片与升级文案", Status: "review", Owner: "Claude Review Runner", Summary: "文案已经准备好，正在等产品确认后合并。"}},
			{ID: "room-memory", IssueKey: "OPS-27", Title: "记忆写回讨论间", Unread: 4, Summary: "让 MEMORY.md 和 decisions/ 真正可用，但不假装我们已经有完整 memory OS。", BoardCount: 2, RunID: "run_memory_01", MessageIDs: []string{"msg-room-6", "msg-room-7"}, Topic: Topic{ID: "topic-memory", Title: "解决写回策略冲突", Status: "blocked", Owner: "Memory Clerk", Summary: "Agent 在写回房间笔记前，需要一个正式的优先级规则。"}},
		},
		RoomMessages: map[string][]Message{
			"room-runtime": {
				{ID: "msg-room-1", Speaker: "Codex Dockmaster", Role: "agent", Tone: "agent", Message: "左下角状态区已经接上，下一步把 Run 详情和机器 heartbeat 带进房间。", Time: "09:20"},
				{ID: "msg-room-2", Speaker: "Longwen", Role: "human", Tone: "human", Message: "机器和 Agent 的状态必须常驻可见，它们不是设置项，而是协作者。", Time: "09:23"},
				{ID: "msg-room-3", Speaker: "System", Role: "system", Tone: "system", Message: "run_runtime_01 已经在 shock-main 上进入实时执行。", Time: "09:26"},
			},
			"room-inbox": {
				{ID: "msg-room-4", Speaker: "Claude Review Runner", Role: "agent", Tone: "agent", Message: "审批卡片现在都会回到房间和 Run，不再掉进孤立的弹窗里。", Time: "10:01"},
				{ID: "msg-room-5", Speaker: "Mina", Role: "human", Tone: "human", Message: "动作文案要冷静，不要官僚化，更不能像告警系统在尖叫。", Time: "10:08"},
			},
			"room-memory": {
				{ID: "msg-room-6", Speaker: "Memory Clerk", Role: "agent", Tone: "blocked", Message: "我已经定位到冲突源，但现在缺少记忆优先级规则，不能继续写回。", Time: "10:30"},
				{ID: "msg-room-7", Speaker: "System", Role: "system", Tone: "system", Message: "已经把阻塞事件升级到 Inbox，等待人类确定优先级。", Time: "10:33"},
			},
		},
		Runs: []Run{
			{ID: "run_runtime_01", IssueKey: "OPS-12", RoomID: "room-runtime", TopicID: "topic-runtime", Status: "running", Runtime: "shock-main", Machine: "shock-main", Provider: "Codex CLI", Branch: "feat/runtime-state-shell", Worktree: "wt-runtime-shell", WorktreePath: "", Owner: "Codex Dockmaster", StartedAt: "09:18", Duration: "42m", Summary: "把 runtime 状态、heartbeat、branch 和 approval_required 都接进讨论间。", ApprovalRequired: true, Stdout: []string{"[09:18:02] 已连接 runtime 心跳", "[09:24:10] 已写入房间右侧上下文面板", "[09:31:40] 等待 destructive git cleanup 授权"}, Stderr: []string{}, ToolCalls: []ToolCall{{ID: "tool-1", Tool: "codex", Summary: "重构房间上下文与状态壳", Result: "成功"}}, Timeline: []RunEvent{{ID: "ev-1", Label: "Run 已启动", At: "09:18", Tone: "yellow"}, {ID: "ev-2", Label: "Heartbeat 已接通", At: "09:24", Tone: "lime"}, {ID: "ev-3", Label: "等待授权", At: "09:31", Tone: "paper"}}, NextAction: "等待人类确认 destructive git cleanup。", PullRequest: "PR #18"},
			{ID: "run_inbox_01", IssueKey: "OPS-19", RoomID: "room-inbox", TopicID: "topic-inbox", Status: "review", Runtime: "shock-sidecar", Machine: "shock-sidecar", Provider: "Claude Code CLI", Branch: "feat/inbox-decision-cards", Worktree: "wt-inbox-cards", WorktreePath: "", Owner: "Claude Review Runner", StartedAt: "09:58", Duration: "18m", Summary: "把批准、阻塞和评审卡片收成一个人类决策收件箱。", ApprovalRequired: false, Stdout: []string{"[09:58:03] 已打开讨论间上下文", "[10:01:14] 已重写批准卡片语气", "[10:06:48] 已把 Inbox 卡片接到 Run 详情和房间视图", "[10:12:30] 等待产品文案核对"}, Stderr: []string{}, ToolCalls: []ToolCall{{ID: "tool-3", Tool: "claude-code", Summary: "重写 Inbox 卡片文案层级", Result: "成功"}}, Timeline: []RunEvent{{ID: "ev-5", Label: "Run 已启动", At: "09:58", Tone: "yellow"}, {ID: "ev-6", Label: "房间跳转已接通", At: "10:06", Tone: "lime"}, {ID: "ev-7", Label: "已发起评审", At: "10:12", Tone: "paper"}}, NextAction: "等待人类确认语气与通知默认值。", PullRequest: "PR #22"},
			{ID: "run_memory_01", IssueKey: "OPS-27", RoomID: "room-memory", TopicID: "topic-memory", Status: "blocked", Runtime: "shock-main", Machine: "shock-main", Provider: "Codex CLI", Branch: "feat/memory-writeback", Worktree: "wt-memory-writeback", WorktreePath: "", Owner: "Memory Clerk", StartedAt: "10:27", Duration: "11m", Summary: "把 Run 摘要写回 MEMORY.md，同时保留可检查的房间上下文。", ApprovalRequired: true, Stdout: []string{"[10:27:02] 已打开 MEMORY.md", "[10:30:44] 已收集房间笔记和用户记忆范围", "[10:31:10] 发现房间笔记与用户笔记优先级冲突"}, Stderr: []string{"[10:31:11] 写回已暂停：缺少房间与用户优先级策略"}, ToolCalls: []ToolCall{{ID: "tool-4", Tool: "codex", Summary: "尝试为 MEMORY.md 规划写回策略", Result: "阻塞"}}, Timeline: []RunEvent{{ID: "ev-8", Label: "Run 已启动", At: "10:27", Tone: "yellow"}, {ID: "ev-9", Label: "检测到冲突", At: "10:31", Tone: "pink"}, {ID: "ev-10", Label: "已创建 Inbox 升级项", At: "10:33", Tone: "paper"}}, NextAction: "先定优先级规则，再恢复写回。", PullRequest: "草稿 PR"},
		},
		Agents: []Agent{
			{ID: "agent-codex-dockmaster", Name: "Codex Dockmaster", Description: "负责壳层基础设施、runtime 状态，以及执行真相的前台可见性。", Mood: "正在接 runtime 卡片", State: "running", Lane: "OPS-12", Provider: "Codex CLI", RuntimePreference: "shock-main", MemorySpaces: []string{"workspace", "issue-room", "topic"}, RecentRunIDs: []string{"run_runtime_01"}},
			{ID: "agent-claude-review-runner", Name: "Claude Review Runner", Description: "负责语气、评审清晰度和 Inbox 的可读性。", Mood: "等待产品核对", State: "idle", Lane: "OPS-19", Provider: "Claude Code CLI", RuntimePreference: "shock-sidecar", MemorySpaces: []string{"workspace", "issue-room"}, RecentRunIDs: []string{"run_inbox_01"}},
			{ID: "agent-memory-clerk", Name: "Memory Clerk", Description: "维护文件级记忆的可追踪、可检查和可恢复。", Mood: "等待策略输入", State: "blocked", Lane: "OPS-27", Provider: "Codex CLI", RuntimePreference: "shock-main", MemorySpaces: []string{"workspace", "user", "room-notes"}, RecentRunIDs: []string{"run_memory_01"}},
		},
		Machines: []Machine{
			{ID: "machine-main", Name: "shock-main", State: "busy", CLI: "Codex + Claude Code", OS: "Windows 11", LastHeartbeat: "8 秒前"},
			{ID: "machine-sidecar", Name: "shock-sidecar", State: "online", CLI: "Codex", OS: "macOS", LastHeartbeat: "21 秒前"},
		},
		Inbox: []InboxItem{
			{ID: "inbox-approval-runtime", Title: "破坏性 Git 清理需要批准", Kind: "approval", Room: "Runtime 讨论间", Time: "2 分钟前", Summary: "这个 Run 想在视觉核对通过后清理过时分支。", Action: "查看批准", Href: "/rooms/room-runtime/runs/run_runtime_01"},
			{ID: "inbox-blocked-memory", Title: "Memory Clerk 被记忆优先级阻塞", Kind: "blocked", Room: "记忆写回讨论间", Time: "7 分钟前", Summary: "写回前需要先确定 topic、房间、工作区、用户和 agent 的优先级规则。", Action: "解除阻塞", Href: "/rooms/room-memory/runs/run_memory_01"},
			{ID: "inbox-review-copy", Title: "Inbox 决策中心已经可以评审", Kind: "review", Room: "Inbox 讨论间", Time: "12 分钟前", Summary: "Agent 已经准备好最终卡片文案和路由跳转。", Action: "打开评审", Href: "/rooms/room-inbox/runs/run_inbox_01"},
			{ID: "inbox-status-shell", Title: "Runtime lane 完成第一轮壳层接线", Kind: "status", Room: "Runtime 讨论间", Time: "18 分钟前", Summary: "机器状态和 Run 元数据已经在主壳里可见。", Action: "打开房间", Href: "/rooms/room-runtime"},
		},
		PullRequests: []PullRequest{
			{ID: "pr-runtime-18", Number: 18, Label: "PR #18", Title: "runtime: surface heartbeat and lane state in discussion room", Status: "in_review", IssueKey: "OPS-12", RoomID: "room-runtime", RunID: "run_runtime_01", Branch: "feat/runtime-state-shell", Author: "Codex Dockmaster", ReviewSummary: "等待产品确认 destructive git cleanup 的审批边界。", UpdatedAt: "2 分钟前"},
			{ID: "pr-inbox-22", Number: 22, Label: "PR #22", Title: "inbox: unify approval, blocked, and review cards", Status: "in_review", IssueKey: "OPS-19", RoomID: "room-inbox", RunID: "run_inbox_01", Branch: "feat/inbox-decision-cards", Author: "Claude Review Runner", ReviewSummary: "等待人类确认卡片语气和默认动作。", UpdatedAt: "12 分钟前"},
			{ID: "pr-memory-draft", Number: 27, Label: "草稿 PR", Title: "memory: write run summary back to MEMORY.md", Status: "draft", IssueKey: "OPS-27", RoomID: "room-memory", RunID: "run_memory_01", Branch: "feat/memory-writeback", Author: "Memory Clerk", ReviewSummary: "等待记忆优先级规则敲定后再进入评审。", UpdatedAt: "7 分钟前"},
		},
		Sessions: []Session{
			{ID: "session-runtime", IssueKey: "OPS-12", RoomID: "room-runtime", TopicID: "topic-runtime", ActiveRunID: "run_runtime_01", Status: "running", Runtime: "shock-main", Machine: "shock-main", Provider: "Codex CLI", Branch: "feat/runtime-state-shell", Worktree: "wt-runtime-shell", WorktreePath: "", Summary: "Runtime 讨论间的持续执行上下文。", UpdatedAt: now, MemoryPaths: []string{"MEMORY.md", "notes/work-log.md", "notes/rooms/room-runtime.md"}},
			{ID: "session-inbox", IssueKey: "OPS-19", RoomID: "room-inbox", TopicID: "topic-inbox", ActiveRunID: "run_inbox_01", Status: "review", Runtime: "shock-sidecar", Machine: "shock-sidecar", Provider: "Claude Code CLI", Branch: "feat/inbox-decision-cards", Worktree: "wt-inbox-cards", WorktreePath: "", Summary: "Inbox 讨论间的评审上下文。", UpdatedAt: now, MemoryPaths: []string{"MEMORY.md", "notes/work-log.md", "notes/rooms/room-inbox.md"}},
			{ID: "session-memory", IssueKey: "OPS-27", RoomID: "room-memory", TopicID: "topic-memory", ActiveRunID: "run_memory_01", Status: "blocked", Runtime: "shock-main", Machine: "shock-main", Provider: "Codex CLI", Branch: "feat/memory-writeback", Worktree: "wt-memory-writeback", WorktreePath: "", Summary: "记忆写回冲突上下文。", UpdatedAt: now, MemoryPaths: []string{"MEMORY.md", "notes/work-log.md", "notes/rooms/room-memory.md"}},
		},
		Memory: []MemoryArtifact{},
	}
}
