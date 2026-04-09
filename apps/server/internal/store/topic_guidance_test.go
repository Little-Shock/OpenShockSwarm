package store

import (
	"path/filepath"
	"testing"
)

func TestUpdateTopicGuidancePersistsTopicContinuityAndLedger(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	nextSummary := "先锁 runtime heartbeat truth，再决定 PR surface 是否继续推进。"
	nextState, room, err := s.UpdateTopicGuidance("topic-runtime", TopicGuidanceUpdateInput{
		Summary:   nextSummary,
		UpdatedBy: "Mina",
	})
	if err != nil {
		t.Fatalf("UpdateTopicGuidance() error = %v", err)
	}

	if room.Topic.Summary != nextSummary || room.Summary != nextSummary {
		t.Fatalf("room = %#v, want topic + room summary updated", room)
	}

	run := findTopicGuidanceRunByID(nextState, "run_runtime_01")
	if run == nil || run.Summary != nextSummary || run.NextAction != nextSummary {
		t.Fatalf("run = %#v, want summary + nextAction updated", run)
	}

	session := findTopicGuidanceSessionByID(nextState, "session-runtime")
	if session == nil || session.Summary != nextSummary {
		t.Fatalf("session = %#v, want summary updated", session)
	}

	issue := findTopicGuidanceIssueByRoomID(nextState, "room-runtime")
	if issue == nil || issue.Summary != nextSummary {
		t.Fatalf("issue = %#v, want summary updated", issue)
	}

	messages := nextState.RoomMessages["room-runtime"]
	if len(messages) == 0 {
		t.Fatalf("room messages = %#v, want appended guidance ledger entry", messages)
	}
	last := messages[len(messages)-1]
	if last.Role != "human" || last.Speaker != "Mina" || last.Message != nextSummary {
		t.Fatalf("last message = %#v, want appended Mina guidance", last)
	}

	topicSearch := findSearchResultByKindAndID(nextState.QuickSearchEntries, "topic", "topic-runtime")
	if topicSearch == nil || topicSearch.Summary != nextSummary {
		t.Fatalf("topic quick search = %#v, want updated topic summary", topicSearch)
	}
}

func TestUpdateTopicGuidanceRejectsMissingTopicAndBlankSummary(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, err := s.UpdateTopicGuidance("", TopicGuidanceUpdateInput{Summary: "still invalid"}); err != ErrTopicNotFound {
		t.Fatalf("missing topic error = %v, want %v", err, ErrTopicNotFound)
	}

	if _, _, err := s.UpdateTopicGuidance("topic-runtime", TopicGuidanceUpdateInput{Summary: "   "}); err != ErrTopicGuidanceRequired {
		t.Fatalf("blank summary error = %v, want %v", err, ErrTopicGuidanceRequired)
	}
}

func findTopicGuidanceRunByID(state State, runID string) *Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}

func findTopicGuidanceSessionByID(state State, sessionID string) *Session {
	for index := range state.Sessions {
		if state.Sessions[index].ID == sessionID {
			return &state.Sessions[index]
		}
	}
	return nil
}

func findTopicGuidanceIssueByRoomID(state State, roomID string) *Issue {
	for index := range state.Issues {
		if state.Issues[index].RoomID == roomID {
			return &state.Issues[index]
		}
	}
	return nil
}
