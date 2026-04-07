package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestControlRunStopResumeAndFollowThread(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	stoppedState, err := s.ControlRun("run_runtime_01", RunControlInput{
		Action: runControlActionStop,
		Note:   "先停一下，把 destructive cleanup 的纠偏说明补清楚。",
		Actor:  "Larkspur",
	})
	if err != nil {
		t.Fatalf("ControlRun(stop) error = %v", err)
	}

	stoppedRun := findControlRunByID(stoppedState, "run_runtime_01")
	if stoppedRun == nil || stoppedRun.Status != runStatusPaused || stoppedRun.ControlNote == "" {
		t.Fatalf("stopped run = %#v, want paused + control note", stoppedRun)
	}
	stoppedRoom := findControlRoomByID(stoppedState, "room-runtime")
	if stoppedRoom == nil || stoppedRoom.Topic.Status != runStatusPaused {
		t.Fatalf("stopped room = %#v, want paused topic", stoppedRoom)
	}
	stoppedIssue := findControlIssueByKey(stoppedState, "OPS-12")
	if stoppedIssue == nil || stoppedIssue.State != runStatusPaused {
		t.Fatalf("stopped issue = %#v, want paused state", stoppedIssue)
	}
	stoppedSession := findControlSessionByID(stoppedState, "session-runtime")
	if stoppedSession == nil || stoppedSession.Status != runStatusPaused || stoppedSession.ControlNote == "" {
		t.Fatalf("stopped session = %#v, want paused + control note", stoppedSession)
	}
	if item, ok := findControlInboxByTitle(stoppedState.Inbox, "Run 已暂停"); !ok || item.Kind != "status" {
		t.Fatalf("stop inbox item missing from %#v", stoppedState.Inbox)
	}

	followState, err := s.ControlRun("run_runtime_01", RunControlInput{
		Action: runControlActionFollow,
		Note:   "恢复后继续沿当前 Runtime 讨论线程收口，不新开 follow-up run。",
		Actor:  "Larkspur",
	})
	if err != nil {
		t.Fatalf("ControlRun(follow_thread) error = %v", err)
	}

	followRun := findControlRunByID(followState, "run_runtime_01")
	if followRun == nil || !followRun.FollowThread || !strings.Contains(followRun.NextAction, "follow-thread") {
		t.Fatalf("follow run = %#v, want follow-thread true + next action", followRun)
	}
	followSession := findControlSessionByID(followState, "session-runtime")
	if followSession == nil || !followSession.FollowThread {
		t.Fatalf("follow session = %#v, want follow-thread true", followSession)
	}
	if item, ok := findControlInboxByTitle(followState.Inbox, "已锁定当前线程"); !ok || item.Kind != "status" {
		t.Fatalf("follow-thread inbox item missing from %#v", followState.Inbox)
	}

	resumedState, err := s.ControlRun("run_runtime_01", RunControlInput{
		Action: runControlActionResume,
		Note:   "按当前线程的纠偏说明继续推进，并把状态同步回 Room / Run / Inbox。",
		Actor:  "Larkspur",
	})
	if err != nil {
		t.Fatalf("ControlRun(resume) error = %v", err)
	}

	resumedRun := findControlRunByID(resumedState, "run_runtime_01")
	if resumedRun == nil || resumedRun.Status != "running" || !resumedRun.FollowThread {
		t.Fatalf("resumed run = %#v, want running + follow-thread preserved", resumedRun)
	}
	resumedSession := findControlSessionByID(resumedState, "session-runtime")
	if resumedSession == nil || resumedSession.Status != "running" || !resumedSession.FollowThread {
		t.Fatalf("resumed session = %#v, want running + follow-thread preserved", resumedSession)
	}
	if item, ok := findControlInboxByTitle(resumedState.Inbox, "Run 已恢复"); !ok || item.Kind != "status" {
		t.Fatalf("resume inbox item missing from %#v", resumedState.Inbox)
	}

	decisionBody, err := os.ReadFile(filepath.Join(root, "decisions", "ops-12.md"))
	if err != nil {
		t.Fatalf("read decision record: %v", err)
	}
	if !strings.Contains(string(decisionBody), "- status: follow_thread") || !strings.Contains(string(decisionBody), "- summary: 按当前线程的纠偏说明继续推进") {
		t.Fatalf("decision record missing control writeback:\n%s", string(decisionBody))
	}
}

func findControlRunByID(state State, runID string) *Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}

func findControlRoomByID(state State, roomID string) *Room {
	for index := range state.Rooms {
		if state.Rooms[index].ID == roomID {
			return &state.Rooms[index]
		}
	}
	return nil
}

func findControlIssueByKey(state State, issueKey string) *Issue {
	for index := range state.Issues {
		if state.Issues[index].Key == issueKey {
			return &state.Issues[index]
		}
	}
	return nil
}

func findControlSessionByID(state State, sessionID string) *Session {
	for index := range state.Sessions {
		if state.Sessions[index].ID == sessionID {
			return &state.Sessions[index]
		}
	}
	return nil
}

func findControlInboxByTitle(items []InboxItem, title string) (InboxItem, bool) {
	for _, item := range items {
		if item.Title == title {
			return item, true
		}
	}
	return InboxItem{}, false
}
