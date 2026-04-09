package store

import (
	"strings"
	"testing"

	"openshock/backend/internal/core"
)

func bindDefaultWorkspaceRepo(t *testing.T, s *MemoryStore) string {
	t.Helper()

	repoPath := "/tmp/openshock-demo-repo"
	if err := s.BindWorkspaceRepo("ws_01", repoPath, "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	return repoPath
}

func TestCreateIssueCreatesRoomAndIntegrationBranch(t *testing.T) {
	s := NewMemoryStore()

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
	s := NewMemoryStore()

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
	s := NewMemoryStore()

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

func TestRoomDetailForDiscussionRoomHasChatOnly(t *testing.T) {
	s := NewMemoryStore()

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

func TestBindWorkspaceRepoHydratesIssueAndRoomDetail(t *testing.T) {
	s := NewMemoryStore()

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
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell please review the roadmap draft and reply with a plan.")
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

func TestRoomPlainHumanMessageWithoutMentionCreatesVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "member", "Sarah", "message", "有人吗？我想确认一下这里下一步怎么推进。")
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

func TestRoomPlainHumanStatusMessageWithoutMentionCreatesVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "member", "Sarah", "message", "我刚把文档同步好了。")
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
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "member", "Sarah", "instruction", "有人在看这个房间吗？")
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

func TestRoomPlainHumanMessageWithMentionPrefersMentionedAgent(t *testing.T) {
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "member", "Sarah", "message", "有人吗？ @agent_shell 请直接接一下。")
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

func TestAgentPlainMessageWithoutMentionDoesNotCreateVisibleMessageTurn(t *testing.T) {
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "agent", "agent_shell", "message", "我先同步一下当前进度。")
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
	s := NewMemoryStore()

	resp := s.PostRoomMessage("issue_101", "member", "Sarah", "message", "@agent_shell please review the issue thread and respond.")
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
	s := NewMemoryStore()

	resp := s.PostRoomMessage("room_001", "member", "Sarah", "instruction", "@agent_shell please review the roadmap draft and reply with a plan.")
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

func TestAgentClarificationInstructionRequeuesTurn(t *testing.T) {
	s := NewMemoryStore()

	initial := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先看一下这个问题。")
	if initial.ResultCode != "room_message_posted" {
		t.Fatalf("expected initial message to succeed, got %#v", initial)
	}

	agentReply := s.PostRoomMessage("room_001", "agent", "agent_shell", "clarification_request", "我需要先确认是否允许改动 billing guard。")
	if agentReply.ResultCode != "room_message_posted" {
		t.Fatalf("expected clarification request to succeed, got %#v", agentReply)
	}

	followup := s.PostRoomMessage("room_001", "member", "Sarah", "instruction", "可以改 billing guard，继续。")
	if followup.ResultCode != "room_message_posted" {
		t.Fatalf("expected human followup to succeed, got %#v", followup)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error after followup: %v", err)
	}
	if len(detail.AgentTurns) != 2 {
		t.Fatalf("expected followup to queue a second turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[1].IntentType != "clarification_followup" || detail.AgentTurns[1].Status != "queued" {
		t.Fatalf("unexpected followup turn payload: %#v", detail.AgentTurns[1])
	}
	if detail.AgentTurns[1].WakeupMode != "clarification_followup" {
		t.Fatalf("expected clarification_followup wakeup mode, got %#v", detail.AgentTurns[1])
	}
	if detail.AgentWaits[0].Status != "resolved" {
		t.Fatalf("expected wait to resolve after human instruction reply, got %#v", detail.AgentWaits[0])
	}
}

func TestAgentClarificationRequestWaitsAndHumanReplyRequeuesTurn(t *testing.T) {
	s := NewMemoryStore()

	initial := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先看一下这个问题。")
	if initial.ResultCode != "room_message_posted" {
		t.Fatalf("expected initial message to succeed, got %#v", initial)
	}

	agentReply := s.PostRoomMessage("room_001", "agent", "agent_shell", "clarification_request", "我需要先确认是否允许改动 billing guard。")
	if agentReply.ResultCode != "room_message_posted" {
		t.Fatalf("expected clarification request to succeed, got %#v", agentReply)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentWaits) != 1 {
		t.Fatalf("expected one agent wait, got %#v", detail.AgentWaits)
	}
	if detail.AgentWaits[0].Status != "waiting_human" {
		t.Fatalf("expected waiting_human status, got %#v", detail.AgentWaits[0])
	}
	if detail.AgentSessions[0].Status != "waiting_human" {
		t.Fatalf("expected session to wait for human, got %#v", detail.AgentSessions[0])
	}

	followup := s.PostRoomMessage("room_001", "member", "Sarah", "message", "可以改 billing guard，继续。")
	if followup.ResultCode != "room_message_posted" {
		t.Fatalf("expected human followup to succeed, got %#v", followup)
	}

	detail, err = s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error after followup: %v", err)
	}
	if len(detail.AgentTurns) != 2 {
		t.Fatalf("expected followup to queue a second turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[1].IntentType != "clarification_followup" || detail.AgentTurns[1].Status != "queued" {
		t.Fatalf("unexpected followup turn payload: %#v", detail.AgentTurns[1])
	}
	if detail.AgentTurns[1].WakeupMode != "clarification_followup" {
		t.Fatalf("expected clarification_followup wakeup mode, got %#v", detail.AgentTurns[1])
	}
	if detail.AgentWaits[0].Status != "resolved" {
		t.Fatalf("expected wait to resolve after human reply, got %#v", detail.AgentWaits[0])
	}
	if detail.AgentSessions[0].Status != "queued" {
		t.Fatalf("expected session to requeue after human reply, got %#v", detail.AgentSessions[0])
	}
}

func TestAgentHandoffCreatesTargetAgentTurn(t *testing.T) {
	s := NewMemoryStore()

	initial := s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 先看看这个问题，然后按需要分派。")
	if initial.ResultCode != "room_message_posted" {
		t.Fatalf("expected initial message to succeed, got %#v", initial)
	}

	handoff := s.PostRoomMessage("room_001", "agent", "agent_shell", "handoff", "@agent_guardian 这里需要你接手做风险评审。")
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

func TestCompleteAgentTurnPreservesWaitingHumanSessionState(t *testing.T) {
	s := NewMemoryStore()

	s.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先看一下这个问题。")
	runtime := s.RegisterRuntime("Test Runtime", "codex", 1)
	execution, claimed, err := s.ClaimNextQueuedAgentTurn(runtime.ID)
	if err != nil {
		t.Fatalf("claim agent turn returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected queued agent turn to be claimed")
	}

	reply := s.PostRoomMessage("room_001", "agent", "agent_shell", "clarification_request", "请先确认是否可以动 billing guard。")
	messageID := ""
	for _, entity := range reply.AffectedEntities {
		if entity.Type == "message" {
			messageID = entity.ID
			break
		}
	}
	if messageID == "" {
		t.Fatalf("expected clarification response to create message entity, got %#v", reply.AffectedEntities)
	}

	if _, err := s.CompleteAgentTurn(execution.Turn.ID, runtime.ID, messageID); err != nil {
		t.Fatalf("complete agent turn returned error: %v", err)
	}

	detail, err := s.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].Status != "waiting_human" {
		t.Fatalf("expected waiting_human session after completion, got %#v", detail.AgentSessions)
	}
}

func TestClaimNextQueuedRun(t *testing.T) {
	s := NewMemoryStore()
	bindDefaultWorkspaceRepo(t, s)

	run, claimed, err := s.ClaimNextQueuedRun("rt_local")
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
	s := NewMemoryStore()

	if _, err := s.CreateRun("task_guard"); err == nil {
		t.Fatal("expected create run to fail without a workspace default repo binding")
	}
}

func TestIngestRunEventCompleted(t *testing.T) {
	s := NewMemoryStore()
	bindDefaultWorkspaceRepo(t, s)

	_, claimed, err := s.ClaimNextQueuedRun("rt_local")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if !claimed {
		t.Fatal("expected a queued run to be claimed")
	}

	run, err := s.IngestRunEvent("run_guard_01", "rt_local", "completed", "done", "", "", nil)
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
	s := NewMemoryStore()
	bindDefaultWorkspaceRepo(t, s)

	if _, claimed, err := s.ClaimNextQueuedRun("rt_local"); err != nil {
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
	s := NewMemoryStore()
	bindDefaultWorkspaceRepo(t, s)

	if _, claimed, err := s.ClaimNextQueuedRun("rt_local"); err != nil {
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

func TestSetTaskStatusUpdatesEditableTaskState(t *testing.T) {
	s := NewMemoryStore()

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

func TestBuildRunInstructionIncludesTaskStatusCommands(t *testing.T) {
	instruction := buildRunInstruction(core.Task{
		ID:              "task_guard",
		Title:           "Add retention guard around handoff queue",
		Description:     "Patch the observer queue to drop stale references on handoff.",
		AssigneeAgentID: "agent_shell",
		BranchName:      "issue-101/task-guard",
	})

	for _, expected := range []string{
		"Task ID: task_guard",
		"This is a single-run execution for the current task branch.",
		"The OpenShock CLI is available as `openshock` during execution.",
		"update the task to in_progress early",
		"openshock task status set --task task_guard --status in_progress --actor-id agent_shell",
		"Finish code changes and validation before stopping.",
		"openshock task status set --task task_guard --status blocked --actor-id agent_shell",
		"If you are blocked, explain the real blocker in your final summary.",
		"openshock task mark-ready --task task_guard --actor-id agent_shell",
		"Your final summary should include both the code changes and the verification you ran.",
	} {
		if !strings.Contains(instruction, expected) {
			t.Fatalf("expected instruction to contain %q, got:\n%s", expected, instruction)
		}
	}
}

func TestRegisterRuntime(t *testing.T) {
	s := NewMemoryStore()

	runtime := s.RegisterRuntime("Daemon Runner", "codex", 2)
	if runtime.ID == "" {
		t.Fatal("expected runtime id to be assigned")
	}
	if runtime.Name != "Daemon Runner" {
		t.Fatalf("expected runtime name to match, got %q", runtime.Name)
	}
}

func TestRequestMergeCreatesInboxItem(t *testing.T) {
	s := NewMemoryStore()

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
	s := NewMemoryStore()
	bindDefaultWorkspaceRepo(t, s)
	_, claimed, err := s.ClaimNextQueuedRun("rt_local")
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
	s := NewMemoryStore()
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
	s := NewMemoryStore()
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
	s := NewMemoryStore()

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
	s := NewMemoryStore()

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
	s := NewMemoryStore()

	_, err := s.CreateDeliveryPR("issue_101", "Sarah")
	if err == nil {
		t.Fatal("expected delivery pr creation to fail before integration branch is ready")
	}
}

func TestCreateDeliveryPRMovesIssueToReview(t *testing.T) {
	s := NewMemoryStore()
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
	s := NewMemoryStore()
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
	s := NewMemoryStore()

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
	s := NewMemoryStore()
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

func TestApproveMergeRequiresPendingApprovalRequest(t *testing.T) {
	s := NewMemoryStore()
	bindDefaultWorkspaceRepo(t, s)

	if _, err := s.ApproveMerge("task_review", "Sarah"); err == nil {
		t.Fatal("expected merge approval to fail without a pending approval request")
	}
}

func TestRequestMergeRejectsIntegratedTask(t *testing.T) {
	s := NewMemoryStore()
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
	s := NewMemoryStore()
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
	s := NewMemoryStore()
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
	s := NewMemoryStore()
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
	s := NewMemoryStore()
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
