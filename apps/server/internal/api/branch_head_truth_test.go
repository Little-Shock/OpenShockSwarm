package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestBranchHeadTruthEndpointReturnsAlignedTruth(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
	ignoreRepoRuntimeArtifacts(t, root)
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
		DetectedAt: "2026-04-09T10:00:00Z",
		SyncedAt:   "2026-04-09T10:00:00Z",
	}); err != nil {
		t.Fatalf("UpdateRepoBinding() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: fakeGitHubProber{
			status: githubsvc.Status{
				Repo:              "example/phase-zero",
				RepoURL:           "https://github.com/example/phase-zero.git",
				Branch:            "main",
				Provider:          "github",
				RemoteConfigured:  true,
				AuthMode:          "gh-cli",
				PreferredAuthMode: "gh-cli",
				Ready:             true,
				Message:           "GitHub CLI 已认证，可以继续推进真实远端 PR 集成。",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/workspace/branch-head-truth")
	if err != nil {
		t.Fatalf("GET branch-head-truth error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload branchHeadTruthResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.Status != "aligned" {
		t.Fatalf("payload.Status = %q, want aligned; drifts=%#v", payload.Status, payload.Drifts)
	}
	if payload.RepoBinding.Branch != "main" {
		t.Fatalf("repo binding branch = %q, want main", payload.RepoBinding.Branch)
	}
	if payload.Checkout.Branch != "main" {
		t.Fatalf("checkout branch = %q, want main", payload.Checkout.Branch)
	}
	if payload.Checkout.Head == "" {
		t.Fatalf("checkout head empty, want current short head")
	}
	if payload.LiveService.Managed {
		t.Fatalf("live service managed = true, want unmanaged without metadata")
	}
	if len(payload.Drifts) != 0 {
		t.Fatalf("drifts = %#v, want none", payload.Drifts)
	}
	if payload.LinkedWorktreeCount != 1 {
		t.Fatalf("linkedWorktreeCount = %d, want 1", payload.LinkedWorktreeCount)
	}
}

func TestBranchHeadTruthEndpointFlagsDriftAcrossBindingCheckoutAndLiveService(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
	ignoreRepoRuntimeArtifacts(t, root)
	runGitForBindingTest(t, root, "branch", "dev")

	devWorktree := filepath.Join(t.TempDir(), "dev-worktree")
	runGitForBindingTest(t, root, "worktree", "add", devWorktree, "dev")
	runGitForBindingTest(t, root, "checkout", "-b", "tkt-24-frontend-interaction-polish")

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
		DetectedAt: "2026-04-09T10:05:00Z",
		SyncedAt:   "2026-04-09T10:05:00Z",
	}); err != nil {
		t.Fatalf("UpdateRepoBinding() error = %v", err)
	}

	head := runGitForBindingTest(t, devWorktree, "rev-parse", "--short", "HEAD")
	metadataPath := filepath.Join(root, "data", "ops", "live-server.json")
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		t.Fatalf("MkdirAll(metadata) error = %v", err)
	}
	if err := os.WriteFile(metadataPath, []byte(`{
  "service": "openshock-server",
  "owner": "@Jerome_架构",
  "pid": 4242,
  "workspaceRoot": "`+devWorktree+`",
  "repoRoot": "`+root+`",
  "address": ":8080",
  "baseUrl": "http://127.0.0.1:8080",
  "healthUrl": "http://127.0.0.1:8080/healthz",
  "stateUrl": "http://127.0.0.1:8080/v1/state",
  "logPath": "`+filepath.Join(root, "data", "logs", "openshock-server.log")+`",
  "branch": "dev",
  "head": "`+head+`",
  "status": "running",
  "statusCommand": "pnpm ops:live-server:status",
  "startCommand": "pnpm ops:live-server:start",
  "stopCommand": "pnpm ops:live-server:stop",
  "reloadCommand": "pnpm ops:live-server:reload"
}`), 0o644); err != nil {
		t.Fatalf("WriteFile(metadata) error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: fakeGitHubProber{
			status: githubsvc.Status{
				Repo:              "example/phase-zero",
				RepoURL:           "https://github.com/example/phase-zero.git",
				Branch:            "tkt-24-frontend-interaction-polish",
				Provider:          "github",
				RemoteConfigured:  true,
				AuthMode:          "gh-cli",
				PreferredAuthMode: "gh-cli",
				Ready:             true,
				Message:           "GitHub CLI 已认证，可以继续推进真实远端 PR 集成。",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/workspace/branch-head-truth")
	if err != nil {
		t.Fatalf("GET branch-head-truth error = %v", err)
	}
	defer resp.Body.Close()

	var payload branchHeadTruthResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.Status != "drift" {
		t.Fatalf("payload.Status = %q, want drift", payload.Status)
	}
	if payload.RepoBinding.Branch != "dev" {
		t.Fatalf("repo binding branch = %q, want dev", payload.RepoBinding.Branch)
	}
	if payload.Checkout.Branch != "tkt-24-frontend-interaction-polish" {
		t.Fatalf("checkout branch = %q, want tkt-24-frontend-interaction-polish", payload.Checkout.Branch)
	}
	if !payload.LiveService.Managed || payload.LiveService.Branch != "dev" {
		t.Fatalf("live service = %#v, want managed dev truth", payload.LiveService)
	}
	if payload.LinkedWorktreeCount != 2 {
		t.Fatalf("linkedWorktreeCount = %d, want 2", payload.LinkedWorktreeCount)
	}
	assertDriftKindPresent(t, payload.Drifts, "binding_vs_checkout_branch")
	assertDriftKindPresent(t, payload.Drifts, "live_service_workspace_root")
	assertDriftKindPresent(t, payload.Drifts, "linked_worktrees_visible")
}

func assertDriftKindPresent(t *testing.T, drifts []branchHeadDrift, want string) {
	t.Helper()
	for _, drift := range drifts {
		if drift.Kind == want {
			return
		}
	}
	t.Fatalf("drift kind %q missing from %#v", want, drifts)
}

func ignoreRepoRuntimeArtifacts(t *testing.T, root string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("data/\nMEMORY.md\nnotes/\ndecisions/\n.openshock/\n"), 0o644); err != nil {
		t.Fatalf("write .gitignore: %v", err)
	}
	runGitForBindingTest(t, root, "add", ".gitignore")
	runGitForBindingTest(t, root, "commit", "-m", "ignore runtime artifacts")
}
