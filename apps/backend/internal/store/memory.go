package store

import (
	"crypto/rand"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"openshock/backend/internal/core"
	"openshock/backend/internal/storestate"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")
var ErrUnauthorized = errors.New("unauthorized")

const agentTurnObservabilityRetention = 48 * time.Hour
const runtimeHeartbeatTTL = 15 * time.Second

type MemoryStore struct {
	mu                      sync.RWMutex
	workspaces              []core.Workspace
	defaultWorkspaceID      string
	defaultRoomIDs          map[string]string
	defaultIssueIDs         map[string]string
	rooms                   []core.RoomSummary
	agents                  []core.Agent
	runtimes                []core.Runtime
	issues                  []core.Issue
	messagesByRoom          map[string][]core.Message
	agentSessions           []core.AgentSession
	agentTurns              []core.AgentTurn
	agentTurnOutputChunks   []core.AgentTurnOutputChunk
	agentTurnToolCalls      []core.AgentTurnToolCall
	handoffRecords          []core.HandoffRecord
	tasks                   []core.Task
	runs                    []core.Run
	runOutputChunks         []core.RunOutputChunk
	toolCalls               []core.ToolCall
	mergeAttempts           []core.MergeAttempt
	integrationBranches     []core.IntegrationBranch
	deliveryPRs             []core.DeliveryPR
	inboxItems              []core.InboxItem
	repoWebhookEvents       map[string]core.RepoWebhookResponse
	members                 map[string]core.Member
	memberWorkspaceAccess   map[string]map[string]struct{}
	memberIDsByUsername     map[string]string
	passwordHashes          map[string]string
	authSessions            map[string]core.AuthSession
	roomReadBySession       map[string]map[string]string
	nextMessageID           int
	nextTaskID              int
	nextRunID               int
	nextRunOutputID         int
	nextToolCallID          int
	nextMergeAttemptID      int
	nextRuntimeID           int
	nextIssueID             int
	nextRoomID              int
	nextInboxID             int
	nextActionID            int
	nextAgentSessionID      int
	nextAgentTurnID         int
	nextAgentTurnOutputID   int
	nextAgentTurnToolCallID int
	nextHandoffID           int
	nextAgentID             int
	nextWorkspaceRepoID     int
	nextMemberID            int
	nextAuthSessionID       int
	actionResults           map[string]core.ActionResponse
}

func defaultWorkspace() core.Workspace {
	return core.Workspace{
		ID:           "ws_01",
		Name:         "OpenShock.ai",
		RepoBindings: []core.WorkspaceRepoBinding{},
	}
}

func cloneStringMap(src map[string]string) map[string]string {
	if src == nil {
		return map[string]string{}
	}

	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cloneMessagesByRoom(src map[string][]core.Message) map[string][]core.Message {
	if src == nil {
		return map[string][]core.Message{}
	}

	dst := make(map[string][]core.Message, len(src))
	for roomID, messages := range src {
		dst[roomID] = slices.Clone(messages)
	}
	return dst
}

func cloneRepoWebhookEvents(src map[string]core.RepoWebhookResponse) map[string]core.RepoWebhookResponse {
	if src == nil {
		return map[string]core.RepoWebhookResponse{}
	}

	dst := make(map[string]core.RepoWebhookResponse, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cloneMembers(src map[string]core.Member) map[string]core.Member {
	if src == nil {
		return map[string]core.Member{}
	}

	dst := make(map[string]core.Member, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cloneMemberWorkspaceAccess(src map[string][]string) map[string]map[string]struct{} {
	if src == nil {
		return map[string]map[string]struct{}{}
	}

	dst := make(map[string]map[string]struct{}, len(src))
	for memberID, workspaceIDs := range src {
		scopes := make(map[string]struct{}, len(workspaceIDs))
		for _, workspaceID := range workspaceIDs {
			trimmed := strings.TrimSpace(workspaceID)
			if trimmed == "" {
				continue
			}
			scopes[trimmed] = struct{}{}
		}
		dst[memberID] = scopes
	}
	return dst
}

func snapshotMemberWorkspaceAccess(src map[string]map[string]struct{}) map[string][]string {
	if src == nil {
		return map[string][]string{}
	}

	dst := make(map[string][]string, len(src))
	for memberID, workspaceIDs := range src {
		values := make([]string, 0, len(workspaceIDs))
		for workspaceID := range workspaceIDs {
			values = append(values, workspaceID)
		}
		slices.Sort(values)
		dst[memberID] = values
	}
	return dst
}

func cloneAuthSessions(src map[string]core.AuthSession) map[string]core.AuthSession {
	if src == nil {
		return map[string]core.AuthSession{}
	}

	dst := make(map[string]core.AuthSession, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cloneRoomReadBySession(src map[string]map[string]string) map[string]map[string]string {
	if src == nil {
		return map[string]map[string]string{}
	}

	dst := make(map[string]map[string]string, len(src))
	for sessionID, roomReads := range src {
		dst[sessionID] = cloneStringMap(roomReads)
	}
	return dst
}

func cloneActionResults(src map[string]core.ActionResponse) map[string]core.ActionResponse {
	if src == nil {
		return map[string]core.ActionResponse{}
	}

	dst := make(map[string]core.ActionResponse, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func defaultWorkspaceDiscussionRooms() []core.RoomSummary {
	return []core.RoomSummary{
		{WorkspaceID: "ws_01", ID: "room_001", Kind: "discussion", Title: "all", UnreadCount: 1},
		{WorkspaceID: "ws_01", ID: "room_002", Kind: "discussion", Title: "annoucement", UnreadCount: 1},
	}
}

func defaultWorkspaceDiscussionMessages() map[string][]core.Message {
	return map[string][]core.Message{
		"room_001": {
			{
				ID:        "msg_001",
				ActorType: "system",
				ActorName: "OpenShock",
				Kind:      "summary",
				Body:      "Workspace initialized. Use this room for discussion that should stay visible to the whole workspace.",
				CreatedAt: "2026-04-11T00:00:00Z",
			},
		},
		"room_002": {
			{
				ID:        "msg_002",
				ActorType: "system",
				ActorName: "OpenShock",
				Kind:      "summary",
				Body:      "Use this room for workspace-wide announcements, notices, and status updates.",
				CreatedAt: "2026-04-11T00:01:00Z",
			},
		},
	}
}

func directMessageRoomTitle(agent core.Agent) string {
	if strings.TrimSpace(agent.Name) != "" {
		return agent.Name
	}
	return agent.ID
}

func newMemoryStoreFromSnapshot(snapshot storestate.MemoryStoreSnapshot) *MemoryStore {
	store := &MemoryStore{
		workspaces:              slices.Clone(snapshot.Workspaces),
		defaultWorkspaceID:      snapshot.DefaultWorkspaceID,
		defaultRoomIDs:          cloneStringMap(snapshot.DefaultRoomIDs),
		defaultIssueIDs:         cloneStringMap(snapshot.DefaultIssueIDs),
		rooms:                   slices.Clone(snapshot.Rooms),
		agents:                  slices.Clone(snapshot.Agents),
		runtimes:                slices.Clone(snapshot.Runtimes),
		issues:                  slices.Clone(snapshot.Issues),
		messagesByRoom:          cloneMessagesByRoom(snapshot.MessagesByRoom),
		agentSessions:           slices.Clone(snapshot.AgentSessions),
		agentTurns:              slices.Clone(snapshot.AgentTurns),
		agentTurnOutputChunks:   slices.Clone(snapshot.AgentTurnOutputChunks),
		agentTurnToolCalls:      slices.Clone(snapshot.AgentTurnToolCalls),
		handoffRecords:          slices.Clone(snapshot.HandoffRecords),
		tasks:                   slices.Clone(snapshot.Tasks),
		runs:                    slices.Clone(snapshot.Runs),
		runOutputChunks:         slices.Clone(snapshot.RunOutputChunks),
		toolCalls:               slices.Clone(snapshot.ToolCalls),
		mergeAttempts:           slices.Clone(snapshot.MergeAttempts),
		integrationBranches:     slices.Clone(snapshot.IntegrationBranches),
		deliveryPRs:             slices.Clone(snapshot.DeliveryPRs),
		inboxItems:              slices.Clone(snapshot.InboxItems),
		repoWebhookEvents:       cloneRepoWebhookEvents(snapshot.RepoWebhookEvents),
		members:                 cloneMembers(snapshot.Members),
		memberWorkspaceAccess:   cloneMemberWorkspaceAccess(snapshot.MemberWorkspaceAccess),
		memberIDsByUsername:     cloneStringMap(snapshot.MemberIDsByUsername),
		passwordHashes:          cloneStringMap(snapshot.PasswordHashes),
		authSessions:            cloneAuthSessions(snapshot.AuthSessions),
		roomReadBySession:       cloneRoomReadBySession(snapshot.RoomReadBySession),
		nextMessageID:           snapshot.NextMessageID,
		nextTaskID:              snapshot.NextTaskID,
		nextRunID:               snapshot.NextRunID,
		nextRunOutputID:         snapshot.NextRunOutputID,
		nextToolCallID:          snapshot.NextToolCallID,
		nextMergeAttemptID:      snapshot.NextMergeAttemptID,
		nextRuntimeID:           snapshot.NextRuntimeID,
		nextIssueID:             snapshot.NextIssueID,
		nextRoomID:              snapshot.NextRoomID,
		nextInboxID:             snapshot.NextInboxID,
		nextActionID:            snapshot.NextActionID,
		nextAgentSessionID:      snapshot.NextAgentSessionID,
		nextAgentTurnID:         snapshot.NextAgentTurnID,
		nextAgentTurnOutputID:   snapshot.NextAgentTurnOutputID,
		nextAgentTurnToolCallID: snapshot.NextAgentTurnToolCallID,
		nextHandoffID:           snapshot.NextHandoffID,
		nextAgentID:             snapshot.NextAgentID,
		nextWorkspaceRepoID:     snapshot.NextWorkspaceRepoID,
		nextMemberID:            snapshot.NextMemberID,
		nextAuthSessionID:       snapshot.NextAuthSessionID,
		actionResults:           cloneActionResults(snapshot.ActionResults),
	}
	for _, workspace := range store.workspaces {
		store.ensureDirectMessageRoomsForWorkspaceLocked(workspace.ID)
		store.ensureWorkspaceDefaultDiscussionAgentSessionsLocked(workspace.ID)
	}
	return store
}

func NewMemoryStore() *MemoryStore {
	return newMemoryStoreFromSnapshot(storestate.MemoryStoreSnapshot{
		Workspaces:         []core.Workspace{defaultWorkspace()},
		DefaultWorkspaceID: "ws_01",
		DefaultRoomIDs: map[string]string{
			"ws_01": "room_001",
		},
		DefaultIssueIDs: map[string]string{
			"ws_01": "",
		},
		Rooms:                   defaultWorkspaceDiscussionRooms(),
		Agents:                  []core.Agent{},
		Runtimes:                []core.Runtime{},
		Issues:                  []core.Issue{},
		MessagesByRoom:          defaultWorkspaceDiscussionMessages(),
		AgentSessions:           []core.AgentSession{},
		AgentTurns:              []core.AgentTurn{},
		AgentTurnOutputChunks:   []core.AgentTurnOutputChunk{},
		AgentTurnToolCalls:      []core.AgentTurnToolCall{},
		HandoffRecords:          []core.HandoffRecord{},
		Tasks:                   []core.Task{},
		Runs:                    []core.Run{},
		RunOutputChunks:         []core.RunOutputChunk{},
		ToolCalls:               []core.ToolCall{},
		MergeAttempts:           []core.MergeAttempt{},
		IntegrationBranches:     []core.IntegrationBranch{},
		DeliveryPRs:             []core.DeliveryPR{},
		InboxItems:              []core.InboxItem{},
		RepoWebhookEvents:       map[string]core.RepoWebhookResponse{},
		Members:                 map[string]core.Member{},
		MemberWorkspaceAccess:   map[string][]string{},
		MemberIDsByUsername:     map[string]string{},
		PasswordHashes:          map[string]string{},
		AuthSessions:            map[string]core.AuthSession{},
		RoomReadBySession:       map[string]map[string]string{},
		NextMessageID:           2,
		NextTaskID:              0,
		NextRunID:               0,
		NextRunOutputID:         0,
		NextToolCallID:          0,
		NextMergeAttemptID:      0,
		NextRuntimeID:           0,
		NextIssueID:             0,
		NextRoomID:              2,
		NextInboxID:             0,
		NextActionID:            0,
		NextAgentSessionID:      0,
		NextAgentTurnID:         0,
		NextAgentTurnOutputID:   0,
		NextAgentTurnToolCallID: 0,
		NextHandoffID:           0,
		NextAgentID:             0,
		NextWorkspaceRepoID:     0,
		NextMemberID:            0,
		NextAuthSessionID:       0,
		ActionResults:           map[string]core.ActionResponse{},
	})
}

func NewMemoryStoreFromSnapshot(snapshot storestate.MemoryStoreSnapshot) *MemoryStore {
	store := newMemoryStoreFromSnapshot(snapshot)
	store.reconcileRuntimeHealthLocked(time.Now().UTC())
	return store
}

func (s *MemoryStore) BindWorkspaceRepo(workspaceID, repoPath, label string, makeDefault bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaceIndexByIDLocked(workspaceID); !ok {
		return ErrNotFound
	}

	_, err := s.bindWorkspaceRepoLocked(workspaceID, repoPath, label, makeDefault)
	return err
}

func (s *MemoryStore) BindWorkspaceRepoAction(workspaceID, repoPath, label string, makeDefault bool, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.workspaceIndexByIDLocked(workspaceID); !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	binding, err := s.bindWorkspaceRepoLocked(workspaceID, repoPath, label, makeDefault)
	if err != nil {
		return core.ActionResponse{}, err
	}

	actorName := s.resolveDisplayActorNameInWorkspaceLocked(workspaceID, actorID)
	if defaultBinding, ok := s.defaultWorkspaceRepoBindingLocked(workspaceID); ok {
		s.appendSystemMessageLocked(
			s.defaultRoomIDForWorkspaceLocked(workspaceID),
			"summary",
			fmt.Sprintf("%s set workspace default repo to %s.", actorName, defaultBinding.RepoPath),
		)
	}

	return core.ActionResponse{
		Status:        "completed",
		ResultCode:    "workspace_repo_bound",
		ResultMessage: "Workspace repo binding updated.",
		AffectedEntities: []core.ActionEntity{
			{Type: "workspace", ID: workspaceID},
			{Type: "workspace_repo_binding", ID: binding.ID},
		},
	}, nil
}

func (s *MemoryStore) Workspaces() []core.Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.workspacesLocked()
}

func (s *MemoryStore) WorkspacesForMember(memberID string) []core.Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()

	workspaces := make([]core.Workspace, 0, len(s.workspaces))
	for _, workspace := range s.workspaces {
		if !s.memberHasWorkspaceAccessLocked(memberID, workspace.ID) {
			continue
		}
		workspaces = append(workspaces, s.workspaceSnapshotLocked(workspace.ID))
	}
	return workspaces
}

func (s *MemoryStore) workspacesLocked() []core.Workspace {
	workspaces := make([]core.Workspace, 0, len(s.workspaces))
	for _, workspace := range s.workspaces {
		workspaces = append(workspaces, s.workspaceSnapshotLocked(workspace.ID))
	}
	return workspaces
}

func (s *MemoryStore) CreateWorkspace(name string) (core.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalizedName := strings.Join(strings.Fields(strings.TrimSpace(name)), " ")
	if normalizedName == "" {
		return core.Workspace{}, errors.New("workspace name is required")
	}

	suffix := len(s.workspaces) + 1
	workspaceID := fmt.Sprintf("ws_%02d", suffix)
	for {
		if _, ok := s.workspaceIndexByIDLocked(workspaceID); !ok {
			break
		}
		suffix++
		workspaceID = fmt.Sprintf("ws_%02d", suffix)
	}

	workspace := core.Workspace{
		ID:           workspaceID,
		Name:         normalizedName,
		RepoBindings: []core.WorkspaceRepoBinding{},
	}
	s.workspaces = append(s.workspaces, workspace)
	s.defaultRoomIDs[workspaceID] = ""
	s.defaultIssueIDs[workspaceID] = ""

	defaultRooms := []core.RoomSummary{
		{WorkspaceID: workspaceID, ID: s.nextRoomIdentifierLocked(), Kind: "discussion", Title: "all", UnreadCount: 0},
		{WorkspaceID: workspaceID, ID: s.nextRoomIdentifierLocked(), Kind: "discussion", Title: "annoucement", UnreadCount: 0},
	}
	s.rooms = append(s.rooms, defaultRooms...)
	s.defaultRoomIDs[workspaceID] = defaultRooms[0].ID
	for _, room := range defaultRooms {
		s.messagesByRoom[room.ID] = []core.Message{}
	}
	s.ensureDirectMessageRoomsForWorkspaceLocked(workspaceID)
	s.ensureWorkspaceDefaultDiscussionAgentSessionsLocked(workspaceID)
	s.appendSystemMessageLocked(defaultRooms[0].ID, "summary", "Workspace initialized. Use this room for discussion that should stay visible to the whole workspace.")
	s.appendSystemMessageLocked(defaultRooms[1].ID, "summary", "Use this room for workspace-wide announcements, notices, and status updates.")

	return s.workspaceSnapshotLocked(workspaceID), nil
}

func (s *MemoryStore) GrantMemberWorkspaceAccess(memberID, workspaceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.members[strings.TrimSpace(memberID)]; !ok {
		return ErrNotFound
	}
	if _, ok := s.workspaceIndexByIDLocked(strings.TrimSpace(workspaceID)); !ok {
		return ErrNotFound
	}
	s.grantMemberWorkspaceAccessLocked(memberID, workspaceID)
	return nil
}

func (s *MemoryStore) AddAgentToRoom(targetID, agentID, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, _, ok := s.resolveExistingRoomTargetLocked(targetID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	room, _ := s.findRoomByIDLocked(roomID)
	if room.Kind == "direct_message" {
		return core.ActionResponse{}, fmt.Errorf("%w: direct chats manage their agent automatically", ErrConflict)
	}

	agent, ok := s.resolveAgentReferenceInWorkspaceLocked(room.WorkspaceID, agentID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	if session, ok := s.findAgentSessionByRoomAndAgentLocked(roomID, agent.ID); ok {
		if session.JoinedRoom {
			return core.ActionResponse{
				Status:        "completed",
				ResultCode:    "room_agent_already_joined",
				ResultMessage: "Agent is already present in the room.",
				AffectedEntities: []core.ActionEntity{
					{Type: "room", ID: roomID},
					{Type: "agent", ID: agent.ID},
					{Type: "agent_session", ID: session.ID},
				},
			}, nil
		}
		if sessionIndex, found := s.agentSessionIndexByIDLocked(session.ID); found {
			s.agentSessions[sessionIndex].JoinedRoom = true
			s.agentSessions[sessionIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
			session = s.agentSessions[sessionIndex]
		}
	}

	sessionIndex := s.ensureAgentSessionLocked(roomID, agent.ID)
	s.agentSessions[sessionIndex].JoinedRoom = true
	session := s.agentSessions[sessionIndex]

	displayActor := s.resolveDisplayActorNameInWorkspaceLocked(room.WorkspaceID, actorID)
	s.appendSystemMessageLocked(
		roomID,
		"summary",
		fmt.Sprintf("%s added %s to this room.", displayActor, agent.Name),
	)

	affected := []core.ActionEntity{
		{Type: "room", ID: roomID},
		{Type: "agent", ID: agent.ID},
		{Type: "agent_session", ID: session.ID},
	}
	if messages := s.messagesByRoom[roomID]; len(messages) > 0 {
		affected = append(affected, core.ActionEntity{Type: "message", ID: messages[len(messages)-1].ID})
	}

	return core.ActionResponse{
		Status:           "completed",
		ResultCode:       "room_agent_joined",
		ResultMessage:    "Agent joined the room.",
		AffectedEntities: affected,
	}, nil
}

func (s *MemoryStore) RemoveAgentFromRoom(targetID, agentID, actorID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, _, ok := s.resolveExistingRoomTargetLocked(targetID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	room, _ := s.findRoomByIDLocked(roomID)
	if room.Kind == "direct_message" {
		return core.ActionResponse{}, fmt.Errorf("%w: direct chats manage their agent automatically", ErrConflict)
	}

	agent, ok := s.resolveAgentReferenceInWorkspaceLocked(room.WorkspaceID, agentID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	session, ok := s.findAgentSessionByRoomAndAgentLocked(roomID, agent.ID)
	if !ok || !session.JoinedRoom {
		return core.ActionResponse{
			Status:        "completed",
			ResultCode:    "room_agent_not_present",
			ResultMessage: "Agent is not currently joined to the room.",
			AffectedEntities: []core.ActionEntity{
				{Type: "room", ID: roomID},
				{Type: "agent", ID: agent.ID},
			},
		}, nil
	}

	if err := s.validateRoomAgentRemovalLocked(session); err != nil {
		return core.ActionResponse{}, err
	}

	sessionIndex, ok := s.agentSessionIndexByIDLocked(session.ID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	s.agentSessions[sessionIndex].JoinedRoom = false
	s.agentSessions[sessionIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	displayActor := s.resolveDisplayActorNameInWorkspaceLocked(room.WorkspaceID, actorID)
	s.appendSystemMessageLocked(
		roomID,
		"summary",
		fmt.Sprintf("%s removed %s from this room.", displayActor, agent.Name),
	)

	affected := []core.ActionEntity{
		{Type: "room", ID: roomID},
		{Type: "agent", ID: agent.ID},
		{Type: "agent_session", ID: session.ID},
	}
	if messages := s.messagesByRoom[roomID]; len(messages) > 0 {
		affected = append(affected, core.ActionEntity{Type: "message", ID: messages[len(messages)-1].ID})
	}

	return core.ActionResponse{
		Status:           "completed",
		ResultCode:       "room_agent_removed",
		ResultMessage:    "Agent removed from the room.",
		AffectedEntities: affected,
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
	return s.defaultWorkspaceID
}

func (s *MemoryStore) Bootstrap() core.BootstrapResponse {
	return s.BootstrapForWorkspace(s.WorkspaceID())
}

func (s *MemoryStore) BootstrapForWorkspace(workspaceID string) core.BootstrapResponse {
	return s.BootstrapForWorkspaceAndSession(workspaceID, "")
}

func (s *MemoryStore) BootstrapForWorkspaceAndSession(workspaceID, sessionID string) core.BootstrapResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	issueSummaries := make([]core.IssueSummary, 0, len(s.issues))
	for _, issue := range s.issues {
		if issue.WorkspaceID != resolvedWorkspaceID {
			continue
		}
		issueSummaries = append(issueSummaries, core.IssueSummary{
			WorkspaceID: issue.WorkspaceID,
			ID:          issue.ID,
			Title:       issue.Title,
			Status:      issue.Status,
		})
	}

	rooms := make([]core.RoomSummary, 0)
	directRooms := make([]core.RoomSummary, 0)
	for _, room := range s.rooms {
		if room.WorkspaceID != resolvedWorkspaceID {
			continue
		}
		room = s.roomSummaryForSessionLocked(room, sessionID)
		if room.Kind == "direct_message" {
			directRooms = append(directRooms, room)
			continue
		}
		rooms = append(rooms, room)
	}

	return core.BootstrapResponse{
		Workspace:      s.workspaceSnapshotLocked(resolvedWorkspaceID),
		DefaultRoomID:  s.defaultRoomIDs[resolvedWorkspaceID],
		DefaultIssueID: s.defaultIssueIDs[resolvedWorkspaceID],
		Rooms:          rooms,
		DirectRooms:    directRooms,
		Agents:         s.agentsForWorkspaceLocked(resolvedWorkspaceID),
		Runtimes:       slices.Clone(s.runtimes),
		IssueSummaries: issueSummaries,
	}
}

func (s *MemoryStore) Agents() []core.Agent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return slices.Clone(s.agents)
}

func (s *MemoryStore) AgentsForWorkspace(workspaceID string) []core.Agent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.agentsForWorkspaceLocked(s.normalizeWorkspaceIDLocked(workspaceID))
}

func (s *MemoryStore) CreateAgent(name, prompt string) (core.Agent, error) {
	return s.createAgent(s.defaultWorkspaceID, "", name, prompt)
}

func (s *MemoryStore) CreateAgentWithID(id, name, prompt string) (core.Agent, error) {
	return s.createAgent(s.defaultWorkspaceID, id, name, prompt)
}

func (s *MemoryStore) CreateAgentInWorkspace(workspaceID, name, prompt string) (core.Agent, error) {
	return s.createAgent(workspaceID, "", name, prompt)
}

func (s *MemoryStore) CreateAgentWithIDInWorkspace(workspaceID, id, name, prompt string) (core.Agent, error) {
	return s.createAgent(workspaceID, id, name, prompt)
}

func (s *MemoryStore) createAgent(workspaceID, id, name, prompt string) (core.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	if _, ok := s.workspaceIndexByIDLocked(resolvedWorkspaceID); !ok {
		return core.Agent{}, ErrNotFound
	}
	normalizedID := strings.TrimSpace(id)
	normalizedName := strings.TrimSpace(name)
	normalizedPrompt := strings.TrimSpace(prompt)
	if err := validateAgentName(normalizedName); err != nil {
		return core.Agent{}, err
	}
	if normalizedPrompt == "" {
		return core.Agent{}, fmt.Errorf("%w: prompt is required", ErrConflict)
	}
	if _, ok := s.findAgentByNameLocked(normalizedName, ""); ok {
		return core.Agent{}, fmt.Errorf("%w: agent name already exists", ErrConflict)
	}
	if normalizedID != "" {
		if strings.ContainsAny(normalizedID, " \t\n\r") {
			return core.Agent{}, fmt.Errorf("%w: id cannot contain whitespace", ErrConflict)
		}
		if _, ok := s.findAgentByIDLocked(normalizedID); ok {
			return core.Agent{}, fmt.Errorf("%w: agent already exists", ErrConflict)
		}
	} else {
		normalizedID = s.nextAgentUUIDLocked()
	}

	agent := core.Agent{
		WorkspaceID: resolvedWorkspaceID,
		ID:          normalizedID,
		Name:        normalizedName,
		Prompt:      normalizedPrompt,
	}
	s.agents = append(s.agents, agent)
	s.ensureDirectMessageRoomLocked(resolvedWorkspaceID, agent)
	s.ensureWorkspaceDefaultDiscussionAgentSessionsLocked(resolvedWorkspaceID)
	return agent, nil
}

func (s *MemoryStore) UpdateAgent(agentID, name, prompt string) (core.Agent, error) {
	return s.UpdateAgentInWorkspace(s.defaultWorkspaceID, agentID, name, prompt)
}

func (s *MemoryStore) UpdateAgentInWorkspace(workspaceID, agentID, name, prompt string) (core.Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	normalizedName := strings.TrimSpace(name)
	normalizedPrompt := strings.TrimSpace(prompt)
	if normalizedPrompt == "" {
		return core.Agent{}, fmt.Errorf("%w: prompt is required", ErrConflict)
	}
	if err := validateAgentName(normalizedName); err != nil {
		return core.Agent{}, err
	}

	for i := range s.agents {
		if s.agents[i].ID == agentID && s.agents[i].WorkspaceID == resolvedWorkspaceID {
			if s.agents[i].Name != normalizedName {
				return core.Agent{}, fmt.Errorf("%w: agent name cannot be renamed", ErrConflict)
			}
			s.agents[i].Prompt = normalizedPrompt
			return s.agents[i], nil
		}
	}
	return core.Agent{}, ErrNotFound
}

func (s *MemoryStore) DeleteAgent(agentID string) error {
	return s.DeleteAgentInWorkspace(s.defaultWorkspaceID, agentID)
}

func (s *MemoryStore) DeleteAgentInWorkspace(workspaceID, agentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	index := -1
	for i := range s.agents {
		if s.agents[i].ID == agentID && s.agents[i].WorkspaceID == resolvedWorkspaceID {
			index = i
			break
		}
	}
	if index < 0 {
		return ErrNotFound
	}
	if reason, blocked := s.agentDeleteConflictReasonLocked(agentID); blocked {
		return fmt.Errorf("%w: %s", ErrConflict, reason)
	}

	s.agents = append(s.agents[:index], s.agents[index+1:]...)
	s.deleteDirectMessageRoomsLocked(resolvedWorkspaceID, agentID)
	return nil
}

func (s *MemoryStore) AgentDetail(agentID string) (core.AgentDetailResponse, error) {
	return s.AgentDetailForWorkspace("", agentID)
}

func (s *MemoryStore) AgentDetailForWorkspace(workspaceID, agentID string) (core.AgentDetailResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	agent, ok := s.findAgentByIDInWorkspaceLocked(resolvedWorkspaceID, agentID)
	if !ok {
		return core.AgentDetailResponse{}, ErrNotFound
	}

	roomIDs := map[string]struct{}{}
	turnIDs := map[string]struct{}{}
	triggerMessageIDs := map[string]struct{}{}
	sessions := make([]core.AgentSession, 0)
	turns := make([]core.AgentTurn, 0)
	handoffs := make([]core.HandoffRecord, 0)

	for _, session := range s.agentSessions {
		if session.AgentID != agentID {
			continue
		}
		if _, ok := s.findRoomByIDInWorkspaceLocked(resolvedWorkspaceID, session.RoomID); !ok {
			continue
		}
		sessions = append(sessions, session)
		roomIDs[session.RoomID] = struct{}{}
	}

	for _, turn := range s.agentTurns {
		if turn.AgentID != agentID {
			continue
		}
		if _, ok := s.findRoomByIDInWorkspaceLocked(resolvedWorkspaceID, turn.RoomID); !ok {
			continue
		}
		turns = append(turns, turn)
		roomIDs[turn.RoomID] = struct{}{}
		turnIDs[turn.ID] = struct{}{}
		if strings.TrimSpace(turn.TriggerMessageID) != "" {
			triggerMessageIDs[turn.TriggerMessageID] = struct{}{}
		}
	}

	for _, handoff := range s.handoffRecords {
		if handoff.FromAgentID != agentID && handoff.ToAgentID != agentID {
			continue
		}
		if _, ok := s.findRoomByIDInWorkspaceLocked(resolvedWorkspaceID, handoff.RoomID); !ok {
			continue
		}
		handoffs = append(handoffs, handoff)
		roomIDs[handoff.RoomID] = struct{}{}
	}

	rooms := make([]core.RoomSummary, 0, len(roomIDs))
	for _, room := range s.rooms {
		if room.WorkspaceID != resolvedWorkspaceID {
			continue
		}
		if _, ok := roomIDs[room.ID]; ok {
			rooms = append(rooms, room)
		}
	}

	messages := make([]core.Message, 0, len(triggerMessageIDs))
	for _, room := range rooms {
		for _, message := range s.messagesByRoom[room.ID] {
			if _, ok := triggerMessageIDs[message.ID]; ok {
				messages = append(messages, message)
			}
		}
	}

	outputChunks := make([]core.AgentTurnOutputChunk, 0)
	for _, chunk := range s.agentTurnOutputChunks {
		if _, ok := turnIDs[chunk.TurnID]; ok {
			outputChunks = append(outputChunks, chunk)
		}
	}

	toolCalls := make([]core.AgentTurnToolCall, 0)
	for _, toolCall := range s.agentTurnToolCalls {
		if _, ok := turnIDs[toolCall.TurnID]; ok {
			toolCalls = append(toolCalls, toolCall)
		}
	}

	return core.AgentDetailResponse{
		Workspace:             s.workspaceSnapshotLocked(resolvedWorkspaceID),
		Agent:                 agent,
		Rooms:                 rooms,
		Messages:              messages,
		AgentSessions:         sessions,
		AgentTurns:            turns,
		AgentTurnOutputChunks: outputChunks,
		AgentTurnToolCalls:    toolCalls,
		HandoffRecords:        handoffs,
	}, nil
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
	return s.IssueDetailForWorkspace("", issueID)
}

func (s *MemoryStore) IssueDetailForWorkspace(workspaceID, issueID string) (core.IssueDetailResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	issue, ok := s.findIssueInWorkspaceLocked(resolvedWorkspaceID, issueID)
	if !ok {
		return core.IssueDetailResponse{}, ErrNotFound
	}

	room, ok := s.findRoomByIssueInWorkspaceLocked(resolvedWorkspaceID, issueID)
	if !ok {
		return core.IssueDetailResponse{}, ErrNotFound
	}

	return core.IssueDetailResponse{
		Workspace:             s.workspaceSnapshotLocked(resolvedWorkspaceID),
		Issue:                 issue,
		Room:                  room,
		Channel:               core.RoomChannel{ID: "channel_" + room.ID, RoomID: room.ID, Name: "chat"},
		Messages:              slices.Clone(s.messagesByRoom[room.ID]),
		AgentSessions:         s.agentSessionsForRoom(room.ID),
		AgentTurns:            s.agentTurnsForRoom(room.ID),
		AgentTurnOutputChunks: s.agentTurnOutputChunksForRoom(room.ID),
		AgentTurnToolCalls:    s.agentTurnToolCallsForRoom(room.ID),
		HandoffRecords:        s.handoffRecordsForRoom(room.ID),
		Tasks:                 s.tasksForIssue(issueID),
		Runs:                  s.runsForIssue(issueID),
		RunOutputChunks:       s.runOutputChunksForIssue(issueID),
		ToolCalls:             s.toolCallsForIssue(issueID),
		MergeAttempts:         s.mergeAttemptsForIssue(issueID),
		IntegrationBranch:     s.integrationForIssue(issueID),
		DeliveryPR:            s.deliveryPRForIssue(issueID),
	}, nil
}

func (s *MemoryStore) RoomDetail(roomID string) (core.RoomDetailResponse, error) {
	return s.RoomDetailForWorkspace("", roomID)
}

func (s *MemoryStore) RoomDetailForWorkspace(workspaceID, roomID string) (core.RoomDetailResponse, error) {
	return s.RoomDetailForWorkspaceAndSession(workspaceID, roomID, "")
}

func (s *MemoryStore) RoomDetailForWorkspaceAndSession(workspaceID, roomID, sessionID string) (core.RoomDetailResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	room, ok := s.findRoomByIDInWorkspaceLocked(resolvedWorkspaceID, roomID)
	if !ok {
		return core.RoomDetailResponse{}, ErrNotFound
	}
	if strings.TrimSpace(sessionID) != "" {
		room = s.roomSummaryForSessionLocked(room, sessionID)
	}

	response := core.RoomDetailResponse{
		Workspace:             s.workspaceSnapshotLocked(resolvedWorkspaceID),
		Room:                  room,
		Channel:               core.RoomChannel{ID: "channel_" + room.ID, RoomID: room.ID, Name: "chat"},
		Messages:              slices.Clone(s.messagesByRoom[room.ID]),
		AgentSessions:         s.agentSessionsForRoom(room.ID),
		AgentTurns:            s.agentTurnsForRoom(room.ID),
		AgentTurnOutputChunks: s.agentTurnOutputChunksForRoom(room.ID),
		AgentTurnToolCalls:    s.agentTurnToolCallsForRoom(room.ID),
		HandoffRecords:        s.handoffRecordsForRoom(room.ID),
		Tasks:                 []core.Task{},
		Runs:                  []core.Run{},
		RunOutputChunks:       []core.RunOutputChunk{},
		ToolCalls:             []core.ToolCall{},
		MergeAttempts:         []core.MergeAttempt{},
		DeliveryPR:            nil,
	}

	if room.Kind == "issue" && strings.TrimSpace(room.IssueID) != "" {
		issue, ok := s.findIssueInWorkspaceLocked(resolvedWorkspaceID, room.IssueID)
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

func (s *MemoryStore) MarkRoomReadForWorkspaceAndSession(workspaceID, roomID, sessionID, messageID string) (core.RoomSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	room, ok := s.findRoomByIDInWorkspaceLocked(resolvedWorkspaceID, roomID)
	if !ok {
		return core.RoomSummary{}, ErrNotFound
	}
	if strings.TrimSpace(sessionID) != "" {
		if err := s.markRoomReadThroughMessageLocked(sessionID, room.ID, messageID); err != nil {
			return core.RoomSummary{}, err
		}
		room = s.roomSummaryForSessionLocked(room, sessionID)
	}

	return room, nil
}

func (s *MemoryStore) roomSummaryForSessionLocked(room core.RoomSummary, sessionID string) core.RoomSummary {
	resolvedSessionID := strings.TrimSpace(sessionID)
	if resolvedSessionID == "" {
		return room
	}

	room.UnreadCount = s.unreadCountForRoomSessionLocked(room.ID, resolvedSessionID)
	return room
}

func (s *MemoryStore) unreadCountForRoomSessionLocked(roomID, sessionID string) int {
	messages := s.messagesByRoom[roomID]
	if len(messages) == 0 {
		return 0
	}

	lastReadMessageID := strings.TrimSpace(s.lastReadMessageIDLocked(sessionID, roomID))
	if lastReadMessageID == "" {
		return len(messages)
	}

	count := 0
	seenLastRead := false
	for _, message := range messages {
		if !seenLastRead {
			if message.ID == lastReadMessageID {
				seenLastRead = true
			}
			continue
		}
		count++
	}

	if !seenLastRead {
		return len(messages)
	}
	return count
}

func (s *MemoryStore) lastReadMessageIDLocked(sessionID, roomID string) string {
	if roomState, ok := s.roomReadBySession[strings.TrimSpace(sessionID)]; ok {
		return strings.TrimSpace(roomState[strings.TrimSpace(roomID)])
	}
	return ""
}

func (s *MemoryStore) markRoomReadLocked(sessionID, roomID string) {
	resolvedSessionID := strings.TrimSpace(sessionID)
	resolvedRoomID := strings.TrimSpace(roomID)
	if resolvedSessionID == "" || resolvedRoomID == "" {
		return
	}

	messages := s.messagesByRoom[resolvedRoomID]
	if len(messages) == 0 {
		return
	}

	if s.roomReadBySession[resolvedSessionID] == nil {
		s.roomReadBySession[resolvedSessionID] = map[string]string{}
	}
	s.roomReadBySession[resolvedSessionID][resolvedRoomID] = messages[len(messages)-1].ID
}

func (s *MemoryStore) markRoomReadThroughMessageLocked(sessionID, roomID, messageID string) error {
	resolvedSessionID := strings.TrimSpace(sessionID)
	resolvedRoomID := strings.TrimSpace(roomID)
	resolvedMessageID := strings.TrimSpace(messageID)
	if resolvedSessionID == "" || resolvedRoomID == "" {
		return nil
	}
	if resolvedMessageID == "" {
		return fmt.Errorf("message id is required")
	}

	messages := s.messagesByRoom[resolvedRoomID]
	targetIndex := -1
	found := false
	for index, message := range messages {
		if message.ID == resolvedMessageID {
			found = true
			targetIndex = index
			break
		}
	}
	if !found {
		return fmt.Errorf("message %s not found in room %s", resolvedMessageID, resolvedRoomID)
	}

	if s.roomReadBySession[resolvedSessionID] == nil {
		s.roomReadBySession[resolvedSessionID] = map[string]string{}
	}
	currentMessageID := strings.TrimSpace(s.roomReadBySession[resolvedSessionID][resolvedRoomID])
	if currentMessageID != "" {
		currentIndex := -1
		for index, message := range messages {
			if message.ID == currentMessageID {
				currentIndex = index
				break
			}
		}
		if currentIndex > targetIndex {
			return nil
		}
	}
	s.roomReadBySession[resolvedSessionID][resolvedRoomID] = resolvedMessageID
	return nil
}

func (s *MemoryStore) TaskBoard() core.TaskBoardResponse {
	return s.TaskBoardForWorkspace("")
}

func (s *MemoryStore) TaskBoardForWorkspace(workspaceID string) core.TaskBoardResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	tasks := make([]core.Task, 0)
	for _, task := range s.tasks {
		if task.WorkspaceID == resolvedWorkspaceID {
			tasks = append(tasks, task)
		}
	}

	return core.TaskBoardResponse{
		Columns: []string{"todo", "in_progress", "ready_for_integration", "blocked", "integrated", "done"},
		Tasks:   tasks,
	}
}

func (s *MemoryStore) Inbox() core.InboxResponse {
	return s.InboxForWorkspace("")
}

func (s *MemoryStore) InboxForWorkspace(workspaceID string) core.InboxResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	items := make([]core.InboxItem, 0)
	for _, item := range s.inboxItems {
		if item.WorkspaceID == resolvedWorkspaceID {
			items = append(items, item)
		}
	}
	return core.InboxResponse{Items: items}
}

func (s *MemoryStore) RegisterRuntime(name, provider string, slotCount int) (core.Runtime, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalizedName := strings.TrimSpace(name)
	normalizedProvider := strings.TrimSpace(provider)
	normalizedSlotCount := normalizedRuntimeSlotCount(slotCount)
	now := time.Now().UTC()
	nowRFC3339 := now.Format(time.RFC3339)
	s.reconcileRuntimeHealthLocked(now)
	for i := range s.runtimes {
		if strings.TrimSpace(s.runtimes[i].Name) == normalizedName &&
			strings.TrimSpace(s.runtimes[i].Provider) == normalizedProvider &&
			!runtimeHeartbeatExpired(s.runtimes[i].LastHeartbeatAt, now) {
			return core.Runtime{}, fmt.Errorf("%w: runtime name %q is already active", ErrConflict, normalizedName)
		}
	}

	s.nextRuntimeID++
	runtime := core.Runtime{
		ID:              fmt.Sprintf("rt_%03d", s.nextRuntimeID),
		Name:            name,
		Status:          "online",
		Provider:        provider,
		SlotCount:       normalizedSlotCount,
		ActiveSlots:     0,
		LastHeartbeatAt: nowRFC3339,
	}
	s.runtimes = append(s.runtimes, runtime)
	s.reconcileRuntimeHealthLocked(now)
	return runtime, nil
}

func (s *MemoryStore) HeartbeatRuntime(runtimeID, status string) (core.Runtime, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	for i := range s.runtimes {
		if s.runtimes[i].ID == runtimeID {
			_ = status
			s.runtimes[i].LastHeartbeatAt = now.Format(time.RFC3339)
			s.reconcileRuntimeHealthLocked(now)
			return s.runtimes[i], nil
		}
	}

	return core.Runtime{}, ErrNotFound
}

func (s *MemoryStore) ClaimNextQueuedAgentTurn(runtimeID string) (core.AgentTurnExecution, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.AgentTurnExecution{}, false, ErrNotFound
	}
	if !s.runtimeHasAvailableSlotLocked(runtimeID) {
		return core.AgentTurnExecution{}, false, nil
	}

	for i := range s.agentTurns {
		if s.agentTurns[i].Status != "queued" {
			continue
		}

		sessionIndex, ok := s.agentSessionIndexByIDLocked(s.agentTurns[i].SessionID)
		if !ok {
			s.invalidateAgentTurnLocked(i)
			continue
		}
		if s.sessionHasActiveCodexWorkLocked(s.agentTurns[i].SessionID) {
			continue
		}

		room, ok := s.findRoomByIDLocked(s.agentTurns[i].RoomID)
		if !ok {
			s.invalidateAgentTurnLocked(i)
			continue
		}
		trigger, ok := s.findMessageByIDLocked(s.agentTurns[i].RoomID, s.agentTurns[i].TriggerMessageID)
		if !ok {
			s.invalidateAgentTurnLocked(i)
			continue
		}

		s.agentTurns[i].Status = "claimed"
		s.agentTurns[i].RuntimeID = runtimeID
		s.refreshRuntimeStatusLocked(runtimeID)
		s.refreshAgentSessionStateLocked(sessionIndex, s.agentSessions[sessionIndex].LastMessageID)

		session := s.agentSessions[sessionIndex]
		agentName := s.agentTurns[i].AgentID
		agentPrompt := ""
		if agent, ok := s.findAgentByIDLocked(s.agentTurns[i].AgentID); ok && strings.TrimSpace(agent.Name) != "" {
			agentName = agent.Name
			agentPrompt = strings.TrimSpace(agent.Prompt)
		}

		var issue *core.Issue
		tasks := []core.Task{}
		runs := []core.Run{}
		mergeAttempts := []core.MergeAttempt{}
		var integrationBranch *core.IntegrationBranch
		var deliveryPR *core.DeliveryPR
		if room.Kind == "issue" && strings.TrimSpace(room.IssueID) != "" {
			if hydratedIssue, ok := s.findIssueInWorkspaceLocked(room.WorkspaceID, room.IssueID); ok {
				issue = &hydratedIssue
			}
			tasks = s.tasksForIssue(room.IssueID)
			runs = s.runsForIssue(room.IssueID)
			mergeAttempts = s.mergeAttemptsForIssue(room.IssueID)
			branch := s.integrationForIssue(room.IssueID)
			integrationBranch = &branch
			deliveryPR = s.deliveryPRForIssue(room.IssueID)
		}

		execution := core.AgentTurnExecution{
			Turn:              s.agentTurns[i],
			Session:           session,
			Room:              room,
			AgentName:         agentName,
			AgentPrompt:       agentPrompt,
			Issue:             issue,
			Tasks:             tasks,
			Runs:              runs,
			MergeAttempts:     mergeAttempts,
			IntegrationBranch: integrationBranch,
			DeliveryPR:        deliveryPR,
			TriggerMessage:    trigger,
			Messages:          slices.Clone(s.recentMessagesForRoomLocked(s.agentTurns[i].RoomID, 12)),
		}
		execution.Instruction = buildAgentTurnInstruction(execution)

		return execution, true, nil
	}

	return core.AgentTurnExecution{}, false, nil
}

func (s *MemoryStore) invalidateAgentTurnLocked(turnIndex int) {
	now := time.Now().UTC().Format(time.RFC3339)
	s.agentTurns[turnIndex].Status = "completed"
	if sessionIndex, ok := s.agentSessionIndexByIDLocked(s.agentTurns[turnIndex].SessionID); ok {
		s.agentSessions[sessionIndex].Status = "blocked"
		s.agentSessions[sessionIndex].CurrentTurnID = s.agentTurns[turnIndex].ID
		s.agentSessions[sessionIndex].UpdatedAt = now
	}
}

func (s *MemoryStore) CompleteAgentTurn(turnID, runtimeID, resultMessageID, appServerThreadID string, clearAppServerThreadID bool) (core.AgentTurn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.AgentTurn{}, ErrNotFound
	}

	for i := range s.agentTurns {
		if s.agentTurns[i].ID != turnID {
			continue
		}
		if !runtimeOwnsAgentTurnLocked(s.agentTurns[i], runtimeID) {
			return core.AgentTurn{}, fmt.Errorf("%w: runtime does not own agent turn", ErrConflict)
		}

		s.agentTurns[i].Status = "completed"
		s.completeHandoffForTurnLocked(turnID)
		if sessionIndex, ok := s.agentSessionIndexByIDLocked(s.agentTurns[i].SessionID); ok {
			if clearAppServerThreadID {
				s.agentSessions[sessionIndex].AppServerThreadID = ""
			} else if threadID := strings.TrimSpace(appServerThreadID); threadID != "" {
				s.agentSessions[sessionIndex].AppServerThreadID = threadID
			}
			s.agentSessions[sessionIndex].LastMessageID = strings.TrimSpace(resultMessageID)
			s.refreshAgentSessionStateLocked(sessionIndex, resultMessageID)
		}
		s.refreshRuntimeStatusLocked(runtimeID)
		return s.agentTurns[i], nil
	}

	return core.AgentTurn{}, ErrNotFound
}

func (s *MemoryStore) IngestAgentTurnEvent(turnID, runtimeID, eventType, message string, stream string, toolCall *core.ToolCallInput) (core.AgentTurn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.AgentTurn{}, ErrNotFound
	}

	for i := range s.agentTurns {
		if s.agentTurns[i].ID != turnID {
			continue
		}
		if !runtimeOwnsAgentTurnLocked(s.agentTurns[i], runtimeID) {
			return core.AgentTurn{}, fmt.Errorf("%w: runtime does not own agent turn", ErrConflict)
		}

		switch eventType {
		case "output":
			content := strings.TrimSpace(message)
			if content != "" {
				s.appendAgentTurnOutputChunkLocked(turnID, normalizedStream(stream), content)
			}
		case "tool_call":
			if toolCall != nil && strings.TrimSpace(toolCall.ToolName) != "" {
				s.appendAgentTurnToolCallLocked(turnID, *toolCall)
			}
		default:
			return core.AgentTurn{}, errors.New("unsupported agent turn event type")
		}

		s.pruneAgentTurnObservabilityLocked(time.Now().UTC())
		return s.agentTurns[i], nil
	}

	return core.AgentTurn{}, ErrNotFound
}

func (s *MemoryStore) PostRoomMessage(targetID, actorType, actorName, kind, body string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, issueID, ok := s.resolveExistingRoomTargetLocked(targetID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	room, ok := s.findRoomByIDLocked(roomID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	messageKind := strings.TrimSpace(kind)
	if messageKind == "" {
		messageKind = "message"
	}
	resolvedActorName := strings.TrimSpace(actorName)
	if actorType == "agent" {
		if agent, ok := s.findAgentByActorInWorkspaceLocked(room.WorkspaceID, actorName); ok {
			resolvedActorName = agent.Name
		}
	}

	s.nextMessageID++
	message := core.Message{
		ID:        fmt.Sprintf("msg_%03d", s.nextMessageID),
		ActorType: actorType,
		ActorName: resolvedActorName,
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
	}, nil
}

func (s *MemoryStore) CreateIssue(title, summary, priority string) core.ActionResponse {
	return s.CreateIssueInWorkspace(s.WorkspaceID(), title, summary, priority)
}

func (s *MemoryStore) CreateIssueInWorkspace(workspaceID, title, summary, priority string) core.ActionResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	s.nextIssueID++

	issueID := fmt.Sprintf("issue_%03d", s.nextIssueID)
	roomID := s.nextRoomIdentifierLocked()
	branchID := fmt.Sprintf("ib_%s", issueID)

	issue := core.Issue{
		WorkspaceID: resolvedWorkspaceID,
		ID:          issueID,
		Title:       title,
		Status:      "todo",
		Priority:    priority,
		Summary:     summary,
	}
	room := core.RoomSummary{
		WorkspaceID: resolvedWorkspaceID,
		ID:          roomID,
		IssueID:     issueID,
		Kind:        "issue",
		Title:       title,
		UnreadCount: 0,
	}
	integrationBranch := core.IntegrationBranch{
		WorkspaceID:   resolvedWorkspaceID,
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
	s.defaultIssueIDs[resolvedWorkspaceID] = issueID
	s.defaultRoomIDs[resolvedWorkspaceID] = roomID
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
	return s.CreateDiscussionRoomInWorkspace(s.WorkspaceID(), title, summary)
}

func (s *MemoryStore) CreateDiscussionRoomInWorkspace(workspaceID, title, summary string) core.ActionResponse {
	s.mu.Lock()
	defer s.mu.Unlock()

	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)

	roomID := s.nextRoomIdentifierLocked()
	room := core.RoomSummary{
		WorkspaceID: resolvedWorkspaceID,
		ID:          roomID,
		Kind:        "discussion",
		Title:       title,
		UnreadCount: 0,
	}

	s.rooms = append(s.rooms, room)
	s.messagesByRoom[roomID] = []core.Message{}
	s.defaultRoomIDs[resolvedWorkspaceID] = roomID

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

func (s *MemoryStore) CreateTask(issueID, title, description, assigneeAgentID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.issueByIDLocked(issueID); !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	issueWorkspaceID, _ := s.workspaceIDForIssueLocked(issueID)
	agent, ok := s.resolveAgentReferenceInWorkspaceLocked(issueWorkspaceID, assigneeAgentID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	s.nextTaskID++
	taskID := fmt.Sprintf("task_%03d", s.nextTaskID)
	task := core.Task{
		WorkspaceID:     issueWorkspaceID,
		ID:              taskID,
		IssueID:         issueID,
		Title:           title,
		Description:     description,
		Status:          "todo",
		AssigneeAgentID: agent.ID,
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
	}, nil
}

func (s *MemoryStore) AssignTask(taskID, agentID string) (core.ActionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	taskWorkspaceID, ok := s.workspaceIDForTaskLocked(taskID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	agent, ok := s.resolveAgentReferenceInWorkspaceLocked(taskWorkspaceID, agentID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}

	for i := range s.tasks {
		if s.tasks[i].ID == taskID {
			s.tasks[i].AssigneeAgentID = agent.ID
			return core.ActionResponse{
				Status:        "completed",
				ResultCode:    "task_assigned",
				ResultMessage: "Task reassigned.",
				AffectedEntities: []core.ActionEntity{
					{Type: "task", ID: taskID},
					{Type: "agent", ID: agent.ID},
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
		actorName := s.resolveDisplayActorNameInWorkspaceLocked(s.tasks[taskIndex].WorkspaceID, actorID)
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

	for i := range s.tasks {
		if s.tasks[i].ID == taskID {
			if _, ok := s.defaultWorkspaceRepoPathLocked(s.tasks[i].WorkspaceID); !ok {
				return core.ActionResponse{}, errors.New("workspace 缺少默认 repo 绑定")
			}
			s.nextRunID++
			run := core.Run{
				WorkspaceID:   s.tasks[i].WorkspaceID,
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
			actorName := s.resolveDisplayActorNameInWorkspaceLocked(s.runs[i].WorkspaceID, actorID)
			s.appendSystemMessageLocked(
				issueID,
				"log",
				fmt.Sprintf("%s approved %s for another execution attempt.", actorName, s.runs[i].Title),
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
			s.refreshRuntimeStatusLocked(s.runs[i].RuntimeID)
		}
		if taskIndex, ok := s.taskIndexByIDLocked(s.runs[i].TaskID); ok {
			s.tasks[taskIndex].Status = "blocked"
		}
		s.resolveInboxItemsLocked("run", runID)
		if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
			actorName := s.resolveDisplayActorNameInWorkspaceLocked(s.runs[i].WorkspaceID, actorID)
			s.appendSystemMessageLocked(
				issueID,
				"blocked",
				fmt.Sprintf("%s cancelled %s before it reached integration.", actorName, s.runs[i].Title),
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
	repoPath, ok := s.defaultWorkspaceRepoPathLocked(s.tasks[taskIndex].WorkspaceID)
	if !ok {
		return core.ActionResponse{}, errors.New("workspace 缺少默认 repo 绑定")
	}
	mergeAttempt := core.MergeAttempt{
		WorkspaceID:  s.tasks[taskIndex].WorkspaceID,
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
	actorName := s.resolveDisplayActorNameInWorkspaceLocked(s.tasks[taskIndex].WorkspaceID, actorID)
	s.appendSystemMessageLocked(
		issueID,
		"log",
		fmt.Sprintf("%s approved merge for %s into %s.", actorName, s.tasks[taskIndex].Title, branch.Name),
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

	workspaceID, ok := s.workspaceIDForIssueLocked(issueID)
	if !ok {
		return core.ActionResponse{}, ErrNotFound
	}
	if _, ok := s.defaultWorkspaceRepoPathLocked(workspaceID); !ok {
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
		WorkspaceID:  workspaceID,
		ID:           prID,
		IssueID:      issueID,
		Title:        title,
		Status:       "open",
		ExternalPRID: fmt.Sprintf("gh_%s", prID),
		ExternalURL:  fmt.Sprintf("https://github.example.local/openshock/pull/%s", prID),
	}
	s.deliveryPRs = append(s.deliveryPRs, pr)
	s.setIssueStatusLocked(issueID, "in_review")
	actorName := s.resolveDisplayActorNameInWorkspaceLocked(workspaceID, actorID)
	s.appendSystemMessageLocked(
		issueID,
		"summary",
		fmt.Sprintf("%s created Delivery PR %s from %s.", actorName, pr.ID, branch.Name),
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

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.MergeAttempt{}, false, ErrNotFound
	}
	if !s.runtimeHasAvailableSlotLocked(runtimeID) {
		return core.MergeAttempt{}, false, nil
	}

	for i := range s.mergeAttempts {
		if s.mergeAttempts[i].Status == "queued" {
			if strings.TrimSpace(s.mergeAttempts[i].RepoPath) == "" {
				repoPath, ok := s.defaultWorkspaceRepoPathLocked(s.mergeAttempts[i].WorkspaceID)
				if !ok {
					return core.MergeAttempt{}, false, errors.New("workspace 缺少默认 repo 绑定")
				}
				s.mergeAttempts[i].RepoPath = repoPath
			}
			s.mergeAttempts[i].Status = "running"
			s.mergeAttempts[i].RuntimeID = runtimeID
			s.refreshRuntimeStatusLocked(runtimeID)
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

func (s *MemoryStore) ClaimNextQueuedRun(runtimeID string) (core.Run, *core.AgentSession, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.reconcileRuntimeHealthLocked(time.Now().UTC())

	if _, ok := s.findRuntimeLocked(runtimeID); !ok {
		return core.Run{}, nil, false, ErrNotFound
	}
	if !s.runtimeHasAvailableSlotLocked(runtimeID) {
		return core.Run{}, nil, false, nil
	}

	for i := range s.runs {
		if s.runs[i].Status == "queued" {
			s.hydrateRunLocked(&s.runs[i])
			if strings.TrimSpace(s.runs[i].RepoPath) == "" {
				return core.Run{}, nil, false, errors.New("workspace 缺少默认 repo 绑定")
			}
			agentSession := s.findExistingAgentSessionForRunLocked(s.runs[i])
			if agentSession != nil && s.sessionHasActiveCodexWorkLocked(agentSession.ID) {
				continue
			}
			s.runs[i].Status = "running"
			s.runs[i].RuntimeID = runtimeID
			s.refreshRuntimeStatusLocked(runtimeID)
			return s.runs[i], agentSession, true, nil
		}
	}

	return core.Run{}, nil, false, nil
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
		if !runtimeOwnsMergeAttemptLocked(s.mergeAttempts[i], runtimeID) {
			return core.MergeAttempt{}, fmt.Errorf("%w: runtime does not own merge attempt", ErrConflict)
		}

		if resultSummary != "" {
			s.mergeAttempts[i].ResultSummary = resultSummary
		}

		switch eventType {
		case "started":
			s.mergeAttempts[i].Status = "running"
			s.mergeAttempts[i].RuntimeID = runtimeID
			s.refreshRuntimeStatusLocked(runtimeID)
		case "succeeded":
			s.mergeAttempts[i].Status = "succeeded"
			s.refreshRuntimeStatusLocked(runtimeID)
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
			s.refreshRuntimeStatusLocked(runtimeID)
			if taskIndex, ok := s.taskIndexByIDLocked(s.mergeAttempts[i].TaskID); ok {
				s.tasks[taskIndex].Status = "blocked"
			}
			branch := s.integrationBranchByIssueLocked(s.mergeAttempts[i].IssueID)
			if branch != nil {
				branch.Status = "blocked"
			}
			s.appendInboxItemLocked(
				s.mergeAttempts[i].WorkspaceID,
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
			s.refreshRuntimeStatusLocked(runtimeID)
			if taskIndex, ok := s.taskIndexByIDLocked(s.mergeAttempts[i].TaskID); ok {
				s.tasks[taskIndex].Status = "blocked"
			}
			if branch := s.integrationBranchByIssueLocked(s.mergeAttempts[i].IssueID); branch != nil {
				branch.Status = "blocked"
			}
			s.appendInboxItemLocked(
				s.mergeAttempts[i].WorkspaceID,
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
		if !runtimeOwnsRunLocked(s.runs[i], runtimeID) {
			return core.Run{}, fmt.Errorf("%w: runtime does not own run", ErrConflict)
		}

		if outputPreview != "" {
			s.runs[i].OutputPreview = outputPreview
		}

		switch eventType {
		case "started":
			s.runs[i].Status = "running"
			s.runs[i].RuntimeID = runtimeID
			s.refreshRuntimeStatusLocked(runtimeID)
		case "output":
			if s.runs[i].Status == "queued" {
				s.runs[i].Status = "running"
				s.runs[i].RuntimeID = runtimeID
				s.refreshRuntimeStatusLocked(runtimeID)
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
				s.refreshRuntimeStatusLocked(runtimeID)
			}
			if toolCall != nil && strings.TrimSpace(toolCall.ToolName) != "" {
				s.appendToolCallLocked(runID, *toolCall)
			}
		case "blocked":
			s.runs[i].Status = "blocked"
			s.refreshRuntimeStatusLocked(runtimeID)
			if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
				s.appendSystemMessageLocked(
					issueID,
					"blocked",
					fmt.Sprintf("Run %s is blocked: %s", s.runs[i].Title, outputPreview),
				)
				s.appendInboxItemLocked(
					s.runs[i].WorkspaceID,
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
			s.refreshRuntimeStatusLocked(runtimeID)
			if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
				s.appendSystemMessageLocked(
					issueID,
					"blocked",
					fmt.Sprintf("Run %s requires approval: %s", s.runs[i].Title, outputPreview),
				)
				s.appendInboxItemLocked(
					s.runs[i].WorkspaceID,
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
			s.refreshRuntimeStatusLocked(runtimeID)
		case "failed":
			s.runs[i].Status = "failed"
			s.refreshRuntimeStatusLocked(runtimeID)
			if issueID, ok := s.issueIDForTaskLocked(s.runs[i].TaskID); ok {
				s.appendSystemMessageLocked(
					issueID,
					"blocked",
					fmt.Sprintf("Run %s failed: %s", s.runs[i].Title, outputPreview),
				)
				s.appendInboxItemLocked(
					s.runs[i].WorkspaceID,
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

func (s *MemoryStore) workspaceSnapshotLocked(workspaceID string) core.Workspace {
	if idx, ok := s.workspaceIndexByIDLocked(workspaceID); ok {
		snapshot := s.workspaces[idx]
		snapshot.RepoBindings = slices.Clone(s.workspaces[idx].RepoBindings)
		return snapshot
	}
	return core.Workspace{}
}

func (s *MemoryStore) workspaceIndexByIDLocked(workspaceID string) (int, bool) {
	for i := range s.workspaces {
		if s.workspaces[i].ID == workspaceID {
			return i, true
		}
	}
	return 0, false
}

func (s *MemoryStore) memberHasWorkspaceAccessLocked(memberID, workspaceID string) bool {
	resolvedMemberID := strings.TrimSpace(memberID)
	resolvedWorkspaceID := strings.TrimSpace(workspaceID)
	if resolvedMemberID == "" || resolvedWorkspaceID == "" {
		return false
	}
	workspaceIDs, ok := s.memberWorkspaceAccess[resolvedMemberID]
	if !ok {
		return false
	}
	_, ok = workspaceIDs[resolvedWorkspaceID]
	return ok
}

func (s *MemoryStore) MemberHasWorkspaceAccess(memberID, workspaceID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.memberHasWorkspaceAccessLocked(memberID, workspaceID)
}

func (s *MemoryStore) grantMemberWorkspaceAccessLocked(memberID, workspaceID string) {
	resolvedMemberID := strings.TrimSpace(memberID)
	resolvedWorkspaceID := strings.TrimSpace(workspaceID)
	if resolvedMemberID == "" || resolvedWorkspaceID == "" {
		return
	}
	if _, ok := s.memberWorkspaceAccess[resolvedMemberID]; !ok {
		s.memberWorkspaceAccess[resolvedMemberID] = map[string]struct{}{}
	}
	s.memberWorkspaceAccess[resolvedMemberID][resolvedWorkspaceID] = struct{}{}
}

func (s *MemoryStore) defaultAccessibleWorkspaceForMemberLocked(memberID string) string {
	if s.memberHasWorkspaceAccessLocked(memberID, s.defaultWorkspaceID) {
		return s.defaultWorkspaceID
	}
	for _, workspace := range s.workspaces {
		if s.memberHasWorkspaceAccessLocked(memberID, workspace.ID) {
			return workspace.ID
		}
	}
	return ""
}

func (s *MemoryStore) normalizeWorkspaceIDLocked(workspaceID string) string {
	resolved := strings.TrimSpace(workspaceID)
	if resolved == "" {
		return s.defaultWorkspaceID
	}
	if _, ok := s.workspaceIndexByIDLocked(resolved); ok {
		return resolved
	}
	return s.defaultWorkspaceID
}

func (s *MemoryStore) defaultRoomIDForWorkspaceLocked(workspaceID string) string {
	return s.defaultRoomIDs[s.normalizeWorkspaceIDLocked(workspaceID)]
}

func (s *MemoryStore) defaultWorkspaceRepoBindingLocked(workspaceID string) (core.WorkspaceRepoBinding, bool) {
	idx, ok := s.workspaceIndexByIDLocked(workspaceID)
	if !ok {
		return core.WorkspaceRepoBinding{}, false
	}
	workspace := s.workspaces[idx]
	if strings.TrimSpace(workspace.DefaultRepoBindingID) != "" {
		for _, binding := range workspace.RepoBindings {
			if binding.ID == workspace.DefaultRepoBindingID && binding.Status == "active" {
				return binding, true
			}
		}
	}
	for _, binding := range workspace.RepoBindings {
		if binding.IsDefault && binding.Status == "active" {
			return binding, true
		}
	}
	return core.WorkspaceRepoBinding{}, false
}

func (s *MemoryStore) defaultWorkspaceRepoPathLocked(workspaceID string) (string, bool) {
	binding, ok := s.defaultWorkspaceRepoBindingLocked(workspaceID)
	if !ok {
		return "", false
	}
	return binding.RepoPath, true
}

func (s *MemoryStore) workspaceRepoBindingIndexByPathLocked(workspaceID, repoPath string) (int, bool) {
	idx, ok := s.workspaceIndexByIDLocked(workspaceID)
	if !ok {
		return 0, false
	}
	normalized := strings.TrimSpace(repoPath)
	for i := range s.workspaces[idx].RepoBindings {
		if s.workspaces[idx].RepoBindings[i].RepoPath == normalized {
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

func (s *MemoryStore) bindWorkspaceRepoLocked(workspaceID, repoPath, label string, makeDefault bool) (core.WorkspaceRepoBinding, error) {
	workspaceIndex, ok := s.workspaceIndexByIDLocked(workspaceID)
	if !ok {
		return core.WorkspaceRepoBinding{}, ErrNotFound
	}
	trimmedRepoPath := strings.TrimSpace(repoPath)
	if trimmedRepoPath == "" {
		return core.WorkspaceRepoBinding{}, errors.New("repo path is required")
	}

	if !makeDefault && strings.TrimSpace(s.workspaces[workspaceIndex].DefaultRepoBindingID) == "" {
		makeDefault = true
	}

	binding := core.WorkspaceRepoBinding{}
	if idx, ok := s.workspaceRepoBindingIndexByPathLocked(workspaceID, trimmedRepoPath); ok {
		s.workspaces[workspaceIndex].RepoBindings[idx].Label = normalizeWorkspaceRepoLabel(trimmedRepoPath, label)
		s.workspaces[workspaceIndex].RepoBindings[idx].Status = "active"
		binding = s.workspaces[workspaceIndex].RepoBindings[idx]
	} else {
		s.nextWorkspaceRepoID++
		binding = core.WorkspaceRepoBinding{
			ID:          fmt.Sprintf("wsrepo_%03d", s.nextWorkspaceRepoID),
			WorkspaceID: workspaceID,
			Label:       normalizeWorkspaceRepoLabel(trimmedRepoPath, label),
			RepoPath:    trimmedRepoPath,
			Status:      "active",
		}
		s.workspaces[workspaceIndex].RepoBindings = append(s.workspaces[workspaceIndex].RepoBindings, binding)
	}

	if makeDefault {
		for i := range s.workspaces[workspaceIndex].RepoBindings {
			s.workspaces[workspaceIndex].RepoBindings[i].IsDefault = s.workspaces[workspaceIndex].RepoBindings[i].ID == binding.ID
			if s.workspaces[workspaceIndex].RepoBindings[i].IsDefault {
				binding = s.workspaces[workspaceIndex].RepoBindings[i]
			}
		}
		s.workspaces[workspaceIndex].DefaultRepoBindingID = binding.ID
	} else if strings.TrimSpace(s.workspaces[workspaceIndex].DefaultRepoBindingID) == binding.ID {
		for i := range s.workspaces[workspaceIndex].RepoBindings {
			if s.workspaces[workspaceIndex].RepoBindings[i].ID == binding.ID {
				s.workspaces[workspaceIndex].RepoBindings[i].IsDefault = true
				binding = s.workspaces[workspaceIndex].RepoBindings[i]
				break
			}
		}
	}

	return binding, nil
}

func (s *MemoryStore) findIssue(issueID string) (core.Issue, bool) {
	for _, issue := range s.issues {
		if issue.ID == issueID {
			if repoPath, ok := s.defaultWorkspaceRepoPathLocked(issue.WorkspaceID); ok {
				issue.RepoPath = repoPath
			}
			return issue, true
		}
	}
	return core.Issue{}, false
}

func (s *MemoryStore) findIssueInWorkspaceLocked(workspaceID, issueID string) (core.Issue, bool) {
	for _, issue := range s.issues {
		if issue.ID == issueID && issue.WorkspaceID == workspaceID {
			if repoPath, ok := s.defaultWorkspaceRepoPathLocked(workspaceID); ok {
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

func (s *MemoryStore) WorkspaceIDForIssue(issueID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.workspaceIDForIssueLocked(issueID)
}

func (s *MemoryStore) WorkspaceIDForRoom(roomID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if room, ok := s.findRoomByIDLocked(roomID); ok {
		return room.WorkspaceID, true
	}
	return "", false
}

func (s *MemoryStore) WorkspaceIDForTask(taskID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.workspaceIDForTaskLocked(taskID)
}

func (s *MemoryStore) workspaceIDForTaskLocked(taskID string) (string, bool) {
	for _, task := range s.tasks {
		if task.ID == taskID {
			return task.WorkspaceID, true
		}
	}
	return "", false
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

func (s *MemoryStore) WorkspaceIDForRun(runID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, run := range s.runs {
		if run.ID == runID {
			return run.WorkspaceID, true
		}
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

func (s *MemoryStore) WorkspaceIDForMergeAttempt(mergeAttemptID string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, attempt := range s.mergeAttempts {
		if attempt.ID == mergeAttemptID {
			return attempt.WorkspaceID, true
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
	run.WorkspaceID = task.WorkspaceID
	run.IssueID = task.IssueID
	run.BranchName = task.BranchName
	if run.Instruction == "" {
		run.Instruction = buildRunInstruction(task)
	}
	if branch := s.integrationBranchByIssueLocked(task.IssueID); branch != nil {
		run.BaseBranch = branch.Name
	}
	if repoPath, ok := s.defaultWorkspaceRepoPathLocked(task.WorkspaceID); ok {
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
		if s.runs[i].TaskID == taskID && s.runs[i].Status == "completed" {
			return s.runs[i].ID
		}
	}
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

func normalizedRuntimeSlotCount(slotCount int) int {
	if slotCount < 1 {
		return 1
	}
	return slotCount
}

func refreshSeedRuntimeHeartbeats(runtimes []core.Runtime, heartbeatAt string) []core.Runtime {
	refreshed := slices.Clone(runtimes)
	for i := range refreshed {
		refreshed[i].SlotCount = normalizedRuntimeSlotCount(refreshed[i].SlotCount)
		refreshed[i].LastHeartbeatAt = heartbeatAt
	}
	return refreshed
}

func runtimeOwnsAgentTurnLocked(turn core.AgentTurn, runtimeID string) bool {
	return strings.TrimSpace(turn.RuntimeID) == "" || turn.RuntimeID == runtimeID
}

func runtimeOwnsRunLocked(run core.Run, runtimeID string) bool {
	return strings.TrimSpace(run.RuntimeID) == "" || run.RuntimeID == runtimeID
}

func runtimeOwnsMergeAttemptLocked(attempt core.MergeAttempt, runtimeID string) bool {
	return strings.TrimSpace(attempt.RuntimeID) == "" || attempt.RuntimeID == runtimeID
}

func runtimeHeartbeatExpired(lastHeartbeatAt string, now time.Time) bool {
	lastHeartbeat, err := time.Parse(time.RFC3339, strings.TrimSpace(lastHeartbeatAt))
	if err != nil || strings.TrimSpace(lastHeartbeatAt) == "" {
		return true
	}
	return now.Sub(lastHeartbeat) > runtimeHeartbeatTTL
}

func (s *MemoryStore) runtimeHasAvailableSlotLocked(runtimeID string) bool {
	for _, runtime := range s.runtimes {
		if runtime.ID == runtimeID {
			return s.runtimeActiveSlotsLocked(runtimeID) < normalizedRuntimeSlotCount(runtime.SlotCount)
		}
	}
	return false
}

func (s *MemoryStore) runtimeActiveSlotsLocked(runtimeID string) int {
	active := 0
	for _, turn := range s.agentTurns {
		if turn.Status == "claimed" && turn.RuntimeID == runtimeID {
			active++
		}
	}
	for _, run := range s.runs {
		if run.Status == "running" && run.RuntimeID == runtimeID {
			active++
		}
	}
	for _, attempt := range s.mergeAttempts {
		if attempt.Status == "running" && attempt.RuntimeID == runtimeID {
			active++
		}
	}
	return active
}

func (s *MemoryStore) sessionHasClaimedAgentTurnLocked(sessionID string) bool {
	for _, turn := range s.agentTurns {
		if turn.SessionID == sessionID && turn.Status == "claimed" {
			return true
		}
	}
	return false
}

func (s *MemoryStore) nextQueuedAgentTurnIDForSessionLocked(sessionID string) string {
	for _, turn := range s.agentTurns {
		if turn.SessionID == sessionID && turn.Status == "queued" {
			return turn.ID
		}
	}
	return ""
}

func (s *MemoryStore) findExistingAgentSessionForRunLocked(run core.Run) *core.AgentSession {
	if strings.TrimSpace(run.AgentID) == "" || strings.TrimSpace(run.IssueID) == "" {
		return nil
	}
	room, ok := s.findRoomByIssueInWorkspaceLocked(run.WorkspaceID, run.IssueID)
	if !ok {
		room, ok = s.findRoomByIssue(run.IssueID)
		if !ok {
			return nil
		}
	}
	session, ok := s.findAgentSessionByRoomAndAgentLocked(room.ID, run.AgentID)
	if !ok {
		return nil
	}
	sessionCopy := session
	return &sessionCopy
}

func (s *MemoryStore) sessionHasRunningRunLocked(sessionID string) bool {
	for _, run := range s.runs {
		if run.Status != "running" {
			continue
		}
		session := s.findExistingAgentSessionForRunLocked(run)
		if session != nil && session.ID == sessionID {
			return true
		}
	}
	return false
}

func (s *MemoryStore) sessionHasActiveCodexWorkLocked(sessionID string) bool {
	return s.sessionHasClaimedAgentTurnLocked(sessionID) || s.sessionHasRunningRunLocked(sessionID)
}

func (s *MemoryStore) refreshAgentSessionStateLocked(sessionIndex int, resultMessageID string) {
	if sessionIndex < 0 || sessionIndex >= len(s.agentSessions) {
		return
	}
	session := &s.agentSessions[sessionIndex]
	session.CurrentTurnID = ""

	switch {
	case s.sessionHasClaimedAgentTurnLocked(session.ID):
		session.Status = "responding"
		for _, turn := range s.agentTurns {
			if turn.SessionID == session.ID && turn.Status == "claimed" {
				session.CurrentTurnID = turn.ID
				break
			}
		}
	case s.nextQueuedAgentTurnIDForSessionLocked(session.ID) != "":
		session.Status = "queued"
		session.CurrentTurnID = s.nextQueuedAgentTurnIDForSessionLocked(session.ID)
	case s.hasQueuedHandoffForSessionLocked(session.ID):
		session.Status = "handoff_requested"
	case strings.TrimSpace(resultMessageID) != "":
		if message, ok := s.findMessageByIDLocked(session.RoomID, resultMessageID); ok && message.Kind == "blocked" {
			session.Status = "blocked"
		} else if session.JoinedRoom {
			session.Status = "idle"
		} else {
			session.Status = "completed"
		}
	default:
		if message, ok := s.findMessageByIDLocked(session.RoomID, session.LastMessageID); ok && message.Kind == "blocked" {
			session.Status = "blocked"
		} else if session.JoinedRoom {
			session.Status = "idle"
		} else {
			session.Status = "completed"
		}
	}

	session.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
}

func (s *MemoryStore) refreshRuntimeStatusLocked(runtimeID string) {
	for i := range s.runtimes {
		if s.runtimes[i].ID == runtimeID {
			s.runtimes[i].SlotCount = normalizedRuntimeSlotCount(s.runtimes[i].SlotCount)
			s.runtimes[i].ActiveSlots = s.runtimeActiveSlotsLocked(runtimeID)
			if runtimeHeartbeatExpired(s.runtimes[i].LastHeartbeatAt, time.Now().UTC()) {
				s.runtimes[i].Status = "offline"
			} else if s.runtimes[i].ActiveSlots > 0 {
				s.runtimes[i].Status = "busy"
			} else {
				s.runtimes[i].Status = "online"
			}
			return
		}
	}
}

func (s *MemoryStore) reconcileRuntimeHealthLocked(now time.Time) {
	affectedSessions := make(map[string]struct{})
	for i := range s.runtimes {
		if !runtimeHeartbeatExpired(s.runtimes[i].LastHeartbeatAt, now) {
			continue
		}
		for j := range s.agentTurns {
			if s.agentTurns[j].Status == "claimed" && s.agentTurns[j].RuntimeID == s.runtimes[i].ID {
				s.agentTurns[j].Status = "queued"
				s.agentTurns[j].RuntimeID = ""
				affectedSessions[s.agentTurns[j].SessionID] = struct{}{}
			}
		}
		for j := range s.runs {
			if s.runs[j].Status == "running" && s.runs[j].RuntimeID == s.runtimes[i].ID {
				s.runs[j].Status = "queued"
				s.runs[j].RuntimeID = ""
			}
		}
		for j := range s.mergeAttempts {
			if s.mergeAttempts[j].Status == "running" && s.mergeAttempts[j].RuntimeID == s.runtimes[i].ID {
				s.mergeAttempts[j].Status = "queued"
				s.mergeAttempts[j].RuntimeID = ""
			}
		}
	}

	for sessionID := range affectedSessions {
		if sessionIndex, ok := s.agentSessionIndexByIDLocked(sessionID); ok {
			s.refreshAgentSessionStateLocked(sessionIndex, s.agentSessions[sessionIndex].LastMessageID)
		}
	}

	for i := range s.runtimes {
		s.runtimes[i].SlotCount = normalizedRuntimeSlotCount(s.runtimes[i].SlotCount)
		s.runtimes[i].ActiveSlots = s.runtimeActiveSlotsLocked(s.runtimes[i].ID)
		if runtimeHeartbeatExpired(s.runtimes[i].LastHeartbeatAt, now) {
			s.runtimes[i].Status = "offline"
		} else if s.runtimes[i].ActiveSlots > 0 {
			s.runtimes[i].Status = "busy"
		} else {
			s.runtimes[i].Status = "online"
		}
	}
}

func (s *MemoryStore) appendSystemMessageLocked(issueID, kind, body string) {
	roomID, _, ok := s.resolveExistingRoomTargetLocked(issueID)
	if !ok {
		return
	}

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
	affected := make([]core.ActionEntity, 0, 8)
	excludedAgentIDs := make(map[string]struct{})

	if handoff, turn, ok := s.enqueueAgentHandoffLocked(roomID, message); ok {
		excludedAgentIDs[turn.AgentID] = struct{}{}
		affected = append(affected,
			core.ActionEntity{Type: "handoff_record", ID: handoff.ID},
			core.ActionEntity{Type: "agent_turn", ID: turn.ID},
		)
	}

	if sessions, turns := s.enqueueVisibleAgentTurnsFromMessageLocked(roomID, message, excludedAgentIDs); len(turns) > 0 {
		for _, session := range sessions {
			affected = append(affected, core.ActionEntity{Type: "agent_session", ID: session.ID})
		}
		for _, turn := range turns {
			affected = append(affected, core.ActionEntity{Type: "agent_turn", ID: turn.ID})
		}
	}
	return affected
}

func (s *MemoryStore) enqueueAgentHandoffLocked(roomID string, message core.Message) (core.HandoffRecord, core.AgentTurn, bool) {
	if message.ActorType != "agent" || strings.TrimSpace(message.Kind) != "handoff" {
		return core.HandoffRecord{}, core.AgentTurn{}, false
	}

	room, ok := s.findRoomByIDLocked(roomID)
	if !ok {
		return core.HandoffRecord{}, core.AgentTurn{}, false
	}
	fromAgent, ok := s.findAgentByActorInWorkspaceLocked(room.WorkspaceID, message.ActorName)
	if !ok {
		return core.HandoffRecord{}, core.AgentTurn{}, false
	}
	targetAgent, ok := s.findMentionedAgentInWorkspaceLocked(room.WorkspaceID, message.Body)
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
	s.agentSessions[fromSessionIndex].LastMessageID = message.ID
	s.refreshAgentSessionStateLocked(fromSessionIndex, message.ID)
	return record, turn, true
}

func (s *MemoryStore) enqueueVisibleAgentTurnsFromMessageLocked(roomID string, message core.Message, excludedAgentIDs map[string]struct{}) ([]core.AgentSession, []core.AgentTurn) {
	if strings.TrimSpace(roomID) == "" {
		return nil, nil
	}
	if message.ActorType == "system" || !isParticipantInstructionMessageKind(message.Kind) {
		return nil, nil
	}
	if strings.TrimSpace(message.Body) == "" {
		return nil, nil
	}

	agents := s.resolveVisibleReplyAgentsLocked(roomID, message, excludedAgentIDs)
	if len(agents) == 0 {
		return nil, nil
	}

	sessions := make([]core.AgentSession, 0, len(agents))
	turns := make([]core.AgentTurn, 0, len(agents))
	for _, agent := range agents {
		sessionIndex := s.ensureAgentSessionLocked(roomID, agent.ID)
		turn := s.createAgentTurnLocked(sessionIndex, roomID, agent.ID, message.ID, "visible_message_response")
		sessions = append(sessions, s.agentSessions[sessionIndex])
		turns = append(turns, turn)
	}
	return sessions, turns
}

func (s *MemoryStore) resolveVisibleReplyAgentsLocked(roomID string, message core.Message, excludedAgentIDs map[string]struct{}) []core.Agent {
	room, ok := s.findRoomByIDLocked(roomID)
	if !ok {
		return nil
	}
	if room.Kind == "direct_message" {
		if agent, ok := s.findAgentByIDInWorkspaceLocked(room.WorkspaceID, room.DirectAgentID); ok {
			return s.filterVisibleReplyAgentsLocked([]core.Agent{agent}, message, excludedAgentIDs)
		}
		return nil
	}

	joinedAgents := s.joinedRoomAgentsLocked(roomID)
	if len(joinedAgents) > 0 {
		return s.filterVisibleReplyAgentsLocked(joinedAgents, message, excludedAgentIDs)
	}
	if message.ActorType == "agent" {
		return nil
	}

	legacyTargets := make([]core.Agent, 0, 1)
	if agent, ok := s.findMentionedAgentInWorkspaceLocked(room.WorkspaceID, message.Body); ok {
		legacyTargets = append(legacyTargets, agent)
	} else if agent, ok := s.selectVisibleReplyAgentLocked(room.WorkspaceID, roomID); ok {
		legacyTargets = append(legacyTargets, agent)
	}
	return s.filterVisibleReplyAgentsLocked(legacyTargets, message, excludedAgentIDs)
}

func (s *MemoryStore) joinedRoomAgentsLocked(roomID string) []core.Agent {
	room, ok := s.findRoomByIDLocked(roomID)
	if !ok {
		return nil
	}
	agents := make([]core.Agent, 0, len(s.agentSessions))
	seen := make(map[string]struct{})
	for _, session := range s.agentSessions {
		if session.RoomID != roomID || !session.JoinedRoom {
			continue
		}
		if _, ok := seen[session.AgentID]; ok {
			continue
		}
		agent, ok := s.findAgentByIDInWorkspaceLocked(room.WorkspaceID, session.AgentID)
		if !ok {
			continue
		}
		seen[session.AgentID] = struct{}{}
		agents = append(agents, agent)
	}
	return agents
}

func (s *MemoryStore) filterVisibleReplyAgentsLocked(candidates []core.Agent, message core.Message, excludedAgentIDs map[string]struct{}) []core.Agent {
	if len(candidates) == 0 {
		return nil
	}

	senderAgentID := ""
	if message.ActorType == "agent" {
		for _, candidate := range candidates {
			if agent, ok := s.findAgentByActorInWorkspaceLocked(candidate.WorkspaceID, message.ActorName); ok {
				senderAgentID = agent.ID
				break
			}
		}
	}

	filtered := make([]core.Agent, 0, len(candidates))
	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		if _, ok := seen[candidate.ID]; ok {
			continue
		}
		if _, ok := excludedAgentIDs[candidate.ID]; ok {
			continue
		}
		if senderAgentID != "" && candidate.ID == senderAgentID {
			continue
		}
		seen[candidate.ID] = struct{}{}
		filtered = append(filtered, candidate)
	}
	return filtered
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
	s.agentSessions[sessionIndex].LastMessageID = triggerMessageID
	s.refreshAgentSessionStateLocked(sessionIndex, triggerMessageID)
	return turn
}

func (s *MemoryStore) ensureAgentSessionLocked(roomID, agentID string) int {
	for i := range s.agentSessions {
		if s.agentSessions[i].RoomID == roomID && s.agentSessions[i].AgentID == agentID {
			return i
		}
	}

	sessionID := newUUIDString()
	session := core.AgentSession{
		ID:               sessionID,
		RoomID:           roomID,
		AgentID:          agentID,
		ProviderThreadID: newUUIDString(),
		Status:           "idle",
		UpdatedAt:        time.Now().UTC().Format(time.RFC3339),
	}
	s.agentSessions = append(s.agentSessions, session)
	return len(s.agentSessions) - 1
}

func (s *MemoryStore) findAgentSessionByRoomAndAgentLocked(roomID, agentID string) (core.AgentSession, bool) {
	for _, session := range s.agentSessions {
		if session.RoomID == roomID && session.AgentID == agentID {
			return session, true
		}
	}
	return core.AgentSession{}, false
}

func (s *MemoryStore) validateRoomAgentRemovalLocked(session core.AgentSession) error {
	if s.hasQueuedHandoffForSessionLocked(session.ID) {
		return fmt.Errorf("%w: agent has a queued handoff in this room", ErrConflict)
	}
	for _, turn := range s.agentTurns {
		if turn.SessionID == session.ID && (turn.Status == "queued" || turn.Status == "claimed") {
			return fmt.Errorf("%w: agent still has an active turn in this room", ErrConflict)
		}
	}
	switch session.Status {
	case "idle", "completed":
		return nil
	default:
		return fmt.Errorf("%w: agent session is %s", ErrConflict, session.Status)
	}
}

func wakeupModeForIntent(intentType string) string {
	switch strings.TrimSpace(intentType) {
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
	} else if room.Kind == "direct_message" && strings.TrimSpace(room.DirectAgentID) != "" {
		currentTarget = fmt.Sprintf("direct_message_room:%s", roomID)
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

func (s *MemoryStore) nextAgentUUIDLocked() string {
	for {
		candidate := newUUIDString()
		if _, ok := s.findAgentByIDLocked(candidate); !ok {
			return candidate
		}
	}
}

func validateAgentName(name string) error {
	normalizedName := strings.TrimSpace(name)
	if normalizedName == "" {
		return fmt.Errorf("%w: name is required", ErrConflict)
	}
	for _, r := range normalizedName {
		switch {
		case r == '_':
		case unicode.IsLetter(r), unicode.IsDigit(r):
		default:
			return fmt.Errorf("%w: agent name may only contain letters, digits, and underscore", ErrConflict)
		}
	}
	return nil
}

func newUUIDString() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		fallback := time.Now().UTC().UnixNano()
		for i := 0; i < 8; i++ {
			value[i] = byte(fallback >> (8 * (7 - i)))
		}
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}

func (s *MemoryStore) findAgentByIDLocked(agentID string) (core.Agent, bool) {
	for _, agent := range s.agents {
		if agent.ID == agentID {
			return agent, true
		}
	}
	return core.Agent{}, false
}

func normalizeAgentNameKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func (s *MemoryStore) agentsForWorkspaceLocked(workspaceID string) []core.Agent {
	agents := make([]core.Agent, 0, len(s.agents))
	for _, agent := range s.agents {
		if agent.WorkspaceID != workspaceID {
			continue
		}
		agents = append(agents, agent)
	}
	return agents
}

func (s *MemoryStore) findAgentByIDInWorkspaceLocked(workspaceID, agentID string) (core.Agent, bool) {
	agent, ok := s.findAgentByIDLocked(agentID)
	if !ok || agent.WorkspaceID != workspaceID {
		return core.Agent{}, false
	}
	return agent, true
}

func (s *MemoryStore) findAgentByNameLocked(name, excludingAgentID string) (core.Agent, bool) {
	normalizedName := normalizeAgentNameKey(name)
	if normalizedName == "" {
		return core.Agent{}, false
	}
	for _, agent := range s.agents {
		if agent.ID == excludingAgentID {
			continue
		}
		if normalizeAgentNameKey(agent.Name) == normalizedName {
			return agent, true
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) resolveAgentReferenceInWorkspaceLocked(workspaceID, agentRef string) (core.Agent, bool) {
	resolved := strings.TrimSpace(agentRef)
	if resolved == "" {
		return core.Agent{}, false
	}
	if agent, ok := s.findAgentByIDInWorkspaceLocked(workspaceID, resolved); ok {
		return agent, true
	}
	agent, ok := s.findAgentByNameLocked(resolved, "")
	if !ok || agent.WorkspaceID != workspaceID {
		return core.Agent{}, false
	}
	return agent, true
}

func (s *MemoryStore) findDirectMessageRoomLocked(workspaceID, agentID string) (core.RoomSummary, bool) {
	for _, room := range s.rooms {
		if room.WorkspaceID == workspaceID && room.Kind == "direct_message" && room.DirectAgentID == agentID {
			return room, true
		}
	}
	return core.RoomSummary{}, false
}

func (s *MemoryStore) ensureDirectMessageRoomLocked(workspaceID string, agent core.Agent) core.RoomSummary {
	if agent.WorkspaceID != workspaceID {
		return core.RoomSummary{}
	}
	if room, ok := s.findDirectMessageRoomLocked(workspaceID, agent.ID); ok {
		return room
	}

	room := core.RoomSummary{
		WorkspaceID:   workspaceID,
		ID:            s.nextRoomIdentifierLocked(),
		DirectAgentID: agent.ID,
		Kind:          "direct_message",
		Title:         directMessageRoomTitle(agent),
		UnreadCount:   0,
	}
	s.rooms = append(s.rooms, room)
	s.messagesByRoom[room.ID] = []core.Message{}
	return room
}

func (s *MemoryStore) ensureDirectMessageRoomsForWorkspaceLocked(workspaceID string) {
	for _, agent := range s.agentsForWorkspaceLocked(workspaceID) {
		s.ensureDirectMessageRoomLocked(workspaceID, agent)
	}
}

func (s *MemoryStore) ensureWorkspaceDefaultDiscussionAgentSessionsLocked(workspaceID string) {
	roomID, ok := s.workspacePrimaryDiscussionRoomIDLocked(workspaceID)
	if !ok {
		return
	}
	for _, agent := range s.agentsForWorkspaceLocked(workspaceID) {
		sessionIndex := s.ensureAgentSessionLocked(roomID, agent.ID)
		s.agentSessions[sessionIndex].JoinedRoom = true
		if strings.TrimSpace(s.agentSessions[sessionIndex].Status) == "" {
			s.agentSessions[sessionIndex].Status = "idle"
		}
		if strings.TrimSpace(s.agentSessions[sessionIndex].UpdatedAt) == "" {
			s.agentSessions[sessionIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		}
	}
}

func (s *MemoryStore) workspacePrimaryDiscussionRoomIDLocked(workspaceID string) (string, bool) {
	resolvedWorkspaceID := s.normalizeWorkspaceIDLocked(workspaceID)
	for _, room := range s.rooms {
		if room.WorkspaceID == resolvedWorkspaceID && room.Kind == "discussion" && strings.EqualFold(strings.TrimSpace(room.Title), "all") {
			return room.ID, true
		}
	}
	return "", false
}

func (s *MemoryStore) renameDirectMessageRoomsLocked(workspaceID, agentID, title string) {
	for i := range s.rooms {
		if s.rooms[i].WorkspaceID == workspaceID && s.rooms[i].Kind == "direct_message" && s.rooms[i].DirectAgentID == agentID {
			s.rooms[i].Title = title
		}
	}
}

func (s *MemoryStore) deleteDirectMessageRoomsLocked(workspaceID, agentID string) {
	filteredRooms := s.rooms[:0]
	for _, room := range s.rooms {
		if room.WorkspaceID == workspaceID && room.Kind == "direct_message" && room.DirectAgentID == agentID {
			delete(s.messagesByRoom, room.ID)
			continue
		}
		filteredRooms = append(filteredRooms, room)
	}
	s.rooms = filteredRooms
}

func (s *MemoryStore) agentDeleteConflictReasonLocked(agentID string) (string, bool) {
	for _, task := range s.tasks {
		if task.AssigneeAgentID == agentID {
			return fmt.Sprintf("agent is assigned to task %s", task.ID), true
		}
	}
	for _, run := range s.runs {
		if run.AgentID == agentID {
			return fmt.Sprintf("agent is referenced by run %s", run.ID), true
		}
	}
	for _, session := range s.agentSessions {
		if session.AgentID == agentID {
			return fmt.Sprintf("agent is referenced by agent session %s", session.ID), true
		}
	}
	for _, turn := range s.agentTurns {
		if turn.AgentID == agentID {
			return fmt.Sprintf("agent is referenced by agent turn %s", turn.ID), true
		}
	}
	for _, handoff := range s.handoffRecords {
		if handoff.FromAgentID == agentID || handoff.ToAgentID == agentID {
			return fmt.Sprintf("agent is referenced by handoff %s", handoff.ID), true
		}
	}
	for _, room := range s.rooms {
		if room.Kind == "direct_message" && room.DirectAgentID == agentID && len(s.messagesByRoom[room.ID]) > 0 {
			return fmt.Sprintf("agent has direct chat history in room %s", room.ID), true
		}
	}
	return "", false
}

func isParticipantInstructionMessageKind(kind string) bool {
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

func (s *MemoryStore) findAgentByActorInWorkspaceLocked(workspaceID, actorName string) (core.Agent, bool) {
	normalizedActor := normalizeMentionToken(actorName)
	if normalizedActor == "" {
		return core.Agent{}, false
	}
	for _, agent := range s.agents {
		if agent.WorkspaceID != workspaceID {
			continue
		}
		if normalizedActor == normalizeMentionToken(agent.ID) || normalizedActor == normalizeMentionToken(agent.Name) {
			return agent, true
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) resolveDisplayActorNameInWorkspaceLocked(workspaceID, actorID string) string {
	displayActor := strings.TrimSpace(actorID)
	if displayActor == "" {
		return "Someone"
	}
	if agent, ok := s.findAgentByActorInWorkspaceLocked(workspaceID, actorID); ok {
		return agent.Name
	}
	return displayActor
}

func (s *MemoryStore) findMentionedAgentInWorkspaceLocked(workspaceID, body string) (core.Agent, bool) {
	for _, token := range strings.Fields(body) {
		if !strings.HasPrefix(token, "@") {
			continue
		}
		normalized := normalizeMentionToken(token)
		if normalized == "" {
			continue
		}
		for _, agent := range s.agents {
			if agent.WorkspaceID != workspaceID {
				continue
			}
			if normalized == normalizeMentionToken(agent.ID) || normalized == normalizeMentionToken(agent.Name) {
				return agent, true
			}
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) selectVisibleReplyAgentLocked(workspaceID, roomID string) (core.Agent, bool) {
	if agent, ok := s.findMostRecentlyUpdatedSessionAgentLocked(workspaceID, roomID); ok {
		return agent, true
	}
	if agent, ok := s.findMostRecentAgentSpeakerLocked(workspaceID, roomID); ok {
		return agent, true
	}
	if agent, ok := s.findMostRecentlyActiveAgentLocked(workspaceID); ok {
		return agent, true
	}
	for _, agent := range s.agentsForWorkspaceLocked(workspaceID) {
		return agent, true
	}
	return core.Agent{}, false
}

func (s *MemoryStore) findMostRecentlyUpdatedSessionAgentLocked(workspaceID, roomID string) (core.Agent, bool) {
	bestUpdatedAt := ""
	bestAgent := core.Agent{}
	found := false
	for _, session := range s.agentSessions {
		if session.RoomID != roomID {
			continue
		}
		agent, ok := s.findAgentByActorInWorkspaceLocked(workspaceID, session.AgentID)
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

func (s *MemoryStore) findMostRecentAgentSpeakerLocked(workspaceID, roomID string) (core.Agent, bool) {
	for i := len(s.messagesByRoom[roomID]) - 1; i >= 0; i-- {
		message := s.messagesByRoom[roomID][i]
		if message.ActorType != "agent" {
			continue
		}
		if agent, ok := s.findAgentByActorInWorkspaceLocked(workspaceID, message.ActorName); ok {
			return agent, true
		}
	}
	return core.Agent{}, false
}

func (s *MemoryStore) findMostRecentlyActiveAgentLocked(workspaceID string) (core.Agent, bool) {
	bestCreatedAt := ""
	bestAgent := core.Agent{}
	found := false
	for _, messages := range s.messagesByRoom {
		for _, message := range messages {
			if message.ActorType != "agent" {
				continue
			}
			agent, ok := s.findAgentByActorInWorkspaceLocked(workspaceID, message.ActorName)
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

func (s *MemoryStore) appendInboxItemLocked(workspaceID, title, kind, severity, summary, relatedEntityType, relatedEntityID, primaryActionType string) {
	s.nextInboxID++
	item := core.InboxItem{
		WorkspaceID:       workspaceID,
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

func (s *MemoryStore) findRoomByIssueInWorkspaceLocked(workspaceID, issueID string) (core.RoomSummary, bool) {
	for _, room := range s.rooms {
		if room.WorkspaceID == workspaceID && room.Kind == "issue" && room.IssueID == issueID {
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

func (s *MemoryStore) findRoomByIDInWorkspaceLocked(workspaceID, roomID string) (core.RoomSummary, bool) {
	for _, room := range s.rooms {
		if room.WorkspaceID == workspaceID && room.ID == roomID {
			return room, true
		}
	}
	return core.RoomSummary{}, false
}

func (s *MemoryStore) resolveExistingRoomTargetLocked(targetID string) (roomID, issueID string, ok bool) {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return "", "", false
	}

	if room, ok := s.findRoomByIDLocked(targetID); ok {
		return room.ID, room.IssueID, true
	}
	if room, ok := s.findRoomByIssue(targetID); ok {
		return room.ID, room.IssueID, true
	}

	return "", "", false
}

func (s *MemoryStore) issueByIDLocked(issueID string) (core.Issue, bool) {
	for _, issue := range s.issues {
		if issue.ID == issueID {
			return issue, true
		}
	}
	return core.Issue{}, false
}

func (s *MemoryStore) workspaceIDForIssueLocked(issueID string) (string, bool) {
	for _, issue := range s.issues {
		if issue.ID == issueID {
			return issue.WorkspaceID, true
		}
	}
	return "", false
}

func (s *MemoryStore) nextRoomIdentifierLocked() string {
	s.nextRoomID++
	return fmt.Sprintf("room_%03d", s.nextRoomID)
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

func (s *MemoryStore) agentTurnOutputChunksForRoom(roomID string) []core.AgentTurnOutputChunk {
	turnIDs := map[string]struct{}{}
	for _, turn := range s.agentTurns {
		if turn.RoomID == roomID {
			turnIDs[turn.ID] = struct{}{}
		}
	}
	chunks := make([]core.AgentTurnOutputChunk, 0)
	for _, chunk := range s.agentTurnOutputChunks {
		if _, ok := turnIDs[chunk.TurnID]; ok {
			chunks = append(chunks, chunk)
		}
	}
	return chunks
}

func (s *MemoryStore) agentTurnToolCallsForRoom(roomID string) []core.AgentTurnToolCall {
	turnIDs := map[string]struct{}{}
	for _, turn := range s.agentTurns {
		if turn.RoomID == roomID {
			turnIDs[turn.ID] = struct{}{}
		}
	}
	toolCalls := make([]core.AgentTurnToolCall, 0)
	for _, toolCall := range s.agentTurnToolCalls {
		if _, ok := turnIDs[toolCall.TurnID]; ok {
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

func (s *MemoryStore) appendAgentTurnOutputChunkLocked(turnID, stream, content string) {
	sequence := 1
	for i := len(s.agentTurnOutputChunks) - 1; i >= 0; i-- {
		if s.agentTurnOutputChunks[i].TurnID == turnID {
			sequence = s.agentTurnOutputChunks[i].Sequence + 1
			break
		}
	}

	s.nextAgentTurnOutputID++
	chunk := core.AgentTurnOutputChunk{
		ID:        fmt.Sprintf("agent_turn_output_%03d", s.nextAgentTurnOutputID),
		TurnID:    turnID,
		Sequence:  sequence,
		Stream:    stream,
		Content:   content,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.agentTurnOutputChunks = append(s.agentTurnOutputChunks, chunk)
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

func (s *MemoryStore) appendAgentTurnToolCallLocked(turnID string, input core.ToolCallInput) {
	sequence := s.nextAgentTurnToolCallSequenceLocked(turnID)
	s.nextAgentTurnToolCallID++
	toolCall := core.AgentTurnToolCall{
		ID:        fmt.Sprintf("agent_turn_tool_call_%03d", s.nextAgentTurnToolCallID),
		TurnID:    turnID,
		Sequence:  sequence,
		ToolName:  input.ToolName,
		Arguments: input.Arguments,
		Status:    normalizedToolCallStatus(input.Status),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.agentTurnToolCalls = append(s.agentTurnToolCalls, toolCall)
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

func (s *MemoryStore) nextAgentTurnToolCallSequenceLocked(turnID string) int {
	sequence := 1
	for i := len(s.agentTurnToolCalls) - 1; i >= 0; i-- {
		if s.agentTurnToolCalls[i].TurnID == turnID {
			sequence = s.agentTurnToolCalls[i].Sequence + 1
			break
		}
	}
	return sequence
}

func (s *MemoryStore) pruneAgentTurnObservabilityLocked(now time.Time) {
	cutoff := now.Add(-agentTurnObservabilityRetention)

	filteredChunks := make([]core.AgentTurnOutputChunk, 0, len(s.agentTurnOutputChunks))
	for _, chunk := range s.agentTurnOutputChunks {
		if createdAt, err := time.Parse(time.RFC3339, chunk.CreatedAt); err == nil && createdAt.Before(cutoff) {
			continue
		}
		filteredChunks = append(filteredChunks, chunk)
	}
	s.agentTurnOutputChunks = filteredChunks

	filteredToolCalls := make([]core.AgentTurnToolCall, 0, len(s.agentTurnToolCalls))
	for _, toolCall := range s.agentTurnToolCalls {
		if createdAt, err := time.Parse(time.RFC3339, toolCall.CreatedAt); err == nil && createdAt.Before(cutoff) {
			continue
		}
		filteredToolCalls = append(filteredToolCalls, toolCall)
	}
	s.agentTurnToolCalls = filteredToolCalls
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
			s.tasks[taskIndex].WorkspaceID,
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
