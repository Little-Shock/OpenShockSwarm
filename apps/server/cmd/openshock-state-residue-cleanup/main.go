package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/api"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func main() {
	stateFile := flag.String("state-file", defaultStateFile(), "path to phase0 state.json")
	writeChanges := flag.Bool("write", false, "write sanitized state back in place")
	flag.Parse()

	body, err := os.ReadFile(*stateFile)
	if err != nil {
		fatalf("read %s: %v", *stateFile, err)
	}

	var snapshot store.State
	if err := json.Unmarshal(body, &snapshot); err != nil {
		fatalf("decode %s: %v", *stateFile, err)
	}

	sanitized := api.SanitizeLiveState(snapshot)
	output, err := json.MarshalIndent(sanitized, "", "  ")
	if err != nil {
		fatalf("encode sanitized state: %v", err)
	}
	output = append(output, '\n')

	changed := !bytes.Equal(bytes.TrimSpace(body), bytes.TrimSpace(output))
	if !changed {
		fmt.Printf("clean: %s\n", *stateFile)
		return
	}

	if !*writeChanges {
		fmt.Printf("dirty: %s\n", *stateFile)
		return
	}

	if err := os.WriteFile(*stateFile, output, 0o644); err != nil {
		fatalf("write %s: %v", *stateFile, err)
	}
	fmt.Printf("cleaned: %s\n", *stateFile)
}

func defaultStateFile() string {
	if fromEnv := os.Getenv("OPENSHOCK_STATE_FILE"); fromEnv != "" {
		return fromEnv
	}
	root := os.Getenv("OPENSHOCK_WORKSPACE_ROOT")
	if root == "" {
		root = "."
	}
	return filepath.Join(root, "data", "phase0", "state.json")
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
