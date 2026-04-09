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

func TestLiveRolloutParityEndpointFlagsActualLiveDrift(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
	ignoreLiveRolloutRuntimeArtifacts(t, root)
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.UpdateRepoBinding(store.RepoBindingInput{
		Repo:       "example/phase-zero",
		RepoURL:    "https://github.com/example/phase-zero.git",
		Branch:     "dev",
		Provider:   "github",
		AuthMode:   "local-git-origin",
		DetectedAt: "2026-04-09T11:00:00Z",
		SyncedAt:   "2026-04-09T11:00:00Z",
	}); err != nil {
		t.Fatalf("UpdateRepoBinding() error = %v", err)
	}

	actualLive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
		case "/v1/state":
			writeJSON(w, http.StatusOK, map[string]any{
				"workspace": map[string]any{
					"repo":   "example/phase-zero",
					"branch": "main",
					"onboarding": map[string]any{
						"status": "ready",
					},
				},
				"auth": map[string]any{
					"session": map[string]any{
						"preferences": map[string]any{
							"startRoute": "/access",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer actualLive.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		ActualLiveURL: actualLive.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/workspace/live-rollout-parity")
	if err != nil {
		t.Fatalf("GET live-rollout-parity error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload liveRolloutParityResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}

	if payload.Status != "drift" {
		t.Fatalf("payload.Status = %q, want drift; drifts=%#v", payload.Status, payload.Drifts)
	}
	if payload.Current.StartRoute != "/chat/all" {
		t.Fatalf("current start route = %q, want /chat/all", payload.Current.StartRoute)
	}
	if payload.Actual.State.StartRoute != "/access" {
		t.Fatalf("actual live start route = %q, want /access", payload.Actual.State.StartRoute)
	}
	assertLiveRolloutDriftKindPresent(t, payload.Drifts, "missing_live_service_route")
	assertLiveRolloutDriftKindPresent(t, payload.Drifts, "missing_experience_metrics_route")
	assertLiveRolloutDriftKindPresent(t, payload.Drifts, "actual_live_branch_mismatch")
	assertLiveRolloutDriftKindPresent(t, payload.Drifts, "actual_live_first_screen_not_collaboration_shell")
	assertLiveRolloutDriftKindPresent(t, payload.Drifts, "actual_live_first_screen_mismatch")
}

func TestLiveRolloutParityEndpointReturnsAlignedTruth(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
	ignoreLiveRolloutRuntimeArtifacts(t, root)
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.UpdateRepoBinding(store.RepoBindingInput{
		Repo:       "example/phase-zero",
		RepoURL:    "https://github.com/example/phase-zero.git",
		Branch:     "main",
		Provider:   "github",
		AuthMode:   "local-git-origin",
		DetectedAt: "2026-04-09T11:05:00Z",
		SyncedAt:   "2026-04-09T11:05:00Z",
	}); err != nil {
		t.Fatalf("UpdateRepoBinding() error = %v", err)
	}

	currentSnapshot := s.ExperienceMetrics()
	actualLive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
		case "/v1/state":
			writeJSON(w, http.StatusOK, map[string]any{
				"workspace": map[string]any{
					"repo":   "example/phase-zero",
					"branch": "main",
					"onboarding": map[string]any{
						"status": "ready",
					},
				},
				"auth": map[string]any{
					"session": map[string]any{
						"preferences": map[string]any{
							"startRoute": "/chat/all",
						},
					},
				},
			})
		case "/v1/runtime/live-service":
			writeJSON(w, http.StatusOK, liveServiceStatusResponse{
				Service:      "openshock-server",
				Managed:      true,
				Status:       "running",
				Owner:        "@Max_开发",
				Branch:       "main",
				Head:         "47cd54e",
				MetadataPath: filepath.Join(root, "data", "ops", "live-server.json"),
			})
		case "/v1/experience-metrics":
			writeJSON(w, http.StatusOK, currentSnapshot)
		default:
			http.NotFound(w, r)
		}
	}))
	defer actualLive.Close()

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		ActualLiveURL: actualLive.URL,
		WorkspaceRoot: root,
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/workspace/live-rollout-parity")
	if err != nil {
		t.Fatalf("GET live-rollout-parity error = %v", err)
	}
	defer resp.Body.Close()

	var payload liveRolloutParityResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.Status != "aligned" {
		t.Fatalf("payload.Status = %q, want aligned; drifts=%#v", payload.Status, payload.Drifts)
	}
	if payload.Current.StartRoute != "/chat/all" {
		t.Fatalf("current start route = %q, want /chat/all", payload.Current.StartRoute)
	}
	if !payload.Actual.LiveService.Available || !payload.Actual.ExperienceMetrics.Available {
		t.Fatalf("actual live route availability = %#v, want live-service + experience-metrics available", payload.Actual)
	}
	if len(payload.Drifts) != 0 {
		t.Fatalf("drifts = %#v, want none", payload.Drifts)
	}
}

func assertLiveRolloutDriftKindPresent(t *testing.T, drifts []liveRolloutParityDrift, want string) {
	t.Helper()
	for _, drift := range drifts {
		if drift.Kind == want {
			return
		}
	}
	t.Fatalf("drift kind %q missing from %#v", want, drifts)
}

func ignoreLiveRolloutRuntimeArtifacts(t *testing.T, root string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("data/\nMEMORY.md\nnotes/\ndecisions/\n.openshock/\n"), 0o644); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}
	runGitForBindingTest(t, root, "add", ".gitignore")
	runGitForBindingTest(t, root, "commit", "-m", "ignore runtime artifacts")
}
