package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"openshock/daemon/internal/acp"
	"openshock/daemon/internal/client"
	"openshock/daemon/internal/gitops"
	"openshock/daemon/internal/provider"
)

func main() {
	var agentWorkspacesDir string
	var (
		baseURL         = flag.String("api-base-url", envOr("OPENSHOCK_API_BASE_URL", "http://localhost:8080"), "OpenShock backend base URL")
		name            = flag.String("name", envOr("OPENSHOCK_RUNTIME_NAME", "Local Daemon"), "Runtime display name")
		runtimeProvider = flag.String("provider", envOr("OPENSHOCK_PROVIDER", "codex"), "Execution provider label reported to the backend")
		codexMode       = flag.String("codex-mode", envOr("OPENSHOCK_CODEX_MODE", codexModeAuto), "Codex execution mode: exec, app-server, or auto")
		codexSandbox    = flag.String("codex-sandbox", envOr("OPENSHOCK_CODEX_SANDBOX", "danger-full-access"), "Codex sandbox mode for agent turns and runs")
		codexHome       = flag.String("codex-home", envOr("OPENSHOCK_CODEX_HOME", defaultCodexHome()), "Optional CODEX_HOME override used by the daemon")
		slotCount       = flag.Int("slots", 6, "Available execution slots")
		turnTimeout     = flag.Duration("codex-turn-timeout", durationEnvOr("OPENSHOCK_CODEX_TURN_TIMEOUT", 10*time.Minute), "Timeout per Codex execution")
		once            = flag.Bool("once", false, "Run one register/claim/report cycle and exit")
	)
	agentWorkspaceDefault := envOr("OPENSHOCK_AGENT_SESSION_ROOT", envOr("OPENSHOCK_AGENT_WORKSPACES_DIR", defaultAgentWorkspaceRoot()))
	flag.StringVar(&agentWorkspacesDir, "agent-session-root", agentWorkspaceDefault, "Root directory for persistent agent session workspaces")
	flag.StringVar(&agentWorkspacesDir, "agent-workspaces-dir", agentWorkspaceDefault, "Deprecated alias for --agent-session-root")
	flag.Parse()

	if err := os.Setenv("OPENSHOCK_API_BASE_URL", *baseURL); err != nil {
		log.Printf("failed to export OPENSHOCK_API_BASE_URL: %v", err)
	}
	if err := ensureOpenShockCLIOnPath(); err != nil {
		log.Printf("failed to prepare openshock cli: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	api := client.New(*baseURL)
	gitService := gitops.New()
	codexBin := envOr("OPENSHOCK_CODEX_BIN", "codex")

	runtimeResp, err := api.RegisterRuntime(ctx, client.RegisterRuntimeRequest{
		Name:      *name,
		Provider:  *runtimeProvider,
		SlotCount: *slotCount,
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("registered runtime %s (%s) slots=%d", runtimeResp.Runtime.ID, runtimeResp.Runtime.Name, runtimeResp.Runtime.SlotCount)

	startHeartbeatLoop(ctx, api, runtimeResp.Runtime.ID)

	workerCount := *slotCount
	if workerCount < 1 {
		workerCount = 1
	}

	if *once {
		workerHome := workerCodexHome(*codexHome, 1)
		executor, activeMode, err := newExecutionProvider(*codexMode, providerFactoryOptions{
			CodexBinPath: codexBin,
			CodexHome:    workerHome,
		})
		if err != nil {
			log.Fatal(err)
		}
		defer executor.Close()
		log.Printf("daemon execution mode %s", activeMode)

		worker := daemonWorker{
			id:                 1,
			api:                api,
			gitService:         gitService,
			executor:           executor,
			runtimeID:          runtimeResp.Runtime.ID,
			codexBin:           codexBin,
			codexSandbox:       *codexSandbox,
			codexHomeRoot:      *codexHome,
			codexHome:          workerHome,
			agentWorkspacesDir: agentWorkspacesDir,
			executionTimeout:   *turnTimeout,
		}
		worker.runOnce(ctx)
		return
	}

	var wg sync.WaitGroup
	for workerID := 1; workerID <= workerCount; workerID++ {
		workerHome := workerCodexHome(*codexHome, workerID)
		executor, activeMode, err := newExecutionProvider(*codexMode, providerFactoryOptions{
			CodexBinPath: codexBin,
			CodexHome:    workerHome,
		})
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("worker %d execution mode %s", workerID, activeMode)

		worker := daemonWorker{
			id:                 workerID,
			api:                api,
			gitService:         gitService,
			executor:           executor,
			runtimeID:          runtimeResp.Runtime.ID,
			codexBin:           codexBin,
			codexSandbox:       *codexSandbox,
			codexHomeRoot:      *codexHome,
			codexHome:          workerHome,
			agentWorkspacesDir: agentWorkspacesDir,
			executionTimeout:   *turnTimeout,
		}

		wg.Add(1)
		go func(executor provider.Executor, worker daemonWorker) {
			defer wg.Done()
			defer executor.Close()
			worker.runLoop(ctx)
		}(executor, worker)
	}

	<-ctx.Done()
	wg.Wait()
}

type daemonWorker struct {
	id                 int
	api                *client.Client
	gitService         *gitops.Service
	executor           provider.Executor
	runtimeID          string
	codexBin           string
	codexSandbox       string
	codexHomeRoot      string
	codexHome          string
	agentWorkspacesDir string
	executionTimeout   time.Duration
}

func (w daemonWorker) runLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if worked := w.runOne(ctx); worked {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

func (w daemonWorker) runOnce(ctx context.Context) {
	_ = w.processAgentTurn(ctx)
	_ = w.processRun(ctx)
	_ = w.processMerge(ctx)
}

func (w daemonWorker) runOne(ctx context.Context) bool {
	if w.processAgentTurn(ctx) {
		return true
	}
	if w.processRun(ctx) {
		return true
	}
	return w.processMerge(ctx)
}

func (w daemonWorker) processAgentTurn(ctx context.Context) bool {
	claim, err := w.api.ClaimAgentTurn(ctx, w.runtimeID)
	if err != nil {
		if !client.IsHTTPStatus(err, 404) {
			log.Printf("worker %d agent turn claim failed: %v", w.id, err)
		}
		return false
	}
	if !claim.Claimed || claim.AgentTurn == nil {
		return false
	}

	log.Printf("worker %d claimed agent turn %s for agent %s in room %s", w.id, claim.AgentTurn.Turn.ID, claim.AgentTurn.Turn.AgentID, claim.AgentTurn.Turn.RoomID)

	workspaceDir, err := prepareAgentWorkspace(w.agentWorkspacesDir, *claim.AgentTurn)
	if err != nil {
		log.Printf("worker %d failed to prepare agent workspace: %v", w.id, err)
		return true
	}
	if logErr := appendAgentWorkspaceLog(workspaceDir, "turn_started", *claim.AgentTurn, agentTurnReply{}, nil); logErr != nil {
		log.Printf("worker %d failed to append agent workspace start log for turn %s: %v", w.id, claim.AgentTurn.Turn.ID, logErr)
	}

	resumeThreadID := resolveResumeThreadID(claim.AgentTurn.Session.AppServerThreadID, workspaceDir)
	executionCodexHome := prepareSessionCodexHome(w.codexHomeRoot, claim.AgentTurn.Session)
	result, execErr := w.execute(ctx, provider.ExecuteRequest{
		RepoPath:       workspaceDir,
		Instruction:    claim.AgentTurn.Instruction,
		CodexBinPath:   w.codexBin,
		SandboxMode:    w.codexSandbox,
		CodexHome:      executionCodexHome,
		ExecutionKind:  "agent_turn",
		SessionKey:     claim.AgentTurn.Session.ID,
		ResumeThreadID: resumeThreadID,
	}, func(event acp.Event) error {
		switch event.Kind {
		case acp.EventStdoutChunk:
			if strings.TrimSpace(event.Content) == "" {
				return nil
			}
			stream := strings.TrimSpace(event.Stream)
			if stream == "" {
				stream = "stdout"
			}
			_, err := w.api.PostAgentTurnEvent(ctx, claim.AgentTurn.Turn.ID, client.AgentTurnEventRequest{
				RuntimeID: w.runtimeID,
				EventType: "output",
				Message:   event.Content,
				Stream:    stream,
			})
			return err
		case acp.EventStderrChunk:
			if strings.TrimSpace(event.Content) == "" {
				return nil
			}
			_, err := w.api.PostAgentTurnEvent(ctx, claim.AgentTurn.Turn.ID, client.AgentTurnEventRequest{
				RuntimeID: w.runtimeID,
				EventType: "output",
				Message:   event.Content,
				Stream:    "stderr",
			})
			return err
		case acp.EventToolCall:
			if event.ToolCall == nil || strings.TrimSpace(event.ToolCall.ToolName) == "" {
				return nil
			}
			_, err := w.api.PostAgentTurnEvent(ctx, claim.AgentTurn.Turn.ID, client.AgentTurnEventRequest{
				RuntimeID: w.runtimeID,
				EventType: "tool_call",
				ToolCall: &client.ToolCallInput{
					ToolName:  event.ToolCall.ToolName,
					Arguments: event.ToolCall.Arguments,
					Status:    event.ToolCall.Status,
				},
			})
			return err
		default:
			return nil
		}
	})
	if err := persistAgentTurnThreadState(workspaceDir, result.ProviderThreadID, execErr); err != nil {
		log.Printf("worker %d failed to persist app-server thread state for turn %s: %v", w.id, claim.AgentTurn.Turn.ID, err)
	}

	reply := parseAgentTurnReply(result.LastMessage)
	body := reply.Body
	kind := reply.Kind
	if execErr != nil {
		log.Printf("worker %d agent turn %s execution failed: %v", w.id, claim.AgentTurn.Turn.ID, execErr)
		body = summarizeFailure(result.RawOutput, execErr)
		kind = "blocked"
	}

	resultMessageID := ""
	if shouldPostVisibleAgentReply(kind) {
		if body == "" {
			switch kind {
			case "blocked":
				body = "执行时遇到了阻塞，请看观测面板里的错误细节。"
			case "handoff":
				body = "这里需要另一位 agent 接手。"
			}
		}
		actionResp, submitErr := w.api.SubmitAction(ctx, client.ActionRequest{
			ActorType:      "agent",
			ActorID:        claim.AgentTurn.Turn.AgentID,
			ActionType:     "RoomMessage.post",
			TargetType:     "room",
			TargetID:       claim.AgentTurn.Turn.RoomID,
			IdempotencyKey: "agent-turn-" + claim.AgentTurn.Turn.ID,
			Payload: map[string]any{
				"body": body,
				"kind": kind,
			},
		})
		if submitErr != nil {
			_ = appendAgentWorkspaceLog(workspaceDir, "reply_post_failed", *claim.AgentTurn, agentTurnReply{Kind: kind, Body: body}, submitErr)
			log.Printf("worker %d failed to post agent turn reply: %v", w.id, submitErr)
			return true
		}
		resultMessageID = actionEntityID(actionResp, "message")
	}

	if _, err := w.api.CompleteAgentTurn(ctx, claim.AgentTurn.Turn.ID, client.AgentTurnCompleteRequest{
		RuntimeID:              w.runtimeID,
		ResultMessageID:        resultMessageID,
		AppServerThreadID:      strings.TrimSpace(result.ProviderThreadID),
		ClearAppServerThreadID: execErr != nil,
	}); err != nil {
		_ = appendAgentWorkspaceLog(workspaceDir, "turn_complete_failed", *claim.AgentTurn, agentTurnReply{Kind: kind, Body: body}, err)
		log.Printf("worker %d failed to complete agent turn %s: %v", w.id, claim.AgentTurn.Turn.ID, err)
		return true
	}
	if logErr := appendAgentWorkspaceLog(workspaceDir, "turn_completed", *claim.AgentTurn, agentTurnReply{Kind: kind, Body: body}, execErr); logErr != nil {
		log.Printf("worker %d failed to append agent workspace completion log for turn %s: %v", w.id, claim.AgentTurn.Turn.ID, logErr)
	}
	log.Printf("worker %d completed agent turn %s", w.id, claim.AgentTurn.Turn.ID)
	return true
}

func (w daemonWorker) processRun(ctx context.Context) bool {
	claim, err := w.api.ClaimRun(ctx, w.runtimeID)
	if err != nil {
		if !client.IsHTTPStatus(err, 404) {
			log.Printf("worker %d run claim failed: %v", w.id, err)
		}
		return false
	}
	if !claim.Claimed || claim.Run == nil {
		return false
	}

	log.Printf("worker %d claimed run %s for task %s", w.id, claim.Run.ID, claim.Run.TaskID)
	if _, err := w.api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
		RuntimeID:     w.runtimeID,
		EventType:     "started",
		OutputPreview: "daemon started execution",
	}); err != nil {
		log.Printf("worker %d failed to post run started event: %v", w.id, err)
		return true
	}

	if strings.TrimSpace(claim.Run.RepoPath) == "" {
		w.failRun(ctx, claim.Run.ID, "run is missing repoPath")
		return true
	}
	if strings.TrimSpace(claim.Run.BranchName) == "" || strings.TrimSpace(claim.Run.BaseBranch) == "" {
		w.failRun(ctx, claim.Run.ID, "run is missing branch metadata")
		return true
	}
	if err := w.gitService.EnsureBranch(ctx, claim.Run.RepoPath, claim.Run.BaseBranch, claim.Run.BranchName); err != nil {
		w.failRun(ctx, claim.Run.ID, summarizeMergeOutput(err.Error()))
		return true
	}

	runCodexHome := w.codexHome
	runSessionKey := claim.Run.ID
	runResumeThreadID := ""
	runSessionWorkspaceDir := ""
	if claim.AgentSession != nil {
		runSessionKey = claim.AgentSession.ID
		runCodexHome = prepareSessionCodexHome(w.codexHomeRoot, *claim.AgentSession)
		if layout, err := ensureAgentSessionWorkspace(w.agentWorkspacesDir, *claim.AgentSession); err != nil {
			log.Printf("worker %d failed to ensure agent session workspace for run %s: %v", w.id, claim.Run.ID, err)
		} else {
			runSessionWorkspaceDir = layout.RoomDir
			runResumeThreadID = resolveResumeThreadID(claim.AgentSession.AppServerThreadID, layout.RoomDir)
		}
	}

	result, execErr := w.execute(ctx, provider.ExecuteRequest{
		RepoPath:       claim.Run.RepoPath,
		Instruction:    claim.Run.Instruction,
		CodexBinPath:   w.codexBin,
		SandboxMode:    w.codexSandbox,
		CodexHome:      runCodexHome,
		ExecutionKind:  "run",
		SessionKey:     runSessionKey,
		ResumeThreadID: runResumeThreadID,
	}, func(event acp.Event) error {
		switch event.Kind {
		case acp.EventStdoutChunk:
			if strings.TrimSpace(event.Content) == "" {
				return nil
			}
			stream := strings.TrimSpace(event.Stream)
			if stream == "" {
				stream = "stdout"
			}
			_, err := w.api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     w.runtimeID,
				EventType:     "output",
				OutputPreview: summarizeMergeOutput(event.Content),
				Message:       event.Content,
				Stream:        stream,
			})
			return err
		case acp.EventStderrChunk:
			if strings.TrimSpace(event.Content) == "" {
				return nil
			}
			_, err := w.api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     w.runtimeID,
				EventType:     "output",
				OutputPreview: summarizeMergeOutput(event.Content),
				Message:       event.Content,
				Stream:        "stderr",
			})
			return err
		case acp.EventToolCall:
			if event.ToolCall == nil || strings.TrimSpace(event.ToolCall.ToolName) == "" {
				return nil
			}
			_, err := w.api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID: w.runtimeID,
				EventType: "tool_call",
				ToolCall: &client.ToolCallInput{
					ToolName:  event.ToolCall.ToolName,
					Arguments: event.ToolCall.Arguments,
					Status:    event.ToolCall.Status,
				},
			})
			return err
		default:
			return nil
		}
	})
	if runSessionWorkspaceDir != "" && strings.TrimSpace(result.ProviderThreadID) != "" {
		if err := writeAppServerThreadID(runSessionWorkspaceDir, result.ProviderThreadID); err != nil {
			log.Printf("worker %d failed to persist app-server thread id for run %s: %v", w.id, claim.Run.ID, err)
		}
	}
	if execErr != nil {
		log.Printf("worker %d run %s execution failed: %v", w.id, claim.Run.ID, execErr)
		w.failRun(ctx, claim.Run.ID, summarizeFailure(result.RawOutput, execErr))
		return true
	}
	if _, err := w.gitService.CommitAll(ctx, claim.Run.RepoPath, buildRunCommitMessage(*claim.Run)); err != nil {
		w.failRun(ctx, claim.Run.ID, summarizeFailure("", err))
		return true
	}
	if _, err := w.api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
		RuntimeID:     w.runtimeID,
		EventType:     "completed",
		OutputPreview: summarizeMergeOutput(result.LastMessage),
	}); err != nil {
		log.Printf("worker %d failed to post run completed event: %v", w.id, err)
	}
	log.Printf("worker %d completed run %s on branch %s", w.id, claim.Run.ID, claim.Run.BranchName)
	return true
}

func (w daemonWorker) processMerge(ctx context.Context) bool {
	claim, err := w.api.ClaimMerge(ctx, w.runtimeID)
	if err != nil {
		if !client.IsHTTPStatus(err, 404) {
			log.Printf("worker %d merge claim failed: %v", w.id, err)
		}
		return false
	}
	if !claim.Claimed || claim.MergeAttempt == nil {
		return false
	}

	log.Printf("worker %d claimed merge attempt %s for task %s", w.id, claim.MergeAttempt.ID, claim.MergeAttempt.TaskID)
	if _, err := w.api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
		RuntimeID:     w.runtimeID,
		EventType:     "started",
		ResultSummary: "daemon started merge execution",
	}); err != nil {
		log.Printf("worker %d failed to post merge started event: %v", w.id, err)
		return true
	}
	if strings.TrimSpace(claim.MergeAttempt.RepoPath) == "" {
		if _, err := w.api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
			RuntimeID:     w.runtimeID,
			EventType:     "failed",
			ResultSummary: "merge attempt is missing repoPath",
		}); err != nil {
			log.Printf("worker %d failed to post merge failed event: %v", w.id, err)
		}
		return true
	}

	result, err := w.gitService.MergeBranch(ctx, claim.MergeAttempt.RepoPath, claim.MergeAttempt.SourceBranch, claim.MergeAttempt.TargetBranch)
	if err != nil {
		if _, postErr := w.api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
			RuntimeID:     w.runtimeID,
			EventType:     "failed",
			ResultSummary: summarizeMergeOutput(err.Error()),
		}); postErr != nil {
			log.Printf("worker %d failed to post merge failure: %v", w.id, postErr)
		}
		return true
	}

	eventType := "failed"
	switch result.Status {
	case gitops.MergeStatusSucceeded:
		eventType = "succeeded"
	case gitops.MergeStatusConflicted:
		eventType = "conflicted"
	}
	if _, err := w.api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
		RuntimeID:     w.runtimeID,
		EventType:     eventType,
		ResultSummary: summarizeMergeOutput(result.Output),
	}); err != nil {
		log.Printf("worker %d failed to post merge %s event: %v", w.id, eventType, err)
		return true
	}
	log.Printf("worker %d completed merge attempt %s with status %s", w.id, claim.MergeAttempt.ID, eventType)
	return true
}

func (w daemonWorker) execute(ctx context.Context, req provider.ExecuteRequest, handle func(acp.Event) error) (provider.ExecuteResult, error) {
	if w.executionTimeout <= 0 {
		return w.executor.Execute(ctx, req, handle)
	}
	execCtx, cancel := context.WithTimeout(ctx, w.executionTimeout)
	defer cancel()
	return w.executor.Execute(execCtx, req, handle)
}

func resolveResumeThreadID(sessionThreadID, workspaceDir string) string {
	if localThreadID, err := readAppServerThreadID(workspaceDir); err == nil {
		return localThreadID
	}
	return strings.TrimSpace(sessionThreadID)
}

func persistAgentTurnThreadState(workspaceDir, providerThreadID string, execErr error) error {
	if strings.TrimSpace(workspaceDir) == "" {
		return nil
	}
	if execErr != nil {
		return writeAppServerThreadID(workspaceDir, "")
	}
	if strings.TrimSpace(providerThreadID) == "" {
		return nil
	}
	return writeAppServerThreadID(workspaceDir, providerThreadID)
}

func (w daemonWorker) failRun(ctx context.Context, runID, summary string) {
	if _, err := w.api.PostRunEvent(ctx, runID, client.RunEventRequest{
		RuntimeID:     w.runtimeID,
		EventType:     "failed",
		OutputPreview: summary,
	}); err != nil {
		log.Printf("worker %d failed to post run failure for %s: %v", w.id, runID, err)
	}
}

func startHeartbeatLoop(ctx context.Context, api *client.Client, runtimeID string) {
	if _, err := api.HeartbeatRuntime(ctx, runtimeID, client.RuntimeHeartbeatRequest{Status: "online"}); err != nil {
		log.Printf("heartbeat failed: %v", err)
	}

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := api.HeartbeatRuntime(ctx, runtimeID, client.RuntimeHeartbeatRequest{Status: "online"}); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("heartbeat failed: %v", err)
				}
			}
		}
	}()
}

func defaultCodexHome() string {
	return ""
}

func workerCodexHome(base string, workerID int) string {
	trimmed := strings.TrimSpace(base)
	if trimmed == "" {
		return ""
	}
	path := filepath.Join(trimmed, fmt.Sprintf("worker-%02d", workerID))
	if err := os.MkdirAll(path, 0o755); err != nil {
		return trimmed
	}
	return path
}

func codexHomeForAgentSession(base string, session client.AgentSession) string {
	trimmed := strings.TrimSpace(base)
	if trimmed == "" {
		return ""
	}
	layout := buildAgentWorkspaceLayout(filepath.Join(trimmed, "sessions"), session)
	path := layout.RoomDir
	if err := os.MkdirAll(path, 0o755); err != nil {
		return trimmed
	}
	return path
}

func prepareSessionCodexHome(base string, session client.AgentSession) string {
	if strings.TrimSpace(base) == "" {
		return ""
	}
	path := codexHomeForAgentSession(base, session)
	if path == "" {
		return path
	}
	if err := syncCodexHomeFiles(base, path); err != nil {
		log.Printf("failed to sync session codex home %s: %v", path, err)
	}
	return path
}

func syncCodexHomeFiles(base, target string) error {
	sourceRoot := strings.TrimSpace(base)
	if sourceRoot == "" {
		return nil
	}
	targetRoot := strings.TrimSpace(target)
	if targetRoot == "" || targetRoot == sourceRoot {
		return nil
	}
	if err := os.MkdirAll(targetRoot, 0o755); err != nil {
		return err
	}
	for _, name := range []string{"config.toml", "auth.json"} {
		if err := copyCodexHomeFile(filepath.Join(sourceRoot, name), filepath.Join(targetRoot, name)); err != nil {
			return err
		}
	}
	return nil
}

func copyCodexHomeFile(source, target string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return os.WriteFile(target, data, 0o600)
}

func durationEnvOr(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envOr(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func ensureOpenShockCLIOnPath() error {
	if _, err := exec.LookPath("openshock"); err == nil {
		return nil
	}

	if executablePath, err := os.Executable(); err == nil {
		executableDir := filepath.Dir(executablePath)
		siblingPath := filepath.Join(executableDir, "openshock")
		if info, statErr := os.Stat(siblingPath); statErr == nil && !info.IsDir() {
			return prependPath(executableDir)
		}
	}

	moduleDir, err := daemonModuleDir()
	if err != nil {
		return err
	}

	if _, err := exec.LookPath("go"); err != nil {
		return err
	}

	toolDir := filepath.Join(os.TempDir(), "openshock-daemon-tools")
	if err := os.MkdirAll(toolDir, 0o755); err != nil {
		return err
	}

	outputPath := filepath.Join(toolDir, "openshock")
	if runtime.GOOS == "windows" {
		outputPath += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", outputPath, "./cmd/openshock")
	cmd.Dir = moduleDir
	if output, err := cmd.CombinedOutput(); err != nil {
		return wrapCommandError("build openshock cli", output, err)
	}
	return prependPath(toolDir)
}

func prependPath(dir string) error {
	trimmedDir := strings.TrimSpace(dir)
	if trimmedDir == "" {
		return nil
	}
	entries := filepath.SplitList(os.Getenv("PATH"))
	for _, entry := range entries {
		if entry == trimmedDir {
			return nil
		}
	}
	pathValue := trimmedDir
	if existing := os.Getenv("PATH"); strings.TrimSpace(existing) != "" {
		pathValue += string(os.PathListSeparator) + existing
	}
	return os.Setenv("PATH", pathValue)
}

func daemonModuleDir() (string, error) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "", os.ErrNotExist
	}
	return filepath.Dir(filepath.Dir(filepath.Dir(filename))), nil
}

func wrapCommandError(prefix string, output []byte, err error) error {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return err
	}
	return &commandError{prefix: prefix, cause: err, output: trimmed}
}

type commandError struct {
	prefix string
	cause  error
	output string
}

func (e *commandError) Error() string {
	if e == nil {
		return ""
	}
	return e.prefix + ": " + e.output
}

func (e *commandError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

func summarizeMergeOutput(value string) string {
	summary := strings.TrimSpace(value)
	if summary == "" {
		return "merge completed without output"
	}
	const maxLen = 240
	if len(summary) <= maxLen {
		return summary
	}
	return summary[:maxLen]
}

func summarizeFailure(rawOutput string, err error) string {
	summary := strings.TrimSpace(rawOutput)
	if summary != "" {
		return summarizeMergeOutput(summary)
	}
	if err == nil {
		return "run failed without output"
	}
	return summarizeMergeOutput(err.Error())
}

type agentTurnReply struct {
	Kind string
	Body string
}

func parseAgentTurnReply(raw string) agentTurnReply {
	text := strings.TrimSpace(raw)
	if text == "" {
		return agentTurnReply{Kind: "done", Body: ""}
	}

	reply := agentTurnReply{Kind: "done", Body: text}
	lines := strings.Split(text, "\n")
	bodyStart := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "kind:") {
			if kind := normalizeAgentReplyKind(strings.TrimSpace(trimmed[len("kind:"):])); kind != "" {
				reply.Kind = kind
			}
			continue
		}
		if strings.HasPrefix(lower, "result:") {
			if kind := normalizeAgentReplyKind(strings.TrimSpace(trimmed[len("result:"):])); kind != "" {
				reply.Kind = kind
			}
			continue
		}
		if strings.EqualFold(trimmed, "body:") {
			bodyStart = i + 1
			break
		}
	}

	if bodyStart >= 0 && bodyStart <= len(lines) {
		reply.Body = strings.TrimSpace(strings.Join(lines[bodyStart:], "\n"))
	}
	return reply
}

func normalizedWakeupMode(execution client.AgentTurnExecution) string {
	mode := strings.TrimSpace(execution.Turn.WakeupMode)
	if mode != "" {
		return mode
	}
	switch strings.TrimSpace(execution.Turn.IntentType) {
	case "handoff_response":
		return "handoff_response"
	default:
		return "direct_message"
	}
}

func normalizeAgentReplyKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "done", "handoff", "blocked", "no_response":
		return strings.ToLower(strings.TrimSpace(kind))
	case "message", "summary":
		return "done"
	default:
		return ""
	}
}

func shouldPostVisibleAgentReply(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "handoff", "blocked":
		return true
	default:
		return false
	}
}

func extractMentionSignals(body string) []string {
	seen := make(map[string]struct{})
	mentions := make([]string, 0, 2)
	for _, token := range strings.Fields(body) {
		if !strings.HasPrefix(token, "@") {
			continue
		}
		cleaned := strings.Trim(token, " \t\r\n,.;:!?()[]{}<>\"'，。；：！？、")
		if cleaned == "" || cleaned == "@" {
			continue
		}
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		mentions = append(mentions, cleaned)
	}
	return mentions
}

func actionEntityID(resp client.ActionResponse, entityType string) string {
	for _, entity := range resp.AffectedEntities {
		if entity.Type == entityType {
			return entity.ID
		}
	}
	return ""
}

func buildRunCommitMessage(run client.Run) string {
	title := strings.TrimSpace(run.Title)
	if title == "" {
		title = run.TaskID
	}
	return "OpenShock: " + title
}
