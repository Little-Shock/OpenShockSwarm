package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type Config struct {
	DaemonURL           string
	WorkspaceRoot       string
	GitHub              githubsvc.Client
	GitHubWebhookSecret string
}

type Server struct {
	store               *store.Store
	httpClient          *http.Client
	defaultDaemonURL    string
	daemonURL           string
	daemonMu            sync.RWMutex
	workspaceRoot       string
	github              githubsvc.Client
	githubWebhookSecret string
}

type serverRouteRegistrar func(*Server, *http.ServeMux)

var serverRouteRegistrars []serverRouteRegistrar

func registerServerRoutes(fn serverRouteRegistrar) {
	serverRouteRegistrars = append(serverRouteRegistrars, fn)
}

type requestGuard func(*Server, http.ResponseWriter) bool
type pullRequestStatusGuard func(*Server, http.ResponseWriter, string) bool

var (
	issueCreateGuard      requestGuard           = allowRequest
	roomReplyGuard        requestGuard           = allowRequest
	roomPullRequestGuard  requestGuard           = allowRequest
	runtimeManageGuard    requestGuard           = allowRequest
	runExecuteGuard       requestGuard           = allowRequest
	pullRequestRouteGuard pullRequestStatusGuard = allowPullRequestRoute
)

func allowRequest(_ *Server, _ http.ResponseWriter) bool {
	return true
}

func allowPullRequestRoute(_ *Server, _ http.ResponseWriter, _ string) bool {
	return true
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

type RunControlRequest struct {
	Action string `json:"action"`
	Note   string `json:"note,omitempty"`
}

type RuntimeSnapshotResponse struct {
	RuntimeID          string                  `json:"runtimeId,omitempty"`
	DaemonURL          string                  `json:"daemonUrl,omitempty"`
	Machine            string                  `json:"machine"`
	DetectedCLI        []string                `json:"detectedCli"`
	Providers          []store.RuntimeProvider `json:"providers"`
	Shell              string                  `json:"shell,omitempty"`
	State              string                  `json:"state"`
	WorkspaceRoot      string                  `json:"workspaceRoot"`
	ReportedAt         string                  `json:"reportedAt"`
	HeartbeatIntervalS int                     `json:"heartbeatIntervalSeconds,omitempty"`
	HeartbeatTimeoutS  int                     `json:"heartbeatTimeoutSeconds,omitempty"`
}

type PairRuntimeRequest struct {
	RuntimeID string `json:"runtimeId"`
	DaemonURL string `json:"daemonUrl"`
}

type PairingStatusResponse struct {
	DaemonURL     string `json:"daemonUrl"`
	PairedRuntime string `json:"pairedRuntime"`
	PairingStatus string `json:"pairingStatus"`
	DeviceAuth    string `json:"deviceAuth"`
	LastPairedAt  string `json:"lastPairedAt"`
}

type SelectRuntimeRequest struct {
	Machine string `json:"machine"`
}

type WorkspaceOnboardingRequest struct {
	Status         string   `json:"status"`
	TemplateID     string   `json:"templateId"`
	CurrentStep    string   `json:"currentStep"`
	CompletedSteps []string `json:"completedSteps"`
	ResumeURL      string   `json:"resumeUrl"`
}

type WorkspaceUpdateRequest struct {
	Plan        string                      `json:"plan"`
	BrowserPush string                      `json:"browserPush"`
	MemoryMode  string                      `json:"memoryMode"`
	Onboarding  *WorkspaceOnboardingRequest `json:"onboarding,omitempty"`
}

type RuntimeSelectionResponse struct {
	SelectedRuntime   string          `json:"selectedRuntime"`
	SelectedDaemonURL string          `json:"selectedDaemonUrl"`
	PairingStatus     string          `json:"pairingStatus"`
	Runtimes          []store.Machine `json:"runtimes"`
}

func New(s *store.Store, httpClient *http.Client, cfg Config) *Server {
	daemonURL := strings.TrimRight(strings.TrimSpace(cfg.DaemonURL), "/")
	if daemonURL == "" {
		if workspace := s.RuntimeSnapshot(time.Now()).Workspace; strings.TrimSpace(workspace.PairedRuntimeURL) != "" {
			daemonURL = strings.TrimRight(workspace.PairedRuntimeURL, "/")
		}
	}
	githubService := cfg.GitHub
	if githubService == nil {
		githubService = githubsvc.NewService(nil)
	}
	return &Server{
		store:               s,
		httpClient:          httpClient,
		defaultDaemonURL:    strings.TrimRight(cfg.DaemonURL, "/"),
		daemonURL:           daemonURL,
		workspaceRoot:       cfg.WorkspaceRoot,
		github:              githubService,
		githubWebhookSecret: strings.TrimSpace(cfg.GitHubWebhookSecret),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/state", s.handleState)
	mux.HandleFunc("/v1/workspace", s.handleWorkspace)
	mux.HandleFunc("/v1/channels", s.handleChannels)
	mux.HandleFunc("/v1/channels/", s.handleChannelRoutes)
	mux.HandleFunc("/v1/issues", s.handleIssues)
	mux.HandleFunc("/v1/rooms", s.handleRooms)
	mux.HandleFunc("/v1/rooms/", s.handleRoomRoutes)
	mux.HandleFunc("/v1/runs", s.handleRunRoutes)
	mux.HandleFunc("/v1/runs/", s.handleRunRoutes)
	mux.HandleFunc("/v1/agents", s.handleAgents)
	mux.HandleFunc("/v1/sessions", s.handleSessionRoutes)
	mux.HandleFunc("/v1/sessions/", s.handleSessionRoutes)
	mux.HandleFunc("/v1/inbox", s.handleInbox)
	mux.HandleFunc("/v1/inbox/", s.handleInboxRoutes)
	mux.HandleFunc("/v1/pull-requests", s.handlePullRequests)
	mux.HandleFunc("/v1/pull-requests/", s.handlePullRequestRoutes)
	mux.HandleFunc("/v1/runtime/registry", s.handleRuntimeRegistry)
	mux.HandleFunc("/v1/runtime/heartbeats", s.handleRuntimeHeartbeats)
	mux.HandleFunc("/v1/runtime", s.handleRuntime)
	mux.HandleFunc("/v1/runtime/pairing", s.handleRuntimePairing)
	mux.HandleFunc("/v1/runtime/selection", s.handleRuntimeSelection)
	mux.HandleFunc("/v1/repo/binding", s.handleRepoBinding)
	mux.HandleFunc("/v1/github/connection", s.handleGitHubConnection)
	mux.HandleFunc("/v1/github/installation-callback", s.handleGitHubInstallationCallback)
	mux.HandleFunc("/v1/github/webhook", s.handleGitHubWebhook)
	mux.HandleFunc("/v1/exec", s.handleExecRoute)
	for _, register := range serverRouteRegistrars {
		register(s, mux)
	}
	return withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, sanitizeLiveState(s.store.Snapshot()))
}

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.Snapshot().Workspace)
	case http.MethodPatch:
		if !s.requireSessionPermission(w, "workspace.manage") {
			return
		}
		var req WorkspaceUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		var onboarding *store.WorkspaceOnboardingSnapshot
		if req.Onboarding != nil {
			onboarding = &store.WorkspaceOnboardingSnapshot{
				Status:         req.Onboarding.Status,
				TemplateID:     req.Onboarding.TemplateID,
				CurrentStep:    req.Onboarding.CurrentStep,
				CompletedSteps: req.Onboarding.CompletedSteps,
				ResumeURL:      req.Onboarding.ResumeURL,
			}
		}
		nextState, workspace, err := s.store.UpdateWorkspaceConfig(store.WorkspaceConfigUpdateInput{
			Plan:        req.Plan,
			BrowserPush: req.BrowserPush,
			MemoryMode:  req.MemoryMode,
			Onboarding:  onboarding,
		})
		if err != nil {
			writeWorkspaceConfigError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"workspace": workspace, "state": nextState})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func writeWorkspaceConfigError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrWorkspaceOnboardingStatusInvalid),
		errors.Is(err, store.ErrWorkspaceResumeURLInvalid),
		errors.Is(err, store.ErrWorkspaceStartRouteInvalid),
		errors.Is(err, store.ErrWorkspacePreferredAgentNotFound):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

func (s *Server) handleChannels(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Channels)
}

func (s *Server) handleChannelRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/channels/")
	if strings.HasSuffix(path, "/messages") {
		channelID := strings.TrimSuffix(path, "/messages")
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
		provider := defaultString(req.Provider, "claude")
		payload, err := s.runDaemonExec(ExecRequest{
			Provider: provider,
			Prompt:   prompt,
			Cwd:      req.Cwd,
		})
		if err != nil {
			status := http.StatusBadGateway
			message := fmt.Sprintf("频道 agent 连接失败：%s", err.Error())
			var daemonErr *daemonHTTPError
			if errors.As(err, &daemonErr) && daemonErr.Status == http.StatusConflict {
				status = http.StatusConflict
				message = buildConflictRoomMessage("频道 runtime lease 冲突", err)
			}
			nextState, appendErr := s.store.AppendChannelConversation(channelID, store.ChannelConversationInput{
				Prompt:       prompt,
				ReplySpeaker: "System",
				ReplyRole:    "system",
				ReplyTone:    "blocked",
				ReplyMessage: message,
			})
			if appendErr != nil {
				if strings.Contains(strings.ToLower(appendErr.Error()), "not found") {
					status = http.StatusNotFound
				}
				writeJSON(w, status, map[string]string{"error": appendErr.Error()})
				return
			}
			response := map[string]any{"error": err.Error(), "state": nextState}
			if daemonErr != nil && daemonErr.Conflict != nil {
				response["conflict"] = daemonErr.Conflict
			}
			writeJSON(w, status, response)
			return
		}
		nextState, err := s.store.AppendChannelConversation(channelID, store.ChannelConversationInput{
			Prompt:       prompt,
			ReplySpeaker: channelReplySpeaker(provider),
			ReplyRole:    "agent",
			ReplyTone:    "agent",
			ReplyMessage: strings.TrimSpace(payload.Output),
		})
		if err != nil {
			status := http.StatusInternalServerError
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"state": nextState, "output": payload.Output})
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "channel route not found"})
}

func (s *Server) handleIssues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.Snapshot().Issues)
	case http.MethodPost:
		if !issueCreateGuard(s, w) {
			return
		}
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
			if errors.Is(err, store.ErrNoSchedulableRuntime) {
				writeJSON(w, http.StatusConflict, map[string]any{
					"error": err.Error(),
					"state": s.store.Snapshot(),
				})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		daemonURL, daemonErr := s.daemonURLForRunID(result.RunID)
		if daemonErr != nil {
			nextState, appendErr := s.store.AppendSystemRoomMessage(result.RoomID, "System", fmt.Sprintf("worktree 创建失败：%s", daemonErr.Error()), "blocked")
			if appendErr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": daemonErr.Error()})
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": daemonErr.Error(), "state": nextState, "roomId": result.RoomID})
			return
		}

		worktreePayload, ensureErr := s.ensureWorktreeLane(daemonURL, WorktreeRequest{
			WorkspaceRoot: s.workspaceRoot,
			Branch:        result.Branch,
			WorktreeName:  result.WorktreeName,
			BaseRef:       "HEAD",
			LeaseID:       defaultString(result.SessionID, result.RunID),
			RunID:         result.RunID,
			SessionID:     result.SessionID,
			RoomID:        result.RoomID,
		})
		if ensureErr != nil {
			status := http.StatusBadGateway
			message := fmt.Sprintf("worktree 创建失败：%s", ensureErr.Error())
			var daemonErr *daemonHTTPError
			if errors.As(ensureErr, &daemonErr) && daemonErr.Status == http.StatusConflict {
				status = http.StatusConflict
				message = runtimeLeaseConflictMessage(daemonErr.Conflict)
			}
			var (
				nextState store.State
				appendErr error
			)
			if daemonErr != nil && daemonErr.Conflict != nil {
				nextState, appendErr = s.store.AppendRuntimeLeaseConflict(
					result.RoomID,
					"System",
					message,
					runtimeLeaseConflictInboxTitle(daemonErr.Conflict),
					runtimeLeaseConflictNextAction(daemonErr.Conflict),
					runtimeLeaseConflictControlNote(daemonErr.Conflict),
				)
			} else {
				nextState, appendErr = s.store.AppendSystemRoomMessage(result.RoomID, "System", message, "blocked")
			}
			if appendErr != nil {
				writeJSON(w, status, map[string]string{"error": ensureErr.Error()})
				return
			}
			payload := map[string]any{"error": ensureErr.Error(), "state": nextState, "roomId": result.RoomID}
			if daemonErr != nil && daemonErr.Conflict != nil {
				payload["conflict"] = daemonErr.Conflict
			}
			writeJSON(w, status, payload)
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
		if !roomReplyGuard(s, w) {
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
			Cwd:      req.Cwd,
		}, prompt)
		return
	}

	if strings.HasSuffix(path, "/messages") {
		roomID := strings.TrimSuffix(path, "/messages")
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if !roomReplyGuard(s, w) {
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

		payload, err := s.runRoomDaemonExec(roomID, ExecRequest{
			Provider: defaultString(req.Provider, "claude"),
			Prompt:   prompt,
			Cwd:      req.Cwd,
		})
		if err != nil {
			status := http.StatusBadGateway
			message := fmt.Sprintf("CLI 连接失败：%s", err.Error())
			var daemonErr *daemonHTTPError
			if errors.As(err, &daemonErr) && daemonErr.Status == http.StatusConflict {
				status = http.StatusConflict
				message = runtimeLeaseConflictMessage(daemonErr.Conflict)
			}
			var (
				nextState store.State
				appendErr error
			)
			if daemonErr != nil && daemonErr.Conflict != nil {
				nextState, appendErr = s.store.AppendRuntimeLeaseConflict(
					roomID,
					"System",
					message,
					runtimeLeaseConflictInboxTitle(daemonErr.Conflict),
					runtimeLeaseConflictNextAction(daemonErr.Conflict),
					runtimeLeaseConflictControlNote(daemonErr.Conflict),
				)
			} else {
				nextState, appendErr = s.store.AppendSystemRoomMessage(roomID, "System", message, "blocked")
			}
			if appendErr != nil {
				writeJSON(w, status, map[string]string{"error": err.Error()})
				return
			}
			payload := map[string]any{"error": err.Error(), "state": nextState}
			if daemonErr != nil && daemonErr.Conflict != nil {
				payload["conflict"] = daemonErr.Conflict
			}
			writeJSON(w, status, payload)
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
		if !roomPullRequestGuard(s, w) {
			return
		}
		snapshot := s.store.Snapshot()
		if existing, ok := findPullRequestByRoom(snapshot, roomID); ok {
			nextState, err := s.syncStoredPullRequest(existing)
			if err != nil {
				writePullRequestFailure(w, "sync", roomID, existing.ID, err, nextState)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"pullRequestId": existing.ID, "state": nextState})
			return
		}

		room, run, issue, ok := findRoomRunIssue(snapshot, roomID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "room not found"})
			return
		}

		remotePullRequest, err := s.github.CreatePullRequest(s.workspaceRoot, githubsvc.CreatePullRequestInput{
			Repo:       snapshot.Workspace.Repo,
			BaseBranch: defaultString(snapshot.Workspace.Branch, "main"),
			HeadBranch: run.Branch,
			Title:      issue.Title,
			Body:       buildPullRequestBody(issue, room, run),
		})
		if err != nil {
			nextState, appendErr := s.store.AppendGitHubPullRequestFailure(roomID, "create", "", err.Error())
			if appendErr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			writePullRequestFailure(w, "create", roomID, "", err, nextState)
			return
		}

		nextState, pullRequestID, err := s.store.CreatePullRequestFromRemote(roomID, mapGitHubPullRequest(remotePullRequest))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
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
	path := strings.TrimPrefix(r.URL.Path, "/v1/runs/")
	if strings.HasSuffix(path, "/control") {
		runID := strings.TrimSuffix(path, "/control")
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if !runExecuteGuard(s, w) {
			return
		}
		var req RunControlRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, err := s.store.ControlRun(runID, store.RunControlInput{
			Action: req.Action,
			Note:   req.Note,
			Actor:  currentAuthActor(s.store.Snapshot().Auth.Session),
		})
		if err != nil {
			switch {
			case errors.Is(err, store.ErrRunControlRunNotFound):
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			case errors.Is(err, store.ErrRunControlUnsupportedAction), errors.Is(err, store.ErrRunControlImmutableFinalStatus):
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			default:
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			}
			return
		}
		var updatedRun *store.Run
		var updatedSession *store.Session
		for index := range nextState.Runs {
			if nextState.Runs[index].ID == runID {
				updatedRun = &nextState.Runs[index]
				break
			}
		}
		for index := range nextState.Sessions {
			if nextState.Sessions[index].ActiveRunID == runID {
				updatedSession = &nextState.Sessions[index]
				break
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"action":  strings.TrimSpace(req.Action),
			"state":   nextState,
			"run":     updatedRun,
			"session": updatedSession,
		})
		return
	}
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	runID := path
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

func (s *Server) handlePullRequests(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	snapshot := s.store.Snapshot()
	nextState, err := s.syncStoredPullRequests(snapshot.PullRequests)
	if err != nil {
		writePullRequestFailure(w, "sync", "", "", err, nextState)
		return
	}
	writeJSON(w, http.StatusOK, nextState.PullRequests)
}

func (s *Server) handlePullRequestRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/pull-requests/")
	if path == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}
	if strings.HasSuffix(path, "/detail") {
		s.handlePullRequestDetail(w, r, strings.TrimSuffix(path, "/detail"))
		return
	}
	pullRequestID := path
	if r.Method == http.MethodGet {
		snapshot := s.store.Snapshot()
		item, ok := findPullRequest(snapshot, pullRequestID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
			return
		}
		nextState, err := s.syncStoredPullRequest(item)
		if err != nil {
			writePullRequestFailure(w, "sync", item.RoomID, pullRequestID, err, nextState)
			return
		}
		synced, ok := findPullRequest(nextState, pullRequestID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
			return
		}
		writeJSON(w, http.StatusOK, synced)
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
	if !pullRequestRouteGuard(s, w, req.Status) {
		return
	}
	snapshot := s.store.Snapshot()
	item, ok := findPullRequest(snapshot, pullRequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}

	var remotePullRequest githubsvc.PullRequest
	var err error
	if req.Status == "merged" {
		remotePullRequest, err = s.github.MergePullRequest(s.workspaceRoot, githubsvc.MergePullRequestInput{
			Repo:   snapshot.Workspace.Repo,
			Number: item.Number,
		})
	} else {
		remotePullRequest, err = s.github.SyncPullRequest(s.workspaceRoot, githubsvc.SyncPullRequestInput{
			Repo:   snapshot.Workspace.Repo,
			Number: item.Number,
		})
	}
	if err != nil {
		operation := "sync"
		if req.Status == "merged" {
			operation = "merge"
		}
		nextState, appendErr := s.store.AppendGitHubPullRequestFailure(item.RoomID, operation, item.Label, err.Error())
		if appendErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writePullRequestFailure(w, operation, item.RoomID, pullRequestID, err, nextState)
		return
	}

	nextState, err := s.store.SyncPullRequestFromRemote(pullRequestID, mapGitHubPullRequest(remotePullRequest))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": nextState})
}

func (s *Server) handlePullRequestDetail(w http.ResponseWriter, r *http.Request, pullRequestID string) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	pullRequestID = strings.TrimSuffix(strings.TrimSpace(pullRequestID), "/")
	if pullRequestID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}

	snapshot := s.store.Snapshot()
	item, ok := findPullRequest(snapshot, pullRequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}

	nextState, err := s.syncStoredPullRequest(item)
	if err != nil {
		writePullRequestFailure(w, "sync", item.RoomID, pullRequestID, err, nextState)
		return
	}

	detail, ok := s.store.PullRequestDetail(pullRequestID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pull request not found"})
		return
	}
	writeJSON(w, http.StatusOK, sanitizeLivePayload(detail))
}

func (s *Server) syncStoredPullRequests(items []store.PullRequest) (store.State, error) {
	finalState := s.store.Snapshot()
	for _, item := range items {
		nextState, err := s.syncStoredPullRequest(item)
		if err != nil {
			return nextState, err
		}
		finalState = nextState
	}
	return finalState, nil
}

func (s *Server) syncStoredPullRequest(item store.PullRequest) (store.State, error) {
	snapshot := s.store.Snapshot()
	if !shouldSyncGitHubPullRequest(snapshot.Workspace, item) {
		return snapshot, nil
	}

	remotePullRequest, err := s.github.SyncPullRequest(s.workspaceRoot, githubsvc.SyncPullRequestInput{
		Repo:   snapshot.Workspace.Repo,
		Number: item.Number,
	})
	if err != nil {
		nextState, appendErr := s.store.AppendGitHubPullRequestFailure(item.RoomID, "sync", item.Label, err.Error())
		if appendErr != nil {
			return store.State{}, err
		}
		return nextState, err
	}
	return s.store.SyncPullRequestFromRemote(item.ID, mapGitHubPullRequest(remotePullRequest))
}

func writePullRequestFailure(w http.ResponseWriter, operation, roomID, pullRequestID string, err error, nextState store.State) {
	payload := map[string]any{
		"error":     err.Error(),
		"operation": operation,
		"state":     nextState,
	}
	if roomID != "" {
		payload["roomId"] = roomID
	}
	if pullRequestID != "" {
		payload["pullRequestId"] = pullRequestID
	}
	writeJSON(w, http.StatusBadGateway, payload)
}

func shouldSyncGitHubPullRequest(workspace store.WorkspaceSnapshot, item store.PullRequest) bool {
	return item.Number > 0 && strings.TrimSpace(item.Provider) == "github" && strings.TrimSpace(workspace.Repo) != ""
}

func mapGitHubPullRequest(pullRequest githubsvc.PullRequest) store.PullRequestRemoteSnapshot {
	status := "in_review"
	switch {
	case pullRequest.Merged || strings.EqualFold(pullRequest.State, "MERGED"):
		status = "merged"
	case pullRequest.IsDraft:
		status = "draft"
	case strings.EqualFold(pullRequest.ReviewDecision, "CHANGES_REQUESTED"):
		status = "changes_requested"
	case strings.EqualFold(pullRequest.State, "CLOSED"):
		status = "changes_requested"
	}

	return store.PullRequestRemoteSnapshot{
		Number:         pullRequest.Number,
		Title:          pullRequest.Title,
		Status:         status,
		Branch:         pullRequest.HeadRefName,
		BaseBranch:     pullRequest.BaseRefName,
		Author:         pullRequest.Author,
		Provider:       "github",
		URL:            pullRequest.URL,
		ReviewDecision: pullRequest.ReviewDecision,
		UpdatedAt:      pullRequest.UpdatedAt,
	}
}

func findRoomRunIssue(snapshot store.State, roomID string) (store.Room, store.Run, store.Issue, bool) {
	var room store.Room
	var run store.Run
	var issue store.Issue
	var roomFound, runFound, issueFound bool

	for _, candidate := range snapshot.Rooms {
		if candidate.ID == roomID {
			room = candidate
			roomFound = true
			break
		}
	}
	if !roomFound {
		return store.Room{}, store.Run{}, store.Issue{}, false
	}
	for _, candidate := range snapshot.Runs {
		if candidate.RoomID == roomID {
			run = candidate
			runFound = true
			break
		}
	}
	for _, candidate := range snapshot.Issues {
		if candidate.RoomID == roomID {
			issue = candidate
			issueFound = true
			break
		}
	}
	return room, run, issue, runFound && issueFound
}

func findPullRequest(snapshot store.State, pullRequestID string) (store.PullRequest, bool) {
	for _, item := range snapshot.PullRequests {
		if item.ID == pullRequestID {
			return item, true
		}
	}
	return store.PullRequest{}, false
}

func findPullRequestByRoom(snapshot store.State, roomID string) (store.PullRequest, bool) {
	for _, item := range snapshot.PullRequests {
		if item.RoomID == roomID {
			return item, true
		}
	}
	return store.PullRequest{}, false
}

func buildPullRequestBody(issue store.Issue, room store.Room, run store.Run) string {
	return strings.TrimSpace(fmt.Sprintf(
		"## %s\n\n%s\n\n- issue: %s\n- room: %s\n- run: %s\n- head: %s\n- worktree: %s",
		issue.Title,
		defaultString(issue.Summary, "等待补充摘要。"),
		issue.Key,
		room.ID,
		run.ID,
		run.Branch,
		defaultString(run.Worktree, "n/a"),
	))
}

func (s *Server) handleRuntime(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	snapshot := s.store.RuntimeSnapshot(time.Now())
	runtimeName := strings.TrimSpace(r.URL.Query().Get("machine"))
	if runtimeName == "" {
		runtimeName = snapshot.Workspace.PairedRuntime
	}
	daemonURL, err := daemonURLForRuntime(snapshot, runtimeName)
	if err != nil {
		if runtimeName == "" || runtimeName != strings.TrimSpace(snapshot.Workspace.PairedRuntime) {
			writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(runtimeName, snapshot.Workspace.LastPairedAt))
			return
		}
		daemonURL = resolveWorkspaceDaemonURL(snapshot, s.daemonURLValue())
		if strings.TrimSpace(daemonURL) == "" {
			writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(runtimeName, snapshot.Workspace.LastPairedAt))
			return
		}
	}

	runtimeSnapshot, err := s.fetchRuntimeSnapshot(daemonURL)
	if err != nil {
		if record, ok := findRuntimeRecord(snapshot, runtimeName); ok {
			writeJSON(w, http.StatusOK, runtimeSnapshotFromRecord(record))
			return
		}
		writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(runtimeName, snapshot.Workspace.LastPairedAt))
		return
	}

	if runtimeSnapshot.DaemonURL == "" {
		runtimeSnapshot.DaemonURL = daemonURL
	}
	if runtimeSnapshot.RuntimeID == "" {
		runtimeSnapshot.RuntimeID = defaultString(runtimeSnapshot.Machine, runtimeName)
	}
	if _, upsertErr := s.store.UpsertRuntimeHeartbeat(runtimeHeartbeatInputFromSnapshot(runtimeSnapshot)); upsertErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": upsertErr.Error()})
		return
	}
	writeJSON(w, http.StatusOK, runtimeSnapshot)
}

func (s *Server) handleRuntimePairing(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		snapshot := s.store.RuntimeSnapshot(time.Now())
		workspace := snapshot.Workspace
		writeJSON(w, http.StatusOK, PairingStatusResponse{
			DaemonURL:     resolveWorkspaceDaemonURL(snapshot, s.daemonURLValue()),
			PairedRuntime: workspace.PairedRuntime,
			PairingStatus: workspace.PairingStatus,
			DeviceAuth:    workspace.DeviceAuth,
			LastPairedAt:  workspace.LastPairedAt,
		})
	case http.MethodPost:
		if !runtimeManageGuard(s, w) {
			return
		}
		var req PairRuntimeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		snapshot := s.store.Snapshot()
		daemonURL := strings.TrimRight(strings.TrimSpace(req.DaemonURL), "/")
		runtimeID := strings.TrimSpace(req.RuntimeID)
		if runtimeID != "" && daemonURL == "" {
			record, ok := findRuntimeRecord(snapshot, runtimeID)
			if !ok {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "runtime not found"})
				return
			}
			daemonURL = strings.TrimRight(strings.TrimSpace(record.DaemonURL), "/")
			if daemonURL == "" {
				writeJSON(w, http.StatusConflict, map[string]string{"error": fmt.Sprintf("runtime %s is not paired to a daemon", runtimeID)})
				return
			}
		}
		if daemonURL == "" {
			daemonURL = s.daemonURLValue()
		}
		runtimeSnapshot, err := s.fetchRuntimeSnapshot(daemonURL)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		if runtimeSnapshot.DaemonURL == "" {
			runtimeSnapshot.DaemonURL = daemonURL
		}
		if runtimeSnapshot.RuntimeID == "" {
			runtimeSnapshot.RuntimeID = defaultString(runtimeID, runtimeSnapshot.Machine)
		}
		if runtimeID != "" && !runtimeSnapshotMatchesRequested(runtimeSnapshot, runtimeID) {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": fmt.Sprintf("runtime %s resolved to %s", runtimeID, defaultString(strings.TrimSpace(runtimeSnapshot.RuntimeID), runtimeSnapshot.Machine)),
			})
			return
		}
		s.setDaemonURL(runtimeSnapshot.DaemonURL)
		nextState, err := s.store.UpdateRuntimePairing(store.RuntimePairingInput{
			RuntimeID:     runtimeSnapshot.RuntimeID,
			DaemonURL:     runtimeSnapshot.DaemonURL,
			Machine:       runtimeSnapshot.Machine,
			DetectedCLI:   runtimeSnapshot.DetectedCLI,
			Providers:     runtimeSnapshot.Providers,
			Shell:         runtimeSnapshot.Shell,
			State:         runtimeSnapshot.State,
			WorkspaceRoot: runtimeSnapshot.WorkspaceRoot,
			ReportedAt:    runtimeSnapshot.ReportedAt,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"daemonUrl": runtimeSnapshot.DaemonURL,
			"runtime":   runtimeSnapshot,
			"state":     nextState,
		})
	case http.MethodDelete:
		if !runtimeManageGuard(s, w) {
			return
		}
		nextState, err := s.store.ClearRuntimePairing()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.setDaemonURL("")
		writeJSON(w, http.StatusOK, map[string]any{
			"daemonUrl": "",
			"runtime":   offlineRuntimeSnapshot("", nextState.Workspace.LastPairedAt),
			"state":     nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleRuntimeRegistry(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, runtimeRegistryResponse(s.store.RuntimeSnapshot(time.Now())))
}

func (s *Server) handleRuntimeHeartbeats(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var req RuntimeSnapshotResponse
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	if strings.TrimSpace(req.RuntimeID) == "" && strings.TrimSpace(req.Machine) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "runtimeId or machine is required"})
		return
	}

	nextState, err := s.store.UpsertRuntimeHeartbeat(runtimeHeartbeatInputFromSnapshot(req))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(nextState.Workspace.PairedRuntimeURL) != "" {
		s.setDaemonURL(nextState.Workspace.PairedRuntimeURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"runtimeId": defaultString(req.RuntimeID, req.Machine),
		"state":     nextState,
	})
}

func (s *Server) handleRuntimeSelection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, buildRuntimeSelectionResponse(s.store.RuntimeSnapshot(time.Now()), s.daemonURLValue()))
	case http.MethodPost:
		if !runtimeManageGuard(s, w) {
			return
		}
		var req SelectRuntimeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, err := s.store.SelectRuntime(req.Machine)
		if err != nil {
			status := http.StatusConflict
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]any{
				"error":     err.Error(),
				"state":     s.store.RuntimeSnapshot(time.Now()),
				"selection": buildRuntimeSelectionResponse(s.store.RuntimeSnapshot(time.Now()), s.daemonURLValue()),
			})
			return
		}
		s.setDaemonURL(nextState.Workspace.PairedRuntimeURL)
		writeJSON(w, http.StatusOK, map[string]any{
			"state":     nextState,
			"selection": buildRuntimeSelectionResponse(nextState, s.daemonURLValue()),
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
	if !runExecuteGuard(s, w) {
		return
	}
	var req ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	payload, err := s.runDaemonExec(req)
	if err != nil {
		var daemonErr *daemonHTTPError
		if errors.As(err, &daemonErr) {
			response := map[string]any{"error": daemonErr.Error()}
			if daemonErr.Conflict != nil {
				response["conflict"] = daemonErr.Conflict
			}
			writeJSON(w, daemonErr.Status, response)
			return
		}
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

	resp, err := s.streamRoomDaemonExec(r, roomID, req, func(event DaemonStreamEvent) error {
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
		message := fmt.Sprintf("CLI 连接失败：%s", err.Error())
		var daemonErr *daemonHTTPError
		if errors.As(err, &daemonErr) && daemonErr.Status == http.StatusConflict {
			message = runtimeLeaseConflictMessage(daemonErr.Conflict)
		}
		var (
			nextState store.State
			appendErr error
		)
		if daemonErr != nil && daemonErr.Conflict != nil {
			nextState, appendErr = s.store.AppendRuntimeLeaseConflict(
				roomID,
				"System",
				message,
				runtimeLeaseConflictInboxTitle(daemonErr.Conflict),
				runtimeLeaseConflictNextAction(daemonErr.Conflict),
				runtimeLeaseConflictControlNote(daemonErr.Conflict),
			)
		} else {
			nextState, appendErr = s.store.AppendSystemRoomMessage(roomID, "System", message, "blocked")
		}
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

func runtimeHeartbeatInputFromSnapshot(snapshot RuntimeSnapshotResponse) store.RuntimeHeartbeatInput {
	return store.RuntimeHeartbeatInput{
		RuntimeID:          strings.TrimSpace(snapshot.RuntimeID),
		DaemonURL:          strings.TrimRight(strings.TrimSpace(snapshot.DaemonURL), "/"),
		Machine:            strings.TrimSpace(snapshot.Machine),
		DetectedCLI:        snapshot.DetectedCLI,
		Providers:          snapshot.Providers,
		Shell:              strings.TrimSpace(snapshot.Shell),
		State:              strings.TrimSpace(snapshot.State),
		WorkspaceRoot:      strings.TrimSpace(snapshot.WorkspaceRoot),
		ReportedAt:         strings.TrimSpace(snapshot.ReportedAt),
		HeartbeatIntervalS: snapshot.HeartbeatIntervalS,
		HeartbeatTimeoutS:  snapshot.HeartbeatTimeoutS,
	}
}

func runtimeSnapshotFromRecord(record store.RuntimeRecord) RuntimeSnapshotResponse {
	return RuntimeSnapshotResponse{
		RuntimeID:          record.ID,
		DaemonURL:          record.DaemonURL,
		Machine:            record.Machine,
		DetectedCLI:        record.DetectedCLI,
		Providers:          record.Providers,
		Shell:              record.Shell,
		State:              record.State,
		WorkspaceRoot:      record.WorkspaceRoot,
		ReportedAt:         record.ReportedAt,
		HeartbeatIntervalS: record.HeartbeatIntervalS,
		HeartbeatTimeoutS:  record.HeartbeatTimeoutS,
	}
}

func findRuntimeRecord(snapshot store.State, runtimeName string) (store.RuntimeRecord, bool) {
	runtimeName = strings.TrimSpace(runtimeName)
	for _, item := range snapshot.Runtimes {
		if item.ID == runtimeName || item.Machine == runtimeName {
			return item, true
		}
	}
	return store.RuntimeRecord{}, false
}

func runtimeSnapshotMatchesRequested(snapshot RuntimeSnapshotResponse, runtimeID string) bool {
	runtimeID = strings.TrimSpace(runtimeID)
	if runtimeID == "" {
		return true
	}
	return strings.TrimSpace(snapshot.RuntimeID) == runtimeID || strings.TrimSpace(snapshot.Machine) == runtimeID
}

func buildRuntimeSelectionResponse(snapshot store.State, fallbackDaemonURL string) RuntimeSelectionResponse {
	return RuntimeSelectionResponse{
		SelectedRuntime:   snapshot.Workspace.PairedRuntime,
		SelectedDaemonURL: resolveWorkspaceDaemonURL(snapshot, fallbackDaemonURL),
		PairingStatus:     snapshot.Workspace.PairingStatus,
		Runtimes:          snapshot.Machines,
	}
}

func (s *Server) daemonURLForRoom(roomID string) (string, error) {
	snapshot := s.store.RuntimeSnapshot(time.Now())
	_, run, _, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return "", fmt.Errorf("room not found")
	}
	return daemonURLForRuntime(snapshot, run.Runtime)
}

func (s *Server) daemonURLForRunID(runID string) (string, error) {
	snapshot := s.store.RuntimeSnapshot(time.Now())
	for _, run := range snapshot.Runs {
		if run.ID == runID {
			return daemonURLForRuntime(snapshot, run.Runtime)
		}
	}
	return "", fmt.Errorf("run not found")
}

func daemonURLForRuntime(snapshot store.State, runtimeName string) (string, error) {
	runtimeName = strings.TrimSpace(runtimeName)
	if runtimeName == "" {
		if strings.TrimSpace(snapshot.Workspace.PairedRuntimeURL) == "" {
			return "", fmt.Errorf("no runtime is selected")
		}
		return strings.TrimRight(snapshot.Workspace.PairedRuntimeURL, "/"), nil
	}

	for _, machine := range snapshot.Machines {
		if !runtimeMachineMatches(machine, runtimeName) {
			continue
		}
		if runtimeStateIsUnroutable(machine.State) {
			return "", fmt.Errorf("runtime %s is offline", machine.Name)
		}
		daemonURL := strings.TrimSpace(machine.DaemonURL)
		if daemonURL == "" && runtimeMachineMatches(snapshotMachineFromWorkspace(snapshot.Workspace), runtimeName) {
			daemonURL = snapshot.Workspace.PairedRuntimeURL
		}
		if strings.TrimSpace(daemonURL) == "" {
			return "", fmt.Errorf("runtime %s is not paired to a daemon", machine.Name)
		}
		return strings.TrimRight(daemonURL, "/"), nil
	}

	if runtimeMachineMatches(snapshotMachineFromWorkspace(snapshot.Workspace), runtimeName) && strings.TrimSpace(snapshot.Workspace.PairedRuntimeURL) != "" {
		return strings.TrimRight(snapshot.Workspace.PairedRuntimeURL, "/"), nil
	}
	return "", fmt.Errorf("runtime %s not found", runtimeName)
}

func resolveWorkspaceDaemonURL(snapshot store.State, fallback string) string {
	if runtimeName := strings.TrimSpace(snapshot.Workspace.PairedRuntime); runtimeName != "" {
		if daemonURL, err := daemonURLForRuntime(snapshot, runtimeName); err == nil && strings.TrimSpace(daemonURL) != "" {
			return daemonURL
		}
	}
	if fallback = strings.TrimRight(strings.TrimSpace(fallback), "/"); fallback != "" {
		return fallback
	}
	return strings.TrimRight(strings.TrimSpace(snapshot.Workspace.PairedRuntimeURL), "/")
}

func snapshotMachineFromWorkspace(workspace store.WorkspaceSnapshot) store.Machine {
	return store.Machine{
		Name:      workspace.PairedRuntime,
		DaemonURL: workspace.PairedRuntimeURL,
		State:     workspace.PairingStatus,
	}
}

func runtimeMachineMatches(machine store.Machine, runtimeName string) bool {
	runtimeName = strings.TrimSpace(runtimeName)
	if runtimeName == "" {
		return false
	}
	return machine.Name == runtimeName || machine.ID == runtimeName
}

func runtimeStateIsUnroutable(value string) bool {
	state := strings.TrimSpace(value)
	return strings.EqualFold(state, "offline") || strings.EqualFold(state, "stale")
}

func (s *Server) currentWorkspaceDaemonURL() string {
	return resolveWorkspaceDaemonURL(s.store.RuntimeSnapshot(time.Now()), s.daemonURLValue())
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

func offlineRuntimeSnapshot(machine, reportedAt string) RuntimeSnapshotResponse {
	if strings.TrimSpace(machine) == "" {
		machine = "未配对"
	}
	return RuntimeSnapshotResponse{
		RuntimeID:     machine,
		Machine:       machine,
		DetectedCLI:   []string{},
		Providers:     nil,
		Shell:         "",
		State:         "offline",
		WorkspaceRoot: "",
		ReportedAt:    reportedAt,
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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

func channelReplySpeaker(provider string) string {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "claude":
		return "Claude Review Runner"
	case "codex":
		return "Codex Dockmaster"
	default:
		return "Shock_AI_Core"
	}
}
