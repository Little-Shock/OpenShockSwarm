package api

import (
	"net/http"
	"net/http/httptest"
	"os"
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
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
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

func TestOpsSmokeUsesManagedLiveServerMetadataWhenServerURLIsUnset(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	metadataPath := filepath.Join(t.TempDir(), "live-server.json")
	if err := os.WriteFile(metadataPath, []byte(`{"status":"running","baseUrl":"`+server.URL+`"}`), 0o644); err != nil {
		t.Fatalf("WriteFile(metadataPath) error = %v", err)
	}

	output, err := runOpsSmokeScriptWithEnv(t, "", daemon.URL, map[string]string{
		"OPENSHOCK_LIVE_SERVER_METADATA": metadataPath,
	})
	if err != nil {
		t.Fatalf("ops smoke error = %v\noutput:\n%s", err, output)
	}
	if !strings.Contains(output, "ops smoke passed") {
		t.Fatalf("ops smoke output missing success marker:\n%s", output)
	}
}

func TestOpsSmokeFailsWhenDaemonRuntimeOmitsAdvertisedURL(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScript(t, server.URL, daemon.URL)
	if err == nil {
		t.Fatalf("ops smoke unexpectedly passed with missing daemon runtime daemonUrl:\n%s", output)
	}
	if !strings.Contains(output, "Daemon runtime missing daemonUrl") {
		t.Fatalf("ops smoke output missing daemon runtime URL marker:\n%s", output)
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
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
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

func TestOpsSmokeStrictFailsWhenGitHubNotReady(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": false})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScriptWithEnv(t, server.URL, daemon.URL, map[string]string{
		"OPENSHOCK_REQUIRE_GITHUB_READY": "1",
	})
	if err == nil {
		t.Fatalf("strict ops smoke unexpectedly passed:\n%s", output)
	}
	if !strings.Contains(output, "GitHub connection not ready for strict release gate") {
		t.Fatalf("strict ops smoke output missing GitHub readiness marker:\n%s", output)
	}
}

func TestOpsSmokeStrictFailsWhenActualLiveParityDrifts(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/runtime/live-service":
			writeJSON(w, http.StatusOK, map[string]any{
				"managed": false,
				"status":  "unmanaged_live_service",
			})
		case "/v1/workspace/live-rollout-parity":
			writeJSON(w, http.StatusOK, map[string]any{
				"status":  "drift",
				"summary": "actual live still points at a different branch",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScriptWithEnv(t, server.URL, daemon.URL, map[string]string{
		"OPENSHOCK_ACTUAL_LIVE_URL":            "http://127.0.0.1:8080",
		"OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY": "1",
	})
	if err == nil {
		t.Fatalf("strict ops smoke unexpectedly passed with actual live drift:\n%s", output)
	}
	if !strings.Contains(output, "Actual live service is not managed") && !strings.Contains(output, "Actual live rollout parity drifted") {
		t.Fatalf("strict ops smoke output missing actual live parity marker:\n%s", output)
	}
}

func TestOpsSmokeStrictFailsWhenActualLiveParityTargetsDifferentURL(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/runtime/live-service":
			writeJSON(w, http.StatusOK, map[string]any{
				"managed": true,
				"status":  "running",
			})
		case "/v1/workspace/live-rollout-parity":
			writeJSON(w, http.StatusOK, map[string]any{
				"status":        "aligned",
				"summary":       "actual live matches current workspace",
				"targetBaseUrl": "http://127.0.0.1:9090",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScriptWithEnv(t, server.URL, daemon.URL, map[string]string{
		"OPENSHOCK_ACTUAL_LIVE_URL":            "http://127.0.0.1:8080",
		"OPENSHOCK_REQUIRE_ACTUAL_LIVE_PARITY": "1",
	})
	if err == nil {
		t.Fatalf("strict ops smoke unexpectedly passed with actual live target mismatch:\n%s", output)
	}
	if !strings.Contains(output, "Actual live rollout target mismatch") {
		t.Fatalf("strict ops smoke output missing actual live target marker:\n%s", output)
	}
}

func TestOpsSmokeFailsWhenRepoBindingIsNotBound(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayloadWith(map[string]any{
				"bindingStatus": "pending",
			}))
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayload())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScript(t, server.URL, daemon.URL)
	if err == nil {
		t.Fatalf("ops smoke unexpectedly passed with unbound repo binding:\n%s", output)
	}
	if !strings.Contains(output, "Repo binding not bound") {
		t.Fatalf("ops smoke output missing repo binding truth marker:\n%s", output)
	}
}

func TestOpsSmokeStrictFailsWhenBranchHeadTruthIsNotAligned(t *testing.T) {
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon"})
		case "/v1/runtime":
			writeJSON(w, http.StatusOK, map[string]any{
				"runtimeId": "shock-main",
				"machine":   "shock-main",
				"daemonUrl": requestRuntimeURL(r),
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
			writeJSON(w, http.StatusOK, opsSmokeStatePayload(daemon.URL))
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
		case "/v1/runtime/bridge-check":
			writeJSON(w, http.StatusOK, map[string]any{
				"command": []string{"runtime", "bridge-check"},
				"output":  "codex 已连接，当前机器 shock-main 在线，可以开始执行。",
			})
		case "/v1/repo/binding":
			writeJSON(w, http.StatusOK, opsSmokeRepoBindingPayload())
		case "/v1/github/connection":
			writeJSON(w, http.StatusOK, map[string]any{"ready": true})
		case "/v1/workspace/branch-head-truth":
			writeJSON(w, http.StatusOK, opsSmokeBranchHeadTruthPayloadWith(map[string]any{
				"status":  "drift",
				"summary": "repo binding points at a different branch",
				"drifts": []map[string]any{{
					"kind":  "branch",
					"value": "release-candidate",
				}},
			}))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output, err := runOpsSmokeScriptWithEnv(t, server.URL, daemon.URL, map[string]string{
		"OPENSHOCK_REQUIRE_BRANCH_HEAD_ALIGNED": "1",
	})
	if err == nil {
		t.Fatalf("strict ops smoke unexpectedly passed with branch-head drift:\n%s", output)
	}
	if !strings.Contains(output, "Branch head truth not aligned") {
		t.Fatalf("strict ops smoke output missing branch-head truth marker:\n%s", output)
	}
}

func runOpsSmokeScript(t *testing.T, serverURL, daemonURL string) (string, error) {
	return runOpsSmokeScriptWithEnv(t, serverURL, daemonURL, nil)
}

func opsSmokeStatePayload(daemonURL string) map[string]any {
	return map[string]any{
		"workspace": map[string]any{
			"pairedRuntime":    "shock-main",
			"pairedRuntimeUrl": daemonURL,
			"pairingStatus":    "paired",
			"quota": map[string]any{
				"maxAgents":          8,
				"messageHistoryDays": 30,
			},
			"usage": map[string]any{
				"totalTokens":  4200,
				"messageCount": 7,
			},
		},
		"runtimes": []map[string]any{{
			"id":           "shock-main",
			"machine":      "shock-main",
			"daemonUrl":    daemonURL,
			"state":        "online",
			"pairingState": "paired",
		}},
		"runs": []map[string]any{{
			"id": "run-smoke",
			"usage": map[string]any{
				"totalTokens": 1200,
			},
		}},
	}
}

func opsSmokeRepoBindingPayload() map[string]any {
	return opsSmokeRepoBindingPayloadWith(nil)
}

func opsSmokeRepoBindingPayloadWith(overrides map[string]any) map[string]any {
	payload := map[string]any{
		"repo":              "Larkspur-Wang/OpenShock",
		"repoUrl":           "https://github.com/Larkspur-Wang/OpenShock.git",
		"branch":            "main",
		"provider":          "github",
		"bindingStatus":     "bound",
		"authMode":          "local-git-origin",
		"preferredAuthMode": "local-git-origin",
		"connectionReady":   true,
		"appInstalled":      true,
	}
	for key, value := range overrides {
		payload[key] = value
	}
	return payload
}

func opsSmokeBranchHeadTruthPayload() map[string]any {
	return opsSmokeBranchHeadTruthPayloadWith(nil)
}

func opsSmokeBranchHeadTruthPayloadWith(overrides map[string]any) map[string]any {
	payload := map[string]any{
		"status":      "aligned",
		"summary":     "repo binding and checkout are aligned",
		"repoBinding": opsSmokeRepoBindingPayload(),
		"checkout": map[string]any{
			"status": "ready",
			"branch": "main",
		},
		"githubConnection": map[string]any{"ready": true},
		"drifts":           []map[string]any{},
	}
	for key, value := range overrides {
		payload[key] = value
	}
	return payload
}

func runOpsSmokeScriptWithEnv(t *testing.T, serverURL, daemonURL string, extraEnv map[string]string) (string, error) {
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

	envParts := []string{
		"OPENSHOCK_DAEMON_URL=" + shellQuote(daemonURL),
		"OPENSHOCK_CURL_MAX_TIME=5",
	}
	if strings.TrimSpace(serverURL) != "" {
		envParts = append(envParts, "OPENSHOCK_SERVER_URL="+shellQuote(serverURL))
	}
	commandLine := strings.Join(append(envParts, shellQuote(scriptPath)), " ")
	cmd := exec.Command("bash", "-lc", commandLine)
	cmd.Dir = projectRoot
	if len(extraEnv) > 0 {
		cmd.Env = append(cmd.Environ(), flattenEnv(extraEnv)...)
	}
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func flattenEnv(values map[string]string) []string {
	result := make([]string, 0, len(values))
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
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

func requestRuntimeURL(r *http.Request) string {
	return "http://" + r.Host
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
