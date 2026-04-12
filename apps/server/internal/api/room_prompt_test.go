package api

import (
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestBuildRoomExecPromptIncludesRoomRunAndRecentContext(t *testing.T) {
	snapshot := store.State{
		Rooms: []store.Room{{
			ID:    "room-runtime",
			Title: "Runtime Lane",
			Topic: store.Topic{
				ID:      "topic-runtime",
				Title:   "Pairing Recovery",
				Summary: "收紧 daemon continuity",
			},
		}},
		Runs: []store.Run{{
			ID:           "run_runtime_01",
			RoomID:       "room-runtime",
			Status:       "running",
			Provider:     "Codex CLI",
			Branch:       "feat/runtime-continuity",
			Worktree:     "wt-runtime-continuity",
			WorktreePath: "/tmp/runtime-continuity",
		}},
		Issues: []store.Issue{{
			ID:     "issue-runtime",
			Key:    "OPS-12",
			Title:  "Recover runtime continuity",
			Owner:  "Codex Dockmaster",
			State:  "running",
			RoomID: "room-runtime",
		}},
		RoomMessages: map[string][]store.Message{
			"room-runtime": {
				{Speaker: "Larkspur", Role: "human", Message: "先把 continuity 做扎实。"},
				{Speaker: "Codex Dockmaster", Role: "agent", Message: "我已经接到当前 worktree，会继续沿着这条 lane 推进。"},
			},
		},
	}

	prompt := buildRoomExecPrompt(snapshot, "room-runtime", "codex", "继续把 session continuity 做实")

	for _, expected := range []string{
		"你正在 OpenShock 的讨论间里继续当前工作线程。",
		"- 房间：Runtime Lane (room-runtime)",
		"- Topic：Pairing Recovery",
		"- Issue：OPS-12 | Recover runtime continuity | owner=Codex Dockmaster | state=running",
		"- Run：run_runtime_01 | status=running | provider=Codex CLI | branch=feat/runtime-continuity | worktree=wt-runtime-continuity",
		"- 工作目录：/tmp/runtime-continuity",
		"- Larkspur[human]: 先把 continuity 做扎实。",
		"- Codex Dockmaster[agent]: 我已经接到当前 worktree，会继续沿着这条 lane 推进。",
		"本轮用户消息：",
		"继续把 session continuity 做实",
		"如果需要改代码或执行命令，默认围绕当前工作目录继续进行。",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("expected room prompt to contain %q, got:\n%s", expected, prompt)
		}
	}
}

func TestBuildRoomExecPromptFallsBackToRawPromptWhenRoomMissing(t *testing.T) {
	raw := "只回复一句话"
	if got := buildRoomExecPrompt(store.State{}, "missing-room", "codex", raw); got != raw {
		t.Fatalf("buildRoomExecPrompt() = %q, want %q", got, raw)
	}
}
