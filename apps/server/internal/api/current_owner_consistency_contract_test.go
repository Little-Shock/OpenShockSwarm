package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestCurrentOwnerFallbackKeepsRunDetailMemoryPreviewAndGovernanceAligned(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	snapshot := s.Snapshot()
	for index := range snapshot.Runs {
		if snapshot.Runs[index].ID != "run_runtime_01" {
			continue
		}
		snapshot.Runs[index].Owner = ""
		snapshot.Runs[index].NextAction = "请当前 reviewer 继续收口 runtime pairing。"
	}
	for index := range snapshot.Issues {
		if snapshot.Issues[index].ID != "issue-runtime" {
			continue
		}
		snapshot.Issues[index].Owner = "Claude Review Runner"
	}
	for index := range snapshot.Rooms {
		if snapshot.Rooms[index].ID != "room-runtime" {
			continue
		}
		snapshot.Rooms[index].Topic.Owner = "Codex Dockmaster"
	}

	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent(snapshot) error = %v", err)
	}
	if err := os.WriteFile(statePath, payload, 0o644); err != nil {
		t.Fatalf("WriteFile(statePath) error = %v", err)
	}

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	if _, _, err := reloadedStore.LoginWithEmail(store.AuthLoginInput{
		Email:       "larkspur@openshock.dev",
		DeviceLabel: "Owner Browser",
	}); err != nil {
		t.Fatalf("LoginWithEmail(owner) error = %v", err)
	}
	server := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()
	mustEstablishContractBrowserSession(t, server.URL, "larkspur@openshock.dev", "Owner Browser")

	detailResp, err := http.Get(server.URL + "/v1/runs/run_runtime_01/detail")
	if err != nil {
		t.Fatalf("GET /v1/runs/run_runtime_01/detail error = %v", err)
	}
	defer detailResp.Body.Close()
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runs/run_runtime_01/detail status = %d, want %d", detailResp.StatusCode, http.StatusOK)
	}

	var detail store.RunDetail
	decodeJSON(t, detailResp, &detail)
	if detail.Run.Owner != "Claude Review Runner" {
		t.Fatalf("detail run owner = %q, want issue-backed current owner", detail.Run.Owner)
	}
	if len(detail.History) == 0 || detail.History[0].Run.Owner != "Claude Review Runner" {
		t.Fatalf("detail history = %#v, want normalized current owner in history", detail.History)
	}

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	defer centerResp.Body.Close()
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}

	var center store.MemoryCenter
	decodeJSON(t, centerResp, &center)
	preview := findPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "Claude Review Runner") || !strings.Contains(preview.PromptSummary, "Claude Code CLI") {
		t.Fatalf("preview summary = %q, want issue-backed reviewer profile", preview.PromptSummary)
	}
	if strings.Contains(preview.PromptSummary, "Codex Dockmaster") || strings.Contains(preview.PromptSummary, "gpt-5.3-codex") {
		t.Fatalf("preview summary = %q, should not fall back to stale recent-run owner", preview.PromptSummary)
	}

	stateResp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer stateResp.Body.Close()
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", stateResp.StatusCode, http.StatusOK)
	}

	var state store.State
	decodeJSON(t, stateResp, &state)
	if state.Workspace.Governance.ResponseAggregation.Aggregator != "Claude Review Runner" {
		t.Fatalf("response aggregation = %#v, want issue-backed current owner aggregator", state.Workspace.Governance.ResponseAggregation)
	}
	if state.Workspace.Governance.ResponseAggregation.FinalResponse != "请当前 reviewer 继续收口 runtime pairing。" {
		t.Fatalf("response aggregation final response = %q, want current room next-action truth", state.Workspace.Governance.ResponseAggregation.FinalResponse)
	}
	if state.Workspace.Governance.RoutingPolicy.SuggestedHandoff.FromAgent != "Claude Review Runner" ||
		state.Workspace.Governance.RoutingPolicy.SuggestedHandoff.FromLaneLabel != "Reviewer" {
		t.Fatalf("suggested handoff = %#v, want governance current owner aligned with reviewer lane", state.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
}
