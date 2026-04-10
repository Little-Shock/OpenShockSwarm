package store

import (
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
	blockedInbox := findInboxItemByID(blockedState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if blockedInbox == nil || blockedInbox.Kind != "blocked" || !strings.Contains(blockedInbox.Summary, blockNote) {
		t.Fatalf("blocked delegation inbox = %#v, want blocked delivery delegation signal", blockedState.Inbox)
	}
	if blockedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "done" {
		t.Fatalf("suggested handoff = %#v, want governance route to stay done during delegated closeout", blockedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}

	if _, _, err := s.AdvanceHandoff(delegatedHandoffID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: delegatedHandoff.ToAgentID,
	}); err != nil {
		t.Fatalf("AdvanceHandoff(re-ack delegated closeout) error = %v", err)
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
		completedDetail.Delivery.Delegation.HandoffStatus != "completed" {
		t.Fatalf("completed delegation = %#v, want done/completed delivery delegation", completedDetail.Delivery.Delegation)
	}
	completedInbox := findInboxItemByID(completedState.Inbox, deliveryDelegationInboxItemID("pr-runtime-18"))
	if completedInbox == nil || completedInbox.Kind != "status" || !strings.Contains(completedInbox.Title, "已完成") {
		t.Fatalf("completed delegation inbox = %#v, want completed delivery delegation signal", completedState.Inbox)
	}
	if completedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "done" {
		t.Fatalf("suggested handoff = %#v, want governance route to remain done after delegated closeout completion", completedState.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
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

func findDeliveryEvidence(items []PullRequestDeliveryEvidence, evidenceID string) *PullRequestDeliveryEvidence {
	for index := range items {
		if items[index].ID == evidenceID {
			return &items[index]
		}
	}
	return nil
}
