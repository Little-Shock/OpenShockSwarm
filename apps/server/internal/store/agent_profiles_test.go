package store

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdateAgentProfilePersistsAuditAndPreview(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	nextState, agent, err := s.UpdateAgentProfile("agent-codex-dockmaster", AgentProfileUpdateInput{
		Role:                  "Delivery Lead",
		Avatar:                "signal-radar",
		Prompt:                "Always start from live repo truth, then propose the shortest next action.",
		OperatingInstructions: "Keep reviewer and owner windows separate.",
		ProviderPreference:    "Claude Code CLI",
		ModelPreference:       "claude-sonnet-4",
		RecallPolicy:          "agent-first",
		RuntimePreference:     "shock-main",
		MemorySpaces:          []string{"workspace", "user"},
		Sandbox: &SandboxPolicy{
			Profile:         sandboxProfileRestricted,
			AllowedHosts:    []string{"github.com"},
			AllowedCommands: []string{"git status"},
			AllowedTools:    []string{"read_file"},
		},
		UpdatedBy: "Larkspur",
	})
	if err != nil {
		t.Fatalf("UpdateAgentProfile() error = %v", err)
	}

	if agent.Role != "Delivery Lead" || agent.Avatar != "signal-radar" || agent.ProviderPreference != "Claude Code CLI" || agent.ModelPreference != "claude-sonnet-4" || agent.RuntimePreference != "shock-main" {
		t.Fatalf("updated agent = %#v, want edited role/avatar/provider/model/runtime preference", agent)
	}
	if agent.Sandbox.Profile != sandboxProfileRestricted || len(agent.Sandbox.AllowedCommands) != 1 {
		t.Fatalf("updated agent sandbox = %#v, want restricted sandbox policy", agent.Sandbox)
	}
	if len(agent.ProfileAudit) == 0 || !strings.Contains(agent.ProfileAudit[0].Summary, "role") {
		t.Fatalf("profile audit = %#v, want latest audit entry", agent.ProfileAudit)
	}
	if found, ok := findAgentByOwner(nextState, "Codex Dockmaster"); !ok || found.Role != "Delivery Lead" {
		t.Fatalf("state agents = %#v, want updated role persisted in returned state", nextState.Agents)
	}

	center := s.MemoryCenter()
	preview := findMemoryPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "Delivery Lead") || !strings.Contains(preview.PromptSummary, "Claude Code CLI") || !strings.Contains(preview.PromptSummary, "claude-sonnet-4") || !strings.Contains(preview.PromptSummary, "shock-main") || !strings.Contains(preview.PromptSummary, "agent-first") {
		t.Fatalf("preview summary = %q, want updated profile fields", preview.PromptSummary)
	}
	if !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "MEMORY.md"))) {
		t.Fatalf("preview items = %#v, want owner agent memory path after user binding", preview.Items)
	}
	if previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "rooms", "room-runtime.md"))) {
		t.Fatalf("preview items = %#v, room note should be absent after dropping issue-room binding", preview.Items)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("reload New() error = %v", err)
	}
	reloadedAgent, ok := reloaded.Agent("agent-codex-dockmaster")
	if !ok {
		t.Fatalf("reloaded agent missing")
	}
	if reloadedAgent.Role != "Delivery Lead" || reloadedAgent.Avatar != "signal-radar" || reloadedAgent.ModelPreference != "claude-sonnet-4" || reloadedAgent.RuntimePreference != "shock-main" || len(reloadedAgent.ProfileAudit) == 0 {
		t.Fatalf("reloaded agent = %#v, want persisted profile edits + audit", reloadedAgent)
	}
}

func TestUpdateAgentProfileAllowsModelOutsideProviderCatalog(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	_, agent, err := s.UpdateAgentProfile("agent-codex-dockmaster", AgentProfileUpdateInput{
		Name:                  "主执行智能体",
		Role:                  "Delivery Lead",
		Avatar:                "signal-radar",
		Prompt:                "Prefer live machine truth before catalog defaults.",
		OperatingInstructions: "Treat provider catalogs as suggestions, not allowlists.",
		ProviderPreference:    "Codex CLI",
		ModelPreference:       "gpt-5.4",
		RecallPolicy:          "agent-first",
		RuntimePreference:     "shock-sidecar",
		MemorySpaces:          []string{"workspace", "user"},
		Sandbox: &SandboxPolicy{
			Profile:         sandboxProfileRestricted,
			AllowedHosts:    []string{"github.com"},
			AllowedCommands: []string{"git status"},
			AllowedTools:    []string{"read_file"},
		},
		UpdatedBy: "Larkspur",
	})
	if err != nil {
		t.Fatalf("UpdateAgentProfile() error = %v", err)
	}

	if agent.ModelPreference != "gpt-5.4" {
		t.Fatalf("updated agent model = %q, want custom model outside catalog to persist", agent.ModelPreference)
	}
	if agent.Name != "主执行智能体" || agent.RuntimePreference != "shock-sidecar" {
		t.Fatalf("updated agent = %#v, want renamed agent + runtime preference persisted", agent)
	}

	center := s.MemoryCenter()
	preview := findMemoryPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "主执行智能体") ||
		!strings.Contains(preview.PromptSummary, "gpt-5.4") ||
		!strings.Contains(preview.PromptSummary, "shock-sidecar") {
		t.Fatalf("preview summary = %q, want renamed agent + custom model + runtime preference", preview.PromptSummary)
	}
}
