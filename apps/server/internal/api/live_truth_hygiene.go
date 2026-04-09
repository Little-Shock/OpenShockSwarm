package api

import (
	"regexp"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

var (
	liveTruthQuestionBurstPattern = regexp.MustCompile(`\?{2,}`)
	liveTruthE2EResiduePattern    = regexp.MustCompile(`(?i)\be2e\b.*\b20\d{6,}\b`)
	liveTruthPlaceholderPattern   = regexp.MustCompile(`(?i)\bplaceholder\b|\bfixture\b|\btest-only\b`)
	liveTruthMockPattern          = regexp.MustCompile(`本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace`)
	liveTruthPathPattern          = regexp.MustCompile(`[A-Za-z]:\\|/tmp/openshock|/home/lark/OpenShock|\.openshock-worktrees|\.slock/`)
)

func sanitizeLivePayload(payload any) any {
	switch typed := payload.(type) {
	case store.State:
		return sanitizeLiveState(typed)
	case store.RoomDetail:
		return sanitizeRoomDetail(typed)
	case store.PullRequestDetail:
		return sanitizePullRequestDetail(typed)
	case store.Channel:
		return sanitizeChannel(typed)
	case []store.Channel:
		items := make([]store.Channel, len(typed))
		for index, item := range typed {
			items[index] = sanitizeChannel(item)
		}
		return items
	case store.Message:
		return sanitizeMessage(typed)
	case []store.Message:
		items := make([]store.Message, len(typed))
		for index, item := range typed {
			items[index] = sanitizeMessage(item)
		}
		return items
	case store.Issue:
		return sanitizeIssue(typed)
	case []store.Issue:
		items := make([]store.Issue, len(typed))
		for index, item := range typed {
			items[index] = sanitizeIssue(item)
		}
		return items
	case store.Room:
		return sanitizeRoom(typed)
	case []store.Room:
		items := make([]store.Room, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRoom(item)
		}
		return items
	case store.Run:
		return sanitizeRun(typed)
	case []store.Run:
		items := make([]store.Run, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRun(item)
		}
		return items
	case store.Agent:
		return sanitizeAgent(typed)
	case []store.Agent:
		items := make([]store.Agent, len(typed))
		for index, item := range typed {
			items[index] = sanitizeAgent(item)
		}
		return items
	case store.RuntimeRecord:
		return sanitizeRuntimeRecord(typed)
	case []store.RuntimeRecord:
		items := make([]store.RuntimeRecord, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRuntimeRecord(item)
		}
		return items
	case store.InboxItem:
		return sanitizeInboxItem(typed)
	case []store.InboxItem:
		items := make([]store.InboxItem, len(typed))
		for index, item := range typed {
			items[index] = sanitizeInboxItem(item)
		}
		return items
	case store.RuntimeLease:
		return sanitizeRuntimeLease(typed)
	case []store.RuntimeLease:
		items := make([]store.RuntimeLease, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRuntimeLease(item)
		}
		return items
	case store.PullRequest:
		return sanitizePullRequest(typed)
	case store.PullRequestConversationEntry:
		return sanitizePullRequestConversationEntry(typed)
	case []store.PullRequest:
		items := make([]store.PullRequest, len(typed))
		for index, item := range typed {
			items[index] = sanitizePullRequest(item)
		}
		return items
	case []store.PullRequestConversationEntry:
		items := make([]store.PullRequestConversationEntry, len(typed))
		for index, item := range typed {
			items[index] = sanitizePullRequestConversationEntry(item)
		}
		return items
	case store.Session:
		return sanitizeSession(typed)
	case []store.Session:
		items := make([]store.Session, len(typed))
		for index, item := range typed {
			items[index] = sanitizeSession(item)
		}
		return items
	case store.MemoryArtifact:
		return sanitizeMemoryArtifact(typed)
	case []store.MemoryArtifact:
		items := make([]store.MemoryArtifact, len(typed))
		for index, item := range typed {
			items[index] = sanitizeMemoryArtifact(item)
		}
		return items
	case store.MemoryArtifactVersion:
		return sanitizeMemoryArtifactVersion(typed)
	case []store.MemoryArtifactVersion:
		items := make([]store.MemoryArtifactVersion, len(typed))
		for index, item := range typed {
			items[index] = sanitizeMemoryArtifactVersion(item)
		}
		return items
	case map[string][]store.Message:
		items := make(map[string][]store.Message, len(typed))
		for key, value := range typed {
			items[key] = sanitizeLivePayload(value).([]store.Message)
		}
		return items
	case map[string][]store.MemoryArtifactVersion:
		items := make(map[string][]store.MemoryArtifactVersion, len(typed))
		for key, value := range typed {
			items[key] = sanitizeLivePayload(value).([]store.MemoryArtifactVersion)
		}
		return items
	case map[string]any:
		items := make(map[string]any, len(typed))
		for key, value := range typed {
			items[key] = sanitizeLivePayload(value)
		}
		return items
	case []any:
		items := make([]any, len(typed))
		for index, value := range typed {
			items[index] = sanitizeLivePayload(value)
		}
		return items
	default:
		return payload
	}
}

func sanitizeLiveState(snapshot store.State) store.State {
	snapshot.Workspace = sanitizeWorkspace(snapshot.Workspace)
	snapshot.Channels = sanitizeLivePayload(snapshot.Channels).([]store.Channel)
	snapshot.ChannelMessages = sanitizeLivePayload(snapshot.ChannelMessages).(map[string][]store.Message)
	snapshot.Issues = sanitizeLivePayload(snapshot.Issues).([]store.Issue)
	snapshot.Rooms = sanitizeLivePayload(snapshot.Rooms).([]store.Room)
	snapshot.RoomMessages = sanitizeLivePayload(snapshot.RoomMessages).(map[string][]store.Message)
	snapshot.Runs = sanitizeLivePayload(snapshot.Runs).([]store.Run)
	snapshot.Agents = sanitizeLivePayload(snapshot.Agents).([]store.Agent)
	snapshot.Runtimes = sanitizeLivePayload(snapshot.Runtimes).([]store.RuntimeRecord)
	snapshot.Inbox = sanitizeLivePayload(snapshot.Inbox).([]store.InboxItem)
	snapshot.PullRequests = sanitizeLivePayload(snapshot.PullRequests).([]store.PullRequest)
	snapshot.Sessions = sanitizeLivePayload(snapshot.Sessions).([]store.Session)
	snapshot.RuntimeLeases = sanitizeLivePayload(snapshot.RuntimeLeases).([]store.RuntimeLease)
	snapshot.Memory = sanitizeLivePayload(snapshot.Memory).([]store.MemoryArtifact)
	snapshot.MemoryVersions = sanitizeLivePayload(snapshot.MemoryVersions).(map[string][]store.MemoryArtifactVersion)
	return snapshot
}

func sanitizeWorkspace(workspace store.WorkspaceSnapshot) store.WorkspaceSnapshot {
	workspace.Name = sanitizeDisplayText(workspace.Name, "当前工作区名称正在整理中。")
	workspace.Repo = sanitizeDisplayText(workspace.Repo, "当前仓库真值正在整理中。")
	workspace.RepoURL = sanitizeDisplayText(workspace.RepoURL, "")
	workspace.Branch = sanitizeDisplayText(workspace.Branch, "待整理分支")
	workspace.RepoProvider = sanitizeDisplayText(workspace.RepoProvider, "待整理仓库提供方")
	workspace.RepoBindingStatus = sanitizeDisplayText(workspace.RepoBindingStatus, "当前绑定状态正在整理中。")
	workspace.RepoAuthMode = sanitizeDisplayText(workspace.RepoAuthMode, "当前认证模式正在整理中。")
	workspace.Plan = sanitizeDisplayText(workspace.Plan, "当前工作区计划正在整理中。")
	workspace.PairedRuntime = sanitizeDisplayText(workspace.PairedRuntime, "当前 runtime 真值正在整理中。")
	workspace.PairedRuntimeURL = sanitizeDisplayText(workspace.PairedRuntimeURL, "")
	workspace.PairingStatus = sanitizeDisplayText(workspace.PairingStatus, "当前配对状态正在整理中。")
	workspace.DeviceAuth = sanitizeDisplayText(workspace.DeviceAuth, "当前设备认证状态正在整理中。")
	workspace.BrowserPush = sanitizeDisplayText(workspace.BrowserPush, "当前浏览器推送策略正在整理中。")
	workspace.MemoryMode = sanitizeDisplayText(workspace.MemoryMode, "当前记忆模式正在整理中。")
	return workspace
}

func sanitizeRoomDetail(detail store.RoomDetail) store.RoomDetail {
	detail.Room = sanitizeRoom(detail.Room)
	detail.Messages = sanitizeLivePayload(detail.Messages).([]store.Message)
	return detail
}

func sanitizePullRequestDetail(detail store.PullRequestDetail) store.PullRequestDetail {
	detail.PullRequest = sanitizePullRequest(detail.PullRequest)
	detail.Room = sanitizeRoom(detail.Room)
	detail.Run = sanitizeRun(detail.Run)
	detail.Issue = sanitizeIssue(detail.Issue)
	detail.Conversation = sanitizeLivePayload(detail.Conversation).([]store.PullRequestConversationEntry)
	detail.RelatedInbox = sanitizeLivePayload(detail.RelatedInbox).([]store.InboxItem)
	return detail
}

func sanitizeChannel(channel store.Channel) store.Channel {
	channel.Summary = sanitizeDisplayText(channel.Summary, "当前频道摘要正在整理中。")
	channel.Purpose = sanitizeDisplayText(channel.Purpose, "当前频道说明正在整理中。")
	return channel
}

func sanitizeMessage(message store.Message) store.Message {
	message.Message = sanitizeDisplayText(message.Message, "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。")
	message.Speaker = sanitizeDisplayText(message.Speaker, fallbackSpeaker(message.Role))
	return message
}

func sanitizeIssue(issue store.Issue) store.Issue {
	issue.Title = sanitizeDisplayText(issue.Title, "待整理任务")
	issue.Summary = sanitizeDisplayText(issue.Summary, "这条任务的上下文正在整理，先回到讨论间查看当前 live truth。")
	return issue
}

func sanitizeRoom(room store.Room) store.Room {
	room.Title = sanitizeDisplayText(room.Title, "待整理讨论间")
	room.Summary = sanitizeDisplayText(room.Summary, "当前讨论间的标题和摘要正在整理，先查看最新执行真相。")
	room.Topic = sanitizeTopic(room.Topic)
	return room
}

func sanitizeTopic(topic store.Topic) store.Topic {
	topic.Title = sanitizeDisplayText(topic.Title, "待整理 Topic")
	topic.Summary = sanitizeDisplayText(topic.Summary, "当前 Topic 的摘要正在整理中。")
	return topic
}

func sanitizeRun(run store.Run) store.Run {
	run.Branch = sanitizeDisplayText(run.Branch, "待整理分支")
	run.Worktree = sanitizeDisplayText(run.Worktree, "当前 worktree 名称正在整理中。")
	run.WorktreePath = sanitizeDisplayText(run.WorktreePath, "当前 worktree 路径正在整理中。")
	run.Summary = sanitizeDisplayText(run.Summary, "当前 Run 正在整理执行摘要。")
	run.NextAction = sanitizeDisplayText(run.NextAction, "等待当前执行真相同步。")
	run.PullRequest = sanitizeDisplayText(run.PullRequest, "待整理 PR")
	run.Stdout = sanitizeTextLines(run.Stdout, "这条执行日志包含测试残留或乱码，已在当前工作区隐藏。")
	run.Stderr = sanitizeTextLines(run.Stderr, "这条执行日志包含测试残留或乱码，已在当前工作区隐藏。")
	for index := range run.ToolCalls {
		run.ToolCalls[index].Summary = sanitizeDisplayText(run.ToolCalls[index].Summary, "当前工具调用摘要正在整理中。")
		run.ToolCalls[index].Result = sanitizeDisplayText(run.ToolCalls[index].Result, "当前工具调用结果正在整理中。")
	}
	for index := range run.Timeline {
		run.Timeline[index].Label = sanitizeDisplayText(run.Timeline[index].Label, "当前时间线事件正在整理中。")
	}
	return run
}

func sanitizeAgent(agent store.Agent) store.Agent {
	agent.Description = sanitizeDisplayText(agent.Description, "当前 Agent 摘要正在整理中。")
	agent.Lane = sanitizeDisplayText(agent.Lane, "待整理泳道")
	return agent
}

func sanitizeRuntimeRecord(record store.RuntimeRecord) store.RuntimeRecord {
	record.WorkspaceRoot = sanitizeDisplayText(record.WorkspaceRoot, "当前 runtime 工作区路径已隐藏。")
	return record
}

func sanitizeInboxItem(item store.InboxItem) store.InboxItem {
	item.Title = sanitizeDisplayText(item.Title, "待整理信号")
	item.Room = sanitizeDisplayText(item.Room, "待整理讨论间")
	item.Summary = sanitizeDisplayText(item.Summary, "这条决策信号的摘要正在整理中。")
	item.Action = sanitizeDisplayText(item.Action, "查看详情")
	return item
}

func sanitizePullRequest(item store.PullRequest) store.PullRequest {
	item.Title = sanitizeDisplayText(item.Title, "待整理 PR")
	item.Branch = sanitizeDisplayText(item.Branch, "待整理分支")
	item.BaseBranch = sanitizeDisplayText(item.BaseBranch, "当前 base 分支正在整理中。")
	item.ReviewSummary = sanitizeDisplayText(item.ReviewSummary, "当前 review 摘要正在整理中。")
	item.Conversation = sanitizeLivePayload(item.Conversation).([]store.PullRequestConversationEntry)
	return item
}

func sanitizePullRequestConversationEntry(item store.PullRequestConversationEntry) store.PullRequestConversationEntry {
	item.Author = sanitizeDisplayText(item.Author, "GitHub")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 PR 对话摘要正在整理中。")
	item.Body = sanitizeDisplayText(item.Body, "当前 PR 对话内容正在整理中。")
	item.Path = sanitizeDisplayText(item.Path, "")
	return item
}

func sanitizeRuntimeLease(item store.RuntimeLease) store.RuntimeLease {
	item.Branch = sanitizeDisplayText(item.Branch, "待整理分支")
	item.WorktreeName = sanitizeDisplayText(item.WorktreeName, "当前 worktree 名称正在整理中。")
	item.WorktreePath = sanitizeDisplayText(item.WorktreePath, "当前 worktree 路径正在整理中。")
	item.Cwd = sanitizeDisplayText(item.Cwd, "当前工作目录正在整理中。")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 runtime lease 摘要正在整理中。")
	return item
}

func sanitizeSession(session store.Session) store.Session {
	session.ControlNote = sanitizeDisplayText(session.ControlNote, "当前控制说明正在整理中。")
	session.Branch = sanitizeDisplayText(session.Branch, "待整理分支")
	session.Worktree = sanitizeDisplayText(session.Worktree, "当前 worktree 名称正在整理中。")
	session.WorktreePath = sanitizeDisplayText(session.WorktreePath, "当前 worktree 路径正在整理中。")
	session.Summary = sanitizeDisplayText(session.Summary, "当前会话摘要正在整理中。")
	session.MemoryPaths = sanitizeTextLines(session.MemoryPaths, "当前 session 记忆路径正在整理中。")
	return session
}

func sanitizeMemoryArtifact(item store.MemoryArtifact) store.MemoryArtifact {
	item.Scope = sanitizeDisplayText(item.Scope, "memory:current")
	item.Path = sanitizeDisplayText(item.Path, "notes/current-artifact.md")
	item.Summary = sanitizeDisplayText(item.Summary, "当前记忆摘要正在整理中。")
	return item
}

func sanitizeMemoryArtifactVersion(item store.MemoryArtifactVersion) store.MemoryArtifactVersion {
	item.Summary = sanitizeDisplayText(item.Summary, "当前记忆版本摘要正在整理中。")
	item.Content = sanitizeDisplayText(item.Content, "这条记忆内容包含测试残留或乱码，已在当前工作区隐藏。")
	return item
}

func sanitizeTextLines(lines []string, fallback string) []string {
	items := make([]string, len(lines))
	for index, line := range lines {
		items[index] = sanitizeDisplayText(line, fallback)
	}
	return items
}

func sanitizeDisplayText(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return trimmed
	}
	if looksLikeLiveTruthLeak(trimmed) {
		return fallback
	}
	return trimmed
}

func looksLikeLiveTruthLeak(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	return liveTruthQuestionBurstPattern.MatchString(trimmed) ||
		liveTruthE2EResiduePattern.MatchString(trimmed) ||
		liveTruthPlaceholderPattern.MatchString(lower) ||
		liveTruthMockPattern.MatchString(trimmed) ||
		liveTruthPathPattern.MatchString(trimmed)
}

func fallbackSpeaker(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "human":
		return "Workspace Member"
	case "agent":
		return "OpenShock Agent"
	default:
		return "System"
	}
}
