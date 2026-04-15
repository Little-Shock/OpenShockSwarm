package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRoomMessageStreamPersistsConversation(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec/stream" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		events := []DaemonStreamEvent{
			{Type: "start", Provider: "claude", Command: []string{"claude", "--bare"}},
			{Type: "stdout", Provider: "claude", Delta: "第一行输出\n"},
			{Type: "stdout", Provider: "claude", Delta: "第二行输出"},
			{Type: "done", Provider: "claude", Output: "第一行输出\n第二行输出", Duration: "1.2s"},
		}
		for _, event := range events {
			if err := json.NewEncoder(w).Encode(event); err != nil {
				t.Fatalf("encode event: %v", err)
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}))
	defer daemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemon.URL,
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Streaming Ready",
		Summary:  "verify room streaming flow",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(created.RunID, created.SessionID, store.LaneBinding{
		Branch:       created.Branch,
		WorktreeName: created.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", created.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "给我一个两行结论",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var events []DaemonStreamEvent
	for scanner.Scan() {
		var event DaemonStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}

	if len(events) < 4 {
		t.Fatalf("expected stream events, got %#v", events)
	}
	last := events[len(events)-1]
	if last.Type != "state" || last.State == nil {
		t.Fatalf("last event = %#v, want state with payload", last)
	}

	detail, ok := s.RoomDetail(created.RoomID)
	if !ok {
		t.Fatalf("RoomDetail(%q) not found", created.RoomID)
	}
	if len(detail.Messages) < 3 {
		t.Fatalf("expected persisted conversation messages, got %#v", detail.Messages)
	}
	agentMessage := detail.Messages[len(detail.Messages)-1].Message
	if !strings.Contains(agentMessage, "第一行输出") || !strings.Contains(agentMessage, "第二行输出") {
		t.Fatalf("agent message = %q, want streamed output", agentMessage)
	}
}

func TestRoomMessageStreamStripsLiveProtocolAndToolLeak(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec/stream" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode stream payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		events := []DaemonStreamEvent{
			{Type: "start", Provider: "codex", Command: []string{"codex", "exec"}},
			{Type: "stdout", Provider: "codex", Delta: "SEND_PUBLIC_MESS"},
			{Type: "stdout", Provider: "codex", Delta: "AGE\nKIND: message\nCLAIM: take\nBODY:\n"},
			{Type: "stdout", Provider: "codex", Delta: "工具调用：\ngit status\n结果：\n"},
			{Type: "stdout", Provider: "codex", Delta: "当前工作区干净，我继续推进。"},
			{Type: "done", Provider: "codex", Output: "SEND_PUBLIC_MESSAGE\nKIND: message\nCLAIM: take\nBODY:\n工具调用：\ngit status\n结果：\n当前工作区干净，我继续推进。", Duration: "0.8s"},
		}
		for _, event := range events {
			if err := json.NewEncoder(w).Encode(event); err != nil {
				t.Fatalf("encode event: %v", err)
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Streaming Hygiene", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进当前 lane",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var events []DaemonStreamEvent
	for scanner.Scan() {
		var event DaemonStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}

	if len(events) == 0 {
		t.Fatalf("expected sanitized stream events, got none")
	}

	for _, event := range events {
		if event.Type == "start" && len(event.Command) != 0 {
			t.Fatalf("start event leaked command = %#v", event)
		}
		if strings.Contains(event.Delta, "SEND_PUBLIC_MESSAGE") ||
			strings.Contains(event.Delta, "KIND:") ||
			strings.Contains(event.Delta, "BODY:") ||
			strings.Contains(event.Delta, "工具调用") ||
			strings.Contains(event.Delta, "git status") ||
			strings.Contains(event.Delta, "结果：") {
			t.Fatalf("stream delta leaked protocol/tool detail: %#v", event)
		}
		if strings.Contains(event.Output, "SEND_PUBLIC_MESSAGE") ||
			strings.Contains(event.Output, "KIND:") ||
			strings.Contains(event.Output, "BODY:") ||
			strings.Contains(event.Output, "工具调用") ||
			strings.Contains(event.Output, "git status") ||
			strings.Contains(event.Output, "结果：") {
			t.Fatalf("stream output leaked protocol/tool detail: %#v", event)
		}
	}

	last := events[len(events)-1]
	if last.Type != "state" || last.State == nil {
		t.Fatalf("last event = %#v, want state payload", last)
	}
	if !strings.Contains(last.Output, "当前工作区干净，我继续推进。") {
		t.Fatalf("final visible output = %q, want sanitized public reply", last.Output)
	}

	roomMessages := last.State.RoomMessages[created.RoomID]
	if len(roomMessages) == 0 {
		t.Fatalf("room messages empty for %q", created.RoomID)
	}
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Message != "当前工作区干净，我继续推进。" {
		t.Fatalf("last room message = %#v, want sanitized visible reply", lastMessage)
	}
}

func TestRoomMessageStreamDisconnectPersistsPendingTurnForResume(t *testing.T) {
	root := t.TempDir()
	var firstStream ExecRequest
	var resumed ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/exec/stream":
			if err := json.NewDecoder(r.Body).Decode(&firstStream); err != nil {
				t.Fatalf("decode stream payload: %v", err)
			}
			w.Header().Set("Content-Type", "application/x-ndjson")
			events := []DaemonStreamEvent{
				{Type: "start", Provider: "codex", Command: []string{"codex", "exec"}},
				{Type: "stdout", Provider: "codex", Delta: "我先接住当前 continuity，已经完成第一段检查。"},
			}
			for _, event := range events {
				if err := json.NewEncoder(w).Encode(event); err != nil {
					return
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			time.Sleep(250 * time.Millisecond)
			_ = json.NewEncoder(w).Encode(DaemonStreamEvent{Type: "stdout", Provider: "codex", Delta: "第二段输出会在连接断开后丢失。"})
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		case "/v1/exec":
			if err := json.NewDecoder(r.Body).Decode(&resumed); err != nil {
				t.Fatalf("decode resumed payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我已经从刚才中断的位置续上，并把最后结论补齐。",
				Duration: "0.7s",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Streaming Disconnect Recovery", "Codex Dockmaster")
	initialDetail, ok := s.RoomDetail(created.RoomID)
	if !ok {
		t.Fatalf("RoomDetail(%q) missing", created.RoomID)
	}

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续把这条 lane 往前推。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	sawPartial := false
	for scanner.Scan() {
		var event DaemonStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		if event.Type == "stdout" && strings.Contains(event.Delta, "第一段检查") {
			sawPartial = true
			break
		}
	}
	if !sawPartial {
		t.Fatalf("stream did not emit partial stdout before disconnect")
	}
	cancel()
	_ = resp.Body.Close()

	deadline := time.Now().Add(3 * time.Second)
	var interrupted *store.Session
	for time.Now().Before(deadline) {
		snapshot := s.Snapshot()
		session := findSessionByID(snapshot, created.SessionID)
		if session != nil && session.PendingTurn != nil && session.PendingTurn.Status == "interrupted" {
			interrupted = session
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if interrupted == nil {
		t.Fatalf("pending interrupted turn missing after stream disconnect: %#v", s.Snapshot().Sessions)
	}
	if interrupted.PendingTurn.Prompt != "继续把这条 lane 往前推。" {
		t.Fatalf("pending turn prompt = %#v, want original user prompt", interrupted.PendingTurn)
	}
	if !strings.Contains(interrupted.PendingTurn.Preview, "第一段检查") {
		t.Fatalf("pending turn preview = %#v, want partial visible output", interrupted.PendingTurn)
	}
	if !interrupted.PendingTurn.ResumeEligible {
		t.Fatalf("pending turn = %#v, want resume eligible", interrupted.PendingTurn)
	}
	if !strings.Contains(interrupted.ControlNote, "中断") {
		t.Fatalf("session control note = %q, want interrupted recovery hint", interrupted.ControlNote)
	}
	if detail, ok := s.RoomDetail(created.RoomID); !ok {
		t.Fatalf("RoomDetail(%q) missing after interrupt", created.RoomID)
	} else if len(detail.Messages) != len(initialDetail.Messages) {
		t.Fatalf("room messages after interrupt = %#v, want no committed failure/filler reply", detail.Messages)
	}

	secondBody, err := json.Marshal(map[string]any{
		"prompt":   "继续刚才中断的那一拍。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal(second) error = %v", err)
	}
	secondResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(secondBody))
	if err != nil {
		t.Fatalf("POST resumed room message error = %v", err)
	}
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("resumed room message status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &payload)

	if !resumed.ResumeSession {
		t.Fatalf("resumed exec request = %#v, want resumeSession after interrupted stream", resumed)
	}
	if !strings.Contains(resumed.Prompt, "上一次流式执行在公开连接断开后中断") {
		t.Fatalf("resumed prompt = %q, want interrupted-turn wakeup hint", resumed.Prompt)
	}
	if !strings.Contains(resumed.Prompt, "第一段检查") {
		t.Fatalf("resumed prompt = %q, want preserved partial visible output", resumed.Prompt)
	}
	finalSession := findSessionByID(payload.State, created.SessionID)
	if finalSession == nil || finalSession.PendingTurn != nil {
		t.Fatalf("final session = %#v, want cleared pending turn after successful resume", finalSession)
	}
	if !strings.Contains(payload.Output, "中断的位置续上") {
		t.Fatalf("final output = %q, want resumed daemon reply", payload.Output)
	}
}

func TestRoomAutoHandoffBlockedFollowupPersistsDurableContinuationAcrossRestart(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	var execRequests []ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		execRequests = append(execRequests, req)

		switch len(execRequests) {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这一棒交给 reviewer。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核恢复链路 | 请把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
		case 2:
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		case 3:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我接着上一轮没跑完的复核，先把恢复链路继续收口。",
				Duration: "0.4s",
			})
		default:
			t.Fatalf("unexpected exec request count: %d", len(execRequests))
		}
	}))
	defer daemon.Close()

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	pairMainRuntime(t, s, daemon.URL)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Blocked Auto Handoff Continuation", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续把恢复链路推进。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("first room message status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var firstPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &firstPayload)
	server.Close()

	var blockedHandoff *store.AgentHandoff
	for index := range firstPayload.State.Mailbox {
		item := &firstPayload.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Kind == "room-auto" {
			blockedHandoff = item
			break
		}
	}
	if blockedHandoff == nil {
		t.Fatalf("mailbox missing room-auto handoff: %#v", firstPayload.State.Mailbox)
	}
	if blockedHandoff.AutoFollowup == nil || blockedHandoff.AutoFollowup.Status != "blocked" {
		t.Fatalf("handoff auto followup = %#v, want blocked durable followup state", blockedHandoff)
	}
	if !strings.Contains(blockedHandoff.AutoFollowup.Summary, "当前还未登录模型服务") {
		t.Fatalf("handoff auto followup summary = %#v, want blocked error summary", blockedHandoff.AutoFollowup)
	}
	if !strings.Contains(blockedHandoff.LastAction, "自动继续受阻") || !strings.Contains(blockedHandoff.LastAction, "当前还未登录模型服务") {
		t.Fatalf("handoff last action = %q, want blocked durable followup visibility", blockedHandoff.LastAction)
	}

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	secondBody, err := json.Marshal(map[string]any{
		"prompt": "现在我补一句，继续把上一轮卡住的复核做完。",
	})
	if err != nil {
		t.Fatalf("Marshal(second) error = %v", err)
	}
	secondResp, err := http.Post(reloadedServer.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(secondBody))
	if err != nil {
		t.Fatalf("POST restarted room message error = %v", err)
	}
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second room message status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var secondPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &secondPayload)

	if len(execRequests) != 3 {
		t.Fatalf("exec requests = %#v, want resumed third request after restart", execRequests)
	}
	if execRequests[2].Provider != "claude" {
		t.Fatalf("restart exec request = %#v, want current owner provider claude", execRequests[2])
	}
	for _, expected := range []string{
		"你上一轮已正式接棒当前房间",
		"自动继续时被阻塞",
		"当前还未登录模型服务",
	} {
		if !strings.Contains(execRequests[2].Prompt, expected) {
			t.Fatalf("restart exec prompt = %q, want %q", execRequests[2].Prompt, expected)
		}
	}

	var resumedHandoff *store.AgentHandoff
	for index := range secondPayload.State.Mailbox {
		item := &secondPayload.State.Mailbox[index]
		if item.ID == blockedHandoff.ID {
			resumedHandoff = item
			break
		}
	}
	if resumedHandoff == nil || resumedHandoff.AutoFollowup == nil || resumedHandoff.AutoFollowup.Status != "completed" {
		t.Fatalf("resumed handoff = %#v, want completed durable followup after restart", resumedHandoff)
	}
	if !strings.Contains(resumedHandoff.LastAction, "已自动继续") || !strings.Contains(resumedHandoff.LastAction, "我接着上一轮没跑完的复核") {
		t.Fatalf("resumed handoff last action = %q, want completed durable followup summary", resumedHandoff.LastAction)
	}
	if secondPayload.Output != "我接着上一轮没跑完的复核，先把恢复链路继续收口。" {
		t.Fatalf("second payload output = %q, want resumed claude reply", secondPayload.Output)
	}
}

func TestRoomMessageStreamCreatesMailboxHandoffFromDirective(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest
	var followup ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/exec/stream":
			if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
				t.Fatalf("decode exec payload: %v", err)
			}
			w.Header().Set("Content-Type", "application/x-ndjson")
			events := []DaemonStreamEvent{
				{Type: "start", Provider: "codex", Command: []string{"codex", "exec"}},
				{Type: "stdout", Provider: "codex", Delta: "我先把 continuity 主链收口。\n"},
				{Type: "stdout", Provider: "codex", Delta: "OPENSHOCK_HANDOFF: agent-claude-review-runner | 复核 continuity 主链 | 请检查恢复链路和副作用。"},
				{Type: "done", Provider: "codex", Output: "我先把 continuity 主链收口。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 复核 continuity 主链 | 请检查恢复链路和副作用。", Duration: "1.4s"},
			}
			for _, event := range events {
				if err := json.NewEncoder(w).Encode(event); err != nil {
					t.Fatalf("encode event: %v", err)
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
		case "/v1/exec":
			if err := json.NewDecoder(r.Body).Decode(&followup); err != nil {
				t.Fatalf("decode followup payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我来接住这一拍，先把恢复链路和副作用复核完，然后回写结论。",
				Duration: "0.6s",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Streaming Auto Handoff", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进这条 lane",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var events []DaemonStreamEvent
	for scanner.Scan() {
		var event DaemonStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}

	if seen.ResumeSession {
		t.Fatalf("stream request = %#v, should not resume on first turn", seen)
	}
	if followup.Provider != "claude" || !strings.Contains(followup.Prompt, "你刚刚已经接住当前房间的正式交棒") {
		t.Fatalf("followup request = %#v, want claude auto-continue prompt", followup)
	}
	if len(events) < 4 {
		t.Fatalf("expected stream events, got %#v", events)
	}
	last := events[len(events)-1]
	if last.Type != "state" || last.State == nil {
		t.Fatalf("last event = %#v, want state payload", last)
	}
	if strings.Contains(last.Output, "OPENSHOCK_HANDOFF:") {
		t.Fatalf("final stream output leaked handoff directive: %q", last.Output)
	}
	if !strings.Contains(last.Output, "continuity 主链收口") {
		t.Fatalf("final stream output = %q, want visible reply", last.Output)
	}

	var handoff *store.AgentHandoff
	for index := range last.State.Mailbox {
		item := &last.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Title == "复核 continuity 主链" {
			handoff = item
			break
		}
	}
	if handoff == nil {
		t.Fatalf("mailbox missing auto handoff for room %q: %#v", created.RoomID, last.State.Mailbox)
	}
	if handoff.FromAgentID != "agent-codex-dockmaster" || handoff.ToAgentID != "agent-claude-review-runner" {
		t.Fatalf("auto handoff = %#v, want codex -> claude", handoff)
	}
	if handoff.Kind != "room-auto" || handoff.Status != "acknowledged" || !strings.Contains(handoff.Summary, "恢复链路") {
		t.Fatalf("auto handoff = %#v, want acknowledged room-auto handoff summary", handoff)
	}

	room := findRoomByID(*last.State, created.RoomID)
	run := findRunByID(*last.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(*last.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want owner switched to Claude Review Runner", room)
	}
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched to Claude Review Runner", run)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want owner switched to Claude Review Runner", issue)
	}
	lastRoomMessage := last.State.RoomMessages[created.RoomID][len(last.State.RoomMessages[created.RoomID])-1]
	if lastRoomMessage.Speaker != "Claude Review Runner" || !strings.Contains(lastRoomMessage.Message, "恢复链路") {
		t.Fatalf("last room message = %#v, want followup from Claude Review Runner", lastRoomMessage)
	}

	for _, message := range last.State.RoomMessages[created.RoomID] {
		if strings.Contains(message.Message, "OPENSHOCK_HANDOFF:") {
			t.Fatalf("room message leaked handoff directive: %#v", message)
		}
	}
}

func TestStateRouteAutonomouslyRecoversBlockedRoomAutoFollowupAfterReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	var (
		mu           sync.Mutex
		execRequests []ExecRequest
	)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		mu.Lock()
		execRequests = append(execRequests, req)
		count := len(execRequests)
		mu.Unlock()

		switch count {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这一棒交给 reviewer。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核恢复链路 | 请把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
		case 2:
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		case 3:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我接着上一轮卡住的复核继续推进，先把恢复链路收口。",
				Duration: "0.4s",
			})
		default:
			t.Fatalf("unexpected exec request count: %d", count)
		}
	}))
	defer daemon.Close()

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	pairMainRuntime(t, s, daemon.URL)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "State Tick Auto Recovery", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续把恢复链路推进。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("first room message status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var firstPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &firstPayload)
	server.Close()

	var blockedHandoff *store.AgentHandoff
	for index := range firstPayload.State.Mailbox {
		item := &firstPayload.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Kind == "room-auto" {
			blockedHandoff = item
			break
		}
	}
	if blockedHandoff == nil || blockedHandoff.AutoFollowup == nil || blockedHandoff.AutoFollowup.Status != "blocked" {
		t.Fatalf("blocked handoff = %#v, want blocked room-auto followup", blockedHandoff)
	}

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	var recovered store.State
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		stateResp, err := http.Get(reloadedServer.URL + "/v1/state")
		if err != nil {
			t.Fatalf("GET /v1/state error = %v", err)
		}
		if stateResp.StatusCode != http.StatusOK {
			t.Fatalf("GET /v1/state status = %d, want %d", stateResp.StatusCode, http.StatusOK)
		}
		decodeJSON(t, stateResp, &recovered)
		stateResp.Body.Close()

		var resumed *store.AgentHandoff
		for index := range recovered.Mailbox {
			item := &recovered.Mailbox[index]
			if item.ID == blockedHandoff.ID {
				resumed = item
				break
			}
		}
		if resumed != nil && resumed.AutoFollowup != nil && resumed.AutoFollowup.Status == "completed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	var resumedHandoff *store.AgentHandoff
	for index := range recovered.Mailbox {
		item := &recovered.Mailbox[index]
		if item.ID == blockedHandoff.ID {
			resumedHandoff = item
			break
		}
	}
	if resumedHandoff == nil || resumedHandoff.AutoFollowup == nil || resumedHandoff.AutoFollowup.Status != "completed" {
		t.Fatalf("recovered handoff = %#v, want completed auto followup after state tick", resumedHandoff)
	}

	mu.Lock()
	if len(execRequests) != 3 {
		mu.Unlock()
		t.Fatalf("exec requests = %#v, want third autonomous retry after state tick", execRequests)
	}
	recoveryReq := execRequests[2]
	mu.Unlock()
	if recoveryReq.Provider != "claude" {
		t.Fatalf("recovery exec request = %#v, want claude owner retry", recoveryReq)
	}
	for _, expected := range []string{
		"你上一轮已正式接棒当前房间",
		"自动继续时被阻塞",
		"当前还未登录模型服务",
	} {
		if !strings.Contains(recoveryReq.Prompt, expected) {
			t.Fatalf("recovery prompt = %q, want %q", recoveryReq.Prompt, expected)
		}
	}

	roomMessages := recovered.RoomMessages[created.RoomID]
	humanCount := 0
	for _, message := range roomMessages {
		if message.Role == "human" {
			humanCount++
		}
	}
	if humanCount != 1 {
		t.Fatalf("room messages = %#v, want only original human message without explicit restart prompt", roomMessages)
	}
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Speaker != "Claude Review Runner" || lastMessage.Message != "我接着上一轮卡住的复核继续推进，先把恢复链路收口。" {
		t.Fatalf("last room message = %#v, want autonomous claude recovery reply", lastMessage)
	}
}

func TestStateRouteRecoveryTickDoesNotDuplicateInFlightRoomAutoRetry(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	previousCooldown := roomAutoRecoveryCooldown
	roomAutoRecoveryCooldown = 0
	defer func() {
		roomAutoRecoveryCooldown = previousCooldown
	}()

	var (
		mu              sync.Mutex
		execRequests    []ExecRequest
		releaseRecovery = make(chan struct{})
	)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		mu.Lock()
		execRequests = append(execRequests, req)
		count := len(execRequests)
		mu.Unlock()

		switch count {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这一棒交给 reviewer。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核恢复链路 | 请把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
		case 2:
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		case 3:
			<-releaseRecovery
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		default:
			t.Fatalf("unexpected exec request count: %d", count)
		}
	}))
	defer daemon.Close()

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	pairMainRuntime(t, s, daemon.URL)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "State Tick Inflight Dedup", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续把恢复链路推进。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("first room message status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	firstTick, err := http.Get(reloadedServer.URL + "/v1/state")
	if err != nil {
		t.Fatalf("first GET /v1/state error = %v", err)
	}
	firstTick.Body.Close()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		count := len(execRequests)
		mu.Unlock()
		if count == 3 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	mu.Lock()
	if len(execRequests) != 3 {
		mu.Unlock()
		t.Fatalf("exec requests before duplicate polls = %#v, want one in-flight recovery request", execRequests)
	}
	mu.Unlock()

	for index := 0; index < 3; index++ {
		stateResp, err := http.Get(reloadedServer.URL + "/v1/state")
		if err != nil {
			t.Fatalf("duplicate GET /v1/state error = %v", err)
		}
		stateResp.Body.Close()
	}

	time.Sleep(100 * time.Millisecond)
	mu.Lock()
	if len(execRequests) != 3 {
		mu.Unlock()
		t.Fatalf("exec requests during in-flight recovery = %#v, want no duplicate retry", execRequests)
	}
	mu.Unlock()

	close(releaseRecovery)
}

func TestBackgroundRecoveryLoopAutonomouslyRecoversBlockedRoomAutoFollowupAfterReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	var (
		mu           sync.Mutex
		execRequests []ExecRequest
	)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		mu.Lock()
		execRequests = append(execRequests, req)
		count := len(execRequests)
		mu.Unlock()

		switch count {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这一棒交给 reviewer。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核恢复链路 | 请把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
		case 2:
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		case 3:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我接着上一轮卡住的复核继续推进，先把恢复链路收口。",
				Duration: "0.4s",
			})
		default:
			t.Fatalf("unexpected exec request count: %d", count)
		}
	}))
	defer daemon.Close()

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	pairMainRuntime(t, s, daemon.URL)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Loop Auto Recovery", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续把恢复链路推进。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("first room message status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedAPI := New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reloadedAPI.StartRoomAutoRecoveryLoop(ctx, 5*time.Millisecond)

	deadline := time.Now().Add(2 * time.Second)
	var resumedHandoff *store.AgentHandoff
	for time.Now().Before(deadline) {
		snapshot := reloadedStore.Snapshot()
		for index := range snapshot.Mailbox {
			item := &snapshot.Mailbox[index]
			if item.RoomID == created.RoomID && item.Kind == "room-auto" {
				resumedHandoff = item
				break
			}
		}
		if resumedHandoff != nil && resumedHandoff.AutoFollowup != nil && resumedHandoff.AutoFollowup.Status == "completed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if resumedHandoff == nil || resumedHandoff.AutoFollowup == nil || resumedHandoff.AutoFollowup.Status != "completed" {
		t.Fatalf("recovered handoff = %#v, want completed auto followup after background loop", resumedHandoff)
	}

	mu.Lock()
	if len(execRequests) != 3 {
		mu.Unlock()
		t.Fatalf("exec requests = %#v, want third autonomous retry from background loop", execRequests)
	}
	recoveryReq := execRequests[2]
	mu.Unlock()
	if recoveryReq.Provider != "claude" {
		t.Fatalf("recovery exec request = %#v, want claude owner retry", recoveryReq)
	}
	for _, expected := range []string{
		"你上一轮已正式接棒当前房间",
		"自动继续时被阻塞",
		"当前还未登录模型服务",
	} {
		if !strings.Contains(recoveryReq.Prompt, expected) {
			t.Fatalf("recovery prompt = %q, want %q", recoveryReq.Prompt, expected)
		}
	}

	roomMessages := reloadedStore.Snapshot().RoomMessages[created.RoomID]
	humanCount := 0
	for _, message := range roomMessages {
		if message.Role == "human" {
			humanCount++
		}
	}
	if humanCount != 1 {
		t.Fatalf("room messages = %#v, want only original human message without explicit restart prompt", roomMessages)
	}
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Speaker != "Claude Review Runner" || lastMessage.Message != "我接着上一轮卡住的复核继续推进，先把恢复链路收口。" {
		t.Fatalf("last room message = %#v, want autonomous claude recovery reply", lastMessage)
	}
}

func TestBackgroundRecoveryLoopDoesNotDuplicateInFlightRoomAutoRetry(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	previousCooldown := roomAutoRecoveryCooldown
	roomAutoRecoveryCooldown = 0
	defer func() {
		roomAutoRecoveryCooldown = previousCooldown
	}()

	var (
		mu              sync.Mutex
		execRequests    []ExecRequest
		releaseRecovery = make(chan struct{})
	)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		mu.Lock()
		execRequests = append(execRequests, req)
		count := len(execRequests)
		mu.Unlock()

		switch count {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这一棒交给 reviewer。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核恢复链路 | 请把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
		case 2:
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		case 3:
			<-releaseRecovery
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "not logged in"})
		default:
			t.Fatalf("unexpected exec request count: %d", count)
		}
	}))
	defer daemon.Close()

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	pairMainRuntime(t, s, daemon.URL)

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Loop Inflight Dedup", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续把恢复链路推进。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("first room message status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedAPI := New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reloadedAPI.StartRoomAutoRecoveryLoop(ctx, 5*time.Millisecond)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		count := len(execRequests)
		mu.Unlock()
		if count == 3 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	mu.Lock()
	if len(execRequests) != 3 {
		mu.Unlock()
		t.Fatalf("exec requests before duplicate ticks = %#v, want one in-flight recovery request", execRequests)
	}
	mu.Unlock()

	time.Sleep(100 * time.Millisecond)
	mu.Lock()
	if len(execRequests) != 3 {
		mu.Unlock()
		t.Fatalf("exec requests during in-flight background recovery = %#v, want no duplicate retry", execRequests)
	}
	mu.Unlock()

	close(releaseRecovery)
}

func TestRoomMessageStreamPersistsBlockedConversationOnError(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec/stream" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		if err := json.NewEncoder(w).Encode(map[string]any{"error": "not logged in"}); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}))
	defer daemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemon.URL,
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Streaming Blocked",
		Summary:  "verify room blocked writeback",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(created.RunID, created.SessionID, store.LaneBinding{
		Branch:       created.Branch,
		WorktreeName: created.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", created.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "请告诉我现在卡在哪里",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST stream error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var events []DaemonStreamEvent
	for scanner.Scan() {
		var event DaemonStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("Unmarshal() error = %v", err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner.Err() = %v", err)
	}

	if len(events) == 0 {
		t.Fatalf("expected stream events, got none")
	}
	last := events[len(events)-1]
	if last.Type != "state" || last.State == nil {
		t.Fatalf("last event = %#v, want state payload", last)
	}

	messages := last.State.RoomMessages[created.RoomID]
	if len(messages) < 4 {
		t.Fatalf("blocked room messages = %#v, want persisted human + blocked reply", messages)
	}
	human := messages[len(messages)-2]
	blocked := messages[len(messages)-1]
	if human.Role != "human" || human.Message != "请告诉我现在卡在哪里" {
		t.Fatalf("human blocked message = %#v, want original prompt persisted", human)
	}
	if blocked.Tone != "blocked" || !strings.Contains(blocked.Message, "当前还未登录模型服务") {
		t.Fatalf("blocked room reply = %#v, want blocked explanation", blocked)
	}
}

func TestRoomMessagePersistsBlockedConversationOnError(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		if err := json.NewEncoder(w).Encode(map[string]any{"error": "not logged in"}); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}))
	defer daemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemon.URL,
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	created, err := s.CreateIssue(store.CreateIssueInput{
		Title:    "Blocked Room Reply",
		Summary:  "verify room blocked writeback",
		Owner:    "Claude Review Runner",
		Priority: "high",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	if _, err := s.AttachLane(created.RunID, created.SessionID, store.LaneBinding{
		Branch:       created.Branch,
		WorktreeName: created.WorktreeName,
		Path:         filepath.Join(root, ".openshock-worktrees", created.WorktreeName),
	}); err != nil {
		t.Fatalf("AttachLane() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "请告诉我为什么失败",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error string      `json:"error"`
		State store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if !strings.Contains(payload.Error, "当前还未登录模型服务") {
		t.Fatalf("error = %q, want blocked explanation", payload.Error)
	}

	messages := payload.State.RoomMessages[created.RoomID]
	if len(messages) < 4 {
		t.Fatalf("room messages = %#v, want persisted human + blocked reply", messages)
	}
	human := messages[len(messages)-2]
	blocked := messages[len(messages)-1]
	if human.Role != "human" || human.Message != "请告诉我为什么失败" {
		t.Fatalf("human blocked message = %#v, want original prompt persisted", human)
	}
	if blocked.Tone != "blocked" || !strings.Contains(blocked.Message, "当前还未登录模型服务") {
		t.Fatalf("blocked room reply = %#v, want blocked explanation", blocked)
	}
}

func TestRoomMessageRouteCreatesMailboxHandoffFromDirective(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest
	var followup ExecRequest
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		if requestCount == 1 {
			if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
				t.Fatalf("decode exec payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这条房间结论收住。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核房间结论 | 请确认回复是否自然且没有漏项。",
				Duration: "0.7s",
			})
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&followup); err != nil {
			t.Fatalf("decode followup payload: %v", err)
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "我来接住这条房间结论，先确认语气和漏项，再继续收口。",
			Duration: "0.5s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Direct Auto Handoff", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "把这条房间消息继续推进",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if seen.ResumeSession {
		t.Fatalf("request = %#v, should not resume on first turn", seen)
	}
	if requestCount != 2 || followup.Provider != "claude" || !strings.Contains(followup.Prompt, "这轮不要继续转交别人") {
		t.Fatalf("followup request = %#v count=%d, want second claude auto-continue request", followup, requestCount)
	}
	if strings.Contains(payload.Output, "OPENSHOCK_HANDOFF:") {
		t.Fatalf("payload output leaked handoff directive: %q", payload.Output)
	}
	if !strings.Contains(payload.Output, "房间结论收住") {
		t.Fatalf("payload output = %q, want visible reply", payload.Output)
	}

	var handoff *store.AgentHandoff
	for index := range payload.State.Mailbox {
		item := &payload.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Title == "继续复核房间结论" {
			handoff = item
			break
		}
	}
	if handoff == nil {
		t.Fatalf("mailbox missing auto handoff for room %q: %#v", created.RoomID, payload.State.Mailbox)
	}
	if handoff.FromAgentID != "agent-codex-dockmaster" || handoff.ToAgentID != "agent-claude-review-runner" {
		t.Fatalf("auto handoff = %#v, want codex -> claude", handoff)
	}
	if handoff.Kind != "room-auto" || handoff.Status != "acknowledged" || !strings.Contains(handoff.Summary, "没有漏项") {
		t.Fatalf("auto handoff = %#v, want acknowledged room-auto handoff summary", handoff)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want owner switched to Claude Review Runner", room)
	}
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched to Claude Review Runner", run)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want owner switched to Claude Review Runner", issue)
	}
	lastRoomMessage := payload.State.RoomMessages[created.RoomID][len(payload.State.RoomMessages[created.RoomID])-1]
	if lastRoomMessage.Speaker != "Claude Review Runner" || !strings.Contains(lastRoomMessage.Message, "漏项") {
		t.Fatalf("last room message = %#v, want followup from Claude Review Runner", lastRoomMessage)
	}

	for _, message := range payload.State.RoomMessages[created.RoomID] {
		if strings.Contains(message.Message, "OPENSHOCK_HANDOFF:") {
			t.Fatalf("room message leaked handoff directive: %#v", message)
		}
	}
}

func TestRoomMessageRouteSequentialAutoHandoffUsesCurrentOwnerOnSecondTurn(t *testing.T) {
	root := t.TempDir()
	var firstTurn ExecRequest
	var firstFollowup ExecRequest
	var secondTurn ExecRequest
	var secondFollowup ExecRequest
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		switch requestCount {
		case 1:
			if err := json.NewDecoder(r.Body).Decode(&firstTurn); err != nil {
				t.Fatalf("decode first turn payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把房间主链收住。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核房间结论 | 请确认回复是否自然且没有漏项。",
				Duration: "0.6s",
			})
		case 2:
			if err := json.NewDecoder(r.Body).Decode(&firstFollowup); err != nil {
				t.Fatalf("decode first followup payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我来接住这条房间结论，先确认语气和漏项，再继续收口。",
				Duration: "0.5s",
			})
		case 3:
			if err := json.NewDecoder(r.Body).Decode(&secondTurn); err != nil {
				t.Fatalf("decode second turn payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我先把这轮房间结论收平。\nOPENSHOCK_HANDOFF: agent-memory-clerk | 继续收记忆和验收点 | 请把影片资料、验收点和记忆写回一起收口。",
				Duration: "0.5s",
			})
		case 4:
			if err := json.NewDecoder(r.Body).Decode(&secondFollowup); err != nil {
				t.Fatalf("decode second followup payload: %v", err)
			}
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我接着把影片资料、验收点和记忆写回一起收口，稍后把最终结论回到房间。",
				Duration: "0.5s",
			})
		default:
			t.Fatalf("unexpected exec request #%d", requestCount)
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Sequential Auto Handoff", "Codex Dockmaster")

	firstBody, err := json.Marshal(map[string]any{
		"prompt":   "继续把房间消息推进",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() first body error = %v", err)
	}

	firstResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(firstBody))
	if err != nil {
		t.Fatalf("POST first room message error = %v", err)
	}
	defer firstResp.Body.Close()

	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	var firstPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, firstResp, &firstPayload)

	roomAfterFirstTurn := findRoomByID(firstPayload.State, created.RoomID)
	if roomAfterFirstTurn == nil || roomAfterFirstTurn.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room after first turn = %#v, want Claude Review Runner owner", roomAfterFirstTurn)
	}

	secondBody, err := json.Marshal(map[string]any{
		"prompt": "继续把影片资料和验收点也收一下。",
	})
	if err != nil {
		t.Fatalf("Marshal() second body error = %v", err)
	}

	secondResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(secondBody))
	if err != nil {
		t.Fatalf("POST second room message error = %v", err)
	}
	defer secondResp.Body.Close()

	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var secondPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &secondPayload)

	if requestCount != 4 {
		t.Fatalf("requestCount = %d, want 4 across two sequential auto handoffs", requestCount)
	}
	if firstTurn.Provider != "codex" || firstTurn.ResumeSession {
		t.Fatalf("first turn request = %#v, want direct codex request without resume", firstTurn)
	}
	if firstFollowup.Provider != "claude" || !strings.Contains(firstFollowup.Prompt, "这轮不要继续转交别人") {
		t.Fatalf("first followup = %#v, want claude auto-continue prompt", firstFollowup)
	}
	if secondTurn.Provider != "claude" || !strings.Contains(secondTurn.Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("second turn = %#v, want second user turn routed to Claude Review Runner", secondTurn)
	}
	if secondFollowup.Provider != "codex" {
		t.Fatalf("second followup = %#v, want codex provider for Memory Clerk handoff", secondFollowup)
	}
	if !strings.Contains(secondFollowup.Prompt, "本轮请以 Memory Clerk 的身份回应") {
		t.Fatalf("second followup prompt = %q, want Memory Clerk identity after second handoff", secondFollowup.Prompt)
	}
	if strings.Contains(secondFollowup.Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("second followup prompt = %q, should not keep Claude Review Runner as responder after second handoff", secondFollowup.Prompt)
	}
	if !strings.Contains(secondFollowup.Prompt, "你刚刚已经接住当前房间的正式交棒") {
		t.Fatalf("second followup prompt = %q, want auto-handoff continuation hint", secondFollowup.Prompt)
	}
	if !strings.Contains(secondFollowup.Prompt, "把 next-run injection、promotion 和 version audit 保持成可解释真值。") {
		t.Fatalf("second followup prompt = %q, want Memory Clerk prompt scaffold after second handoff", secondFollowup.Prompt)
	}
	if strings.Contains(secondFollowup.Prompt, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("second followup prompt = %q, should not fall back to stale Claude Review Runner prompt", secondFollowup.Prompt)
	}
	if strings.Contains(secondPayload.Output, "OPENSHOCK_HANDOFF:") {
		t.Fatalf("second payload output leaked handoff directive: %q", secondPayload.Output)
	}

	var memoryHandoff *store.AgentHandoff
	for index := range secondPayload.State.Mailbox {
		item := &secondPayload.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Title == "继续收记忆和验收点" {
			memoryHandoff = item
			break
		}
	}
	if memoryHandoff == nil {
		t.Fatalf("mailbox missing second auto handoff: %#v", secondPayload.State.Mailbox)
	}
	if memoryHandoff.FromAgentID != "agent-claude-review-runner" || memoryHandoff.ToAgentID != "agent-memory-clerk" {
		t.Fatalf("second auto handoff = %#v, want Claude Review Runner -> Memory Clerk", memoryHandoff)
	}
	if memoryHandoff.Kind != "room-auto" || memoryHandoff.Status != "acknowledged" || !strings.Contains(memoryHandoff.Summary, "记忆写回") {
		t.Fatalf("second auto handoff = %#v, want acknowledged room-auto handoff summary", memoryHandoff)
	}

	room := findRoomByID(secondPayload.State, created.RoomID)
	run := findRunByID(secondPayload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(secondPayload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Memory Clerk" {
		t.Fatalf("room = %#v, want Memory Clerk owner after second handoff", room)
	}
	if run == nil || run.Owner != "Memory Clerk" {
		t.Fatalf("run = %#v, want Memory Clerk run owner after second handoff", run)
	}
	if issue == nil || issue.Owner != "Memory Clerk" {
		t.Fatalf("issue = %#v, want Memory Clerk issue owner after second handoff", issue)
	}
	lastRoomMessage := secondPayload.State.RoomMessages[created.RoomID][len(secondPayload.State.RoomMessages[created.RoomID])-1]
	if lastRoomMessage.Speaker != "Memory Clerk" || !strings.Contains(lastRoomMessage.Message, "记忆写回") {
		t.Fatalf("last room message = %#v, want final followup from Memory Clerk", lastRoomMessage)
	}

	for _, message := range secondPayload.State.RoomMessages[created.RoomID] {
		if strings.Contains(message.Message, "OPENSHOCK_HANDOFF:") {
			t.Fatalf("room message leaked handoff directive: %#v", message)
		}
	}
}

func TestRoomMessageRouteSupportsNoResponseEnvelope(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "codex",
			Command:  []string{"codex", "exec"},
			Output:   "KIND: no_response\nBODY:",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "No Response Envelope", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "收到，先这样。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Output != "" {
		t.Fatalf("payload output = %q, want empty no_response output", payload.Output)
	}
	roomMessages := payload.State.RoomMessages[created.RoomID]
	if len(roomMessages) == 0 {
		t.Fatalf("room messages empty for %q", created.RoomID)
	}
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Role != "human" || lastMessage.Message != "收到，先这样。" {
		t.Fatalf("last room message = %#v, want human-only writeback", lastMessage)
	}
	for _, message := range roomMessages {
		if strings.Contains(message.Message, "已收到，但这次没有可展示的文本输出。") {
			t.Fatalf("room message should not contain default filler reply: %#v", message)
		}
	}
}

func TestRoomMessageRouteMemoryPreviewFollowsCurrentOwnerAcrossHandoffRestart(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		switch requestCount {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "KIND: handoff\nBODY:\n@agent-claude-review-runner 你继续把恢复链路和副作用复核完。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核恢复链路 | 请把恢复链路和副作用复核完。",
				Duration: "0.5s",
			})
		case 2:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "SEND_PUBLIC_MESSAGE\nKIND: no_response\nBODY:",
				Duration: "0.4s",
			})
		case 3:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "KIND: handoff\nBODY:\n@agent-memory-clerk 你继续收记忆和验收点。\nOPENSHOCK_HANDOFF: agent-memory-clerk | 继续收记忆和验收点 | 请把影片资料、验收点和记忆写回一起收口。",
				Duration: "0.5s",
			})
		case 4:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "SEND_PUBLIC_MESSAGE\nKIND: no_response\nBODY:",
				Duration: "0.4s",
			})
		default:
			t.Fatalf("unexpected exec request count: %d", requestCount)
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Memory Preview Continuity", "Codex Dockmaster")

	firstBody, err := json.Marshal(map[string]any{
		"prompt":   "继续推进当前 lane。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	firstResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(firstBody))
	if err != nil {
		t.Fatalf("POST first room message error = %v", err)
	}
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	var firstPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, firstResp, &firstPayload)
	if requestCount != 2 {
		t.Fatalf("requestCount after first turn = %d, want 2", requestCount)
	}

	firstCenterResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	defer firstCenterResp.Body.Close()
	if firstCenterResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", firstCenterResp.StatusCode, http.StatusOK)
	}

	var firstCenter store.MemoryCenter
	decodeJSON(t, firstCenterResp, &firstCenter)
	firstPreview := findPreviewBySession(firstCenter.Previews, created.SessionID)
	if firstPreview == nil {
		t.Fatalf("preview missing for session %q: %#v", created.SessionID, firstCenter.Previews)
	}
	if !strings.Contains(firstPreview.PromptSummary, "Claude Review Runner") {
		t.Fatalf("first preview summary = %q, want Claude Review Runner after first handoff", firstPreview.PromptSummary)
	}
	if !strings.Contains(firstPreview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("first preview summary = %q, want Claude prompt scaffold", firstPreview.PromptSummary)
	}
	if strings.Contains(firstPreview.PromptSummary, "把 next-run injection、promotion 和 version audit 保持成可解释真值。") {
		t.Fatalf("first preview summary = %q, should not jump to Memory Clerk before second handoff", firstPreview.PromptSummary)
	}

	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	secondBody, err := json.Marshal(map[string]any{
		"prompt": "继续把影片资料、验收点和记忆写回一起收口。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	secondResp, err := http.Post(reloadedServer.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(secondBody))
	if err != nil {
		t.Fatalf("POST second room message error = %v", err)
	}
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var secondPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &secondPayload)
	if requestCount != 4 {
		t.Fatalf("requestCount after second turn = %d, want 4", requestCount)
	}

	secondCenterResp, err := http.Get(reloadedServer.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after reload error = %v", err)
	}
	defer secondCenterResp.Body.Close()
	if secondCenterResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after reload status = %d, want %d", secondCenterResp.StatusCode, http.StatusOK)
	}

	var secondCenter store.MemoryCenter
	decodeJSON(t, secondCenterResp, &secondCenter)
	secondPreview := findPreviewBySession(secondCenter.Previews, created.SessionID)
	if secondPreview == nil {
		t.Fatalf("preview missing for session %q after reload: %#v", created.SessionID, secondCenter.Previews)
	}
	if !strings.Contains(secondPreview.PromptSummary, "Memory Clerk") {
		t.Fatalf("second preview summary = %q, want Memory Clerk after second handoff", secondPreview.PromptSummary)
	}
	if !strings.Contains(secondPreview.PromptSummary, "把 next-run injection、promotion 和 version audit 保持成可解释真值。") {
		t.Fatalf("second preview summary = %q, want Memory Clerk prompt scaffold", secondPreview.PromptSummary)
	}
	if strings.Contains(secondPreview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("second preview summary = %q, should not fall back to stale Claude Review Runner prompt", secondPreview.PromptSummary)
	}

	room := findRoomByID(secondPayload.State, created.RoomID)
	run := findRunByID(secondPayload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(secondPayload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Memory Clerk" {
		t.Fatalf("room = %#v, want Memory Clerk owner", room)
	}
	if run == nil || run.Owner != "Memory Clerk" {
		t.Fatalf("run = %#v, want Memory Clerk owner", run)
	}
	if issue == nil || issue.Owner != "Memory Clerk" {
		t.Fatalf("issue = %#v, want Memory Clerk owner", issue)
	}
}

func TestRoomMessageRouteSupportsClarificationRequestEnvelope(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "codex",
			Command:  []string{"codex", "exec"},
			Output:   "kind: clarification_request\nbody:\n请先确认这轮是否允许我改 billing guard。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Clarification Envelope", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "可以改，但只限这个 guard。",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Output != "请先确认这轮是否允许我改 billing guard。" {
		t.Fatalf("payload output = %q, want clarification question", payload.Output)
	}
	roomMessages := payload.State.RoomMessages[created.RoomID]
	if len(roomMessages) < 2 {
		t.Fatalf("room messages = %#v, want human + clarification reply", roomMessages)
	}
	human := roomMessages[len(roomMessages)-2]
	agent := roomMessages[len(roomMessages)-1]
	if human.Role != "human" || human.Message != "可以改，但只限这个 guard。" {
		t.Fatalf("human message = %#v, want original prompt persisted", human)
	}
	if agent.Role != "agent" || agent.Tone != "blocked" || agent.Message != "请先确认这轮是否允许我改 billing guard。" {
		t.Fatalf("agent clarification = %#v, want blocked clarification", agent)
	}
	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Status != "paused" {
		t.Fatalf("room = %#v, want paused topic", room)
	}
	if run == nil || run.Status != "paused" || !strings.Contains(run.NextAction, "等待当前问题") {
		t.Fatalf("run = %#v, want paused run waiting for clarification", run)
	}
	if issue == nil || issue.State != "paused" {
		t.Fatalf("issue = %#v, want paused issue", issue)
	}
}

func TestRoomMessageRouteUsesExplicitWaitAfterSystemMessage(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "KIND: message\nBODY:\n我收到 rollout 范围了，这轮只按当前 lane 继续。",
			Duration: "0.3s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Explicit Wait Routing", "Codex Dockmaster")

	if _, err := s.AppendAgentClarificationRequest(created.RoomID, "Claude Review Runner", "请先补充 rollout 范围。", "claude"); err != nil {
		t.Fatalf("AppendAgentClarificationRequest() error = %v", err)
	}
	if _, err := s.AppendSystemRoomMessage(created.RoomID, "System", "系统提醒：等待人工补充。", "system"); err != nil {
		t.Fatalf("AppendSystemRoomMessage() error = %v", err)
	}

	body, err := json.Marshal(map[string]any{
		"prompt":   "只做当前 lane 的 rollout。",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if !strings.Contains(seen.Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("exec prompt = %q, want clarification followup routed to Claude Review Runner", seen.Prompt)
	}
	if !strings.Contains(seen.Prompt, "你上一轮刚提出过阻塞性澄清") {
		t.Fatalf("exec prompt = %q, want clarification followup hint preserved", seen.Prompt)
	}

	roomMessages := payload.State.RoomMessages[created.RoomID]
	if len(roomMessages) == 0 {
		t.Fatalf("room messages = %#v, want persisted reply", roomMessages)
	}
	last := roomMessages[len(roomMessages)-1]
	if last.Speaker != "Claude Review Runner" || last.Role != "agent" || last.Message != "我收到 rollout 范围了，这轮只按当前 lane 继续。" {
		t.Fatalf("last room message = %#v, want Claude followup reply", last)
	}

	foundResolvedWait := false
	for _, wait := range payload.State.RoomAgentWaits {
		if wait.RoomID == created.RoomID && wait.AgentID == "agent-claude-review-runner" {
			if wait.Status != "resolved" {
				t.Fatalf("room wait = %#v, want resolved after followup reply", wait)
			}
			foundResolvedWait = true
		}
	}
	if !foundResolvedWait {
		t.Fatalf("room waits = %#v, want resolved Claude wait", payload.State.RoomAgentWaits)
	}
}

func TestRoomMessageRouteClarificationWaitSurvivesStoreReload(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "我收到 rollout 范围了，这轮只按当前 lane 继续。",
			Duration: "0.3s",
		})
	}))
	defer daemon.Close()

	initialStore, initialServer := newContractTestServer(t, root, daemon.URL)
	created, _ := createLeaseTestIssue(t, initialStore, root, daemon.URL, "Clarification Reload", "Codex Dockmaster")

	if _, err := initialStore.AppendAgentClarificationRequest(created.RoomID, "Claude Review Runner", "请先补充 rollout 范围。", "claude"); err != nil {
		t.Fatalf("AppendAgentClarificationRequest() error = %v", err)
	}
	initialServer.Close()

	reloadedStore, err := store.New(filepath.Join(root, "data", "state.json"), root)
	if err != nil {
		t.Fatalf("store.New() reload error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	body, err := json.Marshal(map[string]any{
		"prompt": "只做当前 lane 的 rollout。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(reloadedServer.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if seen.Provider != "claude" {
		t.Fatalf("exec request = %#v, want claude provider after reload", seen)
	}
	if !strings.Contains(seen.Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("exec prompt = %q, want clarification followup routed to Claude Review Runner after reload", seen.Prompt)
	}
	if !strings.Contains(seen.Prompt, "你上一轮刚提出过阻塞性澄清") {
		t.Fatalf("exec prompt = %q, want clarification followup hint after reload", seen.Prompt)
	}
	if payload.Output != "我收到 rollout 范围了，这轮只按当前 lane 继续。" {
		t.Fatalf("payload output = %q, want claude reply after reload", payload.Output)
	}

	roomMessages := payload.State.RoomMessages[created.RoomID]
	if len(roomMessages) == 0 {
		t.Fatalf("room messages = %#v, want persisted reply", roomMessages)
	}
	last := roomMessages[len(roomMessages)-1]
	if last.Speaker != "Claude Review Runner" || last.Role != "agent" || last.Message != "我收到 rollout 范围了，这轮只按当前 lane 继续。" {
		t.Fatalf("last room message = %#v, want Claude followup reply after reload", last)
	}

	foundResolvedWait := false
	for _, wait := range payload.State.RoomAgentWaits {
		if wait.RoomID == created.RoomID && wait.AgentID == "agent-claude-review-runner" {
			if wait.Status != "resolved" {
				t.Fatalf("room wait = %#v, want resolved after reload followup reply", wait)
			}
			foundResolvedWait = true
		}
	}
	if !foundResolvedWait {
		t.Fatalf("room waits = %#v, want resolved Claude wait after reload", payload.State.RoomAgentWaits)
	}
}

func TestRoomMessageRouteInfersVisibleHandoffEnvelope(t *testing.T) {
	root := t.TempDir()
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		if requestCount == 1 {
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "KIND: handoff\nBODY:\n@agent-claude-review-runner 你继续把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "我已接手，先复核恢复链路和副作用，再把结论回写到房间。",
			Duration: "0.5s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Visible Handoff Envelope", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进这条 lane",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if requestCount != 2 {
		t.Fatalf("requestCount = %d, want 2 with auto followup", requestCount)
	}
	if payload.Output != "先复核恢复链路和副作用，再把结论回写到房间。" {
		t.Fatalf("payload output = %q, want visible followup output", payload.Output)
	}

	var handoff *store.AgentHandoff
	for index := range payload.State.Mailbox {
		item := &payload.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Kind == "room-auto" {
			handoff = item
			break
		}
	}
	if handoff == nil {
		t.Fatalf("mailbox missing inferred visible handoff: %#v", payload.State.Mailbox)
	}
	if handoff.ToAgentID != "agent-claude-review-runner" || handoff.Status != "acknowledged" {
		t.Fatalf("handoff = %#v, want acknowledged handoff to claude reviewer", handoff)
	}
	if strings.Contains(handoff.Summary, "@agent-claude-review-runner") || !strings.Contains(handoff.Summary, "恢复链路") {
		t.Fatalf("handoff = %#v, want cleaned summary inferred from visible body", handoff)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want owner switched to Claude Review Runner", room)
	}
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched to Claude Review Runner", run)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want owner switched to Claude Review Runner", issue)
	}
	lastRoomMessage := payload.State.RoomMessages[created.RoomID][len(payload.State.RoomMessages[created.RoomID])-1]
	if lastRoomMessage.Speaker != "Claude Review Runner" || !strings.Contains(lastRoomMessage.Message, "恢复链路") {
		t.Fatalf("last room message = %#v, want followup from Claude Review Runner", lastRoomMessage)
	}
	for _, message := range payload.State.RoomMessages[created.RoomID] {
		if strings.Contains(message.Message, "@agent-claude-review-runner 你继续把恢复链路和副作用复核完。") {
			t.Fatalf("room messages should not keep visible relay body: %#v", payload.State.RoomMessages[created.RoomID])
		}
	}
}

func TestRoomAutoHandoffFollowupSupportsClarificationRequest(t *testing.T) {
	root := t.TempDir()
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		if requestCount == 1 {
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先把这条链路收口。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核链路 | 请确认是否允许改 billing guard。",
				Duration: "0.6s",
			})
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "KIND: clarification_request\nBODY:\n请先确认是否允许我改 billing guard。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Auto Handoff Clarification", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if requestCount != 2 {
		t.Fatalf("requestCount = %d, want 2 with auto followup", requestCount)
	}
	roomMessages := payload.State.RoomMessages[created.RoomID]
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Speaker != "Claude Review Runner" || lastMessage.Tone != "blocked" || lastMessage.Message != "请先确认是否允许我改 billing guard。" {
		t.Fatalf("last room message = %#v, want blocked clarification from followup owner", lastMessage)
	}
	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Status != "paused" {
		t.Fatalf("room = %#v, want paused topic after followup clarification", room)
	}
	if run == nil || run.Status != "paused" {
		t.Fatalf("run = %#v, want paused run after followup clarification", run)
	}
	if issue == nil || issue.State != "paused" {
		t.Fatalf("issue = %#v, want paused issue after followup clarification", issue)
	}
}

func TestRoomAutoHandoffFollowupSupportsNoResponseEnvelope(t *testing.T) {
	root := t.TempDir()
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		if requestCount == 1 {
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "KIND: handoff\nBODY:\n@agent-claude-review-runner 你继续把恢复链路和副作用复核完。",
				Duration: "0.6s",
			})
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "SEND_PUBLIC_MESSAGE\nKIND: no_response\nBODY:",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Auto Handoff No Response", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进这条 lane",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if requestCount != 2 {
		t.Fatalf("requestCount = %d, want 2 with silent auto followup", requestCount)
	}
	if payload.Output != "@agent-claude-review-runner 你继续把恢复链路和副作用复核完。" {
		t.Fatalf("payload output = %q, want original visible handoff body", payload.Output)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want owner switched to Claude Review Runner", room)
	}
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want owner switched to Claude Review Runner", run)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want owner switched to Claude Review Runner", issue)
	}

	roomMessages := payload.State.RoomMessages[created.RoomID]
	for _, message := range roomMessages {
		if message.Speaker == "Claude Review Runner" {
			t.Fatalf("room messages = %#v, want no extra visible followup from claude", roomMessages)
		}
		if message.Speaker == "System" && strings.Contains(message.Message, "Claude Review Runner 已接棒") {
			t.Fatalf("room messages = %#v, want no redundant system takeover narration", roomMessages)
		}
		if strings.Contains(message.Message, "已接手") {
			t.Fatalf("room messages = %#v, want no filler takeover message", roomMessages)
		}
	}
}

func TestRoomAutoHandoffClarificationFollowupSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	var execRequests []ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		execRequests = append(execRequests, req)

		switch len(execRequests) {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先收一下当前范围。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核 rollout 范围 | 请先确认 rollout 范围。",
				Duration: "0.5s",
			})
		case 2:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "KIND: clarification_request\nBODY:\n请先确认 rollout 范围。",
				Duration: "0.4s",
			})
		case 3:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我收到 rollout 范围了，接着把复核结果补齐。",
				Duration: "0.4s",
			})
		default:
			t.Fatalf("unexpected exec request count: %d", len(execRequests))
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Restarted Clarification", "Codex Dockmaster")

	firstBody, err := json.Marshal(map[string]any{
		"prompt": "继续推进当前 rollout。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	firstResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(firstBody))
	if err != nil {
		t.Fatalf("POST first room message error = %v", err)
	}
	defer firstResp.Body.Close()

	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	var firstPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, firstResp, &firstPayload)
	server.Close()

	if len(execRequests) != 2 {
		t.Fatalf("exec requests = %#v, want handoff + clarification followup", execRequests)
	}
	if execRequests[0].Provider != "codex" || !strings.Contains(execRequests[1].Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("exec requests = %#v, want Claude clarification followup after handoff", execRequests)
	}
	if firstPayload.Output != "我先收一下当前范围。" {
		t.Fatalf("first payload output = %q, want original visible handoff reply", firstPayload.Output)
	}
	firstRoom := findRoomByID(firstPayload.State, created.RoomID)
	firstRun := findRunByID(firstPayload.State, created.RunID)
	var firstIssue *store.Issue
	if firstRoom != nil {
		firstIssue = findIssueByKey(firstPayload.State, firstRoom.IssueKey)
	}
	if firstRoom == nil || firstRoom.Topic.Owner != "Claude Review Runner" || firstRoom.Topic.Status != "paused" {
		t.Fatalf("first room = %#v, want paused Claude owner after handoff clarification", firstRoom)
	}
	if firstRun == nil || firstRun.Owner != "Claude Review Runner" || firstRun.Status != "paused" {
		t.Fatalf("first run = %#v, want paused Claude owner after handoff clarification", firstRun)
	}
	if firstIssue == nil || firstIssue.Owner != "Claude Review Runner" || firstIssue.State != "paused" {
		t.Fatalf("first issue = %#v, want paused Claude owner after handoff clarification", firstIssue)
	}
	firstMessages := firstPayload.State.RoomMessages[created.RoomID]
	firstLastMessage := firstMessages[len(firstMessages)-1]
	if firstLastMessage.Speaker != "Claude Review Runner" || firstLastMessage.Tone != "blocked" || firstLastMessage.Message != "请先确认 rollout 范围。" {
		t.Fatalf("first last room message = %#v, want Claude clarification after handoff", firstLastMessage)
	}
	foundClaudeWait := false
	for _, wait := range firstPayload.State.RoomAgentWaits {
		if wait.RoomID == created.RoomID && wait.AgentID == "agent-claude-review-runner" && wait.Status == "waiting_reply" {
			foundClaudeWait = true
			break
		}
	}
	if !foundClaudeWait {
		t.Fatalf("room waits = %#v, want Claude waiting_reply", firstPayload.State.RoomAgentWaits)
	}

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	secondBody, err := json.Marshal(map[string]any{
		"prompt": "rollout 只限当前 landing 页和详情页。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	secondResp, err := http.Post(reloadedServer.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(secondBody))
	if err != nil {
		t.Fatalf("POST second room message error = %v", err)
	}
	defer secondResp.Body.Close()

	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var secondPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &secondPayload)

	if len(execRequests) != 3 {
		t.Fatalf("exec requests after restart = %#v, want resumed clarification followup", execRequests)
	}
	if execRequests[2].Provider != "claude" {
		t.Fatalf("restart exec request = %#v, want claude provider", execRequests[2])
	}
	for _, expected := range []string{
		"本轮请以 Claude Review Runner 的身份回应",
		"你上一轮刚提出过阻塞性澄清",
	} {
		if !strings.Contains(execRequests[2].Prompt, expected) {
			t.Fatalf("restart exec prompt = %q, want %q", execRequests[2].Prompt, expected)
		}
	}
	if secondPayload.Output != "我收到 rollout 范围了，接着把复核结果补齐。" {
		t.Fatalf("second payload output = %q, want resumed Claude reply", secondPayload.Output)
	}
	secondMessages := secondPayload.State.RoomMessages[created.RoomID]
	secondLastMessage := secondMessages[len(secondMessages)-1]
	if secondLastMessage.Speaker != "Claude Review Runner" || secondLastMessage.Role != "agent" || secondLastMessage.Message != "我收到 rollout 范围了，接着把复核结果补齐。" {
		t.Fatalf("second last room message = %#v, want resumed Claude reply", secondLastMessage)
	}
	secondRoom := findRoomByID(secondPayload.State, created.RoomID)
	secondRun := findRunByID(secondPayload.State, created.RunID)
	var secondIssue *store.Issue
	if secondRoom != nil {
		secondIssue = findIssueByKey(secondPayload.State, secondRoom.IssueKey)
	}
	if secondRoom == nil || secondRoom.Topic.Owner != "Claude Review Runner" || secondRoom.Topic.Status != "running" {
		t.Fatalf("second room = %#v, want running Claude owner after restart followup", secondRoom)
	}
	if secondRun == nil || secondRun.Owner != "Claude Review Runner" || secondRun.Status != "running" {
		t.Fatalf("second run = %#v, want running Claude owner after restart followup", secondRun)
	}
	if secondIssue == nil || secondIssue.Owner != "Claude Review Runner" || secondIssue.State != "running" {
		t.Fatalf("second issue = %#v, want running Claude owner after restart followup", secondIssue)
	}
	for _, wait := range secondPayload.State.RoomAgentWaits {
		if wait.RoomID == created.RoomID && wait.AgentID == "agent-claude-review-runner" && wait.Status != "resolved" {
			t.Fatalf("room waits = %#v, want resolved Claude wait after restart followup", secondPayload.State.RoomAgentWaits)
		}
	}
}

func TestRoomAutoHandoffClarificationMemoryCenterPreviewPersistsAcrossRestart(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	var execRequests []ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		execRequests = append(execRequests, req)

		switch len(execRequests) {
		case 1:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "我先收一下当前范围。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核 rollout 范围 | 请先确认 rollout 范围。",
				Duration: "0.5s",
			})
		case 2:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "KIND: clarification_request\nBODY:\n请先确认 rollout 范围。",
				Duration: "0.4s",
			})
		case 3:
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "claude",
				Command:  []string{"claude", "--print"},
				Output:   "我收到 rollout 范围了，接着把复核结果补齐。",
				Duration: "0.4s",
			})
		default:
			t.Fatalf("unexpected exec request count: %d", len(execRequests))
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	updateResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/providers",
		`{"providers":[
			{"id":"workspace-file","kind":"workspace-file","label":"Workspace File Memory","enabled":true,"readScopes":["workspace","issue-room","room-notes","decision-ledger","agent","promoted-ledger"],"writeScopes":["workspace","issue-room","room-notes","decision-ledger","agent"],"recallPolicy":"governed-first","retentionPolicy":"保留版本、人工纠偏和提升 ledger。","sharingPolicy":"workspace-governed","summary":"Primary file-backed memory."},
			{"id":"search-sidecar","kind":"search-sidecar","label":"Search Sidecar","enabled":true,"readScopes":["workspace","issue-room","decision-ledger","promoted-ledger"],"writeScopes":[],"recallPolicy":"search-on-demand","retentionPolicy":"短期 query cache。","sharingPolicy":"workspace-query-only","summary":"Use local recall index before full scan."},
			{"id":"external-persistent","kind":"external-persistent","label":"External Persistent Memory","enabled":true,"readScopes":["workspace","agent","user"],"writeScopes":["agent","user"],"recallPolicy":"promote-approved-only","retentionPolicy":"长期保留审核通过的 durable memory。","sharingPolicy":"explicit-share-only","summary":"Forward approved memories to an external durable sink."}
		]}`,
	)
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Clarification Memory Preview Restart", "Codex Dockmaster")

	firstResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader([]byte(`{"prompt":"继续推进当前 rollout。"}`)))
	if err != nil {
		t.Fatalf("POST first room message error = %v", err)
	}
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}

	var firstPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, firstResp, &firstPayload)

	if len(execRequests) != 2 {
		t.Fatalf("exec requests = %#v, want handoff + clarification followup", execRequests)
	}
	firstRoom := findRoomByID(firstPayload.State, created.RoomID)
	firstRun := findRunByID(firstPayload.State, created.RunID)
	var firstIssue *store.Issue
	if firstRoom != nil {
		firstIssue = findIssueByKey(firstPayload.State, firstRoom.IssueKey)
	}
	if firstRoom == nil || firstRoom.Topic.Owner != "Claude Review Runner" || firstRoom.Topic.Status != "paused" {
		t.Fatalf("first room = %#v, want paused Claude owner after handoff clarification", firstRoom)
	}
	if firstRun == nil || firstRun.Owner != "Claude Review Runner" || firstRun.Status != "paused" {
		t.Fatalf("first run = %#v, want paused Claude owner after handoff clarification", firstRun)
	}
	if firstIssue == nil || firstIssue.Owner != "Claude Review Runner" || firstIssue.State != "paused" {
		t.Fatalf("first issue = %#v, want paused Claude owner after handoff clarification", firstIssue)
	}

	checkPreview := func(t *testing.T, serverURL string) {
		t.Helper()
		centerResp, err := http.Get(serverURL + "/v1/memory-center")
		if err != nil {
			t.Fatalf("GET /v1/memory-center error = %v", err)
		}
		defer centerResp.Body.Close()
		if centerResp.StatusCode != http.StatusOK {
			t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
		}

		var center store.MemoryCenter
		decodeJSON(t, centerResp, &center)
		preview := findPreviewBySession(center.Previews, created.SessionID)
		if preview == nil {
			t.Fatalf("preview missing for session %q: %#v", created.SessionID, center.Previews)
		}
		if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "degraded" {
			t.Fatalf("preview search provider = %#v, want degraded", got)
		}
		if got := findProviderByKind(preview.Providers, "external-persistent"); got == nil || got.Status != "degraded" {
			t.Fatalf("preview external provider = %#v, want degraded", got)
		}
		if !strings.Contains(preview.PromptSummary, "Claude Review Runner") {
			t.Fatalf("preview summary = %q, want current owner Claude Review Runner", preview.PromptSummary)
		}
		if !strings.Contains(preview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
			t.Fatalf("preview summary = %q, want Claude Review Runner prompt scaffold", preview.PromptSummary)
		}
		if !strings.Contains(preview.PromptSummary, "Search Sidecar") || !strings.Contains(preview.PromptSummary, "External Persistent Memory") {
			t.Fatalf("preview summary missing provider labels:\n%s", preview.PromptSummary)
		}
		if strings.Contains(preview.PromptSummary, "把 next-run injection、promotion 和 version audit 保持成可解释真值。") {
			t.Fatalf("preview summary = %q, should not drift to Memory Clerk", preview.PromptSummary)
		}
	}

	checkPreview(t, server.URL)
	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	checkPreview(t, reloadedServer.URL)

	secondResp, err := http.Post(reloadedServer.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader([]byte(`{"prompt":"rollout 只限当前 landing 页和详情页。"}`)))
	if err != nil {
		t.Fatalf("POST second room message error = %v", err)
	}
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}

	var secondPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, secondResp, &secondPayload)

	if len(execRequests) != 3 {
		t.Fatalf("exec requests after restart = %#v, want resumed clarification followup", execRequests)
	}
	if secondPayload.Output != "我收到 rollout 范围了，接着把复核结果补齐。" {
		t.Fatalf("second payload output = %q, want resumed Claude reply", secondPayload.Output)
	}
	secondRoom := findRoomByID(secondPayload.State, created.RoomID)
	secondRun := findRunByID(secondPayload.State, created.RunID)
	var secondIssue *store.Issue
	if secondRoom != nil {
		secondIssue = findIssueByKey(secondPayload.State, secondRoom.IssueKey)
	}
	if secondRoom == nil || secondRoom.Topic.Owner != "Claude Review Runner" || secondRoom.Topic.Status != "running" {
		t.Fatalf("second room = %#v, want running Claude owner after restart followup", secondRoom)
	}
	if secondRun == nil || secondRun.Owner != "Claude Review Runner" || secondRun.Status != "running" {
		t.Fatalf("second run = %#v, want running Claude owner after restart followup", secondRun)
	}
	if secondIssue == nil || secondIssue.Owner != "Claude Review Runner" || secondIssue.State != "running" {
		t.Fatalf("second issue = %#v, want running Claude owner after restart followup", secondIssue)
	}
	for _, wait := range secondPayload.State.RoomAgentWaits {
		if wait.RoomID == created.RoomID && wait.AgentID == "agent-claude-review-runner" && wait.Status != "resolved" {
			t.Fatalf("room waits = %#v, want resolved Claude wait after restart followup", secondPayload.State.RoomAgentWaits)
		}
	}

	checkPreview(t, reloadedServer.URL)
}

func TestRoomMessageStreamSequentialAutoHandoffsPersistCurrentOwnerAcrossRestart(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	var streamRequests []ExecRequest
	var execRequests []ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/exec/stream":
			var req ExecRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode stream payload: %v", err)
			}
			streamRequests = append(streamRequests, req)

			w.Header().Set("Content-Type", "application/x-ndjson")
			var events []DaemonStreamEvent
			switch len(streamRequests) {
			case 1:
				events = []DaemonStreamEvent{
					{Type: "start", Provider: "codex", Command: []string{"codex", "exec"}},
					{Type: "stdout", Provider: "codex", Delta: "我先把需求和主链收一下。\n"},
					{Type: "stdout", Provider: "codex", Delta: "OPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核交互与体验 | 请把交互细节和副作用复核完。"},
					{Type: "done", Provider: "codex", Output: "我先把需求和主链收一下。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核交互与体验 | 请把交互细节和副作用复核完。", Duration: "0.8s"},
				}
			case 2:
				events = []DaemonStreamEvent{
					{Type: "start", Provider: "claude", Command: []string{"claude", "--print"}},
					{Type: "stdout", Provider: "claude", Delta: "我先把交互复核收一下。\n"},
					{Type: "stdout", Provider: "claude", Delta: "OPENSHOCK_HANDOFF: agent-memory-clerk | 继续整理资料与记忆 | 请把影片资料、记忆要点和验收点整理完。"},
					{Type: "done", Provider: "claude", Output: "我先把交互复核收一下。\nOPENSHOCK_HANDOFF: agent-memory-clerk | 继续整理资料与记忆 | 请把影片资料、记忆要点和验收点整理完。", Duration: "0.9s"},
				}
			default:
				t.Fatalf("unexpected stream request count: %d", len(streamRequests))
			}
			for _, event := range events {
				if err := json.NewEncoder(w).Encode(event); err != nil {
					t.Fatalf("encode stream event: %v", err)
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
		case "/v1/exec":
			var req ExecRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode exec payload: %v", err)
			}
			execRequests = append(execRequests, req)

			switch len(execRequests) {
			case 1:
				writeJSON(w, http.StatusOK, DaemonExecResponse{
					Provider: "claude",
					Command:  []string{"claude", "--print"},
					Output:   "我来接住交互复核，先把界面和副作用过一遍，再回写结论。",
					Duration: "0.4s",
				})
			case 2:
				writeJSON(w, http.StatusOK, DaemonExecResponse{
					Provider: "codex",
					Command:  []string{"codex", "exec"},
					Output:   "我来收最后一棒，先把影片资料、记忆要点和验收点整理好。",
					Duration: "0.4s",
				})
			case 3:
				writeJSON(w, http.StatusOK, DaemonExecResponse{
					Provider: "codex",
					Command:  []string{"codex", "exec"},
					Output:   "我已经从上一轮状态继续上来了，接着把资料页的验收项补完。",
					Duration: "0.3s",
				})
			default:
				t.Fatalf("unexpected exec request count: %d", len(execRequests))
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Sequential Auto Handoff", "Codex Dockmaster")

	readStreamEvents := func(resp *http.Response) []DaemonStreamEvent {
		t.Helper()
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		var events []DaemonStreamEvent
		for scanner.Scan() {
			var event DaemonStreamEvent
			if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
				t.Fatalf("Unmarshal() error = %v", err)
			}
			events = append(events, event)
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("scanner.Err() = %v", err)
		}
		return events
	}

	firstBody, err := json.Marshal(map[string]any{
		"prompt": "继续推进电影网站这条主链。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	firstResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(firstBody))
	if err != nil {
		t.Fatalf("POST first stream error = %v", err)
	}
	if firstResp.StatusCode != http.StatusOK {
		t.Fatalf("first stream status = %d, want %d", firstResp.StatusCode, http.StatusOK)
	}
	firstEvents := readStreamEvents(firstResp)
	firstResp.Body.Close()

	if len(firstEvents) < 4 {
		t.Fatalf("first stream events = %#v, want streamed state", firstEvents)
	}
	if len(execRequests) != 1 {
		t.Fatalf("exec requests after first handoff = %#v, want 1 auto followup", execRequests)
	}
	if streamRequests[0].Provider != "codex" {
		t.Fatalf("first stream request = %#v, want codex owner turn", streamRequests[0])
	}
	if execRequests[0].Provider != "claude" || !strings.Contains(execRequests[0].Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("first auto followup = %#v, want Claude owner prompt", execRequests[0])
	}

	secondBody, err := json.Marshal(map[string]any{
		"prompt": "继续推进，把最后的资料和记忆也收平。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	secondResp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages/stream", "application/json", bytes.NewReader(secondBody))
	if err != nil {
		t.Fatalf("POST second stream error = %v", err)
	}
	if secondResp.StatusCode != http.StatusOK {
		t.Fatalf("second stream status = %d, want %d", secondResp.StatusCode, http.StatusOK)
	}
	secondEvents := readStreamEvents(secondResp)
	secondResp.Body.Close()
	server.Close()

	if len(secondEvents) < 4 {
		t.Fatalf("second stream events = %#v, want streamed state", secondEvents)
	}
	if len(streamRequests) != 2 || len(execRequests) != 2 {
		t.Fatalf("requests = stream %#v exec %#v, want 2 stream + 2 exec", streamRequests, execRequests)
	}
	if streamRequests[1].Provider != "claude" || !strings.Contains(streamRequests[1].Prompt, "本轮请以 Claude Review Runner 的身份回应") {
		t.Fatalf("second stream request = %#v, want Claude current owner prompt", streamRequests[1])
	}
	if execRequests[1].Provider != "codex" || !strings.Contains(execRequests[1].Prompt, "本轮请以 Memory Clerk 的身份回应") {
		t.Fatalf("second auto followup = %#v, want Memory Clerk current owner prompt", execRequests[1])
	}

	secondLast := secondEvents[len(secondEvents)-1]
	if secondLast.Type != "state" || secondLast.State == nil {
		t.Fatalf("second last event = %#v, want state payload", secondLast)
	}
	room := findRoomByID(*secondLast.State, created.RoomID)
	run := findRunByID(*secondLast.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(*secondLast.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Memory Clerk" {
		t.Fatalf("room = %#v, want Memory Clerk as current owner", room)
	}
	if run == nil || run.Owner != "Memory Clerk" {
		t.Fatalf("run = %#v, want Memory Clerk as current owner", run)
	}
	if issue == nil || issue.Owner != "Memory Clerk" {
		t.Fatalf("issue = %#v, want Memory Clerk as current owner", issue)
	}
	roomMessages := secondLast.State.RoomMessages[created.RoomID]
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Speaker != "Memory Clerk" || !strings.Contains(lastMessage.Message, "记忆要点") {
		t.Fatalf("last room message = %#v, want Memory Clerk auto followup", lastMessage)
	}
	if strings.Contains(secondLast.Output, "OPENSHOCK_HANDOFF:") {
		t.Fatalf("final output leaked handoff directive: %q", secondLast.Output)
	}

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()

	reloadedRoom := findRoomByID(reloadedStore.Snapshot(), created.RoomID)
	if reloadedRoom == nil || reloadedRoom.Topic.Owner != "Memory Clerk" {
		t.Fatalf("reloaded room = %#v, want persisted Memory Clerk owner", reloadedRoom)
	}

	restartBody, err := json.Marshal(map[string]any{
		"prompt": "继续把 landing 页的资料区验收掉。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	restartResp, err := http.Post(reloadedServer.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(restartBody))
	if err != nil {
		t.Fatalf("POST restart message error = %v", err)
	}
	defer restartResp.Body.Close()

	if restartResp.StatusCode != http.StatusOK {
		t.Fatalf("restart message status = %d, want %d", restartResp.StatusCode, http.StatusOK)
	}

	var restartPayload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, restartResp, &restartPayload)

	if len(execRequests) != 3 {
		t.Fatalf("exec requests after restart = %#v, want third persisted owner turn", execRequests)
	}
	if execRequests[2].Provider != "codex" || !strings.Contains(execRequests[2].Prompt, "本轮请以 Memory Clerk 的身份回应") {
		t.Fatalf("restart exec request = %#v, want Memory Clerk persisted owner prompt", execRequests[2])
	}
	if restartPayload.Output != "我已经从上一轮状态继续上来了，接着把资料页的验收项补完。" {
		t.Fatalf("restart payload output = %q, want persisted owner reply", restartPayload.Output)
	}
	restartMessages := restartPayload.State.RoomMessages[created.RoomID]
	restartLastMessage := restartMessages[len(restartMessages)-1]
	if restartLastMessage.Speaker != "Memory Clerk" {
		t.Fatalf("restart last room message = %#v, want Memory Clerk speaker", restartLastMessage)
	}
}

func TestRoomMessageRouteMentionedAgentRepliesWithOwnSpeakerAndProvider(t *testing.T) {
	root := t.TempDir()
	var seen ExecRequest

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
			t.Fatalf("decode exec payload: %v", err)
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "我先接住这条复核请求，先看恢复链路，再回写结论。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Mention Response", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt": "@agent-claude-review-runner 你来继续复核恢复链路。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if seen.Provider != "claude" {
		t.Fatalf("exec request = %#v, want mentioned agent provider claude", seen)
	}
	if !strings.Contains(seen.Prompt, "本轮响应：Claude Review Runner") {
		t.Fatalf("exec prompt = %q, want mentioned agent context", seen.Prompt)
	}
	if payload.Output != "我先接住这条复核请求，先看恢复链路，再回写结论。" {
		t.Fatalf("payload output = %q, want daemon reply", payload.Output)
	}

	roomMessages := payload.State.RoomMessages[created.RoomID]
	if len(roomMessages) < 2 {
		t.Fatalf("room messages = %#v, want human + agent reply", roomMessages)
	}
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Speaker != "Claude Review Runner" || lastMessage.Role != "agent" {
		t.Fatalf("last room message = %#v, want mentioned agent speaker", lastMessage)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Codex Dockmaster" {
		t.Fatalf("room = %#v, want owner unchanged without formal handoff", room)
	}
	if run == nil || run.Owner != "Codex Dockmaster" {
		t.Fatalf("run = %#v, want owner unchanged without formal handoff", run)
	}
	if issue == nil || issue.Owner != "Codex Dockmaster" {
		t.Fatalf("issue = %#v, want issue owner unchanged without formal handoff", issue)
	}
}

func TestRoomMessageRouteClaimTakeTransfersOwnershipToMentionedAgent(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "SEND_PUBLIC_MESSAGE\nKIND: message\nCLAIM: take\nBODY:\n我来接这条复核，先把恢复链路和副作用看完，再回写结论。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Mention Claim", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt": "@agent-claude-review-runner 你来继续复核恢复链路。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Output != "先把恢复链路和副作用看完，再回写结论。" {
		t.Fatalf("payload output = %q, want claimed reply body", payload.Output)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Claude Review Runner" {
		t.Fatalf("room = %#v, want owner claimed by Claude Review Runner", room)
	}
	if run == nil || run.Owner != "Claude Review Runner" {
		t.Fatalf("run = %#v, want run owner claimed by Claude Review Runner", run)
	}
	if issue == nil || issue.Owner != "Claude Review Runner" {
		t.Fatalf("issue = %#v, want issue owner claimed by Claude Review Runner", issue)
	}
	if run == nil || !strings.Contains(run.NextAction, "Claude Review Runner") {
		t.Fatalf("run = %#v, want next action centered on claimed owner", run)
	}
	if len(payload.State.Mailbox) != 0 {
		t.Fatalf("mailbox = %#v, want no formal handoff for claim-take reply", payload.State.Mailbox)
	}
}

func TestRoomMessageRouteSummaryClaimTakeDoesNotTransferOwnership(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "SEND_PUBLIC_MESSAGE\nKIND: summary\nCLAIM: take\nBODY:\n当前结论先收住，下一步我按这条恢复链路继续复核。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Summary Claim Guard", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt": "@agent-claude-review-runner 你先同步一下当前结论。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Output != "当前结论先收住，下一步我按这条恢复链路继续复核。" {
		t.Fatalf("payload output = %q, want summary body", payload.Output)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Codex Dockmaster" {
		t.Fatalf("room = %#v, want owner unchanged for summary claim", room)
	}
	if run == nil || run.Owner != "Codex Dockmaster" {
		t.Fatalf("run = %#v, want run owner unchanged for summary claim", run)
	}
	if issue == nil || issue.Owner != "Codex Dockmaster" {
		t.Fatalf("issue = %#v, want issue owner unchanged for summary claim", issue)
	}
	if len(payload.State.Mailbox) != 0 {
		t.Fatalf("mailbox = %#v, want no formal handoff for summary claim", payload.State.Mailbox)
	}
}

func TestRoomMessageRouteClarificationClaimTakeDoesNotTransferOwnership(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "SEND_PUBLIC_MESSAGE\nKIND: clarification_request\nCLAIM: take\nBODY:\n先确认一下，这条恢复链路现在允许我直接改 billing guard 吗？",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Clarification Claim Guard", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt": "@agent-claude-review-runner 你先看下还有什么阻塞。",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Output != "先确认一下，这条恢复链路现在允许我直接改 billing guard 吗？" {
		t.Fatalf("payload output = %q, want clarification body", payload.Output)
	}

	room := findRoomByID(payload.State, created.RoomID)
	run := findRunByID(payload.State, created.RunID)
	var issue *store.Issue
	if room != nil {
		issue = findIssueByKey(payload.State, room.IssueKey)
	}
	if room == nil || room.Topic.Owner != "Codex Dockmaster" {
		t.Fatalf("room = %#v, want owner unchanged for clarification claim", room)
	}
	if run == nil || run.Owner != "Codex Dockmaster" {
		t.Fatalf("run = %#v, want run owner unchanged for clarification claim", run)
	}
	if issue == nil || issue.Owner != "Codex Dockmaster" {
		t.Fatalf("issue = %#v, want issue owner unchanged for clarification claim", issue)
	}
	if len(payload.State.Mailbox) != 0 {
		t.Fatalf("mailbox = %#v, want no formal handoff for clarification claim", payload.State.Mailbox)
	}
}

func TestRoomMessageRouteHandoffEnvelopeSuppressesVisibleRelayAfterFollowup(t *testing.T) {
	root := t.TempDir()
	requestCount := 0

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		requestCount += 1
		if requestCount == 1 {
			writeJSON(w, http.StatusOK, DaemonExecResponse{
				Provider: "codex",
				Command:  []string{"codex", "exec"},
				Output:   "KIND: handoff\nBODY:\n@agent-claude-review-runner 你继续复核恢复链路。",
				Duration: "0.5s",
			})
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "我来接这条复核，先看恢复链路，再回写结论。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Handoff Relay Compression", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进这条 lane",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if requestCount != 2 {
		t.Fatalf("requestCount = %d, want 2 with auto followup", requestCount)
	}
	if payload.Output != "先看恢复链路，再回写结论。" {
		t.Fatalf("payload output = %q, want visible followup output", payload.Output)
	}

	roomMessages := payload.State.RoomMessages[created.RoomID]
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Speaker != "Claude Review Runner" || lastMessage.Message != "先看恢复链路，再回写结论。" {
		t.Fatalf("last room message = %#v, want followup from Claude Review Runner", lastMessage)
	}
	for _, message := range roomMessages {
		if strings.Contains(message.Message, "@agent-claude-review-runner 你继续复核恢复链路。") {
			t.Fatalf("room messages should not keep visible relay body: %#v", roomMessages)
		}
	}

	var handoff *store.AgentHandoff
	for index := range payload.State.Mailbox {
		item := &payload.State.Mailbox[index]
		if item.RoomID == created.RoomID && item.Kind == "room-auto" {
			handoff = item
			break
		}
	}
	if handoff == nil || handoff.ToAgentID != "agent-claude-review-runner" || handoff.Status != "acknowledged" {
		t.Fatalf("handoff = %#v, want acknowledged handoff to claude reviewer", handoff)
	}
}

func TestRoomMessageRouteSupportsSummaryEnvelope(t *testing.T) {
	root := t.TempDir()

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "codex",
			Command:  []string{"codex", "exec"},
			Output:   "KIND: summary\nBODY:\n当前链路已收平，下一步转入验证。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	s, server := newContractTestServer(t, root, daemon.URL)
	defer server.Close()

	created, _ := createLeaseTestIssue(t, s, root, daemon.URL, "Summary Envelope", "Codex Dockmaster")

	body, err := json.Marshal(map[string]any{
		"prompt":   "现在进展怎样？",
		"provider": "codex",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/rooms/"+created.RoomID+"/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST room message error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	decodeJSON(t, resp, &payload)

	if payload.Output != "当前链路已收平，下一步转入验证。" {
		t.Fatalf("payload output = %q, want summary body", payload.Output)
	}
	roomMessages := payload.State.RoomMessages[created.RoomID]
	if len(roomMessages) < 2 {
		t.Fatalf("room messages = %#v, want human + summary reply", roomMessages)
	}
	lastMessage := roomMessages[len(roomMessages)-1]
	if lastMessage.Role != "agent" || lastMessage.Tone != "paper" || lastMessage.Message != "当前链路已收平，下一步转入验证。" {
		t.Fatalf("last room message = %#v, want paper-tone summary reply", lastMessage)
	}
	run := findRunByID(payload.State, created.RunID)
	if run == nil || run.Summary != "当前链路已收平，下一步转入验证。" || !strings.Contains(run.NextAction, "按当前同步继续推进") {
		t.Fatalf("run = %#v, want summary state writeback", run)
	}
}

func TestChannelMessagePersistsAgentReply(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		if req.Provider != "claude" {
			t.Fatalf("provider = %q, want claude", req.Provider)
		}
		if err := json.NewEncoder(w).Encode(DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--bare"},
			Output:   "我在线，频道可以直接回复了。",
			Duration: "0.8s",
		}); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}))
	defer daemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   daemon.URL,
		Machine:     "shock-main",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "你是谁？",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/channels/all/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/channels/all/messages error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.Output != "我在线，频道可以直接回复了。" {
		t.Fatalf("output = %q, want daemon reply", payload.Output)
	}

	messages := payload.State.ChannelMessages["all"]
	if len(messages) < 2 {
		t.Fatalf("channel messages = %#v, want appended human+agent reply", messages)
	}
	last := messages[len(messages)-1]
	if last.Role != "agent" || last.Speaker != "Claude Review Runner" {
		t.Fatalf("last channel message = %#v, want Claude agent reply", last)
	}
	if !strings.Contains(last.Message, "频道可以直接回复了") {
		t.Fatalf("last message = %q, want daemon output", last.Message)
	}
}

func TestChannelMessageDefaultsToPreferredProviderAndTimeout(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		var req ExecRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		if req.Provider != "codex" {
			t.Fatalf("provider = %q, want codex", req.Provider)
		}
		if req.TimeoutSeconds != channelMessageExecTimeoutSeconds {
			t.Fatalf("timeoutSeconds = %d, want %d", req.TimeoutSeconds, channelMessageExecTimeoutSeconds)
		}
		if err := json.NewEncoder(w).Encode(DaemonExecResponse{
			Provider: "codex",
			Command:  []string{"codex", "exec"},
			Output:   "默认已经切到 Codex 了。",
			Duration: "0.6s",
		}); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt": "给我一句确认",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/channels/all/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/channels/all/messages error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		State store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}

	messages := payload.State.ChannelMessages["all"]
	last := messages[len(messages)-1]
	if last.Speaker != "Codex Dockmaster" {
		t.Fatalf("last channel speaker = %q, want Codex Dockmaster", last.Speaker)
	}
}

func TestChannelMessageStripsInternalProtocolAndToolLeak(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "SEND_PUBLIC_MESSAGE\nKIND: message\nBODY:\n工具调用：\ngit status\n结果：\n当前工作区干净，我继续推进。\nOPENSHOCK_HANDOFF: agent-claude-review-runner | 继续复核 | 请补最后确认。",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:     "shock-main",
		DaemonURL:     daemon.URL,
		Machine:       "shock-main",
		DetectedCLI:   []string{"claude"},
		Providers:     []store.RuntimeProvider{{ID: "claude", Label: "Claude Code CLI"}},
		State:         "online",
		WorkspaceRoot: root,
		ReportedAt:    reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "继续推进",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/channels/all/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/channels/all/messages error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.Output != "当前工作区干净，我继续推进。" {
		t.Fatalf("output = %q, want sanitized public sentence", payload.Output)
	}

	last := payload.State.ChannelMessages["all"][len(payload.State.ChannelMessages["all"])-1]
	if last.Message != "当前工作区干净，我继续推进。" {
		t.Fatalf("last channel message = %#v, want sanitized visible reply", last)
	}
}

func TestChannelMessageNoResponseSuppressesVisibleReply(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	reportedAt := time.Now().UTC().Format(time.RFC3339)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/exec" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, DaemonExecResponse{
			Provider: "claude",
			Command:  []string{"claude", "--print"},
			Output:   "SEND_PUBLIC_MESSAGE\nKIND: no_response\nBODY:",
			Duration: "0.4s",
		})
	}))
	defer daemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:     "shock-main",
		DaemonURL:     daemon.URL,
		Machine:       "shock-main",
		DetectedCLI:   []string{"claude"},
		Providers:     []store.RuntimeProvider{{ID: "claude", Label: "Claude Code CLI"}},
		State:         "online",
		WorkspaceRoot: root,
		ReportedAt:    reportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     daemon.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"prompt":   "收到就继续做",
		"provider": "claude",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/channels/all/messages", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /v1/channels/all/messages error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Output string      `json:"output"`
		State  store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.Output != "" {
		t.Fatalf("output = %q, want empty no_response output", payload.Output)
	}
	if got := len(payload.State.ChannelMessages["all"]); got != 1 {
		t.Fatalf("channel messages = %#v, want only human message after no_response", payload.State.ChannelMessages["all"])
	}
}

func TestRuntimePairingPersistsWorkspaceBinding(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	reportedAt := time.Now().UTC().Format(time.RFC3339)

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime":
			payload := map[string]any{
				"machine":       "shock-browser",
				"detectedCli":   []string{"codex", "claude"},
				"providers":     []map[string]any{{"id": "claude", "label": "Claude Code CLI", "mode": "direct-cli", "capabilities": []string{"conversation"}, "transport": "http bridge"}},
				"state":         "online",
				"workspaceRoot": root,
				"reportedAt":    reportedAt,
			}
			if err := json.NewEncoder(w).Encode(payload); err != nil {
				t.Fatalf("encode runtime payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"daemonUrl": daemon.URL})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST pairing error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pairing status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	snapshot := s.Snapshot().Workspace
	if snapshot.PairedRuntime != "shock-browser" {
		t.Fatalf("paired runtime = %q, want shock-browser", snapshot.PairedRuntime)
	}
	if snapshot.PairedRuntimeURL != daemon.URL {
		t.Fatalf("paired runtime url = %q, want %q", snapshot.PairedRuntimeURL, daemon.URL)
	}
	if snapshot.PairingStatus != "paired" {
		t.Fatalf("pairing status = %q, want paired", snapshot.PairingStatus)
	}
	if snapshot.DeviceAuth != "browser-approved" {
		t.Fatalf("device auth = %q, want browser-approved", snapshot.DeviceAuth)
	}

	restarted := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer restarted.Close()

	runtimeResp, err := http.Get(restarted.URL + "/v1/runtime")
	if err != nil {
		t.Fatalf("GET restarted runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("restarted runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/v1/runtime/pairing", nil)
	if err != nil {
		t.Fatalf("NewRequest(DELETE) error = %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("DELETE pairing error = %v", err)
	}
	defer deleteResp.Body.Close()
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("delete pairing status = %d, want %d", deleteResp.StatusCode, http.StatusOK)
	}

	workspaceAfterDelete := s.Snapshot().Workspace
	if workspaceAfterDelete.PairingStatus != "unpaired" {
		t.Fatalf("pairing status after delete = %q, want unpaired", workspaceAfterDelete.PairingStatus)
	}
	if workspaceAfterDelete.DeviceAuth != "revoked" {
		t.Fatalf("device auth after delete = %q, want revoked", workspaceAfterDelete.DeviceAuth)
	}

	restartedAfterDelete := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer restartedAfterDelete.Close()
	offlineResp, err := http.Get(restartedAfterDelete.URL + "/v1/runtime")
	if err != nil {
		t.Fatalf("GET runtime after delete error = %v", err)
	}
	defer offlineResp.Body.Close()
	var offlinePayload RuntimeSnapshotResponse
	if err := json.NewDecoder(offlineResp.Body).Decode(&offlinePayload); err != nil {
		t.Fatalf("Decode offline runtime payload error = %v", err)
	}
	if offlinePayload.State != "offline" {
		t.Fatalf("offline runtime state = %q, want offline", offlinePayload.State)
	}
}

func TestRuntimeRegistryTracksHeartbeatsAndPairingSelection(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	var mainDaemonURL string
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-main",
			DaemonURL:          mainDaemonURL,
			Machine:            "shock-main",
			DetectedCLI:        []string{"codex"},
			Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer mainDaemon.Close()
	mainDaemonURL = mainDaemon.URL

	var sidecarDaemonURL string
	sidecarDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-sidecar",
			DaemonURL:          sidecarDaemonURL,
			Machine:            "shock-sidecar",
			DetectedCLI:        []string{"claude"},
			Providers:          []store.RuntimeProvider{{ID: "claude", Label: "Claude Code CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer sidecarDaemon.Close()
	sidecarDaemonURL = sidecarDaemon.URL

	mainPayload := RuntimeSnapshotResponse{
		RuntimeID:          "shock-main",
		DaemonURL:          mainDaemonURL,
		Machine:            "shock-main",
		DetectedCLI:        []string{"codex"},
		Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
		State:              "online",
		WorkspaceRoot:      root,
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}
	sidecarPayload := RuntimeSnapshotResponse{
		RuntimeID:          "shock-sidecar",
		DaemonURL:          sidecarDaemonURL,
		Machine:            "shock-sidecar",
		DetectedCLI:        []string{"claude"},
		Providers:          []store.RuntimeProvider{{ID: "claude", Label: "Claude Code CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
		State:              "online",
		WorkspaceRoot:      root,
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     mainDaemonURL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	for _, payload := range []RuntimeSnapshotResponse{mainPayload, sidecarPayload} {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("Marshal heartbeat payload error = %v", err)
		}
		resp, err := http.Post(server.URL+"/v1/runtime/heartbeats", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("POST heartbeat error = %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("heartbeat status = %d, want %d", resp.StatusCode, http.StatusOK)
		}
	}

	pairBody, err := json.Marshal(map[string]any{"runtimeId": "shock-sidecar"})
	if err != nil {
		t.Fatalf("Marshal pairing body error = %v", err)
	}
	pairResp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(pairBody))
	if err != nil {
		t.Fatalf("POST runtime pairing error = %v", err)
	}
	defer pairResp.Body.Close()
	if pairResp.StatusCode != http.StatusOK {
		t.Fatalf("pairing status = %d, want %d", pairResp.StatusCode, http.StatusOK)
	}

	registryResp, err := http.Get(server.URL + "/v1/runtime/registry")
	if err != nil {
		t.Fatalf("GET runtime registry error = %v", err)
	}
	defer registryResp.Body.Close()
	if registryResp.StatusCode != http.StatusOK {
		t.Fatalf("registry status = %d, want %d", registryResp.StatusCode, http.StatusOK)
	}

	var registryPayload struct {
		PairedRuntime string                `json:"pairedRuntime"`
		PairingStatus string                `json:"pairingStatus"`
		Runtimes      []store.RuntimeRecord `json:"runtimes"`
	}
	if err := json.NewDecoder(registryResp.Body).Decode(&registryPayload); err != nil {
		t.Fatalf("Decode runtime registry error = %v", err)
	}
	if registryPayload.PairedRuntime != "shock-sidecar" {
		t.Fatalf("paired runtime = %q, want shock-sidecar", registryPayload.PairedRuntime)
	}
	if registryPayload.PairingStatus != "paired" {
		t.Fatalf("pairing status = %q, want paired", registryPayload.PairingStatus)
	}
	if len(registryPayload.Runtimes) < 2 {
		t.Fatalf("runtime registry = %#v, want at least two runtimes", registryPayload.Runtimes)
	}

	var sidecar *store.RuntimeRecord
	var main *store.RuntimeRecord
	for index := range registryPayload.Runtimes {
		switch registryPayload.Runtimes[index].ID {
		case "shock-sidecar":
			sidecar = &registryPayload.Runtimes[index]
		case "shock-main":
			main = &registryPayload.Runtimes[index]
		}
	}
	if sidecar == nil || sidecar.PairingState != "paired" || sidecar.DaemonURL != sidecarDaemonURL {
		t.Fatalf("sidecar runtime = %#v, want paired runtime record", sidecar)
	}
	if main == nil || main.PairingState != "available" {
		t.Fatalf("main runtime = %#v, want available runtime record", main)
	}
}

func TestRuntimePairingRejectsExplicitRuntimeWithoutDaemonURL(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	var mainDaemonURL string
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-main",
			DaemonURL:          mainDaemonURL,
			Machine:            "shock-main",
			DetectedCLI:        []string{"codex"},
			Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer mainDaemon.Close()
	mainDaemonURL = mainDaemon.URL

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:   "shock-main",
		DaemonURL:   mainDaemonURL,
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing() error = %v", err)
	}

	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-sidecar",
		Machine:            "shock-sidecar",
		State:              "online",
		ReportedAt:         time.Now().UTC().Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     mainDaemonURL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"runtimeId": "shock-sidecar"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime pairing error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("pairing status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode error payload error = %v", err)
	}
	if payload["error"] != "runtime shock-sidecar is not paired to a daemon" {
		t.Fatalf("error payload = %#v, want explicit daemon contract", payload)
	}

	snapshot := s.Snapshot()
	if snapshot.Workspace.PairedRuntime != "shock-main" || snapshot.Workspace.PairedRuntimeURL != mainDaemonURL {
		t.Fatalf("workspace pairing = %#v, want existing main pairing untouched", snapshot.Workspace)
	}

	var sidecar *store.RuntimeRecord
	for index := range snapshot.Runtimes {
		if snapshot.Runtimes[index].ID == "shock-sidecar" {
			sidecar = &snapshot.Runtimes[index]
			break
		}
	}
	if sidecar == nil || sidecar.Machine != "shock-sidecar" || sidecar.DaemonURL != "" {
		t.Fatalf("sidecar runtime = %#v, want registry untouched", sidecar)
	}
}

func TestRuntimePairingRejectsExplicitRuntimeIdentityMismatch(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.ClearRuntimePairing(); err != nil {
		t.Fatalf("ClearRuntimePairing() error = %v", err)
	}

	var mainDaemonURL string
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runtime" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(RuntimeSnapshotResponse{
			RuntimeID:          "shock-main",
			DaemonURL:          mainDaemonURL,
			Machine:            "shock-main",
			DetectedCLI:        []string{"codex"},
			Providers:          []store.RuntimeProvider{{ID: "codex", Label: "Codex CLI", Mode: "direct-cli", Capabilities: []string{"conversation"}, Transport: "http bridge"}},
			State:              "online",
			WorkspaceRoot:      root,
			ReportedAt:         time.Now().UTC().Format(time.RFC3339),
			HeartbeatIntervalS: 10,
			HeartbeatTimeoutS:  45,
		})
	}))
	defer mainDaemon.Close()
	mainDaemonURL = mainDaemon.URL

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     mainDaemonURL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"runtimeId": "shock-sidecar",
		"daemonUrl": mainDaemonURL,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/pairing", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime pairing error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("pairing status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode error payload error = %v", err)
	}
	if payload["error"] != "runtime shock-sidecar resolved to shock-main" {
		t.Fatalf("error payload = %#v, want explicit identity mismatch", payload)
	}

	snapshot := s.Snapshot()
	if snapshot.Workspace.PairedRuntime != "" || snapshot.Workspace.PairedRuntimeURL != "" {
		t.Fatalf("workspace pairing = %#v, want pairing to remain empty", snapshot.Workspace)
	}
}

func TestRuntimeSelectionExposesMultiRuntimeSurfaceAndDispatchesByRun(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	now := time.Now().UTC()
	mainReportedAt := now.Format(time.RFC3339)
	sidecarReportedAt := now.Add(time.Second).Format(time.RFC3339)

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	mainWorktreeHits := 0
	mainDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime":
			if err := json.NewEncoder(w).Encode(map[string]any{
				"machine":       "shock-main",
				"detectedCli":   []string{"codex"},
				"providers":     []map[string]any{{"id": "codex", "label": "Codex CLI", "mode": "direct-cli", "capabilities": []string{"conversation", "patch"}, "transport": "http bridge"}},
				"state":         "online",
				"workspaceRoot": root,
				"reportedAt":    mainReportedAt,
			}); err != nil {
				t.Fatalf("encode main runtime payload: %v", err)
			}
		case "/v1/worktrees/ensure":
			mainWorktreeHits++
			var req WorktreeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode main worktree request: %v", err)
			}
			if err := json.NewEncoder(w).Encode(WorktreeResponse{
				WorkspaceRoot: req.WorkspaceRoot,
				Branch:        req.Branch,
				WorktreeName:  req.WorktreeName,
				Path:          filepath.Join(root, ".openshock-worktrees", "main", req.WorktreeName),
				Created:       true,
				BaseRef:       req.BaseRef,
			}); err != nil {
				t.Fatalf("encode main worktree payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer mainDaemon.Close()

	sidecarWorktreeHits := 0
	sidecarDaemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runtime":
			if err := json.NewEncoder(w).Encode(map[string]any{
				"machine":       "shock-sidecar",
				"detectedCli":   []string{"claude"},
				"providers":     []map[string]any{{"id": "claude", "label": "Claude Code CLI", "mode": "direct-cli", "capabilities": []string{"conversation"}, "transport": "http bridge"}},
				"state":         "online",
				"workspaceRoot": root,
				"reportedAt":    sidecarReportedAt,
			}); err != nil {
				t.Fatalf("encode sidecar runtime payload: %v", err)
			}
		case "/v1/worktrees/ensure":
			sidecarWorktreeHits++
			var req WorktreeRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode sidecar worktree request: %v", err)
			}
			if err := json.NewEncoder(w).Encode(WorktreeResponse{
				WorkspaceRoot: req.WorkspaceRoot,
				Branch:        req.Branch,
				WorktreeName:  req.WorktreeName,
				Path:          filepath.Join(root, ".openshock-worktrees", "sidecar", req.WorktreeName),
				Created:       true,
				BaseRef:       req.BaseRef,
			}); err != nil {
				t.Fatalf("encode sidecar worktree payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer sidecarDaemon.Close()

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   mainDaemon.URL,
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  mainReportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   sidecarDaemon.URL,
		Machine:     "shock-sidecar",
		DetectedCLI: []string{"claude"},
		State:       "online",
		ReportedAt:  sidecarReportedAt,
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(sidecar) error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	selectBody, err := json.Marshal(map[string]any{"machine": "shock-main"})
	if err != nil {
		t.Fatalf("Marshal() selection error = %v", err)
	}
	selectResp, err := http.Post(server.URL+"/v1/runtime/selection", "application/json", bytes.NewReader(selectBody))
	if err != nil {
		t.Fatalf("POST runtime selection error = %v", err)
	}
	defer selectResp.Body.Close()
	if selectResp.StatusCode != http.StatusOK {
		t.Fatalf("runtime selection status = %d, want %d", selectResp.StatusCode, http.StatusOK)
	}

	var selectionPayload struct {
		Selection RuntimeSelectionResponse `json:"selection"`
		State     store.State              `json:"state"`
	}
	if err := json.NewDecoder(selectResp.Body).Decode(&selectionPayload); err != nil {
		t.Fatalf("decode selection payload: %v", err)
	}
	if selectionPayload.Selection.SelectedRuntime != "shock-main" {
		t.Fatalf("selected runtime = %q, want shock-main", selectionPayload.Selection.SelectedRuntime)
	}
	if len(selectionPayload.Selection.Runtimes) < 2 {
		t.Fatalf("selection runtimes = %#v, want at least 2", selectionPayload.Selection.Runtimes)
	}

	runtimeResp, err := http.Get(server.URL + "/v1/runtime?machine=shock-sidecar")
	if err != nil {
		t.Fatalf("GET sidecar runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("sidecar runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}

	var runtimePayload RuntimeSnapshotResponse
	if err := json.NewDecoder(runtimeResp.Body).Decode(&runtimePayload); err != nil {
		t.Fatalf("decode sidecar runtime payload: %v", err)
	}
	if runtimePayload.Machine != "shock-sidecar" {
		t.Fatalf("runtime payload machine = %q, want shock-sidecar", runtimePayload.Machine)
	}

	issueBody, err := json.Marshal(map[string]any{
		"title":    "Dispatch To Preferred Runtime",
		"summary":  "verify run dispatch uses runtime preference",
		"owner":    "Claude Review Runner",
		"priority": "high",
	})
	if err != nil {
		t.Fatalf("Marshal() issue error = %v", err)
	}
	issueResp, err := http.Post(server.URL+"/v1/issues", "application/json", bytes.NewReader(issueBody))
	if err != nil {
		t.Fatalf("POST issue error = %v", err)
	}
	defer issueResp.Body.Close()
	if issueResp.StatusCode != http.StatusCreated {
		t.Fatalf("issue status = %d, want %d", issueResp.StatusCode, http.StatusCreated)
	}

	var issuePayload struct {
		RunID string      `json:"runId"`
		State store.State `json:"state"`
	}
	if err := json.NewDecoder(issueResp.Body).Decode(&issuePayload); err != nil {
		t.Fatalf("decode issue payload: %v", err)
	}

	run := findRunSnapshotByID(issuePayload.State, issuePayload.RunID)
	if run == nil {
		t.Fatalf("run %q missing from issue payload", issuePayload.RunID)
	}
	if run.Runtime != "shock-sidecar" || run.Machine != "shock-sidecar" {
		t.Fatalf("run scheduling = runtime %q machine %q, want shock-sidecar", run.Runtime, run.Machine)
	}
	if run.Provider != "Claude Code CLI" {
		t.Fatalf("run provider = %q, want Claude Code CLI", run.Provider)
	}
	if sidecarWorktreeHits != 1 || mainWorktreeHits != 0 {
		t.Fatalf("worktree routing hits = main %d sidecar %d, want main 0 sidecar 1", mainWorktreeHits, sidecarWorktreeHits)
	}
}

func TestRuntimeSelectionRejectsOfflineRuntime(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		DaemonURL:   "http://127.0.0.1:8090",
		Machine:     "shock-main",
		DetectedCLI: []string{"codex"},
		State:       "online",
		ReportedAt:  time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
		RuntimeID:          "shock-sidecar",
		DaemonURL:          "http://127.0.0.1:8091",
		Machine:            "shock-sidecar",
		DetectedCLI:        []string{"claude"},
		State:              "offline",
		ReportedAt:         time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		HeartbeatIntervalS: 10,
		HeartbeatTimeoutS:  45,
	}); err != nil {
		t.Fatalf("UpsertRuntimeHeartbeat(sidecar) error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{"machine": "shock-sidecar"})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/runtime/selection", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST runtime selection error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("selection status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error     string                   `json:"error"`
		Selection RuntimeSelectionResponse `json:"selection"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode selection error payload: %v", err)
	}
	if !strings.Contains(payload.Error, "offline") {
		t.Fatalf("selection error = %q, want offline wording", payload.Error)
	}
	if payload.Selection.SelectedRuntime != "shock-main" {
		t.Fatalf("selected runtime after failed switch = %q, want shock-main", payload.Selection.SelectedRuntime)
	}
}

func TestCreateIssueRejectsWhenAllRuntimesOffline(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	now := time.Now().UTC()
	if _, err := s.UpdateRuntimePairing(store.RuntimePairingInput{
		RuntimeID:  "shock-main",
		DaemonURL:  "http://127.0.0.1:8090",
		Machine:    "shock-main",
		State:      "online",
		ReportedAt: now.Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("UpdateRuntimePairing(main) error = %v", err)
	}
	if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
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
		daemonURL := "http://127.0.0.1:8090"
		if runtimeID == "shock-sidecar" {
			daemonURL = "http://127.0.0.1:8091"
		}
		if _, err := s.UpsertRuntimeHeartbeat(store.RuntimeHeartbeatInput{
			RuntimeID:          runtimeID,
			DaemonURL:          daemonURL,
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
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(map[string]any{
		"title":    "all offline runtime probe",
		"summary":  "reject create scheduling when all runtimes offline",
		"owner":    "Claude Review Runner",
		"priority": "high",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	resp, err := http.Post(server.URL+"/v1/issues", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST issue error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("issue status = %d, want %d", resp.StatusCode, http.StatusConflict)
	}

	var payload struct {
		Error string      `json:"error"`
		State store.State `json:"state"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode issue error payload: %v", err)
	}
	if payload.Error != store.ErrNoSchedulableRuntime.Error() {
		t.Fatalf("issue error = %q, want %q", payload.Error, store.ErrNoSchedulableRuntime.Error())
	}
	if payload.State.Workspace.PairingStatus != "degraded" {
		t.Fatalf("pairing status = %q, want degraded", payload.State.Workspace.PairingStatus)
	}
	if len(payload.State.Issues) != len(before.Issues) || len(payload.State.Runs) != len(before.Runs) || len(payload.State.Sessions) != len(before.Sessions) {
		t.Fatalf("issue create mutated payload state on failure: before issues/runs/sessions = %d/%d/%d after = %d/%d/%d", len(before.Issues), len(before.Runs), len(before.Sessions), len(payload.State.Issues), len(payload.State.Runs), len(payload.State.Sessions))
	}
	for _, machine := range payload.State.Machines {
		if machine.Name == "shock-main" || machine.Name == "shock-sidecar" {
			if machine.State != "offline" {
				t.Fatalf("machine %s state = %q, want offline", machine.Name, machine.State)
			}
		}
	}
}

func findRunSnapshotByID(state store.State, runID string) *store.Run {
	for index := range state.Runs {
		if state.Runs[index].ID == runID {
			return &state.Runs[index]
		}
	}
	return nil
}
