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

	updateResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPatch,
		server.URL+"/v1/agents/agent-codex-dockmaster",
		`{"role":"Delivery Lead","avatar":"signal-radar","prompt":"Always start from live repo truth, then propose the shortest next action.","operatingInstructions":"Keep reviewer and owner windows separate.","providerPreference":"Claude Code CLI","modelPreference":"claude-sonnet-4","recallPolicy":"agent-first","runtimePreference":"shock-main","memorySpaces":["workspace","user"]}`,
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
	if !previewHasPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "codex-dockmaster", "MEMORY.md"))) {
		t.Fatalf("preview items = %#v, want owner agent memory path", preview.Items)
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
		`{"role":"Delivery Lead","avatar":"signal-radar","prompt":"Prefer live machine truth before catalog defaults.","operatingInstructions":"Treat provider catalogs as suggestions, not allowlists.","providerPreference":"Codex CLI","modelPreference":"gpt-5.4","recallPolicy":"agent-first","runtimePreference":"shock-sidecar","memorySpaces":["workspace","user"]}`,
	)
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/agents/:id status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Agent store.Agent `json:"agent"`
	}
	decodeJSON(t, updateResp, &payload)
	if payload.Agent.ModelPreference != "gpt-5.4" || payload.Agent.RuntimePreference != "shock-sidecar" {
		t.Fatalf("updated agent = %#v, want custom model + runtime preference persisted", payload.Agent)
	}
}
