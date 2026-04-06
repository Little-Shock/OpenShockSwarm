package api

import "net/http"

func init() {
	registerServerRoutes(func(s *Server, mux *http.ServeMux) {
		mux.HandleFunc("/v1/notifications/fanout", s.handleNotificationFanout)
	})
}

func (s *Server) handleNotificationFanout(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	nextState, notifications, worker, err := s.store.DispatchNotificationFanout()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"worker":        worker,
		"notifications": notifications,
		"state":         nextState,
	})
}
