package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type Config struct {
	DaemonURL     string
	WorkspaceRoot string
	GitHub        githubsvc.Prober
}

type Server struct {
	store            *store.Store
	httpClient       *http.Client
	defaultDaemonURL string
	daemonURL        string
	daemonMu         sync.RWMutex
	workspaceRoot    string
	github           githubsvc.Prober
}

type ExecRequest struct {
	Provider string `json:"provider"`
	Prompt   string `json:"prompt"`
	Cwd      string `json:"cwd"`
}

type CreateIssueRequest struct {
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Owner    string `json:"owner"`
	Priority string `json:"priority"`
}

type RoomMessageRequest struct {
	Provider string `json:"provider"`
	Prompt   string `json:"prompt"`
	Cwd      string `json:"cwd"`
}

type UpdatePullRequestRequest struct {
	Status string `json:"status"`
}

type DaemonExecResponse struct {
	Provider string   `json:"provider,omitempty"`
	Command  []string `json:"command,omitempty"`
	Output   string   `json:"output"`
	Error    string   `json:"error,omitempty"`
	Duration string   `json:"duration,omitempty"`
}

type RuntimeSnapshotResponse struct {
	Machine     string   `json:"machine"`
	DetectedCLI []string `json:"detectedCli"`
	Providers   []struct {
		ID           string   `json:"id"`
		Label        string   `json:"label"`
		Mode         string   `json:"mode"`
		Capabilities []string `json:"capabilities"`
		Transport    string   `json:"transport"`
	} `json:"providers"`
	State         string `json:"state"`
	WorkspaceRoot string `json:"workspaceRoot"`
	ReportedAt    string `json:"reportedAt"`
}

type PairRuntimeRequest struct {
	DaemonURL string `json:"daemonUrl"`
}

type PairingStatusResponse struct {
	DaemonURL     string `json:"daemonUrl"`
	PairedRuntime string `json:"pairedRuntime"`
	PairingStatus string `json:"pairingStatus"`
	DeviceAuth    string `json:"deviceAuth"`
	LastPairedAt  string `json:"lastPairedAt"`
}

type DaemonStreamEvent struct {
	Type      string       `json:"type"`
	Provider  string       `json:"provider,omitempty"`
	Command   []string     `json:"command,omitempty"`
	Delta     string       `json:"delta,omitempty"`
	Output    string       `json:"output,omitempty"`
	Error     string       `json:"error,omitempty"`
	Duration  string       `json:"duration,omitempty"`
	Timestamp string       `json:"timestamp,omitempty"`
	State     *store.State `json:"state,omitempty"`
}

type WorktreeRequest struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	Branch        string `json:"branch"`
	WorktreeName  string `json:"worktreeName"`
	BaseRef       string `json:"baseRef"`
}

type WorktreeResponse struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	Branch        string `json:"branch"`
	WorktreeName  string `json:"worktreeName"`
	Path          string `json:"path"`
	Created       bool   `json:"created"`
	BaseRef       string `json:"baseRef"`
}

func New(s *store.Store, httpClient *http.Client, cfg Config) *Server {
	daemonURL := strings.TrimRight(cfg.DaemonURL, "/")
	if workspace := s.Snapshot().Workspace; strings.TrimSpace(workspace.PairedRuntimeURL) != "" {
		daemonURL = strings.TrimRight(workspace.PairedRuntimeURL, "/")
	}
	githubService := cfg.GitHub
	if githubService == nil {
		githubService = githubsvc.NewService(nil)
	}
	return &Server{
		store:            s,
		httpClient:       httpClient,
		defaultDaemonURL: strings.TrimRight(cfg.DaemonURL, "/"),
		daemonURL:        daemonURL,
		workspaceRoot:    cfg.WorkspaceRoot,
		github:           githubService,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/state", s.handleState)
	mux.HandleFunc("/v1/workspace", s.handleWorkspace)
	mux.HandleFunc("/v1/channels", s.handleChannels)
	mux.HandleFunc("/v1/issues", s.handleIssues)
	mux.HandleFunc("/v1/rooms", s.handleRooms)
	mux.HandleFunc("/v1/rooms/", s.handleRoomRoutes)
	mux.HandleFunc("/v1/runs", s.handleRunRoutes)
	mux.HandleFunc("/v1/runs/", s.handleRunRoutes)
	mux.HandleFunc("/v1/agents", s.handleAgents)
	mux.HandleFunc("/v1/sessions", s.handleSessionRoutes)
	mux.HandleFunc("/v1/sessions/", s.handleSessionRoutes)
	mux.HandleFunc("/v1/inbox", s.handleInbox)
	mux.HandleFunc("/v1/memory", s.handleMemory)
	mux.HandleFunc("/v1/pull-requests", s.handlePullRequests)
	mux.HandleFunc("/v1/pull-requests/", s.handlePullRequestRoutes)
	mux.HandleFunc("/v1/runtime", s.handleRuntime)
	mux.HandleFunc("/v1/runtime/pairing", s.handleRuntimePairing)
	mux.HandleFunc("/v1/repo/binding", s.handleRepoBinding)
	mux.HandleFunc("/v1/github/connection", s.handleGitHubConnection)
	mux.HandleFunc("/v1/exec", s.handleExecRoute)
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot())
}

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Workspace)
}

func (s *Server) handleChannels(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Channels)
}

func (s *Server) handleIssues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.Snapshot().Issues)
	case http.MethodPost:
		var req CreateIssueRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		result, err := s.store.CreateIssue(store.CreateIssueInput{
			Title:    req.Title,
			Summary:  req.Summary,
			Owner:    req.Owner,
			Priority: req.Priority,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		worktreePayload, ensureErr := s.ensureWorktreeLane(WorktreeRequest{
			WorkspaceRoot: s.workspaceRoot,
			Branch:        result.Branch,
			WorktreeName:  result.WorktreeName,
			BaseRef:       "HEAD",
		})
		if ensureErr != nil {
			nextState, appendErr := s.store.AppendSystemRoomMessage(result.RoomID, "System", fmt.Sprintf("worktree 创建失败：%s", ensureErr.Error()), "blocked")
			if appendErr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": ensureErr.Error()})
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": ensureErr.Error(), "state": nextState, "roomId": result.RoomID})
			return
		}

		nextState, err := s.store.AttachLane(result.RunID, result.SessionID, store.LaneBinding{
			Branch:       worktreePayload.Branch,
			WorktreeName: worktreePayload.WorktreeName,
			Path:         worktreePayload.Path,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"roomId": result.RoomID, "runId": result.RunID, "sessionId": result.SessionID, "state": nextState})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleRooms(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Rooms)
}

func (s *Server) handleRoomRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/rooms/")
	if path == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "room not found"})
		return
	}

	if strings.HasSuffix(path, "/messages/stream") {
		roomID := strings.TrimSuffix(path, "/messages/stream")
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req RoomMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		prompt := strings.TrimSpace(req.Prompt)
		if prompt == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
			return
		}
		s.handleRoomMessageStream(w, r, roomID, ExecRequest{
			Provider: defaultString(req.Provider, "claude"),
			Prompt:   prompt,
			Cwd:      defaultString(req.Cwd, s.workspaceRoot),
		}, prompt)
		return
	}

	if strings.HasSuffix(path, "/messages") {
		roomID := strings.TrimSuffix(path, "/messages")
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req RoomMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		prompt := strings.TrimSpace(req.Prompt)
		if prompt == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
			return
		}

		payload, err := s.runDaemonExec(ExecRequest{
			Provider: defaultString(req.Provider, "claude"),
			Prompt:   prompt,
			Cwd:      defaultString(req.Cwd, s.workspaceRoot),
		})
		if err != nil {
			nextState, appendErr := s.store.AppendSystemRoomMessage(roomID, "System", fmt.Sprintf("CLI 连接失败：%s", err.Error()), "blocked")
			if appendErr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "state": nextState})
			return
		}

		nextState, err := s.store.AppendConversation(roomID, prompt, strings.TrimSpace(payload.Output))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"output": payload.Output, "state": nextState})
		return
	}

	if strings.HasSuffix(path, "/pull-request") {
		roomID := strings.TrimSuffix(path, "/pull-request")
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		nextState, pullRequestID, err := s.store.CreatePullRequest(roomID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"pullRequestId": pullRequestID, "state": nextState})
		return
	}

	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	detail, ok := s.store.RoomDetail(strings.TrimSuffix(path, "/"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "room not found"})
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleRunRoutes(w http.ResponseWriter, r *http.Request) {
	snapshot := s.store.Snapshot()
	if r.URL.Path == "/v1/runs" {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, snapshot.Runs)
		return
	}
	if !requireMethod(w, r, http.MethodGet) {
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

func (s *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Agents)
}

func (s *Server) handleSessionRoutes(w http.ResponseWriter, r *http.Request) {
	snapshot := s.store.Snapshot()
	if r.URL.Path == "/v1/sessions" {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, snapshot.Sessions)
		return
	}
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	sessionID := strings.TrimPrefix(r.URL.Path, "/v1/sessions/")
	for _, candidate := range snapshot.Sessions {
		if candidate.ID == sessionID {
			writeJSON(w, http.StatusOK, candidate)
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
}

func (s *Server) handleInbox(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Inbox)
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Memory)
}

func (s *Server) handlePullRequests(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().PullRequests)
}

func (s *Server) handlePullRequestRoutes(w http.ResponseWriter, r *http.Request) {
	pullRequestID := strings.TrimPrefix(r.URL.Path, "/v1/pull-requests/")
	if pullRequestID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}
	if r.Method == http.MethodGet {
		snapshot := s.store.Snapshot()
		for _, item := range snapshot.PullRequests {
			if item.ID == pullRequestID {
				writeJSON(w, http.StatusOK, item)
				return
			}
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var req UpdatePullRequestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	nextState, err := s.store.UpdatePullRequestStatus(pullRequestID, req.Status)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": nextState})
}

func (s *Server) handleRuntime(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	workspace := s.store.Snapshot().Workspace
	if workspace.PairingStatus != "paired" || strings.TrimSpace(s.daemonURLValue()) == "" {
		writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(workspace))
		return
	}
	s.forwardGetJSON(w, s.daemonURLValue()+"/v1/runtime")
}

func (s *Server) handleRuntimePairing(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		workspace := s.store.Snapshot().Workspace
		writeJSON(w, http.StatusOK, PairingStatusResponse{
			DaemonURL:     defaultString(workspace.PairedRuntimeURL, s.daemonURLValue()),
			PairedRuntime: workspace.PairedRuntime,
			PairingStatus: workspace.PairingStatus,
			DeviceAuth:    workspace.DeviceAuth,
			LastPairedAt:  workspace.LastPairedAt,
		})
	case http.MethodPost:
		var req PairRuntimeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		daemonURL := strings.TrimRight(strings.TrimSpace(req.DaemonURL), "/")
		if daemonURL == "" {
			daemonURL = s.daemonURLValue()
		}
		runtimeSnapshot, err := s.fetchRuntimeSnapshot(daemonURL)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		s.setDaemonURL(daemonURL)
		nextState, err := s.store.UpdateRuntimePairing(store.RuntimePairingInput{
			DaemonURL:   daemonURL,
			Machine:     runtimeSnapshot.Machine,
			DetectedCLI: runtimeSnapshot.DetectedCLI,
			State:       runtimeSnapshot.State,
			ReportedAt:  runtimeSnapshot.ReportedAt,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"daemonUrl": daemonURL,
			"runtime":   runtimeSnapshot,
			"state":     nextState,
		})
	case http.MethodDelete:
		nextState, err := s.store.ClearRuntimePairing()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.setDaemonURL("")
		writeJSON(w, http.StatusOK, map[string]any{
			"daemonUrl": "",
			"runtime":   offlineRuntimeSnapshot(nextState.Workspace),
			"state":     nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleExecRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	payload, err := s.runDaemonExec(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleRoomMessageStream(w http.ResponseWriter, r *http.Request, roomID string, req ExecRequest, prompt string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	var outputBuilder strings.Builder
	var stderrBuilder strings.Builder

	resp, err := s.streamDaemonExec(r, req, func(event DaemonStreamEvent) error {
		switch event.Type {
		case "stdout":
			outputBuilder.WriteString(event.Delta)
		case "stderr":
			stderrBuilder.WriteString(event.Delta)
		case "done":
			if strings.TrimSpace(event.Output) != "" {
				outputBuilder.Reset()
				outputBuilder.WriteString(event.Output)
			}
		}
		return writeNDJSON(w, flusher, event)
	})
	if err != nil {
		nextState, appendErr := s.store.AppendSystemRoomMessage(roomID, "System", fmt.Sprintf("CLI 连接失败：%s", err.Error()), "blocked")
		if appendErr != nil {
			_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "error", Error: err.Error()})
			return
		}
		_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "state", Error: err.Error(), State: &nextState})
		return
	}

	finalOutput := strings.TrimSpace(outputBuilder.String())
	if finalOutput == "" {
		finalOutput = strings.TrimSpace(resp.Output)
	}
	if finalOutput == "" {
		finalOutput = strings.TrimSpace(stderrBuilder.String())
	}

	nextState, appendErr := s.store.AppendConversation(roomID, prompt, finalOutput)
	if appendErr != nil {
		_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "error", Error: appendErr.Error()})
		return
	}
	_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "state", Output: finalOutput, State: &nextState})
}

func (s *Server) ensureWorktreeLane(req WorktreeRequest) (WorktreeResponse, error) {
	body, _ := json.Marshal(req)
	request, err := http.NewRequest(http.MethodPost, s.daemonURLValue()+"/v1/worktrees/ensure", bytes.NewReader(body))
	if err != nil {
		return WorktreeResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return WorktreeResponse{}, err
	}
	defer response.Body.Close()

	payloadBody, err := io.ReadAll(response.Body)
	if err != nil {
		return WorktreeResponse{}, err
	}

	var payload WorktreeResponse
	if err := json.Unmarshal(payloadBody, &payload); err != nil {
		return WorktreeResponse{}, err
	}
	if response.StatusCode >= 400 {
		if payload.Path != "" {
			return WorktreeResponse{}, errors.New(payload.Path)
		}
		var daemonErr map[string]string
		if err := json.Unmarshal(payloadBody, &daemonErr); err == nil && daemonErr["error"] != "" {
			return WorktreeResponse{}, errors.New(daemonErr["error"])
		}
		return WorktreeResponse{}, fmt.Errorf("worktree error: %s", response.Status)
	}
	return payload, nil
}

func (s *Server) runDaemonExec(req ExecRequest) (DaemonExecResponse, error) {
	body, _ := json.Marshal(req)
	request, err := http.NewRequest(http.MethodPost, s.daemonURLValue()+"/v1/exec", bytes.NewReader(body))
	if err != nil {
		return DaemonExecResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	defer response.Body.Close()

	payloadBody, err := io.ReadAll(response.Body)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	var payload DaemonExecResponse
	if err := json.Unmarshal(payloadBody, &payload); err != nil {
		return DaemonExecResponse{}, err
	}
	if response.StatusCode >= 400 {
		if payload.Error != "" {
			return DaemonExecResponse{}, fmt.Errorf("%s", payload.Error)
		}
		return DaemonExecResponse{}, fmt.Errorf("daemon error: %s", response.Status)
	}
	return payload, nil
}

func (s *Server) streamDaemonExec(r *http.Request, req ExecRequest, emit func(DaemonStreamEvent) error) (DaemonExecResponse, error) {
	body, _ := json.Marshal(req)
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.daemonURLValue()+"/v1/exec/stream", bytes.NewReader(body))
	if err != nil {
		return DaemonExecResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	defer response.Body.Close()

	if response.StatusCode >= 400 {
		payloadBody, readErr := io.ReadAll(response.Body)
		if readErr != nil {
			return DaemonExecResponse{}, readErr
		}
		var payload DaemonExecResponse
		if err := json.Unmarshal(payloadBody, &payload); err == nil && payload.Error != "" {
			return payload, errors.New(payload.Error)
		}
		return DaemonExecResponse{}, fmt.Errorf("daemon error: %s", response.Status)
	}

	var resp DaemonExecResponse
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var event DaemonStreamEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return resp, err
		}
		if event.Type == "done" {
			resp.Output = event.Output
		}
		if event.Type == "error" && strings.TrimSpace(event.Error) != "" {
			resp.Error = event.Error
		}
		if emit != nil {
			if err := emit(event); err != nil {
				return resp, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return resp, err
	}
	if strings.TrimSpace(resp.Error) != "" {
		return resp, errors.New(resp.Error)
	}
	return resp, nil
}

func (s *Server) forwardGetJSON(w http.ResponseWriter, url string) {
	response, err := s.httpClient.Get(url)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(body)
}

func (s *Server) fetchRuntimeSnapshot(daemonURL string) (RuntimeSnapshotResponse, error) {
	response, err := s.httpClient.Get(daemonURL + "/v1/runtime")
	if err != nil {
		return RuntimeSnapshotResponse{}, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return RuntimeSnapshotResponse{}, err
	}
	var payload RuntimeSnapshotResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return RuntimeSnapshotResponse{}, err
	}
	if response.StatusCode >= 400 {
		return RuntimeSnapshotResponse{}, fmt.Errorf("runtime probe failed: %s", response.Status)
	}
	return payload, nil
}

func (s *Server) daemonURLValue() string {
	s.daemonMu.RLock()
	defer s.daemonMu.RUnlock()
	return strings.TrimRight(s.daemonURL, "/")
}

func (s *Server) setDaemonURL(url string) {
	s.daemonMu.Lock()
	defer s.daemonMu.Unlock()
	s.daemonURL = strings.TrimRight(url, "/")
}

func offlineRuntimeSnapshot(workspace store.WorkspaceSnapshot) RuntimeSnapshotResponse {
	machine := workspace.PairedRuntime
	if strings.TrimSpace(machine) == "" {
		machine = "未配对"
	}
	return RuntimeSnapshotResponse{
		Machine:       machine,
		DetectedCLI:   []string{},
		Providers:     nil,
		State:         "offline",
		WorkspaceRoot: "",
		ReportedAt:    workspace.LastPairedAt,
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeNDJSON(w http.ResponseWriter, flusher http.Flusher, payload any) error {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func requireMethod(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, method := range methods {
		if r.Method == method {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(methods, ", "))
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	return false
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
