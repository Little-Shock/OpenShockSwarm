package store

import (
	"fmt"
	"strings"
	"time"
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
			Label:             "研究团队治理链",
			Summary:           "研究模板把 intake、evidence、synthesis 和 reviewer 收成同一条多 Agent 治理链，不再只有静态 bootstrap 说明。",
			TimeoutMinutes:    30,
			RetryBudget:       2,
			EscalationChannel: "mailbox -> inbox -> lead",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "lead", Label: "Research Lead", Role: "方向与验收", DefaultAgent: "Lead Operator", Lane: "scope / final synthesis"},
				{ID: "collector", Label: "Collector", Role: "证据收集", DefaultAgent: "Collector", Lane: "intake -> evidence"},
				{ID: "synthesizer", Label: "Synthesizer", Role: "归纳与草案", DefaultAgent: "Synthesizer", Lane: "evidence -> synthesis"},
				{ID: "reviewer", Label: "Reviewer", Role: "结论复核", DefaultAgent: "Review Runner", Lane: "review / publish"},
			},
		}
	case "blank-custom":
		return governanceTemplateDefinition{
			TemplateID:        "blank-custom",
			Label:             "自定义治理骨架",
			Summary:           "空白模板仍给出最小 handoff / review / override 骨架，避免团队只能靠口头约定推进。",
			TimeoutMinutes:    45,
			RetryBudget:       1,
			EscalationChannel: "mailbox -> inbox -> owner",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "owner", Label: "Owner", Role: "目标与验收", DefaultAgent: "Starter Agent", Lane: "scope / final response"},
				{ID: "member", Label: "Member", Role: "执行与上下文整理", DefaultAgent: "Starter Agent", Lane: "build / collect"},
				{ID: "reviewer", Label: "Reviewer", Role: "复核与阻塞升级", DefaultAgent: "Review Agent", Lane: "review / unblock"},
			},
		}
	default:
		return governanceTemplateDefinition{
			TemplateID:        "dev-team",
			Label:             "开发团队治理链",
			Summary:           "开发模板现在把 PM / Architect / Developer / Reviewer / QA 与 human override、response aggregation 压成同一份治理快照。",
			TimeoutMinutes:    20,
			RetryBudget:       2,
			EscalationChannel: "mailbox -> inbox -> human override",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "pm", Label: "PM", Role: "目标与验收", DefaultAgent: "Spec Captain", Lane: "scope / final response"},
				{ID: "architect", Label: "Architect", Role: "拆解与边界", DefaultAgent: "Spec Captain", Lane: "shape / split"},
				{ID: "developer", Label: "Developer", Role: "实现与分支推进", DefaultAgent: "Build Pilot", Lane: "issue -> branch"},
				{ID: "reviewer", Label: "Reviewer", Role: "exact-head verdict", DefaultAgent: "Review Runner", Lane: "review / blocker"},
				{ID: "qa", Label: "QA", Role: "verify / release evidence", DefaultAgent: "QA Relay", Lane: "test / release gate"},
			},
		}
	}
}

func hydrateWorkspaceGovernance(workspace *WorkspaceSnapshot, state *State) {
	template := governanceTemplateFor(workspace.Onboarding.TemplateID)
	focus := resolveGovernanceFocus(*state)
	stats := buildGovernanceStats(*state)
	humanOverride := buildHumanOverride(focus)
	routingPolicy := buildGovernanceRoutingPolicy(template, focus, humanOverride)
	escalationSLA := buildGovernanceEscalationSLA(template, focus)
	notificationPolicy := buildGovernanceNotificationPolicy(*workspace, template, focus)
	responseAggregation := buildResponseAggregation(focus, humanOverride)
	stats.SLABreaches = escalationSLA.BreachedEscalations
	stats.AggregationSources = len(responseAggregation.Sources)

	summary := template.Summary
	if focus.Issue != nil {
		summary = fmt.Sprintf("%s 当前锚在 %s，并把 issue -> handoff -> review -> test -> final response 摆成同一条治理链。", template.Label, focus.Issue.Key)
	}

	workspace.Governance = WorkspaceGovernanceSnapshot{
		TemplateID:          template.TemplateID,
		Label:               template.Label,
		Summary:             summary,
		TeamTopology:        buildGovernanceTeamTopology(template, focus, humanOverride),
		HandoffRules:        buildGovernanceRules(focus, stats, humanOverride),
		RoutingPolicy:       routingPolicy,
		EscalationSLA:       escalationSLA,
		NotificationPolicy:  notificationPolicy,
		ResponseAggregation: responseAggregation,
		HumanOverride:       humanOverride,
		Walkthrough:         buildGovernanceWalkthrough(focus, responseAggregation),
		Stats:               stats,
	}
}

func resolveGovernanceFocus(state State) governanceFocus {
	focus := governanceFocus{}
	roomID := ""

	if len(state.Mailbox) > 0 {
		handoff := state.Mailbox[0]
		focus.LatestHandoff = &handoff
		roomID = handoff.RoomID
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
		for index := range state.Runs {
			if state.Runs[index].RoomID == roomID {
				focus.Run = &state.Runs[index]
				break
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

func buildGovernanceRoutingPolicy(template governanceTemplateDefinition, focus governanceFocus, humanOverride WorkspaceHumanOverride) WorkspaceGovernanceRoutingPolicy {
	defaultRouteParts := make([]string, 0, len(template.Topology))
	rules := make([]WorkspaceGovernanceRouteRule, 0, len(template.Topology))

	for index, lane := range template.Topology {
		defaultRouteParts = append(defaultRouteParts, lane.Label)
		if index == len(template.Topology)-1 {
			continue
		}
		nextLane := template.Topology[index+1]
		status := "pending"
		summary := fmt.Sprintf("%s 默认把交接发往 %s，并沿 %s 推进。", lane.Label, nextLane.Label, nextLane.Lane)
		if focus.LatestHandoff != nil && governanceRouteMatches(*focus.LatestHandoff, lane, nextLane) {
			status = governanceStatusFromHandoff(focus.LatestHandoff.Status)
			summary = fmt.Sprintf("最新 handoff 已按 %s -> %s 落账。", lane.Label, nextLane.Label)
		} else if index == 0 && focus.Issue != nil {
			status = "ready"
			summary = fmt.Sprintf("%s 当前把 %s 正式路由到后续 lanes。", lane.Label, focus.Issue.Key)
		} else if nextLane.ID == "reviewer" && (focus.PullRequest != nil || len(focus.ReviewInbox) > 0) {
			status = "active"
			summary = fmt.Sprintf("review gate 已显式出现，%s 将接住下一棒。", nextLane.Label)
		}
		rules = append(rules, WorkspaceGovernanceRouteRule{
			ID:       fmt.Sprintf("%s-to-%s", lane.ID, nextLane.ID),
			Trigger:  fmt.Sprintf("%s_handoff", lane.ID),
			FromLane: lane.Label,
			ToLane:   nextLane.Label,
			Policy:   nextLane.Lane,
			Summary:  summary,
			Status:   status,
		})
	}

	overrideStatus := humanOverride.Status
	overrideSummary := "所有 blocked / approval 会沿 mailbox -> inbox -> human override 同一条 escalation chain 收口。"
	if humanOverride.Status == "required" || humanOverride.Status == "watch" {
		overrideSummary = humanOverride.Summary
	}
	rules = append(rules, WorkspaceGovernanceRouteRule{
		ID:       "escalate-to-human",
		Trigger:  "blocked_or_approval",
		FromLane: "Any Lane",
		ToLane:   "Human Override",
		Policy:   "mailbox -> inbox -> human",
		Summary:  overrideSummary,
		Status:   overrideStatus,
	})

	status := "ready"
	summary := fmt.Sprintf("默认 routing matrix = %s。", strings.Join(defaultRouteParts, " -> "))
	for _, rule := range rules {
		switch rule.Status {
		case "blocked":
			status = "blocked"
			summary = fmt.Sprintf("routing 当前被 %s 挡住：%s。", rule.ID, rule.Summary)
			return WorkspaceGovernanceRoutingPolicy{
				Status:       status,
				Summary:      summary,
				DefaultRoute: strings.Join(defaultRouteParts, " -> "),
				Rules:        rules,
			}
		case "active":
			status = "active"
			summary = fmt.Sprintf("当前正在执行 %s。", rule.Summary)
		}
	}

	return WorkspaceGovernanceRoutingPolicy{
		Status:       status,
		Summary:      summary,
		DefaultRoute: strings.Join(defaultRouteParts, " -> "),
		Rules:        rules,
	}
}

func buildGovernanceEscalationSLA(template governanceTemplateDefinition, focus governanceFocus) WorkspaceGovernanceEscalationSLA {
	timeoutMinutes := template.TimeoutMinutes
	retryBudget := template.RetryBudget
	activeEscalations := len(focus.BlockedInbox)
	breachedEscalations := 0
	nextEscalation := template.EscalationChannel

	if focus.LatestHandoff != nil && focus.LatestHandoff.Status != "completed" {
		activeEscalations++
		if governanceMinutesSince(focus.LatestHandoff.UpdatedAt) > timeoutMinutes {
			breachedEscalations++
			nextEscalation = fmt.Sprintf("%s overdue; escalate via %s", focus.LatestHandoff.ID, template.EscalationChannel)
		}
	}

	status := "ready"
	summary := fmt.Sprintf("当前 SLA = %d 分钟响应 / %d 次重试预算。", timeoutMinutes, retryBudget)
	switch {
	case breachedEscalations > 0:
		status = "blocked"
		summary = fmt.Sprintf("已有 %d 条 governance escalation 超时，需要立即升级到 %s。", breachedEscalations, template.EscalationChannel)
	case activeEscalations > 0:
		status = "active"
		summary = fmt.Sprintf("当前有 %d 条 active escalation；下一跳 = %s。", activeEscalations, template.EscalationChannel)
	}

	return WorkspaceGovernanceEscalationSLA{
		Status:              status,
		Summary:             summary,
		TimeoutMinutes:      timeoutMinutes,
		RetryBudget:         retryBudget,
		ActiveEscalations:   activeEscalations,
		BreachedEscalations: breachedEscalations,
		NextEscalation:      nextEscalation,
	}
}

func buildGovernanceNotificationPolicy(workspace WorkspaceSnapshot, template governanceTemplateDefinition, focus governanceFocus) WorkspaceGovernanceNotificationPolicy {
	targets := []string{"mailbox", "inbox"}
	if strings.TrimSpace(workspace.BrowserPush) != "" {
		targets = append(targets, "browser_push")
	}
	status := "ready"
	summary := fmt.Sprintf("blocked / review / verify 默认沿 %s fanout。browser push 当前 = %s。", template.EscalationChannel, workspace.BrowserPush)
	if len(focus.BlockedInbox)+len(focus.ReviewInbox)+len(focus.ApprovalInbox) > 0 {
		status = "active"
		summary = fmt.Sprintf("当前已有 live governance signal；通知策略继续沿 %s 回放到 mailbox / inbox / browser。", template.EscalationChannel)
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
			Summary: fmt.Sprintf("当前有 %d 条显式 human override gate；最新一条是“%s”。", len(focus.ApprovalInbox), item.Title),
			Href:    defaultString(item.Href, "/inbox"),
		}
	}
	if len(focus.BlockedInbox) > 0 {
		item := focus.BlockedInbox[0]
		return WorkspaceHumanOverride{
			Status:  "watch",
			Summary: fmt.Sprintf("当前 blocker 已被升级到 Inbox；人类可以直接围“%s”决定 unblock。", item.Title),
			Href:    defaultString(item.Href, "/inbox"),
		}
	}
	return WorkspaceHumanOverride{
		Status:  "ready",
		Summary: "当前没有额外 human override gate；团队可以沿 mailbox / review / verify 继续推进。",
		Href:    "/inbox",
	}
}

func buildResponseAggregation(focus governanceFocus, humanOverride WorkspaceHumanOverride) WorkspaceResponseAggregation {
	sources := []string{}
	if focus.Issue != nil {
		sources = append(sources, fmt.Sprintf("%s issue", focus.Issue.Key))
	}
	if focus.Room != nil {
		sources = append(sources, fmt.Sprintf("%s room context", focus.Room.Title))
	}
	if focus.LatestHandoff != nil {
		sources = append(sources, fmt.Sprintf("%s -> %s handoff", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent))
	}
	if focus.PullRequest != nil {
		sources = append(sources, focus.PullRequest.Label)
	}
	if len(focus.RelatedInbox) > 0 {
		sources = append(sources, fmt.Sprintf("%d inbox signals", len(focus.RelatedInbox)))
	}
	decisionPath := []string{}
	if focus.Issue != nil {
		decisionPath = append(decisionPath, fmt.Sprintf("issue:%s", focus.Issue.Key))
	}
	if focus.LatestHandoff != nil {
		decisionPath = append(decisionPath, fmt.Sprintf("handoff:%s->%s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent))
	}
	if focus.PullRequest != nil {
		decisionPath = append(decisionPath, fmt.Sprintf("review:%s", focus.PullRequest.Label))
	}
	if len(focus.RelatedInbox) > 0 {
		decisionPath = append(decisionPath, fmt.Sprintf("inbox:%d", len(focus.RelatedInbox)))
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
			Label:      "Issue Truth",
			Status:     "ready",
			Actor:      focus.Issue.Owner,
			Summary:    fmt.Sprintf("%s anchors the target truth.", focus.Issue.Key),
			OccurredAt: occurredAt,
		})
	}
	if focus.LatestHandoff != nil {
		auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
			ID:         "audit-handoff",
			Label:      "Handoff",
			Status:     governanceStatusFromHandoff(focus.LatestHandoff.Status),
			Actor:      focus.LatestHandoff.ToAgent,
			Summary:    fmt.Sprintf("%s -> %s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent),
			OccurredAt: focus.LatestHandoff.UpdatedAt,
		})
	}
	if focus.PullRequest != nil {
		auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
			ID:         "audit-review",
			Label:      "Review",
			Status:     governanceStatusFromPullRequest(focus.PullRequest.Status),
			Actor:      focus.PullRequest.Author,
			Summary:    defaultString(focus.PullRequest.ReviewSummary, focus.PullRequest.Label),
			OccurredAt: focus.PullRequest.UpdatedAt,
		})
	}

	finalResponse := "等待当前 reviewer / tester loop 收口后再聚合最终响应。"
	status := "draft"
	summary := "最终响应会把 issue、room、handoff、review 和 inbox signal 聚合到同一条 human-readable closeout。"
	aggregator := "workspace governance"

	switch {
	case focus.LatestCompletion != nil && strings.TrimSpace(focus.LatestCompletion.LastNote) != "":
		status = "ready"
		finalResponse = focus.LatestCompletion.LastNote
		summary = fmt.Sprintf("最新 closeout note 已从 mailbox 回写：%s。", focus.LatestCompletion.LastNote)
		aggregator = focus.LatestCompletion.ToAgent
	case focus.PullRequest != nil && strings.TrimSpace(focus.PullRequest.ReviewSummary) != "":
		status = governanceStatusFromPullRequest(focus.PullRequest.Status)
		finalResponse = focus.PullRequest.ReviewSummary
		summary = fmt.Sprintf("%s 当前把 reviewer verdict 留在同一条 aggregation surface 上。", focus.PullRequest.Label)
		aggregator = focus.PullRequest.Author
	case focus.Run != nil && strings.TrimSpace(focus.Run.NextAction) != "":
		status = governanceStatusFromRun(focus.Run.Status)
		finalResponse = focus.Run.NextAction
		summary = "当前 final response 继续围同一条 run next-action truth 聚合，不需要再靠口头总结。"
		aggregator = focus.Run.Owner
	}
	auditTrail = append(auditTrail, WorkspaceResponseAggregationAuditEntry{
		ID:         "audit-final-response",
		Label:      "Final Response",
		Status:     status,
		Actor:      aggregator,
		Summary:    finalResponse,
		OccurredAt: time.Now().UTC().Format(time.RFC3339),
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
	switch lane.ID {
	case "pm", "lead", "owner":
		if humanOverride.Status == "required" {
			return "active", humanOverride.Summary
		}
		if focus.Issue != nil {
			return "ready", fmt.Sprintf("%s 当前把 %s 的 acceptance 和 final response 锚在同一条 issue truth 上。", lane.Label, focus.Issue.Key)
		}
	case "architect":
		if focus.Room != nil {
			return "ready", fmt.Sprintf("%s 已把 room / run / PR 边界锚在 %s。", lane.Label, focus.Room.Title)
		}
	case "developer", "collector", "member":
		if focus.Run != nil {
			return governanceStatusFromRun(focus.Run.Status), fmt.Sprintf("当前 live lane 继续沿 %s 推进：%s。", defaultString(focus.Run.Owner, lane.DefaultAgent), focus.Run.Summary)
		}
	case "synthesizer":
		if focus.LatestHandoff != nil {
			return governanceStatusFromHandoff(focus.LatestHandoff.Status), fmt.Sprintf("handoff ledger 已把 %s -> %s 摆成 formal chain。", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent)
		}
		if focus.Room != nil {
			return "ready", fmt.Sprintf("%s 会围 %s 的 room context 聚合结论。", lane.Label, focus.Room.Title)
		}
	case "reviewer":
		switch {
		case focus.LatestHandoff != nil:
			return governanceStatusFromHandoff(focus.LatestHandoff.Status), fmt.Sprintf("当前 reviewer loop 由 handoff %s 驱动：%s。", focus.LatestHandoff.ID, focus.LatestHandoff.LastAction)
		case focus.PullRequest != nil:
			return governanceStatusFromPullRequest(focus.PullRequest.Status), fmt.Sprintf("%s 当前围 %s 收 exact-head verdict。", lane.Label, focus.PullRequest.Label)
		case len(focus.ReviewInbox) > 0:
			return "active", fmt.Sprintf("Inbox 已摆出 reviewer gate：%s。", focus.ReviewInbox[0].Title)
		}
	case "qa":
		status, summary := buildVerificationRule(focus)
		return status, summary
	}

	if focus.Issue != nil {
		return "ready", fmt.Sprintf("%s 模板已围 %s 起链，等待当前 lane 前滚。", lane.Label, focus.Issue.Key)
	}
	return "pending", fmt.Sprintf("%s 还在等待第一条 live governance evidence。", lane.Label)
}

func buildGovernanceRules(focus governanceFocus, stats WorkspaceGovernanceStats, humanOverride WorkspaceHumanOverride) []WorkspaceGovernanceRule {
	verifyStatus, verifySummary := buildVerificationRule(focus)
	reviewStatus := "pending"
	reviewSummary := "当前还没有显式 review gate。"
	if focus.PullRequest != nil {
		reviewStatus = governanceStatusFromPullRequest(focus.PullRequest.Status)
		reviewSummary = fmt.Sprintf("%s 当前状态为 %s；review summary 会和 mailbox / inbox 同步聚合。", focus.PullRequest.Label, focus.PullRequest.Status)
	} else if len(focus.ReviewInbox) > 0 {
		reviewStatus = "active"
		reviewSummary = fmt.Sprintf("Inbox review gate 已显式可见：%s。", focus.ReviewInbox[0].Title)
	}

	blockedStatus := "ready"
	blockedSummary := "当前没有新的 blocked escalation；若 handoff / verify 失败，会先被抬到 Inbox。"
	if len(focus.BlockedInbox) > 0 {
		blockedStatus = "blocked"
		blockedSummary = fmt.Sprintf("blocked escalation 当前有 %d 条，最新一条是“%s”。", len(focus.BlockedInbox), focus.BlockedInbox[0].Title)
	}

	handoffStatus := "ready"
	handoffSummary := fmt.Sprintf("Mailbox ledger 已支持 formal request / ack / block / complete；当前 open handoff = %d。", stats.OpenHandoffs)
	if focus.LatestHandoff != nil {
		handoffStatus = governanceStatusFromHandoff(focus.LatestHandoff.Status)
		handoffSummary = fmt.Sprintf("当前最新 handoff = %s -> %s / %s。", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent, focus.LatestHandoff.Status)
	}

	return []WorkspaceGovernanceRule{
		{ID: "formal-handoff", Label: "Formal Handoff", Status: handoffStatus, Summary: handoffSummary, Href: "/mailbox"},
		{ID: "review-gate", Label: "Review Gate", Status: reviewStatus, Summary: reviewSummary, Href: "/mailbox"},
		{ID: "test-gate", Label: "Test / Verify Gate", Status: verifyStatus, Summary: verifySummary, Href: "/mailbox"},
		{ID: "blocked-escalation", Label: "Blocked Escalation", Status: blockedStatus, Summary: blockedSummary, Href: "/inbox"},
		{ID: "human-override", Label: "Human Override", Status: humanOverride.Status, Summary: humanOverride.Summary, Href: humanOverride.Href},
	}
}

func buildVerificationRule(focus governanceFocus) (string, string) {
	if len(focus.BlockedInbox) > 0 {
		return "blocked", fmt.Sprintf("verify gate 当前被 blocker 挡住：%s。", focus.BlockedInbox[0].Summary)
	}
	if focus.Run != nil {
		switch focus.Run.Status {
		case "review", "done":
			return "ready", fmt.Sprintf("当前 run 已进入 %s；tester / release evidence 可以直接围 `%s` 收口。", focus.Run.Status, focus.Run.NextAction)
		case "blocked", "paused":
			return "blocked", fmt.Sprintf("当前 run 处于 %s；verify 会先 fail-closed，再走 escalation。", focus.Run.Status)
		default:
			return "active", fmt.Sprintf("当前 run 仍在推进 verify-ready evidence：%s。", focus.Run.NextAction)
		}
	}
	if focus.PullRequest != nil {
		return governanceStatusFromPullRequest(focus.PullRequest.Status), fmt.Sprintf("%s 当前继续挂着 verify / release gate。", focus.PullRequest.Label)
	}
	return "pending", "当前还没有 tester / verify evidence；后续会在 room / PR / Inbox 同步出现。"
}

func buildGovernanceWalkthrough(focus governanceFocus, responseAggregation WorkspaceResponseAggregation) []WorkspaceGovernanceWalkthrough {
	issueSummary := "当前还没有 issue truth。"
	issueDetail := "请先从模板起出第一条 issue / room。"
	issueHref := "/rooms"
	if focus.Issue != nil && focus.Room != nil {
		issueSummary = fmt.Sprintf("%s / %s", focus.Issue.Key, focus.Issue.Title)
		issueDetail = fmt.Sprintf("room = %s，owner = %s。", focus.Room.Title, focus.Issue.Owner)
		issueHref = "/rooms/" + focus.Room.ID
	}

	handoffStatus := "pending"
	handoffSummary := "等待第一条 formal handoff。"
	handoffDetail := "Mailbox ledger 会把 request / ack / blocked / complete 写成同一条对象。"
	if focus.LatestHandoff != nil {
		handoffStatus = governanceStatusFromHandoff(focus.LatestHandoff.Status)
		handoffSummary = fmt.Sprintf("%s -> %s / %s", focus.LatestHandoff.FromAgent, focus.LatestHandoff.ToAgent, focus.LatestHandoff.Status)
		handoffDetail = focus.LatestHandoff.LastAction
	}

	reviewStatus := "pending"
	reviewSummary := "等待 current review gate。"
	reviewDetail := "review 会收 exact-head verdict，而不是只留口头结论。"
	reviewHref := "/mailbox"
	if focus.PullRequest != nil {
		reviewStatus = governanceStatusFromPullRequest(focus.PullRequest.Status)
		reviewSummary = fmt.Sprintf("%s / %s", focus.PullRequest.Label, focus.PullRequest.Status)
		reviewDetail = defaultString(focus.PullRequest.ReviewSummary, "review summary 正在聚合中。")
		reviewHref = defaultString(focus.PullRequest.URL, "/mailbox")
	} else if len(focus.ReviewInbox) > 0 {
		reviewStatus = "active"
		reviewSummary = focus.ReviewInbox[0].Title
		reviewDetail = focus.ReviewInbox[0].Summary
		reviewHref = defaultString(focus.ReviewInbox[0].Href, "/inbox")
	}

	testStatus, testDetail := buildVerificationRule(focus)
	testSummary := "verify gate"
	if focus.Run != nil {
		testSummary = fmt.Sprintf("%s / %s", focus.Run.ID, focus.Run.Status)
	}

	return []WorkspaceGovernanceWalkthrough{
		{ID: "issue", Label: "Issue", Status: "ready", Summary: issueSummary, Detail: issueDetail, Href: issueHref},
		{ID: "handoff", Label: "Handoff", Status: handoffStatus, Summary: handoffSummary, Detail: handoffDetail, Href: "/mailbox"},
		{ID: "review", Label: "Review", Status: reviewStatus, Summary: reviewSummary, Detail: reviewDetail, Href: reviewHref},
		{ID: "test", Label: "Test", Status: testStatus, Summary: testSummary, Detail: testDetail, Href: "/mailbox"},
		{ID: "final-response", Label: "Final Response", Status: responseAggregation.Status, Summary: responseAggregation.FinalResponse, Detail: responseAggregation.Summary, Href: "/mailbox"},
	}
}

func governanceRouteMatches(handoff AgentHandoff, fromLane, toLane governanceTemplateLaneDefinition) bool {
	fromMatches := handoff.FromAgent == fromLane.DefaultAgent || strings.EqualFold(handoff.FromAgent, fromLane.Label)
	toMatches := handoff.ToAgent == toLane.DefaultAgent || strings.EqualFold(handoff.ToAgent, toLane.Label)
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
