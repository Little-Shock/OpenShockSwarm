package api

import (
	"fmt"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
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

type daemonErrorPayload struct {
	Error    string               `json:"error"`
	Conflict *daemonLeaseConflict `json:"conflict,omitempty"`
}

type daemonHTTPError struct {
	Status   int
	Message  string
	Conflict *daemonLeaseConflict
}

func (e *daemonHTTPError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func runtimeRegistryResponse(snapshot store.State) map[string]any {
	return map[string]any{
		"pairedRuntime":    snapshot.Workspace.PairedRuntime,
		"pairingStatus":    snapshot.Workspace.PairingStatus,
		"runtimes":         snapshot.Runtimes,
		"leases":           snapshot.RuntimeLeases,
		"runtimeScheduler": snapshot.RuntimeScheduler,
	}
}

func attachRoomRuntimeLease(req *ExecRequest, snapshot store.State, roomID, workspaceRoot string) {
	if lease, ok := findRoomRuntimeLease(snapshot, roomID); ok {
		if strings.TrimSpace(req.Cwd) == "" {
			req.Cwd = defaultString(strings.TrimSpace(lease.WorktreePath), workspaceRoot)
		}
		req.LeaseID = defaultString(strings.TrimSpace(req.LeaseID), lease.LeaseID)
		req.RunID = defaultString(strings.TrimSpace(req.RunID), lease.RunID)
		req.SessionID = defaultString(strings.TrimSpace(req.SessionID), lease.SessionID)
		req.RoomID = defaultString(strings.TrimSpace(req.RoomID), lease.RoomID)
		return
	}
	if strings.TrimSpace(req.Cwd) == "" {
		req.Cwd = workspaceRoot
	}
}

func findRoomRuntimeLease(snapshot store.State, roomID string) (store.RuntimeLease, bool) {
	for _, lease := range snapshot.RuntimeLeases {
		if lease.RoomID != roomID {
			continue
		}
		return lease, true
	}
	return store.RuntimeLease{}, false
}

func findRunRuntimeLease(snapshot store.State, runID string) (store.RuntimeLease, bool) {
	for _, lease := range snapshot.RuntimeLeases {
		if lease.RunID != runID {
			continue
		}
		return lease, true
	}
	return store.RuntimeLease{}, false
}

func buildConflictRoomMessage(prefix string, err error) string {
	if prefix == "" {
		prefix = "runtime lease 冲突"
	}
	if err == nil {
		return prefix
	}
	return fmt.Sprintf("%s：%s", prefix, err.Error())
}
