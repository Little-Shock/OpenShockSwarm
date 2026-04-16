package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"
	"time"
)

func TestBuildCommandClaudeUsesPrintMode(t *testing.T) {
	req := ExecRequest{
		Provider: "claude",
		Prompt:   "Reply exactly: daemon-ready",
		Cwd:      t.TempDir(),
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}

	if plan.command[0] != "claude" {
		t.Fatalf("claude command = %q, want claude", plan.command[0])
	}
	if !containsArg(plan.command, "--print") {
		t.Fatalf("claude command = %#v, want --print", plan.command)
	}
	if containsArg(plan.command, "--bare") {
		t.Fatalf("claude command = %#v, should not contain deprecated --bare", plan.command)
	}
	if !containsArg(plan.command, req.Prompt) {
		t.Fatalf("claude command = %#v, want prompt", plan.command)
	}
}

func TestBuildCommandClaudeFallsBackToClaudeCodeAlias(t *testing.T) {
	tmp := t.TempDir()
	writeExecutable(t, filepath.Join(tmp, "claude-code"))
	t.Setenv("PATH", tmp)

	req := ExecRequest{
		Provider: "claude",
		Prompt:   "alias fallback",
		Cwd:      tmp,
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}

	if plan.command[0] != "claude-code" {
		t.Fatalf("claude alias command = %q, want claude-code", plan.command[0])
	}

	providers := detectProviders()
	if len(providers) != 1 || providers[0].ID != "claude" {
		t.Fatalf("detectProviders() = %#v, want claude provider via alias", providers)
	}

	detected := detectCLI()
	if len(detected) != 1 || detected[0] != "claude-code" {
		t.Fatalf("detectCLI() = %#v, want claude-code alias", detected)
	}
}

func TestBuildCommandCodexUsesOutputFile(t *testing.T) {
	req := ExecRequest{
		Provider: "codex",
		Prompt:   "Reply exactly: daemon-ready",
		Cwd:      t.TempDir(),
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}
	defer os.Remove(plan.outputFile)

	if plan.command[0] != "codex" {
		t.Fatalf("codex command = %q, want codex", plan.command[0])
	}
	if !containsArg(plan.command, "--output-last-message") {
		t.Fatalf("codex command = %#v, want --output-last-message", plan.command)
	}
	if strings.TrimSpace(plan.outputFile) == "" {
		t.Fatalf("output file should not be empty")
	}
	if !plan.cleanupFile {
		t.Fatalf("cleanupFile = false, want true")
	}
}

func TestBuildCommandCodexResumeUsesLastSessionInLane(t *testing.T) {
	req := ExecRequest{
		Provider:      "codex",
		Prompt:        "Continue from the current lane",
		Cwd:           t.TempDir(),
		ResumeSession: true,
	}

	plan, err := buildCommand(req)
	if err != nil {
		t.Fatalf("buildCommand() error = %v", err)
	}
	defer os.Remove(plan.outputFile)

	wantPrefix := []string{"codex", "exec", "resume", "--last"}
	for index, want := range wantPrefix {
		if plan.command[index] != want {
			t.Fatalf("resume command prefix = %#v, want %#v", plan.command, wantPrefix)
		}
	}
	if containsArg(plan.command, "--sandbox") {
		t.Fatalf("resume command = %#v, should not contain unsupported --sandbox flag", plan.command)
	}
	if containsArg(plan.command, "-C") {
		t.Fatalf("resume command = %#v, should rely on cmd.Dir instead of -C", plan.command)
	}
	if !containsArg(plan.command, "--output-last-message") {
		t.Fatalf("resume command = %#v, want --output-last-message", plan.command)
	}
}

func TestBuildCommandNormalizesProviderLabels(t *testing.T) {
	claudePlan, err := buildCommand(ExecRequest{
		Provider: "Claude Code CLI",
		Prompt:   "reply",
		Cwd:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("buildCommand() with Claude label error = %v", err)
	}
	if claudePlan.command[0] != "claude" {
		t.Fatalf("claude label command = %q, want claude", claudePlan.command[0])
	}

	codexPlan, err := buildCommand(ExecRequest{
		Provider: "Codex CLI",
		Prompt:   "reply",
		Cwd:      t.TempDir(),
	})
	if err != nil {
		t.Fatalf("buildCommand() with Codex label error = %v", err)
	}
	defer os.Remove(codexPlan.outputFile)
	if codexPlan.command[0] != "codex" {
		t.Fatalf("codex label command = %q, want codex", codexPlan.command[0])
	}
}

func TestSnapshotIncludesRuntimeRegistrationMetadata(t *testing.T) {
	service := NewService("shock-sidecar", t.TempDir(),
		WithRuntimeID("shock-sidecar"),
		WithDaemonURL("http://127.0.0.1:8091"),
		WithHeartbeatInterval(12*time.Second),
		WithHeartbeatTimeout(48*time.Second),
	)

	snapshot := service.Snapshot()
	if snapshot.RuntimeID != "shock-sidecar" {
		t.Fatalf("runtime id = %q, want shock-sidecar", snapshot.RuntimeID)
	}
	if snapshot.DaemonURL != "http://127.0.0.1:8091" {
		t.Fatalf("daemon url = %q, want http://127.0.0.1:8091", snapshot.DaemonURL)
	}
	if snapshot.HeartbeatIntervalS != 12 || snapshot.HeartbeatTimeoutS != 48 {
		t.Fatalf("heartbeat metadata = %#v, want interval=12 timeout=48", snapshot)
	}
}

func TestAnnotateProviderStatusesUsesAuthTruth(t *testing.T) {
	tmp := t.TempDir()
	writeExecutableWithContent(t, filepath.Join(tmp, "codex"), "#!/bin/sh\nprintf 'Logged in using an API key\\n'\n")
	writeExecutableWithContent(t, filepath.Join(tmp, "claude"), "#!/bin/sh\nprintf '{\"loggedIn\":false,\"authMethod\":\"none\",\"apiProvider\":\"firstParty\"}\\n'\nexit 1\n")
	t.Setenv("PATH", tmp)

	providers := annotateProviderStatuses([]Provider{
		{ID: "codex", Label: "Codex CLI"},
		{ID: "claude", Label: "Claude Code CLI"},
	})

	if len(providers) != 2 {
		t.Fatalf("providers length = %d, want 2", len(providers))
	}
	if !providers[0].Ready || providers[0].Status != providerStatusReady {
		t.Fatalf("codex provider = %#v, want ready status", providers[0])
	}
	if providers[1].Ready || providers[1].Status != providerStatusAuthRequired {
		t.Fatalf("claude provider = %#v, want auth_required status", providers[1])
	}
}

func TestRunPromptPersistsSessionWorkspaceEnvelope(t *testing.T) {
	root := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(t, cliDir, "claude", "#!/bin/sh\nprintf 'daemon-ready\\n'\n", "@echo off\r\necho daemon-ready\r\n")
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	service := NewService("daemon-test", root)
	resp, err := service.RunPrompt(ExecRequest{
		Provider:  "claude",
		Prompt:    "first turn prompt",
		Cwd:       cwd,
		SessionID: "session-runtime",
		RunID:     "run-runtime-01",
		RoomID:    "room-runtime",
	})
	if err != nil {
		t.Fatalf("RunPrompt() error = %v", err)
	}
	if !strings.Contains(resp.Output, "daemon-ready") {
		t.Fatalf("RunPrompt() output = %q, want daemon-ready", resp.Output)
	}

	sessionDir := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	assertFileContains(t, filepath.Join(sessionDir, "MEMORY.md"), "same session")
	assertFileContains(t, filepath.Join(sessionDir, "CURRENT_TURN.md"), "first turn prompt")
	assertFileContains(t, filepath.Join(sessionDir, "notes", "work-log.md"), "first turn prompt")

	var payload struct {
		SessionID         string `json:"sessionId"`
		RunID             string `json:"runId,omitempty"`
		RoomID            string `json:"roomId,omitempty"`
		Provider          string `json:"provider,omitempty"`
		Cwd               string `json:"cwd,omitempty"`
		AppServerThreadID string `json:"appServerThreadId,omitempty"`
	}
	data, err := os.ReadFile(filepath.Join(sessionDir, "SESSION.json"))
	if err != nil {
		t.Fatalf("ReadFile(SESSION.json) error = %v", err)
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("Unmarshal(SESSION.json) error = %v", err)
	}
	if payload.SessionID != "session-runtime" || payload.RunID != "run-runtime-01" || payload.RoomID != "room-runtime" {
		t.Fatalf("SESSION.json payload = %#v, want session/run/room ids", payload)
	}
	if payload.Provider != "claude" || payload.Cwd != cwd {
		t.Fatalf("SESSION.json payload = %#v, want provider/cwd", payload)
	}
	if payload.AppServerThreadID != "" {
		t.Fatalf("SESSION.json appServerThreadId = %q, want empty placeholder", payload.AppServerThreadID)
	}
}

func TestStreamPromptRefreshesCurrentTurnAndAccumulatesWorkLog(t *testing.T) {
	root := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(t, cliDir, "claude", "#!/bin/sh\nprintf 'stream-ready\\n'\n", "@echo off\r\necho stream-ready\r\n")
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	service := NewService("daemon-test", root)
	req := ExecRequest{
		Provider:  "claude",
		Cwd:       cwd,
		SessionID: "session-runtime",
		RunID:     "run-runtime-01",
		RoomID:    "room-runtime",
	}
	if _, err := service.StreamPrompt(withPrompt(req, "first turn prompt"), nil); err != nil {
		t.Fatalf("first StreamPrompt() error = %v", err)
	}
	if _, err := service.StreamPrompt(withPrompt(req, "second turn prompt"), nil); err != nil {
		t.Fatalf("second StreamPrompt() error = %v", err)
	}

	sessionDir := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	currentTurn := readFile(t, filepath.Join(sessionDir, "CURRENT_TURN.md"))
	if !strings.Contains(currentTurn, "second turn prompt") {
		t.Fatalf("CURRENT_TURN.md = %q, want second turn prompt", currentTurn)
	}
	if strings.Contains(currentTurn, "first turn prompt") {
		t.Fatalf("CURRENT_TURN.md = %q, should not retain first turn prompt after refresh", currentTurn)
	}

	workLog := readFile(t, filepath.Join(sessionDir, "notes", "work-log.md"))
	if !strings.Contains(workLog, "first turn prompt") || !strings.Contains(workLog, "second turn prompt") {
		t.Fatalf("work-log = %q, want both prompts", workLog)
	}
}

func TestRunPromptSessionWorkspaceRootRespectsEnvOverride(t *testing.T) {
	root := t.TempDir()
	customRoot := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(t, cliDir, "claude", "#!/bin/sh\nprintf 'override-ready\\n'\n", "@echo off\r\necho override-ready\r\n")
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("OPENSHOCK_AGENT_SESSION_ROOT", customRoot)

	service := NewService("daemon-test", root)
	if _, err := service.RunPrompt(ExecRequest{
		Provider:  "claude",
		Prompt:    "override prompt",
		Cwd:       cwd,
		SessionID: "session-runtime",
	}); err != nil {
		t.Fatalf("RunPrompt() error = %v", err)
	}

	overridePath := filepath.Join(customRoot, "session-runtime", "CURRENT_TURN.md")
	if _, err := os.Stat(overridePath); err != nil {
		t.Fatalf("Stat(custom CURRENT_TURN.md) error = %v", err)
	}
	defaultPath := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	if _, err := os.Stat(defaultPath); !os.IsNotExist(err) {
		t.Fatalf("default session workspace exists unexpectedly at %s", defaultPath)
	}
}

func TestRunPromptUsesSessionScopedCodexHome(t *testing.T) {
	root := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(
		t,
		cliDir,
		"codex",
		"#!/bin/sh\nprintf 'home=%s|args=%s\\n' \"$OPENSHOCK_CODEX_HOME\" \"$*\"\n",
		"@echo off\r\necho home=%OPENSHOCK_CODEX_HOME%^|args=%*\r\n",
	)
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	service := NewService("daemon-test", root)
	resp, err := service.RunPrompt(ExecRequest{
		Provider:  "codex",
		Prompt:    "session scoped codex home",
		Cwd:       cwd,
		SessionID: "session-runtime",
		RunID:     "run-runtime-01",
		RoomID:    "room-runtime",
	})
	if err != nil {
		t.Fatalf("RunPrompt() error = %v", err)
	}

	sessionDir := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	wantHome := filepath.Join(sessionDir, "codex-home")
	if !strings.Contains(resp.Output, "home="+wantHome) {
		t.Fatalf("RunPrompt() output = %q, want codex home %q", resp.Output, wantHome)
	}

	var payload struct {
		CodexHome string `json:"codexHome,omitempty"`
	}
	data, err := os.ReadFile(filepath.Join(sessionDir, "SESSION.json"))
	if err != nil {
		t.Fatalf("ReadFile(SESSION.json) error = %v", err)
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("Unmarshal(SESSION.json) error = %v", err)
	}
	if payload.CodexHome != wantHome {
		t.Fatalf("SESSION.json codexHome = %q, want %q", payload.CodexHome, wantHome)
	}
}

func TestResumeSessionReusesSessionScopedCodexHomeAcrossRestart(t *testing.T) {
	root := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(
		t,
		cliDir,
		"codex",
		"#!/bin/sh\nprintf 'home=%s|args=%s\\n' \"$OPENSHOCK_CODEX_HOME\" \"$*\"\n",
		"@echo off\r\necho home=%OPENSHOCK_CODEX_HOME%^|args=%*\r\n",
	)
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	first := NewService("daemon-test", root)
	firstResp, err := first.RunPrompt(ExecRequest{
		Provider:  "codex",
		Prompt:    "first codex turn",
		Cwd:       cwd,
		SessionID: "session-runtime",
		RunID:     "run-runtime-01",
		RoomID:    "room-runtime",
	})
	if err != nil {
		t.Fatalf("first RunPrompt() error = %v", err)
	}

	second := NewService("daemon-test", root)
	secondResp, err := second.RunPrompt(ExecRequest{
		Provider:      "codex",
		Prompt:        "resume codex turn",
		Cwd:           cwd,
		SessionID:     "session-runtime",
		RunID:         "run-runtime-01",
		RoomID:        "room-runtime",
		ResumeSession: true,
	})
	if err != nil {
		t.Fatalf("second RunPrompt() error = %v", err)
	}

	sessionDir := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	wantHome := filepath.Join(sessionDir, "codex-home")
	if !strings.Contains(firstResp.Output, "home="+wantHome) {
		t.Fatalf("first RunPrompt() output = %q, want codex home %q", firstResp.Output, wantHome)
	}
	if !strings.Contains(secondResp.Output, "home="+wantHome) {
		t.Fatalf("second RunPrompt() output = %q, want codex home %q", secondResp.Output, wantHome)
	}
	if !strings.Contains(secondResp.Output, "args=exec resume --last") {
		t.Fatalf("second RunPrompt() output = %q, want resume command", secondResp.Output)
	}
}

func TestRunPromptPersistsAppServerThreadIDFromProviderStateFile(t *testing.T) {
	root := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(
		t,
		cliDir,
		"codex",
		"#!/bin/sh\nprintf 'thread-file=%s|incoming=%s\\n' \"$OPENSHOCK_APP_SERVER_THREAD_ID_FILE\" \"$OPENSHOCK_APP_SERVER_THREAD_ID\"\nprintf 'thread-001' > \"$OPENSHOCK_APP_SERVER_THREAD_ID_FILE\"\n",
		"@echo off\r\necho thread-file=%OPENSHOCK_APP_SERVER_THREAD_ID_FILE%^|incoming=%OPENSHOCK_APP_SERVER_THREAD_ID%\r\n> \"%OPENSHOCK_APP_SERVER_THREAD_ID_FILE%\" <nul set /p =thread-001\r\n",
	)
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	service := NewService("daemon-test", root)
	resp, err := service.RunPrompt(ExecRequest{
		Provider:  "codex",
		Prompt:    "persist thread state",
		Cwd:       cwd,
		SessionID: "session-runtime",
		RunID:     "run-runtime-01",
		RoomID:    "room-runtime",
	})
	if err != nil {
		t.Fatalf("RunPrompt() error = %v", err)
	}

	sessionDir := filepath.Join(root, ".openshock", "agent-sessions", "session-runtime")
	wantThreadFile := filepath.Join(sessionDir, "app-server-thread-id")
	if !strings.Contains(resp.Output, "thread-file="+wantThreadFile) {
		t.Fatalf("RunPrompt() output = %q, want thread state file %q", resp.Output, wantThreadFile)
	}

	var payload struct {
		AppServerThreadID string `json:"appServerThreadId,omitempty"`
	}
	data, err := os.ReadFile(filepath.Join(sessionDir, "SESSION.json"))
	if err != nil {
		t.Fatalf("ReadFile(SESSION.json) error = %v", err)
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("Unmarshal(SESSION.json) error = %v", err)
	}
	if payload.AppServerThreadID != "thread-001" {
		t.Fatalf("SESSION.json appServerThreadId = %q, want thread-001", payload.AppServerThreadID)
	}
}

func TestResumeSessionExportsPersistedAppServerThreadIDAcrossRestart(t *testing.T) {
	root := t.TempDir()
	cwd := t.TempDir()
	cliDir := t.TempDir()
	writeRuntimeCLI(
		t,
		cliDir,
		"codex",
		"#!/bin/sh\nprintf 'incoming=%s\\n' \"$OPENSHOCK_APP_SERVER_THREAD_ID\"\nif [ \"$1\" = \"exec\" ] && [ \"$2\" != \"resume\" ]; then\n  printf 'thread-001' > \"$OPENSHOCK_APP_SERVER_THREAD_ID_FILE\"\nfi\n",
		"@echo off\r\necho incoming=%OPENSHOCK_APP_SERVER_THREAD_ID%\r\nif \"%1\"==\"exec\" if not \"%2\"==\"resume\" > \"%OPENSHOCK_APP_SERVER_THREAD_ID_FILE%\" <nul set /p =thread-001\r\n",
	)
	t.Setenv("PATH", cliDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	first := NewService("daemon-test", root)
	if _, err := first.RunPrompt(ExecRequest{
		Provider:  "codex",
		Prompt:    "first codex turn",
		Cwd:       cwd,
		SessionID: "session-runtime",
		RunID:     "run-runtime-01",
		RoomID:    "room-runtime",
	}); err != nil {
		t.Fatalf("first RunPrompt() error = %v", err)
	}

	second := NewService("daemon-test", root)
	resp, err := second.RunPrompt(ExecRequest{
		Provider:      "codex",
		Prompt:        "resume codex turn",
		Cwd:           cwd,
		SessionID:     "session-runtime",
		RunID:         "run-runtime-01",
		RoomID:        "room-runtime",
		ResumeSession: true,
	})
	if err != nil {
		t.Fatalf("second RunPrompt() error = %v", err)
	}
	if !strings.Contains(resp.Output, "incoming=thread-001") {
		t.Fatalf("second RunPrompt() output = %q, want persisted thread id", resp.Output)
	}
}

func writeExecutable(t *testing.T, path string) {
	t.Helper()
	content := []byte("#!/bin/sh\nexit 0\n")
	if goruntime.GOOS == "windows" {
		path += ".cmd"
		content = []byte("@echo off\r\nexit /b 0\r\n")
	}
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatalf("write executable %s: %v", path, err)
	}
}

func writeExecutableWithContent(t *testing.T, path string, unixContent string) {
	t.Helper()
	content := []byte(unixContent)
	if goruntime.GOOS == "windows" {
		commandName := filepath.Base(path)
		if !strings.HasSuffix(strings.ToLower(commandName), ".cmd") {
			path += ".cmd"
		}
		content = []byte(fmt.Sprintf("@echo off\r\nif \"%s\"==\"codex\" (\r\n  echo Logged in using an API key\r\n  exit /b 0\r\n)\r\nif \"%s\"==\"claude\" (\r\n  echo {\"loggedIn\":false,\"authMethod\":\"none\",\"apiProvider\":\"firstParty\"}\r\n  exit /b 1\r\n)\r\n", commandName, commandName))
	}
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatalf("write executable %s: %v", path, err)
	}
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

func withPrompt(req ExecRequest, prompt string) ExecRequest {
	req.Prompt = prompt
	return req
}

func writeRuntimeCLI(t *testing.T, dir, name, unixContent, windowsContent string) {
	t.Helper()

	path := filepath.Join(dir, name)
	content := []byte(unixContent)
	if goruntime.GOOS == "windows" {
		path += ".cmd"
		content = []byte(windowsContent)
	}
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatalf("write runtime cli %s: %v", path, err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	return string(data)
}

func assertFileContains(t *testing.T, path, want string) {
	t.Helper()
	if got := readFile(t, path); !strings.Contains(got, want) {
		t.Fatalf("%s = %q, want substring %q", path, got, want)
	}
}
