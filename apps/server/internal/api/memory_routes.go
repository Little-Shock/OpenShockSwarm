package api

import (
	"net/http"
	"strings"
)

func init() {
	registerServerRoutes(registerMemoryRoutes)
}

func registerMemoryRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/memory", s.handleMemory)
	mux.HandleFunc("/v1/memory/", s.handleMemoryRoutes)
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.store.Snapshot().Memory)
}

func (s *Server) handleMemoryRoutes(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	memoryID := strings.TrimPrefix(r.URL.Path, "/v1/memory/")
	if strings.TrimSpace(memoryID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
		return
	}

	detail, ok := s.store.MemoryDetail(memoryID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
		return
	}
	writeJSON(w, http.StatusOK, detail)
}
