package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type workspaceSnapshot struct {
	Name          string `json:"name"`
	Repo          string `json:"repo"`
	RepoURL       string `json:"repoUrl"`
	Branch        string `json:"branch"`
	Plan          string `json:"plan"`
	PairedRuntime string `json:"pairedRuntime"`
	BrowserPush   string `json:"browserPush"`
	MemoryMode    string `json:"memoryMode"`
}

type channel struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Unread  int    `json:"unread"`
	Purpose string `json:"purpose"`
}

type message struct {
	ID      string `json:"id"`
	Speaker string `json:"speaker"`
	Role    string `json:"role"`
	Tone    string `json:"tone"`
	Message string `json:"message"`
	Time    string `json:"time"`
}

type topic struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Status  string `json:"status"`
	Owner   string `json:"owner"`
	Summary string `json:"summary"`
}

type issue struct {
	ID          string   `json:"id"`
	Key         string   `json:"key"`
	Title       string   `json:"title"`
	Summary     string   `json:"summary"`
	State       string   `json:"state"`
	Priority    string   `json:"priority"`
	Owner       string   `json:"owner"`
	RoomID      string   `json:"roomId"`
	RunID       string   `json:"runId"`
	PullRequest string   `json:"pullRequest"`
	Checklist   []string `json:"checklist"`
}

type room struct {
	ID         string   `json:"id"`
	IssueKey   string   `json:"issueKey"`
	Title      string   `json:"title"`
	Unread     int      `json:"unread"`
	Summary    string   `json:"summary"`
	BoardCount int      `json:"boardCount"`
	RunID      string   `json:"runId"`
	MessageIDs []string `json:"messageIds"`
	Topic      topic    `json:"topic"`
}

type runEvent struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	At    string `json:"at"`
	Tone  string `json:"tone"`
}

type toolCall struct {
	ID      string `json:"id"`
	Tool    string `json:"tool"`
	Summary string `json:"summary"`
	Result  string `json:"result"`
}

type run struct {
	ID               string     `json:"id"`
	IssueKey         string     `json:"issueKey"`
	RoomID           string     `json:"roomId"`
	TopicID          string     `json:"topicId"`
	Status           string     `json:"status"`
	Runtime          string     `json:"runtime"`
	Machine          string     `json:"machine"`
	Provider         string     `json:"provider"`
	Branch           string     `json:"branch"`
	Worktree         string     `json:"worktree"`
	Owner            string     `json:"owner"`
	StartedAt        string     `json:"startedAt"`
	Duration         string     `json:"duration"`
	Summary          string     `json:"summary"`
	ApprovalRequired bool       `json:"approvalRequired"`
	Stdout           []string   `json:"stdout"`
	Stderr           []string   `json:"stderr"`
	ToolCalls        []toolCall `json:"toolCalls"`
	Timeline         []runEvent `json:"timeline"`
	NextAction       string     `json:"nextAction"`
	PullRequest      string     `json:"pullRequest"`
}

type agent struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	Mood              string   `json:"mood"`
	State             string   `json:"state"`
	Lane              string   `json:"lane"`
	Provider          string   `json:"provider"`
	RuntimePreference string   `json:"runtimePreference"`
	MemorySpaces      []string `json:"memorySpaces"`
	RecentRunIDs      []string `json:"recentRunIds"`
}

type machine struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	State         string `json:"state"`
	CLI           string `json:"cli"`
	OS            string `json:"os"`
	LastHeartbeat string `json:"lastHeartbeat"`
}

type inboxItem struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Room    string `json:"room"`
	Time    string `json:"time"`
	Summary string `json:"summary"`
	Action  string `json:"action"`
	Href    string `json:"href"`
}

type execRequest struct {
	Provider string `json:"provider"`
	Prompt   string `json:"prompt"`
	Cwd      string `json:"cwd"`
}

type createIssueRequest struct {
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Owner    string `json:"owner"`
	Priority string `json:"priority"`
}

type roomMessageRequest struct {
	Provider string `json:"provider"`
	Prompt   string `json:"prompt"`
	Cwd      string `json:"cwd"`
}

type daemonExecResponse struct {
	Output string `json:"output"`
	Error  string `json:"error"`
}

type apiState struct {
	Workspace       workspaceSnapshot    `json:"workspace"`
	Channels        []channel            `json:"channels"`
	ChannelMessages map[string][]message `json:"channelMessages"`
	Issues          []issue              `json:"issues"`
	Rooms           []room               `json:"rooms"`
	RoomMessages    map[string][]message `json:"roomMessages"`
	Runs            []run                `json:"runs"`
	Agents          []agent              `json:"agents"`
	Machines        []machine            `json:"machines"`
	Inbox           []inboxItem          `json:"inbox"`
}

type roomDetailResponse struct {
	Room     room      `json:"room"`
	Messages []message `json:"messages"`
}

type stateStore struct {
	mu    sync.RWMutex
	path  string
	state apiState
}

func main() {
	addr := envOr("OPENSHOCK_SERVER_ADDR", ":8080")
	daemonURL := strings.TrimRight(envOr("OPENSHOCK_DAEMON_URL", "http://127.0.0.1:8090"), "/")
	workspaceRoot := envOr("OPENSHOCK_WORKSPACE_ROOT", `E:\00.Lark_Projects\00_OpenShock`)
	statePath := envOr("OPENSHOCK_STATE_FILE", filepath.Join(workspaceRoot, "data", "phase0", "state.json"))
	httpClient := &http.Client{Timeout: 4 * time.Minute}

	store, err := newStateStore(statePath)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"service":   "openshock-server",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"stateFile": statePath,
		})
	})
	mux.HandleFunc("/v1/state", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot())
	})
	mux.HandleFunc("/v1/workspace", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot().Workspace)
	})
	mux.HandleFunc("/v1/channels", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot().Channels)
	})
	mux.HandleFunc("/v1/issues", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, store.Snapshot().Issues)
		case http.MethodPost:
			var req createIssueRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}

			nextState, roomID, err := store.CreateIssue(req)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}

			writeJSON(w, http.StatusCreated, map[string]any{"roomId": roomID, "state": nextState})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})
	mux.HandleFunc("/v1/rooms", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot().Rooms)
	})
	mux.HandleFunc("/v1/rooms/", func(w http.ResponseWriter, r *http.Request) {
		handleRoomRoutes(w, r, store, httpClient, daemonURL, workspaceRoot)
	})
	mux.HandleFunc("/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		handleRunRoutes(w, r, store.Snapshot())
	})
	mux.HandleFunc("/v1/agents", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot().Agents)
	})
	mux.HandleFunc("/v1/inbox", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Snapshot().Inbox)
	})
	mux.HandleFunc("/v1/runtime", func(w http.ResponseWriter, _ *http.Request) {
		forwardGetJSON(w, httpClient, daemonURL+"/v1/runtime")
	})
	mux.HandleFunc("/v1/exec", func(w http.ResponseWriter, r *http.Request) {
		handleExecRoute(w, r, httpClient, daemonURL)
	})

	log.Printf("openshock-server listening on %s (daemon %s)", addr, daemonURL)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func handleRoomRoutes(
	w http.ResponseWriter,
	r *http.Request,
	store *stateStore,
	httpClient *http.Client,
	daemonURL string,
	workspaceRoot string,
) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/rooms/")
	if path == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "room not found"})
		return
	}

	if strings.HasSuffix(path, "/messages") {
		roomID := strings.TrimSuffix(path, "/messages")
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req roomMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		prompt := strings.TrimSpace(req.Prompt)
		if prompt == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
			return
		}

		payload, err := runDaemonExec(httpClient, daemonURL, execRequest{
			Provider: defaultString(req.Provider, "claude"),
			Prompt:   prompt,
			Cwd:      defaultString(req.Cwd, workspaceRoot),
		})
		if err != nil {
			nextState, appendErr := store.AppendSystemRoomMessage(roomID, "System", fmt.Sprintf("CLI 连接失败：%s", err.Error()), "blocked")
			if appendErr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "state": nextState})
			return
		}

		nextState, err := store.AppendConversation(roomID, prompt, strings.TrimSpace(payload.Output))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"output": payload.Output, "state": nextState})
		return
	}

	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	detail, ok := store.RoomDetail(strings.TrimSuffix(path, "/"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "room not found"})
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

func handleRunRoutes(w http.ResponseWriter, r *http.Request, snapshot apiState) {
	if r.URL.Path == "/v1/runs" {
		writeJSON(w, http.StatusOK, snapshot.Runs)
		return
	}

	runID := strings.TrimPrefix(r.URL.Path, "/v1/runs/")
	for _, candidate := range snapshot.Runs {
		if candidate.ID == runID {
			writeJSON(w, http.StatusOK, candidate)
			return
		}
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
}

func handleExecRoute(w http.ResponseWriter, r *http.Request, httpClient *http.Client, daemonURL string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var req execRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	payload, err := runDaemonExec(httpClient, daemonURL, req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, payload)
}

func newStateStore(path string) (*stateStore, error) {
	store := &stateStore{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	body, err := os.ReadFile(path)
	if err == nil && len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &store.state); err != nil {
			return nil, err
		}
		return store, nil
	}

	store.state = seedState()
	store.mu.Lock()
	defer store.mu.Unlock()
	return store, store.persistLocked()
}

func (s *stateStore) Snapshot() apiState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.state)
}

func (s *stateStore) RoomDetail(roomID string) (roomDetailResponse, bool) {
	snapshot := s.Snapshot()
	for _, item := range snapshot.Rooms {
		if item.ID == roomID {
			return roomDetailResponse{Room: item, Messages: snapshot.RoomMessages[roomID]}, true
		}
	}

	return roomDetailResponse{}, false
}

func (s *stateStore) CreateIssue(req createIssueRequest) (apiState, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	title := strings.TrimSpace(req.Title)
	if title == "" {
		return apiState{}, "", fmt.Errorf("title is required")
	}

	owner := defaultString(strings.TrimSpace(req.Owner), "Claude Review Runner")
	priority := defaultString(strings.TrimSpace(req.Priority), "high")
	summary := defaultString(strings.TrimSpace(req.Summary), "新建需求，等待进入讨论间和 Run 主链路。")
	slug := slugify(title)
	if slug == "" {
		slug = fmt.Sprintf("issue-%d", time.Now().Unix())
	}

	issueNumber := s.nextIssueNumberLocked()
	issueKey := fmt.Sprintf("OPS-%d", issueNumber)
	roomID := fmt.Sprintf("room-%s", slug)
	topicID := fmt.Sprintf("topic-%s", slug)
	runID := fmt.Sprintf("run_%s_01", slug)
	now := shortClock()

	newIssue := issue{
		ID:          fmt.Sprintf("issue-%s", slug),
		Key:         issueKey,
		Title:       title,
		Summary:     summary,
		State:       "queued",
		Priority:    priority,
		Owner:       owner,
		RoomID:      roomID,
		RunID:       runID,
		PullRequest: "未创建",
		Checklist: []string{
			"确认需求边界",
			"进入讨论间并启动 Run",
			"生成 PR 并回写状态",
		},
	}

	newRoom := room{
		ID:         roomID,
		IssueKey:   issueKey,
		Title:      fmt.Sprintf("%s 讨论间", title),
		Unread:     0,
		Summary:    summary,
		BoardCount: 1,
		RunID:      runID,
		MessageIDs: []string{fmt.Sprintf("%s-msg-1", roomID)},
		Topic: topic{
			ID:      topicID,
			Title:   title,
			Status:  "queued",
			Owner:   owner,
			Summary: "新 Topic 已创建，等待进入执行。",
		},
	}

	newRun := run{
		ID:          runID,
		IssueKey:    issueKey,
		RoomID:      roomID,
		TopicID:     topicID,
		Status:      "queued",
		Runtime:     s.state.Workspace.PairedRuntime,
		Machine:     "shock-main",
		Provider:    "Claude Code CLI",
		Branch:      fmt.Sprintf("feat/%s", slug),
		Worktree:    fmt.Sprintf("wt-%s", slug),
		Owner:       owner,
		StartedAt:   now,
		Duration:    "0m",
		Summary:     summary,
		NextAction:  "进入讨论间并发送第一条指令。",
		PullRequest: "未创建",
		Stdout: []string{
			fmt.Sprintf("[%s] 已创建 Issue Room 与默认 Topic", now),
		},
		Stderr: []string{},
		ToolCalls: []toolCall{
			{ID: fmt.Sprintf("%s-tool-1", runID), Tool: "openshock", Summary: "自动创建房间与执行 lane", Result: "成功"},
		},
		Timeline: []runEvent{
			{ID: fmt.Sprintf("%s-ev-1", runID), Label: "Issue 已创建", At: now, Tone: "yellow"},
		},
	}

	s.state.Issues = append([]issue{newIssue}, s.state.Issues...)
	s.state.Rooms = append([]room{newRoom}, s.state.Rooms...)
	s.state.Runs = append([]run{newRun}, s.state.Runs...)
	if s.state.RoomMessages == nil {
		s.state.RoomMessages = map[string][]message{}
	}
	s.state.RoomMessages[roomID] = []message{{
		ID:      fmt.Sprintf("%s-msg-1", roomID),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 已创建讨论间和默认 Topic，可以直接开始安排 Agent。", issueKey),
		Time:    now,
	}}
	s.state.Inbox = append([]inboxItem{{
		ID:      fmt.Sprintf("inbox-%s", slug),
		Title:   fmt.Sprintf("%s 已准备就绪", issueKey),
		Kind:    "status",
		Room:    newRoom.Title,
		Time:    "刚刚",
		Summary: "新的需求已经进入队列，等待第一条执行指令。",
		Action:  "打开房间",
		Href:    fmt.Sprintf("/rooms/%s", roomID),
	}}, s.state.Inbox...)
	s.appendChannelMessageLocked("announcements", message{
		ID:      fmt.Sprintf("ann-%s", slug),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 已自动升级成新的讨论间：%s。", issueKey, newRoom.Title),
		Time:    now,
	})

	if err := s.persistLocked(); err != nil {
		return apiState{}, "", err
	}

	return cloneState(s.state), roomID, nil
}

func (s *stateStore) AppendConversation(roomID, prompt, output string) (apiState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return apiState{}, fmt.Errorf("room not found")
	}

	now := shortClock()
	humanMessage := message{
		ID:      fmt.Sprintf("%s-human-%d", roomID, time.Now().UnixNano()),
		Speaker: "Lead_Architect",
		Role:    "human",
		Tone:    "human",
		Message: prompt,
		Time:    now,
	}
	agentText := defaultString(strings.TrimSpace(output), "已收到，但这次没有可展示的文本输出。")
	agentMessage := message{
		ID:      fmt.Sprintf("%s-agent-%d", roomID, time.Now().UnixNano()),
		Speaker: "Shock_AI_Core",
		Role:    "agent",
		Tone:    "agent",
		Message: agentText,
		Time:    now,
	}

	s.state.RoomMessages[roomID] = append(s.state.RoomMessages[roomID], humanMessage, agentMessage)
	s.state.Rooms[roomIndex].MessageIDs = append(s.state.Rooms[roomIndex].MessageIDs, humanMessage.ID, agentMessage.ID)
	s.state.Rooms[roomIndex].Unread = 0
	s.state.Rooms[roomIndex].Topic.Status = "running"
	s.state.Rooms[roomIndex].Topic.Summary = agentText
	s.state.Issues[issueIndex].State = "running"
	s.state.Runs[runIndex].Status = "running"
	s.state.Runs[runIndex].StartedAt = now
	s.state.Runs[runIndex].Duration = "实时"
	s.state.Runs[runIndex].Summary = agentText
	s.state.Runs[runIndex].NextAction = "继续在讨论间追加约束或验收标准。"
	s.state.Runs[runIndex].Stdout = append(s.state.Runs[runIndex].Stdout, fmt.Sprintf("[%s] %s", now, agentText))
	s.state.Runs[runIndex].ToolCalls = append(s.state.Runs[runIndex].ToolCalls, toolCall{
		ID:      fmt.Sprintf("%s-tool-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].ToolCalls)+1),
		Tool:    "claude-code",
		Summary: "讨论间对话已同步到本地 CLI",
		Result:  "成功",
	})
	s.state.Runs[runIndex].Timeline = append(s.state.Runs[runIndex].Timeline, runEvent{
		ID:    fmt.Sprintf("%s-ev-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].Timeline)+1),
		Label: "已收到新指令并返回结果",
		At:    now,
		Tone:  "lime",
	})
	s.updateAgentStateLocked(s.state.Issues[issueIndex].Owner, "running", "正在处理讨论间新指令")

	if err := s.persistLocked(); err != nil {
		return apiState{}, err
	}

	return cloneState(s.state), nil
}

func (s *stateStore) AppendSystemRoomMessage(roomID, speaker, text, tone string) (apiState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return apiState{}, fmt.Errorf("room not found")
	}

	now := shortClock()
	msg := message{
		ID:      fmt.Sprintf("%s-system-%d", roomID, time.Now().UnixNano()),
		Speaker: speaker,
		Role:    "system",
		Tone:    tone,
		Message: text,
		Time:    now,
	}
	s.state.RoomMessages[roomID] = append(s.state.RoomMessages[roomID], msg)
	s.state.Rooms[roomIndex].MessageIDs = append(s.state.Rooms[roomIndex].MessageIDs, msg.ID)
	s.state.Rooms[roomIndex].Unread++
	s.state.Rooms[roomIndex].Topic.Status = "blocked"
	s.state.Issues[issueIndex].State = "blocked"
	s.state.Runs[runIndex].Status = "blocked"
	s.state.Runs[runIndex].Stderr = append(s.state.Runs[runIndex].Stderr, fmt.Sprintf("[%s] %s", now, text))
	s.state.Inbox = append([]inboxItem{{
		ID:      fmt.Sprintf("inbox-blocked-%d", time.Now().UnixNano()),
		Title:   "CLI 连接失败，等待人工处理",
		Kind:    "blocked",
		Room:    s.state.Rooms[roomIndex].Title,
		Time:    "刚刚",
		Summary: text,
		Action:  "解除阻塞",
		Href:    fmt.Sprintf("/rooms/%s", roomID),
	}}, s.state.Inbox...)

	if err := s.persistLocked(); err != nil {
		return apiState{}, err
	}

	return cloneState(s.state), nil
}

func (s *stateStore) nextIssueNumberLocked() int {
	max := 0
	for _, item := range s.state.Issues {
		number, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(item.Key), "OPS-"))
		if err == nil && number > max {
			max = number
		}
	}
	return max + 1
}

func (s *stateStore) appendChannelMessageLocked(channelID string, msg message) {
	if s.state.ChannelMessages == nil {
		s.state.ChannelMessages = map[string][]message{}
	}
	s.state.ChannelMessages[channelID] = append(s.state.ChannelMessages[channelID], msg)
	for index := range s.state.Channels {
		if s.state.Channels[index].ID == channelID {
			s.state.Channels[index].Unread++
			return
		}
	}
}

func (s *stateStore) findRoomRunIssueLocked(roomID string) (int, int, int, bool) {
	roomIndex := -1
	runIndex := -1
	issueIndex := -1
	roomRunID := ""
	roomIssueKey := ""

	for index, item := range s.state.Rooms {
		if item.ID == roomID {
			roomIndex = index
			roomRunID = item.RunID
			roomIssueKey = item.IssueKey
			break
		}
	}
	if roomIndex == -1 {
		return 0, 0, 0, false
	}

	for index, item := range s.state.Runs {
		if item.ID == roomRunID {
			runIndex = index
			break
		}
	}
	for index, item := range s.state.Issues {
		if item.Key == roomIssueKey {
			issueIndex = index
			break
		}
	}

	return roomIndex, runIndex, issueIndex, runIndex != -1 && issueIndex != -1
}

func (s *stateStore) updateAgentStateLocked(owner, state, mood string) {
	for index := range s.state.Agents {
		if s.state.Agents[index].Name == owner {
			s.state.Agents[index].State = state
			s.state.Agents[index].Mood = mood
			return
		}
	}
}

func (s *stateStore) persistLocked() error {
	body, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, body, 0o644)
}

func cloneState(state apiState) apiState {
	body, err := json.Marshal(state)
	if err != nil {
		return state
	}
	var clone apiState
	if err := json.Unmarshal(body, &clone); err != nil {
		return state
	}
	return clone
}

func runDaemonExec(client *http.Client, daemonURL string, req execRequest) (daemonExecResponse, error) {
	body, _ := json.Marshal(req)
	request, err := http.NewRequest(http.MethodPost, daemonURL+"/v1/exec", bytes.NewReader(body))
	if err != nil {
		return daemonExecResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return daemonExecResponse{}, err
	}
	defer response.Body.Close()

	payloadBody, err := io.ReadAll(response.Body)
	if err != nil {
		return daemonExecResponse{}, err
	}

	var payload daemonExecResponse
	if err := json.Unmarshal(payloadBody, &payload); err != nil {
		return daemonExecResponse{}, err
	}
	if response.StatusCode >= 400 {
		if payload.Error != "" {
			return daemonExecResponse{}, fmt.Errorf("%s", payload.Error)
		}
		return daemonExecResponse{}, fmt.Errorf("daemon error: %s", response.Status)
	}

	return payload, nil
}

func seedState() apiState {
	return apiState{
		Workspace: workspaceSnapshot{
			Name:          "OpenShock 作战台",
			Repo:          "Larkspur-Wang/OpenShock",
			RepoURL:       "https://github.com/Larkspur-Wang/OpenShock",
			Branch:        "main",
			Plan:          "Builder P0",
			PairedRuntime: "shock-main",
			BrowserPush:   "只推高优先级",
			MemoryMode:    "MEMORY.md + notes/ + decisions/",
		},
		Channels: []channel{
			{ID: "all", Name: "#all", Summary: "轻松聊天、公屏唠嗑、快速交接都在这里。", Unread: 5, Purpose: "这是全局闲聊频道，所有轻量讨论先落在这里，不在这里直接干活。"},
			{ID: "roadmap", Name: "#roadmap", Summary: "路线、优先级、产品分歧和排期讨论都在这里。", Unread: 2, Purpose: "路线图先在这里吵清楚，确认后再升级成真正的讨论间。"},
			{ID: "announcements", Name: "#announcements", Summary: "版本、Runtime 变化和制度公告，尽量低噪音。", Unread: 0, Purpose: "这里只做广播，不让讨论蔓延成新的上下文黑洞。"},
		},
		ChannelMessages: map[string][]message{
			"all": {
				{ID: "msg-all-1", Speaker: "Mina", Role: "human", Tone: "human", Message: "前台一定要轻。频道就是频道，严肃工作一律升级成讨论间。", Time: "09:12"},
				{ID: "msg-all-2", Speaker: "Codex Dockmaster", Role: "agent", Tone: "agent", Message: "Runtime 在线状态已经同步。下一步是把真实 Run 和审批链路拉进前台。", Time: "09:16"},
				{ID: "msg-all-3", Speaker: "System", Role: "system", Tone: "system", Message: "OPS-12 已经升级成讨论间，因为它开始涉及 runtime、branch 和 PR 收口。", Time: "09:17"},
			},
			"roadmap": {
				{ID: "msg-roadmap-1", Speaker: "Longwen", Role: "human", Tone: "human", Message: "默认入口必须聊天优先。任务板只能是辅助视图，不许反客为主。", Time: "10:04"},
				{ID: "msg-roadmap-2", Speaker: "Claude Review Runner", Role: "agent", Tone: "agent", Message: "Inbox 现在更像决策驾驶舱，不像一个冷冰冰的告警后台了。", Time: "10:07"},
			},
			"announcements": {
				{ID: "msg-ann-1", Speaker: "System", Role: "system", Tone: "system", Message: "Phase 0 主壳已经就位。下一步是把真实状态流和房间执行链路接通。", Time: "11:02"},
			},
		},
		Issues: []issue{
			{ID: "issue-runtime", Key: "OPS-12", Title: "打通 runtime 心跳与机器在线状态", Summary: "把 runtime 状态、最近 heartbeat 和本机 CLI 执行能力真实带进壳层和讨论间。", State: "running", Priority: "critical", Owner: "Codex Dockmaster", RoomID: "room-runtime", RunID: "run_runtime_01", PullRequest: "PR #18", Checklist: []string{"左下角展示机器在线 / 忙碌 / 离线", "Run 详情必须带出 branch 和 worktree", "approval_required 必须对人类可见"}},
			{ID: "issue-inbox", Key: "OPS-19", Title: "把 Inbox 做成人类决策中心", Summary: "把 blocked、approval、review 三类事件统一成一个人类干预面板。", State: "review", Priority: "high", Owner: "Claude Review Runner", RoomID: "room-inbox", RunID: "run_inbox_01", PullRequest: "PR #22", Checklist: []string{"按事件类型统一卡片语气和动作文案", "每张卡都能直接回到房间或 Run", "浏览器 Push 只给高优先级事件"}},
			{ID: "issue-memory", Key: "OPS-27", Title: "落地文件级记忆写回", Summary: "把 run 摘要写回 MEMORY.md、notes/、decisions/，但不提前引入沉重的 memory OS。", State: "blocked", Priority: "high", Owner: "Memory Clerk", RoomID: "room-memory", RunID: "run_memory_01", PullRequest: "草稿 PR", Checklist: []string{"把 Run 摘要写入 MEMORY.md", "策略冲突必须经由 Inbox 升级，而不是静默覆盖", "房间笔记必须保持人类可检查"}},
		},
		Rooms: []room{
			{ID: "room-runtime", IssueKey: "OPS-12", Title: "Runtime 讨论间", Unread: 3, Summary: "把 runtime 状态、活跃 Run 和人类干预都收进一个讨论间。", BoardCount: 4, RunID: "run_runtime_01", MessageIDs: []string{"msg-room-1", "msg-room-2", "msg-room-3"}, Topic: topic{ID: "topic-runtime", Title: "把 runtime 卡片和 Run 元信息接进前端", Status: "running", Owner: "Codex Dockmaster", Summary: "壳层正在推进中。Agent 正在把机器在线状态、branch 和 Run 详情接进前端。"}},
			{ID: "room-inbox", IssueKey: "OPS-19", Title: "Inbox 讨论间", Unread: 1, Summary: "把 blocked、approval 和 review 三种提示统一收进一个人类决策面。", BoardCount: 3, RunID: "run_inbox_01", MessageIDs: []string{"msg-room-4", "msg-room-5"}, Topic: topic{ID: "topic-inbox", Title: "收紧审批卡片与升级文案", Status: "review", Owner: "Claude Review Runner", Summary: "文案已经准备好，正在等产品确认后合并。"}},
			{ID: "room-memory", IssueKey: "OPS-27", Title: "记忆写回讨论间", Unread: 4, Summary: "让 MEMORY.md 和 decisions/ 真正可用，但不假装我们已经有完整 memory OS。", BoardCount: 2, RunID: "run_memory_01", MessageIDs: []string{"msg-room-6", "msg-room-7"}, Topic: topic{ID: "topic-memory", Title: "解决写回策略冲突", Status: "blocked", Owner: "Memory Clerk", Summary: "Agent 在写回房间笔记前，需要一个正式的优先级规则。"}},
		},
		RoomMessages: map[string][]message{
			"room-runtime": {
				{ID: "msg-room-1", Speaker: "Codex Dockmaster", Role: "agent", Tone: "agent", Message: "左下角状态区已经接上，下一步把 Run 详情和机器 heartbeat 带进房间。", Time: "09:20"},
				{ID: "msg-room-2", Speaker: "Longwen", Role: "human", Tone: "human", Message: "机器和 Agent 的状态必须常驻可见，它们不是设置项，而是协作者。", Time: "09:23"},
				{ID: "msg-room-3", Speaker: "System", Role: "system", Tone: "system", Message: "run_runtime_01 已经在 shock-main 上进入实时执行。", Time: "09:26"},
			},
			"room-inbox": {
				{ID: "msg-room-4", Speaker: "Claude Review Runner", Role: "agent", Tone: "agent", Message: "审批卡片现在都会回到房间和 Run，不再掉进孤立的弹窗里。", Time: "10:01"},
				{ID: "msg-room-5", Speaker: "Mina", Role: "human", Tone: "human", Message: "动作文案要冷静，不要官僚化，更不能像告警系统在尖叫。", Time: "10:08"},
			},
			"room-memory": {
				{ID: "msg-room-6", Speaker: "Memory Clerk", Role: "agent", Tone: "blocked", Message: "我已经定位到冲突源，但现在缺少记忆优先级规则，不能继续写回。", Time: "10:30"},
				{ID: "msg-room-7", Speaker: "System", Role: "system", Tone: "system", Message: "已经把阻塞事件升级到 Inbox，等待人类确定优先级。", Time: "10:33"},
			},
		},
		Runs: []run{
			{ID: "run_runtime_01", IssueKey: "OPS-12", RoomID: "room-runtime", TopicID: "topic-runtime", Status: "running", Runtime: "shock-main", Machine: "shock-main", Provider: "Codex CLI", Branch: "feat/runtime-state-shell", Worktree: "wt-runtime-shell", Owner: "Codex Dockmaster", StartedAt: "09:18", Duration: "42m", Summary: "把 runtime 状态、heartbeat、branch 和 approval_required 都接进讨论间。", ApprovalRequired: true, Stdout: []string{"[09:18:02] 已连接 runtime 心跳", "[09:24:10] 已写入房间右侧上下文面板", "[09:31:40] 等待 destructive git cleanup 授权"}, Stderr: []string{}, ToolCalls: []toolCall{{ID: "tool-1", Tool: "codex", Summary: "重构房间上下文与状态壳", Result: "成功"}}, Timeline: []runEvent{{ID: "ev-1", Label: "Run 已启动", At: "09:18", Tone: "yellow"}, {ID: "ev-2", Label: "Heartbeat 已接通", At: "09:24", Tone: "lime"}, {ID: "ev-3", Label: "等待授权", At: "09:31", Tone: "paper"}}, NextAction: "等待人类确认 destructive git cleanup。", PullRequest: "PR #18"},
			{ID: "run_inbox_01", IssueKey: "OPS-19", RoomID: "room-inbox", TopicID: "topic-inbox", Status: "review", Runtime: "shock-sidecar", Machine: "shock-sidecar", Provider: "Claude Code CLI", Branch: "feat/inbox-decision-cards", Worktree: "wt-inbox-cards", Owner: "Claude Review Runner", StartedAt: "09:58", Duration: "18m", Summary: "把批准、阻塞和评审卡片收成一个人类决策收件箱。", ApprovalRequired: false, Stdout: []string{"[09:58:03] 已打开讨论间上下文", "[10:01:14] 已重写批准卡片语气", "[10:06:48] 已把 Inbox 卡片接到 Run 详情和房间视图", "[10:12:30] 等待产品文案核对"}, Stderr: []string{}, ToolCalls: []toolCall{{ID: "tool-3", Tool: "claude-code", Summary: "重写 Inbox 卡片文案层级", Result: "成功"}}, Timeline: []runEvent{{ID: "ev-5", Label: "Run 已启动", At: "09:58", Tone: "yellow"}, {ID: "ev-6", Label: "房间跳转已接通", At: "10:06", Tone: "lime"}, {ID: "ev-7", Label: "已发起评审", At: "10:12", Tone: "paper"}}, NextAction: "等待人类确认语气与通知默认值。", PullRequest: "PR #22"},
			{ID: "run_memory_01", IssueKey: "OPS-27", RoomID: "room-memory", TopicID: "topic-memory", Status: "blocked", Runtime: "shock-main", Machine: "shock-main", Provider: "Codex CLI", Branch: "feat/memory-writeback", Worktree: "wt-memory-writeback", Owner: "Memory Clerk", StartedAt: "10:27", Duration: "11m", Summary: "把 Run 摘要写回 MEMORY.md，同时保留可检查的房间上下文。", ApprovalRequired: true, Stdout: []string{"[10:27:02] 已打开 MEMORY.md", "[10:30:44] 已收集房间笔记和用户记忆范围", "[10:31:10] 发现房间笔记与用户笔记优先级冲突"}, Stderr: []string{"[10:31:11] 写回已暂停：缺少房间与用户优先级策略"}, ToolCalls: []toolCall{{ID: "tool-4", Tool: "codex", Summary: "尝试为 MEMORY.md 规划写回策略", Result: "阻塞"}}, Timeline: []runEvent{{ID: "ev-8", Label: "Run 已启动", At: "10:27", Tone: "yellow"}, {ID: "ev-9", Label: "检测到冲突", At: "10:31", Tone: "pink"}, {ID: "ev-10", Label: "已创建 Inbox 升级项", At: "10:33", Tone: "paper"}}, NextAction: "先定优先级规则，再恢复写回。", PullRequest: "草稿 PR"},
		},
		Agents: []agent{
			{ID: "agent-codex-dockmaster", Name: "Codex Dockmaster", Description: "负责壳层基础设施、runtime 状态，以及执行真相的前台可见性。", Mood: "正在接 runtime 卡片", State: "running", Lane: "OPS-12", Provider: "Codex CLI", RuntimePreference: "shock-main", MemorySpaces: []string{"workspace", "issue-room", "topic"}, RecentRunIDs: []string{"run_runtime_01"}},
			{ID: "agent-claude-review-runner", Name: "Claude Review Runner", Description: "负责语气、评审清晰度和 Inbox 的可读性。", Mood: "等待产品核对", State: "idle", Lane: "OPS-19", Provider: "Claude Code CLI", RuntimePreference: "shock-sidecar", MemorySpaces: []string{"workspace", "issue-room"}, RecentRunIDs: []string{"run_inbox_01"}},
			{ID: "agent-memory-clerk", Name: "Memory Clerk", Description: "维护文件级记忆的可追踪、可检查和可恢复。", Mood: "等待策略输入", State: "blocked", Lane: "OPS-27", Provider: "Codex CLI", RuntimePreference: "shock-main", MemorySpaces: []string{"workspace", "user", "room-notes"}, RecentRunIDs: []string{"run_memory_01"}},
		},
		Machines: []machine{
			{ID: "machine-main", Name: "shock-main", State: "busy", CLI: "Codex + Claude Code", OS: "Windows 11", LastHeartbeat: "8 秒前"},
			{ID: "machine-sidecar", Name: "shock-sidecar", State: "online", CLI: "Codex", OS: "macOS", LastHeartbeat: "21 秒前"},
		},
		Inbox: []inboxItem{
			{ID: "inbox-approval-runtime", Title: "破坏性 Git 清理需要批准", Kind: "approval", Room: "Runtime 讨论间", Time: "2 分钟前", Summary: "这个 Run 想在视觉核对通过后清理过时分支。", Action: "查看批准", Href: "/rooms/room-runtime/runs/run_runtime_01"},
			{ID: "inbox-blocked-memory", Title: "Memory Clerk 被记忆优先级阻塞", Kind: "blocked", Room: "记忆写回讨论间", Time: "7 分钟前", Summary: "写回前需要先确定 topic、房间、工作区、用户和 agent 的优先级规则。", Action: "解除阻塞", Href: "/rooms/room-memory/runs/run_memory_01"},
			{ID: "inbox-review-copy", Title: "Inbox 决策中心已经可以评审", Kind: "review", Room: "Inbox 讨论间", Time: "12 分钟前", Summary: "Agent 已经准备好最终卡片文案和路由跳转。", Action: "打开评审", Href: "/rooms/room-inbox/runs/run_inbox_01"},
			{ID: "inbox-status-shell", Title: "Runtime lane 完成第一轮壳层接线", Kind: "status", Room: "Runtime 讨论间", Time: "18 分钟前", Summary: "机器状态和 Run 元数据已经在主壳里可见。", Action: "打开房间", Href: "/rooms/room-runtime"},
		},
	}
}

func forwardGetJSON(w http.ResponseWriter, client *http.Client, url string) {
	response, err := client.Get(url)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer response.Body.Close()
	copyJSON(w, response.StatusCode, response.Body)
}

func copyJSON(w http.ResponseWriter, status int, reader io.Reader) {
	body, err := io.ReadAll(reader)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func shortClock() string {
	return time.Now().Format("15:04")
}

func slugify(input string) string {
	var builder strings.Builder
	lastDash := false
	for _, char := range strings.ToLower(input) {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
			lastDash = false
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
			lastDash = false
		default:
			if !lastDash && builder.Len() > 0 {
				builder.WriteRune('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(builder.String(), "-")
}
