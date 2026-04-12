package store

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrPlannerSessionNotFound     = errors.New("planner session not found")
	ErrPlannerAgentNotFound       = errors.New("planner agent not found")
	ErrPlannerPullRequestNotFound = errors.New("planner pull request not found")
)

type PlannerQueueGate struct {
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Href    string `json:"href"`
}

type AutoMergeGuard struct {
	Status             string `json:"status"`
	Reason             string `json:"reason"`
	CanRequest         bool   `json:"canRequest"`
	CanApply           bool   `json:"canApply"`
	RequiresPermission string `json:"requiresPermission,omitempty"`
	ReviewDecision     string `json:"reviewDecision,omitempty"`
	PullRequestID      string `json:"pullRequestId,omitempty"`
	RoomID             string `json:"roomId,omitempty"`
	RunID              string `json:"runId,omitempty"`
}

type PlannerQueueItem struct {
	SessionID         string             `json:"sessionId"`
	IssueKey          string             `json:"issueKey"`
	RoomID            string             `json:"roomId"`
	RunID             string             `json:"runId"`
	Status            string             `json:"status"`
	Summary           string             `json:"summary"`
	Owner             string             `json:"owner"`
	AgentID           string             `json:"agentId,omitempty"`
	AgentName         string             `json:"agentName,omitempty"`
	Provider          string             `json:"provider"`
	Runtime           string             `json:"runtime"`
	Machine           string             `json:"machine"`
	WorktreePath      string             `json:"worktreePath,omitempty"`
	PullRequestID     string             `json:"pullRequestId,omitempty"`
	PullRequestLabel  string             `json:"pullRequestLabel,omitempty"`
	PullRequestStatus string             `json:"pullRequestStatus,omitempty"`
	ReviewDecision    string             `json:"reviewDecision,omitempty"`
	ApprovalRequired  bool               `json:"approvalRequired"`
	Gates             []PlannerQueueGate `json:"gates"`
	AutoMerge         AutoMergeGuard     `json:"autoMerge"`
}

type SessionAssignmentInput struct {
	AgentID string
}

func (s *Store) PlannerQueue() []PlannerQueueItem {
	snapshot := s.Snapshot()
	items := make([]PlannerQueueItem, 0, len(snapshot.Sessions))
	for _, session := range snapshot.Sessions {
		items = append(items, plannerQueueItemFromState(snapshot, session))
	}
	return items
}

func (s *Store) AutoMergeGuardForPullRequest(pullRequestID string) (AutoMergeGuard, bool) {
	snapshot := s.Snapshot()
	pr, ok := findPullRequestInState(snapshot, pullRequestID)
	if !ok {
		return AutoMergeGuard{}, false
	}
	return autoMergeGuardFromState(snapshot, pr), true
}

func (s *Store) AssignSession(sessionID string, input SessionAssignmentInput) (State, PlannerQueueItem, error) {
	agentID := strings.TrimSpace(input.AgentID)
	if agentID == "" {
		return State{}, PlannerQueueItem{}, fmt.Errorf("agentId is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	sessionIndex := -1
	for index := range s.state.Sessions {
		if s.state.Sessions[index].ID == sessionID {
			sessionIndex = index
			break
		}
	}
	if sessionIndex == -1 {
		return State{}, PlannerQueueItem{}, ErrPlannerSessionNotFound
	}

	agentIndex := -1
	for index := range s.state.Agents {
		if s.state.Agents[index].ID == agentID {
			agentIndex = index
			break
		}
	}
	if agentIndex == -1 {
		return State{}, PlannerQueueItem{}, ErrPlannerAgentNotFound
	}

	session := &s.state.Sessions[sessionIndex]
	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(session.RoomID)
	if !ok {
		return State{}, PlannerQueueItem{}, fmt.Errorf("room not found for planner session")
	}

	run := &s.state.Runs[runIndex]
	room := &s.state.Rooms[roomIndex]
	issue := &s.state.Issues[issueIndex]
	agent := &s.state.Agents[agentIndex]

	previousOwner := strings.TrimSpace(run.Owner)
	now := shortClock()
	summary := fmt.Sprintf("Planner 已把 %s 分配给 %s，等待继续执行。", issue.Key, agent.Name)

	issue.Owner = agent.Name
	room.Topic.Owner = agent.Name
	room.Topic.Status = "running"
	room.Topic.Summary = summary

	run.Owner = agent.Name
	run.Status = "running"
	run.Summary = summary
	run.NextAction = "继续在讨论间推进当前 run，并等待 review / auto-merge guard。"
	if text := strings.TrimSpace(agent.Provider); text != "" {
		run.Provider = text
	}
	run.Timeline = append(run.Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", run.ID, len(run.Timeline)+1),
		Label: fmt.Sprintf("Planner 已分配给 %s", agent.Name),
		At:    now,
		Tone:  "lime",
	})

	session.Status = "running"
	session.Summary = summary
	session.Provider = run.Provider
	session.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if len(session.MemoryPaths) == 0 {
		session.MemoryPaths = defaultSessionMemoryPaths(session.RoomID, session.IssueKey)
	}

	if previousOwner != "" && previousOwner != agent.Name {
		s.updateAgentStateLocked(previousOwner, "idle", "等待下一条 planner assignment")
	}
	agent.State = "running"
	agent.Mood = "Planner 已指派当前 run"
	agent.Lane = issue.Key
	agent.RecentRunIDs = prependUnique(agent.RecentRunIDs, run.ID)

	s.appendRoomMessageLocked(room.ID, Message{
		ID:      fmt.Sprintf("%s-planner-assignment-%d", room.ID, time.Now().UnixNano()),
		Speaker: "Planner",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("Planner 已把当前 run 分配给 %s。", agent.Name),
		Time:    now,
	})

	if err := appendRunArtifacts(s.workspaceRoot, room.ID, issue.Key, agent.Name, "Planner Assignment", fmt.Sprintf("- agent: %s\n- provider: %s\n- session: %s", agent.Name, run.Provider, session.ID)); err != nil {
		return State{}, PlannerQueueItem{}, err
	}

	if err := s.persistLocked(); err != nil {
		return State{}, PlannerQueueItem{}, err
	}

	nextState := cloneState(s.state)
	queueItem, _ := findPlannerQueueItem(nextState, session.ID)
	return nextState, queueItem, nil
}

func (s *Store) RequestAutoMerge(pullRequestID string) (State, AutoMergeGuard, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	prIndex := s.findPullRequestLocked(pullRequestID)
	if prIndex == -1 {
		return State{}, AutoMergeGuard{}, ErrPlannerPullRequestNotFound
	}

	pr := s.state.PullRequests[prIndex]
	guard := autoMergeGuardFromState(s.state, pr)
	if guard.Status != "ready" && guard.Status != "approval_required" {
		return cloneState(s.state), guard, nil
	}

	if guard.Status == "approval_required" {
		return cloneState(s.state), guard, nil
	}

	roomIndex, runIndex, _, ok := s.findRoomRunIssueLocked(pr.RoomID)
	if !ok {
		return State{}, AutoMergeGuard{}, fmt.Errorf("room not found for pull request")
	}

	run := &s.state.Runs[runIndex]
	room := &s.state.Rooms[roomIndex]
	message := fmt.Sprintf("%s 已申请 auto-merge，等待显式确认。", pr.Label)

	run.ApprovalRequired = true
	run.NextAction = "等待显式确认是否执行 auto-merge。"
	run.Status = "review"
	run.Summary = message
	room.Topic.Status = "review"
	room.Topic.Summary = message
	s.updateSessionLocked(run.ID, func(item *Session) {
		item.Status = "review"
		item.Summary = message
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})

	s.appendRoomMessageLocked(pr.RoomID, Message{
		ID:      fmt.Sprintf("%s-auto-merge-request-%d", pr.RoomID, time.Now().UnixNano()),
		Speaker: "Planner",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("当前 run 已对 %s 提交 auto-merge 请求。", pr.Label),
		Time:    shortClock(),
	})

	if err := s.persistLocked(); err != nil {
		return State{}, AutoMergeGuard{}, err
	}

	nextState := cloneState(s.state)
	nextPR, _ := findPullRequestInState(nextState, pullRequestID)
	return nextState, autoMergeGuardFromState(nextState, nextPR), nil
}

func findPlannerQueueItem(state State, sessionID string) (PlannerQueueItem, bool) {
	for _, session := range state.Sessions {
		if session.ID == sessionID {
			return plannerQueueItemFromState(state, session), true
		}
	}
	return PlannerQueueItem{}, false
}

func plannerQueueItemFromState(snapshot State, session Session) PlannerQueueItem {
	run, _ := findRunInState(snapshot, session.ActiveRunID)
	issue, _ := findIssueInState(snapshot, session.IssueKey)
	agent, agentOK := findAgentForRun(snapshot, run)
	pr, prOK := findPullRequestByRunID(snapshot, session.ActiveRunID)

	gates := make([]PlannerQueueGate, 0, len(snapshot.Inbox))
	for _, item := range snapshot.Inbox {
		if !strings.Contains(item.Href, session.ActiveRunID) && !strings.Contains(item.Href, session.RoomID) {
			continue
		}
		gates = append(gates, PlannerQueueGate{
			Kind:    item.Kind,
			Title:   item.Title,
			Summary: item.Summary,
			Href:    item.Href,
		})
	}

	queueItem := PlannerQueueItem{
		SessionID:        session.ID,
		IssueKey:         session.IssueKey,
		RoomID:           session.RoomID,
		RunID:            session.ActiveRunID,
		Status:           defaultString(session.Status, run.Status),
		Summary:          defaultString(session.Summary, run.Summary),
		Owner:            defaultString(run.Owner, issue.Owner),
		Provider:         defaultString(session.Provider, run.Provider),
		Runtime:          defaultString(session.Runtime, run.Runtime),
		Machine:          defaultString(session.Machine, run.Machine),
		WorktreePath:     defaultString(session.WorktreePath, run.WorktreePath),
		ApprovalRequired: run.ApprovalRequired,
		Gates:            gates,
		AutoMerge:        AutoMergeGuard{Status: "unavailable", Reason: "当前 run 还没有 pull request 真值。"},
	}
	if agentOK {
		queueItem.AgentID = agent.ID
		queueItem.AgentName = agent.Name
	}
	if prOK {
		queueItem.PullRequestID = pr.ID
		queueItem.PullRequestLabel = pr.Label
		queueItem.PullRequestStatus = pr.Status
		queueItem.ReviewDecision = pr.ReviewDecision
		queueItem.AutoMerge = autoMergeGuardFromState(snapshot, pr)
	}
	return queueItem
}

func autoMergeGuardFromState(snapshot State, pr PullRequest) AutoMergeGuard {
	run, _ := findRunInState(snapshot, pr.RunID)
	mergeSafetyReason := pullRequestMergeSafetyGuardReason(pr)
	guard := AutoMergeGuard{
		Status:         "unavailable",
		Reason:         "当前还没有 auto-merge guard truth。",
		CanRequest:     true,
		CanApply:       false,
		ReviewDecision: pr.ReviewDecision,
		PullRequestID:  pr.ID,
		RoomID:         pr.RoomID,
		RunID:          pr.RunID,
	}

	switch {
	case strings.TrimSpace(pr.ID) == "":
		guard.Reason = "pull request not found"
	case strings.EqualFold(pr.Status, "merged"):
		guard.Status = "merged"
		guard.Reason = "PR 已合并，不再需要 auto-merge。"
	case strings.EqualFold(pr.Status, "draft"):
		guard.Status = "blocked"
		guard.Reason = "PR 仍是 draft，auto-merge 不可执行。"
	case hasBlockedPlannerGate(snapshot.Inbox, pr):
		guard.Status = "blocked"
		guard.Reason = "当前存在 blocked gate，auto-merge 不可执行。"
	case mergeSafetyReason != "":
		guard.Status = "blocked"
		guard.Reason = mergeSafetyReason
	case strings.EqualFold(pr.Status, "changes_requested") || strings.EqualFold(pr.ReviewDecision, "CHANGES_REQUESTED"):
		guard.Status = "blocked"
		guard.Reason = "GitHub Review 当前要求补充修改，auto-merge 不可执行。"
	case !strings.EqualFold(strings.TrimSpace(pr.ReviewDecision), "APPROVED"):
		guard.Status = "blocked"
		guard.Reason = "GitHub Review 尚未批准，auto-merge 仍需等待。"
	case run.ApprovalRequired:
		guard.Status = "approval_required"
		guard.Reason = "auto-merge 已申请，等待显式确认。"
		guard.CanApply = true
	default:
		guard.Status = "ready"
		guard.Reason = "review 已批准，可以显式执行 merge。"
		guard.CanApply = true
	}

	return guard
}

func pullRequestMergeSafetyGuardReason(pr PullRequest) string {
	mergeable := normalizeMergeable(pr.Mergeable)
	mergeStateStatus := normalizeMergeStateStatus(pr.MergeStateStatus)

	switch {
	case mergeStateStatus == "DIRTY" || mergeable == "CONFLICTING":
		return "PR 当前与基线分支存在冲突，需先同步最新基线后再继续合并。"
	case mergeStateStatus == "BEHIND":
		return "PR 当前已落后基线分支，需先同步最新基线后再继续合并。"
	case mergeStateStatus == "BLOCKED":
		return "GitHub 当前仍报告合并受阻；需要先通过分支保护和必需检查。"
	case mergeStateStatus == "HAS_HOOKS":
		return "GitHub 当前仍在等待检查和保护规则完成，暂不能继续自动合并。"
	case mergeStateStatus == "UNSTABLE":
		return "GitHub 当前合并状态仍不稳定，需等待检查收敛后再继续。"
	case mergeStateStatus == "UNKNOWN" || mergeable == "UNKNOWN":
		return "GitHub 正在计算当前合并条件，暂不允许直接自动合并。"
	default:
		return ""
	}
}

func hasBlockedPlannerGate(items []InboxItem, pr PullRequest) bool {
	for _, item := range items {
		if item.Kind != "blocked" {
			continue
		}
		if strings.Contains(item.Href, pr.RunID) || strings.Contains(item.Href, pr.RoomID) {
			return true
		}
	}
	return false
}

func findPullRequestInState(state State, pullRequestID string) (PullRequest, bool) {
	for _, item := range state.PullRequests {
		if item.ID == pullRequestID {
			return item, true
		}
	}
	return PullRequest{}, false
}

func findPullRequestByRunID(state State, runID string) (PullRequest, bool) {
	for _, item := range state.PullRequests {
		if item.RunID == runID {
			return item, true
		}
	}
	return PullRequest{}, false
}

func findRunInState(state State, runID string) (Run, bool) {
	for _, item := range state.Runs {
		if item.ID == runID {
			return item, true
		}
	}
	return Run{}, false
}

func findIssueInState(state State, issueKey string) (Issue, bool) {
	for _, item := range state.Issues {
		if item.Key == issueKey {
			return item, true
		}
	}
	return Issue{}, false
}

func findAgentByOwner(state State, owner string) (Agent, bool) {
	for _, item := range state.Agents {
		if item.Name == owner {
			return item, true
		}
	}
	return Agent{}, false
}

func findAgentForRun(state State, run Run) (Agent, bool) {
	if strings.TrimSpace(run.ID) != "" {
		for _, item := range state.Agents {
			for _, runID := range item.RecentRunIDs {
				if runID == run.ID {
					return item, true
				}
			}
		}
	}
	return findAgentByOwner(state, run.Owner)
}

func prependUnique(items []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return items
	}
	filtered := make([]string, 0, len(items)+1)
	filtered = append(filtered, value)
	for _, item := range items {
		if item == value {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}
