package api

import (
	"fmt"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type RuntimeLease struct {
	LeaseID      string `json:"leaseId"`
	SessionID    string `json:"sessionId,omitempty"`
	RunID        string `json:"runId,omitempty"`
	RoomID       string `json:"roomId,omitempty"`
	Runtime      string `json:"runtime"`
	Machine      string `json:"machine"`
	Owner        string `json:"owner,omitempty"`
	Provider     string `json:"provider,omitempty"`
	Status       string `json:"status,omitempty"`
	Branch       string `json:"branch,omitempty"`
	WorktreeName string `json:"worktreeName,omitempty"`
	WorktreePath string `json:"worktreePath,omitempty"`
	Cwd          string `json:"cwd,omitempty"`
	Summary      string `json:"summary,omitempty"`
}

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

func buildRuntimeLeases(snapshot store.State) []RuntimeLease {
	leases := make([]RuntimeLease, 0, len(snapshot.Sessions))
	for _, session := range snapshot.Sessions {
		lease, ok := runtimeLeaseFromSession(snapshot, session)
		if !ok {
			continue
		}
		leases = append(leases, lease)
	}
	return leases
}

func runtimeRegistryResponse(snapshot store.State) map[string]any {
	return map[string]any{
		"pairedRuntime": snapshot.Workspace.PairedRuntime,
		"pairingStatus": snapshot.Workspace.PairingStatus,
		"runtimes":      snapshot.Runtimes,
		"leases":        buildRuntimeLeases(snapshot),
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

func findRoomRuntimeLease(snapshot store.State, roomID string) (RuntimeLease, bool) {
	for _, session := range snapshot.Sessions {
		if session.RoomID != roomID {
			continue
		}
		return runtimeLeaseFromSession(snapshot, session)
	}
	return RuntimeLease{}, false
}

func findRunRuntimeLease(snapshot store.State, runID string) (RuntimeLease, bool) {
	for _, session := range snapshot.Sessions {
		if session.ActiveRunID != runID {
			continue
		}
		return runtimeLeaseFromSession(snapshot, session)
	}
	return RuntimeLease{}, false
}

func runtimeLeaseFromSession(snapshot store.State, session store.Session) (RuntimeLease, bool) {
	run, _ := findRuntimeLeaseRunByID(snapshot, session.ActiveRunID)
	runtimeName := defaultString(strings.TrimSpace(session.Runtime), strings.TrimSpace(run.Runtime))
	machine := defaultString(strings.TrimSpace(session.Machine), strings.TrimSpace(run.Machine))
	if runtimeName == "" && machine == "" {
		return RuntimeLease{}, false
	}
	worktreePath := defaultString(strings.TrimSpace(session.WorktreePath), strings.TrimSpace(run.WorktreePath))
	lease := RuntimeLease{
		LeaseID:      defaultString(strings.TrimSpace(session.ID), defaultString(strings.TrimSpace(run.ID), strings.TrimSpace(session.RoomID))),
		SessionID:    strings.TrimSpace(session.ID),
		RunID:        defaultString(strings.TrimSpace(session.ActiveRunID), strings.TrimSpace(run.ID)),
		RoomID:       strings.TrimSpace(session.RoomID),
		Runtime:      defaultString(runtimeName, machine),
		Machine:      defaultString(machine, runtimeName),
		Owner:        strings.TrimSpace(run.Owner),
		Provider:     defaultString(strings.TrimSpace(session.Provider), strings.TrimSpace(run.Provider)),
		Status:       defaultString(strings.TrimSpace(session.Status), strings.TrimSpace(run.Status)),
		Branch:       defaultString(strings.TrimSpace(session.Branch), strings.TrimSpace(run.Branch)),
		WorktreeName: defaultString(strings.TrimSpace(session.Worktree), strings.TrimSpace(run.Worktree)),
		WorktreePath: worktreePath,
		Cwd:          worktreePath,
		Summary:      defaultString(strings.TrimSpace(session.Summary), strings.TrimSpace(run.Summary)),
	}
	return lease, true
}

func findRuntimeLeaseRunByID(snapshot store.State, runID string) (store.Run, bool) {
	runID = strings.TrimSpace(runID)
	for _, item := range snapshot.Runs {
		if item.ID == runID {
			return item, true
		}
	}
	return store.Run{}, false
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
