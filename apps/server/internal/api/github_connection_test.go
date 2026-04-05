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
