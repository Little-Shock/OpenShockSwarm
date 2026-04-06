package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/api"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func main() {
	addr := envOr("OPENSHOCK_SERVER_ADDR", ":8080")
	daemonURL := envOr("OPENSHOCK_DAEMON_URL", "http://127.0.0.1:8090")
	workspaceRoot := envOr("OPENSHOCK_WORKSPACE_ROOT", `E:\00.Lark_Projects\00_OpenShock`)
	statePath := envOr("OPENSHOCK_STATE_FILE", filepath.Join(workspaceRoot, "data", "phase0", "state.json"))
	githubWebhookSecret := envOr("OPENSHOCK_GITHUB_WEBHOOK_SECRET", "")

	httpClient := &http.Client{Timeout: 4 * time.Minute}
	stateStore, err := store.New(statePath, workspaceRoot)
	if err != nil {
		log.Fatal(err)
	}

	server := api.New(stateStore, httpClient, api.Config{
		DaemonURL:           daemonURL,
		WorkspaceRoot:       workspaceRoot,
		GitHubWebhookSecret: githubWebhookSecret,
	})

	log.Printf("openshock-server listening on %s (daemon %s)", addr, daemonURL)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
