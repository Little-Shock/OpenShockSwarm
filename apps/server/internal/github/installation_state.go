package github

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type InstallationState struct {
	InstallationID  string `json:"installationId"`
	InstallationURL string `json:"installationUrl,omitempty"`
	SetupAction     string `json:"setupAction,omitempty"`
	UpdatedAt       string `json:"updatedAt,omitempty"`
}

func installationStatePath(workspaceRoot string) string {
	return filepath.Join(strings.TrimSpace(workspaceRoot), "data", "phase0", "github-app-installation.json")
}

func LoadInstallationState(workspaceRoot string) (InstallationState, error) {
	path := installationStatePath(workspaceRoot)
	if strings.TrimSpace(path) == "" || path == filepath.Join("data", "phase0", "github-app-installation.json") {
		return InstallationState{}, fmt.Errorf("workspace root is empty")
	}

	body, err := os.ReadFile(path)
	if err != nil {
		return InstallationState{}, err
	}

	var state InstallationState
	if err := json.Unmarshal(body, &state); err != nil {
		return InstallationState{}, err
	}
	state.InstallationID = strings.TrimSpace(state.InstallationID)
	state.InstallationURL = strings.TrimSpace(state.InstallationURL)
	state.SetupAction = strings.TrimSpace(state.SetupAction)
	state.UpdatedAt = strings.TrimSpace(state.UpdatedAt)
	if state.InstallationID == "" {
		return InstallationState{}, fmt.Errorf("persisted github app installation id is empty")
	}
	if state.InstallationURL == "" {
		state.InstallationURL = "https://github.com/settings/installations/" + state.InstallationID
	}
	return state, nil
}

func SaveInstallationState(workspaceRoot string, state InstallationState) error {
	workspaceRoot = strings.TrimSpace(workspaceRoot)
	if workspaceRoot == "" {
		return fmt.Errorf("workspace root is empty")
	}

	state.InstallationID = strings.TrimSpace(state.InstallationID)
	state.InstallationURL = strings.TrimSpace(state.InstallationURL)
	state.SetupAction = strings.TrimSpace(state.SetupAction)
	if state.InstallationID == "" {
		return fmt.Errorf("installation id is required")
	}
	if state.InstallationURL == "" {
		state.InstallationURL = "https://github.com/settings/installations/" + state.InstallationID
	}
	if strings.TrimSpace(state.UpdatedAt) == "" {
		state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}

	path := installationStatePath(workspaceRoot)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	return os.WriteFile(path, body, 0o644)
}

func loadInstallationStateFallback(workspaceRoot string) InstallationState {
	state, err := LoadInstallationState(workspaceRoot)
	if err != nil {
		return InstallationState{}
	}
	return state
}
