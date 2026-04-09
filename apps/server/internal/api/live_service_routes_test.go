package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type liveServiceStatusPayload struct {
	Service       string `json:"service"`
	Managed       bool   `json:"managed"`
	Status        string `json:"status"`
	Message       string `json:"message"`
	Owner         string `json:"owner"`
	PID           int    `json:"pid"`
	WorkspaceRoot string `json:"workspaceRoot"`
	RepoRoot      string `json:"repoRoot"`
	Address       string `json:"address"`
	BaseURL       string `json:"baseUrl"`
	HealthURL     string `json:"healthUrl"`
	StateURL      string `json:"stateUrl"`
	MetadataPath  string `json:"metadataPath"`
	LogPath       string `json:"logPath"`
	Branch        string `json:"branch"`
	Head          string `json:"head"`
	LaunchCommand string `json:"launchCommand"`
	LaunchedAt    string `json:"launchedAt"`
	ReloadedAt    string `json:"reloadedAt"`
	StoppedAt     string `json:"stoppedAt"`
	LastError     string `json:"lastError"`
	StatusCommand string `json:"statusCommand"`
	StartCommand  string `json:"startCommand"`
	StopCommand   string `json:"stopCommand"`
	ReloadCommand string `json:"reloadCommand"`
}

func TestLiveServiceRouteReturnsUnmanagedStatusWithoutMetadata(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/runtime/live-service")
	if err != nil {
		t.Fatalf("GET /v1/runtime/live-service error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runtime/live-service status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload liveServiceStatusPayload
	decodeJSON(t, resp, &payload)
	if payload.Managed {
		t.Fatalf("managed = true, want false without metadata: %#v", payload)
	}
	if payload.Status != "unmanaged_live_service" {
		t.Fatalf("status = %q, want unmanaged_live_service", payload.Status)
	}
	if !strings.Contains(payload.Message, "no managed owner metadata") {
		t.Fatalf("message = %q, want missing metadata guidance", payload.Message)
	}
	if payload.MetadataPath != filepath.Join(root, "data", "ops", "live-server.json") {
		t.Fatalf("metadataPath = %q", payload.MetadataPath)
	}
	if payload.ReloadCommand != liveServerReloadCommand || payload.StatusCommand != liveServerStatusCommand {
		t.Fatalf("control commands missing from payload: %#v", payload)
	}
}

func TestLiveServiceRouteReturnsRecordedOwnerReloadMetadata(t *testing.T) {
	root := t.TempDir()
	metadataPath := filepath.Join(root, "data", "ops", "live-server.json")
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		t.Fatalf("MkdirAll(metadata) error = %v", err)
	}
	body := `{
  "service": "openshock-server",
  "owner": "@Max_开发",
  "pid": 4242,
  "workspaceRoot": "` + root + `",
  "repoRoot": "/tmp/openshock-tkt59",
  "address": ":8080",
  "baseUrl": "http://127.0.0.1:8080",
  "healthUrl": "http://127.0.0.1:8080/healthz",
  "stateUrl": "http://127.0.0.1:8080/v1/state",
  "logPath": "` + filepath.Join(root, "data", "logs", "openshock-server.log") + `",
  "branch": "dev",
  "head": "5f48321",
  "launchCommand": "bash -lc 'cd apps/server && exec ...'",
  "launchedAt": "2026-04-09T05:20:00Z",
  "reloadedAt": "2026-04-09T05:21:00Z",
  "status": "running",
  "statusCommand": "pnpm ops:live-server:status",
  "startCommand": "pnpm ops:live-server:start",
  "stopCommand": "pnpm ops:live-server:stop",
  "reloadCommand": "pnpm ops:live-server:reload"
}`
	if err := os.WriteFile(metadataPath, []byte(body), 0o644); err != nil {
		t.Fatalf("WriteFile(metadata) error = %v", err)
	}

	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/runtime/live-service")
	if err != nil {
		t.Fatalf("GET /v1/runtime/live-service error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runtime/live-service status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload liveServiceStatusPayload
	decodeJSON(t, resp, &payload)
	if !payload.Managed || payload.Status != "running" {
		t.Fatalf("payload managed/status = %#v, want managed running metadata", payload)
	}
	if payload.Owner != "@Max_开发" || payload.PID != 4242 {
		t.Fatalf("payload owner/pid = %#v, want recorded owner metadata", payload)
	}
	if payload.ReloadCommand != liveServerReloadCommand || payload.StartCommand != liveServerStartCommand || payload.StopCommand != liveServerStopCommand {
		t.Fatalf("payload commands = %#v, want control commands carried through", payload)
	}
	if payload.Head != "5f48321" || payload.Branch != "dev" {
		t.Fatalf("payload git truth = %#v, want branch/head preserved", payload)
	}
}

func TestLiveServiceRouteRejectsMutation(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/runtime/live-service", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("POST /v1/runtime/live-service error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST /v1/runtime/live-service status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}
