package store

import (
	"fmt"
	"strings"
	"time"
)

type RuntimePublishInput struct {
	RuntimeID      string
	RunID          string
	SessionID      string
	RoomID         string
	Cursor         int
	Phase          string
	Status         string
	Summary        string
	IdempotencyKey string
	FailureAnchor  string
	CloseoutReason string
	EvidenceLines  []string
	Payload        map[string]any
	OccurredAt     string
}

type RuntimePublishResult struct {
	State        State                       `json:"state"`
	Record       RuntimePublishRecord        `json:"record"`
	Replay       RuntimeReplayEvidencePacket `json:"replay"`
	Deduped      bool                        `json:"deduped,omitempty"`
	ErrorFamily  string                      `json:"errorFamily,omitempty"`
	ErrorMessage string                      `json:"errorMessage,omitempty"`
}

type RuntimePublishPage struct {
	Items        []RuntimePublishRecord `json:"items"`
	NextSequence int                    `json:"nextSequence"`
	HasMore      bool                   `json:"hasMore"`
}

func (s *Store) PublishRuntimeEvent(input RuntimePublishInput) (RuntimePublishResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureRuntimePublishStateLocked()

	reject := func(family, message string) (RuntimePublishResult, error) {
		return RuntimePublishResult{
			State:        cloneState(s.state),
			ErrorFamily:  family,
			ErrorMessage: message,
			Replay: RuntimeReplayEvidencePacket{
				RunID:        strings.TrimSpace(input.RunID),
				ReplayAnchor: runtimeReplayAnchor(strings.TrimSpace(input.RunID)),
				Events:       []RuntimePublishRecord{},
			},
		}, nil
	}

	runtimeID := strings.TrimSpace(input.RuntimeID)
	runID := strings.TrimSpace(input.RunID)
	phase := defaultString(strings.TrimSpace(input.Phase), "status")
	status := strings.TrimSpace(input.Status)
	if runtimeID == "" {
		return reject(controlPlaneErrorFamilyBoundaryRejection, "runtimeId is required")
	}
	if runID == "" {
		return reject(controlPlaneErrorFamilyBoundaryRejection, "runId is required")
	}
	if input.Cursor <= 0 {
		return reject(controlPlaneErrorFamilyBoundaryRejection, "cursor must be greater than zero")
	}

	runIndex := -1
	for index := range s.state.Runs {
		if s.state.Runs[index].ID == runID {
			runIndex = index
			break
		}
	}
	if runIndex == -1 {
		return reject(controlPlaneErrorFamilyNotFound, fmt.Sprintf("run %s not found", runID))
	}

	sessionID := strings.TrimSpace(input.SessionID)
	if sessionID == "" {
		for index := range s.state.Sessions {
			if s.state.Sessions[index].ActiveRunID == runID {
				sessionID = s.state.Sessions[index].ID
				break
			}
		}
	}
	roomID := defaultString(strings.TrimSpace(input.RoomID), s.state.Runs[runIndex].RoomID)
	if sessionID != "" {
		for index := range s.state.Sessions {
			if s.state.Sessions[index].ID == sessionID && s.state.Sessions[index].ActiveRunID != runID {
				return reject(controlPlaneErrorFamilyConflict, fmt.Sprintf("session %s does not belong to run %s", sessionID, runID))
			}
		}
	}

	if existing := s.findRuntimePublishRecordLocked(runtimeID, runID, input.Cursor); existing != nil {
		if runtimePublishMatches(existing, input) {
			replay, _ := s.buildRuntimeReplayLocked(runID)
			return RuntimePublishResult{
				State:   cloneState(s.state),
				Record:  *existing,
				Replay:  replay,
				Deduped: true,
			}, nil
		}
		return reject(controlPlaneErrorFamilyConflict, fmt.Sprintf("cursor %d for run %s already recorded with different payload", input.Cursor, runID))
	}

	lastCursor := s.lastRuntimePublishCursorLocked(runtimeID, runID)
	if input.Cursor != lastCursor+1 {
		return reject(controlPlaneErrorFamilyConflict, fmt.Sprintf("cursor gap for run %s: got %d, want %d", runID, input.Cursor, lastCursor+1))
	}

	record := RuntimePublishRecord{
		ID:             fmt.Sprintf("rt-publish-%d", time.Now().UnixNano()),
		RuntimeID:      runtimeID,
		RunID:          runID,
		SessionID:      sessionID,
		RoomID:         roomID,
		Sequence:       s.state.RuntimePublish.NextSequence,
		Cursor:         input.Cursor,
		Phase:          phase,
		Status:         defaultString(status, s.state.Runs[runIndex].Status),
		Summary:        defaultString(strings.TrimSpace(input.Summary), "runtime publish event recorded"),
		IdempotencyKey: strings.TrimSpace(input.IdempotencyKey),
		FailureAnchor:  strings.TrimSpace(input.FailureAnchor),
		CloseoutReason: strings.TrimSpace(input.CloseoutReason),
		EvidenceLines:  normalizeRuntimePublishLines(input.EvidenceLines),
		Payload:        clonePayloadMap(input.Payload),
		OccurredAt:     defaultString(strings.TrimSpace(input.OccurredAt), time.Now().UTC().Format(time.RFC3339)),
	}
	s.state.RuntimePublish.NextSequence++
	s.state.RuntimePublish.Records = append(s.state.RuntimePublish.Records, record)
	s.applyRuntimePublishToStateLocked(record)

	if err := s.persistLocked(); err != nil {
		return RuntimePublishResult{}, err
	}
	replay, _ := s.buildRuntimeReplayLocked(runID)
	return RuntimePublishResult{
		State:  cloneState(s.state),
		Record: record,
		Replay: replay,
	}, nil
}

func (s *Store) RuntimePublishRecords(afterSequence, limit int, runID, runtimeID string) RuntimePublishPage {
	snapshot := s.Snapshot().RuntimePublish
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	runID = strings.TrimSpace(runID)
	runtimeID = strings.TrimSpace(runtimeID)
	items := make([]RuntimePublishRecord, 0, limit)
	for _, item := range snapshot.Records {
		if item.Sequence <= afterSequence {
			continue
		}
		if runID != "" && item.RunID != runID {
			continue
		}
		if runtimeID != "" && item.RuntimeID != runtimeID {
			continue
		}
		items = append(items, item)
		if len(items) == limit {
			break
		}
	}
	nextSequence := afterSequence
	if len(items) > 0 {
		nextSequence = items[len(items)-1].Sequence
	}
	hasMore := false
	for _, item := range snapshot.Records {
		if item.Sequence > nextSequence {
			if runID != "" && item.RunID != runID {
				continue
			}
			if runtimeID != "" && item.RuntimeID != runtimeID {
				continue
			}
			hasMore = true
			break
		}
	}
	return RuntimePublishPage{
		Items:        items,
		NextSequence: nextSequence,
		HasMore:      hasMore,
	}
}

func (s *Store) RuntimeReplayEvidence(runID string) (RuntimeReplayEvidencePacket, bool) {
	snapshot := s.Snapshot()
	return buildRuntimeReplayEvidence(snapshot, strings.TrimSpace(runID))
}

func (s *Store) ensureRuntimePublishStateLocked() {
	if s.state.RuntimePublish.Records == nil {
		s.state.RuntimePublish.Records = []RuntimePublishRecord{}
	}
	if s.state.RuntimePublish.NextSequence <= 0 {
		s.state.RuntimePublish.NextSequence = 1
	}
}

func (s *Store) findRuntimePublishRecordLocked(runtimeID, runID string, cursor int) *RuntimePublishRecord {
	for index := range s.state.RuntimePublish.Records {
		item := &s.state.RuntimePublish.Records[index]
		if item.RuntimeID == runtimeID && item.RunID == runID && item.Cursor == cursor {
			return item
		}
	}
	return nil
}

func (s *Store) lastRuntimePublishCursorLocked(runtimeID, runID string) int {
	last := 0
	for _, item := range s.state.RuntimePublish.Records {
		if item.RuntimeID == runtimeID && item.RunID == runID && item.Cursor > last {
			last = item.Cursor
		}
	}
	return last
}

func runtimePublishMatches(existing *RuntimePublishRecord, input RuntimePublishInput) bool {
	if existing == nil {
		return false
	}
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if idempotencyKey != "" && existing.IdempotencyKey == idempotencyKey {
		return true
	}
	return existing.Phase == defaultString(strings.TrimSpace(input.Phase), "status") &&
		existing.Status == strings.TrimSpace(input.Status) &&
		existing.Summary == defaultString(strings.TrimSpace(input.Summary), "runtime publish event recorded") &&
		existing.FailureAnchor == strings.TrimSpace(input.FailureAnchor) &&
		existing.CloseoutReason == strings.TrimSpace(input.CloseoutReason)
}

func (s *Store) applyRuntimePublishToStateLocked(record RuntimePublishRecord) {
	runIndex := -1
	for index := range s.state.Runs {
		if s.state.Runs[index].ID == record.RunID {
			runIndex = index
			break
		}
	}
	if runIndex == -1 {
		return
	}

	run := &s.state.Runs[runIndex]
	nowClock := shortClock()
	run.Status = normalizePublishedRunStatus(record.Status, run.Status)
	run.Summary = defaultString(strings.TrimSpace(record.Summary), run.Summary)
	if strings.TrimSpace(record.CloseoutReason) != "" {
		run.NextAction = record.CloseoutReason
	}
	run.Stdout = append(run.Stdout, fmt.Sprintf("[%s] publish#%d %s: %s", nowClock, record.Cursor, record.Phase, record.Summary))
	if strings.TrimSpace(record.FailureAnchor) != "" {
		run.Stderr = append(run.Stderr, fmt.Sprintf("[%s] failure anchor: %s", nowClock, record.FailureAnchor))
	}
	run.Timeline = append(run.Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-publish-%d", run.ID, record.Sequence),
		Label: fmt.Sprintf("publish#%d %s", record.Cursor, record.Phase),
		At:    nowClock,
		Tone:  runtimePublishTimelineTone(record),
	})

	for index := range s.state.Sessions {
		if s.state.Sessions[index].ActiveRunID != record.RunID {
			continue
		}
		s.state.Sessions[index].Status = run.Status
		s.state.Sessions[index].Summary = run.Summary
		if strings.TrimSpace(record.CloseoutReason) != "" {
			s.state.Sessions[index].ControlNote = record.CloseoutReason
		}
		s.state.Sessions[index].UpdatedAt = record.OccurredAt
		break
	}

	roomIndex, _, issueIndex, ok := s.findRoomRunIssueLocked(run.RoomID)
	if ok {
		s.state.Rooms[roomIndex].Topic.Status = run.Status
		s.state.Rooms[roomIndex].Topic.Summary = run.Summary
		s.state.Issues[issueIndex].State = run.Status
	}
}

func (s *Store) buildRuntimeReplayLocked(runID string) (RuntimeReplayEvidencePacket, bool) {
	return buildRuntimeReplayEvidence(s.state, strings.TrimSpace(runID))
}

func buildRuntimeReplayEvidence(state State, runID string) (RuntimeReplayEvidencePacket, bool) {
	if runID == "" {
		return RuntimeReplayEvidencePacket{}, false
	}
	events := make([]RuntimePublishRecord, 0, len(state.RuntimePublish.Records))
	for _, item := range state.RuntimePublish.Records {
		if item.RunID == runID {
			events = append(events, item)
		}
	}
	if len(events) == 0 {
		return RuntimeReplayEvidencePacket{}, false
	}
	last := events[len(events)-1]
	packet := RuntimeReplayEvidencePacket{
		RunID:          runID,
		SessionID:      last.SessionID,
		RoomID:         last.RoomID,
		RuntimeID:      last.RuntimeID,
		LastCursor:     last.Cursor,
		Status:         last.Status,
		Summary:        last.Summary,
		FailureAnchor:  last.FailureAnchor,
		CloseoutReason: last.CloseoutReason,
		ReplayAnchor:   runtimeReplayAnchor(runID),
		Events:         events,
	}
	if run := findRunSnapshotByID(state, runID); run != nil {
		packet.Status = defaultString(packet.Status, run.Status)
		if strings.TrimSpace(packet.Summary) == "" {
			packet.Summary = run.Summary
		}
		if strings.TrimSpace(packet.CloseoutReason) == "" {
			packet.CloseoutReason = run.NextAction
		}
	}
	return packet, true
}

func runtimeReplayAnchor(runID string) string {
	return "/v1/runtime/publish/replay?runId=" + runID
}

func normalizePublishedRunStatus(nextStatus, fallback string) string {
	switch strings.TrimSpace(nextStatus) {
	case "queued", "running", "paused", "blocked", "review", "done":
		return strings.TrimSpace(nextStatus)
	default:
		return fallback
	}
}

func runtimePublishTimelineTone(record RuntimePublishRecord) string {
	switch normalizePublishedRunStatus(record.Status, "") {
	case "done", "review":
		return "lime"
	case "blocked":
		return "pink"
	default:
		return "yellow"
	}
}

func normalizeRuntimePublishLines(lines []string) []string {
	if len(lines) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		normalized = append(normalized, line)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}
