package store

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
)

type governanceTemplateDefinition struct {
	TemplateID        string
	Label             string
	Summary           string
	Topology          []governanceTemplateLaneDefinition
	TimeoutMinutes    int
	RetryBudget       int
	EscalationChannel string
}

type governanceTemplateLaneDefinition struct {
	ID           string
	Label        string
	Role         string
	DefaultAgent string
	Lane         string
}

type governanceFocus struct {
	Issue            *Issue
	Room             *Room
	Run              *Run
	PullRequest      *PullRequest
	LatestHandoff    *AgentHandoff
	LatestCompletion *AgentHandoff
	RelatedInbox     []InboxItem
	ReviewInbox      []InboxItem
	BlockedInbox     []InboxItem
	ApprovalInbox    []InboxItem
}

func governanceTemplateFor(templateID string) governanceTemplateDefinition {
	switch canonicalWorkspaceOnboardingTemplateID(templateID) {
	case "research-team":
		return governanceTemplateDefinition{
			TemplateID:        "research-team",
			Label:             "研究团队协作流",
			Summary:           "研究团队模板会提供资料收集、分析整理和复核分工。",
			TimeoutMinutes:    30,
			RetryBudget:       2,
			EscalationChannel: "交接箱 -> 收件箱 -> 当前处理人",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "lead", Label: "Research Lead", Role: "方向与结论", DefaultAgent: "Lead Operator", Lane: "目标确认 / 最终回复"},
				{ID: "collector", Label: "Collector", Role: "资料收集", DefaultAgent: "Collector", Lane: "收集 / 整理"},
				{ID: "synthesizer", Label: "Synthesizer", Role: "归纳与草案", DefaultAgent: "Synthesizer", Lane: "整理 / 草案"},
				{ID: "reviewer", Label: "Reviewer", Role: "结论复核", DefaultAgent: "Claude Review Runner", Lane: "复核 / 发布"},
			},
		}
	case "blank-custom":
		return governanceTemplateDefinition{
			TemplateID:        "blank-custom",
			Label:             "自定义协作流",
			Summary:           "空白模板只提供最基础的分工和协作设置。",
			TimeoutMinutes:    45,
			RetryBudget:       1,
			EscalationChannel: "交接箱 -> 收件箱 -> 当前处理人",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "owner", Label: "Owner", Role: "目标与验收", DefaultAgent: "启动智能体", Lane: "目标确认 / 最终回复"},
				{ID: "member", Label: "Member", Role: "执行与整理", DefaultAgent: "启动智能体", Lane: "处理 / 整理"},
				{ID: "reviewer", Label: "Reviewer", Role: "复核与阻塞处理", DefaultAgent: "评审智能体", Lane: "复核 / 处理阻塞"},
			},
		}
	default:
		return governanceTemplateDefinition{
			TemplateID:        "dev-team",
			Label:             "开发团队协作流",
			Summary:           "开发团队模板会提供产品、开发、评审和测试协作分工。",
			TimeoutMinutes:    20,
			RetryBudget:       2,
			EscalationChannel: "交接箱 -> 收件箱 -> 人工接管",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "pm", Label: "PM", Role: "目标与验收", DefaultAgent: "Codex Dockmaster", Lane: "目标确认 / 最终回复"},
				{ID: "architect", Label: "Architect", Role: "拆解与边界", DefaultAgent: "Codex Dockmaster", Lane: "拆解 / 边界"},
				{ID: "developer", Label: "Developer", Role: "实现与推进", DefaultAgent: "Build Pilot", Lane: "实现 / 提交"},
				{ID: "reviewer", Label: "Reviewer", Role: "评审与结论", DefaultAgent: "Claude Review Runner", Lane: "评审 / 回退"},
				{ID: "qa", Label: "QA", Role: "验证与交付确认", DefaultAgent: "Memory Clerk", Lane: "验证 / 交付"},
			},
		}
	}
}

func defaultWorkspaceGovernanceTopology(templateID string) []WorkspaceGovernanceLaneConfig {
	template := governanceTemplateFor(templateID)
	configured := make([]WorkspaceGovernanceLaneConfig, 0, len(template.Topology))
	for _, lane := range template.Topology {
		configured = append(configured, WorkspaceGovernanceLaneConfig{
			ID:           lane.ID,
			Label:        lane.Label,
			Role:         lane.Role,
			DefaultAgent: lane.DefaultAgent,
			Lane:         lane.Lane,
		})
	}
	return configured
}

func configuredGovernanceTemplate(template governanceTemplateDefinition, configured []WorkspaceGovernanceLaneConfig) governanceTemplateDefinition {
	if len(configured) == 0 {
		return template
	}

	effective := template
	effective.Topology = make([]governanceTemplateLaneDefinition, 0, len(configured))
	for _, lane := range configured {
		effective.Topology = append(effective.Topology, governanceTemplateLaneDefinition{
			ID:           lane.ID,
			Label:        lane.Label,
			Role:         lane.Role,
			DefaultAgent: lane.DefaultAgent,
			Lane:         lane.Lane,
		})
	}
	return effective
}

func governanceTopologyCustomized(configured []WorkspaceGovernanceLaneConfig, template []governanceTemplateLaneDefinition) bool {
	if len(configured) != len(template) {
		return true
	}
	for index := range configured {
		if configured[index].ID != template[index].ID ||
			configured[index].Label != template[index].Label ||
			configured[index].Role != template[index].Role ||
			configured[index].DefaultAgent != template[index].DefaultAgent ||
			configured[index].Lane != template[index].Lane {
			return true
		}
	}
	return false
}

func hydrateWorkspaceGovernance(workspace *WorkspaceSnapshot, state *State) {
	template := governanceTemplateFor(workspace.Onboarding.TemplateID)
	configuredTopology := append([]WorkspaceGovernanceLaneConfig{}, workspace.Governance.ConfiguredTopology...)
	if len(configuredTopology) == 0 {
		configuredTopology = defaultWorkspaceGovernanceTopology(template.TemplateID)
	}
	customizedTopology := governanceTopologyCustomized(configuredTopology, template.Topology)
	effectiveTemplate := configuredGovernanceTemplate(template, configuredTopology)
	focus := resolveGovernanceFocus(*state)
	stats := buildGovernanceStats(*state)
	humanOverride := buildHumanOverride(focus)
	routingPolicy := buildGovernanceRoutingPolicy(effectiveTemplate, *state, focus, humanOverride)
	escalationSLA := buildGovernanceEscalationSLA(effectiveTemplate, *state, focus)
	notificationPolicy := buildGovernanceNotificationPolicy(*workspace, effectiveTemplate, focus)
	responseAggregation := buildResponseAggregation(*state, focus, humanOverride, routingPolicy.SuggestedHandoff)
	deliveryDelegationMode := workspaceGovernanceDeliveryDelegationMode(*workspace)
	stats.SLABreaches = escalationSLA.BreachedEscalations
	stats.AggregationSources = len(responseAggregation.Sources)

	summary := effectiveTemplate.Summary
	if customizedTopology {
		summary = fmt.Sprintf("%s 当前启用了 %d 个分工；后续会按同一套分工继续推进。", template.Label, len(effectiveTemplate.Topology))
	}
	if focus.Issue != nil {
		if customizedTopology {
			summary = fmt.Sprintf("%s 当前围绕 %s 推进，已按 %d 个分工串起事项、交接、评审、验证和最终回复。", template.Label, focus.Issue.Key, len(effectiveTemplate.Topology))
		} else {
			summary = fmt.Sprintf("%s 当前围绕 %s 推进，已经把事项、交接、评审、验证和最终回复收成一条连续流程。", template.Label, focus.Issue.Key)
		}
	}
	if deliveryDelegationMode == governanceDeliveryDelegationModeSignalOnly {
		summary += " 交付结果当前只发提醒，不再自动新建收尾交接。"
	} else if deliveryDelegationMode == governanceDeliveryDelegationModeAutoComplete {
		summary += " 交付结果当前会直接收口，不再额外新建收尾交接。"
	}

	workspace.Governance = WorkspaceGovernanceSnapshot{
		TemplateID:             effectiveTemplate.TemplateID,
		Label:                  effectiveTemplate.Label,
		Summary:                summary,
		ConfiguredTopology:     configuredTopology,
		DeliveryDelegationMode: deliveryDelegationMode,
		TeamTopology:           buildGovernanceTeamTopology(effectiveTemplate, focus, humanOverride),
		HandoffRules:           buildGovernanceRules(focus, stats, humanOverride),
		RoutingPolicy:          routingPolicy,
		EscalationSLA:          escalationSLA,
		NotificationPolicy:     notificationPolicy,
		ResponseAggregation:    responseAggregation,
		HumanOverride:          humanOverride,
		Walkthrough:            buildGovernanceWalkthrough(focus, responseAggregation),
		Stats:                  stats,
	}
}

func resolveGovernanceFocus(state State) governanceFocus {
	return resolveGovernanceFocusForRoom(state, "")
}

func resolveGovernanceFocusForRoom(state State, preferredRoomID string) governanceFocus {
	focus := governanceFocus{}
	roomID := strings.TrimSpace(preferredRoomID)

	if roomID == "" && len(state.Mailbox) > 0 {
		for _, candidate := range state.Mailbox {
			if isGovernanceSidecarHandoff(candidate.Kind) {
				continue
			}
			handoff := candidate
			focus.LatestHandoff = &handoff
			roomID = handoff.RoomID
			break
		}
	}
	if roomID == "" {
		for _, run := range state.Runs {
			if run.Status == "running" || run.Status == "review" || run.Status == "blocked" {
				roomID = run.RoomID
				break
			}
		}
	}
	if roomID == "" && len(state.Rooms) > 0 {
		roomID = state.Rooms[0].ID
	}

	if roomID != "" {
		for index := range state.Rooms {
			if state.Rooms[index].ID == roomID {
				focus.Room = &state.Rooms[index]
				break
			}
		}
		if focus.Room != nil && strings.TrimSpace(focus.Room.RunID) != "" {
			for index := range state.Runs {
				if state.Runs[index].ID == focus.Room.RunID {
					focus.Run = &state.Runs[index]
					break
				}
			}
		}
		if focus.Run == nil {
			for index := range state.Runs {
				if state.Runs[index].RoomID == roomID {
					focus.Run = &state.Runs[index]
					break
				}
			}
		}
		for index := range state.Issues {
			if state.Issues[index].RoomID == roomID {
				focus.Issue = &state.Issues[index]
				break
			}
		}
		for index := range state.PullRequests {
			if state.PullRequests[index].RoomID == roomID {
				focus.PullRequest = &state.PullRequests[index]
				break
			}
		}
	}

	for _, handoff := range state.Mailbox {
		if isGovernanceSidecarHandoff(handoff.Kind) {
			continue
		}
		if roomID != "" && handoff.RoomID != roomID {
			continue
		}
		if focus.LatestHandoff == nil {
			item := handoff
			focus.LatestHandoff = &item
		}
		if handoff.Status == "completed" {
			item := handoff
			focus.LatestCompletion = &item
			break
		}
	}

	for _, item := range state.Inbox {
		if roomID != "" && !strings.Contains(item.Href, roomID) && (focus.Run == nil || !strings.Contains(item.Href, focus.Run.ID)) {
			continue
		}
		focus.RelatedInbox = append(focus.RelatedInbox, item)
		switch item.Kind {
		case "review":
			focus.ReviewInbox = append(focus.ReviewInbox, item)
		case "blocked":
			focus.BlockedInbox = append(focus.BlockedInbox, item)
		case "approval":
			focus.ApprovalInbox = append(focus.ApprovalInbox, item)
		}
	}

	return focus
}

func isGovernanceSidecarHandoff(kind string) bool {
	switch strings.TrimSpace(kind) {
	case handoffKindDeliveryCloseout, handoffKindDeliveryReply:
		return true
	default:
		return false
	}
}

func buildGovernanceStats(state State) WorkspaceGovernanceStats {
	stats := WorkspaceGovernanceStats{}
	for _, handoff := range state.Mailbox {
		if handoff.Status != "completed" {
			stats.OpenHandoffs++
		}
		if handoff.Status == "blocked" {
			stats.BlockedEscalations++
		}
	}
	for _, item := range state.Inbox {
		switch item.Kind {
		case "blocked":
			stats.BlockedEscalations++
		case "review":
			stats.ReviewGates++
		case "approval":
			stats.HumanOverrideGates++
		}
	}
	for _, pullRequest := range state.PullRequests {
		if pullRequest.Status == "open" || pullRequest.Status == "in_review" || pullRequest.Status == "changes_requested" {
			stats.ReviewGates++
		}
	}
	return stats
}

func buildGovernanceRoutingPolicy(template governanceTemplateDefinition, state State, focus governanceFocus, humanOverride WorkspaceHumanOverride) WorkspaceGovernanceRoutingPolicy {
	defaultRouteParts := make([]string, 0, len(template.Topology))
	rules := make([]WorkspaceGovernanceRouteRule, 0, len(template.Topology))

	for index, lane := range template.Topology {
		defaultRouteParts = append(defaultRouteParts, lane.Label)
		if index == len(template.Topology)-1 {
			continue
		}
		nextLane := template.Topology[index+1]
		status := "pending"
		summary := fmt.Sprintf("%s 默认会把当前事项交给 %s，并继续处理%s。", lane.Label, nextLane.Label, defaultString(strings.TrimSpace(nextLane.Role), "后续工作"))
		if focus.LatestHandoff != nil && governanceRouteMatches(*focus.LatestHandoff, lane, nextLane) {
			status = governanceStatusFromHandoff(focus.LatestHandoff.Status)
			summary = fmt.Sprintf("最新交接已经按 %s 交给 %s。", lane.Label, nextLane.Label)
		} else if index == 0 && focus.Issue != nil {
			status = "ready"
			summary = fmt.Sprintf("%s 已经接住 %s，接下来会继续往下分工。", lane.Label, focus.Issue.Key)
		} else if isGovernanceReviewLane(nextLane) && (focus.PullRequest != nil || len(focus.ReviewInbox) > 0) {
			status = "active"
			summary = fmt.Sprintf("已经出现待评审事项，接下来会交给 %s。", nextLane.Label)
		}
		rules = append(rules, WorkspaceGovernanceRouteRule{
			ID:       fmt.Sprintf("%s-to-%s", lane.ID, nextLane.ID),
			Trigger:  fmt.Sprintf("%s_handoff", lane.ID),
			FromLane: lane.Label,
			ToLane:   nextLane.Label,
			Policy:   defaultString(strings.TrimSpace(nextLane.Role), strings.TrimSpace(nextLane.Lane)),
			Summary:  summary,
			Status:   status,
		})
	}

	overrideStatus := humanOverride.Status
	overrideSummary := "所有阻塞和审批都会沿交接箱、收件箱和人工处理这条路径收口。"
	if humanOverride.Status == "required" || humanOverride.Status == "watch" {
		overrideSummary = humanOverride.Summary
	}
	rules = append(rules, WorkspaceGovernanceRouteRule{
		ID:       "escalate-to-human",
		Trigger:  "blocked_or_approval",
		FromLane: "任意步骤",
		ToLane:   "人工接管",
		Policy:   "交接箱 -> 收件箱 -> 人工处理",
		Summary:  overrideSummary,
		Status:   overrideStatus,
	})

	status := "ready"
	summary := fmt.Sprintf("默认顺序：%s。", strings.Join(defaultRouteParts, " -> "))
	for _, rule := range rules {
		switch rule.Status {
		case "blocked":
			status = "blocked"
			summary = fmt.Sprintf("当前安排被 %s 卡住：%s。", rule.ID, rule.Summary)
			return WorkspaceGovernanceRoutingPolicy{
				Status:           status,
				Summary:          summary,
				DefaultRoute:     strings.Join(defaultRouteParts, " -> "),
				Rules:            rules,
				SuggestedHandoff: buildGovernanceSuggestedHandoff(state, template, focus),
			}
		case "active":
			status = "active"
			summary = fmt.Sprintf("当前正在按这条顺序推进：%s。", rule.Summary)
		}
	}

	return WorkspaceGovernanceRoutingPolicy{
		Status:           status,
		Summary:          summary,
		DefaultRoute:     strings.Join(defaultRouteParts, " -> "),
		Rules:            rules,
		SuggestedHandoff: buildGovernanceSuggestedHandoff(state, template, focus),
	}
}

func buildGovernanceSuggestedHandoff(state State, template governanceTemplateDefinition, focus governanceFocus) WorkspaceGovernanceSuggestedHandoff {
	result := WorkspaceGovernanceSuggestedHandoff{
		Status: "pending",
		Reason: "暂无明确下一步建议。",
	}

	if focus.Room == nil || focus.Issue == nil {
		return result
	}

	result.RoomID = focus.Room.ID
	result.IssueKey = focus.Issue.Key

	if focus.LatestHandoff != nil && focus.LatestHandoff.Status != "completed" {
		fromLane := governanceLaneByAgentName(template.Topology, state.Agents, focus.LatestHandoff.FromAgent)
		toLane := governanceLaneByAgentName(template.Topology, state.Agents, focus.LatestHandoff.ToAgent)
		href := mailboxInboxHref(focus.LatestHandoff.ID, focus.LatestHandoff.RoomID)
		return WorkspaceGovernanceSuggestedHandoff{
			Status:        "active",
			Reason:        fmt.Sprintf("交接已在进行中；先继续 %s -> %s，避免重复创建。", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent),
			RoomID:        focus.LatestHandoff.RoomID,
			IssueKey:      focus.LatestHandoff.IssueKey,
			FromLaneID:    defaultString(laneIDOrEmpty(fromLane), ""),
			FromLaneLabel: defaultString(laneLabelOrEmpty(fromLane), ""),
			FromAgentID:   focus.LatestHandoff.FromAgentID,
			FromAgent:     focus.LatestHandoff.FromAgent,
			ToLaneID:      defaultString(laneIDOrEmpty(toLane), ""),
			ToLaneLabel:   defaultString(laneLabelOrEmpty(toLane), ""),
			ToAgentID:     focus.LatestHandoff.ToAgentID,
			ToAgent:       focus.LatestHandoff.ToAgent,
			DraftTitle:    focus.LatestHandoff.Title,
			DraftSummary:  focus.LatestHandoff.Summary,
			HandoffID:     focus.LatestHandoff.ID,
			Href:          href,
			HrefLabel:     WorkspaceGovernanceNextRouteHrefLabel("active", href),
		}
	}

	currentOwner := governanceCurrentOwnerName(state, focus)
	if currentOwner == "" {
		result.Reason = "当前讨论还没定位到处理人。"
		return result
	}

	fromLaneIndex := governanceSuggestedCurrentLaneIndex(template.Topology, state.Agents, focus, currentOwner)
	if fromLaneIndex == -1 {
		result.Reason = fmt.Sprintf("当前处理人 %s 还没对应到现有分工；请先调整默认智能体或手动交接。", currentOwner)
		return result
	}
	if fromLaneIndex >= len(template.Topology)-1 {
		fromLane := template.Topology[fromLaneIndex]
		reason := fmt.Sprintf("%s 已经到了最后一步 %s，不需要再新建交接。", currentOwner, fromLane.Label)
		href := fmt.Sprintf("/mailbox?roomId=%s", focus.Room.ID)
		if focus.PullRequest != nil {
			href = fmt.Sprintf("/pull-requests/%s", focus.PullRequest.ID)
			reason = fmt.Sprintf("%s 已经完成最后一步 %s；下一步直接查看交付详情。", currentOwner, fromLane.Label)
		}
		if focus.LatestCompletion != nil && strings.TrimSpace(focus.LatestCompletion.LastNote) != "" {
			if focus.PullRequest != nil {
				reason = fmt.Sprintf("%s 已经完成最后一步 %s；最新结果已回到交付详情：%s", currentOwner, fromLane.Label, focus.LatestCompletion.LastNote)
			} else {
				reason = fmt.Sprintf("%s 已经完成最后一步 %s；当前结果已收口：%s", currentOwner, fromLane.Label, focus.LatestCompletion.LastNote)
			}
		}
		return WorkspaceGovernanceSuggestedHandoff{
			Status:        "done",
			Reason:        reason,
			RoomID:        focus.Room.ID,
			IssueKey:      focus.Issue.Key,
			FromLaneID:    fromLane.ID,
			FromLaneLabel: fromLane.Label,
			FromAgent:     currentOwner,
			Href:          href,
			HrefLabel:     WorkspaceGovernanceNextRouteHrefLabel("done", href),
		}
	}

	fromLane := template.Topology[fromLaneIndex]
	toLane := template.Topology[fromLaneIndex+1]
	fromAgent, fromAgentFound := governanceAgentByName(state.Agents, currentOwner)
	toAgent, toAgentFound := resolveGovernanceLaneAgent(state.Agents, toLane, currentOwner)
	suggested := WorkspaceGovernanceSuggestedHandoff{
		Status:        "ready",
		Reason:        fmt.Sprintf("当前由 %s 负责，下一步建议交给 %s。", currentOwner, toLane.Label),
		RoomID:        focus.Room.ID,
		IssueKey:      focus.Issue.Key,
		FromLaneID:    fromLane.ID,
		FromLaneLabel: fromLane.Label,
		ToLaneID:      toLane.ID,
		ToLaneLabel:   toLane.Label,
		DraftTitle:    fmt.Sprintf("请 %s 接手当前事项", toLane.Label),
		DraftSummary: fmt.Sprintf(
			"%s 已经把 %s 推到 %s；下一步建议由 %s 接手，继续处理%s。",
			currentOwner,
			focus.Issue.Key,
			focus.Room.Title,
			defaultString(agentNameOrDefault(toAgent, toAgentFound), toLane.Label),
			defaultString(strings.TrimSpace(toLane.Role), "后续工作"),
		),
	}
	if fromAgentFound {
		suggested.FromAgentID = fromAgent.ID
		suggested.FromAgent = fromAgent.Name
	} else {
		suggested.FromAgent = currentOwner
	}
	if !toAgentFound {
		suggested.Status = "blocked"
		suggested.Reason = fmt.Sprintf("%s 当前还没有默认智能体；请先补充接手人或手动选择。", toLane.Label)
		return suggested
	}
	suggested.ToAgentID = toAgent.ID
	suggested.ToAgent = toAgent.Name
	return suggested
}

func governanceSuggestedHandoffLabel(item WorkspaceGovernanceSuggestedHandoff) string {
	switch strings.TrimSpace(item.Status) {
	case "active", "ready":
		switch {
		case strings.TrimSpace(item.FromAgent) != "" && strings.TrimSpace(item.ToAgent) != "":
			return fmt.Sprintf("%s -> %s", item.FromAgent, item.ToAgent)
		case strings.TrimSpace(item.FromLaneLabel) != "" && strings.TrimSpace(item.ToLaneLabel) != "":
			return fmt.Sprintf("%s -> %s", item.FromLaneLabel, item.ToLaneLabel)
		case strings.TrimSpace(item.ToLaneLabel) != "":
			return item.ToLaneLabel
		default:
			return "下一步"
		}
	case "blocked":
		switch {
		case strings.TrimSpace(item.FromLaneLabel) != "" && strings.TrimSpace(item.ToLaneLabel) != "":
			return fmt.Sprintf("%s -> %s", item.FromLaneLabel, item.ToLaneLabel)
		case strings.TrimSpace(item.ToLaneLabel) != "":
			return item.ToLaneLabel
		default:
			return "下一步受阻"
		}
	case "done":
		return "交付详情"
	default:
		return ""
	}
}

func governanceSuggestedHandoffHref(item WorkspaceGovernanceSuggestedHandoff, roomID string) string {
	href := strings.TrimSpace(item.Href)
	if href != "" {
		return href
	}
	return governanceMailboxRoomHref(roomID)
}

func governanceSuggestedHandoffHrefLabel(item WorkspaceGovernanceSuggestedHandoff, roomID string) string {
	if explicit := strings.TrimSpace(item.HrefLabel); explicit != "" {
		return explicit
	}
	href := governanceSuggestedHandoffHref(item, roomID)
	return WorkspaceGovernanceNextRouteHrefLabel(item.Status, href)
}

func WorkspaceGovernanceNextRouteHrefLabel(status, href string) string {
	return MailboxHrefLabel(status, href)
}

func governanceEscalationRoomHrefLabel(href string) string {
	return WorkspaceGovernanceEscalationRoomHrefLabel(href)
}

func WorkspaceGovernanceEscalationRoomHrefLabel(href string) string {
	return HrefTargetLabel(href)
}

func governanceCurrentOwnerName(state State, focus governanceFocus) string {
	switch {
	case focus.Run != nil:
		issue := Issue{}
		if focus.Issue != nil {
			issue = *focus.Issue
		}
		room := Room{}
		if focus.Room != nil {
			room = *focus.Room
		}
		return resolveRunOwnerNameWithContext(state, *focus.Run, issue, room)
	case focus.Issue != nil && strings.TrimSpace(focus.Issue.Owner) != "":
		return canonicalOwnerName(state.Agents, focus.Issue.Owner)
	case focus.Room != nil && strings.TrimSpace(focus.Room.Topic.Owner) != "":
		return canonicalOwnerName(state.Agents, focus.Room.Topic.Owner)
	default:
		return ""
	}
}

func governanceLaneIndexByAgentName(topology []governanceTemplateLaneDefinition, agents []Agent, agentName string) int {
	for index := range topology {
		if governanceLaneMatchesAgentName(topology[index], agents, agentName) {
			return index
		}
	}
	return -1
}

func governanceSuggestedCurrentLaneIndex(topology []governanceTemplateLaneDefinition, agents []Agent, focus governanceFocus, currentOwner string) int {
	if focus.LatestCompletion == nil && focus.Run != nil && strings.EqualFold(strings.TrimSpace(focus.Run.Owner), strings.TrimSpace(currentOwner)) {
		for index := range topology {
			if isGovernanceExecutionLane(topology[index]) {
				return index
			}
		}
	}
	return governanceLaneIndexByAgentName(topology, agents, currentOwner)
}

func governanceLaneByAgentName(topology []governanceTemplateLaneDefinition, agents []Agent, agentName string) *governanceTemplateLaneDefinition {
	index := governanceLaneIndexByAgentName(topology, agents, agentName)
	if index == -1 {
		return nil
	}
	return &topology[index]
}

func governanceLaneMatchesAgentName(lane governanceTemplateLaneDefinition, agents []Agent, agentName string) bool {
	name := strings.TrimSpace(agentName)
	if name == "" {
		return false
	}
	if strings.EqualFold(name, lane.DefaultAgent) || strings.EqualFold(name, lane.Label) {
		return true
	}
	agent, ok := governanceAgentByName(agents, name)
	if !ok {
		return false
	}
	return governanceLaneMatchesAgent(lane, agent)
}

func resolveGovernanceLaneAgent(agents []Agent, lane governanceTemplateLaneDefinition, excludeName string) (Agent, bool) {
	if agent, ok := governanceAgentByName(agents, lane.DefaultAgent); ok && !strings.EqualFold(agent.Name, excludeName) {
		return agent, true
	}

	for _, agent := range agents {
		if strings.EqualFold(agent.Name, excludeName) {
			continue
		}
		if governanceLaneMatchesAgent(lane, agent) {
			return agent, true
		}
	}
	return Agent{}, false
}

func governanceLaneMatchesAgent(lane governanceTemplateLaneDefinition, agent Agent) bool {
	text := strings.ToLower(strings.Join([]string{agent.Name, agent.Role, agent.Description}, " "))
	if strings.EqualFold(agent.Name, lane.DefaultAgent) ||
		strings.EqualFold(agent.Name, lane.Label) ||
		strings.EqualFold(agent.Role, lane.Role) {
		return true
	}
	switch {
	case isGovernanceOwnerLane(lane):
		return governanceTextMatchesAny(text, "owner", "lead", "pm", "spec", "product")
	case isGovernanceArchitectureLane(lane):
		return governanceTextMatchesAny(text, "architect", "spec", "split", "planner")
	case isGovernanceVerificationLane(lane):
		return governanceTextMatchesAny(text, "qa", "test", "verify", "release")
	case isGovernanceExecutionLane(lane):
		return governanceTextMatchesAny(text, "build", "developer", "execution", "pilot", "codex", "dockmaster", "collector")
	case isGovernanceSynthesisLane(lane):
		return governanceTextMatchesAny(text, "synthesizer", "synthesis", "summary")
	case isGovernanceReviewLane(lane):
		return governanceTextMatchesAny(text, "review", "reviewer", "verdict", "claude")
	default:
		return false
	}
}

func governanceAgentByName(agents []Agent, name string) (Agent, bool) {
	for _, agent := range agents {
		if strings.EqualFold(strings.TrimSpace(agent.Name), strings.TrimSpace(name)) {
			return agent, true
		}
	}
	return Agent{}, false
}

func governanceTextMatches(text, target string) bool {
	parts := governanceKeywords(target)
	if len(parts) == 0 {
		return false
	}
	text = strings.ToLower(text)
	textTokens := governanceKeywords(text)
	for _, part := range parts {
		if governanceKeywordIsASCII(part) {
			if !governanceTokenListContains(textTokens, part) {
				return false
			}
			continue
		}
		if !strings.Contains(text, part) {
			return false
		}
	}
	return true
}

func governanceTextMatchesAny(text string, values ...string) bool {
	for _, value := range values {
		if governanceTextMatches(text, value) {
			return true
		}
	}
	return false
}

func governanceKeywords(value string) []string {
	return strings.FieldsFunc(strings.ToLower(strings.TrimSpace(value)), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
}

func governanceKeywordIsASCII(value string) bool {
	for _, r := range value {
		if r > unicode.MaxASCII {
			return false
		}
	}
	return true
}

func governanceTokenListContains(tokens []string, target string) bool {
	for _, token := range tokens {
		if token == target {
			return true
		}
	}
	return false
}

func laneIDOrEmpty(lane *governanceTemplateLaneDefinition) string {
	if lane == nil {
		return ""
	}
	return lane.ID
}

func laneLabelOrEmpty(lane *governanceTemplateLaneDefinition) string {
	if lane == nil {
		return ""
	}
	return lane.Label
}

func agentNameOrDefault(agent Agent, ok bool) string {
	if !ok {
		return ""
	}
	return agent.Name
}

func buildGovernanceEscalationSLA(template governanceTemplateDefinition, state State, focus governanceFocus) WorkspaceGovernanceEscalationSLA {
	timeoutMinutes := template.TimeoutMinutes
	retryBudget := template.RetryBudget
	activeEscalations := len(focus.BlockedInbox)
	breachedEscalations := 0
	nextEscalation := template.EscalationChannel
	queue := make([]WorkspaceGovernanceEscalationQueueEntry, 0, len(focus.BlockedInbox)+1)

	if focus.LatestHandoff != nil && focus.LatestHandoff.Status != "completed" {
		activeEscalations++
		elapsedMinutes := governanceMinutesSince(focus.LatestHandoff.UpdatedAt)
		queueStatus := "active"
		nextStep := fmt.Sprintf("请在 %d 分钟内继续处理；超时后按 %s 升级。", timeoutMinutes, template.EscalationChannel)
		if focus.LatestHandoff.Status == "blocked" {
			queueStatus = "blocked"
			nextStep = fmt.Sprintf("当前交接已阻塞；请尽快按 %s 处理。", template.EscalationChannel)
		}
		if elapsedMinutes > timeoutMinutes {
			breachedEscalations++
			queueStatus = "blocked"
			nextStep = fmt.Sprintf("当前交接已超时；请立即按 %s 升级。", template.EscalationChannel)
			nextEscalation = fmt.Sprintf("%s 已超时，请通过 %s 继续处理。", focus.LatestHandoff.ID, template.EscalationChannel)
		}
		queue = append(queue, WorkspaceGovernanceEscalationQueueEntry{
			ID:               fmt.Sprintf("handoff:%s", focus.LatestHandoff.ID),
			Label:            fmt.Sprintf("%s -> %s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent),
			Status:           queueStatus,
			Source:           "交接",
			Owner:            focus.LatestHandoff.ToAgent,
			Summary:          focus.LatestHandoff.LastAction,
			NextStep:         nextStep,
			Href:             mailboxInboxHref(focus.LatestHandoff.ID, focus.LatestHandoff.RoomID),
			TimeLabel:        focus.LatestHandoff.UpdatedAt,
			ElapsedMinutes:   elapsedMinutes,
			ThresholdMinutes: timeoutMinutes,
		})
	}

	for _, item := range focus.BlockedInbox {
		queue = append(queue, WorkspaceGovernanceEscalationQueueEntry{
			ID:               fmt.Sprintf("inbox:%s", item.ID),
			Label:            item.Title,
			Status:           "blocked",
			Source:           "收件箱",
			Owner:            item.Room,
			Summary:          item.Summary,
			NextStep:         fmt.Sprintf("%s；按 %s 继续处理。", defaultString(item.Action, "打开当前提醒"), template.EscalationChannel),
			Href:             defaultString(item.Href, "/inbox"),
			TimeLabel:        item.Time,
			ElapsedMinutes:   0,
			ThresholdMinutes: timeoutMinutes,
		})
	}

	status := "ready"
	summary := fmt.Sprintf("当前时限为 %d 分钟响应 / %d 次重试。", timeoutMinutes, retryBudget)
	switch {
	case breachedEscalations > 0:
		status = "blocked"
		summary = fmt.Sprintf("已有 %d 条事项超时，需要立即按 %s 升级。", breachedEscalations, template.EscalationChannel)
	case activeEscalations > 0:
		status = "active"
		summary = fmt.Sprintf("当前有 %d 条待处理升级；升级路径：%s。", activeEscalations, template.EscalationChannel)
	}

	return WorkspaceGovernanceEscalationSLA{
		Status:              status,
		Summary:             summary,
		TimeoutMinutes:      timeoutMinutes,
		RetryBudget:         retryBudget,
		ActiveEscalations:   activeEscalations,
		BreachedEscalations: breachedEscalations,
		NextEscalation:      nextEscalation,
		Queue:               queue,
		Rollup:              buildGovernanceEscalationRoomRollup(template, state),
	}
}

type governanceEscalationRoomAccumulator struct {
	RoomID          string
	RoomTitle       string
	EscalationCount int
	BlockedCount    int
	LatestSource    string
	LatestLabel     string
	LatestSummary   string
	Href            string
	latestAt        time.Time
	latestKnown     bool
}

func buildGovernanceEscalationRoomRollup(
	template governanceTemplateDefinition,
	state State,
) []WorkspaceGovernanceEscalationRoomRollup {
	if len(state.Rooms) == 0 {
		return nil
	}

	rollups := map[string]*governanceEscalationRoomAccumulator{}
	for _, handoff := range state.Mailbox {
		if handoff.Status == "completed" || isGovernanceSidecarHandoff(handoff.Kind) {
			continue
		}
		roomTitle := governanceRoomTitleByID(state.Rooms, handoff.RoomID)
		entryStatus := "active"
		if handoff.Status == "blocked" || governanceMinutesSince(handoff.UpdatedAt) > template.TimeoutMinutes {
			entryStatus = "blocked"
		}
		accumulator := ensureGovernanceEscalationRoomAccumulator(rollups, handoff.RoomID, roomTitle)
		accumulator.EscalationCount++
		if entryStatus == "blocked" {
			accumulator.BlockedCount++
		}
		updateGovernanceEscalationRoomAccumulator(
			accumulator,
			entryStatus,
			"交接",
			fmt.Sprintf("%s -> %s", handoff.FromAgent, handoff.ToAgent),
			handoff.LastAction,
			mailboxInboxHref(handoff.ID, handoff.RoomID),
			governanceParseTimestamp(handoff.UpdatedAt),
		)
	}

	for _, item := range state.Inbox {
		if item.Kind != "blocked" {
			continue
		}
		roomID, roomTitle := governanceEscalationInboxRoom(state, item)
		if roomID == "" && strings.TrimSpace(roomTitle) == "" {
			continue
		}
		accumulator := ensureGovernanceEscalationRoomAccumulator(rollups, roomID, roomTitle)
		accumulator.EscalationCount++
		accumulator.BlockedCount++
		updateGovernanceEscalationRoomAccumulator(
			accumulator,
			"blocked",
			"收件箱",
			item.Title,
			item.Summary,
			defaultString(item.Href, governanceMailboxRoomHref(roomID)),
			governanceInboxOccurredAt(state, item),
		)
	}

	items := make([]WorkspaceGovernanceEscalationRoomRollup, 0, len(rollups))
	for _, accumulator := range rollups {
		status := "active"
		if accumulator.BlockedCount > 0 {
			status = "blocked"
		}
		roomFocus := resolveGovernanceFocusForRoom(state, accumulator.RoomID)
		currentOwner := governanceCurrentOwnerName(state, roomFocus)
		currentLane := ""
		if lane := governanceLaneByAgentName(template.Topology, state.Agents, currentOwner); lane != nil {
			currentLane = lane.Label
		}
		suggested := buildGovernanceSuggestedHandoff(state, template, roomFocus)
		items = append(items, WorkspaceGovernanceEscalationRoomRollup{
			RoomID:             accumulator.RoomID,
			RoomTitle:          accumulator.RoomTitle,
			Status:             status,
			EscalationCount:    accumulator.EscalationCount,
			BlockedCount:       accumulator.BlockedCount,
			CurrentOwner:       currentOwner,
			CurrentLane:        currentLane,
			LatestSource:       accumulator.LatestSource,
			LatestLabel:        accumulator.LatestLabel,
			LatestSummary:      accumulator.LatestSummary,
			NextRouteStatus:    suggested.Status,
			NextRouteLabel:     governanceSuggestedHandoffLabel(suggested),
			NextRouteSummary:   suggested.Reason,
			NextRouteHref:      governanceSuggestedHandoffHref(suggested, accumulator.RoomID),
			NextRouteHrefLabel: governanceSuggestedHandoffHrefLabel(suggested, accumulator.RoomID),
			Href:               accumulator.Href,
			HrefLabel:          governanceEscalationRoomHrefLabel(accumulator.Href),
		})
	}

	sort.Slice(items, func(left, right int) bool {
		if items[left].Status != items[right].Status {
			return items[left].Status == "blocked"
		}
		if items[left].EscalationCount != items[right].EscalationCount {
			return items[left].EscalationCount > items[right].EscalationCount
		}
		return strings.ToLower(items[left].RoomTitle) < strings.ToLower(items[right].RoomTitle)
	})

	return items
}

func ensureGovernanceEscalationRoomAccumulator(
	items map[string]*governanceEscalationRoomAccumulator,
	roomID string,
	roomTitle string,
) *governanceEscalationRoomAccumulator {
	key := strings.TrimSpace(roomID)
	if key == "" {
		key = strings.TrimSpace(roomTitle)
	}
	if existing, ok := items[key]; ok {
		if existing.RoomTitle == "" {
			existing.RoomTitle = roomTitle
		}
		if existing.Href == "" {
			existing.Href = governanceMailboxRoomHref(roomID)
		}
		return existing
	}
	item := &governanceEscalationRoomAccumulator{
		RoomID:    strings.TrimSpace(roomID),
		RoomTitle: strings.TrimSpace(defaultString(roomTitle, roomID)),
		Href:      governanceMailboxRoomHref(roomID),
	}
	items[key] = item
	return item
}

func updateGovernanceEscalationRoomAccumulator(
	accumulator *governanceEscalationRoomAccumulator,
	status string,
	source string,
	label string,
	summary string,
	href string,
	occurredAt time.Time,
) {
	if strings.TrimSpace(href) != "" {
		accumulator.Href = href
	}
	if accumulator.latestKnown && !occurredAt.After(accumulator.latestAt) {
		return
	}
	if !accumulator.latestKnown && !occurredAt.IsZero() {
		accumulator.latestKnown = true
		accumulator.latestAt = occurredAt
	} else if accumulator.latestKnown {
		accumulator.latestAt = occurredAt
	}
	if !accumulator.latestKnown || !occurredAt.IsZero() || accumulator.LatestLabel == "" {
		accumulator.LatestSource = source
		accumulator.LatestLabel = label
		accumulator.LatestSummary = summary
		if strings.TrimSpace(href) != "" {
			accumulator.Href = href
		}
	}
	if status == "blocked" && accumulator.BlockedCount == 0 {
		accumulator.BlockedCount = 1
	}
}

func governanceEscalationInboxRoom(state State, item InboxItem) (string, string) {
	if strings.TrimSpace(item.HandoffID) != "" {
		for _, handoff := range state.Mailbox {
			if handoff.ID == item.HandoffID {
				return handoff.RoomID, governanceRoomTitleByID(state.Rooms, handoff.RoomID)
			}
		}
	}
	roomID := governanceRoomIDFromHref(item.Href)
	if roomID != "" {
		return roomID, defaultString(governanceRoomTitleByID(state.Rooms, roomID), item.Room)
	}
	if roomID = governanceRoomIDByTitle(state.Rooms, item.Room); roomID != "" {
		return roomID, governanceRoomTitleByID(state.Rooms, roomID)
	}
	return "", strings.TrimSpace(item.Room)
}

func governanceRoomTitleByID(rooms []Room, roomID string) string {
	for _, room := range rooms {
		if room.ID == roomID {
			return room.Title
		}
	}
	return ""
}

func governanceRoomIDByTitle(rooms []Room, roomTitle string) string {
	title := strings.TrimSpace(roomTitle)
	for _, room := range rooms {
		if strings.EqualFold(strings.TrimSpace(room.Title), title) {
			return room.ID
		}
	}
	return ""
}

func governanceRoomIDFromHref(href string) string {
	if href == "" {
		return ""
	}
	marker := "roomId="
	index := strings.Index(href, marker)
	if index == -1 {
		return ""
	}
	value := href[index+len(marker):]
	if ampersand := strings.Index(value, "&"); ampersand >= 0 {
		value = value[:ampersand]
	}
	return strings.TrimSpace(value)
}

func governanceMailboxRoomHref(roomID string) string {
	if strings.TrimSpace(roomID) == "" {
		return "/mailbox"
	}
	return fmt.Sprintf("/mailbox?roomId=%s", roomID)
}

func governanceInboxOccurredAt(state State, item InboxItem) time.Time {
	if strings.TrimSpace(item.HandoffID) != "" {
		for _, handoff := range state.Mailbox {
			if handoff.ID == item.HandoffID {
				return governanceParseTimestamp(handoff.UpdatedAt)
			}
		}
	}
	return time.Time{}
}

func governanceParseTimestamp(value string) time.Time {
	timestamp := strings.TrimSpace(value)
	if timestamp == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err == nil {
		return parsed
	}
	return time.Time{}
}

func buildGovernanceNotificationPolicy(workspace WorkspaceSnapshot, template governanceTemplateDefinition, focus governanceFocus) WorkspaceGovernanceNotificationPolicy {
	targets := []string{"交接箱", "收件箱"}
	if strings.TrimSpace(workspace.BrowserPush) != "" {
		targets = append(targets, "浏览器提醒")
	}
	status := "ready"
	summary := fmt.Sprintf("阻塞、评审和需要拍板的事项都会按 %s 提醒。浏览器提醒当前：%s。", template.EscalationChannel, workspace.BrowserPush)
	if len(focus.BlockedInbox)+len(focus.ReviewInbox)+len(focus.ApprovalInbox) > 0 {
		status = "active"
		summary = fmt.Sprintf("当前已有新的提醒；系统会继续按 %s 同步到交接箱、收件箱和浏览器提醒。", template.EscalationChannel)
	}
	return WorkspaceGovernanceNotificationPolicy{
		Status:            status,
		Summary:           summary,
		BrowserPush:       workspace.BrowserPush,
		Targets:           targets,
		EscalationChannel: template.EscalationChannel,
	}
}

func buildHumanOverride(focus governanceFocus) WorkspaceHumanOverride {
	if len(focus.ApprovalInbox) > 0 {
		item := focus.ApprovalInbox[0]
		return WorkspaceHumanOverride{
			Status:  "required",
			Summary: fmt.Sprintf("当前有 %d 条需要你拍板的事项；最新一条是“%s”。", len(focus.ApprovalInbox), item.Title),
			Href:    defaultString(item.Href, "/inbox"),
		}
	}
	if len(focus.BlockedInbox) > 0 {
		item := focus.BlockedInbox[0]
		return WorkspaceHumanOverride{
			Status:  "watch",
			Summary: fmt.Sprintf("当前阻塞已经进了收件箱；可以直接从“%s”开始处理。", item.Title),
			Href:    defaultString(item.Href, "/inbox"),
		}
	}
	return WorkspaceHumanOverride{
		Status:  "ready",
		Summary: "暂无需要你拍板的事项；交接、评审和验证都会继续推进。",
		Href:    "/inbox",
	}
}

func buildResponseAggregation(
	state State,
	focus governanceFocus,
	humanOverride WorkspaceHumanOverride,
	routingPolicy WorkspaceGovernanceSuggestedHandoff,
) WorkspaceResponseAggregation {
	currentOwner := governanceCurrentOwnerName(state, focus)
	sources := []string{}
	if focus.Issue != nil {
		sources = append(sources, fmt.Sprintf("%s 事项", focus.Issue.Key))
	}
	if focus.Room != nil {
		sources = append(sources, fmt.Sprintf("%s 讨论", focus.Room.Title))
	}
	if focus.LatestHandoff != nil {
		sources = append(sources, fmt.Sprintf("%s -> %s 交接", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent))
	}
	if focus.PullRequest != nil {
		sources = append(sources, focus.PullRequest.Label)
	}
	if len(focus.RelatedInbox) > 0 {
		sources = append(sources, fmt.Sprintf("%d 条收件箱提醒", len(focus.RelatedInbox)))
	}
	deliveryDelegation := PullRequestDeliveryDelegation{}
	deliveryDelegationActive := false
	if focus.PullRequest != nil && routingPolicy.Status == "done" {
		deliveryDelegation = buildPullRequestDeliveryDelegation(state, *focus.PullRequest, routingPolicy)
		deliveryDelegationActive = deliveryDelegation.Status == "ready" || deliveryDelegation.Status == "blocked" || deliveryDelegation.Status == "done"
		if deliveryDelegationActive {
			sources = append(sources, "交付收尾")
		}
	}
	decisionPath := []string{}
	if focus.Issue != nil {
		decisionPath = append(decisionPath, fmt.Sprintf("事项:%s", focus.Issue.Key))
	}
	if focus.LatestHandoff != nil {
		decisionPath = append(decisionPath, fmt.Sprintf("交接:%s->%s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent))
	}
	if focus.PullRequest != nil {
		decisionPath = append(decisionPath, fmt.Sprintf("评审:%s", focus.PullRequest.Label))
	}
	if len(focus.RelatedInbox) > 0 {
		decisionPath = append(decisionPath, fmt.Sprintf("收件箱:%d", len(focus.RelatedInbox)))
	}
	if deliveryDelegationActive {
		decisionPath = append(decisionPath, fmt.Sprintf("交付:%s", deliveryDelegation.Status))
	}
	overrideTrace := []string{}
	if humanOverride.Status == "required" || humanOverride.Status == "watch" {
		overrideTrace = append(overrideTrace, humanOverride.Summary)
	}
	auditTrail := make([]WorkspaceResponseAggregationAuditEntry, 0, 5)
	if focus.Issue != nil {
		occurredAt := ""
		if focus.Run != nil {
			occurredAt = focus.Run.StartedAt
		}
		auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
			ID:         "audit-issue",
			Label:      "事项",
			Status:     "ready",
			Actor:      focus.Issue.Owner,
			Summary:    fmt.Sprintf("%s 记录了当前目标。", focus.Issue.Key),
			OccurredAt: occurredAt,
		})
	}
	if focus.LatestHandoff != nil {
		auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
			ID:         "audit-handoff",
			Label:      "交接",
			Status:     governanceStatusFromHandoff(focus.LatestHandoff.Status),
			Actor:      focus.LatestHandoff.ToAgent,
			Summary:    fmt.Sprintf("%s -> %s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent),
			OccurredAt: focus.LatestHandoff.UpdatedAt,
		})
	}
	if focus.PullRequest != nil {
		auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
			ID:         "audit-review",
			Label:      "评审",
			Status:     governanceStatusFromPullRequest(focus.PullRequest.Status),
			Actor:      focus.PullRequest.Author,
			Summary:    defaultString(focus.PullRequest.ReviewSummary, focus.PullRequest.Label),
			OccurredAt: focus.PullRequest.UpdatedAt,
		})
	}
	if deliveryDelegationActive {
		auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
			ID:         "audit-delivery-closeout",
			Label:      "交付收尾",
			Status:     deliveryDelegation.Status,
			Actor:      defaultString(strings.TrimSpace(deliveryDelegation.TargetAgent), defaultString(strings.TrimSpace(currentOwner), "交付收尾")),
			Summary:    deliveryDelegation.Summary,
			OccurredAt: responseAggregationDeliveryOccurredAt(state, focus, deliveryDelegation),
		})
	}

	finalResponse := "等当前事项收口后再给出最终回复。"
	status := "draft"
	summary := "最终回复会把事项、讨论、交接、评审和收件箱里的结果收在一起。"
	aggregator := defaultString(currentOwner, "当前协作")
	finalOccurredAt := responseAggregationFallbackOccurredAt(focus)

	switch {
	case deliveryDelegationActive:
		status = responseAggregationStatusFromDeliveryDelegation(deliveryDelegation.Status)
		finalResponse = deliveryDelegation.Summary
		summary = "当前最终回复会跟着交付结果一起更新。"
		aggregator = defaultString(strings.TrimSpace(deliveryDelegation.TargetAgent), aggregator)
		finalOccurredAt = responseAggregationDeliveryOccurredAt(state, focus, deliveryDelegation)
	case governanceCompletionMatchesCurrentOwner(focus.LatestCompletion, currentOwner) && strings.TrimSpace(focus.LatestCompletion.LastNote) != "":
		status = "ready"
		finalResponse = focus.LatestCompletion.LastNote
		summary = fmt.Sprintf("最新结果已回写：%s。", focus.LatestCompletion.LastNote)
		aggregator = focus.LatestCompletion.ToAgent
		finalOccurredAt = defaultString(strings.TrimSpace(focus.LatestCompletion.UpdatedAt), finalOccurredAt)
	case focus.Run != nil && strings.TrimSpace(focus.Run.NextAction) != "":
		status = governanceStatusFromRun(focus.Run.Status)
		finalResponse = focus.Run.NextAction
		summary = "当前最终回复会跟着这次执行的下一步一起更新。"
		aggregator = defaultString(currentOwner, aggregator)
	case focus.PullRequest != nil && strings.TrimSpace(focus.PullRequest.ReviewSummary) != "":
		status = governanceStatusFromPullRequest(focus.PullRequest.Status)
		finalResponse = focus.PullRequest.ReviewSummary
		summary = fmt.Sprintf("%s 的评审结果已经同步到这里。", focus.PullRequest.Label)
		aggregator = defaultString(strings.TrimSpace(focus.PullRequest.Author), aggregator)
		finalOccurredAt = defaultString(strings.TrimSpace(focus.PullRequest.UpdatedAt), finalOccurredAt)
	}
	auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
		ID:         "audit-final-response",
		Label:      "最终回复",
		Status:     status,
		Actor:      aggregator,
		Summary:    finalResponse,
		OccurredAt: finalOccurredAt,
	})

	return WorkspaceResponseAggregation{
		Status:        status,
		Summary:       summary,
		Sources:       sources,
		FinalResponse: finalResponse,
		Aggregator:    aggregator,
		DecisionPath:  decisionPath,
		OverrideTrace: overrideTrace,
		AuditTrail:    auditTrail,
	}
}

func responseAggregationStatusFromDeliveryDelegation(status string) string {
	switch strings.TrimSpace(status) {
	case "blocked":
		return "blocked"
	case "ready", "done":
		return "ready"
	default:
		return "draft"
	}
}

func responseAggregationDeliveryOccurredAt(state State, focus governanceFocus, delegation PullRequestDeliveryDelegation) string {
	for _, handoff := range state.Mailbox {
		if handoff.ID == delegation.ResponseHandoffID {
			return handoff.UpdatedAt
		}
		if handoff.ID == delegation.HandoffID {
			return handoff.UpdatedAt
		}
	}
	return responseAggregationFallbackOccurredAt(focus)
}

func responseAggregationFallbackOccurredAt(focus governanceFocus) string {
	switch {
	case focus.LatestCompletion != nil && strings.TrimSpace(focus.LatestCompletion.UpdatedAt) != "":
		return focus.LatestCompletion.UpdatedAt
	case focus.LatestHandoff != nil && strings.TrimSpace(focus.LatestHandoff.UpdatedAt) != "":
		return focus.LatestHandoff.UpdatedAt
	case focus.PullRequest != nil && strings.TrimSpace(focus.PullRequest.UpdatedAt) != "":
		return focus.PullRequest.UpdatedAt
	case focus.Run != nil && strings.TrimSpace(focus.Run.StartedAt) != "":
		return focus.Run.StartedAt
	default:
		return ""
	}
}

func governanceCompletionMatchesCurrentOwner(item *AgentHandoff, currentOwner string) bool {
	if item == nil {
		return false
	}
	completionOwner := strings.TrimSpace(item.ToAgent)
	currentOwner = strings.TrimSpace(currentOwner)
	if completionOwner == "" {
		return false
	}
	if currentOwner == "" {
		return true
	}
	return strings.EqualFold(completionOwner, currentOwner)
}

func buildGovernanceTeamTopology(template governanceTemplateDefinition, focus governanceFocus, humanOverride WorkspaceHumanOverride) []WorkspaceGovernanceLane {
	lanes := make([]WorkspaceGovernanceLane, 0, len(template.Topology))
	for _, lane := range template.Topology {
		status, summary := resolveGovernanceLaneState(lane, focus, humanOverride)
		lanes = append(lanes, WorkspaceGovernanceLane{
			ID:           lane.ID,
			Label:        lane.Label,
			Role:         lane.Role,
			DefaultAgent: lane.DefaultAgent,
			Lane:         lane.Lane,
			Status:       status,
			Summary:      summary,
		})
	}
	return lanes
}

func resolveGovernanceLaneState(lane governanceTemplateLaneDefinition, focus governanceFocus, humanOverride WorkspaceHumanOverride) (string, string) {
	switch {
	case isGovernanceOwnerLane(lane):
		if humanOverride.Status == "required" {
			return "active", humanOverride.Summary
		}
		if focus.Issue != nil {
			return "ready", fmt.Sprintf("%s 正在盯着 %s 的目标和最终回复。", lane.Label, focus.Issue.Key)
		}
	case isGovernanceArchitectureLane(lane):
		if focus.Room != nil {
			return "ready", fmt.Sprintf("%s 已经把 %s 的讨论、执行和交付边界收清。", lane.Label, focus.Room.Title)
		}
	case isGovernanceVerificationLane(lane):
		status, summary := buildVerificationRule(focus)
		return status, summary
	case isGovernanceExecutionLane(lane):
		if focus.Run != nil {
			return governanceStatusFromRun(focus.Run.Status), fmt.Sprintf("当前由 %s 持续推进：%s。", defaultString(focus.Run.Owner, lane.DefaultAgent), focus.Run.Summary)
		}
	case isGovernanceSynthesisLane(lane):
		if focus.LatestHandoff != nil {
			return governanceStatusFromHandoff(focus.LatestHandoff.Status), fmt.Sprintf("最近一条交接是 %s -> %s。", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent)
		}
		if focus.Room != nil {
			return "ready", fmt.Sprintf("%s 会围绕 %s 汇总结论。", lane.Label, focus.Room.Title)
		}
	case isGovernanceReviewLane(lane):
		switch {
		case focus.LatestHandoff != nil:
			return governanceStatusFromHandoff(focus.LatestHandoff.Status), fmt.Sprintf("当前评审跟着交接推进：%s。", focus.LatestHandoff.LastAction)
		case focus.PullRequest != nil:
			return governanceStatusFromPullRequest(focus.PullRequest.Status), fmt.Sprintf("%s 正在查看 %s。", lane.Label, focus.PullRequest.Label)
		case len(focus.ReviewInbox) > 0:
			return "active", fmt.Sprintf("收件箱里有待评审事项：%s。", focus.ReviewInbox[0].Title)
		}
	}

	if focus.Issue != nil {
		return "ready", fmt.Sprintf("%s 已接入 %s，等待轮到这一步。", lane.Label, focus.Issue.Key)
	}
	return "pending", fmt.Sprintf("%s 还在等待新进展。", lane.Label)
}

func governanceLaneSummaryText(lane governanceTemplateLaneDefinition) string {
	return strings.ToLower(strings.Join([]string{lane.ID, lane.Label, lane.Role, lane.Lane}, " "))
}

func governanceLaneMatchesAny(lane governanceTemplateLaneDefinition, keywords ...string) bool {
	text := governanceLaneSummaryText(lane)
	for _, keyword := range keywords {
		if keyword != "" && strings.Contains(text, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func isGovernanceOwnerLane(lane governanceTemplateLaneDefinition) bool {
	return governanceLaneMatchesAny(lane, "pm", "lead", "owner", "目标", "验收", "final response", "scope")
}

func isGovernanceArchitectureLane(lane governanceTemplateLaneDefinition) bool {
	return governanceLaneMatchesAny(lane, "architect", "splitter", "拆解", "边界", "shape", "split")
}

func isGovernanceExecutionLane(lane governanceTemplateLaneDefinition) bool {
	return governanceLaneMatchesAny(lane, "developer", "collector", "member", "build", "collect", "实现", "执行")
}

func isGovernanceSynthesisLane(lane governanceTemplateLaneDefinition) bool {
	return governanceLaneMatchesAny(lane, "synthesizer", "synthesis", "归纳", "草案")
}

func isGovernanceReviewLane(lane governanceTemplateLaneDefinition) bool {
	return governanceLaneMatchesAny(lane, "review", "reviewer", "复核", "verdict")
}

func isGovernanceVerificationLane(lane governanceTemplateLaneDefinition) bool {
	return governanceLaneMatchesAny(lane, "qa", "test", "verify", "release gate", "验证", "测试")
}

func buildGovernanceRules(focus governanceFocus, stats WorkspaceGovernanceStats, humanOverride WorkspaceHumanOverride) []WorkspaceGovernanceRule {
	verifyStatus, verifySummary := buildVerificationRule(focus)
	reviewStatus := "pending"
	reviewSummary := "当前还没有待评审事项。"
	if focus.PullRequest != nil {
		reviewStatus = governanceStatusFromPullRequest(focus.PullRequest.Status)
		reviewSummary = fmt.Sprintf("%s 当前状态为 %s；评审结果会同步到这里。", focus.PullRequest.Label, focus.PullRequest.Status)
	} else if len(focus.ReviewInbox) > 0 {
		reviewStatus = "active"
		reviewSummary = fmt.Sprintf("当前有待评审事项：%s。", focus.ReviewInbox[0].Title)
	}

	blockedStatus := "ready"
	blockedSummary := "当前没有新的阻塞项；如果交接或验证失败，会先进入收件箱。"
	if len(focus.BlockedInbox) > 0 {
		blockedStatus = "blocked"
		blockedSummary = fmt.Sprintf("当前有 %d 条阻塞项，最新一条是“%s”。", len(focus.BlockedInbox), focus.BlockedInbox[0].Title)
	}

	handoffStatus := "ready"
	handoffSummary := fmt.Sprintf("当前还有 %d 条交接在进行。", stats.OpenHandoffs)
	if focus.LatestHandoff != nil {
		handoffStatus = governanceStatusFromHandoff(focus.LatestHandoff.Status)
		handoffSummary = fmt.Sprintf("最新交接：%s -> %s（%s）。", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent, focus.LatestHandoff.Status)
	}

	return []WorkspaceGovernanceRule{
		{ID: "formal-handoff", Label: "交接", Status: handoffStatus, Summary: handoffSummary, Href: "/mailbox"},
		{ID: "review-gate", Label: "评审", Status: reviewStatus, Summary: reviewSummary, Href: "/mailbox"},
		{ID: "test-gate", Label: "验证", Status: verifyStatus, Summary: verifySummary, Href: "/mailbox"},
		{ID: "blocked-escalation", Label: "阻塞", Status: blockedStatus, Summary: blockedSummary, Href: "/inbox"},
		{ID: "human-override", Label: "人工接管", Status: humanOverride.Status, Summary: humanOverride.Summary, Href: humanOverride.Href},
	}
}

func buildVerificationRule(focus governanceFocus) (string, string) {
	if len(focus.BlockedInbox) > 0 {
		return "blocked", fmt.Sprintf("当前验证被这条阻塞拦住：%s。", focus.BlockedInbox[0].Summary)
	}
	if focus.Run != nil {
		switch focus.Run.Status {
		case "review", "done":
			return "ready", fmt.Sprintf("当前执行已到 %s；可以直接围“%s”收结果。", focus.Run.Status, focus.Run.NextAction)
		case "blocked", "paused":
			return "blocked", fmt.Sprintf("当前执行处于 %s；请先处理阻塞后再继续验证。", focus.Run.Status)
		default:
			return "active", fmt.Sprintf("当前执行还在推进，最新一步：%s。", focus.Run.NextAction)
		}
	}
	if focus.PullRequest != nil {
		return governanceStatusFromPullRequest(focus.PullRequest.Status), fmt.Sprintf("%s 当前仍在等待验证结果。", focus.PullRequest.Label)
	}
	return "pending", "暂无验证结果；后续会在讨论、PR 或收件箱里出现。"
}

func buildGovernanceWalkthrough(focus governanceFocus, responseAggregation WorkspaceResponseAggregation) []WorkspaceGovernanceWalkthrough {
	issueSummary := "暂无事项。"
	issueDetail := "先创建事项，再进入讨论间。"
	issueHref := "/rooms"
	if focus.Issue != nil && focus.Room != nil {
		issueSummary = fmt.Sprintf("%s / %s", focus.Issue.Key, focus.Issue.Title)
		issueDetail = fmt.Sprintf("讨论间：%s · 当前处理人：%s。", focus.Room.Title, focus.Issue.Owner)
		issueHref = "/rooms/" + focus.Room.ID
	}

	handoffStatus := "pending"
	handoffSummary := "等待第一条交接。"
	handoffDetail := "新的交接会直接写进交接箱。"
	if focus.LatestHandoff != nil {
		handoffStatus = governanceStatusFromHandoff(focus.LatestHandoff.Status)
		handoffSummary = fmt.Sprintf("%s -> %s · %s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent, focus.LatestHandoff.Status)
		handoffDetail = focus.LatestHandoff.LastAction
	}

	reviewStatus := "pending"
	reviewSummary := "等待待评审事项。"
	reviewDetail := "评审结果会直接写回这里。"
	reviewHref := "/mailbox"
	if focus.PullRequest != nil {
		reviewStatus = governanceStatusFromPullRequest(focus.PullRequest.Status)
		reviewSummary = fmt.Sprintf("%s / %s", focus.PullRequest.Label, focus.PullRequest.Status)
		reviewDetail = defaultString(focus.PullRequest.ReviewSummary, "评审结果正在整理中。")
		reviewHref = defaultString(focus.PullRequest.URL, "/mailbox")
	} else if len(focus.ReviewInbox) > 0 {
		reviewStatus = "active"
		reviewSummary = focus.ReviewInbox[0].Title
		reviewDetail = focus.ReviewInbox[0].Summary
		reviewHref = defaultString(focus.ReviewInbox[0].Href, "/inbox")
	}

	testStatus, testDetail := buildVerificationRule(focus)
	testSummary := "验证"
	if focus.Run != nil {
		testSummary = fmt.Sprintf("%s / %s", focus.Run.ID, focus.Run.Status)
	}

	return []WorkspaceGovernanceWalkthrough{
		{ID: "issue", Label: "事项", Status: "ready", Summary: issueSummary, Detail: issueDetail, Href: issueHref},
		{ID: "handoff", Label: "交接", Status: handoffStatus, Summary: handoffSummary, Detail: handoffDetail, Href: "/mailbox"},
		{ID: "review", Label: "评审", Status: reviewStatus, Summary: reviewSummary, Detail: reviewDetail, Href: reviewHref},
		{ID: "test", Label: "验证", Status: testStatus, Summary: testSummary, Detail: testDetail, Href: "/mailbox"},
		{ID: "final-response", Label: "最终回复", Status: responseAggregation.Status, Summary: responseAggregation.FinalResponse, Detail: responseAggregation.Summary, Href: "/mailbox"},
	}
}

func governanceRouteMatches(handoff AgentHandoff, fromLane, toLane governanceTemplateLaneDefinition) bool {
	fromMatches := strings.EqualFold(handoff.FromAgent, fromLane.DefaultAgent) ||
		strings.EqualFold(handoff.FromAgent, fromLane.Label) ||
		governanceTextMatches(strings.ToLower(handoff.FromAgent), fromLane.DefaultAgent)
	toMatches := strings.EqualFold(handoff.ToAgent, toLane.DefaultAgent) ||
		strings.EqualFold(handoff.ToAgent, toLane.Label) ||
		governanceTextMatches(strings.ToLower(handoff.ToAgent), toLane.DefaultAgent)
	return fromMatches && toMatches
}

func governanceMinutesSince(value string) int {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return 0
	}
	return int(time.Since(parsed).Minutes())
}

func governanceStatusFromRun(status string) string {
	switch strings.TrimSpace(status) {
	case "running":
		return "active"
	case "review":
		return "ready"
	case "done":
		return "done"
	case "blocked", "paused":
		return "blocked"
	default:
		return "pending"
	}
}

func governanceStatusFromPullRequest(status string) string {
	switch strings.TrimSpace(status) {
	case "merged":
		return "done"
	case "changes_requested":
		return "blocked"
	case "open", "in_review":
		return "active"
	default:
		return "pending"
	}
}

func governanceStatusFromHandoff(status string) string {
	switch strings.TrimSpace(status) {
	case "completed":
		return "done"
	case "blocked":
		return "blocked"
	case "requested", "acknowledged":
		return "active"
	default:
		return "pending"
	}
}
