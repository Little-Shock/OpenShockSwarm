package api

import "net/http"

func init() {
	registerServerRoutes(registerExperienceMetricsRoutes)
}

func registerExperienceMetricsRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/experience-metrics", s.handleExperienceMetrics)
}

func (s *Server) handleExperienceMetrics(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.ExperienceMetrics())
}
