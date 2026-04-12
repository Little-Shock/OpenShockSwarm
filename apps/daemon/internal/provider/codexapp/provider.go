package codexapp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"openshock/daemon/internal/acp"
	"openshock/daemon/internal/provider"
)

type Options struct {
	CodexBinPath       string
	CodexHome          string
	ResumeStallTimeout time.Duration
}

type Executor struct {
	mu                 sync.Mutex
	binPath            string
	codexHome          string
	resumeStallTimeout time.Duration
	cmd                *exec.Cmd
	stdin              io.WriteCloser
	stdout             *bufio.Reader
	stderrDone         chan struct{}
	queued             []rpcEnvelope
	nextRequest        int
}

const defaultResumeStallTimeout = 15 * time.Second

type rpcEnvelope struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Result json.RawMessage `json:"result"`
	Error  *rpcError       `json:"error"`
	Params json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type initializeResponse struct {
	UserAgent string `json:"userAgent"`
}

type threadResponse struct {
	Thread struct {
		ID string `json:"id"`
	} `json:"thread"`
}

type turnStartResponse struct {
	Turn struct {
		ID string `json:"id"`
	} `json:"turn"`
}

type agentMessageDelta struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
	ItemID   string `json:"itemId"`
	Delta    string `json:"delta"`
}

type commandOutputDelta struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
	ItemID   string `json:"itemId"`
	Delta    string `json:"delta"`
}

type threadStatusChanged struct {
	ThreadID string `json:"threadId"`
	Status   struct {
		Type string `json:"type"`
	} `json:"status"`
}

type turnCompleted struct {
	ThreadID string `json:"threadId"`
	Turn     struct {
		ID string `json:"id"`
	} `json:"turn"`
}

type itemNotification struct {
	ThreadID string          `json:"threadId"`
	TurnID   string          `json:"turnId"`
	Item     json.RawMessage `json:"item"`
}

type threadItem struct {
	Type             string `json:"type"`
	ID               string `json:"id"`
	Text             string `json:"text"`
	Command          string `json:"command"`
	Status           string `json:"status"`
	AggregatedOutput string `json:"aggregatedOutput"`
}

func NewExecutor(options Options) (*Executor, error) {
	executor := &Executor{
		binPath:            strings.TrimSpace(options.CodexBinPath),
		codexHome:          strings.TrimSpace(options.CodexHome),
		resumeStallTimeout: options.ResumeStallTimeout,
		stderrDone:         make(chan struct{}),
		nextRequest:        1,
	}
	if executor.binPath == "" {
		executor.binPath = "codex"
	}
	if executor.resumeStallTimeout <= 0 {
		executor.resumeStallTimeout = defaultResumeStallTimeout
	}
	if err := executor.start(); err != nil {
		return nil, err
	}
	return executor, nil
}

func (e *Executor) Execute(ctx context.Context, req provider.ExecuteRequest, handle func(acp.Event) error) (provider.ExecuteResult, error) {
	if retryCtx, cancel, ok := e.resumeAttemptContext(ctx, req); ok {
		result, err := e.executeOnce(retryCtx, req, handle)
		cancel()
		if !shouldRetryWithoutResume(ctx, req, result, err) {
			return result, err
		}

		freshReq := req
		freshReq.ResumeThreadID = ""
		return e.executeOnce(ctx, freshReq, handle)
	}
	return e.executeOnce(ctx, req, handle)
}

func (e *Executor) executeOnce(ctx context.Context, req provider.ExecuteRequest, handle func(acp.Event) error) (provider.ExecuteResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if err := e.ensureStartedLocked(); err != nil {
		return provider.ExecuteResult{}, err
	}
	if strings.TrimSpace(req.RepoPath) == "" {
		return provider.ExecuteResult{}, errors.New("repoPath is required")
	}
	if strings.TrimSpace(req.Instruction) == "" {
		return provider.ExecuteResult{}, errors.New("instruction is required")
	}

	if codexHome := strings.TrimSpace(req.CodexHome); codexHome != "" && codexHome != e.codexHome {
		if err := e.restartLocked(codexHome); err != nil {
			return provider.ExecuteResult{}, err
		}
	}

	process := e.processLocked()
	if process == nil {
		return provider.ExecuteResult{}, errors.New("app-server process is unavailable")
	}
	cancelled := make(chan struct{})
	go func(proc *os.Process) {
		select {
		case <-ctx.Done():
			killProcessGroup(proc)
		case <-cancelled:
		}
	}(process)
	defer close(cancelled)

	result := provider.ExecuteResult{}
	var rawOutput strings.Builder

	threadID, err := e.prepareThreadLocked(req, &rawOutput)
	if err != nil {
		e.resetLocked()
		return result, err
	}
	result.ProviderThreadID = threadID

	turnID, err := e.startTurnLocked(req, threadID, &rawOutput)
	if err != nil {
		e.resetLocked()
		return result, err
	}
	result.ProviderTurnID = turnID

	for {
		envelope, err := e.nextExecutionEnvelopeLocked(&rawOutput)
		if err != nil {
			e.resetLocked()
			if errors.Is(ctx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
				if strings.TrimSpace(result.LastMessage) != "" {
					result.RawOutput = strings.TrimSpace(rawOutput.String())
					return result, nil
				}
				return result, ctx.Err()
			}
			return result, err
		}
		completed, err := e.handleNotificationLocked(envelope, threadID, turnID, &result, handle)
		if err != nil {
			e.resetLocked()
			return result, err
		}
		if completed {
			result.RawOutput = strings.TrimSpace(rawOutput.String())
			return result, nil
		}
	}
}

func (e *Executor) resumeAttemptContext(parent context.Context, req provider.ExecuteRequest) (context.Context, context.CancelFunc, bool) {
	if strings.TrimSpace(req.ResumeThreadID) == "" || e.resumeStallTimeout <= 0 {
		return nil, nil, false
	}

	timeout := e.resumeStallTimeout
	if deadline, ok := parent.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, nil, false
		}
		if remaining <= timeout {
			timeout = remaining / 2
		}
		if timeout <= 0 {
			return nil, nil, false
		}
	}

	ctx, cancel := context.WithTimeout(parent, timeout)
	return ctx, cancel, true
}

func (e *Executor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.resetLocked()
	return nil
}

func shouldRetryWithoutResume(parent context.Context, req provider.ExecuteRequest, result provider.ExecuteResult, err error) bool {
	if strings.TrimSpace(req.ResumeThreadID) == "" {
		return false
	}
	if err == nil || parent.Err() != nil {
		return false
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if strings.TrimSpace(result.LastMessage) != "" {
		return false
	}
	return strings.TrimSpace(result.ProviderThreadID) == strings.TrimSpace(req.ResumeThreadID)
}

func (e *Executor) start() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ensureStartedLocked()
}

func (e *Executor) ensureStartedLocked() error {
	if e.cmd != nil && e.cmd.Process != nil {
		return nil
	}

	cmd := exec.Command(e.binPath, "app-server", "--listen", "stdio://")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Env = append(os.Environ(), "OTEL_SDK_DISABLED=true")
	if strings.TrimSpace(e.codexHome) != "" {
		cmd.Env = append(cmd.Env, "CODEX_HOME="+e.codexHome)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	e.cmd = cmd
	e.stdin = stdin
	e.stdout = bufio.NewReader(stdout)
	e.stderrDone = make(chan struct{})
	go e.drainStderr(stderr, e.stderrDone)

	if _, err := e.callLocked("initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "openshock-daemon",
			"version": "0.1",
		},
		"capabilities": nil,
	}); err != nil {
		e.resetLocked()
		return err
	}
	return nil
}

func (e *Executor) restartLocked(codexHome string) error {
	e.resetLocked()
	e.codexHome = codexHome
	return e.ensureStartedLocked()
}

func (e *Executor) resetLocked() {
	if e.stdin != nil {
		_ = e.stdin.Close()
	}
	if e.cmd != nil && e.cmd.Process != nil {
		killProcessGroup(e.cmd.Process)
		_, _ = e.cmd.Process.Wait()
	}
	if e.stderrDone != nil {
		close(e.stderrDone)
		e.stderrDone = nil
	}
	e.cmd = nil
	e.stdin = nil
	e.stdout = nil
	e.queued = nil
}

func (e *Executor) processLocked() *os.Process {
	if e.cmd == nil {
		return nil
	}
	return e.cmd.Process
}

func killProcessGroup(proc *os.Process) {
	if proc == nil {
		return
	}
	if proc.Pid > 0 {
		_ = syscall.Kill(-proc.Pid, syscall.SIGKILL)
	}
	_ = proc.Kill()
}

func (e *Executor) prepareThreadLocked(req provider.ExecuteRequest, rawOutput *strings.Builder) (string, error) {
	if resumeID := strings.TrimSpace(req.ResumeThreadID); resumeID != "" {
		result, err := e.callLocked("thread/resume", map[string]any{
			"threadId":               resumeID,
			"persistExtendedHistory": false,
			"cwd":                    req.RepoPath,
			"approvalPolicy":         "never",
			"sandbox":                normalizedSandboxMode(req.SandboxMode),
		})
		if err == nil {
			var payload threadResponse
			if decodeErr := json.Unmarshal(result, &payload); decodeErr == nil && strings.TrimSpace(payload.Thread.ID) != "" {
				return payload.Thread.ID, nil
			}
		}
	}

	result, err := e.callLocked("thread/start", map[string]any{
		"cwd":            req.RepoPath,
		"approvalPolicy": "never",
		"sandbox":        normalizedSandboxMode(req.SandboxMode),
		"ephemeral":      false,
	})
	if err != nil {
		return "", err
	}
	var payload threadResponse
	if err := json.Unmarshal(result, &payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Thread.ID) == "" {
		return "", errors.New("thread/start returned an empty thread id")
	}
	appendRawOutput(rawOutput, string(result))
	return payload.Thread.ID, nil
}

func (e *Executor) startTurnLocked(req provider.ExecuteRequest, threadID string, rawOutput *strings.Builder) (string, error) {
	result, err := e.callLocked("turn/start", map[string]any{
		"threadId": threadID,
		"input": []map[string]any{
			{
				"type":          "text",
				"text":          req.Instruction,
				"text_elements": []any{},
			},
		},
		"sandboxPolicy": sandboxPolicyFor(req.SandboxMode, req.RepoPath),
	})
	if err != nil {
		return "", err
	}
	var payload turnStartResponse
	if err := json.Unmarshal(result, &payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Turn.ID) == "" {
		return "", errors.New("turn/start returned an empty turn id")
	}
	appendRawOutput(rawOutput, string(result))
	return payload.Turn.ID, nil
}

func (e *Executor) nextExecutionEnvelopeLocked(rawOutput *strings.Builder) (rpcEnvelope, error) {
	if len(e.queued) > 0 {
		envelope := e.queued[0]
		e.queued = e.queued[1:]
		appendRawOutput(rawOutput, marshalEnvelope(envelope))
		return envelope, nil
	}

	line, err := e.stdout.ReadString('\n')
	if err != nil {
		return rpcEnvelope{}, err
	}
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return e.nextExecutionEnvelopeLocked(rawOutput)
	}

	var envelope rpcEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		appendRawOutput(rawOutput, trimmed)
		return rpcEnvelope{}, nil
	}
	appendRawOutput(rawOutput, trimmed)
	return envelope, nil
}

func (e *Executor) callLocked(method string, params any) (json.RawMessage, error) {
	requestID := e.nextRequest
	e.nextRequest++

	request := map[string]any{
		"jsonrpc": "2.0",
		"id":      requestID,
		"method":  method,
		"params":  params,
	}
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	if _, err := e.stdin.Write(append(data, '\n')); err != nil {
		return nil, err
	}

	for {
		envelope, err := e.readEnvelopeLocked()
		if err != nil {
			return nil, err
		}
		if len(envelope.ID) == 0 {
			e.queued = append(e.queued, envelope)
			continue
		}
		if rpcIDEquals(envelope.ID, requestID) {
			if envelope.Error != nil {
				return nil, fmt.Errorf("app-server %s failed: %s", method, envelope.Error.Message)
			}
			return envelope.Result, nil
		}
	}
}

func (e *Executor) readEnvelopeLocked() (rpcEnvelope, error) {
	line, err := e.stdout.ReadString('\n')
	if err != nil {
		return rpcEnvelope{}, err
	}
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return e.readEnvelopeLocked()
	}
	var envelope rpcEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return rpcEnvelope{}, err
	}
	return envelope, nil
}

func (e *Executor) handleNotificationLocked(envelope rpcEnvelope, threadID, turnID string, result *provider.ExecuteResult, handle func(acp.Event) error) (bool, error) {
	if envelope.Error != nil {
		return false, errors.New(envelope.Error.Message)
	}
	if strings.TrimSpace(envelope.Method) == "" {
		return false, nil
	}

	switch envelope.Method {
	case "item/agentMessage/delta":
		var payload agentMessageDelta
		if err := json.Unmarshal(envelope.Params, &payload); err != nil {
			return false, err
		}
		if payload.ThreadID != threadID || payload.TurnID != turnID || strings.TrimSpace(payload.Delta) == "" {
			return false, nil
		}
		if handle == nil {
			return false, nil
		}
		return false, handle(acp.Event{Kind: acp.EventStdoutChunk, Content: payload.Delta, Stream: "session"})
	case "item/commandExecution/outputDelta", "command/exec/outputDelta":
		var payload commandOutputDelta
		if err := json.Unmarshal(envelope.Params, &payload); err != nil {
			return false, err
		}
		if payload.ThreadID != threadID || payload.TurnID != turnID || strings.TrimSpace(payload.Delta) == "" || handle == nil {
			return false, nil
		}
		return false, handle(acp.Event{Kind: acp.EventStdoutChunk, Content: payload.Delta, Stream: "stdout"})
	case "item/started", "item/completed":
		var payload itemNotification
		if err := json.Unmarshal(envelope.Params, &payload); err != nil {
			return false, err
		}
		if payload.ThreadID != threadID || payload.TurnID != turnID {
			return false, nil
		}
		return false, handleItemNotification(envelope.Method, payload, result, handle)
	case "turn/completed":
		var payload turnCompleted
		if err := json.Unmarshal(envelope.Params, &payload); err != nil {
			return false, err
		}
		if payload.ThreadID != threadID || payload.Turn.ID != turnID {
			return false, nil
		}
		return true, nil
	case "thread/status/changed":
		var payload threadStatusChanged
		if err := json.Unmarshal(envelope.Params, &payload); err != nil {
			return false, err
		}
		if payload.ThreadID != threadID {
			return false, nil
		}
		if payload.Status.Type == "idle" && strings.TrimSpace(result.LastMessage) != "" {
			return true, nil
		}
		return false, nil
	default:
		return false, nil
	}
}

func handleItemNotification(method string, payload itemNotification, result *provider.ExecuteResult, handle func(acp.Event) error) error {
	var item threadItem
	if err := json.Unmarshal(payload.Item, &item); err != nil {
		return err
	}

	switch item.Type {
	case "agentMessage":
		if method == "item/completed" && strings.TrimSpace(item.Text) != "" {
			result.LastMessage = item.Text
		}
	case "commandExecution":
		if handle == nil || strings.TrimSpace(item.Command) == "" {
			return nil
		}
		return handle(acp.Event{
			Kind: acp.EventToolCall,
			ToolCall: &acp.ToolCall{
				ToolName:  "shell",
				Arguments: item.Command,
				Status:    normalizedStatus(item.Status),
			},
		})
	}

	return nil
}

func rpcIDEquals(raw json.RawMessage, expected int) bool {
	var numeric int
	if err := json.Unmarshal(raw, &numeric); err == nil {
		return numeric == expected
	}
	var stringID string
	if err := json.Unmarshal(raw, &stringID); err == nil {
		return stringID == fmt.Sprintf("%d", expected)
	}
	return false
}

func normalizedStatus(value string) string {
	status := strings.TrimSpace(value)
	if status == "" {
		return "completed"
	}
	return strings.ToLower(status[:1]) + status[1:]
}

func normalizedSandboxMode(value string) string {
	switch strings.TrimSpace(value) {
	case "read-only", "workspace-write", "danger-full-access":
		return strings.TrimSpace(value)
	default:
		return "danger-full-access"
	}
}

func sandboxPolicyFor(mode, repoPath string) map[string]any {
	switch normalizedSandboxMode(mode) {
	case "read-only":
		return map[string]any{
			"type":          "readOnly",
			"access":        map[string]any{"type": "fullAccess"},
			"networkAccess": true,
		}
	case "workspace-write":
		return map[string]any{
			"type":                "workspaceWrite",
			"writableRoots":       []string{repoPath},
			"readOnlyAccess":      map[string]any{"type": "fullAccess"},
			"networkAccess":       true,
			"excludeTmpdirEnvVar": false,
			"excludeSlashTmp":     false,
		}
	default:
		return map[string]any{"type": "dangerFullAccess"}
	}
}

func appendRawOutput(builder *strings.Builder, line string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}
	builder.WriteString(trimmed)
	builder.WriteString("\n")
}

func marshalEnvelope(envelope rpcEnvelope) string {
	data, err := json.Marshal(envelope)
	if err != nil {
		return ""
	}
	return string(data)
}

func (e *Executor) drainStderr(stderr io.Reader, done <-chan struct{}) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		select {
		case <-done:
			return
		default:
		}
	}
}
