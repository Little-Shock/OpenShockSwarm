package github

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreatePullRequestUsesGitHubAppEffectiveAuthPath(t *testing.T) {
	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID", "67890")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))

	var createPayload struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Head  string `json:"head"`
		Base  string `json:"base"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Fatalf("token request missing bearer auth: %#v", r.Header)
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodPost && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls":
			if got := r.Header.Get("Authorization"); got != "Bearer app-install-token" {
				t.Fatalf("create auth header = %q, want installation token", got)
			}
			if err := json.NewDecoder(r.Body).Decode(&createPayload); err != nil {
				t.Fatalf("decode create payload: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"number": 52})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/52":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     52,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/52",
				"title":      "runtime: surface heartbeat and lane state",
				"state":      "open",
				"draft":      false,
				"merged":     false,
				"updated_at": "2026-04-06T11:20:00Z",
				"head":       map[string]any{"ref": "feat/runtime-shell"},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"repository": map[string]any{
						"pullRequest": map[string]any{
							"reviewDecision": "REVIEW_REQUIRED",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", server.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", server.URL+"/graphql")

	service := NewService(fakeRunner{
		outputs: map[string]fakeOutput{
			"git -C E:\\repo remote get-url origin":             {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C E:\\repo rev-parse --abbrev-ref HEAD":       {text: "main"},
			"git -C E:\\repo push -u origin feat/runtime-shell": {text: "branch pushed"},
		},
	})

	pullRequest, err := service.CreatePullRequest(`E:\repo`, CreatePullRequestInput{
		Repo:       "Larkspur-Wang/OpenShock",
		BaseBranch: "main",
		HeadBranch: "feat/runtime-shell",
		Title:      "runtime: surface heartbeat and lane state",
		Body:       "issue: OPS-12",
	})
	if err != nil {
		t.Fatalf("CreatePullRequest() error = %v", err)
	}
	if createPayload.Head != "feat/runtime-shell" || createPayload.Base != "main" {
		t.Fatalf("create payload branches = %#v, want feat/runtime-shell -> main", createPayload)
	}
	if pullRequest.Number != 52 || pullRequest.ReviewDecision != "REVIEW_REQUIRED" {
		t.Fatalf("pull request = %#v, want app-backed created snapshot", pullRequest)
	}
}

func TestSyncPullRequestUsesGitHubAppEffectiveAuthPath(t *testing.T) {
	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID", "67890")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/73":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     73,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/73",
				"title":      "Sync Remote PR",
				"state":      "open",
				"draft":      false,
				"merged":     false,
				"updated_at": "2026-04-06T11:22:00Z",
				"head":       map[string]any{"ref": "feat/runtime-shell"},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"repository": map[string]any{
						"pullRequest": map[string]any{
							"reviewDecision": "CHANGES_REQUESTED",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", server.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", server.URL+"/graphql")

	service := NewService(fakeRunner{
		outputs: map[string]fakeOutput{
			"git -C E:\\repo remote get-url origin":       {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C E:\\repo rev-parse --abbrev-ref HEAD": {text: "main"},
		},
	})

	pullRequest, err := service.SyncPullRequest(`E:\repo`, SyncPullRequestInput{
		Repo:   "Larkspur-Wang/OpenShock",
		Number: 73,
	})
	if err != nil {
		t.Fatalf("SyncPullRequest() error = %v", err)
	}
	if pullRequest.Number != 73 || pullRequest.ReviewDecision != "CHANGES_REQUESTED" {
		t.Fatalf("pull request = %#v, want app-backed synced snapshot", pullRequest)
	}
}

func TestSyncPullRequestFailsClosedWhenGitHubAppReviewDecisionQueryFails(t *testing.T) {
	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID", "67890")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/73":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     73,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/73",
				"title":      "Sync Remote PR",
				"state":      "open",
				"draft":      false,
				"merged":     false,
				"updated_at": "2026-04-06T11:22:00Z",
				"head":       map[string]any{"ref": "feat/runtime-shell"},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "graphql review decision timeout"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", server.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", server.URL+"/graphql")

	service := NewService(fakeRunner{
		outputs: map[string]fakeOutput{
			"git -C E:\\repo remote get-url origin":       {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C E:\\repo rev-parse --abbrev-ref HEAD": {text: "main"},
		},
	})

	_, err := service.SyncPullRequest(`E:\repo`, SyncPullRequestInput{
		Repo:   "Larkspur-Wang/OpenShock",
		Number: 73,
	})
	if err == nil || !strings.Contains(err.Error(), "graphql review decision timeout") {
		t.Fatalf("SyncPullRequest() error = %v, want graphql review decision timeout", err)
	}
}

func TestSyncPullRequestUsesPersistedInstallationStateWhenEnvInstallationIDIsMissing(t *testing.T) {
	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))

	root := t.TempDir()
	if err := SaveInstallationState(root, InstallationState{
		InstallationID:  "67890",
		InstallationURL: "https://github.com/settings/installations/67890",
		SetupAction:     "install",
	}); err != nil {
		t.Fatalf("SaveInstallationState() error = %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/73":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     73,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/73",
				"title":      "Sync Remote PR",
				"state":      "open",
				"draft":      false,
				"merged":     false,
				"updated_at": "2026-04-06T11:22:00Z",
				"head":       map[string]any{"ref": "feat/runtime-shell"},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"repository": map[string]any{
						"pullRequest": map[string]any{
							"reviewDecision": "APPROVED",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", server.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", server.URL+"/graphql")

	service := NewService(fakeRunner{
		outputs: map[string]fakeOutput{
			"git -C " + root + " remote get-url origin":       {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C " + root + " rev-parse --abbrev-ref HEAD": {text: "main"},
		},
	})

	pullRequest, err := service.SyncPullRequest(root, SyncPullRequestInput{
		Repo:   "Larkspur-Wang/OpenShock",
		Number: 73,
	})
	if err != nil {
		t.Fatalf("SyncPullRequest() error = %v", err)
	}
	if pullRequest.Number != 73 || pullRequest.ReviewDecision != "APPROVED" {
		t.Fatalf("pull request = %#v, want persisted-installation synced snapshot", pullRequest)
	}
	if _, err := LoadInstallationState(root); err != nil {
		t.Fatalf("LoadInstallationState() error = %v", err)
	}
}

func TestMergePullRequestUsesGitHubAppEffectiveAuthPath(t *testing.T) {
	t.Setenv("OPENSHOCK_GITHUB_APP_ID", "12345")
	t.Setenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID", "67890")
	t.Setenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY", testGitHubAppPrivateKeyPEM(t))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/67890/access_tokens":
			_ = json.NewEncoder(w).Encode(map[string]string{"token": "app-install-token"})
		case r.Method == http.MethodPut && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/42/merge":
			_ = json.NewEncoder(w).Encode(map[string]any{"merged": true})
		case r.Method == http.MethodGet && r.URL.Path == "/repos/Larkspur-Wang/OpenShock/pulls/42":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"number":     42,
				"html_url":   "https://github.com/Larkspur-Wang/OpenShock/pull/42",
				"title":      "runtime: surface heartbeat and lane state",
				"state":      "closed",
				"draft":      false,
				"merged":     true,
				"merged_at":  "2026-04-06T11:24:00Z",
				"updated_at": "2026-04-06T11:24:00Z",
				"head":       map[string]any{"ref": "feat/runtime-shell"},
				"base":       map[string]any{"ref": "main"},
				"user":       map[string]any{"login": "CodexDockmaster"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/graphql":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"repository": map[string]any{
						"pullRequest": map[string]any{
							"reviewDecision": "APPROVED",
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("OPENSHOCK_GITHUB_API_BASE_URL", server.URL)
	t.Setenv("OPENSHOCK_GITHUB_GRAPHQL_URL", server.URL+"/graphql")

	service := NewService(fakeRunner{
		outputs: map[string]fakeOutput{
			"git -C E:\\repo remote get-url origin":       {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C E:\\repo rev-parse --abbrev-ref HEAD": {text: "main"},
		},
	})

	pullRequest, err := service.MergePullRequest(`E:\repo`, MergePullRequestInput{
		Repo:   "Larkspur-Wang/OpenShock",
		Number: 42,
	})
	if err != nil {
		t.Fatalf("MergePullRequest() error = %v", err)
	}
	if !pullRequest.Merged || pullRequest.State != "CLOSED" {
		t.Fatalf("pull request = %#v, want merged app-backed snapshot", pullRequest)
	}
}

func testGitHubAppPrivateKeyPEM(t *testing.T) string {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}

	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}))
}
