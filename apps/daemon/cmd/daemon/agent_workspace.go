package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"openshock/daemon/internal/client"
)

type agentWorkspaceSession struct {
	SessionID         string `json:"sessionId"`
	ProviderThreadID  string `json:"providerThreadId,omitempty"`
	AppServerThreadID string `json:"appServerThreadId,omitempty"`
	RoomID            string `json:"roomId"`
	RoomTitle         string `json:"roomTitle"`
	AgentID           string `json:"agentId"`
	CurrentTurnID     string `json:"currentTurnId"`
	CurrentWakeupMode string `json:"currentWakeupMode"`
}

type agentWorkspaceLayout struct {
	RootDir  string
	AgentDir string
	RoomDir  string
}

func defaultAgentWorkspaceRoot() string {
	homeDir, err := os.UserHomeDir()
	if err == nil && strings.TrimSpace(homeDir) != "" {
		return filepath.Join(homeDir, ".openshock-workspaces")
	}
	return filepath.Join(os.TempDir(), "openshock-workspaces")
}

func prepareAgentWorkspace(root string, execution client.AgentTurnExecution) (string, error) {
	layout, err := ensureAgentSessionWorkspace(root, execution.Session)
	if err != nil {
		return "", err
	}
	if err := ensureWorkspaceMemoryFile(layout.AgentDir, execution); err != nil {
		return "", err
	}
	if err := ensureWorkspaceLogFile(layout.RoomDir); err != nil {
		return "", err
	}
	if err := writeWorkspaceSessionFile(layout.RoomDir, execution); err != nil {
		return "", err
	}
	if err := writeWorkspaceRoomContextFile(layout.RoomDir, execution); err != nil {
		return "", err
	}

	turnSnapshot := buildAgentTurnWorkspaceSnapshot(execution)
	if err := os.WriteFile(filepath.Join(layout.RoomDir, "CURRENT_TURN.md"), []byte(turnSnapshot), 0o644); err != nil {
		return "", err
	}
	return layout.RoomDir, nil
}

func ensureAgentSessionWorkspace(root string, session client.AgentSession) (agentWorkspaceLayout, error) {
	workspaceRoot := strings.TrimSpace(root)
	if workspaceRoot == "" {
		workspaceRoot = defaultAgentWorkspaceRoot()
	}

	layout := buildAgentWorkspaceLayout(workspaceRoot, session)
	if err := os.MkdirAll(filepath.Join(layout.RoomDir, "notes"), 0o755); err != nil {
		return agentWorkspaceLayout{}, err
	}
	if err := writeWorkspaceSessionMetadata(layout.RoomDir, session, "", "", session.AgentID, "", ""); err != nil {
		return agentWorkspaceLayout{}, err
	}
	return layout, nil
}

func buildAgentWorkspaceLayout(root string, session client.AgentSession) agentWorkspaceLayout {
	agentKey := sanitizeWorkspaceName(agentWorkspaceAgentKey(session))
	roomKey := sanitizeWorkspaceName(agentWorkspaceRoomKey(session))
	agentDir := filepath.Join(root, "agents", agentKey)
	return agentWorkspaceLayout{
		RootDir:  root,
		AgentDir: agentDir,
		RoomDir:  filepath.Join(agentDir, "rooms", roomKey),
	}
}

func agentWorkspaceAgentKey(session client.AgentSession) string {
	if value := strings.TrimSpace(session.AgentID); value != "" {
		return value
	}
	if value := strings.TrimSpace(session.ID); value != "" {
		return value
	}
	if value := strings.TrimSpace(session.ProviderThreadID); value != "" {
		return value
	}
	return "agent"
}

func agentWorkspaceRoomKey(session client.AgentSession) string {
	if value := strings.TrimSpace(session.RoomID); value != "" {
		return value
	}
	if value := strings.TrimSpace(session.ID); value != "" {
		return value
	}
	if value := strings.TrimSpace(session.ProviderThreadID); value != "" {
		return value
	}
	return "room"
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
	return os.WriteFile(path, []byte("# OpenShock Agent 工作日志\n"), 0o644)
}

func defaultAgentMemory(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("# OpenShock Agent 记忆\n\n")
	builder.WriteString("这个文件属于 agent 级工作区，会在同一个 agent 的多个房间、多次回合之间持续复用。\n")
	builder.WriteString("这里建议只记录跨回合仍然有价值的稳定事实，不要把临时回复策略或一次性指令写进来。\n\n")
	builder.WriteString("当稳定上下文发生变化时，请更新这个文件，例如：\n")
	builder.WriteString("- 频道或房间规则\n")
	builder.WriteString("- 所有权或 handoff 预期\n")
	builder.WriteString("- 持续性的阻塞或决策\n")
	builder.WriteString("- 下个回合值得复用的稳定项目背景\n\n")
	builder.WriteString("## Agent\n")
	builder.WriteString("- Agent 名称：")
	builder.WriteString(firstNonEmptyString(execution.AgentName, execution.Turn.AgentID))
	builder.WriteString("\n")
	builder.WriteString("- Agent ID：")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n")
	builder.WriteString("\n## Session\n")
	builder.WriteString("- Session 房间：")
	builder.WriteString(execution.Turn.RoomID)
	builder.WriteString("\n- Provider 线程：")
	builder.WriteString(workspaceSessionKey(execution.Session))
	builder.WriteString("\n")
	return builder.String()
}

func writeWorkspaceSessionFile(dir string, execution client.AgentTurnExecution) error {
	return writeWorkspaceSessionMetadata(
		dir,
		execution.Session,
		execution.Room.ID,
		execution.Room.Title,
		execution.Turn.AgentID,
		execution.Turn.ID,
		normalizedWakeupMode(execution),
	)
}

func writeWorkspaceSessionMetadata(dir string, session client.AgentSession, roomID, roomTitle, agentID, currentTurnID, wakeupMode string) error {
	existing, existingErr := readAgentWorkspaceSession(dir)
	appServerThreadID := strings.TrimSpace(session.AppServerThreadID)
	if existingErr == nil {
		// Once a local workspace exists, treat its app-server thread as the source of truth.
		// This preserves intentional local clears instead of rehydrating stale backend state.
		appServerThreadID = existing.AppServerThreadID
	}
	payload := agentWorkspaceSession{
		SessionID:         firstNonEmptyString(session.ID, existing.SessionID),
		ProviderThreadID:  firstNonEmptyString(session.ProviderThreadID, existing.ProviderThreadID),
		AppServerThreadID: strings.TrimSpace(appServerThreadID),
		RoomID:            firstNonEmptyString(roomID, existing.RoomID),
		RoomTitle:         firstNonEmptyString(roomTitle, existing.RoomTitle),
		AgentID:           firstNonEmptyString(agentID, session.AgentID, existing.AgentID),
		CurrentTurnID:     firstNonEmptyString(currentTurnID, existing.CurrentTurnID),
		CurrentWakeupMode: firstNonEmptyString(wakeupMode, existing.CurrentWakeupMode),
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "SESSION.json"), append(data, '\n'), 0o644)
}

func readAgentWorkspaceSession(dir string) (agentWorkspaceSession, error) {
	data, err := os.ReadFile(filepath.Join(dir, "SESSION.json"))
	if err != nil {
		return agentWorkspaceSession{}, err
	}
	var payload agentWorkspaceSession
	if err := json.Unmarshal(data, &payload); err != nil {
		return agentWorkspaceSession{}, err
	}
	return payload, nil
}

func readAppServerThreadID(dir string) (string, error) {
	payload, err := readAgentWorkspaceSession(dir)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.AppServerThreadID) == "" {
		return "", errors.New("app-server thread id is not set")
	}
	return strings.TrimSpace(payload.AppServerThreadID), nil
}

func writeAppServerThreadID(dir, threadID string) error {
	payload, err := readAgentWorkspaceSession(dir)
	if err != nil {
		return err
	}
	payload.AppServerThreadID = strings.TrimSpace(threadID)
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "SESSION.json"), append(data, '\n'), 0o644)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func writeWorkspaceRoomContextFile(dir string, execution client.AgentTurnExecution) error {
	return os.WriteFile(filepath.Join(dir, "notes", "room-context.md"), []byte(buildAgentRoomContextSnapshot(execution)), 0o644)
}

func buildAgentRoomContextSnapshot(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("# 房间上下文\n\n")
	builder.WriteString("本文件只记录房间相关的事实快照；回复规则和 workflow 约束由系统 prompt 直接注入。\n\n")
	builder.WriteString("- 房间 ID：")
	builder.WriteString(execution.Room.ID)
	builder.WriteString("\n- 房间标题：")
	builder.WriteString(execution.Room.Title)
	builder.WriteString("\n- Agent ID：")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n- 唤醒模式：")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString("\n")
	if issueID := strings.TrimSpace(execution.Room.IssueID); issueID != "" {
		builder.WriteString("- 关联 Issue：")
		builder.WriteString(issueID)
		builder.WriteString("\n")
	}
	if requester := strings.TrimSpace(execution.Turn.EventFrame.RequestedBy); requester != "" {
		builder.WriteString("- 请求人：")
		builder.WriteString(requester)
		builder.WriteString("\n")
	}
	if execution.Issue != nil {
		builder.WriteString("- Issue 状态：")
		builder.WriteString(execution.Issue.Status)
		builder.WriteString("\n")
		if repoPath := strings.TrimSpace(execution.Issue.RepoPath); repoPath != "" {
			builder.WriteString("- 默认 Repo：")
			builder.WriteString(repoPath)
			builder.WriteString("\n")
		}
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.ContextSummary); summary != "" {
		builder.WriteString("\n## 上下文摘要\n")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.RecentMessagesSummary); summary != "" {
		builder.WriteString("\n## 最近摘要\n")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	appendAgentIssueStateSection(&builder, execution)
	return builder.String()
}

func buildAgentTurnWorkspaceSnapshot(execution client.AgentTurnExecution) string {
	var builder strings.Builder
	builder.WriteString("# 当前回合\n\n")
	builder.WriteString("本文件只记录本回合的事实快照；回复契约、决策规则和 CLI 用法以系统 prompt 为准。\n\n")
	builder.WriteString("- 回合 ID：")
	builder.WriteString(execution.Turn.ID)
	builder.WriteString("\n- 序号：")
	builder.WriteString(fmt.Sprintf("%d", execution.Turn.Sequence))
	builder.WriteString("\n- 唤醒模式：")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString("\n- 意图类型：")
	builder.WriteString(execution.Turn.IntentType)
	builder.WriteString("\n- Agent：")
	builder.WriteString(execution.Turn.AgentID)
	builder.WriteString("\n- 房间：")
	builder.WriteString(execution.Room.Title)
	builder.WriteString(" (")
	builder.WriteString(execution.Room.ID)
	builder.WriteString(")\n")
	if target := strings.TrimSpace(execution.Turn.EventFrame.CurrentTarget); target != "" {
		builder.WriteString("- 当前目标：")
		builder.WriteString(target)
		builder.WriteString("\n")
	}
	if requester := strings.TrimSpace(execution.Turn.EventFrame.RequestedBy); requester != "" {
		builder.WriteString("- 请求人：")
		builder.WriteString(requester)
		builder.WriteString("\n")
	}
	if summary := strings.TrimSpace(execution.Turn.EventFrame.ContextSummary); summary != "" {
		builder.WriteString("\n## 上下文摘要\n")
		builder.WriteString(summary)
		builder.WriteString("\n")
	}
	builder.WriteString("\n## 触发消息\n")
	builder.WriteString(execution.TriggerMessage.ActorName)
	builder.WriteString(" [")
	builder.WriteString(execution.TriggerMessage.Kind)
	builder.WriteString("]: ")
	builder.WriteString(execution.TriggerMessage.Body)
	builder.WriteString("\n")
	builder.WriteString("\n## 最近消息\n")
	for _, message := range execution.Messages {
		builder.WriteString("- ")
		builder.WriteString(message.ActorName)
		builder.WriteString(" [")
		builder.WriteString(message.Kind)
		builder.WriteString("]: ")
		builder.WriteString(message.Body)
		builder.WriteString("\n")
	}
	appendAgentIssueStateSection(&builder, execution)
	return builder.String()
}

func appendAgentIssueStateSection(builder *strings.Builder, execution client.AgentTurnExecution) {
	if builder == nil || execution.Issue == nil {
		return
	}

	builder.WriteString("\n## 当前系统状态\n")
	builder.WriteString("- Issue：")
	builder.WriteString(execution.Issue.ID)
	builder.WriteString(" | ")
	builder.WriteString(execution.Issue.Title)
	builder.WriteString(" | status=")
	builder.WriteString(execution.Issue.Status)
	builder.WriteString(" | priority=")
	builder.WriteString(execution.Issue.Priority)
	builder.WriteString("\n")
	if repoPath := strings.TrimSpace(execution.Issue.RepoPath); repoPath != "" {
		builder.WriteString("- 默认 Repo：")
		builder.WriteString(repoPath)
		builder.WriteString("\n")
	}
	if len(execution.Tasks) == 0 {
		builder.WriteString("- 任务：当前没有 task\n")
	} else {
		for _, task := range execution.Tasks {
			builder.WriteString("- Task ")
			builder.WriteString(task.ID)
			builder.WriteString(" | ")
			builder.WriteString(task.Title)
			builder.WriteString(" | status=")
			builder.WriteString(task.Status)
			builder.WriteString(" | assignee=")
			if assignee := strings.TrimSpace(task.AssigneeAgentID); assignee != "" {
				builder.WriteString(assignee)
			} else {
				builder.WriteString("unassigned")
			}
			builder.WriteString(" | branch=")
			builder.WriteString(task.BranchName)
			builder.WriteString("\n")
		}
	}
	if len(execution.Runs) == 0 {
		builder.WriteString("- Runs：当前没有 run\n")
	} else {
		for _, run := range execution.Runs {
			builder.WriteString("- Run ")
			builder.WriteString(run.ID)
			builder.WriteString(" | task=")
			builder.WriteString(run.TaskID)
			builder.WriteString(" | status=")
			builder.WriteString(run.Status)
			builder.WriteString(" | preview=")
			builder.WriteString(previewWorkspaceText(run.OutputPreview))
			builder.WriteString("\n")
		}
	}
	if execution.IntegrationBranch != nil && strings.TrimSpace(execution.IntegrationBranch.Name) != "" {
		builder.WriteString("- Integration Branch：")
		builder.WriteString(execution.IntegrationBranch.Name)
		builder.WriteString(" | status=")
		builder.WriteString(execution.IntegrationBranch.Status)
		if len(execution.IntegrationBranch.MergedTaskIDs) > 0 {
			builder.WriteString(" | merged=")
			builder.WriteString(strings.Join(execution.IntegrationBranch.MergedTaskIDs, ", "))
		}
		builder.WriteString("\n")
	}
	if len(execution.MergeAttempts) == 0 {
		builder.WriteString("- Merge Attempts：当前没有 merge attempt\n")
	} else {
		for _, attempt := range execution.MergeAttempts {
			builder.WriteString("- Merge ")
			builder.WriteString(attempt.ID)
			builder.WriteString(" | task=")
			builder.WriteString(attempt.TaskID)
			builder.WriteString(" | status=")
			builder.WriteString(attempt.Status)
			builder.WriteString(" | ")
			builder.WriteString(attempt.SourceBranch)
			builder.WriteString(" -> ")
			builder.WriteString(attempt.TargetBranch)
			if summary := previewWorkspaceText(attempt.ResultSummary); summary != "" {
				builder.WriteString(" | ")
				builder.WriteString(summary)
			}
			builder.WriteString("\n")
		}
	}
	if execution.DeliveryPR != nil {
		builder.WriteString("- Delivery PR：")
		builder.WriteString(execution.DeliveryPR.ID)
		builder.WriteString(" | status=")
		builder.WriteString(execution.DeliveryPR.Status)
		builder.WriteString(" | ")
		builder.WriteString(execution.DeliveryPR.Title)
		builder.WriteString("\n")
	}
}

func previewWorkspaceText(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	const limit = 120
	runes := []rune(trimmed)
	if len(runes) <= limit {
		return trimmed
	}
	return string(runes[:limit-1]) + "…"
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
	builder.WriteString("- 回合 ID：")
	builder.WriteString(execution.Turn.ID)
	builder.WriteString("\n")
	builder.WriteString("- 序号：")
	builder.WriteString(fmt.Sprintf("%d", execution.Turn.Sequence))
	builder.WriteString("\n")
	builder.WriteString("- 唤醒模式：")
	builder.WriteString(normalizedWakeupMode(execution))
	builder.WriteString("\n")
	builder.WriteString("- 回复类型：")
	builder.WriteString(strings.TrimSpace(reply.Kind))
	builder.WriteString("\n")
	builder.WriteString("- 触发内容：")
	builder.WriteString(strings.TrimSpace(execution.TriggerMessage.Body))
	builder.WriteString("\n")
	if body := strings.TrimSpace(reply.Body); body != "" {
		builder.WriteString("- 回复摘要：")
		builder.WriteString(compactWorkspaceLogValue(body))
		builder.WriteString("\n")
	}
	if executeErr != nil {
		builder.WriteString("- 执行错误：")
		builder.WriteString(compactWorkspaceLogValue(executeErr.Error()))
		builder.WriteString("\n")
	}

	return appendFileLocked(path, []byte(builder.String()))
}

func appendFileLocked(path string, data []byte) error {
	if len(data) == 0 {
		return nil
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	}()

	for len(data) > 0 {
		written, err := file.Write(data)
		if err != nil {
			return err
		}
		data = data[written:]
	}

	return nil
}

func compactWorkspaceLogValue(value string) string {
	singleLine := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(singleLine) <= 240 {
		return singleLine
	}
	return singleLine[:240]
}
