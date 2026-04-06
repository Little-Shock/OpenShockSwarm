package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
)

func TestReportHeartbeatPostsRuntimeSnapshot(t *testing.T) {
	var payload runtime.Heartbeat
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/runtime/heartbeats" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode heartbeat payload error = %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	service := runtime.NewService("shock-main", t.TempDir(),
		runtime.WithDaemonURL("http://127.0.0.1:8090"),
	)
	if err := reportHeartbeat(server.URL, http.DefaultClient, service); err != nil {
		t.Fatalf("reportHeartbeat() error = %v", err)
	}

	if payload.RuntimeID != "shock-main" {
		t.Fatalf("runtime id = %q, want shock-main", payload.RuntimeID)
	}
	if payload.DaemonURL != "http://127.0.0.1:8090" {
		t.Fatalf("daemon url = %q, want http://127.0.0.1:8090", payload.DaemonURL)
	}
}
