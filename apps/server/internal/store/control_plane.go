package store

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	controlPlaneCommandStatusPending   = "pending"
	controlPlaneCommandStatusCommitted = "committed"
	controlPlaneCommandStatusRejected  = "rejected"

	controlPlaneErrorFamilyNotFound          = "not_found"
	controlPlaneErrorFamilyConflict          = "conflict"
	controlPlaneErrorFamilyBoundaryRejection = "boundary_rejection"
	controlPlaneErrorFamilyInternal          = "internal"
)

type ControlPlaneCommandInput struct {
	Kind             string
	IdempotencyKey   string
	Actor            string
	Payload          map[string]any
	IssueCreate      *CreateIssueInput
	RunControl       *ControlPlaneRunControlInput
	RuntimeSelection *ControlPlaneRuntimeSelectionInput
}

type ControlPlaneRunControlInput struct {
	RunID  string
	Action string
	Note   string
}

type ControlPlaneRuntimeSelectionInput struct {
	Machine string
}

type ControlPlaneCommandResult struct {
	State     State                  `json:"state"`
	Command   ControlPlaneCommand    `json:"command"`
	Events    []ControlPlaneEvent    `json:"events,omitempty"`
	Rejection *ControlPlaneRejection `json:"rejection,omitempty"`
	Deduped   bool                   `json:"deduped,omitempty"`
}

type ControlPlaneEventsPage struct {
	Items      []ControlPlaneEvent `json:"items"`
	NextCursor int                 `json:"nextCursor"`
	HasMore    bool                `json:"hasMore"`
}

type ControlPlaneRejectionsPage struct {
	Items []ControlPlaneRejection `json:"items"`
}

type ControlPlaneCommandDebugView struct {
	Command   ControlPlaneCommand    `json:"command"`
	Events    []ControlPlaneEvent    `json:"events"`
	Rejection *ControlPlaneRejection `json:"rejection,omitempty"`
}

type controlPlaneApplySuccess struct {
	EventKind     string
	Summary       string
	AggregateKind string
	AggregateID   string
	AggregateHref string
}

func (s *Store) SubmitControlPlaneCommand(input ControlPlaneCommandInput) (ControlPlaneCommandResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureControlPlaneStateLocked()

	kind := strings.TrimSpace(input.Kind)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	actor := defaultString(strings.TrimSpace(input.Actor), "Control Plane")
	if kind == "" {
		return s.rejectControlPlaneBoundaryLocked(kind, idempotencyKey, actor, input.Payload, "command kind is required")
	}
	if idempotencyKey == "" {
		return s.rejectControlPlaneBoundaryLocked(kind, idempotencyKey, actor, input.Payload, "idempotencyKey is required")
	}

	if existing := s.findControlPlaneCommandByIdempotencyLocked(kind, idempotencyKey); existing != nil {
		return s.buildControlPlaneResultLocked(existing.ID, true), nil
	}

	command := ControlPlaneCommand{
		ID:             fmt.Sprintf("cp-%d", time.Now().UnixNano()),
		Kind:           kind,
		Status:         controlPlaneCommandStatusPending,
		IdempotencyKey: idempotencyKey,
		Actor:          actor,
		Payload:        clonePayloadMap(input.Payload),
		RequestedAt:    time.Now().UTC().Format(time.RFC3339),
		Debug: []ControlPlaneDebugEntry{
			{
				ID:         fmt.Sprintf("cp-debug-%d", time.Now().UnixNano()),
				Stage:      "received",
				Summary:    "command accepted at versioned /v1 boundary and queued for apply",
				OccurredAt: time.Now().UTC().Format(time.RFC3339),
			},
		},
	}

	before := cloneStoredState(s.state)
	s.state.ControlPlane.Commands = append(s.state.ControlPlane.Commands, command)
	commandIndex := len(s.state.ControlPlane.Commands) - 1

	applyResult, err := s.applyControlPlaneCommandLocked(input)
	if err != nil {
		family, known := controlPlaneErrorFamily(kind, err)
		if !known {
			family = controlPlaneErrorFamilyInternal
		}
		reason := err.Error()
		s.state = before
		s.ensureControlPlaneStateLocked()
		s.state.ControlPlane.Commands = append(s.state.ControlPlane.Commands, command)
		commandIndex = len(s.state.ControlPlane.Commands) - 1
		s.finalizeRejectedControlPlaneCommandLocked(commandIndex, family, reason)
		if persistErr := s.persistLocked(); persistErr != nil {
			return ControlPlaneCommandResult{}, persistErr
		}
		return s.buildControlPlaneResultLocked(command.ID, false), nil
	}

	s.finalizeCommittedControlPlaneCommandLocked(commandIndex, applyResult)
	if persistErr := s.persistLocked(); persistErr != nil {
		return ControlPlaneCommandResult{}, persistErr
	}
	return s.buildControlPlaneResultLocked(command.ID, false), nil
}

func (s *Store) ControlPlaneEvents(afterCursor, limit int) ControlPlaneEventsPage {
	snapshot := s.Snapshot().ControlPlane
	return buildControlPlaneEventsPage(snapshot.Events, afterCursor, limit)
}

func (s *Store) ControlPlaneRejections(commandID, family string, limit int) ControlPlaneRejectionsPage {
	snapshot := s.Snapshot().ControlPlane
	commandID = strings.TrimSpace(commandID)
	family = strings.TrimSpace(family)
	items := make([]ControlPlaneRejection, 0, len(snapshot.Rejections))
	for _, item := range snapshot.Rejections {
		if commandID != "" && item.CommandID != commandID {
			continue
		}
		if family != "" && item.Family != family {
			continue
		}
		items = append(items, item)
	}
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return ControlPlaneRejectionsPage{Items: items}
}

func (s *Store) ControlPlaneCommandDebug(commandID string) (ControlPlaneCommandDebugView, bool) {
	snapshot := s.Snapshot().ControlPlane
	for _, command := range snapshot.Commands {
		if command.ID != strings.TrimSpace(commandID) {
			continue
		}
		view := ControlPlaneCommandDebugView{
			Command: command,
			Events:  controlPlaneEventsForCommand(snapshot.Events, command.ID),
		}
		if rejection := controlPlaneRejectionForCommand(snapshot.Rejections, command.ID); rejection != nil {
			copyRejection := *rejection
			view.Rejection = &copyRejection
		}
		return view, true
	}
	return ControlPlaneCommandDebugView{}, false
}

func (s *Store) ensureControlPlaneStateLocked() {
	if s.state.ControlPlane.Commands == nil {
		s.state.ControlPlane.Commands = []ControlPlaneCommand{}
	}
	if s.state.ControlPlane.Events == nil {
		s.state.ControlPlane.Events = []ControlPlaneEvent{}
	}
	if s.state.ControlPlane.Rejections == nil {
		s.state.ControlPlane.Rejections = []ControlPlaneRejection{}
	}
	if s.state.ControlPlane.NextEventCursor <= 0 {
		s.state.ControlPlane.NextEventCursor = 1
	}
}

func (s *Store) rejectControlPlaneBoundaryLocked(kind, idempotencyKey, actor string, payload map[string]any, reason string) (ControlPlaneCommandResult, error) {
	command := ControlPlaneCommand{
		ID:             fmt.Sprintf("cp-%d", time.Now().UnixNano()),
		Kind:           strings.TrimSpace(kind),
		Status:         controlPlaneCommandStatusRejected,
		IdempotencyKey: strings.TrimSpace(idempotencyKey),
		Actor:          actor,
		Payload:        clonePayloadMap(payload),
		RequestedAt:    time.Now().UTC().Format(time.RFC3339),
		Debug: []ControlPlaneDebugEntry{
			{
				ID:         fmt.Sprintf("cp-debug-%d", time.Now().UnixNano()),
				Stage:      "received",
				Summary:    "command rejected at boundary before touching live state",
				OccurredAt: time.Now().UTC().Format(time.RFC3339),
			},
		},
	}
	s.state.ControlPlane.Commands = append(s.state.ControlPlane.Commands, command)
	commandIndex := len(s.state.ControlPlane.Commands) - 1
	s.finalizeRejectedControlPlaneCommandLocked(commandIndex, controlPlaneErrorFamilyBoundaryRejection, reason)
	if err := s.persistLocked(); err != nil {
		return ControlPlaneCommandResult{}, err
	}
	return s.buildControlPlaneResultLocked(command.ID, false), nil
}

func (s *Store) applyControlPlaneCommandLocked(input ControlPlaneCommandInput) (controlPlaneApplySuccess, error) {
	switch strings.TrimSpace(input.Kind) {
	case "issue.create":
		if input.IssueCreate == nil {
			return controlPlaneApplySuccess{}, errors.New("issue.create payload is required")
		}
		created, err := s.createIssueLocked(*input.IssueCreate)
		if err != nil {
			return controlPlaneApplySuccess{}, err
		}
		roomIndex, _, issueIndex, ok := s.findRoomRunIssueLocked(created.RoomID)
		if !ok {
			return controlPlaneApplySuccess{}, fmt.Errorf("created issue room %s not found", created.RoomID)
		}
		issue := s.state.Issues[issueIndex]
		room := s.state.Rooms[roomIndex]
		return controlPlaneApplySuccess{
			EventKind:     "issue.created",
			Summary:       fmt.Sprintf("%s created %s and linked %s / %s", issue.Title, issue.Key, room.ID, created.RunID),
			AggregateKind: "issue",
			AggregateID:   issue.Key,
			AggregateHref: "/v1/issues",
		}, nil
	case "run.control":
		if input.RunControl == nil {
			return controlPlaneApplySuccess{}, errors.New("run.control payload is required")
		}
		if _, err := s.controlRunLocked(strings.TrimSpace(input.RunControl.RunID), RunControlInput{
			Action: strings.TrimSpace(input.RunControl.Action),
			Note:   strings.TrimSpace(input.RunControl.Note),
			Actor:  defaultString(strings.TrimSpace(input.Actor), "Control Plane"),
		}); err != nil {
			return controlPlaneApplySuccess{}, err
		}
		run := findRunSnapshotByID(s.state, strings.TrimSpace(input.RunControl.RunID))
		if run == nil {
			return controlPlaneApplySuccess{}, fmt.Errorf("run %s not found after control apply", input.RunControl.RunID)
		}
		return controlPlaneApplySuccess{
			EventKind:     "run.controlled",
			Summary:       fmt.Sprintf("%s moved to %s via %s", run.ID, run.Status, strings.TrimSpace(input.RunControl.Action)),
			AggregateKind: "run",
			AggregateID:   run.ID,
			AggregateHref: "/v1/runs/" + run.ID,
		}, nil
	case "runtime.selection.set":
		if input.RuntimeSelection == nil {
			return controlPlaneApplySuccess{}, errors.New("runtime.selection.set payload is required")
		}
		if _, err := s.selectRuntimeLocked(strings.TrimSpace(input.RuntimeSelection.Machine)); err != nil {
			return controlPlaneApplySuccess{}, err
		}
		return controlPlaneApplySuccess{
			EventKind:     "runtime.selected",
			Summary:       fmt.Sprintf("paired runtime moved to %s", s.state.Workspace.PairedRuntime),
			AggregateKind: "runtime",
			AggregateID:   s.state.Workspace.PairedRuntime,
			AggregateHref: "/v1/runtime/selection",
		}, nil
	default:
		return controlPlaneApplySuccess{}, fmt.Errorf("unsupported control-plane command %s", input.Kind)
	}
}

func (s *Store) finalizeCommittedControlPlaneCommandLocked(commandIndex int, result controlPlaneApplySuccess) {
	command := &s.state.ControlPlane.Commands[commandIndex]
	command.Status = controlPlaneCommandStatusCommitted
	command.Summary = result.Summary
	command.AggregateKind = result.AggregateKind
	command.AggregateID = result.AggregateID
	command.AggregateHref = result.AggregateHref
	command.AppliedAt = time.Now().UTC().Format(time.RFC3339)
	command.ReplayAnchor = "/v1/control-plane/debug/commands/" + command.ID
	command.Debug = append(command.Debug, ControlPlaneDebugEntry{
		ID:         fmt.Sprintf("cp-debug-%d", time.Now().UnixNano()),
		Stage:      "applied",
		Summary:    result.Summary,
		OccurredAt: time.Now().UTC().Format(time.RFC3339),
	})
	event := s.appendControlPlaneEventLocked(ControlPlaneEvent{
		CommandID:     command.ID,
		Kind:          result.EventKind,
		Status:        controlPlaneCommandStatusCommitted,
		AggregateKind: result.AggregateKind,
		AggregateID:   result.AggregateID,
		Summary:       result.Summary,
		ReplayAnchor:  command.ReplayAnchor,
		OccurredAt:    time.Now().UTC().Format(time.RFC3339),
	})
	command.EventCursorStart = event.Cursor
	command.EventCursorEnd = event.Cursor
}

func (s *Store) finalizeRejectedControlPlaneCommandLocked(commandIndex int, family, reason string) {
	command := &s.state.ControlPlane.Commands[commandIndex]
	command.Status = controlPlaneCommandStatusRejected
	command.ErrorFamily = family
	command.ErrorMessage = reason
	command.Summary = reason
	command.AppliedAt = time.Now().UTC().Format(time.RFC3339)
	command.ReplayAnchor = "/v1/control-plane/debug/commands/" + command.ID
	command.Debug = append(command.Debug, ControlPlaneDebugEntry{
		ID:         fmt.Sprintf("cp-debug-%d", time.Now().UnixNano()),
		Stage:      "rejected",
		Summary:    fmt.Sprintf("%s: %s", family, reason),
		OccurredAt: time.Now().UTC().Format(time.RFC3339),
	})
	event := s.appendControlPlaneEventLocked(ControlPlaneEvent{
		CommandID:    command.ID,
		Kind:         "command.rejected",
		Status:       controlPlaneCommandStatusRejected,
		Summary:      reason,
		ReplayAnchor: command.ReplayAnchor,
		ErrorFamily:  family,
		OccurredAt:   time.Now().UTC().Format(time.RFC3339),
	})
	command.EventCursorStart = event.Cursor
	command.EventCursorEnd = event.Cursor
	s.state.ControlPlane.Rejections = append([]ControlPlaneRejection{{
		ID:           fmt.Sprintf("cp-rejection-%d", time.Now().UnixNano()),
		CommandID:    command.ID,
		Family:       family,
		Summary:      reason,
		Reason:       reason,
		ReplayAnchor: command.ReplayAnchor,
		OccurredAt:   time.Now().UTC().Format(time.RFC3339),
	}}, s.state.ControlPlane.Rejections...)
}

func (s *Store) appendControlPlaneEventLocked(event ControlPlaneEvent) ControlPlaneEvent {
	if s.state.ControlPlane.NextEventCursor <= 0 {
		s.state.ControlPlane.NextEventCursor = 1
	}
	event.Cursor = s.state.ControlPlane.NextEventCursor
	s.state.ControlPlane.NextEventCursor++
	s.state.ControlPlane.Events = append(s.state.ControlPlane.Events, event)
	return event
}

func (s *Store) buildControlPlaneResultLocked(commandID string, deduped bool) ControlPlaneCommandResult {
	command := findControlPlaneCommandByID(s.state.ControlPlane.Commands, commandID)
	result := ControlPlaneCommandResult{
		State:   cloneState(s.state),
		Deduped: deduped,
	}
	if command != nil {
		result.Command = *command
		result.Events = controlPlaneEventsForCommand(s.state.ControlPlane.Events, commandID)
		if rejection := controlPlaneRejectionForCommand(s.state.ControlPlane.Rejections, commandID); rejection != nil {
			copyRejection := *rejection
			result.Rejection = &copyRejection
		}
	}
	return result
}

func (s *Store) findControlPlaneCommandByIdempotencyLocked(kind, idempotencyKey string) *ControlPlaneCommand {
	for index := range s.state.ControlPlane.Commands {
		item := &s.state.ControlPlane.Commands[index]
		if item.Kind == kind && item.IdempotencyKey == idempotencyKey {
			return item
		}
	}
	return nil
}

func buildControlPlaneEventsPage(events []ControlPlaneEvent, afterCursor, limit int) ControlPlaneEventsPage {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	items := make([]ControlPlaneEvent, 0, limit)
	for _, item := range events {
		if item.Cursor <= afterCursor {
			continue
		}
		items = append(items, item)
		if len(items) == limit {
			break
		}
	}
	nextCursor := afterCursor
	if len(items) > 0 {
		nextCursor = items[len(items)-1].Cursor
	}
	hasMore := false
	if len(items) > 0 && nextCursor < events[len(events)-1].Cursor {
		hasMore = true
	}
	return ControlPlaneEventsPage{
		Items:      items,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}
}

func controlPlaneErrorFamily(kind string, err error) (string, bool) {
	switch strings.TrimSpace(kind) {
	case "issue.create":
		switch {
		case errors.Is(err, ErrNoSchedulableRuntime):
			return controlPlaneErrorFamilyConflict, true
		case strings.Contains(strings.ToLower(err.Error()), "required"):
			return controlPlaneErrorFamilyBoundaryRejection, true
		}
	case "run.control":
		switch {
		case errors.Is(err, ErrRunControlRunNotFound):
			return controlPlaneErrorFamilyNotFound, true
		case errors.Is(err, ErrRunControlImmutableFinalStatus):
			return controlPlaneErrorFamilyConflict, true
		case errors.Is(err, ErrRunControlUnsupportedAction), errors.Is(err, ErrRunControlSessionNotFound):
			return controlPlaneErrorFamilyBoundaryRejection, true
		}
	case "runtime.selection.set":
		text := strings.ToLower(err.Error())
		switch {
		case strings.Contains(text, "not found"):
			return controlPlaneErrorFamilyNotFound, true
		case strings.Contains(text, "offline"), strings.Contains(text, "not paired"):
			return controlPlaneErrorFamilyConflict, true
		case strings.Contains(text, "required"):
			return controlPlaneErrorFamilyBoundaryRejection, true
		}
	default:
		if strings.Contains(strings.ToLower(err.Error()), "unsupported control-plane command") {
			return controlPlaneErrorFamilyBoundaryRejection, true
		}
	}
	return "", false
}

func controlPlaneEventsForCommand(items []ControlPlaneEvent, commandID string) []ControlPlaneEvent {
	events := make([]ControlPlaneEvent, 0, 2)
	for _, item := range items {
		if item.CommandID == commandID {
			events = append(events, item)
		}
	}
	return events
}

func controlPlaneRejectionForCommand(items []ControlPlaneRejection, commandID string) *ControlPlaneRejection {
	for index := range items {
		if items[index].CommandID == commandID {
			return &items[index]
		}
	}
	return nil
}

func findControlPlaneCommandByID(items []ControlPlaneCommand, commandID string) *ControlPlaneCommand {
	for index := range items {
		if items[index].ID == commandID {
			return &items[index]
		}
	}
	return nil
}

func findRunSnapshotByID(state State, runID string) *Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}

func clonePayloadMap(payload map[string]any) map[string]any {
	if len(payload) == 0 {
		return nil
	}
	clone := make(map[string]any, len(payload))
	for key, value := range payload {
		clone[key] = value
	}
	return clone
}
