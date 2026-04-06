package runtime

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type Heartbeat struct {
	Machine       string     `json:"machine"`
	DetectedCLI   []string   `json:"detectedCli"`
	Providers     []Provider `json:"providers"`
	State         string     `json:"state"`
	WorkspaceRoot string     `json:"workspaceRoot"`
	ReportedAt    string     `json:"reportedAt"`
}

type Provider struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	Mode         string   `json:"mode"`
	Capabilities []string `json:"capabilities"`
	Transport    string   `json:"transport"`
}

type ExecRequest struct {
	Provider string `json:"provider"`
	Prompt   string `json:"prompt"`
	Cwd      string `json:"cwd"`
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
	machine string
	root    string
}

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

func NewService(machine, root string) *Service {
	return &Service{machine: machine, root: root}
}

func (s *Service) Snapshot() Heartbeat {
	return Heartbeat{
		Machine:       s.machine,
		DetectedCLI:   detectCLI(),
		Providers:     detectProviders(),
		State:         "online",
		WorkspaceRoot: s.root,
		ReportedAt:    time.Now().UTC().Format(time.RFC3339),
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

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
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

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
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
			Transport: "http bridge",
		})
	}
	return providers
}

func buildCommand(req ExecRequest) (execPlan, error) {
	switch strings.ToLower(strings.TrimSpace(req.Provider)) {
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

func findClaudeCLI() (string, bool) {
	for _, candidate := range []string{"claude", "claude-code"} {
		if _, err := exec.LookPath(candidate); err == nil {
			return candidate, true
		}
	}
	return "claude", false
}
