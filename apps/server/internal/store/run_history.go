package store

import (
	"strconv"
	"strings"
)

const (
	defaultRunHistoryPageSize = 3
	maxRunHistoryPageSize     = 20
)

func (s *Store) RunDetail(runID string) (RunDetail, bool) {
	snapshot := s.Snapshot()

	run, ok := findRunInRunSnapshot(snapshot, runID)
	if !ok {
		return RunDetail{}, false
	}

	room, ok := findRoomInRunSnapshot(snapshot, run.RoomID)
	if !ok {
		return RunDetail{}, false
	}

	issue, ok := findIssueInRunSnapshot(snapshot, run.IssueKey)
	if !ok {
		return RunDetail{}, false
	}
	run = normalizeRunOwnerForView(snapshot, run, issue, room)

	session, _ := findSessionForRunSnapshot(snapshot, run.ID)

	return RunDetail{
		Run:           run,
		Room:          room,
		Issue:         issue,
		Session:       session,
		RecoveryAudit: buildRunRecoveryAudit(snapshot, run, session),
		History:       collectRunHistoryEntries(snapshot, run.RoomID),
	}, true
}

func (s *Store) RunHistory(limit, cursor int, roomID string) RunHistoryPage {
	snapshot := s.Snapshot()
	entries := collectRunHistoryEntries(snapshot, roomID)
	totalCount := len(entries)
	limit = normalizeRunHistoryLimit(limit)
	cursor = normalizeRunHistoryCursor(cursor, totalCount)
	end := cursor + limit
	if end > totalCount {
		end = totalCount
	}

	page := RunHistoryPage{
		Items:      entries[cursor:end],
		TotalCount: totalCount,
	}
	if end < totalCount {
		page.NextCursor = strconv.Itoa(end)
	}
	return page
}

func collectRunHistoryEntries(snapshot State, roomID string) []RunHistoryEntry {
	items := make([]RunHistoryEntry, 0, len(snapshot.Runs))
	for index := len(snapshot.Runs) - 1; index >= 0; index -= 1 {
		run := snapshot.Runs[index]
		if roomID != "" && run.RoomID != roomID {
			continue
		}

		entry, ok := buildRunHistoryEntry(snapshot, run)
		if !ok {
			continue
		}
		items = append(items, entry)
	}
	return items
}

func buildRunHistoryEntry(snapshot State, run Run) (RunHistoryEntry, bool) {
	room, ok := findRoomInRunSnapshot(snapshot, run.RoomID)
	if !ok {
		return RunHistoryEntry{}, false
	}

	issue, ok := findIssueInRunSnapshot(snapshot, run.IssueKey)
	if !ok {
		return RunHistoryEntry{}, false
	}
	run = normalizeRunOwnerForView(snapshot, run, issue, room)

	session, _ := findSessionForRunSnapshot(snapshot, run.ID)

	return RunHistoryEntry{
		Run:       run,
		Room:      room,
		Issue:     issue,
		Session:   session,
		IsCurrent: room.RunID == run.ID,
	}, true
}

func findRunInRunSnapshot(snapshot State, runID string) (Run, bool) {
	for _, item := range snapshot.Runs {
		if item.ID == runID {
			return item, true
		}
	}
	return Run{}, false
}

func findRoomInRunSnapshot(snapshot State, roomID string) (Room, bool) {
	for _, item := range snapshot.Rooms {
		if item.ID == roomID {
			return item, true
		}
	}
	return Room{}, false
}

func findIssueInRunSnapshot(snapshot State, issueKey string) (Issue, bool) {
	for _, item := range snapshot.Issues {
		if item.Key == issueKey {
			return item, true
		}
	}
	return Issue{}, false
}

func findSessionForRunSnapshot(snapshot State, runID string) (Session, bool) {
	for _, item := range snapshot.Sessions {
		if item.ActiveRunID == runID {
			return item, true
		}
	}

	run, ok := findRunInRunSnapshot(snapshot, runID)
	if !ok {
		return Session{}, false
	}

	return Session{
		ID:           defaultString(run.ID, "session-missing"),
		IssueKey:     run.IssueKey,
		RoomID:       run.RoomID,
		TopicID:      run.TopicID,
		ActiveRunID:  run.ID,
		Status:       defaultString(run.Status, "queued"),
		FollowThread: run.FollowThread,
		ControlNote:  run.ControlNote,
		Runtime:      run.Runtime,
		Machine:      run.Machine,
		Provider:     run.Provider,
		Branch:       run.Branch,
		Worktree:     run.Worktree,
		WorktreePath: run.WorktreePath,
		Summary:      defaultString(run.Summary, "补建的 Session 上下文。"),
		UpdatedAt:    run.StartedAt,
		MemoryPaths:  defaultSessionMemoryPaths(run.RoomID, run.IssueKey),
	}, true
}

func buildRunRecoveryAudit(snapshot State, run Run, session Session) RunRecoveryAudit {
	audit := RunRecoveryAudit{}

	if session.PendingTurn != nil {
		audit.Status = strings.TrimSpace(session.PendingTurn.Status)
		audit.Source = "session.pending_turn"
		audit.Summary = defaultString(strings.TrimSpace(session.ControlNote), strings.TrimSpace(session.Summary))
		audit.Preview = strings.TrimSpace(session.PendingTurn.Preview)
		audit.ResumeEligible = session.PendingTurn.ResumeEligible
	}
	if audit.Status == "" && session.Recovery != nil {
		audit.Status = strings.TrimSpace(session.Recovery.Status)
		audit.Source = "session.recovery"
		audit.Summary = strings.TrimSpace(session.Recovery.Summary)
		audit.Preview = strings.TrimSpace(session.Recovery.Preview)
		audit.SessionReplay = defaultString(strings.TrimSpace(session.Recovery.ReplayAnchor), sessionRecoveryReplayAnchor(session.ID))
	}
	if audit.Source == "session.pending_turn" {
		audit.SessionReplay = sessionRecoveryReplayAnchor(session.ID)
	}

	if followup, ok := findLatestRunRecoveryHandoffAutoFollowup(snapshot, run.RoomID); ok {
		audit.HandoffAutoFollowup = &RunRecoveryHandoffAutoFollowup{
			Kind:       strings.TrimSpace(followup.Kind),
			HandoffID:  followup.ID,
			ToAgentID:  strings.TrimSpace(followup.ToAgentID),
			ToAgent:    strings.TrimSpace(followup.ToAgent),
			Status:     strings.TrimSpace(followup.AutoFollowup.Status),
			Summary:    strings.TrimSpace(followup.AutoFollowup.Summary),
			LastAction: strings.TrimSpace(followup.LastAction),
		}
		if strings.TrimSpace(followup.Kind) == handoffKindRoomAuto {
			alias := *audit.HandoffAutoFollowup
			audit.RoomAutoFollowup = &alias
		}
	}

	if replay, ok := buildRuntimeReplayEvidence(snapshot, run.ID); ok {
		audit.RuntimeReplay = &RunRecoveryRuntimeReplay{
			ReplayAnchor:   strings.TrimSpace(replay.ReplayAnchor),
			Status:         strings.TrimSpace(replay.Status),
			Summary:        strings.TrimSpace(replay.Summary),
			LastCursor:     replay.LastCursor,
			CloseoutReason: strings.TrimSpace(replay.CloseoutReason),
		}
	}

	return audit
}

func findLatestRunRecoveryHandoffAutoFollowup(snapshot State, roomID string) (AgentHandoff, bool) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return AgentHandoff{}, false
	}
	for index := range snapshot.Mailbox {
		item := snapshot.Mailbox[index]
		if item.RoomID != roomID || !handoffKindSupportsAutoFollowup(item.Kind) || item.AutoFollowup == nil {
			continue
		}
		switch strings.TrimSpace(item.AutoFollowup.Status) {
		case "pending", "blocked", "completed":
			return item, true
		}
	}
	return AgentHandoff{}, false
}

func normalizeRunHistoryLimit(limit int) int {
	if limit <= 0 {
		return defaultRunHistoryPageSize
	}
	if limit > maxRunHistoryPageSize {
		return maxRunHistoryPageSize
	}
	return limit
}

func normalizeRunHistoryCursor(cursor, totalCount int) int {
	if cursor < 0 {
		return 0
	}
	if cursor > totalCount {
		return totalCount
	}
	return cursor
}
