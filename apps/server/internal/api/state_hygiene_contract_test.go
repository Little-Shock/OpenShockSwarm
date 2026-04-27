package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestStateEndpointSanitizesCustomerVisibleResidue(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	fixture := store.State{
		Workspace: store.WorkspaceSnapshot{
			Name:          "OpenShock 作战台",
			Repo:          "Larkspur-Wang/OpenShock",
			RepoURL:       "https://github.com/Larkspur-Wang/OpenShock",
			Branch:        "feat/e2e-status-sync-20260405",
			Plan:          "Builder P0",
			PairedRuntime: "shock-main",
			Onboarding: store.WorkspaceOnboardingSnapshot{
				Status:      "ready",
				CurrentStep: "placeholder 注释窗口",
				ResumeURL:   "/setup?resume=e2e-status-sync-20260405",
			},
		},
		ChannelMessages: map[string][]store.Message{
			"announcements": {
				{
					ID:      "ann-live-detail",
					Speaker: "System",
					Role:    "system",
					Tone:    "system",
					Message: "OPS-29 已自动升级成新的讨论间：?? live detail ?? 讨论间。",
					Time:    "21:42",
				},
				{
					ID:      "ann-e2e",
					Speaker: "System",
					Role:    "system",
					Tone:    "system",
					Message: "OPS-30 已自动升级成新的讨论间：E2E ???? 20260405 讨论间。",
					Time:    "22:55",
				},
			},
			"all": {{
				ID:      "all-garbled",
				Speaker: "Lead_Architect",
				Role:    "human",
				Tone:    "human",
				Message: "???????? smoke ??????",
				Time:    "22:26",
			}},
		},
		Issues: []store.Issue{
			{
				ID:      "issue-live-detail",
				Key:     "OPS-29",
				Title:   "?? live detail ??",
				Summary: "?? Issue ? Run ????????????",
			},
			{
				ID:      "issue-e2e",
				Key:     "OPS-30",
				Title:   "E2E ???? 20260405",
				Summary: "??????????:Issue?Room?Run?PR?Inbox?Memory?",
			},
		},
		Rooms: []store.Room{
			{
				ID:       "room-live-detail",
				IssueKey: "OPS-29",
				Title:    "?? live detail ?? 讨论间",
				Summary:  "?? Issue ? Run ????????????",
				Topic: store.Topic{
					ID:      "topic-live-detail",
					Title:   "?? live detail ??",
					Summary: "placeholder 注释窗口",
				},
			},
			{
				ID:       "room-e2e",
				IssueKey: "OPS-30",
				Title:    "E2E ???? 20260405 讨论间",
				Summary:  "??????????:Issue?Room?Run?PR?Inbox?Memory?",
				Topic: store.Topic{
					ID:      "topic-e2e",
					Title:   "E2E ???? 20260405",
					Summary: "placeholder 注释窗口",
				},
			},
		},
		RoomMessages: map[string][]store.Message{
			"room-e2e": {
				{
					ID:      "room-e2e-system",
					Speaker: "System",
					Role:    "system",
					Tone:    "blocked",
					Message: "runtime lease conflict: E:\\00.Lark_Projects\\00_OpenShock is already held by session-runtime",
					Time:    "22:11",
				},
				{
					ID:      "room-e2e-human",
					Speaker: "Lead_Architect",
					Role:    "human",
					Tone:    "human",
					Message: "???:???",
					Time:    "23:01",
				},
				{
					ID:      "room-e2e-agent",
					Speaker: "Shock_AI_Core",
					Role:    "agent",
					Tone:    "agent",
					Message: "我在 `E:\\00.Lark_Projects\\00_OpenShock` 项目中，可以帮您查看项目状态。",
					Time:    "23:01",
				},
			},
		},
		DirectMessages: []store.DirectMessage{{
			ID:          "dm-e2e",
			Name:        "@E2E Follow-up 20260405",
			Summary:     "placeholder 注释窗口",
			Purpose:     "test-only dm purpose",
			Presence:    "running",
			Counterpart: "E2E Follow-up 20260405",
			MessageIDs:  []string{"dm-e2e-1"},
		}},
		DirectMessageMessages: map[string][]store.Message{
			"dm-e2e": {{
				ID:      "dm-e2e-1",
				Speaker: "E2E Bot 20260405",
				Role:    "agent",
				Tone:    "agent",
				Message: "CLI 连接失败：Post \"/tmp/openshock-e2e-20260405\"",
				Time:    "11:24",
			}},
		},
		FollowedThreads: []store.MessageSurfaceEntry{{
			ID:           "followed-e2e-thread",
			ChannelID:    "dm-e2e",
			MessageID:    "dm-e2e-1",
			ChannelLabel: "@E2E Follow-up 20260405",
			Title:        "E2E Status Sync 20260405 thread",
			Summary:      "placeholder 注释窗口",
			Note:         "test-only thread note",
			UpdatedAt:    "11:25",
			Unread:       1,
		}},
		Runs: []store.Run{{
			ID:           "run-e2e-1",
			Branch:       "feat/e2e-status-sync-20260405",
			Worktree:     "wt-e2e-status-sync-20260405",
			WorktreePath: "/tmp/openshock-review130/.openshock-worktrees/wt-e2e-status-sync-20260405",
			Summary:      "E2E Status Sync 20260405",
			NextAction:   "placeholder 注释窗口",
		}},
		Inbox: []store.InboxItem{{
			ID:      "inbox-e2e",
			Title:   "?? live detail ??",
			Room:    "E2E ???? 20260405 讨论间",
			Summary: "??????????:Issue?Room?Run?PR?Inbox?Memory?",
			Action:  "test-only action",
		}},
		PullRequests: []store.PullRequest{{
			ID:            "pr-e2e",
			Title:         "E2E Status Sync 20260405",
			Branch:        "feat/e2e-status-sync-20260405",
			BaseBranch:    "?? base ??",
			ReviewSummary: "??????????:Issue?Room?Run?PR?Inbox?Memory?",
		}},
		Runtimes: []store.RuntimeRecord{{
			ID:            "shock-main",
			Machine:       "shock-main",
			State:         "online",
			PairingState:  "paired",
			WorkspaceRoot: "/home/lark/OpenShock",
		}},
		Sessions: []store.Session{{
			ID:           "session-e2e-1",
			Status:       "running",
			Branch:       "feat/e2e-status-sync-20260405",
			Worktree:     "wt-e2e-status-sync-20260405",
			WorktreePath: "/tmp/openshock-review130/.openshock-worktrees/wt-e2e-status-sync-20260405",
			Summary:      "E2E Status Sync 20260405",
			MemoryPaths:  []string{"notes/rooms/room-e2e-status-sync-20260405.md"},
		}},
		RuntimeLeases: []store.RuntimeLease{{
			LeaseID:      "lease-e2e-1",
			Runtime:      "shock-main",
			Machine:      "shock-main",
			Branch:       "feat/e2e-status-sync-20260405",
			WorktreeName: "wt-e2e-status-sync-20260405",
			WorktreePath: "/tmp/openshock-review130/.openshock-worktrees/wt-e2e-status-sync-20260405",
			Cwd:          "/tmp/openshock-review130/.openshock-worktrees/wt-e2e-status-sync-20260405",
			Summary:      "?? Issue ? Run ????????????",
		}},
		Memory: []store.MemoryArtifact{{
			ID:      "memory-e2e-1",
			Scope:   "room:room-e2e-status-sync-20260405",
			Path:    "notes/rooms/room-e2e-status-sync-20260405.md",
			Summary: "?? memory summary ??",
		}},
		MemoryVersions: map[string][]store.MemoryArtifactVersion{
			"memory-e2e-1": {{
				Version: 1,
				Summary: "E2E Status Sync 20260405",
				Content: "# E2E ???? 20260405 讨论间\n\n- prompt: ???:???\n- output: 我在 `E:\\00.Lark_Projects\\00_OpenShock` 项目中，可以帮您查看项目状态。",
			}},
		},
	}

	body, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent() error = %v", err)
	}
	if err := os.WriteFile(statePath, body, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	mustLoginReadyOwner(t, s)
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

	resp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload store.State
	decodeJSON(t, resp, &payload)

	if got := payload.Workspace.Branch; got != "待整理分支" {
		t.Fatalf("workspace branch = %q, want sanitized fallback", got)
	}
	if got := payload.ChannelMessages["announcements"][0].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("announcement message = %q, want sanitized fallback", got)
	}
	if got := payload.ChannelMessages["all"][0].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("all channel message = %q, want sanitized fallback", got)
	}
	if got := payload.Issues[0].Title; got != "待整理任务" {
		t.Fatalf("issue title = %q, want sanitized fallback", got)
	}
	if got := payload.Issues[1].Summary; got != "这条任务的上下文正在整理，先回到讨论间确认当前状态。" {
		t.Fatalf("issue summary = %q, want sanitized fallback", got)
	}
	if got := payload.Rooms[0].Title; got != "待整理讨论间" {
		t.Fatalf("room title = %q, want sanitized fallback", got)
	}
	if got := payload.Rooms[1].Topic.Title; got != "待整理话题" {
		t.Fatalf("topic title = %q, want sanitized fallback", got)
	}
	if got := payload.RoomMessages["room-e2e"][0].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("room system message = %q, want sanitized fallback", got)
	}
	if got := payload.RoomMessages["room-e2e"][1].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("room human message = %q, want sanitized fallback", got)
	}
	if got := payload.RoomMessages["room-e2e"][2].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("room agent message = %q, want sanitized fallback", got)
	}
	if got := payload.Runs[0].WorktreePath; got != "当前 worktree 路径正在整理中。" {
		t.Fatalf("run worktree path = %q, want sanitized fallback", got)
	}
	if got := payload.Runs[0].NextAction; got != "等待当前执行更新。" {
		t.Fatalf("run nextAction = %q, want sanitized fallback", got)
	}
	if got := payload.Runtimes[0].WorkspaceRoot; got != "当前 runtime 工作区路径已隐藏。" {
		t.Fatalf("runtime workspace root = %q, want sanitized fallback", got)
	}
	if got := payload.DirectMessages[0].Summary; got != "当前私聊摘要还没同步。" {
		t.Fatalf("direct message summary = %q, want sanitized fallback", got)
	}
	if got := payload.DirectMessageMessages["dm-e2e"][0].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("direct message message = %q, want sanitized fallback", got)
	}
	if got := payload.FollowedThreads[0].Summary; got != "当前消息线索摘要正在整理中。" {
		t.Fatalf("followed thread summary = %q, want sanitized fallback", got)
	}
	if got := payload.Inbox[0].Title; got != "待整理信号" {
		t.Fatalf("inbox title = %q, want sanitized fallback", got)
	}
	if got := payload.PullRequests[0].Title; got != "待整理 PR" {
		t.Fatalf("pull request title = %q, want sanitized fallback", got)
	}
	if got := payload.PullRequests[0].ReviewSummary; got != "当前 review 摘要正在整理中。" {
		t.Fatalf("pull request review summary = %q, want sanitized fallback", got)
	}
	if got := payload.Workspace.Onboarding.CurrentStep; got != "" {
		t.Fatalf("onboarding currentStep = %q, want sanitized fallback", got)
	}
	if got := payload.Workspace.Onboarding.ResumeURL; got != "" {
		t.Fatalf("onboarding resumeUrl = %q, want sanitized fallback", got)
	}
	if got := payload.Sessions[0].MemoryPaths[0]; got != "当前 session 记忆路径正在整理中。" {
		t.Fatalf("session memory path = %q, want sanitized fallback", got)
	}
	if got := payload.Memory[0].Path; got != "notes/current-artifact.md" {
		t.Fatalf("memory path = %q, want sanitized fallback", got)
	}
	if got := payload.MemoryVersions["memory-e2e-1"][0].Content; got != "这条记忆内容包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("memory version content = %q, want sanitized fallback", got)
	}
	if got := payload.Workspace.Repo; got != "Larkspur-Wang/OpenShock" {
		t.Fatalf("workspace repo = %q, want safe repo identity kept", got)
	}
	searchResult := findSearchResultByKindAndID(payload.QuickSearchEntries, "dm", "dm-e2e")
	if searchResult == nil {
		t.Fatalf("quick search entries = %#v, want dm-e2e entry", payload.QuickSearchEntries)
	}
	if got := searchResult.Title; got != "待整理结果" {
		t.Fatalf("quick search title = %q, want sanitized fallback", got)
	}
}

func findSearchResultByKindAndID(items []store.SearchResult, kind, id string) *store.SearchResult {
	for index := range items {
		if items[index].Kind == kind && items[index].ID == id {
			return &items[index]
		}
	}
	return nil
}
