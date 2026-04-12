package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Heartbeat struct {
	RuntimeID          string     `json:"runtimeId"`
	DaemonURL          string     `json:"daemonUrl,omitempty"`
	Machine            string     `json:"machine"`
	DetectedCLI        []string   `json:"detectedCli"`
	Providers          []Provider `json:"providers"`
	Shell              string     `json:"shell,omitempty"`
	State              string     `json:"state"`
	WorkspaceRoot      string     `json:"workspaceRoot"`
	ReportedAt         string     `json:"reportedAt"`
	HeartbeatIntervalS int        `json:"heartbeatIntervalSeconds,omitempty"`
	HeartbeatTimeoutS  int        `json:"heartbeatTimeoutSeconds,omitempty"`
}

type Provider struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Mode          string   `json:"mode"`
	Capabilities  []string `json:"capabilities"`
	Models        []string `json:"models,omitempty"`
	Transport     string   `json:"transport"`
	Ready         bool     `json:"ready,omitempty"`
	Status        string   `json:"status,omitempty"`
	StatusMessage string   `json:"statusMessage,omitempty"`
	CheckedAt     string   `json:"checkedAt,omitempty"`
}

type ExecRequest struct {
	Provider       string `json:"provider"`
	Prompt         string `json:"prompt"`
	Cwd            string `json:"cwd"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty"`
	LeaseID        string `json:"leaseId,omitempty"`
	RunID          string `json:"runId,omitempty"`
	SessionID      string `json:"sessionId,omitempty"`
	RoomID         string `json:"roomId,omitempty"`
	ResumeSession  bool   `json:"resumeSession,omitempty"`
}

type ExecResponse struct {
	Provider string   `json:"provider"`
	Command  []string `json:"command"`
	Output   string   `json:"output"`
	Error    string   `json:"error,omitempty"`
	Duration string   `json:"duration"`
}

type StreamEvent struct {
	Type      string   `json:"type"`
	Provider  string   `json:"provider,omitempty"`
	Command   []string `json:"command,omitempty"`
	Delta     string   `json:"delta,omitempty"`
	Output    string   `json:"output,omitempty"`
	Error     string   `json:"error,omitempty"`
	Duration  string   `json:"duration,omitempty"`
	Timestamp string   `json:"timestamp,omitempty"`
}

type Service struct {
	runtimeID          string
	machine            string
	root               string
	daemonURL          string
	heartbeatIntervalS int
	heartbeatTimeoutS  int
}

type Option func(*Service)

type execPlan struct {
	command     []string
	outputFile  string
	cleanupFile bool
}

type streamChunk struct {
	stream string
	text   string
	err    error
}

type providerAuthProbe struct {
	Ready   bool
	Status  string
	Message string
}

type claudeAuthStatus struct {
	LoggedIn    bool   `json:"loggedIn"`
	AuthMethod  string `json:"authMethod"`
	APIProvider string `json:"apiProvider"`
}

const (
	providerStatusReady        = "ready"
	providerStatusAuthRequired = "auth_required"
	providerStatusUnavailable  = "unavailable"
	providerStatusDegraded     = "degraded"
	providerProbeTimeout       = 3 * time.Second
)

func NewService(machine, root string, options ...Option) *Service {
	service := &Service{
		runtimeID:          strings.TrimSpace(machine),
		machine:            machine,
		root:               root,
		heartbeatIntervalS: int((10 * time.Second) / time.Second),
		heartbeatTimeoutS:  int((45 * time.Second) / time.Second),
	}
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	if strings.TrimSpace(service.runtimeID) == "" {
		service.runtimeID = strings.TrimSpace(service.machine)
	}
	return service
}

func WithRuntimeID(runtimeID string) Option {
	return func(service *Service) {
		if strings.TrimSpace(runtimeID) != "" {
			service.runtimeID = strings.TrimSpace(runtimeID)
		}
	}
}

func WithDaemonURL(daemonURL string) Option {
	return func(service *Service) {
		service.daemonURL = strings.TrimRight(strings.TrimSpace(daemonURL), "/")
	}
}

func WithHeartbeatInterval(interval time.Duration) Option {
	return func(service *Service) {
		if interval > 0 {
			service.heartbeatIntervalS = int(interval / time.Second)
		}
	}
}

func WithHeartbeatTimeout(timeout time.Duration) Option {
	return func(service *Service) {
		if timeout > 0 {
			service.heartbeatTimeoutS = int(timeout / time.Second)
		}
	}
}

func (s *Service) Snapshot() Heartbeat {
	runtimeID := strings.TrimSpace(s.runtimeID)
	if runtimeID == "" {
		runtimeID = strings.TrimSpace(s.machine)
	}
	return Heartbeat{
		RuntimeID:          runtimeID,
		DaemonURL:          strings.TrimRight(strings.TrimSpace(s.daemonURL), "/"),
		Machine:            s.machine,
		DetectedCLI:        detectCLI(),
		Providers:          annotateProviderStatuses(detectProviders()),
		Shell:              detectShell(),
		State:              "online",
		WorkspaceRoot:      s.root,
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: s.heartbeatIntervalS,
		HeartbeatTimeoutS:  s.heartbeatTimeoutS,
	}
}

func (s *Service) RunPrompt(req ExecRequest) (ExecResponse, error) {
	startedAt := time.Now()
	plan, err := buildCommand(req)
	if err != nil {
		return ExecResponse{Provider: req.Provider}, err
	}
	if plan.cleanupFile {
		defer os.Remove(plan.outputFile)
	}

	ctx, cancel := context.WithTimeout(context.Background(), execTimeout(req))
	defer cancel()

	cmd := exec.CommandContext(ctx, plan.command[0], plan.command[1:]...)
	cmd.Dir = req.Cwd
	cmd.Env = os.Environ()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	output := strings.TrimSpace(stdout.String())
	if output == "" {
		output = strings.TrimSpace(stderr.String())
	}
	if plan.outputFile != "" {
		if contentBytes, readErr := os.ReadFile(plan.outputFile); readErr == nil {
			fileOutput := strings.TrimSpace(string(contentBytes))
			if fileOutput != "" {
				output = fileOutput
			}
		}
	}

	resp := ExecResponse{
		Provider: req.Provider,
		Command:  plan.command,
		Output:   output,
		Duration: time.Since(startedAt).Round(time.Millisecond).String(),
	}

	if ctx.Err() == context.DeadlineExceeded {
		return resp, context.DeadlineExceeded
	}
	if err != nil {
		if stderr.Len() > 0 {
			resp.Error = strings.TrimSpace(stderr.String())
		}
		return resp, err
	}
	return resp, nil
}

func (s *Service) StreamPrompt(req ExecRequest, emit func(StreamEvent) error) (ExecResponse, error) {
	startedAt := time.Now()
	plan, err := buildCommand(req)
	if err != nil {
		return ExecResponse{Provider: req.Provider}, err
	}
	if plan.cleanupFile {
		defer os.Remove(plan.outputFile)
	}

	ctx, cancel := context.WithTimeout(context.Background(), execTimeout(req))
	defer cancel()

	cmd := exec.CommandContext(ctx, plan.command[0], plan.command[1:]...)
	cmd.Dir = req.Cwd
	cmd.Env = os.Environ()

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return ExecResponse{Provider: req.Provider}, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return ExecResponse{Provider: req.Provider}, err
	}

	if err := cmd.Start(); err != nil {
		return ExecResponse{Provider: req.Provider}, err
	}

	if emit != nil {
		if err := emit(StreamEvent{
			Type:      "start",
			Provider:  req.Provider,
			Command:   plan.command,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		}); err != nil {
			cancel()
			return ExecResponse{Provider: req.Provider, Command: plan.command}, err
		}
	}

	chunks := make(chan streamChunk, 32)
	var stdoutBuilder strings.Builder
	var stderrBuilder strings.Builder
	var readWG sync.WaitGroup
	readWG.Add(2)

	go pumpStream("stdout", stdoutPipe, &stdoutBuilder, chunks, &readWG)
	go pumpStream("stderr", stderrPipe, &stderrBuilder, chunks, &readWG)

	waitDone := make(chan error, 1)
	go func() {
		err := cmd.Wait()
		readWG.Wait()
		close(chunks)
		waitDone <- err
	}()

	var emitErr error
	for chunk := range chunks {
		if chunk.err != nil && emitErr == nil && emit != nil {
			emitErr = emit(StreamEvent{
				Type:      "error",
				Provider:  req.Provider,
				Error:     chunk.err.Error(),
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
			if emitErr != nil {
				cancel()
			}
			continue
		}
		if strings.TrimSpace(chunk.text) == "" {
			continue
		}
		if emitErr == nil && emit != nil {
			emitErr = emit(StreamEvent{
				Type:      chunk.stream,
				Provider:  req.Provider,
				Delta:     chunk.text,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
			if emitErr != nil {
				cancel()
			}
		}
	}

	waitErr := <-waitDone
	output := strings.TrimSpace(stdoutBuilder.String())
	if output == "" {
		output = strings.TrimSpace(stderrBuilder.String())
	}
	if plan.outputFile != "" {
		if contentBytes, readErr := os.ReadFile(plan.outputFile); readErr == nil {
			fileOutput := strings.TrimSpace(string(contentBytes))
			if fileOutput != "" {
				output = fileOutput
			}
		}
	}

	resp := ExecResponse{
		Provider: req.Provider,
		Command:  plan.command,
		Output:   output,
		Duration: time.Since(startedAt).Round(time.Millisecond).String(),
	}

	if ctx.Err() == context.DeadlineExceeded {
		resp.Error = context.DeadlineExceeded.Error()
		if emitErr == nil && emit != nil {
			_ = emit(StreamEvent{
				Type:      "error",
				Provider:  req.Provider,
				Error:     resp.Error,
				Duration:  resp.Duration,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
		return resp, context.DeadlineExceeded
	}
	if waitErr != nil {
		if resp.Error == "" {
			resp.Error = strings.TrimSpace(stderrBuilder.String())
		}
		if resp.Error == "" {
			resp.Error = waitErr.Error()
		}
		if emitErr == nil && emit != nil {
			_ = emit(StreamEvent{
				Type:      "error",
				Provider:  req.Provider,
				Error:     resp.Error,
				Duration:  resp.Duration,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
		return resp, waitErr
	}
	if emitErr == nil && emit != nil {
		if err := emit(StreamEvent{
			Type:      "done",
			Provider:  req.Provider,
			Output:    resp.Output,
			Duration:  resp.Duration,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		}); err != nil {
			return resp, err
		}
	}
	if emitErr != nil {
		return resp, emitErr
	}
	return resp, nil
}

func pumpStream(stream string, reader io.Reader, builder *strings.Builder, chunks chan<- streamChunk, wg *sync.WaitGroup) {
	defer wg.Done()

	buffered := bufio.NewReader(reader)
	for {
		chunk, err := buffered.ReadString('\n')
		if len(chunk) > 0 {
			builder.WriteString(chunk)
			chunks <- streamChunk{stream: stream, text: chunk}
		}
		if err != nil {
			if err != io.EOF {
				chunks <- streamChunk{stream: stream, err: err}
			}
			return
		}
	}
}

func detectCLI() []string {
	candidates := []string{"codex", "claude", "claude-code"}
	detected := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if _, err := exec.LookPath(candidate); err == nil {
			detected = append(detected, candidate)
		}
	}
	if len(detected) == 0 {
		return []string{"none-detected"}
	}
	return detected
}

func detectProviders() []Provider {
	providers := make([]Provider, 0, 2)
	if _, err := exec.LookPath("codex"); err == nil {
		providers = append(providers, Provider{
			ID:    "codex",
			Label: "Codex CLI",
			Mode:  "direct-cli",
			Capabilities: []string{
				"conversation",
				"non-interactive-exec",
				"mcp-server",
				"app-server",
			},
			// This list is a suggestion catalog for the UI. Only CLI/provider presence is machine-derived here.
			Models:    []string{"gpt-5.2", "gpt-5.3-codex", "gpt-5.1-codex-mini"},
			Transport: "http bridge",
		})
	}
	if _, ok := findClaudeCLI(); ok {
		providers = append(providers, Provider{
			ID:    "claude",
			Label: "Claude Code CLI",
			Mode:  "direct-cli",
			Capabilities: []string{
				"conversation",
				"non-interactive-print",
				"mcp-config",
			},
			// This list is a suggestion catalog for the UI. Only CLI/provider presence is machine-derived here.
			Models:    []string{"claude-sonnet-4", "claude-opus-4.1"},
			Transport: "http bridge",
		})
	}
	return providers
}

func annotateProviderStatuses(providers []Provider) []Provider {
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	result := make([]Provider, 0, len(providers))
	for _, provider := range providers {
		probe := probeProviderAuthStatus(provider.ID)
		provider.Ready = probe.Ready
		provider.Status = probe.Status
		provider.StatusMessage = probe.Message
		provider.CheckedAt = checkedAt
		result = append(result, provider)
	}
	return result
}

func probeProviderAuthStatus(providerID string) providerAuthProbe {
	switch normalizedProviderID(providerID) {
	case "codex":
		return probeCodexAuthStatus()
	case "claude":
		return probeClaudeAuthStatus()
	default:
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusDegraded,
			Message: "当前模型服务状态还没确认。",
		}
	}
}

func probeCodexAuthStatus() providerAuthProbe {
	output, err := runProviderStatusCommand(providerProbeTimeout, "codex", "login", "status")
	lower := strings.ToLower(output)

	switch {
	case errors.Is(err, exec.ErrNotFound):
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusUnavailable,
			Message: "Codex CLI 当前未安装，请先补齐本地 CLI。",
		}
	case errors.Is(err, context.DeadlineExceeded):
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusDegraded,
			Message: "Codex CLI 状态检查超时，请稍后重试。",
		}
	case strings.Contains(lower, "logged in"):
		return providerAuthProbe{
			Ready:   true,
			Status:  providerStatusReady,
			Message: "Codex CLI 已登录，可直接发送。",
		}
	case strings.Contains(lower, "not logged"):
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusAuthRequired,
			Message: "Codex CLI 还没有登录，请先在本机完成登录。",
		}
	case err != nil:
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusDegraded,
			Message: fallbackProviderProbeMessage("Codex CLI", output, err),
		}
	default:
		return providerAuthProbe{
			Ready:   true,
			Status:  providerStatusReady,
			Message: "Codex CLI 已就绪，可直接发送。",
		}
	}
}

func probeClaudeAuthStatus() providerAuthProbe {
	output, err := runProviderStatusCommand(providerProbeTimeout, "claude", "auth", "status")
	if errors.Is(err, exec.ErrNotFound) {
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusUnavailable,
			Message: "Claude Code CLI 当前未安装，请先补齐本地 CLI。",
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusDegraded,
			Message: "Claude Code CLI 状态检查超时，请稍后重试。",
		}
	}

	var payload claudeAuthStatus
	if strings.TrimSpace(output) != "" && json.Unmarshal([]byte(output), &payload) == nil {
		if payload.LoggedIn {
			return providerAuthProbe{
				Ready:   true,
				Status:  providerStatusReady,
				Message: "Claude Code CLI 已登录，可直接发送。",
			}
		}
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusAuthRequired,
			Message: "Claude Code CLI 还没有登录，请先在本机完成登录。",
		}
	}

	if err != nil {
		return providerAuthProbe{
			Ready:   false,
			Status:  providerStatusDegraded,
			Message: fallbackProviderProbeMessage("Claude Code CLI", output, err),
		}
	}

	return providerAuthProbe{
		Ready:   false,
		Status:  providerStatusDegraded,
		Message: "Claude Code CLI 状态暂时无法确认。",
	}
}

func runProviderStatusCommand(timeout time.Duration, name string, args ...string) (string, error) {
	if _, err := exec.LookPath(name); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = os.Environ()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	output := strings.TrimSpace(stdout.String())
	if output == "" {
		output = strings.TrimSpace(stderr.String())
	}
	if ctx.Err() == context.DeadlineExceeded {
		return output, context.DeadlineExceeded
	}
	return output, err
}

func fallbackProviderProbeMessage(label, output string, err error) string {
	if text := strings.TrimSpace(output); text != "" {
		return text
	}
	if err != nil {
		return label + " 状态检查失败，请稍后重试。"
	}
	return label + " 状态暂时无法确认。"
}

func detectShell() string {
	candidates := []string{
		os.Getenv("OPENSHOCK_RUNTIME_SHELL"),
		os.Getenv("SHELL"),
		os.Getenv("COMSPEC"),
		os.Getenv("ComSpec"),
	}
	for _, candidate := range candidates {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			return filepath.Base(trimmed)
		}
	}
	if _, err := exec.LookPath("pwsh"); err == nil {
		return "pwsh"
	}
	if _, err := exec.LookPath("bash"); err == nil {
		return "bash"
	}
	return "unknown"
}

func execTimeout(req ExecRequest) time.Duration {
	if req.TimeoutSeconds > 0 {
		return time.Duration(req.TimeoutSeconds) * time.Second
	}
	return 180 * time.Second
}

func buildCommand(req ExecRequest) (execPlan, error) {
	switch normalizedProviderID(req.Provider) {
	case "claude":
		claudeCLI, _ := findClaudeCLI()
		return execPlan{
			command: []string{
				claudeCLI, "--print", req.Prompt,
				"--output-format", "text",
				"--permission-mode", "bypassPermissions",
				"--no-session-persistence",
				"--add-dir", req.Cwd,
			},
		}, nil
	default:
		outputFile, err := os.CreateTemp("", "openshock-codex-last-*.txt")
		if err != nil {
			return execPlan{}, err
		}
		_ = outputFile.Close()
		if shouldResumeCodexSession(req) {
			return execPlan{
				command: []string{
					"codex", "exec", "resume",
					"--last",
					"--skip-git-repo-check",
					"--output-last-message", outputFile.Name(),
					req.Prompt,
				},
				outputFile:  outputFile.Name(),
				cleanupFile: true,
			}, nil
		}
		return execPlan{
			command: []string{
				"codex", "exec", req.Prompt,
				"--skip-git-repo-check",
				"--sandbox", "read-only",
				"-C", req.Cwd,
				"--output-last-message", outputFile.Name(),
			},
			outputFile:  outputFile.Name(),
			cleanupFile: true,
		}, nil
	}
}

func shouldResumeCodexSession(req ExecRequest) bool {
	return req.ResumeSession && strings.TrimSpace(req.Cwd) != ""
}

func normalizedProviderID(value string) string {
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

func findClaudeCLI() (string, bool) {
	for _, candidate := range []string{"claude", "claude-code"} {
		if _, err := exec.LookPath(candidate); err == nil {
			return candidate, true
		}
	}
	return "claude", false
}
