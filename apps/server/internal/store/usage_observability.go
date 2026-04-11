package store

import (
	"fmt"
	"strings"
	"time"
)

const (
	defaultWorkspaceMaxMachines        = 4
	defaultWorkspaceMaxAgents          = 8
	defaultWorkspaceMaxChannels        = 12
	defaultWorkspaceMaxRooms           = 16
	defaultWorkspaceMessageHistoryDays = 30
	defaultWorkspaceRunLogDays         = 14
	defaultWorkspaceMemoryDraftDays    = 90
)

func (s *Store) refreshUsageObservabilityLocked() {
	refreshUsageObservability(&s.state)
}

func refreshUsageObservability(state *State) {
	refreshedAt := time.Now().UTC().Format(time.RFC3339)

	for index := range state.Runs {
		hydrateRunUsage(&state.Runs[index], refreshedAt)
	}

	for index := range state.Rooms {
		room := &state.Rooms[index]
		hydrateRoomUsage(room, state.RoomMessages[room.ID], findRunForRoom(state.Runs, room.RunID), refreshedAt)
	}

	hydrateWorkspaceObservability(&state.Workspace, state, refreshedAt)
}

func findRunForRoom(runs []Run, runID string) *Run {
	for index := range runs {
		if runs[index].ID == runID {
			return &runs[index]
		}
	}
	return nil
}

func hydrateWorkspaceObservability(workspace *WorkspaceSnapshot, state *State, refreshedAt string) {
	quota := workspace.Quota
	if quota.MaxMachines == 0 {
		quota.MaxMachines = defaultWorkspaceMaxMachines
	}
	if quota.MaxAgents == 0 {
		quota.MaxAgents = defaultWorkspaceMaxAgents
	}
	if quota.MaxChannels == 0 {
		quota.MaxChannels = defaultWorkspaceMaxChannels
	}
	if quota.MaxRooms == 0 {
		quota.MaxRooms = defaultWorkspaceMaxRooms
	}
	if quota.MessageHistoryDays == 0 {
		quota.MessageHistoryDays = defaultWorkspaceMessageHistoryDays
	}
	if quota.RunLogDays == 0 {
		quota.RunLogDays = defaultWorkspaceRunLogDays
	}
	if quota.MemoryDraftDays == 0 {
		quota.MemoryDraftDays = defaultWorkspaceMemoryDraftDays
	}
	quota.UsedMachines = len(state.Machines)
	quota.UsedAgents = len(state.Agents)
	quota.UsedChannels = len(state.Channels)
	quota.UsedRooms = len(state.Rooms)
	if quota.UsedMachines > quota.MaxMachines {
		quota.MaxMachines = quota.UsedMachines
	}
	if quota.UsedAgents > quota.MaxAgents {
		quota.MaxAgents = quota.UsedAgents
	}
	if quota.UsedChannels > quota.MaxChannels {
		quota.MaxChannels = quota.UsedChannels
	}
	if quota.UsedRooms > quota.MaxRooms {
		quota.MaxRooms = quota.UsedRooms
	}
	quota.Status = deriveWorkspaceQuotaStatus(quota)
	quota.Warning = deriveWorkspaceQuotaWarning(quota)
	workspace.Quota = quota

	usage := workspace.Usage
	if strings.TrimSpace(usage.WindowLabel) == "" {
		usage.WindowLabel = "过去 24h"
	}
	usage.RunCount = len(state.Runs)
	usage.MessageCount = countMessages(state.ChannelMessages) + countMessages(state.RoomMessages)
	usage.TotalTokens = 0
	for _, run := range state.Runs {
		usage.TotalTokens += run.Usage.TotalTokens
	}
	usage.RefreshedAt = refreshedAt
	usage.Warning = deriveWorkspaceUsageWarning(*workspace, usage)
	workspace.Usage = usage
}

func hydrateRoomUsage(room *Room, messages []Message, run *Run, refreshedAt string) {
	usage := room.Usage
	if strings.TrimSpace(usage.WindowLabel) == "" {
		usage.WindowLabel = "过去 6h"
	}
	usage.MessageCount = len(messages)
	usage.HumanTurns = countMessagesByRole(messages, "human")
	usage.AgentTurns = countMessagesByRole(messages, "agent")
	usage.TotalTokens = deriveRoomTokenUsage(messages, run)
	usage.RefreshedAt = refreshedAt
	usage.Warning = deriveRoomUsageWarning(*room, usage)
	room.Usage = usage
}

func hydrateRunUsage(run *Run, refreshedAt string) {
	usage := run.Usage
	if usage.PromptTokens == 0 {
		usage.PromptTokens = deriveRunPromptTokens(*run)
	}
	if usage.CompletionTokens == 0 {
		usage.CompletionTokens = deriveRunCompletionTokens(*run)
	}
	if usage.ToolCallCount == 0 {
		usage.ToolCallCount = len(run.ToolCalls)
	}
	if usage.ContextWindow == 0 {
		usage.ContextWindow = deriveRunContextWindow(*run)
	}
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	usage.BudgetStatus = deriveRunBudgetStatus(usage)
	usage.RefreshedAt = refreshedAt
	usage.Warning = deriveRunBudgetWarning(*run, usage)
	run.Usage = usage
}

func countMessages(collection map[string][]Message) int {
	total := 0
	for _, items := range collection {
		total += len(items)
	}
	return total
}

func countMessagesByRole(messages []Message, role string) int {
	total := 0
	for _, message := range messages {
		if message.Role == role {
			total++
		}
	}
	return total
}

func deriveRunPromptTokens(run Run) int {
	wordWeight := len(strings.Fields(run.Summary)) * 24
	return 1200 + len(run.Stdout)*320 + len(run.ToolCalls)*280 + len(run.Timeline)*180 + wordWeight
}

func deriveRunCompletionTokens(run Run) int {
	wordWeight := len(strings.Fields(run.NextAction)) * 16
	return 800 + len(run.Stderr)*220 + len(run.ToolCalls)*150 + len(run.Timeline)*110 + wordWeight
}

func deriveRunContextWindow(run Run) int {
	provider := strings.ToLower(run.Provider)
	if strings.Contains(provider, "claude") {
		return 32000
	}
	return 16000
}

func deriveRunBudgetStatus(usage RunUsageSnapshot) string {
	if usage.ContextWindow <= 0 {
		return "healthy"
	}
	ratio := float64(usage.TotalTokens) / float64(usage.ContextWindow)
	switch {
	case ratio >= 0.6:
		return "near_limit"
	case ratio >= 0.3:
		return "watch"
	default:
		return "healthy"
	}
}

func deriveRunBudgetWarning(run Run, usage RunUsageSnapshot) string {
	switch usage.BudgetStatus {
	case "near_limit":
		return fmt.Sprintf("这条 Run 已吃掉 %d tokens，继续扩 thread 前先压缩上下文或拆下一条 lane。", usage.TotalTokens)
	case "watch":
		return fmt.Sprintf("这条 Run 当前已用 %d tokens；继续拉长协作前先看 context headroom。", usage.TotalTokens)
	default:
		if run.ApprovalRequired {
			return "当前 run 虽未逼近 token 上限，但仍被人工批准闸门锁住。"
		}
		return "当前 token / context headroom 仍健康，可继续沿 Room / Run / PR 收口。"
	}
}

func deriveRoomTokenUsage(messages []Message, run *Run) int {
	base := len(messages)*140 + countMessagesByRole(messages, "human")*80 + countMessagesByRole(messages, "agent")*110
	if run == nil {
		return base
	}
	return run.Usage.TotalTokens + base
}

func deriveRoomUsageWarning(room Room, usage RoomUsageSnapshot) string {
	switch room.Topic.Status {
	case "blocked":
		return "这间房当前是 blocked 态；继续追加消息前先确认是否该升级到 Inbox。"
	case "review":
		return "这间房已进入 review；下一条消息优先围绕 blocker / no-blocker，而不是继续扩 scope。"
	default:
		if usage.TotalTokens > 12000 {
			return "这间房的消息与执行成本已经不低，继续扩 thread 前先确认是否该切出新的 Run。"
		}
		return "房间 usage 仍在可读范围，消息密度与 run cost 可以继续并排观察。"
	}
}

func deriveWorkspaceQuotaStatus(quota WorkspaceQuotaSnapshot) string {
	maxRatio := 0.0
	for _, ratio := range []float64{
		safeRatio(quota.UsedMachines, quota.MaxMachines),
		safeRatio(quota.UsedAgents, quota.MaxAgents),
		safeRatio(quota.UsedChannels, quota.MaxChannels),
		safeRatio(quota.UsedRooms, quota.MaxRooms),
	} {
		if ratio > maxRatio {
			maxRatio = ratio
		}
	}
	switch {
	case maxRatio >= 0.9:
		return "near_limit"
	case maxRatio >= 0.7:
		return "watch"
	default:
		return "healthy"
	}
}

func deriveWorkspaceQuotaWarning(quota WorkspaceQuotaSnapshot) string {
	switch quota.Status {
	case "near_limit":
		return "workspace 的 seat / channel / room 配额已经逼近上限，下一张票优先补 retain / cleanup / archive 动作。"
	case "watch":
		return "workspace 配额正在进入 watch 区，后续新增 room 或 citizen 前先看 plan headroom。"
	default:
		return "当前配额状态正常。"
	}
}

func deriveWorkspaceUsageWarning(workspace WorkspaceSnapshot, usage WorkspaceUsageSnapshot) string {
	if usage.TotalTokens >= 14000 {
		return "过去 24h 的 token 消耗已经过万，下一拍优先围绕高成本 room/run 做 drill-down。"
	}
	return fmt.Sprintf("%s 当前运行正常。", defaultString(workspace.Plan, "当前计划"))
}

func safeRatio(used, limit int) float64 {
	if limit <= 0 {
		return 0
	}
	return float64(used) / float64(limit)
}
