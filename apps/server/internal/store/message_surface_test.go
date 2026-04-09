package store

import (
	"path/filepath"
	"testing"
)

func TestAppendDirectMessageConversationPersistsLiveTruth(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	nextState, err := s.AppendDirectMessageConversation("dm-mina", "这条 DM 先别升级成 room。", "Larkspur")
	if err != nil {
		t.Fatalf("AppendDirectMessageConversation() error = %v", err)
	}

	messages := nextState.DirectMessageMessages["dm-mina"]
	if len(messages) < 4 {
		t.Fatalf("direct message messages = %#v, want appended human + agent reply", messages)
	}
	last := messages[len(messages)-1]
	if last.Role != "agent" || last.Speaker != "Mina" {
		t.Fatalf("last direct message = %#v, want Mina agent reply", last)
	}

	dm := findDirectMessageByID(nextState, "dm-mina")
	if dm == nil || dm.Summary != "这条 DM 先别升级成 room。" {
		t.Fatalf("direct message summary = %#v, want updated prompt summary", dm)
	}
}

func TestUpdateMessageSurfaceCollectionPersistsFollowedAndSavedTruth(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	followState, entry, err := s.UpdateMessageSurfaceCollection(MessageSurfaceCollectionUpdateInput{
		Kind:      "followed",
		ChannelID: "roadmap",
		MessageID: "msg-roadmap-1",
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("UpdateMessageSurfaceCollection(followed) error = %v", err)
	}
	if entry.ChannelID != "roadmap" || entry.MessageID != "msg-roadmap-1" {
		t.Fatalf("followed entry = %#v, want roadmap/msg-roadmap-1", entry)
	}
	if findMessageSurfaceEntryByID(followState.FollowedThreads, entry.ID) == nil {
		t.Fatalf("followed threads = %#v, want inserted entry", followState.FollowedThreads)
	}

	savedState, savedEntry, err := s.UpdateMessageSurfaceCollection(MessageSurfaceCollectionUpdateInput{
		Kind:      "saved",
		ChannelID: "dm-codex-dockmaster",
		MessageID: "msg-dm-codex-1",
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("UpdateMessageSurfaceCollection(saved) error = %v", err)
	}
	if findMessageSurfaceEntryByID(savedState.SavedLaterItems, savedEntry.ID) == nil {
		t.Fatalf("saved later items = %#v, want inserted entry", savedState.SavedLaterItems)
	}

	removedState, _, err := s.UpdateMessageSurfaceCollection(MessageSurfaceCollectionUpdateInput{
		Kind:      "followed",
		ChannelID: "all",
		MessageID: "msg-all-2",
		Enabled:   false,
	})
	if err != nil {
		t.Fatalf("UpdateMessageSurfaceCollection(remove) error = %v", err)
	}
	if findMessageSurfaceEntryByID(removedState.FollowedThreads, "followed-all-runtime") != nil {
		t.Fatalf("followed threads = %#v, want seed entry removed", removedState.FollowedThreads)
	}
}

func TestSnapshotBuildsQuickSearchEntriesForMessageSurfaces(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	snapshot := s.Snapshot()
	if findSearchResultByKindAndID(snapshot.QuickSearchEntries, "dm", "dm-mina") == nil {
		t.Fatalf("quick search entries = %#v, want dm-mina entry", snapshot.QuickSearchEntries)
	}
	if findSearchResultByKindAndID(snapshot.QuickSearchEntries, "followed", "followed-all-runtime") == nil {
		t.Fatalf("quick search entries = %#v, want followed thread entry", snapshot.QuickSearchEntries)
	}
	if findSearchResultByKindAndID(snapshot.QuickSearchEntries, "saved", "saved-roadmap-chat-first") == nil {
		t.Fatalf("quick search entries = %#v, want saved-later entry", snapshot.QuickSearchEntries)
	}
}

func findDirectMessageByID(state State, dmID string) *DirectMessage {
	for index := range state.DirectMessages {
		if state.DirectMessages[index].ID == dmID {
			return &state.DirectMessages[index]
		}
	}
	return nil
}

func findMessageSurfaceEntryByID(items []MessageSurfaceEntry, entryID string) *MessageSurfaceEntry {
	for index := range items {
		if items[index].ID == entryID {
			return &items[index]
		}
	}
	return nil
}

func findSearchResultByKindAndID(items []SearchResult, kind, entryID string) *SearchResult {
	for index := range items {
		if items[index].Kind == kind && items[index].ID == entryID {
			return &items[index]
		}
	}
	return nil
}
