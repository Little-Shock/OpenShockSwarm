package store

import (
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"openshock/backend/internal/core"
)

var ErrNotFound = errors.New("not found")

type MemoryStore struct {
	mu                  sync.RWMutex
	workspace           core.Workspace
	defaultRoomID       string
	defaultIssueID      string
	rooms               []core.RoomSummary
	channel             core.RoomChannel
	agents              []core.Agent
	runtimes            []core.Runtime
	issues              []core.Issue
	messagesByRoom      map[string][]core.Message
	agentSessions       []core.AgentSession
	agentTurns          []core.AgentTurn
	agentWaits          []core.AgentWait
	handoffRecords      []core.HandoffRecord
	tasks               []core.Task
	runs                []core.Run
	runOutputChunks     []core.RunOutputChunk
	toolCalls           []core.ToolCall
	mergeAttempts       []core.MergeAttempt
	integrationBranches []core.IntegrationBranch
	deliveryPRs         []core.DeliveryPR
	inboxItems          []core.InboxItem
	repoWebhookEvents   map[string]core.RepoWebhookResponse
	nextMessageID       int
	nextTaskID          int
	nextRunID           int
	nextRunOutputID     int
	nextToolCallID      int
	nextMergeAttemptID  int
	nextRuntimeID       int
	nextIssueID         int
	nextRoomID          int
	nextInboxID         int
	nextActionID        int
	nextAgentSessionID  int
	nextAgentTurnID     int
	nextAgentWaitID     int
	nextHandoffID       int
	nextWorkspaceRepoID int
	actionResults       map[string]core.ActionResponse
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		workspace:      core.SeedWorkspace(),
		defaultRoomID:  "room_001",
		defaultIssueID: "issue_101",
		rooms:          core.SeedRooms(),
		channel:        core.RoomChannel{ID: "room_channel_default", RoomID: "room_001", Name: "chat"},
		agents:         core.SeedAgents(),
		runtimes:       core.SeedRuntimes(),
		issues:         core.SeedIssues(),
		messagesByRoom: map[string][]core.Message{
			"room_001": {
				{
					ID:        "msg_announcement_001",
					ActorType: "system",
					ActorName: "OpenShock",
					Kind:      "summary",
					Body:      "Workspace initialized. Use this room for cross-team announcements and decisions that everyone should see.",
					CreatedAt: "2026-04-05T07:40:00Z",
				},
			},
			"room_002": {
				{
					ID:        "msg_roadmap_001",
					ActorType: "system",
					ActorName: "OpenShock",
					Kind:      "summary",
					Body:      "Track roadmap direction here: milestones, sequencing, and scope changes across issues.",
					CreatedAt: "2026-04-05T07:45:00Z",
				},
			},
			"room_101": core.SeedMessages(),
			"room_102": {},
			"room_103": {},
		},
		agentSessions:       []core.AgentSession{},
		agentTurns:          []core.AgentTurn{},
		agentWaits:          []core.AgentWait{},
		handoffRecords:      []core.HandoffRecord{},
		tasks:               core.SeedTasks(),
		runs:                core.SeedRuns(),
		runOutputChunks:     []core.RunOutputChunk{},
		toolCalls:           []core.ToolCall{},
		mergeAttempts:       []core.MergeAttempt{},
		integrationBranches: core.SeedIntegrationBranches(),
		deliveryPRs:         core.SeedDeliveryPRs(),
		inboxItems:          core.SeedInboxItems(),
		repoWebhookEvents:   map[string]core.RepoWebhookResponse{},
		nextMessageID:       100,
		nextTaskID:          100,
		nextRunID:           100,
		nextRunOutputID:     100,
		nextToolCallID:      100,
		nextMergeAttemptID:  100,
		nextRuntimeID:       100,
		nextIssueID:         103,
		nextRoomID:          103,
		nextInboxID:         100,
		nextActionID:        100,
		nextAgentSessionID:  100,
		nextAgentTurnID:     100,
		nextAgentWaitID:     100,
		nextHandoffID:       100,
		nextWorkspaceRepoID: 100,
		actionResults:       map[string]core.ActionResponse{},
	}
}

func (s *MemoryStore) BindWorkspaceRepo(workspaceID, repoPath, label string, makeDefault bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if workspaceID != s.workspace.ID {
		return ErrNotFound
	}

	_, err := s.bindWorkspaceRepoLocked(repoPath, label, makeDefault)
	return err
}

func (s *MemoryStore) BindWorkspaceRepoAction(workspaceID, repoPath, label string, makeDefault bool, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if workspaceID != s.workspace.ID {
		return core.ActionResponse{}, ErrNotFound
	}

	binding, err := s.bindWorkspaceRepoLocked(repoPath, label, makeDefault)
	if err != nil {
		return core.ActionResponse{}, err
	}

	actorName := strings.TrimSpace(actorID)
	if actorName == "" {
		actorName = "someone"
	}
	if defaultBinding, ok := s.defaultWorkspaceRepoBindingLocked(); ok {
		s.appendSystemMessageLocked(
			s.defaultRoomID,
			"summary",
			fmt.Sprintf("%s set workspace default repo to %s.", actorName, defaultBinding.RepoPath),
		)
	}

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "workspace_repo_bound",
		ResultMessage: "Workspace repo binding updated.",
		AffectedEntities: []core.ActionEntity{
			{Type: "workspace", ID: s.workspace.ID},
			{Type: "workspace_repo_binding", ID: binding.ID},
		},
	}, nil
}

func (s *MemoryStore) NextActionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextActionID++
	return fmt.Sprintf("action_%03d", s.nextActionID)
}

func (s *MemoryStore) WorkspaceID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.workspace.ID
}

func (s *MemoryStore) Bootstrap() core.BootstrapResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	issueSummaries := make([]core.IssueSummary, 0, len(s.issues))
	for _, issue := range s.issues {
		issueSummaries = append(issueSummaries, core.IssueSummary{
			ID: issue.ID, Title: issue.Title, Status: issue.Status,
		})
	}

	return core.BootstrapResponse{
		Workspace:      s.workspaceSnapshotLocked(),
		DefaultRoomID:  s.defaultRoomID,
		DefaultIssueID: s.defaultIssueID,
		Rooms:          slices.Clone(s.rooms),
		Agents:         slices.Clone(s.agents),
		Runtimes:       slices.Clone(s.runtimes),
		IssueSummaries: issueSummaries,
	}
}

func (s *MemoryStore) LookupActionResult(idempotencyKey string) (core.ActionResponse, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	resp, ok := s.actionResults[idempotencyKey]
	return resp, ok
}

func (s *MemoryStore) SaveActionResult(idempotencyKey string, resp core.ActionResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.actionResults[idempotencyKey] = resp
}

func (s *MemoryStore) IssueDetail(issueID string) (core.IssueDetailResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	issue, ok := s.findIssue(issueID)
	if !ok {
		return core.IssueDetailResponse{}, ErrNotFound
	}

	room, ok := s.findRoomByIssue(issueID)
	if !ok {
		return core.IssueDetailResponse{}, ErrNotFound
	}

	return core.IssueDetailResponse{
		Workspace:         s.workspaceSnapshotLocked(),
		Issue:             issue,
		Room:              room,
		Channel:           core.RoomChannel{ID: "channel_" + room.ID, RoomID: room.ID, Name: "chat"},
		Messages:          slices.Clone(s.messagesByRoom[room.ID]),
		AgentSessions:     s.agentSessionsForRoom(room.ID),
		AgentTurns:        s.agentTurnsForRoom(room.ID),
		AgentWaits:        s.agentWaitsForRoom(room.ID),
		HandoffRecords:    s.handoffRecordsForRoom(room.ID),
		Tasks:             s.tasksForIssue(issueID),
		Runs:              s.runsForIssue(issueID),
		RunOutputChunks:   s.runOutputChunksForIssue(issueID),
		ToolCalls:         s.toolCallsForIssue(issueID),
		MergeAttempts:     s.mergeAttemptsForIssue(issueID),
		IntegrationBranch: s.integrationForIssue(issueID),
		DeliveryPR:        s.deliveryPRForIssue(issueID),
	}, nil
}

func (s *MemoryStore) RoomDetail(roomID string) (core.RoomDetailResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	room, ok := s.findRoomByIDLocked(roomID)
	if !ok {
		return core.RoomDetailResponse{}, ErrNotFound
	}

	response := core.RoomDetailResponse{
		Workspace:       s.workspaceSnapshotLocked(),
		Room:            room,
		Channel:         core.RoomChannel{ID: "channel_" + room.ID, RoomID: room.ID, Name: "chat"},
		Messages:        slices.Clone(s.messagesByRoom[room.ID]),
		AgentSessions:   s.agentSessionsForRoom(room.ID),
		AgentTurns:      s.agentTurnsForRoom(room.ID),
		AgentWaits:      s.agentWaitsForRoom(room.ID),
		HandoffRecords:  s.handoffRecordsForRoom(room.ID),
		Tasks:           []core.Task{},
		Runs:            []core.Run{},
		RunOutputChunks: []core.RunOutputChunk{},
		ToolCalls:       []core.ToolCall{},
		MergeAttempts:   []core.MergeAttempt{},
		DeliveryPR:      nil,
	}

	if room.Kind == "issue" && strings.TrimSpace(room.IssueID) != "" {
		issue, ok := s.findIssue(room.IssueID)
		if !ok {
			return core.RoomDetailResponse{}, ErrNotFound
		}
		response.Issue = &issue
		response.Tasks = s.tasksForIssue(room.IssueID)
		response.Runs = s.runsForIssue(room.IssueID)
		response.RunOutputChunks = s.runOutputChunksForIssue(room.IssueID)
		response.ToolCalls = s.toolCallsForIssue(room.IssueID)
		response.MergeAttempts = s.mergeAttemptsForIssue(room.IssueID)
		branch := s.integrationForIssue(room.IssueID)
		response.IntegrationBranch = &branch
		response.DeliveryPR = s.deliveryPRForIssue(room.IssueID)
	}

	return response, nil
}

func (s *MemoryStore) TaskBoard() core.TaskBoardResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return core.TaskBoardResponse{
		Columns: []string{"todo", "in_progress", "ready_for_integration", "blocked", "integrated", "done"},
		Tasks:   slices.Clone(s.tasks),
	}
}

func (s *MemoryStore) Inbox() core.InboxResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return core.InboxResponse{Items: slices.Clone(s.inboxItems)}
}

func (s *MemoryStore) RegisterRuntime(name, provider string, _ int) core.Runtime {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextRuntimeID++
	runtime := core.Runtime{
		ID:       fmt.Sprintf("rt_%03d", s.nextRuntimeID),
		Name:     name,
		Status:   "online",
		Provider: provider,
	}
	s.runtimes = append(s.runtimes, runtime)
	return runtime
}

func (s *MemoryStore) HeartbeatRuntime(runtimeID, status string) (core.Runtime, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.runtimes {
		if s.runtimes[i].ID == runtimeID {
			s.runtimes[i].Status = status
			return s.runtimes[i], nil
		}
	}

	return core.Runtime{}, ErrNotFound
}

func (s *MemoryStore) ClaimNextQueuedAgentTurn(runtimeID string) (core.AgentTurnExecution, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.AgentTurnExecution{}, false, ErrNotFound
	}

	for i := range s.agentTurns {
		if s.agentTurns[i].Status != "queued" {
			continue
		}

		s.agentTurns[i].Status = "claimed"
		s.markRuntimeBusyLocked(runtimeID)
		if sessionIndex, ok := s.agentSessionIndexByIDLocked(s.agentTurns[i].SessionID); ok {
			s.agentSessions[sessionIndex].Status = "responding"
			s.agentSessions[sessionIndex].CurrentTurnID = s.agentTurns[i].ID
			s.agentSessions[sessionIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		}

		room, ok := s.findRoomByIDLocked(s.agentTurns[i].RoomID)
		if !ok {
			return core.AgentTurnExecution{}, false, ErrNotFound
		}
		trigger, ok := s.findMessageByIDLocked(s.agentTurns[i].RoomID, s.agentTurns[i].TriggerMessageID)
		if !ok {
			return core.AgentTurnExecution{}, false, ErrNotFound
		}

		session := core.AgentSession{}
		if sessionIndex, ok := s.agentSessionIndexByIDLocked(s.agentTurns[i].SessionID); ok {
			session = s.agentSessions[sessionIndex]
		}

		return core.AgentTurnExecution{
			Turn:           s.agentTurns[i],
			Session:        session,
			Room:           room,
			TriggerMessage: trigger,
			Messages:       slices.Clone(s.recentMessagesForRoomLocked(s.agentTurns[i].RoomID, 12)),
		}, true, nil
	}

	return core.AgentTurnExecution{}, false, nil
}

func (s *MemoryStore) CompleteAgentTurn(turnID, runtimeID, resultMessageID string) (core.AgentTurn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.AgentTurn{}, ErrNotFound
	}

	for i := range s.agentTurns {
		if s.agentTurns[i].ID != turnID {
			continue
		}

		s.agentTurns[i].Status = "completed"
		if sessionIndex, ok := s.agentSessionIndexByIDLocked(s.agentTurns[i].SessionID); ok {
			sessionStatus := "completed"
			if s.hasOpenAgentWaitForSessionLocked(s.agentTurns[i].SessionID) {
				sessionStatus = "waiting_human"
			} else if s.hasQueuedHandoffForSessionLocked(s.agentTurns[i].SessionID) {
				sessionStatus = "handoff_requested"
			} else if resultMessageID != "" {
				if message, ok := s.findMessageByIDLocked(s.agentTurns[i].RoomID, resultMessageID); ok && message.Kind == "blocked" {
					sessionStatus = "blocked"
				}
			}
			s.agentSessions[sessionIndex].Status = sessionStatus
			s.agentSessions[sessionIndex].CurrentTurnID = s.agentTurns[i].ID
			s.agentSessions[sessionIndex].LastMessageID = strings.TrimSpace(resultMessageID)
			s.agentSessions[sessionIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		s.completeHandoffForTurnLocked(turnID)
		s.markRuntimeOnlineLocked(runtimeID)
		return s.agentTurns[i], nil
	}

	return core.AgentTurn{}, ErrNotFound
}

func (s *MemoryStore) PostRoomMessage(targetID, actorType, actorName, kind, body string) core.ActionResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, issueID := s.resolveRoomTargetLocked(targetID)
	messageKind := strings.TrimSpace(kind)
	if messageKind == "" {
		messageKind = "message"
	}

	s.nextMessageID++
	message := core.Message{
		ID:        fmt.Sprintf("msg_%03d", s.nextMessageID),
		ActorType: actorType,
		ActorName: actorName,
		Body:      body,
		Kind:      messageKind,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.messagesByRoom[roomID] = append(s.messagesByRoom[roomID], message)

	affected := []core.ActionEntity{
		{Type: "message", ID: message.ID},
		{Type: "room", ID: roomID},
	}
	affected = append(affected, s.postRoomMessageEffectsLocked(roomID, message)...)
	if issueID != "" {
		affected = append(affected, core.ActionEntity{Type: "issue", ID: issueID})
	}

	return core.ActionResponse{
		Status:           "completed",
		ResultCode:       "room_message_posted",
		ResultMessage:    "Room message posted.",
		AffectedEntities: affected,
	}
}

func (s *MemoryStore) CreateIssue(title, summary, priority string) core.ActionResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextIssueID++
	s.nextRoomID++

	issueID := fmt.Sprintf("issue_%03d", s.nextIssueID)
	roomID := fmt.Sprintf("room_%03d", s.nextRoomID)
	branchID := fmt.Sprintf("ib_%s", issueID)

	issue := core.Issue{
		ID:       issueID,
		Title:    title,
		Status:   "todo",
		Priority: priority,
		Summary:  summary,
	}
	room := core.RoomSummary{
		ID:          roomID,
		IssueID:     issueID,
		Kind:        "issue",
		Title:       title,
		UnreadCount: 0,
	}
	integrationBranch := core.IntegrationBranch{
		ID:            branchID,
		IssueID:       issueID,
		Name:          fmt.Sprintf("%s/integration", strings.ReplaceAll(issueID, "_", "-")),
		Status:        "collecting",
		MergedTaskIDs: []string{},
	}

	s.issues = append(s.issues, issue)
	s.rooms = append(s.rooms, room)
	s.integrationBranches = append(s.integrationBranches, integrationBranch)
	s.messagesByRoom[roomID] = []core.Message{}
	s.defaultIssueID = issueID
	s.defaultRoomID = roomID
	s.appendSystemMessageLocked(
		roomID,
		"summary",
		fmt.Sprintf("Issue %s created. Room, default chat channel, and integration branch are ready.", title),
	)

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "issue_created",
		ResultMessage: "Issue, room, and integration branch created.",
		AffectedEntities: []core.ActionEntity{
			{Type: "issue", ID: issueID},
			{Type: "room", ID: roomID},
			{Type: "integration_branch", ID: branchID},
		},
	}
}

func (s *MemoryStore) CreateDiscussionRoom(title, summary string) core.ActionResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextRoomID++

	roomID := fmt.Sprintf("room_%03d", s.nextRoomID)
	room := core.RoomSummary{
		ID:          roomID,
		Kind:        "discussion",
		Title:       title,
		UnreadCount: 0,
	}

	s.rooms = append(s.rooms, room)
	s.messagesByRoom[roomID] = []core.Message{}
	s.defaultRoomID = roomID

	openingMessage := strings.TrimSpace(summary)
	if openingMessage == "" {
		openingMessage = fmt.Sprintf("%s created. Use this room for ongoing discussion.", title)
	}
	s.appendSystemMessageLocked(roomID, "summary", openingMessage)

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "room_created",
		ResultMessage: "Discussion room created.",
		AffectedEntities: []core.ActionEntity{
			{Type: "room", ID: roomID},
		},
	}
}

func (s *MemoryStore) CreateTask(issueID, title, description, assigneeAgentID string) core.ActionResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextTaskID++
	taskID := fmt.Sprintf("task_%03d", s.nextTaskID)
	task := core.Task{
		ID:              taskID,
		IssueID:         issueID,
		Title:           title,
		Description:     description,
		Status:          "todo",
		AssigneeAgentID: assigneeAgentID,
		BranchName:      fmt.Sprintf("%s/%s", strings.ReplaceAll(issueID, "_", "-"), taskID),
		RunCount:        0,
	}
	s.tasks = append(s.tasks, task)
	s.setIssueStatusLocked(issueID, "in_progress")

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "task_created",
		ResultMessage: "Task created.",
		AffectedEntities: []core.ActionEntity{
			{Type: "task", ID: task.ID},
			{Type: "issue", ID: issueID},
		},
	}
}

func (s *MemoryStore) AssignTask(taskID, agentID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.tasks {
		if s.tasks[i].ID == taskID {
			s.tasks[i].AssigneeAgentID = agentID
			return core.ActionResponse{
				Status:        "completed",
				ResultCode:    "task_assigned",
				ResultMessage: "Task reassigned.",
				AffectedEntities: []core.ActionEntity{
					{Type: "task", ID: taskID},
					{Type: "agent", ID: agentID},
				},
			}, nil
		}
	}

	return core.ActionResponse{}, ErrNotFound
}

func (s *MemoryStore) SetTaskStatus(taskID, status, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalizedStatus, err := normalizeEditableTaskStatus(status)
	if err != nil {
		return core.ActionResponse{}, err
	}

	taskIndex, ok := s.taskIndexByIDLocked(taskID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	s.tasks[taskIndex].Status = normalizedStatus
	if issueID, ok := s.issueIDForTaskLocked(taskID); ok {
		actorName := strings.TrimSpace(actorID)
		if actorName == "" {
			actorName = "someone"
		}
		s.appendSystemMessageLocked(
			issueID,
			"log",
			fmt.Sprintf("%s set task %s to %s.", actorName, s.tasks[taskIndex].Title, normalizedStatus),
		)
	}

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "task_status_updated",
		ResultMessage: fmt.Sprintf("Task status updated to %s.", normalizedStatus),
		AffectedEntities: []core.ActionEntity{
			{Type: "task", ID: taskID},
		},
	}, nil
}

func (s *MemoryStore) MarkTaskReadyForIntegration(taskID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	taskIndex, ok := s.taskIndexByIDLocked(taskID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	if s.tasks[taskIndex].Status != "integrated" {
		s.tasks[taskIndex].Status = "ready_for_integration"
	}
	resp, err := s.requestMergeLocked(taskID)
	if err != nil {
		return core.ActionResponse{}, err
	}

	resp.ResultCode = "task_ready_for_integration"
	resp.ResultMessage = "Task marked ready and integration review requested."
	return resp, nil
}

func (s *MemoryStore) CreateRun(taskID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.defaultWorkspaceRepoPathLocked(); !ok {
		return core.ActionResponse{}, errors.New("workspace 缺少默认 repo 绑定")
	}

	for i := range s.tasks {
		if s.tasks[i].ID == taskID {
			s.nextRunID++
			run := core.Run{
				ID:            fmt.Sprintf("run_%03d", s.nextRunID),
				TaskID:        taskID,
				AgentID:       s.tasks[i].AssigneeAgentID,
				RuntimeID:     "",
				Status:        "queued",
				Title:         "Queued from Action Gateway",
				OutputPreview: "Queued and waiting for runtime claim.",
			}
			s.hydrateRunLocked(&run)
			s.tasks[i].RunCount++
			s.tasks[i].Status = "in_progress"
			s.setIssueStatusLocked(s.tasks[i].IssueID, "in_progress")
			s.runs = append(s.runs, run)
			return core.ActionResponse{
				Status:        "completed",
				ResultCode:    "run_created",
				ResultMessage: "Run created for task.",
				AffectedEntities: []core.ActionEntity{
					{Type: "run", ID: run.ID},
					{Type: "task", ID: taskID},
				},
			}, nil
		}
	}

	return core.ActionResponse{}, ErrNotFound
}

func (s *MemoryStore) ApproveRun(runID, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.runs {
		if s.runs[i].ID != runID {
			continue
		}
		if s.runs[i].Status != "approval_required" && s.runs[i].Status != "blocked" && s.runs[i].Status != "failed" {
			return core.ActionResponse{}, errors.New("run is not awaiting human intervention")
		}

		s.runs[i].Status = "queued"
		s.runs[i].RuntimeID = ""
		s.resolveInboxItemsLocked("run", runID)
		if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
			s.appendSystemMessageLocked(
				issueID,
				"log",
				fmt.Sprintf("%s approved %s for another execution attempt.", actorID, s.runs[i].Title),
			)
		}

		return core.ActionResponse{
			Status:        "completed",
			ResultCode:    "run_requeued",
			ResultMessage: "Run approved and re-queued for execution.",
			AffectedEntities: []core.ActionEntity{
				{Type: "run", ID: runID},
			},
		}, nil
	}

	return core.ActionResponse{}, ErrNotFound
}

func (s *MemoryStore) CancelRun(runID, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.runs {
		if s.runs[i].ID != runID {
			continue
		}

		if s.runs[i].Status == "completed" || s.runs[i].Status == "cancelled" {
			return core.ActionResponse{}, errors.New("run can no longer be cancelled")
		}

		s.runs[i].Status = "cancelled"
		if s.runs[i].RuntimeID != "" {
			s.markRuntimeOnlineLocked(s.runs[i].RuntimeID)
		}
		if taskIndex, ok := s.taskIndexByIDLocked(s.runs[i].TaskID); ok {
			s.tasks[taskIndex].Status = "blocked"
		}
		s.resolveInboxItemsLocked("run", runID)
		if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
			s.appendSystemMessageLocked(
				issueID,
				"blocked",
				fmt.Sprintf("%s cancelled %s before it reached integration.", actorID, s.runs[i].Title),
			)
		}

		return core.ActionResponse{
			Status:        "completed",
			ResultCode:    "run_cancelled",
			ResultMessage: "Run cancelled.",
			AffectedEntities: []core.ActionEntity{
				{Type: "run", ID: runID},
			},
		}, nil
	}

	return core.ActionResponse{}, ErrNotFound
}

func (s *MemoryStore) RequestMerge(taskID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.requestMergeLocked(taskID)
}

func (s *MemoryStore) ApproveMerge(taskID, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	taskIndex, ok := s.taskIndexByIDLocked(taskID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	issueID := s.tasks[taskIndex].IssueID
	branch := s.integrationBranchByIssueLocked(issueID)
	if branch == nil {
		return core.ActionResponse{}, ErrNotFound
	}
	if existing, ok := s.activeMergeAttemptForTaskLocked(taskID); ok {
		return core.ActionResponse{
			Status:        "completed",
			ResultCode:    "merge_attempt_already_queued",
			ResultMessage: "Merge attempt already queued for this task.",
			AffectedEntities: []core.ActionEntity{
				{Type: "merge_attempt", ID: existing.ID},
			},
		}, nil
	}
	if s.tasks[taskIndex].Status == "integrated" {
		return core.ActionResponse{}, errors.New("task is already integrated")
	}
	if !s.hasInboxItemLocked("task", taskID, "GitIntegration.merge.approve") {
		return core.ActionResponse{}, errors.New("merge is not awaiting human approval")
	}

	s.nextMergeAttemptID++
	repoPath, ok := s.defaultWorkspaceRepoPathLocked()
	if !ok {
		return core.ActionResponse{}, errors.New("workspace 缺少默认 repo 绑定")
	}
	mergeAttempt := core.MergeAttempt{
		ID:           fmt.Sprintf("merge_%03d", s.nextMergeAttemptID),
		IssueID:      issueID,
		TaskID:       taskID,
		SourceRunID:  s.latestRunIDForTaskLocked(taskID),
		SourceBranch: s.tasks[taskIndex].BranchName,
		TargetBranch: branch.Name,
		RepoPath:     repoPath,
		Status:       "queued",
	}
	s.mergeAttempts = append(s.mergeAttempts, mergeAttempt)
	s.resolveInboxItemsLocked("task", taskID)
	s.appendSystemMessageLocked(
		issueID,
		"log",
		fmt.Sprintf("%s approved merge for %s into %s.", actorID, s.tasks[taskIndex].Title, branch.Name),
	)

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "merge_attempt_queued",
		ResultMessage: "Merge attempt queued for daemon execution.",
		AffectedEntities: []core.ActionEntity{
			{Type: "merge_attempt", ID: mergeAttempt.ID},
			{Type: "integration_branch", ID: branch.ID},
		},
	}, nil
}

func (s *MemoryStore) CreateDeliveryPR(issueID, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.defaultWorkspaceRepoPathLocked(); !ok {
		return core.ActionResponse{}, errors.New("workspace 缺少默认 repo 绑定")
	}

	branch := s.integrationBranchByIssueLocked(issueID)
	if branch == nil {
		return core.ActionResponse{}, ErrNotFound
	}
	if branch.Status != "ready_for_delivery" {
		return core.ActionResponse{}, errors.New("integration branch is not ready for delivery")
	}
	for _, pr := range s.deliveryPRs {
		if pr.IssueID == issueID && pr.Status != "merged" && pr.Status != "closed" {
			return core.ActionResponse{}, errors.New("delivery pr already exists for issue")
		}
	}

	prID := fmt.Sprintf("pr_%03d", len(s.deliveryPRs)+101)
	title := fmt.Sprintf("Merge %s into main", branch.Name)
	pr := core.DeliveryPR{
		ID:           prID,
		IssueID:      issueID,
		Title:        title,
		Status:       "open",
		ExternalPRID: fmt.Sprintf("gh_%s", prID),
		ExternalURL:  fmt.Sprintf("https://github.example.local/openshock/pull/%s", prID),
	}
	s.deliveryPRs = append(s.deliveryPRs, pr)
	s.setIssueStatusLocked(issueID, "in_review")
	s.appendSystemMessageLocked(
		issueID,
		"summary",
		fmt.Sprintf("%s created Delivery PR %s from %s.", actorID, pr.ID, branch.Name),
	)

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "delivery_pr_created",
		ResultMessage: "Delivery PR created from the integration branch.",
		AffectedEntities: []core.ActionEntity{
			{Type: "delivery_pr", ID: prID},
			{Type: "issue", ID: issueID},
		},
	}, nil
}

func (s *MemoryStore) ClaimNextQueuedMerge(runtimeID string) (core.MergeAttempt, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.MergeAttempt{}, false, ErrNotFound
	}

	for i := range s.mergeAttempts {
		if s.mergeAttempts[i].Status == "queued" {
			if strings.TrimSpace(s.mergeAttempts[i].RepoPath) == "" {
				repoPath, ok := s.defaultWorkspaceRepoPathLocked()
				if !ok {
					return core.MergeAttempt{}, false, errors.New("workspace 缺少默认 repo 绑定")
				}
				s.mergeAttempts[i].RepoPath = repoPath
			}
			s.mergeAttempts[i].Status = "running"
			s.mergeAttempts[i].RuntimeID = runtimeID
			s.markRuntimeBusyLocked(runtimeID)
			return s.mergeAttempts[i], true, nil
		}
	}

	return core.MergeAttempt{}, false, nil
}

func (s *MemoryStore) IngestRepoWebhook(eventID, provider, externalPRID, status string) (core.RepoWebhookResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if replay, ok := s.repoWebhookEvents[eventID]; ok {
		replay.Replayed = true
		return replay, nil
	}
	if strings.TrimSpace(provider) == "" || strings.TrimSpace(externalPRID) == "" || strings.TrimSpace(status) == "" {
		return core.RepoWebhookResponse{}, errors.New("provider, external pr id, and status are required")
	}

	for i := range s.deliveryPRs {
		if s.deliveryPRs[i].ExternalPRID != externalPRID {
			continue
		}

		switch status {
		case "open", "in_review":
			s.deliveryPRs[i].Status = "open"
			s.setIssueStatusLocked(s.deliveryPRs[i].IssueID, "in_review")
		case "merged":
			s.deliveryPRs[i].Status = "merged"
			s.setIssueStatusLocked(s.deliveryPRs[i].IssueID, "done")
			if branch := s.integrationBranchByIssueLocked(s.deliveryPRs[i].IssueID); branch != nil {
				branch.Status = "merged_to_main"
			}
			s.appendSystemMessageLocked(
				s.deliveryPRs[i].IssueID,
				"summary",
				fmt.Sprintf("Delivery PR %s merged via %s webhook.", s.deliveryPRs[i].ID, provider),
			)
		case "closed":
			s.deliveryPRs[i].Status = "closed"
			s.setIssueStatusLocked(s.deliveryPRs[i].IssueID, "in_progress")
		default:
			return core.RepoWebhookResponse{}, errors.New("unsupported delivery pr webhook status")
		}

		resp := core.RepoWebhookResponse{
			DeliveryPRID: s.deliveryPRs[i].ID,
			Status:       s.deliveryPRs[i].Status,
			Replayed:     false,
		}
		s.repoWebhookEvents[eventID] = resp
		return resp, nil
	}

	return core.RepoWebhookResponse{}, ErrNotFound
}

func (s *MemoryStore) ClaimNextQueuedRun(runtimeID string) (core.Run, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.Run{}, false, ErrNotFound
	}

	for i := range s.runs {
		if s.runs[i].Status == "queued" {
			s.hydrateRunLocked(&s.runs[i])
			if strings.TrimSpace(s.runs[i].RepoPath) == "" {
				return core.Run{}, false, errors.New("workspace 缺少默认 repo 绑定")
			}
			s.runs[i].Status = "running"
			s.runs[i].RuntimeID = runtimeID
			s.markRuntimeBusyLocked(runtimeID)
			return s.runs[i], true, nil
		}
	}

	return core.Run{}, false, nil
}

func (s *MemoryStore) IngestMergeEvent(mergeAttemptID, runtimeID, eventType, resultSummary string) (core.MergeAttempt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.MergeAttempt{}, ErrNotFound
	}

	for i := range s.mergeAttempts {
		if s.mergeAttempts[i].ID != mergeAttemptID {
			continue
		}

		if resultSummary != "" {
			s.mergeAttempts[i].ResultSummary = resultSummary
		}

		switch eventType {
		case "started":
			s.mergeAttempts[i].Status = "running"
			s.mergeAttempts[i].RuntimeID = runtimeID
			s.markRuntimeBusyLocked(runtimeID)
		case "succeeded":
			s.mergeAttempts[i].Status = "succeeded"
			s.markRuntimeOnlineLocked(runtimeID)
			if taskIndex, ok := s.taskIndexByIDLocked(s.mergeAttempts[i].TaskID); ok {
				s.tasks[taskIndex].Status = "integrated"
			}
			branch := s.integrationBranchByIssueLocked(s.mergeAttempts[i].IssueID)
			if branch != nil && !slices.Contains(branch.MergedTaskIDs, s.mergeAttempts[i].TaskID) {
				branch.MergedTaskIDs = append(branch.MergedTaskIDs, s.mergeAttempts[i].TaskID)
			}
			if branch != nil {
				if s.allTasksIntegratedLocked(s.mergeAttempts[i].IssueID) {
					branch.Status = "ready_for_delivery"
				} else {
					branch.Status = "integrating"
				}
			}
		case "conflicted":
			s.mergeAttempts[i].Status = "conflicted"
			s.markRuntimeOnlineLocked(runtimeID)
			if taskIndex, ok := s.taskIndexByIDLocked(s.mergeAttempts[i].TaskID); ok {
				s.tasks[taskIndex].Status = "blocked"
			}
			branch := s.integrationBranchByIssueLocked(s.mergeAttempts[i].IssueID)
			if branch != nil {
				branch.Status = "blocked"
			}
			s.appendInboxItemLocked(
				"Integration Merge Conflict",
				"merge_conflict",
				"high",
				fmt.Sprintf("Merge attempt for %s hit a conflict: %s", s.mergeAttempts[i].TaskID, s.mergeAttempts[i].ResultSummary),
				"merge_attempt",
				mergeAttemptID,
				"GitIntegration.merge.request",
			)
			s.appendSystemMessageLocked(
				s.mergeAttempts[i].IssueID,
				"blocked",
				fmt.Sprintf("Merge attempt %s conflicted: %s", mergeAttemptID, s.mergeAttempts[i].ResultSummary),
			)
		case "failed":
			s.mergeAttempts[i].Status = "failed"
			s.markRuntimeOnlineLocked(runtimeID)
			if taskIndex, ok := s.taskIndexByIDLocked(s.mergeAttempts[i].TaskID); ok {
				s.tasks[taskIndex].Status = "blocked"
			}
			if branch := s.integrationBranchByIssueLocked(s.mergeAttempts[i].IssueID); branch != nil {
				branch.Status = "blocked"
			}
			s.appendInboxItemLocked(
				"Integration Merge Failed",
				"failed",
				"high",
				fmt.Sprintf("Merge attempt %s failed: %s", mergeAttemptID, s.mergeAttempts[i].ResultSummary),
				"merge_attempt",
				mergeAttemptID,
				"GitIntegration.merge.request",
			)
			s.appendSystemMessageLocked(
				s.mergeAttempts[i].IssueID,
				"blocked",
				fmt.Sprintf("Merge attempt %s failed: %s", mergeAttemptID, s.mergeAttempts[i].ResultSummary),
			)
		default:
			return core.MergeAttempt{}, errors.New("unsupported merge event type")
		}

		return s.mergeAttempts[i], nil
	}

	return core.MergeAttempt{}, ErrNotFound
}

func (s *MemoryStore) IngestRunEvent(runID, runtimeID, eventType, outputPreview, message string, stream string, toolCall *core.ToolCallInput) (core.Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.Run{}, ErrNotFound
	}

	for i := range s.runs {
		if s.runs[i].ID != runID {
			continue
		}

		if outputPreview != "" {
			s.runs[i].OutputPreview = outputPreview
		}

		switch eventType {
		case "started":
			s.runs[i].Status = "running"
			s.runs[i].RuntimeID = runtimeID
			s.markRuntimeBusyLocked(runtimeID)
		case "output":
			if s.runs[i].Status == "queued" {
				s.runs[i].Status = "running"
				s.runs[i].RuntimeID = runtimeID
				s.markRuntimeBusyLocked(runtimeID)
			}
			content := strings.TrimSpace(message)
			if content == "" {
				content = strings.TrimSpace(outputPreview)
			}
			if content != "" {
				s.appendRunOutputChunkLocked(runID, normalizedStream(stream), content)
			}
		case "tool_call":
			if s.runs[i].Status == "queued" {
				s.runs[i].Status = "running"
				s.runs[i].RuntimeID = runtimeID
				s.markRuntimeBusyLocked(runtimeID)
			}
			if toolCall != nil && strings.TrimSpace(toolCall.ToolName) != "" {
				s.appendToolCallLocked(runID, *toolCall)
			}
		case "blocked":
			s.runs[i].Status = "blocked"
			s.markRuntimeOnlineLocked(runtimeID)
			if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
				s.appendSystemMessageLocked(
					issueID,
					"blocked",
					fmt.Sprintf("Run %s is blocked: %s", s.runs[i].Title, outputPreview),
				)
				s.appendInboxItemLocked(
					"Run Blocked",
					"blocked",
					"high",
					fmt.Sprintf("%s is blocked and needs intervention.", s.runs[i].Title),
					"run",
					runID,
					"Run.approve",
				)
			}
		case "approval_required":
			s.runs[i].Status = "approval_required"
			s.markRuntimeOnlineLocked(runtimeID)
			if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
				s.appendSystemMessageLocked(
					issueID,
					"blocked",
					fmt.Sprintf("Run %s requires approval: %s", s.runs[i].Title, outputPreview),
				)
				s.appendInboxItemLocked(
					"Run Requires Approval",
					"approval_required",
					"high",
					fmt.Sprintf("%s paused for human approval.", s.runs[i].Title),
					"run",
					runID,
					"Run.approve",
				)
			}
		case "completed":
			s.runs[i].Status = "completed"
			s.markRuntimeOnlineLocked(runtimeID)
		case "failed":
			s.runs[i].Status = "failed"
			s.markRuntimeOnlineLocked(runtimeID)
			if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
				s.appendSystemMessageLocked(
					issueID,
					"blocked",
					fmt.Sprintf("Run %s failed: %s", s.runs[i].Title, outputPreview),
				)
				s.appendInboxItemLocked(
					"Run Failed",
					"failed",
					"high",
					fmt.Sprintf("%s failed and may need a retry.", s.runs[i].Title),
					"run",
					runID,
					"Run.approve",
				)
			}
		default:
			return core.Run{}, errors.New("unsupported run event type")
		}

		return s.runs[i], nil
	}

	return core.Run{}, ErrNotFound
}

func (s *MemoryStore) workspaceSnapshotLocked() core.Workspace {
	snapshot := s.workspace
	snapshot.RepoBindings = slices.Clone(s.workspace.RepoBindings)
	return snapshot
}

func (s *MemoryStore) defaultWorkspaceRepoBindingLocked() (core.WorkspaceRepoBinding, bool) {
	if strings.TrimSpace(s.workspace.DefaultRepoBindingID) != "" {
		for _, binding := range s.workspace.RepoBindings {
			if binding.ID == s.workspace.DefaultRepoBindingID && binding.Status == "active" {
				return binding, true
			}
		}
	}
	for _, binding := range s.workspace.RepoBindings {
		if binding.IsDefault && binding.Status == "active" {
			return binding, true
		}
	}
	return core.WorkspaceRepoBinding{}, false
}

func (s *MemoryStore) defaultWorkspaceRepoPathLocked() (string, bool) {
	binding, ok := s.defaultWorkspaceRepoBindingLocked()
	if !ok {
		return "", false
	}
	return binding.RepoPath, true
}

func (s *MemoryStore) workspaceRepoBindingIndexByPathLocked(repoPath string) (int, bool) {
	normalized := strings.TrimSpace(repoPath)
	for i := range s.workspace.RepoBindings {
		if s.workspace.RepoBindings[i].RepoPath == normalized {
			return i, true
		}
	}
	return 0, false
}

func normalizeWorkspaceRepoLabel(repoPath, label string) string {
	trimmedLabel := strings.TrimSpace(label)
	if trimmedLabel != "" {
		return trimmedLabel
	}
	base := strings.TrimSpace(filepath.Base(strings.TrimSpace(repoPath)))
	if base == "" || base == "." || base == string(filepath.Separator) {
		return strings.TrimSpace(repoPath)
	}
	return base
}

func (s *MemoryStore) bindWorkspaceRepoLocked(repoPath, label string, makeDefault bool) (core.WorkspaceRepoBinding, error) {
	trimmedRepoPath := strings.TrimSpace(repoPath)
	if trimmedRepoPath == "" {
		return core.WorkspaceRepoBinding{}, errors.New("repo path is required")
	}

	if !makeDefault && strings.TrimSpace(s.workspace.DefaultRepoBindingID) == "" {
		makeDefault = true
	}

	binding := core.WorkspaceRepoBinding{}
	if idx, ok := s.workspaceRepoBindingIndexByPathLocked(trimmedRepoPath); ok {
		s.workspace.RepoBindings[idx].Label = normalizeWorkspaceRepoLabel(trimmedRepoPath, label)
		s.workspace.RepoBindings[idx].Status = "active"
		binding = s.workspace.RepoBindings[idx]
	} else {
		s.nextWorkspaceRepoID++
		binding = core.WorkspaceRepoBinding{
			ID:          fmt.Sprintf("wsrepo_%03d", s.nextWorkspaceRepoID),
			WorkspaceID: s.workspace.ID,
			Label:       normalizeWorkspaceRepoLabel(trimmedRepoPath, label),
			RepoPath:    trimmedRepoPath,
			Status:      "active",
		}
		s.workspace.RepoBindings = append(s.workspace.RepoBindings, binding)
	}

	if makeDefault {
		for i := range s.workspace.RepoBindings {
			s.workspace.RepoBindings[i].IsDefault = s.workspace.RepoBindings[i].ID == binding.ID
			if s.workspace.RepoBindings[i].IsDefault {
				binding = s.workspace.RepoBindings[i]
			}
		}
		s.workspace.DefaultRepoBindingID = binding.ID
	} else if strings.TrimSpace(s.workspace.DefaultRepoBindingID) == binding.ID {
		for i := range s.workspace.RepoBindings {
			if s.workspace.RepoBindings[i].ID == binding.ID {
				s.workspace.RepoBindings[i].IsDefault = true
				binding = s.workspace.RepoBindings[i]
				break
			}
		}
	}

	return binding, nil
}

func (s *MemoryStore) findIssue(issueID string) (core.Issue, bool) {
	for _, issue := range s.issues {
		if issue.ID == issueID {
			if repoPath, ok := s.defaultWorkspaceRepoPathLocked(); ok {
				issue.RepoPath = repoPath
			}
			return issue, true
		}
	}
	return core.Issue{}, false
}

func (s *MemoryStore) issueIDForTaskLocked(taskID string) (string, bool) {
	for _, task := range s.tasks {
		if task.ID == taskID {
			return task.IssueID, true
		}
	}
	return "", false
}

func (s *MemoryStore) IssueIDForTask(taskID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.issueIDForTaskLocked(taskID)
}

func (s *MemoryStore) IssueIDForRun(runID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, run := range s.runs {
		if run.ID != runID {
			continue
		}
		return s.issueIDForTaskLocked(run.TaskID)
	}

	return "", false
}

func (s *MemoryStore) IssueIDForMergeAttempt(mergeAttemptID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, attempt := range s.mergeAttempts {
		if attempt.ID == mergeAttemptID {
			return attempt.IssueID, true
		}
	}

	return "", false
}

func (s *MemoryStore) IssueIDForDeliveryPR(deliveryPRID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, pr := range s.deliveryPRs {
		if pr.ID == deliveryPRID {
			return pr.IssueID, true
		}
	}

	return "", false
}

func (s *MemoryStore) taskIndexByIDLocked(taskID string) (int, bool) {
	for i := range s.tasks {
		if s.tasks[i].ID == taskID {
			return i, true
		}
	}
	return 0, false
}

func (s *MemoryStore) hydrateRunLocked(run *core.Run) {
	taskIndex, ok := s.taskIndexByIDLocked(run.TaskID)
	if !ok {
		return
	}

	task := s.tasks[taskIndex]
	run.IssueID = task.IssueID
	run.BranchName = task.BranchName
	if run.Instruction == "" {
		run.Instruction = buildRunInstruction(task)
	}
	if branch := s.integrationBranchByIssueLocked(task.IssueID); branch != nil {
		run.BaseBranch = branch.Name
	}
	if repoPath, ok := s.defaultWorkspaceRepoPathLocked(); ok {
		run.RepoPath = repoPath
	}
}

func (s *MemoryStore) activeMergeAttemptForTaskLocked(taskID string) (core.MergeAttempt, bool) {
	for _, attempt := range s.mergeAttempts {
		if attempt.TaskID == taskID && (attempt.Status == "queued" || attempt.Status == "running") {
			return attempt, true
		}
	}
	return core.MergeAttempt{}, false
}

func (s *MemoryStore) latestRunIDForTaskLocked(taskID string) string {
	for i := len(s.runs) - 1; i >= 0; i-- {
		if s.runs[i].TaskID == taskID {
			return s.runs[i].ID
		}
	}
	return ""
}

func (s *MemoryStore) allTasksIntegratedLocked(issueID string) bool {
	found := false
	for _, task := range s.tasks {
		if task.IssueID != issueID {
			continue
		}
		found = true
		if task.Status != "integrated" {
			return false
		}
	}
	return found
}

func (s *MemoryStore) setIssueStatusLocked(issueID, status string) {
	for i := range s.issues {
		if s.issues[i].ID == issueID {
			s.issues[i].Status = status
			return
		}
	}
}

func (s *MemoryStore) findRuntimeLocked(runtimeID string) (core.Runtime, bool) {
	for _, runtime := range s.runtimes {
		if runtime.ID == runtimeID {
			return runtime, true
		}
	}
	return core.Runtime{}, false
}

func (s *MemoryStore) markRuntimeBusyLocked(runtimeID string) {
	for i := range s.runtimes {
		if s.runtimes[i].ID == runtimeID {
			s.runtimes[i].Status = "busy"
			return
		}
	}
}

func (s *MemoryStore) markRuntimeOnlineLocked(runtimeID string) {
	for i := range s.runtimes {
		if s.runtimes[i].ID == runtimeID {
			s.runtimes[i].Status = "online"
			return
		}
	}
}

func (s *MemoryStore) appendSystemMessageLocked(issueID, kind, body string) {
	roomID, _ := s.resolveRoomTargetLocked(issueID)

	s.nextMessageID++
	message := core.Message{
		ID:        fmt.Sprintf("msg_%03d", s.nextMessageID),
		ActorType: "system",
		ActorName: "OpenShock",
		Body:      body,
		Kind:      kind,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.messagesByRoom[roomID] = append(s.messagesByRoom[roomID], message)
}

func (s *MemoryStore) postRoomMessageEffectsLocked(roomID string, message core.Message) []core.ActionEntity {
	affected := make([]core.ActionEntity, 0, 4)

	if wait, ok := s.markAgentWaitingLocked(roomID, message); ok {
		affected = append(affected,
			core.ActionEntity{Type: "agent_session", ID: wait.SessionID},
			core.ActionEntity{Type: "agent_wait", ID: wait.ID},
		)
		return affected
	}

	if handoff, turn, ok := s.enqueueAgentHandoffLocked(roomID, message); ok {
		affected = append(affected,
			core.ActionEntity{Type: "handoff_record", ID: handoff.ID},
			core.ActionEntity{Type: "agent_turn", ID: turn.ID},
		)
		return affected
	}

	if session, turn, ok := s.resumeWaitingAgentFromMessageLocked(roomID, message); ok {
		affected = append(affected,
			core.ActionEntity{Type: "agent_session", ID: session.ID},
			core.ActionEntity{Type: "agent_turn", ID: turn.ID},
		)
		return affected
	}

	if session, turn, ok := s.enqueueAgentTurnFromMessageLocked(roomID, message); ok {
		affected = append(affected,
			core.ActionEntity{Type: "agent_session", ID: session.ID},
			core.ActionEntity{Type: "agent_turn", ID: turn.ID},
		)
	}
	return affected
}

func (s *MemoryStore) markAgentWaitingLocked(roomID string, message core.Message) (core.AgentWait, bool) {
	if message.ActorType != "agent" || strings.TrimSpace(message.Kind) != "clarification_request" {
		return core.AgentWait{}, false
	}

	agent, ok := s.findAgentByActorLocked(message.ActorName)
	if !ok {
		return core.AgentWait{}, false
	}

	sessionIndex := s.ensureAgentSessionLocked(roomID, agent.ID)
	for i := range s.agentWaits {
		if s.agentWaits[i].SessionID == s.agentSessions[sessionIndex].ID && s.agentWaits[i].Status == "waiting_human" {
			s.agentWaits[i].BlockingMessageID = message.ID
			s.agentWaits[i].CreatedAt = time.Now().UTC().Format(time.RFC3339)
			s.agentWaits[i].ResolvedAt = ""
			s.agentSessions[sessionIndex].Status = "waiting_human"
			s.agentSessions[sessionIndex].LastMessageID = message.ID
			s.agentSessions[sessionIndex].UpdatedAt = s.agentWaits[i].CreatedAt
			return s.agentWaits[i], true
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	s.nextAgentWaitID++
	wait := core.AgentWait{
		ID:                fmt.Sprintf("agent_wait_%03d", s.nextAgentWaitID),
		SessionID:         s.agentSessions[sessionIndex].ID,
		RoomID:            roomID,
		AgentID:           agent.ID,
		BlockingMessageID: message.ID,
		Status:            "waiting_human",
		CreatedAt:         now,
	}
	s.agentWaits = append(s.agentWaits, wait)
	s.agentSessions[sessionIndex].Status = "waiting_human"
	s.agentSessions[sessionIndex].LastMessageID = message.ID
	s.agentSessions[sessionIndex].UpdatedAt = now
	return wait, true
}

func (s *MemoryStore) enqueueAgentHandoffLocked(roomID string, message core.Message) (core.HandoffRecord, core.AgentTurn, bool) {
	if message.ActorType != "agent" || strings.TrimSpace(message.Kind) != "handoff" {
		return core.HandoffRecord{}, core.AgentTurn{}, false
	}

	fromAgent, ok := s.findAgentByActorLocked(message.ActorName)
	if !ok {
		return core.HandoffRecord{}, core.AgentTurn{}, false
	}
	targetAgent, ok := s.findMentionedAgentLocked(message.Body)
	if !ok || targetAgent.ID == fromAgent.ID {
		return core.HandoffRecord{}, core.AgentTurn{}, false
	}

	fromSessionIndex := s.ensureAgentSessionLocked(roomID, fromAgent.ID)
	targetSessionIndex := s.ensureAgentSessionLocked(roomID, targetAgent.ID)
	turn := s.createAgentTurnLocked(targetSessionIndex, roomID, targetAgent.ID, message.ID, "handoff_response")

	s.nextHandoffID++
	now := time.Now().UTC().Format(time.RFC3339)
	record := core.HandoffRecord{
		ID:               fmt.Sprintf("handoff_%03d", s.nextHandoffID),
		RoomID:           roomID,
		FromSessionID:    s.agentSessions[fromSessionIndex].ID,
		FromAgentID:      fromAgent.ID,
		ToAgentID:        targetAgent.ID,
		TriggerMessageID: message.ID,
		Status:           "queued",
		AcceptedTurnID:   turn.ID,
		CreatedAt:        now,
	}
	s.handoffRecords = append(s.handoffRecords, record)
	s.agentSessions[fromSessionIndex].Status = "handoff_requested"
	s.agentSessions[fromSessionIndex].LastMessageID = message.ID
	s.agentSessions[fromSessionIndex].UpdatedAt = now
	return record, turn, true
}

func (s *MemoryStore) resumeWaitingAgentFromMessageLocked(roomID string, message core.Message) (core.AgentSession, core.AgentTurn, bool) {
	if message.ActorType == "agent" || message.ActorType == "system" || !isHumanInstructionMessageKind(message.Kind) {
		return core.AgentSession{}, core.AgentTurn{}, false
	}

	waitIndex, ok := s.findResolvableAgentWaitIndexLocked(roomID, message)
	if !ok {
		return core.AgentSession{}, core.AgentTurn{}, false
	}

	wait := s.agentWaits[waitIndex]
	sessionIndex, ok := s.agentSessionIndexByIDLocked(wait.SessionID)
	if !ok {
		return core.AgentSession{}, core.AgentTurn{}, false
	}

	turn := s.createAgentTurnLocked(sessionIndex, roomID, wait.AgentID, message.ID, "clarification_followup")
	now := time.Now().UTC().Format(time.RFC3339)
	s.agentWaits[waitIndex].Status = "resolved"
	s.agentWaits[waitIndex].ResolvedAt = now
	s.agentSessions[sessionIndex].Status = "queued"
	s.agentSessions[sessionIndex].LastMessageID = message.ID
	s.agentSessions[sessionIndex].UpdatedAt = now
	return s.agentSessions[sessionIndex], turn, true
}

func (s *MemoryStore) enqueueAgentTurnFromMessageLocked(roomID string, message core.Message) (core.AgentSession, core.AgentTurn, bool) {
	if strings.TrimSpace(roomID) == "" {
		return core.AgentSession{}, core.AgentTurn{}, false
	}
	if message.ActorType == "agent" || message.ActorType == "system" || !isHumanInstructionMessageKind(message.Kind) {
		return core.AgentSession{}, core.AgentTurn{}, false
	}
	if strings.TrimSpace(message.Body) == "" {
		return core.AgentSession{}, core.AgentTurn{}, false
	}

	agent, ok := s.findMentionedAgentLocked(message.Body)
	if !ok {
		agent, ok = s.selectVisibleReplyAgentLocked(roomID)
		if !ok {
			return core.AgentSession{}, core.AgentTurn{}, false
		}
	}
	if strings.EqualFold(strings.TrimSpace(agent.ID), strings.TrimSpace(message.ActorName)) || strings.EqualFold(strings.TrimSpace(agent.Name), strings.TrimSpace(message.ActorName)) {
		return core.AgentSession{}, core.AgentTurn{}, false
	}

	sessionIndex := s.ensureAgentSessionLocked(roomID, agent.ID)
	turn := s.createAgentTurnLocked(sessionIndex, roomID, agent.ID, message.ID, "visible_message_response")
	return s.agentSessions[sessionIndex], turn, true
}

func (s *MemoryStore) createAgentTurnLocked(sessionIndex int, roomID, agentID, triggerMessageID, intentType string) core.AgentTurn {
	now := time.Now().UTC().Format(time.RFC3339)
	s.nextAgentTurnID++
	turn := core.AgentTurn{
		ID:               fmt.Sprintf("turn_%03d", s.nextAgentTurnID),
		SessionID:        s.agentSessions[sessionIndex].ID,
		RoomID:           roomID,
		AgentID:          agentID,
		Sequence:         s.nextAgentTurnSequenceLocked(s.agentSessions[sessionIndex].ID),
		TriggerMessageID: triggerMessageID,
		IntentType:       intentType,
		WakeupMode:       wakeupModeForIntent(intentType),
		EventFrame:       s.buildEventFrameLocked(roomID, triggerMessageID, intentType),
		Status:           "queued",
		CreatedAt:        now,
	}
	s.agentTurns = append(s.agentTurns, turn)
	s.agentSessions[sessionIndex].Status = "queued"
	s.agentSessions[sessionIndex].LastMessageID = triggerMessageID
	s.agentSessions[sessionIndex].CurrentTurnID = turn.ID
	s.agentSessions[sessionIndex].UpdatedAt = now
	return turn
}

func (s *MemoryStore) ensureAgentSessionLocked(roomID, agentID string) int {
	for i := range s.agentSessions {
		if s.agentSessions[i].RoomID == roomID && s.agentSessions[i].AgentID == agentID {
			return i
		}
	}

	s.nextAgentSessionID++
	sessionID := fmt.Sprintf("agent_session_%03d", s.nextAgentSessionID)
	session := core.AgentSession{
		ID:               sessionID,
		RoomID:           roomID,
		AgentID:          agentID,
		ProviderThreadID: fmt.Sprintf("provider_thread_%s", sessionID),
		Status:           "idle",
		UpdatedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	s.agentSessions = append(s.agentSessions, session)
	return len(s.agentSessions) - 1
}

func wakeupModeForIntent(intentType string) string {
	switch strings.TrimSpace(intentType) {
	case "clarification_followup":
		return "clarification_followup"
	case "handoff_response":
		return "handoff_response"
	case "visible_message_response":
		return "direct_message"
	default:
		return "direct_message"
	}
}

func (s *MemoryStore) buildEventFrameLocked(roomID, triggerMessageID, intentType string) core.EventFrame {
	room, _ := s.findRoomByIDLocked(roomID)
	trigger, _ := s.findMessageByIDLocked(roomID, triggerMessageID)

	recentMessages := s.recentMessagesForRoomLocked(roomID, 3)
	recentSummaryParts := make([]string, 0, len(recentMessages))
	for _, message := range recentMessages {
		body := strings.TrimSpace(message.Body)
		if body == "" {
			continue
		}
		recentSummaryParts = append(recentSummaryParts, fmt.Sprintf("%s[%s]: %s", message.ActorName, message.Kind, body))
	}

	currentTarget := fmt.Sprintf("room:%s", roomID)
	if room.IssueID != "" {
		currentTarget = fmt.Sprintf("issue:%s/room:%s", room.IssueID, roomID)
	}

	contextSummary := fmt.Sprintf("Respond in %s for trigger message %s.", currentTarget, triggerMessageID)
	if trigger.ActorName != "" {
		contextSummary = fmt.Sprintf("%s Triggered by %s.", contextSummary, trigger.ActorName)
	}

	return core.EventFrame{
		CurrentTarget:         currentTarget,
		SourceTarget:          currentTarget,
		SourceMessageID:       triggerMessageID,
		RequestedBy:           trigger.ActorName,
		RelatedIssueID:        room.IssueID,
		RecentMessagesSummary: strings.Join(recentSummaryParts, " | "),
		ExpectedAction:        intentType,
		ContextSummary:        contextSummary,
	}
}

func (s *MemoryStore) nextAgentTurnSequenceLocked(sessionID string) int {
	sequence := 1
	for i := len(s.agentTurns) - 1; i >= 0; i-- {
		if s.agentTurns[i].SessionID == sessionID {
			sequence = s.agentTurns[i].Sequence + 1
			break
		}
	}
	return sequence
}

func isHumanInstructionMessageKind(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "message", "instruction":
		return true
	default:
		return false
	}
}

func (s *MemoryStore) agentSessionIndexByIDLocked(sessionID string) (int, bool) {
	for i := range s.agentSessions {
		if s.agentSessions[i].ID == sessionID {
			return i, true
		}
	}
	return 0, false
}

func (s *MemoryStore) findAgentByActorLocked(actorName string) (core.Agent, bool) {
	normalizedActor := normalizeMentionToken(actorName)
	if normalizedActor == "" {
		return core.Agent{}, false
	}
	for _, agent := range s.agents {
		if normalizedActor == normalizeMentionToken(agent.ID) || normalizedActor == normalizeMentionToken(agent.Name) {
			return agent, true
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) findMentionedAgentLocked(body string) (core.Agent, bool) {
	for _, token := range strings.Fields(body) {
		if !strings.HasPrefix(token, "@") {
			continue
		}
		normalized := normalizeMentionToken(token)
		if normalized == "" {
			continue
		}
		for _, agent := range s.agents {
			if normalized == normalizeMentionToken(agent.ID) || normalized == normalizeMentionToken(agent.Name) {
				return agent, true
			}
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) selectVisibleReplyAgentLocked(roomID string) (core.Agent, bool) {
	if agent, ok := s.findMostRecentlyUpdatedSessionAgentLocked(roomID); ok {
		return agent, true
	}
	if agent, ok := s.findMostRecentAgentSpeakerLocked(roomID); ok {
		return agent, true
	}
	if agent, ok := s.findMostRecentlyActiveAgentLocked(); ok {
		return agent, true
	}
	for _, agent := range s.agents {
		return agent, true
	}
	return core.Agent{}, false
}

func (s *MemoryStore) findMostRecentlyUpdatedSessionAgentLocked(roomID string) (core.Agent, bool) {
	bestUpdatedAt := ""
	bestAgent := core.Agent{}
	found := false
	for _, session := range s.agentSessions {
		if session.RoomID != roomID {
			continue
		}
		agent, ok := s.findAgentByActorLocked(session.AgentID)
		if !ok {
			continue
		}
		if !found || session.UpdatedAt > bestUpdatedAt {
			bestUpdatedAt = session.UpdatedAt
			bestAgent = agent
			found = true
		}
	}
	return bestAgent, found
}

func (s *MemoryStore) findMostRecentAgentSpeakerLocked(roomID string) (core.Agent, bool) {
	for i := len(s.messagesByRoom[roomID]) - 1; i >= 0; i-- {
		message := s.messagesByRoom[roomID][i]
		if message.ActorType != "agent" {
			continue
		}
		if agent, ok := s.findAgentByActorLocked(message.ActorName); ok {
			return agent, true
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) findMostRecentlyActiveAgentLocked() (core.Agent, bool) {
	bestCreatedAt := ""
	bestAgent := core.Agent{}
	found := false
	for _, messages := range s.messagesByRoom {
		for _, message := range messages {
			if message.ActorType != "agent" {
				continue
			}
			agent, ok := s.findAgentByActorLocked(message.ActorName)
			if !ok {
				continue
			}
			if !found || message.CreatedAt > bestCreatedAt {
				bestCreatedAt = message.CreatedAt
				bestAgent = agent
				found = true
			}
		}
	}
	return bestAgent, found
}

func (s *MemoryStore) findResolvableAgentWaitIndexLocked(roomID string, message core.Message) (int, bool) {
	candidateAgentID := ""
	if agent, ok := s.findMentionedAgentLocked(message.Body); ok {
		candidateAgentID = agent.ID
	}

	matchIndex := -1
	openCount := 0
	for i := len(s.agentWaits) - 1; i >= 0; i-- {
		wait := s.agentWaits[i]
		if wait.RoomID != roomID || wait.Status != "waiting_human" {
			continue
		}
		openCount++
		if candidateAgentID != "" && wait.AgentID == candidateAgentID {
			return i, true
		}
		if matchIndex == -1 {
			matchIndex = i
		}
	}

	if candidateAgentID == "" && openCount == 1 && matchIndex >= 0 {
		return matchIndex, true
	}
	return -1, false
}

func (s *MemoryStore) hasOpenAgentWaitForSessionLocked(sessionID string) bool {
	for _, wait := range s.agentWaits {
		if wait.SessionID == sessionID && wait.Status == "waiting_human" {
			return true
		}
	}
	return false
}

func (s *MemoryStore) hasQueuedHandoffForSessionLocked(sessionID string) bool {
	for _, record := range s.handoffRecords {
		if record.FromSessionID == sessionID && record.Status == "queued" {
			return true
		}
	}
	return false
}

func (s *MemoryStore) completeHandoffForTurnLocked(turnID string) {
	for i := range s.handoffRecords {
		if s.handoffRecords[i].AcceptedTurnID == turnID {
			s.handoffRecords[i].Status = "accepted"
		}
	}
}

func normalizeMentionToken(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "@"))
	value = strings.Trim(value, ".,:;!?()[]{}<>")
	return strings.ToLower(value)
}

func (s *MemoryStore) findMessageByIDLocked(roomID, messageID string) (core.Message, bool) {
	for _, message := range s.messagesByRoom[roomID] {
		if message.ID == messageID {
			return message, true
		}
	}
	return core.Message{}, false
}

func (s *MemoryStore) recentMessagesForRoomLocked(roomID string, limit int) []core.Message {
	messages := s.messagesByRoom[roomID]
	if limit <= 0 || len(messages) <= limit {
		return messages
	}
	return messages[len(messages)-limit:]
}

func (s *MemoryStore) appendInboxItemLocked(title, kind, severity, summary, relatedEntityType, relatedEntityID, primaryActionType string) {
	s.nextInboxID++
	item := core.InboxItem{
		ID:                fmt.Sprintf("inbox_%03d", s.nextInboxID),
		Title:             title,
		Kind:              kind,
		Severity:          severity,
		Summary:           summary,
		RelatedEntityType: relatedEntityType,
		RelatedEntityID:   relatedEntityID,
		PrimaryActionType: primaryActionType,
	}
	s.inboxItems = append([]core.InboxItem{item}, s.inboxItems...)
}

func (s *MemoryStore) hasInboxItemLocked(relatedEntityType, relatedEntityID, primaryActionType string) bool {
	for _, item := range s.inboxItems {
		if item.RelatedEntityType == relatedEntityType && item.RelatedEntityID == relatedEntityID && item.PrimaryActionType == primaryActionType {
			return true
		}
	}
	return false
}

func (s *MemoryStore) resolveInboxItemsLocked(relatedEntityType, relatedEntityID string) {
	filtered := make([]core.InboxItem, 0, len(s.inboxItems))
	for _, item := range s.inboxItems {
		if item.RelatedEntityType == relatedEntityType && item.RelatedEntityID == relatedEntityID {
			continue
		}
		filtered = append(filtered, item)
	}
	s.inboxItems = filtered
}

func (s *MemoryStore) agentSessionsForRoom(roomID string) []core.AgentSession {
	sessions := make([]core.AgentSession, 0)
	for _, session := range s.agentSessions {
		if session.RoomID == roomID {
			sessions = append(sessions, session)
		}
	}
	return sessions
}

func (s *MemoryStore) agentTurnsForRoom(roomID string) []core.AgentTurn {
	turns := make([]core.AgentTurn, 0)
	for _, turn := range s.agentTurns {
		if turn.RoomID == roomID {
			turns = append(turns, turn)
		}
	}
	return turns
}

func (s *MemoryStore) agentWaitsForRoom(roomID string) []core.AgentWait {
	waits := make([]core.AgentWait, 0)
	for _, wait := range s.agentWaits {
		if wait.RoomID == roomID {
			waits = append(waits, wait)
		}
	}
	return waits
}

func (s *MemoryStore) handoffRecordsForRoom(roomID string) []core.HandoffRecord {
	records := make([]core.HandoffRecord, 0)
	for _, record := range s.handoffRecords {
		if record.RoomID == roomID {
			records = append(records, record)
		}
	}
	return records
}

func (s *MemoryStore) RoomIDForAgentTurn(turnID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, turn := range s.agentTurns {
		if turn.ID == turnID {
			return turn.RoomID, true
		}
	}
	return "", false
}

func (s *MemoryStore) IssueIDForAgentTurn(turnID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, turn := range s.agentTurns {
		if turn.ID != turnID {
			continue
		}
		room, ok := s.findRoomByIDLocked(turn.RoomID)
		if !ok || strings.TrimSpace(room.IssueID) == "" {
			return "", false
		}
		return room.IssueID, true
	}
	return "", false
}

func (s *MemoryStore) findRoomByIssue(issueID string) (core.RoomSummary, bool) {
	for _, room := range s.rooms {
		if room.Kind == "issue" && room.IssueID == issueID {
			return room, true
		}
	}
	return core.RoomSummary{}, false
}

func (s *MemoryStore) findRoomByIDLocked(roomID string) (core.RoomSummary, bool) {
	for _, room := range s.rooms {
		if room.ID == roomID {
			return room, true
		}
	}
	return core.RoomSummary{}, false
}

func (s *MemoryStore) resolveRoomTargetLocked(targetID string) (roomID, issueID string) {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return "", ""
	}

	if room, ok := s.findRoomByIDLocked(targetID); ok {
		return room.ID, room.IssueID
	}
	if room, ok := s.findRoomByIssue(targetID); ok {
		return room.ID, room.IssueID
	}

	return targetID, ""
}

func (s *MemoryStore) tasksForIssue(issueID string) []core.Task {
	tasks := make([]core.Task, 0)
	for _, task := range s.tasks {
		if task.IssueID == issueID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

func (s *MemoryStore) runsForIssue(issueID string) []core.Run {
	taskIDs := map[string]struct{}{}
	for _, task := range s.tasks {
		if task.IssueID == issueID {
			taskIDs[task.ID] = struct{}{}
		}
	}
	runs := make([]core.Run, 0)
	for _, run := range s.runs {
		if _, ok := taskIDs[run.TaskID]; ok {
			runs = append(runs, run)
		}
	}
	return runs
}

func (s *MemoryStore) mergeAttemptsForIssue(issueID string) []core.MergeAttempt {
	attempts := make([]core.MergeAttempt, 0)
	for _, attempt := range s.mergeAttempts {
		if attempt.IssueID == issueID {
			attempts = append(attempts, attempt)
		}
	}
	return attempts
}

func (s *MemoryStore) runOutputChunksForIssue(issueID string) []core.RunOutputChunk {
	taskIDs := map[string]struct{}{}
	for _, task := range s.tasks {
		if task.IssueID == issueID {
			taskIDs[task.ID] = struct{}{}
		}
	}
	runIDs := map[string]struct{}{}
	for _, run := range s.runs {
		if _, ok := taskIDs[run.TaskID]; ok {
			runIDs[run.ID] = struct{}{}
		}
	}
	chunks := make([]core.RunOutputChunk, 0)
	for _, chunk := range s.runOutputChunks {
		if _, ok := runIDs[chunk.RunID]; ok {
			chunks = append(chunks, chunk)
		}
	}
	return chunks
}

func (s *MemoryStore) toolCallsForIssue(issueID string) []core.ToolCall {
	taskIDs := map[string]struct{}{}
	for _, task := range s.tasks {
		if task.IssueID == issueID {
			taskIDs[task.ID] = struct{}{}
		}
	}
	runIDs := map[string]struct{}{}
	for _, run := range s.runs {
		if _, ok := taskIDs[run.TaskID]; ok {
			runIDs[run.ID] = struct{}{}
		}
	}
	toolCalls := make([]core.ToolCall, 0)
	for _, toolCall := range s.toolCalls {
		if _, ok := runIDs[toolCall.RunID]; ok {
			toolCalls = append(toolCalls, toolCall)
		}
	}
	return toolCalls
}

func (s *MemoryStore) integrationForIssue(issueID string) core.IntegrationBranch {
	for _, branch := range s.integrationBranches {
		if branch.IssueID == issueID {
			return branch
		}
	}
	return core.IntegrationBranch{}
}

func (s *MemoryStore) deliveryPRForIssue(issueID string) *core.DeliveryPR {
	for _, pr := range s.deliveryPRs {
		if pr.IssueID == issueID {
			value := pr
			return &value
		}
	}
	return nil
}

func (s *MemoryStore) integrationBranchByIssueLocked(issueID string) *core.IntegrationBranch {
	for i := range s.integrationBranches {
		if s.integrationBranches[i].IssueID == issueID {
			return &s.integrationBranches[i]
		}
	}
	return nil
}

func (s *MemoryStore) appendRunOutputChunkLocked(runID, stream, content string) {
	sequence := 1
	for i := len(s.runOutputChunks) - 1; i >= 0; i-- {
		if s.runOutputChunks[i].RunID == runID {
			sequence = s.runOutputChunks[i].Sequence + 1
			break
		}
	}

	s.nextRunOutputID++
	chunk := core.RunOutputChunk{
		ID:        fmt.Sprintf("run_output_%03d", s.nextRunOutputID),
		RunID:     runID,
		Sequence:  sequence,
		Stream:    stream,
		Content:   content,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.runOutputChunks = append(s.runOutputChunks, chunk)
}

func (s *MemoryStore) appendToolCallLocked(runID string, input core.ToolCallInput) {
	sequence := s.nextToolCallSequenceLocked(runID)
	s.nextToolCallID++
	toolCall := core.ToolCall{
		ID:        fmt.Sprintf("tool_call_%03d", s.nextToolCallID),
		RunID:     runID,
		Sequence:  sequence,
		ToolName:  input.ToolName,
		Arguments: input.Arguments,
		Status:    normalizedToolCallStatus(input.Status),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.toolCalls = append(s.toolCalls, toolCall)
}

func (s *MemoryStore) nextToolCallSequenceLocked(runID string) int {
	sequence := 1
	for i := len(s.toolCalls) - 1; i >= 0; i-- {
		if s.toolCalls[i].RunID == runID {
			sequence = s.toolCalls[i].Sequence + 1
			break
		}
	}
	return sequence
}

func normalizedToolCallStatus(status string) string {
	value := strings.TrimSpace(status)
	if value == "" {
		return "completed"
	}
	return value
}

func normalizeEditableTaskStatus(status string) (string, error) {
	value := strings.TrimSpace(status)
	switch value {
	case "todo", "in_progress", "blocked", "ready_for_integration":
		return value, nil
	default:
		return "", errors.New("unsupported editable task status")
	}
}

func normalizedStream(stream string) string {
	value := strings.TrimSpace(stream)
	if value == "" {
		return "stdout"
	}
	return value
}

func buildRunInstruction(task core.Task) string {
	actorID := strings.TrimSpace(task.AssigneeAgentID)
	if actorID == "" {
		actorID = "agent_runtime"
	}

	parts := []string{
		fmt.Sprintf("Task ID: %s", task.ID),
		fmt.Sprintf("Task: %s", task.Title),
		fmt.Sprintf("Branch: %s", task.BranchName),
	}
	if strings.TrimSpace(task.AssigneeAgentID) != "" {
		parts = append(parts, fmt.Sprintf("Agent ID: %s", task.AssigneeAgentID))
	}
	if strings.TrimSpace(task.Description) != "" {
		parts = append(parts, fmt.Sprintf("Description: %s", task.Description))
	}
	parts = append(parts,
		"This is a single-run execution for the current task branch. Complete the work, verify it, summarize the result, and then stop.",
		"Modify the working tree for this task and summarize the result.",
		"The OpenShock CLI is available as `openshock` during execution.",
		"Once you begin implementation work, update the task to in_progress early instead of waiting until the end.",
		fmt.Sprintf("If you are actively working on this task, you may update status with: openshock task status set --task %s --status in_progress --actor-id %s", task.ID, actorID),
		"If you report progress, that does not mean the run is complete. Finish code changes and validation before stopping.",
		fmt.Sprintf("If you are blocked by a real dependency or missing context, set blocked with: openshock task status set --task %s --status blocked --actor-id %s", task.ID, actorID),
		"If you are blocked, explain the real blocker in your final summary.",
		fmt.Sprintf("When the task is ready for integration, mark it ready with: openshock task mark-ready --task %s --actor-id %s", task.ID, actorID),
		"Your final summary should include both the code changes and the verification you ran.",
	)
	return strings.Join(parts, "\n")
}

func (s *MemoryStore) requestMergeLocked(taskID string) (core.ActionResponse, error) {
	taskIndex, ok := s.taskIndexByIDLocked(taskID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	if s.tasks[taskIndex].Status == "integrated" {
		return core.ActionResponse{}, errors.New("task is already integrated")
	}

	issueID := s.tasks[taskIndex].IssueID
	branch := s.integrationBranchByIssueLocked(issueID)
	if branch == nil {
		return core.ActionResponse{}, ErrNotFound
	}
	if s.tasks[taskIndex].Status != "integrated" {
		s.tasks[taskIndex].Status = "ready_for_integration"
	}
	s.appendSystemMessageLocked(
		issueID,
		"approval_required",
		fmt.Sprintf("Merge request for %s needs human approval before it can touch the integration branch.", s.tasks[taskIndex].Title),
	)
	if !s.hasInboxItemLocked("task", taskID, "GitIntegration.merge.approve") {
		s.appendInboxItemLocked(
			"Merge Request Needs Approval",
			"approval_required",
			"high",
			fmt.Sprintf("%s requested integration review for %s.", s.tasks[taskIndex].AssigneeAgentID, s.tasks[taskIndex].Title),
			"task",
			taskID,
			"GitIntegration.merge.approve",
		)
	}

	return core.ActionResponse{
		Status:        "approval_required",
		ResultCode:    "merge_requires_review",
		ResultMessage: "Integration merge requires human review before execution.",
		AffectedEntities: []core.ActionEntity{
			{Type: "task", ID: taskID},
			{Type: "integration_branch", ID: branch.ID},
		},
	}, nil
}
