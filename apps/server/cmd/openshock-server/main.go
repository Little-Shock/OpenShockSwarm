package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/api"
	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func main() {
	addr := envOr("OPENSHOCK_SERVER_ADDR", ":8080")
	controlURL := envOr("OPENSHOCK_CONTROL_URL", "")
	daemonURL := envOr("OPENSHOCK_DAEMON_URL", "http://127.0.0.1:8090")
	actualLiveURL := envOr("OPENSHOCK_ACTUAL_LIVE_URL", "http://127.0.0.1:8080")
	workspaceRoot := envOr("OPENSHOCK_WORKSPACE_ROOT", `E:\00.Lark_Projects\00_OpenShock`)
	statePath := envOr("OPENSHOCK_STATE_FILE", filepath.Join(workspaceRoot, "data", "phase0", "state.json"))
	githubWebhookSecret := envOr("OPENSHOCK_GITHUB_WEBHOOK_SECRET", "")

	httpClient := &http.Client{Timeout: 4 * time.Minute}
	stateStore, err := store.New(statePath, workspaceRoot)
	if err != nil {
		log.Fatal(err)
	}
	githubClient, err := githubsvc.NewEnvOverrideClient(githubsvc.NewService(nil))
	if err != nil {
		log.Fatal(err)
	}
	if changed, err := sanitizePersistedStateOnStartup(stateStore); err != nil {
		log.Fatal(err)
	} else if changed {
		log.Printf("sanitized persisted live state at startup: %s", statePath)
	}

	server := api.New(stateStore, httpClient, api.Config{
		ControlURL:          controlURL,
		DaemonURL:           daemonURL,
		ActualLiveURL:       actualLiveURL,
		WorkspaceRoot:       workspaceRoot,
		GitHub:              githubClient,
		GitHubWebhookSecret: githubWebhookSecret,
	})
	backgroundCtx, cancelBackground := context.WithCancel(context.Background())
	defer cancelBackground()
	startBackgroundWorkers(backgroundCtx, server)

	log.Printf("openshock-server listening on %s (daemon %s)", addr, daemonURL)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}

var roomAutoRecoveryLoopInterval = 15 * time.Second

func startBackgroundWorkers(ctx context.Context, server *api.Server) {
	if server == nil || ctx == nil {
		return
	}
	server.StartRoomAutoRecoveryLoop(ctx, roomAutoRecoveryLoopInterval)
}

func sanitizePersistedStateOnStartup(stateStore *store.Store) (bool, error) {
	return stateStore.RewriteState(api.SanitizeLiveState)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
