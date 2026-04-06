package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRepoBindingScansLocalGitOriginAndPersists(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
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
				Provider: "github",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/repo/binding", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("POST repo binding error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("repo binding status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Binding RepoBindingResponse `json:"binding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode repo binding payload: %v", err)
	}
	if payload.Binding.Repo != "example/phase-zero" {
		t.Fatalf("repo = %q, want example/phase-zero", payload.Binding.Repo)
	}
	if payload.Binding.Branch != "main" {
		t.Fatalf("branch = %q, want main", payload.Binding.Branch)
	}
	if payload.Binding.Provider != "github" {
		t.Fatalf("provider = %q, want github", payload.Binding.Provider)
	}
	if payload.Binding.AuthMode != "local-git-origin" {
		t.Fatalf("auth mode = %q, want local-git-origin", payload.Binding.AuthMode)
	}

	restartedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("restart store.New() error = %v", err)
	}
	restarted := httptest.NewServer(New(restartedStore, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
		GitHub: fakeGitHubProber{
			status: githubsvc.Status{
				Provider: "github",
			},
		},
	}).Handler())
	defer restarted.Close()

	getResp, err := http.Get(restarted.URL + "/v1/repo/binding")
	if err != nil {
		t.Fatalf("GET repo binding error = %v", err)
	}
	defer getResp.Body.Close()

	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("repo binding GET status = %d, want %d", getResp.StatusCode, http.StatusOK)
	}
	var persisted RepoBindingResponse
	if err := json.NewDecoder(getResp.Body).Decode(&persisted); err != nil {
		t.Fatalf("decode persisted repo binding payload: %v", err)
	}
	if persisted.Repo != "example/phase-zero" {
		t.Fatalf("persisted repo = %q, want example/phase-zero", persisted.Repo)
	}
	if persisted.BindingStatus != "bound" {
		t.Fatalf("persisted binding status = %q, want bound", persisted.BindingStatus)
	}
	if persisted.ConnectionReady {
		t.Fatalf("persisted.ConnectionReady = true, want false")
	}
}

func TestParseRepoIdentitySupportsHTTPAndSSH(t *testing.T) {
	tests := []struct {
		name     string
		remote   string
		wantRepo string
		wantProv string
	}{
		{name: "https", remote: "https://github.com/Larkspur-Wang/OpenShock.git", wantRepo: "Larkspur-Wang/OpenShock", wantProv: "github"},
		{name: "ssh", remote: "git@github.com:Larkspur-Wang/OpenShock.git", wantRepo: "Larkspur-Wang/OpenShock", wantProv: "github"},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			gotRepo, gotProv := parseRepoIdentity(testCase.remote)
			if gotRepo != testCase.wantRepo || gotProv != testCase.wantProv {
				t.Fatalf("parseRepoIdentity(%q) = (%q, %q), want (%q, %q)", testCase.remote, gotRepo, gotProv, testCase.wantRepo, testCase.wantProv)
			}
		})
	}
}

func TestRepoBindingPromotesToGitHubAppWhenConnectionIsReady(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
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
				Repo:             "example/phase-zero",
				RepoURL:          "https://github.com/example/phase-zero.git",
				Branch:           "main",
				Provider:         "github",
				RemoteConfigured: true,
				AppID:            "12345",
				AppSlug:          "openshock-app",
				AppConfigured:    true,
				AppInstalled:     true,
				InstallationID:   "67890",
				InstallationURL:  "https://github.com/settings/installations/67890",
				Ready:            true,
				AuthMode:         "github-app",
				Message:          "GitHub App installation 已就绪。",
			},
		},
	}).Handler())
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/repo/binding", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("POST repo binding error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("repo binding status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Binding    RepoBindingResponse `json:"binding"`
		Connection githubsvc.Status    `json:"connection"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode repo binding payload: %v", err)
	}
	if payload.Binding.AuthMode != "github-app" {
		t.Fatalf("binding auth mode = %q, want github-app", payload.Binding.AuthMode)
	}
	if !payload.Binding.ConnectionReady || !payload.Binding.AppInstalled {
		t.Fatalf("binding app contract = (%t, %t), want true/true", payload.Binding.ConnectionReady, payload.Binding.AppInstalled)
	}
	if payload.Binding.InstallationID != "67890" {
		t.Fatalf("binding installation id = %q, want 67890", payload.Binding.InstallationID)
	}
	if payload.Connection.AuthMode != "github-app" {
		t.Fatalf("connection auth mode = %q, want github-app", payload.Connection.AuthMode)
	}
}

func TestRepoBindingReturnsExplicitContractWhenGitHubAppIsNotInstalled(t *testing.T) {
	root := initGitBindingRepo(t, "https://github.com/example/phase-zero.git")
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
				Repo:             "example/phase-zero",
				RepoURL:          "https://github.com/example/phase-zero.git",
				Branch:           "main",
				Provider:         "github",
				RemoteConfigured: true,
				AppID:            "12345",
				AppSlug:          "openshock-app",
				AppConfigured:    true,
				AppInstalled:     false,
				InstallationURL:  "https://github.com/apps/openshock-app/installations/new",
				AuthMode:         "github-app",
				Message:          "GitHub App 已配置，但 installation 还未完成。",
			},
		},
	}).Handler())
	defer server.Close()

	body := bytes.NewReader([]byte(`{"authMode":"github-app"}`))
	resp, err := http.Post(server.URL+"/v1/repo/binding", "application/json", body)
	if err != nil {
		t.Fatalf("POST repo binding error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("repo binding status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}

	var payload struct {
		Error      string              `json:"error"`
		Binding    RepoBindingResponse `json:"binding"`
		Connection githubsvc.Status    `json:"connection"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode repo binding failure payload: %v", err)
	}
	if !strings.Contains(payload.Error, "installation") {
		t.Fatalf("error = %q, want installation contract failure", payload.Error)
	}
	if payload.Binding.BindingStatus != "blocked" {
		t.Fatalf("binding status = %q, want blocked", payload.Binding.BindingStatus)
	}
	if payload.Binding.AuthMode != "github-app" {
		t.Fatalf("binding auth mode = %q, want github-app", payload.Binding.AuthMode)
	}
	if payload.Binding.AppInstalled {
		t.Fatalf("binding AppInstalled = true, want false")
	}
	if payload.Connection.AppInstalled {
		t.Fatalf("connection AppInstalled = true, want false")
	}
}

func initGitBindingRepo(t *testing.T, remote string) string {
	t.Helper()

	root := t.TempDir()
	runGitForBindingTest(t, root, "init", "-b", "main")
	runGitForBindingTest(t, root, "config", "user.name", "OpenShock Test")
	runGitForBindingTest(t, root, "config", "user.email", "openshock@example.com")
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# binding\n"), 0o644); err != nil {
		t.Fatalf("write README.md: %v", err)
	}
	runGitForBindingTest(t, root, "add", ".")
	runGitForBindingTest(t, root, "commit", "-m", "init")
	runGitForBindingTest(t, root, "remote", "add", "origin", remote)
	return root
}

func runGitForBindingTest(t *testing.T, dir string, args ...string) string {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, string(output))
	}
	return strings.TrimSpace(string(output))
}
