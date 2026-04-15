package api

import (
	"fmt"
	"path/filepath"
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
		attachRoomConversationContinuity(req, snapshot, roomID)
		return
	}
	if strings.TrimSpace(req.Cwd) == "" {
		req.Cwd = workspaceRoot
	}
	attachRoomConversationContinuity(req, snapshot, roomID)
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

func attachRoomConversationContinuity(req *ExecRequest, snapshot store.State, roomID string) {
	if req == nil || normalizeProviderID(req.Provider) != "codex" || strings.TrimSpace(req.Cwd) == "" {
		return
	}
	session, ok := findRoomConversationSession(snapshot, roomID, req.SessionID)
	if !ok {
		return
	}
	if normalizeProviderID(session.Provider) != normalizeProviderID(req.Provider) {
		return
	}
	if !session.ContinuityReady && !sessionHasResumeEligiblePendingTurn(session, req.Provider) {
		return
	}
	req.ResumeSession = true
}

func sessionHasResumeEligiblePendingTurn(session store.Session, provider string) bool {
	if session.PendingTurn == nil {
		return false
	}
	if strings.TrimSpace(session.PendingTurn.Status) != "interrupted" || !session.PendingTurn.ResumeEligible {
		return false
	}
	pendingProvider := normalizeProviderID(session.PendingTurn.Provider)
	if pendingProvider == "" {
		pendingProvider = normalizeProviderID(session.Provider)
	}
	return pendingProvider != "" && pendingProvider == normalizeProviderID(provider)
}

func findRoomConversationSession(snapshot store.State, roomID, sessionID string) (store.Session, bool) {
	trimmedSessionID := strings.TrimSpace(sessionID)
	if trimmedSessionID != "" {
		for _, session := range snapshot.Sessions {
			if session.ID == trimmedSessionID {
				return session, true
			}
		}
	}
	for _, session := range snapshot.Sessions {
		if session.RoomID == roomID {
			return session, true
		}
	}
	return store.Session{}, false
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

func runtimeLeaseConflictTargetName(conflict *daemonLeaseConflict) string {
	if conflict == nil {
		return "current-lane"
	}
	if worktreeName := strings.TrimSpace(conflict.WorktreeName); worktreeName != "" {
		return worktreeName
	}
	if cwd := strings.TrimSpace(conflict.Cwd); cwd != "" {
		return filepath.Base(filepath.Clean(cwd))
	}
	key := strings.TrimSpace(conflict.Key)
	if strings.Contains(key, "::") {
		parts := strings.Split(key, "::")
		key = parts[len(parts)-1]
	}
	if key != "" {
		return filepath.Base(filepath.Clean(key))
	}
	return "current-lane"
}

func runtimeLeaseConflictTarget(conflict *daemonLeaseConflict) string {
	name := runtimeLeaseConflictTargetName(conflict)
	if conflict != nil && strings.TrimSpace(conflict.Operation) == "worktree" {
		return fmt.Sprintf("worktree lane `%s`", name)
	}
	return fmt.Sprintf("执行 lane `%s`", name)
}

func runtimeLeaseConflictHolder(conflict *daemonLeaseConflict) string {
	if conflict == nil {
		return "另一条 active runtime lease"
	}
	return defaultString(
		strings.TrimSpace(conflict.SessionID),
		defaultString(
			strings.TrimSpace(conflict.RunID),
			defaultString(strings.TrimSpace(conflict.RoomID), defaultString(strings.TrimSpace(conflict.LeaseID), "另一条 active runtime lease")),
		),
	)
}

func runtimeLeaseConflictInboxTitle(conflict *daemonLeaseConflict) string {
	if conflict != nil && strings.TrimSpace(conflict.Operation) == "worktree" {
		return "Runtime lease 冲突，等待 worktree lane 释放"
	}
	return "Runtime lease 冲突，等待当前 lane 释放"
}

func runtimeLeaseConflictMessage(conflict *daemonLeaseConflict) string {
	return fmt.Sprintf("runtime lease 冲突：当前 %s 正被 `%s` 占用。", runtimeLeaseConflictTarget(conflict), runtimeLeaseConflictHolder(conflict))
}

func runtimeLeaseConflictNextAction(conflict *daemonLeaseConflict) string {
	targetName := runtimeLeaseConflictTargetName(conflict)
	holder := runtimeLeaseConflictHolder(conflict)
	if conflict != nil && strings.TrimSpace(conflict.Operation) == "worktree" {
		return fmt.Sprintf("等待 `%s` 释放 worktree lane `%s`，或改用新的 branch/worktree lane 后重试。", holder, targetName)
	}
	return fmt.Sprintf("等待 `%s` 释放执行 lane `%s`，或切到新的 room lane / runtime 后重试。", holder, targetName)
}

func runtimeLeaseConflictControlNote(conflict *daemonLeaseConflict) string {
	targetName := runtimeLeaseConflictTargetName(conflict)
	holder := runtimeLeaseConflictHolder(conflict)
	targetKind := "执行 lane"
	if conflict != nil && strings.TrimSpace(conflict.Operation) == "worktree" {
		targetKind = "worktree lane"
	}
	note := fmt.Sprintf("当前 %s `%s` 正被 `%s` 占用。", targetKind, targetName, holder)
	if conflict != nil && strings.TrimSpace(conflict.AcquiredAt) != "" {
		note += fmt.Sprintf(" lease 创建于 %s。", strings.TrimSpace(conflict.AcquiredAt))
	}
	if conflict != nil && strings.TrimSpace(conflict.Operation) == "worktree" {
		return fmt.Sprintf("%s 先释放旧 worktree lane，再重试当前 branch。", note)
	}
	return fmt.Sprintf("%s 先等待当前执行目录释放，或切到新的 lane 再继续。", note)
}
