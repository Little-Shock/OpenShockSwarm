package api

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"net/http/httptest"

	"openshock/backend/internal/store"
	"openshock/backend/internal/testsupport/scenario"
)

func TestDaemonOnceCompletesQueuedRun(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	repoPath := newGitFixtureRepo(t)
	if err := backingStore.BindWorkspaceRepo("ws_01", repoPath, "daemon-fixture", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinary(t)

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	runCompleted := false
	outputChunkRecorded := false
	toolCallRecorded := false
	for _, run := range detail.Runs {
		if run.ID == "run_review_01" && run.Status == "completed" {
			runCompleted = true
		}
	}
	for _, chunk := range detail.RunOutputChunks {
		if chunk.RunID == "run_review_01" {
			outputChunkRecorded = true
		}
	}
	for _, toolCall := range detail.ToolCalls {
		if toolCall.RunID == "run_review_01" {
			toolCallRecorded = true
		}
	}
	if !runCompleted {
		t.Fatalf("expected queued seed run to complete via daemon, got %#v\n\ndaemon output:\n%s", detail.Runs, string(output))
	}
	if !outputChunkRecorded {
		t.Fatalf("expected daemon run to append output chunks, got %#v\n\ndaemon output:\n%s", detail.RunOutputChunks, string(output))
	}
	if !toolCallRecorded {
		t.Fatalf("expected daemon run to append tool calls, got %#v\n\ndaemon output:\n%s", detail.ToolCalls, string(output))
	}
	artifactBytes, err := os.ReadFile(filepath.Join(repoPath, "agent-output.txt"))
	if err != nil {
		t.Fatalf("expected codex artifact to be written: %v", err)
	}
	if strings.TrimSpace(string(artifactBytes)) == "" {
		t.Fatal("expected codex artifact to contain instruction text")
	}
	currentBranch := mustGit(t, repoPath, "branch", "--show-current")
	if strings.TrimSpace(currentBranch) != "issue-101/task-review" {
		t.Fatalf("expected daemon to execute on task branch, got %q", currentBranch)
	}

	bootstrap := backingStore.Bootstrap()
	runtimeFound := false
	for _, runtime := range bootstrap.Runtimes {
		if runtime.Name == "E2E Daemon" {
			runtimeFound = true
		}
	}
	if !runtimeFound {
		t.Fatalf("expected daemon runtime registration, got %#v", bootstrap.Runtimes)
	}
}

func TestDaemonRunCanUpdateTaskStatusViaOpenShockCLI(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	repoPath := newGitFixtureRepo(t)
	if err := backingStore.BindWorkspaceRepo("ws_01", repoPath, "daemon-fixture", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinaryWithScript(t, "fake codex completed task", `
if ! openshock task mark-ready --task task_review --actor-id agent_guardian >/dev/null; then
  exit 1
fi
`)

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Task Status Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	runCompleted := false
	taskReady := false
	for _, run := range detail.Runs {
		if run.ID == "run_review_01" && run.Status == "completed" {
			runCompleted = true
		}
	}
	for _, task := range detail.Tasks {
		if task.ID == "task_review" && task.Status == "ready_for_integration" {
			taskReady = true
		}
	}
	if !runCompleted {
		t.Fatalf("expected run_review_01 to complete, got %#v\n\ndaemon output:\n%s", detail.Runs, string(output))
	}
	if !taskReady {
		t.Fatalf("expected task_review to become ready_for_integration via openshock cli, got %#v\n\ndaemon output:\n%s", detail.Tasks, string(output))
	}
}

func TestDaemonOnceCompletesQueuedMergeAttempt(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	repoPath := newGitFixtureRepo(t)
	setupMergeFixtureBranches(t, repoPath)
	if err := backingStore.BindWorkspaceRepo("ws_01", repoPath, "daemon-fixture", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	if _, err := backingStore.RequestMerge("task_guard"); err != nil {
		t.Fatalf("request merge returned error: %v", err)
	}
	if _, err := backingStore.ApproveMerge("task_guard", "Sarah"); err != nil {
		t.Fatalf("approve merge returned error: %v", err)
	}

	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinary(t)

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Merge Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	mergeSucceeded := false
	taskIntegrated := false
	for _, attempt := range detail.MergeAttempts {
		if attempt.TaskID == "task_guard" && attempt.Status == "succeeded" {
			mergeSucceeded = true
		}
	}
	for _, task := range detail.Tasks {
		if task.ID == "task_guard" && task.Status == "integrated" {
			taskIntegrated = true
		}
	}

	if !mergeSucceeded {
		t.Fatalf("expected merge attempt to complete via daemon, got %#v", detail.MergeAttempts)
	}
	if !taskIntegrated {
		t.Fatalf("expected merge success to integrate task, got %#v", detail.Tasks)
	}
}

func TestDaemonOnceCompletesQueuedAgentTurn(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	if _, err := backingStore.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 请先理解这个目标, 然后给我一个简短计划。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinaryWithScript(t, "RESULT: no_response\nBODY:\n", `
if ! openshock send-message --room room_001 --body "我已经理解目标，下一步会先整理简短计划。" --actor-id agent_shell >/dev/null; then
  exit 1
fi
`)

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Agent Turn Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 || detail.AgentTurns[0].Status != "completed" {
		t.Fatalf("expected completed agent turn, got %#v", detail.AgentTurns)
	}
	if len(detail.AgentTurnOutputChunks) == 0 {
		t.Fatalf("expected daemon agent turn to append output chunks, got %#v\n\ndaemon output:\n%s", detail.AgentTurnOutputChunks, string(output))
	}
	if len(detail.AgentTurnToolCalls) == 0 {
		t.Fatalf("expected daemon agent turn to append tool calls, got %#v\n\ndaemon output:\n%s", detail.AgentTurnToolCalls, string(output))
	}

	foundAgentReply := false
	for _, message := range detail.Messages {
		if message.ActorType == "agent" && message.ActorName == "Shell_Runner" {
			foundAgentReply = true
		}
	}
	if !foundAgentReply {
		t.Fatalf("expected daemon to post agent reply into room, got %#v", detail.Messages)
	}
}

func TestDaemonAgentTurnCanDriveTaskAndMergeWorkflowViaOpenShockCLI(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	repoPath := newGitFixtureRepo(t)
	if err := backingStore.BindWorkspaceRepo("ws_01", repoPath, "daemon-fixture", true); err != nil {
		t.Fatalf("bind workspace repo returned error: %v", err)
	}
	if _, err := backingStore.PostRoomMessage("issue_101", "member", "Sarah", "message", "@agent_shell 请把这个 issue 的任务往前推进：新建一个后续 task，认领 task_review，触发执行并推进合并。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinaryWithScript(t, "RESULT: done\nBODY:\n", `
if [ -f CURRENT_TURN.md ]; then
  if ! openshock task create --issue issue_101 --title "Follow-up cleanup" --description "Coordinate the next integration-safe cleanup." --assignee-agent-id agent_guardian --actor-id agent_shell >/dev/null; then
    exit 1
  fi
  if ! openshock task claim --task task_review --actor-id agent_shell >/dev/null; then
    exit 1
  fi
  if ! openshock task status set --task task_review --status in_progress --actor-id agent_shell >/dev/null; then
    exit 1
  fi
  if ! openshock run create --task task_review --actor-id agent_shell >/dev/null; then
    exit 1
  fi
  if ! openshock git request-merge --task task_review --actor-id agent_shell >/dev/null; then
    exit 1
  fi
  if ! openshock git approve-merge --task task_review --actor-id agent_guardian >/dev/null; then
    exit 1
  fi
fi
`)

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Agent Workflow Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.IssueDetail("issue_101")
	if err != nil {
		t.Fatalf("issue detail returned error: %v", err)
	}

	createdTaskFound := false
	taskReviewIntegrated := false
	runCreated := false
	mergeSucceeded := false
	for _, task := range detail.Tasks {
		if task.ID == "task_101" && task.Title == "Follow-up cleanup" && task.AssigneeAgentID == "agent_guardian" {
			createdTaskFound = true
		}
		if task.ID == "task_review" && task.AssigneeAgentID == "agent_shell" && task.Status == "integrated" {
			taskReviewIntegrated = true
		}
	}
	for _, run := range detail.Runs {
		if run.ID == "run_101" && run.TaskID == "task_review" {
			runCreated = true
		}
	}
	for _, attempt := range detail.MergeAttempts {
		if attempt.TaskID == "task_review" && attempt.Status == "succeeded" {
			mergeSucceeded = true
		}
	}
	if !createdTaskFound {
		t.Fatalf("expected agent turn to create a follow-up task, got %#v\n\ndaemon output:\n%s", detail.Tasks, string(output))
	}
	if !taskReviewIntegrated {
		t.Fatalf("expected task_review to be claimed by agent_shell and merged to integrated, got %#v\n\ndaemon output:\n%s", detail.Tasks, string(output))
	}
	if !runCreated {
		t.Fatalf("expected agent turn to create a new run for task_review, got %#v\n\ndaemon output:\n%s", detail.Runs, string(output))
	}
	if !mergeSucceeded {
		t.Fatalf("expected agent turn to queue and complete a merge attempt for task_review, got %#v\n\ndaemon output:\n%s", detail.MergeAttempts, string(output))
	}
}

func TestDaemonOnceCanCompleteQueuedAgentTurnWithoutPostingReply(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	if _, err := backingStore.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell FYI，我刚把文档同步好了。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	before, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail before daemon returned error: %v", err)
	}
	beforeMessageCount := len(before.Messages)

	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinaryWithFinalMessage(t, "RESULT: no_response\nBODY:\n")

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Agent Turn No Reply Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 || detail.AgentTurns[0].Status != "completed" {
		t.Fatalf("expected completed agent turn, got %#v", detail.AgentTurns)
	}
	if len(detail.Messages) != beforeMessageCount {
		t.Fatalf("expected no additional room message for no_response, got before=%d after=%d %#v", beforeMessageCount, len(detail.Messages), detail.Messages)
	}
}

func TestDaemonOnceDoesNotPostVisibleReplyFromFinalResultBody(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	if _, err := backingStore.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell FYI，先看看这条。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}

	before, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail before daemon returned error: %v", err)
	}
	beforeMessageCount := len(before.Messages)

	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	daemonDir := daemonModuleDir(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fakeCodex := writeFakeCodexBinaryWithFinalMessage(t, "RESULT: done\nBODY:\n我先看一下。")

	cmd := exec.CommandContext(
		ctx,
		"go",
		"run",
		"./cmd/daemon",
		"--once",
		"--api-base-url",
		server.URL,
		"--name",
		"E2E Agent Turn Result Body Ignored Daemon",
	)
	cmd.Dir = daemonDir
	cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		t.Fatalf("daemon timed out: %s", string(output))
	}
	if err != nil {
		t.Fatalf("daemon command failed: %v\n%s", err, string(output))
	}

	detail, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error: %v", err)
	}
	if len(detail.AgentTurns) != 1 || detail.AgentTurns[0].Status != "completed" {
		t.Fatalf("expected completed agent turn, got %#v", detail.AgentTurns)
	}
	if len(detail.Messages) != beforeMessageCount {
		t.Fatalf("expected final result body to stay invisible, got before=%d after=%d %#v", beforeMessageCount, len(detail.Messages), detail.Messages)
	}
}

func TestDaemonAgentTurnReusesPersistentWorkspace(t *testing.T) {
	backingStore := store.NewMemoryStoreFromSnapshot(scenario.Snapshot())
	if _, err := backingStore.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 先看一下这个问题。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}
	server := httptest.NewServer(New(backingStore).Handler())
	defer server.Close()

	workspaceRoot := t.TempDir()
	daemonDir := daemonModuleDir(t)
	fakeCodex := writeFakeCodexBinaryWithScript(t, "RESULT: done\nBODY:\n", `
printf '%s\n' "memory touched" >> ../../MEMORY.md
`)

	runOnce := func(name string) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		cmd := exec.CommandContext(
			ctx,
			"go",
			"run",
			"./cmd/daemon",
			"--once",
			"--api-base-url",
			server.URL,
			"--name",
			name,
			"--agent-workspaces-dir",
			workspaceRoot,
		)
		cmd.Dir = daemonDir
		cmd.Env = append(os.Environ(), "OPENSHOCK_CODEX_BIN="+fakeCodex)

		output, err := cmd.CombinedOutput()
		if ctx.Err() == context.DeadlineExceeded {
			t.Fatalf("daemon timed out: %s", string(output))
		}
		if err != nil {
			t.Fatalf("daemon command failed: %v\n%s", err, string(output))
		}
		return output
	}

	runOnce("E2E Agent Workspace Daemon 1")

	firstDetail, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error after first run: %v", err)
	}
	if len(firstDetail.AgentSessions) != 1 {
		t.Fatalf("expected one agent session after first run, got %#v", firstDetail.AgentSessions)
	}
	workspaceDir := filepath.Join(workspaceRoot, "agents", firstDetail.AgentSessions[0].AgentID, "rooms", firstDetail.AgentSessions[0].RoomID)
	memoryPath := filepath.Join(workspaceRoot, "agents", firstDetail.AgentSessions[0].AgentID, "MEMORY.md")
	if _, err := os.Stat(memoryPath); err != nil {
		t.Fatalf("expected MEMORY.md to exist in workspace: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspaceDir, "notes", "work-log.md")); err != nil {
		t.Fatalf("expected work log to exist in workspace: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspaceDir, "notes", "room-context.md")); err != nil {
		t.Fatalf("expected room context note to exist in workspace: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspaceDir, "turns")); !os.IsNotExist(err) {
		t.Fatalf("expected turns directory to be absent, got err=%v", err)
	}

	if _, err := backingStore.PostRoomMessage("room_001", "member", "Sarah", "message", "@agent_shell 再继续往下看。"); err != nil {
		t.Fatalf("post room message returned error: %v", err)
	}
	runOnce("E2E Agent Workspace Daemon 2")

	secondDetail, err := backingStore.RoomDetail("room_001")
	if err != nil {
		t.Fatalf("room detail returned error after second run: %v", err)
	}
	if len(secondDetail.AgentSessions) != 1 || secondDetail.AgentSessions[0].ProviderThreadID != firstDetail.AgentSessions[0].ProviderThreadID {
		t.Fatalf("expected provider thread reuse across turns, got %#v %#v", firstDetail.AgentSessions, secondDetail.AgentSessions)
	}
	if _, err := os.Stat(filepath.Join(workspaceDir, "turns")); !os.IsNotExist(err) {
		t.Fatalf("expected turns directory to remain absent, got err=%v", err)
	}

	memoryBytes, err := os.ReadFile(memoryPath)
	if err != nil {
		t.Fatalf("failed to read workspace memory: %v", err)
	}
	if strings.Count(string(memoryBytes), "memory touched") != 2 {
		t.Fatalf("expected workspace memory to persist and be updated twice, got %q", string(memoryBytes))
	}

	currentTurnBytes, err := os.ReadFile(filepath.Join(workspaceDir, "CURRENT_TURN.md"))
	if err != nil {
		t.Fatalf("failed to read current turn snapshot: %v", err)
	}
	if !strings.Contains(string(currentTurnBytes), "@agent_shell 再继续往下看。") {
		t.Fatalf("expected current turn snapshot to refresh to latest trigger, got %q", string(currentTurnBytes))
	}

	workLogBytes, err := os.ReadFile(filepath.Join(workspaceDir, "notes", "work-log.md"))
	if err != nil {
		t.Fatalf("failed to read workspace work log: %v", err)
	}
	for _, expected := range []string{
		"turn_started",
		"turn_completed",
		"- 回合 ID：turn_101",
		"- 回合 ID：turn_102",
	} {
		if !strings.Contains(string(workLogBytes), expected) {
			t.Fatalf("expected work log to contain %q, got %q", expected, string(workLogBytes))
		}
	}

	roomContextBytes, err := os.ReadFile(filepath.Join(workspaceDir, "notes", "room-context.md"))
	if err != nil {
		t.Fatalf("failed to read room-context note: %v", err)
	}
	if !strings.Contains(string(roomContextBytes), "唤醒模式：direct_message") {
		t.Fatalf("expected room-context note to describe wakeup mode, got %q", string(roomContextBytes))
	}
}

func setupMergeFixtureBranches(t *testing.T, repoPath string) {
	t.Helper()

	mustGit(t, repoPath, "checkout", "-b", "issue-101/integration")
	mustGit(t, repoPath, "checkout", "-b", "issue-101/task-guard")
	if err := os.WriteFile(filepath.Join(repoPath, "feature.txt"), []byte("task branch feature\n"), 0o644); err != nil {
		t.Fatalf("failed to write merge fixture file: %v", err)
	}
	mustGit(t, repoPath, "add", "feature.txt")
	mustGit(t, repoPath, "commit", "-m", "task branch feature")
	mustGit(t, repoPath, "checkout", "issue-101/integration")
}

func daemonModuleDir(t *testing.T) string {
	t.Helper()

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get working directory: %v", err)
	}

	daemonDir := filepath.Clean(filepath.Join(wd, "../../../../apps/daemon"))
	if !strings.HasSuffix(daemonDir, filepath.Join("apps", "daemon")) {
		t.Fatalf("resolved daemon directory looks wrong: %s", daemonDir)
	}
	return daemonDir
}

func newGitFixtureRepo(t *testing.T) string {
	t.Helper()

	repoPath := t.TempDir()
	mustGit(t, repoPath, "init", "-b", "main")
	mustGit(t, repoPath, "config", "user.name", "OpenShock Test")
	mustGit(t, repoPath, "config", "user.email", "test@openshock.local")
	if err := os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("seed\n"), 0o644); err != nil {
		t.Fatalf("failed to write fixture file: %v", err)
	}
	mustGit(t, repoPath, "add", "README.md")
	mustGit(t, repoPath, "commit", "-m", "initial commit")
	return repoPath
}

func mustGit(t *testing.T, repoPath string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(output))
	}
	return string(output)
}

func writeFakeCodexBinary(t *testing.T) string {
	return writeFakeCodexBinaryWithFinalMessage(t, "fake codex completed task")
}

func writeFakeCodexBinaryWithFinalMessage(t *testing.T, finalMessage string) string {
	return writeFakeCodexBinaryWithScript(t, finalMessage, "")
}

func writeFakeCodexBinaryWithScript(t *testing.T, finalMessage, shellSnippet string) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "codex")
	content := `#!/bin/sh
output_file=""
repo_path=""
instruction=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    exec)
      shift
      ;;
    --json)
      shift
      ;;
    -o)
      output_file="$2"
      shift 2
      ;;
    -C)
      repo_path="$2"
      shift 2
      ;;
    --skip-git-repo-check|--full-auto)
      shift
      ;;
    --sandbox)
      shift 2
      ;;
    *)
      instruction="$1"
      shift
      ;;
  esac
done
printf '%s\n' '{"type":"thread.started","thread_id":"thread_fake"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"response.output_text.delta","delta":"fake codex streamed stdout"}'
printf '%s\n' '{"type":"item.started","item":{"id":"cmd_01","type":"command_execution","command":"openshock task create","status":"in_progress"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"cmd_01","type":"command_execution","command":"openshock task create","status":"completed","aggregated_output":"task created"}}'
printf '%s\n' '{"type":"tool_call","toolName":"openshock","arguments":"task create","status":"completed"}'
cd "$repo_path" || exit 1
` + shellSnippet + `
cat <<'EOF' > "$output_file"
` + finalMessage + `
EOF
printf '%s\n' "$instruction" > "$repo_path/agent-output.txt"
`
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("failed to write fake codex binary: %v", err)
	}
	return path
}
