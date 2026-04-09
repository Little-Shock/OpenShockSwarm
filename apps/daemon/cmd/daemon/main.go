package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"openshock/daemon/internal/acp"
	"openshock/daemon/internal/client"
	"openshock/daemon/internal/gitops"
	"openshock/daemon/internal/provider/codex"
)

func main() {
	var agentWorkspacesDir string
	var (
		baseURL   = flag.String("api-base-url", envOr("OPENSHOCK_API_BASE_URL", "http://localhost:8080"), "OpenShock backend base URL")
		name      = flag.String("name", envOr("OPENSHOCK_RUNTIME_NAME", "Local Daemon"), "Runtime display name")
		provider  = flag.String("provider", envOr("OPENSHOCK_PROVIDER", "codex"), "Execution provider")
		slotCount = flag.Int("slots", 2, "Available execution slots")
		once      = flag.Bool("once", false, "Run one register/claim/report cycle and exit")
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

	ctx := context.Background()
	api := client.New(*baseURL)
	gitService := gitops.New()
	codexExecutor := codex.NewExecutor()
	codexBin := envOr("OPENSHOCK_CODEX_BIN", "codex")

	runtimeResp, err := api.RegisterRuntime(ctx, client.RegisterRuntimeRequest{
		Name:      *name,
		Provider:  *provider,
		SlotCount: *slotCount,
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("registered runtime %s (%s)", runtimeResp.Runtime.ID, runtimeResp.Runtime.Name)

	heartbeat := func() {
		if _, err := api.HeartbeatRuntime(ctx, runtimeResp.Runtime.ID, client.RuntimeHeartbeatRequest{Status: "online"}); err != nil {
			log.Printf("heartbeat failed: %v", err)
		}
	}

	agentTurnCycle := func() {
		heartbeat()
		claim, err := api.ClaimAgentTurn(ctx, runtimeResp.Runtime.ID)
		if err != nil {
			if client.IsHTTPStatus(err, 404) {
				return
			}
			log.Printf("agent turn claim failed: %v", err)
			return
		}
		if !claim.Claimed || claim.AgentTurn == nil {
			log.Printf("no queued agent turns available")
			return
		}

		log.Printf("claimed agent turn %s for agent %s in room %s", claim.AgentTurn.Turn.ID, claim.AgentTurn.Turn.AgentID, claim.AgentTurn.Turn.RoomID)

		workspaceDir, err := prepareAgentWorkspace(agentWorkspacesDir, *claim.AgentTurn)
		if err != nil {
			log.Printf("failed to prepare agent workspace: %v", err)
			return
		}
		log.Printf("prepared agent workspace %s for session %s", workspaceDir, claim.AgentTurn.Session.ID)
		if logErr := appendAgentWorkspaceLog(workspaceDir, "turn_started", *claim.AgentTurn, agentTurnReply{}, nil); logErr != nil {
			log.Printf("failed to append agent workspace start log for turn %s: %v", claim.AgentTurn.Turn.ID, logErr)
		}

		result, err := codexExecutor.Execute(ctx, codex.ExecuteRequest{
			RepoPath:     workspaceDir,
			Instruction:  buildAgentTurnInstruction(*claim.AgentTurn),
			CodexBinPath: codexBin,
		}, nil)

		reply := parseAgentTurnReply(result.LastMessage)
		body := reply.Body
		kind := reply.Kind
		if err != nil {
			log.Printf("agent turn %s execution failed: %v", claim.AgentTurn.Turn.ID, err)
			body = summarizeFailure(result.RawOutput, err)
			kind = "blocked"
		}
		resultMessageID := ""
		if kind == "no_response" {
			body = ""
		} else {
			if body == "" {
				body = "收到，我先看一下。"
			}

			actionResp, submitErr := api.SubmitAction(ctx, client.ActionRequest{
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
				log.Printf("failed to post agent turn reply: %v", submitErr)
				return
			}
			resultMessageID = actionEntityID(actionResp, "message")
		}

		if _, err := api.CompleteAgentTurn(ctx, claim.AgentTurn.Turn.ID, client.AgentTurnCompleteRequest{
			RuntimeID:       runtimeResp.Runtime.ID,
			ResultMessageID: resultMessageID,
		}); err != nil {
			_ = appendAgentWorkspaceLog(workspaceDir, "turn_complete_failed", *claim.AgentTurn, agentTurnReply{Kind: kind, Body: body}, err)
			log.Printf("failed to complete agent turn %s: %v", claim.AgentTurn.Turn.ID, err)
			return
		}
		if logErr := appendAgentWorkspaceLog(workspaceDir, "turn_completed", *claim.AgentTurn, agentTurnReply{Kind: kind, Body: body}, err); logErr != nil {
			log.Printf("failed to append agent workspace log for turn %s: %v", claim.AgentTurn.Turn.ID, logErr)
		}

		log.Printf("completed agent turn %s", claim.AgentTurn.Turn.ID)
	}

	runCycle := func() {
		heartbeat()
		claim, err := api.ClaimRun(ctx, runtimeResp.Runtime.ID)
		if err != nil {
			log.Printf("claim failed: %v", err)
			return
		}
		if !claim.Claimed || claim.Run == nil {
			log.Printf("no queued runs available")
			return
		}

		log.Printf("claimed run %s for task %s", claim.Run.ID, claim.Run.TaskID)

		if _, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
			RuntimeID:     runtimeResp.Runtime.ID,
			EventType:     "started",
			OutputPreview: "daemon started execution",
		}); err != nil {
			log.Printf("failed to post started event: %v", err)
			return
		}

		if strings.TrimSpace(claim.Run.RepoPath) == "" {
			if _, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				OutputPreview: "run is missing repoPath",
			}); err != nil {
				log.Printf("failed to post failed event: %v", err)
			}
			return
		}
		if strings.TrimSpace(claim.Run.BranchName) == "" || strings.TrimSpace(claim.Run.BaseBranch) == "" {
			if _, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				OutputPreview: "run is missing branch metadata",
			}); err != nil {
				log.Printf("failed to post failed event: %v", err)
			}
			return
		}
		if err := gitService.EnsureBranch(ctx, claim.Run.RepoPath, claim.Run.BaseBranch, claim.Run.BranchName); err != nil {
			if _, postErr := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				OutputPreview: summarizeMergeOutput(err.Error()),
			}); postErr != nil {
				log.Printf("failed to post branch-prepare failure: %v", postErr)
			}
			return
		}

		result, err := codexExecutor.Execute(ctx, codex.ExecuteRequest{
			RepoPath:     claim.Run.RepoPath,
			Instruction:  claim.Run.Instruction,
			CodexBinPath: codexBin,
		}, func(event acp.Event) error {
			switch event.Kind {
			case acp.EventStdoutChunk:
				if strings.TrimSpace(event.Content) == "" {
					return nil
				}
				_, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
					RuntimeID:     runtimeResp.Runtime.ID,
					EventType:     "output",
					OutputPreview: summarizeMergeOutput(event.Content),
					Message:       event.Content,
					Stream:        "stdout",
				})
				return err
			case acp.EventStderrChunk:
				if strings.TrimSpace(event.Content) == "" {
					return nil
				}
				_, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
					RuntimeID:     runtimeResp.Runtime.ID,
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
				_, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
					RuntimeID: runtimeResp.Runtime.ID,
					EventType: "tool_call",
					ToolCall: &client.ToolCallInput{
						ToolName:  event.ToolCall.ToolName,
						Arguments: event.ToolCall.Arguments,
						Status:    event.ToolCall.Status,
					},
				})
				return err
			case acp.EventCompleted:
				return nil
			default:
				return nil
			}
		})
		if err != nil {
			log.Printf("run %s execution failed: %v", claim.Run.ID, err)
			if _, postErr := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				OutputPreview: summarizeFailure(result.RawOutput, err),
			}); postErr != nil {
				log.Printf("failed to post codex failure: %v", postErr)
			}
			return
		}
		if _, err := gitService.CommitAll(ctx, claim.Run.RepoPath, buildRunCommitMessage(*claim.Run)); err != nil {
			if _, postErr := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				OutputPreview: summarizeFailure("", err),
			}); postErr != nil {
				log.Printf("failed to post git commit failure: %v", postErr)
			}
			return
		}

		if _, err := api.PostRunEvent(ctx, claim.Run.ID, client.RunEventRequest{
			RuntimeID:     runtimeResp.Runtime.ID,
			EventType:     "completed",
			OutputPreview: summarizeMergeOutput(result.LastMessage),
		}); err != nil {
			log.Printf("failed to post completed event: %v", err)
			return
		}

		log.Printf("completed run %s on branch %s", claim.Run.ID, claim.Run.BranchName)
	}

	mergeCycle := func() {
		heartbeat()
		claim, err := api.ClaimMerge(ctx, runtimeResp.Runtime.ID)
		if err != nil {
			log.Printf("merge claim failed: %v", err)
			return
		}
		if !claim.Claimed || claim.MergeAttempt == nil {
			log.Printf("no queued merge attempts available")
			return
		}

		log.Printf("claimed merge attempt %s for task %s", claim.MergeAttempt.ID, claim.MergeAttempt.TaskID)

		if _, err := api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
			RuntimeID:     runtimeResp.Runtime.ID,
			EventType:     "started",
			ResultSummary: "daemon started merge execution",
		}); err != nil {
			log.Printf("failed to post merge started event: %v", err)
			return
		}

		if strings.TrimSpace(claim.MergeAttempt.RepoPath) == "" {
			if _, err := api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				ResultSummary: "merge attempt is missing repoPath",
			}); err != nil {
				log.Printf("failed to post merge failed event: %v", err)
			}
			return
		}

		result, err := gitService.MergeBranch(ctx, claim.MergeAttempt.RepoPath, claim.MergeAttempt.SourceBranch, claim.MergeAttempt.TargetBranch)
		if err != nil {
			if _, postErr := api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
				RuntimeID:     runtimeResp.Runtime.ID,
				EventType:     "failed",
				ResultSummary: summarizeMergeOutput(err.Error()),
			}); postErr != nil {
				log.Printf("failed to post merge failed event: %v", postErr)
			}
			return
		}

		eventType := "failed"
		switch result.Status {
		case gitops.MergeStatusSucceeded:
			eventType = "succeeded"
		case gitops.MergeStatusConflicted:
			eventType = "conflicted"
		}
		if _, err := api.PostMergeEvent(ctx, claim.MergeAttempt.ID, client.MergeEventRequest{
			RuntimeID:     runtimeResp.Runtime.ID,
			EventType:     eventType,
			ResultSummary: summarizeMergeOutput(result.Output),
		}); err != nil {
			log.Printf("failed to post merge %s event: %v", eventType, err)
			return
		}

		log.Printf("completed merge attempt %s with status %s", claim.MergeAttempt.ID, eventType)
	}

	if *once {
		agentTurnCycle()
		runCycle()
		mergeCycle()
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		agentTurnCycle()
		runCycle()
		mergeCycle()
		<-ticker.C
	}
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

func buildAgentTurnInstruction(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("You are participating inside OpenShock as a visible agent in the current conversation.\n")
	builder.WriteString("Lifecycle:\n")
	builder.WriteString("- This is a single daemon-driven turn. Complete all work for this turn before stopping.\n")
	builder.WriteString("- This workspace persists across turns for the same OpenShock agent session.\n")
	builder.WriteString("- The daemon will wake you again on a future turn when later room activity targets this session.\n")
	builder.WriteString("Workspace contract:\n")
	builder.WriteString("- Read MEMORY.md first before deep reasoning.\n")
	builder.WriteString("- Read CURRENT_TURN.md for this turn's exact trigger and reply contract.\n")
	builder.WriteString("- Use notes/room-context.md for durable room context and notes/work-log.md for recent turn history.\n")
	builder.WriteString("- SESSION.json is available if you need the raw session envelope.\n")
	builder.WriteString("- If you learn durable context that should survive to the next turn, update MEMORY.md before you stop.\n")
	builder.WriteString("Your only visible output channel in this turn is the structured reply format below.\n")
	builder.WriteString("Reply in concise Chinese.\n")
	builder.WriteString("Messages with or without @mention use the same reasoning flow. @mention is only a stronger explicit signal in the input context, not a separate workflow.\n")
	builder.WriteString("Wakeup mode: ")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString(".\n")
	builder.WriteString("Wakeup reason: ")
	builder.WriteString(describeWakeupMode(execution))
	builder.WriteString("\n")
	builder.WriteString("Mode-specific first step:\n")
	builder.WriteString(buildWakeupModeGuidance(execution))
	builder.WriteString("Decision order:\n")
	builder.WriteString("1. First decide whether this message needs your reply.\n")
	builder.WriteString("2. If you reply, the first visible response must be natural language, like a teammate speaking in chat.\n")
	builder.WriteString("3. If the turn is actionable, acknowledge ownership or the next step naturally in the first sentence.\n")
	builder.WriteString("4. Use the wakeup mode to decide whether you are answering a fresh message, resuming an earlier clarification, or taking over a handoff.\n")
	builder.WriteString("5. While replying, also analyze whether the conversation should later converge into a task. Do not default to task-taking, task-assignment, task-creation, or workflow wording.\n")
	builder.WriteString("Reply contract:\n")
	builder.WriteString("Return exactly this format:\n")
	builder.WriteString("KIND: <message|clarification_request|handoff|summary|no_response>\n")
	builder.WriteString("BODY:\n")
	builder.WriteString("<your message>\n")
	builder.WriteString("Use message for an ordinary conversational reply.\n")
	builder.WriteString("If you choose clarification_request, ask only the blocking question.\n")
	builder.WriteString("If you choose handoff, mention the target agent in BODY with @agent_id.\n")
	builder.WriteString("Use summary only for a concise wrap-up or status note after understanding the context.\n")
	builder.WriteString("Use no_response only when this visible message does not need a reply from you.\n")
	builder.WriteString("Do not mention internal implementation details.\n")
	builder.WriteString("Current target and trigger:\n")
	builder.WriteString("Signal summary: ")
	builder.WriteString(describeTurnSignal(execution))
	builder.WriteString("\n")
	builder.WriteString("Visible target: ")
	if target := strings.TrimSpace(execution.Turn.EventFrame.CurrentTarget); target != "" {
		builder.WriteString(target)
	} else {
		builder.WriteString("room:")
		builder.WriteString(execution.Turn.RoomID)
	}
	builder.WriteString("\n")
	builder.WriteString("Room title: ")
	builder.WriteString(execution.Room.Title)
	builder.WriteString("\n")
	builder.WriteString("Current agent: ")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n")
	if mentions := extractMentionSignals(execution.TriggerMessage.Body); len(mentions) > 0 {
		builder.WriteString("Mention signals in trigger: ")
		builder.WriteString(strings.Join(mentions, ", "))
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.ContextSummary); summary != "" {
		builder.WriteString("Context summary: ")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.RecentMessagesSummary); summary != "" {
		builder.WriteString("Recent summary: ")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	builder.WriteString("Trigger message:\n")
	builder.WriteString(execution.TriggerMessage.ActorName)
	builder.WriteString(": ")
	builder.WriteString(execution.TriggerMessage.Body)
	builder.WriteString("\n\nRecent room context:\n")
	for _, message := range execution.Messages {
		builder.WriteString("- ")
		builder.WriteString(message.ActorName)
		builder.WriteString(" [")
		builder.WriteString(message.Kind)
		builder.WriteString("]: ")
		builder.WriteString(message.Body)
		builder.WriteString("\n")
	}
	return builder.String()
}

type agentTurnReply struct {
	Kind string
	Body string
}

func parseAgentTurnReply(raw string) agentTurnReply {
	text := strings.TrimSpace(raw)
	if text == "" {
		return agentTurnReply{Kind: "message", Body: ""}
	}

	reply := agentTurnReply{Kind: "message", Body: text}
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
	case "clarification_followup":
		return "clarification_followup"
	case "handoff_response":
		return "handoff_response"
	default:
		return "direct_message"
	}
}

func describeWakeupMode(execution client.AgentTurnExecution) string {
	switch normalizedWakeupMode(execution) {
	case "clarification_followup":
		return "the human is replying after your earlier blocking clarification request"
	case "handoff_response":
		return "another agent explicitly asked you to take over or continue the thread"
	default:
		if mentions := extractMentionSignals(execution.TriggerMessage.Body); len(mentions) > 0 {
			return "a direct visible room message with explicit mention signal"
		}
		return "a direct visible room message that may or may not need a visible reply"
	}
}

func buildWakeupModeGuidance(execution client.AgentTurnExecution) string {
	switch normalizedWakeupMode(execution) {
	case "clarification_followup":
		return "- Treat the trigger as new information answering an earlier blocker.\n- Do not repeat the old blocker unless it still remains unresolved.\n"
	case "handoff_response":
		return "- Start from the assumption that takeover is expected.\n- Reply with concrete ownership, next step, or the real blocker preventing takeover.\n"
	default:
		return "- First decide whether a visible reply is needed at all.\n- If it is actionable, acknowledge ownership or next step naturally before deeper detail.\n"
	}
}

func normalizeAgentReplyKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "message", "clarification_request", "handoff", "summary", "no_response":
		return strings.ToLower(strings.TrimSpace(kind))
	default:
		return ""
	}
}

func describeTurnSignal(execution client.AgentTurnExecution) string {
	switch normalizedWakeupMode(execution) {
	case "clarification_followup":
		return "human follow-up after an earlier clarification"
	case "handoff_response":
		return "another agent explicitly asked you to take over"
	default:
		if mentions := extractMentionSignals(execution.TriggerMessage.Body); len(mentions) > 0 {
			return "ordinary visible message with explicit mention signal"
		}
		return "ordinary visible room message"
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
