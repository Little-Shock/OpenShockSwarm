package api

import (
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestSanitizeLivePayloadRemovesPlaceholderLeakage(t *testing.T) {
	state := store.State{
		Workspace: store.WorkspaceSnapshot{
			Name:          "OpenShock 作战台",
			Branch:        "feat/e2e-status-sync-20260405",
			Repo:          "Larkspur-Wang/OpenShock",
			RepoURL:       "https://github.com/Larkspur-Wang/OpenShock",
			PairedRuntime: "shock-main",
		},
		Channels: []store.Channel{{
			ID:      "announcements",
			Name:    "#announcements",
			Summary: "版本、Runtime 变化和制度公告。",
			Purpose: "这里只做广播。",
		}},
		ChannelMessages: map[string][]store.Message{
			"announcements": {
				{ID: "ann-1", Speaker: "System", Role: "system", Tone: "system", Message: "OPS-29 已自动升级成新的讨论间：?? live detail ?? 讨论间。", Time: "21:42"},
				{ID: "ann-2", Speaker: "System", Role: "system", Tone: "system", Message: "OPS-31 已自动升级成新的讨论间：E2E Status Sync 20260405 讨论间。", Time: "23:06"},
				{ID: "ann-3", Speaker: "System", Role: "system", Tone: "system", Message: "工作区已绑定仓库：Larkspur-Wang/OpenShock。", Time: "21:54"},
			},
		},
		Issues: []store.Issue{{
			ID:      "issue-live-detail",
			Key:     "OPS-29",
			Title:   "?? live detail ??",
			Summary: "?? Issue ? Run ????????????",
		}},
		Rooms: []store.Room{{
			ID:      "room-live-detail",
			Title:   "E2E ???? 20260405 讨论间",
			Summary: "?? Issue ? Run ????????????",
			Topic: store.Topic{
				ID:      "topic-live-detail",
				Title:   "?? live detail ??",
				Summary: "placeholder 注释窗口",
			},
		}},
		RoomMessages: map[string][]store.Message{
			"room-live-detail": {
				{ID: "room-1", Speaker: "System", Role: "system", Tone: "system", Message: "CLI 连接失败：Post \"E:\\\\00.Lark_Projects\\\\00_OpenShock\"", Time: "23:00"},
			},
		},
		Runs: []store.Run{{
			ID:           "run_live-detail_01",
			Branch:       "feat/e2e-status-sync-20260405",
			Worktree:     "wt-e2e-status-sync-20260405",
			WorktreePath: "E:\\\\00.Lark_Projects\\\\.openshock-worktrees\\\\00_OpenShock\\\\wt-e2e-status-sync-20260405",
			Summary:      "E2E ???? 20260405",
			NextAction:   "placeholder 注释窗口",
			Stdout:       []string{"worktree path: E:\\\\00.Lark_Projects\\\\.openshock-worktrees"},
			Stderr:       []string{"?? run stderr ??"},
			ToolCalls:    []store.ToolCall{{ID: "tool-1", Summary: "?? call ??", Result: "test-only"}},
			Timeline:     []store.RunEvent{{ID: "event-1", Label: "?? live detail ??", At: "23:00", Tone: "paper"}},
		}},
		Runtimes: []store.RuntimeRecord{{
			ID:            "shock-main",
			Machine:       "shock-main",
			DaemonURL:     "http://127.0.0.1:8090",
			Shell:         "bash",
			State:         "online",
			PairingState:  "paired",
			WorkspaceRoot: "/home/lark/OpenShock",
			ReportedAt:    "2026-04-09T00:00:00Z",
		}},
		Inbox: []store.InboxItem{{
			ID:      "inbox-1",
			Title:   "?? live detail ??",
			Room:    "E2E Status Sync 20260405 讨论间",
			Summary: "placeholder 注释窗口",
			Action:  "test-only action",
		}},
		RuntimeLeases: []store.RuntimeLease{{
			LeaseID:      "lease-1",
			Branch:       "feat/e2e-status-sync-20260405",
			WorktreeName: "wt-e2e-status-sync-20260405",
			WorktreePath: "E:\\\\00.Lark_Projects\\\\.openshock-worktrees\\\\00_OpenShock\\\\wt-e2e-status-sync-20260405",
			Cwd:          "E:\\\\00.Lark_Projects\\\\.openshock-worktrees\\\\00_OpenShock\\\\wt-e2e-status-sync-20260405",
			Summary:      "?? Issue ? Run ????????????",
		}},
		PullRequests: []store.PullRequest{{
			ID:            "pr-1",
			Title:         "E2E Status Sync 20260405",
			Branch:        "feat/e2e-status-sync-20260405",
			BaseBranch:    "?? base ??",
			ReviewSummary: "?? review summary ??",
		}},
		Sessions: []store.Session{{
			ID:           "session-1",
			Branch:       "feat/e2e-status-sync-20260405",
			Worktree:     "wt-e2e-status-sync-20260405",
			WorktreePath: "E:\\\\00.Lark_Projects\\\\.openshock-worktrees\\\\00_OpenShock\\\\wt-e2e-status-sync-20260405",
			Summary:      "E2E ???? 20260405",
			MemoryPaths:  []string{"notes/rooms/room-e2e-status-sync-20260405.md"},
		}},
		Memory: []store.MemoryArtifact{{
			ID:      "memory-1",
			Scope:   "room:room-e2e-status-sync-20260405",
			Path:    "notes/rooms/room-e2e-status-sync-20260405.md",
			Summary: "?? memory summary ??",
		}},
		MemoryVersions: map[string][]store.MemoryArtifactVersion{
			"memory-1": {{
				Version: 1,
				Summary: "E2E Status Sync 20260405",
				Content: "# E2E ???? 20260405 讨论间",
			}},
		},
	}

	sanitized := sanitizeLivePayload(state).(store.State)

	if got := sanitized.Workspace.Branch; got != "待整理分支" {
		t.Fatalf("workspace branch = %q, want sanitized fallback", got)
	}
	if got := sanitized.Issues[0].Title; got != "待整理任务" {
		t.Fatalf("issue title = %q, want sanitized fallback", got)
	}
	if got := sanitized.Rooms[0].Title; got != "待整理讨论间" {
		t.Fatalf("room title = %q, want sanitized fallback", got)
	}
	if got := sanitized.Rooms[0].Topic.Title; got != "待整理话题" {
		t.Fatalf("topic title = %q, want sanitized fallback", got)
	}
	if got := sanitized.ChannelMessages["announcements"][0].Message; got != "这条历史消息包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("announcement message = %q, want sanitized fallback", got)
	}
	if got := sanitized.ChannelMessages["announcements"][2].Message; got != "工作区已绑定仓库：Larkspur-Wang/OpenShock。" {
		t.Fatalf("safe message = %q, want untouched", got)
	}
	if got := sanitized.Runs[0].Summary; got != "当前执行摘要还没同步。" {
		t.Fatalf("run summary = %q, want sanitized fallback", got)
	}
	if got := sanitized.Runs[0].Branch; got != "待整理分支" {
		t.Fatalf("run branch = %q, want sanitized fallback", got)
	}
	if got := sanitized.Runs[0].WorktreePath; got != "当前 worktree 路径正在整理中。" {
		t.Fatalf("run worktree path = %q, want sanitized fallback", got)
	}
	if got := sanitized.Runtimes[0].WorkspaceRoot; got != "当前 runtime 工作区路径已隐藏。" {
		t.Fatalf("runtime workspace root = %q, want sanitized fallback", got)
	}
	if got := sanitized.Inbox[0].Title; got != "待整理信号" {
		t.Fatalf("inbox title = %q, want sanitized fallback", got)
	}
	if got := sanitized.RuntimeLeases[0].Summary; got != "当前 runtime lease 摘要正在整理中。" {
		t.Fatalf("runtime lease summary = %q, want sanitized fallback", got)
	}
	if got := sanitized.RuntimeLeases[0].Cwd; got != "当前工作目录正在整理中。" {
		t.Fatalf("runtime lease cwd = %q, want sanitized fallback", got)
	}
	if got := sanitized.PullRequests[0].Title; got != "待整理 PR" {
		t.Fatalf("pull request title = %q, want sanitized fallback", got)
	}
	if got := sanitized.PullRequests[0].Branch; got != "待整理分支" {
		t.Fatalf("pull request branch = %q, want sanitized fallback", got)
	}
	if got := sanitized.Sessions[0].Summary; got != "当前会话摘要正在整理中。" {
		t.Fatalf("session summary = %q, want sanitized fallback", got)
	}
	if got := sanitized.Sessions[0].MemoryPaths[0]; got != "当前 session 记忆路径正在整理中。" {
		t.Fatalf("session memory path = %q, want sanitized fallback", got)
	}
	if got := sanitized.Memory[0].Path; got != "notes/current-artifact.md" {
		t.Fatalf("memory path = %q, want sanitized fallback", got)
	}
	if got := sanitized.MemoryVersions["memory-1"][0].Content; got != "这条记忆内容包含测试残留或乱码，已在当前工作区隐藏。" {
		t.Fatalf("memory version content = %q, want sanitized fallback", got)
	}
}

func TestBuildStateStreamEventSanitizesSnapshot(t *testing.T) {
	event := buildStateStreamEvent(store.State{
		Workspace: store.WorkspaceSnapshot{
			Onboarding: store.WorkspaceOnboardingSnapshot{
				Materialization: store.WorkspaceOnboardingMaterialization{
					Roles:              []string{"Owner / Member / Viewer", "Research Lead", "Collector", "Synthesizer", "Reviewer"},
					Agents:             []string{"Lead Operator", "Collector", "Synthesizer", "Review Runner"},
					NotificationPolicy: "evidence ready / synthesis blocked / reviewer feedback 优先推送",
					Notes:              []string{"只推高优先级与显式 review 事件"},
				},
			},
		},
		Issues: []store.Issue{{
			ID:      "issue-live-detail",
			Key:     "OPS-29",
			Title:   "?? live detail ??",
			Summary: "?? Issue ? Run ????????????",
		}},
		Runtimes: []store.RuntimeRecord{{
			ID:            "shock-main",
			Machine:       "shock-main",
			State:         "online",
			PairingState:  "paired",
			WorkspaceRoot: "/home/lark/OpenShock",
		}},
	}, 1)

	if got := event.State.Issues[0].Title; got != "待整理任务" {
		t.Fatalf("stream issue title = %q, want sanitized fallback", got)
	}
	if got := event.State.Runtimes[0].WorkspaceRoot; got != "当前 runtime 工作区路径已隐藏。" {
		t.Fatalf("stream runtime workspace root = %q, want sanitized fallback", got)
	}
	if got := event.State.Workspace.Onboarding.Materialization.Roles; len(got) != 7 || got[0] != "所有者" || got[1] != "成员" || got[2] != "访客" || got[3] != "方向" || got[4] != "采集" || got[5] != "归纳" || got[6] != "评审" {
		t.Fatalf("stream onboarding roles = %#v, want customer-facing role labels", got)
	}
	if got := event.State.Workspace.Onboarding.Materialization.Agents; len(got) != 4 || got[0] != "总控智能体" || got[1] != "采集智能体" || got[2] != "归纳智能体" || got[3] != "评审智能体" {
		t.Fatalf("stream onboarding agents = %#v, want customer-facing agent labels", got)
	}
	if got := event.State.Workspace.Onboarding.Materialization.NotificationPolicy; got != "优先推送证据就绪、综合阻塞和复核反馈" {
		t.Fatalf("stream onboarding notification policy = %q, want customer-facing policy", got)
	}
	if got := event.State.Workspace.Onboarding.Materialization.Notes[0]; got != "只推高优先级与显式评审事件" {
		t.Fatalf("stream onboarding note = %q, want customer-facing note", got)
	}
}

func TestBuildStateStreamEventRewritesRuntimeSchedulerCopy(t *testing.T) {
	event := buildStateStreamEvent(store.State{
		Runs: []store.Run{{
			ID:         "run-runtime",
			Summary:    "当前执行可继续。",
			NextAction: "等待 worktree lane；shock-main 当前不可用，已切换到 shock-spare，当前有 0 个运行任务。",
			Timeline: []store.RunEvent{
				{ID: "run-1", Label: "Runtime 已 failover 到 shock-spare"},
			},
		}},
		Sessions: []store.Session{{
			ID:          "session-runtime",
			ActiveRunID: "run-runtime",
			Summary:     "shock-main 当前不可用，已切换到 shock-spare，当前有 0 个运行任务。",
		}},
		RuntimeScheduler: store.RuntimeScheduler{
			SelectedRuntime:  "shock-main",
			PreferredRuntime: "shock-main",
			AssignedRuntime:  "shock-spare",
			AssignedMachine:  "shock-spare",
			Strategy:         "failover",
			FailoverFrom:     "shock-main",
			Summary:          "当前 fallback state 仍按 workspace selection 指向 shock-main。",
			Candidates: []store.RuntimeSchedulerCandidate{
				{Runtime: "shock-main", Machine: "shock-main", State: "offline", Reason: "preferred runtime 当前不可调度，已被 failover 跳过。"},
				{Runtime: "shock-spare", Machine: "shock-spare", State: "online", Assigned: true, Reason: "承接 `shock-main` 的 failover；当前承载 0 条 active lease。"},
				{Runtime: "shock-sidecar", Machine: "shock-sidecar", State: "online", ActiveLeaseCount: 2, Reason: "当前承载 2 条 active lease。"},
			},
		},
	}, 1)

	if got := event.State.RuntimeScheduler.Summary; got != "当前仍指向工作区默认运行环境 shock-main。" {
		t.Fatalf("scheduler summary = %q, want customer-facing fallback summary", got)
	}
	if got := event.State.RuntimeScheduler.Candidates[0].Reason; got != "首选运行环境暂不可调度，已跳过。" {
		t.Fatalf("preferred reason = %q, want customer-facing failover skip", got)
	}
	if got := event.State.RuntimeScheduler.Candidates[1].Reason; got != "承接 shock-main 的切换，当前有 0 条执行。" {
		t.Fatalf("assigned reason = %q, want customer-facing switch reason", got)
	}
	if got := event.State.RuntimeScheduler.Candidates[2].Reason; got != "当前有 2 条执行。" {
		t.Fatalf("lease reason = %q, want customer-facing execution count", got)
	}
	if got := event.State.Runs[0].NextAction; got != "等待 worktree lane；shock-main 当前不可用，已切到 shock-spare，当前有 0 条执行。" {
		t.Fatalf("run next action = %q, want rewritten scheduler summary", got)
	}
	if got := event.State.Runs[0].Timeline[0].Label; got != "运行环境已切到 shock-spare" {
		t.Fatalf("run timeline label = %q, want customer-facing runtime label", got)
	}
	if got := event.State.Sessions[0].Summary; got != "shock-main 当前不可用，已切到 shock-spare，当前有 0 条执行。" {
		t.Fatalf("session summary = %q, want rewritten scheduler summary", got)
	}
}

func TestSanitizePullRequestDeliveryGateBackfillsHrefLabel(t *testing.T) {
	cases := []struct {
		name string
		gate store.PullRequestDeliveryGate
		want string
	}{
		{
			name: "run detail",
			gate: store.PullRequestDeliveryGate{ID: "run-usage", Label: "Run Usage", Summary: "healthy", Href: "/runs/run-runtime"},
			want: "执行详情",
		},
		{
			name: "notification settings",
			gate: store.PullRequestDeliveryGate{ID: "notification-delivery", Label: "Notification", Summary: "ready", Href: "/settings"},
			want: "通知设置",
		},
		{
			name: "mailbox handoff",
			gate: store.PullRequestDeliveryGate{ID: "handoff-followup", Label: "Handoff", Summary: "ready", Href: "/mailbox?roomId=room-runtime"},
			want: "交接箱",
		},
		{
			name: "room topic tab",
			gate: store.PullRequestDeliveryGate{ID: "room-topic", Label: "Room", Summary: "ready", Href: "/rooms/room-runtime?tab=topic"},
			want: "讨论间话题",
		},
		{
			name: "no href",
			gate: store.PullRequestDeliveryGate{ID: "review-merge", Label: "Review", Summary: "ready"},
			want: "",
		},
		{
			name: "opaque href",
			gate: store.PullRequestDeliveryGate{ID: "opaque-gate", Label: "Opaque", Summary: "ready", Href: "/external-review/opaque"},
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizePullRequestDeliveryGate(tc.gate)
			if got.HrefLabel != tc.want {
				t.Fatalf("href label = %q, want %q for %#v", got.HrefLabel, tc.want, got)
			}
		})
	}
}

func TestSanitizeAgentHandoffBackfillsKindLabel(t *testing.T) {
	handoff := sanitizeAgentHandoff(store.AgentHandoff{
		ID:         "handoff-response",
		Kind:       "delivery-reply",
		KindLabel:  "",
		Title:      "补交 release 说明",
		Summary:    "把 blocker 所需的补充信息回给 source。",
		FromAgent:  "Codex Dockmaster",
		ToAgent:    "Memory Clerk",
		LastAction: "等待补充回复继续同步。",
		Messages:   []store.MailboxMessage{},
	})

	if handoff.KindLabel != "补充回复" {
		t.Fatalf("kind label = %q, want delivery reply fallback label", handoff.KindLabel)
	}
}

func TestSanitizeInboxItemBackfillsActionLabel(t *testing.T) {
	item := sanitizeInboxItem(store.InboxItem{
		ID:      "inbox-runtime",
		Title:   "Runtime 已准备就绪",
		Kind:    "status",
		Room:    "Runtime 讨论间",
		Summary: "当前运行状态已经可见。",
		Action:  "",
		Href:    "/rooms/room-runtime/runs/run_runtime_01",
	})

	if item.Action != "执行详情" {
		t.Fatalf("action = %q, want explicit inbox target label", item.Action)
	}
}

func TestSanitizePullRequestDeliveryEvidenceBackfillsHrefLabel(t *testing.T) {
	cases := []struct {
		name     string
		evidence store.PullRequestDeliveryEvidence
		want     string
	}{
		{
			name:     "room pr tab",
			evidence: store.PullRequestDeliveryEvidence{ID: "room-pr-tab", Label: "Room PR Tab", Value: "Runtime Reliability", Summary: "ready", Href: "/rooms/room-runtime?tab=pr"},
			want:     "讨论间 PR",
		},
		{
			name:     "remote pr",
			evidence: store.PullRequestDeliveryEvidence{ID: "remote-pr", Label: "Remote PR", Value: "https://github.com/acme/repo/pull/42", Summary: "ready", Href: "https://github.com/acme/repo/pull/42"},
			want:     "远端 PR",
		},
		{
			name:     "review conversation self detail",
			evidence: store.PullRequestDeliveryEvidence{ID: "review-conversation", Label: "Latest Review Event", Value: "4 entries", Summary: "ready", Href: "/pull-requests/pr-runtime-18"},
			want:     "PR 详情",
		},
		{
			name:     "notification templates",
			evidence: store.PullRequestDeliveryEvidence{ID: "notification-templates", Label: "Notification Templates", Value: "ops_review(ready)", Summary: "ready", Href: "/settings"},
			want:     "通知设置",
		},
		{
			name:     "no href",
			evidence: store.PullRequestDeliveryEvidence{ID: "release-contract", Label: "Release Contract", Value: "pnpm verify:release", Summary: "ready"},
			want:     "",
		},
		{
			name:     "opaque href",
			evidence: store.PullRequestDeliveryEvidence{ID: "opaque-evidence", Label: "Opaque", Value: "external", Summary: "ready", Href: "/external-review/opaque"},
			want:     "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizePullRequestDeliveryEvidence(tc.evidence)
			if got.HrefLabel != tc.want {
				t.Fatalf("href label = %q, want %q for %#v", got.HrefLabel, tc.want, got)
			}
		})
	}
}

func TestSanitizeWorkspaceGovernanceRollupBackfillsHrefLabels(t *testing.T) {
	state := store.State{
		Workspace: store.WorkspaceSnapshot{
			Governance: store.WorkspaceGovernanceSnapshot{
				EscalationSLA: store.WorkspaceGovernanceEscalationSLA{
					Rollup: []store.WorkspaceGovernanceEscalationRoomRollup{
						{
							RoomID:          "room-runtime",
							RoomTitle:       "Runtime Reliability",
							Status:          "blocked",
							NextRouteStatus: "active",
							NextRouteHref:   "/mailbox?roomId=room-runtime&handoffId=handoff-runtime",
							Href:            "/runs/run-runtime",
						},
						{
							RoomID:          "room-release",
							RoomTitle:       "Release Readiness",
							Status:          "active",
							NextRouteStatus: "done",
							NextRouteHref:   "/pull-requests/pr-runtime-18",
							Href:            "/mailbox?roomId=room-release",
						},
						{
							RoomID:          "room-unknown",
							RoomTitle:       "Unknown Route",
							Status:          "active",
							NextRouteStatus: "done",
							NextRouteHref:   "/external-review/opaque",
							Href:            "/rooms/room-unknown",
						},
					},
				},
			},
		},
	}

	sanitized := sanitizeLivePayload(state).(store.State)
	runtimeRollup := sanitized.Workspace.Governance.EscalationSLA.Rollup[0]
	if runtimeRollup.NextRouteHrefLabel != "当前交接" {
		t.Fatalf("runtime next route href label = %q, want explicit active handoff label", runtimeRollup.NextRouteHrefLabel)
	}
	if runtimeRollup.HrefLabel != "执行详情" {
		t.Fatalf("runtime room href label = %q, want explicit run detail label", runtimeRollup.HrefLabel)
	}

	releaseRollup := sanitized.Workspace.Governance.EscalationSLA.Rollup[1]
	if releaseRollup.NextRouteHrefLabel != "交付详情" {
		t.Fatalf("release next route href label = %q, want explicit delivery detail label", releaseRollup.NextRouteHrefLabel)
	}
	if releaseRollup.HrefLabel != "交接箱" {
		t.Fatalf("release room href label = %q, want explicit mailbox label", releaseRollup.HrefLabel)
	}

	unknownRollup := sanitized.Workspace.Governance.EscalationSLA.Rollup[2]
	if unknownRollup.NextRouteHrefLabel != "" {
		t.Fatalf("unknown next route href label = %q, want fail-closed empty label", unknownRollup.NextRouteHrefLabel)
	}
	if unknownRollup.HrefLabel != "进入讨论间" {
		t.Fatalf("unknown room href label = %q, want explicit room label", unknownRollup.HrefLabel)
	}
}

func TestSanitizeWorkspaceSuggestedHandoffBackfillsHrefLabel(t *testing.T) {
	state := store.State{
		Workspace: store.WorkspaceSnapshot{
			Governance: store.WorkspaceGovernanceSnapshot{
				RoutingPolicy: store.WorkspaceGovernanceRoutingPolicy{
					SuggestedHandoff: store.WorkspaceGovernanceSuggestedHandoff{
						Status: "done",
						Reason: "当前治理链已收口。",
						Href:   "/mailbox?roomId=room-runtime",
					},
				},
			},
		},
	}

	sanitized := sanitizeLivePayload(state).(store.State)
	if got := sanitized.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HrefLabel; got != "交接箱" {
		t.Fatalf("suggested handoff href label = %q, want explicit closeout label", got)
	}
}
