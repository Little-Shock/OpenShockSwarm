package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type recordingGitHubCallbackClient struct {
	status     githubsvc.Status
	syncInputs []githubsvc.SyncPullRequestInput
}

func (c *recordingGitHubCallbackClient) Probe(_ string) (githubsvc.Status, error) {
	return c.status, nil
}

func (c *recordingGitHubCallbackClient) CreatePullRequest(string, githubsvc.CreatePullRequestInput) (githubsvc.PullRequest, error) {
	return githubsvc.PullRequest{}, nil
}

func (c *recordingGitHubCallbackClient) SyncPullRequest(_ string, input githubsvc.SyncPullRequestInput) (githubsvc.PullRequest, error) {
	c.syncInputs = append(c.syncInputs, input)
	return githubsvc.PullRequest{
		Number:         input.Number,
		URL:            fmt.Sprintf("https://github.com/%s/pull/%d", input.Repo, input.Number),
		Title:          "Synced Pull Request",
		State:          "OPEN",
		ReviewDecision: "APPROVED",
		HeadRefName:    "feature/callback-sync",
		BaseRefName:    "main",
		Author:         "GitHub App Bot",
	}, nil
}

func (c *recordingGitHubCallbackClient) MergePullRequest(string, githubsvc.MergePullRequestInput) (githubsvc.PullRequest, error) {
	return githubsvc.PullRequest{}, nil
}

func TestGitHubInstallationCallbackPersistsInstallTruthAndRefreshesRepoBinding(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	if _, err := s.SyncPullRequestFromRemote("pr-runtime-18", store.PullRequestRemoteSnapshot{
		Number:         18,
		Title:          "runtime: surface heartbeat and lane state in discussion room",
		Status:         "in_review",
		Branch:         "feat/runtime-state-shell",
		BaseBranch:     "main",
		Author:         "Codex Dockmaster",
		Provider:       "github",
		URL:            "https://github.com/example/phase-zero/pull/18",
		ReviewDecision: "REVIEW_REQUIRED",
		ReviewSummary:  "等待 GitHub App callback 后的 current sync。",
		UpdatedAt:      "刚刚",
	}); err != nil {
		t.Fatalf("SyncPullRequestFromRemote() seed error = %v", err)
	}

	client := &recordingGitHubCallbackClient{
		status: githubsvc.Status{
			Repo:              "example/phase-zero",
			RepoURL:           "https://github.com/example/phase-zero.git",
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
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        client,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(GitHubInstallationCallbackRequest{
		InstallationID: "67890",
		SetupAction:    "install",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/github/installation-callback", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST installation callback error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload GitHubInstallationCallbackResponse
	decodeJSON(t, resp, &payload)
	if payload.Binding.AuthMode != "github-app" {
		t.Fatalf("binding auth mode = %q, want github-app", payload.Binding.AuthMode)
	}
	if payload.Binding.BindingStatus != "bound" {
		t.Fatalf("binding status = %q, want bound", payload.Binding.BindingStatus)
	}
	if payload.State == nil {
		t.Fatal("payload.State = nil, want refreshed state")
	}
	if payload.State.Workspace.RepoAuthMode != "github-app" {
		t.Fatalf("workspace repo auth mode = %q, want github-app", payload.State.Workspace.RepoAuthMode)
	}
	if payload.SyncedPullCount != 1 || len(client.syncInputs) != payload.SyncedPullCount {
		t.Fatalf("sync count = %d / %#v, want callback-triggered PR backfill", payload.SyncedPullCount, client.syncInputs)
	}
	if client.syncInputs[0].Repo != "example/phase-zero" {
		t.Fatalf("sync repo = %q, want example/phase-zero", client.syncInputs[0].Repo)
	}

	installationState, err := githubsvc.LoadInstallationState(root)
	if err != nil {
		t.Fatalf("LoadInstallationState() error = %v", err)
	}
	if installationState.InstallationID != "67890" || installationState.SetupAction != "install" {
		t.Fatalf("installation state = %#v, want persisted callback truth", installationState)
	}
}

func TestGitHubInstallationCallbackRejectsMissingInstallationID(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
	statePath := filepath.Join(root, "data", "state.json")

	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}

	client := &recordingGitHubCallbackClient{
		status: githubsvc.Status{
			Repo:             "example/phase-zero",
			RepoURL:          "https://github.com/example/phase-zero.git",
			Branch:           "main",
			Provider:         "github",
			RemoteConfigured: true,
		},
	}

	server := httptest.NewServer(New(s, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub:        client,
	}).Handler())
	defer server.Close()

	body, err := json.Marshal(GitHubInstallationCallbackRequest{})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	resp, err := http.Post(server.URL+"/v1/github/installation-callback", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST installation callback error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	var payload struct {
		Error string `json:"error"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Error != "installationId is required" {
		t.Fatalf("error = %q, want installationId validation failure", payload.Error)
	}
	if _, err := githubsvc.LoadInstallationState(root); err == nil {
		t.Fatal("LoadInstallationState() succeeded, want no persisted installation state on invalid callback")
	}
	if len(client.syncInputs) != 0 {
		t.Fatalf("syncInputs = %#v, want no PR backfill when installationId is missing", client.syncInputs)
	}
}
