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

	scheduledMachine, provider, scheduler, err := s.scheduleRuntimeLocked(owner)
	if err != nil {
		return IssueCreationResult{}, err
	}
	runtimeName := strings.TrimSpace(scheduledMachine.Name)
	if runtimeName == "" {
		runtimeName = strings.TrimSpace(s.state.Workspace.PairedRuntime)
	}
	if runtimeName == "" {
		runtimeName = "unassigned"
	}
	machineName := runtimeName
	if strings.TrimSpace(scheduledMachine.Name) == "" && strings.TrimSpace(scheduledMachine.ID) != "" {
		machineName = strings.TrimSpace(scheduledMachine.ID)
	}

	newRun := Run{
		ID:           runID,
		IssueKey:     issueKey,
		RoomID:       roomID,
		TopicID:      topicID,
		Status:       "queued",
		Runtime:      runtimeName,
		Machine:      machineName,
		Provider:     provider,
		Branch:       fmt.Sprintf("feat/%s", slug),
		Worktree:     fmt.Sprintf("wt-%s", slug),
		WorktreePath: "",
		Owner:        owner,
		StartedAt:    now,
		Duration:     "0m",
		Summary:      summary,
		NextAction:   fmt.Sprintf("等待 worktree lane；%s", scheduler.Summary),
		PullRequest:  "未创建",
		Stdout: []string{
			fmt.Sprintf("[%s] 已创建 Issue Room 与默认 Topic", now),
			fmt.Sprintf("[%s] %s", now, scheduler.Summary),
		},
		Stderr:    []string{},
		ToolCalls: []ToolCall{{ID: fmt.Sprintf("%s-tool-1", runID), Tool: "openshock", Summary: "自动创建房间与执行 lane", Result: "成功"}},
		Timeline: []RunEvent{
			{ID: fmt.Sprintf("%s-ev-1", runID), Label: "Issue 已创建", At: now, Tone: "yellow"},
			{ID: fmt.Sprintf("%s-ev-2", runID), Label: runtimeSchedulerTimelineLabel(scheduler), At: now, Tone: "lime"},
		},
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
		Summary:      scheduler.Summary,
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
		Message: fmt.Sprintf("%s 已创建讨论间和默认 Topic，可以直接开始安排 Agent。%s", issueKey, scheduler.Summary),
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
	s.recordMemoryArtifactWritesLocked(runArtifactPaths(roomID, owner), "Issue Created", "issue-create", owner)
	if err := updateDecisionRecord(s.workspaceRoot, issueKey, "queued", "Issue 已创建，等待 worktree lane 与第一次指令。"); err != nil {
		return IssueCreationResult{}, err
	}
	s.recordMemoryArtifactWriteLocked(decisionArtifactPath(issueKey), "Decision status queued", "issue-create", owner)
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
	s.recordMemoryArtifactWritesLocked(runArtifactPaths(s.state.Runs[runIndex].RoomID, s.state.Runs[runIndex].Owner), "Worktree Ready", "lane-attach", s.state.Runs[runIndex].Owner)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) UpdateRuntimePairing(req RuntimePairingInput) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureRuntimeRegistryStateLocked()

	daemonURL := defaultString(strings.TrimSpace(req.DaemonURL), s.state.Workspace.PairedRuntimeURL)
	machine := defaultString(strings.TrimSpace(req.Machine), s.state.Workspace.PairedRuntime)
	runtimeState := defaultString(strings.TrimSpace(req.State), runtimeStateOnline)
	reportedAt := defaultString(strings.TrimSpace(req.ReportedAt), time.Now().UTC().Format(time.RFC3339))
	record := upsertRuntimeHeartbeatLocked(&s.state, RuntimeHeartbeatInput{
		RuntimeID:          req.RuntimeID,
		DaemonURL:          daemonURL,
		Machine:            machine,
		DetectedCLI:        req.DetectedCLI,
		Providers:          req.Providers,
		Shell:              req.Shell,
		State:              runtimeState,
		WorkspaceRoot:      req.WorkspaceRoot,
		ReportedAt:         reportedAt,
		HeartbeatIntervalS: int(defaultRuntimeHeartbeatInterval / time.Second),
		HeartbeatTimeoutS:  int(defaultRuntimeHeartbeatTimeout / time.Second),
	})
	if strings.TrimSpace(record.ID) != "" {
		machine = record.ID
	}

	s.state.Workspace.PairedRuntime = machine
	s.state.Workspace.PairedRuntimeURL = defaultString(strings.TrimSpace(record.DaemonURL), daemonURL)
	s.state.Workspace.PairingStatus = workspacePairingPaired
	s.state.Workspace.DeviceAuth = "browser-approved"
	s.state.Workspace.LastPairedAt = reportedAt

	for index := range s.state.Runtimes {
		s.state.Runtimes[index].PairingState = runtimePairingAvailable
		if matchesPairedRuntime(s.state.Workspace, s.state.Runtimes[index]) {
			s.state.Runtimes[index].PairingState = runtimePairingPaired
		}
	}

	now := shortClock()
	message := fmt.Sprintf("浏览器已完成本地 runtime 配对：%s -> %s", machine, s.state.Workspace.PairedRuntimeURL)
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

func (s *Store) UpdateRepoBinding(req RepoBindingInput) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	repo := defaultString(strings.TrimSpace(req.Repo), s.state.Workspace.Repo)
	repoURL := defaultString(strings.TrimSpace(req.RepoURL), s.state.Workspace.RepoURL)
	branch := defaultString(strings.TrimSpace(req.Branch), s.state.Workspace.Branch)
	provider := defaultString(strings.TrimSpace(req.Provider), "github")
	authMode := defaultString(strings.TrimSpace(req.AuthMode), "local-git-origin")
	detectedAt := defaultString(strings.TrimSpace(req.DetectedAt), time.Now().UTC().Format(time.RFC3339))
	syncedAt := defaultString(strings.TrimSpace(req.SyncedAt), detectedAt)
	if repo == "" || repoURL == "" {
		return State{}, fmt.Errorf("repo binding requires repo and repoUrl")
	}

	s.state.Workspace.Repo = repo
	s.state.Workspace.RepoURL = repoURL
	s.state.Workspace.Branch = branch
	s.state.Workspace.RepoProvider = provider
	s.state.Workspace.RepoBindingStatus = "bound"
	s.state.Workspace.RepoAuthMode = authMode
	s.state.Workspace.RepoBinding = WorkspaceRepoBindingSnapshot{
		Repo:          repo,
		RepoURL:       repoURL,
		Branch:        branch,
		Provider:      provider,
		BindingStatus: "bound",
		AuthMode:      authMode,
		DetectedAt:    detectedAt,
		SyncedAt:      syncedAt,
	}
	s.applyRepoBindingConnectionLocked(req, syncedAt)
	syncWorkspaceSnapshotDefaults(&s.state.Workspace)

	now := shortClock()
	s.appendChannelMessageLocked("announcements", Message{
		ID:      fmt.Sprintf("ann-repo-binding-%d", time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("工作区已绑定仓库：%s (%s)。", repo, authMode),
		Time:    now,
	})
	s.state.Inbox = append([]InboxItem{{
		ID:      fmt.Sprintf("inbox-repo-bound-%d", time.Now().UnixNano()),
		Title:   "仓库绑定已更新",
		Kind:    "status",
		Room:    "Setup",
		Time:    "刚刚",
		Summary: fmt.Sprintf("当前绑定仓库为 %s，分支 %s。", repo, branch),
		Action:  "打开配置",
		Href:    "/setup",
	}}, s.state.Inbox...)
	s.recordMemoryArtifactWriteLocked("repo-binding", fmt.Sprintf("%s @ %s (%s)", repo, branch, detectedAt), "repo-binding-sync", "System")

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) ClearRuntimePairing() (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureRuntimeRegistryStateLocked()

	now := shortClock()
	previousRuntime := s.state.Workspace.PairedRuntime
	if previousRuntime == "" {
		previousRuntime = "未命名 runtime"
	}

	s.state.Workspace.PairedRuntime = ""
	s.state.Workspace.PairedRuntimeURL = ""
	s.state.Workspace.PairingStatus = workspacePairingUnpaired
	s.state.Workspace.DeviceAuth = "revoked"
	s.state.Workspace.LastPairedAt = time.Now().UTC().Format(time.RFC3339)

	for index := range s.state.Runtimes {
		s.state.Runtimes[index].PairingState = runtimePairingAvailable
	}

	s.appendChannelMessageLocked("announcements", Message{
		ID:      fmt.Sprintf("ann-unpairing-%d", time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("浏览器已撤销本地 runtime 配对：%s。", previousRuntime),
		Time:    now,
	})
	s.state.Inbox = append([]InboxItem{{
		ID:      fmt.Sprintf("inbox-runtime-revoked-%d", time.Now().UnixNano()),
		Title:   "本地 Runtime 已撤销",
		Kind:    "status",
		Room:    "Setup",
		Time:    "刚刚",
		Summary: "浏览器设备授权已撤销，需要重新配对后才能继续使用本地 CLI。",
		Action:  "重新配对",
		Href:    "/setup",
	}}, s.state.Inbox...)

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) SelectRuntime(machine string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureRuntimeRegistryStateLocked()
	applyRuntimeDerivedTruth(&s.state, time.Now())

	machine = strings.TrimSpace(machine)
	if machine == "" {
		return State{}, fmt.Errorf("machine is required")
	}

	machineIndex := s.findMachineIndexLocked(machine)
	if machineIndex == -1 {
		return State{}, fmt.Errorf("runtime %s not found", machine)
	}

	selected := s.state.Machines[machineIndex]
	if strings.EqualFold(strings.TrimSpace(selected.State), runtimeStateOffline) || strings.EqualFold(strings.TrimSpace(selected.State), runtimeStateStale) {
		return State{}, fmt.Errorf("runtime %s is offline", selected.Name)
	}
	if strings.TrimSpace(selected.DaemonURL) == "" {
		return State{}, fmt.Errorf("runtime %s is not paired to a daemon", selected.Name)
	}

	s.state.Workspace.PairedRuntime = selected.Name
	s.state.Workspace.PairedRuntimeURL = strings.TrimSpace(selected.DaemonURL)
	s.state.Workspace.PairingStatus = workspacePairingPaired
	s.state.Workspace.DeviceAuth = "browser-approved"
	s.state.Workspace.LastPairedAt = time.Now().UTC().Format(time.RFC3339)
	for index := range s.state.Runtimes {
		s.state.Runtimes[index].PairingState = runtimePairingAvailable
		if matchesPairedRuntime(s.state.Workspace, s.state.Runtimes[index]) {
			s.state.Runtimes[index].PairingState = runtimePairingPaired
		}
	}

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) CreatePullRequest(roomID string) (State, string, error) {
	return s.CreatePullRequestFromRemote(roomID, PullRequestRemoteSnapshot{})
}

func (s *Store) scheduleRuntimeLocked(owner string) (Machine, string, RuntimeScheduler, error) {
	applyRuntimeDerivedTruth(&s.state, time.Now())
	result := buildRuntimeScheduler(s.state, owner)
	if strings.TrimSpace(result.Scheduler.AssignedMachine) == "" && strings.TrimSpace(result.Scheduler.AssignedRuntime) == "" {
		return Machine{}, result.Provider, result.Scheduler, ErrNoSchedulableRuntime
	}
	machineIndex := s.findMachineIndexLocked(result.Scheduler.AssignedMachine)
	if machineIndex == -1 {
		machineIndex = s.findMachineIndexLocked(result.Scheduler.AssignedRuntime)
	}
	if machineIndex == -1 {
		return Machine{}, result.Provider, result.Scheduler, ErrNoSchedulableRuntime
	}
	return s.state.Machines[machineIndex], result.Provider, result.Scheduler, nil
}

func (s *Store) findAgentIndexLocked(owner string) int {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return -1
	}
	for index := range s.state.Agents {
		if s.state.Agents[index].Name == owner {
			return index
		}
	}
	return -1
}

func (s *Store) findMachineIndexLocked(machine string) int {
	machine = strings.TrimSpace(machine)
	if machine == "" {
		return -1
	}
	for index := range s.state.Machines {
		if machineMatches(s.state.Machines[index], machine) {
			return index
		}
	}
	return -1
}

func (s *Store) findSchedulableMachineIndexLocked(machine string) int {
	machineIndex := s.findMachineIndexLocked(machine)
	if machineIndex == -1 {
		return -1
	}
	if !machineSchedulable(s.state.Machines[machineIndex]) {
		return -1
	}
	return machineIndex
}

func (s *Store) firstSchedulableMachineIndexLocked() int {
	for _, state := range []string{"online", "busy"} {
		for index := range s.state.Machines {
			if strings.EqualFold(strings.TrimSpace(s.state.Machines[index].State), state) && machineSchedulable(s.state.Machines[index]) {
				return index
			}
		}
	}
	return -1
}

func machineSchedulable(machine Machine) bool {
	state := strings.TrimSpace(machine.State)
	return strings.TrimSpace(machine.DaemonURL) != "" && (strings.EqualFold(state, runtimeStateOnline) || strings.EqualFold(state, runtimeStateBusy))
}

func machineMatches(machine Machine, name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	return machine.Name == name || machine.ID == name
}

func (s *Store) CreatePullRequestFromRemote(roomID string, remote PullRequestRemoteSnapshot) (State, string, error) {
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
	roomItem := &s.state.Rooms[roomIndex]
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]

	status := defaultString(strings.TrimSpace(remote.Status), "in_review")
	number := remote.Number
	if number <= 0 {
		number = s.nextPullRequestNumberLocked()
	}

	pr := PullRequest{
		ID:             fmt.Sprintf("pr-%d", number),
		Number:         number,
		Label:          pullRequestLabel(number, status),
		Title:          defaultString(strings.TrimSpace(remote.Title), issueItem.Title),
		Status:         status,
		IssueKey:       issueItem.Key,
		RoomID:         roomID,
		RunID:          runItem.ID,
		Branch:         defaultString(strings.TrimSpace(remote.Branch), runItem.Branch),
		BaseBranch:     defaultString(strings.TrimSpace(remote.BaseBranch), s.state.Workspace.Branch),
		Author:         defaultString(strings.TrimSpace(remote.Author), runItem.Owner),
		Provider:       defaultString(strings.TrimSpace(remote.Provider), s.state.Workspace.RepoProvider),
		URL:            strings.TrimSpace(remote.URL),
		ReviewDecision: strings.TrimSpace(remote.ReviewDecision),
		ReviewSummary:  defaultString(strings.TrimSpace(remote.ReviewSummary), summarizePullRequestStatus(status, strings.TrimSpace(remote.ReviewDecision))),
		UpdatedAt:      defaultString(strings.TrimSpace(remote.UpdatedAt), "刚刚"),
	}

	s.state.PullRequests = append([]PullRequest{pr}, s.state.PullRequests...)
	s.applyPullRequestLifecycleLocked(&s.state.PullRequests[0], roomItem, runItem, issueItem)

	runItem.ToolCalls = append(runItem.ToolCalls, ToolCall{
		ID:      fmt.Sprintf("%s-tool-%d", runItem.ID, len(runItem.ToolCalls)+1),
		Tool:    "github",
		Summary: "从讨论间创建远端 PR 并同步回控制面",
		Result:  "成功",
	})
	runItem.Timeline = append(runItem.Timeline, RunEvent{
		ID:    fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1),
		Label: "远端 PR 已创建",
		At:    now,
		Tone:  "lime",
	})
	s.appendRoomMessageLocked(roomID, Message{
		ID:      fmt.Sprintf("%s-pr-%d", roomID, time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("%s 已在 GitHub 创建并绑定到当前讨论间。", s.state.PullRequests[0].Label),
		Time:    now,
	})
	s.prependPullRequestInboxLocked(s.state.PullRequests[0], roomItem.Title)
	s.updateAgentStateLocked(runItem.Owner, "idle", "等待 GitHub PR 评审")

	if err := appendRunArtifacts(s.workspaceRoot, roomID, issueItem.Key, runItem.Owner, "Pull Request Created", fmt.Sprintf("- pr: %s\n- url: %s\n- head: %s\n- base: %s\n- run: %s", s.state.PullRequests[0].Label, defaultString(s.state.PullRequests[0].URL, "n/a"), s.state.PullRequests[0].Branch, defaultString(s.state.PullRequests[0].BaseBranch, "n/a"), runItem.ID)); err != nil {
		return State{}, "", err
	}
	s.recordMemoryArtifactWritesLocked(runArtifactPaths(roomID, runItem.Owner), "Pull Request Created", "pull-request-create", runItem.Owner)
	if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, decisionStateForPullRequestStatus(s.state.PullRequests[0].Status), s.state.PullRequests[0].ReviewSummary); err != nil {
		return State{}, "", err
	}
	s.recordMemoryArtifactWriteLocked(decisionArtifactPath(issueItem.Key), fmt.Sprintf("Decision status %s", decisionStateForPullRequestStatus(s.state.PullRequests[0].Status)), "pull-request-create", runItem.Owner)
	if err := s.persistLocked(); err != nil {
		return State{}, "", err
	}
	return cloneState(s.state), s.state.PullRequests[0].ID, nil
}

func (s *Store) SyncPullRequestFromRemote(pullRequestID string, remote PullRequestRemoteSnapshot) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	prIndex := s.findPullRequestLocked(pullRequestID)
	if prIndex == -1 {
		return State{}, fmt.Errorf("pull request not found")
	}

	pr := &s.state.PullRequests[prIndex]
	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(pr.RoomID)
	if !ok {
		return State{}, fmt.Errorf("room not found for pull request")
	}
	roomItem := &s.state.Rooms[roomIndex]
	runItem := &s.state.Runs[runIndex]
	issueItem := &s.state.Issues[issueIndex]

	oldStatus := pr.Status
	oldSummary := pr.ReviewSummary
	oldTitle := pr.Title
	oldURL := pr.URL
	oldReviewDecision := pr.ReviewDecision

	if remote.Number > 0 {
		pr.Number = remote.Number
	}
	if text := strings.TrimSpace(remote.Title); text != "" {
		pr.Title = text
	}
	if text := strings.TrimSpace(remote.Status); text != "" {
		pr.Status = text
	}
	if text := strings.TrimSpace(remote.Branch); text != "" {
		pr.Branch = text
	}
	if text := strings.TrimSpace(remote.BaseBranch); text != "" {
		pr.BaseBranch = text
	}
	if text := strings.TrimSpace(remote.Author); text != "" {
		pr.Author = text
	}
	if text := strings.TrimSpace(remote.Provider); text != "" {
		pr.Provider = text
	}
	if text := strings.TrimSpace(remote.URL); text != "" {
		pr.URL = text
	}
	if strings.TrimSpace(remote.ReviewDecision) != "" || pr.ReviewDecision != "" {
		pr.ReviewDecision = strings.TrimSpace(remote.ReviewDecision)
	}
	pr.Label = pullRequestLabel(pr.Number, pr.Status)
	pr.ReviewSummary = defaultString(strings.TrimSpace(remote.ReviewSummary), summarizePullRequestStatus(pr.Status, pr.ReviewDecision))
	pr.UpdatedAt = defaultString(strings.TrimSpace(remote.UpdatedAt), "刚刚")
	s.applyPullRequestLifecycleLocked(pr, roomItem, runItem, issueItem)

	changed := oldStatus != pr.Status || oldSummary != pr.ReviewSummary || oldTitle != pr.Title || oldURL != pr.URL || oldReviewDecision != pr.ReviewDecision
	if changed {
		now := shortClock()
		runItem.Timeline = append(runItem.Timeline, RunEvent{
			ID:    fmt.Sprintf("%s-ev-%d", runItem.ID, len(runItem.Timeline)+1),
			Label: fmt.Sprintf("PR 状态同步为 %s", pr.Status),
			At:    now,
			Tone:  "paper",
		})
		s.appendRoomMessageLocked(pr.RoomID, Message{
			ID:      fmt.Sprintf("%s-pr-status-%d", pr.RoomID, time.Now().UnixNano()),
			Speaker: "System",
			Role:    "system",
			Tone:    "system",
			Message: fmt.Sprintf("%s 已同步到 GitHub 当前状态：%s。", pr.Label, pr.Status),
			Time:    now,
		})
		s.prependPullRequestInboxLocked(*pr, roomItem.Title)

		if err := appendRunArtifacts(s.workspaceRoot, pr.RoomID, issueItem.Key, runItem.Owner, "Pull Request Status Updated", fmt.Sprintf("- pr: %s\n- status: %s\n- url: %s\n- summary: %s", pr.Label, pr.Status, defaultString(pr.URL, "n/a"), pr.ReviewSummary)); err != nil {
			return State{}, err
		}
		s.recordMemoryArtifactWritesLocked(runArtifactPaths(pr.RoomID, runItem.Owner), "Pull Request Status Updated", "pull-request-sync", runItem.Owner)
		if err := updateDecisionRecord(s.workspaceRoot, issueItem.Key, decisionStateForPullRequestStatus(pr.Status), pr.ReviewSummary); err != nil {
			return State{}, err
		}
		s.recordMemoryArtifactWriteLocked(decisionArtifactPath(issueItem.Key), fmt.Sprintf("Decision status %s", decisionStateForPullRequestStatus(pr.Status)), "pull-request-sync", runItem.Owner)
	}

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) UpdatePullRequestStatus(pullRequestID, status string) (State, error) {
	if strings.TrimSpace(status) == "" {
		return State{}, fmt.Errorf("status is required")
	}
	return s.SyncPullRequestFromRemote(pullRequestID, PullRequestRemoteSnapshot{
		Status:        status,
		ReviewSummary: summarizePullRequestStatus(status, ""),
	})
}

func (s *Store) applyPullRequestLifecycleLocked(pr *PullRequest, roomItem *Room, runItem *Run, issueItem *Issue) {
	issueItem.PullRequest = pr.Label
	runItem.PullRequest = pr.Label
	roomItem.Topic.Summary = pr.ReviewSummary
	runItem.Summary = pr.ReviewSummary
	runItem.ApprovalRequired = false

	switch pr.Status {
	case "merged":
		roomItem.Topic.Status = "done"
		runItem.Status = "done"
		issueItem.State = "done"
		runItem.NextAction = "已完成，等待后续归档。"
	case "changes_requested":
		roomItem.Topic.Status = "blocked"
		runItem.Status = "blocked"
		issueItem.State = "blocked"
		runItem.NextAction = "根据 GitHub Review 意见启动 follow-up run。"
	default:
		roomItem.Topic.Status = "review"
		runItem.Status = "review"
		issueItem.State = "review"
		runItem.NextAction = "等待 GitHub Review、同步结果或继续合并。"
	}

	s.updateSessionLocked(runItem.ID, func(item *Session) {
		item.Status = runItem.Status
		item.Summary = pr.ReviewSummary
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	})
}

func (s *Store) prependPullRequestInboxLocked(pr PullRequest, roomTitle string) {
	item := InboxItem{
		ID:   fmt.Sprintf("inbox-pr-%s-%d", pr.Status, time.Now().UnixNano()),
		Room: roomTitle,
		Time: "刚刚",
		Href: fmt.Sprintf("/rooms/%s/runs/%s", pr.RoomID, pr.RunID),
	}

	switch pr.Status {
	case "merged":
		item.Title = fmt.Sprintf("%s 已合并", pr.Label)
		item.Kind = "status"
		item.Summary = "远端 PR 已完成合并，可以回到 Board 查看 Done 列。"
		item.Action = "打开房间"
	case "changes_requested":
		item.Title = fmt.Sprintf("%s 需要补充修改", pr.Label)
		item.Kind = "blocked"
		item.Summary = "GitHub Review 已要求补充修改，当前需求需要 follow-up run。"
		item.Action = "恢复执行"
		item.Href = fmt.Sprintf("/rooms/%s", pr.RoomID)
	default:
		item.Title = fmt.Sprintf("%s 已准备评审", pr.Label)
		item.Kind = "review"
		item.Summary = "远端 PR 已创建并同步回控制面，等待人类做最终判断。"
		item.Action = "打开评审"
	}

	s.state.Inbox = append([]InboxItem{item}, s.state.Inbox...)
}

func summarizePullRequestStatus(status, reviewDecision string) string {
	switch strings.TrimSpace(status) {
	case "merged":
		return "PR 已在 GitHub 合并，Issue 与讨论间进入完成状态。"
	case "changes_requested":
		return "GitHub Review 要求补充修改，等待 follow-up run。"
	case "draft":
		return "远端草稿 PR 已创建，等待进入正式评审。"
	default:
		switch strings.TrimSpace(reviewDecision) {
		case "APPROVED":
			return "GitHub Review 已批准，等待最终合并。"
		case "CHANGES_REQUESTED":
			return "GitHub Review 要求补充修改，等待 follow-up run。"
		default:
			return "远端 PR 已创建，等待 GitHub Review 或合并。"
		}
	}
}

func decisionStateForPullRequestStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "merged":
		return "merged"
	case "changes_requested":
		return "blocked"
	default:
		return "review"
	}
}

func pullRequestLabel(number int, status string) string {
	if number > 0 {
		return fmt.Sprintf("PR #%d", number)
	}
	if strings.TrimSpace(status) == "draft" {
		return "草稿 PR"
	}
	return "PR"
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
	s.recordMemoryArtifactWritesLocked(runArtifactPaths(roomID, s.state.Issues[issueIndex].Owner), "Room Conversation", "room-conversation", s.state.Issues[issueIndex].Owner)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

type ChannelConversationInput struct {
	Prompt       string
	ReplySpeaker string
	ReplyRole    string
	ReplyTone    string
	ReplyMessage string
}

func (s *Store) AppendChannelConversation(channelID string, input ChannelConversationInput) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	channelIndex := -1
	for index := range s.state.Channels {
		if s.state.Channels[index].ID == channelID {
			channelIndex = index
			break
		}
	}
	if channelIndex == -1 {
		return State{}, fmt.Errorf("channel not found")
	}

	now := shortClock()
	humanMessage := Message{
		ID:      fmt.Sprintf("%s-human-%d", channelID, time.Now().UnixNano()),
		Speaker: "Lead_Architect",
		Role:    "human",
		Tone:    "human",
		Message: defaultString(strings.TrimSpace(input.Prompt), "空消息已忽略。"),
		Time:    now,
	}
	replyMessage := Message{
		ID:      fmt.Sprintf("%s-reply-%d", channelID, time.Now().UnixNano()),
		Speaker: defaultString(strings.TrimSpace(input.ReplySpeaker), "Shock_AI_Core"),
		Role:    defaultString(strings.TrimSpace(input.ReplyRole), "agent"),
		Tone:    defaultString(strings.TrimSpace(input.ReplyTone), "agent"),
		Message: defaultString(strings.TrimSpace(input.ReplyMessage), "已收到，但这次没有拿到可展示的回复。"),
		Time:    now,
	}
	s.appendChannelMessageLocked(channelID, humanMessage)
	s.appendChannelMessageLocked(channelID, replyMessage)
	s.state.Channels[channelIndex].Unread = 0

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
	s.recordMemoryArtifactWritesLocked(runArtifactPaths(roomID, s.state.Issues[issueIndex].Owner), "System Escalation", "system-escalation", speaker)
	if err := updateDecisionRecord(s.workspaceRoot, s.state.Issues[issueIndex].Key, "blocked", text); err != nil {
		return State{}, err
	}
	s.recordMemoryArtifactWriteLocked(decisionArtifactPath(s.state.Issues[issueIndex].Key), "Decision status blocked", "system-escalation", speaker)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) AppendGitHubPullRequestFailure(roomID, operation, pullRequestLabel, detail string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomIndex, runIndex, issueIndex, ok := s.findRoomRunIssueLocked(roomID)
	if !ok {
		return State{}, fmt.Errorf("room not found")
	}

	title := gitHubPullRequestFailureTitle(operation, pullRequestLabel)
	message := fmt.Sprintf("%s：%s", title, strings.TrimSpace(detail))
	nextAction := gitHubPullRequestFailureNextAction(operation)
	now := shortClock()
	failureHref := fmt.Sprintf("/rooms/%s/runs/%s", roomID, s.state.Runs[runIndex].ID)
	s.state.Rooms[roomIndex].Topic.Status = "blocked"
	s.state.Rooms[roomIndex].Topic.Summary = message
	s.state.Issues[issueIndex].State = "blocked"
	s.state.Runs[runIndex].Status = "blocked"
	s.state.Runs[runIndex].Summary = message
	s.state.Runs[runIndex].NextAction = nextAction
	s.syncPullRequestFailureSurfaceLocked(roomID, message)
	alreadyEscalated := s.hasGitHubPullRequestFailureEvidenceLocked(roomID, title, message, failureHref)
	if !alreadyEscalated {
		msg := Message{
			ID:      fmt.Sprintf("%s-system-%d", roomID, time.Now().UnixNano()),
			Speaker: "System",
			Role:    "system",
			Tone:    "blocked",
			Message: message,
			Time:    now,
		}
		s.state.RoomMessages[roomID] = append(s.state.RoomMessages[roomID], msg)
		s.state.Rooms[roomIndex].MessageIDs = append(s.state.Rooms[roomIndex].MessageIDs, msg.ID)
		s.state.Rooms[roomIndex].Unread++
		s.state.Runs[runIndex].Stderr = append(s.state.Runs[runIndex].Stderr, fmt.Sprintf("[%s] %s", now, message))
		s.state.Runs[runIndex].Timeline = append(s.state.Runs[runIndex].Timeline, RunEvent{
			ID:    fmt.Sprintf("%s-ev-%d", s.state.Runs[runIndex].ID, len(s.state.Runs[runIndex].Timeline)+1),
			Label: title,
			At:    now,
			Tone:  "pink",
		})
		s.state.Inbox = append([]InboxItem{{
			ID:      fmt.Sprintf("inbox-github-blocked-%d", time.Now().UnixNano()),
			Title:   title,
			Kind:    "blocked",
			Room:    s.state.Rooms[roomIndex].Title,
			Time:    "刚刚",
			Summary: message,
			Action:  "处理 GitHub 阻塞",
			Href:    failureHref,
		}}, s.state.Inbox...)
	}
	s.updateAgentStateLocked(s.state.Runs[runIndex].Owner, "blocked", title)
	s.updateSessionLocked(s.state.Runs[runIndex].ID, func(item *Session) {
		item.Status = "blocked"
		item.Summary = message
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if len(item.MemoryPaths) == 0 {
			item.MemoryPaths = defaultSessionMemoryPaths(item.RoomID, item.IssueKey)
		}
	})

	if !alreadyEscalated {
		if err := appendRunArtifacts(s.workspaceRoot, roomID, s.state.Issues[issueIndex].Key, s.state.Runs[runIndex].Owner, "System Escalation", fmt.Sprintf("- tone: blocked\n- message: %s", message)); err != nil {
			return State{}, err
		}
		s.recordMemoryArtifactWritesLocked(runArtifactPaths(roomID, s.state.Issues[issueIndex].Owner), "System Escalation", "system-escalation", "System")
		if err := updateDecisionRecord(s.workspaceRoot, s.state.Issues[issueIndex].Key, "blocked", message); err != nil {
			return State{}, err
		}
		s.recordMemoryArtifactWriteLocked(decisionArtifactPath(s.state.Issues[issueIndex].Key), "Decision status blocked", "system-escalation", "System")
	}
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) syncPullRequestFailureSurfaceLocked(roomID, message string) {
	prIndex := s.findPullRequestByRoomLocked(roomID)
	if prIndex == -1 {
		return
	}

	pr := &s.state.PullRequests[prIndex]
	pr.Status = "changes_requested"
	pr.Label = pullRequestLabel(pr.Number, pr.Status)
	pr.ReviewDecision = ""
	pr.ReviewSummary = message
	pr.UpdatedAt = "刚刚"

	reviewHref := fmt.Sprintf("/rooms/%s/runs/%s", pr.RoomID, pr.RunID)
	filtered := s.state.Inbox[:0]
	for _, item := range s.state.Inbox {
		if item.Kind == "review" && item.Href == reviewHref {
			continue
		}
		filtered = append(filtered, item)
	}
	s.state.Inbox = filtered
}

func (s *Store) hasGitHubPullRequestFailureEvidenceLocked(roomID, title, message, href string) bool {
	hasRoomMessage := false
	for _, item := range s.state.RoomMessages[roomID] {
		if item.Tone == "blocked" && item.Message == message {
			hasRoomMessage = true
			break
		}
	}
	if !hasRoomMessage {
		return false
	}
	for _, item := range s.state.Inbox {
		if item.Kind == "blocked" && item.Title == title && item.Summary == message && item.Href == href {
			return true
		}
	}
	return false
}

func gitHubPullRequestFailureTitle(operation, pullRequestLabel string) string {
	label := strings.TrimSpace(pullRequestLabel)
	switch strings.TrimSpace(operation) {
	case "create":
		return "GitHub PR 创建失败"
	case "merge":
		if label != "" {
			return fmt.Sprintf("%s 合并失败", label)
		}
		return "GitHub PR 合并失败"
	default:
		if label != "" {
			return fmt.Sprintf("%s 同步失败", label)
		}
		return "GitHub PR 同步失败"
	}
}

func gitHubPullRequestFailureNextAction(operation string) string {
	switch strings.TrimSpace(operation) {
	case "create":
		return "检查 GitHub 认证、origin 与分支推送状态后重试 PR 创建。"
	case "merge":
		return "检查 GitHub Review/权限状态后重试合并，或回到讨论间继续处理。"
	default:
		return "检查 GitHub 认证、远端 PR 状态与网络后重试同步。"
	}
}
