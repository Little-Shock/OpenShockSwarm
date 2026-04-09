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
	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

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
	if got := payload.Runs[0].WorktreePath; got != "当前 worktree 路径正在整理中。" {
		t.Fatalf("run worktree path = %q, want sanitized fallback", got)
	}
	if got := payload.Runs[0].NextAction; got != "等待当前执行真相同步。" {
		t.Fatalf("run nextAction = %q, want sanitized fallback", got)
	}
	if got := payload.Runtimes[0].WorkspaceRoot; got != "当前 runtime 工作区路径已隐藏。" {
		t.Fatalf("runtime workspace root = %q, want sanitized fallback", got)
	}
	if got := payload.DirectMessages[0].Summary; got != "当前私聊摘要正在整理中。" {
		t.Fatalf("direct message summary = %q, want sanitized fallback", got)
	}
	if got := payload.DirectMessageMessages["dm-e2e"][0].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("direct message message = %q, want sanitized fallback", got)
	}
	if got := payload.FollowedThreads[0].Summary; got != "当前消息线索摘要正在整理中。" {
		t.Fatalf("followed thread summary = %q, want sanitized fallback", got)
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
