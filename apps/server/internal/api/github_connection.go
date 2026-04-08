package api

import (
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func (s *Server) handleGitHubConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	status, err := s.github.Probe(s.workspaceRoot)
	if err != nil {
		writeJSON(w, http.StatusOK, buildWorkspaceGitHubStatus(s.store.Snapshot().Workspace))
		return
	}

	writeJSON(w, http.StatusOK, status)
}

func buildWorkspaceGitHubStatus(workspace store.WorkspaceSnapshot) map[string]any {
	binding := storeBindingSnapshot(workspace)
	installation := workspaceGitHubInstallationSnapshot(workspace)
	return map[string]any{
		"repo":              binding.Repo,
		"repoUrl":           binding.RepoURL,
		"branch":            binding.Branch,
		"provider":          binding.Provider,
		"remoteConfigured":  strings.TrimSpace(binding.RepoURL) != "",
		"ghCliInstalled":    false,
		"ghAuthenticated":   false,
		"appId":             "",
		"appSlug":           "",
		"appConfigured":     installation.AppConfigured,
		"appInstalled":      installation.AppInstalled,
		"installationId":    installation.InstallationID,
		"installationUrl":   installation.InstallationURL,
		"missing":           append([]string{}, installation.Missing...),
		"ready":             installation.ConnectionReady,
		"authMode":          binding.AuthMode,
		"preferredAuthMode": installation.PreferredAuthMode,
		"message":           installation.ConnectionMessage,
	}
}
