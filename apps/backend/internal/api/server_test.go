package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"openshock/backend/internal/store"
	"openshock/backend/internal/testsupport/scenario"
)

func bindAPITestWorkspaceRepo(t *testing.T, s *store.MemoryStore) string {
	t.Helper()

	repoPath := "/tmp/openshock-demo-repo"
	if err := s.BindWorkspaceRepo("ws_01", repoPath, "openshock-demo-repo", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	return repoPath
}

func requestAPITestMerge(t *testing.T, api *API, taskID, idempotencyKey string) {
	t.Helper()

	body := []byte(`{"actorType":"agent","actorId":"agent_shell","actionType":"GitIntegration.merge.request","targetType":"task","targetId":"` + taskID + `","idempotencyKey":"` + idempotencyKey + `","payload":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected merge request to succeed, got %d with body %s", rec.Code, rec.Body.String())
	}
}

func memberSessionTokenForAPITest(t *testing.T, api *API, username, displayName string) string {
	t.Helper()

	resp, err := api.store.RegisterMember(username, displayName, "password123")
	if err != nil {
		t.Fatalf("register member returned error: %v", err)
	}
	return resp.SessionToken
}

func mustCreateAPITestAgent(t *testing.T, s *store.MemoryStore, agentID string) {
	t.Helper()

	name := agentID
	if agentID == "agent_shell" {
		name = "Shell_Runner"
	}
	if _, err := s.CreateAgentWithID(agentID, name, "test fixture prompt"); err != nil {
		t.Fatalf("create test agent returned error: %v", err)
	}
}

func TestBootstrapHandler(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "bootstrap_owner", "Bootstrap Owner")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload["defaultIssueId"] != "issue_101" {
		t.Fatalf("expected defaultIssueId issue_101, got %#v", payload["defaultIssueId"])
	}
	if payload["defaultRoomId"] != "room_001" {
		t.Fatalf("expected defaultRoomId room_001, got %#v", payload["defaultRoomId"])
	}
}

func TestWorkspaceLifecycleSwitchesBootstrapScope(t *testing.T) {
	api := New(store.NewMemoryStore())
	token := memberSessionTokenForAPITest(t, api, "workspace_owner", "Workspace Owner")

	createBody := []byte(`{"name":"Beta Ops"}`)
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set(sessionHeaderName, token)
	createRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusOK {
		t.Fatalf("expected workspace create 200, got %d with body %s", createRec.Code, createRec.Body.String())
	}

	var createPayload struct {
		Workspace struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"workspace"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createPayload); err != nil {
		t.Fatalf("invalid create workspace response: %v", err)
	}
	if createPayload.Workspace.ID == "" || createPayload.Workspace.Name != "Beta Ops" {
		t.Fatalf("unexpected created workspace payload: %#v", createPayload.Workspace)
	}

	switchReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/current", bytes.NewReader([]byte(`{"workspaceId":"`+createPayload.Workspace.ID+`"}`)))
	switchReq.Header.Set("Content-Type", "application/json")
	switchReq.Header.Set(sessionHeaderName, token)
	switchRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(switchRec, switchReq)

	if switchRec.Code != http.StatusOK {
		t.Fatalf("expected workspace switch 200, got %d with body %s", switchRec.Code, switchRec.Body.String())
	}

	bootstrapReq := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	bootstrapReq.Header.Set(sessionHeaderName, token)
	bootstrapRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(bootstrapRec, bootstrapReq)

	if bootstrapRec.Code != http.StatusOK {
		t.Fatalf("expected workspace-scoped bootstrap 200, got %d with body %s", bootstrapRec.Code, bootstrapRec.Body.String())
	}

	var bootstrapPayload struct {
		Workspace struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"workspace"`
		DefaultIssueID string `json:"defaultIssueId"`
		Rooms          []struct {
			ID          string `json:"id"`
			WorkspaceID string `json:"workspaceId"`
			Title       string `json:"title"`
		} `json:"rooms"`
	}
	if err := json.Unmarshal(bootstrapRec.Body.Bytes(), &bootstrapPayload); err != nil {
		t.Fatalf("invalid bootstrap response: %v", err)
	}
	if bootstrapPayload.Workspace.ID != createPayload.Workspace.ID {
		t.Fatalf("expected switched workspace bootstrap, got %#v", bootstrapPayload.Workspace)
	}
	if bootstrapPayload.DefaultIssueID != "" {
		t.Fatalf("expected empty workspace to have no default issue, got %q", bootstrapPayload.DefaultIssueID)
	}
	if len(bootstrapPayload.Rooms) != 2 {
		t.Fatalf("expected two default rooms after switch, got %#v", bootstrapPayload.Rooms)
	}
	for _, room := range bootstrapPayload.Rooms {
		if room.WorkspaceID != createPayload.Workspace.ID {
			t.Fatalf("expected room to be scoped to switched workspace, got %#v", room)
		}
	}
}

func TestWorkspaceListOnlyReturnsAccessibleWorkspaces(t *testing.T) {
	api := New(store.NewMemoryStore())
	alphaToken := memberSessionTokenForAPITest(t, api, "alpha_owner", "Alpha Owner")
	betaToken := memberSessionTokenForAPITest(t, api, "beta_owner", "Beta Owner")

	createReq := func(token, name string) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader([]byte(`{"name":"`+name+`"}`)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set(sessionHeaderName, token)
		rec := httptest.NewRecorder()
		api.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected workspace create 200, got %d with body %s", rec.Code, rec.Body.String())
		}
	}

	createReq(alphaToken, "Alpha Ops")
	createReq(betaToken, "Beta Ops")

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	listReq.Header.Set(sessionHeaderName, alphaToken)
	listRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected workspace list 200, got %d with body %s", listRec.Code, listRec.Body.String())
	}

	var payload struct {
		Workspaces []struct {
			Name string `json:"name"`
		} `json:"workspaces"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid workspace list response: %v", err)
	}
	if len(payload.Workspaces) != 2 {
		t.Fatalf("expected default workspace plus one owned workspace, got %#v", payload.Workspaces)
	}
	for _, workspace := range payload.Workspaces {
		if workspace.Name == "Beta Ops" {
			t.Fatalf("expected inaccessible workspace to be filtered out, got %#v", payload.Workspaces)
		}
	}
}

func TestWorkspaceSwitchRejectsUnauthorizedWorkspace(t *testing.T) {
	api := New(store.NewMemoryStore())
	alphaToken := memberSessionTokenForAPITest(t, api, "alpha_owner", "Alpha Owner")
	betaToken := memberSessionTokenForAPITest(t, api, "beta_owner", "Beta Owner")

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", bytes.NewReader([]byte(`{"name":"Beta Ops"}`)))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set(sessionHeaderName, betaToken)
	createRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected workspace create 200, got %d with body %s", createRec.Code, createRec.Body.String())
	}

	var payload struct {
		Workspace struct {
			ID string `json:"id"`
		} `json:"workspace"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid workspace create response: %v", err)
	}

	switchReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/current", bytes.NewReader([]byte(`{"workspaceId":"`+payload.Workspace.ID+`"}`)))
	switchReq.Header.Set("Content-Type", "application/json")
	switchReq.Header.Set(sessionHeaderName, alphaToken)
	switchRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(switchRec, switchReq)

	if switchRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized workspace switch, got %d with body %s", switchRec.Code, switchRec.Body.String())
	}
}

func TestBootstrapAndRoomDetailTrackReadStateForSession(t *testing.T) {
	api := New(store.NewMemoryStore())
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	bootstrapReq := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	bootstrapReq.Header.Set(sessionHeaderName, token)
	bootstrapRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(bootstrapRec, bootstrapReq)

	if bootstrapRec.Code != http.StatusOK {
		t.Fatalf("expected bootstrap 200, got %d with body %s", bootstrapRec.Code, bootstrapRec.Body.String())
	}

	var bootstrapPayload struct {
		Rooms []struct {
			ID          string `json:"id"`
			UnreadCount int    `json:"unreadCount"`
		} `json:"rooms"`
	}
	if err := json.Unmarshal(bootstrapRec.Body.Bytes(), &bootstrapPayload); err != nil {
		t.Fatalf("invalid bootstrap json response: %v", err)
	}
	initialUnread := map[string]int{}
	for _, room := range bootstrapPayload.Rooms {
		initialUnread[room.ID] = room.UnreadCount
	}
	if initialUnread["room_001"] != 1 {
		t.Fatalf("expected room_001 to start unread, got %#v", bootstrapPayload.Rooms)
	}

	roomReq := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/room_001", nil)
	roomReq.Header.Set(sessionHeaderName, token)
	roomRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(roomRec, roomReq)

	if roomRec.Code != http.StatusOK {
		t.Fatalf("expected room detail 200, got %d with body %s", roomRec.Code, roomRec.Body.String())
	}

	var roomPayload struct {
		Room struct {
			ID          string `json:"id"`
			UnreadCount int    `json:"unreadCount"`
		} `json:"room"`
	}
	if err := json.Unmarshal(roomRec.Body.Bytes(), &roomPayload); err != nil {
		t.Fatalf("invalid room detail json response: %v", err)
	}
	if roomPayload.Room.UnreadCount != 1 {
		t.Fatalf("expected room detail to preserve unread count until explicit mark read, got %#v", roomPayload.Room)
	}

	bootstrapAfterReq := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	bootstrapAfterReq.Header.Set(sessionHeaderName, token)
	bootstrapAfterRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(bootstrapAfterRec, bootstrapAfterReq)

	if bootstrapAfterRec.Code != http.StatusOK {
		t.Fatalf("expected second bootstrap 200, got %d with body %s", bootstrapAfterRec.Code, bootstrapAfterRec.Body.String())
	}

	if err := json.Unmarshal(bootstrapAfterRec.Body.Bytes(), &bootstrapPayload); err != nil {
		t.Fatalf("invalid second bootstrap json response: %v", err)
	}
	finalUnread := map[string]int{}
	for _, room := range bootstrapPayload.Rooms {
		finalUnread[room.ID] = room.UnreadCount
	}
	if finalUnread["room_001"] != 1 {
		t.Fatalf("expected room_001 unread count to remain after opening it, got %#v", bootstrapPayload.Rooms)
	}
}

func TestMarkRoomReadEndpointClearsUnreadForSession(t *testing.T) {
	api := New(store.NewMemoryStore())
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	bootstrapReq := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	bootstrapReq.Header.Set(sessionHeaderName, token)
	bootstrapRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(bootstrapRec, bootstrapReq)

	if bootstrapRec.Code != http.StatusOK {
		t.Fatalf("expected bootstrap 200, got %d with body %s", bootstrapRec.Code, bootstrapRec.Body.String())
	}

	var bootstrapPayload struct {
		Rooms []struct {
			ID          string `json:"id"`
			UnreadCount int    `json:"unreadCount"`
		} `json:"rooms"`
	}
	if err := json.Unmarshal(bootstrapRec.Body.Bytes(), &bootstrapPayload); err != nil {
		t.Fatalf("invalid bootstrap json response: %v", err)
	}
	initialUnread := map[string]int{}
	for _, room := range bootstrapPayload.Rooms {
		initialUnread[room.ID] = room.UnreadCount
	}
	if initialUnread["room_001"] != 1 {
		t.Fatalf("expected room_001 to start unread, got %#v", bootstrapPayload.Rooms)
	}

	roomReq := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/room_001", nil)
	roomReq.Header.Set(sessionHeaderName, token)
	roomRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(roomRec, roomReq)

	if roomRec.Code != http.StatusOK {
		t.Fatalf("expected room detail 200, got %d with body %s", roomRec.Code, roomRec.Body.String())
	}

	var roomPayload struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(roomRec.Body.Bytes(), &roomPayload); err != nil {
		t.Fatalf("invalid room detail json response: %v", err)
	}

	readReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/rooms/room_001/read",
		bytes.NewReader([]byte(`{"messageId":"`+roomPayload.Messages[len(roomPayload.Messages)-1].ID+`"}`)),
	)
	readReq.Header.Set("Content-Type", "application/json")
	readReq.Header.Set(sessionHeaderName, token)
	readRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(readRec, readReq)

	if readRec.Code != http.StatusOK {
		t.Fatalf("expected mark read 200, got %d with body %s", readRec.Code, readRec.Body.String())
	}

	var readPayload struct {
		Room struct {
			ID          string `json:"id"`
			UnreadCount int    `json:"unreadCount"`
		} `json:"room"`
	}
	if err := json.Unmarshal(readRec.Body.Bytes(), &readPayload); err != nil {
		t.Fatalf("invalid mark read json response: %v", err)
	}
	if readPayload.Room.ID != "room_001" || readPayload.Room.UnreadCount != 0 {
		t.Fatalf("expected room_001 to be read immediately, got %#v", readPayload.Room)
	}

	bootstrapAfterReq := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	bootstrapAfterReq.Header.Set(sessionHeaderName, token)
	bootstrapAfterRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(bootstrapAfterRec, bootstrapAfterReq)

	if bootstrapAfterRec.Code != http.StatusOK {
		t.Fatalf("expected second bootstrap 200, got %d with body %s", bootstrapAfterRec.Code, bootstrapAfterRec.Body.String())
	}

	if err := json.Unmarshal(bootstrapAfterRec.Body.Bytes(), &bootstrapPayload); err != nil {
		t.Fatalf("invalid second bootstrap json response: %v", err)
	}
	finalUnread := map[string]int{}
	for _, room := range bootstrapPayload.Rooms {
		finalUnread[room.ID] = room.UnreadCount
	}
	if finalUnread["room_001"] != 0 {
		t.Fatalf("expected room_001 unread count to clear after mark read, got %#v", bootstrapPayload.Rooms)
	}
}

func TestMarkRoomReadEndpointDoesNotClearMessagesBeyondClientCursor(t *testing.T) {
	api := New(store.NewMemoryStore())
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	roomReq := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/room_001", nil)
	roomReq.Header.Set(sessionHeaderName, token)
	roomRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(roomRec, roomReq)

	if roomRec.Code != http.StatusOK {
		t.Fatalf("expected room detail 200, got %d with body %s", roomRec.Code, roomRec.Body.String())
	}

	var roomPayload struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(roomRec.Body.Bytes(), &roomPayload); err != nil {
		t.Fatalf("invalid room detail json response: %v", err)
	}
	lastVisibleMessageID := roomPayload.Messages[len(roomPayload.Messages)-1].ID

	messageBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"mark-read-race-1","payload":{"body":"一条更晚的新消息"}}`)
	messageReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(messageBody))
	messageReq.Header.Set("Content-Type", "application/json")
	messageReq.Header.Set(sessionHeaderName, token)
	messageRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(messageRec, messageReq)
	if messageRec.Code != http.StatusOK {
		t.Fatalf("expected post message 200, got %d with body %s", messageRec.Code, messageRec.Body.String())
	}

	readReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/rooms/room_001/read",
		bytes.NewReader([]byte(`{"messageId":"`+lastVisibleMessageID+`"}`)),
	)
	readReq.Header.Set("Content-Type", "application/json")
	readReq.Header.Set(sessionHeaderName, token)
	readRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(readRec, readReq)

	if readRec.Code != http.StatusOK {
		t.Fatalf("expected mark read 200, got %d with body %s", readRec.Code, readRec.Body.String())
	}

	bootstrapReq := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap", nil)
	bootstrapReq.Header.Set(sessionHeaderName, token)
	bootstrapRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(bootstrapRec, bootstrapReq)

	if bootstrapRec.Code != http.StatusOK {
		t.Fatalf("expected bootstrap 200, got %d with body %s", bootstrapRec.Code, bootstrapRec.Body.String())
	}

	var bootstrapPayload struct {
		Rooms []struct {
			ID          string `json:"id"`
			UnreadCount int    `json:"unreadCount"`
		} `json:"rooms"`
	}
	if err := json.Unmarshal(bootstrapRec.Body.Bytes(), &bootstrapPayload); err != nil {
		t.Fatalf("invalid bootstrap json response: %v", err)
	}
	finalUnread := map[string]int{}
	for _, room := range bootstrapPayload.Rooms {
		finalUnread[room.ID] = room.UnreadCount
	}
	if finalUnread["room_001"] != 1 {
		t.Fatalf("expected newer message to remain unread, got %#v", bootstrapPayload.Rooms)
	}
}

func TestActionEndpointCreatesMessage(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	body := []byte(`{"actorType":"agent","actorId":"agent_lead","actionType":"RoomMessage.post","targetType":"issue","targetId":"issue_101","idempotencyKey":"message-1","payload":{"body":"Need owner input on the guard branch."}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload["status"] != "completed" {
		t.Fatalf("expected completed status, got %#v", payload["status"])
	}
}

func TestActionEndpointCreatesDiscussionRoom(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"Room.create","targetType":"workspace","targetId":"ws_01","idempotencyKey":"room-create-1","payload":{"kind":"discussion","title":"Architecture","summary":"Cross-cutting design discussion."}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		ResultCode       string `json:"resultCode"`
		AffectedEntities []struct {
			Type string `json:"type"`
			ID   string `json:"id"`
		} `json:"affectedEntities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.ResultCode != "room_created" {
		t.Fatalf("expected room_created result code, got %#v", payload.ResultCode)
	}
	if len(payload.AffectedEntities) != 1 || payload.AffectedEntities[0].Type != "room" {
		t.Fatalf("expected created room entity, got %#v", payload.AffectedEntities)
	}

	detail, err := api.store.RoomDetail(payload.AffectedEntities[0].ID)
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if detail.Room.Kind != "discussion" || detail.Issue != nil {
		t.Fatalf("expected discussion room detail, got room=%#v issue=%#v", detail.Room, detail.Issue)
	}
}

func TestActionEndpointCreatesAgentTurnFromMention(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-1","payload":{"body":"@agent_shell please prepare a plan"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	secondBody := []byte(`{"actorType":"agent","actorId":"agent_guardian","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-6","payload":{"body":"我补充一个验收角度。"}}`)
	secondReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(secondBody))
	secondReq.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, secondReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected second agent reply 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
}

func TestActionEndpointAddsAgentToRoom(t *testing.T) {
	api := New(store.NewMemoryStore())
	mustCreateAPITestAgent(t, api.store, "agent_shell")
	token := memberSessionTokenForAPITest(t, api, "sarah_room_join", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomAgent.add","targetType":"room","targetId":"room_001","idempotencyKey":"room-agent-add-api-1","payload":{"agentId":"agent_shell"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].AgentID != "agent_shell" {
		t.Fatalf("expected joined room agent session, got %#v", detail.AgentSessions)
	}
}

func TestActionEndpointRemovesAgentFromRoom(t *testing.T) {
	api := New(store.NewMemoryStore())
	mustCreateAPITestAgent(t, api.store, "agent_shell")
	if _, err := api.store.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add agent to room returned error: %v", err)
	}
	token := memberSessionTokenForAPITest(t, api, "sarah_room_remove", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomAgent.remove","targetType":"room","targetId":"room_001","idempotencyKey":"room-agent-remove-api-1","payload":{"agentId":"agent_shell"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentSessions) != 1 || detail.AgentSessions[0].JoinedRoom {
		t.Fatalf("expected room session to remain but leave joined state, got %#v", detail.AgentSessions)
	}
}

func TestActionEndpointRejectsIssueRepoBinding(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"Issue.bind_repo","targetType":"issue","targetId":"issue_101","idempotencyKey":"issue-bind-repo-removed-api","payload":{"repoPath":"/tmp/openshock-demo-repo"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d with body %s", rec.Code, rec.Body.String())
	}
}

func TestActionEndpointCreatesAgentTurnFromInstructionKind(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-2","payload":{"kind":"instruction","body":"@agent_shell please prepare a plan"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	lastMessage := detail.Messages[len(detail.Messages)-1]
	if lastMessage.Kind != "instruction" {
		t.Fatalf("expected message kind to remain instruction, got %#v", lastMessage)
	}
}

func TestActionEndpointCreatesAgentTurnFromPlainHumanMessageWithoutMention(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-1","payload":{"body":"有人吗？我想确认一下这里下一步怎么推进。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected visible message turn for agent_guardian, got %#v", detail.AgentTurns[0])
	}
}

func TestActionEndpointCreatesVisibleMessageTurnForNeutralPlainMessage(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-2","payload":{"body":"我刚把文档同步好了。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one agent turn for neutral plain message, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected visible message turn for neutral plain message, got %#v", detail.AgentTurns[0])
	}
}

func TestActionEndpointCreatesVisibleMessageTurnFromInstructionWithoutMention(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-2","payload":{"kind":"instruction","body":"有人在看这个房间吗？"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
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

func TestActionEndpointAgentPlainMessageDoesNotCreateVisibleMessageTurn(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	body := []byte(`{"actorType":"agent","actorId":"agent_shell","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-3","payload":{"body":"我先同步一下当前进度。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 0 {
		t.Fatalf("expected no queued agent turn for agent-authored plain message, got %#v", detail.AgentTurns)
	}
}

func TestActionEndpointAgentPlainMessageWakesOtherJoinedAgents(t *testing.T) {
	api := New(store.NewMemoryStore())
	mustCreateAPITestAgent(t, api.store, "agent_shell")
	mustCreateAPITestAgent(t, api.store, "agent_guardian")
	if _, err := api.store.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add first agent to room returned error: %v", err)
	}
	if _, err := api.store.AddAgentToRoom("room_001", "agent_guardian", "Sarah"); err != nil {
		t.Fatalf("add second agent to room returned error: %v", err)
	}

	body := []byte(`{"actorType":"agent","actorId":"agent_shell","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-default-5","payload":{"body":"我先同步一下当前进度。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 {
		t.Fatalf("expected one queued agent turn for the other joined agent, got %#v", detail.AgentTurns)
	}
	if detail.AgentTurns[0].AgentID != "agent_guardian" || detail.AgentTurns[0].IntentType != "visible_message_response" {
		t.Fatalf("expected agent-authored room message to wake the other joined agent, got %#v", detail.AgentTurns[0])
	}
}

func TestActionEndpointHumanMentionStillFansOutToAllJoinedAgents(t *testing.T) {
	api := New(store.NewMemoryStore())
	mustCreateAPITestAgent(t, api.store, "agent_shell")
	mustCreateAPITestAgent(t, api.store, "agent_guardian")
	if _, err := api.store.AddAgentToRoom("room_001", "agent_shell", "Sarah"); err != nil {
		t.Fatalf("add first agent to room returned error: %v", err)
	}
	if _, err := api.store.AddAgentToRoom("room_001", "agent_guardian", "Sarah"); err != nil {
		t.Fatalf("add second agent to room returned error: %v", err)
	}
	token := memberSessionTokenForAPITest(t, api, "sarah_mention_fanout", "Sarah")

	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"message-turn-mention-fanout-1","payload":{"body":"@agent_shell 先看看这个问题，大家有补充也一起跟进。"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 2 {
		t.Fatalf("expected mention to fan out to all joined agents, got %#v", detail.AgentTurns)
	}
	agentIDs := []string{detail.AgentTurns[0].AgentID, detail.AgentTurns[1].AgentID}
	if !(containsString(agentIDs, "agent_shell") && containsString(agentIDs, "agent_guardian")) {
		t.Fatalf("expected both joined agents to receive turns, got %#v", detail.AgentTurns)
	}
}

func TestIssueDetailReturns404(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "issue_reader", "Issue Reader")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/issue_missing", nil)
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestRoomDetailReturnsDiscussionRoom(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "room_reader", "Room Reader")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/room_002", nil)
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Room struct {
			ID    string `json:"id"`
			Kind  string `json:"kind"`
			Title string `json:"title"`
		} `json:"room"`
		Tasks []any `json:"tasks"`
		Issue any   `json:"issue"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Room.Kind != "discussion" || payload.Room.Title != "Roadmap" {
		t.Fatalf("unexpected room payload: %#v", payload.Room)
	}
	if payload.Issue != nil {
		t.Fatalf("expected no issue payload for discussion room, got %#v", payload.Issue)
	}
	if len(payload.Tasks) != 0 {
		t.Fatalf("expected no tasks for discussion room, got %#v", payload.Tasks)
	}
}

func TestRegisterRuntimeEndpoint(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	body := []byte(`{"name":"Daemon Runner","provider":"codex","slotCount":2}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runtimes/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Runtime struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Status      string `json:"status"`
			Provider    string `json:"provider"`
			SlotCount   int    `json:"slotCount"`
			ActiveSlots int    `json:"activeSlots"`
		} `json:"runtime"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Runtime.Name != "Daemon Runner" {
		t.Fatalf("expected registered runtime name, got %#v", payload.Runtime.Name)
	}
	if payload.Runtime.SlotCount != 2 || payload.Runtime.ActiveSlots != 0 {
		t.Fatalf("expected slot metadata in runtime response, got %#v", payload.Runtime)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestClaimRunEndpoint(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	body := []byte(`{"runtimeId":"rt_local"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Claimed bool `json:"claimed"`
		Run     *struct {
			ID         string `json:"id"`
			Status     string `json:"status"`
			RuntimeID  string `json:"runtimeId"`
			BranchName string `json:"branchName"`
			BaseBranch string `json:"baseBranch"`
		} `json:"run"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if !payload.Claimed || payload.Run == nil {
		t.Fatalf("expected a claimed run, got %#v", payload)
	}
	if payload.Run.Status != "running" {
		t.Fatalf("expected running status after claim, got %q", payload.Run.Status)
	}
	if payload.Run.RuntimeID != "rt_local" {
		t.Fatalf("expected runtime id to be assigned, got %q", payload.Run.RuntimeID)
	}
	if payload.Run.BranchName == "" || payload.Run.BaseBranch == "" {
		t.Fatalf("expected run claim to include branch metadata, got %#v", payload.Run)
	}
}

func TestRunEventEndpointUpdatesRun(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/runs/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	var claimPayload struct {
		Run *struct {
			ID string `json:"id"`
		} `json:"run"`
	}
	if err := json.Unmarshal(claimRec.Body.Bytes(), &claimPayload); err != nil {
		t.Fatalf("invalid claim response: %v", err)
	}
	if claimPayload.Run == nil || claimPayload.Run.ID == "" {
		t.Fatalf("expected claimed run id, got %s", claimRec.Body.String())
	}

	body := []byte(`{"runtimeId":"rt_local","eventType":"completed","outputPreview":"Guard patch applied cleanly."}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/"+claimPayload.Run.ID+"/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		RunID  string `json:"runId"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Status != "completed" {
		t.Fatalf("expected completed status, got %q", payload.Status)
	}
}

func TestRunToolCallEventEndpointUpdatesRun(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/runs/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	body := []byte(`{"runtimeId":"rt_local","eventType":"tool_call","toolCall":{"toolName":"openshock","arguments":"{\"command\":\"task create\"}","status":"completed"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/run_review_01/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}
	found := false
	for _, toolCall := range detail.ToolCalls {
		if toolCall.RunID == "run_review_01" && toolCall.ToolName == "openshock" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected tool call to be recorded, got %#v", detail.ToolCalls)
	}
}

func TestAgentTurnEventEndpointUpdatesTurnObservability(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	api := New(backingStore)
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	messageBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"room","targetId":"room_001","idempotencyKey":"agent-turn-event-1","payload":{"body":"@agent_shell 请先准备一个计划"}}`)
	messageReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(messageBody))
	messageReq.Header.Set("Content-Type", "application/json")
	messageReq.Header.Set(sessionHeaderName, token)
	messageRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(messageRec, messageReq)

	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/agent-turns/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	body := []byte(`{"runtimeId":"rt_local","eventType":"tool_call","toolCall":{"toolName":"shell","arguments":"{\"command\":\"git status\"}","status":"completed"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent-turns/turn_101/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	detail, err := api.store.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	found := false
	for _, toolCall := range detail.AgentTurnToolCalls {
		if toolCall.TurnID == "turn_101" && toolCall.ToolName == "shell" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected agent turn tool call to be recorded, got %#v", detail.AgentTurnToolCalls)
	}
}

func TestClaimMergeEndpoint(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	requestAPITestMerge(t, api, "task_guard", "merge-request-claim")
	mergeBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_guard","idempotencyKey":"merge-approve-claim","payload":{}}`)
	mergeReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(mergeBody))
	mergeReq.Header.Set("Content-Type", "application/json")
	mergeReq.Header.Set(sessionHeaderName, token)
	mergeRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(mergeRec, mergeReq)

	body := []byte(`{"runtimeId":"rt_local"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/merges/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Claimed      bool `json:"claimed"`
		MergeAttempt *struct {
			ID           string `json:"id"`
			Status       string `json:"status"`
			SourceBranch string `json:"sourceBranch"`
			TargetBranch string `json:"targetBranch"`
		} `json:"mergeAttempt"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if !payload.Claimed || payload.MergeAttempt == nil {
		t.Fatalf("expected a claimed merge attempt, got %#v", payload)
	}
	if payload.MergeAttempt.SourceBranch == "" || payload.MergeAttempt.TargetBranch == "" {
		t.Fatalf("expected merge claim to include branch metadata, got %#v", payload.MergeAttempt)
	}
}

func TestClaimAgentTurnEndpoint(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	messageBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"issue","targetId":"issue_101","idempotencyKey":"turn-claim-1","payload":{"body":"@agent_shell please prepare a plan"}}`)
	messageReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(messageBody))
	messageReq.Header.Set("Content-Type", "application/json")
	messageReq.Header.Set(sessionHeaderName, token)
	messageRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(messageRec, messageReq)

	body := []byte(`{"runtimeId":"rt_local"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent-turns/claim", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Claimed   bool `json:"claimed"`
		AgentTurn *struct {
			AgentName   string `json:"agentName"`
			AgentPrompt string `json:"agentPrompt"`
			Instruction string `json:"instruction"`
			Session     struct {
				ID               string `json:"id"`
				ProviderThreadID string `json:"providerThreadId"`
			} `json:"session"`
			Turn struct {
				ID         string `json:"id"`
				AgentID    string `json:"agentId"`
				WakeupMode string `json:"wakeupMode"`
				Status     string `json:"status"`
				EventFrame struct {
					CurrentTarget   string `json:"currentTarget"`
					SourceMessageID string `json:"sourceMessageId"`
					RequestedBy     string `json:"requestedBy"`
				} `json:"eventFrame"`
			} `json:"turn"`
		} `json:"agentTurn"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if !payload.Claimed || payload.AgentTurn == nil || payload.AgentTurn.Turn.AgentID != "agent_shell" {
		t.Fatalf("unexpected agent turn claim payload: %#v", payload)
	}
	if payload.AgentTurn.AgentName != "Shell_Runner" {
		t.Fatalf("expected claimed turn to expose display name, got %#v", payload.AgentTurn)
	}
	if payload.AgentTurn.AgentPrompt == "" {
		t.Fatalf("expected claimed turn to expose agent prompt, got %#v", payload.AgentTurn)
	}
	if !strings.Contains(payload.AgentTurn.Instruction, "你在房间界面里的名字是 `Shell_Runner`。") {
		t.Fatalf("expected claimed turn to expose server-built instruction, got %#v", payload.AgentTurn)
	}
	if !strings.Contains(payload.AgentTurn.Instruction, payload.AgentTurn.AgentPrompt) {
		t.Fatalf("expected claimed turn to expose server-built instruction, got %#v", payload.AgentTurn)
	}
	if !strings.Contains(payload.AgentTurn.Instruction, "openshock task create --issue issue_101") {
		t.Fatalf("expected claimed turn instruction to expose task workflow commands, got %#v", payload.AgentTurn)
	}
	if payload.AgentTurn.Session.ProviderThreadID == "" {
		t.Fatalf("expected claimed agent turn to expose provider thread id, got %#v", payload.AgentTurn.Session)
	}
	if payload.AgentTurn.Turn.EventFrame.CurrentTarget == "" || payload.AgentTurn.Turn.EventFrame.SourceMessageID == "" {
		t.Fatalf("expected claimed agent turn to expose event frame, got %#v", payload.AgentTurn.Turn.EventFrame)
	}
	if payload.AgentTurn.Turn.EventFrame.RequestedBy != "Sarah" {
		t.Fatalf("expected event frame requester Sarah, got %#v", payload.AgentTurn.Turn.EventFrame)
	}
	if payload.AgentTurn.Turn.WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", payload.AgentTurn.Turn)
	}
}

func TestIssueDetailEndpointIncludesAgentObservability(t *testing.T) {
	api := New(store.NewMemoryStoreFromSnapshot(scenario.Snapshot()))
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	body := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"RoomMessage.post","targetType":"issue","targetId":"issue_101","idempotencyKey":"issue-observability-1","payload":{"body":"@agent_shell please review the issue and reply"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(sessionHeaderName, token)
	rec := httptest.NewRecorder()
	api.Handler().ServeHTTP(rec, req)

	detailReq := httptest.NewRequest(http.MethodGet, "/api/v1/issues/issue_101", nil)
	detailReq.Header.Set(sessionHeaderName, token)
	detailRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(detailRec, detailReq)

	if detailRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", detailRec.Code, detailRec.Body.String())
	}

	var payload struct {
		AgentSessions []struct {
			ProviderThreadID string `json:"providerThreadId"`
		} `json:"agentSessions"`
		AgentTurns []struct {
			WakeupMode string `json:"wakeupMode"`
			EventFrame struct {
				RelatedIssueID string `json:"relatedIssueId"`
				ExpectedAction string `json:"expectedAction"`
			} `json:"eventFrame"`
		} `json:"agentTurns"`
	}
	if err := json.Unmarshal(detailRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if len(payload.AgentSessions) != 1 || payload.AgentSessions[0].ProviderThreadID == "" {
		t.Fatalf("expected issue detail agent session observability, got %#v", payload.AgentSessions)
	}
	if len(payload.AgentTurns) != 1 || payload.AgentTurns[0].EventFrame.RelatedIssueID != "issue_101" {
		t.Fatalf("expected issue detail event frame observability, got %#v", payload.AgentTurns)
	}
	if payload.AgentTurns[0].EventFrame.ExpectedAction != "visible_message_response" {
		t.Fatalf("expected event frame expected action to match turn intent, got %#v", payload.AgentTurns[0].EventFrame)
	}
	if payload.AgentTurns[0].WakeupMode != "direct_message" {
		t.Fatalf("expected direct_message wakeup mode, got %#v", payload.AgentTurns[0])
	}
}

func TestMergeEventEndpointUpdatesAttempt(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")
	requestAPITestMerge(t, api, "task_guard", "merge-request-event")
	mergeBody := []byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_guard","idempotencyKey":"merge-approve-event","payload":{}}`)
	mergeReq := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(mergeBody))
	mergeReq.Header.Set("Content-Type", "application/json")
	mergeReq.Header.Set(sessionHeaderName, token)
	mergeRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(mergeRec, mergeReq)

	claimBody := []byte(`{"runtimeId":"rt_local"}`)
	claimReq := httptest.NewRequest(http.MethodPost, "/api/v1/merges/claim", bytes.NewReader(claimBody))
	claimReq.Header.Set("Content-Type", "application/json")
	claimRec := httptest.NewRecorder()
	api.Handler().ServeHTTP(claimRec, claimReq)

	body := []byte(`{"runtimeId":"rt_local","eventType":"succeeded","resultSummary":"merged cleanly"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/merges/merge_101/events", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		MergeAttemptID string `json:"mergeAttemptId"`
		Status         string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Status != "succeeded" {
		t.Fatalf("expected succeeded status, got %q", payload.Status)
	}
}

func TestRepoWebhookEndpointUpdatesDeliveryPR(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	bindAPITestWorkspaceRepo(t, backingStore)
	api := New(backingStore)
	token := memberSessionTokenForAPITest(t, api, "sarah", "Sarah")

	requestAPITestMerge(t, api, "task_guard", "repo-webhook-request-1")
	requestAPITestMerge(t, api, "task_review", "repo-webhook-request-2")
	for _, body := range [][]byte{
		[]byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_guard","idempotencyKey":"repo-webhook-merge-1","payload":{}}`),
		[]byte(`{"actorType":"member","actorId":"Sarah","actionType":"GitIntegration.merge.approve","targetType":"task","targetId":"task_review","idempotencyKey":"repo-webhook-merge-2","payload":{}}`),
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/actions", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set(sessionHeaderName, token)
		rec := httptest.NewRecorder()
		api.Handler().ServeHTTP(rec, req)
	}

	storeRef := api.store
	attemptA, claimed, err := storeRef.ClaimNextQueuedMerge("rt_local")
	if err != nil || !claimed {
		t.Fatalf("failed to claim first merge attempt: %v %#v", err, attemptA)
	}
	if _, err := storeRef.IngestMergeEvent(attemptA.ID, "rt_local", "succeeded", "merged task guard"); err != nil {
		t.Fatalf("failed to ingest first merge event: %v", err)
	}
	attemptB, claimed, err := storeRef.ClaimNextQueuedMerge("rt_local")
	if err != nil || !claimed {
		t.Fatalf("failed to claim second merge attempt: %v %#v", err, attemptB)
	}
	if _, err := storeRef.IngestMergeEvent(attemptB.ID, "rt_local", "succeeded", "merged task review"); err != nil {
		t.Fatalf("failed to ingest second merge event: %v", err)
	}
	if _, err := storeRef.CreateDeliveryPR("issue_101", "Sarah"); err != nil {
		t.Fatalf("failed to create delivery pr: %v", err)
	}

	body := []byte(`{"eventId":"evt_repo_101","provider":"github","externalPrId":"gh_pr_102","status":"merged"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/repo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	api.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		DeliveryPRID string `json:"deliveryPrId"`
		Status       string `json:"status"`
		Replayed     bool   `json:"replayed"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if payload.Status != "merged" || payload.Replayed {
		t.Fatalf("unexpected repo webhook response: %#v", payload)
	}
}
