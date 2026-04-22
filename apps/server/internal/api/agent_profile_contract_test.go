package api

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestAgentProfileRouteSupportsEditAndPreviewWriteback(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	detailResp, err := http.Get(server.URL + "/v1/agents/agent-codex-dockmaster")
	if err != nil {
		t.Fatalf("GET /v1/agents/:id error = %v", err)
	}
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/agents/:id status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}
	var initial store.Agent
	decodeJSON(t, detailResp, &initial)
	if initial.Role == "" || initial.Avatar == "" || initial.Prompt == "" || initial.ProviderPreference == "" {
		t.Fatalf("initial agent = %#v, want seeded profile fields", initial)
	}
	if !agentFileStackHasPath(initial.FileStack, filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "SOUL.md"))) ||
		!agentFileStackHasPath(initial.FileStack, filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "MEMORY.md"))) {
		t.Fatalf("initial fileStack = %#v, want seeded agent file-backed memory scaffold", initial.FileStack)
	}

	updateResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPatch,
		server.URL+"/v1/agents/agent-codex-dockmaster",
		`{"role":"Delivery Lead","avatar":"signal-radar","prompt":"Always start from live repo truth, then propose the shortest next action.","operatingInstructions":"Keep reviewer and owner windows separate.","providerPreference":"Claude Code CLI","modelPreference":"claude-sonnet-4","recallPolicy":"agent-first","runtimePreference":"shock-main","memorySpaces":["workspace","user"],"sandbox":{"profile":"restricted","allowedHosts":["github.com"],"allowedCommands":["git status"],"allowedTools":["read_file"]}}`,
	)
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/agents/:id status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}
	var payload struct {
		Agent  store.Agent        `json:"agent"`
		State  store.State        `json:"state"`
		Center store.MemoryCenter `json:"center"`
	}
	decodeJSON(t, updateResp, &payload)
	if payload.Agent.Role != "Delivery Lead" || payload.Agent.Avatar != "signal-radar" || payload.Agent.ProviderPreference != "Claude Code CLI" || payload.Agent.ModelPreference != "claude-sonnet-4" || payload.Agent.RuntimePreference != "shock-main" {
		t.Fatalf("updated agent = %#v, want edited role/avatar/provider/model/runtime preference", payload.Agent)
	}
	if payload.Agent.Sandbox.Profile != "restricted" || len(payload.Agent.Sandbox.AllowedCommands) != 1 {
		t.Fatalf("updated agent sandbox = %#v, want persisted sandbox policy", payload.Agent.Sandbox)
	}
	if len(payload.Agent.ProfileAudit) == 0 {
		t.Fatalf("updated agent audit = %#v, want audit entry", payload.Agent.ProfileAudit)
	}

	preview := findPreviewBySession(payload.Center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", payload.Center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "Delivery Lead") || !strings.Contains(preview.PromptSummary, "Claude Code CLI") || !strings.Contains(preview.PromptSummary, "claude-sonnet-4") || !strings.Contains(preview.PromptSummary, "shock-main") || !strings.Contains(preview.PromptSummary, "agent-first") {
		t.Fatalf("promptSummary = %q, want updated profile fields", preview.PromptSummary)
	}
	requiredPreviewPaths := []string{
		filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "SOUL.md")),
		filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "MEMORY.md")),
		filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "notes", "channels.md")),
		filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "notes", "operating-rules.md")),
		filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "notes", "skills.md")),
		filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "notes", "work-log.md")),
	}
	for _, path := range requiredPreviewPaths {
		if !previewHasPath(preview.Items, path) {
			t.Fatalf("preview items = %#v, want %q", preview.Items, path)
		}
		if !stringSliceHasPath(preview.Files, path) {
			t.Fatalf("preview files = %#v, want %q", preview.Files, path)
		}
	}
	if previewHasPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "rooms", "room-runtime.md"))) {
		t.Fatalf("preview items = %#v, room note should be absent after binding change", preview.Items)
	}

	updatedDetailResp, err := http.Get(server.URL + "/v1/agents/agent-codex-dockmaster")
	if err != nil {
		t.Fatalf("second GET /v1/agents/:id error = %v", err)
	}
	if updatedDetailResp.StatusCode != http.StatusOK {
		t.Fatalf("second GET /v1/agents/:id status = %d, want %d", updatedDetailResp.StatusCode, http.StatusOK)
	}
	var updated store.Agent
	decodeJSON(t, updatedDetailResp, &updated)
	if updated.Role != "Delivery Lead" || updated.RecallPolicy != "agent-first" || updated.ModelPreference != "claude-sonnet-4" || updated.RuntimePreference != "shock-main" || len(updated.ProfileAudit) == 0 {
		t.Fatalf("updated detail = %#v, want persisted profile edits", updated)
	}
	if updated.Sandbox.Profile != "restricted" || len(updated.Sandbox.AllowedTools) != 1 {
		t.Fatalf("updated sandbox detail = %#v, want persisted sandbox policy", updated.Sandbox)
	}
	if !agentFileStackHasPath(updated.FileStack, filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "notes", "operating-rules.md"))) ||
		!agentFileStackHasPath(updated.FileStack, filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "notes", "skills.md"))) {
		t.Fatalf("updated detail fileStack = %#v, want durable agent file-backed rule paths", updated.FileStack)
	}
}

func TestAgentProfileRouteAllowsCustomModelOutsideCatalog(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	updateResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPatch,
		server.URL+"/v1/agents/agent-codex-dockmaster",
		`{"name":"主执行智能体","role":"Delivery Lead","avatar":"signal-radar","prompt":"Prefer live machine truth before catalog defaults.","operatingInstructions":"Treat provider catalogs as suggestions, not allowlists.","providerPreference":"Codex CLI","modelPreference":"gpt-5.4","recallPolicy":"agent-first","runtimePreference":"shock-sidecar","memorySpaces":["workspace","user"],"sandbox":{"profile":"restricted","allowedHosts":["github.com"],"allowedCommands":["git status"],"allowedTools":["read_file"]}}`,
	)
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/agents/:id status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Agent  store.Agent        `json:"agent"`
		Center store.MemoryCenter `json:"center"`
	}
	decodeJSON(t, updateResp, &payload)
	if payload.Agent.Name != "主执行智能体" || payload.Agent.ModelPreference != "gpt-5.4" || payload.Agent.RuntimePreference != "shock-sidecar" {
		t.Fatalf("updated agent = %#v, want renamed agent + custom model + runtime preference persisted", payload.Agent)
	}

	preview := findPreviewBySession(payload.Center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", payload.Center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "主执行智能体") ||
		!strings.Contains(preview.PromptSummary, "gpt-5.4") ||
		!strings.Contains(preview.PromptSummary, "shock-sidecar") {
		t.Fatalf("promptSummary = %q, want renamed agent + custom model + runtime preference", preview.PromptSummary)
	}
}

func agentFileStackHasPath(items []store.AgentFileReference, want string) bool {
	want = filepath.ToSlash(want)
	for _, item := range items {
		if filepath.ToSlash(item.Path) == want {
			return true
		}
	}
	return false
}

func stringSliceHasPath(items []string, want string) bool {
	want = filepath.ToSlash(want)
	for _, item := range items {
		if filepath.ToSlash(item) == want {
			return true
		}
	}
	return false
}
