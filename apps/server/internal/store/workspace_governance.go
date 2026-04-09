package store

import (
	"fmt"
	"strings"
)

type governanceTemplateDefinition struct {
	TemplateID string
	Label      string
	Summary    string
	Topology   []governanceTemplateLaneDefinition
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
			TemplateID: "research-team",
			Label:      "研究团队治理链",
			Summary:    "研究模板把 intake、evidence、synthesis 和 reviewer 收成同一条多 Agent 治理链，不再只有静态 bootstrap 说明。",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "lead", Label: "Research Lead", Role: "方向与验收", DefaultAgent: "Lead Operator", Lane: "scope / final synthesis"},
				{ID: "collector", Label: "Collector", Role: "证据收集", DefaultAgent: "Collector", Lane: "intake -> evidence"},
				{ID: "synthesizer", Label: "Synthesizer", Role: "归纳与草案", DefaultAgent: "Synthesizer", Lane: "evidence -> synthesis"},
				{ID: "reviewer", Label: "Reviewer", Role: "结论复核", DefaultAgent: "Review Runner", Lane: "review / publish"},
			},
		}
	case "blank-custom":
		return governanceTemplateDefinition{
			TemplateID: "blank-custom",
			Label:      "自定义治理骨架",
			Summary:    "空白模板仍给出最小 handoff / review / override 骨架，避免团队只能靠口头约定推进。",
			Topology: []governanceTemplateLaneDefinition{
				{ID: "owner", Label: "Owner", Role: "目标与验收", DefaultAgent: "Starter Agent", Lane: "scope / final response"},
				{ID: "member", Label: "Member", Role: "执行与上下文整理", DefaultAgent: "Starter Agent", Lane: "build / collect"},
				{ID: "reviewer", Label: "Reviewer", Role: "复核与阻塞升级", DefaultAgent: "Review Agent", Lane: "review / unblock"},
			},
		}
	default:
		return governanceTemplateDefinition{
			TemplateID: "dev-team",
			Label:      "开发团队治理链",
			Summary:    "开发模板现在把 PM / Architect / Developer / Reviewer / QA 与 human override、response aggregation 压成同一份治理快照。",
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
	responseAggregation := buildResponseAggregation(focus)

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

func buildResponseAggregation(focus governanceFocus) WorkspaceResponseAggregation {
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

	finalResponse := "等待当前 reviewer / tester loop 收口后再聚合最终响应。"
	status := "draft"
	summary := "最终响应会把 issue、room、handoff、review 和 inbox signal 聚合到同一条 human-readable closeout。"

	switch {
	case focus.LatestCompletion != nil && strings.TrimSpace(focus.LatestCompletion.LastNote) != "":
		status = "ready"
		finalResponse = focus.LatestCompletion.LastNote
		summary = fmt.Sprintf("最新 closeout note 已从 mailbox 回写：%s。", focus.LatestCompletion.LastNote)
	case focus.PullRequest != nil && strings.TrimSpace(focus.PullRequest.ReviewSummary) != "":
		status = governanceStatusFromPullRequest(focus.PullRequest.Status)
		finalResponse = focus.PullRequest.ReviewSummary
		summary = fmt.Sprintf("%s 当前把 reviewer verdict 留在同一条 aggregation surface 上。", focus.PullRequest.Label)
	case focus.Run != nil && strings.TrimSpace(focus.Run.NextAction) != "":
		status = governanceStatusFromRun(focus.Run.Status)
		finalResponse = focus.Run.NextAction
		summary = "当前 final response 继续围同一条 run next-action truth 聚合，不需要再靠口头总结。"
	}

	return WorkspaceResponseAggregation{
		Status:        status,
		Summary:       summary,
		Sources:       sources,
		FinalResponse: finalResponse,
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
