package api

import "net/http"

func init() {
	registerServerRoutes(registerAuthRoutes)
}

func registerAuthRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/auth/session", s.handleAuthSession)
	mux.HandleFunc("/v1/workspace/members", s.handleWorkspaceMembers)
	mux.HandleFunc("/v1/workspace/members/", s.handleWorkspaceMembers)
}
