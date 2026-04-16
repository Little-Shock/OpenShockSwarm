package store

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

var (
	ErrMailboxTitleRequired         = errors.New("handoff title is required")
	ErrMailboxSummaryRequired       = errors.New("handoff summary is required")
	ErrMailboxRoomNotFound          = errors.New("handoff room not found")
	ErrMailboxGovernedRoomRequired  = errors.New("governed handoff roomId is required")
	ErrMailboxFromAgentRequired     = errors.New("fromAgentId is required")
	ErrMailboxToAgentRequired       = errors.New("toAgentId is required")
	ErrMailboxAgentNotFound         = errors.New("handoff agent not found")
	ErrMailboxSameAgent             = errors.New("handoff target must differ from source agent")
	ErrMailboxHandoffNotFound       = errors.New("handoff not found")
	ErrMailboxGovernedRouteNotReady = errors.New("governed handoff suggestion is not ready")
	ErrMailboxActionInvalid         = errors.New("handoff action is invalid")
	ErrMailboxTransitionInvalid     = errors.New("handoff transition is invalid")
	ErrMailboxBlockedNoteRequired   = errors.New("blocked handoff requires a note")
	ErrMailboxCommentRequired       = errors.New("formal comment requires a note")
	ErrMailboxActingAgentRequired   = errors.New("acting agent is required")
	ErrMailboxActingAgentForbidden  = errors.New("only the target agent can advance this handoff")
	ErrMailboxCommentAgentForbidden = errors.New("only the source or target agent can comment on this handoff")
)

const (
	handoffKindManual           = "manual"
	handoffKindRoomAuto         = "room-auto"
	handoffKindGoverned         = "governed"
	handoffKindDeliveryCloseout = "delivery-closeout"
	handoffKindDeliveryReply    = "delivery-reply"
	mailboxEventTimestampLayout = "2006-01-02T15:04:05.000000000Z07:00"
)

func handoffKindSupportsAutoFollowup(kind string) bool {
	switch strings.TrimSpace(kind) {
	case handoffKindManual, handoffKindRoomAuto, handoffKindGoverned:
		return true
	default:
		return false
	}
}

func defaultHandoffAutoFollowupSummary(handoff AgentHandoff) string {
	target := defaultString(strings.TrimSpace(handoff.ToAgent), "当前接手智能体")
	return fmt.Sprintf("等待 %s 自动继续当前房间。", target)
}

func ensureHandoffAutoFollowupPending(handoff *AgentHandoff, updatedAt string) {
	if handoff == nil || !handoffKindSupportsAutoFollowup(handoff.Kind) {
		return
	}
	if handoff.AutoFollowup == nil {
		handoff.AutoFollowup = &AgentHandoffAutoFollowup{}
	}
	handoff.AutoFollowup.Status = "pending"
	handoff.AutoFollowup.Summary = defaultHandoffAutoFollowupSummary(*handoff)
	handoff.AutoFollowup.UpdatedAt = updatedAt
	handoff.UpdatedAt = updatedAt
	handoff.LastAction = roomAutoHandoffFollowupLastAction(*handoff)
}

func updateHandoffAutoFollowupStatus(handoff *AgentHandoff, status, summary, updatedAt string) {
	if handoff == nil || !handoffKindSupportsAutoFollowup(handoff.Kind) {
		return
	}
	if handoff.AutoFollowup == nil {
		handoff.AutoFollowup = &AgentHandoffAutoFollowup{}
	}
	handoff.AutoFollowup.Status = strings.TrimSpace(status)
	handoff.AutoFollowup.Summary = defaultString(strings.TrimSpace(summary), defaultHandoffAutoFollowupSummary(*handoff))
	handoff.AutoFollowup.UpdatedAt = updatedAt
	handoff.UpdatedAt = updatedAt
	handoff.LastAction = roomAutoHandoffFollowupLastAction(*handoff)
}

func mailboxEventTimestamp(now time.Time) string {
	return now.UTC().Format(mailboxEventTimestampLayout)
}

type MailboxCreateInput struct {
	RoomID          string
	FromAgentID     string
	ToAgentID       string
	ParentHandoffID string
	Title           string
	Summary         string
	Kind            string
}

type MailboxUpdateInput struct {
	Action                string
	ActingAgentID         string
	Note                  string
	ContinueGovernedRoute bool
}

type handoffActionPresentationResult struct {
	MessageKind      string
	Status           string
	Title            string
	Summary          string
	NextAction       string
	RoomSpeaker      string
	RoomRole         string
	RoomTone         string
	RoomMessage      string
	PreserveLastNote bool
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

func (s *Store) UpdateRoomAutoHandoffFollowup(handoffID, status, summary string) (State, AgentHandoff, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	handoff, ok := s.updateRoomAutoHandoffFollowupLocked(handoffID, status, summary, mailboxEventTimestamp(time.Now()))
	if !ok {
		return State{}, AgentHandoff{}, ErrMailboxHandoffNotFound
	}
	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, err
	}
	return cloneState(s.state), handoff, nil
}

func (s *Store) CompleteLatestRoomAutoHandoffFollowup(roomID, agentName, summary string) (State, AgentHandoff, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	updatedAt := mailboxEventTimestamp(time.Now())
	handoff, ok := s.completeLatestRoomAutoHandoffFollowupLocked(roomID, agentName, summary, updatedAt)
	if !ok {
		return cloneState(s.state), AgentHandoff{}, false, nil
	}
	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, false, err
	}
	return cloneState(s.state), handoff, true, nil
}

func (s *Store) CreateHandoff(input MailboxCreateInput) (State, AgentHandoff, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	handoff, err := s.createHandoffLocked(input)
	if err != nil {
		return State{}, AgentHandoff{}, err
	}

	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, err
	}
	return cloneState(s.state), handoff, nil
}

func (s *Store) CreateGovernedHandoffForRoom(roomID string) (State, AgentHandoff, WorkspaceGovernanceSuggestedHandoff, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	handoff, suggestion, err := s.createGovernedHandoffForRoomLocked(roomID)
	if err != nil {
		return State{}, AgentHandoff{}, WorkspaceGovernanceSuggestedHandoff{}, err
	}

	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, WorkspaceGovernanceSuggestedHandoff{}, err
	}
	return cloneState(s.state), handoff, suggestion, nil
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
	note := strings.TrimSpace(input.Note)
	if action == "blocked" && note == "" {
		return State{}, AgentHandoff{}, ErrMailboxBlockedNoteRequired
	}
	if action == "comment" && note == "" {
		return State{}, AgentHandoff{}, ErrMailboxCommentRequired
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
	if !handoffActionAllowsActor(*handoff, action, actingAgentID) {
		if action == "comment" {
			return State{}, AgentHandoff{}, ErrMailboxCommentAgentForbidden
		}
		return State{}, AgentHandoff{}, ErrMailboxActingAgentForbidden
	}

	now := time.Now()
	nowClock := shortClock()
	updatedAt := mailboxEventTimestamp(now)
	shouldSyncActiveRun := shouldSyncHandoffIntoActiveRun(*handoff, action, s.state.Runs[runIndex].Owner)
	presentation := handoffActionPresentation(*handoff, actingAgent, action, note)
	presentation = s.decorateDeliveryDelegationParentPresentationLocked(*handoff, presentation)

	handoff.Status = presentation.Status
	handoff.UpdatedAt = updatedAt
	handoff.LastAction = presentation.NextAction
	if !presentation.PreserveLastNote {
		handoff.LastNote = note
	}
	appendMailboxMessageLocked(
		handoff,
		presentation.MessageKind,
		actingAgent.ID,
		actingAgent.Name,
		defaultString(note, presentation.Summary),
		updatedAt,
	)
	if action == "acknowledged" && handoff.Kind != handoffKindDeliveryCloseout && handoff.Kind != handoffKindDeliveryReply {
		s.state.Rooms[roomIndex].Topic.Owner = handoff.ToAgent
		s.state.Runs[runIndex].Owner = handoff.ToAgent
		s.state.Issues[issueIndex].Owner = handoff.ToAgent
		shouldSyncActiveRun = true
		if handoff.Kind != handoffKindRoomAuto && handoffKindSupportsAutoFollowup(handoff.Kind) {
			ensureHandoffAutoFollowupPending(handoff, updatedAt)
			presentation.NextAction = handoff.LastAction
		}
	}
	if action == "blocked" && handoff.Kind != handoffKindRoomAuto && handoff.AutoFollowup != nil {
		updateHandoffAutoFollowupStatus(handoff, "blocked", note, updatedAt)
	}
	if action == "completed" && handoff.Kind != handoffKindRoomAuto && handoff.AutoFollowup != nil {
		updateHandoffAutoFollowupStatus(handoff, "completed", defaultString(note, presentation.Summary), updatedAt)
	}
	if shouldSyncActiveRun {
		s.state.Runs[runIndex].NextAction = presentation.NextAction
		s.updateSessionLocked(handoff.RunID, func(item *Session) {
			item.Summary = presentation.Summary
			item.ControlNote = presentation.NextAction
			item.UpdatedAt = updatedAt
		})
	}
	inboxTitle := presentation.Title
	inboxSummary := presentation.Summary
	if handoffKindSupportsAutoFollowup(handoff.Kind) && handoff.AutoFollowup != nil {
		inboxTitle = roomAutoHandoffFollowupInboxTitle(*handoff)
		inboxSummary = roomAutoHandoffFollowupInboxSummary(*handoff)
	}
	s.updateHandoffInboxLocked(*handoff, inboxTitle, inboxSummary)
	s.appendRoomMessageLocked(handoff.RoomID, Message{
		ID:      fmt.Sprintf("%s-system-%d", handoff.RoomID, now.UnixNano()),
		Speaker: presentation.RoomSpeaker,
		Role:    presentation.RoomRole,
		Tone:    presentation.RoomTone,
		Message: presentation.RoomMessage,
		Time:    nowClock,
	})
	if action == "blocked" && handoff.Kind == handoffKindDeliveryCloseout {
		if err := s.ensureDeliveryDelegationResponseHandoffLocked(*handoff, note); err != nil {
			return State{}, AgentHandoff{}, err
		}
	}
	if action == "completed" && input.ContinueGovernedRoute {
		if err := s.continueGovernedRouteLocked(*handoff); err != nil {
			return State{}, AgentHandoff{}, err
		}
	}
	if action == "completed" {
		if err := s.ensureDeliveryDelegationHandoffLocked(handoff.RoomID); err != nil {
			return State{}, AgentHandoff{}, err
		}
	}
	if action == "completed" || handoff.Kind == handoffKindDeliveryCloseout || handoff.Kind == handoffKindDeliveryReply {
		s.syncDeliveryDelegationInboxLocked(handoff.RoomID)
	}
	if handoff.Kind == handoffKindDeliveryReply {
		s.syncDeliveryDelegationResponseParentLocked(*handoff, action, note, actingAgent.ID, actingAgent.Name)
	}
	if handoff.Kind == handoffKindDeliveryCloseout {
		s.syncDeliveryDelegationParentProgressIntoLatestResponseLocked(*handoff, action)
	}

	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, err
	}
	return cloneState(s.state), *handoff, nil
}

func shouldSyncHandoffIntoActiveRun(handoff AgentHandoff, action, currentOwner string) bool {
	if handoff.Kind == handoffKindDeliveryCloseout || handoff.Kind == handoffKindDeliveryReply {
		return true
	}
	if action == "acknowledged" {
		return true
	}
	if handoff.Status != "acknowledged" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(currentOwner), strings.TrimSpace(handoff.ToAgent))
}

func (s *Store) createHandoffLocked(input MailboxCreateInput) (AgentHandoff, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return AgentHandoff{}, ErrMailboxTitleRequired
	}
	summary := strings.TrimSpace(input.Summary)
	if summary == "" {
		return AgentHandoff{}, ErrMailboxSummaryRequired
	}

	roomID := strings.TrimSpace(input.RoomID)
	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return AgentHandoff{}, ErrMailboxRoomNotFound
	}
	fromAgentID := strings.TrimSpace(input.FromAgentID)
	if fromAgentID == "" {
		return AgentHandoff{}, ErrMailboxFromAgentRequired
	}
	toAgentID := strings.TrimSpace(input.ToAgentID)
	if toAgentID == "" {
		return AgentHandoff{}, ErrMailboxToAgentRequired
	}
	if fromAgentID == toAgentID {
		return AgentHandoff{}, ErrMailboxSameAgent
	}

	fromAgent, ok := findAgentByID(s.state.Agents, fromAgentID)
	if !ok {
		return AgentHandoff{}, ErrMailboxAgentNotFound
	}
	toAgent, ok := findAgentByID(s.state.Agents, toAgentID)
	if !ok {
		return AgentHandoff{}, ErrMailboxAgentNotFound
	}

	now := time.Now()
	nowClock := shortClock()
	createdAt := mailboxEventTimestamp(now)
	handoffID := fmt.Sprintf("handoff-%d", now.UnixNano())
	inboxItemID := fmt.Sprintf("inbox-handoff-%d", now.UnixNano())
	handoffKind := normalizeHandoffKind(input.Kind)
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
		ID:              handoffID,
		Kind:            handoffKind,
		ParentHandoffID: strings.TrimSpace(input.ParentHandoffID),
		Title:           title,
		Summary:         summary,
		Status:          "requested",
		IssueKey:        s.state.Issues[issueIndex].Key,
		RoomID:          roomID,
		RunID:           s.state.Runs[runIndex].ID,
		FromAgentID:     fromAgent.ID,
		FromAgent:       fromAgent.Name,
		ToAgentID:       toAgent.ID,
		ToAgent:         toAgent.Name,
		InboxItemID:     inboxItemID,
		RequestedAt:     createdAt,
		UpdatedAt:       createdAt,
		LastAction:      fmt.Sprintf("等待 %s acknowledge / block 这次交接。", toAgent.Name),
		Messages:        []MailboxMessage{message},
	}
	if handoffKind == handoffKindRoomAuto {
		ensureHandoffAutoFollowupPending(&handoff, createdAt)
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
	if handoffKind != handoffKindRoomAuto {
		s.appendRoomMessageLocked(roomID, Message{
			ID:      fmt.Sprintf("%s-system-%d", roomID, now.UnixNano()),
			Speaker: "System",
			Role:    "system",
			Tone:    "system",
			Message: fmt.Sprintf("%s 向 %s 发起正式交接：%s。Mailbox 里现在可以追踪 request -> ack / blocked / complete。", fromAgent.Name, toAgent.Name, title),
			Time:    nowClock,
		})
		return handoff, nil
	}

	return s.autoAcknowledgeRoomHandoffLocked(handoff.ID, roomIndex, runIndex, issueIndex)
}

func (s *Store) autoAcknowledgeRoomHandoffLocked(handoffID string, roomIndex, runIndex, issueIndex int) (AgentHandoff, error) {
	handoffIndex := -1
	for index := range s.state.Mailbox {
		if s.state.Mailbox[index].ID == handoffID {
			handoffIndex = index
			break
		}
	}
	if handoffIndex == -1 {
		return AgentHandoff{}, ErrMailboxHandoffNotFound
	}

	handoff := &s.state.Mailbox[handoffIndex]
	actingAgentIndex := -1
	for index := range s.state.Agents {
		if s.state.Agents[index].ID == handoff.ToAgentID {
			actingAgentIndex = index
			break
		}
	}
	if actingAgentIndex == -1 {
		return AgentHandoff{}, ErrMailboxAgentNotFound
	}

	now := time.Now()
	nowClock := shortClock()
	updatedAt := mailboxEventTimestamp(now)
	actingAgent := &s.state.Agents[actingAgentIndex]
	previousOwner := strings.TrimSpace(s.state.Runs[runIndex].Owner)
	if previousOwner == "" {
		previousOwner = handoff.FromAgent
	}

	nextSummary := fmt.Sprintf("%s 已接棒：%s", handoff.ToAgent, handoff.Title)
	nextAction := fmt.Sprintf("当前由 %s 继续推进；如需补充，再直接在房间里追加消息。", handoff.ToAgent)
	roomMessage := fmt.Sprintf("%s 已接棒：%s。", handoff.ToAgent, handoff.Title)
	inboxTitle := fmt.Sprintf("%s 已接棒", handoff.ToAgent)
	inboxSummary := fmt.Sprintf("%s 正在跟进：%s", handoff.ToAgent, defaultString(strings.TrimSpace(handoff.Summary), handoff.Title))
	providerLabel := strings.TrimSpace(defaultString(strings.TrimSpace(actingAgent.ProviderPreference), strings.TrimSpace(actingAgent.Provider)))

	handoff.Status = "acknowledged"
	handoff.UpdatedAt = updatedAt
	handoff.LastAction = nextAction
	appendMailboxMessageLocked(
		handoff,
		"ack",
		actingAgent.ID,
		actingAgent.Name,
		nextSummary,
		updatedAt,
	)
	if handoff.Kind == handoffKindRoomAuto {
		nextAction = roomAutoHandoffFollowupLastAction(*handoff)
		inboxTitle = roomAutoHandoffFollowupInboxTitle(*handoff)
		inboxSummary = roomAutoHandoffFollowupInboxSummary(*handoff)
		handoff.LastAction = nextAction
	}

	s.state.Rooms[roomIndex].Topic.Owner = handoff.ToAgent
	s.state.Rooms[roomIndex].Topic.Status = "running"
	s.state.Rooms[roomIndex].Topic.Summary = nextSummary

	s.state.Issues[issueIndex].Owner = handoff.ToAgent
	s.state.Issues[issueIndex].State = "running"

	s.state.Runs[runIndex].Owner = handoff.ToAgent
	s.state.Runs[runIndex].Status = "running"
	s.state.Runs[runIndex].Summary = nextSummary
	s.state.Runs[runIndex].NextAction = nextAction
	if providerLabel != "" {
		s.state.Runs[runIndex].Provider = providerLabel
	}
	s.state.Runs[runIndex].Timeline = append(s.state.Runs[runIndex].Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].Timeline)+1),
		Label: fmt.Sprintf("%s 已自动接棒", handoff.ToAgent),
		At:    nowClock,
		Tone:  "lime",
	})

	if previousOwner != "" && previousOwner != handoff.ToAgent {
		s.updateAgentStateLocked(previousOwner, "idle", "等待下一次接棒或房间补充")
	}
	actingAgent.State = "running"
	actingAgent.Mood = "正在跟进当前房间"
	actingAgent.Lane = s.state.Issues[issueIndex].Key
	actingAgent.RecentRunIDs = prependUnique(actingAgent.RecentRunIDs, s.state.Runs[runIndex].ID)

	s.updateSessionLocked(handoff.RunID, func(item *Session) {
		item.Status = "running"
		item.Summary = nextSummary
		item.ControlNote = nextAction
		item.UpdatedAt = updatedAt
		if providerLabel != "" {
			item.Provider = providerLabel
		}
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})
	s.updateHandoffInboxLocked(*handoff, inboxTitle, inboxSummary)
	s.appendRoomMessageLocked(handoff.RoomID, Message{
		ID:      fmt.Sprintf("%s-system-%d", handoff.RoomID, now.UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: roomMessage,
		Time:    nowClock,
	})

	return *handoff, nil
}

func (s *Store) updateRoomAutoHandoffFollowupLocked(handoffID, status, summary, updatedAt string) (AgentHandoff, bool) {
	for index := range s.state.Mailbox {
		handoff := &s.state.Mailbox[index]
		if handoff.ID != strings.TrimSpace(handoffID) || !handoffKindSupportsAutoFollowup(handoff.Kind) {
			continue
		}
		updateHandoffAutoFollowupStatus(handoff, status, summary, updatedAt)
		s.updateHandoffInboxLocked(*handoff, roomAutoHandoffFollowupInboxTitle(*handoff), roomAutoHandoffFollowupInboxSummary(*handoff))
		return *handoff, true
	}
	return AgentHandoff{}, false
}

func (s *Store) completeLatestRoomAutoHandoffFollowupLocked(roomID, agentName, summary, updatedAt string) (AgentHandoff, bool) {
	roomID = strings.TrimSpace(roomID)
	agentName = strings.TrimSpace(agentName)
	if roomID == "" || agentName == "" {
		return AgentHandoff{}, false
	}
	for index := range s.state.Mailbox {
		handoff := &s.state.Mailbox[index]
		if handoff.RoomID != roomID || !handoffKindSupportsAutoFollowup(handoff.Kind) || handoff.AutoFollowup == nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(handoff.ToAgent), agentName) {
			continue
		}
		switch strings.TrimSpace(handoff.AutoFollowup.Status) {
		case "pending", "blocked":
			updateHandoffAutoFollowupStatus(handoff, "completed", summary, updatedAt)
			s.updateHandoffInboxLocked(*handoff, roomAutoHandoffFollowupInboxTitle(*handoff), roomAutoHandoffFollowupInboxSummary(*handoff))
			return *handoff, true
		}
	}
	return AgentHandoff{}, false
}

func (s *Store) createGovernedHandoffForRoomLocked(roomID string) (AgentHandoff, WorkspaceGovernanceSuggestedHandoff, error) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return AgentHandoff{}, WorkspaceGovernanceSuggestedHandoff{}, ErrMailboxGovernedRoomRequired
	}
	if _, _, _, ok := s.findRoomRunIssueLocked(roomID); !ok {
		return AgentHandoff{}, WorkspaceGovernanceSuggestedHandoff{}, ErrMailboxRoomNotFound
	}

	snapshot := cloneState(s.state)
	template := governanceTemplateFor(snapshot.Workspace.Onboarding.TemplateID)
	configuredTopology := append([]WorkspaceGovernanceLaneConfig{}, snapshot.Workspace.Governance.ConfiguredTopology...)
	if len(configuredTopology) == 0 {
		configuredTopology = defaultWorkspaceGovernanceTopology(template.TemplateID)
	}
	effectiveTemplate := configuredGovernanceTemplate(template, configuredTopology)
	focus := resolveGovernanceFocusForRoom(snapshot, roomID)
	suggestion := buildGovernanceSuggestedHandoff(snapshot, effectiveTemplate, focus)
	if suggestion.Status != "ready" ||
		strings.TrimSpace(suggestion.RoomID) != roomID ||
		strings.TrimSpace(suggestion.FromAgentID) == "" ||
		strings.TrimSpace(suggestion.ToAgentID) == "" ||
		strings.TrimSpace(suggestion.DraftTitle) == "" {
		return AgentHandoff{}, suggestion, fmt.Errorf("%w: %s", ErrMailboxGovernedRouteNotReady, defaultString(suggestion.Reason, "当前 governed route 尚未 ready"))
	}

	handoff, err := s.createHandoffLocked(MailboxCreateInput{
		RoomID:      suggestion.RoomID,
		FromAgentID: suggestion.FromAgentID,
		ToAgentID:   suggestion.ToAgentID,
		Title:       suggestion.DraftTitle,
		Summary:     defaultString(suggestion.DraftSummary, "按当前治理链继续推进下一棒。"),
		Kind:        handoffKindGoverned,
	})
	return handoff, suggestion, err
}

func (s *Store) continueGovernedRouteLocked(completed AgentHandoff) error {
	snapshot := cloneState(s.state)
	suggestion := snapshot.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	if suggestion.Status != "ready" || suggestion.RoomID != completed.RoomID {
		return nil
	}
	if strings.TrimSpace(suggestion.FromAgentID) == "" || strings.TrimSpace(suggestion.ToAgentID) == "" {
		return nil
	}
	if strings.TrimSpace(suggestion.DraftTitle) == "" {
		return nil
	}

	_, err := s.createHandoffLocked(MailboxCreateInput{
		RoomID:      suggestion.RoomID,
		FromAgentID: suggestion.FromAgentID,
		ToAgentID:   suggestion.ToAgentID,
		Title:       suggestion.DraftTitle,
		Summary:     defaultString(suggestion.DraftSummary, "按当前治理链继续推进下一棒。"),
		Kind:        handoffKindGoverned,
	})
	return err
}

func (s *Store) ensureDeliveryDelegationHandoffLocked(roomID string) error {
	prIndex := s.findPullRequestByRoomLocked(strings.TrimSpace(roomID))
	if prIndex == -1 {
		return nil
	}
	if workspaceGovernanceDeliveryDelegationMode(s.state.Workspace) != governanceDeliveryDelegationModeFormalHandoff {
		return nil
	}

	snapshot := cloneState(s.state)
	hydrateWorkspaceGovernance(&snapshot.Workspace, &snapshot)
	pr := snapshot.PullRequests[prIndex]
	governedCloseout := snapshot.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	delegation := buildPullRequestDeliveryDelegation(snapshot, pr, governedCloseout)
	if delegation.Status != "ready" || strings.TrimSpace(delegation.HandoffID) != "" {
		return nil
	}

	lane, targetAgentName, laneFound, targetFound := resolvePullRequestDeliveryDelegationTarget(snapshot)
	if !laneFound || !targetFound {
		return nil
	}

	fromAgentName := strings.TrimSpace(governedCloseout.FromAgent)
	if fromAgentName == "" {
		fromAgentName = strings.TrimSpace(pr.Author)
	}
	fromAgent, ok := governanceAgentByName(s.state.Agents, fromAgentName)
	if !ok {
		return nil
	}
	targetAgent, err := s.ensureGovernanceLaneAgentLocked(lane, targetAgentName)
	if err != nil {
		return err
	}
	if strings.EqualFold(fromAgent.ID, targetAgent.ID) {
		return nil
	}

	title := pullRequestDeliveryDelegationTitle(pr, targetAgent.Name)
	if existing := findPullRequestDeliveryDelegationHandoff(s.state.Mailbox, pr, targetAgent.Name); existing != nil {
		return nil
	}

	_, err = s.createHandoffLocked(MailboxCreateInput{
		RoomID:      pr.RoomID,
		FromAgentID: fromAgent.ID,
		ToAgentID:   targetAgent.ID,
		Title:       title,
		Summary:     pullRequestDeliveryDelegationSummary(governedCloseout, pr, lane, targetAgent.Name),
		Kind:        handoffKindDeliveryCloseout,
	})
	return err
}

func (s *Store) ensureDeliveryDelegationResponseHandoffLocked(blockedHandoff AgentHandoff, note string) error {
	if blockedHandoff.Kind != handoffKindDeliveryCloseout {
		return nil
	}
	if strings.TrimSpace(blockedHandoff.FromAgentID) == "" || strings.TrimSpace(blockedHandoff.ToAgentID) == "" {
		return nil
	}
	if strings.EqualFold(blockedHandoff.FromAgentID, blockedHandoff.ToAgentID) {
		return nil
	}
	if existing, _ := findLatestDeliveryDelegationResponseHandoff(s.state.Mailbox, blockedHandoff.ID); existing != nil && existing.Status != "completed" {
		return nil
	}

	summary := fmt.Sprintf(
		"%s 在 \"%s\" 上 blocked：%s。请 %s 补 unblock response，回复后由 %s 重新 acknowledge final delivery closeout。",
		blockedHandoff.ToAgent,
		blockedHandoff.Title,
		note,
		blockedHandoff.FromAgent,
		blockedHandoff.ToAgent,
	)
	title := fmt.Sprintf("回应 %s 的 delivery closeout blocker", blockedHandoff.ToAgent)
	_, err := s.createHandoffLocked(MailboxCreateInput{
		RoomID:          blockedHandoff.RoomID,
		FromAgentID:     blockedHandoff.ToAgentID,
		ToAgentID:       blockedHandoff.FromAgentID,
		ParentHandoffID: blockedHandoff.ID,
		Title:           title,
		Summary:         summary,
		Kind:            handoffKindDeliveryReply,
	})
	return err
}

func (s *Store) syncDeliveryDelegationInboxLocked(roomID string) {
	prIndex := s.findPullRequestByRoomLocked(strings.TrimSpace(roomID))
	if prIndex == -1 {
		return
	}

	snapshot := cloneState(s.state)
	hydrateWorkspaceGovernance(&snapshot.Workspace, &snapshot)
	pr := snapshot.PullRequests[prIndex]
	delegation := buildPullRequestDeliveryDelegation(snapshot, pr, snapshot.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	inboxID := deliveryDelegationInboxItemID(pr.ID)

	filtered := make([]InboxItem, 0, len(s.state.Inbox))
	for _, item := range s.state.Inbox {
		if item.ID == inboxID {
			continue
		}
		filtered = append(filtered, item)
	}
	s.state.Inbox = filtered

	if delegation.Status != "ready" && delegation.Status != "blocked" && delegation.Status != "done" {
		return
	}

	roomTitle := ""
	if roomIndex, _, _, ok := s.findRoomRunIssueLocked(pr.RoomID); ok {
		roomTitle = s.state.Rooms[roomIndex].Title
	}
	labelPrefix := defaultString(strings.TrimSpace(pr.Label), fmt.Sprintf("PR %s", strings.TrimSpace(pr.ID)))
	title := fmt.Sprintf("%s Delivery Delegation Blocked", labelPrefix)
	kind := "blocked"
	if delegation.Status == "ready" {
		title = fmt.Sprintf("%s 交付委托已准备 -> %s", labelPrefix, delegation.TargetAgent)
		kind = "status"
	}
	if delegation.Status == "done" {
		title = fmt.Sprintf("%s 交付委托已完成 -> %s", labelPrefix, delegation.TargetAgent)
		kind = "status"
	}
	s.state.Inbox = append([]InboxItem{{
		ID:      inboxID,
		Title:   title,
		Kind:    kind,
		Room:    defaultString(roomTitle, pr.RoomID),
		Time:    "刚刚",
		Summary: delegation.Summary,
		Action:  "Open Delivery Entry",
		Href:    delegation.Href,
	}}, s.state.Inbox...)
}

func (s *Store) updateHandoffInboxLocked(handoff AgentHandoff, title, summary string) {
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
		if handoff.Status == "blocked" || roomAutoHandoffFollowupInboxKind(handoff) == "blocked" {
			s.state.Inbox[index].Kind = "blocked"
		} else {
			s.state.Inbox[index].Kind = "status"
		}
		if handoff.Status == "completed" && handoff.LastNote != "" {
			s.state.Inbox[index].Summary = fmt.Sprintf("%s 收口备注：%s", summary, handoff.LastNote)
		}
		return
	}
}

func roomAutoHandoffFollowupLastAction(handoff AgentHandoff) string {
	if !handoffKindSupportsAutoFollowup(handoff.Kind) || handoff.AutoFollowup == nil {
		return handoff.LastAction
	}
	target := defaultString(strings.TrimSpace(handoff.ToAgent), "当前接手智能体")
	summary := strings.TrimSpace(handoff.AutoFollowup.Summary)
	switch strings.TrimSpace(handoff.AutoFollowup.Status) {
	case "pending":
		return defaultString(summary, fmt.Sprintf("等待 %s 自动继续当前房间。", target))
	case "blocked":
		if summary != "" {
			return fmt.Sprintf("%s 自动继续受阻：%s", target, summary)
		}
		return fmt.Sprintf("%s 自动继续受阻，等待恢复后继续。", target)
	case "completed":
		if summary != "" {
			return fmt.Sprintf("%s 已自动继续：%s", target, summary)
		}
		return fmt.Sprintf("%s 已自动继续当前房间。", target)
	default:
		return handoff.LastAction
	}
}

func roomAutoHandoffFollowupInboxTitle(handoff AgentHandoff) string {
	target := defaultString(strings.TrimSpace(handoff.ToAgent), "当前接手智能体")
	if !handoffKindSupportsAutoFollowup(handoff.Kind) || handoff.AutoFollowup == nil {
		return fmt.Sprintf("%s 已接棒", target)
	}
	switch strings.TrimSpace(handoff.AutoFollowup.Status) {
	case "blocked":
		return fmt.Sprintf("%s 自动继续受阻", target)
	case "completed":
		return fmt.Sprintf("%s 自动继续已完成", target)
	default:
		return fmt.Sprintf("%s 已接棒", target)
	}
}

func roomAutoHandoffFollowupInboxSummary(handoff AgentHandoff) string {
	target := defaultString(strings.TrimSpace(handoff.ToAgent), "当前接手智能体")
	if !handoffKindSupportsAutoFollowup(handoff.Kind) || handoff.AutoFollowup == nil {
		return fmt.Sprintf("%s 正在跟进：%s", target, defaultString(strings.TrimSpace(handoff.Summary), handoff.Title))
	}
	switch strings.TrimSpace(handoff.AutoFollowup.Status) {
	case "pending":
		return defaultString(strings.TrimSpace(handoff.AutoFollowup.Summary), fmt.Sprintf("等待 %s 自动继续当前房间。", target))
	case "blocked", "completed":
		return defaultString(strings.TrimSpace(handoff.AutoFollowup.Summary), defaultString(strings.TrimSpace(handoff.Summary), handoff.Title))
	default:
		return defaultString(strings.TrimSpace(handoff.Summary), handoff.Title)
	}
}

func roomAutoHandoffFollowupInboxKind(handoff AgentHandoff) string {
	if !handoffKindSupportsAutoFollowup(handoff.Kind) || handoff.AutoFollowup == nil {
		return ""
	}
	if strings.TrimSpace(handoff.AutoFollowup.Status) == "blocked" {
		return "blocked"
	}
	return "status"
}

func mailboxInboxHref(handoffID, roomID string) string {
	values := url.Values{}
	values.Set("handoffId", handoffID)
	values.Set("roomId", roomID)
	return "/inbox?" + values.Encode()
}

func normalizeHandoffKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case handoffKindRoomAuto:
		return handoffKindRoomAuto
	case handoffKindGoverned:
		return handoffKindGoverned
	case handoffKindDeliveryCloseout:
		return handoffKindDeliveryCloseout
	case handoffKindDeliveryReply:
		return handoffKindDeliveryReply
	default:
		return handoffKindManual
	}
}

func (s *Store) ensureGovernanceLaneAgentLocked(
	lane governanceTemplateLaneDefinition,
	targetAgentName string,
) (Agent, error) {
	if agent, ok := governanceAgentByName(s.state.Agents, targetAgentName); ok {
		return agent, nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	agentID := uniqueAgentID(s.state.Agents, "agent-"+slugify(targetAgentName))
	providerPreference := "Codex CLI"
	modelPreference := "gpt-5.3-codex"
	runtimePreference := strings.TrimSpace(s.state.Workspace.PairedRuntime)
	sandbox := s.state.Workspace.Sandbox
	if len(s.state.Agents) > 0 {
		templateAgent := s.state.Agents[0]
		providerPreference = defaultString(strings.TrimSpace(templateAgent.ProviderPreference), providerPreference)
		modelPreference = defaultString(strings.TrimSpace(templateAgent.ModelPreference), modelPreference)
		runtimePreference = defaultString(strings.TrimSpace(templateAgent.RuntimePreference), runtimePreference)
		sandbox = templateAgent.Sandbox
	}
	if runtimePreference == "" && len(s.state.Runtimes) > 0 {
		runtimePreference = s.state.Runtimes[0].ID
	}

	agent := Agent{
		ID:                    agentID,
		Name:                  targetAgentName,
		Description:           fmt.Sprintf("自动从 %s lane 物化的 closeout delegate。", defaultString(strings.TrimSpace(lane.Label), "治理拓扑")),
		Mood:                  "等待 final delivery closeout",
		State:                 "idle",
		Lane:                  defaultString(strings.TrimSpace(lane.Label), "delivery closeout"),
		Role:                  defaultString(strings.TrimSpace(lane.Role), defaultString(strings.TrimSpace(lane.Label), "Delivery Delegate")),
		Avatar:                "delivery-anchor",
		Prompt:                "围 release gate、operator handoff note 和 delivery evidence 做最后收口。",
		OperatingInstructions: "当前 Agent 由治理拓扑自动物化，用来接 final delivery closeout formal handoff。",
		Provider:              providerPreference,
		ProviderPreference:    providerPreference,
		ModelPreference:       modelPreference,
		RecallPolicy:          "governed-first",
		RuntimePreference:     defaultString(runtimePreference, "shock-main"),
		MemorySpaces:          []string{"workspace", "issue-room", "topic"},
		CredentialProfileIDs:  []string{},
		Sandbox:               sandbox,
		RecentRunIDs:          []string{},
		ProfileAudit: []AgentProfileAuditEntry{{
			ID:        fmt.Sprintf("%s-audit-1", agentID),
			UpdatedAt: now,
			UpdatedBy: "governance-auto-materialize",
			Summary:   fmt.Sprintf("从 %s lane 自动物化 delivery closeout delegate。", defaultString(strings.TrimSpace(lane.Label), "治理拓扑")),
			Changes:   []AgentProfileAuditChange{},
		}},
	}
	s.state.Agents = append([]Agent{agent}, s.state.Agents...)
	if artifacts, err := ensureWorkspaceScaffold(s.workspaceRoot, s.state.Agents, s.state.Memory); err == nil {
		s.state.Memory = artifacts
	} else {
		return Agent{}, err
	}
	return agent, nil
}

func uniqueAgentID(existing []Agent, base string) string {
	candidate := strings.TrimSpace(base)
	if candidate == "" {
		candidate = fmt.Sprintf("agent-%d", time.Now().UnixNano())
	}
	for index := 0; ; index += 1 {
		id := candidate
		if index > 0 {
			id = fmt.Sprintf("%s-%d", candidate, index+1)
		}
		if _, ok := findAgentByID(existing, id); !ok {
			return id
		}
	}
}

func normalizeHandoffAction(action string) string {
	switch strings.TrimSpace(action) {
	case "ack", "acknowledge", "acknowledged":
		return "acknowledged"
	case "blocked", "block":
		return "blocked"
	case "comment", "reply":
		return "comment"
	case "complete", "completed":
		return "completed"
	default:
		return ""
	}
}

func handoffActionAllowsActor(handoff AgentHandoff, action, actingAgentID string) bool {
	if action == "comment" {
		return actingAgentID == handoff.FromAgentID || actingAgentID == handoff.ToAgentID
	}
	return actingAgentID == handoff.ToAgentID
}

func handoffStatusAllowsAction(status, action string) bool {
	switch action {
	case "acknowledged":
		return status == "requested" || status == "blocked"
	case "blocked":
		return status == "requested" || status == "acknowledged"
	case "comment":
		return status == "requested" || status == "acknowledged" || status == "blocked" || status == "completed"
	case "completed":
		return status == "acknowledged"
	default:
		return false
	}
}

func handoffActionPresentation(handoff AgentHandoff, actingAgent Agent, action, note string) handoffActionPresentationResult {
	switch action {
	case "acknowledged":
		return handoffActionPresentationResult{
			MessageKind: "ack",
			Status:      "acknowledged",
			Title:       fmt.Sprintf("%s 已接住交接", handoff.ToAgent),
			Summary:     fmt.Sprintf("%s 已确认接住 %s 交来的 \"%s\"，当前 room owner 已切到 %s。", handoff.ToAgent, handoff.FromAgent, handoff.Title, handoff.ToAgent),
			NextAction:  fmt.Sprintf("%s 已接手执行，后续在 Mailbox 中标记 complete 或 blocked。", handoff.ToAgent),
			RoomSpeaker: "System",
			RoomRole:    "system",
			RoomTone:    "system",
			RoomMessage: fmt.Sprintf("%s 已确认接住 %s 交来的 \"%s\"，当前 room owner 已切到 %s。", handoff.ToAgent, handoff.FromAgent, handoff.Title, handoff.ToAgent),
		}
	case "blocked":
		return handoffActionPresentationResult{
			MessageKind: "blocked",
			Status:      "blocked",
			Title:       fmt.Sprintf("%s 阻塞了交接", handoff.ToAgent),
			Summary:     fmt.Sprintf("%s 暂时阻塞 \"%s\"：%s", handoff.ToAgent, handoff.Title, note),
			NextAction:  fmt.Sprintf("%s 需要先解除 blocker，再重新 acknowledge 这次 handoff。", handoff.ToAgent),
			RoomSpeaker: "System",
			RoomRole:    "system",
			RoomTone:    "blocked",
			RoomMessage: fmt.Sprintf("%s 暂时阻塞 \"%s\"：%s", handoff.ToAgent, handoff.Title, note),
		}
	case "comment":
		roomTone := "agent"
		if handoff.Status == "blocked" {
			roomTone = "blocked"
		}
		return handoffActionPresentationResult{
			MessageKind:      "comment",
			Status:           handoff.Status,
			Title:            fmt.Sprintf("%s 补充了 formal comment", actingAgent.Name),
			Summary:          fmt.Sprintf("%s 在 \"%s\" 上补充正式评论：%s", actingAgent.Name, handoff.Title, note),
			NextAction:       handoffCommentNextAction(handoff, actingAgent.Name),
			RoomSpeaker:      actingAgent.Name,
			RoomRole:         "agent",
			RoomTone:         roomTone,
			RoomMessage:      fmt.Sprintf("[Mailbox] %s 在 \"%s\" 上补充正式评论：%s", actingAgent.Name, handoff.Title, note),
			PreserveLastNote: true,
		}
	default:
		return handoffActionPresentationResult{
			MessageKind: "complete",
			Status:      "completed",
			Title:       fmt.Sprintf("%s 已完成交接收口", handoff.ToAgent),
			Summary:     fmt.Sprintf("%s 已在 Mailbox 中把 \"%s\" 标记为 complete，room / inbox / mailbox 都能回放这次交接。", handoff.ToAgent, handoff.Title),
			NextAction:  fmt.Sprintf("%s 已完成这次 handoff，可以继续推进 PR / response 收口。", handoff.ToAgent),
			RoomSpeaker: "System",
			RoomRole:    "system",
			RoomTone:    "system",
			RoomMessage: fmt.Sprintf("%s 已在 Mailbox 中把 \"%s\" 标记为 complete，room / inbox / mailbox 都能回放这次交接。", handoff.ToAgent, handoff.Title),
		}
	}
}

func (s *Store) decorateDeliveryDelegationParentPresentationLocked(
	handoff AgentHandoff,
	presentation handoffActionPresentationResult,
) handoffActionPresentationResult {
	if handoff.Kind != handoffKindDeliveryCloseout {
		return presentation
	}
	if presentation.Status != "acknowledged" && presentation.Status != "completed" {
		return presentation
	}

	responseHandoff, attemptCount := findLatestDeliveryDelegationResponseHandoff(s.state.Mailbox, handoff.ID)
	if responseHandoff == nil || attemptCount <= 0 {
		return presentation
	}

	responseSummary := strings.TrimSpace(deliveryDelegationResponseSummary(presentation.Status, responseHandoff, attemptCount))
	if responseSummary == "" {
		return presentation
	}

	presentation.Summary = strings.TrimSpace(presentation.Summary + " " + responseSummary)
	presentation.NextAction = strings.TrimSpace(presentation.NextAction + " " + responseSummary)
	presentation.RoomMessage = strings.TrimSpace(presentation.RoomMessage + " " + responseSummary)
	return presentation
}

func handoffCommentNextAction(handoff AgentHandoff, actorName string) string {
	switch handoff.Status {
	case "requested":
		return fmt.Sprintf("%s 刚补充了正式评论；仍等待 %s acknowledge / block 这次交接。", actorName, handoff.ToAgent)
	case "acknowledged":
		return fmt.Sprintf("%s 刚补充了正式评论；%s 继续推进执行并在 Mailbox 中收口。", actorName, handoff.ToAgent)
	case "blocked":
		return fmt.Sprintf("%s 刚补充了正式评论；当前 blocker 仍需解除后再由 %s 重新 acknowledge。", actorName, handoff.ToAgent)
	default:
		return fmt.Sprintf("%s 刚补充了正式评论；这次 handoff 已完成，后续可以回放完整上下文。", actorName)
	}
}

func (s *Store) syncDeliveryDelegationResponseParentLocked(
	response AgentHandoff,
	action string,
	note string,
	actorID string,
	actorName string,
) {
	if response.Kind != handoffKindDeliveryReply || strings.TrimSpace(response.ParentHandoffID) == "" {
		return
	}

	parentIndex := -1
	for index := range s.state.Mailbox {
		if s.state.Mailbox[index].ID == response.ParentHandoffID {
			parentIndex = index
			break
		}
	}
	if parentIndex == -1 {
		return
	}

	parent := &s.state.Mailbox[parentIndex]
	if parent.Kind != handoffKindDeliveryCloseout {
		return
	}

	_, attemptCount := findLatestDeliveryDelegationResponseHandoff(s.state.Mailbox, parent.ID)
	progressAction := deliveryDelegationResponseParentAction(*parent, response, action, note, actorName, attemptCount)
	if progressAction == "" {
		return
	}

	parent.LastAction = progressAction
	parent.UpdatedAt = response.UpdatedAt
	appendMailboxMessageLocked(
		parent,
		"response-progress",
		actorID,
		defaultString(strings.TrimSpace(actorName), "System"),
		progressAction,
		response.UpdatedAt,
	)
	if action == "comment" || action == "blocked" || action == "completed" {
		s.appendDeliveryDelegationResponseParentRoomTraceLocked(*parent, progressAction)
	}

	if runIndex := s.findRunByIDLocked(parent.RunID); runIndex != -1 {
		s.state.Runs[runIndex].NextAction = progressAction
	}
	s.updateSessionLocked(parent.RunID, func(item *Session) {
		item.Summary = progressAction
		item.ControlNote = progressAction
		item.UpdatedAt = response.UpdatedAt
	})
	s.updateDeliveryDelegationParentInboxProgressLocked(*parent, progressAction)
}

func (s *Store) appendDeliveryDelegationResponseParentRoomTraceLocked(parent AgentHandoff, progressAction string) {
	if strings.TrimSpace(parent.RoomID) == "" || strings.TrimSpace(progressAction) == "" {
		return
	}
	s.appendRoomMessageLocked(parent.RoomID, Message{
		ID:      fmt.Sprintf("%s-system-%d", parent.RoomID, time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "blocked",
		Message: fmt.Sprintf("[Mailbox Sync] \"%s\" 已同步 unblock response 进度：%s", parent.Title, progressAction),
		Time:    shortClock(),
	})
}

func deliveryDelegationResponseParentAction(
	parent AgentHandoff,
	response AgentHandoff,
	action string,
	note string,
	actorName string,
	attemptCount int,
) string {
	attemptLabel := fmt.Sprintf("第 %d 轮", max(1, attemptCount))
	switch action {
	case "acknowledged":
		return fmt.Sprintf(
			"%s 已接住%s unblock response；补完后由 %s 重新 acknowledge 主 closeout。",
			response.ToAgent,
			attemptLabel,
			parent.ToAgent,
		)
	case "blocked":
		return fmt.Sprintf(
			"%s 的%s unblock response 当前也 blocked：%s。主 closeout 继续保持 blocked。",
			response.ToAgent,
			attemptLabel,
			defaultString(strings.TrimSpace(note), defaultString(strings.TrimSpace(response.LastNote), "仍有额外 blocker 需要处理")),
		)
	case "comment":
		return fmt.Sprintf(
			"%s 刚在%s unblock response 上补充正式评论：%s。后续仍由 %s 处理 response，再由 %s 重新 acknowledge 主 closeout。",
			actorName,
			attemptLabel,
			defaultString(strings.TrimSpace(note), "补充了最新 unblock context"),
			response.ToAgent,
			parent.ToAgent,
		)
	case "completed":
		return fmt.Sprintf(
			"%s 已完成%s unblock response：%s。等待 %s 重新 acknowledge 主 closeout。",
			response.ToAgent,
			attemptLabel,
			defaultString(strings.TrimSpace(note), "closeout response 已补齐"),
			parent.ToAgent,
		)
	default:
		return ""
	}
}

func (s *Store) updateDeliveryDelegationParentInboxProgressLocked(parent AgentHandoff, progressAction string) {
	for index := range s.state.Inbox {
		if s.state.Inbox[index].ID != parent.InboxItemID {
			continue
		}

		s.state.Inbox[index].Time = "刚刚"
		s.state.Inbox[index].Action = "打开 Mailbox"
		s.state.Inbox[index].Href = mailboxInboxHref(parent.ID, parent.RoomID)
		s.state.Inbox[index].HandoffID = parent.ID
		if parent.Status == "blocked" {
			s.state.Inbox[index].Kind = "blocked"
		} else {
			s.state.Inbox[index].Kind = "status"
		}

		blocker := strings.TrimSpace(parent.LastNote)
		if blocker != "" {
			s.state.Inbox[index].Summary = fmt.Sprintf("当前 blocker：%s 最新 unblock response：%s", blocker, progressAction)
		} else {
			s.state.Inbox[index].Summary = fmt.Sprintf("最新 unblock response：%s", progressAction)
		}
		return
	}
}

func (s *Store) syncDeliveryDelegationParentProgressIntoLatestResponseLocked(parent AgentHandoff, action string) {
	if parent.Kind != handoffKindDeliveryCloseout {
		return
	}
	if action != "acknowledged" && action != "completed" {
		return
	}

	response, attemptCount := findLatestDeliveryDelegationResponseHandoff(s.state.Mailbox, parent.ID)
	if response == nil || attemptCount <= 0 {
		return
	}

	progressAction := deliveryDelegationParentResponseChildAction(parent, attemptCount)
	if progressAction == "" {
		return
	}

	response.LastAction = progressAction
	response.UpdatedAt = parent.UpdatedAt
	appendMailboxMessageLocked(
		response,
		"parent-progress",
		parent.ToAgentID,
		defaultString(strings.TrimSpace(parent.ToAgent), "System"),
		progressAction,
		parent.UpdatedAt,
	)
	s.updateDeliveryDelegationResponseChildInboxProgressLocked(*response, progressAction)
}

func deliveryDelegationParentResponseChildAction(parent AgentHandoff, attemptCount int) string {
	attemptLabel := fmt.Sprintf("第 %d 轮", max(1, attemptCount))
	switch parent.Status {
	case "acknowledged":
		return fmt.Sprintf(
			"%s 已重新 acknowledge 主 closeout；这条%s unblock response 现在可以直接回放 parent acknowledged。",
			parent.ToAgent,
			attemptLabel,
		)
	case "completed":
		return fmt.Sprintf(
			"%s 已完成主 closeout；这条%s unblock response 已随 parent closeout 一起收口。",
			parent.ToAgent,
			attemptLabel,
		)
	default:
		return ""
	}
}

func (s *Store) updateDeliveryDelegationResponseChildInboxProgressLocked(response AgentHandoff, progressAction string) {
	for index := range s.state.Inbox {
		if s.state.Inbox[index].ID != response.InboxItemID {
			continue
		}

		s.state.Inbox[index].Time = "刚刚"
		s.state.Inbox[index].Action = "打开 Mailbox"
		s.state.Inbox[index].Href = mailboxInboxHref(response.ID, response.RoomID)
		s.state.Inbox[index].HandoffID = response.ID
		if response.Status == "blocked" {
			s.state.Inbox[index].Kind = "blocked"
		} else {
			s.state.Inbox[index].Kind = "status"
		}
		s.state.Inbox[index].Summary = progressAction
		return
	}
}

func appendMailboxMessageLocked(handoff *AgentHandoff, kind, authorID, authorName, body, createdAt string) {
	handoff.Messages = append(handoff.Messages, MailboxMessage{
		ID:         fmt.Sprintf("%s-msg-%d", handoff.ID, len(handoff.Messages)+1),
		HandoffID:  handoff.ID,
		Kind:       kind,
		AuthorID:   authorID,
		AuthorName: authorName,
		Body:       body,
		CreatedAt:  createdAt,
	})
}
