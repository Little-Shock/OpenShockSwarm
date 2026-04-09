package store

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

var (
	ErrMailboxTitleRequired        = errors.New("handoff title is required")
	ErrMailboxSummaryRequired      = errors.New("handoff summary is required")
	ErrMailboxRoomNotFound         = errors.New("handoff room not found")
	ErrMailboxFromAgentRequired    = errors.New("fromAgentId is required")
	ErrMailboxToAgentRequired      = errors.New("toAgentId is required")
	ErrMailboxAgentNotFound        = errors.New("handoff agent not found")
	ErrMailboxSameAgent            = errors.New("handoff target must differ from source agent")
	ErrMailboxHandoffNotFound      = errors.New("handoff not found")
	ErrMailboxActionInvalid        = errors.New("handoff action is invalid")
	ErrMailboxTransitionInvalid    = errors.New("handoff transition is invalid")
	ErrMailboxBlockedNoteRequired  = errors.New("blocked handoff requires a note")
	ErrMailboxActingAgentRequired  = errors.New("acting agent is required")
	ErrMailboxActingAgentForbidden = errors.New("only the target agent can advance this handoff")
)

type MailboxCreateInput struct {
	RoomID      string
	FromAgentID string
	ToAgentID   string
	Title       string
	Summary     string
}

type MailboxUpdateInput struct {
	Action        string
	ActingAgentID string
	Note          string
}

func (s *Store) Handoff(handoffID string) (AgentHandoff, bool) {
	snapshot := s.Snapshot()
	for _, item := range snapshot.Mailbox {
		if item.ID == handoffID {
			return item, true
		}
	}
	return AgentHandoff{}, false
}

func (s *Store) CreateHandoff(input MailboxCreateInput) (State, AgentHandoff, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	title := strings.TrimSpace(input.Title)
	if title == "" {
		return State{}, AgentHandoff{}, ErrMailboxTitleRequired
	}
	summary := strings.TrimSpace(input.Summary)
	if summary == "" {
		return State{}, AgentHandoff{}, ErrMailboxSummaryRequired
	}

	roomID := strings.TrimSpace(input.RoomID)
	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, AgentHandoff{}, ErrMailboxRoomNotFound
	}
	fromAgentID := strings.TrimSpace(input.FromAgentID)
	if fromAgentID == "" {
		return State{}, AgentHandoff{}, ErrMailboxFromAgentRequired
	}
	toAgentID := strings.TrimSpace(input.ToAgentID)
	if toAgentID == "" {
		return State{}, AgentHandoff{}, ErrMailboxToAgentRequired
	}
	if fromAgentID == toAgentID {
		return State{}, AgentHandoff{}, ErrMailboxSameAgent
	}

	fromAgent, ok := findAgentByID(s.state.Agents, fromAgentID)
	if !ok {
		return State{}, AgentHandoff{}, ErrMailboxAgentNotFound
	}
	toAgent, ok := findAgentByID(s.state.Agents, toAgentID)
	if !ok {
		return State{}, AgentHandoff{}, ErrMailboxAgentNotFound
	}

	now := time.Now()
	nowClock := shortClock()
	createdAt := now.UTC().Format(time.RFC3339)
	handoffID := fmt.Sprintf("handoff-%d", now.UnixNano())
	inboxItemID := fmt.Sprintf("inbox-handoff-%d", now.UnixNano())
	message := MailboxMessage{
		ID:         fmt.Sprintf("%s-msg-1", handoffID),
		HandoffID:  handoffID,
		Kind:       "request",
		AuthorID:   fromAgent.ID,
		AuthorName: fromAgent.Name,
		Body:       summary,
		CreatedAt:  createdAt,
	}
	handoff := AgentHandoff{
		ID:          handoffID,
		Title:       title,
		Summary:     summary,
		Status:      "requested",
		IssueKey:    s.state.Issues[issueIndex].Key,
		RoomID:      roomID,
		RunID:       s.state.Runs[runIndex].ID,
		FromAgentID: fromAgent.ID,
		FromAgent:   fromAgent.Name,
		ToAgentID:   toAgent.ID,
		ToAgent:     toAgent.Name,
		InboxItemID: inboxItemID,
		RequestedAt: createdAt,
		UpdatedAt:   createdAt,
		LastAction:  fmt.Sprintf("等待 %s acknowledge / block 这次交接。", toAgent.Name),
		Messages:    []MailboxMessage{message},
	}

	s.state.Mailbox = append([]AgentHandoff{handoff}, s.state.Mailbox...)
	s.state.Inbox = append([]InboxItem{{
		ID:        inboxItemID,
		Title:     fmt.Sprintf("%s -> %s 正式交接", fromAgent.Name, toAgent.Name),
		Kind:      "status",
		Room:      s.state.Rooms[roomIndex].Title,
		Time:      "刚刚",
		Summary:   summary,
		Action:    "打开 Mailbox",
		Href:      mailboxInboxHref(handoffID, roomID),
		HandoffID: handoffID,
	}}, s.state.Inbox...)
	s.state.Runs[runIndex].NextAction = fmt.Sprintf("等待 %s 在 Mailbox 中接住这次 handoff。", toAgent.Name)
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		item.Summary = fmt.Sprintf("%s -> %s handoff requested", fromAgent.Name, toAgent.Name)
		item.ControlNote = handoff.LastAction
		item.UpdatedAt = createdAt
	})
	s.appendRoomMessageLocked(roomID, Message{
		ID:      fmt.Sprintf("%s-system-%d", roomID, now.UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 向 %s 发起正式交接：%s。Mailbox 里现在可以追踪 request -> ack / blocked / complete。", fromAgent.Name, toAgent.Name, title),
		Time:    nowClock,
	})

	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, err
	}
	return cloneState(s.state), handoff, nil
}

func (s *Store) AdvanceHandoff(handoffID string, input MailboxUpdateInput) (State, AgentHandoff, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index := -1
	for candidateIndex, item := range s.state.Mailbox {
		if item.ID == handoffID {
			index = candidateIndex
			break
		}
	}
	if index == -1 {
		return State{}, AgentHandoff{}, ErrMailboxHandoffNotFound
	}

	action := normalizeHandoffAction(input.Action)
	if action == "" {
		return State{}, AgentHandoff{}, ErrMailboxActionInvalid
	}

	actingAgentID := strings.TrimSpace(input.ActingAgentID)
	if actingAgentID == "" {
		return State{}, AgentHandoff{}, ErrMailboxActingAgentRequired
	}
	handoff := &s.state.Mailbox[index]
	if actingAgentID != handoff.ToAgentID {
		return State{}, AgentHandoff{}, ErrMailboxActingAgentForbidden
	}
	note := strings.TrimSpace(input.Note)
	if action == "blocked" && note == "" {
		return State{}, AgentHandoff{}, ErrMailboxBlockedNoteRequired
	}
	if !handoffStatusAllowsAction(handoff.Status, action) {
		return State{}, AgentHandoff{}, ErrMailboxTransitionInvalid
	}

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(handoff.RoomID)
	if !ok {
		return State{}, AgentHandoff{}, ErrMailboxRoomNotFound
	}
	actingAgent, ok := findAgentByID(s.state.Agents, actingAgentID)
	if !ok {
		return State{}, AgentHandoff{}, ErrMailboxAgentNotFound
	}

	now := time.Now()
	nowClock := shortClock()
	updatedAt := now.UTC().Format(time.RFC3339)
	messageKind, status, title, summary, nextAction, tone := handoffActionPresentation(*handoff, action, note)

	handoff.Status = status
	handoff.UpdatedAt = updatedAt
	handoff.LastAction = nextAction
	handoff.LastNote = note
	handoff.Messages = append(handoff.Messages, MailboxMessage{
		ID:         fmt.Sprintf("%s-msg-%d", handoff.ID, len(handoff.Messages)+1),
		HandoffID:  handoff.ID,
		Kind:       messageKind,
		AuthorID:   actingAgent.ID,
		AuthorName: actingAgent.Name,
		Body:       defaultString(note, summary),
		CreatedAt:  updatedAt,
	})
	if action == "acknowledged" {
		s.state.Rooms[roomIndex].Topic.Owner = handoff.ToAgent
		s.state.Runs[runIndex].Owner = handoff.ToAgent
		s.state.Issues[issueIndex].Owner = handoff.ToAgent
	}
	s.state.Runs[runIndex].NextAction = nextAction
	s.updateSessionLocked(handoff.RunID, func(item *Session) {
		item.Summary = summary
		item.ControlNote = nextAction
		item.UpdatedAt = updatedAt
	})
	s.updateHandoffInboxLocked(*handoff, title, summary, action, note)
	s.appendRoomMessageLocked(handoff.RoomID, Message{
		ID:      fmt.Sprintf("%s-system-%d", handoff.RoomID, now.UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    tone,
		Message: summary,
		Time:    nowClock,
	})

	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, err
	}
	return cloneState(s.state), *handoff, nil
}

func (s *Store) updateHandoffInboxLocked(handoff AgentHandoff, title, summary, action, note string) {
	for index := range s.state.Inbox {
		if s.state.Inbox[index].ID != handoff.InboxItemID {
			continue
		}
		s.state.Inbox[index].Title = title
		s.state.Inbox[index].Summary = summary
		s.state.Inbox[index].Time = "刚刚"
		s.state.Inbox[index].Action = "打开 Mailbox"
		s.state.Inbox[index].Href = mailboxInboxHref(handoff.ID, handoff.RoomID)
		s.state.Inbox[index].HandoffID = handoff.ID
		if action == "blocked" {
			s.state.Inbox[index].Kind = "blocked"
		} else {
			s.state.Inbox[index].Kind = "status"
		}
		if action == "completed" && note != "" {
			s.state.Inbox[index].Summary = fmt.Sprintf("%s 收口备注：%s", summary, note)
		}
		return
	}
}

func mailboxInboxHref(handoffID, roomID string) string {
	values := url.Values{}
	values.Set("handoffId", handoffID)
	values.Set("roomId", roomID)
	return "/inbox?" + values.Encode()
}

func normalizeHandoffAction(action string) string {
	switch strings.TrimSpace(action) {
	case "ack", "acknowledge", "acknowledged":
		return "acknowledged"
	case "blocked", "block":
		return "blocked"
	case "complete", "completed":
		return "completed"
	default:
		return ""
	}
}

func handoffStatusAllowsAction(status, action string) bool {
	switch action {
	case "acknowledged":
		return status == "requested" || status == "blocked"
	case "blocked":
		return status == "requested" || status == "acknowledged"
	case "completed":
		return status == "acknowledged"
	default:
		return false
	}
}

func handoffActionPresentation(handoff AgentHandoff, action, note string) (messageKind, status, title, summary, nextAction, tone string) {
	switch action {
	case "acknowledged":
		return "ack",
			"acknowledged",
			fmt.Sprintf("%s 已接住交接", handoff.ToAgent),
			fmt.Sprintf("%s 已确认接住 %s 交来的 \"%s\"，当前 room owner 已切到 %s。", handoff.ToAgent, handoff.FromAgent, handoff.Title, handoff.ToAgent),
			fmt.Sprintf("%s 已接手执行，后续在 Mailbox 中标记 complete 或 blocked。", handoff.ToAgent),
			"system"
	case "blocked":
		return "blocked",
			"blocked",
			fmt.Sprintf("%s 阻塞了交接", handoff.ToAgent),
			fmt.Sprintf("%s 暂时阻塞 \"%s\"：%s", handoff.ToAgent, handoff.Title, note),
			fmt.Sprintf("%s 需要先解除 blocker，再重新 acknowledge 这次 handoff。", handoff.ToAgent),
			"blocked"
	default:
		return "complete",
			"completed",
			fmt.Sprintf("%s 已完成交接收口", handoff.ToAgent),
			fmt.Sprintf("%s 已在 Mailbox 中把 \"%s\" 标记为 complete，room / inbox / mailbox 都能回放这次交接。", handoff.ToAgent, handoff.Title),
			fmt.Sprintf("%s 已完成这次 handoff，可以继续推进 PR / response 收口。", handoff.ToAgent),
			"system"
	}
}
