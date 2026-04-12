package store

import (
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"openshock/backend/internal/core"
	"openshock/backend/internal/testsupport/scenario"
)

func bindDefaultWorkspaceRepo(t *testing.T, s *MemoryStore) string {
	t.Helper()

	repoPath := "/tmp/openshock-demo-repo"
	if err := s.BindWorkspaceRepo("ws_01", repoPath, "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	return repoPath
}

func mustPostRoomMessage(t *testing.T, s *MemoryStore, targetID, actorType, actorName, kind, body string) core.ActionResponse {
	t.Helper()

	resp, err := s.PostRoomMessage(targetID, actorType, actorName, kind, body)
	if err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}
	return resp
}

func mustCreateTestAgents(t *testing.T, s *MemoryStore, agentIDs ...string) {
	t.Helper()

	for _, agentID := range agentIDs {
		name := agentID
		switch agentID {
		case "agent_shell":
			name = "Shell_Runner"
		case "agent_guardian":
			name = "Guardian_Bot"
		case "agent_systems":
			name = "Systems_Agent_01"
		case "agent_lead":
			name = "Lead_Architect"
		}

		if _, err := s.CreateAgentWithID(agentID, name, "test fixture prompt"); err != nil {
			t.Fatalf("create test agent %s returned error: %v", agentID, err)
		}
	}
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func looksLikeUUID(value string) bool {
	return uuidPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}

func TestNewEmptyMemoryStoreStartsWithDefaultWorkspaceDiscussionRooms(t *testing.T) {
	s := NewMemoryStore()

	bootstrap := s.Bootstrap()
	if bootstrap.DefaultRoomID != "room_001" {
		t.Fatalf("expected default room id room_001, got %q", bootstrap.DefaultRoomID)
	}
	if bootstrap.DefaultIssueID != "" {
		t.Fatalf("expected empty default issue id, got %q", bootstrap.DefaultIssueID)
	}
	if len(bootstrap.Rooms) != 2 {
		t.Fatalf("expected exactly two default discussion rooms, got %#v", bootstrap.Rooms)
	}
	expectedTitles := map[string]string{
		"room_001": "all",
		"room_002": "annoucement",
	}
	for _, room := range bootstrap.Rooms {
		if room.Kind != "discussion" {
			t.Fatalf("expected default room to be discussion, got %#v", room)
		}
		if expectedTitles[room.ID] != room.Title {
			t.Fatalf("expected room %s title %q, got %#v", room.ID, expectedTitles[room.ID], room)
		}
	}
	if len(bootstrap.IssueSummaries) != 0 {
		t.Fatalf("expected no seeded issues, got %#v", bootstrap.IssueSummaries)
	}
	if len(bootstrap.Runtimes) != 0 {
		t.Fatalf("expected no seeded runtimes, got %#v", bootstrap.Runtimes)
	}
	if len(bootstrap.Agents) != 0 {
		t.Fatalf("expected no default agents, got %#v", bootstrap.Agents)
	}
	if len(bootstrap.Workspace.RepoBindings) != 0 {
		t.Fatalf("expected no repo bindings, got %#v", bootstrap.Workspace.RepoBindings)
	}

	roomDetail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("expected default room detail to resolve: %v", err)
	}
	if len(roomDetail.Messages) != 1 {
		t.Fatalf("expected seeded default room message, got %#v", roomDetail.Messages)
	}
}

func TestNewMemoryStoreStartsWithoutAgentsOrDirectRooms(t *testing.T) {
	s := NewMemoryStore()

	bootstrap := s.Bootstrap()
	if len(bootstrap.Agents) != 0 {
		t.Fatalf("expected app store to start without default agents, got %#v", bootstrap.Agents)
	}
	if len(bootstrap.DirectRooms) != 0 {
		t.Fatalf("expected app store to start without direct rooms, got %#v", bootstrap.DirectRooms)
	}
	if len(bootstrap.Rooms) != 2 {
		t.Fatalf("expected app store to keep the two default discussion rooms, got %#v", bootstrap.Rooms)
	}
}

func TestCreateWorkspaceCreatesScopedDefaultRooms(t *testing.T) {
	s := NewMemoryStore()

	workspace, err := s.CreateWorkspace("Beta Ops")
	if err != nil {
		t.Fatalf("create workspace returned error: %v", err)
	}

	bootstrap := s.BootstrapForWorkspace(workspace.ID)
	if bootstrap.Workspace.ID != workspace.ID || bootstrap.Workspace.Name != "Beta Ops" {
		t.Fatalf("expected created workspace in bootstrap, got %#v", bootstrap.Workspace)
	}
	if len(bootstrap.Rooms) != 2 {
		t.Fatalf("expected exactly two default rooms in new workspace, got %#v", bootstrap.Rooms)
	}
	if bootstrap.DefaultRoomID == "" {
		t.Fatal("expected new workspace to have a default room")
	}
	if bootstrap.DefaultIssueID != "" {
		t.Fatalf("expected new workspace to start without issues, got %q", bootstrap.DefaultIssueID)
	}
	for _, room := range bootstrap.Rooms {
		if room.WorkspaceID != workspace.ID {
			t.Fatalf("expected room to belong to created workspace, got %#v", room)
		}
	}

	original := s.Bootstrap()
	if original.Workspace.ID == workspace.ID {
		t.Fatalf("expected default bootstrap to remain on original workspace, got %#v", original.Workspace)
	}
}

func TestWorkspaceScopedAgentsStayIsolatedBetweenWorkspaces(t *testing.T) {
	s := NewMemoryStore()

	beta, err := s.CreateWorkspace("Beta Ops")
	if err != nil {
		t.Fatalf("create workspace returned error: %v", err)
	}
	alphaAgent, err := s.CreateAgentInWorkspace("ws_01", "alpha_agent", "alpha prompt")
	if err != nil {
		t.Fatalf("create default workspace agent returned error: %v", err)
	}
	betaAgent, err := s.CreateAgentInWorkspace(beta.ID, "beta_agent", "beta prompt")
	if err != nil {
		t.Fatalf("create beta workspace agent returned error: %v", err)
	}

	alphaBootstrap := s.BootstrapForWorkspace("ws_01")
	if len(alphaBootstrap.Agents) != 1 || alphaBootstrap.Agents[0].ID != alphaAgent.ID {
		t.Fatalf("expected default workspace bootstrap to only include its agent, got %#v", alphaBootstrap.Agents)
	}
	if len(alphaBootstrap.DirectRooms) != 1 || alphaBootstrap.DirectRooms[0].DirectAgentID != alphaAgent.ID {
		t.Fatalf("expected default workspace direct rooms to stay scoped, got %#v", alphaBootstrap.DirectRooms)
	}

	betaBootstrap := s.BootstrapForWorkspace(beta.ID)
	if len(betaBootstrap.Agents) != 1 || betaBootstrap.Agents[0].ID != betaAgent.ID {
		t.Fatalf("expected beta workspace bootstrap to only include its agent, got %#v", betaBootstrap.Agents)
	}
	if len(betaBootstrap.DirectRooms) != 1 || betaBootstrap.DirectRooms[0].DirectAgentID != betaAgent.ID {
		t.Fatalf("expected beta workspace direct rooms to stay scoped, got %#v", betaBootstrap.DirectRooms)
	}
}

func TestCreateTaskRejectsAgentFromAnotherWorkspace(t *testing.T) {
	s := NewMemoryStore()

	beta, err := s.CreateWorkspace("Beta Ops")
	if err != nil {
		t.Fatalf("create workspace returned error: %v", err)
	}
	if _, err := s.CreateAgentInWorkspace("ws_01", "alpha_agent", "alpha prompt"); err != nil {
		t.Fatalf("create default workspace agent returned error: %v", err)
	}

	createIssueResp := s.CreateIssueInWorkspace(beta.ID, "Beta Issue", "beta summary", "medium")
	issueID := createIssueResp.AffectedEntities[0].ID

	if _, err := s.CreateTask(issueID, "Cross-space task", "should fail", "alpha_agent"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected cross-workspace assignee to be rejected, got %v", err)
	}
}

func TestNewMemoryStoreIncludesDirectRoomsForWorkspaceAgents(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	bootstrap := s.Bootstrap()
	if len(bootstrap.DirectRooms) != len(bootstrap.Agents) {
		t.Fatalf("expected one direct room per agent, got directRooms=%d agents=%d", len(bootstrap.DirectRooms), len(bootstrap.Agents))
	}

	roomsByAgentID := make(map[string]core.RoomSummary, len(bootstrap.DirectRooms))
	for _, room := range bootstrap.DirectRooms {
		if room.Kind != "direct_message" {
			t.Fatalf("expected direct room kind direct_message, got %#v", room)
		}
		if room.DirectAgentID == "" {
			t.Fatalf("expected direct room to keep directAgentId, got %#v", room)
		}
		roomsByAgentID[room.DirectAgentID] = room
	}

	for _, agent := range bootstrap.Agents {
		room, ok := roomsByAgentID[agent.ID]
		if !ok {
			t.Fatalf("expected direct room for agent %s", agent.ID)
		}
		if room.Title != agent.Name {
			t.Fatalf("expected direct room title %q for agent %s, got %#v", agent.Name, agent.ID, room)
		}
	}
}

func TestAllRoomIncludesAllWorkspaceAgentsCreatedLater(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell", "agent_guardian", "agent_systems")

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 3 {
		t.Fatalf("expected all room to include every created agent, got %#v", detail.AgentSessions)
	}

	seen := make(map[string]bool, len(detail.AgentSessions))
	for _, session := range detail.AgentSessions {
		if !session.JoinedRoom {
			t.Fatalf("expected all room session to be joined, got %#v", session)
		}
		seen[session.AgentID] = true
	}
	for _, agentID := range []string{"agent_shell", "agent_guardian", "agent_systems"} {
		if !seen[agentID] {
			t.Fatalf("expected agent %s in all room, got %#v", agentID, detail.AgentSessions)
		}
	}
}

func TestDirectMessageRoomQueuesTurnForItsAssignedAgent(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	bootstrap := s.Bootstrap()
	var directRoom core.RoomSummary
	found := false
	for _, room := range bootstrap.DirectRooms {
		if room.DirectAgentID == "agent_shell" {
			directRoom = room
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected a direct room for agent_shell")
	}

	mustPostRoomMessage(t, s, directRoom.ID, "member", "Sarah", "message", "Please review this in private.")

	detail, err := s.RoomDetail(directRoom.ID)
	if err != nil {
		t.Fatalf("expected direct room detail to resolve: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued turn in direct room, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_shell" {
		t.Fatalf("expected direct room turn to target agent_shell, got %#v", detail.AgentTurns[0])
	}
	if detail.AgentTurns[0].WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", detail.AgentTurns[0])
	}
}

func TestBootstrapUnreadCountsTrackRoomReadStatePerSession(t *testing.T) {
	s := NewMemoryStore()

	auth, err := s.RegisterMember("sarah", "Sarah", "password123")
	if err != nil {
		t.Fatalf("register member returned error: %v", err)
	}

	before := s.BootstrapForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, auth.Session.ID)
	roomUnread := map[string]int{}
	for _, room := range before.Rooms {
		roomUnread[room.ID] = room.UnreadCount
	}
	if roomUnread["room_001"] != 1 || roomUnread["room_002"] != 1 {
		t.Fatalf("expected both seeded rooms to start unread, got %#v", before.Rooms)
	}

	detail, err := s.RoomDetailForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, "room_001", auth.Session.ID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if detail.Room.UnreadCount != 1 {
		t.Fatalf("expected room detail to preserve unread count until explicit mark read, got %#v", detail.Room)
	}

	after := s.BootstrapForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, auth.Session.ID)
	roomUnread = map[string]int{}
	for _, room := range after.Rooms {
		roomUnread[room.ID] = room.UnreadCount
	}
	if roomUnread["room_001"] != 1 {
		t.Fatalf("expected room_001 to remain unread after opening detail, got %#v", after.Rooms)
	}
	if roomUnread["room_002"] != 1 {
		t.Fatalf("expected room_002 unread count to remain unchanged, got %#v", after.Rooms)
	}

	if _, err := s.PostRoomMessage("room_001", "agent", "agent_shell", "message", "这里有新的更新。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}
	afterNewMessage := s.BootstrapForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, auth.Session.ID)
	roomUnread = map[string]int{}
	for _, room := range afterNewMessage.Rooms {
		roomUnread[room.ID] = room.UnreadCount
	}
	if roomUnread["room_001"] != 2 {
		t.Fatalf("expected unopened unread backlog plus new message to remain unread, got %#v", afterNewMessage.Rooms)
	}
}

func TestMarkRoomReadForSessionClearsUnreadCount(t *testing.T) {
	s := NewMemoryStore()

	auth, err := s.RegisterMember("sarah", "Sarah", "password123")
	if err != nil {
		t.Fatalf("register member returned error: %v", err)
	}

	before := s.BootstrapForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, auth.Session.ID)
	roomUnread := map[string]int{}
	for _, room := range before.Rooms {
		roomUnread[room.ID] = room.UnreadCount
	}
	if roomUnread["room_001"] != 1 {
		t.Fatalf("expected room_001 to start unread, got %#v", before.Rooms)
	}

	detail, err := s.RoomDetailForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, "room_001", auth.Session.ID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}

	room, err := s.MarkRoomReadForWorkspaceAndSession(
		auth.Session.ActiveWorkspaceID,
		"room_001",
		auth.Session.ID,
		detail.Messages[len(detail.Messages)-1].ID,
	)
	if err != nil {
		t.Fatalf("mark room read returned error: %v", err)
	}
	if room.UnreadCount != 0 {
		t.Fatalf("expected marked room to be read immediately, got %#v", room)
	}

	after := s.BootstrapForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, auth.Session.ID)
	roomUnread = map[string]int{}
	for _, room := range after.Rooms {
		roomUnread[room.ID] = room.UnreadCount
	}
	if roomUnread["room_001"] != 0 {
		t.Fatalf("expected room_001 unread count to clear after explicit mark read, got %#v", after.Rooms)
	}
}

func TestMarkRoomReadForSessionDoesNotSkipNewerMessages(t *testing.T) {
	s := NewMemoryStore()

	auth, err := s.RegisterMember("sarah", "Sarah", "password123")
	if err != nil {
		t.Fatalf("register member returned error: %v", err)
	}

	detail, err := s.RoomDetailForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, "room_001", auth.Session.ID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	lastVisibleMessageID := detail.Messages[len(detail.Messages)-1].ID

	if _, err := s.PostRoomMessage("room_001", "agent", "agent_shell", "message", "这里有一条更晚的新消息。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	room, err := s.MarkRoomReadForWorkspaceAndSession(
		auth.Session.ActiveWorkspaceID,
		"room_001",
		auth.Session.ID,
		lastVisibleMessageID,
	)
	if err != nil {
		t.Fatalf("mark room read returned error: %v", err)
	}
	if room.UnreadCount != 1 {
		t.Fatalf("expected newer message to remain unread, got %#v", room)
	}
}

func TestMarkRoomReadForSessionDoesNotMoveCursorBackward(t *testing.T) {
	s := NewMemoryStore()

	auth, err := s.RegisterMember("sarah", "Sarah", "password123")
	if err != nil {
		t.Fatalf("register member returned error: %v", err)
	}

	detail, err := s.RoomDetailForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, "room_001", auth.Session.ID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	initialMessageID := detail.Messages[len(detail.Messages)-1].ID

	if _, err := s.PostRoomMessage("room_001", "agent", "agent_shell", "message", "第二条消息。"); err != nil {
		t.Fatalf("post second room message returned error: %v", err)
	}
	if _, err := s.PostRoomMessage("room_001", "agent", "agent_shell", "message", "第三条消息。"); err != nil {
		t.Fatalf("post third room message returned error: %v", err)
	}

	updatedDetail, err := s.RoomDetailForWorkspaceAndSession(auth.Session.ActiveWorkspaceID, "room_001", auth.Session.ID)
	if err != nil {
		t.Fatalf("updated room detail returned error: %v", err)
	}
	newestMessageID := updatedDetail.Messages[len(updatedDetail.Messages)-1].ID

	room, err := s.MarkRoomReadForWorkspaceAndSession(
		auth.Session.ActiveWorkspaceID,
		"room_001",
		auth.Session.ID,
		newestMessageID,
	)
	if err != nil {
		t.Fatalf("mark newest room read returned error: %v", err)
	}
	if room.UnreadCount != 0 {
		t.Fatalf("expected newest message cursor to clear unread count, got %#v", room)
	}

	room, err = s.MarkRoomReadForWorkspaceAndSession(
		auth.Session.ActiveWorkspaceID,
		"room_001",
		auth.Session.ID,
		initialMessageID,
	)
	if err != nil {
		t.Fatalf("mark older room read returned error: %v", err)
	}
	if room.UnreadCount != 0 {
		t.Fatalf("expected older read receipt to be ignored after newer cursor, got %#v", room)
	}
}

func TestCreateIssueCreatesRoomAndIntegrationBranch(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	before := s.Bootstrap()
	resp := s.CreateIssue("Investigate flaky merge queue", "Queue stalls under high churn.", "high")
	after := s.Bootstrap()

	if resp.ResultCode != "issue_created" {
		t.Fatalf("expected issue_created result code, got %q", resp.ResultCode)
	}
	if len(after.IssueSummaries) != len(before.IssueSummaries)+1 {
		t.Fatalf("expected issue count to increase, got before=%d after=%d", len(before.IssueSummaries), len(after.IssueSummaries))
	}

	createdIssueID := resp.AffectedEntities[0].ID
	detail, err := s.IssueDetail(createdIssueID)
	if err != nil {
		t.Fatalf("expected new issue detail to resolve: %v", err)
	}
	if detail.Room.IssueID != createdIssueID {
		t.Fatalf("expected room to point at new issue, got %q", detail.Room.IssueID)
	}
	if detail.IntegrationBranch.IssueID != createdIssueID {
		t.Fatalf("expected integration branch to point at new issue, got %q", detail.IntegrationBranch.IssueID)
	}
}

func TestCreateDiscussionRoomCreatesChatOnlyRoom(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	before := s.Bootstrap()
	resp := s.CreateDiscussionRoom("Architecture", "Track cross-cutting architecture decisions here.")
	after := s.Bootstrap()

	if resp.ResultCode != "room_created" {
		t.Fatalf("expected room_created result code, got %q", resp.ResultCode)
	}
	if len(after.Rooms) != len(before.Rooms)+1 {
		t.Fatalf("expected room count to increase, got before=%d after=%d", len(before.Rooms), len(after.Rooms))
	}
	if after.DefaultRoomID != resp.AffectedEntities[0].ID {
		t.Fatalf("expected new discussion room to become default room, got %q", after.DefaultRoomID)
	}
	if after.DefaultIssueID != before.DefaultIssueID {
		t.Fatalf("expected default issue to remain unchanged, got before=%q after=%q", before.DefaultIssueID, after.DefaultIssueID)
	}

	detail, err := s.RoomDetail(resp.AffectedEntities[0].ID)
	if err != nil {
		t.Fatalf("expected room detail to resolve: %v", err)
	}
	if detail.Room.Kind != "discussion" {
		t.Fatalf("expected discussion room kind, got %#v", detail.Room)
	}
	if detail.Issue != nil || len(detail.Tasks) != 0 || len(detail.Runs) != 0 {
		t.Fatalf("expected discussion room to stay chat-only, got %#v", detail)
	}
	if len(detail.Messages) != 1 || !strings.Contains(detail.Messages[0].Body, "Track cross-cutting architecture decisions") {
		t.Fatalf("expected opening summary message, got %#v", detail.Messages)
	}
}

func TestBootstrapSeedsDiscussionRooms(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	bootstrap := s.Bootstrap()
	if bootstrap.DefaultRoomID != "room_001" {
		t.Fatalf("expected default discussion room room_001, got %q", bootstrap.DefaultRoomID)
	}

	kindsByTitle := map[string]string{}
	for _, room := range bootstrap.Rooms {
		kindsByTitle[room.Title] = room.Kind
	}

	if kindsByTitle["Announcements"] != "discussion" {
		t.Fatalf("expected Announcements discussion room, got %#v", bootstrap.Rooms)
	}
	if kindsByTitle["Roadmap"] != "discussion" {
		t.Fatalf("expected Roadmap discussion room, got %#v", bootstrap.Rooms)
	}
}

func TestAgentCatalogCRUD(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	created, err := s.CreateAgent(
		"research_partner",
		"会先整理问题背景、已有结论和不确定项，再把信息压缩成结构化判断，适合承担调研和分析型任务。",
	)
	if err != nil {
		t.Fatalf("create agent returned error: %v", err)
	}
	if !looksLikeUUID(created.ID) || created.Name != "research_partner" || created.Prompt == "" {
		t.Fatalf("unexpected created agent payload: %#v", created)
	}

	updated, err := s.UpdateAgent(
		created.ID,
		"research_partner",
		"更新后的 agent prompt 应该被完整保留，便于在前端以多行方式展示和编辑。",
	)
	if err != nil {
		t.Fatalf("update agent returned error: %v", err)
	}
	if updated.Prompt != "更新后的 agent prompt 应该被完整保留，便于在前端以多行方式展示和编辑。" {
		t.Fatalf("unexpected updated agent payload: %#v", updated)
	}

	if err := s.DeleteAgent(created.ID); err != nil {
		t.Fatalf("delete agent returned error: %v", err)
	}

	for _, agent := range s.Agents() {
		if agent.ID == created.ID {
			t.Fatalf("expected deleted agent to be absent, got %#v", agent)
		}
	}
}

func TestCreateAgentAutoJoinsWorkspaceDefaultDiscussionRoom(t *testing.T) {
	s := NewMemoryStore()

	created, err := s.CreateAgent("research_partner", "prompt")
	if err != nil {
		t.Fatalf("create agent returned error: %v", err)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected default room to gain one auto-joined session, got %#v", detail.AgentSessions)
	}
	session := detail.AgentSessions[0]
	if session.AgentID != created.ID || !session.JoinedRoom || session.Status != "idle" {
		t.Fatalf("expected created agent to auto-join default room, got %#v", session)
	}
}

func TestCreateAgentInWorkspaceAutoJoinsWorkspaceDefaultDiscussionRoom(t *testing.T) {
	s := NewMemoryStore()

	workspace, err := s.CreateWorkspace("Beta Ops")
	if err != nil {
		t.Fatalf("create workspace returned error: %v", err)
	}
	created, err := s.CreateAgentInWorkspace(workspace.ID, "beta_agent", "prompt")
	if err != nil {
		t.Fatalf("create workspace agent returned error: %v", err)
	}

	bootstrap := s.BootstrapForWorkspace(workspace.ID)
	detail, err := s.RoomDetailForWorkspace(workspace.ID, bootstrap.DefaultRoomID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected workspace default room to gain one auto-joined session, got %#v", detail.AgentSessions)
	}
	session := detail.AgentSessions[0]
	if session.AgentID != created.ID || !session.JoinedRoom || session.Status != "idle" {
		t.Fatalf("expected created workspace agent to auto-join default room, got %#v", session)
	}
}

func TestAgentCatalogRejectsDuplicateNames(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.CreateAgent("Shell_Runner", "another prompt"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected duplicate create name conflict, got %v", err)
	}

	if _, err := s.UpdateAgent("agent_guardian", "Shell_Runner", "updated prompt"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected duplicate update name conflict, got %v", err)
	}
}

func TestAgentCatalogRejectsInvalidOrRenamedNames(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.CreateAgent("research partner", "prompt"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected whitespace name conflict, got %v", err)
	}
	if _, err := s.CreateAgent("research-partner", "prompt"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected punctuation name conflict, got %v", err)
	}

	created, err := s.CreateAgent("research_partner", "prompt")
	if err != nil {
		t.Fatalf("create agent returned error: %v", err)
	}
	if _, err := s.UpdateAgent(created.ID, "renamed_partner", "next prompt"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected rename conflict, got %v", err)
	}
}

func TestDeleteAgentRejectsReferencedAgents(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if err := s.DeleteAgent("agent_shell"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict when deleting referenced agent, got %v", err)
	}
}

func TestRoomDetailForDiscussionRoomHasChatOnly(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	detail, err := s.RoomDetail("room_002")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if detail.Room.Kind != "discussion" {
		t.Fatalf("expected discussion room, got %#v", detail.Room)
	}
	if detail.Issue != nil {
		t.Fatalf("expected no issue payload for discussion room, got %#v", detail.Issue)
	}
	if len(detail.Tasks) != 0 || len(detail.Runs) != 0 || len(detail.ToolCalls) != 0 {
		t.Fatalf("expected chat-only discussion room detail, got %#v", detail)
	}
	if len(detail.Messages) == 0 {
		t.Fatal("expected seeded discussion room to contain a welcome message")
	}
}

func TestAddAgentToRoomCreatesIdleSessionAndSystemMessage(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")

	resp, err := s.AddAgentToRoom("room_002", "agent_shell", "Sarah")
	if err != nil {
		t.Fatalf("add agent to room returned error: %v", err)
	}
	if resp.ResultCode != "room_agent_joined" {
		t.Fatalf("expected room_agent_joined, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_002")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected one room agent session, got %#v", detail.AgentSessions)
	}
	if detail.AgentSessions[0].AgentID != "agent_shell" || detail.AgentSessions[0].Status != "idle" || !detail.AgentSessions[0].JoinedRoom {
		t.Fatalf("expected idle room agent session, got %#v", detail.AgentSessions[0])
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if !strings.Contains(lastMessage.Body, "added Shell_Runner to this room") {
		t.Fatalf("expected system join message, got %#v", lastMessage)
	}
}

func TestAddAgentToRoomIsIdempotentForExistingSession(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")

	if _, err := s.AddAgentToRoom("room_002", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("first add agent to room returned error: %v", err)
	}
	resp, err := s.AddAgentToRoom("room_002", "agent_shell", "Sarah")
	if err != nil {
		t.Fatalf("second add agent to room returned error: %v", err)
	}
	if resp.ResultCode != "room_agent_already_joined" {
		t.Fatalf("expected room_agent_already_joined, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_002")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected one room agent session after repeat join, got %#v", detail.AgentSessions)
	}
	if !detail.AgentSessions[0].JoinedRoom {
		t.Fatalf("expected repeated join to preserve joined room membership, got %#v", detail.AgentSessions[0])
	}
	if len(detail.Messages) != 2 {
		t.Fatalf("expected only one additional system join message, got %#v", detail.Messages)
	}
}

func TestRemoveAgentFromRoomDeletesJoinedSessionAndAppendsSystemMessage(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")

	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add agent to room returned error: %v", err)
	}

	resp, err := s.RemoveAgentFromRoom("room_001", "agent_shell", "Sarah")
	if err != nil {
		t.Fatalf("remove agent from room returned error: %v", err)
	}
	if resp.ResultCode != "room_agent_removed" {
		t.Fatalf("expected room_agent_removed, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected room session history to remain available, got %#v", detail.AgentSessions)
	}
	if detail.AgentSessions[0].JoinedRoom {
		t.Fatalf("expected room agent membership to be removed, got %#v", detail.AgentSessions[0])
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if !strings.Contains(lastMessage.Body, "removed Shell_Runner from this room") {
		t.Fatalf("expected system remove message, got %#v", lastMessage)
	}
}

func TestRemoveAgentFromRoomRejectsActiveSession(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")

	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add agent to room returned error: %v", err)
	}
	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先处理一下这个问题。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	if _, err := s.RemoveAgentFromRoom("room_001", "agent_shell", "Sarah"); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict when removing active room agent, got %v", err)
	}
}

func TestBindWorkspaceRepoHydratesIssueAndRoomDetail(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	err := s.BindWorkspaceRepo("ws_01", "/tmp/openshock-demo-repo", "openshock-demo-repo", true)
	if err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}

	issueDetail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if issueDetail.Issue.RepoPath != "/tmp/openshock-demo-repo" {
		t.Fatalf("expected issue detail repo path to be hydrated, got %#v", issueDetail.Issue)
	}

	roomDetail, err := s.RoomDetail("room_101")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if roomDetail.Issue == nil || roomDetail.Issue.RepoPath != "/tmp/openshock-demo-repo" {
		t.Fatalf("expected room detail issue repo path to be hydrated, got %#v", roomDetail.Issue)
	}
	if roomDetail.Workspace.DefaultRepoBindingID == "" || len(roomDetail.Workspace.RepoBindings) != 1 {
		t.Fatalf("expected workspace repo binding to be hydrated, got %#v", roomDetail.Workspace)
	}
}

func TestRoomInstructionMessageCreatesAgentTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell please review the roadmap draft and reply with a plan.")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected one agent session, got %#v", detail.AgentSessions)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentSessions[0].AgentID != "agent_shell" || detail.AgentSessions[0].Status != "queued" {
		t.Fatalf("unexpected agent session payload: %#v", detail.AgentSessions[0])
	}
	if detail.AgentSessions[0].ProviderThreadID == "" {
		t.Fatalf("expected provider thread id to be observable, got %#v", detail.AgentSessions[0])
	}
	if detail.AgentTurns[0].AgentID != "agent_shell" || detail.AgentTurns[0].IntentType != "visible_message_response" || detail.AgentTurns[0].Status != "queued" {
		t.Fatalf("unexpected agent turn payload: %#v", detail.AgentTurns[0])
	}
	if detail.AgentTurns[0].WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", detail.AgentTurns[0])
	}
	if detail.AgentTurns[0].EventFrame.SourceMessageID == "" || detail.AgentTurns[0].EventFrame.CurrentTarget == "" {
		t.Fatalf("expected event frame to be attached to agent turn, got %#v", detail.AgentTurns[0].EventFrame)
	}
	if detail.AgentTurns[0].EventFrame.RequestedBy != "Sarah" {
		t.Fatalf("expected event frame requester to be Sarah, got %#v", detail.AgentTurns[0].EventFrame)
	}

	foundTurnEntity := false
	for _, entity := range resp.AffectedEntities {
		if entity.Type == "agent_turn" {
			foundTurnEntity = true
		}
	}
	if !foundTurnEntity {
		t.Fatalf("expected action response to include agent_turn entity, got %#v", resp.AffectedEntities)
	}

	issueDetail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(issueDetail.AgentSessions) != 0 || len(issueDetail.AgentTurns) != 0 {
		t.Fatalf("discussion room message should not bleed into unrelated issue detail, got %#v %#v", issueDetail.AgentSessions, issueDetail.AgentTurns)
	}
}

func TestRoomPlainParticipantMessageWithoutMentionCreatesVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "有人吗？我想确认一下这里下一步怎么推进。")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected one agent session, got %#v", detail.AgentSessions)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentSessions[0].AgentID != "agent_guardian" || detail.AgentSessions[0].Status != "queued" {
		t.Fatalf("expected selected visible agent session to be queued, got %#v", detail.AgentSessions[0])
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" || detail.AgentTurns[0].Status != "queued" {
		t.Fatalf("unexpected visible message turn payload: %#v", detail.AgentTurns[0])
	}
	if detail.AgentTurns[0].WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", detail.AgentTurns[0])
	}
	if detail.AgentTurns[0].EventFrame.RequestedBy != "Sarah" {
		t.Fatalf("expected event frame requester to be Sarah, got %#v", detail.AgentTurns[0].EventFrame)
	}
}

func TestRoomPlainParticipantStatusMessageWithoutMentionCreatesVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "我刚把文档同步好了。")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || len(detail.AgentTurns) != 1 {
		t.Fatalf("expected plain status message to still enter visible message turn, got %#v %#v", detail.AgentSessions, detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected plain status message to queue a visible message turn, got %#v", detail.AgentTurns[0])
	}
}

func TestRoomPlainInstructionWithoutMentionCreatesVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "instruction", "有人在看这个房间吗？")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected visible message turn for ordinary instruction, got %#v", detail.AgentTurns[0])
	}
}

func TestRoomPlainParticipantMessageWithMentionPrefersMentionedAgent(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "有人吗？ @agent_shell 请直接接一下。")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_shell" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected explicit mention to select the mentioned agent, got %#v", detail.AgentTurns[0])
	}
}

func TestJoinedRoomAgentsAllReceiveVisibleMessageTurns(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell", "agent_guardian")

	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add first room agent returned error: %v", err)
	}
	if _, err := s.AddAgentToRoom("room_001", "agent_guardian", "Sarah"); err != nil {
		t.Fatalf("add second room agent returned error: %v", err)
	}

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 麻烦同步一下下一步。")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 2 {
		t.Fatalf("expected two room agent sessions, got %#v", detail.AgentSessions)
	}
	if len(detail.AgentTurns) != 2 {
		t.Fatalf("expected both joined room agents to receive visible turns, got %#v", detail.AgentTurns)
	}

	turnsByAgentID := make(map[string]core.AgentTurn, len(detail.AgentTurns))
	for _, turn := range detail.AgentTurns {
		turnsByAgentID[turn.AgentID] = turn
	}
	for _, agentID := range []string{"agent_shell", "agent_guardian"} {
		turn, ok := turnsByAgentID[agentID]
		if !ok {
			t.Fatalf("expected joined agent %s to receive a turn, got %#v", agentID, detail.AgentTurns)
		}
		if turn.IntentType != "visible_message_response" || turn.Status != "queued" {
			t.Fatalf("expected visible queued turn for %s, got %#v", agentID, turn)
		}
	}
}

func TestJoinedRoomAgentsSeeAgentAuthoredVisibleMessages(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell", "agent_guardian")

	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add first room agent returned error: %v", err)
	}
	if _, err := s.AddAgentToRoom("room_001", "agent_guardian", "Sarah"); err != nil {
		t.Fatalf("add second room agent returned error: %v", err)
	}

	resp := mustPostRoomMessage(t, s, "room_001", "agent", "agent_shell", "message", "我先同步一下当前进度。")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected only the other joined room agent to receive a turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected agent-authored room message to wake the other joined agent, got %#v", detail.AgentTurns[0])
	}
}

func TestAgentPlainMessageWithoutJoinedRoomAgentsDoesNotCreateVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "agent", "agent_shell", "message", "我先同步一下当前进度。")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 0 || len(detail.AgentTurns) != 0 {
		t.Fatalf("expected agent-authored plain message to avoid visible message turn, got %#v %#v", detail.AgentSessions, detail.AgentTurns)
	}
}

func TestIssueDetailIncludesAgentObservabilityForIssueRoom(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "issue_101", "member", "Sarah", "message", "@agent_shell please review the issue thread and respond.")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room message post result, got %#v", resp)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || len(detail.AgentTurns) != 1 {
		t.Fatalf("expected issue detail to expose agent observability, got %#v %#v", detail.AgentSessions, detail.AgentTurns)
	}
	if detail.AgentSessions[0].ProviderThreadID == "" {
		t.Fatalf("expected provider thread id in issue detail, got %#v", detail.AgentSessions[0])
	}
	if detail.AgentTurns[0].EventFrame.RelatedIssueID != "issue_101" {
		t.Fatalf("expected event frame to include related issue id, got %#v", detail.AgentTurns[0].EventFrame)
	}
}

func TestRoomExplicitInstructionKindCreatesAgentTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "instruction", "@agent_shell please review the roadmap draft and reply with a plan.")
	if resp.ResultCode != "room_message_posted" {
		t.Fatalf("expected room_message_posted result code, got %#v", resp)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected one agent session, got %#v", detail.AgentSessions)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].IntentType != "visible_message_response" || detail.AgentTurns[0].Status != "queued" {
		t.Fatalf("unexpected agent turn payload: %#v", detail.AgentTurns[0])
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if lastMessage.Kind != "instruction" {
		t.Fatalf("expected stored message kind to remain instruction, got %#v", lastMessage)
	}
}

func TestAgentQuestionMessageCreatesOrdinaryFollowupTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	initial := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 请先看一下这个问题。")
	if initial.ResultCode != "room_message_posted" {
		t.Fatalf("expected initial message to succeed, got %#v", initial)
	}

	agentReply := mustPostRoomMessage(t, s, "room_001", "agent", "agent_shell", "message", "我先确认一下：这里是否允许改动 billing guard？")
	if agentReply.ResultCode != "room_message_posted" {
		t.Fatalf("expected agent message to succeed, got %#v", agentReply)
	}

	followup := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "instruction", "可以改 billing guard，继续。")
	if followup.ResultCode != "room_message_posted" {
		t.Fatalf("expected participant followup to succeed, got %#v", followup)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error after followup: %v", err)
	}
	if len(detail.AgentTurns) != 2 {
		t.Fatalf("expected ordinary follow-up turn after participant reply, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[1].IntentType != "visible_message_response" || detail.AgentTurns[1].WakeupMode != "direct_message" {
		t.Fatalf("expected ordinary direct-message wakeup semantics, got %#v", detail.AgentTurns[1])
	}
}

func TestAgentQuestionMessageKeepsSessionInNormalFlow(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	initial := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 请先看一下这个问题。")
	if initial.ResultCode != "room_message_posted" {
		t.Fatalf("expected initial message to succeed, got %#v", initial)
	}

	agentReply := mustPostRoomMessage(t, s, "room_001", "agent", "agent_shell", "message", "我先确认一下：这里是否允许改动 billing guard？")
	if agentReply.ResultCode != "room_message_posted" {
		t.Fatalf("expected agent message to succeed, got %#v", agentReply)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 {
		t.Fatalf("expected one agent session, got %#v", detail.AgentSessions)
	}
	switch detail.AgentSessions[0].Status {
	case "blocked", "handoff_requested":
		t.Fatalf("did not expect ordinary question message to leave session in exceptional state, got %#v", detail.AgentSessions[0])
	}
}

func TestAgentHandoffCreatesTargetAgentTurn(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	initial := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 先看看这个问题，然后按需要分派。")
	if initial.ResultCode != "room_message_posted" {
		t.Fatalf("expected initial message to succeed, got %#v", initial)
	}

	handoff := mustPostRoomMessage(t, s, "room_001", "agent", "agent_shell", "handoff", "@agent_guardian 这里需要你接手做风险评审。")
	if handoff.ResultCode != "room_message_posted" {
		t.Fatalf("expected handoff message to succeed, got %#v", handoff)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.HandoffRecords) != 1 {
		t.Fatalf("expected one handoff record, got %#v", detail.HandoffRecords)
	}
	if detail.HandoffRecords[0].ToAgentID != "agent_guardian" || detail.HandoffRecords[0].Status != "queued" {
		t.Fatalf("unexpected handoff record payload: %#v", detail.HandoffRecords[0])
	}
	if len(detail.AgentTurns) != 2 {
		t.Fatalf("expected handoff to create second turn for target agent, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[1].AgentID != "agent_guardian" || detail.AgentTurns[1].IntentType != "handoff_response" {
		t.Fatalf("unexpected target turn payload: %#v", detail.AgentTurns[1])
	}
	if detail.AgentTurns[1].WakeupMode != "handoff_response" {
		t.Fatalf("expected handoff_response wakeup mode, got %#v", detail.AgentTurns[1])
	}
}

func TestCompleteAgentTurnWithQuestionMessageLeavesSessionCompleted(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 请先看一下这个问题。")
	runtime, err := s.RegisterRuntime("Test Runtime", "codex", 1)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}
	execution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim agent turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued agent turn to be claimed")
	}

	reply := mustPostRoomMessage(t, s, "room_001", "agent", "agent_shell", "message", "请先确认是否可以动 billing guard。")
	messageID := ""
	for _, entity := range reply.AffectedEntities {
		if entity.Type == "message" {
			messageID = entity.ID
			break
		}
	}
	if messageID == "" {
		t.Fatalf("expected agent response to create message entity, got %#v", reply.AffectedEntities)
	}

	if _, err := s.CompleteAgentTurn(execution.Turn.ID, runtime.ID, messageID, "", false); err != nil {
		t.Fatalf("complete agent turn returned error: %v", err)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].Status != "completed" {
		t.Fatalf("expected completed session after ordinary agent reply, got %#v", detail.AgentSessions)
	}
}

func TestCompleteAgentTurnCanClearPersistedAppServerThreadID(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 帮我再看一下。")
	runtime, err := s.RegisterRuntime("Test Runtime", "codex", 1)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}
	execution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim agent turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued agent turn to be claimed")
	}

	sessionIndex, ok := s.agentSessionIndexByIDLocked(execution.Session.ID)
	if !ok {
		t.Fatalf("expected session %s to exist", execution.Session.ID)
	}
	s.agentSessions[sessionIndex].AppServerThreadID = "thread_stale_001"

	if _, err := s.CompleteAgentTurn(execution.Turn.ID, runtime.ID, "", "", true); err != nil {
		t.Fatalf("complete agent turn returned error: %v", err)
	}
	if s.agentSessions[sessionIndex].AppServerThreadID != "" {
		t.Fatalf("expected app-server thread id to be cleared, got %#v", s.agentSessions[sessionIndex])
	}
}

func TestClaimNextQueuedRun(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	run, _, claimed, err := s.ClaimNextQueuedRun("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued run to be claimed")
	}
	if run.Status != "running" {
		t.Fatalf("expected claimed run to be running, got %q", run.Status)
	}
	if run.RuntimeID != "rt_local" {
		t.Fatalf("expected runtime id rt_local, got %q", run.RuntimeID)
	}
}

func TestCreateRunRequiresWorkspaceDefaultRepo(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.CreateRun("task_guard"); err == nil {
		t.Fatal("expected create run to fail without a workspace default repo binding")
	}
}

func TestIngestRunEventCompleted(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	run, _, claimed, err := s.ClaimNextQueuedRun("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued run to be claimed")
	}

	run, err = s.IngestRunEvent(run.ID, "rt_local", "completed", "done", "", "", nil)
	if err != nil {
		t.Fatalf("ingest returned error: %v", err)
	}
	if run.Status != "completed" {
		t.Fatalf("expected completed status, got %q", run.Status)
	}
	if run.OutputPreview != "done" {
		t.Fatalf("expected output preview to update, got %q", run.OutputPreview)
	}
}

func TestRunOutputEventAppendsChunks(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, _, claimed, err := s.ClaimNextQueuedRun("rt_local"); err != nil {
		t.Fatalf("claim returned error: %v", err)
	} else if !claimed {
		t.Fatal("expected a queued run to be claimed")
	}

	if _, err := s.IngestRunEvent("run_review_01", "rt_local", "output", "preview one", "first output chunk", "stdout", nil); err != nil {
		t.Fatalf("first output event returned error: %v", err)
	}
	if _, err := s.IngestRunEvent("run_review_01", "rt_local", "output", "preview two", "second output chunk", "stdout", nil); err != nil {
		t.Fatalf("second output event returned error: %v", err)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(detail.RunOutputChunks) < 2 {
		t.Fatalf("expected appended run output chunks, got %#v", detail.RunOutputChunks)
	}

	lastTwo := detail.RunOutputChunks[len(detail.RunOutputChunks)-2:]
	if lastTwo[0].Sequence != 1 || lastTwo[1].Sequence != 2 {
		t.Fatalf("expected append-only chunk sequence 1,2 got %#v", lastTwo)
	}
	if lastTwo[1].Content != "second output chunk" {
		t.Fatalf("unexpected chunk content: %#v", lastTwo[1])
	}
}

func TestToolCallEventAppendsToolCalls(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, _, claimed, err := s.ClaimNextQueuedRun("rt_local"); err != nil {
		t.Fatalf("claim returned error: %v", err)
	} else if !claimed {
		t.Fatal("expected a queued run to be claimed")
	}

	firstToolCall := &core.ToolCallInput{
		ToolName:  "openshock",
		Arguments: `{"command":"task create"}`,
		Status:    "completed",
	}
	secondToolCall := &core.ToolCallInput{
		ToolName:  "git",
		Arguments: `{"command":"status"}`,
		Status:    "completed",
	}
	if _, err := s.IngestRunEvent("run_review_01", "rt_local", "tool_call", "", "", "", firstToolCall); err != nil {
		t.Fatalf("first tool call returned error: %v", err)
	}
	if _, err := s.IngestRunEvent("run_review_01", "rt_local", "tool_call", "", "", "", secondToolCall); err != nil {
		t.Fatalf("second tool call returned error: %v", err)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(detail.ToolCalls) < 2 {
		t.Fatalf("expected appended tool calls, got %#v", detail.ToolCalls)
	}

	lastTwo := detail.ToolCalls[len(detail.ToolCalls)-2:]
	if lastTwo[0].Sequence != 1 || lastTwo[1].Sequence != 2 {
		t.Fatalf("expected append-only tool call sequence 1,2 got %#v", lastTwo)
	}
	if lastTwo[1].ToolName != "git" {
		t.Fatalf("unexpected tool call payload: %#v", lastTwo[1])
	}
}

func TestAgentTurnOutputEventAppendsOutputChunks(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先给我一个计划。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	execution, claimed, err := s.ClaimNextQueuedAgentTurn("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued agent turn to be claimed")
	}
	if execution.AgentName != "Shell_Runner" {
		t.Fatalf("expected claimed turn to expose agent display name, got %#v", execution)
	}
	if execution.AgentPrompt == "" {
		t.Fatalf("expected claimed turn to expose agent prompt, got %#v", execution)
	}
	if !strings.Contains(execution.Instruction, "你在房间界面里的名字是 `Shell_Runner`。") {
		t.Fatalf("expected claimed turn to expose backend-built instruction, got %#v", execution)
	}
	if !strings.Contains(execution.Instruction, execution.AgentPrompt) {
		t.Fatalf("expected claimed turn to expose backend-built instruction, got %#v", execution)
	}

	if _, err := s.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "output", "first streamed output", "stdout", nil); err != nil {
		t.Fatalf("first output event returned error: %v", err)
	}
	if _, err := s.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "output", "second streamed output", "stderr", nil); err != nil {
		t.Fatalf("second output event returned error: %v", err)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurnOutputChunks) < 2 {
		t.Fatalf("expected appended agent turn output chunks, got %#v", detail.AgentTurnOutputChunks)
	}

	lastTwo := detail.AgentTurnOutputChunks[len(detail.AgentTurnOutputChunks)-2:]
	if lastTwo[0].Sequence != 1 || lastTwo[1].Sequence != 2 {
		t.Fatalf("expected append-only chunk sequence 1,2 got %#v", lastTwo)
	}
	if lastTwo[1].Stream != "stderr" || lastTwo[1].Content != "second streamed output" {
		t.Fatalf("unexpected agent turn output payload: %#v", lastTwo[1])
	}
}

func TestAgentTurnToolCallEventAppendsToolCalls(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先给我一个计划。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	execution, claimed, err := s.ClaimNextQueuedAgentTurn("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued agent turn to be claimed")
	}

	firstToolCall := &core.ToolCallInput{
		ToolName:  "shell",
		Arguments: `{"command":"git status"}`,
		Status:    "completed",
	}
	secondToolCall := &core.ToolCallInput{
		ToolName:  "openshock",
		Arguments: `{"command":"task create"}`,
		Status:    "completed",
	}
	if _, err := s.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "tool_call", "", "", firstToolCall); err != nil {
		t.Fatalf("first tool call returned error: %v", err)
	}
	if _, err := s.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "tool_call", "", "", secondToolCall); err != nil {
		t.Fatalf("second tool call returned error: %v", err)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurnToolCalls) < 2 {
		t.Fatalf("expected appended agent turn tool calls, got %#v", detail.AgentTurnToolCalls)
	}

	lastTwo := detail.AgentTurnToolCalls[len(detail.AgentTurnToolCalls)-2:]
	if lastTwo[0].Sequence != 1 || lastTwo[1].Sequence != 2 {
		t.Fatalf("expected append-only tool call sequence 1,2 got %#v", lastTwo)
	}
	if lastTwo[1].ToolName != "openshock" {
		t.Fatalf("unexpected agent turn tool call payload: %#v", lastTwo[1])
	}
}

func TestAgentTurnObservabilityRollsAfterRetentionWindow(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先给我一个计划。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	execution, claimed, err := s.ClaimNextQueuedAgentTurn("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued agent turn to be claimed")
	}

	oldTimestamp := time.Now().UTC().Add(-agentTurnObservabilityRetention - time.Hour).Format(time.RFC3339)
	s.agentTurnOutputChunks = append(s.agentTurnOutputChunks, core.AgentTurnOutputChunk{
		ID:        "agent_turn_output_old",
		TurnID:    execution.Turn.ID,
		Sequence:  99,
		Stream:    "stdout",
		Content:   "old output",
		CreatedAt: oldTimestamp,
	})
	s.agentTurnToolCalls = append(s.agentTurnToolCalls, core.AgentTurnToolCall{
		ID:        "agent_turn_tool_call_old",
		TurnID:    execution.Turn.ID,
		Sequence:  99,
		ToolName:  "shell",
		Status:    "completed",
		CreatedAt: oldTimestamp,
	})

	if _, err := s.IngestAgentTurnEvent(execution.Turn.ID, "rt_local", "output", "fresh output", "stdout", nil); err != nil {
		t.Fatalf("fresh output event returned error: %v", err)
	}

	for _, chunk := range s.agentTurnOutputChunks {
		if chunk.ID == "agent_turn_output_old" {
			t.Fatalf("expected old output chunk to be pruned, got %#v", s.agentTurnOutputChunks)
		}
	}
	for _, toolCall := range s.agentTurnToolCalls {
		if toolCall.ID == "agent_turn_tool_call_old" {
			t.Fatalf("expected old tool call to be pruned, got %#v", s.agentTurnToolCalls)
		}
	}
}

func TestClaimNextQueuedAgentTurnSerializesSessionClaims(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")
	runtime, err := s.RegisterRuntime("Local Daemon", "codex", 2)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}

	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add room agent returned error: %v", err)
	}
	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 先看第一条。"); err != nil {
		t.Fatalf("post first room message returned error: %v", err)
	}

	firstExecution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim first turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected first agent turn to be claimed")
	}

	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 再跟进第二条。"); err != nil {
		t.Fatalf("post second room message returned error: %v", err)
	}

	if _, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID); err != nil {
		t.Fatalf("claim second turn while first is active returned error: %v", err)
	} else if claimed {
		t.Fatal("expected same session follow-up turn to wait until the active turn completes")
	}

	if _, err := s.CompleteAgentTurn(firstExecution.Turn.ID, runtime.ID, "", "", false); err != nil {
		t.Fatalf("complete first turn returned error: %v", err)
	}

	secondExecution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim second turn after completion returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued follow-up turn to be claimable after completion")
	}
	if secondExecution.Turn.TriggerMessageID == firstExecution.Turn.TriggerMessageID {
		t.Fatalf("expected follow-up turn to target the newer message, got %#v", secondExecution.Turn)
	}
}

func TestReconcileRuntimeHealthRequeuesClaimedAgentTurn(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")
	runtime, err := s.RegisterRuntime("Local Daemon", "codex", 1)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}

	if _, err := s.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add room agent returned error: %v", err)
	}
	if _, err := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 看一下卡住恢复。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	execution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim agent turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected agent turn to be claimed")
	}

	for i := range s.runtimes {
		if s.runtimes[i].ID == runtime.ID {
			s.runtimes[i].LastHeartbeatAt = time.Now().UTC().Add(-runtimeHeartbeatTTL - time.Second).Format(time.RFC3339)
		}
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 || detail.AgentTurns[0].Status != "queued" || detail.AgentTurns[0].RuntimeID != "" {
		t.Fatalf("expected claimed turn to be requeued after stale heartbeat, got %#v", detail.AgentTurns)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].Status != "queued" {
		t.Fatalf("expected session to return to queued after stale heartbeat, got %#v", detail.AgentSessions)
	}
	if detail.AgentSessions[0].CurrentTurnID != execution.Turn.ID {
		t.Fatalf("expected session current turn to stay on the requeued turn, got %#v", detail.AgentSessions[0])
	}
}

func TestClaimNextQueuedRunReturnsExistingAgentSession(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_guardian")
	bindDefaultWorkspaceRepo(t, s)
	runtime, err := s.RegisterRuntime("Local Daemon", "codex", 1)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}

	issueResp := s.CreateIssue("Run Session Issue", "verify run session reuse", "high")
	issueID := issueResp.AffectedEntities[0].ID
	if _, err := s.AddAgentToRoom(issueID, "agent_guardian", "Sarah"); err != nil {
		t.Fatalf("add issue room agent returned error: %v", err)
	}
	taskResp, err := s.CreateTask(issueID, "Guard task", "exercise run session mapping", "agent_guardian")
	if err != nil {
		t.Fatalf("create task returned error: %v", err)
	}
	taskID := taskResp.AffectedEntities[0].ID
	if _, err := s.CreateRun(taskID); err != nil {
		t.Fatalf("create run returned error: %v", err)
	}

	run, agentSession, claimed, err := s.ClaimNextQueuedRun(runtime.ID)
	if err != nil {
		t.Fatalf("claim run returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected run to be claimed")
	}
	if run.TaskID != taskID {
		t.Fatalf("expected claimed run for %s, got %#v", taskID, run)
	}
	room, ok := s.findRoomByIssue(issueID)
	if !ok {
		t.Fatalf("expected room for issue %s", issueID)
	}
	if agentSession == nil || agentSession.AgentID != "agent_guardian" || agentSession.RoomID != room.ID {
		t.Fatalf("expected existing issue agent session to be attached, got %#v", agentSession)
	}
}

func TestClaimNextQueuedRunWaitsForActiveAgentSessionWork(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_guardian")
	bindDefaultWorkspaceRepo(t, s)
	runtime, err := s.RegisterRuntime("Local Daemon", "codex", 2)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}

	issueResp := s.CreateIssue("Run Wait Issue", "serialize agent work", "high")
	issueID := issueResp.AffectedEntities[0].ID
	if _, err := s.AddAgentToRoom(issueID, "agent_guardian", "Sarah"); err != nil {
		t.Fatalf("add issue room agent returned error: %v", err)
	}
	if _, err := s.PostRoomMessage(issueID, "member", "Sarah", "message", "@agent_guardian 先回房间消息。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	turnExecution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim agent turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected room agent turn to be claimed")
	}

	taskResp, err := s.CreateTask(issueID, "Guard task", "serialize with room turn", "agent_guardian")
	if err != nil {
		t.Fatalf("create task returned error: %v", err)
	}
	taskID := taskResp.AffectedEntities[0].ID
	if _, err := s.CreateRun(taskID); err != nil {
		t.Fatalf("create run returned error: %v", err)
	}
	if _, _, claimed, err := s.ClaimNextQueuedRun(runtime.ID); err != nil {
		t.Fatalf("claim run while agent turn is active returned error: %v", err)
	} else if claimed {
		t.Fatal("expected run to wait while the same agent session already has active Codex work")
	}

	if _, err := s.CompleteAgentTurn(turnExecution.Turn.ID, runtime.ID, "", "", false); err != nil {
		t.Fatalf("complete agent turn returned error: %v", err)
	}
	if _, _, claimed, err := s.ClaimNextQueuedRun(runtime.ID); err != nil {
		t.Fatalf("claim run after agent turn completion returned error: %v", err)
	} else if !claimed {
		t.Fatal("expected run to become claimable after the agent session is free")
	}
}

func TestSetTaskStatusUpdatesEditableTaskState(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp, err := s.SetTaskStatus("task_guard", "blocked", "Sarah")
	if err != nil {
		t.Fatalf("set task status returned error: %v", err)
	}
	if resp.ResultCode != "task_status_updated" {
		t.Fatalf("expected task_status_updated result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	found := false
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "blocked" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected task_guard to become blocked, got %#v", detail.Tasks)
	}
}

func TestSetTaskStatusSystemMessageUsesAgentDisplayName(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.SetTaskStatus("task_guard", "in_progress", "agent_shell"); err != nil {
		t.Fatalf("set task status returned error: %v", err)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if strings.Contains(lastMessage.Body, "agent_shell") {
		t.Fatalf("expected system message to avoid agent id, got %#v", lastMessage)
	}
	if !strings.Contains(lastMessage.Body, "Shell_Runner set task") {
		t.Fatalf("expected system message to use agent display name, got %#v", lastMessage)
	}
}

func TestBuildRunInstructionIncludesTaskStatusCommands(t *testing.T) {
	instruction := buildRunInstruction(core.Task{
		ID:              "task_guard",
		Title:           "Add retention guard around handoff queue",
		Description:     "Patch the observer queue to drop stale references on handoff.",
		AssigneeAgentID: "agent_shell",
		BranchName:      "issue-101/task-guard",
	})

	for _, expected := range []string{
		"任务 ID：task_guard",
		"这是当前任务分支的一次单次执行。",
		"执行期间可使用 OpenShock CLI，命令名为 `openshock`。",
		"尽早把任务状态更新为 `in_progress`",
		"openshock task status set --task task_guard --status in_progress --actor-id agent_shell",
		"停止前要完成代码修改和验证。",
		"openshock task status set --task task_guard --status blocked --actor-id agent_shell",
		"请在最终总结里清楚说明真实阻塞点。",
		"openshock task mark-ready --task task_guard --actor-id agent_shell",
		"最终总结里需要同时包含代码改动和你实际执行过的验证。",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected instruction to contain %q, got:\n%s", expected, instruction)
		}
	}
}

func TestPostRoomMessageRejectsUnknownTarget(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.PostRoomMessage("room_missing", "member", "Sarah", "message", "有人吗？"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown room target, got %v", err)
	}
}

func TestPostRoomMessageStoresAgentDisplayName(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.PostRoomMessage("room_001", "agent", "agent_shell", "message", "我先同步一下当前进度。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if lastMessage.ActorName != "Shell_Runner" {
		t.Fatalf("expected agent display name Shell_Runner, got %#v", lastMessage)
	}
}

func TestClaimNextQueuedAgentTurnSkipsInvalidTurnAndClaimsNextValid(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 先看这个损坏 turn。")
	s.agentTurns[0].RoomID = "room_missing"

	second := mustPostRoomMessage(t, s, "room_001", "member", "Sarah", "message", "@agent_shell 再处理这个有效 turn。")
	validMessageID := ""
	for _, entity := range second.AffectedEntities {
		if entity.Type == "message" {
			validMessageID = entity.ID
			break
		}
	}
	if validMessageID == "" {
		t.Fatalf("expected second message id, got %#v", second.AffectedEntities)
	}

	runtime, err := s.RegisterRuntime("Daemon Runner", "codex", 1)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}
	execution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim agent turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a valid queued turn to still be claimable")
	}
	if execution.Turn.TriggerMessageID != validMessageID {
		t.Fatalf("expected claim to skip invalid turn and select valid trigger %q, got %#v", validMessageID, execution.Turn)
	}
	if s.agentTurns[0].Status != "completed" {
		t.Fatalf("expected invalid turn to be invalidated, got %#v", s.agentTurns[0])
	}
}

func TestCreateTaskRejectsUnknownIssue(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	if _, err := s.CreateTask("issue_missing", "Write patch", "Handle missing issue validation.", "agent_shell"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown issue, got %v", err)
	}
}

func TestRegisterRuntime(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	runtime, err := s.RegisterRuntime("Daemon Runner", "codex", 2)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}
	if runtime.ID == "" {
		t.Fatal("expected runtime id to be assigned")
	}
	if runtime.Name != "Daemon Runner" {
		t.Fatalf("expected runtime name to match, got %q", runtime.Name)
	}
}

func TestRegisterRuntimeRejectsActiveDuplicateNameAndProvider(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	first, err := s.RegisterRuntime("Daemon Runner", "codex", 1)
	if err != nil {
		t.Fatalf("first register runtime returned error: %v", err)
	}
	if _, err := s.RegisterRuntime("Daemon Runner", "codex", 4); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict for active duplicate runtime, got %v", err)
	}
	if first.ID == "" {
		t.Fatal("expected first runtime id to be assigned")
	}
}

func TestRequestMergeCreatesInboxItem(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp, err := s.RequestMerge("task_guard")
	if err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if resp.Status != "approval_required" {
		t.Fatalf("expected approval_required status, got %q", resp.Status)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	taskReady := false
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "ready_for_integration" {
			taskReady = true
		}
	}
	if !taskReady {
		t.Fatalf("expected task_guard to be ready_for_integration, got %#v", detail.Tasks)
	}

	inbox := s.Inbox().Items
	foundApproval := false
	for _, item := range inbox {
		if item.RelatedEntityType == "task" && item.RelatedEntityID == "task_guard" && item.PrimaryActionType == "GitIntegration.merge.approve" {
			foundApproval = true
		}
	}
	if !foundApproval {
		t.Fatalf("expected merge approval inbox item, got %#v", inbox)
	}
}

func TestBlockedRunEventCreatesInboxItemAndMessage(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)
	_, _, claimed, err := s.ClaimNextQueuedRun("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued run to be claimed")
	}

	beforeInbox := len(s.Inbox().Items)
	beforeIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	_, err = s.IngestRunEvent("run_review_01", "rt_local", "blocked", "needs owner input", "", "", nil)
	if err != nil {
		t.Fatalf("ingest returned error: %v", err)
	}

	afterInbox := len(s.Inbox().Items)
	if afterInbox != beforeInbox+1 {
		t.Fatalf("expected blocked event to create inbox item, got before=%d after=%d", beforeInbox, afterInbox)
	}

	afterIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(afterIssue.Messages) == len(beforeIssue.Messages) {
		t.Fatal("expected blocked event to append a room/system message")
	}
}

func TestStartedRunEventDoesNotAppendRoomMessage(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	beforeIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	if _, err := s.IngestRunEvent("run_review_01", "rt_local", "started", "daemon started execution", "", "", nil); err != nil {
		t.Fatalf("ingest returned error: %v", err)
	}

	afterIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(afterIssue.Messages) != len(beforeIssue.Messages) {
		t.Fatalf("expected started run event to stay out of room timeline, before=%d after=%d", len(beforeIssue.Messages), len(afterIssue.Messages))
	}
}

func TestCompletedRunEventDoesNotAppendRoomMessage(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	beforeIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	if _, err := s.IngestRunEvent("run_review_01", "rt_local", "completed", "all checks passed", "", "", nil); err != nil {
		t.Fatalf("ingest returned error: %v", err)
	}

	afterIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(afterIssue.Messages) != len(beforeIssue.Messages) {
		t.Fatalf("expected completed run event to stay out of room timeline, before=%d after=%d", len(beforeIssue.Messages), len(afterIssue.Messages))
	}
}

func TestApproveRunRequeuesAndClearsInbox(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	beforeInbox := len(s.Inbox().Items)
	resp, err := s.ApproveRun("run_guard_01", "Sarah")
	if err != nil {
		t.Fatalf("approve run returned error: %v", err)
	}
	if resp.ResultCode != "run_requeued" {
		t.Fatalf("expected run_requeued result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	foundQueued := false
	for _, run := range detail.Runs {
		if run.ID == "run_guard_01" && run.Status == "queued" {
			foundQueued = true
		}
	}
	if !foundQueued {
		t.Fatal("expected approved run to be re-queued")
	}

	afterInbox := len(s.Inbox().Items)
	if afterInbox >= beforeInbox {
		t.Fatalf("expected approval inbox item to be cleared, got before=%d after=%d", beforeInbox, afterInbox)
	}
}

func TestCancelRunMarksTaskBlocked(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp, err := s.CancelRun("run_review_01", "Sarah")
	if err != nil {
		t.Fatalf("cancel run returned error: %v", err)
	}
	if resp.ResultCode != "run_cancelled" {
		t.Fatalf("expected run_cancelled result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	runCancelled := false
	taskBlocked := false
	for _, run := range detail.Runs {
		if run.ID == "run_review_01" && run.Status == "cancelled" {
			runCancelled = true
		}
	}
	for _, task := range detail.Tasks {
		if task.ID == "task_review" && task.Status == "blocked" {
			taskBlocked = true
		}
	}
	if !runCancelled {
		t.Fatal("expected run to be cancelled")
	}
	if !taskBlocked {
		t.Fatal("expected task to be marked blocked after cancellation")
	}
}

func TestCreateDeliveryPRRequiresReadyIntegration(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	_, err := s.CreateDeliveryPR("issue_101", "Sarah")
	if err == nil {
		t.Fatal("expected delivery pr creation to fail before integration branch is ready")
	}
}

func TestCreateDeliveryPRMovesIssueToReview(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	respA, err := s.ApproveMerge("task_guard", "Sarah")
	if err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	if respA.ResultCode != "merge_attempt_queued" {
		t.Fatalf("expected merge_attempt_queued result code, got %q", respA.ResultCode)
	}
	attemptA, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected task_guard merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attemptA.ID, "rt_local", "succeeded", "merged guard task"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}

	if _, err := s.RequestMerge("task_review"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	respB, err := s.ApproveMerge("task_review", "Sarah")
	if err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	if respB.ResultCode != "merge_attempt_queued" {
		t.Fatalf("expected merge_attempt_queued result code, got %q", respB.ResultCode)
	}
	attemptB, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected task_review merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attemptB.ID, "rt_local", "succeeded", "merged review task"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}

	resp, err := s.CreateDeliveryPR("issue_101", "Sarah")
	if err != nil {
		t.Fatalf("create delivery pr returned error: %v", err)
	}
	if resp.ResultCode != "delivery_pr_created" {
		t.Fatalf("expected delivery_pr_created result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if detail.DeliveryPR == nil {
		t.Fatal("expected delivery pr to be attached to issue")
	}
	if detail.Issue.Status != "in_review" {
		t.Fatalf("expected issue to move to in_review, got %q", detail.Issue.Status)
	}
	if detail.IntegrationBranch.Status != "ready_for_delivery" {
		t.Fatalf("expected branch to stay ready_for_delivery, got %q", detail.IntegrationBranch.Status)
	}
	if detail.DeliveryPR.ExternalPRID == "" || detail.DeliveryPR.ExternalURL == "" {
		t.Fatalf("expected external delivery pr metadata, got %#v", detail.DeliveryPR)
	}
}

func TestRepoWebhookMergeMovesIssueDoneAndIsIdempotent(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	attemptA, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected first merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attemptA.ID, "rt_local", "succeeded", "merged guard task"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}
	if _, err := s.RequestMerge("task_review"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_review", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	attemptB, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected second merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attemptB.ID, "rt_local", "succeeded", "merged review task"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}

	if _, err := s.CreateDeliveryPR("issue_101", "Sarah"); err != nil {
		t.Fatalf("create delivery pr returned error: %v", err)
	}

	first, err := s.IngestRepoWebhook("evt_delivery_1", "github", "gh_pr_102", "merged")
	if err != nil {
		t.Fatalf("first webhook returned error: %v", err)
	}
	if first.Status != "merged" || first.Replayed {
		t.Fatalf("unexpected first webhook response: %#v", first)
	}
	second, err := s.IngestRepoWebhook("evt_delivery_1", "github", "gh_pr_102", "merged")
	if err != nil {
		t.Fatalf("second webhook returned error: %v", err)
	}
	if !second.Replayed || second.Status != "merged" {
		t.Fatalf("expected replayed webhook response, got %#v", second)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if detail.Issue.Status != "done" {
		t.Fatalf("expected issue to move to done, got %q", detail.Issue.Status)
	}
	if detail.DeliveryPR == nil || detail.DeliveryPR.Status != "merged" {
		t.Fatalf("expected delivery pr to be merged, got %#v", detail.DeliveryPR)
	}
	if detail.IntegrationBranch.Status != "merged_to_main" {
		t.Fatalf("expected integration branch to be merged_to_main, got %q", detail.IntegrationBranch.Status)
	}
}

func TestMarkTaskReadyForIntegrationRequestsReview(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())

	resp, err := s.MarkTaskReadyForIntegration("task_guard")
	if err != nil {
		t.Fatalf("mark ready returned error: %v", err)
	}
	if resp.ResultCode != "task_ready_for_integration" {
		t.Fatalf("expected task_ready_for_integration result code, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	taskReady := false
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "ready_for_integration" {
			taskReady = true
		}
	}
	if !taskReady {
		t.Fatalf("expected task_guard to be ready_for_integration, got %#v", detail.Tasks)
	}
}

func TestApproveMergeQueuesMergeAttempt(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}

	resp, err := s.ApproveMerge("task_guard", "Sarah")
	if err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}
	if resp.ResultCode != "merge_attempt_queued" {
		t.Fatalf("expected merge_attempt_queued, got %q", resp.ResultCode)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(detail.MergeAttempts) != 1 || detail.MergeAttempts[0].Status != "queued" {
		t.Fatalf("expected one queued merge attempt, got %#v", detail.MergeAttempts)
	}
}

func TestApproveMergePrefersLatestCompletedRunAsSource(t *testing.T) {
	s := NewMemoryStore()
	mustCreateTestAgents(t, s, "agent_shell")
	bindDefaultWorkspaceRepo(t, s)
	runtime, err := s.RegisterRuntime("Local Daemon", "codex", 1)
	if err != nil {
		t.Fatalf("register runtime returned error: %v", err)
	}

	issueResp := s.CreateIssue("Acceptance Issue", "source run selection", "high")
	issueID := issueResp.AffectedEntities[0].ID
	taskResp, err := s.CreateTask(issueID, "Acceptance Task", "verify merge source run", "agent_shell")
	if err != nil {
		t.Fatalf("create task returned error: %v", err)
	}
	taskID := taskResp.AffectedEntities[0].ID

	if _, err := s.CreateRun(taskID); err != nil {
		t.Fatalf("first create run returned error: %v", err)
	}
	if _, err := s.CreateRun(taskID); err != nil {
		t.Fatalf("second create run returned error: %v", err)
	}

	runOne, _, claimed, err := s.ClaimNextQueuedRun(runtime.ID)
	if err != nil {
		t.Fatalf("claim first run returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected first run to be claimed")
	}
	if _, err := s.IngestRunEvent(runOne.ID, runtime.ID, "completed", "completed", "", "", nil); err != nil {
		t.Fatalf("complete first run returned error: %v", err)
	}

	runTwo, _, claimed, err := s.ClaimNextQueuedRun(runtime.ID)
	if err != nil {
		t.Fatalf("claim second run returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected second run to be claimed")
	}
	if _, err := s.IngestRunEvent(runTwo.ID, runtime.ID, "blocked", "blocked", "", "", nil); err != nil {
		t.Fatalf("block second run returned error: %v", err)
	}

	if _, err := s.RequestMerge(taskID); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge(taskID, "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	detail, err := s.IssueDetail(issueID)
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(detail.MergeAttempts) != 1 {
		t.Fatalf("expected one merge attempt, got %#v", detail.MergeAttempts)
	}
	if detail.MergeAttempts[0].SourceRunID != runOne.ID {
		t.Fatalf("expected merge to prefer completed run %s, got %s", runOne.ID, detail.MergeAttempts[0].SourceRunID)
	}
}

func TestApproveMergeRequiresPendingApprovalRequest(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.ApproveMerge("task_review", "Sarah"); err == nil {
		t.Fatal("expected merge approval to fail without a pending approval request")
	}
}

func TestRequestMergeRejectsIntegratedTask(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	attempt, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued merge attempt to be claimed")
	}
	if _, err := s.IngestMergeEvent(attempt.ID, "rt_local", "succeeded", "merged cleanly"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}

	if _, err := s.RequestMerge("task_guard"); err == nil {
		t.Fatal("expected merge request to fail for an integrated task")
	}
}

func TestMergeEventSucceededIntegratesTask(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	attempt, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued merge attempt to be claimed")
	}

	result, err := s.IngestMergeEvent(attempt.ID, "rt_local", "succeeded", "merged cleanly")
	if err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}
	if result.Status != "succeeded" {
		t.Fatalf("expected merge attempt succeeded, got %q", result.Status)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	taskIntegrated := false
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "integrated" {
			taskIntegrated = true
		}
	}
	if !taskIntegrated {
		t.Fatal("expected merge success to integrate task")
	}
}

func TestMergeEventConflictBlocksTask(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	attempt, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued merge attempt to be claimed")
	}

	result, err := s.IngestMergeEvent(attempt.ID, "rt_local", "conflicted", "shared.txt conflicted")
	if err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}
	if result.Status != "conflicted" {
		t.Fatalf("expected merge attempt conflicted, got %q", result.Status)
	}

	detail, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	taskBlocked := false
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "blocked" {
			taskBlocked = true
		}
	}
	if !taskBlocked {
		t.Fatalf("expected task_guard to be blocked after conflict, got %#v", detail.Tasks)
	}
}

func TestStartedMergeEventDoesNotAppendRoomMessage(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	beforeIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	attempt, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued merge attempt to be claimed")
	}

	if _, err := s.IngestMergeEvent(attempt.ID, "rt_local", "started", "daemon started merge execution"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}

	afterIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(afterIssue.Messages) != len(beforeIssue.Messages) {
		t.Fatalf("expected started merge event to stay out of room timeline, before=%d after=%d", len(beforeIssue.Messages), len(afterIssue.Messages))
	}
}

func TestSucceededMergeEventDoesNotAppendRoomMessage(t *testing.T) {
	s := NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := s.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	beforeIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	attempt, claimed, err := s.ClaimNextQueuedMerge("rt_local")
	if err != nil {
		t.Fatalf("claim merge returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued merge attempt to be claimed")
	}

	if _, err := s.IngestMergeEvent(attempt.ID, "rt_local", "succeeded", "merged cleanly"); err != nil {
		t.Fatalf("ingest merge event returned error: %v", err)
	}

	afterIssue, err := s.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	if len(afterIssue.Messages) != len(beforeIssue.Messages) {
		t.Fatalf("expected succeeded merge event to stay out of room timeline, before=%d after=%d", len(beforeIssue.Messages), len(afterIssue.Messages))
	}
}
