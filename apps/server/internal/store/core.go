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
	s := &Store{
		path:           path,
		workspaceRoot:  workspaceRoot,
		bootstrapMode:  bootstrapModeFromEnv(),
		authChallenges: map[string]AuthChallenge{},
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	body, err := os.ReadFile(path)
	if err == nil && len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &s.state); err != nil {
			return nil, err
		}
		s.hydrateMissingDefaults()
		s.mu.Lock()
		if err := s.ensureFreshOnboardingMaterializationLocked(); err != nil {
			s.mu.Unlock()
			return nil, err
		}
		s.mu.Unlock()
		if err := s.ensureFilesystemArtifacts(); err != nil {
			return nil, err
		}
		return s, nil
	}

	if s.freshBootstrap() {
		s.state = freshState(workspaceRoot)
	} else {
		s.state = seedState()
	}
	s.hydrateMissingDefaults()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureFreshOnboardingMaterializationLocked(); err != nil {
		return nil, err
	}
	if err := s.ensureFilesystemArtifactsLocked(); err != nil {
		return nil, err
	}
	return s, s.persistLocked()
}

func (s *Store) StatePath() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.path
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

func (s *Store) PullRequestDetail(pullRequestID string) (PullRequestDetail, bool) {
	snapshot := s.Snapshot()
	notificationCenter := s.NotificationCenter()
	for _, item := range snapshot.PullRequests {
		if item.ID != pullRequestID {
			continue
		}

		room, run, issue, ok := findRoomRunIssueSnapshot(snapshot, item.RoomID)
		if !ok {
			return PullRequestDetail{}, false
		}

		relatedInbox := make([]InboxItem, 0, len(snapshot.Inbox))
		for _, inboxItem := range snapshot.Inbox {
			if isTrackedPullRequestInboxItem(inboxItem, item) {
				relatedInbox = append(relatedInbox, inboxItem)
			}
		}

		conversation := append([]PullRequestConversationEntry{}, item.Conversation...)
		if conversation == nil {
			conversation = []PullRequestConversationEntry{}
		}

		return PullRequestDetail{
			PullRequest:  item,
			Room:         room,
			Run:          run,
			Issue:        issue,
			Conversation: conversation,
			RelatedInbox: relatedInbox,
			Delivery:     buildPullRequestDeliveryEntry(snapshot, notificationCenter, item, room, run, issue, relatedInbox, conversation),
		}, true
	}
	return PullRequestDetail{}, false
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
	if len(s.state.Machines) == 0 && !s.freshBootstrap() {
		s.state.Machines = defaults.Machines
	}
	if s.state.DirectMessages == nil && !s.freshBootstrap() {
		s.state.DirectMessages = defaults.DirectMessages
	}
	if s.state.DirectMessageMessages == nil && !s.freshBootstrap() {
		s.state.DirectMessageMessages = defaults.DirectMessageMessages
	}
	if s.state.FollowedThreads == nil && !s.freshBootstrap() {
		s.state.FollowedThreads = defaults.FollowedThreads
	}
	if s.state.SavedLaterItems == nil && !s.freshBootstrap() {
		s.state.SavedLaterItems = defaults.SavedLaterItems
	}
	if len(s.state.Agents) == 0 && !s.freshBootstrap() {
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
		if s.state.Agents[index].CredentialProfileIDs == nil {
			s.state.Agents[index].CredentialProfileIDs = []string{}
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
	if len(s.state.PullRequests) == 0 && !s.freshBootstrap() {
		s.state.PullRequests = defaults.PullRequests
	}
	for index := range s.state.PullRequests {
		if s.state.PullRequests[index].Conversation == nil {
			s.state.PullRequests[index].Conversation = []PullRequestConversationEntry{}
		}
	}
	if s.state.Mailbox == nil && !s.freshBootstrap() {
		s.state.Mailbox = defaults.Mailbox
	}
	for index := range s.state.Mailbox {
		if s.state.Mailbox[index].Messages == nil {
			s.state.Mailbox[index].Messages = []MailboxMessage{}
		}
	}
	if s.state.RoomAgentWaits == nil {
		s.state.RoomAgentWaits = []RoomAgentWait{}
	}
	if len(s.state.Sessions) == 0 && !s.freshBootstrap() {
		s.state.Sessions = defaults.Sessions
	}
	for index := range s.state.Runs {
		if s.state.Runs[index].CredentialProfileIDs == nil {
			s.state.Runs[index].CredentialProfileIDs = []string{}
		}
	}
	if len(s.state.Memory) == 0 && !s.freshBootstrap() {
		s.state.Memory = defaults.Memory
	}
	if s.state.MemoryVersions == nil && !s.freshBootstrap() {
		s.state.MemoryVersions = defaults.MemoryVersions
	}
	if s.state.Credentials == nil {
		s.state.Credentials = []CredentialProfile{}
	}
	if s.state.ControlPlane.Commands == nil {
		s.state.ControlPlane.Commands = []ControlPlaneCommand{}
	}
	if s.state.ControlPlane.Events == nil {
		s.state.ControlPlane.Events = []ControlPlaneEvent{}
	}
	if s.state.ControlPlane.Rejections == nil {
		s.state.ControlPlane.Rejections = []ControlPlaneRejection{}
	}
	if s.state.RuntimePublish.Records == nil {
		s.state.RuntimePublish.Records = []RuntimePublishRecord{}
	}
	if s.state.RuntimePublish.NextSequence <= 0 {
		s.state.RuntimePublish.NextSequence = 1
	}
	if s.state.ChannelMessages == nil {
		s.state.ChannelMessages = defaults.ChannelMessages
	}
	if s.state.RoomMessages == nil {
		s.state.RoomMessages = defaults.RoomMessages
	}
	for index := range s.state.Agents {
		syncSandboxPolicyDefaults(&s.state.Agents[index].Sandbox)
	}
	for index := range s.state.Runs {
		syncSandboxPolicyDefaults(&s.state.Runs[index].Sandbox)
		syncSandboxDecisionDefaults(&s.state.Runs[index].SandboxDecision)
	}
	s.ensureRuntimeRegistryState()
	s.ensureSessionConsistency()
	s.ensureAuthConsistency()
	syncWorkspaceSnapshotDefaults(&s.state.Workspace)
	s.refreshUsageObservabilityLocked()
}

func findRoomRunIssueSnapshot(state State, roomID string) (Room, Run, Issue, bool) {
	var room Room
	var run Run
	var issue Issue
	var roomFound bool
	var runFound bool
	var issueFound bool

	for _, candidate := range state.Rooms {
		if candidate.ID == roomID {
			room = candidate
			roomFound = true
			break
		}
	}
	if !roomFound {
		return Room{}, Run{}, Issue{}, false
	}

	for _, candidate := range state.Runs {
		if candidate.RoomID == roomID {
			run = candidate
			runFound = true
			break
		}
	}
	if !runFound {
		return Room{}, Run{}, Issue{}, false
	}

	for _, candidate := range state.Issues {
		if candidate.RoomID == roomID {
			issue = candidate
			issueFound = true
			break
		}
	}
	if !issueFound {
		return Room{}, Run{}, Issue{}, false
	}

	return room, run, issue, true
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
	if err := s.ensureCredentialVaultLocked(); err != nil {
		return err
	}
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
	s.syncAllCredentialGuardsLocked()
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

func (s *Store) removeLastRoomMessageLocked(roomID string) (Message, bool) {
	messages := s.state.RoomMessages[roomID]
	if len(messages) == 0 {
		return Message{}, false
	}
	last := messages[len(messages)-1]
	s.state.RoomMessages[roomID] = messages[:len(messages)-1]
	for index := range s.state.Rooms {
		if s.state.Rooms[index].ID != roomID {
			continue
		}
		if count := len(s.state.Rooms[index].MessageIDs); count > 0 {
			s.state.Rooms[index].MessageIDs = s.state.Rooms[index].MessageIDs[:count-1]
		}
		break
	}
	return last, true
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
	roomID := ""
	for index := range s.state.Runs {
		if s.state.Runs[index].ID == runID {
			roomID = s.state.Runs[index].RoomID
			break
		}
	}
	for index := range s.state.Sessions {
		if s.state.Sessions[index].ActiveRunID == runID {
			mutate(&s.state.Sessions[index])
			return
		}
	}
	if strings.TrimSpace(roomID) == "" {
		return
	}
	for index := range s.state.Sessions {
		if s.state.Sessions[index].RoomID == roomID {
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
	s.refreshUsageObservabilityLocked()
	// Persist the same derived runtime/message/governance truth exposed by Snapshot()
	// so restart artifacts and offline inspection do not drift from live surfaces.
	body, err := json.MarshalIndent(cloneState(s.state), "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, body, 0o644); err != nil {
		return err
	}
	if err := s.persistCredentialVaultLocked(); err != nil {
		return err
	}
	s.publishSnapshotLocked()
	return nil
}

func (s *Store) RewriteState(rewrite func(State) State) (bool, error) {
	if rewrite == nil {
		return false, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	before, err := json.Marshal(s.state)
	if err != nil {
		return false, err
	}

	next := rewrite(cloneStoredState(s.state))
	s.state = cloneStoredState(next)
	s.hydrateMissingDefaults()

	after, err := json.Marshal(s.state)
	if err != nil {
		return false, err
	}
	if bytes.Equal(before, after) {
		return false, nil
	}

	if err := s.persistLocked(); err != nil {
		return false, err
	}
	return true, nil
}

func cloneStoredState(state State) State {
	body, err := json.Marshal(state)
	if err != nil {
		return state
	}
	var clone State
	if err := json.Unmarshal(body, &clone); err != nil {
		return state
	}
	return clone
}

func cloneState(state State) State {
	clone := cloneStoredState(state)
	applyRuntimeDerivedTruth(&clone, time.Now())
	clone.RuntimeLeases = buildRuntimeLeases(clone)
	clone.RuntimeScheduler = buildRuntimeScheduler(clone, "").Scheduler
	clone.QuickSearchEntries = buildMessageSurfaceQuickSearchEntries(clone)
	hydrateAgentFileStacks(&clone)
	hydrateWorkspaceGovernance(&clone.Workspace, &clone)
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
