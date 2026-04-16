package store

import (
	"fmt"
	"strings"
	"time"
)

const sessionRecoveryHistoryCap = 16

func recoveryWritebackShouldPreserveHumanPause(run Run, session *Session) bool {
	if strings.TrimSpace(run.Status) != runStatusPaused {
		return false
	}
	if session == nil || strings.TrimSpace(session.Status) != runStatusPaused {
		return false
	}
	return strings.Contains(strings.TrimSpace(run.NextAction), "Resume")
}

func (s *Store) roomConversationRecoverySessionLocked(runID string) *Session {
	for index := range s.state.Sessions {
		if s.state.Sessions[index].ActiveRunID == runID {
			return &s.state.Sessions[index]
		}
	}
	return nil
}

func (s *Store) applyRoomConversationRecoveryWritebackLocked(roomIndex, runIndex, issueIndex int) {
	session := s.roomConversationRecoverySessionLocked(s.state.Runs[runIndex].ID)
	if recoveryWritebackShouldPreserveHumanPause(s.state.Runs[runIndex], session) {
		s.state.Rooms[roomIndex].Topic.Status = runStatusPaused
		s.state.Issues[issueIndex].State = runStatusPaused
		return
	}
	s.state.Rooms[roomIndex].Topic.Status = "running"
	s.state.Issues[issueIndex].State = "running"
}

func sessionRecoveryReplayAnchor(sessionID string) string {
	trimmedID := strings.TrimSpace(sessionID)
	if trimmedID == "" {
		return ""
	}
	return "/v1/sessions/" + trimmedID + "/recovery"
}

func newSessionRecovery(sessionID, preview, summary, now string) *SessionRecovery {
	recovery := &SessionRecovery{
		Status:       "interrupted",
		Summary:      strings.TrimSpace(summary),
		Preview:      strings.TrimSpace(preview),
		ReplayAnchor: sessionRecoveryReplayAnchor(sessionID),
		LastSource:   "stream_disconnect",
	}
	appendSessionRecoveryEvent(recovery, "interrupted", "stream_disconnect", recovery.Summary, now)
	return recovery
}

func appendSessionRecoveryEvent(recovery *SessionRecovery, status, source, summary, occurredAt string) {
	if recovery == nil {
		return
	}
	cursor := len(recovery.Events) + 1
	recovery.Status = strings.TrimSpace(status)
	recovery.Summary = strings.TrimSpace(summary)
	recovery.LastSource = strings.TrimSpace(source)
	recovery.Events = append(recovery.Events, SessionRecoveryEvent{
		ID:         fmt.Sprintf("session-recovery-%d", time.Now().UnixNano()),
		Cursor:     cursor,
		Status:     strings.TrimSpace(status),
		Source:     strings.TrimSpace(source),
		Summary:    strings.TrimSpace(summary),
		OccurredAt: defaultString(strings.TrimSpace(occurredAt), time.Now().UTC().Format(time.RFC3339)),
	})
	if len(recovery.Events) > sessionRecoveryHistoryCap {
		recovery.Events = append([]SessionRecoveryEvent(nil), recovery.Events[len(recovery.Events)-sessionRecoveryHistoryCap:]...)
		for index := range recovery.Events {
			recovery.Events[index].Cursor = index + 1
		}
	}
}

func (s *Store) RecordRoomConversationRecoveryAttempt(roomID, source, summary string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	summary = defaultString(strings.TrimSpace(summary), "当前会话正在从中断位置继续恢复。")
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		if item.Recovery == nil {
			item.Recovery = newSessionRecovery(item.ID, "", summary, now)
		}
		item.Recovery.AttemptCount++
		item.Recovery.LastAttemptAt = now
		item.Recovery.LastError = ""
		appendSessionRecoveryEvent(item.Recovery, "retrying", strings.TrimSpace(source), summary, now)
		item.UpdatedAt = now
	})
	s.applyRoomConversationRecoveryWritebackLocked(roomIndex, runIndex, issueIndex)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) RecordRoomConversationRecoveryBlocked(roomID, source, summary string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	summary = defaultString(strings.TrimSpace(summary), "当前会话恢复被阻塞。")
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		if item.Recovery == nil {
			item.Recovery = newSessionRecovery(item.ID, "", summary, now)
		}
		item.Recovery.LastError = summary
		appendSessionRecoveryEvent(item.Recovery, "blocked", strings.TrimSpace(source), summary, now)
		item.UpdatedAt = now
	})
	s.applyRoomConversationRecoveryWritebackLocked(roomIndex, runIndex, issueIndex)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) CompleteRoomConversationRecovery(roomID, source, summary string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	summary = defaultString(strings.TrimSpace(summary), "当前会话已从中断位置继续收口。")
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		if item.Recovery == nil {
			item.Recovery = newSessionRecovery(item.ID, "", summary, now)
		}
		item.Recovery.LastRecoveredAt = now
		item.Recovery.LastError = ""
		appendSessionRecoveryEvent(item.Recovery, "recovered", strings.TrimSpace(source), summary, now)
		item.UpdatedAt = now
	})
	s.applyRoomConversationRecoveryWritebackLocked(roomIndex, runIndex, issueIndex)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) SessionRecoveryEvidence(sessionID string, afterCursor, limit int) (SessionRecoveryEvidencePacket, bool) {
	snapshot := s.Snapshot()
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return SessionRecoveryEvidencePacket{}, false
	}
	for _, session := range snapshot.Sessions {
		if session.ID != sessionID || session.Recovery == nil {
			continue
		}
		return buildSessionRecoveryEvidence(session, afterCursor, limit), true
	}
	return SessionRecoveryEvidencePacket{}, false
}

func buildSessionRecoveryEvidence(session Session, afterCursor, limit int) SessionRecoveryEvidencePacket {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	events := make([]SessionRecoveryEvent, 0, len(session.Recovery.Events))
	for _, event := range session.Recovery.Events {
		if event.Cursor <= afterCursor {
			continue
		}
		events = append(events, event)
		if len(events) == limit {
			break
		}
	}

	lastCursor := 0
	if len(session.Recovery.Events) > 0 {
		lastCursor = session.Recovery.Events[len(session.Recovery.Events)-1].Cursor
	}

	resumeEligible := false
	if session.PendingTurn != nil {
		resumeEligible = session.PendingTurn.ResumeEligible
	}

	return SessionRecoveryEvidencePacket{
		SessionID:      session.ID,
		RunID:          session.ActiveRunID,
		RoomID:         session.RoomID,
		Status:         session.Recovery.Status,
		Summary:        session.Recovery.Summary,
		Preview:        session.Recovery.Preview,
		ReplayAnchor:   defaultString(strings.TrimSpace(session.Recovery.ReplayAnchor), sessionRecoveryReplayAnchor(session.ID)),
		LastSource:     session.Recovery.LastSource,
		AttemptCount:   session.Recovery.AttemptCount,
		LastCursor:     lastCursor,
		ResumeEligible: resumeEligible,
		Events:         events,
	}
}
