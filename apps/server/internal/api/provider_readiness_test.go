package api

import (
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestResolveExecProviderPrefersReadyProvider(t *testing.T) {
	state := store.State{
		Workspace: store.WorkspaceSnapshot{PairedRuntime: "shock-main"},
		Runtimes: []store.RuntimeRecord{
			{
				ID: "shock-main",
				Providers: []store.RuntimeProvider{
					{ID: "claude", Label: "Claude Code CLI", Status: "auth_required"},
					{ID: "codex", Label: "Codex CLI", Status: "ready"},
				},
			},
		},
		Agents: []store.Agent{
			{ID: "agent-1", ProviderPreference: "Claude Code CLI", Provider: "Claude Code CLI"},
		},
	}

	if got := resolveExecProvider(state, ""); got != "codex" {
		t.Fatalf("resolveExecProvider() = %q, want codex", got)
	}
}

func TestResolveExecProviderPreservesExplicitRequestedProvider(t *testing.T) {
	state := store.State{
		Workspace: store.WorkspaceSnapshot{PairedRuntime: "shock-main"},
		Runtimes: []store.RuntimeRecord{
			{
				ID: "shock-main",
				Providers: []store.RuntimeProvider{
					{ID: "claude", Label: "Claude Code CLI", Status: "auth_required"},
					{ID: "codex", Label: "Codex CLI", Status: "ready"},
				},
			},
		},
	}

	if got := resolveExecProvider(state, "claude"); got != "claude" {
		t.Fatalf("resolveExecProvider() = %q, want claude", got)
	}
}

func TestExecProviderPreflightMessageBlocksUnauthenticatedProvider(t *testing.T) {
	state := store.State{
		Workspace: store.WorkspaceSnapshot{PairedRuntime: "shock-main"},
		Runtimes: []store.RuntimeRecord{
			{
				ID: "shock-main",
				Providers: []store.RuntimeProvider{
					{ID: "claude", Label: "Claude Code CLI", Status: "auth_required"},
				},
			},
		},
	}

	if got := execProviderPreflightMessage("讨论间消息", state, "claude"); got != "讨论间消息当前还未登录模型服务，请先完成登录。" {
		t.Fatalf("execProviderPreflightMessage() = %q", got)
	}
}
