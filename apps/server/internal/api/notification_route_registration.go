package api

import "net/http"

func init() {
	registerServerRoutes(registerNotificationRoutes)
}

func registerNotificationRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/notifications", s.handleNotifications)
	mux.HandleFunc("/v1/notifications/", s.handleNotifications)
	mux.HandleFunc("/v1/approval-center", s.handleApprovalCenter)
}
