package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type decodedStateStreamDeltaEvent struct {
	Type     string                     `json:"type"`
	Sequence int                        `json:"sequence"`
	SentAt   string                     `json:"sentAt"`
	Presence StateStreamPresence        `json:"presence"`
	Kinds    []string                   `json:"kinds"`
	Events   []string                   `json:"events"`
	Delta    map[string]json.RawMessage `json:"delta"`
}

type stateStreamFrame struct {
	Event string
	Data  string
}

func TestStateStreamEmitsInitialSnapshotAndDeltaUpdates(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/state/stream", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET state stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("state stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("state stream content-type = %q, want text/event-stream", contentType)
	}

	reader := bufio.NewReader(resp.Body)
	first := decodeSnapshotFrame(t, readStateStreamFrame(t, reader))
	if first.Type != "snapshot" || first.Sequence != 1 {
		t.Fatalf("first event = %#v, want snapshot seq=1", first)
	}
	if first.Presence.Unread == 0 {
		t.Fatalf("first presence = %#v, want seeded unread truth", first.Presence)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-realtime",
		DaemonURL:          "http://127.0.0.1:8092",
		Machine:            "shock-realtime",
		DetectedCLI:        []string{"codex"},
		State:              "busy",
		WorkspaceRoot:      root,
		ReportedAt:         reportedAt,
		HeartbeatIntervalS: 12,
		HeartbeatTimeoutS:  48,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat() error = %v", err)
	}

	second := decodeDeltaFrame(t, readStateStreamFrame(t, reader))
	if second.Type != "delta" || second.Sequence != 2 {
		t.Fatalf("second event = %#v, want delta seq=2", second)
	}
	if second.Presence.BusyMachines == 0 {
		t.Fatalf("second presence = %#v, want busy machine truth", second.Presence)
	}
	if !containsString(second.Kinds, "runtime") {
		t.Fatalf("second kinds = %#v, want runtime", second.Kinds)
	}
	if !containsString(second.Events, "runtime:heartbeat") {
		t.Fatalf("second events = %#v, want runtime:heartbeat", second.Events)
	}

	var runtimes []store.RuntimeRecord
	decodeDeltaField(t, second.Delta, "runtimes", &runtimes)
	if !runtimeRecordsContain(runtimes, "shock-realtime") {
		t.Fatalf("second delta runtimes = %#v, want shock-realtime", runtimes)
	}
}

func TestStateStreamDeltaBundlesCrossObjectProjectionUpdates(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/state/stream", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET state stream error = %v", err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)
	_ = decodeSnapshotFrame(t, readStateStreamFrame(t, reader))

	if _, err := s.UpdatePullRequestStatus("pr-inbox-22", "changes_requested"); err != nil {
		t.Fatalf("UpdatePullRequestStatus() error = %v", err)
	}

	delta := decodeDeltaFrame(t, readStateStreamFrame(t, reader))
	for _, kind := range []string{"pr", "run", "notification", "room", "issue", "session"} {
		if !containsString(delta.Kinds, kind) {
			t.Fatalf("delta kinds = %#v, want %q", delta.Kinds, kind)
		}
	}
	for _, event := range []string{"pr:status_changed", "run:blocked"} {
		if !containsString(delta.Events, event) {
			t.Fatalf("delta events = %#v, want %q", delta.Events, event)
		}
	}

	var pullRequests []store.PullRequest
	decodeDeltaField(t, delta.Delta, "pullRequests", &pullRequests)
	pr, ok := pullRequestByID(pullRequests, "pr-inbox-22")
	if !ok || pr.Status != "changes_requested" {
		t.Fatalf("pull request = %#v, want pr-inbox-22 changes_requested", pullRequests)
	}

	var runs []store.Run
	decodeDeltaField(t, delta.Delta, "runs", &runs)
	run, ok := runByID(runs, "run_inbox_01")
	if !ok || run.Status != "blocked" {
		t.Fatalf("runs = %#v, want run_inbox_01 blocked", runs)
	}

	var issues []store.Issue
	decodeDeltaField(t, delta.Delta, "issues", &issues)
	issue, ok := issueByID(issues, "issue-inbox")
	if !ok || issue.State != "blocked" {
		t.Fatalf("issues = %#v, want issue-inbox blocked", issues)
	}

	var rooms []store.Room
	decodeDeltaField(t, delta.Delta, "rooms", &rooms)
	room, ok := roomByID(rooms, "room-inbox")
	if !ok || room.Topic.Status != "blocked" {
		t.Fatalf("rooms = %#v, want room-inbox topic blocked", rooms)
	}

	var sessions []store.Session
	decodeDeltaField(t, delta.Delta, "sessions", &sessions)
	session, ok := sessionByID(sessions, "session-inbox")
	if !ok || session.Status != "blocked" {
		t.Fatalf("sessions = %#v, want session-inbox blocked", sessions)
	}

	var inbox []store.InboxItem
	decodeDeltaField(t, delta.Delta, "inbox", &inbox)
	if len(inbox) == 0 || !strings.Contains(inbox[0].Title, "需要补充修改") {
		t.Fatalf("inbox = %#v, want fresh changes-requested recovery signal", inbox)
	}
}

func TestStateStreamDeltaEmitsMemberPreferenceAndOnboardingSignals(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/state/stream", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET state stream error = %v", err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)
	_ = decodeSnapshotFrame(t, readStateStreamFrame(t, reader))

	if _, _, err := s.InviteWorkspaceMember(store.WorkspaceMemberUpsertInput{
		Email: "reviewer@openshock.dev",
		Name:  "Reviewer",
		Role:  "viewer",
	}); err != nil {
		t.Fatalf("InviteWorkspaceMember() error = %v", err)
	}

	memberDelta := decodeDeltaFrame(t, readStateStreamFrame(t, reader))
	if !containsString(memberDelta.Kinds, "member") || !containsString(memberDelta.Events, "member:invited") {
		t.Fatalf("member delta = %#v, want member invitation signal", memberDelta)
	}

	var auth store.AuthSnapshot
	decodeDeltaField(t, memberDelta.Delta, "auth", &auth)
	if _, ok := workspaceMemberByEmail(auth.Members, "reviewer@openshock.dev"); !ok {
		t.Fatalf("auth members = %#v, want reviewer@openshock.dev", auth.Members)
	}

	if _, _, _, err := s.UpdateNotificationPolicy(store.NotificationPolicyInput{BrowserPush: "all"}); err != nil {
		t.Fatalf("UpdateNotificationPolicy() error = %v", err)
	}

	preferenceDelta := decodeDeltaFrame(t, readStateStreamFrame(t, reader))
	if !containsString(preferenceDelta.Kinds, "preferences") || !containsString(preferenceDelta.Events, "preferences:updated") {
		t.Fatalf("preference delta = %#v, want preferences:updated", preferenceDelta)
	}

	var workspace store.WorkspaceSnapshot
	decodeDeltaField(t, preferenceDelta.Delta, "workspace", &workspace)
	if workspace.BrowserPush != "推全部 live 通知" {
		t.Fatalf("workspace browser push = %q, want 推全部 live 通知", workspace.BrowserPush)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:     "shock-browser",
		DaemonURL:     "http://127.0.0.1:8099",
		Machine:       "shock-browser",
		DetectedCLI:   []string{"codex", "claude"},
		State:         "online",
		WorkspaceRoot: root,
		ReportedAt:    reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	onboardingDelta := decodeDeltaFrame(t, readStateStreamFrame(t, reader))
	for _, kind := range []string{"onboarding", "runtime", "notification"} {
		if !containsString(onboardingDelta.Kinds, kind) {
			t.Fatalf("onboarding kinds = %#v, want %q", onboardingDelta.Kinds, kind)
		}
	}
	for _, event := range []string{"workspace:onboarding_progressed", "runtime:heartbeat"} {
		if !containsString(onboardingDelta.Events, event) {
			t.Fatalf("onboarding events = %#v, want %q", onboardingDelta.Events, event)
		}
	}

	decodeDeltaField(t, onboardingDelta.Delta, "workspace", &workspace)
	if workspace.PairedRuntime != "shock-browser" || workspace.PairedRuntimeURL != "http://127.0.0.1:8099" {
		t.Fatalf("workspace pairing = %#v, want shock-browser @ 127.0.0.1:8099", workspace)
	}

	var inbox []store.InboxItem
	decodeDeltaField(t, onboardingDelta.Delta, "inbox", &inbox)
	if len(inbox) == 0 || inbox[0].Href != "/setup" {
		t.Fatalf("inbox = %#v, want setup recovery signal", inbox)
	}
}

func readStateStreamFrame(t *testing.T, reader *bufio.Reader) stateStreamFrame {
	t.Helper()

	frame := stateStreamFrame{}
	var data strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("ReadString() error = %v", err)
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		switch {
		case strings.HasPrefix(line, ":"):
			continue
		case strings.HasPrefix(line, "event: "):
			frame.Event = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
		case strings.HasPrefix(line, "data: "):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(line, "data: "))
		}
	}

	frame.Data = data.String()
	return frame
}

func decodeSnapshotFrame(t *testing.T, frame stateStreamFrame) StateStreamEvent {
	t.Helper()

	if frame.Event != "snapshot" {
		t.Fatalf("event name = %q, want snapshot", frame.Event)
	}

	var payload StateStreamEvent
	if err := json.Unmarshal([]byte(frame.Data), &payload); err != nil {
		t.Fatalf("json.Unmarshal(snapshot) error = %v", err)
	}
	return payload
}

func decodeDeltaFrame(t *testing.T, frame stateStreamFrame) decodedStateStreamDeltaEvent {
	t.Helper()

	if frame.Event != "delta" {
		t.Fatalf("event name = %q, want delta", frame.Event)
	}

	var payload decodedStateStreamDeltaEvent
	if err := json.Unmarshal([]byte(frame.Data), &payload); err != nil {
		t.Fatalf("json.Unmarshal(delta) error = %v", err)
	}
	return payload
}

func decodeDeltaField(t *testing.T, delta map[string]json.RawMessage, key string, target any) {
	t.Helper()

	body, ok := delta[key]
	if !ok {
		t.Fatalf("delta missing key %q in %#v", key, delta)
	}
	if err := json.Unmarshal(body, target); err != nil {
		t.Fatalf("json.Unmarshal(%s) error = %v", key, err)
	}
}

func runtimeRecordsContain(runtimes []store.RuntimeRecord, runtimeID string) bool {
	for _, item := range runtimes {
		if item.ID == runtimeID || item.Machine == runtimeID {
			return true
		}
	}
	return false
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func pullRequestByID(items []store.PullRequest, id string) (store.PullRequest, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.PullRequest{}, false
}

func runByID(items []store.Run, id string) (store.Run, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.Run{}, false
}

func issueByID(items []store.Issue, id string) (store.Issue, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.Issue{}, false
}

func roomByID(items []store.Room, id string) (store.Room, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.Room{}, false
}

func sessionByID(items []store.Session, id string) (store.Session, bool) {
	for _, item := range items {
		if item.ID == id {
			return item, true
		}
	}
	return store.Session{}, false
}

func workspaceMemberByEmail(items []store.WorkspaceMember, email string) (store.WorkspaceMember, bool) {
	for _, item := range items {
		if strings.EqualFold(item.Email, email) {
			return item, true
		}
	}
	return store.WorkspaceMember{}, false
}
