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
		if r.URL.Path == "/v1/runs/__ops_smoke_missing_run__/control" {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "run not found"})
			return
		}
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
		case "/v1/state":
			writeJSON(w, http.StatusOK, map[string]any{
				"workspace": map[string]any{
					"pairedRuntime": "shock-main",
					"quota": map[string]any{
						"maxAgents":          8,
						"messageHistoryDays": 30,
					},
					"usage": map[string]any{
						"totalTokens":  4200,
						"messageCount": 7,
					},
				},
				"runs": []map[string]any{{
					"id": "run-smoke",
					"usage": map[string]any{
						"totalTokens": 1200,
					},
				}},
			})
		case "/v1/state/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("event: snapshot\nid: 1\ndata: {\"type\":\"snapshot\",\"state\":{\"workspace\":{\"name\":\"OpenShock\"}}}\n\n"))
		case "/v1/experience-metrics":
			writeJSON(w, http.StatusOK, map[string]any{
				"workspace":   "OpenShock",
				"summary":     "baseline ready",
				"methodology": "repo + live stack probes",
				"sections": []map[string]any{{
					"id": "product",
				}},
			})
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
		if r.URL.Path == "/v1/runs/__ops_smoke_missing_run__/control" {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "run not found"})
			return
		}
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-server"})
		case "/v1/state":
			writeJSON(w, http.StatusOK, map[string]any{
				"workspace": map[string]any{
					"pairedRuntime": "shock-main",
					"quota": map[string]any{
						"maxAgents":          8,
						"messageHistoryDays": 30,
					},
					"usage": map[string]any{
						"totalTokens":  4200,
						"messageCount": 7,
					},
				},
				"runs": []map[string]any{{
					"id": "run-smoke",
					"usage": map[string]any{
						"totalTokens": 1200,
					},
				}},
			})
		case "/v1/state/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("event: snapshot\nid: 1\ndata: {\"type\":\"snapshot\",\"state\":{\"workspace\":{\"name\":\"OpenShock\"}}}\n\n"))
		case "/v1/experience-metrics":
			writeJSON(w, http.StatusOK, map[string]any{
				"workspace":   "OpenShock",
				"summary":     "baseline ready",
				"methodology": "repo + live stack probes",
				"sections": []map[string]any{{
					"id": "product",
				}},
			})
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
	if runtime.GOOS == "windows" {
		scriptPath = windowsPathToBashPath(scriptPath)
	} else {
		scriptPath = filepath.ToSlash(scriptPath)
	}

	commandLine := strings.Join([]string{
		"OPENSHOCK_SERVER_URL=" + shellQuote(serverURL),
		"OPENSHOCK_DAEMON_URL=" + shellQuote(daemonURL),
		"OPENSHOCK_CURL_MAX_TIME=2",
		shellQuote(scriptPath),
	}, " ")
	cmd := exec.Command("bash", "-lc", commandLine)
	cmd.Dir = projectRoot
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func windowsPathToBashPath(path string) string {
	path = filepath.Clean(path)
	path = filepath.ToSlash(path)
	if len(path) >= 2 && path[1] == ':' {
		drive := strings.ToLower(path[:1])
		rest := strings.TrimPrefix(path[2:], "/")
		return "/mnt/" + drive + "/" + rest
	}
	return path
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
