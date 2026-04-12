package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCreateIssueInitializesSessionMemoryPaths(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(RuntimePairingInput{
		DaemonURL:   "http://127.0.0.1:8091",
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	result, err := s.CreateIssue(CreateIssueInput{
		Title:    "Session Memory Ready",
		Summary:  "verify session memory paths",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(result.RunID, result.SessionID, LaneBinding{
		Branch:       result.Branch,
		WorktreeName: result.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", result.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	snapshot := s.Snapshot()
	session := findSessionByID(snapshot, result.SessionID)
	if session == nil {
		t.Fatalf("session %q not found", result.SessionID)
	}

	if len(session.MemoryPaths) != 4 {
		t.Fatalf("expected 4 session memory paths, got %d: %#v", len(session.MemoryPaths), session.MemoryPaths)
	}

	want := []string{
		"MEMORY.md",
		"notes/work-log.md",
		filepath.ToSlash(filepath.Join("notes", "rooms", "room-session-memory-ready.md")),
		filepath.ToSlash(filepath.Join("decisions", "ops-28.md")),
	}
	for _, path := range want {
		if !contains(session.MemoryPaths, path) {
			t.Fatalf("expected session memory paths to contain %q, got %#v", path, session.MemoryPaths)
		}
	}
}

func TestCreateIssueSchedulesOwnerPreferredRuntime(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(RuntimePairingInput{
		DaemonURL:   "http://127.0.0.1:8091",
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	result, err := s.CreateIssue(CreateIssueInput{
		Title:    "Runtime Scheduler Ready",
		Summary:  "verify multi-runtime scheduling",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	snapshot := s.Snapshot()
	run := findRunByID(snapshot, result.RunID)
	session := findSessionByID(snapshot, result.SessionID)
	if run == nil || session == nil {
		t.Fatalf("expected run/session to exist after create issue")
	}

	if run.Runtime != "shock-sidecar" || run.Machine != "shock-sidecar" {
		t.Fatalf("run scheduling = runtime %q machine %q, want shock-sidecar", run.Runtime, run.Machine)
	}
	if run.Provider != "Claude Code CLI" {
		t.Fatalf("run provider = %q, want Claude Code CLI", run.Provider)
	}
	if session.Runtime != "shock-sidecar" || session.Machine != "shock-sidecar" || session.Provider != "Claude Code CLI" {
		t.Fatalf("session scheduling = %#v, want shock-sidecar / Claude Code CLI", session)
	}
}

func TestPersistedStateIncludesDerivedRuntimeTruth(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	created, err := s.CreateIssue(CreateIssueInput{
		Title:    "Persisted Runtime Truth",
		Summary:  "verify persisted state keeps derived lease and scheduler truth",
		Owner:    "Codex Dockmaster",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	body, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("ReadFile(statePath) error = %v", err)
	}

	var persisted State
	if err := json.Unmarshal(body, &persisted); err != nil {
		t.Fatalf("json.Unmarshal(persisted state) error = %v", err)
	}

	if persisted.RuntimeScheduler.AssignedRuntime != "shock-main" {
		t.Fatalf("persisted runtime scheduler = %#v, want assigned runtime shock-main", persisted.RuntimeScheduler)
	}

	var lease *RuntimeLease
	for index := range persisted.RuntimeLeases {
		if persisted.RuntimeLeases[index].SessionID == created.SessionID {
			lease = &persisted.RuntimeLeases[index]
			break
		}
	}
	if lease == nil {
		t.Fatalf("persisted runtime leases missing session %q: %#v", created.SessionID, persisted.RuntimeLeases)
	}
	if lease.Runtime != "shock-main" || lease.Machine != "shock-main" {
		t.Fatalf("persisted runtime lease = %#v, want shock-main runtime/machine", lease)
	}
}

func TestCreateIssueRejectsWhenAllRuntimesOffline(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Now().UTC()
	if _, err := s.UpdateRuntimePairing(RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: now.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpsertRuntimeHeartbeat(RuntimeHeartbeatInput{
		RuntimeID:          "shock-sidecar",
		DaemonURL:          "http://127.0.0.1:8091",
		Machine:            "shock-sidecar",
		State:              "online",
		ReportedAt:         now.Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat(sidecar online) error = %v", err)
	}

	offlineReportedAt := now.Add(-2 * time.Minute).Format(time.RFC3339)
	for _, runtimeID := range []string{"shock-main", "shock-sidecar"} {
		if _, err := s.UpsertRuntimeHeartbeat(RuntimeHeartbeatInput{
			RuntimeID:          runtimeID,
			DaemonURL:          map[string]string{"shock-main": "http://127.0.0.1:8090", "shock-sidecar": "http://127.0.0.1:8091"}[runtimeID],
			Machine:            runtimeID,
			State:              "online",
			ReportedAt:         offlineReportedAt,
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		}); err != nil {
			t.Fatalf("UpsertRuntimeHeartbeat(%s offline) error = %v", runtimeID, err)
		}
	}

	before := s.Snapshot()
	_, err = s.CreateIssue(CreateIssueInput{
		Title:    "All Offline Runtime",
		Summary:  "verify scheduler rejects offline runtimes",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != ErrNoSchedulableRuntime {
		t.Fatalf("CreateIssue() error = %v, want %v", err, ErrNoSchedulableRuntime)
	}

	after := s.Snapshot()
	if len(after.Issues) != len(before.Issues) || len(after.Runs) != len(before.Runs) || len(after.Sessions) != len(before.Sessions) {
		t.Fatalf("create issue mutated state on failure: before issues/runs/sessions = %d/%d/%d after = %d/%d/%d", len(before.Issues), len(before.Runs), len(before.Sessions), len(after.Issues), len(after.Runs), len(after.Sessions))
	}
	if after.Workspace.PairingStatus != workspacePairingDegraded {
		t.Fatalf("pairing status = %q, want %q", after.Workspace.PairingStatus, workspacePairingDegraded)
	}
	for _, machine := range after.Machines {
		if machine.Name == "shock-main" || machine.Name == "shock-sidecar" {
			if machine.State != runtimeStateOffline {
				t.Fatalf("machine %s state = %q, want %q", machine.Name, machine.State, runtimeStateOffline)
			}
		}
	}
}

func TestCreateIssueFailsOverToLeastLoadedRuntimeWhenPreferredRuntimeIsOffline(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Now().UTC()
	if _, err := s.UpdateRuntimePairing(RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: now.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	for _, runtime := range []struct {
		id        string
		daemonURL string
	}{
		{id: "shock-sidecar", daemonURL: "http://127.0.0.1:8091"},
		{id: "shock-spare", daemonURL: "http://127.0.0.1:8092"},
	} {
		if _, err := s.UpsertRuntimeHeartbeat(RuntimeHeartbeatInput{
			RuntimeID:          runtime.id,
			DaemonURL:          runtime.daemonURL,
			Machine:            runtime.id,
			State:              "online",
			ReportedAt:         now.Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		}); err != nil {
			t.Fatalf("UpsertRuntimeHeartbeat(%s) error = %v", runtime.id, err)
		}
	}

	sidecarLoad, err := s.CreateIssue(CreateIssueInput{
		Title:    "Sidecar Load",
		Summary:  "occupy sidecar lease so failover has to choose spare",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue(sidecar load) error = %v", err)
	}
	var sidecarRun *Run
	for index := range sidecarLoad.State.Runs {
		if sidecarLoad.State.Runs[index].ID == sidecarLoad.RunID {
			sidecarRun = &sidecarLoad.State.Runs[index]
			break
		}
	}
	if sidecarRun == nil || sidecarRun.Runtime != "shock-sidecar" {
		t.Fatalf("sidecar load runtime = %#v, want shock-sidecar", sidecarRun)
	}

	if _, err := s.UpsertRuntimeHeartbeat(RuntimeHeartbeatInput{
		RuntimeID:          "shock-main",
		DaemonURL:          "http://127.0.0.1:8090",
		Machine:            "shock-main",
		State:              "online",
		ReportedAt:         now.Add(-2 * time.Minute).Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat(shock-main offline) error = %v", err)
	}

	snapshot := s.Snapshot()
	if snapshot.RuntimeScheduler.Strategy != runtimeSchedulerStrategyFailover {
		t.Fatalf("scheduler strategy = %q, want %q", snapshot.RuntimeScheduler.Strategy, runtimeSchedulerStrategyFailover)
	}
	if snapshot.RuntimeScheduler.AssignedRuntime != "shock-spare" {
		t.Fatalf("scheduler assigned runtime = %q, want shock-spare", snapshot.RuntimeScheduler.AssignedRuntime)
	}
	if snapshot.RuntimeScheduler.FailoverFrom != "shock-main" {
		t.Fatalf("scheduler failoverFrom = %q, want shock-main", snapshot.RuntimeScheduler.FailoverFrom)
	}
	var sidecarCandidate *RuntimeSchedulerCandidate
	for index := range snapshot.RuntimeScheduler.Candidates {
		if snapshot.RuntimeScheduler.Candidates[index].Runtime == "shock-sidecar" {
			sidecarCandidate = &snapshot.RuntimeScheduler.Candidates[index]
			break
		}
	}
	if sidecarCandidate == nil || sidecarCandidate.ActiveLeaseCount < 1 {
		t.Fatalf("sidecar candidate = %#v, want active lease pressure", sidecarCandidate)
	}
	var spareCandidate *RuntimeSchedulerCandidate
	for index := range snapshot.RuntimeScheduler.Candidates {
		if snapshot.RuntimeScheduler.Candidates[index].Runtime == "shock-spare" {
			spareCandidate = &snapshot.RuntimeScheduler.Candidates[index]
			break
		}
	}
	if spareCandidate == nil || sidecarCandidate.ActiveLeaseCount <= spareCandidate.ActiveLeaseCount {
		t.Fatalf("scheduler candidates = %#v, want sidecar pressure greater than spare", snapshot.RuntimeScheduler.Candidates)
	}

	failoverResult, err := s.CreateIssue(CreateIssueInput{
		Title:    "Offline Failover Lane",
		Summary:  "verify scheduler chooses least-loaded runtime during failover",
		Owner:    "Codex Dockmaster",
		Priority: "critical",
	})
	if err != nil {
		t.Fatalf("CreateIssue(failover) error = %v", err)
	}

	var failoverRun *Run
	for index := range failoverResult.State.Runs {
		if failoverResult.State.Runs[index].ID == failoverResult.RunID {
			failoverRun = &failoverResult.State.Runs[index]
			break
		}
	}
	if failoverRun == nil {
		t.Fatalf("failover run %q missing from state", failoverResult.RunID)
	}
	if failoverRun.Runtime != "shock-spare" || failoverRun.Machine != "shock-spare" {
		t.Fatalf("failover runtime = %#v, want shock-spare", failoverRun)
	}
	if !strings.Contains(failoverRun.NextAction, "已切换到 shock-spare") {
		t.Fatalf("run next action = %q, want failover switch wording", failoverRun.NextAction)
	}
	if len(failoverRun.Timeline) < 2 || failoverRun.Timeline[1].Label != "Runtime 已 failover 到 shock-spare" {
		t.Fatalf("run timeline = %#v, want failover event", failoverRun.Timeline)
	}

	var failoverSession *Session
	for index := range failoverResult.State.Sessions {
		if failoverResult.State.Sessions[index].ActiveRunID == failoverResult.RunID {
			failoverSession = &failoverResult.State.Sessions[index]
			break
		}
	}
	if failoverSession == nil || !strings.Contains(failoverSession.Summary, "已切换到 shock-spare") {
		t.Fatalf("failover session = %#v, want runtime switch summary", failoverSession)
	}
}

func TestSelectRuntimePersistsSelectedDaemon(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(RuntimePairingInput{
		DaemonURL:   "http://127.0.0.1:8091",
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	nextState, err := s.SelectRuntime("shock-sidecar")
	if err != nil {
		t.Fatalf("SelectRuntime() error = %v", err)
	}

	if nextState.Workspace.PairedRuntime != "shock-sidecar" {
		t.Fatalf("paired runtime = %q, want shock-sidecar", nextState.Workspace.PairedRuntime)
	}
	if nextState.Workspace.PairedRuntimeURL != "http://127.0.0.1:8091" {
		t.Fatalf("paired runtime url = %q, want http://127.0.0.1:8091", nextState.Workspace.PairedRuntimeURL)
	}
}

func TestRuntimeHeartbeatLifecycleDegradesAndRecoversPairedRuntime(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339)
	state, err := s.UpdateRuntimePairing(RuntimePairingInput{
		RuntimeID:  "shock-stale",
		DaemonURL:  "http://127.0.0.1:8099",
		Machine:    "shock-stale",
		State:      "online",
		ReportedAt: reportedAt,
	})
	if err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	if state.Workspace.PairingStatus != workspacePairingDegraded {
		t.Fatalf("pairing status = %q, want %q", state.Workspace.PairingStatus, workspacePairingDegraded)
	}

	var staleRuntime *RuntimeRecord
	for index := range state.Runtimes {
		if state.Runtimes[index].ID == "shock-stale" {
			staleRuntime = &state.Runtimes[index]
			break
		}
	}
	if staleRuntime == nil {
		t.Fatalf("runtime shock-stale missing from registry: %#v", state.Runtimes)
	}
	if staleRuntime.State != runtimeStateOffline {
		t.Fatalf("runtime state = %q, want %q", staleRuntime.State, runtimeStateOffline)
	}

	recovered, err := s.UpsertRuntimeHeartbeat(RuntimeHeartbeatInput{
		RuntimeID:  "shock-stale",
		DaemonURL:  "http://127.0.0.1:8099",
		Machine:    "shock-stale",
		State:      "online",
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat() error = %v", err)
	}
	if recovered.Workspace.PairingStatus != workspacePairingPaired {
		t.Fatalf("pairing status after heartbeat = %q, want %q", recovered.Workspace.PairingStatus, workspacePairingPaired)
	}

	staleRuntime = nil
	for index := range recovered.Runtimes {
		if recovered.Runtimes[index].ID == "shock-stale" {
			staleRuntime = &recovered.Runtimes[index]
			break
		}
	}
	if staleRuntime == nil || staleRuntime.State != runtimeStateOnline {
		t.Fatalf("recovered runtime = %#v, want online", staleRuntime)
	}
}

func TestPullRequestStatusUpdatesDecisionCurrentAndRoomSummary(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	result, err := s.CreateIssue(CreateIssueInput{
		Title:    "Merged Summary Sync",
		Summary:  "verify merged state writeback",
		Owner:    "Claude Review Runner",
		Priority: "critical",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(result.RunID, result.SessionID, LaneBinding{
		Branch:       result.Branch,
		WorktreeName: result.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", result.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	if _, _, err := s.CreatePullRequest(result.RoomID); err != nil {
		t.Fatalf("CreatePullRequest() error = %v", err)
	}

	snapshot := s.Snapshot()
	pr := findPullRequestByRoom(snapshot, result.RoomID)
	if pr == nil {
		t.Fatalf("pull request for room %q not found", result.RoomID)
	}

	if _, err := s.UpdatePullRequestStatus(pr.ID, "merged"); err != nil {
		t.Fatalf("UpdatePullRequestStatus() error = %v", err)
	}

	merged := s.Snapshot()
	room := findRoomByID(merged, result.RoomID)
	run := findRunByID(merged, result.RunID)
	session := findSessionByID(merged, result.SessionID)

	if room == nil || run == nil || session == nil {
		t.Fatalf("expected room/run/session to exist after merge")
	}

	wantSummary := "PR 已在 GitHub 合并，Issue 与讨论间进入完成状态。"
	if room.Topic.Summary != wantSummary {
		t.Fatalf("room topic summary = %q, want %q", room.Topic.Summary, wantSummary)
	}
	if run.Summary != wantSummary {
		t.Fatalf("run summary = %q, want %q", run.Summary, wantSummary)
	}
	if session.Summary != wantSummary {
		t.Fatalf("session summary = %q, want %q", session.Summary, wantSummary)
	}

	decisionPath := filepath.Join(root, "decisions", "ops-28.md")
	body, err := os.ReadFile(decisionPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", decisionPath, err)
	}
	content := string(body)
	if !strings.Contains(content, "- Current: merged") {
		t.Fatalf("decision file missing merged current status:\n%s", content)
	}

	memoryPath := filepath.Join(root, "MEMORY.md")
	memoryBody, err := os.ReadFile(memoryPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", memoryPath, err)
	}
	memoryContent := string(memoryBody)
	if !strings.Contains(memoryContent, "Issue Created") || !strings.Contains(memoryContent, "Worktree Ready") || !strings.Contains(memoryContent, "Pull Request Created") || !strings.Contains(memoryContent, "Pull Request Status Updated") {
		t.Fatalf("workspace memory missing lifecycle writeback:\n%s", memoryContent)
	}

	memoryArtifact := findMemoryArtifactByPath(merged, "MEMORY.md")
	if memoryArtifact == nil || !strings.Contains(memoryArtifact.Summary, "Pull Request Status Updated") {
		t.Fatalf("workspace memory artifact = %#v, want latest writeback summary", memoryArtifact)
	}
	decisionArtifact := findMemoryArtifactByPath(merged, filepath.ToSlash(filepath.Join("decisions", "ops-28.md")))
	if decisionArtifact == nil || !strings.Contains(decisionArtifact.Summary, "merged") {
		t.Fatalf("decision artifact = %#v, want merged writeback summary", decisionArtifact)
	}
}

func TestAppendConversationWritesWorkspaceMemoryArtifacts(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	result, err := s.CreateIssue(CreateIssueInput{
		Title:    "Memory Writeback Contract",
		Summary:  "verify conversation writeback",
		Owner:    "Memory Clerk",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(result.RunID, result.SessionID, LaneBinding{
		Branch:       result.Branch,
		WorktreeName: result.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", result.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	if _, err := s.AppendConversation(result.RoomID, "Need a durable writeback", "Conversation synced into file memory.", "codex"); err != nil {
		t.Fatalf("AppendConversation() error = %v", err)
	}

	snapshot := s.Snapshot()
	memoryBody, err := os.ReadFile(filepath.Join(root, "MEMORY.md"))
	if err != nil {
		t.Fatalf("read MEMORY.md: %v", err)
	}
	if content := string(memoryBody); !strings.Contains(content, "Room Conversation") || !strings.Contains(content, "Need a durable writeback") || !strings.Contains(content, "Conversation synced into file memory.") {
		t.Fatalf("workspace memory missing conversation writeback:\n%s", content)
	}

	roomNotePath := filepath.Join(root, "notes", "rooms", "room-memory-writeback-contract.md")
	roomBody, err := os.ReadFile(roomNotePath)
	if err != nil {
		t.Fatalf("read room note: %v", err)
	}
	if content := string(roomBody); !strings.Contains(content, "Room Conversation") {
		t.Fatalf("room note missing conversation writeback:\n%s", content)
	}

	workspaceArtifact := findMemoryArtifactByPath(snapshot, "MEMORY.md")
	if workspaceArtifact == nil || !strings.Contains(workspaceArtifact.Summary, "Room Conversation") {
		t.Fatalf("workspace artifact = %#v, want Room Conversation summary", workspaceArtifact)
	}
	workLogArtifact := findMemoryArtifactByPath(snapshot, filepath.ToSlash(filepath.Join("notes", "work-log.md")))
	if workLogArtifact == nil || !strings.Contains(workLogArtifact.Summary, "Room Conversation") {
		t.Fatalf("work-log artifact = %#v, want Room Conversation summary", workLogArtifact)
	}
	roomArtifact := findMemoryArtifactByPath(snapshot, filepath.ToSlash(filepath.Join("notes", "rooms", "room-memory-writeback-contract.md")))
	if roomArtifact == nil || !strings.Contains(roomArtifact.Summary, "Room Conversation") {
		t.Fatalf("room artifact = %#v, want Room Conversation summary", roomArtifact)
	}
}

func TestMemorySubsystemTracksVersionsAndGovernance(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	baseline := s.Snapshot()
	workspaceArtifact := findMemoryArtifactByPath(baseline, "MEMORY.md")
	if workspaceArtifact == nil {
		t.Fatalf("workspace memory artifact missing")
	}
	if workspaceArtifact.Version < 1 {
		t.Fatalf("workspace artifact version = %d, want >= 1", workspaceArtifact.Version)
	}
	if workspaceArtifact.Governance.Mode != "append-only" || !workspaceArtifact.Governance.RequiresReview || workspaceArtifact.Governance.Escalation != "inbox" {
		t.Fatalf("workspace governance = %#v, want append-only + inbox review", workspaceArtifact.Governance)
	}

	workspaceDetail, ok := s.MemoryDetail(workspaceArtifact.ID)
	if !ok {
		t.Fatalf("MemoryDetail(%q) not found", workspaceArtifact.ID)
	}
	if len(workspaceDetail.Versions) == 0 || !strings.Contains(workspaceDetail.Content, "# OpenShock Workspace Memory") {
		t.Fatalf("workspace detail = %#v, want baseline content and versions", workspaceDetail)
	}

	result, err := s.CreateIssue(CreateIssueInput{
		Title:    "Memory Versioning Ready",
		Summary:  "verify versioned memory contract",
		Owner:    "Memory Clerk",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}
	if _, err := s.AttachLane(result.RunID, result.SessionID, LaneBinding{
		Branch:       result.Branch,
		WorktreeName: result.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", result.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}
	if _, err := s.AppendConversation(result.RoomID, "Need versioned audit", "Conversation synced into governed file memory.", "codex"); err != nil {
		t.Fatalf("AppendConversation() error = %v", err)
	}

	updated := s.Snapshot()
	workspaceArtifact = findMemoryArtifactByPath(updated, "MEMORY.md")
	if workspaceArtifact == nil || workspaceArtifact.Version <= 1 {
		t.Fatalf("workspace artifact = %#v, want version > 1 after writeback", workspaceArtifact)
	}
	workspaceDetail, ok = s.MemoryDetail(workspaceArtifact.ID)
	if !ok {
		t.Fatalf("MemoryDetail(%q) not found after writeback", workspaceArtifact.ID)
	}
	lastVersion := workspaceDetail.Versions[len(workspaceDetail.Versions)-1]
	if lastVersion.Source != "room-conversation" || lastVersion.Actor != "Memory Clerk" {
		t.Fatalf("latest workspace version = %#v, want room-conversation by Memory Clerk", lastVersion)
	}
	if !strings.Contains(lastVersion.Content, "Conversation synced into governed file memory.") {
		t.Fatalf("latest workspace content missing conversation writeback:\n%s", lastVersion.Content)
	}

	decisionArtifact := findMemoryArtifactByPath(updated, filepath.ToSlash(filepath.Join("decisions", "ops-28.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing")
	}
	if decisionArtifact.Governance.Mode != "decision-ledger" || !decisionArtifact.Governance.RequiresReview || decisionArtifact.Governance.Escalation != "inbox" {
		t.Fatalf("decision governance = %#v, want decision-ledger + inbox review", decisionArtifact.Governance)
	}
}

func TestMemorySubsystemHydratesExternalFileEditsOnRestart(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	baseline := s.Snapshot()
	workspaceArtifact := findMemoryArtifactByPath(baseline, "MEMORY.md")
	if workspaceArtifact == nil {
		t.Fatalf("workspace memory artifact missing")
	}
	baselineDetail, ok := s.MemoryDetail(workspaceArtifact.ID)
	if !ok || len(baselineDetail.Versions) == 0 {
		t.Fatalf("baseline memory detail missing versions: %#v", baselineDetail)
	}

	externalContent := "# OpenShock Workspace Memory\n\n- external edit landed before restart\n"
	if err := os.WriteFile(filepath.Join(root, "MEMORY.md"), []byte(externalContent), 0o644); err != nil {
		t.Fatalf("write MEMORY.md: %v", err)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(restart) error = %v", err)
	}

	updated := reloaded.Snapshot()
	workspaceArtifact = findMemoryArtifactByPath(updated, "MEMORY.md")
	if workspaceArtifact == nil {
		t.Fatalf("workspace memory artifact missing after restart")
	}
	if workspaceArtifact.Version != baselineDetail.Versions[len(baselineDetail.Versions)-1].Version+1 {
		t.Fatalf("workspace artifact version = %d, want %d", workspaceArtifact.Version, baselineDetail.Versions[len(baselineDetail.Versions)-1].Version+1)
	}
	if workspaceArtifact.LatestSource != "external-file-edit" || workspaceArtifact.LatestActor != "Filesystem" {
		t.Fatalf("workspace latest source/actor = %q/%q, want external-file-edit/Filesystem", workspaceArtifact.LatestSource, workspaceArtifact.LatestActor)
	}
	if !strings.Contains(workspaceArtifact.Summary, "External File Edit") {
		t.Fatalf("workspace artifact summary = %q, want External File Edit", workspaceArtifact.Summary)
	}

	detail, ok := reloaded.MemoryDetail(workspaceArtifact.ID)
	if !ok {
		t.Fatalf("MemoryDetail(%q) missing after restart", workspaceArtifact.ID)
	}
	if len(detail.Versions) != len(baselineDetail.Versions)+1 {
		t.Fatalf("detail versions len = %d, want %d", len(detail.Versions), len(baselineDetail.Versions)+1)
	}
	if !strings.Contains(detail.Content, "external edit landed before restart") {
		t.Fatalf("detail content missing external edit:\n%s", detail.Content)
	}
	last := detail.Versions[len(detail.Versions)-1]
	if last.Source != "external-file-edit" || last.Actor != "Filesystem" {
		t.Fatalf("latest version = %#v, want external-file-edit by Filesystem", last)
	}
	if !strings.Contains(last.Content, "external edit landed before restart") {
		t.Fatalf("latest version content missing external edit:\n%s", last.Content)
	}
	if workspaceArtifact.Digest != last.Digest || workspaceArtifact.SizeBytes != last.SizeBytes {
		t.Fatalf("artifact digest/size = %q/%d, want latest snapshot %q/%d", workspaceArtifact.Digest, workspaceArtifact.SizeBytes, last.Digest, last.SizeBytes)
	}
}

func TestMemorySubsystemSanitizesCustomerVisibleResidueOnExternalFileReplay(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	baseline := s.Snapshot()
	workspaceArtifact := findMemoryArtifactByPath(baseline, "MEMORY.md")
	if workspaceArtifact == nil {
		t.Fatalf("workspace memory artifact missing")
	}

	dirtyContent := strings.Join([]string{
		"# E2E ???? 20260405 讨论间",
		"",
		"- prompt: ???:???",
		"- output: 我在 `E:\\00.Lark_Projects\\00_OpenShock` 项目中，可以帮您查看项目状态。",
		"- summary: ??????????:Issue?Room?Run?PR?Inbox?Memory?",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(root, "MEMORY.md"), []byte(dirtyContent), 0o644); err != nil {
		t.Fatalf("write MEMORY.md: %v", err)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(restart) error = %v", err)
	}

	detail, ok := reloaded.MemoryDetail(workspaceArtifact.ID)
	if !ok || len(detail.Versions) == 0 {
		t.Fatalf("memory detail missing after restart: %#v", detail)
	}

	last := detail.Versions[len(detail.Versions)-1]
	if strings.Contains(last.Content, "E2E ???? 20260405") {
		t.Fatalf("latest version content leaked e2e residue:\n%s", last.Content)
	}
	if strings.Contains(last.Content, "???:???") {
		t.Fatalf("latest version content leaked garbled prompt:\n%s", last.Content)
	}
	if strings.Contains(last.Content, "E:\\00.Lark_Projects\\00_OpenShock") {
		t.Fatalf("latest version content leaked internal path:\n%s", last.Content)
	}
	if !strings.Contains(last.Content, "这条历史记录包含测试残留或乱码，已从当前工作区隐藏。") {
		t.Fatalf("latest version content = %q, want sanitized fallback", last.Content)
	}
}

func contains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func findSessionByID(state State, sessionID string) *Session {
	for index := range state.Sessions {
		if state.Sessions[index].ID == sessionID {
			return &state.Sessions[index]
		}
	}
	return nil
}

func findRoomByID(state State, roomID string) *Room {
	for index := range state.Rooms {
		if state.Rooms[index].ID == roomID {
			return &state.Rooms[index]
		}
	}
	return nil
}

func findRunByID(state State, runID string) *Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}

func findPullRequestByRoom(state State, roomID string) *PullRequest {
	for index := range state.PullRequests {
		if state.PullRequests[index].RoomID == roomID {
			return &state.PullRequests[index]
		}
	}
	return nil
}

func findMemoryArtifactByPath(state State, path string) *MemoryArtifact {
	for index := range state.Memory {
		if state.Memory[index].Path == path {
			return &state.Memory[index]
		}
	}
	return nil
}
