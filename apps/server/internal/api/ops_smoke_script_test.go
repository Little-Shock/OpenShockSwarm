package api

import (
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestOpsSmokePassesWhenPairingMatchesDaemonTruth(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": "",
				"providers": []map[string]any{{"id": "codex"}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
		case "/v1/state":
			writeJSON(w, http.StatusOK, map[string]any{"workspace": map[string]any{"pairedRuntime": "shock-main"}})
		case "/v1/runtime/registry":
			writeJSON(w, http.StatusOK, map[string]any{
				"pairedRuntime": "shock-main",
				"runtimes": []map[string]any{{
					"id":        "shock-main",
					"machine":   "shock-main",
					"daemonUrl": daemon.URL,
				}},
			})
		case "/v1/runtime/pairing":
			writeJSON(w, http.StatusOK, map[string]any{
				"daemonUrl":     daemon.URL,
				"pairedRuntime": "shock-main",
				"pairingStatus": "paired",
			})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": daemon.URL,
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, map[string]any{"bindingStatus": "bound"})
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScript(t, server.URL, daemon.URL)
	if err != nil {
		t.Fatalf("ops smoke error = %v\noutput:\n%s", err, output)
	}
	if !strings.Contains(output, "ops smoke passed") {
		t.Fatalf("ops smoke output missing success marker:\n%s", output)
	}
}

func TestOpsSmokeFailsWhenPairingDriftsFromDaemonTruth(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": "",
				"providers": []map[string]any{{"id": "codex"}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer daemon.Close()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
		case "/v1/state":
			writeJSON(w, http.StatusOK, map[string]any{"workspace": map[string]any{"pairedRuntime": "shock-main"}})
		case "/v1/runtime/registry":
			writeJSON(w, http.StatusOK, map[string]any{
				"pairedRuntime": "shock-main",
				"runtimes": []map[string]any{{
					"id":        "shock-main",
					"machine":   "shock-main",
					"daemonUrl": "http://127.0.0.1:8090",
				}},
			})
		case "/v1/runtime/pairing":
			writeJSON(w, http.StatusOK, map[string]any{
				"daemonUrl":     "http://127.0.0.1:8090",
				"pairedRuntime": "shock-main",
				"pairingStatus": "paired",
			})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": daemon.URL,
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, map[string]any{"bindingStatus": "bound"})
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScript(t, server.URL, daemon.URL)
	if err == nil {
		t.Fatalf("ops smoke unexpectedly passed:\n%s", output)
	}
	if !strings.Contains(output, "Server runtime pairing daemonUrl mismatch") {
		t.Fatalf("ops smoke output missing pairing drift marker:\n%s", output)
	}
}

func runOpsSmokeScript(t *testing.T, serverURL, daemonURL string) (string, error) {
	t.Helper()

	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller(0) failed")
	}
	projectRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "..", ".."))
	scriptPath := filepath.Join(projectRoot, "scripts", "ops-smoke.sh")

	cmd := exec.Command("bash", scriptPath)
	cmd.Dir = projectRoot
	cmd.Env = append(cmd.Environ(),
		"OPENSHOCK_SERVER_URL="+serverURL,
		"OPENSHOCK_DAEMON_URL="+daemonURL,
		"OPENSHOCK_CURL_MAX_TIME=2",
	)
	output, err := cmd.CombinedOutput()
	return string(output), err
}
