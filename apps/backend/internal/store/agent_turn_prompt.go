package store

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"
	"text/template"

	"openshock/backend/internal/core"
)

//go:embed agent_turn_prompt.md.tmpl
var agentTurnPromptTemplateSource string

var agentTurnPromptTemplate = template.Must(
	template.New("agent_turn_prompt.md.tmpl").Funcs(template.FuncMap{
		"join":         strings.Join,
		"preview":      previewPromptText,
		"taskRunLabel": taskRunLabel,
	}).Parse(agentTurnPromptTemplateSource),
)

type agentTurnPromptMessageView struct {
	ActorName string
	Kind      string
	Body      string
}

type agentTurnPromptTaskView struct {
	ID              string
	Title           string
	Status          string
	AssigneeAgent   string
	AssigneeAgentID string
	BranchName      string
	RunCount        int
}

type agentTurnPromptRunView struct {
	ID            string
	TaskID        string
	Status        string
	Agent         string
	BranchName    string
	OutputPreview string
}

type agentTurnPromptMergeAttemptView struct {
	ID            string
	TaskID        string
	Status        string
	SourceBranch  string
	TargetBranch  string
	ResultSummary string
}

type agentTurnPromptData struct {
	AgentID               string
	AgentDisplayName      string
	AgentPrompt           string
	RoomID                string
	WakeupMode            string
	VisibleTarget         string
	RoomTitle             string
	ContextSummary        string
	RecentMessagesSummary string
	TriggerActorName      string
	TriggerBody           string
	MentionSignals        []string
	Issue                 *core.Issue
	Tasks                 []agentTurnPromptTaskView
	Runs                  []agentTurnPromptRunView
	MergeAttempts         []agentTurnPromptMergeAttemptView
	IntegrationBranch     *core.IntegrationBranch
	DeliveryPR            *core.DeliveryPR
	Messages              []agentTurnPromptMessageView
}

func buildAgentTurnInstruction(execution core.AgentTurnExecution) string {
	agentDisplayName := strings.TrimSpace(execution.AgentName)
	if agentDisplayName == "" {
		agentDisplayName = execution.Turn.AgentID
	}

	visibleTarget := strings.TrimSpace(execution.Turn.EventFrame.CurrentTarget)
	if visibleTarget == "" {
		visibleTarget = "room:" + execution.Turn.RoomID
	}

	messages := make([]agentTurnPromptMessageView, 0, len(execution.Messages))
	for _, message := range execution.Messages {
		messages = append(messages, agentTurnPromptMessageView{
			ActorName: message.ActorName,
			Kind:      message.Kind,
			Body:      message.Body,
		})
	}

	tasks := make([]agentTurnPromptTaskView, 0, len(execution.Tasks))
	for _, task := range execution.Tasks {
		tasks = append(tasks, agentTurnPromptTaskView{
			ID:              task.ID,
			Title:           task.Title,
			Status:          task.Status,
			AssigneeAgent:   strings.TrimSpace(task.AssigneeAgentID),
			AssigneeAgentID: strings.TrimSpace(task.AssigneeAgentID),
			BranchName:      task.BranchName,
			RunCount:        task.RunCount,
		})
	}

	runs := make([]agentTurnPromptRunView, 0, len(execution.Runs))
	for _, run := range execution.Runs {
		runs = append(runs, agentTurnPromptRunView{
			ID:            run.ID,
			TaskID:        run.TaskID,
			Status:        run.Status,
			Agent:         strings.TrimSpace(run.AgentID),
			BranchName:    run.BranchName,
			OutputPreview: strings.TrimSpace(run.OutputPreview),
		})
	}

	mergeAttempts := make([]agentTurnPromptMergeAttemptView, 0, len(execution.MergeAttempts))
	for _, attempt := range execution.MergeAttempts {
		mergeAttempts = append(mergeAttempts, agentTurnPromptMergeAttemptView{
			ID:            attempt.ID,
			TaskID:        attempt.TaskID,
			Status:        attempt.Status,
			SourceBranch:  attempt.SourceBranch,
			TargetBranch:  attempt.TargetBranch,
			ResultSummary: strings.TrimSpace(attempt.ResultSummary),
		})
	}

	data := agentTurnPromptData{
		AgentID:               execution.Turn.AgentID,
		AgentDisplayName:      agentDisplayName,
		AgentPrompt:           strings.TrimSpace(execution.AgentPrompt),
		RoomID:                execution.Turn.RoomID,
		WakeupMode:            normalizedAgentTurnWakeupMode(execution),
		VisibleTarget:         visibleTarget,
		RoomTitle:             execution.Room.Title,
		ContextSummary:        strings.TrimSpace(execution.Turn.EventFrame.ContextSummary),
		RecentMessagesSummary: strings.TrimSpace(execution.Turn.EventFrame.RecentMessagesSummary),
		TriggerActorName:      execution.TriggerMessage.ActorName,
		TriggerBody:           execution.TriggerMessage.Body,
		MentionSignals:        extractAgentTurnMentionSignals(execution.TriggerMessage.Body),
		Issue:                 execution.Issue,
		Tasks:                 tasks,
		Runs:                  runs,
		MergeAttempts:         mergeAttempts,
		IntegrationBranch:     execution.IntegrationBranch,
		DeliveryPR:            execution.DeliveryPR,
		Messages:              messages,
	}

	var rendered bytes.Buffer
	if err := agentTurnPromptTemplate.Execute(&rendered, data); err != nil {
		panic(err)
	}
	return rendered.String()
}

func normalizedAgentTurnWakeupMode(execution core.AgentTurnExecution) string {
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

func extractAgentTurnMentionSignals(body string) []string {
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

func previewPromptText(value string) string {
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

func taskRunLabel(count int) string {
	if count == 1 {
		return "1 run"
	}
	return fmt.Sprintf("%d runs", count)
}
