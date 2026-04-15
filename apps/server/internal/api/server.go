package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type Config struct {
	DaemonURL           string
	ControlURL          string
	ActualLiveURL       string
	WorkspaceRoot       string
	GitHub              githubsvc.Client
	GitHubWebhookSecret string
}

type Server struct {
	store                  *store.Store
	httpClient             *http.Client
	defaultDaemonURL       string
	daemonURL              string
	controlURL             string
	actualLiveURL          string
	daemonMu               sync.RWMutex
	workspaceRoot          string
	github                 githubsvc.Client
	githubWebhookSecret    string
	roomAutoLoopOnce       sync.Once
	roomAutoRecoveryMu     sync.Mutex
	roomAutoInFlight       map[string]struct{}
	roomAutoLastAttempt    map[string]time.Time
	pendingTurnRecoveryMu  sync.Mutex
	pendingTurnInFlight    map[string]struct{}
	pendingTurnLastAttempt map[string]time.Time
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

type SandboxPolicyRequest struct {
	Profile         string   `json:"profile"`
	AllowedHosts    []string `json:"allowedHosts"`
	AllowedCommands []string `json:"allowedCommands"`
	AllowedTools    []string `json:"allowedTools"`
}

type RunSandboxCheckRequest struct {
	Kind     string `json:"kind"`
	Target   string `json:"target"`
	Override bool   `json:"override,omitempty"`
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

const (
	channelMessageExecTimeoutSeconds = 90
	roomMessageExecTimeoutSeconds    = 45
	roomStreamExecTimeoutSeconds     = 45
	defaultExecTimeoutSeconds        = 90
)

var roomAutoRecoveryCooldown = 30 * time.Second

const roomAutoRecoveryLoopDefaultInterval = 15 * time.Second

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

type WorkspaceGovernanceRequest struct {
	TeamTopology           []store.WorkspaceGovernanceLaneConfig `json:"teamTopology"`
	DeliveryDelegationMode string                                `json:"deliveryDelegationMode"`
}

type WorkspaceUpdateRequest struct {
	Plan        string                      `json:"plan"`
	BrowserPush string                      `json:"browserPush"`
	MemoryMode  string                      `json:"memoryMode"`
	Sandbox     *SandboxPolicyRequest       `json:"sandbox,omitempty"`
	Onboarding  *WorkspaceOnboardingRequest `json:"onboarding,omitempty"`
	Governance  *WorkspaceGovernanceRequest `json:"governance,omitempty"`
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
		controlURL:          strings.TrimRight(strings.TrimSpace(cfg.ControlURL), "/"),
		actualLiveURL:       strings.TrimRight(strings.TrimSpace(cfg.ActualLiveURL), "/"),
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
	snapshot := s.store.Snapshot()
	if authSessionHasPermission(snapshot.Auth.Session, "room.reply") || authSessionHasPermission(snapshot.Auth.Session, "run.execute") {
		s.kickRoomAutoRecovery()
		snapshot = s.store.Snapshot()
	}
	w.Header().Set("X-OpenShock-State-Sequence", strconv.Itoa(s.store.CurrentStateSequence()))
	writeJSON(w, http.StatusOK, sanitizeLiveState(snapshot))
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
		var sandbox *store.SandboxPolicy
		if req.Sandbox != nil {
			sandbox = &store.SandboxPolicy{
				Profile:         req.Sandbox.Profile,
				AllowedHosts:    req.Sandbox.AllowedHosts,
				AllowedCommands: req.Sandbox.AllowedCommands,
				AllowedTools:    req.Sandbox.AllowedTools,
			}
		}
		var governance *store.WorkspaceGovernanceConfigInput
		if req.Governance != nil {
			governance = &store.WorkspaceGovernanceConfigInput{
				TeamTopology:           append([]store.WorkspaceGovernanceLaneConfig{}, req.Governance.TeamTopology...),
				DeliveryDelegationMode: req.Governance.DeliveryDelegationMode,
			}
		}
		nextState, workspace, err := s.store.UpdateWorkspaceConfig(store.WorkspaceConfigUpdateInput{
			Plan:        req.Plan,
			BrowserPush: req.BrowserPush,
			MemoryMode:  req.MemoryMode,
			Sandbox:     sandbox,
			Onboarding:  onboarding,
			Governance:  governance,
			UpdatedBy:   currentAuthActor(s.store.Snapshot().Auth.Session),
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
		errors.Is(err, store.ErrWorkspacePreferredAgentNotFound),
		errors.Is(err, store.ErrWorkspaceGovernanceTopologyInvalid),
		errors.Is(err, store.ErrWorkspaceGovernanceDeliveryDelegationModeInvalid):
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
		snapshot := s.store.Snapshot()
		provider := resolveExecProvider(snapshot, req.Provider)
		execPrompt := buildChannelExecPrompt(snapshot, channelID, provider, prompt)
		if blocked := execProviderPreflightMessage("频道消息", snapshot, provider); blocked != "" {
			nextState, appendErr := s.store.AppendChannelConversation(channelID, store.ChannelConversationInput{
				Prompt:       prompt,
				ReplySpeaker: "System",
				ReplyRole:    "system",
				ReplyTone:    "blocked",
				ReplyMessage: blocked,
			})
			if appendErr != nil {
				writeJSON(w, http.StatusConflict, map[string]string{"error": appendErr.Error()})
				return
			}
			writeJSON(w, http.StatusConflict, map[string]any{"error": blocked, "state": nextState})
			return
		}
		payload, err := s.runDaemonExec(ExecRequest{
			Provider:       provider,
			Prompt:         execPrompt,
			Cwd:            req.Cwd,
			TimeoutSeconds: channelMessageExecTimeoutSeconds,
		})
		if err != nil {
			status := http.StatusBadGateway
			message := execFailureMessage("频道消息", err)
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
			response := map[string]any{"error": message, "state": nextState}
			if daemonErr != nil && daemonErr.Conflict != nil {
				response["conflict"] = daemonErr.Conflict
			}
			writeJSON(w, status, response)
			return
		}
		directives := parseRoomResponseDirectives(strings.TrimSpace(payload.Output))
		replyMessage := directives.DisplayOutput
		suppressReply := directives.SuppressReply || strings.TrimSpace(replyMessage) == ""
		nextState, err := s.store.AppendChannelConversation(channelID, store.ChannelConversationInput{
			Prompt:        prompt,
			ReplySpeaker:  channelReplySpeaker(provider),
			ReplyRole:     "agent",
			ReplyTone:     channelReplyTone(directives.ReplyKind),
			ReplyMessage:  replyMessage,
			SuppressReply: suppressReply,
		})
		if err != nil {
			status := http.StatusInternalServerError
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"state": nextState, "output": replyMessage})
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
		snapshot := s.store.Snapshot()
		provider := resolveRoomTurnExecProvider(snapshot, roomID, req.Provider, prompt)
		execPrompt := buildRoomExecPrompt(snapshot, roomID, provider, prompt)
		if blocked := execProviderPreflightMessage("讨论间消息", snapshot, provider); blocked != "" {
			nextState, appendErr := s.store.AppendConversationFailure(roomID, prompt, blocked)
			if appendErr != nil {
				writeJSON(w, http.StatusConflict, map[string]string{"error": blocked})
				return
			}
			writeJSON(w, http.StatusConflict, map[string]any{"error": blocked, "state": nextState})
			return
		}
		s.handleRoomMessageStream(w, r, roomID, ExecRequest{
			Provider:       provider,
			Prompt:         execPrompt,
			Cwd:            req.Cwd,
			TimeoutSeconds: roomStreamExecTimeoutSeconds,
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
		snapshot := s.store.Snapshot()
		provider := resolveRoomTurnExecProvider(snapshot, roomID, req.Provider, prompt)
		execPrompt := buildRoomExecPrompt(snapshot, roomID, provider, prompt)
		if blocked := execProviderPreflightMessage("讨论间消息", snapshot, provider); blocked != "" {
			nextState, appendErr := s.store.AppendConversationFailure(roomID, prompt, blocked)
			if appendErr != nil {
				writeJSON(w, http.StatusConflict, map[string]string{"error": blocked})
				return
			}
			writeJSON(w, http.StatusConflict, map[string]any{"error": blocked, "state": nextState})
			return
		}

		payload, err := s.runRoomDaemonExec(roomID, ExecRequest{
			Provider:       provider,
			Prompt:         execPrompt,
			Cwd:            req.Cwd,
			TimeoutSeconds: roomMessageExecTimeoutSeconds,
		})
		if err != nil {
			status := http.StatusBadGateway
			message := execFailureMessage("讨论间消息", err)
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
				nextState, appendErr = s.store.AppendConversationFailure(roomID, prompt, message)
			}
			if appendErr != nil {
				writeJSON(w, status, map[string]string{"error": message})
				return
			}
			payload := map[string]any{"error": message, "state": nextState}
			if daemonErr != nil && daemonErr.Conflict != nil {
				payload["conflict"] = daemonErr.Conflict
			}
			writeJSON(w, status, payload)
			return
		}

		directives := parseRoomResponseDirectives(strings.TrimSpace(payload.Output))
		replySpeaker := roomReplySpeaker(snapshot, roomID, prompt)
		suppressRelay := shouldSuppressRoomHandoffRelay(snapshot, roomID, directives)
		var nextState store.State
		if directives.SuppressReply || suppressRelay {
			nextState, err = s.store.AppendConversationWithoutVisibleReply(roomID, prompt, provider)
		} else if directives.ReplyKind == "clarification_request" {
			nextState, err = s.store.AppendClarificationRequest(roomID, prompt, replySpeaker, directives.DisplayOutput, provider)
		} else if directives.ReplyKind == "summary" {
			nextState, err = s.store.AppendConversationSummary(roomID, prompt, replySpeaker, directives.DisplayOutput, provider)
		} else {
			nextState, err = s.store.AppendConversationAsAgent(roomID, prompt, replySpeaker, directives.DisplayOutput, provider)
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		nextState, followupOutput := s.applyRoomResponseDirectives(nextState, nextState, roomID, replySpeaker, provider, directives)
		visibleOutput := directives.DisplayOutput
		if directives.SuppressReply {
			visibleOutput = followupOutput
		} else if suppressRelay {
			if strings.TrimSpace(directives.DisplayOutput) != "" {
				if strings.TrimSpace(followupOutput) == "" {
					if restoredState, restoreErr := s.store.AppendAgentRoomMessage(roomID, replySpeaker, directives.DisplayOutput, provider); restoreErr == nil {
						nextState = restoredState
					}
					visibleOutput = directives.DisplayOutput
				} else {
					visibleOutput = followupOutput
				}
			} else if strings.TrimSpace(followupOutput) != "" {
				visibleOutput = followupOutput
			}
		}
		nextState = s.completeRoomAutoHandoffFollowupIfNeeded(nextState, roomID, replySpeaker, directives, visibleOutput)
		writeJSON(w, http.StatusOK, map[string]any{"output": visibleOutput, "state": nextState})
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
	if path == "history" {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
		cursor, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("cursor")))
		roomID := strings.TrimSpace(r.URL.Query().Get("roomId"))
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.RunHistory(limit, cursor, roomID)))
		return
	}
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
	if strings.HasSuffix(path, "/credentials") {
		s.handleRunCredentialRoutes(w, r, strings.TrimSuffix(path, "/credentials"))
		return
	}
	if strings.HasSuffix(path, "/sandbox") {
		runID := strings.TrimSuffix(path, "/sandbox")
		switch r.Method {
		case http.MethodPatch:
			if !runExecuteGuard(s, w) {
				return
			}
			var req SandboxPolicyRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			nextState, run, err := s.store.UpdateRunSandbox(runID, store.SandboxPolicy{
				Profile:         req.Profile,
				AllowedHosts:    req.AllowedHosts,
				AllowedCommands: req.AllowedCommands,
				AllowedTools:    req.AllowedTools,
			}, currentAuthActor(s.store.Snapshot().Auth.Session))
			if err != nil {
				switch {
				case errors.Is(err, store.ErrSandboxRunNotFound):
					writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				case errors.Is(err, store.ErrSandboxProfileInvalid):
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				default:
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				}
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"state": nextState, "run": run, "sandbox": run.Sandbox})
			return
		case http.MethodPost:
			if !runExecuteGuard(s, w) {
				return
			}
			var req RunSandboxCheckRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
			session := s.store.Snapshot().Auth.Session
			if req.Override && !authSessionHasPermission(session, "workspace.manage") {
				writeJSON(w, http.StatusForbidden, map[string]any{
					"error":      "permission \"workspace.manage\" required for sandbox override",
					"permission": "workspace.manage",
					"session":    session,
					"state":      s.store.Snapshot(),
				})
				return
			}
			nextState, run, decision, err := s.store.EvaluateRunSandbox(runID, store.RunSandboxCheckInput{
				Kind:        req.Kind,
				Target:      req.Target,
				RequestedBy: currentAuthActor(session),
				Override:    req.Override,
			})
			if err != nil {
				switch {
				case errors.Is(err, store.ErrSandboxRunNotFound):
					writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				case errors.Is(err, store.ErrSandboxActionKindInvalid),
					errors.Is(err, store.ErrSandboxActionTargetRequired),
					errors.Is(err, store.ErrSandboxOverrideRequiresReview):
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				default:
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				}
				return
			}
			status := http.StatusOK
			switch decision.Status {
			case "approval_required":
				status = http.StatusAccepted
			case "denied":
				status = http.StatusConflict
			}
			writeJSON(w, status, map[string]any{"state": nextState, "run": run, "decision": decision})
			return
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
	}
	if strings.HasSuffix(path, "/detail") {
		s.handleRunDetail(w, r, strings.TrimSuffix(path, "/detail"))
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

func (s *Server) handleRunDetail(w http.ResponseWriter, r *http.Request, runID string) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	runID = strings.TrimSuffix(strings.TrimSpace(runID), "/")
	if runID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
		return
	}

	detail, ok := s.store.RunDetail(runID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
		return
	}
	writeJSON(w, http.StatusOK, sanitizeLivePayload(detail))
}

type RunCredentialBindingRequest struct {
	CredentialProfileIDs []string `json:"credentialProfileIds"`
}

func (s *Server) handleRunCredentialRoutes(w http.ResponseWriter, r *http.Request, runID string) {
	runID = strings.Trim(strings.TrimSpace(runID), "/")
	if runID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "run not found"})
		return
	}

	switch r.Method {
	case http.MethodPatch:
		if !s.requireSessionPermission(w, "run.execute") {
			return
		}
		var req RunCredentialBindingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
		nextState, run, err := s.store.UpdateRunCredentialBindings(runID, store.RunCredentialBindingInput{
			CredentialProfileIDs: req.CredentialProfileIDs,
			UpdatedBy:            currentAuthActor(s.store.Snapshot().Auth.Session),
		})
		if err != nil {
			switch {
			case errors.Is(err, store.ErrCredentialRunNotFound):
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			case errors.Is(err, store.ErrCredentialProfileBindingInvalid):
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			default:
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			}
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"run":   run,
			"state": nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
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
		Number:           pullRequest.Number,
		Title:            pullRequest.Title,
		Status:           status,
		Branch:           pullRequest.HeadRefName,
		BaseBranch:       pullRequest.BaseRefName,
		Author:           pullRequest.Author,
		Provider:         "github",
		URL:              pullRequest.URL,
		Mergeable:        pullRequest.Mergeable,
		MergeStateStatus: pullRequest.MergeStateStatus,
		ReviewDecision:   pullRequest.ReviewDecision,
		ReviewSummary:    summarizeMappedGitHubPullRequest(status, pullRequest.ReviewDecision, pullRequest.Mergeable, pullRequest.MergeStateStatus),
		UpdatedAt:        pullRequest.UpdatedAt,
	}
}

func summarizeMappedGitHubPullRequest(status, reviewDecision, mergeable, mergeStateStatus string) string {
	switch strings.TrimSpace(status) {
	case "merged":
		return "PR 已在 GitHub 合并，Issue 与讨论间进入完成状态。"
	case "changes_requested":
		return "GitHub Review 要求补充修改，等待 follow-up run。"
	case "draft":
		return "远端草稿 PR 已创建，等待进入正式评审。"
	default:
		mergeable = strings.ToUpper(strings.TrimSpace(mergeable))
		mergeStateStatus = strings.ToUpper(strings.TrimSpace(mergeStateStatus))
		reviewDecision = strings.TrimSpace(reviewDecision)

		switch {
		case mergeStateStatus == "DIRTY" || mergeable == "CONFLICTING":
			return "当前 PR 与基线分支存在冲突，需先同步最新基线后再继续评审或合并。"
		case mergeStateStatus == "BEHIND":
			return "当前 PR 已落后基线分支，需先同步最新基线后再继续合并。"
		case mergeStateStatus == "BLOCKED":
			if strings.EqualFold(reviewDecision, "APPROVED") {
				return "GitHub 评审已批准，但分支保护和必需检查仍阻塞合并。"
			}
			return "当前合并仍被分支保护和必需检查阻塞。"
		case mergeStateStatus == "HAS_HOOKS":
			return "GitHub 当前仍在等待检查和保护规则完成，暂时还不能放行合并。"
		case mergeStateStatus == "UNSTABLE":
			return "GitHub 当前合并状态仍不稳定，需等待检查收敛后再继续合并。"
		case mergeStateStatus == "UNKNOWN" || mergeable == "UNKNOWN":
			return "GitHub 正在计算当前合并条件，暂不允许直接合并。"
		}

		switch reviewDecision {
		case "APPROVED":
			return "GitHub Review 已批准，等待最终合并。"
		case "CHANGES_REQUESTED":
			return "GitHub Review 要求补充修改，等待 follow-up run。"
		default:
			return "远端 PR 已创建，等待 GitHub Review 或合并。"
		}
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
	var (
		daemonURL string
		err       error
	)
	if runtimeName == "" {
		daemonURL = resolveWorkspaceDaemonURL(snapshot, s.daemonURLValue())
		if strings.TrimSpace(daemonURL) == "" {
			writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(runtimeName, snapshot.Workspace.LastPairedAt))
			return
		}
	} else {
		daemonURL, err = daemonURLForRuntime(snapshot, runtimeName)
		if err != nil {
			if runtimeName != strings.TrimSpace(snapshot.Workspace.PairedRuntime) {
				writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(runtimeName, snapshot.Workspace.LastPairedAt))
				return
			}
			daemonURL = resolveWorkspaceDaemonURL(snapshot, s.daemonURLValue())
			if strings.TrimSpace(daemonURL) == "" {
				writeJSON(w, http.StatusOK, offlineRuntimeSnapshot(runtimeName, snapshot.Workspace.LastPairedAt))
				return
			}
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
	if strings.TrimSpace(nextState.Workspace.PairedRuntime) != "" && strings.TrimSpace(nextState.Workspace.PairedRuntimeURL) != "" {
		s.setDaemonURL(nextState.Workspace.PairedRuntimeURL)
	} else if strings.TrimSpace(req.DaemonURL) != "" {
		s.setDaemonURL(req.DaemonURL)
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
	snapshot := s.store.Snapshot()
	req.Provider = resolveExecProvider(snapshot, req.Provider)
	if blocked := execProviderPreflightMessage("执行请求", snapshot, req.Provider); blocked != "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": blocked})
		return
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = defaultExecTimeoutSeconds
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
	if strings.TrimSpace(req.RunID) != "" {
		if err := s.store.RecordCredentialUse(req.RunID, currentAuthActor(s.store.Snapshot().Auth.Session)); err != nil && !errors.Is(err, store.ErrCredentialRunNotFound) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleRoomMessageStream(w http.ResponseWriter, r *http.Request, roomID string, req ExecRequest, prompt string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}
	if _, err := s.store.MarkRoomConversationPending(roomID, prompt, req.Provider); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	var outputBuilder strings.Builder
	var stderrBuilder strings.Builder
	outputProjector := newRoomStreamPublicProjector()
	stderrProjector := newRoomStreamPublicProjector()

	resp, err := s.streamRoomDaemonExec(r, roomID, req, func(event DaemonStreamEvent) error {
		switch event.Type {
		case "start":
			event.Command = nil
		case "stdout":
			outputBuilder.WriteString(event.Delta)
			event.Delta = outputProjector.Push(event.Delta)
		case "stderr":
			stderrBuilder.WriteString(event.Delta)
			event.Delta = stderrProjector.Push(event.Delta)
		case "done":
			if strings.TrimSpace(event.Output) != "" {
				outputBuilder.Reset()
				outputBuilder.WriteString(event.Output)
			}
			event.Command = nil
			event.Output = outputProjector.Finalize(event.Output)
		}
		if (event.Type == "stdout" || event.Type == "stderr") && strings.TrimSpace(event.Delta) == "" {
			return nil
		}
		if event.Type == "done" && strings.TrimSpace(event.Output) == "" {
			return nil
		}
		return writeNDJSON(w, flusher, event)
	})
	if err != nil {
		if roomStreamInterruptedByClient(r, err) {
			preview := buildInterruptedPendingTurnPreview(outputBuilder.String())
			_, _ = s.store.MarkRoomConversationInterrupted(roomID, prompt, req.Provider, preview)
			return
		}
		message := execFailureMessage("讨论间消息", err)
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
			nextState, appendErr = s.store.AppendConversationFailure(roomID, prompt, message)
		}
		if appendErr != nil {
			_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "error", Error: message})
			return
		}
		_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "state", Error: message, State: &nextState})
		return
	}

	finalOutput := strings.TrimSpace(outputBuilder.String())
	if finalOutput == "" {
		finalOutput = strings.TrimSpace(resp.Output)
	}
	if finalOutput == "" {
		finalOutput = strings.TrimSpace(stderrBuilder.String())
	}
	directives := parseRoomResponseDirectives(finalOutput)

	var (
		nextState store.State
		appendErr error
	)
	replySpeaker := roomReplySpeaker(s.store.Snapshot(), roomID, prompt)
	suppressRelay := shouldSuppressRoomHandoffRelay(s.store.Snapshot(), roomID, directives)
	if directives.SuppressReply || suppressRelay {
		nextState, appendErr = s.store.AppendConversationWithoutVisibleReply(roomID, prompt, req.Provider)
	} else if directives.ReplyKind == "clarification_request" {
		nextState, appendErr = s.store.AppendClarificationRequest(roomID, prompt, replySpeaker, directives.DisplayOutput, req.Provider)
	} else if directives.ReplyKind == "summary" {
		nextState, appendErr = s.store.AppendConversationSummary(roomID, prompt, replySpeaker, directives.DisplayOutput, req.Provider)
	} else {
		nextState, appendErr = s.store.AppendConversationAsAgent(roomID, prompt, replySpeaker, directives.DisplayOutput, req.Provider)
	}
	if appendErr != nil {
		_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "error", Error: appendErr.Error()})
		return
	}
	nextState, followupOutput := s.applyRoomResponseDirectives(nextState, nextState, roomID, replySpeaker, req.Provider, directives)
	visibleOutput := directives.DisplayOutput
	if directives.SuppressReply {
		visibleOutput = followupOutput
	} else if suppressRelay {
		if strings.TrimSpace(directives.DisplayOutput) != "" {
			if strings.TrimSpace(followupOutput) == "" {
				if restoredState, restoreErr := s.store.AppendAgentRoomMessage(roomID, replySpeaker, directives.DisplayOutput, req.Provider); restoreErr == nil {
					nextState = restoredState
				}
				visibleOutput = directives.DisplayOutput
			} else {
				visibleOutput = followupOutput
			}
		} else if strings.TrimSpace(followupOutput) != "" {
			visibleOutput = followupOutput
		}
	}
	nextState = s.completeRoomAutoHandoffFollowupIfNeeded(nextState, roomID, replySpeaker, directives, visibleOutput)
	_ = writeNDJSON(w, flusher, DaemonStreamEvent{Type: "state", Output: visibleOutput, State: &nextState})
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

func buildRoomExecPrompt(snapshot store.State, roomID, provider, userPrompt string) string {
	room, run, issue, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return userPrompt
	}
	ownerAgent, hasOwnerAgent := findRoomOwnerAgent(snapshot, roomID)
	turnAgent, wakeupMode, hasTurnAgent := resolveRoomTurnAgent(snapshot, roomID, userPrompt)

	var builder strings.Builder
	builder.WriteString("你正在 OpenShock 的讨论间里继续当前工作线程。\n")
	builder.WriteString("请把这次消息视为同一条 room / run / worktree 的后续，不要重置上下文。\n\n")
	builder.WriteString("当前上下文：\n")
	builder.WriteString(fmt.Sprintf("- 房间：%s (%s)\n", defaultString(strings.TrimSpace(room.Title), roomID), roomID))
	builder.WriteString(fmt.Sprintf("- Topic：%s\n", defaultString(strings.TrimSpace(room.Topic.Title), defaultString(strings.TrimSpace(room.Topic.Summary), "未命名话题"))))
	builder.WriteString(fmt.Sprintf("- Issue：%s | %s | owner=%s | state=%s\n", issue.Key, issue.Title, issue.Owner, issue.State))
	builder.WriteString(fmt.Sprintf("- Run：%s | status=%s | provider=%s | branch=%s | worktree=%s\n", run.ID, run.Status, defaultString(strings.TrimSpace(run.Provider), provider), run.Branch, run.Worktree))
	if hasOwnerAgent {
		builder.WriteString(fmt.Sprintf("- 当前接手：%s | role=%s | lane=%s | provider=%s\n", ownerAgent.Name, defaultString(strings.TrimSpace(ownerAgent.Role), "未定义"), defaultString(strings.TrimSpace(ownerAgent.Lane), issue.Key), defaultString(strings.TrimSpace(ownerAgent.ProviderPreference), defaultString(strings.TrimSpace(ownerAgent.Provider), provider))))
		if text := strings.TrimSpace(ownerAgent.Prompt); text != "" {
			builder.WriteString(fmt.Sprintf("- 当前智能体要求：%s\n", compactPromptLine(text)))
		}
		if text := strings.TrimSpace(ownerAgent.OperatingInstructions); text != "" {
			builder.WriteString(fmt.Sprintf("- 执行边界：%s\n", compactPromptLine(text)))
		}
	}
	if hasTurnAgent && (!hasOwnerAgent || turnAgent.ID != ownerAgent.ID) {
		builder.WriteString(fmt.Sprintf("- 本轮响应：%s | role=%s | lane=%s | provider=%s\n", turnAgent.Name, defaultString(strings.TrimSpace(turnAgent.Role), "未定义"), defaultString(strings.TrimSpace(turnAgent.Lane), issue.Key), defaultString(strings.TrimSpace(turnAgent.ProviderPreference), defaultString(strings.TrimSpace(turnAgent.Provider), provider))))
	}
	if worktreePath := strings.TrimSpace(run.WorktreePath); worktreePath != "" {
		builder.WriteString(fmt.Sprintf("- 工作目录：%s\n", worktreePath))
	}
	if pending := findInterruptedRoomPendingTurn(snapshot, roomID, provider); pending != nil {
		builder.WriteString("\n恢复提醒：\n")
		builder.WriteString("- 上一次流式执行在公开连接断开后中断；先从同一条 continuity 接着往下做，不要把它当成新线程。\n")
		if preview := strings.TrimSpace(pending.Preview); preview != "" {
			builder.WriteString(fmt.Sprintf("- 中断前最后一段公开可见输出：%s\n", compactPromptLine(preview)))
		}
	}
	if handoffHint := buildRoomAutoHandoffContinuationHint(snapshot, roomID, turnAgent, ownerAgent, hasTurnAgent, hasOwnerAgent); handoffHint != "" {
		builder.WriteString("\n接棒提醒：\n")
		builder.WriteString(handoffHint)
	}

	if recent := buildRoomPromptHistory(snapshot.RoomMessages[roomID], 6); recent != "" {
		builder.WriteString("\n最近对话：\n")
		builder.WriteString(recent)
	}
	if hint := buildRoomWakeupHint(snapshot, roomID, wakeupMode, turnAgent, ownerAgent); hint != "" {
		builder.WriteString("\n当前触发提醒：\n")
		builder.WriteString(hint)
	}

	builder.WriteString("\n本轮用户消息：\n")
	builder.WriteString(strings.TrimSpace(userPrompt))
	builder.WriteString("\n\n读取边界：\n")
	builder.WriteString("- 默认只围当前 room / run / worktree 和当前接手智能体的记忆继续推进。\n")
	builder.WriteString("- 如果需要补上下文，先看当前工作目录里的 MEMORY.md、notes/work-log.md 和当前 room 对应笔记，再决定是否继续扩展。\n")
	builder.WriteString("- 不要主动去翻别的 room、别的 issue、别的 worktree，或其他智能体的记忆空间。\n")
	builder.WriteString("- 只有用户明确要求，或当前回合必须排查系统级问题时，才扩大读取范围；扩大后必须在公开回复里同步原因。\n")
	builder.WriteString("\n\n回复要求：\n")
	builder.WriteString("- 先在内部判断这条消息是否需要公开回复、是否需要你接手，再决定输出。\n")
	builder.WriteString("- 公开消息只能通过 SEND_PUBLIC_MESSAGE 这个封装返回；不要把正文裸写出来。\n")
	builder.WriteString("- 先判断这条消息是否真的需要一个可见回复。\n")
	builder.WriteString("- 默认控制在 1 到 3 句；先直接回答，再补下一步。\n")
	builder.WriteString("- 如果只是内部继续执行，不要为了刷存在感发公开消息；优先 KIND: no_response。\n")
	builder.WriteString("- 除非用户明确要求，不要长篇分点，不要复述系统背景。\n")
	builder.WriteString("- 如果要回复，第一句必须像团队成员在聊天里说话，不要写成报告。\n")
	builder.WriteString("- 如果本轮要接手、推进或同步结果，在第一句自然说清楚，不要写内部思考过程。\n")
	builder.WriteString("- 如果只是被点名答一句，不要顺手写成长段接手宣言。\n")
	builder.WriteString("- 默认沿用当前 room、run、branch 和 worktree 推进。\n")
	builder.WriteString("- 默认只在当前 room、当前 run、当前 worktree 和你自己的职责范围内判断与行动。\n")
	builder.WriteString("- 不要主动扩散去翻其他 room、其他 agent 或其他工作空间；只有用户明确要求，或必须排查系统级问题且会在公开回复里说明原因时，才扩大范围。\n")
	builder.WriteString("- 如果只是拿到了稳定上下文，但不需要改变房间里的共享认知，优先静默继续推进，不要为了说明自己看过而发消息。\n")
	if hasTurnAgent {
		builder.WriteString(fmt.Sprintf("- 本轮请以 %s 的身份回应，不要替多个智能体同时发言。\n", turnAgent.Name))
	} else if hasOwnerAgent {
		builder.WriteString(fmt.Sprintf("- 以 %s 的身份继续当前房间，不要替多个智能体同时发言。\n", ownerAgent.Name))
	}
	builder.WriteString("- 不要输出心理活动、系统旁白或自我解释。\n")
	builder.WriteString("- 标准格式如下：\n")
	builder.WriteString("  SEND_PUBLIC_MESSAGE\n")
	builder.WriteString("  KIND: message | summary | clarification_request | handoff | no_response\n")
	builder.WriteString("  CLAIM: keep | take\n")
	builder.WriteString("  BODY:\n")
	builder.WriteString("  <只放准备公开发到房间的正文>\n")
	builder.WriteString("- 如果这轮其实不需要你可见回复，就返回 SEND_PUBLIC_MESSAGE，KIND: no_response，BODY 留空。\n")
	builder.WriteString("- 如果你要回复，就返回 SEND_PUBLIC_MESSAGE，KIND: message，然后在 BODY 写自然中文；系统只会展示 BODY。\n")
	builder.WriteString("- 如果你只缺一个继续推进所必需的信息，就返回 KIND: clarification_request，然后在 BODY 里只问那一个问题。\n")
	builder.WriteString("- 如果你只是做简短收尾或状态同步，就返回 KIND: summary；只写 1 到 2 句必要同步，不要重复房间背景。\n")
	builder.WriteString("- 只有你准备继续承担这条房间后续工作时，才把 CLAIM 设为 take；只是被点名答一句时保持 CLAIM: keep。\n")
	builder.WriteString("- 如果信息不足，只问最小必要的澄清问题；否则直接推进。\n")
	builder.WriteString("- 不要把打算做的事说成已经做完。\n")
	if handoffCatalog := buildRoomHandoffCatalog(snapshot, roomID); handoffCatalog != "" {
		builder.WriteString("- 如果要把当前线程交给别人继续，也可以返回 KIND: handoff，然后在 BODY 里用 @agent_id 点名接手人；系统会自动把它记成正式交接。\n")
		builder.WriteString("- handoff 正文只写一句短交棒，不要把上下文再讲一遍。\n")
		builder.WriteString("- 如果这轮应该交给别的智能体继续，在正文最后单独追加一行：OPENSHOCK_HANDOFF: <agent_id> | <title> | <summary>\n")
		builder.WriteString("- 可交棒对象：\n")
		builder.WriteString(handoffCatalog)
	}
	if normalizeProviderID(provider) == "codex" {
		builder.WriteString("- 如果需要改代码或执行命令，默认围绕当前工作目录继续进行。\n")
	}
	return builder.String()
}

func buildChannelExecPrompt(snapshot store.State, channelID, provider, userPrompt string) string {
	channelName := channelID
	for _, channel := range snapshot.Channels {
		if channel.ID == channelID {
			channelName = defaultString(strings.TrimSpace(channel.Name), channelID)
			break
		}
	}

	var builder strings.Builder
	builder.WriteString("你正在 OpenShock 的频道里发一条公开消息。\n")
	builder.WriteString("频道只展示对团队当前会话有价值的有效信息，不展示你的内部执行过程。\n\n")
	builder.WriteString("当前上下文：\n")
	builder.WriteString(fmt.Sprintf("- 频道：%s (%s)\n", channelName, channelID))
	builder.WriteString(fmt.Sprintf("- Provider：%s\n", defaultString(strings.TrimSpace(provider), "未指定")))
	if recent := buildRoomPromptHistory(snapshot.ChannelMessages[channelID], 6); recent != "" {
		builder.WriteString("\n最近频道消息：\n")
		builder.WriteString(recent)
	}

	builder.WriteString("\n本轮用户消息：\n")
	builder.WriteString(strings.TrimSpace(userPrompt))
	builder.WriteString("\n\n读取边界：\n")
	builder.WriteString("- 频道回复默认只基于当前频道会话和这次触发消息判断，不主动扩展到别的 room、别的 issue 或别的智能体上下文。\n")
	builder.WriteString("- 如果没有新增判断、结论、唯一阻塞问题或下一步动作，就不要为了刷存在感发公屏消息。\n")
	builder.WriteString("\n\n回复要求：\n")
	builder.WriteString("- 先判断这条消息是否真的需要公屏可见回复。\n")
	builder.WriteString("- 只有会话里对别人有用的当前判断、简短结论、唯一阻塞问题，才值得发到公屏。\n")
	builder.WriteString("- 默认只基于当前频道上下文和这次触发消息判断，不要为了凑回复去扩散查其他频道、讨论间或智能体上下文。\n")
	builder.WriteString("- 只有用户明确要求，或你必须在公开消息里同步跨范围核对结果时，才扩大判断范围。\n")
	builder.WriteString("- 不要公开暴露工具调用、命令、函数参数、内部协议、思考过程、旁白或自我解释。\n")
	builder.WriteString("- 默认控制在 1 到 3 句；先说结论，再补下一步。\n")
	builder.WriteString("- 如果只是内部继续执行，不要为了刷存在感发消息；优先 KIND: no_response。\n")
	builder.WriteString("- 标准格式如下：\n")
	builder.WriteString("  SEND_PUBLIC_MESSAGE\n")
	builder.WriteString("  KIND: message | summary | clarification_request | no_response\n")
	builder.WriteString("  BODY:\n")
	builder.WriteString("  <只放准备公开发到频道的正文>\n")
	builder.WriteString("- 如果要回复，就只在 BODY 放最终准备公开展示的那几句自然中文。\n")
	builder.WriteString("- 如果这轮不需要公屏回复，就返回 SEND_PUBLIC_MESSAGE，KIND: no_response，BODY 留空。\n")
	builder.WriteString("- 如果你只缺一个继续推进所必需的信息，就返回 KIND: clarification_request，然后只问那一个问题。\n")
	builder.WriteString("- 如果你只是同步阶段结论，就返回 KIND: summary。\n")
	return builder.String()
}

func buildRoomWakeupHint(snapshot store.State, roomID, wakeupMode string, turnAgent, ownerAgent store.Agent) string {
	switch strings.TrimSpace(wakeupMode) {
	case "mention_response":
		name := strings.TrimSpace(turnAgent.Name)
		if name == "" {
			name = defaultString(strings.TrimSpace(ownerAgent.Name), "当前智能体")
		}
		return fmt.Sprintf("- 这条消息明确点名了 %s，默认由他直接回应。\n- 被点名不等于自动接手；只有准备继续负责后续工作时，才显式 CLAIM: take。\n- 如果只是被点名答一句，不要顺手写成长段接手宣言。", name)
	case "clarification_followup":
		if _, ok := findOpenRoomClarificationWaitByAgent(snapshot, roomID, turnAgent.ID); ok {
			return "- 你上一轮刚提出过阻塞性澄清，先判断这条新消息是否已经补齐关键信息。\n- 如果阻塞已解除，不要重复原问题，直接继续推进。"
		}
		messages := snapshot.RoomMessages[roomID]
		if len(messages) == 0 {
			return ""
		}
		last := messages[len(messages)-1]
		if last.Role != "agent" || last.Tone != "blocked" {
			return ""
		}
		turnName := strings.TrimSpace(turnAgent.Name)
		if turnName != "" && !strings.EqualFold(strings.TrimSpace(last.Speaker), turnName) {
			return ""
		}
		return "- 你上一轮刚提出过阻塞性澄清，先判断这条新消息是否已经补齐关键信息。\n- 如果阻塞已解除，不要重复原问题，直接继续推进。"
	default:
		return ""
	}
}

func buildRoomAutoHandoffContinuationHint(snapshot store.State, roomID string, turnAgent, ownerAgent store.Agent, hasTurnAgent, hasOwnerAgent bool) string {
	if !hasOwnerAgent {
		return ""
	}
	if hasTurnAgent && turnAgent.ID != "" && turnAgent.ID != ownerAgent.ID {
		return ""
	}
	handoff := findLatestRoomAutoHandoffContinuation(snapshot, roomID, ownerAgent)
	if handoff == nil || handoff.AutoFollowup == nil {
		return ""
	}

	summary := compactPromptLine(strings.TrimSpace(handoff.AutoFollowup.Summary))
	switch strings.TrimSpace(handoff.AutoFollowup.Status) {
	case "pending":
		return "- 你上一轮已正式接棒当前房间，但自动继续还没完成；这轮默认沿上次交棒继续，不要重讲背景或再把同一棒转交出去。\n- 默认直接沿当前 room / run / worktree 继续，不要重复“我已接手”这类铺垫。"
	case "blocked":
		if summary != "" {
			return fmt.Sprintf("- 你上一轮已正式接棒当前房间，但自动继续时被阻塞：%s。\n- 这轮默认沿同一条 room / run / worktree 接着收口，不要重讲背景或再次转交同一棒。", summary)
		}
		return "- 你上一轮已正式接棒当前房间，但自动继续时被阻塞；这轮默认沿同一条 room / run / worktree 接着收口，不要重讲背景或再次转交同一棒。"
	default:
		return ""
	}
}

func findLatestRoomAutoHandoffContinuation(snapshot store.State, roomID string, ownerAgent store.Agent) *store.AgentHandoff {
	for index := range snapshot.Mailbox {
		handoff := &snapshot.Mailbox[index]
		if handoff.RoomID != roomID || handoff.Kind != "room-auto" || handoff.AutoFollowup == nil {
			continue
		}
		if handoff.ToAgentID != ownerAgent.ID && !strings.EqualFold(strings.TrimSpace(handoff.ToAgent), strings.TrimSpace(ownerAgent.Name)) {
			continue
		}
		switch strings.TrimSpace(handoff.AutoFollowup.Status) {
		case "pending", "blocked":
			return handoff
		}
	}
	return nil
}

func findInterruptedRoomPendingTurn(snapshot store.State, roomID, provider string) *store.SessionPendingTurn {
	session, ok := findRoomConversationSession(snapshot, roomID, "")
	if !ok || !sessionHasResumeEligiblePendingTurn(session, provider) {
		return nil
	}
	return session.PendingTurn
}

func buildRoomHandoffCatalog(snapshot store.State, roomID string) string {
	_, run, issue, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return ""
	}
	currentOwner := defaultString(strings.TrimSpace(run.Owner), strings.TrimSpace(issue.Owner))

	var builder strings.Builder
	for _, agent := range snapshot.Agents {
		if strings.TrimSpace(agent.ID) == "" {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(agent.ID), currentOwner) || strings.EqualFold(strings.TrimSpace(agent.Name), currentOwner) {
			continue
		}
		builder.WriteString(fmt.Sprintf("  - %s | %s | %s | lane=%s\n", agent.ID, agent.Name, agent.Role, agent.Lane))
	}
	return builder.String()
}

func findRoomOwnerAgent(snapshot store.State, roomID string) (store.Agent, bool) {
	room, run, issue, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return store.Agent{}, false
	}
	for _, owner := range []string{
		strings.TrimSpace(run.Owner),
		strings.TrimSpace(issue.Owner),
		strings.TrimSpace(room.Topic.Owner),
	} {
		if owner == "" {
			continue
		}
		for _, agent := range snapshot.Agents {
			if agent.ID == owner || strings.EqualFold(strings.TrimSpace(agent.Name), owner) {
				return agent, true
			}
		}
	}
	if strings.TrimSpace(run.ID) != "" {
		for _, agent := range snapshot.Agents {
			for _, runID := range agent.RecentRunIDs {
				if runID == run.ID {
					return agent, true
				}
			}
		}
	}
	return store.Agent{}, false
}

func buildRoomPromptHistory(messages []store.Message, limit int) string {
	if len(messages) == 0 || limit <= 0 {
		return ""
	}
	start := len(messages) - limit
	if start < 0 {
		start = 0
	}
	var builder strings.Builder
	for _, message := range messages[start:] {
		speaker := defaultString(strings.TrimSpace(message.Speaker), defaultString(strings.TrimSpace(message.Role), "unknown"))
		builder.WriteString(fmt.Sprintf("- %s[%s]: %s\n", speaker, message.Role, compactPromptLine(message.Message)))
	}
	return builder.String()
}

func compactPromptLine(text string) string {
	line := strings.TrimSpace(strings.NewReplacer("\n", " / ", "\r", " ", "\t", " ").Replace(text))
	if len(line) <= 220 {
		return line
	}
	return strings.TrimSpace(line[:217]) + "..."
}

type roomResponseDirectives struct {
	DisplayOutput string
	Handoff       *roomHandoffDirective
	ClaimMode     string
	ReplyKind     string
	SuppressReply bool
}

type roomHandoffDirective struct {
	ToAgentID string
	Title     string
	Summary   string
}

func parseRoomResponseDirectives(output string) roomResponseDirectives {
	replyKind, body, claimMode, hasEnvelope := parseRoomReplyEnvelope(output)
	if hasEnvelope {
		output = body
	}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	filtered := make([]string, 0, len(lines))
	var handoff *roomHandoffDirective

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			filtered = append(filtered, line)
			continue
		}
		if directive, ok := parseRoomHandoffDirective(trimmed); ok {
			handoff = &directive
			continue
		}
		filtered = append(filtered, line)
	}

	return roomResponseDirectives{
		DisplayOutput: compactPublicReplyBody(replyKind, sanitizePublicReplyBody(strings.Join(filtered, "\n"))),
		Handoff:       handoff,
		ClaimMode:     claimMode,
		ReplyKind:     replyKind,
		SuppressReply: replyKind == "no_response",
	}
}

func compactPublicReplyBody(replyKind, output string) string {
	output = stripLowSignalOwnershipLead(strings.TrimSpace(output))
	if output == "" {
		return ""
	}

	switch replyKind {
	case "handoff", "clarification_request":
		return limitPublicReplySentences(output, 1)
	case "summary":
		return limitPublicReplySentences(output, 2)
	default:
		return limitPublicReplySentences(output, 3)
	}
}

func stripLowSignalOwnershipLead(output string) string {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return ""
	}

	for _, prefix := range []string{
		"我已接手，",
		"我已接手：",
		"我来接这条复核，",
		"我来接这条，",
		"我来接这条 lane，",
		"我来接这条任务，",
		"我来接这条工作，",
		"我来继续这条复核，",
		"我来继续这条 lane，",
	} {
		if strings.HasPrefix(trimmed, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, prefix))
		}
	}
	return trimmed
}

func limitPublicReplySentences(output string, maxSentences int) string {
	if maxSentences <= 0 {
		return ""
	}

	sentences := splitPublicReplySentences(output)
	if len(sentences) == 0 {
		return ""
	}
	if len(sentences) > maxSentences {
		sentences = sentences[:maxSentences]
	}
	return strings.TrimSpace(strings.Join(sentences, ""))
}

func splitPublicReplySentences(output string) []string {
	text := strings.TrimSpace(strings.ReplaceAll(output, "\r\n", "\n"))
	if text == "" {
		return nil
	}

	sentences := []string{}
	var builder strings.Builder
	flush := func(force bool) {
		current := strings.TrimSpace(builder.String())
		if current == "" {
			builder.Reset()
			return
		}
		if force || current != "" {
			sentences = append(sentences, current)
		}
		builder.Reset()
	}

	for _, r := range text {
		switch r {
		case '\n':
			flush(true)
		default:
			builder.WriteRune(r)
			switch r {
			case '。', '！', '？', '!', '?', '；', ';':
				flush(true)
			}
		}
	}
	flush(true)
	return sentences
}

func sanitizePublicReplyBody(output string) string {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(output), "\r\n", "\n"), "\n")
	filtered := make([]string, 0, len(lines))
	skipStructuredBlock := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if skipStructuredBlock {
				skipStructuredBlock = false
			}
			if len(filtered) > 0 && filtered[len(filtered)-1] != "" {
				filtered = append(filtered, "")
			}
			continue
		}

		if shouldStartInternalPublicReplyBlock(trimmed) {
			skipStructuredBlock = true
			continue
		}
		if skipStructuredBlock && looksLikeInternalPublicReplyLine(trimmed) {
			continue
		}
		skipStructuredBlock = false

		if isPublicReplyProtocolLine(trimmed) || looksLikeInternalPublicReplyLine(trimmed) {
			continue
		}
		filtered = append(filtered, trimmed)
	}

	return strings.TrimSpace(strings.Join(filtered, "\n"))
}

func shouldStartInternalPublicReplyBlock(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	switch {
	case strings.HasPrefix(lower, "工具调用"),
		strings.HasPrefix(lower, "调用工具"),
		strings.HasPrefix(lower, "tool call"),
		strings.HasPrefix(lower, "tool result"),
		strings.HasPrefix(lower, "function call"),
		strings.HasPrefix(lower, "function result"),
		strings.HasPrefix(lower, "arguments:"),
		strings.HasPrefix(lower, "参数:"),
		strings.HasPrefix(lower, "结果："),
		strings.HasPrefix(lower, "结果:"),
		strings.HasPrefix(lower, "observation:"),
		strings.HasPrefix(lower, "analysis:"),
		strings.HasPrefix(lower, "reasoning:"),
		strings.HasPrefix(lower, "thinking:"),
		strings.HasPrefix(lower, "思考："),
		strings.HasPrefix(lower, "思考:"),
		strings.HasPrefix(lower, "心理活动"),
		strings.HasPrefix(lower, "内心"),
		strings.HasPrefix(lower, "推理："),
		strings.HasPrefix(lower, "推理:"):
		return true
	default:
		return false
	}
}

func isPublicReplyProtocolLine(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	switch {
	case strings.EqualFold(line, "SEND_PUBLIC_MESSAGE"),
		strings.HasPrefix(lower, "kind:"),
		strings.HasPrefix(lower, "claim:"),
		strings.HasPrefix(lower, "body:"),
		strings.HasPrefix(strings.TrimSpace(line), "OPENSHOCK_HANDOFF:"):
		return true
	default:
		return false
	}
}

func looksLikeInternalPublicReplyLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	lower := strings.ToLower(trimmed)

	switch {
	case strings.HasPrefix(lower, "tool:"),
		strings.HasPrefix(lower, "tool call"),
		strings.HasPrefix(lower, "tool result"),
		strings.HasPrefix(lower, "function:"),
		strings.HasPrefix(lower, "function call"),
		strings.HasPrefix(lower, "function result"),
		strings.HasPrefix(lower, "arguments:"),
		strings.HasPrefix(lower, "result:"),
		strings.HasPrefix(lower, "stdout:"),
		strings.HasPrefix(lower, "stderr:"),
		strings.HasPrefix(lower, "exit code"),
		strings.HasPrefix(lower, "command:"),
		strings.HasPrefix(lower, "$ "),
		strings.HasPrefix(lower, "> "),
		strings.HasPrefix(lower, "git "),
		strings.HasPrefix(lower, "pnpm "),
		strings.HasPrefix(lower, "npm "),
		strings.HasPrefix(lower, "node "),
		strings.HasPrefix(lower, "go "),
		strings.HasPrefix(lower, "python "),
		strings.HasPrefix(lower, "bash "),
		strings.HasPrefix(lower, "curl "),
		strings.HasPrefix(lower, "claude "),
		strings.HasPrefix(lower, "codex "),
		strings.HasPrefix(lower, "```"),
		strings.HasPrefix(trimmed, "{"),
		strings.HasPrefix(trimmed, "["),
		strings.HasPrefix(trimmed, "<tool"),
		strings.HasPrefix(trimmed, "</tool"),
		strings.HasPrefix(trimmed, "<function"),
		strings.HasPrefix(trimmed, "</function"),
		strings.Contains(lower, "\"tool\""),
		strings.Contains(lower, "\"arguments\""),
		strings.Contains(lower, "\"command\""),
		strings.Contains(lower, "openai tool"),
		strings.Contains(lower, "tool_calls"),
		strings.Contains(lower, "function_call"),
		strings.Contains(lower, "心理活动"),
		strings.Contains(lower, "内心独白"),
		strings.Contains(lower, "chain-of-thought"),
		strings.Contains(lower, "chain of thought"):
		return true
	default:
		return false
	}
}

type roomStreamPublicProjector struct {
	raw     strings.Builder
	emitted string
}

func newRoomStreamPublicProjector() *roomStreamPublicProjector {
	return &roomStreamPublicProjector{}
}

func (p *roomStreamPublicProjector) Push(delta string) string {
	if p == nil || strings.TrimSpace(delta) == "" {
		return ""
	}
	p.raw.WriteString(delta)
	visible := sanitizeStreamingPublicReplyPreview(p.raw.String())
	if visible == "" {
		return ""
	}
	if !strings.HasPrefix(visible, p.emitted) {
		return ""
	}
	next := visible[len(p.emitted):]
	p.emitted = visible
	return next
}

func (p *roomStreamPublicProjector) Finalize(output string) string {
	if p == nil {
		return ""
	}
	if strings.TrimSpace(output) != "" {
		p.raw.Reset()
		p.raw.WriteString(output)
	}
	visible := strings.TrimSpace(parseRoomResponseDirectives(p.raw.String()).DisplayOutput)
	p.emitted = visible
	return visible
}

func sanitizeStreamingPublicReplyPreview(output string) string {
	normalized := strings.ReplaceAll(output, "\r\n", "\n")
	if strings.TrimSpace(normalized) == "" {
		return ""
	}

	lines := strings.Split(normalized, "\n")
	completeCount := len(lines)
	trailing := ""
	if !strings.HasSuffix(normalized, "\n") {
		completeCount -= 1
		if completeCount < 0 {
			completeCount = 0
		}
		trailing = lines[len(lines)-1]
	}

	filtered := make([]string, 0, len(lines))
	skipStructuredBlock := false

	processLine := func(trimmed string) {
		if trimmed == "" {
			if skipStructuredBlock {
				skipStructuredBlock = false
			}
			if len(filtered) > 0 && filtered[len(filtered)-1] != "" {
				filtered = append(filtered, "")
			}
			return
		}
		if shouldStartInternalPublicReplyBlock(trimmed) {
			skipStructuredBlock = true
			return
		}
		if skipStructuredBlock && looksLikeInternalPublicReplyLine(trimmed) {
			return
		}
		skipStructuredBlock = false
		if isPublicReplyProtocolLine(trimmed) || looksLikeInternalPublicReplyLine(trimmed) {
			return
		}
		filtered = append(filtered, trimmed)
	}

	for index := 0; index < completeCount; index += 1 {
		processLine(strings.TrimSpace(lines[index]))
	}

	trimmedTrailing := strings.TrimSpace(trailing)
	if trimmedTrailing != "" {
		switch {
		case shouldStartInternalPublicReplyBlock(trimmedTrailing):
		case looksLikePotentialInternalPublicReplyPrefix(trimmedTrailing):
		case skipStructuredBlock && (looksLikeInternalPublicReplyLine(trimmedTrailing) || looksLikePotentialInternalPublicReplyPrefix(trimmedTrailing)):
		case isPublicReplyProtocolLine(trimmedTrailing):
		case looksLikePotentialPublicReplyProtocolPrefix(trimmedTrailing):
		default:
			filtered = append(filtered, trimmedTrailing)
		}
	}

	return strings.TrimSpace(strings.Join(filtered, "\n"))
}

func looksLikePotentialPublicReplyProtocolPrefix(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	for _, candidate := range []string{
		"send_public_message",
		"kind:",
		"claim:",
		"body:",
		"openshock_handoff:",
	} {
		if matchesPartialInternalPrefix(lower, candidate) {
			return true
		}
	}
	return false
}

func looksLikePotentialInternalPublicReplyPrefix(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	for _, candidate := range []string{
		"工具调用",
		"调用工具",
		"tool:",
		"tool call",
		"tool result",
		"function:",
		"function call",
		"function result",
		"arguments:",
		"结果：",
		"结果:",
		"result:",
		"stdout:",
		"stderr:",
		"exit code",
		"command:",
		"$ ",
		"> ",
		"git ",
		"pnpm ",
		"npm ",
		"node ",
		"go ",
		"python ",
		"bash ",
		"curl ",
		"claude ",
		"codex ",
		"observation:",
		"analysis:",
		"reasoning:",
		"thinking:",
		"思考",
		"心理活动",
		"内心",
		"推理",
		"```",
		"{",
		"[",
		"<tool",
		"</tool",
		"<function",
		"</function",
	} {
		if matchesPartialInternalPrefix(lower, candidate) {
			return true
		}
	}
	return false
}

func matchesPartialInternalPrefix(line, candidate string) bool {
	if line == "" || candidate == "" {
		return false
	}
	if strings.HasPrefix(line, candidate) {
		return true
	}
	if !strings.HasPrefix(candidate, line) {
		return false
	}
	lineRunes := utf8.RuneCountInString(line)
	candidateRunes := utf8.RuneCountInString(candidate)
	minRunes := 3
	if strings.IndexFunc(candidate, func(r rune) bool { return r > 127 }) != -1 {
		minRunes = 2
	}
	if candidateRunes < minRunes {
		minRunes = candidateRunes
	}
	return lineRunes >= minRunes
}

func shouldSuppressRoomHandoffRelay(snapshot store.State, roomID string, directives roomResponseDirectives) bool {
	if directives.ReplyKind != "handoff" {
		return false
	}
	body := strings.TrimSpace(directives.DisplayOutput)
	if body == "" {
		return true
	}
	if !strings.HasPrefix(body, "@") {
		return false
	}
	if directives.Handoff != nil {
		return true
	}
	_, ok := inferRoomHandoffDirective(snapshot, roomID, body)
	return ok
}

func roomStreamInterruptedByClient(r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	if r != nil && r.Context().Err() != nil {
		return true
	}
	return errors.Is(err, context.Canceled)
}

func buildInterruptedPendingTurnPreview(output string) string {
	preview := strings.TrimSpace(sanitizePublicReplyBody(output))
	if preview == "" {
		return ""
	}
	if len(preview) <= 360 {
		return preview
	}
	return strings.TrimSpace(preview[:357]) + "..."
}

func parseRoomReplyEnvelope(output string) (string, string, string, bool) {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(output), "\r\n", "\n"), "\n")
	if len(lines) == 0 {
		return "", "", "", false
	}

	start := 0
	first := strings.TrimSpace(lines[0])
	if strings.EqualFold(first, "SEND_PUBLIC_MESSAGE") {
		start = 1
	} else if !strings.HasPrefix(strings.ToLower(first), "kind:") {
		return "", output, "", false
	}

	kind := ""
	claim := ""
	bodyLineIndex := -1
	bodyHead := ""

	for index := start; index < len(lines); index += 1 {
		line := strings.TrimSpace(lines[index])
		switch {
		case strings.HasPrefix(strings.ToLower(line), "kind:"):
			kind = normalizeRoomReplyKind(strings.TrimSpace(line[len("KIND:"):]))
		case strings.HasPrefix(strings.ToLower(line), "claim:"):
			claim = normalizeRoomClaimMode(strings.TrimSpace(line[len("CLAIM:"):]))
		case strings.HasPrefix(strings.ToLower(line), "body:"):
			bodyLineIndex = index
			bodyHead = strings.TrimSpace(line[len("BODY:"):])
			index = len(lines)
		}
	}
	if kind == "" || bodyLineIndex == -1 {
		return "", output, "", false
	}
	bodyLines := make([]string, 0, len(lines)-bodyLineIndex)
	if bodyHead != "" {
		bodyLines = append(bodyLines, bodyHead)
	}
	bodyLines = append(bodyLines, lines[bodyLineIndex+1:]...)
	return kind, strings.TrimSpace(strings.Join(bodyLines, "\n")), claim, true
}

func normalizeRoomReplyKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "message", "clarification_request", "handoff", "summary", "no_response":
		return strings.ToLower(strings.TrimSpace(kind))
	default:
		return ""
	}
}

func normalizeRoomClaimMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "keep":
		return "keep"
	case "take":
		return "take"
	default:
		return ""
	}
}

func parseRoomHandoffDirective(line string) (roomHandoffDirective, bool) {
	const prefix = "OPENSHOCK_HANDOFF:"
	if !strings.HasPrefix(strings.TrimSpace(line), prefix) {
		return roomHandoffDirective{}, false
	}
	parts := strings.Split(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), prefix)), "|")
	if len(parts) != 3 {
		return roomHandoffDirective{}, false
	}
	directive := roomHandoffDirective{
		ToAgentID: strings.TrimSpace(parts[0]),
		Title:     strings.TrimSpace(parts[1]),
		Summary:   strings.TrimSpace(parts[2]),
	}
	if directive.ToAgentID == "" || directive.Title == "" || directive.Summary == "" {
		return roomHandoffDirective{}, false
	}
	return directive, true
}

func (s *Server) applyRoomResponseDirectives(current store.State, snapshot store.State, roomID, replySpeaker, provider string, directives roomResponseDirectives) (store.State, string) {
	if directives.ClaimMode == "take" && directives.Handoff == nil && directives.ReplyKind == "message" {
		if nextState, err := s.store.ClaimRoomOwnership(roomID, replySpeaker, provider); err == nil {
			current = nextState
			snapshot = nextState
		}
	}
	handoff := directives.Handoff
	if handoff == nil && directives.ReplyKind == "handoff" {
		if inferred, ok := inferRoomHandoffDirective(snapshot, roomID, directives.DisplayOutput); ok {
			handoff = &inferred
		}
	}
	if handoff == nil {
		return current, ""
	}
	handoffInput, ok := buildRoomAutoHandoffInput(snapshot, roomID, replySpeaker, *handoff)
	if !ok {
		return current, ""
	}
	nextState, createdHandoff, err := s.store.CreateHandoff(handoffInput)
	if err != nil {
		return current, ""
	}
	return s.continueRoomAutoHandoff(nextState, roomID, handoff.Title, createdHandoff.ID)
}

func buildRoomAutoHandoffInput(snapshot store.State, roomID, fromAgentName string, directive roomHandoffDirective) (store.MailboxCreateInput, bool) {
	room, run, issue, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return store.MailboxCreateInput{}, false
	}
	fromAgentID, ok := findAgentIDByName(snapshot.Agents, defaultString(strings.TrimSpace(fromAgentName), defaultString(strings.TrimSpace(run.Owner), defaultString(strings.TrimSpace(issue.Owner), strings.TrimSpace(room.Topic.Owner)))))
	if !ok {
		return store.MailboxCreateInput{}, false
	}
	toAgentID, ok := findAgentIDByIDOrName(snapshot.Agents, directive.ToAgentID)
	if !ok || toAgentID == fromAgentID {
		return store.MailboxCreateInput{}, false
	}
	return store.MailboxCreateInput{
		RoomID:      roomID,
		FromAgentID: fromAgentID,
		ToAgentID:   toAgentID,
		Title:       directive.Title,
		Summary:     directive.Summary,
		Kind:        "room-auto",
	}, true
}

func (s *Server) continueRoomAutoHandoff(snapshot store.State, roomID, handoffTitle, handoffID string) (store.State, string) {
	room, _, _, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return snapshot, ""
	}
	if strings.TrimSpace(room.Topic.Owner) == "" {
		return snapshot, ""
	}

	provider := resolveRoomExecProvider(snapshot, roomID, "")
	if blocked := execProviderPreflightMessage("讨论间自动接棒", snapshot, provider); blocked != "" {
		if nextState, _, err := s.store.UpdateRoomAutoHandoffFollowup(handoffID, "blocked", blocked); err == nil {
			snapshot = nextState
		}
		message := fmt.Sprintf("%s 已接棒，但当前无法继续执行：%s", room.Topic.Owner, blocked)
		nextState, err := s.store.AppendSystemRoomMessage(roomID, "System", message, "blocked")
		if err != nil {
			return snapshot, ""
		}
		return nextState, message
	}

	followupPrompt := buildRoomAutoFollowupPrompt(room.Topic.Owner, handoffTitle)
	execPrompt := buildRoomExecPrompt(snapshot, roomID, provider, followupPrompt)
	payload, err := s.runRoomDaemonExec(roomID, ExecRequest{
		Provider:       provider,
		Prompt:         execPrompt,
		TimeoutSeconds: roomMessageExecTimeoutSeconds,
	})
	if err != nil {
		blocked := execFailureMessage("讨论间自动接棒", err)
		if nextState, _, followupErr := s.store.UpdateRoomAutoHandoffFollowup(handoffID, "blocked", blocked); followupErr == nil {
			snapshot = nextState
		}
		message := fmt.Sprintf("%s 已接棒，但继续推进失败：%s", room.Topic.Owner, blocked)
		nextState, appendErr := s.store.AppendSystemRoomMessage(roomID, "System", message, "blocked")
		if appendErr != nil {
			return snapshot, ""
		}
		return nextState, message
	}

	directives := parseRoomResponseDirectives(strings.TrimSpace(payload.Output))
	if directives.SuppressReply {
		if nextState, _, err := s.store.UpdateRoomAutoHandoffFollowup(handoffID, "completed", "已静默继续当前房间，无需额外公开回复。"); err == nil {
			snapshot = nextState
		}
		if nextState, _, err := s.store.SuppressRoomAutoHandoffAnnouncement(roomID, room.Topic.Owner, handoffTitle); err == nil {
			return nextState, ""
		}
		return snapshot, ""
	}
	if strings.TrimSpace(directives.DisplayOutput) == "" {
		return snapshot, ""
	}
	var nextState store.State
	if directives.ReplyKind == "clarification_request" {
		nextState, err = s.store.AppendAgentClarificationRequest(roomID, room.Topic.Owner, directives.DisplayOutput, provider)
	} else if directives.ReplyKind == "summary" {
		nextState, err = s.store.AppendAgentRoomSummary(roomID, room.Topic.Owner, directives.DisplayOutput, provider)
	} else {
		nextState, err = s.store.AppendAgentRoomMessage(roomID, room.Topic.Owner, directives.DisplayOutput, provider)
	}
	if err != nil {
		if blockedState, _, followupErr := s.store.UpdateRoomAutoHandoffFollowup(handoffID, "blocked", err.Error()); followupErr == nil {
			return blockedState, ""
		}
		return snapshot, ""
	}
	if blockedState, _, followupErr := s.store.UpdateRoomAutoHandoffFollowup(handoffID, "completed", directives.DisplayOutput); followupErr == nil {
		nextState = blockedState
	}
	return nextState, directives.DisplayOutput
}

func buildRoomAutoFollowupPrompt(ownerName, handoffTitle string) string {
	return fmt.Sprintf(
		"你刚刚已经接住当前房间的正式交棒，主题是「%s」。默认继续沿当前 room / run / worktree 内部推进，不要重讲背景，这轮不要继续转交别人。如果只是内部继续执行，优先返回 KIND: no_response。只有确实需要让人知道当前判断、同步阶段结论或提出唯一阻塞问题时，才公开回复；用 1 到 2 句给当前判断和下一步，不要重复“我已接手”这类铺垫。如果已经能直接开做，就不要提问。请直接以 %s 的身份继续推进。",
		defaultString(strings.TrimSpace(handoffTitle), "继续当前房间"),
		defaultString(strings.TrimSpace(ownerName), "当前接手智能体"),
	)
}

func (s *Server) StartRoomAutoRecoveryLoop(ctx context.Context, interval time.Duration) {
	if ctx == nil {
		return
	}
	if interval <= 0 {
		interval = roomAutoRecoveryLoopDefaultInterval
	}
	s.roomAutoLoopOnce.Do(func() {
		go func() {
			s.kickRoomAutoRecovery()
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					s.kickRoomAutoRecovery()
				}
			}
		}()
	})
}

func (s *Server) kickRoomAutoRecovery() {
	snapshot := s.store.Snapshot()
	now := time.Now()
	for _, session := range snapshot.Sessions {
		if !interruptedPendingTurnRecoveryEligible(session) {
			s.clearPendingTurnRecoveryTracking(session.ID)
			continue
		}
		if !s.beginPendingTurnRecovery(session.ID, now) {
			continue
		}
		go s.runPendingTurnRecovery(session.ID)
	}
	for index := range snapshot.Mailbox {
		handoff := snapshot.Mailbox[index]
		if !roomAutoHandoffRecoveryEligible(snapshot, handoff) {
			s.clearRoomAutoRecoveryTracking(handoff.ID)
			continue
		}
		if !s.beginRoomAutoRecovery(handoff.ID, now) {
			continue
		}
		go s.runRoomAutoRecovery(handoff.ID)
	}
}

func (s *Server) beginPendingTurnRecovery(sessionID string, now time.Time) bool {
	trimmedID := strings.TrimSpace(sessionID)
	if trimmedID == "" {
		return false
	}
	s.pendingTurnRecoveryMu.Lock()
	defer s.pendingTurnRecoveryMu.Unlock()

	if s.pendingTurnInFlight == nil {
		s.pendingTurnInFlight = map[string]struct{}{}
	}
	if s.pendingTurnLastAttempt == nil {
		s.pendingTurnLastAttempt = map[string]time.Time{}
	}
	if _, exists := s.pendingTurnInFlight[trimmedID]; exists {
		return false
	}
	if lastAttempt, exists := s.pendingTurnLastAttempt[trimmedID]; exists && roomAutoRecoveryCooldown > 0 && now.Sub(lastAttempt) < roomAutoRecoveryCooldown {
		return false
	}
	s.pendingTurnInFlight[trimmedID] = struct{}{}
	s.pendingTurnLastAttempt[trimmedID] = now
	return true
}

func (s *Server) runPendingTurnRecovery(sessionID string) {
	defer s.finishPendingTurnRecovery(sessionID)

	snapshot := s.store.Snapshot()
	session, ok := findInterruptedPendingTurnSession(snapshot, sessionID)
	if !ok {
		return
	}
	_, _ = s.continueInterruptedPendingTurn(snapshot, session)
}

func (s *Server) finishPendingTurnRecovery(sessionID string) {
	trimmedID := strings.TrimSpace(sessionID)
	if trimmedID == "" {
		return
	}
	snapshot := s.store.Snapshot()
	_, ok := findInterruptedPendingTurnSession(snapshot, trimmedID)

	s.pendingTurnRecoveryMu.Lock()
	defer s.pendingTurnRecoveryMu.Unlock()
	delete(s.pendingTurnInFlight, trimmedID)
	if !ok {
		delete(s.pendingTurnLastAttempt, trimmedID)
	}
}

func (s *Server) clearPendingTurnRecoveryTracking(sessionID string) {
	trimmedID := strings.TrimSpace(sessionID)
	if trimmedID == "" {
		return
	}
	s.pendingTurnRecoveryMu.Lock()
	defer s.pendingTurnRecoveryMu.Unlock()
	delete(s.pendingTurnInFlight, trimmedID)
	delete(s.pendingTurnLastAttempt, trimmedID)
}

func (s *Server) beginRoomAutoRecovery(handoffID string, now time.Time) bool {
	trimmedID := strings.TrimSpace(handoffID)
	if trimmedID == "" {
		return false
	}
	s.roomAutoRecoveryMu.Lock()
	defer s.roomAutoRecoveryMu.Unlock()

	if s.roomAutoInFlight == nil {
		s.roomAutoInFlight = map[string]struct{}{}
	}
	if s.roomAutoLastAttempt == nil {
		s.roomAutoLastAttempt = map[string]time.Time{}
	}
	if _, exists := s.roomAutoInFlight[trimmedID]; exists {
		return false
	}
	if lastAttempt, exists := s.roomAutoLastAttempt[trimmedID]; exists && roomAutoRecoveryCooldown > 0 && now.Sub(lastAttempt) < roomAutoRecoveryCooldown {
		return false
	}
	s.roomAutoInFlight[trimmedID] = struct{}{}
	s.roomAutoLastAttempt[trimmedID] = now
	return true
}

func (s *Server) runRoomAutoRecovery(handoffID string) {
	defer s.finishRoomAutoRecovery(handoffID)

	snapshot := s.store.Snapshot()
	handoff, ok := findRoomAutoHandoffByID(snapshot, handoffID)
	if !ok || !roomAutoHandoffRecoveryEligible(snapshot, handoff) {
		return
	}
	_, _ = s.continueRoomAutoHandoff(snapshot, handoff.RoomID, handoff.Title, handoff.ID)
}

func (s *Server) finishRoomAutoRecovery(handoffID string) {
	trimmedID := strings.TrimSpace(handoffID)
	if trimmedID == "" {
		return
	}
	snapshot := s.store.Snapshot()
	handoff, ok := findRoomAutoHandoffByID(snapshot, trimmedID)

	s.roomAutoRecoveryMu.Lock()
	defer s.roomAutoRecoveryMu.Unlock()
	delete(s.roomAutoInFlight, trimmedID)
	if !ok || !roomAutoHandoffRecoveryEligible(snapshot, handoff) {
		delete(s.roomAutoLastAttempt, trimmedID)
	}
}

func (s *Server) clearRoomAutoRecoveryTracking(handoffID string) {
	trimmedID := strings.TrimSpace(handoffID)
	if trimmedID == "" {
		return
	}
	s.roomAutoRecoveryMu.Lock()
	defer s.roomAutoRecoveryMu.Unlock()
	delete(s.roomAutoInFlight, trimmedID)
	delete(s.roomAutoLastAttempt, trimmedID)
}

func roomAutoHandoffRecoveryEligible(snapshot store.State, handoff store.AgentHandoff) bool {
	if handoff.Kind != "room-auto" || strings.TrimSpace(handoff.Status) != "acknowledged" || handoff.AutoFollowup == nil {
		return false
	}
	switch strings.TrimSpace(handoff.AutoFollowup.Status) {
	case "pending", "blocked":
	default:
		return false
	}

	room, run, issue, ok := findRoomRunIssue(snapshot, handoff.RoomID)
	if !ok {
		return false
	}
	ownerMatches := false
	for _, owner := range []string{
		strings.TrimSpace(room.Topic.Owner),
		strings.TrimSpace(run.Owner),
		strings.TrimSpace(issue.Owner),
	} {
		if owner == "" {
			continue
		}
		if strings.EqualFold(owner, strings.TrimSpace(handoff.ToAgent)) || strings.EqualFold(owner, strings.TrimSpace(handoff.ToAgentID)) {
			ownerMatches = true
			break
		}
	}
	if !ownerMatches {
		return false
	}

	session, ok := findRoomConversationSession(snapshot, handoff.RoomID, "")
	if ok && session.PendingTurn != nil {
		return false
	}
	return true
}

func continueInterruptedPendingTurnProvider(session store.Session) string {
	if session.PendingTurn == nil {
		return ""
	}
	provider := normalizeProviderID(defaultString(strings.TrimSpace(session.PendingTurn.Provider), strings.TrimSpace(session.Provider)))
	if provider != "codex" {
		return ""
	}
	if !sessionHasResumeEligiblePendingTurn(session, provider) {
		return ""
	}
	return provider
}

func interruptedPendingTurnRecoveryEligible(session store.Session) bool {
	return strings.TrimSpace(session.ID) != "" &&
		strings.TrimSpace(session.RoomID) != "" &&
		continueInterruptedPendingTurnProvider(session) != ""
}

func findInterruptedPendingTurnSession(snapshot store.State, sessionID string) (store.Session, bool) {
	trimmedID := strings.TrimSpace(sessionID)
	if trimmedID == "" {
		return store.Session{}, false
	}
	for _, session := range snapshot.Sessions {
		if session.ID != trimmedID || !interruptedPendingTurnRecoveryEligible(session) {
			continue
		}
		return session, true
	}
	return store.Session{}, false
}

func (s *Server) continueInterruptedPendingTurn(snapshot store.State, session store.Session) (store.State, string) {
	roomID := strings.TrimSpace(session.RoomID)
	provider := continueInterruptedPendingTurnProvider(session)
	if roomID == "" || provider == "" || session.PendingTurn == nil {
		return snapshot, ""
	}
	if blocked := execProviderPreflightMessage("讨论间恢复执行", snapshot, provider); blocked != "" {
		return snapshot, ""
	}

	prompt := strings.TrimSpace(session.PendingTurn.Prompt)
	execPrompt := buildRoomExecPrompt(snapshot, roomID, provider, prompt)
	payload, err := s.runRoomDaemonExec(roomID, ExecRequest{
		Provider:       provider,
		Prompt:         execPrompt,
		TimeoutSeconds: roomMessageExecTimeoutSeconds,
	})
	if err != nil {
		return snapshot, ""
	}

	directives := parseRoomResponseDirectives(strings.TrimSpace(payload.Output))
	replySpeaker := roomReplySpeaker(snapshot, roomID, prompt)
	suppressRelay := shouldSuppressRoomHandoffRelay(snapshot, roomID, directives)

	var nextState store.State
	if directives.SuppressReply || suppressRelay {
		nextState, err = s.store.AppendConversationWithoutVisibleReply(roomID, prompt, provider)
	} else if directives.ReplyKind == "clarification_request" {
		nextState, err = s.store.AppendClarificationRequest(roomID, prompt, replySpeaker, directives.DisplayOutput, provider)
	} else if directives.ReplyKind == "summary" {
		nextState, err = s.store.AppendConversationSummary(roomID, prompt, replySpeaker, directives.DisplayOutput, provider)
	} else {
		nextState, err = s.store.AppendConversationAsAgent(roomID, prompt, replySpeaker, directives.DisplayOutput, provider)
	}
	if err != nil {
		return snapshot, ""
	}

	nextState, followupOutput := s.applyRoomResponseDirectives(nextState, nextState, roomID, replySpeaker, provider, directives)
	visibleOutput := directives.DisplayOutput
	if directives.SuppressReply {
		visibleOutput = followupOutput
	} else if suppressRelay {
		if strings.TrimSpace(directives.DisplayOutput) != "" {
			if strings.TrimSpace(followupOutput) == "" {
				if restoredState, restoreErr := s.store.AppendAgentRoomMessage(roomID, replySpeaker, directives.DisplayOutput, provider); restoreErr == nil {
					nextState = restoredState
				}
				visibleOutput = directives.DisplayOutput
			} else {
				visibleOutput = followupOutput
			}
		} else if strings.TrimSpace(followupOutput) != "" {
			visibleOutput = followupOutput
		}
	}
	nextState = s.completeRoomAutoHandoffFollowupIfNeeded(nextState, roomID, replySpeaker, directives, visibleOutput)
	return nextState, visibleOutput
}

func findRoomAutoHandoffByID(snapshot store.State, handoffID string) (store.AgentHandoff, bool) {
	trimmedID := strings.TrimSpace(handoffID)
	if trimmedID == "" {
		return store.AgentHandoff{}, false
	}
	for _, handoff := range snapshot.Mailbox {
		if handoff.ID == trimmedID && handoff.Kind == "room-auto" {
			return handoff, true
		}
	}
	return store.AgentHandoff{}, false
}

func (s *Server) completeRoomAutoHandoffFollowupIfNeeded(snapshot store.State, roomID, replySpeaker string, directives roomResponseDirectives, visibleOutput string) store.State {
	summary := strings.TrimSpace(visibleOutput)
	if directives.SuppressReply {
		summary = "已在显式触发下静默继续当前房间，无需额外公开回复。"
	} else if directives.ReplyKind == "clarification_request" && summary == "" {
		summary = "已接住当前房间，并继续发起必要澄清。"
	} else if summary == "" {
		return snapshot
	}
	nextState, _, updated, err := s.store.CompleteLatestRoomAutoHandoffFollowup(roomID, replySpeaker, summary)
	if err != nil || !updated {
		return snapshot
	}
	return nextState
}

func roomReplySpeaker(snapshot store.State, roomID, userPrompt string) string {
	if agent, _, ok := resolveRoomTurnAgent(snapshot, roomID, userPrompt); ok {
		return agent.Name
	}
	room, run, issue, ok := findRoomRunIssue(snapshot, roomID)
	if !ok {
		return "当前智能体"
	}
	return defaultString(strings.TrimSpace(run.Owner), defaultString(strings.TrimSpace(issue.Owner), defaultString(strings.TrimSpace(room.Topic.Owner), "当前智能体")))
}

func resolveRoomTurnAgent(snapshot store.State, roomID, userPrompt string) (store.Agent, string, bool) {
	if agent, ok := findRoomClarificationAgent(snapshot, roomID, userPrompt); ok {
		return agent, "clarification_followup", true
	}
	if targetAgentID, _, ok := findMentionedAgentID(snapshot.Agents, userPrompt); ok {
		for _, agent := range snapshot.Agents {
			if agent.ID == targetAgentID {
				return agent, "mention_response", true
			}
		}
	}
	if agent, ok := findRoomOwnerAgent(snapshot, roomID); ok {
		return agent, "direct_message", true
	}
	return store.Agent{}, "direct_message", false
}

func findRoomClarificationAgent(snapshot store.State, roomID, userPrompt string) (store.Agent, bool) {
	if wait, ok := findResolvableRoomClarificationWait(snapshot, roomID, userPrompt); ok {
		for _, agent := range snapshot.Agents {
			if strings.EqualFold(strings.TrimSpace(agent.ID), strings.TrimSpace(wait.AgentID)) {
				return agent, true
			}
		}
		for _, agent := range snapshot.Agents {
			if strings.EqualFold(strings.TrimSpace(agent.Name), strings.TrimSpace(wait.Agent)) {
				return agent, true
			}
		}
	}

	messages := snapshot.RoomMessages[roomID]
	if len(messages) == 0 {
		return store.Agent{}, false
	}
	last := messages[len(messages)-1]
	if last.Role != "agent" || last.Tone != "blocked" {
		return store.Agent{}, false
	}
	for _, agent := range snapshot.Agents {
		if strings.EqualFold(strings.TrimSpace(agent.Name), strings.TrimSpace(last.Speaker)) || strings.EqualFold(strings.TrimSpace(agent.ID), strings.TrimSpace(last.Speaker)) {
			return agent, true
		}
	}
	return store.Agent{}, false
}

func findResolvableRoomClarificationWait(snapshot store.State, roomID, userPrompt string) (store.RoomAgentWait, bool) {
	candidateAgentID := ""
	if id, _, ok := findMentionedAgentID(snapshot.Agents, userPrompt); ok {
		candidateAgentID = id
	}

	matchIndex := -1
	openCount := 0
	for index := len(snapshot.RoomAgentWaits) - 1; index >= 0; index-- {
		wait := snapshot.RoomAgentWaits[index]
		if wait.RoomID != roomID || wait.Status != "waiting_reply" {
			continue
		}
		openCount++
		if candidateAgentID != "" && wait.AgentID == candidateAgentID {
			return wait, true
		}
		if matchIndex == -1 {
			matchIndex = index
		}
	}

	if candidateAgentID == "" && openCount == 1 && matchIndex >= 0 {
		return snapshot.RoomAgentWaits[matchIndex], true
	}
	return store.RoomAgentWait{}, false
}

func findOpenRoomClarificationWaitByAgent(snapshot store.State, roomID, agentID string) (store.RoomAgentWait, bool) {
	for index := len(snapshot.RoomAgentWaits) - 1; index >= 0; index-- {
		wait := snapshot.RoomAgentWaits[index]
		if wait.RoomID != roomID || wait.Status != "waiting_reply" {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(wait.AgentID), strings.TrimSpace(agentID)) {
			return wait, true
		}
	}
	return store.RoomAgentWait{}, false
}

func inferRoomHandoffDirective(snapshot store.State, roomID, body string) (roomHandoffDirective, bool) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return roomHandoffDirective{}, false
	}
	targetAgentID, mentionLabel, ok := findMentionedAgentID(snapshot.Agents, trimmed)
	if !ok {
		return roomHandoffDirective{}, false
	}
	summary := strings.TrimSpace(strings.ReplaceAll(trimmed, mentionLabel, ""))
	summary = strings.Trim(summary, " ，。,:;!?\t\r\n")
	if summary == "" {
		summary = "请继续接手当前房间。"
	}
	title := summary
	if runes := []rune(title); len(runes) > 24 {
		title = string(runes[:24]) + "…"
	}
	return roomHandoffDirective{
		ToAgentID: targetAgentID,
		Title:     defaultString(title, "继续接手当前房间"),
		Summary:   summary,
	}, true
}

func findMentionedAgentID(agents []store.Agent, body string) (string, string, bool) {
	for _, token := range strings.Fields(body) {
		if !strings.HasPrefix(token, "@") {
			continue
		}
		label := strings.Trim(token, " \t\r\n,.;:!?()[]{}<>\"'，。；：！？、】【")
		candidate := strings.TrimPrefix(label, "@")
		if candidate == "" {
			continue
		}
		if id, ok := findAgentIDByIDOrName(agents, candidate); ok {
			return id, label, true
		}
	}
	return "", "", false
}

func findAgentIDByName(agents []store.Agent, name string) (string, bool) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", false
	}
	for _, agent := range agents {
		if strings.EqualFold(strings.TrimSpace(agent.Name), trimmed) {
			return agent.ID, true
		}
	}
	return "", false
}

func findAgentIDByIDOrName(agents []store.Agent, value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", false
	}
	for _, agent := range agents {
		if agent.ID == trimmed || strings.EqualFold(strings.TrimSpace(agent.Name), trimmed) {
			return agent.ID, true
		}
	}
	return "", false
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

func (s *Server) actualLiveURLValue() string {
	if value := strings.TrimRight(strings.TrimSpace(s.actualLiveURL), "/"); value != "" {
		return value
	}
	return "http://127.0.0.1:8080"
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
	switch normalizeProviderID(provider) {
	case "claude":
		return "Claude Review Runner"
	case "codex":
		return "Codex Dockmaster"
	default:
		return "Shock_AI_Core"
	}
}

func channelReplyTone(replyKind string) string {
	switch strings.TrimSpace(replyKind) {
	case "summary":
		return "paper"
	case "clarification_request":
		return "blocked"
	default:
		return "agent"
	}
}

func resolveExecProvider(state store.State, requested string) string {
	requestedProvider := normalizeProviderID(requested)
	if requestedProvider != "" {
		return requestedProvider
	}

	preferredProvider := preferredExecProvider(state)
	readyCandidates := runtimeReadyProviderCandidates(state)
	if len(readyCandidates) > 0 {
		if preferredProvider != "" && runtimeProviderReady(state, preferredProvider) {
			return preferredProvider
		}
		return readyCandidates[0]
	}

	if preferredProvider != "" && runtimeSupportsProvider(state, preferredProvider) {
		return preferredProvider
	}

	for _, candidate := range []string{"codex", "claude"} {
		if runtimeSupportsProvider(state, candidate) {
			return candidate
		}
	}

	if provider := firstAvailableExecProvider(state); provider != "" {
		return provider
	}

	if provider := preferredExecProvider(state); provider != "" {
		return provider
	}

	return "codex"
}

func resolveRoomExecProvider(state store.State, roomID, requested string) string {
	requestedProvider := normalizeProviderID(requested)
	if requestedProvider != "" {
		return requestedProvider
	}
	if agent, ok := findRoomOwnerAgent(state, roomID); ok {
		provider := normalizeProviderID(defaultString(strings.TrimSpace(agent.ProviderPreference), strings.TrimSpace(agent.Provider)))
		if provider != "" {
			if runtimeProviderReady(state, provider) || runtimeSupportsProvider(state, provider) {
				return provider
			}
		}
	}
	return resolveExecProvider(state, requested)
}

func resolveRoomTurnExecProvider(state store.State, roomID, requested, userPrompt string) string {
	requestedProvider := normalizeProviderID(requested)
	if requestedProvider != "" {
		return requestedProvider
	}
	if agent, _, ok := resolveRoomTurnAgent(state, roomID, userPrompt); ok {
		provider := normalizeProviderID(defaultString(strings.TrimSpace(agent.ProviderPreference), strings.TrimSpace(agent.Provider)))
		if provider != "" {
			if runtimeProviderReady(state, provider) || runtimeSupportsProvider(state, provider) {
				return provider
			}
		}
	}
	return resolveRoomExecProvider(state, roomID, requested)
}

func preferredExecProvider(state store.State) string {
	preferredAgentID := strings.TrimSpace(state.Auth.Session.Preferences.PreferredAgentID)
	if preferredAgentID != "" {
		for _, agent := range state.Agents {
			if agent.ID == preferredAgentID {
				if provider := normalizeProviderID(defaultString(agent.ProviderPreference, agent.Provider)); provider != "" {
					return provider
				}
				break
			}
		}
	}

	if len(state.Agents) > 0 {
		if provider := normalizeProviderID(defaultString(state.Agents[0].ProviderPreference, state.Agents[0].Provider)); provider != "" {
			return provider
		}
	}

	return ""
}

func runtimeSupportsProvider(state store.State, want string) bool {
	want = normalizeProviderID(want)
	if want == "" {
		return false
	}
	for _, provider := range runtimeProviderCandidates(state) {
		if provider == want {
			return true
		}
	}
	return false
}

func runtimeProviderReady(state store.State, want string) bool {
	provider, ok := runtimeProviderRecord(state, want)
	return ok && runtimeProviderIsReady(provider)
}

func firstAvailableExecProvider(state store.State) string {
	for _, provider := range runtimeProviderCandidates(state) {
		if provider != "" {
			return provider
		}
	}
	return ""
}

func runtimeReadyProviderCandidates(state store.State) []string {
	candidates := make([]string, 0, 4)
	seen := map[string]bool{}
	appendRuntimeProviders := func(runtime store.RuntimeRecord) {
		for _, provider := range runtime.Providers {
			id := normalizeProviderID(defaultString(provider.ID, provider.Label))
			if id == "" || seen[id] || !runtimeProviderIsReady(provider) {
				continue
			}
			seen[id] = true
			candidates = append(candidates, id)
		}
	}

	pairedRuntimeID := strings.TrimSpace(state.Workspace.PairedRuntime)
	if pairedRuntimeID != "" {
		for _, runtime := range state.Runtimes {
			if runtime.ID == pairedRuntimeID {
				appendRuntimeProviders(runtime)
				break
			}
		}
	}

	for _, runtime := range state.Runtimes {
		if runtime.ID == pairedRuntimeID {
			continue
		}
		appendRuntimeProviders(runtime)
	}

	return candidates
}

func runtimeProviderCandidates(state store.State) []string {
	candidates := make([]string, 0, 4)
	seen := map[string]bool{}
	appendRuntimeProviders := func(runtime store.RuntimeRecord) {
		for _, provider := range runtime.Providers {
			id := normalizeProviderID(defaultString(provider.ID, provider.Label))
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			candidates = append(candidates, id)
		}
	}

	pairedRuntimeID := strings.TrimSpace(state.Workspace.PairedRuntime)
	if pairedRuntimeID != "" {
		for _, runtime := range state.Runtimes {
			if runtime.ID == pairedRuntimeID {
				appendRuntimeProviders(runtime)
				break
			}
		}
	}

	for _, runtime := range state.Runtimes {
		if runtime.ID == pairedRuntimeID {
			continue
		}
		appendRuntimeProviders(runtime)
	}

	return candidates
}

func runtimeProviderRecord(state store.State, want string) (store.RuntimeProvider, bool) {
	want = normalizeProviderID(want)
	if want == "" {
		return store.RuntimeProvider{}, false
	}

	pairedRuntimeID := strings.TrimSpace(state.Workspace.PairedRuntime)
	if pairedRuntimeID != "" {
		for _, runtime := range state.Runtimes {
			if runtime.ID != pairedRuntimeID {
				continue
			}
			for _, provider := range runtime.Providers {
				if normalizeProviderID(defaultString(provider.ID, provider.Label)) == want {
					return provider, true
				}
			}
			break
		}
	}

	for _, runtime := range state.Runtimes {
		if runtime.ID == pairedRuntimeID {
			continue
		}
		for _, provider := range runtime.Providers {
			if normalizeProviderID(defaultString(provider.ID, provider.Label)) == want {
				return provider, true
			}
		}
	}

	return store.RuntimeProvider{}, false
}

func runtimeProviderIsReady(provider store.RuntimeProvider) bool {
	status := strings.TrimSpace(provider.Status)
	switch status {
	case "", "ready":
		return true
	case "auth_required", "unavailable", "degraded":
		return false
	default:
		return provider.Ready
	}
}

func execProviderPreflightMessage(scope string, state store.State, provider string) string {
	record, ok := runtimeProviderRecord(state, provider)
	if !ok || runtimeProviderIsReady(record) {
		return ""
	}

	switch strings.TrimSpace(record.Status) {
	case "auth_required":
		return fmt.Sprintf("%s当前还未登录模型服务，请先完成登录。", scope)
	case "unavailable":
		return fmt.Sprintf("%s当前还没有可用模型，请先在设置里完成本地模型连接。", scope)
	case "degraded":
		return fmt.Sprintf("%s当前状态异常，请先检查本地模型连接后重试。", scope)
	default:
		return fmt.Sprintf("%s当前还不能直接发送，请先检查模型服务状态。", scope)
	}
}

func normalizeProviderID(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.Contains(trimmed, "claude"):
		return "claude"
	case strings.Contains(trimmed, "codex"):
		return "codex"
	default:
		return trimmed
	}
}

func execFailureMessage(scope string, err error) string {
	raw := strings.TrimSpace(err.Error())
	lower := strings.ToLower(raw)

	switch {
	case strings.Contains(lower, "deadline exceeded"):
		return fmt.Sprintf("%s暂时没有返回，请确认本地模型已登录后再试。", scope)
	case strings.Contains(lower, "executable file not found"),
		strings.Contains(lower, "not found in $path"),
		strings.Contains(lower, "no such file or directory"):
		return fmt.Sprintf("%s当前还没有可用模型，请先在设置里完成本地模型连接。", scope)
	case strings.Contains(lower, "not logged"),
		strings.Contains(lower, "login"),
		strings.Contains(lower, "unauthorized"):
		return fmt.Sprintf("%s当前还未登录模型服务，请先完成登录。", scope)
	default:
		return fmt.Sprintf("%s暂时不可用，请检查本地模型连接后重试。", scope)
	}
}
