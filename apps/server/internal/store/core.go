package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func New(path, workspaceRoot string) (*Store, error) {
	s := &Store{path: path, workspaceRoot: workspaceRoot}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	body, err := os.ReadFile(path)
	if err == nil && len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &s.state); err != nil {
			return nil, err
		}
		s.hydrateMissingDefaults()
		if err := s.ensureFilesystemArtifacts(); err != nil {
			return nil, err
		}
		return s, nil
	}

	s.state = seedState()
	s.hydrateMissingDefaults()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureFilesystemArtifactsLocked(); err != nil {
		return nil, err
	}
	return s, s.persistLocked()
}

func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.state)
}

func (s *Store) RuntimeSnapshot(now time.Time) State {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snapshot := cloneState(s.state)
	applyRuntimeDerivedTruth(&snapshot, now)
	return snapshot
}

func (s *Store) RoomDetail(roomID string) (RoomDetail, bool) {
	snapshot := s.Snapshot()
	for _, item := range snapshot.Rooms {
		if item.ID == roomID {
			return RoomDetail{Room: item, Messages: snapshot.RoomMessages[roomID]}, true
		}
	}
	return RoomDetail{}, false
}

func (s *Store) hydrateMissingDefaults() {
	defaults := seedState()
	if strings.TrimSpace(s.state.Workspace.RepoProvider) == "" {
		s.state.Workspace.RepoProvider = defaults.Workspace.RepoProvider
	}
	if strings.TrimSpace(s.state.Workspace.RepoBindingStatus) == "" {
		s.state.Workspace.RepoBindingStatus = defaults.Workspace.RepoBindingStatus
	}
	if strings.TrimSpace(s.state.Workspace.RepoAuthMode) == "" {
		s.state.Workspace.RepoAuthMode = defaults.Workspace.RepoAuthMode
	}
	if strings.TrimSpace(s.state.Workspace.PairedRuntimeURL) == "" {
		s.state.Workspace.PairedRuntimeURL = defaults.Workspace.PairedRuntimeURL
	}
	if strings.TrimSpace(s.state.Workspace.PairingStatus) == "" {
		s.state.Workspace.PairingStatus = defaults.Workspace.PairingStatus
	}
	if strings.TrimSpace(s.state.Workspace.DeviceAuth) == "" {
		s.state.Workspace.DeviceAuth = defaults.Workspace.DeviceAuth
	}
	if strings.TrimSpace(s.state.Workspace.LastPairedAt) == "" {
		s.state.Workspace.LastPairedAt = defaults.Workspace.LastPairedAt
	}
	if len(s.state.Machines) == 0 {
		s.state.Machines = defaults.Machines
	}
	if len(s.state.Agents) == 0 {
		s.state.Agents = defaults.Agents
	}
	for index := range s.state.Agents {
		defaultAgent, ok := findAgentByID(defaults.Agents, s.state.Agents[index].ID)
		if !ok {
			continue
		}
		if strings.TrimSpace(s.state.Agents[index].Role) == "" {
			s.state.Agents[index].Role = defaultAgent.Role
		}
		if strings.TrimSpace(s.state.Agents[index].Avatar) == "" {
			s.state.Agents[index].Avatar = defaultAgent.Avatar
		}
		if strings.TrimSpace(s.state.Agents[index].Prompt) == "" {
			s.state.Agents[index].Prompt = defaultAgent.Prompt
		}
		if strings.TrimSpace(s.state.Agents[index].OperatingInstructions) == "" {
			s.state.Agents[index].OperatingInstructions = defaultAgent.OperatingInstructions
		}
		if strings.TrimSpace(s.state.Agents[index].ProviderPreference) == "" {
			s.state.Agents[index].ProviderPreference = defaultAgent.ProviderPreference
		}
		if strings.TrimSpace(s.state.Agents[index].ModelPreference) == "" {
			s.state.Agents[index].ModelPreference = defaultAgent.ModelPreference
		}
		if strings.TrimSpace(s.state.Agents[index].RuntimePreference) == "" {
			s.state.Agents[index].RuntimePreference = defaultAgent.RuntimePreference
		}
		if strings.TrimSpace(s.state.Agents[index].RecallPolicy) == "" {
			s.state.Agents[index].RecallPolicy = defaultAgent.RecallPolicy
		}
		if len(s.state.Agents[index].MemorySpaces) == 0 {
			s.state.Agents[index].MemorySpaces = append([]string{}, defaultAgent.MemorySpaces...)
		}
		if s.state.Agents[index].ProfileAudit == nil {
			s.state.Agents[index].ProfileAudit = []AgentProfileAuditEntry{}
		}
	}
	for index := range s.state.Machines {
		if strings.TrimSpace(s.state.Machines[index].DaemonURL) == "" && machineMatches(s.state.Machines[index], s.state.Workspace.PairedRuntime) {
			s.state.Machines[index].DaemonURL = s.state.Workspace.PairedRuntimeURL
		}
		if defaultMachine, ok := findMachineByID(defaults.Machines, s.state.Machines[index].ID, s.state.Machines[index].Name); ok && strings.TrimSpace(s.state.Machines[index].Shell) == "" {
			s.state.Machines[index].Shell = defaultMachine.Shell
		}
	}
	if len(s.state.PullRequests) == 0 {
		s.state.PullRequests = defaults.PullRequests
	}
	if len(s.state.Sessions) == 0 {
		s.state.Sessions = defaults.Sessions
	}
	if len(s.state.Memory) == 0 {
		s.state.Memory = defaults.Memory
	}
	if s.state.MemoryVersions == nil {
		s.state.MemoryVersions = defaults.MemoryVersions
	}
	if s.state.ChannelMessages == nil {
		s.state.ChannelMessages = defaults.ChannelMessages
	}
	if s.state.RoomMessages == nil {
		s.state.RoomMessages = defaults.RoomMessages
	}
	s.ensureRuntimeRegistryState()
	s.ensureSessionConsistency()
	s.ensureAuthConsistency()
}

func findAgentByID(items []Agent, agentID string) (Agent, bool) {
	for _, item := range items {
		if item.ID == agentID {
			return item, true
		}
	}
	return Agent{}, false
}

func findMachineByID(items []Machine, machineID, machineName string) (Machine, bool) {
	for _, item := range items {
		if item.ID == machineID || item.Name == machineName {
			return item, true
		}
	}
	return Machine{}, false
}

func (s *Store) ensureFilesystemArtifacts() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureFilesystemArtifactsLocked(); err != nil {
		return err
	}
	return s.persistLocked()
}

func (s *Store) ensureFilesystemArtifactsLocked() error {
	artifacts, err := ensureWorkspaceScaffold(s.workspaceRoot, s.state.Agents, s.state.Memory)
	if err != nil {
		return err
	}

	for _, issueItem := range s.state.Issues {
		roomItem := Room{}
		foundRoom := false
		for _, candidate := range s.state.Rooms {
			if candidate.ID == issueItem.RoomID {
				roomItem = candidate
				foundRoom = true
				break
			}
		}
		if !foundRoom {
			continue
		}

		artifacts, err = ensureIssueArtifacts(s.workspaceRoot, issueItem, roomItem, issueItem.Owner, artifacts)
		if err != nil {
			return err
		}
	}

	s.state.Memory = artifacts
	s.ensureMemorySubsystemLocked()
	return nil
}

func (s *Store) nextIssueNumberLocked() int {
	max := 0
	for _, item := range s.state.Issues {
		number, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(item.Key), "OPS-"))
		if err == nil && number > max {
			max = number
		}
	}
	return max + 1
}

func (s *Store) appendChannelMessageLocked(channelID string, msg Message) {
	if s.state.ChannelMessages == nil {
		s.state.ChannelMessages = map[string][]Message{}
	}
	s.state.ChannelMessages[channelID] = append(s.state.ChannelMessages[channelID], msg)
	for index := range s.state.Channels {
		if s.state.Channels[index].ID == channelID {
			s.state.Channels[index].Unread++
			return
		}
	}
}

func (s *Store) appendRoomMessageLocked(roomID string, msg Message) {
	if s.state.RoomMessages == nil {
		s.state.RoomMessages = map[string][]Message{}
	}
	s.state.RoomMessages[roomID] = append(s.state.RoomMessages[roomID], msg)
	for index := range s.state.Rooms {
		if s.state.Rooms[index].ID == roomID {
			s.state.Rooms[index].MessageIDs = append(s.state.Rooms[index].MessageIDs, msg.ID)
			return
		}
	}
}

func (s *Store) findPullRequestLocked(pullRequestID string) int {
	for index, item := range s.state.PullRequests {
		if item.ID == pullRequestID {
			return index
		}
	}
	return -1
}

func (s *Store) findPullRequestByRoomLocked(roomID string) int {
	for index, item := range s.state.PullRequests {
		if item.RoomID == roomID {
			return index
		}
	}
	return -1
}

func (s *Store) nextPullRequestNumberLocked() int {
	max := 0
	for _, item := range s.state.PullRequests {
		if item.Number > max {
			max = item.Number
		}
	}
	return max + 1
}

func (s *Store) findRoomRunIssueLocked(roomID string) (int, int, int, bool) {
	roomIndex := -1
	runIndex := -1
	issueIndex := -1
	roomRunID := ""
	roomIssueKey := ""

	for index, item := range s.state.Rooms {
		if item.ID == roomID {
			roomIndex = index
			roomRunID = item.RunID
			roomIssueKey = item.IssueKey
			break
		}
	}
	if roomIndex == -1 {
		return 0, 0, 0, false
	}
	for index, item := range s.state.Runs {
		if item.ID == roomRunID {
			runIndex = index
			break
		}
	}
	for index, item := range s.state.Issues {
		if item.Key == roomIssueKey {
			issueIndex = index
			break
		}
	}
	return roomIndex, runIndex, issueIndex, runIndex != -1 && issueIndex != -1
}

func (s *Store) updateAgentStateLocked(owner, state, mood string) {
	for index := range s.state.Agents {
		if s.state.Agents[index].Name == owner {
			s.state.Agents[index].State = state
			s.state.Agents[index].Mood = mood
			return
		}
	}
}

func (s *Store) updateSessionLocked(runID string, mutate func(*Session)) {
	for index := range s.state.Sessions {
		if s.state.Sessions[index].ActiveRunID == runID {
			mutate(&s.state.Sessions[index])
			return
		}
	}
}

func (s *Store) updateSessionByIDLocked(sessionID string, mutate func(*Session)) {
	for index := range s.state.Sessions {
		if s.state.Sessions[index].ID == sessionID {
			mutate(&s.state.Sessions[index])
			return
		}
	}
}

func (s *Store) markMemoryArtifactWriteLocked(path, latest string) {
	s.recordMemoryArtifactWriteLocked(path, latest, "system", "System")
}

func (s *Store) markMemoryArtifactWritesLocked(paths []string, latest string) {
	s.recordMemoryArtifactWritesLocked(paths, latest, "system", "System")
}

func (s *Store) persistLocked() error {
	body, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, body, 0o644); err != nil {
		return err
	}
	s.publishSnapshotLocked()
	return nil
}

func cloneState(state State) State {
	body, err := json.Marshal(state)
	if err != nil {
		return state
	}
	var clone State
	if err := json.Unmarshal(body, &clone); err != nil {
		return state
	}
	applyRuntimeDerivedTruth(&clone, time.Now())
	clone.RuntimeLeases = buildRuntimeLeases(clone)
	clone.RuntimeScheduler = buildRuntimeScheduler(clone, "").Scheduler
	return clone
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func shortClock() string {
	return time.Now().Format("15:04")
}

func slugify(input string) string {
	var builder strings.Builder
	lastDash := false
	for _, char := range strings.ToLower(input) {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
			lastDash = false
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
			lastDash = false
		default:
			if !lastDash && builder.Len() > 0 {
				builder.WriteRune('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(builder.String(), "-")
}

func (s *Store) ensureSessionConsistency() {
	seen := make(map[string]bool, len(s.state.Sessions))
	for index := range s.state.Sessions {
		defaultPaths := defaultSessionMemoryPaths(s.state.Sessions[index].RoomID, s.state.Sessions[index].IssueKey)
		if len(s.state.Sessions[index].MemoryPaths) == 0 {
			s.state.Sessions[index].MemoryPaths = defaultPaths
		} else {
			existing := make(map[string]bool, len(s.state.Sessions[index].MemoryPaths))
			normalized := make([]string, 0, len(s.state.Sessions[index].MemoryPaths)+len(defaultPaths))
			for _, path := range s.state.Sessions[index].MemoryPaths {
				path = filepath.ToSlash(strings.TrimSpace(path))
				if path == "" || existing[path] {
					continue
				}
				existing[path] = true
				normalized = append(normalized, path)
			}
			for _, path := range defaultPaths {
				if existing[path] {
					continue
				}
				existing[path] = true
				normalized = append(normalized, path)
			}
			s.state.Sessions[index].MemoryPaths = normalized
		}
		if strings.TrimSpace(s.state.Sessions[index].UpdatedAt) == "" {
			s.state.Sessions[index].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		if strings.TrimSpace(s.state.Sessions[index].ID) == "" {
			s.state.Sessions[index].ID = fmt.Sprintf("session-%s", slugify(s.state.Sessions[index].ActiveRunID))
		}
		seen[s.state.Sessions[index].ActiveRunID] = true
	}

	for _, run := range s.state.Runs {
		if seen[run.ID] {
			continue
		}
		s.state.Sessions = append(s.state.Sessions, Session{
			ID:           fmt.Sprintf("session-%s", slugify(run.ID)),
			IssueKey:     run.IssueKey,
			RoomID:       run.RoomID,
			TopicID:      run.TopicID,
			ActiveRunID:  run.ID,
			Status:       defaultString(run.Status, "queued"),
			Runtime:      run.Runtime,
			Machine:      run.Machine,
			Provider:     run.Provider,
			Branch:       run.Branch,
			Worktree:     run.Worktree,
			WorktreePath: run.WorktreePath,
			Summary:      defaultString(run.Summary, "补建的 Session 上下文。"),
			UpdatedAt:    time.Now().UTC().Format(time.RFC3339),
			MemoryPaths:  defaultSessionMemoryPaths(run.RoomID, run.IssueKey),
		})
	}
}
