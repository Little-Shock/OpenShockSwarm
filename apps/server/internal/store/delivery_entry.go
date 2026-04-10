package store

import (
	"fmt"
	"sort"
	"strings"
)

const (
	deliveryEntryStatusReady   = "ready"
	deliveryEntryStatusWarning = "warning"
	deliveryEntryStatusBlocked = "blocked"
)

func buildPullRequestDeliveryEntry(
	snapshot State,
	center NotificationCenter,
	pr PullRequest,
	room Room,
	run Run,
	issue Issue,
	relatedInbox []InboxItem,
	conversation []PullRequestConversationEntry,
) PullRequestDeliveryEntry {
	reviewGate := buildPullRequestDeliveryReviewGate(snapshot, pr)
	usageGate := buildPullRequestDeliveryUsageGate(run)
	quotaGate := buildPullRequestDeliveryQuotaGate(snapshot.Workspace)
	templates := buildPullRequestDeliveryTemplates(center, pr, relatedInbox)
	notificationGate := buildPullRequestDeliveryNotificationGate(pr, relatedInbox, templates)
	gates := []PullRequestDeliveryGate{
		reviewGate,
		usageGate,
		quotaGate,
		notificationGate,
	}

	status, releaseReady, summary := summarizePullRequestDeliveryGates(gates)
	governanceAggregation := snapshot.Workspace.Governance.ResponseAggregation
	governedCloseout := snapshot.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	delegation := buildPullRequestDeliveryDelegation(snapshot, pr, governedCloseout)
	evidence := buildPullRequestDeliveryEvidence(snapshot, pr, room, run, issue, conversation, templates, governanceAggregation, governedCloseout)
	handoffNote := buildPullRequestDeliveryHandoffNote(
		pr,
		room,
		run,
		issue,
		reviewGate,
		usageGate,
		quotaGate,
		notificationGate,
		delegation,
		governanceAggregation,
		governedCloseout,
		status,
		releaseReady,
	)

	return PullRequestDeliveryEntry{
		Status:       status,
		ReleaseReady: releaseReady,
		Summary:      summary,
		Gates:        gates,
		Templates:    templates,
		Delegation:   delegation,
		HandoffNote:  handoffNote,
		Evidence:     evidence,
	}
}

func buildPullRequestDeliveryDelegation(
	snapshot State,
	pr PullRequest,
	governedCloseout WorkspaceGovernanceSuggestedHandoff,
) PullRequestDeliveryDelegation {
	result := PullRequestDeliveryDelegation{
		Status:  "pending",
		Summary: "等待 final verify / governed closeout 收口后，再明确最终 delivery delegate。",
		Href:    fmt.Sprintf("/pull-requests/%s", pr.ID),
	}

	if strings.EqualFold(strings.TrimSpace(pr.Status), "merged") {
		result.Status = "done"
		result.Summary = "这条 PR 已合并，delivery delegation 已完成。"
		return result
	}
	if governedCloseout.Status != "done" {
		return result
	}

	lane, targetAgent, laneFound, agentFound := resolvePullRequestDeliveryDelegationTarget(snapshot)
	if !laneFound {
		result.Status = "blocked"
		result.Summary = "governed closeout 已完成，但当前 team topology 还没有可用的 delivery delegate lane。"
		return result
	}

	result.TargetLane = lane.Label
	result.InboxItemID = deliveryDelegationInboxItemID(pr.ID)
	if !agentFound {
		result.Status = "blocked"
		result.Summary = fmt.Sprintf("%s 已完成 governed closeout，但当前缺少可映射到 %s 的默认 Agent。", defaultString(governedCloseout.FromAgent, "当前治理链"), lane.Label)
		return result
	}

	result.Status = "ready"
	result.TargetAgent = targetAgent
	if handoff := findPullRequestDeliveryDelegationHandoff(snapshot.Mailbox, pr, targetAgent); handoff != nil {
		result.HandoffID = handoff.ID
		result.HandoffHref = mailboxInboxHref(handoff.ID, handoff.RoomID)
		result.HandoffStatus = handoff.Status
		switch handoff.Status {
		case "blocked":
			result.Status = "blocked"
			result.Summary = fmt.Sprintf(
				"%s 的 delivery closeout handoff 当前 blocked：%s",
				targetAgent,
				defaultString(strings.TrimSpace(handoff.LastNote), handoff.LastAction),
			)
			return result
		case "completed":
			result.Status = "done"
			result.Summary = fmt.Sprintf(
				"%s 已完成 formal delivery closeout handoff；当前等待最终 merge / release receipt 收口。",
				targetAgent,
			)
			return result
		default:
			result.Summary = fmt.Sprintf(
				"%s 已完成 governed closeout；系统已为 %s 自动创建 formal delivery closeout handoff，可直接进入最后一棒收口。",
				defaultString(governedCloseout.FromAgent, "当前治理链"),
				targetAgent,
			)
			return result
		}
	}
	result.Summary = fmt.Sprintf(
		"%s 已完成 governed closeout；下一步交给 %s（%s）复核 release gate、operator handoff note 与最终交付收口。",
		defaultString(governedCloseout.FromAgent, "当前治理链"),
		targetAgent,
		lane.Label,
	)
	return result
}

func resolvePullRequestDeliveryDelegationTarget(snapshot State) (governanceTemplateLaneDefinition, string, bool, bool) {
	topology := deliveryDelegationTopology(snapshot)
	for _, lane := range topology {
		if governanceLaneMatchesAny(lane, "publisher", "publish", "delivery", "closeout") {
			return resolvePullRequestDeliveryDelegationLane(snapshot.Agents, lane)
		}
	}
	for _, lane := range topology {
		if isGovernanceOwnerLane(lane) {
			return resolvePullRequestDeliveryDelegationLane(snapshot.Agents, lane)
		}
	}
	return governanceTemplateLaneDefinition{}, "", false, false
}

func resolvePullRequestDeliveryDelegationLane(
	agents []Agent,
	lane governanceTemplateLaneDefinition,
) (governanceTemplateLaneDefinition, string, bool, bool) {
	if agent, ok := resolveGovernanceLaneAgent(agents, lane, ""); ok {
		return lane, agent.Name, true, true
	}
	if defaultAgent := strings.TrimSpace(lane.DefaultAgent); defaultAgent != "" {
		return lane, defaultAgent, true, true
	}
	return lane, "", true, false
}

func deliveryDelegationTopology(snapshot State) []governanceTemplateLaneDefinition {
	template := governanceTemplateFor(snapshot.Workspace.Governance.TemplateID)
	if len(snapshot.Workspace.Governance.ConfiguredTopology) > 0 {
		template = configuredGovernanceTemplate(template, snapshot.Workspace.Governance.ConfiguredTopology)
	}
	if len(template.Topology) > 0 {
		return template.Topology
	}

	fallback := make([]governanceTemplateLaneDefinition, 0, len(snapshot.Workspace.Governance.TeamTopology))
	for _, lane := range snapshot.Workspace.Governance.TeamTopology {
		fallback = append(fallback, governanceTemplateLaneDefinition{
			ID:           lane.ID,
			Label:        lane.Label,
			Role:         lane.Role,
			DefaultAgent: lane.DefaultAgent,
			Lane:         lane.Lane,
		})
	}
	return fallback
}

func findPullRequestDeliveryDelegationHandoff(
	mailbox []AgentHandoff,
	pr PullRequest,
	targetAgent string,
) *AgentHandoff {
	for index := range mailbox {
		handoff := &mailbox[index]
		if handoff.Kind != handoffKindDeliveryCloseout {
			continue
		}
		if handoff.RoomID != pr.RoomID || handoff.IssueKey != pr.IssueKey {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(handoff.ToAgent), strings.TrimSpace(targetAgent)) {
			continue
		}
		return handoff
	}
	return nil
}

func pullRequestDeliveryDelegationTitle(pr PullRequest, targetAgent string) string {
	return fmt.Sprintf(
		"%s 最终交付收口 -> %s",
		defaultString(strings.TrimSpace(pr.Label), strings.TrimSpace(pr.ID)),
		targetAgent,
	)
}

func pullRequestDeliveryDelegationSummary(
	governedCloseout WorkspaceGovernanceSuggestedHandoff,
	pr PullRequest,
	lane governanceTemplateLaneDefinition,
	targetAgent string,
) string {
	lines := []string{
		fmt.Sprintf(
			"%s 已完成最终 governed closeout；请你接住 %s 的 delivery entry、release gate 和最终 closeout。",
			defaultString(strings.TrimSpace(governedCloseout.FromAgent), "当前治理链"),
			defaultString(strings.TrimSpace(pr.Label), strings.TrimSpace(pr.ID)),
		),
	}
	if note := strings.TrimSpace(governedCloseout.Reason); note != "" {
		lines = append(lines, "当前 closeout 摘要："+note)
	}
	if laneLabel := strings.TrimSpace(lane.Label); laneLabel != "" {
		lines = append(lines, fmt.Sprintf("目标治理 lane：%s（%s）。", laneLabel, defaultString(strings.TrimSpace(lane.Lane), "final closeout")))
	}
	lines = append(lines, fmt.Sprintf("请 %s 复核 operator handoff note、delivery evidence，并完成最后一棒交付收口。", targetAgent))
	return strings.Join(lines, " ")
}

func buildPullRequestDeliveryReviewGate(snapshot State, pr PullRequest) PullRequestDeliveryGate {
	guard := autoMergeGuardFromState(snapshot, pr)
	status := deliveryEntryStatusBlocked
	switch guard.Status {
	case "ready", "merged":
		status = deliveryEntryStatusReady
	case "approval_required":
		status = deliveryEntryStatusWarning
	}

	return PullRequestDeliveryGate{
		ID:      "review-merge",
		Label:   "Review / Merge Gate",
		Status:  status,
		Summary: defaultString(strings.TrimSpace(guard.Reason), "当前 review / merge gate 正在整理中。"),
		Href:    fmt.Sprintf("/pull-requests/%s", pr.ID),
	}
}

func buildPullRequestDeliveryUsageGate(run Run) PullRequestDeliveryGate {
	status := deliveryEntryStatusReady
	switch strings.TrimSpace(run.Usage.BudgetStatus) {
	case "near_limit", "watch":
		status = deliveryEntryStatusWarning
	}

	summary := defaultString(strings.TrimSpace(run.Usage.Warning), "当前 run token / context headroom 仍健康，可继续沿 PR 收口。")
	if run.Usage.TotalTokens > 0 || run.Usage.ContextWindow > 0 {
		summary = fmt.Sprintf(
			"%s 当前 %d/%d tokens，tool calls %d。%s",
			defaultString(strings.TrimSpace(run.ID), "这条 run"),
			run.Usage.TotalTokens,
			run.Usage.ContextWindow,
			run.Usage.ToolCallCount,
			summary,
		)
	}

	return PullRequestDeliveryGate{
		ID:      "run-usage",
		Label:   "Run Usage / Headroom",
		Status:  status,
		Summary: summary,
		Href:    fmt.Sprintf("/runs/%s", run.ID),
	}
}

func buildPullRequestDeliveryQuotaGate(workspace WorkspaceSnapshot) PullRequestDeliveryGate {
	status := deliveryEntryStatusReady
	switch strings.TrimSpace(workspace.Quota.Status) {
	case "near_limit", "watch":
		status = deliveryEntryStatusWarning
	}

	summary := fmt.Sprintf(
		"%s · machines %d/%d · agents %d/%d · rooms %d/%d · %s %d tokens / %d runs / %d messages。",
		defaultString(strings.TrimSpace(workspace.Plan), "当前计划"),
		workspace.Quota.UsedMachines,
		workspace.Quota.MaxMachines,
		workspace.Quota.UsedAgents,
		workspace.Quota.MaxAgents,
		workspace.Quota.UsedRooms,
		workspace.Quota.MaxRooms,
		defaultString(strings.TrimSpace(workspace.Usage.WindowLabel), "过去 24h"),
		workspace.Usage.TotalTokens,
		workspace.Usage.RunCount,
		workspace.Usage.MessageCount,
	)
	warning := defaultString(strings.TrimSpace(workspace.Quota.Warning), strings.TrimSpace(workspace.Usage.Warning))
	if warning != "" {
		summary = fmt.Sprintf("%s %s", summary, warning)
	}

	return PullRequestDeliveryGate{
		ID:      "workspace-quota",
		Label:   "Workspace Plan / Quota",
		Status:  status,
		Summary: summary,
		Href:    "/settings",
	}
}

func buildPullRequestDeliveryTemplates(center NotificationCenter, pr PullRequest, relatedInbox []InboxItem) []PullRequestDeliveryTemplate {
	relatedInboxIDs := make(map[string]bool, len(relatedInbox))
	for _, item := range relatedInbox {
		relatedInboxIDs[item.ID] = true
	}

	type aggregate struct {
		item PullRequestDeliveryTemplate
	}

	templates := map[string]*aggregate{}
	ensureTemplate := func(templateID, label string) *aggregate {
		key := strings.TrimSpace(templateID)
		if key == "" {
			key = slugify(label)
		}
		if key == "" {
			key = "unlabeled-template"
		}
		if templates[key] == nil {
			templates[key] = &aggregate{
				item: PullRequestDeliveryTemplate{
					TemplateID: strings.TrimSpace(templateID),
					Label:      defaultString(strings.TrimSpace(label), "未命名模板"),
					Status:     deliveryEntryStatusWarning,
					Href:       "/settings",
				},
			}
		}
		return templates[key]
	}

	for _, delivery := range center.Deliveries {
		if !deliveryMatchesPullRequest(delivery.InboxItemID, delivery.Href, pr, relatedInboxIDs) {
			continue
		}
		template := ensureTemplate(delivery.TemplateID, delivery.TemplateLabel)
		switch delivery.Status {
		case notificationDeliveryStatusReady:
			template.item.ReadyDeliveries++
		case notificationDeliveryStatusBlocked:
			template.item.BlockedDeliveries++
		}
	}

	for _, receipt := range center.Worker.Receipts {
		if !deliveryMatchesPullRequest(receipt.InboxItemID, receipt.Href, pr, relatedInboxIDs) {
			continue
		}
		template := ensureTemplate(receipt.TemplateID, receipt.TemplateLabel)
		switch receipt.Status {
		case notificationFanoutReceiptStatusSent:
			template.item.SentReceipts++
		case notificationFanoutReceiptStatusFailed:
			template.item.FailedReceipts++
		}
	}

	items := make([]PullRequestDeliveryTemplate, 0, len(templates))
	for _, aggregate := range templates {
		switch {
		case aggregate.item.BlockedDeliveries > 0 || aggregate.item.FailedReceipts > 0:
			aggregate.item.Status = deliveryEntryStatusBlocked
		case aggregate.item.SentReceipts > 0 || aggregate.item.ReadyDeliveries > 0:
			aggregate.item.Status = deliveryEntryStatusReady
		default:
			aggregate.item.Status = deliveryEntryStatusWarning
		}
		items = append(items, aggregate.item)
	}

	sort.Slice(items, func(left, right int) bool {
		if items[left].Status != items[right].Status {
			return deliveryEntryStatusRank(items[left].Status) < deliveryEntryStatusRank(items[right].Status)
		}
		return items[left].Label < items[right].Label
	})
	return items
}

func buildPullRequestDeliveryNotificationGate(pr PullRequest, relatedInbox []InboxItem, templates []PullRequestDeliveryTemplate) PullRequestDeliveryGate {
	if len(templates) == 0 {
		summary := "当前还没有和这条 PR 直接关联的 notification template delivery。"
		if len(relatedInbox) > 0 {
			summary = fmt.Sprintf("这条 PR 已有 %d 条 inbox signal，但还没有 template delivery / receipt 被统一收进 handoff contract。", len(relatedInbox))
		}
		return PullRequestDeliveryGate{
			ID:      "notification-delivery",
			Label:   "Notification / Handoff Delivery",
			Status:  deliveryEntryStatusWarning,
			Summary: summary,
			Href:    "/settings",
		}
	}

	ready := 0
	warnings := 0
	blocked := 0
	templateLabels := make([]string, 0, len(templates))
	for _, template := range templates {
		templateLabels = append(templateLabels, template.Label)
		switch template.Status {
		case deliveryEntryStatusBlocked:
			blocked++
		case deliveryEntryStatusWarning:
			warnings++
		default:
			ready++
		}
	}

	status := deliveryEntryStatusReady
	switch {
	case blocked > 0:
		status = deliveryEntryStatusBlocked
	case warnings > 0:
		status = deliveryEntryStatusWarning
	}

	summary := fmt.Sprintf(
		"已收 %d 个 template：ready %d，warning %d，blocked %d。模板面：%s。",
		len(templates),
		ready,
		warnings,
		blocked,
		strings.Join(templateLabels, " / "),
	)
	if len(relatedInbox) > 0 {
		summary = fmt.Sprintf("%s 相关 inbox signals %d 条。", summary, len(relatedInbox))
	}

	return PullRequestDeliveryGate{
		ID:      "notification-delivery",
		Label:   "Notification / Handoff Delivery",
		Status:  status,
		Summary: summary,
		Href:    "/settings",
	}
}

func summarizePullRequestDeliveryGates(gates []PullRequestDeliveryGate) (string, bool, string) {
	hasWarning := false
	for _, gate := range gates {
		if gate.Status == deliveryEntryStatusBlocked {
			return deliveryEntryStatusBlocked, false, "当前 delivery entry 仍有 hard blocker；先修 blocked gate，再做 release closeout。"
		}
		if gate.Status == deliveryEntryStatusWarning {
			hasWarning = true
		}
	}
	if hasWarning {
		return deliveryEntryStatusWarning, true, "当前没有 hard blocker，但仍有 warning 需要在 handoff note 里显式说明。"
	}
	return deliveryEntryStatusReady, true, "当前 review / usage / quota / notification 已收成单一 delivery contract；发布前按 handoff note 跑 release gate 即可。"
}

func buildPullRequestDeliveryHandoffNote(
	pr PullRequest,
	room Room,
	run Run,
	issue Issue,
	reviewGate PullRequestDeliveryGate,
	usageGate PullRequestDeliveryGate,
	quotaGate PullRequestDeliveryGate,
	notificationGate PullRequestDeliveryGate,
	delegation PullRequestDeliveryDelegation,
	governanceAggregation WorkspaceResponseAggregation,
	governedCloseout WorkspaceGovernanceSuggestedHandoff,
	status string,
	releaseReady bool,
) PullRequestDeliveryHandoffNote {
	lines := []string{
		fmt.Sprintf("交付对象：%s / %s。", defaultString(strings.TrimSpace(pr.Label), "当前 PR"), defaultString(strings.TrimSpace(pr.Title), "待整理标题")),
		fmt.Sprintf("Room / Run：%s / %s。", defaultString(strings.TrimSpace(room.Title), room.ID), defaultString(strings.TrimSpace(run.ID), "待整理 run")),
		fmt.Sprintf("当前 review gate：%s", reviewGate.Summary),
		fmt.Sprintf("当前 run usage：%s", usageGate.Summary),
		fmt.Sprintf("当前 workspace quota：%s", quotaGate.Summary),
		fmt.Sprintf("当前通知 / handoff：%s", notificationGate.Summary),
		fmt.Sprintf("发布前命令：`pnpm verify:release` -> `pnpm ops:smoke`。Issue = %s。", defaultString(strings.TrimSpace(issue.Key), "待整理 issue")),
	}
	if governanceAggregation.Status == "ready" && strings.TrimSpace(governanceAggregation.FinalResponse) != "" {
		lines = append(lines, fmt.Sprintf("当前治理收口：%s", governanceAggregation.FinalResponse))
	}
	if governedCloseout.Status == "done" {
		lines = append(lines, "governed route 已到 done；当前不需要新的 formal handoff，直接围这份 delivery entry / release gate 做最后收口。")
	}
	if delegation.Status == "ready" {
		lines = append(lines, fmt.Sprintf("当前 delivery delegation：交给 %s（%s）。", delegation.TargetAgent, delegation.TargetLane))
		if strings.TrimSpace(delegation.HandoffStatus) != "" {
			lines = append(lines, fmt.Sprintf("系统已自动创建 formal delivery closeout handoff，当前状态：%s。", delegation.HandoffStatus))
		}
	} else if delegation.Status == "blocked" {
		lines = append(lines, fmt.Sprintf("当前 delivery delegation blocked：%s", delegation.Summary))
	} else if delegation.Status == "done" && strings.TrimSpace(delegation.HandoffStatus) != "" {
		lines = append(lines, fmt.Sprintf("delivery delegation handoff 已完成：%s。", delegation.TargetAgent))
	}

	summary := "当前 closeout 仍需围着 blocked gate 修复后再交付。"
	switch status {
	case deliveryEntryStatusReady:
		summary = "这条 PR 的 handoff note 已把 review / usage / quota / notification 和发布前命令收成一页。"
	case deliveryEntryStatusWarning:
		summary = "这条 PR 没有 hard blocker，但 handoff 时仍要把 warning 写清。"
	}
	if governanceAggregation.Status == "ready" && governedCloseout.Status == "done" {
		summary = "这条 PR 的 handoff note 已接住 governed closeout，可直接围 delivery entry / release gate 做最后交付收口。"
	}
	if delegation.Status == "ready" {
		summary = fmt.Sprintf("这条 PR 的 handoff note 已接住 governed closeout，并明确委托给 %s 做最终 delivery closeout。", delegation.TargetAgent)
	}
	if releaseReady {
		lines = append(lines, "当前 release-ready 已成立；operator 只需按上面的 release gate 命令补最终验收。")
	} else {
		lines = append(lines, "当前 release-ready 还未成立；请先修掉 blocked gate 再继续 closeout。")
	}

	return PullRequestDeliveryHandoffNote{
		Title:   fmt.Sprintf("%s operator handoff note", defaultString(strings.TrimSpace(pr.Label), "PR")),
		Summary: summary,
		Lines:   lines,
	}
}

func buildPullRequestDeliveryEvidence(
	snapshot State,
	pr PullRequest,
	room Room,
	run Run,
	issue Issue,
	conversation []PullRequestConversationEntry,
	templates []PullRequestDeliveryTemplate,
	governanceAggregation WorkspaceResponseAggregation,
	governedCloseout WorkspaceGovernanceSuggestedHandoff,
) []PullRequestDeliveryEvidence {
	items := []PullRequestDeliveryEvidence{
		{
			ID:      "release-contract",
			Label:   "Release Contract",
			Value:   "pnpm verify:release -> pnpm ops:smoke",
			Summary: "发布前最短正确命令链，避免 release gate / smoke / handoff note 分散在多处。",
		},
		{
			ID:      "room-pr-tab",
			Label:   "Room PR Tab",
			Value:   defaultString(strings.TrimSpace(room.Title), room.ID),
			Summary: defaultString(strings.TrimSpace(room.Summary), "回到 room 的 PR 工作台继续收 review / merge / blocked 真值。"),
			Href:    fmt.Sprintf("/rooms/%s?tab=pr", room.ID),
		},
		{
			ID:      "run-context",
			Label:   "Run Context",
			Value:   defaultString(strings.TrimSpace(run.ID), "待整理 run"),
			Summary: defaultString(strings.TrimSpace(run.Summary), "继续围这条 run 的 usage、timeline 与 next action 做交付判断。"),
			Href:    fmt.Sprintf("/runs/%s", run.ID),
		},
	}

	if strings.TrimSpace(pr.URL) != "" {
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "remote-pr",
			Label:   "Remote PR",
			Value:   pr.URL,
			Summary: defaultString(strings.TrimSpace(pr.ReviewSummary), "远端 PR 当前 review / merge 真值。"),
			Href:    pr.URL,
		})
	}
	if governanceAggregation.Status == "ready" && strings.TrimSpace(governanceAggregation.FinalResponse) != "" {
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "governed-closeout",
			Label:   "Governed Closeout",
			Value:   defaultString(strings.TrimSpace(governanceAggregation.Aggregator), "workspace governance"),
			Summary: governanceAggregation.FinalResponse,
			Href:    defaultString(strings.TrimSpace(governedCloseout.Href), "/mailbox"),
		})
	}
	delegation := buildPullRequestDeliveryDelegation(snapshot, pr, governedCloseout)
	if delegation.Status == "ready" {
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "delivery-delegate",
			Label:   "Delivery Delegate",
			Value:   delegation.TargetAgent,
			Summary: delegation.Summary,
			Href:    delegation.Href,
		})
	}
	if strings.TrimSpace(delegation.HandoffID) != "" {
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "delivery-delegate-handoff",
			Label:   "Delegated Closeout Handoff",
			Value:   defaultString(strings.TrimSpace(delegation.HandoffStatus), "requested"),
			Summary: delegation.Summary,
			Href:    delegation.HandoffHref,
		})
	}

	if len(conversation) > 0 {
		latest := conversation[0]
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "review-conversation",
			Label:   "Latest Review Event",
			Value:   fmt.Sprintf("%d entries", len(conversation)),
			Summary: fmt.Sprintf("%s · %s", latest.Author, latest.Summary),
			Href:    fmt.Sprintf("/pull-requests/%s", pr.ID),
		})
	}

	if len(templates) > 0 {
		templateLabels := make([]string, 0, len(templates))
		for _, template := range templates {
			templateLabels = append(templateLabels, fmt.Sprintf("%s(%s)", template.Label, template.Status))
		}
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "notification-templates",
			Label:   "Notification Templates",
			Value:   strings.Join(templateLabels, " / "),
			Summary: "通知模板与 fanout receipt 现在和交付入口在同一页，不再只留在 settings。",
			Href:    "/settings",
		})
	}

	decisionPath := decisionArtifactPath(issue.Key)
	if artifact := findMemoryArtifactByPathInSnapshot(snapshot, decisionPath); artifact != nil {
		items = append(items, PullRequestDeliveryEvidence{
			ID:      "decision-ledger",
			Label:   "Decision Ledger",
			Value:   artifact.Path,
			Summary: defaultString(strings.TrimSpace(artifact.LatestWrite), artifact.Summary),
		})
	}

	return items
}

func deliveryDelegationInboxItemID(pullRequestID string) string {
	return "inbox-delivery-delegation-" + strings.TrimSpace(pullRequestID)
}

func deliveryMatchesPullRequest(inboxItemID, href string, pr PullRequest, relatedInboxIDs map[string]bool) bool {
	if relatedInboxIDs[inboxItemID] {
		return true
	}
	href = strings.TrimSpace(href)
	if href == "" {
		return false
	}
	return strings.Contains(href, pr.RunID) || strings.Contains(href, pr.RoomID) || strings.Contains(href, fmt.Sprintf("/pull-requests/%s", pr.ID))
}

func deliveryEntryStatusRank(status string) int {
	switch status {
	case deliveryEntryStatusBlocked:
		return 0
	case deliveryEntryStatusWarning:
		return 1
	default:
		return 2
	}
}
