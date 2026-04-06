package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/api"
	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
)

func main() {
	once := flag.Bool("once", false, "print one heartbeat and exit")
	machine := flag.String("machine-name", "shock-main", "machine name reported to OpenShock")
	workspaceRoot := flag.String("workspace-root", ".", "workspace root for local runtime discovery")
	addr := flag.String("addr", envOr("OPENSHOCK_DAEMON_ADDR", ":8090"), "http listen address")
	controlURL := flag.String("control-url", envOr("OPENSHOCK_CONTROL_URL", ""), "OpenShock server control plane url for runtime heartbeats")
	advertiseURL := flag.String("advertise-url", envOr("OPENSHOCK_DAEMON_ADVERTISE_URL", ""), "daemon url advertised to the OpenShock control plane")
	heartbeatInterval := flag.Duration("heartbeat-interval", durationOr("OPENSHOCK_DAEMON_HEARTBEAT_INTERVAL", 10*time.Second), "runtime heartbeat interval")
	heartbeatTimeout := flag.Duration("heartbeat-timeout", durationOr("OPENSHOCK_DAEMON_HEARTBEAT_TIMEOUT", 45*time.Second), "runtime heartbeat timeout published to the control plane")
	flag.Parse()

	root, err := filepath.Abs(*workspaceRoot)
	if err != nil {
		log.Fatal(err)
	}

	advertisedURL := strings.TrimRight(strings.TrimSpace(*advertiseURL), "/")
	if advertisedURL == "" {
		advertisedURL = defaultAdvertiseURL(*addr)
	}

	service := runtime.NewService(*machine, root,
		runtime.WithRuntimeID(*machine),
		runtime.WithDaemonURL(advertisedURL),
		runtime.WithHeartbeatInterval(*heartbeatInterval),
		runtime.WithHeartbeatTimeout(*heartbeatTimeout),
	)
	if *once {
		printHeartbeat(service)
		return
	}

	if strings.TrimSpace(*controlURL) != "" {
		go startHeartbeatLoop(strings.TrimRight(strings.TrimSpace(*controlURL), "/"), service, *heartbeatInterval)
	}

	server := api.New(service, root)
	log.Printf("openshock-daemon listening on %s for %s", *addr, root)
	if err := http.ListenAndServe(*addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}

func printHeartbeat(service *runtime.Service) {
	body, err := json.Marshal(service.Snapshot())
	if err != nil {
		log.Printf("failed to marshal heartbeat: %v", err)
		return
	}
	log.Println(string(body))
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func durationOr(key string, fallback time.Duration) time.Duration {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
}

func defaultAdvertiseURL(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "http://127.0.0.1:8090"
	}
	if strings.HasPrefix(addr, "http://") || strings.HasPrefix(addr, "https://") {
		return strings.TrimRight(addr, "/")
	}
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func startHeartbeatLoop(controlURL string, service *runtime.Service, interval time.Duration) {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	client := &http.Client{Timeout: 5 * time.Second}
	if err := reportHeartbeat(controlURL, client, service); err != nil {
		log.Printf("runtime heartbeat failed: %v", err)
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		if err := reportHeartbeat(controlURL, client, service); err != nil {
			log.Printf("runtime heartbeat failed: %v", err)
		}
	}
}

func reportHeartbeat(controlURL string, client *http.Client, service *runtime.Service) error {
	body, err := json.Marshal(service.Snapshot())
	if err != nil {
		return err
	}

	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(controlURL, "/")+"/v1/runtime/heartbeats", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusBadRequest {
		payload, _ := io.ReadAll(response.Body)
		return fmt.Errorf("runtime heartbeat status = %s: %s", response.Status, strings.TrimSpace(string(payload)))
	}
	return nil
}
