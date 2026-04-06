package api

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/worktree"
)

type daemonLeaseConflict struct {
	LeaseID       string `json:"leaseId,omitempty"`
	RunID         string `json:"runId,omitempty"`
	SessionID     string `json:"sessionId,omitempty"`
	RoomID        string `json:"roomId,omitempty"`
	Operation     string `json:"operation"`
	Key           string `json:"key"`
	Cwd           string `json:"cwd,omitempty"`
	WorkspaceRoot string `json:"workspaceRoot,omitempty"`
	WorktreeName  string `json:"worktreeName,omitempty"`
	AcquiredAt    string `json:"acquiredAt"`
}

type leaseGuard struct {
	mu        sync.Mutex
	exec      map[string]daemonLeaseConflict
	worktrees map[string]daemonLeaseConflict
}

func newLeaseGuard() *leaseGuard {
	return &leaseGuard{
		exec:      make(map[string]daemonLeaseConflict),
		worktrees: make(map[string]daemonLeaseConflict),
	}
}

func (g *leaseGuard) acquireExec(req runtime.ExecRequest, defaultRoot string) (func(), *daemonLeaseConflict) {
	cwd := normalizeLeasePath(strings.TrimSpace(req.Cwd))
	if cwd == "" {
		cwd = normalizeLeasePath(defaultRoot)
	}
	if cwd == "" {
		cwd = "."
	}

	claim := daemonLeaseConflict{
		LeaseID:    firstNonEmpty(strings.TrimSpace(req.LeaseID), strings.TrimSpace(req.SessionID), strings.TrimSpace(req.RunID), strings.TrimSpace(req.RoomID), cwd),
		RunID:      strings.TrimSpace(req.RunID),
		SessionID:  strings.TrimSpace(req.SessionID),
		RoomID:     strings.TrimSpace(req.RoomID),
		Operation:  "exec",
		Key:        cwd,
		Cwd:        cwd,
		AcquiredAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	return g.acquire(g.exec, cwd, claim)
}

func (g *leaseGuard) acquireWorktree(req worktree.Request, defaultRoot string) (func(), *daemonLeaseConflict) {
	root := normalizeLeasePath(strings.TrimSpace(req.WorkspaceRoot))
	if root == "" {
		root = normalizeLeasePath(defaultRoot)
	}
	worktreeName := strings.TrimSpace(req.WorktreeName)
	if worktreeName == "" {
		worktreeName = strings.ReplaceAll(strings.TrimPrefix(strings.TrimSpace(req.Branch), "feat/"), "/", "-")
	}
	if worktreeName == "" {
		worktreeName = strings.TrimSpace(req.Branch)
	}
	key := strings.TrimSpace(root)
	if key != "" {
		key += "::"
	}
	key += strings.TrimSpace(worktreeName)
	if key == "" {
		key = "anonymous-worktree"
	}

	claim := daemonLeaseConflict{
		LeaseID:       firstNonEmpty(strings.TrimSpace(req.LeaseID), strings.TrimSpace(req.SessionID), strings.TrimSpace(req.RunID), strings.TrimSpace(req.RoomID), key),
		RunID:         strings.TrimSpace(req.RunID),
		SessionID:     strings.TrimSpace(req.SessionID),
		RoomID:        strings.TrimSpace(req.RoomID),
		Operation:     "worktree",
		Key:           key,
		WorkspaceRoot: root,
		WorktreeName:  strings.TrimSpace(worktreeName),
		AcquiredAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	return g.acquire(g.worktrees, key, claim)
}

func (g *leaseGuard) acquire(target map[string]daemonLeaseConflict, key string, claim daemonLeaseConflict) (func(), *daemonLeaseConflict) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if existing, ok := target[key]; ok {
		conflict := existing
		return nil, &conflict
	}
	target[key] = claim
	return func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		delete(target, key)
	}, nil
}

func normalizeLeasePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if absolute, err := filepath.Abs(path); err == nil {
		path = absolute
	}
	return filepath.Clean(path)
}

func formatLeaseConflictError(conflict daemonLeaseConflict) string {
	target := strings.TrimSpace(conflict.Cwd)
	if target == "" {
		target = strings.TrimSpace(conflict.WorktreeName)
	}
	if target == "" {
		target = strings.TrimSpace(conflict.Key)
	}
	holder := firstNonEmpty(strings.TrimSpace(conflict.SessionID), strings.TrimSpace(conflict.RunID), strings.TrimSpace(conflict.RoomID), strings.TrimSpace(conflict.LeaseID))
	if holder == "" {
		holder = "another active runtime lease"
	}
	return fmt.Sprintf("runtime lease conflict: %s is already held by %s", target, holder)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
