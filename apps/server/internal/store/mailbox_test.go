package store

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreateHandoffPersistsMailboxInboxAndRoomTruth(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	nextState, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "接 review lane",
		Summary:     "请你接住 reviewer lane，并在 mailbox 里回写 blocked / complete。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if handoff.Status != "requested" || handoff.ID == "" {
		t.Fatalf("handoff = %#v, want requested status with generated id", handoff)
	}
	if len(nextState.Mailbox) == 0 || nextState.Mailbox[0].ID != handoff.ID {
		t.Fatalf("mailbox = %#v, want new handoff at front", nextState.Mailbox)
	}

	inboxItem := findInboxItemByHandoffID(nextState.Inbox, handoff.ID)
	if inboxItem == nil {
		t.Fatalf("inbox = %#v, want handoff-backed inbox item", nextState.Inbox)
	}
	if !strings.Contains(inboxItem.Href, "/inbox?") || !strings.Contains(inboxItem.Href, "handoffId="+handoff.ID) {
		t.Fatalf("inbox href = %q, want deep link back to inbox mailbox surface", inboxItem.Href)
	}

	run := findRunByID(nextState, "run_runtime_01")
	if run == nil || !strings.Contains(run.NextAction, "Claude Review Runner") {
		t.Fatalf("run = %#v, want next action waiting for Claude Review Runner", run)
	}

	session := findSessionByID(nextState, "session-runtime")
	if session == nil || !strings.Contains(session.Summary, "handoff requested") {
		t.Fatalf("session = %#v, want handoff requested summary", session)
	}

	roomMessages := nextState.RoomMessages["room-runtime"]
	if len(roomMessages) == 0 || !strings.Contains(roomMessages[len(roomMessages)-1].Message, "正式交接") {
		t.Fatalf("room messages = %#v, want system handoff writeback", roomMessages)
	}
}

func TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "接 review lane",
		Summary:     "先接住这一拍，再把 blocked / complete 回写到 mailbox。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	ackState, acked, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged) error = %v", err)
	}
	if acked.Status != "acknowledged" {
		t.Fatalf("acked handoff = %#v, want acknowledged", acked)
	}

	run := findRunByID(ackState, "run_runtime_01")
	room := findRoomByID(ackState, "room-runtime")
	issue := findIssueByID(ackState, "issue-runtime")
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched to Claude Review Runner", run)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want topic owner switched", room)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want issue owner switched", issue)
	}

	blockedState, blocked, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "等 PR comment sync 先收平。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(blocked) error = %v", err)
	}
	if blocked.Status != "blocked" || blocked.LastNote != "等 PR comment sync 先收平。" {
		t.Fatalf("blocked handoff = %#v, want blocked status with note", blocked)
	}
	blockedInbox := findInboxItemByHandoffID(blockedState.Inbox, handoff.ID)
	if blockedInbox == nil || blockedInbox.Kind != "blocked" {
		t.Fatalf("blocked inbox item = %#v, want blocked tone", blockedInbox)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(re-acknowledged) error = %v", err)
	}

	completedState, completed, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "review notes 已吸收，准备回到 PR 收口。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed) error = %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("completed handoff = %#v, want completed", completed)
	}
	completedInbox := findInboxItemByHandoffID(completedState.Inbox, handoff.ID)
	if completedInbox == nil || !strings.Contains(completedInbox.Summary, "收口备注") {
		t.Fatalf("completed inbox item = %#v, want completion note reflected", completedInbox)
	}
}

func TestAdvanceHandoffRejectsInvalidActorAndMissingBlockNote(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "接 review lane",
		Summary:     "先确认你能不能接住这条 handoff。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: "agent-claude-review-runner",
	}); err != ErrMailboxBlockedNoteRequired {
		t.Fatalf("AdvanceHandoff(blocked without note) error = %v, want %v", err, ErrMailboxBlockedNoteRequired)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != ErrMailboxActingAgentForbidden {
		t.Fatalf("AdvanceHandoff(wrong actor) error = %v, want %v", err, ErrMailboxActingAgentForbidden)
	}
}

func TestAdvanceHandoffCommentKeepsLifecycleAndAllowsBothEnds(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 reviewer lane 接过去",
		Summary:     "请你正式接住 reviewer lane，并在需要时用 mailbox comment 对齐上下文。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	requestedState, requestedComment, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: "agent-codex-dockmaster",
		Note:          "补充 exact-head reviewer context，先别丢掉前序评论。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(comment from source) error = %v", err)
	}
	if requestedComment.Status != "requested" {
		t.Fatalf("commented handoff = %#v, want requested status preserved", requestedComment)
	}
	if requestedComment.LastNote != "" {
		t.Fatalf("commented handoff last note = %q, want lifecycle note untouched", requestedComment.LastNote)
	}
	lastRequestedMessage := requestedComment.Messages[len(requestedComment.Messages)-1]
	if lastRequestedMessage.Kind != "comment" || lastRequestedMessage.AuthorID != "agent-codex-dockmaster" {
		t.Fatalf("requested comment message = %#v, want source-authored comment", lastRequestedMessage)
	}
	requestedInbox := findInboxItemByHandoffID(requestedState.Inbox, handoff.ID)
	if requestedInbox == nil || requestedInbox.Kind != "status" || !strings.Contains(requestedInbox.Summary, "正式评论") {
		t.Fatalf("requested inbox item = %#v, want status tone with comment summary", requestedInbox)
	}
	requestedRoomMessages := requestedState.RoomMessages["room-runtime"]
	if len(requestedRoomMessages) == 0 {
		t.Fatalf("room messages missing after comment")
	}
	lastRequestedRoomMessage := requestedRoomMessages[len(requestedRoomMessages)-1]
	if lastRequestedRoomMessage.Speaker != "Codex Dockmaster" ||
		lastRequestedRoomMessage.Role != "agent" ||
		!strings.Contains(lastRequestedRoomMessage.Message, "[Mailbox]") {
		t.Fatalf("requested room message = %#v, want agent-authored mailbox comment trace", lastRequestedRoomMessage)
	}

	_, blocked, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "还缺 review diff 上下文。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(blocked) error = %v", err)
	}
	if blocked.LastNote != "还缺 review diff 上下文。" {
		t.Fatalf("blocked handoff = %#v, want blocker note retained", blocked)
	}

	blockedState, blockedComment, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "我已经补看了 reviewer thread，现在只差最终 diff。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(comment from target) error = %v", err)
	}
	if blockedComment.Status != "blocked" || blockedComment.LastNote != "还缺 review diff 上下文。" {
		t.Fatalf("blocked comment handoff = %#v, want blocked status and blocker note preserved", blockedComment)
	}
	lastBlockedMessage := blockedComment.Messages[len(blockedComment.Messages)-1]
	if lastBlockedMessage.Kind != "comment" || lastBlockedMessage.AuthorID != "agent-claude-review-runner" {
		t.Fatalf("blocked comment message = %#v, want target-authored comment", lastBlockedMessage)
	}
	blockedInbox := findInboxItemByHandoffID(blockedState.Inbox, handoff.ID)
	if blockedInbox == nil || blockedInbox.Kind != "blocked" {
		t.Fatalf("blocked inbox item = %#v, want blocked tone preserved after comment", blockedInbox)
	}
	blockedRoomMessages := blockedState.RoomMessages["room-runtime"]
	lastBlockedRoomMessage := blockedRoomMessages[len(blockedRoomMessages)-1]
	if lastBlockedRoomMessage.Speaker != "Claude Review Runner" ||
		lastBlockedRoomMessage.Tone != "blocked" ||
		!strings.Contains(lastBlockedRoomMessage.Message, "正式评论") {
		t.Fatalf("blocked room message = %#v, want blocked-tone agent comment trace", lastBlockedRoomMessage)
	}
}

func TestAdvanceHandoffCommentRejectsEmptyNoteAndUnrelatedActor(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "补 comment guardrail",
		Summary:     "验证 mailbox comment 的 note 与 actor 约束。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: "agent-codex-dockmaster",
	}); err != ErrMailboxCommentRequired {
		t.Fatalf("AdvanceHandoff(comment without note) error = %v, want %v", err, ErrMailboxCommentRequired)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: "agent-memory-clerk",
		Note:          "我是无关 agent，不应该被允许评论。",
	}); err != ErrMailboxCommentAgentForbidden {
		t.Fatalf("AdvanceHandoff(comment from unrelated actor) error = %v, want %v", err, ErrMailboxCommentAgentForbidden)
	}
}

func TestMailboxLifecycleHydratesWorkspaceGovernance(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	baseline := s.Snapshot()
	if baseline.Workspace.Governance.TemplateID != "dev-team" || len(baseline.Workspace.Governance.TeamTopology) != 5 {
		t.Fatalf("baseline governance = %#v, want dev-team topology", baseline.Workspace.Governance)
	}
	if baseline.Workspace.Governance.HumanOverride.Status != "required" {
		t.Fatalf("baseline human override = %#v, want required override gate", baseline.Workspace.Governance.HumanOverride)
	}
	secondRoomID := findAlternateGovernanceRoomID(baseline, "room-runtime")
	if secondRoomID == "" {
		t.Fatalf("baseline rooms = %#v, want second room for cross-room escalation rollup", baseline.Rooms)
	}

	nextState, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 reviewer loop 正式摆上桌",
		Summary:     "请你正式接住 reviewer lane，并把 blocked / complete / closeout note 写回治理链。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if nextState.Workspace.Governance.Stats.OpenHandoffs != 1 {
		t.Fatalf("governance stats = %#v, want 1 open handoff", nextState.Workspace.Governance.Stats)
	}
	if len(nextState.Workspace.Governance.EscalationSLA.Queue) == 0 ||
		nextState.Workspace.Governance.EscalationSLA.Queue[0].Source != "mailbox handoff" {
		t.Fatalf("escalation queue after create = %#v, want mailbox handoff entry", nextState.Workspace.Governance.EscalationSLA)
	}
	handoffStep := findGovernanceStep(nextState.Workspace.Governance.Walkthrough, "handoff")
	if handoffStep == nil || handoffStep.Status != "active" {
		t.Fatalf("handoff step = %#v, want active handoff walkthrough", handoffStep)
	}

	blockedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "等 reviewer evidence 先收平。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(blocked) error = %v", err)
	}
	if blockedState.Workspace.Governance.Stats.BlockedEscalations == 0 {
		t.Fatalf("blocked governance stats = %#v, want blocked escalation count", blockedState.Workspace.Governance.Stats)
	}
	if findEscalationQueueEntryBySource(blockedState.Workspace.Governance.EscalationSLA.Queue, "inbox blocker") == nil {
		t.Fatalf("blocked escalation queue = %#v, want inbox blocker entry", blockedState.Workspace.Governance.EscalationSLA.Queue)
	}
	runtimeRollup := findEscalationRoomRollupByRoomID(blockedState.Workspace.Governance.EscalationSLA.Rollup, "room-runtime")
	if runtimeRollup == nil || runtimeRollup.Status != "blocked" || runtimeRollup.EscalationCount != 2 || runtimeRollup.BlockedCount != 2 {
		t.Fatalf("runtime escalation rollup after block = %#v, want blocked rollup with handoff + inbox blocker", blockedState.Workspace.Governance.EscalationSLA.Rollup)
	}
	reviewerLane := findGovernanceLane(blockedState.Workspace.Governance.TeamTopology, "reviewer")
	if reviewerLane == nil || reviewerLane.Status != "blocked" {
		t.Fatalf("reviewer lane = %#v, want blocked reviewer lane", reviewerLane)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(re-acknowledged) error = %v", err)
	}

	completedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "review / test evidence 已收平，可以回到最终响应。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed) error = %v", err)
	}
	if completedState.Workspace.Governance.ResponseAggregation.Status != "ready" ||
		!strings.Contains(completedState.Workspace.Governance.ResponseAggregation.FinalResponse, "最终响应") {
		t.Fatalf("response aggregation = %#v, want ready closeout summary", completedState.Workspace.Governance.ResponseAggregation)
	}
	finalStep := findGovernanceStep(completedState.Workspace.Governance.Walkthrough, "final-response")
	if finalStep == nil || finalStep.Status != "ready" {
		t.Fatalf("final response step = %#v, want ready final response walkthrough", finalStep)
	}

	secondRoomState, _, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      secondRoomID,
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-memory-clerk",
		Title:       "把第二个 room 也接入 cross-room escalation rollup",
		Summary:     "请保持 requested，验证治理面会把另一个 room 也收进 rollup。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff(second room) error = %v", err)
	}
	secondRoomRollup := findEscalationRoomRollupByRoomID(secondRoomState.Workspace.Governance.EscalationSLA.Rollup, secondRoomID)
	if secondRoomRollup == nil || secondRoomRollup.Status != "active" || secondRoomRollup.EscalationCount != 1 || secondRoomRollup.BlockedCount != 0 {
		t.Fatalf("second room escalation rollup = %#v, want active second-room rollup", secondRoomState.Workspace.Governance.EscalationSLA.Rollup)
	}
}

func TestGovernanceSuggestedHandoffTracksDefaultRoleRoute(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	baseline := s.Snapshot()
	suggested := baseline.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	if suggested.Status != "ready" ||
		suggested.RoomID != "room-runtime" ||
		suggested.FromAgent != "Codex Dockmaster" ||
		suggested.ToAgent != "Claude Review Runner" ||
		suggested.ToLaneLabel != "Reviewer" {
		t.Fatalf("baseline governed handoff = %#v, want ready Codex -> Claude reviewer route", suggested)
	}

	afterCreate, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	activeSuggestion := afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	if activeSuggestion.Status != "active" || activeSuggestion.HandoffID != handoff.ID || !strings.Contains(activeSuggestion.Reason, "不要重复创建") {
		t.Fatalf("active governed handoff = %#v, want active suggestion pointing at the open handoff", activeSuggestion)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged) error = %v", err)
	}

	completedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "review 已完成，继续看下一条治理建议。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed) error = %v", err)
	}

	blockedNextSuggestion := completedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	if blockedNextSuggestion.Status != "blocked" ||
		blockedNextSuggestion.FromLaneLabel != "Reviewer" ||
		blockedNextSuggestion.ToLaneLabel != "QA" ||
		!strings.Contains(blockedNextSuggestion.Reason, "缺少可映射") {
		t.Fatalf("post-complete governed handoff = %#v, want blocked reviewer -> QA route due to missing target agent", blockedNextSuggestion)
	}
}

func TestAdvanceHandoffCanAutoAdvanceGovernedRoute(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged) error = %v", err)
	}

	nextState, completed, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed continue) error = %v", err)
	}
	if completed.Status != "completed" {
		t.Fatalf("completed handoff = %#v, want completed", completed)
	}
	if len(nextState.Mailbox) < 2 {
		t.Fatalf("mailbox = %#v, want followup handoff created at front", nextState.Mailbox)
	}

	followup := nextState.Mailbox[0]
	if followup.ID == handoff.ID ||
		followup.Status != "requested" ||
		followup.FromAgent != "Claude Review Runner" ||
		followup.ToAgent != "Memory Clerk" {
		t.Fatalf("followup handoff = %#v, want new requested reviewer -> Memory Clerk handoff", followup)
	}
	if !strings.Contains(followup.Title, "QA") {
		t.Fatalf("followup title = %q, want QA lane draft", followup.Title)
	}
	run := findRunByID(nextState, "run_runtime_01")
	if run == nil || !strings.Contains(run.NextAction, "Memory Clerk") {
		t.Fatalf("run = %#v, want next action waiting for Memory Clerk", run)
	}
	suggested := nextState.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	if suggested.Status != "active" || suggested.HandoffID != followup.ID || suggested.ToAgent != "Memory Clerk" {
		t.Fatalf("suggested handoff = %#v, want active followup pointing at Memory Clerk", suggested)
	}
}

func TestCreateGovernedHandoffForRoomUsesRoomSpecificSuggestion(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
		Kind:        handoffKindGoverned,
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-claude-review-runner",
		Note:          "review 已完成，等待跨 room orchestration 直接起 QA 一棒。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed) error = %v", err)
	}

	nextState, created, suggestion, err := s.CreateGovernedHandoffForRoom("room-runtime")
	if err != nil {
		t.Fatalf("CreateGovernedHandoffForRoom() error = %v", err)
	}
	if suggestion.Status != "ready" || suggestion.ToAgent != "Memory Clerk" {
		t.Fatalf("suggestion = %#v, want ready reviewer -> Memory Clerk route", suggestion)
	}
	if created.Kind != handoffKindGoverned || created.Status != "requested" || created.FromAgent != "Claude Review Runner" || created.ToAgent != "Memory Clerk" {
		t.Fatalf("created governed handoff = %#v, want requested reviewer -> Memory Clerk governed handoff", created)
	}
	if nextState.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HandoffID != created.ID {
		t.Fatalf("workspace suggested handoff = %#v, want active created handoff", nextState.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}

	if _, _, _, err := s.CreateGovernedHandoffForRoom("room-runtime"); !errors.Is(err, ErrMailboxGovernedRouteNotReady) {
		t.Fatalf("repeat CreateGovernedHandoffForRoom error = %v, want ErrMailboxGovernedRouteNotReady", err)
	}
}

func TestGovernedFinalLaneCompletionBridgesDeliveryCloseout(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}

	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	followup := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(followup.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}

	closeoutNote := "QA 验证完成，可以进入 PR delivery closeout。"
	finalState, completedFollowup, err := s.AdvanceHandoff(followup.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          closeoutNote,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}
	if completedFollowup.Status != "completed" {
		t.Fatalf("completed followup = %#v, want completed", completedFollowup)
	}

	suggested := finalState.Workspace.Governance.RoutingPolicy.SuggestedHandoff
	if suggested.Status != "done" || suggested.Href != "/pull-requests/pr-runtime-18" {
		t.Fatalf("suggested closeout = %#v, want done status with PR delivery link", suggested)
	}
	if !strings.Contains(suggested.Reason, closeoutNote) {
		t.Fatalf("suggested reason = %q, want closeout note reflected", suggested.Reason)
	}

	detail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok {
		t.Fatalf("PullRequestDetail() missing runtime PR detail")
	}
	if !strings.Contains(detail.Delivery.HandoffNote.Summary, "governed closeout") {
		t.Fatalf("handoff note summary = %q, want governed closeout wording", detail.Delivery.HandoffNote.Summary)
	}
	if detail.Delivery.Delegation.Status != "ready" ||
		detail.Delivery.Delegation.TargetAgent != "Spec Captain" ||
		detail.Delivery.Delegation.TargetLane != "PM" {
		t.Fatalf("delivery delegation = %#v, want ready Spec Captain / PM delegate", detail.Delivery.Delegation)
	}
	if detail.Delivery.Delegation.HandoffID == "" || detail.Delivery.Delegation.HandoffStatus != "requested" {
		t.Fatalf("delivery delegation = %#v, want auto-created requested delivery closeout handoff", detail.Delivery.Delegation)
	}
	joinedLines := strings.Join(detail.Delivery.HandoffNote.Lines, "\n")
	if !strings.Contains(joinedLines, closeoutNote) || !strings.Contains(joinedLines, "governed route 已到 done") {
		t.Fatalf("handoff note lines = %#v, want closeout note + governed done guidance", detail.Delivery.HandoffNote.Lines)
	}

	evidence := findDeliveryEvidence(detail.Delivery.Evidence, "governed-closeout")
	if evidence == nil || evidence.Href != "/pull-requests/pr-runtime-18" || !strings.Contains(evidence.Summary, closeoutNote) {
		t.Fatalf("delivery evidence = %#v, want governed closeout evidence", detail.Delivery.Evidence)
	}
	delegateEvidence := findDeliveryEvidence(detail.Delivery.Evidence, "delivery-delegate")
	if delegateEvidence == nil || delegateEvidence.Value != "Spec Captain" {
		t.Fatalf("delivery evidence = %#v, want delivery delegate evidence", detail.Delivery.Evidence)
	}
	delegationInbox := findInboxItemByID(finalState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if delegationInbox == nil || delegationInbox.Href != "/pull-requests/pr-runtime-18" || !strings.Contains(delegationInbox.Summary, "Spec Captain") {
		t.Fatalf("delegation inbox = %#v, want PR delivery delegation inbox signal", finalState.Inbox)
	}
	closeoutHandoff := findHandoffByID(finalState.Mailbox, detail.Delivery.Delegation.HandoffID)
	if closeoutHandoff == nil ||
		closeoutHandoff.Kind != handoffKindDeliveryCloseout ||
		closeoutHandoff.FromAgent != "Memory Clerk" ||
		closeoutHandoff.ToAgent != "Spec Captain" ||
		closeoutHandoff.Status != "requested" {
		t.Fatalf("delivery closeout handoff = %#v, want requested Memory Clerk -> Spec Captain delivery-closeout handoff", finalState.Mailbox)
	}
}

func TestDeliveryDelegationHandoffLifecycleSyncsBackToPullRequest(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	blockedState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          blockNote,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(blocked delegated closeout) error = %v", err)
	}
	blockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		blockedDetail.Delivery.Delegation.Status != "blocked" ||
		blockedDetail.Delivery.Delegation.HandoffStatus != "blocked" ||
		!strings.Contains(blockedDetail.Delivery.Delegation.Summary, blockNote) {
		t.Fatalf("blocked delegation = %#v, want blocked summary with blocker note", blockedDetail.Delivery.Delegation)
	}
	if blockedDetail.Delivery.Delegation.ResponseHandoffID == "" ||
		blockedDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" {
		t.Fatalf("blocked delegation = %#v, want auto-created unblock response handoff", blockedDetail.Delivery.Delegation)
	}
	responseHandoff := findHandoffByID(blockedState.Mailbox, blockedDetail.Delivery.Delegation.ResponseHandoffID)
	if responseHandoff == nil ||
		responseHandoff.Kind != handoffKindDeliveryReply ||
		responseHandoff.ParentHandoffID != delegatedHandoffID ||
		responseHandoff.FromAgentID != delegatedHandoff.ToAgentID ||
		responseHandoff.ToAgentID != delegatedHandoff.FromAgentID {
		t.Fatalf("response handoff = %#v, want delivery-reply from target back to source", responseHandoff)
	}
	blockedInbox := findInboxItemByID(blockedState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if blockedInbox == nil || blockedInbox.Kind != "blocked" || !strings.Contains(blockedInbox.Summary, blockNote) || !strings.Contains(blockedInbox.Summary, "unblock response handoff") {
		t.Fatalf("blocked delegation inbox = %#v, want blocked delivery delegation signal", blockedState.Inbox)
	}
	if blockedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "done" {
		t.Fatalf("suggested handoff = %#v, want governance route to stay done during delegated closeout", blockedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}

	if _, _, err := s.AdvanceHandoff(responseHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: responseHandoff.ToAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged delivery reply) error = %v", err)
	}
	responseCompletedState, _, err := s.AdvanceHandoff(responseHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: responseHandoff.ToAgentID,
		Note:          "release receipt checklist 已补齐，请重新接住 delivery closeout。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed delivery reply) error = %v", err)
	}
	responseCompletedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		responseCompletedDetail.Delivery.Delegation.Status != "blocked" ||
		responseCompletedDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(responseCompletedDetail.Delivery.Delegation.Summary, "重新 acknowledge final delivery closeout") {
		t.Fatalf("response-completed delegation = %#v, want blocked delegation with completed response handoff", responseCompletedDetail.Delivery.Delegation)
	}
	responseCompletedInbox := findInboxItemByID(responseCompletedState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if responseCompletedInbox == nil || !strings.Contains(responseCompletedInbox.Summary, "重新 acknowledge final delivery closeout") {
		t.Fatalf("response-completed delegation inbox = %#v, want response completion summary", responseCompletedState.Inbox)
	}

	reAckState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.ToAgentID,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(re-ack delegated closeout) error = %v", err)
	}
	reAckDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		reAckDetail.Delivery.Delegation.Status != "ready" ||
		reAckDetail.Delivery.Delegation.HandoffStatus != "acknowledged" ||
		reAckDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(reAckDetail.Delivery.Delegation.Summary, "第 1 轮") ||
		!strings.Contains(reAckDetail.Delivery.Delegation.Summary, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("re-ack delegation = %#v, want resumed delivery delegation with preserved response history", reAckDetail.Delivery.Delegation)
	}
	reAckInbox := findInboxItemByID(reAckState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if reAckInbox == nil ||
		reAckInbox.Kind != "status" ||
		!strings.Contains(reAckInbox.Summary, "第 1 轮") ||
		!strings.Contains(reAckInbox.Summary, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("re-ack delegation inbox = %#v, want resumed delivery delegation summary with preserved response history", reAckState.Inbox)
	}
	completedState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          "最终 delivery closeout 已收口，等待 merge / release receipt。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed delegated closeout) error = %v", err)
	}

	completedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		completedDetail.Delivery.Delegation.Status != "done" ||
		completedDetail.Delivery.Delegation.HandoffStatus != "completed" ||
		completedDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(completedDetail.Delivery.Delegation.Summary, "第 1 轮") ||
		!strings.Contains(completedDetail.Delivery.Delegation.Summary, "也已完成 final delivery closeout") {
		t.Fatalf("completed delegation = %#v, want done/completed delivery delegation with preserved response history", completedDetail.Delivery.Delegation)
	}
	completedInbox := findInboxItemByID(completedState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if completedInbox == nil ||
		completedInbox.Kind != "status" ||
		!strings.Contains(completedInbox.Title, "已完成") ||
		!strings.Contains(completedInbox.Summary, "第 1 轮") ||
		!strings.Contains(completedInbox.Summary, "也已完成 final delivery closeout") {
		t.Fatalf("completed delegation inbox = %#v, want completed delivery delegation signal with preserved response history", completedState.Inbox)
	}
	if completedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "done" {
		t.Fatalf("suggested handoff = %#v, want governance route to remain done after delegated closeout completion", completedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
}

func TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          "第一轮 blocker：release 文案待确认。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(first blocked delegated closeout) error = %v", err)
	}
	firstBlockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		firstBlockedDetail.Delivery.Delegation.ResponseAttemptCount != 1 ||
		firstBlockedDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" {
		t.Fatalf("first blocked delegation = %#v, want first response attempt requested", firstBlockedDetail.Delivery.Delegation)
	}
	firstResponseHandoffID := firstBlockedDetail.Delivery.Delegation.ResponseHandoffID
	if _, _, err := s.AdvanceHandoff(firstResponseHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.FromAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged first delivery reply) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(firstResponseHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          "第一轮 unblock response 已补齐。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed first delivery reply) error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.ToAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(re-ack delegated closeout before retry) error = %v", err)
	}
	reblockedState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          "第二轮 blocker：release owner 还没签字。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(second blocked delegated closeout) error = %v", err)
	}
	reblockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		reblockedDetail.Delivery.Delegation.ResponseAttemptCount != 2 ||
		reblockedDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" ||
		reblockedDetail.Delivery.Delegation.ResponseHandoffID == firstResponseHandoffID ||
		!strings.Contains(reblockedDetail.Delivery.Delegation.Summary, "第 2 轮") {
		t.Fatalf("reblocked delegation = %#v, want second response retry surfaced", reblockedDetail.Delivery.Delegation)
	}
	secondResponseHandoff := findHandoffByID(reblockedState.Mailbox, reblockedDetail.Delivery.Delegation.ResponseHandoffID)
	if secondResponseHandoff == nil || secondResponseHandoff.ParentHandoffID != delegatedHandoffID {
		t.Fatalf("second response handoff = %#v, want new retry handoff linked to delegated closeout", secondResponseHandoff)
	}
	responseHandoffs := 0
	for _, item := range reblockedState.Mailbox {
		if item.Kind == handoffKindDeliveryReply && item.ParentHandoffID == delegatedHandoffID {
			responseHandoffs += 1
		}
	}
	if responseHandoffs != 2 {
		t.Fatalf("response handoff count = %d, want 2 retry ledgers", responseHandoffs)
	}

	if _, _, err := s.AdvanceHandoff(secondResponseHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: secondResponseHandoff.ToAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged second delivery reply) error = %v", err)
	}
	secondResponseState, _, err := s.AdvanceHandoff(secondResponseHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: secondResponseHandoff.ToAgentID,
		Note:          "第二轮 unblock response 已补齐，请重新接住。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed second delivery reply) error = %v", err)
	}
	secondResponseDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		secondResponseDetail.Delivery.Delegation.Status != "blocked" ||
		secondResponseDetail.Delivery.Delegation.ResponseAttemptCount != 2 ||
		secondResponseDetail.Delivery.Delegation.ResponseHandoffStatus != "completed" ||
		!strings.Contains(secondResponseDetail.Delivery.Delegation.Summary, "第 2 轮") {
		t.Fatalf("second-response delegation = %#v, want completed second retry response", secondResponseDetail.Delivery.Delegation)
	}
	secondResponseInbox := findInboxItemByID(secondResponseState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if secondResponseInbox == nil || !strings.Contains(secondResponseInbox.Summary, "第 2 轮") {
		t.Fatalf("second-response inbox = %#v, want retry attempt summary", secondResponseState.Inbox)
	}
}

func TestDeliveryDelegationResponseCommentsSyncBackToPullRequest(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          "需要先确认最终 release 文案，再继续 closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(blocked delegated closeout) error = %v", err)
	}
	blockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || blockedDetail.Delivery.Delegation.ResponseHandoffID == "" {
		t.Fatalf("blocked detail = %#v, want response handoff", blockedDetail)
	}
	responseHandoffID := blockedDetail.Delivery.Delegation.ResponseHandoffID

	sourceComment := "source 说明：release receipt checklist 正在补。"
	sourceCommentState, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          sourceComment,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(source comment response handoff) error = %v", err)
	}
	sourceCommentDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		sourceCommentDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" ||
		!strings.Contains(sourceCommentDetail.Delivery.Delegation.Summary, sourceComment) {
		t.Fatalf("source-comment delegation = %#v, want latest response comment sync", sourceCommentDetail.Delivery.Delegation)
	}
	sourceCommentInbox := findInboxItemByID(sourceCommentState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if sourceCommentInbox == nil || !strings.Contains(sourceCommentInbox.Summary, sourceComment) {
		t.Fatalf("source-comment inbox = %#v, want response comment summary", sourceCommentState.Inbox)
	}

	targetComment := "target 回应：等 owner 签字后我会重新接住。"
	targetCommentState, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          targetComment,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(target comment response handoff) error = %v", err)
	}
	targetCommentDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		targetCommentDetail.Delivery.Delegation.ResponseHandoffStatus != "requested" ||
		!strings.Contains(targetCommentDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("target-comment delegation = %#v, want latest target response comment sync", targetCommentDetail.Delivery.Delegation)
	}
	targetCommentInbox := findInboxItemByID(targetCommentState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if targetCommentInbox == nil || !strings.Contains(targetCommentInbox.Summary, targetComment) {
		t.Fatalf("target-comment inbox = %#v, want latest target response comment summary", targetCommentState.Inbox)
	}

	if _, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.FromAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged response handoff) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          "release receipt checklist 已补齐，请重新接住 delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed response handoff) error = %v", err)
	}

	responseCompletedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || !strings.Contains(responseCompletedDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("response-completed delegation = %#v, want latest target response comment preserved", responseCompletedDetail.Delivery.Delegation)
	}

	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.ToAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged delegated closeout after response comments) error = %v", err)
	}
	resumedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || !strings.Contains(resumedDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("resumed delegation = %#v, want latest target response comment preserved after parent resume", resumedDetail.Delivery.Delegation)
	}

	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          "最终 delivery closeout 已收口，等待 merge / release receipt。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed delegated closeout after response comments) error = %v", err)
	}
	completedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || !strings.Contains(completedDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("completed delegation = %#v, want latest target response comment preserved after parent completion", completedDetail.Delivery.Delegation)
	}
}

func TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          blockNote,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(blocked delegated closeout) error = %v", err)
	}
	blockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || blockedDetail.Delivery.Delegation.ResponseHandoffID == "" {
		t.Fatalf("blocked detail = %#v, want response handoff", blockedDetail)
	}
	responseHandoffID := blockedDetail.Delivery.Delegation.ResponseHandoffID

	sourceComment := "source 说明：release receipt checklist 正在补。"
	commentState, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          sourceComment,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(comment response handoff) error = %v", err)
	}
	parentAfterComment := findHandoffByID(commentState.Mailbox, delegatedHandoffID)
	if parentAfterComment == nil ||
		parentAfterComment.Status != "blocked" ||
		parentAfterComment.LastNote != blockNote ||
		!strings.Contains(parentAfterComment.LastAction, sourceComment) ||
		!strings.Contains(parentAfterComment.LastAction, "重新 acknowledge 主 closeout") {
		t.Fatalf("parent handoff after response comment = %#v, want mirrored resume guidance", parentAfterComment)
	}
	parentCommentInbox := findInboxItemByID(commentState.Inbox, delegatedHandoff.InboxItemID)
	if parentCommentInbox == nil ||
		!strings.Contains(parentCommentInbox.Summary, blockNote) ||
		!strings.Contains(parentCommentInbox.Summary, sourceComment) {
		t.Fatalf("parent inbox after response comment = %#v, want blocker + response progress summary", parentCommentInbox)
	}
	if !hasMailboxMessage(parentAfterComment.Messages, "response-progress", sourceComment) {
		t.Fatalf("parent handoff messages after response comment = %#v, want response-progress ledger entry", parentAfterComment.Messages)
	}
	if !roomMessagesContain(commentState.RoomMessages["room-runtime"], "[Mailbox Sync]") ||
		!roomMessagesContain(commentState.RoomMessages["room-runtime"], sourceComment) {
		t.Fatalf("room messages after response comment = %#v, want room sync trace for child response comment", commentState.RoomMessages["room-runtime"])
	}
	commentRun := findRunByID(commentState, delegatedHandoff.RunID)
	if commentRun == nil || !strings.Contains(commentRun.NextAction, sourceComment) {
		t.Fatalf("comment run = %#v, want response progress next action", commentRun)
	}

	if _, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.FromAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged response handoff) error = %v", err)
	}

	completeNote := "release receipt checklist 已补齐，请重新接住 delivery closeout。"
	completedState, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          completeNote,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed response handoff) error = %v", err)
	}
	parentAfterComplete := findHandoffByID(completedState.Mailbox, delegatedHandoffID)
	if parentAfterComplete == nil ||
		parentAfterComplete.Status != "blocked" ||
		parentAfterComplete.LastNote != blockNote ||
		!strings.Contains(parentAfterComplete.LastAction, completeNote) ||
		!strings.Contains(parentAfterComplete.LastAction, "重新 acknowledge 主 closeout") {
		t.Fatalf("parent handoff after response completion = %#v, want resume-after-response signal", parentAfterComplete)
	}
	parentCompleteInbox := findInboxItemByID(completedState.Inbox, delegatedHandoff.InboxItemID)
	if parentCompleteInbox == nil ||
		!strings.Contains(parentCompleteInbox.Summary, blockNote) ||
		!strings.Contains(parentCompleteInbox.Summary, completeNote) {
		t.Fatalf("parent inbox after response completion = %#v, want completion progress summary", parentCompleteInbox)
	}
	if !hasMailboxMessage(parentAfterComplete.Messages, "response-progress", completeNote) {
		t.Fatalf("parent handoff messages after response completion = %#v, want response-progress completion entry", parentAfterComplete.Messages)
	}
	if !roomMessagesContain(completedState.RoomMessages["room-runtime"], sourceComment) ||
		!roomMessagesContain(completedState.RoomMessages["room-runtime"], completeNote) {
		t.Fatalf("room messages after response completion = %#v, want preserved room sync trace for response progress", completedState.RoomMessages["room-runtime"])
	}
	completedRun := findRunByID(completedState, delegatedHandoff.RunID)
	if completedRun == nil || !strings.Contains(completedRun.NextAction, completeNote) {
		t.Fatalf("completed run = %#v, want completion resume next action", completedRun)
	}

	reAckState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.ToAgentID,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(re-ack parent delegated closeout) error = %v", err)
	}
	parentAfterResume := findHandoffByID(reAckState.Mailbox, delegatedHandoffID)
	if parentAfterResume == nil ||
		parentAfterResume.Status != "acknowledged" ||
		!strings.Contains(parentAfterResume.LastAction, "第 1 轮") ||
		!strings.Contains(parentAfterResume.LastAction, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("parent handoff after resume = %#v, want reply-history-aware next action", parentAfterResume)
	}
	parentResumeInbox := findInboxItemByID(reAckState.Inbox, delegatedHandoff.InboxItemID)
	if parentResumeInbox == nil ||
		!strings.Contains(parentResumeInbox.Summary, "第 1 轮") ||
		!strings.Contains(parentResumeInbox.Summary, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("parent inbox after resume = %#v, want preserved response history summary", parentResumeInbox)
	}
	responseAfterResume := findHandoffByID(reAckState.Mailbox, responseHandoffID)
	if responseAfterResume == nil ||
		!strings.Contains(responseAfterResume.LastAction, "已重新 acknowledge 主 closeout") ||
		!strings.Contains(responseAfterResume.LastAction, "第 1 轮") {
		t.Fatalf("response handoff after resume = %#v, want child ledger synced to parent acknowledged", responseAfterResume)
	}
	responseResumeLastMessage := responseAfterResume.Messages[len(responseAfterResume.Messages)-1]
	if responseResumeLastMessage.Kind != "parent-progress" ||
		!strings.Contains(responseResumeLastMessage.Body, "已重新 acknowledge 主 closeout") {
		t.Fatalf("response handoff messages after resume = %#v, want latest parent-progress ledger entry", responseAfterResume.Messages)
	}
	responseResumeInbox := findInboxItemByID(reAckState.Inbox, responseAfterResume.InboxItemID)
	if responseResumeInbox == nil ||
		!strings.Contains(responseResumeInbox.Summary, "已重新 acknowledge 主 closeout") ||
		!strings.Contains(responseResumeInbox.Summary, "第 1 轮") {
		t.Fatalf("response inbox after resume = %#v, want child inbox synced to parent acknowledged", responseResumeInbox)
	}
	resumedRun := findRunByID(reAckState, delegatedHandoff.RunID)
	if resumedRun == nil ||
		!strings.Contains(resumedRun.NextAction, "第 1 轮") ||
		!strings.Contains(resumedRun.NextAction, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("resumed run = %#v, want preserved response history next action", resumedRun)
	}
	resumedSession := findSessionByID(reAckState, "session-runtime")
	if resumedSession == nil ||
		!strings.Contains(resumedSession.Summary, "第 1 轮") ||
		!strings.Contains(resumedSession.ControlNote, "已重新 acknowledge final delivery closeout") {
		t.Fatalf("resumed session = %#v, want preserved response history summary + control note", resumedSession)
	}

	parentCompleteState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          "最终 delivery closeout 已收口，等待 merge / release receipt。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed parent delegated closeout) error = %v", err)
	}
	parentAfterFinalCloseout := findHandoffByID(parentCompleteState.Mailbox, delegatedHandoffID)
	if parentAfterFinalCloseout == nil ||
		parentAfterFinalCloseout.Status != "completed" ||
		!strings.Contains(parentAfterFinalCloseout.LastAction, "第 1 轮") ||
		!strings.Contains(parentAfterFinalCloseout.LastAction, "也已完成 final delivery closeout") {
		t.Fatalf("parent handoff after final closeout = %#v, want reply-history-aware completion action", parentAfterFinalCloseout)
	}
	if !hasMailboxMessage(parentAfterFinalCloseout.Messages, "response-progress", completeNote) {
		t.Fatalf("parent handoff messages after final closeout = %#v, want preserved response-progress history", parentAfterFinalCloseout.Messages)
	}
	parentCompletedInbox := findInboxItemByID(parentCompleteState.Inbox, delegatedHandoff.InboxItemID)
	if parentCompletedInbox == nil ||
		!strings.Contains(parentCompletedInbox.Summary, "第 1 轮") ||
		!strings.Contains(parentCompletedInbox.Summary, "也已完成 final delivery closeout") {
		t.Fatalf("parent inbox after final closeout = %#v, want preserved completion history summary", parentCompletedInbox)
	}
	responseAfterFinalCloseout := findHandoffByID(parentCompleteState.Mailbox, responseHandoffID)
	if responseAfterFinalCloseout == nil ||
		!strings.Contains(responseAfterFinalCloseout.LastAction, "已完成主 closeout") ||
		!strings.Contains(responseAfterFinalCloseout.LastAction, "第 1 轮") {
		t.Fatalf("response handoff after final closeout = %#v, want child ledger synced to parent completion", responseAfterFinalCloseout)
	}
	responseCompletedLastMessage := responseAfterFinalCloseout.Messages[len(responseAfterFinalCloseout.Messages)-1]
	if responseCompletedLastMessage.Kind != "parent-progress" ||
		!strings.Contains(responseCompletedLastMessage.Body, "已完成主 closeout") {
		t.Fatalf("response handoff messages after final closeout = %#v, want completion parent-progress ledger entry", responseAfterFinalCloseout.Messages)
	}
	responseCompletedInbox := findInboxItemByID(parentCompleteState.Inbox, responseAfterFinalCloseout.InboxItemID)
	if responseCompletedInbox == nil ||
		!strings.Contains(responseCompletedInbox.Summary, "已完成主 closeout") ||
		!strings.Contains(responseCompletedInbox.Summary, "第 1 轮") {
		t.Fatalf("response inbox after final closeout = %#v, want child inbox synced to parent completion", responseCompletedInbox)
	}
	parentCompletedRun := findRunByID(parentCompleteState, delegatedHandoff.RunID)
	if parentCompletedRun == nil ||
		!strings.Contains(parentCompletedRun.NextAction, "第 1 轮") ||
		!strings.Contains(parentCompletedRun.NextAction, "也已完成 final delivery closeout") {
		t.Fatalf("parent completed run = %#v, want preserved completion history next action", parentCompletedRun)
	}
	parentCompletedSession := findSessionByID(parentCompleteState, "session-runtime")
	if parentCompletedSession == nil ||
		!strings.Contains(parentCompletedSession.Summary, "第 1 轮") ||
		!strings.Contains(parentCompletedSession.ControlNote, "也已完成 final delivery closeout") {
		t.Fatalf("parent completed session = %#v, want preserved completion history summary + control note", parentCompletedSession)
	}
}

func TestDeliveryDelegationBlockedResponseSyncsIntoParentRoomTrace(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          blockNote,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(blocked delegated closeout) error = %v", err)
	}
	blockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || blockedDetail.Delivery.Delegation.ResponseHandoffID == "" {
		t.Fatalf("blocked detail = %#v, want response handoff", blockedDetail)
	}
	responseHandoffID := blockedDetail.Delivery.Delegation.ResponseHandoffID

	responseBlockNote := "source 也卡住了：release owner 还没签字。"
	blockedResponseState, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          responseBlockNote,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(blocked response handoff) error = %v", err)
	}

	responseBlockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		responseBlockedDetail.Delivery.Delegation.ResponseHandoffStatus != "blocked" ||
		!strings.Contains(responseBlockedDetail.Delivery.Delegation.Summary, responseBlockNote) {
		t.Fatalf("response-blocked delegation = %#v, want blocked response summary preserved", responseBlockedDetail.Delivery.Delegation)
	}
	parentAfterBlockedResponse := findHandoffByID(blockedResponseState.Mailbox, delegatedHandoffID)
	if parentAfterBlockedResponse == nil ||
		parentAfterBlockedResponse.Status != "blocked" ||
		parentAfterBlockedResponse.LastNote != blockNote ||
		!strings.Contains(parentAfterBlockedResponse.LastAction, responseBlockNote) ||
		!strings.Contains(parentAfterBlockedResponse.LastAction, "当前也 blocked") {
		t.Fatalf("parent handoff after blocked response = %#v, want blocked response guidance", parentAfterBlockedResponse)
	}
	parentBlockedResponseInbox := findInboxItemByID(blockedResponseState.Inbox, delegatedHandoff.InboxItemID)
	if parentBlockedResponseInbox == nil ||
		!strings.Contains(parentBlockedResponseInbox.Summary, blockNote) ||
		!strings.Contains(parentBlockedResponseInbox.Summary, responseBlockNote) {
		t.Fatalf("parent inbox after blocked response = %#v, want blocker + blocked response summary", parentBlockedResponseInbox)
	}
	if !hasMailboxMessage(parentAfterBlockedResponse.Messages, "response-progress", responseBlockNote) {
		t.Fatalf("parent handoff messages after blocked response = %#v, want response-progress blocked entry", parentAfterBlockedResponse.Messages)
	}
	if !roomMessagesContain(blockedResponseState.RoomMessages["room-runtime"], "[Mailbox Sync]") ||
		!roomMessagesContain(blockedResponseState.RoomMessages["room-runtime"], responseBlockNote) ||
		!roomMessagesContain(blockedResponseState.RoomMessages["room-runtime"], "当前也 blocked") {
		t.Fatalf("room messages after blocked response = %#v, want room sync trace for blocked child response", blockedResponseState.RoomMessages["room-runtime"])
	}
	blockedRun := findRunByID(blockedResponseState, delegatedHandoff.RunID)
	if blockedRun == nil || !strings.Contains(blockedRun.NextAction, responseBlockNote) {
		t.Fatalf("blocked run = %#v, want blocked response next action", blockedRun)
	}
}

func TestDeliveryDelegationCommunicationThreadAggregatesParentAndReplyMessages(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	if len(initialDetail.Delivery.Delegation.Communication) != 1 {
		t.Fatalf("initial communication = %#v, want initial parent closeout request", initialDetail.Delivery.Delegation.Communication)
	}
	if initialDetail.Delivery.Delegation.Communication[0].HandoffLabel != "Parent Closeout" ||
		initialDetail.Delivery.Delegation.Communication[0].MessageKind != "request" {
		t.Fatalf("initial communication entry = %#v, want parent request entry", initialDetail.Delivery.Delegation.Communication[0])
	}

	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "blocked",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          blockNote,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(blocked delegated closeout) error = %v", err)
	}
	blockedDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || blockedDetail.Delivery.Delegation.ResponseHandoffID == "" {
		t.Fatalf("blocked detail = %#v, want response handoff", blockedDetail)
	}
	responseHandoffID := blockedDetail.Delivery.Delegation.ResponseHandoffID

	sourceComment := "source 说明：release receipt checklist 正在补。"
	if _, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          sourceComment,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(comment response handoff) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.FromAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged response handoff) error = %v", err)
	}
	responseCompleteNote := "release receipt checklist 已补齐，请重新接住 delivery closeout。"
	if _, _, err := s.AdvanceHandoff(responseHandoffID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          responseCompleteNote,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed response handoff) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.ToAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged delegated closeout) error = %v", err)
	}

	detail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok {
		t.Fatalf("PullRequestDetail() missing runtime PR detail")
	}
	communication := detail.Delivery.Delegation.Communication
	if len(communication) < 8 {
		t.Fatalf("communication = %#v, want unified parent + reply timeline", communication)
	}

	blockedIndex := -1
	replyRequestIndex := -1
	replyCommentIndex := -1
	parentResumeIndex := -1
	replyProgressIndex := -1
	for index, entry := range communication {
		switch {
		case entry.HandoffLabel == "Parent Closeout" && entry.MessageKind == "blocked" && strings.Contains(entry.Summary, blockNote):
			blockedIndex = index
		case entry.HandoffLabel == "Unblock Reply x1" && entry.MessageKind == "request":
			replyRequestIndex = index
			if !strings.Contains(entry.Href, responseHandoffID) {
				t.Fatalf("reply request entry = %#v, want child mailbox href", entry)
			}
		case entry.HandoffLabel == "Unblock Reply x1" && entry.MessageKind == "comment" && strings.Contains(entry.Summary, sourceComment):
			replyCommentIndex = index
		case entry.HandoffLabel == "Parent Closeout" && entry.MessageKind == "ack":
			parentResumeIndex = index
		case entry.HandoffLabel == "Unblock Reply x1" && entry.MessageKind == "parent-progress" && strings.Contains(entry.Summary, "已重新 acknowledge 主 closeout"):
			replyProgressIndex = index
		}
	}

	if blockedIndex == -1 || replyRequestIndex == -1 || replyCommentIndex == -1 || parentResumeIndex == -1 || replyProgressIndex == -1 {
		t.Fatalf("communication = %#v, want blocked/request/comment/parent-resume/parent-progress entries", communication)
	}
	if !(blockedIndex < replyRequestIndex && replyRequestIndex < replyCommentIndex && replyCommentIndex < parentResumeIndex && parentResumeIndex < replyProgressIndex) {
		t.Fatalf("communication order = %#v, want chronological parent->reply->parent sync thread", communication)
	}
}

func TestDeliveryDelegationSignalOnlyPolicySkipsAutoCreatedHandoff(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			DeliveryDelegationMode: governanceDeliveryDelegationModeSignalOnly,
			TeamTopology:           topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	finalState, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	detail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok {
		t.Fatalf("PullRequestDetail() missing runtime PR detail")
	}
	if detail.Delivery.Delegation.Status != "ready" ||
		detail.Delivery.Delegation.TargetAgent != "Spec Captain" ||
		detail.Delivery.Delegation.HandoffID != "" ||
		detail.Delivery.Delegation.HandoffStatus != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "signal-only") {
		t.Fatalf("delivery delegation = %#v, want signal-only delivery delegate without auto-created handoff", detail.Delivery.Delegation)
	}
	delegationInbox := findInboxItemByID(finalState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if delegationInbox == nil || delegationInbox.Kind != "status" || !strings.Contains(delegationInbox.Summary, "signal-only") {
		t.Fatalf("delegation inbox = %#v, want signal-only delivery delegation signal", finalState.Inbox)
	}
	for _, item := range finalState.Mailbox {
		if item.Kind == handoffKindDeliveryCloseout && item.RoomID == "room-runtime" {
			t.Fatalf("mailbox = %#v, want no auto-created delivery-closeout handoff under signal-only policy", finalState.Mailbox)
		}
	}
}

func TestDelegatedCloseoutCommentsSyncToDeliveryContract(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			TeamTopology: topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	initialDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok || initialDetail.Delivery.Delegation.HandoffID == "" {
		t.Fatalf("PullRequestDetail() = %#v, want auto-created delivery delegation handoff", initialDetail)
	}
	delegatedHandoffID := initialDetail.Delivery.Delegation.HandoffID
	delegatedHandoff := findHandoffByID(s.Snapshot().Mailbox, delegatedHandoffID)
	if delegatedHandoff == nil {
		t.Fatalf("delegated handoff %q missing from mailbox", delegatedHandoffID)
	}

	sourceComment := "QA 已补充 release receipt checklist，先按这个清单收最终 operator closeout。"
	sourceCommentState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: delegatedHandoff.FromAgentID,
		Note:          sourceComment,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(source comment delegated closeout) error = %v", err)
	}
	sourceDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		sourceDetail.Delivery.Delegation.Status != "ready" ||
		sourceDetail.Delivery.Delegation.HandoffStatus != "requested" ||
		!strings.Contains(sourceDetail.Delivery.Delegation.Summary, sourceComment) {
		t.Fatalf("source-comment delegation = %#v, want requested summary with source comment", sourceDetail.Delivery.Delegation)
	}
	sourceInbox := findInboxItemByID(sourceCommentState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if sourceInbox == nil || !strings.Contains(sourceInbox.Summary, sourceComment) {
		t.Fatalf("source-comment delegation inbox = %#v, want source comment synced", sourceCommentState.Inbox)
	}

	targetComment := "Spec Captain 已收到 checklist，会按这个顺序补最终 release note 和 receipt。"
	targetCommentState, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "comment",
		ActingAgentID: delegatedHandoff.ToAgentID,
		Note:          targetComment,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(target comment delegated closeout) error = %v", err)
	}
	targetDetail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok ||
		targetDetail.Delivery.Delegation.Status != "ready" ||
		targetDetail.Delivery.Delegation.HandoffStatus != "requested" ||
		!strings.Contains(targetDetail.Delivery.Delegation.Summary, targetComment) {
		t.Fatalf("target-comment delegation = %#v, want requested summary with target comment", targetDetail.Delivery.Delegation)
	}
	targetInbox := findInboxItemByID(targetCommentState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if targetInbox == nil || !strings.Contains(targetInbox.Summary, targetComment) {
		t.Fatalf("target-comment delegation inbox = %#v, want target comment synced", targetCommentState.Inbox)
	}
}

func TestDeliveryDelegationAutoCompletePolicyMarksDelegationDoneWithoutHandoff(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	topology := defaultWorkspaceGovernanceTopology("dev-team")
	topology[len(topology)-1].DefaultAgent = "Memory Clerk"
	if _, _, err := s.UpdateWorkspaceConfig(WorkspaceConfigUpdateInput{
		Governance: &WorkspaceGovernanceConfigInput{
			DeliveryDelegationMode: governanceDeliveryDelegationModeAutoComplete,
			TeamTopology:           topology,
		},
	}); err != nil {
		t.Fatalf("UpdateWorkspaceConfig() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "把 developer lane 正式交给 reviewer",
		Summary:     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	if err != nil {
		t.Fatalf("CreateHandoff() error = %v", err)
	}
	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged reviewer) error = %v", err)
	}
	reviewerClosedState, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:                "completed",
		ActingAgentID:         "agent-claude-review-runner",
		Note:                  "review 已完成，直接把 QA 接力拉起来。",
		ContinueGovernedRoute: true,
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed reviewer continue) error = %v", err)
	}
	qaHandoff := reviewerClosedState.Mailbox[0]

	if _, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-memory-clerk",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged qa) error = %v", err)
	}
	finalState, _, err := s.AdvanceHandoff(qaHandoff.ID, MailboxUpdateInput{
		Action:        "completed",
		ActingAgentID: "agent-memory-clerk",
		Note:          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	if err != nil {
		t.Fatalf("AdvanceHandoff(completed qa) error = %v", err)
	}

	detail, ok := s.PullRequestDetail("pr-runtime-18")
	if !ok {
		t.Fatalf("PullRequestDetail() missing runtime PR detail")
	}
	if detail.Delivery.Delegation.Status != "done" ||
		detail.Delivery.Delegation.TargetAgent != "Spec Captain" ||
		detail.Delivery.Delegation.HandoffID != "" ||
		detail.Delivery.Delegation.HandoffStatus != "" ||
		!strings.Contains(detail.Delivery.Delegation.Summary, "auto-complete") {
		t.Fatalf("delivery delegation = %#v, want auto-complete delivery delegate without formal handoff", detail.Delivery.Delegation)
	}
	if !strings.Contains(detail.Delivery.HandoffNote.Summary, "auto-closeout policy") {
		t.Fatalf("delivery handoff note = %#v, want auto-closeout policy summary", detail.Delivery.HandoffNote)
	}
	delegationInbox := findInboxItemByID(finalState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if delegationInbox == nil || delegationInbox.Kind != "status" || !strings.Contains(delegationInbox.Summary, "auto-complete") {
		t.Fatalf("delegation inbox = %#v, want auto-complete delivery delegation signal", finalState.Inbox)
	}
	for _, item := range finalState.Mailbox {
		if item.Kind == handoffKindDeliveryCloseout && item.RoomID == "room-runtime" {
			t.Fatalf("mailbox = %#v, want no auto-created delivery-closeout handoff under auto-complete policy", finalState.Mailbox)
		}
	}
}

func findInboxItemByHandoffID(items []InboxItem, handoffID string) *InboxItem {
	for index := range items {
		if items[index].HandoffID == handoffID {
			return &items[index]
		}
	}
	return nil
}

func findInboxItemByID(items []InboxItem, inboxID string) *InboxItem {
	for index := range items {
		if items[index].ID == inboxID {
			return &items[index]
		}
	}
	return nil
}

func findHandoffByID(items []AgentHandoff, handoffID string) *AgentHandoff {
	for index := range items {
		if items[index].ID == handoffID {
			return &items[index]
		}
	}
	return nil
}

func hasMailboxMessage(items []MailboxMessage, kind, needle string) bool {
	for _, item := range items {
		if item.Kind != kind {
			continue
		}
		if strings.Contains(item.Body, needle) {
			return true
		}
	}
	return false
}

func roomMessagesContain(items []Message, needle string) bool {
	for _, item := range items {
		if strings.Contains(item.Message, needle) {
			return true
		}
	}
	return false
}

func findIssueByID(state State, issueID string) *Issue {
	for index := range state.Issues {
		if state.Issues[index].ID == issueID {
			return &state.Issues[index]
		}
	}
	return nil
}

func findGovernanceLane(items []WorkspaceGovernanceLane, laneID string) *WorkspaceGovernanceLane {
	for index := range items {
		if items[index].ID == laneID {
			return &items[index]
		}
	}
	return nil
}

func findGovernanceStep(items []WorkspaceGovernanceWalkthrough, stepID string) *WorkspaceGovernanceWalkthrough {
	for index := range items {
		if items[index].ID == stepID {
			return &items[index]
		}
	}
	return nil
}

func findEscalationQueueEntryBySource(
	items []WorkspaceGovernanceEscalationQueueEntry,
	source string,
) *WorkspaceGovernanceEscalationQueueEntry {
	for index := range items {
		if items[index].Source == source {
			return &items[index]
		}
	}
	return nil
}

func findEscalationRoomRollupByRoomID(
	items []WorkspaceGovernanceEscalationRoomRollup,
	roomID string,
) *WorkspaceGovernanceEscalationRoomRollup {
	for index := range items {
		if items[index].RoomID == roomID {
			return &items[index]
		}
	}
	return nil
}

func findAlternateGovernanceRoomID(state State, exclude string) string {
	hotRoomIDs := map[string]bool{}
	for _, item := range state.Workspace.Governance.EscalationSLA.Rollup {
		hotRoomIDs[item.RoomID] = true
	}
	for _, room := range state.Rooms {
		if room.ID != exclude && !hotRoomIDs[room.ID] {
			return room.ID
		}
	}
	return ""
}

func findDeliveryEvidence(items []PullRequestDeliveryEvidence, evidenceID string) *PullRequestDeliveryEvidence {
	for index := range items {
		if items[index].ID == evidenceID {
			return &items[index]
		}
	}
	return nil
}
