package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type GitHubInstallationCallbackRequest struct {
	InstallationID string `json:"installationId"`
	SetupAction    string `json:"setupAction,omitempty"`
}

type GitHubInstallationCallbackResponse struct {
	InstallationID  string              `json:"installationId"`
	SetupAction     string              `json:"setupAction,omitempty"`
	Connection      githubsvc.Status    `json:"connection"`
	Binding         RepoBindingResponse `json:"binding"`
	State           *store.State        `json:"state,omitempty"`
	SyncedPullCount int                 `json:"syncedPullCount"`
}

func (s *Server) handleGitHubInstallationCallback(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireSessionPermission(w, "repo.admin") {
		return
	}

	var req GitHubInstallationCallbackRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}
	}
	req.InstallationID = strings.TrimSpace(req.InstallationID)
	req.SetupAction = strings.TrimSpace(req.SetupAction)
	if req.InstallationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "installationId is required"})
		return
	}

	if err := githubsvc.SaveInstallationState(s.workspaceRoot, githubsvc.InstallationState{
		InstallationID: req.InstallationID,
		SetupAction:    req.SetupAction,
	}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	connection, err := s.github.Probe(s.workspaceRoot)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	nextState := s.store.Snapshot()
	if detected, detectErr := detectLocalRepoBinding(s.workspaceRoot); detectErr == nil {
		bindingInput := alignRepoBindingWithConnection(detected, RepoBindingRequest{}, nil, connection)
		if validateErr := validateRepoBindingConnection(bindingInput, nil, connection); validateErr == nil {
			nextState, err = s.store.UpdateRepoBinding(bindingInput)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
		}
	}

	syncableCount := countSyncablePullRequests(nextState)
	if syncableCount > 0 {
		nextState, err = s.syncStoredPullRequests(nextState.PullRequests)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"error":           err.Error(),
				"installationId":  req.InstallationID,
				"setupAction":     req.SetupAction,
				"connection":      connection,
				"binding":         bindingResponseFromWorkspace(nextState.Workspace, "", &connection),
				"state":           nextState,
				"syncedPullCount": syncableCount,
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, GitHubInstallationCallbackResponse{
		InstallationID:  req.InstallationID,
		SetupAction:     req.SetupAction,
		Connection:      connection,
		Binding:         bindingResponseFromWorkspace(nextState.Workspace, "", &connection),
		State:           &nextState,
		SyncedPullCount: syncableCount,
	})
}

func countSyncablePullRequests(snapshot store.State) int {
	count := 0
	for _, item := range snapshot.PullRequests {
		if shouldSyncGitHubPullRequest(snapshot.Workspace, item) {
			count++
		}
	}
	return count
}
