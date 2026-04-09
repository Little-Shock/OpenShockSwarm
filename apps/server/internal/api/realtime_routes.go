package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerRealtimeRoutes)
}

func registerRealtimeRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/state/stream", s.handleStateStream)
}

type StateStreamPresence struct {
	OnlineMachines int `json:"onlineMachines"`
	BusyMachines   int `json:"busyMachines"`
	RunningAgents  int `json:"runningAgents"`
	BlockedAgents  int `json:"blockedAgents"`
	ActiveRuns     int `json:"activeRuns"`
	Unread         int `json:"unread"`
}

type StateStreamEvent struct {
	Type     string              `json:"type"`
	Sequence int                 `json:"sequence"`
	SentAt   string              `json:"sentAt"`
	Presence StateStreamPresence `json:"presence"`
	State    store.State         `json:"state"`
}

type StateStreamDeltaEvent struct {
	Type     string              `json:"type"`
	Sequence int                 `json:"sequence"`
	SentAt   string              `json:"sentAt"`
	Presence StateStreamPresence `json:"presence"`
	Kinds    []string            `json:"kinds"`
	Events   []string            `json:"events"`
	Delta    map[string]any      `json:"delta"`
}

func (s *Server) handleStateStream(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	subID, updates := s.store.SubscribeState()
	defer s.store.UnsubscribeState(subID)

	current := s.store.Snapshot()
	sequence := 1
	if err := writeSSEEvent(w, flusher, "snapshot", buildStateStreamEvent(current, sequence)); err != nil {
		return
	}
	previous := current

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case snapshot, ok := <-updates:
			if !ok {
				return
			}
			sequence++
			delta := buildStateStreamDeltaEvent(previous, snapshot, sequence)
			previous = snapshot
			if len(delta.Delta) == 0 {
				if err := writeSSEEvent(w, flusher, "snapshot", buildStateStreamEvent(snapshot, sequence)); err != nil {
					return
				}
				continue
			}
			if err := writeSSEEvent(w, flusher, "delta", delta); err != nil {
				return
			}
		case <-keepalive.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func buildStateStreamEvent(snapshot store.State, sequence int) StateStreamEvent {
	snapshot = sanitizeLiveState(snapshot)
	return StateStreamEvent{
		Type:     "snapshot",
		Sequence: sequence,
		SentAt:   time.Now().UTC().Format(time.RFC3339),
		Presence: buildStateStreamPresence(snapshot),
		State:    snapshot,
	}
}

func buildStateStreamDeltaEvent(previous, next store.State, sequence int) StateStreamDeltaEvent {
	previous = sanitizeLiveState(previous)
	next = sanitizeLiveState(next)

	delta := map[string]any{}
	kinds := map[string]struct{}{}
	events := map[string]struct{}{}

	addKind := func(kind string) {
		kind = strings.TrimSpace(kind)
		if kind != "" {
			kinds[kind] = struct{}{}
		}
	}
	addEvent := func(event string) {
		event = strings.TrimSpace(event)
		if event != "" {
			events[event] = struct{}{}
		}
	}

	if !reflect.DeepEqual(previous.Workspace, next.Workspace) {
		delta["workspace"] = next.Workspace
		if workspacePreferencesChanged(previous.Workspace, next.Workspace) {
			addKind("preferences")
			addEvent("preferences:updated")
		}
		if workspaceOnboardingChanged(previous.Workspace, next.Workspace) {
			addKind("onboarding")
			if !workspaceOnboardingComplete(previous.Workspace) && workspaceOnboardingComplete(next.Workspace) {
				addEvent("workspace:onboarding_completed")
			} else {
				addEvent("workspace:onboarding_progressed")
			}
		}
		if workspaceDeviceAuthorized(previous.Workspace, next.Workspace) {
			addEvent("auth:device_authorized")
		}
	}

	if !reflect.DeepEqual(previous.Auth, next.Auth) {
		delta["auth"] = next.Auth
		addKind("member")
		for _, event := range inferMemberStreamEvents(previous.Auth, next.Auth) {
			addEvent(event)
		}
	}

	if !reflect.DeepEqual(previous.Channels, next.Channels) {
		delta["channels"] = next.Channels
		addKind("message")
		addEvent("message:updated")
	}

	if !reflect.DeepEqual(previous.ChannelMessages, next.ChannelMessages) {
		delta["channelMessages"] = next.ChannelMessages
		addKind("message")
		addEvent("message:new")
	}

	if !reflect.DeepEqual(previous.DirectMessages, next.DirectMessages) {
		delta["directMessages"] = next.DirectMessages
		addKind("message")
		addEvent("message:updated")
	}

	if !reflect.DeepEqual(previous.DirectMessageMessages, next.DirectMessageMessages) {
		delta["directMessageMessages"] = next.DirectMessageMessages
		addKind("message")
		addEvent("message:new")
	}

	if !reflect.DeepEqual(previous.FollowedThreads, next.FollowedThreads) {
		delta["followedThreads"] = next.FollowedThreads
		addKind("message")
		addEvent("thread:updated")
	}

	if !reflect.DeepEqual(previous.SavedLaterItems, next.SavedLaterItems) {
		delta["savedLaterItems"] = next.SavedLaterItems
		addKind("message")
		addEvent("thread:updated")
	}

	if !reflect.DeepEqual(previous.QuickSearchEntries, next.QuickSearchEntries) {
		delta["quickSearchEntries"] = next.QuickSearchEntries
		addKind("search")
	}

	if !reflect.DeepEqual(previous.Issues, next.Issues) {
		delta["issues"] = next.Issues
		addKind("issue")
	}

	if !reflect.DeepEqual(previous.Rooms, next.Rooms) {
		delta["rooms"] = next.Rooms
		addKind("room")
		addEvent("thread:updated")
	}

	if !reflect.DeepEqual(previous.RoomMessages, next.RoomMessages) {
		delta["roomMessages"] = next.RoomMessages
		addKind("message")
		addEvent("message:new")
		addEvent("thread:updated")
	}

	if !reflect.DeepEqual(previous.Runs, next.Runs) {
		delta["runs"] = next.Runs
		addKind("run")
		for _, event := range inferRunStreamEvents(previous.Runs, next.Runs) {
			addEvent(event)
		}
	}

	if !reflect.DeepEqual(previous.Agents, next.Agents) {
		delta["agents"] = next.Agents
		addKind("agent")
		addEvent("agent:profile_updated")
	}

	if !reflect.DeepEqual(previous.Machines, next.Machines) {
		delta["machines"] = next.Machines
		addKind("runtime")
		for _, event := range inferMachineStreamEvents(previous.Machines, next.Machines) {
			addEvent(event)
		}
	}

	if !reflect.DeepEqual(previous.Runtimes, next.Runtimes) {
		delta["runtimes"] = next.Runtimes
		addKind("runtime")
		for _, event := range inferRuntimeStreamEvents(previous.Runtimes, next.Runtimes) {
			addEvent(event)
		}
	}

	if !reflect.DeepEqual(previous.Inbox, next.Inbox) {
		delta["inbox"] = next.Inbox
		addKind("notification")
		if len(next.Inbox) > len(previous.Inbox) {
			addEvent("inbox:new")
		} else {
			addEvent("notification:updated")
		}
	}

	if !reflect.DeepEqual(previous.PullRequests, next.PullRequests) {
		delta["pullRequests"] = next.PullRequests
		addKind("pr")
		for _, event := range inferPullRequestStreamEvents(previous.PullRequests, next.PullRequests) {
			addEvent(event)
		}
	}

	if !reflect.DeepEqual(previous.Sessions, next.Sessions) {
		delta["sessions"] = next.Sessions
		addKind("session")
	}

	if !reflect.DeepEqual(previous.RuntimeLeases, next.RuntimeLeases) {
		delta["runtimeLeases"] = next.RuntimeLeases
		addKind("runtime")
	}

	if !reflect.DeepEqual(previous.RuntimeScheduler, next.RuntimeScheduler) {
		delta["runtimeScheduler"] = next.RuntimeScheduler
		addKind("runtime")
	}

	if !reflect.DeepEqual(previous.Guards, next.Guards) {
		delta["guards"] = next.Guards
		addKind("guard")
	}

	if !reflect.DeepEqual(previous.Memory, next.Memory) {
		delta["memory"] = next.Memory
		addKind("memory")
		if len(next.Memory) > len(previous.Memory) {
			addEvent("memory:captured")
		} else {
			addEvent("memory:updated")
		}
	}

	return StateStreamDeltaEvent{
		Type:     "delta",
		Sequence: sequence,
		SentAt:   time.Now().UTC().Format(time.RFC3339),
		Presence: buildStateStreamPresence(next),
		Kinds:    sortedKeys(kinds),
		Events:   sortedKeys(events),
		Delta:    delta,
	}
}

func buildStateStreamPresence(snapshot store.State) StateStreamPresence {
	presence := StateStreamPresence{}
	for _, machine := range snapshot.Machines {
		switch strings.ToLower(strings.TrimSpace(machine.State)) {
		case "busy":
			presence.BusyMachines++
		case "online":
			presence.OnlineMachines++
		}
	}
	for _, agent := range snapshot.Agents {
		switch strings.ToLower(strings.TrimSpace(agent.State)) {
		case "running":
			presence.RunningAgents++
		case "blocked":
			presence.BlockedAgents++
		}
	}
	for _, run := range snapshot.Runs {
		switch strings.ToLower(strings.TrimSpace(run.Status)) {
		case "running", "queued", "waiting":
			presence.ActiveRuns++
		}
	}
	for _, channel := range snapshot.Channels {
		presence.Unread += channel.Unread
	}
	for _, room := range snapshot.Rooms {
		presence.Unread += room.Unread
	}
	return presence
}

func workspacePreferencesChanged(previous, next store.WorkspaceSnapshot) bool {
	return previous.BrowserPush != next.BrowserPush || previous.MemoryMode != next.MemoryMode
}

func workspaceOnboardingChanged(previous, next store.WorkspaceSnapshot) bool {
	return previous.RepoBindingStatus != next.RepoBindingStatus ||
		previous.PairingStatus != next.PairingStatus ||
		previous.DeviceAuth != next.DeviceAuth ||
		previous.PairedRuntime != next.PairedRuntime ||
		previous.PairedRuntimeURL != next.PairedRuntimeURL ||
		!reflect.DeepEqual(previous.RepoBinding, next.RepoBinding) ||
		!reflect.DeepEqual(previous.GitHubInstallation, next.GitHubInstallation) ||
		!reflect.DeepEqual(previous.Onboarding, next.Onboarding)
}

func workspaceOnboardingComplete(snapshot store.WorkspaceSnapshot) bool {
	onboardingStatus := strings.ToLower(strings.TrimSpace(snapshot.Onboarding.Status))
	if onboardingStatus == "completed" || onboardingStatus == "ready" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(snapshot.RepoBindingStatus), "bound") &&
		strings.EqualFold(strings.TrimSpace(snapshot.PairingStatus), "paired") &&
		(strings.Contains(strings.ToLower(snapshot.DeviceAuth), "approved") || strings.Contains(strings.ToLower(snapshot.DeviceAuth), "authorized"))
}

func workspaceDeviceAuthorized(previous, next store.WorkspaceSnapshot) bool {
	if previous.DeviceAuth == next.DeviceAuth {
		return false
	}
	nextStatus := strings.ToLower(strings.TrimSpace(next.DeviceAuth))
	return strings.Contains(nextStatus, "approved") || strings.Contains(nextStatus, "authorized")
}

func inferMemberStreamEvents(previous, next store.AuthSnapshot) []string {
	events := map[string]struct{}{}
	previousMembers := make(map[string]store.WorkspaceMember, len(previous.Members))
	for _, member := range previous.Members {
		previousMembers[member.ID] = member
	}

	for _, member := range next.Members {
		previousMember, ok := previousMembers[member.ID]
		switch {
		case !ok && strings.EqualFold(member.Status, "invited"):
			events["member:invited"] = struct{}{}
		case !ok && strings.EqualFold(member.Status, "active"):
			events["member:joined"] = struct{}{}
		case !ok:
			events["member:updated"] = struct{}{}
		case previousMember.Status != member.Status && strings.EqualFold(member.Status, "invited"):
			events["member:invited"] = struct{}{}
		case previousMember.Status != member.Status && strings.EqualFold(previousMember.Status, "invited") && strings.EqualFold(member.Status, "active"):
			events["member:joined"] = struct{}{}
		case !reflect.DeepEqual(previousMember, member):
			events["member:updated"] = struct{}{}
		}
	}

	if !reflect.DeepEqual(previous.Session, next.Session) && len(events) == 0 {
		events["member:updated"] = struct{}{}
	}

	return sortedKeys(events)
}

func inferRunStreamEvents(previous, next []store.Run) []string {
	events := map[string]struct{}{}
	previousRuns := make(map[string]store.Run, len(previous))
	for _, run := range previous {
		previousRuns[run.ID] = run
	}

	for _, run := range next {
		previousRun, ok := previousRuns[run.ID]
		if !ok {
			addRunStatusEvent(events, run.Status)
			if run.ApprovalRequired {
				events["run:approval_required"] = struct{}{}
			}
			continue
		}
		if previousRun.Status != run.Status {
			addRunStatusEvent(events, run.Status)
		}
		if !previousRun.ApprovalRequired && run.ApprovalRequired {
			events["run:approval_required"] = struct{}{}
		}
		if reflect.DeepEqual(previousRun, run) {
			continue
		}
		if previousRun.Status == run.Status && previousRun.ApprovalRequired == run.ApprovalRequired {
			events["run:updated"] = struct{}{}
		}
	}

	return sortedKeys(events)
}

func addRunStatusEvent(events map[string]struct{}, status string) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "queued":
		events["run:queued"] = struct{}{}
	case "running":
		events["run:started"] = struct{}{}
	case "done":
		events["run:completed"] = struct{}{}
	case "blocked", "paused":
		events["run:blocked"] = struct{}{}
	default:
		events["run:updated"] = struct{}{}
	}
}

func inferMachineStreamEvents(previous, next []store.Machine) []string {
	events := map[string]struct{}{}
	previousMachines := make(map[string]store.Machine, len(previous))
	for _, machine := range previous {
		previousMachines[machine.ID] = machine
	}

	for _, machine := range next {
		previousMachine, ok := previousMachines[machine.ID]
		switch {
		case !ok:
			events["runtime:heartbeat"] = struct{}{}
		case previousMachine.State != machine.State && strings.EqualFold(machine.State, "offline"):
			events["runtime:offline"] = struct{}{}
		case !reflect.DeepEqual(previousMachine, machine):
			events["runtime:heartbeat"] = struct{}{}
		}
	}

	return sortedKeys(events)
}

func inferRuntimeStreamEvents(previous, next []store.RuntimeRecord) []string {
	events := map[string]struct{}{}
	previousRuntimes := make(map[string]store.RuntimeRecord, len(previous))
	for _, runtime := range previous {
		previousRuntimes[runtime.ID] = runtime
	}

	for _, runtime := range next {
		previousRuntime, ok := previousRuntimes[runtime.ID]
		switch {
		case !ok:
			events["runtime:heartbeat"] = struct{}{}
			events["runtime:capabilities_discovered"] = struct{}{}
		case previousRuntime.State != runtime.State && strings.EqualFold(runtime.State, "offline"):
			events["runtime:offline"] = struct{}{}
		default:
			if previousRuntime.LastHeartbeatAt != runtime.LastHeartbeatAt || previousRuntime.ReportedAt != runtime.ReportedAt || previousRuntime.State != runtime.State {
				events["runtime:heartbeat"] = struct{}{}
			}
			if !reflect.DeepEqual(previousRuntime.Providers, runtime.Providers) || !reflect.DeepEqual(previousRuntime.DetectedCLI, runtime.DetectedCLI) {
				events["runtime:capabilities_discovered"] = struct{}{}
			}
		}
	}

	return sortedKeys(events)
}

func inferPullRequestStreamEvents(previous, next []store.PullRequest) []string {
	events := map[string]struct{}{}
	previousPullRequests := make(map[string]store.PullRequest, len(previous))
	for _, item := range previous {
		previousPullRequests[item.ID] = item
	}

	for _, item := range next {
		previousItem, ok := previousPullRequests[item.ID]
		switch {
		case !ok:
			events["pr:created"] = struct{}{}
		case previousItem.Status != item.Status:
			events["pr:status_changed"] = struct{}{}
		case !reflect.DeepEqual(previousItem, item):
			events["pr:updated"] = struct{}{}
		}
	}

	return sortedKeys(events)
}

func sortedKeys(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\n", event); err != nil {
		return err
	}
	for _, line := range strings.Split(string(body), "\n") {
		if _, err := fmt.Fprintf(w, "data: %s\n", line); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprint(w, "\n"); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}
