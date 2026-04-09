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

func findInboxItemByHandoffID(items []InboxItem, handoffID string) *InboxItem {
	for index := range items {
		if items[index].HandoffID == handoffID {
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
