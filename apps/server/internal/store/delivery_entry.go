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
	evidence := buildPullRequestDeliveryEvidence(snapshot, pr, room, run, issue, conversation, templates)
	handoffNote := buildPullRequestDeliveryHandoffNote(pr, room, run, issue, reviewGate, usageGate, quotaGate, notificationGate, status, releaseReady)

	return PullRequestDeliveryEntry{
		Status:       status,
		ReleaseReady: releaseReady,
		Summary:      summary,
		Gates:        gates,
		Templates:    templates,
		HandoffNote:  handoffNote,
		Evidence:     evidence,
	}
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

	summary := "当前 closeout 仍需围着 blocked gate 修复后再交付。"
	switch status {
	case deliveryEntryStatusReady:
		summary = "这条 PR 的 handoff note 已把 review / usage / quota / notification 和发布前命令收成一页。"
	case deliveryEntryStatusWarning:
		summary = "这条 PR 没有 hard blocker，但 handoff 时仍要把 warning 写清。"
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
