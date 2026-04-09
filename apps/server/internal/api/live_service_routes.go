package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	liveServerMetadataRelativePath = "data/ops/live-server.json"
	liveServerLogRelativePath      = "data/logs/openshock-server.log"
	liveServerStatusCommand        = "pnpm ops:live-server:status"
	liveServerStartCommand         = "pnpm ops:live-server:start"
	liveServerStopCommand          = "pnpm ops:live-server:stop"
	liveServerReloadCommand        = "pnpm ops:live-server:reload"
)

type liveServiceMetadataFile struct {
	Service       string `json:"service,omitempty"`
	Owner         string `json:"owner,omitempty"`
	PID           int    `json:"pid,omitempty"`
	WorkspaceRoot string `json:"workspaceRoot,omitempty"`
	RepoRoot      string `json:"repoRoot,omitempty"`
	Address       string `json:"address,omitempty"`
	BaseURL       string `json:"baseUrl,omitempty"`
	HealthURL     string `json:"healthUrl,omitempty"`
	StateURL      string `json:"stateUrl,omitempty"`
	LogPath       string `json:"logPath,omitempty"`
	Branch        string `json:"branch,omitempty"`
	Head          string `json:"head,omitempty"`
	LaunchCommand string `json:"launchCommand,omitempty"`
	LaunchedAt    string `json:"launchedAt,omitempty"`
	ReloadedAt    string `json:"reloadedAt,omitempty"`
	StoppedAt     string `json:"stoppedAt,omitempty"`
	Status        string `json:"status,omitempty"`
	LastError     string `json:"lastError,omitempty"`
	StatusCommand string `json:"statusCommand,omitempty"`
	StartCommand  string `json:"startCommand,omitempty"`
	StopCommand   string `json:"stopCommand,omitempty"`
	ReloadCommand string `json:"reloadCommand,omitempty"`
}

type liveServiceStatusResponse struct {
	Service       string `json:"service"`
	Managed       bool   `json:"managed"`
	Status        string `json:"status"`
	Message       string `json:"message"`
	Owner         string `json:"owner,omitempty"`
	PID           int    `json:"pid,omitempty"`
	WorkspaceRoot string `json:"workspaceRoot,omitempty"`
	RepoRoot      string `json:"repoRoot,omitempty"`
	Address       string `json:"address,omitempty"`
	BaseURL       string `json:"baseUrl,omitempty"`
	HealthURL     string `json:"healthUrl,omitempty"`
	StateURL      string `json:"stateUrl,omitempty"`
	MetadataPath  string `json:"metadataPath"`
	LogPath       string `json:"logPath,omitempty"`
	Branch        string `json:"branch,omitempty"`
	Head          string `json:"head,omitempty"`
	LaunchCommand string `json:"launchCommand,omitempty"`
	LaunchedAt    string `json:"launchedAt,omitempty"`
	ReloadedAt    string `json:"reloadedAt,omitempty"`
	StoppedAt     string `json:"stoppedAt,omitempty"`
	LastError     string `json:"lastError,omitempty"`
	StatusCommand string `json:"statusCommand"`
	StartCommand  string `json:"startCommand"`
	StopCommand   string `json:"stopCommand"`
	ReloadCommand string `json:"reloadCommand"`
}

func init() {
	registerServerRoutes(registerLiveServiceRoutes)
}

func registerLiveServiceRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/runtime/live-service", s.handleLiveServiceStatus)
}

func (s *Server) handleLiveServiceStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, buildLiveServiceStatus(s.workspaceRoot))
}

func buildLiveServiceStatus(workspaceRoot string) liveServiceStatusResponse {
	address := defaultLiveServerAddress()
	baseURL := defaultLiveServerBaseURL(address)
	metadataPath := liveServiceMetadataPath(workspaceRoot)
	response := liveServiceStatusResponse{
		Service:       "openshock-server",
		Managed:       false,
		Status:        "unmanaged_live_service",
		Message:       "current live service has no managed owner metadata; use pnpm ops:live-server:* to establish a visible reload path",
		WorkspaceRoot: workspaceRoot,
		Address:       address,
		BaseURL:       baseURL,
		HealthURL:     strings.TrimRight(baseURL, "/") + "/healthz",
		StateURL:      strings.TrimRight(baseURL, "/") + "/v1/state",
		MetadataPath:  metadataPath,
		LogPath:       liveServiceLogPath(workspaceRoot),
		StatusCommand: liveServerStatusCommand,
		StartCommand:  liveServerStartCommand,
		StopCommand:   liveServerStopCommand,
		ReloadCommand: liveServerReloadCommand,
	}

	if strings.TrimSpace(workspaceRoot) == "" {
		response.Status = "workspace_root_missing"
		response.Message = "workspace root is empty; cannot derive live service metadata path"
		return response
	}

	body, err := os.ReadFile(metadataPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return response
		}
		response.Status = "metadata_unreadable"
		response.Message = "live service metadata exists but could not be read"
		response.LastError = err.Error()
		return response
	}

	var metadata liveServiceMetadataFile
	if err := json.Unmarshal(body, &metadata); err != nil {
		response.Status = "metadata_invalid"
		response.Message = "live service metadata exists but is invalid JSON"
		response.LastError = err.Error()
		return response
	}

	response.Managed = true
	response.Status = defaultString(strings.TrimSpace(metadata.Status), "running")
	response.Message = "live service owner metadata is present; use the recorded reload command for controlled roll/restart"
	response.Service = defaultString(strings.TrimSpace(metadata.Service), response.Service)
	response.Owner = strings.TrimSpace(metadata.Owner)
	response.PID = metadata.PID
	response.WorkspaceRoot = defaultString(strings.TrimSpace(metadata.WorkspaceRoot), response.WorkspaceRoot)
	response.RepoRoot = strings.TrimSpace(metadata.RepoRoot)
	response.Address = defaultString(strings.TrimSpace(metadata.Address), response.Address)
	response.BaseURL = defaultString(strings.TrimSpace(metadata.BaseURL), response.BaseURL)
	response.HealthURL = defaultString(strings.TrimSpace(metadata.HealthURL), response.HealthURL)
	response.StateURL = defaultString(strings.TrimSpace(metadata.StateURL), response.StateURL)
	response.LogPath = defaultString(strings.TrimSpace(metadata.LogPath), response.LogPath)
	response.Branch = strings.TrimSpace(metadata.Branch)
	response.Head = strings.TrimSpace(metadata.Head)
	response.LaunchCommand = strings.TrimSpace(metadata.LaunchCommand)
	response.LaunchedAt = strings.TrimSpace(metadata.LaunchedAt)
	response.ReloadedAt = strings.TrimSpace(metadata.ReloadedAt)
	response.StoppedAt = strings.TrimSpace(metadata.StoppedAt)
	response.LastError = strings.TrimSpace(metadata.LastError)
	response.StatusCommand = defaultString(strings.TrimSpace(metadata.StatusCommand), response.StatusCommand)
	response.StartCommand = defaultString(strings.TrimSpace(metadata.StartCommand), response.StartCommand)
	response.StopCommand = defaultString(strings.TrimSpace(metadata.StopCommand), response.StopCommand)
	response.ReloadCommand = defaultString(strings.TrimSpace(metadata.ReloadCommand), response.ReloadCommand)
	return response
}

func liveServiceMetadataPath(workspaceRoot string) string {
	if strings.TrimSpace(workspaceRoot) == "" {
		return liveServerMetadataRelativePath
	}
	return filepath.Join(workspaceRoot, filepath.FromSlash(liveServerMetadataRelativePath))
}

func liveServiceLogPath(workspaceRoot string) string {
	if strings.TrimSpace(workspaceRoot) == "" {
		return liveServerLogRelativePath
	}
	return filepath.Join(workspaceRoot, filepath.FromSlash(liveServerLogRelativePath))
}

func defaultLiveServerAddress() string {
	return defaultString(strings.TrimSpace(os.Getenv("OPENSHOCK_SERVER_ADDR")), ":8080")
}

func defaultLiveServerBaseURL(address string) string {
	if value := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENSHOCK_SERVER_URL")), "/"); value != "" {
		return value
	}
	address = strings.TrimSpace(address)
	switch {
	case address == "":
		return "http://127.0.0.1:8080"
	case strings.HasPrefix(address, "http://"), strings.HasPrefix(address, "https://"):
		return strings.TrimRight(address, "/")
	case strings.HasPrefix(address, ":"):
		return "http://127.0.0.1" + address
	default:
		return "http://" + strings.TrimLeft(address, "/")
	}
}
