package store

import (
	"fmt"
	"strings"
	"time"
)

func (s *Store) ApplyInboxDecision(inboxItemID, decision string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index, item, ok := s.findInboxItemLocked(inboxItemID)
	if !ok {
		return State{}, fmt.Errorf("inbox item not found")
	}

	switch strings.TrimSpace(item.Kind) {
	case "approval":
		return s.applyApprovalInboxDecisionLocked(index, item, decision)
	case "blocked":
		return s.applyBlockedInboxDecisionLocked(index, item, decision)
	default:
		return State{}, fmt.Errorf("inbox item kind %q does not support direct decisions", item.Kind)
	}
}

func (s *Store) RemoveInboxItem(inboxItemID string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index, _, ok := s.findInboxItemLocked(inboxItemID)
	if !ok {
		return State{}, fmt.Errorf("inbox item not found")
	}
	s.removeInboxItemLocked(index)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) applyApprovalInboxDecisionLocked(index int, item InboxItem, decision string) (State, error) {
	roomID := s.resolveInboxRoomIDLocked(item)
	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found for inbox item")
	}

	roomItem := &s.state.Rooms[roomIndex]
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]
	now := shortClock()

	var (
		title         string
		summary       string
		decisionState string
		sessionStatus string
		logLine       string
		timelineTone  string
		messageTone   string
		agentState    string
		agentMood     string
	)

	switch strings.TrimSpace(decision) {
	case "approved":
		title = "高风险动作已批准"
		summary = "人类已批准当前高风险动作，Run 可以继续执行。"
		decisionState = "approved"
		sessionStatus = "running"
		logLine = fmt.Sprintf("[%s] %s", now, summary)
		timelineTone = "lime"
		messageTone = "system"
		agentState = "running"
		agentMood = "已拿到批准，继续当前 run"
		roomItem.Topic.Status = "running"
		roomItem.Topic.Summary = summary
		issueItem.State = "running"
		runItem.Status = "running"
		runItem.Summary = summary
		runItem.ApprovalRequired = false
		runItem.NextAction = "继续执行已批准的高风险动作，并把结果同步回讨论间。"
		runItem.Stdout = append(runItem.Stdout, logLine)
	case "deferred":
		title = "高风险动作已暂缓"
		summary = "人类暂缓了当前高风险动作，等待更安全方案或下一次批准。"
		decisionState = "deferred"
		sessionStatus = "blocked"
		logLine = fmt.Sprintf("[%s] %s", now, summary)
		timelineTone = "paper"
		messageTone = "blocked"
		agentState = "blocked"
		agentMood = "等待新的批准或更安全方案"
		roomItem.Topic.Status = "blocked"
		roomItem.Topic.Summary = summary
		issueItem.State = "blocked"
		runItem.Status = "blocked"
		runItem.Summary = summary
		runItem.ApprovalRequired = true
		runItem.NextAction = "改写方案、准备更安全的 diff，或再次请求批准。"
		runItem.Stderr = append(runItem.Stderr, logLine)
	default:
		return State{}, fmt.Errorf("unsupported approval decision %q", decision)
	}

	s.removeInboxItemLocked(index)
	s.prependStatusInboxLocked(title, roomItem.Title, summary, item.Href)
	s.appendRoomMessageLocked(roomID, Message{
		ID:      fmt.Sprintf("%s-inbox-approval-%d", roomID, time.Now().UnixNano()),
		Speaker: "Human Inbox",
		Role:    "system",
		Tone:    messageTone,
		Message: summary,
		Time:    now,
	})
	roomItem.Unread++
	runItem.Timeline = append(runItem.Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1),
		Label: title,
		At:    now,
		Tone:  timelineTone,
	})
	s.updateAgentStateLocked(runItem.Owner, agentState, agentMood)
	s.updateSessionLocked(runItem.ID, func(item *Session) {
		item.Status = sessionStatus
		item.Summary = summary
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})

	if err := appendRunArtifacts(s.workspaceRoot, roomID, issueItem.Key, runItem.Owner, "Inbox Decision", fmt.Sprintf("- kind: approval\n- decision: %s\n- summary: %s", decision, summary)); err != nil {
		return State{}, err
	}
	s.markMemoryArtifactWritesLocked(runArtifactPaths(roomID, runItem.Owner), "Inbox Decision")
	if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, decisionState, summary); err != nil {
		return State{}, err
	}
	s.markMemoryArtifactWriteLocked(decisionArtifactPath(issueItem.Key), fmt.Sprintf("Decision status %s", decisionState))
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) applyBlockedInboxDecisionLocked(index int, item InboxItem, decision string) (State, error) {
	roomID := s.resolveInboxRoomIDLocked(item)
	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found for inbox item")
	}

	roomItem := &s.state.Rooms[roomIndex]
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]
	now := shortClock()

	var (
		title         string
		summary       string
		decisionState string
		sessionStatus string
		logLine       string
		timelineTone  string
		messageTone   string
		agentState    string
		agentMood     string
	)

	switch strings.TrimSpace(decision) {
	case "resolved":
		title = "阻塞已解除"
		summary = "人类已给出处理决定，当前 Run 可以恢复执行。"
		decisionState = "resolved"
		sessionStatus = "running"
		logLine = fmt.Sprintf("[%s] %s", now, summary)
		timelineTone = "lime"
		messageTone = "system"
		agentState = "running"
		agentMood = "阻塞已解除，恢复执行"
		roomItem.Topic.Status = "running"
		roomItem.Topic.Summary = summary
		issueItem.State = "running"
		runItem.Status = "running"
		runItem.Summary = summary
		runItem.ApprovalRequired = false
		runItem.NextAction = "按最新的人类决策恢复执行，并把结果同步回讨论间。"
		runItem.Stdout = append(runItem.Stdout, logLine)
	case "deferred":
		title = "阻塞继续挂起"
		summary = "人类选择继续挂起当前阻塞，等待后续处理。"
		decisionState = "blocked"
		sessionStatus = "blocked"
		logLine = fmt.Sprintf("[%s] %s", now, summary)
		timelineTone = "paper"
		messageTone = "blocked"
		agentState = "blocked"
		agentMood = "等待下一次人类决策"
		roomItem.Topic.Status = "blocked"
		roomItem.Topic.Summary = summary
		issueItem.State = "blocked"
		runItem.Status = "blocked"
		runItem.Summary = summary
		runItem.NextAction = "保持阻塞，等待下一次人类决策。"
		runItem.Stderr = append(runItem.Stderr, logLine)
	default:
		return State{}, fmt.Errorf("unsupported blocked decision %q", decision)
	}

	s.removeInboxItemLocked(index)
	s.prependStatusInboxLocked(title, roomItem.Title, summary, item.Href)
	s.appendRoomMessageLocked(roomID, Message{
		ID:      fmt.Sprintf("%s-inbox-blocked-%d", roomID, time.Now().UnixNano()),
		Speaker: "Human Inbox",
		Role:    "system",
		Tone:    messageTone,
		Message: summary,
		Time:    now,
	})
	roomItem.Unread++
	runItem.Timeline = append(runItem.Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1),
		Label: title,
		At:    now,
		Tone:  timelineTone,
	})
	s.updateAgentStateLocked(runItem.Owner, agentState, agentMood)
	s.updateSessionLocked(runItem.ID, func(item *Session) {
		item.Status = sessionStatus
		item.Summary = summary
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})

	if err := appendRunArtifacts(s.workspaceRoot, roomID, issueItem.Key, runItem.Owner, "Inbox Decision", fmt.Sprintf("- kind: blocked\n- decision: %s\n- summary: %s", decision, summary)); err != nil {
		return State{}, err
	}
	s.markMemoryArtifactWritesLocked(runArtifactPaths(roomID, runItem.Owner), "Inbox Decision")
	if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, decisionState, summary); err != nil {
		return State{}, err
	}
	s.markMemoryArtifactWriteLocked(decisionArtifactPath(issueItem.Key), fmt.Sprintf("Decision status %s", decisionState))
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) findInboxItemLocked(inboxItemID string) (int, InboxItem, bool) {
	for index, item := range s.state.Inbox {
		if item.ID == inboxItemID {
			return index, item, true
		}
	}
	return -1, InboxItem{}, false
}

func (s *Store) removeInboxItemLocked(index int) {
	if index < 0 || index >= len(s.state.Inbox) {
		return
	}
	s.state.Inbox = append(s.state.Inbox[:index], s.state.Inbox[index+1:]...)
}

func (s *Store) resolveInboxRoomIDLocked(item InboxItem) string {
	trimmed := strings.Trim(strings.TrimSpace(item.Href), "/")
	if trimmed != "" {
		parts := strings.Split(trimmed, "/")
		if len(parts) >= 2 && parts[0] == "rooms" {
			return parts[1]
		}
	}
	for _, room := range s.state.Rooms {
		if room.Title == item.Room {
			return room.ID
		}
	}
	return ""
}

func (s *Store) prependStatusInboxLocked(title, roomTitle, summary, href string) {
	s.state.Inbox = append([]InboxItem{{
		ID:      fmt.Sprintf("inbox-status-%d", time.Now().UnixNano()),
		Title:   title,
		Kind:    "status",
		Room:    roomTitle,
		Time:    "刚刚",
		Summary: summary,
		Action:  "打开房间",
		Href:    href,
	}}, s.state.Inbox...)
}
