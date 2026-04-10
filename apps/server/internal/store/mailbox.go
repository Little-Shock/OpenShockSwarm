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
	ErrMailboxFromAgentRequired     = errors.New("fromAgentId is required")
	ErrMailboxToAgentRequired       = errors.New("toAgentId is required")
	ErrMailboxAgentNotFound         = errors.New("handoff agent not found")
	ErrMailboxSameAgent             = errors.New("handoff target must differ from source agent")
	ErrMailboxHandoffNotFound       = errors.New("handoff not found")
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
	handoffKindGoverned         = "governed"
	handoffKindDeliveryCloseout = "delivery-closeout"
)

type MailboxCreateInput struct {
	RoomID      string
	FromAgentID string
	ToAgentID   string
	Title       string
	Summary     string
	Kind        string
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
	updatedAt := now.UTC().Format(time.RFC3339)
	presentation := handoffActionPresentation(*handoff, actingAgent, action, note)

	handoff.Status = presentation.Status
	handoff.UpdatedAt = updatedAt
	handoff.LastAction = presentation.NextAction
	if !presentation.PreserveLastNote {
		handoff.LastNote = note
	}
	handoff.Messages = append(handoff.Messages, MailboxMessage{
		ID:         fmt.Sprintf("%s-msg-%d", handoff.ID, len(handoff.Messages)+1),
		HandoffID:  handoff.ID,
		Kind:       presentation.MessageKind,
		AuthorID:   actingAgent.ID,
		AuthorName: actingAgent.Name,
		Body:       defaultString(note, presentation.Summary),
		CreatedAt:  updatedAt,
	})
	if action == "acknowledged" && handoff.Kind != handoffKindDeliveryCloseout {
		s.state.Rooms[roomIndex].Topic.Owner = handoff.ToAgent
		s.state.Runs[runIndex].Owner = handoff.ToAgent
		s.state.Issues[issueIndex].Owner = handoff.ToAgent
	}
	s.state.Runs[runIndex].NextAction = presentation.NextAction
	s.updateSessionLocked(handoff.RunID, func(item *Session) {
		item.Summary = presentation.Summary
		item.ControlNote = presentation.NextAction
		item.UpdatedAt = updatedAt
	})
	s.updateHandoffInboxLocked(*handoff, presentation.Title, presentation.Summary)
	s.appendRoomMessageLocked(handoff.RoomID, Message{
		ID:      fmt.Sprintf("%s-system-%d", handoff.RoomID, now.UnixNano()),
		Speaker: presentation.RoomSpeaker,
		Role:    presentation.RoomRole,
		Tone:    presentation.RoomTone,
		Message: presentation.RoomMessage,
		Time:    nowClock,
	})
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
	if action == "completed" || handoff.Kind == handoffKindDeliveryCloseout {
		s.syncDeliveryDelegationInboxLocked(handoff.RoomID)
	}

	if err := s.persistLocked(); err != nil {
		return State{}, AgentHandoff{}, err
	}
	return cloneState(s.state), *handoff, nil
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
	createdAt := now.UTC().Format(time.RFC3339)
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
		ID:          handoffID,
		Kind:        handoffKind,
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
	return handoff, nil
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
		if handoff.Status == "blocked" {
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

func mailboxInboxHref(handoffID, roomID string) string {
	values := url.Values{}
	values.Set("handoffId", handoffID)
	values.Set("roomId", roomID)
	return "/inbox?" + values.Encode()
}

func normalizeHandoffKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case handoffKindGoverned:
		return handoffKindGoverned
	case handoffKindDeliveryCloseout:
		return handoffKindDeliveryCloseout
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
