package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/runtime"
	"github.com/Larkspur-Wang/OpenShock/apps/daemon/internal/worktree"
)

type Server struct {
	service *runtime.Service
	root    string
}

func New(service *runtime.Service, root string) *Server {
	return &Server{service: service, root: root}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "openshock-daemon", "timestamp": time.Now().UTC().Format(time.RFC3339)})
	})
	mux.HandleFunc("/v1/runtime", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.service.Snapshot())
	})
	mux.HandleFunc("/v1/worktrees/ensure", s.handleEnsureWorktree)
	mux.HandleFunc("/v1/exec", s.handleExec)
	mux.HandleFunc("/v1/exec/stream", s.handleStreamExec)
	return withCORS(mux)
}

func (s *Server) handleEnsureWorktree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req worktree.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	payload, err := worktree.Ensure(req, s.root)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req runtime.ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
		return
	}
	if strings.TrimSpace(req.Cwd) == "" {
		req.Cwd = s.root
	}
	resp, err := s.service.RunPrompt(req)
	if err != nil {
		resp.Error = err.Error()
		writeJSON(w, http.StatusBadGateway, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStreamExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req runtime.ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
		return
	}
	if strings.TrimSpace(req.Cwd) == "" {
		req.Cwd = s.root
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	resp, err := s.service.StreamPrompt(req, func(event runtime.StreamEvent) error {
		return writeNDJSON(w, flusher, event)
	})
	if err != nil {
		if strings.TrimSpace(resp.Error) == "" {
			resp.Error = err.Error()
		}
		_ = writeNDJSON(w, flusher, runtime.StreamEvent{
			Type:      "error",
			Provider:  req.Provider,
			Error:     resp.Error,
			Duration:  resp.Duration,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeNDJSON(w http.ResponseWriter, flusher http.Flusher, payload any) error {
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
