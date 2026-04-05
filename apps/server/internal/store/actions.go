package store

import (
	"fmt"
	"strings"
	"time"
)

func (s *Store) CreateIssue(req CreateIssueInput) (IssueCreationResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	title := defaultString(req.Title, "")
	if title == "" {
		return IssueCreationResult{}, fmt.Errorf("title is required")
	}

	owner := defaultString(req.Owner, "Claude Review Runner")
	priority := defaultString(req.Priority, "high")
	summary := defaultString(req.Summary, "新建需求，等待进入讨论间和 Run 主链路。")
	slug := slugify(title)
	if slug == "" {
		slug = fmt.Sprintf("issue-%d", time.Now().Unix())
	}

	issueNumber := s.nextIssueNumberLocked()
	issueKey := fmt.Sprintf("OPS-%d", issueNumber)
	roomID := fmt.Sprintf("room-%s", slug)
	topicID := fmt.Sprintf("topic-%s", slug)
	runID := fmt.Sprintf("run_%s_01", slug)
	now := shortClock()

	newIssue := Issue{
		ID:          fmt.Sprintf("issue-%s", slug),
		Key:         issueKey,
		Title:       title,
		Summary:     summary,
		State:       "queued",
		Priority:    priority,
		Owner:       owner,
		RoomID:      roomID,
		RunID:       runID,
		PullRequest: "未创建",
		Checklist:   []string{"确认需求边界", "进入讨论间并启动 Run", "生成 PR 并回写状态"},
	}

	newRoom := Room{
		ID:         roomID,
		IssueKey:   issueKey,
		Title:      fmt.Sprintf("%s 讨论间", title),
		Unread:     0,
		Summary:    summary,
		BoardCount: 1,
		RunID:      runID,
		MessageIDs: []string{fmt.Sprintf("%s-msg-1", roomID)},
		Topic: Topic{
			ID:      topicID,
			Title:   title,
			Status:  "queued",
			Owner:   owner,
			Summary: "新 Topic 已创建，等待进入执行。",
		},
	}

	newRun := Run{
		ID:           runID,
		IssueKey:     issueKey,
		RoomID:       roomID,
		TopicID:      topicID,
		Status:       "queued",
		Runtime:      s.state.Workspace.PairedRuntime,
		Machine:      "shock-main",
		Provider:     "Claude Code CLI",
		Branch:       fmt.Sprintf("feat/%s", slug),
		Worktree:     fmt.Sprintf("wt-%s", slug),
		WorktreePath: "",
		Owner:        owner,
		StartedAt:    now,
		Duration:     "0m",
		Summary:      summary,
		NextAction:   "进入讨论间并发送第一条指令。",
		PullRequest:  "未创建",
		Stdout:       []string{fmt.Sprintf("[%s] 已创建 Issue Room 与默认 Topic", now)},
		Stderr:       []string{},
		ToolCalls:    []ToolCall{{ID: fmt.Sprintf("%s-tool-1", runID), Tool: "openshock", Summary: "自动创建房间与执行 lane", Result: "成功"}},
		Timeline:     []RunEvent{{ID: fmt.Sprintf("%s-ev-1", runID), Label: "Issue 已创建", At: now, Tone: "yellow"}},
	}

	newSession := Session{
		ID:           fmt.Sprintf("session-%s", slug),
		IssueKey:     issueKey,
		RoomID:       roomID,
		TopicID:      topicID,
		ActiveRunID:  runID,
		Status:       "queued",
		Runtime:      newRun.Runtime,
		Machine:      newRun.Machine,
		Provider:     newRun.Provider,
		Branch:       newRun.Branch,
		Worktree:     newRun.Worktree,
		WorktreePath: "",
		Summary:      "Session 已创建，等待 worktree lane 就绪。",
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
		MemoryPaths:  defaultSessionMemoryPaths(roomID, issueKey),
	}

	s.state.Issues = append([]Issue{newIssue}, s.state.Issues...)
	s.state.Rooms = append([]Room{newRoom}, s.state.Rooms...)
	s.state.Runs = append([]Run{newRun}, s.state.Runs...)
	s.state.Sessions = append([]Session{newSession}, s.state.Sessions...)
	if s.state.RoomMessages == nil {
		s.state.RoomMessages = map[string][]Message{}
	}
	s.state.RoomMessages[roomID] = []Message{{
		ID:      fmt.Sprintf("%s-msg-1", roomID),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 已创建讨论间和默认 Topic，可以直接开始安排 Agent。", issueKey),
		Time:    now,
	}}
	s.state.Inbox = append([]InboxItem{{
		ID:      fmt.Sprintf("inbox-%s", slug),
		Title:   fmt.Sprintf("%s 已准备就绪", issueKey),
		Kind:    "status",
		Room:    newRoom.Title,
		Time:    "刚刚",
		Summary: "新的需求已经进入队列，等待第一条执行指令。",
		Action:  "打开房间",
		Href:    fmt.Sprintf("/rooms/%s", roomID),
	}}, s.state.Inbox...)
	s.appendChannelMessageLocked("announcements", Message{
		ID:      fmt.Sprintf("ann-%s", slug),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 已自动升级成新的讨论间：%s。", issueKey, newRoom.Title),
		Time:    now,
	})

	artifacts, err := ensureIssueArtifacts(s.workspaceRoot, newIssue, newRoom, owner, s.state.Memory)
	if err != nil {
		return IssueCreationResult{}, err
	}
	s.state.Memory = artifacts
	if err := appendRunArtifacts(s.workspaceRoot, roomID, issueKey, owner, "Issue Created", fmt.Sprintf("- title: %s\n- summary: %s\n- branch: %s\n- worktree: %s", title, summary, newRun.Branch, newRun.Worktree)); err != nil {
		return IssueCreationResult{}, err
	}
	if err := updateDecisionRecord(s.workspaceRoot, issueKey, "queued", "Issue 已创建，等待 worktree lane 与第一次指令。"); err != nil {
		return IssueCreationResult{}, err
	}
	if err := s.persistLocked(); err != nil {
		return IssueCreationResult{}, err
	}

	return IssueCreationResult{
		State:        cloneState(s.state),
		RoomID:       roomID,
		RunID:        runID,
		SessionID:    newSession.ID,
		Branch:       newRun.Branch,
		WorktreeName: newRun.Worktree,
	}, nil
}

func (s *Store) AttachLane(runID, sessionID string, payload LaneBinding) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runIndex := -1
	issueIndex := -1
	for index, item := range s.state.Runs {
		if item.ID == runID {
			runIndex = index
			break
		}
	}
	if runIndex == -1 {
		return State{}, fmt.Errorf("run not found")
	}
	for index, item := range s.state.Issues {
		if item.RunID == runID {
			issueIndex = index
			break
		}
	}
	if issueIndex == -1 {
		return State{}, fmt.Errorf("issue not found for run")
	}

	now := shortClock()
	s.state.Runs[runIndex].WorktreePath = payload.Path
	s.state.Runs[runIndex].Stdout = append(s.state.Runs[runIndex].Stdout, fmt.Sprintf("[%s] worktree 已就绪：%s", now, payload.Path))
	s.state.Runs[runIndex].Timeline = append(s.state.Runs[runIndex].Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].Timeline)+1),
		Label: "Worktree lane 已就绪",
		At:    now,
		Tone:  "lime",
	})
	s.updateSessionByIDLocked(sessionID, func(item *Session) {
		item.WorktreePath = payload.Path
		item.Status = "ready"
		item.Summary = "Worktree lane 已创建，可以开始执行。"
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})
	s.appendRoomMessageLocked(s.state.Runs[runIndex].RoomID, Message{
		ID:      fmt.Sprintf("%s-worktree-%d", s.state.Runs[runIndex].RoomID, time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("执行 lane 已就绪：%s", payload.Path),
		Time:    now,
	})

	if err := appendRunArtifacts(s.workspaceRoot, s.state.Runs[runIndex].RoomID, s.state.Issues[issueIndex].Key, s.state.Runs[runIndex].Owner, "Worktree Ready", fmt.Sprintf("- branch: %s\n- worktree: %s\n- path: %s", payload.Branch, payload.WorktreeName, payload.Path)); err != nil {
		return State{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) UpdateRuntimePairing(req RuntimePairingInput) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	daemonURL := defaultString(strings.TrimSpace(req.DaemonURL), s.state.Workspace.PairedRuntimeURL)
	machine := defaultString(strings.TrimSpace(req.Machine), "shock-main")
	runtimeState := defaultString(strings.TrimSpace(req.State), "online")
	reportedAt := defaultString(strings.TrimSpace(req.ReportedAt), time.Now().UTC().Format(time.RFC3339))
	cliLabel := "none-detected"
	if len(req.DetectedCLI) > 0 {
		cliLabel = strings.Join(req.DetectedCLI, " + ")
	}

	s.state.Workspace.PairedRuntime = machine
	s.state.Workspace.PairedRuntimeURL = daemonURL
	s.state.Workspace.PairingStatus = "paired"
	s.state.Workspace.DeviceAuth = "browser-approved"
	s.state.Workspace.LastPairedAt = reportedAt

	machineIndex := -1
	for index := range s.state.Machines {
		if s.state.Machines[index].Name == machine || s.state.Machines[index].ID == machine {
			machineIndex = index
			break
		}
	}
	if machineIndex == -1 {
		s.state.Machines = append([]Machine{{
			ID:            machine,
			Name:          machine,
			State:         runtimeState,
			CLI:           cliLabel,
			OS:            "Local",
			LastHeartbeat: "刚刚",
		}}, s.state.Machines...)
	} else {
		s.state.Machines[machineIndex].Name = machine
		s.state.Machines[machineIndex].State = runtimeState
		s.state.Machines[machineIndex].CLI = cliLabel
		s.state.Machines[machineIndex].LastHeartbeat = "刚刚"
	}

	now := shortClock()
	message := fmt.Sprintf("浏览器已完成本地 runtime 配对：%s -> %s", machine, daemonURL)
	s.appendChannelMessageLocked("announcements", Message{
		ID:      fmt.Sprintf("ann-pairing-%d", time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: message,
		Time:    now,
	})
	s.state.Inbox = append([]InboxItem{{
		ID:      fmt.Sprintf("inbox-runtime-paired-%d", time.Now().UnixNano()),
		Title:   "本地 Runtime 已配对",
		Kind:    "status",
		Room:    "Setup",
		Time:    "刚刚",
		Summary: "浏览器设备授权已经完成，可以直接从讨论间启动真实 Run。",
		Action:  "打开配置",
		Href:    "/setup",
	}}, s.state.Inbox...)

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) CreatePullRequest(roomID string) (State, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, "", fmt.Errorf("room not found")
	}
	if existingIndex := s.findPullRequestByRoomLocked(roomID); existingIndex != -1 {
		existing := s.state.PullRequests[existingIndex]
		return cloneState(s.state), existing.ID, nil
	}

	now := shortClock()
	nextNumber := s.nextPullRequestNumberLocked()
	label := fmt.Sprintf("PR #%d", nextNumber)
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]
	roomItem := &s.state.Rooms[roomIndex]

	pr := PullRequest{
		ID:            fmt.Sprintf("pr-%d", nextNumber),
		Number:        nextNumber,
		Label:         label,
		Title:         issueItem.Title,
		Status:        "in_review",
		IssueKey:      issueItem.Key,
		RoomID:        roomID,
		RunID:         runItem.ID,
		Branch:        runItem.Branch,
		Author:        runItem.Owner,
		ReviewSummary: "PR 已创建，等待人类进行 Review 或合并。",
		UpdatedAt:     "刚刚",
	}

	s.state.PullRequests = append([]PullRequest{pr}, s.state.PullRequests...)
	issueItem.PullRequest = label
	issueItem.State = "review"
	runItem.PullRequest = label
	runItem.Status = "review"
	runItem.Summary = pr.ReviewSummary
	runItem.ApprovalRequired = false
	runItem.NextAction = "等待 Review 结果或合并。"
	runItem.ToolCalls = append(runItem.ToolCalls, ToolCall{ID: fmt.Sprintf("%s-tool-%d", runItem.ID, len(runItem.ToolCalls)+1), Tool: "github", Summary: "从讨论间创建 PR 并进入 Review", Result: "成功"})
	runItem.Timeline = append(runItem.Timeline, RunEvent{ID: fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1), Label: "PR 已创建", At: now, Tone: "lime"})
	roomItem.Topic.Status = "review"
	roomItem.Topic.Summary = "PR 已创建，讨论间进入评审模式。"
	s.updateSessionLocked(runItem.ID, func(item *Session) {
		item.Status = "review"
		item.Summary = "PR 已创建，等待评审。"
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	})
	s.appendRoomMessageLocked(roomID, Message{
		ID:      fmt.Sprintf("%s-pr-%d", roomID, time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 已创建并绑定到当前讨论间，进入评审状态。", label),
		Time:    now,
	})
	s.state.Inbox = append([]InboxItem{{
		ID:      fmt.Sprintf("inbox-pr-review-%d", nextNumber),
		Title:   fmt.Sprintf("%s 已准备评审", label),
		Kind:    "review",
		Room:    roomItem.Title,
		Time:    "刚刚",
		Summary: "代码修改已经收口到 PR，等待人类做最终判断。",
		Action:  "打开评审",
		Href:    fmt.Sprintf("/rooms/%s/runs/%s", roomID, runItem.ID),
	}}, s.state.Inbox...)
	s.updateAgentStateLocked(runItem.Owner, "idle", "等待 PR 评审")

	if err := appendRunArtifacts(s.workspaceRoot, roomID, issueItem.Key, runItem.Owner, "Pull Request Created", fmt.Sprintf("- pr: %s\n- branch: %s\n- run: %s", label, runItem.Branch, runItem.ID)); err != nil {
		return State{}, "", err
	}
	if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, "review", fmt.Sprintf("%s 已创建，等待评审。", label)); err != nil {
		return State{}, "", err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, "", err
	}
	return cloneState(s.state), pr.ID, nil
}

func (s *Store) UpdatePullRequestStatus(pullRequestID, status string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if status == "" {
		return State{}, fmt.Errorf("status is required")
	}
	prIndex := s.findPullRequestLocked(pullRequestID)
	if prIndex == -1 {
		return State{}, fmt.Errorf("pull request not found")
	}

	pr := &s.state.PullRequests[prIndex]
	now := shortClock()
	pr.Status = status
	pr.UpdatedAt = "刚刚"

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(pr.RoomID)
	if !ok {
		return State{}, fmt.Errorf("room not found for pull request")
	}
	roomItem := &s.state.Rooms[roomIndex]
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]

	switch status {
	case "in_review", "open":
		pr.ReviewSummary = "PR 正在等待 Review。"
		roomItem.Topic.Status = "review"
		roomItem.Topic.Summary = pr.ReviewSummary
		runItem.Status = "review"
		issueItem.State = "review"
		runItem.Summary = pr.ReviewSummary
		runItem.NextAction = "等待人类 Review 或补充反馈。"
	case "changes_requested":
		pr.ReviewSummary = "评审要求补充修改，等待 follow-up run。"
		roomItem.Topic.Status = "blocked"
		roomItem.Topic.Summary = pr.ReviewSummary
		runItem.Status = "blocked"
		issueItem.State = "blocked"
		runItem.Summary = pr.ReviewSummary
		runItem.NextAction = "根据 Review 意见启动 follow-up run。"
		s.state.Inbox = append([]InboxItem{{ID: fmt.Sprintf("inbox-pr-change-%d", pr.Number), Title: fmt.Sprintf("%s 需要补充修改", pr.Label), Kind: "blocked", Room: roomItem.Title, Time: "刚刚", Summary: "Review 已打回，当前需求需要 follow-up run。", Action: "恢复执行", Href: fmt.Sprintf("/rooms/%s", pr.RoomID)}}, s.state.Inbox...)
	case "merged":
		pr.ReviewSummary = "PR 已合并，Issue 与讨论间进入完成状态。"
		roomItem.Topic.Status = "done"
		roomItem.Topic.Summary = pr.ReviewSummary
		runItem.Status = "done"
		issueItem.State = "done"
		runItem.Summary = pr.ReviewSummary
		runItem.NextAction = "已完成，等待后续归档。"
		s.state.Inbox = append([]InboxItem{{ID: fmt.Sprintf("inbox-pr-merged-%d", pr.Number), Title: fmt.Sprintf("%s 已合并", pr.Label), Kind: "status", Room: roomItem.Title, Time: "刚刚", Summary: "需求已经完成，可以回到 Board 查看 Done 列。", Action: "打开房间", Href: fmt.Sprintf("/rooms/%s", pr.RoomID)}}, s.state.Inbox...)
	default:
		return State{}, fmt.Errorf("unsupported pull request status")
	}

	s.updateSessionLocked(runItem.ID, func(item *Session) {
		item.Status = runItem.Status
		item.Summary = pr.ReviewSummary
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	})
	runItem.Timeline = append(runItem.Timeline, RunEvent{ID: fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1), Label: fmt.Sprintf("PR 状态更新为 %s", status), At: now, Tone: "paper"})
	s.appendRoomMessageLocked(pr.RoomID, Message{
		ID:      fmt.Sprintf("%s-pr-status-%d", pr.RoomID, time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 状态已更新为 %s。", pr.Label, status),
		Time:    now,
	})

	if err := appendRunArtifacts(s.workspaceRoot, pr.RoomID, issueItem.Key, runItem.Owner, "Pull Request Status Updated", fmt.Sprintf("- pr: %s\n- status: %s\n- summary: %s", pr.Label, status, pr.ReviewSummary)); err != nil {
		return State{}, err
	}
	if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, status, pr.ReviewSummary); err != nil {
		return State{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) AppendConversation(roomID, prompt, output string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found")
	}

	now := shortClock()
	humanMessage := Message{ID: fmt.Sprintf("%s-human-%d", roomID, time.Now().UnixNano()), Speaker: "Lead_Architect", Role: "human", Tone: "human", Message: prompt, Time: now}
	agentText := defaultString(strings.TrimSpace(output), "已收到，但这次没有可展示的文本输出。")
	agentMessage := Message{ID: fmt.Sprintf("%s-agent-%d", roomID, time.Now().UnixNano()), Speaker: "Shock_AI_Core", Role: "agent", Tone: "agent", Message: agentText, Time: now}

	s.state.RoomMessages[roomID] = append(s.state.RoomMessages[roomID], humanMessage, agentMessage)
	s.state.Rooms[roomIndex].MessageIDs = append(s.state.Rooms[roomIndex].MessageIDs, humanMessage.ID, agentMessage.ID)
	s.state.Rooms[roomIndex].Unread = 0
	s.state.Rooms[roomIndex].Topic.Status = "running"
	s.state.Rooms[roomIndex].Topic.Summary = agentText
	s.state.Issues[issueIndex].State = "running"
	s.state.Runs[runIndex].Status = "running"
	s.state.Runs[runIndex].StartedAt = now
	s.state.Runs[runIndex].Duration = "实时"
	s.state.Runs[runIndex].Summary = agentText
	s.state.Runs[runIndex].NextAction = "继续在讨论间追加约束或验收标准。"
	s.state.Runs[runIndex].Stdout = append(s.state.Runs[runIndex].Stdout, fmt.Sprintf("[%s] %s", now, agentText))
	s.state.Runs[runIndex].ToolCalls = append(s.state.Runs[runIndex].ToolCalls, ToolCall{ID: fmt.Sprintf("%s-tool-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].ToolCalls)+1), Tool: "claude-code", Summary: "讨论间对话已同步到本地 CLI", Result: "成功"})
	s.state.Runs[runIndex].Timeline = append(s.state.Runs[runIndex].Timeline, RunEvent{ID: fmt.Sprintf("%s-ev-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].Timeline)+1), Label: "已收到新指令并返回结果", At: now, Tone: "lime"})
	s.updateAgentStateLocked(s.state.Issues[issueIndex].Owner, "running", "正在处理讨论间新指令")
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		item.Status = "running"
		item.Summary = agentText
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	})

	if err := appendRunArtifacts(s.workspaceRoot, roomID, s.state.Issues[issueIndex].Key, s.state.Issues[issueIndex].Owner, "Room Conversation", fmt.Sprintf("- prompt: %s\n- output: %s", prompt, agentText)); err != nil {
		return State{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) AppendSystemRoomMessage(roomID, speaker, text, tone string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found")
	}

	now := shortClock()
	msg := Message{ID: fmt.Sprintf("%s-system-%d", roomID, time.Now().UnixNano()), Speaker: speaker, Role: "system", Tone: tone, Message: text, Time: now}
	s.state.RoomMessages[roomID] = append(s.state.RoomMessages[roomID], msg)
	s.state.Rooms[roomIndex].MessageIDs = append(s.state.Rooms[roomIndex].MessageIDs, msg.ID)
	s.state.Rooms[roomIndex].Unread++
	s.state.Rooms[roomIndex].Topic.Status = "blocked"
	s.state.Rooms[roomIndex].Topic.Summary = text
	s.state.Issues[issueIndex].State = "blocked"
	s.state.Runs[runIndex].Status = "blocked"
	s.state.Runs[runIndex].Summary = text
	s.state.Runs[runIndex].NextAction = "等待人工处理、重试 CLI，或切换 provider。"
	s.state.Runs[runIndex].Stderr = append(s.state.Runs[runIndex].Stderr, fmt.Sprintf("[%s] %s", now, text))
	s.state.Inbox = append([]InboxItem{{ID: fmt.Sprintf("inbox-blocked-%d", time.Now().UnixNano()), Title: "CLI 连接失败，等待人工处理", Kind: "blocked", Room: s.state.Rooms[roomIndex].Title, Time: "刚刚", Summary: text, Action: "解除阻塞", Href: fmt.Sprintf("/rooms/%s", roomID)}}, s.state.Inbox...)
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		item.Status = "blocked"
		item.Summary = text
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})

	if err := appendRunArtifacts(s.workspaceRoot, roomID, s.state.Issues[issueIndex].Key, s.state.Issues[issueIndex].Owner, "System Escalation", fmt.Sprintf("- tone: %s\n- message: %s", tone, text)); err != nil {
		return State{}, err
	}
	if err := updateDecisionRecord(s.workspaceRoot, s.state.Issues[issueIndex].Key, "blocked", text); err != nil {
		return State{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}
