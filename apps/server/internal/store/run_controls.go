package store

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	runStatusPaused           = "paused"
	runControlActionStop      = "stop"
	runControlActionResume    = "resume"
	runControlActionFollow    = "follow_thread"
	runControlArtifactKind    = "Run Control"
	runControlSpeakerFallback = "Human Control"
)

var (
	ErrRunControlRunNotFound          = errors.New("run not found")
	ErrRunControlSessionNotFound      = errors.New("session not found for run")
	ErrRunControlUnsupportedAction    = errors.New("unsupported run control action")
	ErrRunControlImmutableFinalStatus = errors.New("run is already done")
)

type RunControlInput struct {
	Action string `json:"action"`
	Note   string `json:"note,omitempty"`
	Actor  string `json:"actor,omitempty"`
}

func (s *Store) ControlRun(runID string, input RunControlInput) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, sessionIndex, err := s.findRunControlTargetsLocked(runID)
	if err != nil {
		return State{}, err
	}

	roomItem := &s.state.Rooms[roomIndex]
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]
	sessionItem := &s.state.Sessions[sessionIndex]

	if strings.TrimSpace(runItem.Status) == "done" {
		return State{}, ErrRunControlImmutableFinalStatus
	}

	action := strings.TrimSpace(input.Action)
	actor := defaultString(strings.TrimSpace(input.Actor), runControlSpeakerFallback)
	note := strings.TrimSpace(input.Note)
	now := shortClock()
	href := fmt.Sprintf("/rooms/%s/runs/%s", roomItem.ID, runItem.ID)

	var (
		title         string
		summary       string
		decisionState string
		timelineTone  string
		agentState    string
		agentMood     string
	)

	switch action {
	case runControlActionStop:
		title = "Run 已暂停"
		summary = defaultString(note, "人类已停止当前 Run，等待纠偏说明后再决定是否恢复。")
		decisionState = runStatusPaused
		timelineTone = "paper"
		agentState = "blocked"
		agentMood = "已被人类暂停，等待 Resume 或 follow-thread 指令"
		roomItem.Topic.Status = runStatusPaused
		roomItem.Topic.Summary = summary
		issueItem.State = runStatusPaused
		runItem.Status = runStatusPaused
		runItem.Summary = summary
		runItem.ControlNote = summary
		runItem.ApprovalRequired = false
		if runItem.FollowThread {
			runItem.NextAction = "当前已锁定 follow-thread；补充纠偏说明后可直接 Resume。"
		} else {
			runItem.NextAction = "补充纠偏说明后点击 Resume，或先锁定 follow-thread 保持当前线程。"
		}
		runItem.Stdout = append(runItem.Stdout, fmt.Sprintf("[%s] %s: %s", now, actor, summary))
		sessionItem.Status = runStatusPaused
		sessionItem.Summary = summary
		sessionItem.ControlNote = summary
	case runControlActionResume:
		title = "Run 已恢复"
		if runItem.FollowThread {
			summary = defaultString(note, "人类已恢复当前 Run，并要求沿当前讨论线程继续推进。")
			runItem.NextAction = "沿当前 follow-thread 指引继续执行，并把结果同步回讨论间。"
			agentMood = "已恢复执行，并沿当前 thread 继续推进"
		} else {
			summary = defaultString(note, "人类已恢复当前 Run，沿原 session continuity 继续执行。")
			runItem.NextAction = "沿原 session continuity 继续执行，并把结果同步回讨论间。"
			agentMood = "已恢复执行"
		}
		decisionState = "running"
		timelineTone = "lime"
		agentState = "running"
		roomItem.Topic.Status = "running"
		roomItem.Topic.Summary = summary
		issueItem.State = "running"
		runItem.Status = "running"
		runItem.Summary = summary
		runItem.ControlNote = summary
		runItem.ApprovalRequired = false
		runItem.Stdout = append(runItem.Stdout, fmt.Sprintf("[%s] %s: %s", now, actor, summary))
		sessionItem.Status = "running"
		sessionItem.Summary = summary
		sessionItem.ControlNote = summary
	case runControlActionFollow:
		title = "已锁定当前线程"
		summary = defaultString(note, "后续恢复会沿当前讨论线程继续，不切新 follow-up run。")
		decisionState = "follow_thread"
		if strings.TrimSpace(runItem.Status) == runStatusPaused {
			timelineTone = "paper"
			agentState = "blocked"
			agentMood = "已锁定 follow-thread，等待 Resume"
			runItem.NextAction = "已锁定 follow-thread；补充纠偏说明后可直接 Resume。"
		} else {
			timelineTone = "lime"
			agentState = "running"
			agentMood = "沿当前 thread 继续推进"
			runItem.NextAction = "继续沿当前讨论线程推进，并把状态回写到 Room / Run / Inbox。"
		}
		runItem.FollowThread = true
		runItem.Summary = summary
		runItem.ControlNote = summary
		runItem.Stdout = append(runItem.Stdout, fmt.Sprintf("[%s] %s: %s", now, actor, summary))
		roomItem.Topic.Summary = summary
		sessionItem.FollowThread = true
		sessionItem.Summary = summary
		sessionItem.ControlNote = summary
	default:
		return State{}, ErrRunControlUnsupportedAction
	}

	roomItem.Unread++
	s.appendRoomMessageLocked(roomItem.ID, Message{
		ID:      fmt.Sprintf("%s-run-control-%d", roomItem.ID, time.Now().UnixNano()),
		Speaker: actor,
		Role:    "human",
		Tone:    "human",
		Message: summary,
		Time:    now,
	})
	s.prependStatusInboxLocked(title, roomItem.Title, summary, href)
	runItem.Timeline = append(runItem.Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1),
		Label: title,
		At:    now,
		Tone:  timelineTone,
	})
	s.updateAgentStateLocked(runItem.Owner, agentState, agentMood)
	sessionItem.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	if err := appendRunArtifacts(
		s.workspaceRoot,
		roomItem.ID,
		issueItem.Key,
		runItem.Owner,
		runControlArtifactKind,
		fmt.Sprintf("- action: %s\n- actor: %s\n- note: %s\n- follow_thread: %t", action, actor, summary, runItem.FollowThread),
	); err != nil {
		return State{}, err
	}
	s.recordMemoryArtifactWritesLocked(runArtifactPaths(roomItem.ID, runItem.Owner), runControlArtifactKind, "run-control", actor)
	if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, decisionState, summary); err != nil {
		return State{}, err
	}
	s.recordMemoryArtifactWriteLocked(decisionArtifactPath(issueItem.Key), fmt.Sprintf("Decision status %s", decisionState), "run-control", actor)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}

	return cloneState(s.state), nil
}

func (s *Store) findRunControlTargetsLocked(runID string) (int, int, int, int, error) {
	runIndex := -1
	roomID := ""
	issueKey := ""
	for index := range s.state.Runs {
		if s.state.Runs[index].ID == runID {
			runIndex = index
			roomID = s.state.Runs[index].RoomID
			issueKey = s.state.Runs[index].IssueKey
			break
		}
	}
	if runIndex == -1 {
		return 0, 0, 0, 0, ErrRunControlRunNotFound
	}

	roomIndex := -1
	for index := range s.state.Rooms {
		if s.state.Rooms[index].ID == roomID {
			roomIndex = index
			break
		}
	}
	if roomIndex == -1 {
		return 0, 0, 0, 0, ErrRunControlRunNotFound
	}

	issueIndex := -1
	for index := range s.state.Issues {
		if s.state.Issues[index].Key == issueKey {
			issueIndex = index
			break
		}
	}
	if issueIndex == -1 {
		return 0, 0, 0, 0, ErrRunControlRunNotFound
	}

	sessionIndex := -1
	for index := range s.state.Sessions {
		if s.state.Sessions[index].ActiveRunID == runID {
			sessionIndex = index
			break
		}
	}
	if sessionIndex == -1 {
		return 0, 0, 0, 0, ErrRunControlSessionNotFound
	}

	return roomIndex, runIndex, issueIndex, sessionIndex, nil
}
