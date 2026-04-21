package store

import (
	"fmt"
	"strings"
	"time"
)

const (
	experienceMetricReady   = "ready"
	experienceMetricWarning = "warning"
	experienceMetricBlocked = "blocked"
	experienceMetricPartial = "partial"
)

type ExperienceMetric struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Value   string `json:"value"`
	Target  string `json:"target"`
	Summary string `json:"summary"`
	Href    string `json:"href,omitempty"`
}

type ExperienceMetricSection struct {
	ID           string             `json:"id"`
	Label        string             `json:"label"`
	Summary      string             `json:"summary"`
	ReadyCount   int                `json:"readyCount"`
	WarningCount int                `json:"warningCount"`
	BlockedCount int                `json:"blockedCount"`
	PartialCount int                `json:"partialCount"`
	Metrics      []ExperienceMetric `json:"metrics"`
}

type ExperienceMetricsSnapshot struct {
	RefreshedAt  string                    `json:"refreshedAt"`
	Workspace    string                    `json:"workspace"`
	Repo         string                    `json:"repo"`
	Branch       string                    `json:"branch"`
	Summary      string                    `json:"summary"`
	Methodology  string                    `json:"methodology"`
	ReadyCount   int                       `json:"readyCount"`
	WarningCount int                       `json:"warningCount"`
	BlockedCount int                       `json:"blockedCount"`
	PartialCount int                       `json:"partialCount"`
	Sections     []ExperienceMetricSection `json:"sections"`
}

func (s *Store) ExperienceMetrics() ExperienceMetricsSnapshot {
	snapshot := s.Snapshot()
	notificationCenter := s.NotificationCenter()
	memoryCenter := s.MemoryCenter()
	return buildExperienceMetricsSnapshot(snapshot, notificationCenter, memoryCenter)
}

func buildExperienceMetricsSnapshot(snapshot State, notificationCenter NotificationCenter, memoryCenter MemoryCenter) ExperienceMetricsSnapshot {
	sections := []ExperienceMetricSection{
		buildProductMetrics(snapshot, notificationCenter, memoryCenter),
		buildExperienceMetricsSection(snapshot, notificationCenter, memoryCenter),
		buildDesignMetrics(snapshot),
	}

	summary := ExperienceMetricsSnapshot{
		RefreshedAt: time.Now().UTC().Format(time.RFC3339),
		Workspace:   defaultString(snapshot.Workspace.Name, "OpenShock Workspace"),
		Repo:        snapshot.Workspace.Repo,
		Branch:      snapshot.Workspace.Branch,
		Methodology: "Derived from the current workspace state, notification center, and memory center. Historical metrics without durable time-series truth stay marked as partial instead of being guessed.",
		Sections:    sections,
	}

	for _, section := range sections {
		summary.ReadyCount += section.ReadyCount
		summary.WarningCount += section.WarningCount
		summary.BlockedCount += section.BlockedCount
		summary.PartialCount += section.PartialCount
	}
	summary.Summary = fmt.Sprintf(
		"%d ready / %d warning / %d blocked / %d partial across %d metrics.",
		summary.ReadyCount,
		summary.WarningCount,
		summary.BlockedCount,
		summary.PartialCount,
		countSectionMetrics(sections),
	)

	return summary
}

func buildProductMetrics(snapshot State, notificationCenter NotificationCenter, memoryCenter MemoryCenter) ExperienceMetricSection {
	issuesWithRunTruth := 0
	issuesWithPullRequest := 0
	activeSessions := 0
	activeRuns := 0
	activeSessionsByIssue := map[string]int{}
	continuitySessions := 0

	for _, issue := range snapshot.Issues {
		if strings.TrimSpace(issue.RoomID) != "" && strings.TrimSpace(issue.RunID) != "" {
			if _, ok := findRunInState(snapshot, issue.RunID); ok {
				issuesWithRunTruth++
			}
		}
		if issueHasPullRequest(snapshot, issue) {
			issuesWithPullRequest++
		}
	}

	for _, session := range snapshot.Sessions {
		if isActiveSessionStatus(session.Status) {
			activeSessions++
			activeSessionsByIssue[session.IssueKey]++
		}
		if len(session.MemoryPaths) > 0 || strings.TrimSpace(session.ControlNote) != "" || session.FollowThread {
			continuitySessions++
		}
	}

	for _, run := range snapshot.Runs {
		if isActiveRunStatus(run.Status) {
			activeRuns++
		}
	}

	invitedMembers := 0
	activeMembers := 0
	for _, member := range snapshot.Auth.Members {
		switch member.Status {
		case workspaceMemberStatusInvited:
			invitedMembers++
		case workspaceMemberStatusActive:
			activeMembers++
		}
	}

	maxIssueParallelism := 0
	maxIssueParallelismLabel := "none"
	for issueKey, count := range activeSessionsByIssue {
		if count > maxIssueParallelism {
			maxIssueParallelism = count
			maxIssueParallelismLabel = issueKey
		}
	}

	totalHandoffs := len(snapshot.Mailbox)
	ackedHandoffs := 0
	blockedHandoffs := 0
	for _, handoff := range snapshot.Mailbox {
		switch handoff.Status {
		case "acknowledged", "completed":
			ackedHandoffs++
		case "blocked":
			blockedHandoffs++
		}
	}

	totalPreviews := len(memoryCenter.Previews)
	previewsWithRecall := 0
	for _, preview := range memoryCenter.Previews {
		if len(preview.Items) > 0 {
			previewsWithRecall++
		}
	}

	recoveredIssues, blockedIssues, retriedIssues := deriveRecoveryMetrics(snapshot)
	interventionAverage := 0.0
	if len(snapshot.Issues) > 0 {
		interventionAverage = float64(notificationCenter.ApprovalCenter.OpenCount) / float64(len(snapshot.Issues))
	}

	metrics := []ExperienceMetric{
		experienceMetric(
			"issue-first-run",
			"Issue -> first run truth",
			statusFromCoverage(issuesWithRunTruth, len(snapshot.Issues)),
			fmt.Sprintf("%d/%d issues already carry room + run truth", issuesWithRunTruth, len(snapshot.Issues)),
			"Every issue should project straight into a runnable lane.",
			"Checks whether each issue already has a linked room and run instead of stopping at planning-only truth.",
			"/issues",
		),
		experienceMetric(
			"invite-join",
			"Invite -> join pipeline",
			statusFromPending(invitedMembers, len(snapshot.Auth.Members)),
			fmt.Sprintf("%d active / %d invited pending", activeMembers, invitedMembers),
			"Invites should continue forward into active workspace membership.",
			"Derived from current member roster truth instead of manual invite bookkeeping.",
			"/access",
		),
		experienceMetric(
			"onboarding-completion",
			"Onboarding completion",
			statusFromOnboarding(snapshot.Workspace.Onboarding),
			fmt.Sprintf("%s / %d completed steps", defaultString(snapshot.Workspace.Onboarding.Status, "unknown"), len(snapshot.Workspace.Onboarding.CompletedSteps)),
			"Onboarding should persist, resume, and finish from the current template truth.",
			fmt.Sprintf("Tracks workspace onboarding status plus completed step count; current step = %s.", defaultString(snapshot.Workspace.Onboarding.CurrentStep, "unset")),
			defaultString(snapshot.Workspace.Onboarding.ResumeURL, "/setup"),
		),
		experienceMetric(
			"session-concurrency",
			"Concurrent sessions",
			statusFromObserved(activeSessions),
			fmt.Sprintf("%d active sessions / %d active runs", activeSessions, activeRuns),
			"Daily session concurrency should be continuously observable.",
			"Counts live session and run lanes from the current workspace snapshot.",
			"/runs",
		),
		experienceMetric(
			"issue-parallelism",
			"Issue parallelism",
			statusFromObserved(maxIssueParallelism),
			fmt.Sprintf("max %d active sessions on %s", maxIssueParallelism, maxIssueParallelismLabel),
			"Single-issue parallel work should stay visible instead of hiding in side threads.",
			"Uses current active sessions grouped by issue key to show how much parallelism the queue is actually carrying.",
			"/board",
		),
		experienceMetric(
			"manual-intervention-load",
			"Manual intervention load",
			statusFromInterventionLoad(notificationCenter.ApprovalCenter.OpenCount, notificationCenter.ApprovalCenter.BlockedCount),
			fmt.Sprintf("%d open signals / %.1f per issue", notificationCenter.ApprovalCenter.OpenCount, interventionAverage),
			"Human intervention should be explicit and measurable.",
			fmt.Sprintf("Approval center currently shows %d approvals, %d blocked items, and %d review items.", notificationCenter.ApprovalCenter.ApprovalCount, notificationCenter.ApprovalCenter.BlockedCount, notificationCenter.ApprovalCenter.ReviewCount),
			"/inbox",
		),
		experienceMetric(
			"pr-auto-create",
			"PR auto-create coverage",
			statusFromCoverage(issuesWithPullRequest, len(snapshot.Issues)),
			fmt.Sprintf("%d/%d issues already carry PR truth", issuesWithPullRequest, len(snapshot.Issues)),
			"Issue -> branch -> PR alignment should not require manual cross-checking.",
			"Counts issues that already project to a tracked pull request or run-level PR label.",
			"/issues",
		),
		experienceMetric(
			"handoff-ack-rate",
			"Agent handoff ack rate",
			statusFromHandoffs(totalHandoffs, ackedHandoffs, blockedHandoffs),
			fmt.Sprintf("%d/%d acked or completed", ackedHandoffs, totalHandoffs),
			"Formal handoffs should move out of requested state with explicit ack/block truth.",
			fmt.Sprintf("Mailbox currently has %d total handoffs with %d blocked.", totalHandoffs, blockedHandoffs),
			"/mailbox",
		),
		experienceMetric(
			"memory-recall-hit",
			"Cross-session memory recall hit",
			statusFromCoverageWithEmptyAsPartial(previewsWithRecall, totalPreviews),
			fmt.Sprintf("%d/%d session previews carry recall items", previewsWithRecall, totalPreviews),
			"Cross-session memory recall should come from the same governed memory truth.",
			"Uses memory injection previews as the current observable signal for recall readiness.",
			"/memory",
		),
		experienceMetric(
			"repeat-instruction-reduction",
			"Repeated-instruction reduction",
			experienceMetricPartial,
			fmt.Sprintf("%d/%d sessions already carry continuity hints", continuitySessions, len(snapshot.Sessions)),
			"Repeated setup instructions should keep shrinking over time.",
			"Current state exposes memory paths, control notes, and follow-thread continuity, but there is no durable before/after delta yet.",
			"/runs",
		),
		experienceMetric(
			"blocked-recovery",
			"Blocked recovery within 24h",
			experienceMetricPartial,
			fmt.Sprintf("%d/%d blocked issues already show a recovery lane", recoveredIssues, blockedIssues),
			"Blocked work should recover inside a clearly observable time window.",
			"Recovery lanes are visible from multi-run issue history, but 24h SLA timing still needs durable event rollups.",
			"/inbox",
		),
		experienceMetric(
			"retry-success",
			"Retry success after failure",
			experienceMetricPartial,
			fmt.Sprintf("%d issues show retry continuity", retriedIssues),
			"After a failure, the next successful lane should be measurable without manual log reading.",
			"Current run history can show multi-lane recovery, but not a stable success-after-failure rate over time.",
			"/runs",
		),
	}

	return summarizeMetricSection(
		"product",
		"产品指标",
		"Product metrics stay tied to current issue, member, PR, mailbox, and memory truth. Historical rates that still lack durable event rollups remain explicit partials.",
		metrics,
	)
}

func buildExperienceMetricsSection(snapshot State, notificationCenter NotificationCenter, memoryCenter MemoryCenter) ExperienceMetricSection {
	runsWithFailureLocation := 0
	issueContextCoverage := 0
	for _, run := range snapshot.Runs {
		if strings.TrimSpace(run.RoomID) != "" &&
			strings.TrimSpace(run.Runtime) != "" &&
			strings.TrimSpace(run.Machine) != "" &&
			strings.TrimSpace(run.Worktree) != "" &&
			strings.TrimSpace(run.Branch) != "" {
			runsWithFailureLocation++
		}
	}
	for _, issue := range snapshot.Issues {
		if issueHasContextChain(snapshot, notificationCenter, issue) {
			issueContextCoverage++
		}
	}

	actionableSignals := 0
	for _, signal := range notificationCenter.ApprovalCenter.Signals {
		if len(signal.DecisionOptions) > 0 && strings.TrimSpace(signal.Href) != "" {
			actionableSignals++
		}
	}

	totalMemoryArtifacts := len(snapshot.Memory)
	explainedMemoryArtifacts := 0
	for _, artifact := range snapshot.Memory {
		if strings.TrimSpace(artifact.LatestSource) != "" &&
			strings.TrimSpace(artifact.LatestActor) != "" &&
			strings.TrimSpace(artifact.UpdatedAt) != "" {
			explainedMemoryArtifacts++
		}
	}

	totalHandoffs := len(snapshot.Mailbox)
	explainedHandoffs := 0
	for _, handoff := range snapshot.Mailbox {
		if strings.TrimSpace(handoff.FromAgent) != "" &&
			strings.TrimSpace(handoff.ToAgent) != "" &&
			strings.TrimSpace(handoff.LastAction) != "" &&
			strings.TrimSpace(handoff.RoomID) != "" {
			explainedHandoffs++
		}
	}

	authorizedDevice := snapshot.Auth.Session.DeviceAuthStatus == authDeviceStatusAuthorized || snapshot.Auth.Session.Status == authSessionStatusSignedOut
	pairedRuntime := strings.TrimSpace(snapshot.Workspace.PairingStatus) == "paired"
	onlineRuntimes := 0
	for _, runtime := range snapshot.Runtimes {
		if strings.TrimSpace(runtime.State) == "online" {
			onlineRuntimes++
		}
	}

	onboarding := snapshot.Workspace.Onboarding
	materializedAgents := len(onboarding.Materialization.Agents)
	materializedChannels := len(onboarding.Materialization.Channels)

	previewsWithItems := 0
	for _, preview := range memoryCenter.Previews {
		if len(preview.Items) > 0 {
			previewsWithItems++
		}
	}

	metrics := []ExperienceMetric{
		experienceMetric(
			"failure-location",
			"Failure location in 30s",
			statusFromCoverage(runsWithFailureLocation, len(snapshot.Runs)),
			fmt.Sprintf("%d/%d runs expose session + runtime + worktree truth", runsWithFailureLocation, len(snapshot.Runs)),
			"A failed lane should be locatable by session, runtime, and worktree without reading raw logs first.",
			"Checks whether run surfaces already expose the minimum routing fields users need to localize a failure quickly.",
			"/runs",
		),
		experienceMetric(
			"inbox-correction",
			"Inbox correction actionability",
			statusFromInboxCorrection(actionableSignals, notificationCenter.ApprovalCenter.OpenCount),
			fmt.Sprintf("%d/%d open signals already have direct decisions", actionableSignals, notificationCenter.ApprovalCenter.OpenCount),
			"Users should be able to correct a blocked lane from Inbox without detouring through raw state.",
			"Looks for decision options plus backlinks on each open approval/review/blocked signal.",
			"/inbox",
		),
		experienceMetric(
			"device-auth-runtime",
			"Device auth -> first runtime",
			statusFromAuthAndRuntime(snapshot.Auth.Session.Status, authorizedDevice, pairedRuntime, onlineRuntimes),
			fmt.Sprintf("device %s / pairing %s / %d runtimes online", defaultString(snapshot.Auth.Session.DeviceAuthStatus, snapshot.Workspace.DeviceAuth), defaultString(snapshot.Workspace.PairingStatus, "unknown"), onlineRuntimes),
			"A fresh device should reach an authorized runtime without hidden side conditions.",
			"Combines auth session device status, workspace runtime pairing, and current runtime availability.",
			"/setup",
		),
		experienceMetric(
			"template-onboarding",
			"Template onboarding -> first agent",
			statusFromTemplateOnboarding(onboarding, materializedAgents, materializedChannels),
			fmt.Sprintf("%s / %d agents / %d channels", defaultString(onboarding.Status, "unknown"), materializedAgents, materializedChannels),
			"Template onboarding should materialize the initial channels and agents instead of stopping at a wizard shell.",
			"Uses persisted onboarding materialization truth plus current onboarding status.",
			defaultString(onboarding.ResumeURL, "/setup"),
		),
		experienceMetric(
			"context-disambiguation",
			"Target / discussion / code / blocker disambiguation",
			statusFromCoverage(issueContextCoverage, len(snapshot.Issues)),
			fmt.Sprintf("%d/%d issues expose room + run + PR/blocker chain", issueContextCoverage, len(snapshot.Issues)),
			"Users should be able to say where the target is, where the discussion is, where the code is, and where it is blocked.",
			"Checks each issue for room truth, run truth, and either PR truth or an inbox/guard blocker link.",
			"/rooms",
		),
		experienceMetric(
			"memory-provenance",
			"Memory provenance explainability",
			statusFromCoverageWithEmptyAsPartial(explainedMemoryArtifacts, totalMemoryArtifacts),
			fmt.Sprintf("%d/%d artifacts carry source + actor + time", explainedMemoryArtifacts, totalMemoryArtifacts),
			"Users should be able to explain where a memory came from, who wrote it, and when it changed.",
			fmt.Sprintf("Current memory center exposes %d previews with recall items.", previewsWithItems),
			"/memory",
		),
		experienceMetric(
			"handoff-provenance",
			"Agent handoff explainability",
			statusFromCoverageWithEmptyAsPartial(explainedHandoffs, totalHandoffs),
			fmt.Sprintf("%d/%d handoffs explain who -> who -> why", explainedHandoffs, totalHandoffs),
			"Formal handoff truth should answer who requested the work, who received it, and why it got blocked.",
			"Derived from mailbox ledger fields instead of room-side narration alone.",
			"/mailbox",
		),
	}

	return summarizeMetricSection(
		"experience",
		"体验指标",
		"Experience metrics stay tied to actionable user-facing truth: run routing, inbox decisions, onboarding, memory provenance, and mailbox explainability.",
		metrics,
	)
}

func buildDesignMetrics(snapshot State) ExperienceMetricSection {
	startRoute := defaultString(snapshot.Auth.Session.Preferences.StartRoute, defaultWorkspaceMemberPreferences().StartRoute)
	agentsWithVisibility := 0
	for _, agent := range snapshot.Agents {
		if strings.TrimSpace(agent.State) != "" && strings.TrimSpace(agent.Lane) != "" {
			agentsWithVisibility++
		}
	}
	machinesWithVisibility := 0
	for _, machine := range snapshot.Machines {
		if strings.TrimSpace(machine.State) != "" && strings.TrimSpace(machine.Name) != "" {
			machinesWithVisibility++
		}
	}
	profileReadyAgents := 0
	for _, agent := range snapshot.Agents {
		if strings.TrimSpace(agent.Role) != "" &&
			strings.TrimSpace(agent.ProviderPreference) != "" &&
			strings.TrimSpace(agent.RuntimePreference) != "" {
			profileReadyAgents++
		}
	}
	machineCapabilityVisible := 0
	for _, machine := range snapshot.Machines {
		if strings.TrimSpace(machine.CLI) != "" && strings.TrimSpace(machine.OS) != "" {
			machineCapabilityVisible++
		}
	}

	metrics := []ExperienceMetric{
		experienceMetric(
			"collaboration-shell-first",
			"Collaboration shell first entry",
			statusFromStartRoute(startRoute),
			startRoute,
			"First entry should land in a collaboration shell rather than a planning-first or auth-only detour.",
			"Uses the current member start-route preference as the observable first-entry contract.",
			startRoute,
		),
		experienceMetric(
			"active-agent-machine-visibility",
			"Active agent / machine visibility",
			statusFromDualCoverage(agentsWithVisibility, len(snapshot.Agents), machinesWithVisibility, len(snapshot.Machines)),
			fmt.Sprintf("%d/%d agents + %d/%d machines show live state", agentsWithVisibility, len(snapshot.Agents), machinesWithVisibility, len(snapshot.Machines)),
			"Users should be able to identify who is working and on which machine at a glance.",
			"Checks for agent state/lane and machine state visibility in the live workspace projection.",
			"/agents",
		),
		experienceMetric(
			"board-secondary",
			"Board stays secondary to chat / room / inbox",
			statusFromBoardSecondary(startRoute, len(snapshot.Rooms), len(snapshot.Inbox)),
			fmt.Sprintf("start route %s / %d rooms / %d inbox items", startRoute, len(snapshot.Rooms), len(snapshot.Inbox)),
			"Board can stay useful without becoming the primary collaboration shell.",
			"Looks for a non-board start route plus a live room/inbox chain that keeps execution truth in the foreground.",
			"/board",
		),
		experienceMetric(
			"profile-capability-visibility",
			"Profile / capability / onboarding visibility",
			statusFromTripleCoverage(profileReadyAgents, len(snapshot.Agents), machineCapabilityVisible, len(snapshot.Machines), strings.TrimSpace(snapshot.Workspace.Onboarding.CurrentStep) != ""),
			fmt.Sprintf("%d/%d agents profiled / %d/%d machines surfaced / onboarding step %s", profileReadyAgents, len(snapshot.Agents), machineCapabilityVisible, len(snapshot.Machines), defaultString(snapshot.Workspace.Onboarding.CurrentStep, "unset")),
			"Agent profile, machine capability, and onboarding progress should not hide as low-priority settings residue.",
			"Uses live profile fields, machine capability truth, and persisted onboarding step to decide whether these surfaces are actually visible enough to matter.",
			"/profiles/agent/"+defaultString(firstAgentID(snapshot.Agents), ""),
		),
	}

	return summarizeMetricSection(
		"design",
		"设计指标",
		"Design metrics stay constrained to currently observable surface truth: entry route, live actor visibility, board priority, and profile/capability/onboarding presence.",
		metrics,
	)
}

func summarizeMetricSection(id, label, summary string, metrics []ExperienceMetric) ExperienceMetricSection {
	section := ExperienceMetricSection{
		ID:      id,
		Label:   label,
		Summary: summary,
		Metrics: metrics,
	}
	for _, metric := range metrics {
		switch metric.Status {
		case experienceMetricReady:
			section.ReadyCount++
		case experienceMetricWarning:
			section.WarningCount++
		case experienceMetricBlocked:
			section.BlockedCount++
		case experienceMetricPartial:
			section.PartialCount++
		}
	}
	return section
}

func experienceMetric(id, label, status, value, target, summary, href string) ExperienceMetric {
	return ExperienceMetric{
		ID:      id,
		Label:   label,
		Status:  status,
		Value:   value,
		Target:  target,
		Summary: summary,
		Href:    href,
	}
}

func countSectionMetrics(sections []ExperienceMetricSection) int {
	total := 0
	for _, section := range sections {
		total += len(section.Metrics)
	}
	return total
}

func statusFromCoverage(ok, total int) string {
	switch {
	case total == 0:
		return experienceMetricBlocked
	case ok == total:
		return experienceMetricReady
	case ok > 0:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromCoverageWithEmptyAsPartial(ok, total int) string {
	switch {
	case total == 0:
		return experienceMetricPartial
	case ok == total:
		return experienceMetricReady
	case ok > 0:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromPending(pending, total int) string {
	switch {
	case total == 0:
		return experienceMetricBlocked
	case pending == 0:
		return experienceMetricReady
	default:
		return experienceMetricWarning
	}
}

func statusFromOnboarding(onboarding WorkspaceOnboardingSnapshot) string {
	if workspaceOnboardingIsComplete(onboarding) {
		return experienceMetricReady
	}
	switch strings.TrimSpace(onboarding.Status) {
	case workspaceOnboardingReady, workspaceOnboardingInProgress:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromInboxCorrection(ok, total int) string {
	switch {
	case total == 0:
		return experienceMetricReady
	case ok == total:
		return experienceMetricReady
	case ok > 0:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromTemplateOnboarding(onboarding WorkspaceOnboardingSnapshot, materializedAgents, materializedChannels int) string {
	switch {
	case workspaceOnboardingIsComplete(onboarding) && materializedAgents > 0 && materializedChannels > 0:
		return experienceMetricReady
	case materializedAgents > 0 || materializedChannels > 0 || strings.TrimSpace(onboarding.Status) == workspaceOnboardingReady:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromObserved(count int) string {
	if count > 0 {
		return experienceMetricReady
	}
	return experienceMetricWarning
}

func statusFromInterventionLoad(openCount, blockedCount int) string {
	switch {
	case blockedCount > 0:
		return experienceMetricBlocked
	case openCount > 0:
		return experienceMetricWarning
	default:
		return experienceMetricReady
	}
}

func statusFromHandoffs(total, acked, blocked int) string {
	switch {
	case total == 0:
		return experienceMetricPartial
	case acked == total && blocked == 0:
		return experienceMetricReady
	case acked > 0 || blocked > 0:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromAuthAndRuntime(sessionStatus string, authorizedDevice, pairedRuntime bool, onlineRuntimes int) string {
	switch {
	case strings.TrimSpace(sessionStatus) != authSessionStatusActive:
		return experienceMetricBlocked
	case authorizedDevice && pairedRuntime && onlineRuntimes > 0:
		return experienceMetricReady
	case authorizedDevice || pairedRuntime || onlineRuntimes > 0:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromStartRoute(startRoute string) string {
	switch strings.TrimSpace(startRoute) {
	case "/rooms", "/chat/all", "/inbox", "/mailbox":
		return experienceMetricReady
	case "/setup":
		return experienceMetricWarning
	case "/board":
		return experienceMetricBlocked
	default:
		return experienceMetricBlocked
	}
}

func statusFromBoardSecondary(startRoute string, rooms, inbox int) string {
	if strings.TrimSpace(startRoute) == "/board" {
		return experienceMetricBlocked
	}
	if rooms > 0 && inbox > 0 {
		return experienceMetricReady
	}
	return experienceMetricWarning
}

func statusFromDualCoverage(leftOK, leftTotal, rightOK, rightTotal int) string {
	switch {
	case leftTotal == 0 || rightTotal == 0:
		return experienceMetricBlocked
	case leftOK == leftTotal && rightOK == rightTotal:
		return experienceMetricReady
	case leftOK > 0 && rightOK > 0:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func statusFromTripleCoverage(leftOK, leftTotal, middleOK, middleTotal int, rightOK bool) string {
	switch {
	case leftTotal == 0 || middleTotal == 0:
		return experienceMetricBlocked
	case leftOK == leftTotal && middleOK == middleTotal && rightOK:
		return experienceMetricReady
	case leftOK > 0 || middleOK > 0 || rightOK:
		return experienceMetricWarning
	default:
		return experienceMetricBlocked
	}
}

func isActiveSessionStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "running", "review", "blocked", "queued", "waiting":
		return true
	default:
		return false
	}
}

func isActiveRunStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "running", "review", "blocked", "queued", "waiting":
		return true
	default:
		return false
	}
}

func issueHasPullRequest(snapshot State, issue Issue) bool {
	if strings.TrimSpace(issue.PullRequest) != "" {
		return true
	}
	for _, pullRequest := range snapshot.PullRequests {
		if pullRequest.IssueKey == issue.Key || pullRequest.RunID == issue.RunID {
			return true
		}
	}
	return false
}

func issueHasContextChain(snapshot State, notificationCenter NotificationCenter, issue Issue) bool {
	if strings.TrimSpace(issue.RoomID) == "" || strings.TrimSpace(issue.RunID) == "" {
		return false
	}
	if _, ok := findRunInState(snapshot, issue.RunID); !ok {
		return false
	}
	if !issueHasPullRequest(snapshot, issue) {
		for _, item := range snapshot.Inbox {
			if strings.Contains(item.Href, issue.RunID) || strings.Contains(item.Href, issue.RoomID) {
				return true
			}
		}
		for _, item := range notificationCenter.ApprovalCenter.Signals {
			if item.RoomID == issue.RoomID || item.RunID == issue.RunID {
				return true
			}
		}
		for _, guard := range snapshot.Guards {
			if guard.RoomID == issue.RoomID || guard.RunID == issue.RunID {
				return true
			}
		}
		return false
	}
	return true
}

func deriveRecoveryMetrics(snapshot State) (recoveredIssues int, blockedIssues int, retriedIssues int) {
	runsByIssue := map[string][]Run{}
	for _, run := range snapshot.Runs {
		if strings.TrimSpace(run.IssueKey) == "" {
			continue
		}
		runsByIssue[run.IssueKey] = append(runsByIssue[run.IssueKey], run)
	}

	for _, runs := range runsByIssue {
		hasBlocked := false
		hasRecovery := false
		if len(runs) > 1 {
			retriedIssues++
		}
		for _, run := range runs {
			if strings.TrimSpace(run.Status) == "blocked" {
				hasBlocked = true
				continue
			}
			if isRecoveryRunStatus(run.Status) {
				hasRecovery = true
			}
		}
		if hasBlocked {
			blockedIssues++
			if hasRecovery {
				recoveredIssues++
			}
		}
	}

	return recoveredIssues, blockedIssues, retriedIssues
}

func isRecoveryRunStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "running", "review", "done":
		return true
	default:
		return false
	}
}

func firstAgentID(agents []Agent) string {
	for _, agent := range agents {
		if strings.TrimSpace(agent.ID) != "" {
			return agent.ID
		}
	}
	return ""
}
