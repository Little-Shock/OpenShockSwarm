package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

const authSessionStatusActive = "active"

func init() {
	issueCreateGuard = func(s *Server, w http.ResponseWriter) bool {
		return s.requireSessionPermission(w, "issue.create")
	}
	roomReplyGuard = func(s *Server, w http.ResponseWriter) bool {
		return s.requireSessionPermission(w, "room.reply")
	}
	roomPullRequestGuard = func(s *Server, w http.ResponseWriter) bool {
		return s.requireSessionPermission(w, "pull_request.review")
	}
	runtimeManageGuard = func(s *Server, w http.ResponseWriter) bool {
		return s.requireSessionPermission(w, "runtime.manage")
	}
	runExecuteGuard = func(s *Server, w http.ResponseWriter) bool {
		return s.requireSessionPermission(w, "run.execute")
	}
	pullRequestRouteGuard = func(s *Server, w http.ResponseWriter, status string) bool {
		return s.requireSessionPermission(w, permissionForPullRequestMutation(status))
	}
}

func (s *Server) requireSessionPermission(w http.ResponseWriter, permission string) bool {
	snapshot := s.store.Snapshot()
	session := snapshot.Auth.Session
	payload := map[string]any{
		"permission": permission,
		"session":    session,
		"state":      snapshot,
	}

	if strings.TrimSpace(session.Status) != authSessionStatusActive {
		payload["error"] = store.ErrAuthSessionRequired.Error()
		writeJSON(w, http.StatusUnauthorized, payload)
		return false
	}

	if !authSessionHasPermission(session, permission) {
		payload["error"] = fmt.Sprintf("permission %q required", permission)
		writeJSON(w, http.StatusForbidden, payload)
		return false
	}

	return true
}

func authSessionHasPermission(session store.AuthSession, permission string) bool {
	if strings.TrimSpace(session.Status) != authSessionStatusActive {
		return false
	}
	for _, granted := range session.Permissions {
		if granted == permission {
			return true
		}
	}
	return false
}

func permissionForPullRequestMutation(status string) string {
	if strings.EqualFold(strings.TrimSpace(status), "merged") {
		return "pull_request.merge"
	}
	return "pull_request.review"
}

func permissionForInboxDecision(item store.InboxItem, decision string) string {
	if strings.EqualFold(strings.TrimSpace(item.Kind), "review") && strings.EqualFold(strings.TrimSpace(decision), "changes_requested") {
		return "inbox.review"
	}
	return "inbox.decide"
}
