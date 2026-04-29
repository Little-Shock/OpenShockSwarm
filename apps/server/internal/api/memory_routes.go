package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func init() {
	registerServerRoutes(registerMemoryRoutes)
}

func registerMemoryRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/memory", s.handleMemory)
	mux.HandleFunc("/v1/memory/", s.handleMemoryRoutes)
	mux.HandleFunc("/v1/memory-center", s.handleMemoryCenter)
	mux.HandleFunc("/v1/memory-center/cleanup", s.handleMemoryCenterCleanup)
	mux.HandleFunc("/v1/memory-center/policy", s.handleMemoryCenterPolicy)
	mux.HandleFunc("/v1/memory-center/providers", s.handleMemoryCenterProviders)
	mux.HandleFunc("/v1/memory-center/providers/", s.handleMemoryCenterProviderRoutes)
	mux.HandleFunc("/v1/memory-center/compaction", s.handleMemoryCenterCompaction)
	mux.HandleFunc("/v1/memory-center/compaction/", s.handleMemoryCenterCompactionRoutes)
	mux.HandleFunc("/v1/memory-center/promotions", s.handleMemoryCenterPromotions)
	mux.HandleFunc("/v1/memory-center/promotions/", s.handleMemoryCenterPromotionRoutes)
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "memory.read") {
		return
	}
	writeJSON(w, http.StatusOK, s.sanitizedLiveStateSnapshotForRequest(r).Memory)
}

func (s *Server) handleMemoryRoutes(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/memory/"), "/")
	if strings.TrimSpace(trimmed) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
		return
	}

	parts := strings.Split(trimmed, "/")
	memoryID := strings.TrimSpace(parts[0])
	if memoryID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
		return
	}

	if len(parts) == 1 {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		if !s.requireRequestSessionPermission(w, r, "memory.read") {
			return
		}

		detail, ok := s.store.MemoryDetail(memoryID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact not found"})
			return
		}
		writeJSON(w, http.StatusOK, sanitizeLivePayload(detail))
		return
	}

	if len(parts) != 2 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact route not found"})
		return
	}
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "memory.write") {
		return
	}

	switch parts[1] {
	case "feedback":
		var req MemoryFeedbackRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, detail, center, err := s.store.SubmitMemoryFeedback(memoryID, store.MemoryFeedbackInput{
			SourceVersion: req.SourceVersion,
			Summary:       req.Summary,
			Note:          req.Note,
			CorrectedBy:   s.currentRequestAuthActor(r),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"detail": detail,
			"center": center,
			"state":  s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	case "forget":
		var req MemoryForgetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, detail, center, err := s.store.ForgetMemoryArtifact(memoryID, store.MemoryForgetInput{
			SourceVersion: req.SourceVersion,
			Reason:        req.Reason,
			ForgottenBy:   s.currentRequestAuthActor(r),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"detail": detail,
			"center": center,
			"state":  s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory artifact route not found"})
	}
}

type MemoryPolicyRequest struct {
	Mode                     string `json:"mode"`
	IncludeRoomNotes         bool   `json:"includeRoomNotes"`
	IncludeDecisionLedger    bool   `json:"includeDecisionLedger"`
	IncludeAgentMemory       bool   `json:"includeAgentMemory"`
	IncludePromotedArtifacts bool   `json:"includePromotedArtifacts"`
	MaxItems                 int    `json:"maxItems"`
}

type MemoryProviderBindingsRequest struct {
	Providers []store.MemoryProviderBinding `json:"providers"`
}

type MemoryProviderCheckRequest struct {
	ProviderID string `json:"providerId"`
}

type MemoryPromotionRequest struct {
	MemoryID      string `json:"memoryId"`
	SourceVersion int    `json:"sourceVersion"`
	Kind          string `json:"kind"`
	Title         string `json:"title"`
	Rationale     string `json:"rationale"`
}

type MemoryPromotionReviewRequest struct {
	Status     string `json:"status"`
	ReviewNote string `json:"reviewNote"`
}

type MemoryCompactionRequest struct {
	SourceArtifactID string `json:"sourceArtifactId"`
	Reason           string `json:"reason"`
}

type MemoryCompactionReviewRequest struct {
	Status string `json:"status"`
}

type MemoryFeedbackRequest struct {
	SourceVersion int    `json:"sourceVersion"`
	Summary       string `json:"summary"`
	Note          string `json:"note"`
}

type MemoryForgetRequest struct {
	SourceVersion int    `json:"sourceVersion"`
	Reason        string `json:"reason"`
}

func (s *Server) handleMemoryCenter(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "memory.read") {
		return
	}
	writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.MemoryCenter()))
}

func (s *Server) handleMemoryCenterCleanup(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "memory.write") {
		return
	}

	mode := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("mode")))
	if mode != "" && mode != "due" && mode != "dry-run" && mode != "preview" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid cleanup mode"})
		return
	}
	if mode == "dry-run" || mode == "preview" {
		nextState, preview, center, err := s.store.PreviewMemoryCleanup()
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"dryRun":    true,
			"executed":  false,
			"dueCount":  preview.DueCount,
			"nextRunAt": preview.NextRunAt,
			"items":     preview.Items,
			"preview":   preview,
			"center":    center,
			"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
		})
		return
	}
	if mode == "due" {
		nextState, cleanup, center, executed, err := s.store.RunDueMemoryCleanup(s.currentRequestAuthActor(r))
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		payload := map[string]any{
			"executed": executed,
			"center":   center,
			"state":    s.sanitizedStateSnapshotForRequest(nextState, r),
		}
		if cleanup != nil {
			payload["cleanup"] = cleanup
		}
		writeJSON(w, http.StatusOK, payload)
		return
	}

	nextState, cleanup, center, err := s.store.RunMemoryCleanup(s.currentRequestAuthActor(r))
	if err != nil {
		writeMemoryError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"cleanup": cleanup,
		"center":  center,
		"state":   s.sanitizedStateSnapshotForRequest(nextState, r),
	})
}

func (s *Server) handleMemoryCenterProviders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !s.requireRequestSessionPermission(w, r, "memory.read") {
			return
		}
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.MemoryCenter().Providers))
	case http.MethodPost:
		if !s.requireRequestSessionPermission(w, r, "memory.write") {
			return
		}

		var req MemoryProviderBindingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, providers, center, err := s.store.UpdateMemoryProviders(req.Providers, s.currentRequestAuthActor(r))
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"providers": providers,
			"center":    center,
			"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMemoryCenterProviderRoutes(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/v1/memory-center/providers/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/memory-center/providers/"), "/")
	if trimmed == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory provider route not found"})
		return
	}

	parts := strings.Split(trimmed, "/")
	switch {
	case len(parts) == 1 && parts[0] == "check":
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		if !s.requireRequestSessionPermission(w, r, "memory.write") {
			return
		}

		var req MemoryProviderCheckRequest
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, http.ErrBodyNotAllowed) && !errors.Is(err, io.EOF) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
				return
			}
		}

		nextState, providers, center, err := s.store.CheckMemoryProviders(req.ProviderID, s.currentRequestAuthActor(r))
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"providers": providers,
			"center":    center,
			"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	case len(parts) == 2 && strings.TrimSpace(parts[0]) != "" && parts[1] == "recover":
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		if !s.requireRequestSessionPermission(w, r, "memory.write") {
			return
		}

		nextState, provider, center, err := s.store.RecoverMemoryProvider(parts[0], s.currentRequestAuthActor(r))
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"provider": provider,
			"center":   center,
			"state":    s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory provider route not found"})
	}
}

func (s *Server) handleMemoryCenterPolicy(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !s.requireRequestSessionPermission(w, r, "memory.read") {
			return
		}
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.MemoryCenter().Policy))
	case http.MethodPost:
		if !s.requireRequestSessionPermission(w, r, "memory.write") {
			return
		}

		var req MemoryPolicyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, policy, center, err := s.store.UpdateMemoryPolicy(store.MemoryPolicyInput{
			Mode:                     req.Mode,
			IncludeRoomNotes:         req.IncludeRoomNotes,
			IncludeDecisionLedger:    req.IncludeDecisionLedger,
			IncludeAgentMemory:       req.IncludeAgentMemory,
			IncludePromotedArtifacts: req.IncludePromotedArtifacts,
			MaxItems:                 req.MaxItems,
			UpdatedBy:                s.currentRequestAuthActor(r),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"policy": policy,
			"center": center,
			"state":  s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMemoryCenterPromotions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !s.requireRequestSessionPermission(w, r, "memory.read") {
			return
		}
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.MemoryCenter().Promotions))
	case http.MethodPost:
		if !s.requireRequestSessionPermission(w, r, "memory.write") {
			return
		}

		var req MemoryPromotionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, promotion, center, err := s.store.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
			MemoryID:      req.MemoryID,
			SourceVersion: req.SourceVersion,
			Kind:          req.Kind,
			Title:         req.Title,
			Rationale:     req.Rationale,
			ProposedBy:    s.currentRequestAuthActor(r),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"promotion": promotion,
			"center":    center,
			"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMemoryCenterCompaction(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !s.requireRequestSessionPermission(w, r, "memory.read") {
			return
		}
		writeJSON(w, http.StatusOK, sanitizeLivePayload(s.store.MemoryCompactionQueue()))
	case http.MethodPost:
		if !s.requireRequestSessionPermission(w, r, "memory.write") {
			return
		}

		var req MemoryCompactionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
			return
		}

		nextState, candidate, center, err := s.store.EnqueueMemoryCompactionCandidate(store.MemoryCompactionCandidateInput{
			SourceArtifactID: req.SourceArtifactID,
			Reason:           req.Reason,
			UpdatedBy:        s.currentRequestAuthActor(r),
		})
		if err != nil {
			writeMemoryError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"candidate": candidate,
			"center":    center,
			"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *Server) handleMemoryCenterCompactionRoutes(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/v1/memory-center/compaction/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/memory-center/compaction/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "review" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory compaction candidate not found"})
		return
	}
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "memory.write") {
		return
	}

	var req MemoryCompactionReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	var (
		nextState store.State
		candidate store.MemoryCompactionCandidate
		center    store.MemoryCenter
		err       error
	)
	switch strings.TrimSpace(strings.ToLower(req.Status)) {
	case "approved":
		nextState, candidate, center, err = s.store.ApproveMemoryCompactionCandidate(parts[0], s.currentRequestAuthActor(r))
	case "dismissed":
		nextState, candidate, center, err = s.store.DismissMemoryCompactionCandidate(parts[0], s.currentRequestAuthActor(r))
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "memory compaction review status is invalid"})
		return
	}
	if err != nil {
		writeMemoryError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"candidate": candidate,
		"center":    center,
		"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
	})
}

func (s *Server) handleMemoryCenterPromotionRoutes(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/v1/memory-center/promotions/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/memory-center/promotions/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "review" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "memory promotion not found"})
		return
	}
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if !s.requireRequestSessionPermission(w, r, "memory.write") {
		return
	}

	var req MemoryPromotionReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	nextState, promotion, center, err := s.store.ReviewMemoryPromotion(parts[0], store.MemoryPromotionReviewInput{
		Status:     req.Status,
		ReviewNote: req.ReviewNote,
		ReviewedBy: s.currentRequestAuthActor(r),
	})
	if err != nil {
		writeMemoryError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"promotion": promotion,
		"center":    center,
		"state":     s.sanitizedStateSnapshotForRequest(nextState, r),
	})
}

func currentAuthActor(session store.AuthSession) string {
	if strings.TrimSpace(session.Name) != "" {
		return strings.TrimSpace(session.Name)
	}
	if strings.TrimSpace(session.Email) != "" {
		return strings.TrimSpace(session.Email)
	}
	return "System"
}

func writeMemoryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrMemoryPolicyModeInvalid),
		errors.Is(err, store.ErrMemoryPolicyMaxItemsInvalid),
		errors.Is(err, store.ErrMemoryPromotionKindInvalid),
		errors.Is(err, store.ErrMemoryPromotionTitleRequired),
		errors.Is(err, store.ErrMemoryPromotionReviewInvalid),
		errors.Is(err, store.ErrMemoryProviderBindingsRequired),
		errors.Is(err, store.ErrMemoryProviderKindInvalid),
		errors.Is(err, store.ErrMemoryProviderScopeInvalid),
		errors.Is(err, store.ErrMemoryProviderWorkspaceRequired),
		errors.Is(err, store.ErrMemoryCompactionReasonRequired),
		errors.Is(err, store.ErrMemoryFeedbackNoteRequired),
		errors.Is(err, store.ErrMemoryForgetReasonRequired),
		errors.Is(err, store.ErrMemoryArtifactImmutable),
		errors.Is(err, store.ErrMemoryArtifactForgotten),
		errors.Is(err, store.ErrMemoryArtifactAlreadyForgotten),
		errors.Is(err, store.ErrMemoryArtifactVersionConflict):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, store.ErrMemoryArtifactNotFound),
		errors.Is(err, store.ErrMemoryPromotionNotFound),
		errors.Is(err, store.ErrMemoryProviderNotFound),
		errors.Is(err, store.ErrMemoryCompactionCandidateNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
