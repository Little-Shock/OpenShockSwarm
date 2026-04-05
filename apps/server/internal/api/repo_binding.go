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
	Repo          string `json:"repo"`
	RepoURL       string `json:"repoUrl"`
	Branch        string `json:"branch"`
	Provider      string `json:"provider"`
	BindingStatus string `json:"bindingStatus"`
	AuthMode      string `json:"authMode"`
	DetectedAt    string `json:"detectedAt"`
}

func (s *Server) handleRepoBinding(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.currentRepoBinding())
	case http.MethodPost:
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
		binding := mergeRepoBindingInput(detected, req)
		nextState, updateErr := s.store.UpdateRepoBinding(binding)
		if updateErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": updateErr.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"binding": RepoBindingResponse{
				Repo:          nextState.Workspace.Repo,
				RepoURL:       nextState.Workspace.RepoURL,
				Branch:        nextState.Workspace.Branch,
				Provider:      nextState.Workspace.RepoProvider,
				BindingStatus: nextState.Workspace.RepoBindingStatus,
				AuthMode:      nextState.Workspace.RepoAuthMode,
				DetectedAt:    binding.DetectedAt,
			},
			"state": nextState,
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) currentRepoBinding() RepoBindingResponse {
	return bindingResponseFromWorkspace(s.store.Snapshot().Workspace)
}

func bindingResponseFromWorkspace(workspace store.WorkspaceSnapshot) RepoBindingResponse {
	return RepoBindingResponse{
		Repo:          workspace.Repo,
		RepoURL:       workspace.RepoURL,
		Branch:        workspace.Branch,
		Provider:      workspace.RepoProvider,
		BindingStatus: workspace.RepoBindingStatus,
		AuthMode:      workspace.RepoAuthMode,
	}
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
	return merged
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
