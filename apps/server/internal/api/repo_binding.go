package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type RepoBindingRequest struct {
	Repo     string `json:"repo"`
	RepoURL  string `json:"repoUrl"`
	Branch   string `json:"branch"`
	Provider string `json:"provider"`
	AuthMode string `json:"authMode"`
}

type RepoBindingResponse struct {
	Repo              string   `json:"repo"`
	RepoURL           string   `json:"repoUrl"`
	Branch            string   `json:"branch"`
	Provider          string   `json:"provider"`
	BindingStatus     string   `json:"bindingStatus"`
	AuthMode          string   `json:"authMode"`
	PreferredAuthMode string   `json:"preferredAuthMode,omitempty"`
	DetectedAt        string   `json:"detectedAt"`
	ConnectionReady   bool     `json:"connectionReady"`
	AppConfigured     bool     `json:"appConfigured"`
	AppInstalled      bool     `json:"appInstalled"`
	InstallationID    string   `json:"installationId"`
	InstallationURL   string   `json:"installationUrl"`
	Missing           []string `json:"missing,omitempty"`
	ConnectionMessage string   `json:"connectionMessage"`
}

func (s *Server) handleRepoBinding(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.currentRepoBinding())
	case http.MethodPost:
		if !s.requireSessionPermission(w, "repo.admin") {
			return
		}
		var req RepoBindingRequest
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
		}

		detected, err := detectLocalRepoBinding(s.workspaceRoot)
		if err != nil && strings.TrimSpace(req.Repo) == "" && strings.TrimSpace(req.RepoURL) == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		connection, probeErr := s.github.Probe(s.workspaceRoot)
		binding := mergeRepoBindingInput(detected, req)
		binding = alignRepoBindingWithConnection(binding, req, probeErr, connection)
		if failure := validateRepoBindingConnection(binding, probeErr, connection); failure != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"error":      failure.Error(),
				"binding":    bindingResponseFromInput(binding, "blocked", &connection),
				"connection": connection,
			})
			return
		}
		nextState, updateErr := s.store.UpdateRepoBinding(binding)
		if updateErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": updateErr.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"binding":    bindingResponseFromWorkspace(nextState.Workspace, binding.DetectedAt, &connection),
			"connection": connection,
			"state":      nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) currentRepoBinding() RepoBindingResponse {
	workspace := s.store.Snapshot().Workspace
	connection, err := s.github.Probe(s.workspaceRoot)
	if err != nil {
		return bindingResponseFromWorkspace(workspace, "", nil)
	}
	return bindingResponseFromWorkspace(workspace, "", &connection)
}

func bindingResponseFromWorkspace(workspace store.WorkspaceSnapshot, detectedAt string, connection *githubsvc.Status) RepoBindingResponse {
	binding := storeBindingSnapshot(workspace)
	installation := workspaceGitHubInstallationSnapshot(workspace)
	if detectedAt == "" {
		detectedAt = binding.DetectedAt
	}
	return enrichRepoBindingResponse(RepoBindingResponse{
		Repo:              binding.Repo,
		RepoURL:           binding.RepoURL,
		Branch:            binding.Branch,
		Provider:          binding.Provider,
		BindingStatus:     binding.BindingStatus,
		AuthMode:          binding.AuthMode,
		PreferredAuthMode: installation.PreferredAuthMode,
		DetectedAt:        detectedAt,
		ConnectionReady:   installation.ConnectionReady,
		AppConfigured:     installation.AppConfigured,
		AppInstalled:      installation.AppInstalled,
		InstallationID:    installation.InstallationID,
		InstallationURL:   installation.InstallationURL,
		Missing:           append([]string{}, installation.Missing...),
		ConnectionMessage: installation.ConnectionMessage,
	}, connection)
}

func bindingResponseFromInput(binding store.RepoBindingInput, bindingStatus string, connection *githubsvc.Status) RepoBindingResponse {
	return enrichRepoBindingResponse(RepoBindingResponse{
		Repo:          binding.Repo,
		RepoURL:       binding.RepoURL,
		Branch:        binding.Branch,
		Provider:      binding.Provider,
		BindingStatus: bindingStatus,
		AuthMode:      binding.AuthMode,
		DetectedAt:    binding.DetectedAt,
	}, connection)
}

func enrichRepoBindingResponse(response RepoBindingResponse, connection *githubsvc.Status) RepoBindingResponse {
	if connection == nil {
		return response
	}
	response.ConnectionReady = connection.Ready
	response.PreferredAuthMode = connection.PreferredAuthMode
	response.AppConfigured = connection.AppConfigured
	response.AppInstalled = connection.AppInstalled
	response.InstallationID = connection.InstallationID
	response.InstallationURL = connection.InstallationURL
	if len(connection.Missing) > 0 {
		response.Missing = append([]string(nil), connection.Missing...)
	}
	response.ConnectionMessage = connection.Message
	if strings.TrimSpace(response.Provider) == "" {
		response.Provider = connection.Provider
	}
	return response
}

func mergeRepoBindingInput(detected store.RepoBindingInput, req RepoBindingRequest) store.RepoBindingInput {
	merged := detected
	if text := strings.TrimSpace(req.Repo); text != "" {
		merged.Repo = text
	}
	if text := strings.TrimSpace(req.RepoURL); text != "" {
		merged.RepoURL = text
	}
	if text := strings.TrimSpace(req.Branch); text != "" {
		merged.Branch = text
	}
	if text := strings.TrimSpace(req.Provider); text != "" {
		merged.Provider = text
	}
	if text := strings.TrimSpace(req.AuthMode); text != "" {
		merged.AuthMode = text
	}
	if strings.TrimSpace(merged.DetectedAt) == "" {
		merged.DetectedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if strings.TrimSpace(merged.SyncedAt) == "" {
		merged.SyncedAt = merged.DetectedAt
	}
	return merged
}

func alignRepoBindingWithConnection(binding store.RepoBindingInput, req RepoBindingRequest, probeErr error, connection githubsvc.Status) store.RepoBindingInput {
	binding.SyncedAt = time.Now().UTC().Format(time.RFC3339)
	binding.PreferredAuthMode = connection.PreferredAuthMode
	binding.ConnectionReady = connection.Ready
	binding.AppConfigured = connection.AppConfigured
	binding.AppInstalled = connection.AppInstalled
	binding.InstallationID = connection.InstallationID
	binding.InstallationURL = connection.InstallationURL
	binding.ConnectionMessage = connection.Message
	if len(connection.Missing) > 0 {
		binding.Missing = append([]string(nil), connection.Missing...)
	} else {
		binding.Missing = nil
	}
	if strings.TrimSpace(req.AuthMode) != "" || probeErr != nil {
		return binding
	}
	provider := defaultString(strings.TrimSpace(binding.Provider), connection.Provider)
	if connection.RemoteConfigured &&
		strings.EqualFold(provider, "github") &&
		(strings.EqualFold(connection.AuthMode, "github-app") || strings.EqualFold(connection.PreferredAuthMode, "github-app")) {
		binding.AuthMode = "github-app"
	}
	return binding
}

func validateRepoBindingConnection(binding store.RepoBindingInput, probeErr error, connection githubsvc.Status) error {
	if strings.TrimSpace(binding.AuthMode) != "github-app" {
		return nil
	}
	if probeErr != nil {
		return fmt.Errorf("probe github app readiness: %w", probeErr)
	}
	if !connection.RemoteConfigured {
		return fmt.Errorf("github-app repo binding requires an origin remote")
	}
	if !strings.EqualFold(defaultString(strings.TrimSpace(connection.Provider), "github"), "github") {
		return fmt.Errorf("github-app repo binding only supports GitHub remotes")
	}
	if !connection.AppConfigured {
		if message := strings.TrimSpace(connection.Message); message != "" {
			return fmt.Errorf("%s", message)
		}
		if len(connection.Missing) > 0 {
			return fmt.Errorf("github-app auth is not configured; missing %s", strings.Join(connection.Missing, " / "))
		}
		return fmt.Errorf("github-app auth is not configured")
	}
	if !connection.AppInstalled {
		if message := strings.TrimSpace(connection.Message); message != "" {
			return fmt.Errorf("%s", message)
		}
		return fmt.Errorf("github-app installation is not ready")
	}
	return nil
}

func detectLocalRepoBinding(workspaceRoot string) (store.RepoBindingInput, error) {
	if strings.TrimSpace(workspaceRoot) == "" {
		return store.RepoBindingInput{}, fmt.Errorf("workspace root is empty")
	}
	repoURL, err := runGit(workspaceRoot, "remote", "get-url", "origin")
	if err != nil {
		return store.RepoBindingInput{}, fmt.Errorf("detect origin remote: %w", err)
	}
	branch, err := runGit(workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return store.RepoBindingInput{}, fmt.Errorf("detect current branch: %w", err)
	}
	repo, provider := parseRepoIdentity(repoURL)
	if repo == "" {
		return store.RepoBindingInput{}, fmt.Errorf("unsupported git remote url: %s", repoURL)
	}
	return store.RepoBindingInput{
		Repo:       repo,
		RepoURL:    repoURL,
		Branch:     branch,
		Provider:   provider,
		AuthMode:   "local-git-origin",
		DetectedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func runGit(workspaceRoot string, args ...string) (string, error) {
	command := exec.Command("git", append([]string{"-C", workspaceRoot}, args...)...)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func parseRepoIdentity(remoteURL string) (string, string) {
	return githubsvc.ParseRepoIdentity(remoteURL)
}

func storeBindingSnapshot(workspace store.WorkspaceSnapshot) store.WorkspaceRepoBindingSnapshot {
	binding := workspace.RepoBinding
	if strings.TrimSpace(binding.Repo) == "" {
		binding.Repo = workspace.Repo
	}
	if strings.TrimSpace(binding.RepoURL) == "" {
		binding.RepoURL = workspace.RepoURL
	}
	if strings.TrimSpace(binding.Branch) == "" {
		binding.Branch = workspace.Branch
	}
	if strings.TrimSpace(binding.Provider) == "" {
		binding.Provider = defaultString(workspace.RepoProvider, "github")
	}
	if strings.TrimSpace(binding.BindingStatus) == "" {
		binding.BindingStatus = defaultString(workspace.RepoBindingStatus, "pending")
	}
	if strings.TrimSpace(binding.AuthMode) == "" {
		binding.AuthMode = defaultString(workspace.RepoAuthMode, "local-git-origin")
	}
	return binding
}

func workspaceGitHubInstallationSnapshot(workspace store.WorkspaceSnapshot) store.WorkspaceGitHubInstallSnapshot {
	installation := workspace.GitHubInstallation
	if strings.TrimSpace(installation.Provider) == "" {
		installation.Provider = defaultString(workspace.RepoProvider, "github")
	}
	if strings.TrimSpace(installation.PreferredAuthMode) == "" {
		installation.PreferredAuthMode = defaultString(workspace.RepoAuthMode, "local-git-origin")
	}
	if strings.TrimSpace(installation.ConnectionMessage) == "" {
		installation.ConnectionMessage = "等待 GitHub probe 或 installation callback 返回 install truth。"
	}
	return installation
}
