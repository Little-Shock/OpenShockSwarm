package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type fakeGitHubProber struct {
	status githubsvc.Status
	err    error
}

func (f fakeGitHubProber) Probe(_ string) (githubsvc.Status, error) {
	return f.status, f.err
}

func (f fakeGitHubProber) CreatePullRequest(string, githubsvc.CreatePullRequestInput) (githubsvc.PullRequest, error) {
	return githubsvc.PullRequest{}, nil
}

func (f fakeGitHubProber) SyncPullRequest(string, githubsvc.SyncPullRequestInput) (githubsvc.PullRequest, error) {
	return githubsvc.PullRequest{}, nil
}

func (f fakeGitHubProber) MergePullRequest(string, githubsvc.MergePullRequestInput) (githubsvc.PullRequest, error) {
	return githubsvc.PullRequest{}, nil
}

func TestGitHubConnectionEndpointReturnsProbeStatus(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: fakeGitHubProber{
			status: githubsvc.Status{
				Repo:             "Larkspur-Wang/OpenShock",
				RepoURL:          "https://github.com/Larkspur-Wang/OpenShock.git",
				Branch:           "main",
				Provider:         "github",
				RemoteConfigured: true,
				GHCLIInstalled:   true,
				GHAuthenticated:  true,
				Ready:            true,
				AuthMode:         "gh-cli",
				Message:          "GitHub CLI 已认证，可以继续推进真实远端 PR 集成。",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/github/connection")
	if err != nil {
		t.Fatalf("GET github connection error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload githubsvc.Status
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if !payload.Ready {
		t.Fatalf("payload.Ready = false, want true")
	}
	if payload.AuthMode != "gh-cli" {
		t.Fatalf("payload.AuthMode = %q, want gh-cli", payload.AuthMode)
	}
}

func TestGitHubConnectionEndpointReturnsGitHubAppContract(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: fakeGitHubProber{
			status: githubsvc.Status{
				Repo:              "Larkspur-Wang/OpenShock",
				RepoURL:           "https://github.com/Larkspur-Wang/OpenShock.git",
				Branch:            "main",
				Provider:          "github",
				RemoteConfigured:  true,
				AppID:             "12345",
				AppSlug:           "openshock-app",
				AppConfigured:     true,
				AppInstalled:      true,
				InstallationID:    "67890",
				InstallationURL:   "https://github.com/settings/installations/67890",
				Ready:             true,
				AuthMode:          "github-app",
				PreferredAuthMode: "github-app",
				Message:           "GitHub App installation 已就绪，可以继续推进 repo binding 与 webhook contract。",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/github/connection")
	if err != nil {
		t.Fatalf("GET github connection error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload githubsvc.Status
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.AuthMode != "github-app" {
		t.Fatalf("payload.AuthMode = %q, want github-app", payload.AuthMode)
	}
	if payload.PreferredAuthMode != "github-app" {
		t.Fatalf("payload.PreferredAuthMode = %q, want github-app", payload.PreferredAuthMode)
	}
	if !payload.AppConfigured || !payload.AppInstalled {
		t.Fatalf("payload app readiness = (%t, %t), want true/true", payload.AppConfigured, payload.AppInstalled)
	}
	if payload.InstallationID != "67890" {
		t.Fatalf("payload.InstallationID = %q, want 67890", payload.InstallationID)
	}
}

func TestGitHubConnectionEndpointSurfacesEffectiveAuthModeWhenGitHubAppFallsBackToGHCLI(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: fakeGitHubProber{
			status: githubsvc.Status{
				Repo:              "Larkspur-Wang/OpenShock",
				RepoURL:           "https://github.com/Larkspur-Wang/OpenShock.git",
				Branch:            "main",
				Provider:          "github",
				RemoteConfigured:  true,
				GHCLIInstalled:    true,
				GHAuthenticated:   true,
				AppID:             "12345",
				AppSlug:           "openshock-app",
				Ready:             true,
				AuthMode:          "gh-cli",
				PreferredAuthMode: "github-app",
				Message:           "GitHub App 配置不完整，缺少 privateKey / installationId；当前仍退回 gh CLI。",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/github/connection")
	if err != nil {
		t.Fatalf("GET github connection error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload githubsvc.Status
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if payload.AuthMode != "gh-cli" {
		t.Fatalf("payload.AuthMode = %q, want gh-cli", payload.AuthMode)
	}
	if payload.PreferredAuthMode != "github-app" {
		t.Fatalf("payload.PreferredAuthMode = %q, want github-app", payload.PreferredAuthMode)
	}
}
