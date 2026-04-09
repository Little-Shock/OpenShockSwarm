package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"openshock/daemon/internal/client"
)

func defaultAgentWorkspaceRoot() string {
	return filepath.Join(os.TempDir(), "openshock-agent-sessions")
}

func prepareAgentWorkspace(root string, execution client.AgentTurnExecution) (string, error) {
	workspaceRoot := strings.TrimSpace(root)
	if workspaceRoot == "" {
		workspaceRoot = defaultAgentWorkspaceRoot()
	}

	dir := filepath.Join(workspaceRoot, sanitizeWorkspaceName(workspaceSessionKey(execution.Session)))
	if err := os.MkdirAll(filepath.Join(dir, "turns"), 0o755); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Join(dir, "notes"), 0o755); err != nil {
		return "", err
	}
	if err := ensureWorkspaceMemoryFile(dir, execution); err != nil {
		return "", err
	}
	if err := ensureWorkspaceLogFile(dir); err != nil {
		return "", err
	}
	if err := writeWorkspaceSessionFile(dir, execution); err != nil {
		return "", err
	}
	if err := writeWorkspaceRoomContextFile(dir, execution); err != nil {
		return "", err
	}

	turnSnapshot := buildAgentTurnWorkspaceSnapshot(execution)
	if err := os.WriteFile(filepath.Join(dir, "CURRENT_TURN.md"), []byte(turnSnapshot), 0o644); err != nil {
		return "", err
	}

	turnFile := filepath.Join(dir, "turns", fmt.Sprintf("%03d-%s.md", execution.Turn.Sequence, execution.Turn.ID))
	if err := os.WriteFile(turnFile, []byte(turnSnapshot), 0o644); err != nil {
		return "", err
	}
	return dir, nil
}

func workspaceSessionKey(session client.AgentSession) string {
	if value := strings.TrimSpace(session.ProviderThreadID); value != "" {
		return value
	}
	if value := strings.TrimSpace(session.ID); value != "" {
		return value
	}
	return "agent-session"
}

func sanitizeWorkspaceName(value string) string {
	if strings.TrimSpace(value) == "" {
		return "agent-session"
	}
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '-', r == '_', r == '.':
			return r
		default:
			return '_'
		}
	}, value)
}

func ensureWorkspaceMemoryFile(dir string, execution client.AgentTurnExecution) error {
	path := filepath.Join(dir, "MEMORY.md")
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(path, []byte(defaultAgentMemory(execution)), 0o644)
}

func ensureWorkspaceLogFile(dir string) error {
	path := filepath.Join(dir, "notes", "work-log.md")
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(path, []byte("# OpenShock Agent Work Log\n"), 0o644)
}

func defaultAgentMemory(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("# OpenShock Agent Memory\n\n")
	builder.WriteString("This workspace persists across turns for one OpenShock agent session.\n\n")
	builder.WriteString("Update this file when durable context changes, such as:\n")
	builder.WriteString("- channel or room rules\n")
	builder.WriteString("- ownership or handoff expectations\n")
	builder.WriteString("- durable blockers or decisions\n")
	builder.WriteString("- stable project context worth reusing next turn\n\n")
	builder.WriteString("## Session\n")
	builder.WriteString("- Agent: ")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n- Room: ")
	builder.WriteString(execution.Turn.RoomID)
	builder.WriteString("\n- Provider thread: ")
	builder.WriteString(workspaceSessionKey(execution.Session))
	builder.WriteString("\n")
	return builder.String()
}

func writeWorkspaceSessionFile(dir string, execution client.AgentTurnExecution) error {
	payload := map[string]any{
		"sessionId":         execution.Session.ID,
		"providerThreadId":  execution.Session.ProviderThreadID,
		"roomId":            execution.Room.ID,
		"roomTitle":         execution.Room.Title,
		"agentId":           execution.Turn.AgentID,
		"currentTurnId":     execution.Turn.ID,
		"currentWakeupMode": normalizedWakeupMode(execution),
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "SESSION.json"), append(data, '\n'), 0o644)
}

func writeWorkspaceRoomContextFile(dir string, execution client.AgentTurnExecution) error {
	return os.WriteFile(filepath.Join(dir, "notes", "room-context.md"), []byte(buildAgentRoomContextSnapshot(execution)), 0o644)
}

func buildAgentRoomContextSnapshot(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("# Room Context\n\n")
	builder.WriteString("- Room ID: ")
	builder.WriteString(execution.Room.ID)
	builder.WriteString("\n- Room title: ")
	builder.WriteString(execution.Room.Title)
	builder.WriteString("\n- Agent ID: ")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n- Wakeup mode: ")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString("\n")
	if issueID := strings.TrimSpace(execution.Room.IssueID); issueID != "" {
		builder.WriteString("- Related issue: ")
		builder.WriteString(issueID)
		builder.WriteString("\n")
	}
	if requester := strings.TrimSpace(execution.Turn.EventFrame.RequestedBy); requester != "" {
		builder.WriteString("- Requested by: ")
		builder.WriteString(requester)
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.ContextSummary); summary != "" {
		builder.WriteString("\n## Context Summary\n")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.RecentMessagesSummary); summary != "" {
		builder.WriteString("\n## Recent Summary\n")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	return builder.String()
}

func buildAgentTurnWorkspaceSnapshot(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("# Current Turn\n\n")
	builder.WriteString("- Turn ID: ")
	builder.WriteString(execution.Turn.ID)
	builder.WriteString("\n- Sequence: ")
	builder.WriteString(fmt.Sprintf("%d", execution.Turn.Sequence))
	builder.WriteString("\n- Wakeup mode: ")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString("\n- Intent type: ")
	builder.WriteString(execution.Turn.IntentType)
	builder.WriteString("\n- Agent: ")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n- Room: ")
	builder.WriteString(execution.Room.Title)
	builder.WriteString(" (")
	builder.WriteString(execution.Room.ID)
	builder.WriteString(")\n")
	if target := strings.TrimSpace(execution.Turn.EventFrame.CurrentTarget); target != "" {
		builder.WriteString("- Current target: ")
		builder.WriteString(target)
		builder.WriteString("\n")
	}
	if requester := strings.TrimSpace(execution.Turn.EventFrame.RequestedBy); requester != "" {
		builder.WriteString("- Requested by: ")
		builder.WriteString(requester)
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.ContextSummary); summary != "" {
		builder.WriteString("\n## Context Summary\n")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	builder.WriteString("\n## Trigger Message\n")
	builder.WriteString(execution.TriggerMessage.ActorName)
	builder.WriteString(" [")
	builder.WriteString(execution.TriggerMessage.Kind)
	builder.WriteString("]: ")
	builder.WriteString(execution.TriggerMessage.Body)
	builder.WriteString("\n")
	builder.WriteString("\n## Reply Contract\n")
	builder.WriteString("Return exactly:\n")
	builder.WriteString("KIND: <message|clarification_request|handoff|summary|no_response>\n")
	builder.WriteString("BODY:\n")
	builder.WriteString("<your message>\n")
	builder.WriteString("\n## Recent Messages\n")
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

func appendAgentWorkspaceLog(dir, stage string, execution client.AgentTurnExecution, reply agentTurnReply, executeErr error) error {
	path := filepath.Join(dir, "notes", "work-log.md")
	executedAt := time.Now().UTC().Format(time.RFC3339)

	var builder strings.Builder
	builder.WriteString("\n## ")
	builder.WriteString(executedAt)
	builder.WriteString(" ")
	if strings.TrimSpace(stage) != "" {
		builder.WriteString(stage)
	} else {
		builder.WriteString("turn_event")
	}
	builder.WriteString("\n")
	builder.WriteString("- Turn ID: ")
	builder.WriteString(execution.Turn.ID)
	builder.WriteString("\n")
	builder.WriteString("- Sequence: ")
	builder.WriteString(fmt.Sprintf("%d", execution.Turn.Sequence))
	builder.WriteString("\n")
	builder.WriteString("- Wakeup mode: ")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString("\n")
	builder.WriteString("- Reply kind: ")
	builder.WriteString(strings.TrimSpace(reply.Kind))
	builder.WriteString("\n")
	builder.WriteString("- Trigger: ")
	builder.WriteString(strings.TrimSpace(execution.TriggerMessage.Body))
	builder.WriteString("\n")
	if body := strings.TrimSpace(reply.Body); body != "" {
		builder.WriteString("- Reply summary: ")
		builder.WriteString(compactWorkspaceLogValue(body))
		builder.WriteString("\n")
	}
	if executeErr != nil {
		builder.WriteString("- Execution error: ")
		builder.WriteString(compactWorkspaceLogValue(executeErr.Error()))
		builder.WriteString("\n")
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.WriteString(builder.String())
	return err
}

func compactWorkspaceLogValue(value string) string {
	singleLine := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(singleLine) <= 240 {
		return singleLine
	}
	return singleLine[:240]
}
