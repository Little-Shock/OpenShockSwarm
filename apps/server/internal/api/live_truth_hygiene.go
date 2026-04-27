package api

import (
	"regexp"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

var (
	liveTruthQuestionBurstPattern           = regexp.MustCompile(`\?{2,}`)
	liveTruthE2EResiduePattern              = regexp.MustCompile(`(?i)\be2e\b.*\b20\d{6,}\b`)
	liveTruthPlaceholderPattern             = regexp.MustCompile(`(?i)\bplaceholder\b|\bfixture\b|\btest-only\b`)
	liveTruthMockPattern                    = regexp.MustCompile(`本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace`)
	liveTruthPathPattern                    = regexp.MustCompile(`[A-Za-z]:\\|/tmp/openshock|/home/lark/OpenShock|\.openshock-worktrees|\.slock/`)
	runtimeSchedulerFallbackStatePattern    = regexp.MustCompile(`^当前 fallback state 仍按 workspace selection 指向 (.+)。$`)
	runtimeSchedulerOwnerSummaryPattern     = regexp.MustCompile(`^已按 (.+) 的设置选择 (.+)，当前有 (\d+) 个运行任务。$`)
	runtimeSchedulerSelectedPattern         = regexp.MustCompile(`^当前继续使用 (.+)，当前有 (\d+) 个运行任务。$`)
	runtimeSchedulerFailoverPattern         = regexp.MustCompile(`^(.+?) 当前不可用，已切换到 (.+)，当前有 (\d+) 个运行任务。$`)
	runtimeSchedulerLeastLoadedPattern      = regexp.MustCompile(`^当前已选择 (.+)，当前有 (\d+) 个运行任务。$`)
	runtimeSchedulerOwnerReasonPattern      = regexp.MustCompile(`^按 owner runtime preference 选中；当前承载 (\d+) 条 active lease。$`)
	runtimeSchedulerSelectedReasonPattern   = regexp.MustCompile(`^沿用当前 selection；当前承载 (\d+) 条 active lease。$`)
	runtimeSchedulerFailoverReasonPattern   = regexp.MustCompile("^承接 `?([^`；]+)`? 的 failover；当前承载 (\\d+) 条 active lease。$")
	runtimeSchedulerPressureReasonPattern   = regexp.MustCompile(`^按 lease 压力选中；当前承载 (\d+) 条 active lease。$`)
	runtimeSchedulerStateReasonPattern      = regexp.MustCompile("^当前 `?([^`，]+)`?，(?:未进入可调度状态|不可调度)。$")
	runtimeSchedulerPreferredSkipPattern    = regexp.MustCompile(`^preferred runtime 当前不可调度，已被 failover 跳过。$`)
	runtimeSchedulerActiveLeasePattern      = regexp.MustCompile(`^当前承载 (\d+) 条 active lease。$`)
	runtimeSchedulerUnavailablePattern      = regexp.MustCompile(`^当前没有可调度 runtime。$`)
	runtimeSchedulerOpenLanePattern         = regexp.MustCompile(`^当前可接新 lane。$`)
	runtimeSchedulerUnpairedPattern         = regexp.MustCompile(`^未配对 daemon，当前不可调度。$`)
	runtimeSchedulerTimelineFailoverPattern = regexp.MustCompile(`^Runtime 已 failover 到 (.+)$`)
	runtimeSchedulerTimelineAssignedPattern = regexp.MustCompile(`^Runtime 已分配到 (.+)$`)
)

// SanitizeLiveState exports the customer-visible hygiene contract so cleanup
// tooling can rewrite persisted state using the same fail-closed rules.
func SanitizeLiveState(snapshot store.State) store.State {
	return sanitizeLiveState(snapshot)
}

// SanitizePersistedState removes dirty placeholder residue from persisted state
// without applying viewer-specific redaction that would erase durable data.
func SanitizePersistedState(snapshot store.State) store.State {
	return sanitizeState(snapshot, false)
}

func sanitizeLivePayload(payload any) any {
	switch typed := payload.(type) {
	case store.State:
		return sanitizeLiveState(typed)
	case store.RoomDetail:
		return sanitizeRoomDetail(typed)
	case store.RunDetail:
		return sanitizeRunDetail(typed)
	case store.RunRecoveryAudit:
		return sanitizeRunRecoveryAudit(typed)
	case store.RunRecoveryHandoffAutoFollowup:
		return sanitizeRunRecoveryHandoffAutoFollowup(typed)
	case store.RunRecoveryRuntimeReplay:
		return sanitizeRunRecoveryRuntimeReplay(typed)
	case store.RunHistoryPage:
		return sanitizeRunHistoryPage(typed)
	case store.PullRequestDetail:
		return sanitizePullRequestDetail(typed)
	case store.PullRequestDeliveryEntry:
		return sanitizePullRequestDeliveryEntry(typed)
	case []store.PullRequestDeliveryGate:
		items := make([]store.PullRequestDeliveryGate, len(typed))
		for index, item := range typed {
			items[index] = sanitizePullRequestDeliveryGate(item)
		}
		return items
	case []store.PullRequestDeliveryTemplate:
		items := make([]store.PullRequestDeliveryTemplate, len(typed))
		for index, item := range typed {
			items[index] = sanitizePullRequestDeliveryTemplate(item)
		}
		return items
	case []store.PullRequestDeliveryEvidence:
		items := make([]store.PullRequestDeliveryEvidence, len(typed))
		for index, item := range typed {
			items[index] = sanitizePullRequestDeliveryEvidence(item)
		}
		return items
	case store.WorkspaceGovernanceLane:
		return sanitizeWorkspaceGovernanceLane(typed)
	case []store.WorkspaceGovernanceLane:
		items := make([]store.WorkspaceGovernanceLane, len(typed))
		for index, item := range typed {
			items[index] = sanitizeWorkspaceGovernanceLane(item)
		}
		return items
	case store.WorkspaceGovernanceRule:
		return sanitizeWorkspaceGovernanceRule(typed)
	case []store.WorkspaceGovernanceRule:
		items := make([]store.WorkspaceGovernanceRule, len(typed))
		for index, item := range typed {
			items[index] = sanitizeWorkspaceGovernanceRule(item)
		}
		return items
	case store.WorkspaceGovernanceSuggestedHandoff:
		return sanitizeWorkspaceSuggestedHandoff(typed)
	case store.WorkspaceGovernanceWalkthrough:
		return sanitizeWorkspaceGovernanceWalkthrough(typed)
	case []store.WorkspaceGovernanceWalkthrough:
		items := make([]store.WorkspaceGovernanceWalkthrough, len(typed))
		for index, item := range typed {
			items[index] = sanitizeWorkspaceGovernanceWalkthrough(item)
		}
		return items
	case store.Channel:
		return sanitizeChannel(typed)
	case []store.Channel:
		items := make([]store.Channel, len(typed))
		for index, item := range typed {
			items[index] = sanitizeChannel(item)
		}
		return items
	case store.DirectMessage:
		return sanitizeDirectMessage(typed)
	case []store.DirectMessage:
		items := make([]store.DirectMessage, len(typed))
		for index, item := range typed {
			items[index] = sanitizeDirectMessage(item)
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
	case store.RunHistoryEntry:
		return sanitizeRunHistoryEntry(typed)
	case []store.Run:
		items := make([]store.Run, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRun(item)
		}
		return items
	case []store.RunHistoryEntry:
		items := make([]store.RunHistoryEntry, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRunHistoryEntry(item)
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
	case store.Machine:
		return sanitizeMachine(typed)
	case []store.Machine:
		items := make([]store.Machine, len(typed))
		for index, item := range typed {
			items[index] = sanitizeMachine(item)
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
	case store.MessageSurfaceEntry:
		return sanitizeMessageSurfaceEntry(typed)
	case []store.MessageSurfaceEntry:
		items := make([]store.MessageSurfaceEntry, len(typed))
		for index, item := range typed {
			items[index] = sanitizeMessageSurfaceEntry(item)
		}
		return items
	case store.SearchResult:
		return sanitizeSearchResult(typed)
	case []store.SearchResult:
		items := make([]store.SearchResult, len(typed))
		for index, item := range typed {
			items[index] = sanitizeSearchResult(item)
		}
		return items
	case store.AgentHandoff:
		return sanitizeAgentHandoff(typed)
	case []store.AgentHandoff:
		items := make([]store.AgentHandoff, len(typed))
		for index, item := range typed {
			items[index] = sanitizeAgentHandoff(item)
		}
		return items
	case store.MailboxMessage:
		return sanitizeMailboxMessage(typed)
	case []store.MailboxMessage:
		items := make([]store.MailboxMessage, len(typed))
		for index, item := range typed {
			items[index] = sanitizeMailboxMessage(item)
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
	case store.RuntimePublishRecord:
		return sanitizeRuntimePublishRecord(typed)
	case []store.RuntimePublishRecord:
		items := make([]store.RuntimePublishRecord, len(typed))
		for index, item := range typed {
			items[index] = sanitizeRuntimePublishRecord(item)
		}
		return items
	case store.RuntimeReplayEvidencePacket:
		return sanitizeRuntimeReplayEvidencePacket(typed)
	case store.RuntimeScheduler:
		return sanitizeRuntimeScheduler(typed)
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
	case store.DestructiveGuard:
		return sanitizeGuard(typed)
	case []store.DestructiveGuard:
		items := make([]store.DestructiveGuard, len(typed))
		for index, item := range typed {
			items[index] = sanitizeGuard(item)
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
	case store.SessionRecovery:
		return sanitizeSessionRecovery(typed)
	case store.SessionRecoveryEvidencePacket:
		return sanitizeSessionRecoveryEvidencePacket(typed)
	case store.SessionRecoveryEvent:
		return sanitizeSessionRecoveryEvent(typed)
	case []store.SessionRecoveryEvent:
		items := make([]store.SessionRecoveryEvent, len(typed))
		for index, item := range typed {
			items[index] = sanitizeSessionRecoveryEvent(item)
		}
		return items
	case store.AuthSnapshot:
		return sanitizeAuthSnapshot(typed)
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
	case store.CredentialProfile:
		return sanitizeCredentialProfile(typed)
	case []store.CredentialProfile:
		items := make([]store.CredentialProfile, len(typed))
		for index, item := range typed {
			items[index] = sanitizeCredentialProfile(item)
		}
		return items
	case store.CredentialProfileAuditEntry:
		return sanitizeCredentialProfileAuditEntry(typed)
	case []store.CredentialProfileAuditEntry:
		items := make([]store.CredentialProfileAuditEntry, len(typed))
		for index, item := range typed {
			items[index] = sanitizeCredentialProfileAuditEntry(item)
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
	return sanitizeState(snapshot, true)
}

func sanitizeState(snapshot store.State, viewerRedaction bool) store.State {
	snapshot.Workspace = sanitizeWorkspace(snapshot.Workspace)
	snapshot.Channels = sanitizeLivePayload(snapshot.Channels).([]store.Channel)
	snapshot.ChannelMessages = sanitizeLivePayload(snapshot.ChannelMessages).(map[string][]store.Message)
	snapshot.DirectMessages = sanitizeLivePayload(snapshot.DirectMessages).([]store.DirectMessage)
	snapshot.DirectMessageMessages = sanitizeLivePayload(snapshot.DirectMessageMessages).(map[string][]store.Message)
	snapshot.FollowedThreads = sanitizeLivePayload(snapshot.FollowedThreads).([]store.MessageSurfaceEntry)
	snapshot.SavedLaterItems = sanitizeLivePayload(snapshot.SavedLaterItems).([]store.MessageSurfaceEntry)
	snapshot.QuickSearchEntries = sanitizeLivePayload(snapshot.QuickSearchEntries).([]store.SearchResult)
	snapshot.Issues = sanitizeLivePayload(snapshot.Issues).([]store.Issue)
	snapshot.Rooms = sanitizeLivePayload(snapshot.Rooms).([]store.Room)
	snapshot.RoomMessages = sanitizeLivePayload(snapshot.RoomMessages).(map[string][]store.Message)
	snapshot.Runs = sanitizeLivePayload(snapshot.Runs).([]store.Run)
	snapshot.Agents = sanitizeLivePayload(snapshot.Agents).([]store.Agent)
	snapshot.Machines = sanitizeLivePayload(snapshot.Machines).([]store.Machine)
	snapshot.Runtimes = sanitizeLivePayload(snapshot.Runtimes).([]store.RuntimeRecord)
	snapshot.Inbox = sanitizeLivePayload(snapshot.Inbox).([]store.InboxItem)
	snapshot.Mailbox = sanitizeLivePayload(snapshot.Mailbox).([]store.AgentHandoff)
	snapshot.PullRequests = sanitizeLivePayload(snapshot.PullRequests).([]store.PullRequest)
	snapshot.Sessions = sanitizeLivePayload(snapshot.Sessions).([]store.Session)
	snapshot.RuntimeLeases = sanitizeLivePayload(snapshot.RuntimeLeases).([]store.RuntimeLease)
	snapshot.RuntimeScheduler = sanitizeLivePayload(snapshot.RuntimeScheduler).(store.RuntimeScheduler)
	snapshot.ControlPlane = sanitizeControlPlaneState(snapshot.ControlPlane)
	snapshot.RuntimePublish = sanitizeRuntimePublishState(snapshot.RuntimePublish)
	snapshot.Guards = sanitizeLivePayload(snapshot.Guards).([]store.DestructiveGuard)
	snapshot.Auth = sanitizeLivePayload(snapshot.Auth).(store.AuthSnapshot)
	snapshot.Memory = sanitizeLivePayload(snapshot.Memory).([]store.MemoryArtifact)
	snapshot.MemoryVersions = sanitizeLivePayload(snapshot.MemoryVersions).(map[string][]store.MemoryArtifactVersion)
	snapshot.Credentials = sanitizeLivePayload(snapshot.Credentials).([]store.CredentialProfile)
	if !viewerRedaction {
		return snapshot
	}
	snapshot.Auth = redactAuthSnapshotForViewer(snapshot.Auth)
	session := snapshot.Auth.Session
	if strings.TrimSpace(session.Status) != authSessionStatusActive {
		return redactSignedOutLiveState(snapshot)
	}
	if authSessionPermissionReadinessError(session) != "" && !authSessionHasRawPermission(session, "members.manage") {
		return redactSignedOutLiveState(snapshot)
	}
	if !authSessionHasRawPermission(session, "runtime.manage") {
		snapshot = redactRuntimeManageState(snapshot)
	}
	return snapshot
}

func redactRuntimeManageState(snapshot store.State) store.State {
	snapshot.Workspace.PairedRuntimeURL = ""
	for index := range snapshot.Runtimes {
		snapshot.Runtimes[index].DaemonURL = ""
	}
	return snapshot
}

func redactSignedOutLiveState(snapshot store.State) store.State {
	snapshot.Workspace = redactSignedOutWorkspaceBootstrap(snapshot.Workspace)
	snapshot.Channels = []store.Channel{}
	snapshot.ChannelMessages = map[string][]store.Message{}
	snapshot.DirectMessages = []store.DirectMessage{}
	snapshot.DirectMessageMessages = map[string][]store.Message{}
	snapshot.FollowedThreads = []store.MessageSurfaceEntry{}
	snapshot.SavedLaterItems = []store.MessageSurfaceEntry{}
	snapshot.QuickSearchEntries = []store.SearchResult{}
	snapshot.Issues = []store.Issue{}
	snapshot.Rooms = []store.Room{}
	snapshot.RoomMessages = map[string][]store.Message{}
	snapshot.Runs = []store.Run{}
	snapshot.Agents = []store.Agent{}
	snapshot.Machines = []store.Machine{}
	snapshot.Runtimes = []store.RuntimeRecord{}
	snapshot.Inbox = []store.InboxItem{}
	snapshot.Mailbox = []store.AgentHandoff{}
	snapshot.PullRequests = []store.PullRequest{}
	snapshot.Sessions = []store.Session{}
	snapshot.RuntimeLeases = []store.RuntimeLease{}
	snapshot.RuntimeScheduler = store.RuntimeScheduler{}
	snapshot.ControlPlane = store.ControlPlaneState{}
	snapshot.RuntimePublish = store.RuntimePublishState{}
	snapshot.Guards = []store.DestructiveGuard{}
	snapshot.Memory = []store.MemoryArtifact{}
	snapshot.MemoryVersions = map[string][]store.MemoryArtifactVersion{}
	snapshot.Credentials = []store.CredentialProfile{}
	return snapshot
}

func redactSignedOutWorkspaceBootstrap(workspace store.WorkspaceSnapshot) store.WorkspaceSnapshot {
	return store.WorkspaceSnapshot{
		Name: sanitizeDisplayText(workspace.Name, "当前工作区名称还没同步。"),
		GitHubInstallation: sanitizeWorkspaceGitHubInstall(store.WorkspaceGitHubInstallSnapshot{
			Provider:          workspace.GitHubInstallation.Provider,
			PreferredAuthMode: workspace.GitHubInstallation.PreferredAuthMode,
			ConnectionMessage: "登录后再查看 GitHub 连接状态。",
		}),
		Onboarding: sanitizeWorkspaceOnboarding(workspace.Onboarding),
	}
}

func sanitizeWorkspace(workspace store.WorkspaceSnapshot) store.WorkspaceSnapshot {
	workspace.Name = sanitizeDisplayText(workspace.Name, "当前工作区名称还没同步。")
	workspace.Repo = sanitizeDisplayText(workspace.Repo, "当前仓库信息还没同步。")
	workspace.RepoURL = sanitizeDisplayText(workspace.RepoURL, "")
	workspace.Branch = sanitizeDisplayTextOrFallback(workspace.Branch, "待整理分支")
	workspace.RepoProvider = sanitizeDisplayText(workspace.RepoProvider, "待整理仓库提供方")
	workspace.RepoBindingStatus = sanitizeDisplayText(workspace.RepoBindingStatus, "当前绑定状态正在整理中。")
	workspace.RepoAuthMode = sanitizeDisplayText(workspace.RepoAuthMode, "当前认证模式正在整理中。")
	workspace.Plan = sanitizeDisplayText(workspace.Plan, "当前工作区计划正在整理中。")
	workspace.PairedRuntime = sanitizeDisplayText(workspace.PairedRuntime, "当前运行环境还没同步。")
	workspace.PairedRuntimeURL = sanitizeDisplayText(workspace.PairedRuntimeURL, "")
	workspace.PairingStatus = sanitizeDisplayText(workspace.PairingStatus, "当前配对状态正在整理中。")
	workspace.DeviceAuth = sanitizeDisplayText(workspace.DeviceAuth, "当前设备认证状态正在整理中。")
	workspace.BrowserPush = sanitizeDisplayText(workspace.BrowserPush, "当前浏览器推送策略正在整理中。")
	workspace.MemoryMode = sanitizeDisplayText(workspace.MemoryMode, "当前记忆模式正在整理中。")
	workspace.RepoBinding = sanitizeWorkspaceRepoBinding(workspace.RepoBinding)
	workspace.GitHubInstallation = sanitizeWorkspaceGitHubInstall(workspace.GitHubInstallation)
	workspace.Onboarding = sanitizeWorkspaceOnboarding(workspace.Onboarding)
	workspace.Governance = sanitizeWorkspaceGovernance(workspace.Governance)
	return workspace
}

func sanitizeWorkspaceGovernance(governance store.WorkspaceGovernanceSnapshot) store.WorkspaceGovernanceSnapshot {
	governance.Label = sanitizeDisplayTextOrFallback(governance.Label, "当前协作流程正在整理中。")
	governance.Summary = sanitizeDisplayTextOrFallback(governance.Summary, "当前协作摘要正在整理中。")
	governance.ConfiguredTopology = sanitizeWorkspaceGovernanceTopologyConfig(governance.ConfiguredTopology)
	governance.TeamTopology = sanitizeLivePayload(governance.TeamTopology).([]store.WorkspaceGovernanceLane)
	governance.HandoffRules = sanitizeLivePayload(governance.HandoffRules).([]store.WorkspaceGovernanceRule)
	governance.RoutingPolicy = sanitizeWorkspaceRoutingPolicy(governance.RoutingPolicy)
	governance.EscalationSLA = sanitizeWorkspaceEscalationSLA(governance.EscalationSLA)
	governance.NotificationPolicy = sanitizeWorkspaceNotificationPolicy(governance.NotificationPolicy)
	governance.ResponseAggregation = sanitizeWorkspaceResponseAggregation(governance.ResponseAggregation)
	governance.HumanOverride = sanitizeWorkspaceHumanOverride(governance.HumanOverride)
	governance.Walkthrough = sanitizeLivePayload(governance.Walkthrough).([]store.WorkspaceGovernanceWalkthrough)
	return governance
}

func sanitizeWorkspaceGovernanceTopologyConfig(items []store.WorkspaceGovernanceLaneConfig) []store.WorkspaceGovernanceLaneConfig {
	sanitized := make([]store.WorkspaceGovernanceLaneConfig, 0, len(items))
	for _, item := range items {
		sanitized = append(sanitized, store.WorkspaceGovernanceLaneConfig{
			ID:           sanitizeDisplayText(item.ID, "lane"),
			Label:        sanitizeDisplayTextOrFallback(item.Label, "未命名分工"),
			Role:         sanitizeDisplayTextOrFallback(item.Role, "当前职责正在整理中。"),
			DefaultAgent: sanitizeDisplayText(item.DefaultAgent, ""),
			Lane:         sanitizeDisplayText(item.Lane, ""),
		})
	}
	return sanitized
}

func sanitizeWorkspaceGovernanceLane(item store.WorkspaceGovernanceLane) store.WorkspaceGovernanceLane {
	item.Label = sanitizeDisplayTextOrFallback(item.Label, "未命名分工")
	item.Role = sanitizeDisplayTextOrFallback(item.Role, "当前职责正在整理中。")
	item.DefaultAgent = sanitizeDisplayText(item.DefaultAgent, "")
	item.Lane = sanitizeDisplayText(item.Lane, "")
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前分工正在整理中。")
	return item
}

func sanitizeWorkspaceGovernanceRule(item store.WorkspaceGovernanceRule) store.WorkspaceGovernanceRule {
	item.Label = sanitizeDisplayTextOrFallback(item.Label, "未命名规则")
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前规则正在整理中。")
	item.Href = sanitizeDisplayText(item.Href, "")
	return item
}

func sanitizeWorkspaceRoutingPolicy(item store.WorkspaceGovernanceRoutingPolicy) store.WorkspaceGovernanceRoutingPolicy {
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前安排正在整理中。")
	item.DefaultRoute = sanitizeDisplayText(item.DefaultRoute, "")
	item.SuggestedHandoff = sanitizeWorkspaceSuggestedHandoff(item.SuggestedHandoff)
	for index := range item.Rules {
		item.Rules[index].Trigger = sanitizeDisplayTextOrFallback(item.Rules[index].Trigger, "trigger")
		item.Rules[index].FromLane = sanitizeDisplayTextOrFallback(item.Rules[index].FromLane, "未命名来源")
		item.Rules[index].ToLane = sanitizeDisplayTextOrFallback(item.Rules[index].ToLane, "未命名目标")
		item.Rules[index].Policy = sanitizeDisplayTextOrFallback(item.Rules[index].Policy, "当前安排正在整理中。")
		item.Rules[index].Summary = sanitizeDisplayTextOrFallback(item.Rules[index].Summary, "当前安排正在整理中。")
	}
	return item
}

func sanitizeWorkspaceSuggestedHandoff(item store.WorkspaceGovernanceSuggestedHandoff) store.WorkspaceGovernanceSuggestedHandoff {
	item.Reason = sanitizeDisplayTextOrFallback(item.Reason, "当前交接建议正在整理中。")
	item.RoomID = sanitizeDisplayText(item.RoomID, "")
	item.IssueKey = sanitizeDisplayText(item.IssueKey, "")
	item.FromLaneID = sanitizeDisplayText(item.FromLaneID, "")
	item.FromLaneLabel = sanitizeDisplayText(item.FromLaneLabel, "")
	item.FromAgentID = sanitizeDisplayText(item.FromAgentID, "")
	item.FromAgent = sanitizeDisplayText(item.FromAgent, "")
	item.ToLaneID = sanitizeDisplayText(item.ToLaneID, "")
	item.ToLaneLabel = sanitizeDisplayText(item.ToLaneLabel, "")
	item.ToAgentID = sanitizeDisplayText(item.ToAgentID, "")
	item.ToAgent = sanitizeDisplayText(item.ToAgent, "")
	item.DraftTitle = sanitizeDisplayText(item.DraftTitle, "")
	item.DraftSummary = sanitizeDisplayText(item.DraftSummary, "")
	item.HandoffID = sanitizeDisplayText(item.HandoffID, "")
	item.Href = sanitizeDisplayText(item.Href, "")
	hrefLabelFallback := store.WorkspaceGovernanceNextRouteHrefLabel(item.Status, item.Href)
	item.HrefLabel = sanitizeDisplayText(item.HrefLabel, hrefLabelFallback)
	if strings.TrimSpace(item.HrefLabel) == "" {
		item.HrefLabel = hrefLabelFallback
	}
	return item
}

func sanitizeWorkspaceEscalationSLA(item store.WorkspaceGovernanceEscalationSLA) store.WorkspaceGovernanceEscalationSLA {
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前待处理事项正在整理中。")
	item.NextEscalation = sanitizeDisplayText(item.NextEscalation, "")
	for index := range item.Queue {
		item.Queue[index].Label = sanitizeDisplayTextOrFallback(item.Queue[index].Label, "未命名待处理事项")
		item.Queue[index].Status = sanitizeDisplayText(item.Queue[index].Status, "pending")
		item.Queue[index].Source = sanitizeDisplayTextOrFallback(item.Queue[index].Source, "当前状态")
		item.Queue[index].Owner = sanitizeDisplayText(item.Queue[index].Owner, "")
		item.Queue[index].Summary = sanitizeDisplayTextOrFallback(item.Queue[index].Summary, "当前待处理事项正在整理中。")
		item.Queue[index].NextStep = sanitizeDisplayTextOrFallback(item.Queue[index].NextStep, "当前下一步正在整理中。")
		item.Queue[index].Href = sanitizeDisplayText(item.Queue[index].Href, "")
		item.Queue[index].TimeLabel = sanitizeDisplayText(item.Queue[index].TimeLabel, "")
	}
	for index := range item.Rollup {
		item.Rollup[index].RoomID = sanitizeDisplayText(item.Rollup[index].RoomID, "")
		item.Rollup[index].RoomTitle = sanitizeDisplayTextOrFallback(item.Rollup[index].RoomTitle, "未命名讨论间")
		item.Rollup[index].Status = sanitizeDisplayText(item.Rollup[index].Status, "pending")
		item.Rollup[index].CurrentOwner = sanitizeDisplayText(item.Rollup[index].CurrentOwner, "")
		item.Rollup[index].CurrentLane = sanitizeDisplayText(item.Rollup[index].CurrentLane, "")
		item.Rollup[index].LatestSource = sanitizeDisplayTextOrFallback(item.Rollup[index].LatestSource, "当前状态")
		item.Rollup[index].LatestLabel = sanitizeDisplayTextOrFallback(item.Rollup[index].LatestLabel, "未命名待处理事项")
		item.Rollup[index].LatestSummary = sanitizeDisplayTextOrFallback(item.Rollup[index].LatestSummary, "当前讨论间提醒正在整理中。")
		item.Rollup[index].NextRouteStatus = sanitizeDisplayText(item.Rollup[index].NextRouteStatus, "pending")
		item.Rollup[index].NextRouteLabel = sanitizeDisplayText(item.Rollup[index].NextRouteLabel, "")
		item.Rollup[index].NextRouteSummary = sanitizeDisplayTextOrFallback(item.Rollup[index].NextRouteSummary, "当前下一步安排正在整理中。")
		item.Rollup[index].NextRouteHref = sanitizeDisplayText(item.Rollup[index].NextRouteHref, "")
		nextRouteHrefLabelFallback := store.WorkspaceGovernanceNextRouteHrefLabel(item.Rollup[index].NextRouteStatus, item.Rollup[index].NextRouteHref)
		item.Rollup[index].NextRouteHrefLabel = sanitizeDisplayText(item.Rollup[index].NextRouteHrefLabel, nextRouteHrefLabelFallback)
		if strings.TrimSpace(item.Rollup[index].NextRouteHrefLabel) == "" {
			item.Rollup[index].NextRouteHrefLabel = nextRouteHrefLabelFallback
		}
		item.Rollup[index].Href = sanitizeDisplayText(item.Rollup[index].Href, "")
		hrefLabelFallback := store.WorkspaceGovernanceEscalationRoomHrefLabel(item.Rollup[index].Href)
		item.Rollup[index].HrefLabel = sanitizeDisplayText(item.Rollup[index].HrefLabel, hrefLabelFallback)
		if strings.TrimSpace(item.Rollup[index].HrefLabel) == "" {
			item.Rollup[index].HrefLabel = hrefLabelFallback
		}
	}
	return item
}

func sanitizeWorkspaceNotificationPolicy(item store.WorkspaceGovernanceNotificationPolicy) store.WorkspaceGovernanceNotificationPolicy {
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前提醒设置正在整理中。")
	item.BrowserPush = sanitizeDisplayText(item.BrowserPush, "")
	item.EscalationChannel = sanitizeDisplayText(item.EscalationChannel, "")
	item.Targets = sanitizeTextLinesOrFallback(item.Targets, "当前提醒对象")
	return item
}

func sanitizeWorkspaceResponseAggregation(item store.WorkspaceResponseAggregation) store.WorkspaceResponseAggregation {
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前最终回复正在整理中。")
	item.Sources = sanitizeTextLinesOrFallback(item.Sources, "当前来源")
	item.FinalResponse = sanitizeDisplayTextOrFallback(item.FinalResponse, "等待当前事项收口。")
	item.Aggregator = sanitizeDisplayText(item.Aggregator, "")
	item.DecisionPath = sanitizeTextLinesOrFallback(item.DecisionPath, "当前步骤")
	item.OverrideTrace = sanitizeTextLinesOrFallback(item.OverrideTrace, "人工处理记录")
	for index := range item.AuditTrail {
		item.AuditTrail[index].Label = sanitizeDisplayTextOrFallback(item.AuditTrail[index].Label, "未命名记录")
		item.AuditTrail[index].Actor = sanitizeDisplayText(item.AuditTrail[index].Actor, "")
		item.AuditTrail[index].Summary = sanitizeDisplayTextOrFallback(item.AuditTrail[index].Summary, "当前记录正在整理中。")
		item.AuditTrail[index].OccurredAt = sanitizeDisplayText(item.AuditTrail[index].OccurredAt, "")
	}
	return item
}

func sanitizeWorkspaceHumanOverride(item store.WorkspaceHumanOverride) store.WorkspaceHumanOverride {
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前人工处理状态正在整理中。")
	item.Href = sanitizeDisplayText(item.Href, "")
	return item
}

func sanitizeWorkspaceGovernanceWalkthrough(item store.WorkspaceGovernanceWalkthrough) store.WorkspaceGovernanceWalkthrough {
	item.Label = sanitizeDisplayTextOrFallback(item.Label, "未命名步骤")
	item.Summary = sanitizeDisplayTextOrFallback(item.Summary, "当前步骤正在整理中。")
	item.Detail = sanitizeDisplayText(item.Detail, "")
	item.Href = sanitizeDisplayText(item.Href, "")
	return item
}

func sanitizeControlPlaneState(state store.ControlPlaneState) store.ControlPlaneState {
	for index := range state.Commands {
		state.Commands[index].Summary = sanitizeDisplayText(state.Commands[index].Summary, "当前 control-plane command 正在整理中。")
		state.Commands[index].AggregateHref = sanitizeDisplayText(state.Commands[index].AggregateHref, "")
		state.Commands[index].ReplayAnchor = sanitizeDisplayText(state.Commands[index].ReplayAnchor, "")
		state.Commands[index].ErrorMessage = sanitizeDisplayText(state.Commands[index].ErrorMessage, "")
		for debugIndex := range state.Commands[index].Debug {
			state.Commands[index].Debug[debugIndex].Summary = sanitizeDisplayText(state.Commands[index].Debug[debugIndex].Summary, "当前 control-plane debug 正在整理中。")
		}
	}
	for index := range state.Events {
		state.Events[index].Summary = sanitizeDisplayText(state.Events[index].Summary, "当前 control-plane event 正在整理中。")
		state.Events[index].ReplayAnchor = sanitizeDisplayText(state.Events[index].ReplayAnchor, "")
	}
	for index := range state.Rejections {
		state.Rejections[index].Summary = sanitizeDisplayText(state.Rejections[index].Summary, "当前 control-plane rejection 正在整理中。")
		state.Rejections[index].Reason = sanitizeDisplayText(state.Rejections[index].Reason, "当前 control-plane rejection reason 正在整理中。")
		state.Rejections[index].ReplayAnchor = sanitizeDisplayText(state.Rejections[index].ReplayAnchor, "")
	}
	return state
}

func sanitizeRuntimePublishState(state store.RuntimePublishState) store.RuntimePublishState {
	for index := range state.Records {
		state.Records[index] = sanitizeRuntimePublishRecord(state.Records[index])
	}
	return state
}

func sanitizeRuntimePublishRecord(item store.RuntimePublishRecord) store.RuntimePublishRecord {
	item.Summary = sanitizeDisplayText(item.Summary, "当前 runtime publish record 正在整理中。")
	item.FailureAnchor = sanitizeDisplayText(item.FailureAnchor, "")
	item.CloseoutReason = sanitizeDisplayText(item.CloseoutReason, "")
	item.EvidenceLines = sanitizeTextLines(item.EvidenceLines, "evidence")
	return item
}

func sanitizeRuntimeReplayEvidencePacket(item store.RuntimeReplayEvidencePacket) store.RuntimeReplayEvidencePacket {
	item.Summary = sanitizeDisplayText(item.Summary, "当前 runtime replay evidence 正在整理中。")
	item.FailureAnchor = sanitizeDisplayText(item.FailureAnchor, "")
	item.CloseoutReason = sanitizeDisplayText(item.CloseoutReason, "")
	item.ReplayAnchor = sanitizeDisplayText(item.ReplayAnchor, "")
	item.Events = sanitizeLivePayload(item.Events).([]store.RuntimePublishRecord)
	return item
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
	detail.Delivery = sanitizeLivePayload(detail.Delivery).(store.PullRequestDeliveryEntry)
	return detail
}

func sanitizePullRequestDeliveryEntry(item store.PullRequestDeliveryEntry) store.PullRequestDeliveryEntry {
	item.Summary = sanitizeDisplayText(item.Summary, "当前 delivery contract 摘要正在整理中。")
	item.Gates = sanitizeLivePayload(item.Gates).([]store.PullRequestDeliveryGate)
	item.Templates = sanitizeLivePayload(item.Templates).([]store.PullRequestDeliveryTemplate)
	item.Delegation = sanitizePullRequestDeliveryDelegation(item.Delegation)
	item.HandoffNote = sanitizePullRequestDeliveryHandoffNote(item.HandoffNote)
	item.Evidence = sanitizeLivePayload(item.Evidence).([]store.PullRequestDeliveryEvidence)
	return item
}

func sanitizePullRequestDeliveryGate(item store.PullRequestDeliveryGate) store.PullRequestDeliveryGate {
	item.Label = sanitizeDisplayText(item.Label, "当前 gate 正在整理中。")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 gate 摘要正在整理中。")
	item.Href = sanitizeDisplayText(item.Href, "")
	hrefLabelFallback := store.PullRequestDeliveryHrefLabel(item.ID, item.Href)
	item.HrefLabel = sanitizeDisplayText(item.HrefLabel, hrefLabelFallback)
	if strings.TrimSpace(item.HrefLabel) == "" {
		item.HrefLabel = hrefLabelFallback
	}
	return item
}

func sanitizePullRequestDeliveryTemplate(item store.PullRequestDeliveryTemplate) store.PullRequestDeliveryTemplate {
	item.Label = sanitizeDisplayText(item.Label, "未命名模板")
	item.Href = sanitizeDisplayText(item.Href, "")
	return item
}

func sanitizePullRequestDeliveryDelegation(item store.PullRequestDeliveryDelegation) store.PullRequestDeliveryDelegation {
	item.TargetLane = sanitizeDisplayText(item.TargetLane, "")
	item.TargetAgent = sanitizeDisplayText(item.TargetAgent, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 delivery delegation 正在整理中。")
	item.Href = sanitizeDisplayText(item.Href, "")
	item.HrefLabel = sanitizeDisplayText(item.HrefLabel, "")
	item.InboxItemID = sanitizeDisplayText(item.InboxItemID, "")
	item.HandoffID = sanitizeDisplayText(item.HandoffID, "")
	item.HandoffHref = sanitizeDisplayText(item.HandoffHref, "")
	item.HandoffHrefLabel = sanitizeDisplayText(item.HandoffHrefLabel, "")
	item.HandoffStatus = sanitizeDisplayText(item.HandoffStatus, "")
	if item.ResponseAttemptCount < 0 {
		item.ResponseAttemptCount = 0
	}
	item.ResponseHandoffID = sanitizeDisplayText(item.ResponseHandoffID, "")
	item.ResponseHandoffHref = sanitizeDisplayText(item.ResponseHandoffHref, "")
	item.ResponseHandoffHrefLabel = sanitizeDisplayText(item.ResponseHandoffHrefLabel, "")
	item.ResponseHandoffStatus = sanitizeDisplayText(item.ResponseHandoffStatus, "")
	return item
}

func sanitizePullRequestDeliveryHandoffNote(item store.PullRequestDeliveryHandoffNote) store.PullRequestDeliveryHandoffNote {
	item.Title = sanitizeDisplayText(item.Title, "当前 handoff note 标题正在整理中。")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 handoff note 摘要正在整理中。")
	item.Lines = sanitizeTextLines(item.Lines, "当前 handoff note 正在整理中。")
	return item
}

func sanitizePullRequestDeliveryEvidence(item store.PullRequestDeliveryEvidence) store.PullRequestDeliveryEvidence {
	item.Label = sanitizeDisplayText(item.Label, "当前证据项正在整理中。")
	item.Value = sanitizeDisplayText(item.Value, "当前证据值正在整理中。")
	item.Summary = sanitizeDisplayText(item.Summary, "当前证据摘要正在整理中。")
	item.Href = sanitizeDisplayText(item.Href, "")
	hrefLabelFallback := store.PullRequestDeliveryEvidenceHrefLabel(item.ID, item.Href)
	item.HrefLabel = sanitizeDisplayText(item.HrefLabel, hrefLabelFallback)
	if strings.TrimSpace(item.HrefLabel) == "" {
		item.HrefLabel = hrefLabelFallback
	}
	return item
}

func sanitizeRunDetail(detail store.RunDetail) store.RunDetail {
	detail.Run = sanitizeRun(detail.Run)
	detail.Room = sanitizeRoom(detail.Room)
	detail.Issue = sanitizeIssue(detail.Issue)
	detail.Session = sanitizeSession(detail.Session)
	detail.RecoveryAudit = sanitizeRunRecoveryAudit(detail.RecoveryAudit)
	detail.History = sanitizeLivePayload(detail.History).([]store.RunHistoryEntry)
	return detail
}

func sanitizeRunRecoveryAudit(item store.RunRecoveryAudit) store.RunRecoveryAudit {
	item.Status = sanitizeDisplayText(item.Status, "")
	item.Source = sanitizeDisplayText(item.Source, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前恢复摘要正在整理中。")
	item.Preview = sanitizeDisplayText(item.Preview, "当前恢复预览正在整理中。")
	item.SessionReplay = sanitizeDisplayText(item.SessionReplay, "")
	if item.HandoffAutoFollowup != nil {
		sanitized := sanitizeRunRecoveryHandoffAutoFollowup(*item.HandoffAutoFollowup)
		item.HandoffAutoFollowup = &sanitized
	}
	if item.RoomAutoFollowup != nil {
		sanitized := sanitizeRunRecoveryHandoffAutoFollowup(*item.RoomAutoFollowup)
		item.RoomAutoFollowup = &sanitized
	}
	if item.RuntimeReplay != nil {
		sanitized := sanitizeRunRecoveryRuntimeReplay(*item.RuntimeReplay)
		item.RuntimeReplay = &sanitized
	}
	return item
}

func sanitizeRunRecoveryHandoffAutoFollowup(item store.RunRecoveryHandoffAutoFollowup) store.RunRecoveryHandoffAutoFollowup {
	item.Kind = sanitizeDisplayText(item.Kind, "")
	item.HandoffID = sanitizeDisplayText(item.HandoffID, "")
	item.ToAgentID = sanitizeDisplayText(item.ToAgentID, "")
	item.ToAgent = sanitizeDisplayText(item.ToAgent, "")
	item.Status = sanitizeDisplayText(item.Status, "")
	item.Summary = sanitizeDisplayText(item.Summary, "交接继续摘要正在整理中。")
	item.LastAction = sanitizeDisplayText(item.LastAction, "交接继续动作正在整理中。")
	return item
}

func sanitizeRunRecoveryRuntimeReplay(item store.RunRecoveryRuntimeReplay) store.RunRecoveryRuntimeReplay {
	item.ReplayAnchor = sanitizeDisplayText(item.ReplayAnchor, "")
	item.Status = sanitizeDisplayText(item.Status, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 runtime replay 摘要正在整理中。")
	item.CloseoutReason = sanitizeDisplayText(item.CloseoutReason, "")
	return item
}

func sanitizeRunHistoryPage(page store.RunHistoryPage) store.RunHistoryPage {
	page.Items = sanitizeLivePayload(page.Items).([]store.RunHistoryEntry)
	return page
}

func sanitizeRunHistoryEntry(entry store.RunHistoryEntry) store.RunHistoryEntry {
	entry.Run = sanitizeRun(entry.Run)
	entry.Room = sanitizeRoom(entry.Room)
	entry.Issue = sanitizeIssue(entry.Issue)
	entry.Session = sanitizeSession(entry.Session)
	return entry
}

func sanitizeChannel(channel store.Channel) store.Channel {
	channel.Summary = sanitizeDisplayText(channel.Summary, "当前频道摘要正在整理中。")
	channel.Purpose = sanitizeDisplayText(channel.Purpose, "频道说明还没同步。")
	return channel
}

func sanitizeDirectMessage(item store.DirectMessage) store.DirectMessage {
	item.Name = sanitizeDisplayText(item.Name, "@OpenShock Agent")
	item.Summary = sanitizeDisplayText(item.Summary, "当前私聊摘要还没同步。")
	item.Purpose = sanitizeDisplayText(item.Purpose, "私聊说明还没同步。")
	item.Counterpart = sanitizeDisplayText(item.Counterpart, "OpenShock Agent")
	return item
}

func sanitizeMessage(message store.Message) store.Message {
	message.Message = sanitizeDisplayText(message.Message, "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。")
	message.Speaker = sanitizeDisplayText(message.Speaker, fallbackSpeaker(message.Role))
	return message
}

func sanitizeIssue(issue store.Issue) store.Issue {
	issue.Title = sanitizeDisplayText(issue.Title, "待整理任务")
	issue.Summary = sanitizeDisplayText(issue.Summary, "这条任务的上下文正在整理，先回到讨论间确认当前状态。")
	return issue
}

func sanitizeRoom(room store.Room) store.Room {
	room.Title = sanitizeDisplayText(room.Title, "待整理讨论间")
	room.Summary = sanitizeDisplayText(room.Summary, "当前讨论间的标题和摘要正在整理，先确认最新执行状态。")
	room.Topic = sanitizeTopic(room.Topic)
	return room
}

func sanitizeTopic(topic store.Topic) store.Topic {
	topic.Title = sanitizeDisplayText(topic.Title, "待整理话题")
	topic.Summary = sanitizeDisplayText(topic.Summary, "当前话题摘要还没同步。")
	return topic
}

func sanitizeRun(run store.Run) store.Run {
	run.Branch = sanitizeDisplayTextOrFallback(run.Branch, "待整理分支")
	run.Worktree = sanitizeDisplayText(run.Worktree, "当前 worktree 名称正在整理中。")
	run.WorktreePath = sanitizeDisplayText(run.WorktreePath, "当前 worktree 路径正在整理中。")
	run.Summary = sanitizeDisplayText(run.Summary, "当前执行摘要还没同步。")
	run.NextAction = sanitizeDisplayText(run.NextAction, "等待当前执行更新。")
	run.PullRequest = sanitizeDisplayText(run.PullRequest, "待整理 PR")
	run.CredentialProfileIDs = sanitizeTextLines(run.CredentialProfileIDs, "")
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
	agent.Mood = sanitizeDisplayText(agent.Mood, "当前 Agent 状态正在整理中。")
	agent.Lane = sanitizeDisplayText(agent.Lane, "待整理泳道")
	agent.Role = sanitizeDisplayText(agent.Role, "Agent")
	agent.Avatar = sanitizeDisplayText(agent.Avatar, "agent")
	agent.Prompt = sanitizeDisplayText(agent.Prompt, "当前 Agent 提示词正在整理中。")
	agent.OperatingInstructions = sanitizeDisplayText(agent.OperatingInstructions, "当前 Agent 操作约束正在整理中。")
	agent.ProviderPreference = sanitizeDisplayText(agent.ProviderPreference, "当前 provider 偏好正在整理中。")
	agent.ModelPreference = sanitizeDisplayText(agent.ModelPreference, "当前模型偏好正在整理中。")
	agent.RecallPolicy = sanitizeDisplayText(agent.RecallPolicy, "当前 recall 策略正在整理中。")
	agent.CredentialProfileIDs = sanitizeTextLines(agent.CredentialProfileIDs, "")
	for index := range agent.ProfileAudit {
		agent.ProfileAudit[index] = sanitizeAgentProfileAuditEntry(agent.ProfileAudit[index])
	}
	return agent
}

func sanitizeMachine(item store.Machine) store.Machine {
	item.Name = sanitizeDisplayText(item.Name, "待整理机器")
	item.CLI = sanitizeDisplayText(item.CLI, "当前 CLI 能力正在整理中。")
	item.Shell = sanitizeDisplayText(item.Shell, "当前 shell 真值正在整理中。")
	item.OS = sanitizeDisplayText(item.OS, "当前系统信息正在整理中。")
	return item
}

func sanitizeRuntimeRecord(record store.RuntimeRecord) store.RuntimeRecord {
	record.Machine = sanitizeDisplayText(record.Machine, "待整理 runtime")
	record.DaemonURL = sanitizeDisplayText(record.DaemonURL, "")
	record.Shell = sanitizeDisplayText(record.Shell, "当前 shell 真值正在整理中。")
	for index := range record.Providers {
		record.Providers[index] = sanitizeRuntimeProvider(record.Providers[index])
	}
	record.WorkspaceRoot = sanitizeDisplayText(record.WorkspaceRoot, "当前 runtime 工作区路径已隐藏。")
	return record
}

func sanitizeMessageSurfaceEntry(item store.MessageSurfaceEntry) store.MessageSurfaceEntry {
	item.ChannelLabel = sanitizeDisplayText(item.ChannelLabel, "当前消息面标签正在整理中。")
	item.Title = sanitizeDisplayText(item.Title, "待整理消息线索")
	item.Summary = sanitizeDisplayText(item.Summary, "当前消息线索摘要正在整理中。")
	item.Note = sanitizeDisplayText(item.Note, "当前消息线索备注正在整理中。")
	return item
}

func sanitizeSearchResult(item store.SearchResult) store.SearchResult {
	item.Title = sanitizeDisplayText(item.Title, "待整理结果")
	item.Summary = sanitizeDisplayText(item.Summary, "当前搜索结果摘要正在整理中。")
	item.Meta = sanitizeDisplayText(item.Meta, "当前搜索结果上下文正在整理中。")
	item.Href = sanitizeDisplayText(item.Href, "/")
	item.Keywords = sanitizeDisplayText(item.Keywords, "")
	return item
}

func sanitizeInboxItem(item store.InboxItem) store.InboxItem {
	item.Title = sanitizeDisplayText(item.Title, "待整理信号")
	item.Room = sanitizeDisplayText(item.Room, "待整理讨论间")
	item.Summary = sanitizeDisplayText(item.Summary, "这条决策信号的摘要正在整理中。")
	actionFallback := store.InboxItemActionLabel(item.Href)
	item.Action = sanitizeDisplayText(item.Action, actionFallback)
	if strings.TrimSpace(item.Action) == "" {
		item.Action = actionFallback
	}
	return item
}

func sanitizeAgentHandoff(item store.AgentHandoff) store.AgentHandoff {
	item.Title = sanitizeDisplayText(item.Title, "待整理交接")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 handoff 摘要正在整理中。")
	item.Kind = sanitizeDisplayText(item.Kind, "manual")
	kindLabelFallback := store.AgentHandoffKindLabel(item.Kind)
	item.KindLabel = sanitizeDisplayText(item.KindLabel, kindLabelFallback)
	if strings.TrimSpace(item.KindLabel) == "" {
		item.KindLabel = kindLabelFallback
	}
	item.ParentHandoffID = sanitizeDisplayText(item.ParentHandoffID, "")
	item.FromAgent = sanitizeDisplayText(item.FromAgent, "来源 Agent")
	item.ToAgent = sanitizeDisplayText(item.ToAgent, "目标 Agent")
	item.LastAction = sanitizeDisplayText(item.LastAction, "等待 handoff 同步。")
	item.LastNote = sanitizeDisplayText(item.LastNote, "")
	if item.AutoFollowup != nil {
		item.AutoFollowup.Status = sanitizeDisplayText(item.AutoFollowup.Status, "")
		item.AutoFollowup.Summary = sanitizeDisplayText(item.AutoFollowup.Summary, "当前自动接棒摘要正在整理中。")
	}
	item.Messages = sanitizeLivePayload(item.Messages).([]store.MailboxMessage)
	return item
}

func sanitizeMailboxMessage(item store.MailboxMessage) store.MailboxMessage {
	item.AuthorName = sanitizeDisplayText(item.AuthorName, "OpenShock Agent")
	item.Body = sanitizeDisplayText(item.Body, "当前 mailbox 消息正在整理中。")
	return item
}

func sanitizePullRequest(item store.PullRequest) store.PullRequest {
	item.Title = sanitizeDisplayText(item.Title, "待整理 PR")
	item.Branch = sanitizeDisplayTextOrFallback(item.Branch, "待整理分支")
	item.BaseBranch = sanitizeDisplayTextOrFallback(item.BaseBranch, "当前 base 分支正在整理中。")
	item.Mergeable = sanitizeDisplayText(item.Mergeable, "")
	item.MergeStateStatus = sanitizeDisplayText(item.MergeStateStatus, "")
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
	item.Branch = sanitizeDisplayTextOrFallback(item.Branch, "待整理分支")
	item.WorktreeName = sanitizeDisplayText(item.WorktreeName, "当前 worktree 名称正在整理中。")
	item.WorktreePath = sanitizeDisplayText(item.WorktreePath, "当前 worktree 路径正在整理中。")
	item.Cwd = sanitizeDisplayText(item.Cwd, "当前工作目录正在整理中。")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 runtime lease 摘要正在整理中。")
	return item
}

func sanitizeRuntimeScheduler(item store.RuntimeScheduler) store.RuntimeScheduler {
	item.PreferredRuntime = sanitizeDisplayText(item.PreferredRuntime, "当前首选运行环境正在整理中。")
	item.AssignedRuntime = sanitizeDisplayText(item.AssignedRuntime, "当前分配运行环境正在整理中。")
	item.AssignedMachine = sanitizeDisplayText(item.AssignedMachine, "当前分配机器正在整理中。")
	item.FailoverFrom = sanitizeDisplayText(item.FailoverFrom, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前运行环境调度摘要正在整理中。")
	for index := range item.Candidates {
		item.Candidates[index] = sanitizeRuntimeSchedulerCandidate(item.Candidates[index])
	}
	return item
}

func sanitizeSession(session store.Session) store.Session {
	session.ControlNote = sanitizeDisplayText(session.ControlNote, "当前执行备注还没同步。")
	session.Branch = sanitizeDisplayTextOrFallback(session.Branch, "待整理分支")
	session.Worktree = sanitizeDisplayText(session.Worktree, "当前 worktree 名称正在整理中。")
	session.WorktreePath = sanitizeDisplayText(session.WorktreePath, "当前 worktree 路径正在整理中。")
	session.Summary = sanitizeDisplayText(session.Summary, "当前会话摘要正在整理中。")
	if session.PendingTurn != nil {
		session.PendingTurn.Prompt = sanitizeDisplayText(session.PendingTurn.Prompt, "当前中断前用户消息正在整理中。")
		session.PendingTurn.Provider = sanitizeDisplayText(session.PendingTurn.Provider, "")
		session.PendingTurn.Status = sanitizeDisplayText(session.PendingTurn.Status, "")
		session.PendingTurn.Preview = sanitizeDisplayText(session.PendingTurn.Preview, "当前中断前公开摘要正在整理中。")
	}
	if session.Recovery != nil {
		sanitized := sanitizeSessionRecovery(*session.Recovery)
		session.Recovery = &sanitized
	}
	session.MemoryPaths = sanitizeTextLines(session.MemoryPaths, "当前 session 记忆路径正在整理中。")
	return session
}

func sanitizeSessionRecovery(item store.SessionRecovery) store.SessionRecovery {
	item.Status = sanitizeDisplayText(item.Status, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前恢复摘要正在整理中。")
	item.Preview = sanitizeDisplayText(item.Preview, "当前中断预览正在整理中。")
	item.ReplayAnchor = sanitizeDisplayText(item.ReplayAnchor, "")
	item.LastSource = sanitizeDisplayText(item.LastSource, "")
	item.LastError = sanitizeDisplayText(item.LastError, "")
	for index := range item.Events {
		item.Events[index] = sanitizeSessionRecoveryEvent(item.Events[index])
	}
	return item
}

func sanitizeSessionRecoveryEvent(item store.SessionRecoveryEvent) store.SessionRecoveryEvent {
	item.Status = sanitizeDisplayText(item.Status, "")
	item.Source = sanitizeDisplayText(item.Source, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前恢复事件摘要正在整理中。")
	return item
}

func sanitizeSessionRecoveryEvidencePacket(item store.SessionRecoveryEvidencePacket) store.SessionRecoveryEvidencePacket {
	item.Status = sanitizeDisplayText(item.Status, "")
	item.Summary = sanitizeDisplayText(item.Summary, "当前恢复摘要正在整理中。")
	item.Preview = sanitizeDisplayText(item.Preview, "当前中断预览正在整理中。")
	item.ReplayAnchor = sanitizeDisplayText(item.ReplayAnchor, "")
	item.LastSource = sanitizeDisplayText(item.LastSource, "")
	for index := range item.Events {
		item.Events[index] = sanitizeSessionRecoveryEvent(item.Events[index])
	}
	return item
}

func sanitizeGuard(item store.DestructiveGuard) store.DestructiveGuard {
	item.Title = sanitizeDisplayText(item.Title, "待整理 Guard")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 guard 摘要正在整理中。")
	item.Risk = sanitizeDisplayText(item.Risk, "当前风险标签正在整理中。")
	item.Scope = sanitizeDisplayText(item.Scope, "当前影响范围正在整理中。")
	for index := range item.Boundaries {
		item.Boundaries[index] = sanitizeGuardBoundary(item.Boundaries[index])
	}
	return item
}

func sanitizeAuthSnapshot(snapshot store.AuthSnapshot) store.AuthSnapshot {
	snapshot.Session = sanitizeAuthSession(snapshot.Session)
	for index := range snapshot.Roles {
		snapshot.Roles[index] = sanitizeWorkspaceRole(snapshot.Roles[index])
	}
	for index := range snapshot.Members {
		snapshot.Members[index] = sanitizeWorkspaceMember(snapshot.Members[index])
	}
	for index := range snapshot.Devices {
		snapshot.Devices[index] = sanitizeAuthDevice(snapshot.Devices[index])
	}
	for index := range snapshot.Challenges {
		snapshot.Challenges[index] = sanitizeAuthChallenge(snapshot.Challenges[index])
	}
	return snapshot
}

func redactAuthSnapshotForViewer(snapshot store.AuthSnapshot) store.AuthSnapshot {
	session := snapshot.Session
	if strings.TrimSpace(session.Status) != authSessionStatusActive {
		snapshot.Members = []store.WorkspaceMember{}
		snapshot.Devices = []store.AuthDevice{}
		snapshot.Challenges = []store.AuthChallenge{}
		return snapshot
	}
	if authSessionHasRawPermission(session, "members.manage") {
		return snapshot
	}

	memberID := strings.TrimSpace(session.MemberID)
	email := strings.TrimSpace(session.Email)

	filteredMembers := make([]store.WorkspaceMember, 0, 1)
	for _, member := range snapshot.Members {
		if member.ID == memberID {
			filteredMembers = append(filteredMembers, member)
			break
		}
	}
	snapshot.Members = filteredMembers

	filteredDevices := make([]store.AuthDevice, 0, len(snapshot.Devices))
	for _, device := range snapshot.Devices {
		if device.MemberID == memberID || device.ID == session.DeviceID {
			filteredDevices = append(filteredDevices, device)
		}
	}
	snapshot.Devices = filteredDevices

	filteredChallenges := make([]store.AuthChallenge, 0, len(snapshot.Challenges))
	for _, challenge := range snapshot.Challenges {
		if challenge.MemberID == memberID || strings.EqualFold(strings.TrimSpace(challenge.Email), email) {
			filteredChallenges = append(filteredChallenges, challenge)
		}
	}
	snapshot.Challenges = filteredChallenges
	return snapshot
}

func sanitizeWorkspaceRepoBinding(item store.WorkspaceRepoBindingSnapshot) store.WorkspaceRepoBindingSnapshot {
	item.Repo = sanitizeDisplayText(item.Repo, "当前仓库绑定真值正在整理中。")
	item.RepoURL = sanitizeDisplayText(item.RepoURL, "")
	item.Branch = sanitizeDisplayTextOrFallback(item.Branch, "待整理分支")
	item.Provider = sanitizeDisplayText(item.Provider, "待整理仓库提供方")
	item.BindingStatus = sanitizeDisplayText(item.BindingStatus, "当前绑定状态正在整理中。")
	item.AuthMode = sanitizeDisplayText(item.AuthMode, "当前认证模式正在整理中。")
	return item
}

func sanitizeWorkspaceGitHubInstall(item store.WorkspaceGitHubInstallSnapshot) store.WorkspaceGitHubInstallSnapshot {
	item.Provider = sanitizeDisplayText(item.Provider, "github")
	item.PreferredAuthMode = sanitizeDisplayText(item.PreferredAuthMode, "")
	item.InstallationID = sanitizeDisplayText(item.InstallationID, "")
	item.InstallationURL = sanitizeDisplayText(item.InstallationURL, "")
	item.Missing = sanitizeTextLines(item.Missing, "当前 GitHub 安装缺口正在整理中。")
	item.ConnectionMessage = sanitizeDisplayText(item.ConnectionMessage, "GitHub 连接说明正在整理中。")
	return item
}

func sanitizeWorkspaceOnboarding(item store.WorkspaceOnboardingSnapshot) store.WorkspaceOnboardingSnapshot {
	item.Status = sanitizeDisplayText(item.Status, "当前 onboarding 状态正在整理中。")
	item.TemplateID = sanitizeDisplayText(item.TemplateID, "")
	item.CurrentStep = sanitizeDisplayText(item.CurrentStep, "")
	item.CompletedSteps = sanitizeTextLines(item.CompletedSteps, "")
	item.ResumeURL = sanitizeDisplayText(item.ResumeURL, "")
	item.Materialization = sanitizeWorkspaceOnboardingMaterialization(item.Materialization)
	return item
}

func sanitizeWorkspaceOnboardingMaterialization(item store.WorkspaceOnboardingMaterialization) store.WorkspaceOnboardingMaterialization {
	item.Label = sanitizeDisplayText(item.Label, "")
	item.Channels = sanitizeTextLines(item.Channels, "")
	item.Roles = sanitizeOnboardingRoleLabels(item.Roles)
	item.Agents = sanitizeOnboardingAgentLabels(item.Agents)
	item.NotificationPolicy = rewriteOnboardingPackageText(sanitizeDisplayText(item.NotificationPolicy, ""))
	item.Notes = sanitizeOnboardingPackageLines(item.Notes, "onboarding 说明正在整理中。")
	return item
}

func sanitizeOnboardingRoleLabels(lines []string) []string {
	items := make([]string, 0, len(lines))
	for _, line := range lines {
		sanitized := sanitizeDisplayText(line, "")
		switch sanitized {
		case "Owner / Member / Viewer":
			items = append(items, "所有者", "成员", "访客")
		case "PM":
			items = append(items, "目标")
		case "Architect":
			items = append(items, "边界")
		case "Developer":
			items = append(items, "实现")
		case "Reviewer", "Peer Reviewer":
			items = append(items, "评审")
		case "QA":
			items = append(items, "验证")
		case "Research Lead", "Lead Operator":
			items = append(items, "方向")
		case "Collector", "Field Collector":
			items = append(items, "采集")
		case "Synthesizer":
			items = append(items, "归纳")
		case "Owner":
			items = append(items, "所有者")
		case "Member":
			items = append(items, "成员")
		case "Viewer":
			items = append(items, "访客")
		default:
			items = append(items, rewriteOnboardingPackageText(sanitized))
		}
	}
	return items
}

func sanitizeOnboardingAgentLabels(lines []string) []string {
	items := make([]string, 0, len(lines))
	for _, line := range lines {
		sanitized := sanitizeDisplayText(line, "")
		switch sanitized {
		case "Codex Dockmaster":
			items = append(items, "需求智能体")
		case "Spec Captain":
			items = append(items, "需求智能体")
		case "Build Pilot":
			items = append(items, "开发智能体")
		case "Claude Review Runner":
			items = append(items, "评审智能体")
		case "Review Runner", "Reviewer", "Peer Reviewer":
			items = append(items, "评审智能体")
		case "Memory Clerk":
			items = append(items, "测试智能体")
		case "QA Relay":
			items = append(items, "测试智能体")
		case "Lead Operator", "Research Lead":
			items = append(items, "总控智能体")
		case "Collector", "Field Collector":
			items = append(items, "采集智能体")
		case "Synthesizer":
			items = append(items, "归纳智能体")
		default:
			items = append(items, rewriteOnboardingPackageText(sanitized))
		}
	}
	return items
}

func sanitizeOnboardingPackageLines(lines []string, fallback string) []string {
	items := make([]string, len(lines))
	for index, line := range lines {
		items[index] = rewriteOnboardingPackageText(sanitizeDisplayText(line, fallback))
	}
	return items
}

func rewriteOnboardingPackageText(value string) string {
	replacements := []struct {
		from string
		to   string
	}{
		{"blocked / review / release gate 优先推送", "优先推送阻塞、评审和发布门事件"},
		{"evidence ready / synthesis blocked / reviewer feedback 优先推送", "优先推送证据就绪、综合阻塞和复核反馈"},
		{"只推高优先级与显式 review 事件", "只推高优先级与显式评审事件"},
		{"Owner / Member / Viewer", "所有者 / 成员 / 访客"},
		{"Research Lead", "方向"},
		{"Lead Operator", "总控智能体"},
		{"Codex Dockmaster", "需求智能体"},
		{"Spec Captain", "需求智能体"},
		{"Build Pilot", "开发智能体"},
		{"Claude Review Runner", "评审智能体"},
		{"Review Runner", "评审智能体"},
		{"Memory Clerk", "测试智能体"},
		{"QA Relay", "测试智能体"},
	}
	next := value
	for _, replacement := range replacements {
		next = strings.ReplaceAll(next, replacement.from, replacement.to)
	}
	return next
}

func sanitizeAgentProfileAuditEntry(item store.AgentProfileAuditEntry) store.AgentProfileAuditEntry {
	item.UpdatedBy = sanitizeDisplayText(item.UpdatedBy, "OpenShock Agent")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 Agent profile 变更摘要正在整理中。")
	for index := range item.Changes {
		item.Changes[index] = sanitizeAgentProfileAuditChange(item.Changes[index])
	}
	return item
}

func sanitizeAgentProfileAuditChange(item store.AgentProfileAuditChange) store.AgentProfileAuditChange {
	item.Field = sanitizeDisplayText(item.Field, "field")
	item.Previous = sanitizeDisplayText(item.Previous, "当前旧值正在整理中。")
	item.Current = sanitizeDisplayText(item.Current, "当前新值正在整理中。")
	return item
}

func sanitizeRuntimeProvider(item store.RuntimeProvider) store.RuntimeProvider {
	item.Label = sanitizeDisplayText(item.Label, "当前 provider 标签正在整理中。")
	item.Mode = sanitizeDisplayText(item.Mode, "当前 provider 模式正在整理中。")
	item.Capabilities = sanitizeTextLines(item.Capabilities, "当前 capability 正在整理中。")
	item.Models = sanitizeTextLines(item.Models, "当前模型目录正在整理中。")
	item.Transport = sanitizeDisplayText(item.Transport, "当前 transport 正在整理中。")
	return item
}

func sanitizeRuntimeSchedulerCandidate(item store.RuntimeSchedulerCandidate) store.RuntimeSchedulerCandidate {
	item.Runtime = sanitizeDisplayText(item.Runtime, "待整理运行环境")
	item.Machine = sanitizeDisplayText(item.Machine, "待整理机器")
	item.Reason = sanitizeDisplayText(item.Reason, "当前安排原因正在整理中。")
	return item
}

func sanitizeGuardBoundary(item store.GuardBoundary) store.GuardBoundary {
	item.Label = sanitizeDisplayText(item.Label, "Boundary")
	item.Value = sanitizeDisplayText(item.Value, "当前 guard boundary 正在整理中。")
	return item
}

func sanitizeCredentialProfile(item store.CredentialProfile) store.CredentialProfile {
	item.Label = sanitizeDisplayText(item.Label, "credential")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 credential 摘要正在整理中。")
	item.SecretKind = sanitizeDisplayText(item.SecretKind, "opaque-secret")
	item.SecretStatus = sanitizeDisplayText(item.SecretStatus, "configured")
	item.UpdatedBy = sanitizeDisplayText(item.UpdatedBy, "System")
	item.LastUsedBy = sanitizeDisplayText(item.LastUsedBy, "")
	for index := range item.Audit {
		item.Audit[index] = sanitizeCredentialProfileAuditEntry(item.Audit[index])
	}
	return item
}

func sanitizeCredentialProfileAuditEntry(item store.CredentialProfileAuditEntry) store.CredentialProfileAuditEntry {
	item.Action = sanitizeDisplayText(item.Action, "updated")
	item.Summary = sanitizeDisplayText(item.Summary, "当前 credential audit 正在整理中。")
	item.UpdatedBy = sanitizeDisplayText(item.UpdatedBy, "System")
	return item
}

func sanitizeAuthSession(item store.AuthSession) store.AuthSession {
	item.Email = sanitizeDisplayText(item.Email, "")
	item.Name = sanitizeDisplayText(item.Name, "Workspace Member")
	item.Role = sanitizeDisplayText(item.Role, "")
	item.AuthMethod = sanitizeDisplayText(item.AuthMethod, "")
	item.DeviceID = sanitizeDisplayText(item.DeviceID, "")
	item.DeviceLabel = sanitizeDisplayText(item.DeviceLabel, "当前设备标签正在整理中。")
	item.DeviceAuthStatus = sanitizeDisplayText(item.DeviceAuthStatus, "")
	item.EmailVerificationStatus = sanitizeDisplayText(item.EmailVerificationStatus, "")
	item.PasswordResetStatus = sanitizeDisplayText(item.PasswordResetStatus, "")
	item.RecoveryStatus = sanitizeDisplayText(item.RecoveryStatus, "")
	item.GitHubIdentity = sanitizeAuthExternalIdentity(item.GitHubIdentity)
	item.Preferences = sanitizeWorkspaceMemberPreferences(item.Preferences)
	for index := range item.LinkedIdentities {
		item.LinkedIdentities[index] = sanitizeAuthExternalIdentity(item.LinkedIdentities[index])
	}
	item.Permissions = sanitizeTextLines(item.Permissions, "")
	return item
}

func sanitizeWorkspaceRole(item store.WorkspaceRole) store.WorkspaceRole {
	item.Label = sanitizeDisplayText(item.Label, "当前角色标签正在整理中。")
	item.Summary = sanitizeDisplayText(item.Summary, "角色说明正在整理中。")
	item.Permissions = sanitizeTextLines(item.Permissions, "")
	return item
}

func sanitizeWorkspaceMember(item store.WorkspaceMember) store.WorkspaceMember {
	item.Email = sanitizeDisplayText(item.Email, "")
	item.Name = sanitizeDisplayText(item.Name, "Workspace Member")
	item.Role = sanitizeDisplayText(item.Role, "")
	item.Source = sanitizeDisplayText(item.Source, "")
	item.RecoveryEmail = sanitizeDisplayText(item.RecoveryEmail, "")
	item.EmailVerificationStatus = sanitizeDisplayText(item.EmailVerificationStatus, "")
	item.PasswordResetStatus = sanitizeDisplayText(item.PasswordResetStatus, "")
	item.RecoveryStatus = sanitizeDisplayText(item.RecoveryStatus, "")
	item.GitHubIdentity = sanitizeAuthExternalIdentity(item.GitHubIdentity)
	item.Preferences = sanitizeWorkspaceMemberPreferences(item.Preferences)
	for index := range item.LinkedIdentities {
		item.LinkedIdentities[index] = sanitizeAuthExternalIdentity(item.LinkedIdentities[index])
	}
	item.TrustedDeviceIDs = sanitizeTextLines(item.TrustedDeviceIDs, "")
	item.Permissions = sanitizeTextLines(item.Permissions, "")
	return item
}

func sanitizeWorkspaceMemberPreferences(item store.WorkspaceMemberPreferences) store.WorkspaceMemberPreferences {
	item.PreferredAgentID = sanitizeDisplayText(item.PreferredAgentID, "")
	item.StartRoute = sanitizeDisplayText(item.StartRoute, "")
	return item
}

func sanitizeAuthExternalIdentity(item store.AuthExternalIdentity) store.AuthExternalIdentity {
	item.Provider = sanitizeDisplayText(item.Provider, "")
	item.Handle = sanitizeDisplayText(item.Handle, "当前外部身份 handle 正在整理中。")
	item.Status = sanitizeDisplayText(item.Status, "")
	return item
}

func sanitizeAuthDevice(item store.AuthDevice) store.AuthDevice {
	item.MemberID = sanitizeDisplayText(item.MemberID, "")
	item.Label = sanitizeDisplayText(item.Label, "当前设备标签正在整理中。")
	item.Status = sanitizeDisplayText(item.Status, "")
	return item
}

func sanitizeAuthChallenge(item store.AuthChallenge) store.AuthChallenge {
	item.MemberID = sanitizeDisplayText(item.MemberID, "")
	item.Kind = sanitizeDisplayText(item.Kind, "")
	item.Email = sanitizeDisplayText(item.Email, "")
	item.DeviceID = sanitizeDisplayText(item.DeviceID, "")
	item.Status = sanitizeDisplayText(item.Status, "")
	return item
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

func sanitizeTextLinesOrFallback(lines []string, fallback string) []string {
	items := make([]string, len(lines))
	for index, line := range lines {
		items[index] = sanitizeDisplayTextOrFallback(line, fallback)
	}
	return items
}

func sanitizeDisplayText(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	rewritten := rewriteCustomerFacingText(trimmed)
	if looksLikeLiveTruthLeak(rewritten) {
		return fallback
	}
	return rewritten
}

func sanitizeDisplayTextOrFallback(value, fallback string) string {
	sanitized := sanitizeDisplayText(value, fallback)
	if strings.TrimSpace(sanitized) == "" {
		return fallback
	}
	return sanitized
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

func rewriteCustomerFacingText(value string) string {
	next := value
	next = runtimeSchedulerFallbackStatePattern.ReplaceAllString(next, "当前仍指向工作区默认运行环境 $1。")
	next = runtimeSchedulerOwnerSummaryPattern.ReplaceAllString(next, "已按 $1 偏好安排到 $2，当前有 $3 条执行。")
	next = runtimeSchedulerSelectedPattern.ReplaceAllString(next, "继续使用 $1，当前有 $2 条执行。")
	next = runtimeSchedulerFailoverPattern.ReplaceAllString(next, "$1 当前不可用，已切到 $2，当前有 $3 条执行。")
	next = runtimeSchedulerLeastLoadedPattern.ReplaceAllString(next, "已安排到 $1，当前有 $2 条执行。")
	next = runtimeSchedulerOwnerReasonPattern.ReplaceAllString(next, "按智能体偏好安排，当前有 $1 条执行。")
	next = runtimeSchedulerSelectedReasonPattern.ReplaceAllString(next, "沿用当前选择，当前有 $1 条执行。")
	next = runtimeSchedulerFailoverReasonPattern.ReplaceAllString(next, "承接 $1 的切换，当前有 $2 条执行。")
	next = runtimeSchedulerPressureReasonPattern.ReplaceAllString(next, "按当前压力安排，当前有 $1 条执行。")
	next = runtimeSchedulerStateReasonPattern.ReplaceAllStringFunc(next, func(text string) string {
		matches := runtimeSchedulerStateReasonPattern.FindStringSubmatch(text)
		if len(matches) != 2 {
			return text
		}
		return "当前" + runtimeSchedulerStateLabel(matches[1]) + "，暂不可调度。"
	})
	next = runtimeSchedulerPreferredSkipPattern.ReplaceAllString(next, "首选运行环境暂不可调度，已跳过。")
	next = runtimeSchedulerActiveLeasePattern.ReplaceAllString(next, "当前有 $1 条执行。")
	next = runtimeSchedulerUnavailablePattern.ReplaceAllString(next, "当前没有可用运行环境。")
	next = runtimeSchedulerOpenLanePattern.ReplaceAllString(next, "可以接新事项。")
	next = runtimeSchedulerUnpairedPattern.ReplaceAllString(next, "还没配对，暂不可调度。")
	next = runtimeSchedulerTimelineFailoverPattern.ReplaceAllString(next, "运行环境已切到 $1")
	next = runtimeSchedulerTimelineAssignedPattern.ReplaceAllString(next, "运行环境已分配到 $1")
	return next
}

func runtimeSchedulerStateLabel(state string) string {
	switch strings.TrimSpace(state) {
	case "offline":
		return "离线"
	case "stale":
		return "心跳过期"
	default:
		return strings.TrimSpace(state)
	}
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
