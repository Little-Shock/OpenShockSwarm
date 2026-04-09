package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"openshock/backend/internal/actions"
	"openshock/backend/internal/core"
	"openshock/backend/internal/realtime"
	"openshock/backend/internal/store"
)

type API struct {
	store   *store.MemoryStore
	gateway *actions.Gateway
	hub     *realtime.Hub
}

func New(store *store.MemoryStore) *API {
	return newAPI(store, realtime.NewHub(512))
}

func newAPI(store *store.MemoryStore, hub *realtime.Hub) *API {
	if hub == nil {
		hub = realtime.NewHub(512)
	}
	return &API{
		store:   store,
		gateway: actions.NewGateway(store),
		hub:     hub,
	}
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/api/v1/bootstrap", a.handleBootstrap)
	mux.HandleFunc("/api/v1/issues/", a.handleIssueDetail)
	mux.HandleFunc("/api/v1/rooms/", a.handleRoomDetail)
	mux.HandleFunc("/api/v1/task-board", a.handleTaskBoard)
	mux.HandleFunc("/api/v1/inbox", a.handleInbox)
	mux.HandleFunc("/api/v1/realtime/events", a.handleRealtimeEvents)
	mux.HandleFunc("/api/v1/actions", a.handleActions)
	mux.HandleFunc("/api/v1/runtimes/register", a.handleRegisterRuntime)
	mux.HandleFunc("/api/v1/runtimes/", a.handleRuntimeRoutes)
	mux.HandleFunc("/api/v1/agent-turns/claim", a.handleClaimAgentTurn)
	mux.HandleFunc("/api/v1/agent-turns/", a.handleAgentTurnRoutes)
	mux.HandleFunc("/api/v1/runs/claim", a.handleClaimRun)
	mux.HandleFunc("/api/v1/runs/", a.handleRunRoutes)
	mux.HandleFunc("/api/v1/merges/claim", a.handleClaimMerge)
	mux.HandleFunc("/api/v1/merges/", a.handleMergeRoutes)
	mux.HandleFunc("/api/v1/webhooks/repo", a.handleRepoWebhook)
	return withCORS(mux)
}

func (a *API) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, a.store.Bootstrap())
}

func (a *API) handleIssueDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	issueID := strings.TrimPrefix(r.URL.Path, "/api/v1/issues/")
	if issueID == "" {
		http.NotFound(w, r)
		return
	}

	resp, err := a.store.IssueDetail(issueID)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleRoomDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	roomID := strings.TrimPrefix(r.URL.Path, "/api/v1/rooms/")
	if roomID == "" {
		http.NotFound(w, r)
		return
	}

	resp, err := a.store.RoomDetail(roomID)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleTaskBoard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, a.store.TaskBoard())
}

func (a *API) handleInbox(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, a.store.Inbox())
}

func (a *API) handleActions(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	if replay, ok := a.store.LookupActionResult(req.IdempotencyKey); ok {
		writeJSON(w, http.StatusOK, replay)
		return
	}

	resp, err := a.gateway.Submit(req)
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, store.ErrNotFound) {
			code = http.StatusNotFound
		}
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}

	a.publish("action.applied", a.scopesForAction(req, resp), map[string]any{
		"actionId":      resp.ActionID,
		"actionType":    req.ActionType,
		"targetType":    req.TargetType,
		"targetId":      req.TargetID,
		"status":        resp.Status,
		"resultCode":    resp.ResultCode,
		"actorType":     req.ActorType,
		"actorId":       req.ActorID,
		"issueId":       a.issueIDForAction(req, resp),
		"entityChanges": resp.AffectedEntities,
	})

	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleRegisterRuntime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.RegisterRuntimeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	runtime := a.store.RegisterRuntime(req.Name, req.Provider, req.SlotCount)
	a.publish("runtime.registered", []string{
		a.workspaceScope(),
		"runtime:all",
		fmt.Sprintf("runtime:%s", runtime.ID),
	}, map[string]any{
		"runtimeId": runtime.ID,
		"status":    runtime.Status,
		"provider":  runtime.Provider,
	})
	writeJSON(w, http.StatusOK, core.RegisterRuntimeResponse{Runtime: runtime})
}

func (a *API) handleRuntimeRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/runtimes/")
	if strings.HasSuffix(path, "/heartbeat") {
		runtimeID := strings.TrimSuffix(path, "/heartbeat")
		a.handleRuntimeHeartbeat(w, r, strings.TrimSuffix(runtimeID, "/"))
		return
	}
	http.NotFound(w, r)
}

func (a *API) handleRuntimeHeartbeat(w http.ResponseWriter, r *http.Request, runtimeID string) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.RuntimeHeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	runtime, err := a.store.HeartbeatRuntime(runtimeID, req.Status)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	a.publish("runtime.heartbeat", []string{
		a.workspaceScope(),
		"runtime:all",
		fmt.Sprintf("runtime:%s", runtime.ID),
	}, map[string]any{
		"runtimeId": runtime.ID,
		"status":    runtime.Status,
	})

	writeJSON(w, http.StatusOK, core.RuntimeHeartbeatResponse{
		RuntimeID: runtime.ID,
		Status:    runtime.Status,
	})
}

func (a *API) handleClaimAgentTurn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.AgentTurnClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	turn, claimed, err := a.store.ClaimNextQueuedAgentTurn(req.RuntimeID)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	response := core.AgentTurnClaimResponse{Claimed: claimed}
	if claimed {
		response.AgentTurn = &turn
		scopes := []string{
			a.workspaceScope(),
			fmt.Sprintf("room:%s", turn.Turn.RoomID),
			"runtime:all",
			fmt.Sprintf("runtime:%s", req.RuntimeID),
			fmt.Sprintf("agent_turn:%s", turn.Turn.ID),
		}
		if issueID := strings.TrimSpace(turn.Room.IssueID); issueID != "" {
			scopes = append(scopes, fmt.Sprintf("issue:%s", issueID))
		}
		a.publish("agent_turn.claimed", scopes, map[string]any{
			"agentTurnId": turn.Turn.ID,
			"roomId":      turn.Turn.RoomID,
			"agentId":     turn.Turn.AgentID,
			"runtimeId":   req.RuntimeID,
			"status":      turn.Turn.Status,
			"wakeupMode":  turn.Turn.WakeupMode,
		})
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *API) handleAgentTurnRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/agent-turns/")
	if strings.HasSuffix(path, "/complete") {
		turnID := strings.TrimSuffix(path, "/complete")
		a.handleCompleteAgentTurn(w, r, strings.TrimSuffix(turnID, "/"))
		return
	}
	http.NotFound(w, r)
}

func (a *API) handleCompleteAgentTurn(w http.ResponseWriter, r *http.Request, turnID string) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.AgentTurnCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	turn, err := a.store.CompleteAgentTurn(turnID, req.RuntimeID, req.ResultMessageID)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	scopes := []string{
		a.workspaceScope(),
		fmt.Sprintf("room:%s", turn.RoomID),
		"runtime:all",
		fmt.Sprintf("runtime:%s", req.RuntimeID),
		fmt.Sprintf("agent_turn:%s", turn.ID),
	}
	if issueID, ok := a.store.IssueIDForAgentTurn(turn.ID); ok {
		scopes = append(scopes, fmt.Sprintf("issue:%s", issueID))
	}
	a.publish("agent_turn.updated", scopes, map[string]any{
		"agentTurnId":     turn.ID,
		"roomId":          turn.RoomID,
		"agentId":         turn.AgentID,
		"runtimeId":       req.RuntimeID,
		"status":          turn.Status,
		"wakeupMode":      turn.WakeupMode,
		"resultMessageId": req.ResultMessageID,
	})

	writeJSON(w, http.StatusOK, core.AgentTurnCompleteResponse{
		AgentTurnID: turn.ID,
		Status:      turn.Status,
	})
}

func (a *API) handleClaimRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.RunClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	run, claimed, err := a.store.ClaimNextQueuedRun(req.RuntimeID)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	response := core.RunClaimResponse{Claimed: claimed}
	if claimed {
		response.Run = &run
		a.publish("run.claimed", []string{
			a.workspaceScope(),
			"board:default",
			"runtime:all",
			fmt.Sprintf("runtime:%s", req.RuntimeID),
			fmt.Sprintf("task:%s", run.TaskID),
			fmt.Sprintf("run:%s", run.ID),
			fmt.Sprintf("issue:%s", run.IssueID),
		}, map[string]any{
			"runId":      run.ID,
			"taskId":     run.TaskID,
			"issueId":    run.IssueID,
			"runtimeId":  req.RuntimeID,
			"status":     run.Status,
			"branchName": run.BranchName,
			"baseBranch": run.BaseBranch,
		})
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *API) handleRunRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/runs/")
	if strings.HasSuffix(path, "/events") {
		runID := strings.TrimSuffix(path, "/events")
		a.handleRunEvents(w, r, strings.TrimSuffix(runID, "/"))
		return
	}
	http.NotFound(w, r)
}

func (a *API) handleClaimMerge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.MergeClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	mergeAttempt, claimed, err := a.store.ClaimNextQueuedMerge(req.RuntimeID)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	response := core.MergeClaimResponse{Claimed: claimed}
	if claimed {
		response.MergeAttempt = &mergeAttempt
		a.publish("merge.claimed", []string{
			a.workspaceScope(),
			"board:default",
			"runtime:all",
			fmt.Sprintf("runtime:%s", req.RuntimeID),
			fmt.Sprintf("task:%s", mergeAttempt.TaskID),
			fmt.Sprintf("merge:%s", mergeAttempt.ID),
			fmt.Sprintf("issue:%s", mergeAttempt.IssueID),
		}, map[string]any{
			"mergeAttemptId": mergeAttempt.ID,
			"taskId":         mergeAttempt.TaskID,
			"issueId":        mergeAttempt.IssueID,
			"runtimeId":      req.RuntimeID,
			"status":         mergeAttempt.Status,
		})
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *API) handleMergeRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/merges/")
	if strings.HasSuffix(path, "/events") {
		mergeAttemptID := strings.TrimSuffix(path, "/events")
		a.handleMergeEvents(w, r, strings.TrimSuffix(mergeAttemptID, "/"))
		return
	}
	http.NotFound(w, r)
}

func (a *API) handleRunEvents(w http.ResponseWriter, r *http.Request, runID string) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.RunEventRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	run, err := a.store.IngestRunEvent(runID, req.RuntimeID, req.EventType, req.OutputPreview, req.Message, req.Stream, req.ToolCall)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	a.publish("run.updated", []string{
		a.workspaceScope(),
		"board:default",
		"inbox:default",
		"runtime:all",
		fmt.Sprintf("runtime:%s", req.RuntimeID),
		fmt.Sprintf("task:%s", run.TaskID),
		fmt.Sprintf("run:%s", run.ID),
		fmt.Sprintf("issue:%s", run.IssueID),
	}, map[string]any{
		"runId":     run.ID,
		"taskId":    run.TaskID,
		"issueId":   run.IssueID,
		"runtimeId": req.RuntimeID,
		"eventType": req.EventType,
		"status":    run.Status,
		"toolCall":  req.ToolCall != nil,
		"hasOutput": strings.TrimSpace(req.OutputPreview) != "" || strings.TrimSpace(req.Message) != "",
		"stream":    req.Stream,
	})

	writeJSON(w, http.StatusOK, core.RunEventResponse{
		RunID:  run.ID,
		Status: run.Status,
	})
}

func (a *API) handleMergeEvents(w http.ResponseWriter, r *http.Request, mergeAttemptID string) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.MergeEventRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	mergeAttempt, err := a.store.IngestMergeEvent(mergeAttemptID, req.RuntimeID, req.EventType, req.ResultSummary)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	a.publish("merge.updated", []string{
		a.workspaceScope(),
		"board:default",
		"inbox:default",
		"runtime:all",
		fmt.Sprintf("runtime:%s", req.RuntimeID),
		fmt.Sprintf("task:%s", mergeAttempt.TaskID),
		fmt.Sprintf("merge:%s", mergeAttempt.ID),
		fmt.Sprintf("issue:%s", mergeAttempt.IssueID),
	}, map[string]any{
		"mergeAttemptId": mergeAttempt.ID,
		"taskId":         mergeAttempt.TaskID,
		"issueId":        mergeAttempt.IssueID,
		"runtimeId":      req.RuntimeID,
		"eventType":      req.EventType,
		"status":         mergeAttempt.Status,
	})

	writeJSON(w, http.StatusOK, core.MergeEventResponse{
		MergeAttemptID: mergeAttempt.ID,
		Status:         mergeAttempt.Status,
	})
}

func (a *API) handleRepoWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	var req core.RepoWebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON payload"})
		return
	}

	resp, err := a.store.IngestRepoWebhook(req.EventID, req.Provider, req.ExternalPRID, req.Status)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if !resp.Replayed {
		scopes := []string{
			a.workspaceScope(),
			"board:default",
			"inbox:default",
		}
		if issueID, ok := a.store.IssueIDForDeliveryPR(resp.DeliveryPRID); ok {
			scopes = append(scopes, fmt.Sprintf("issue:%s", issueID))
		}

		a.publish("delivery_pr.updated", scopes, map[string]any{
			"deliveryPrId": resp.DeliveryPRID,
			"status":       resp.Status,
			"provider":     req.Provider,
			"externalPrId": req.ExternalPRID,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleRealtimeEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}

	subscription := a.hub.Subscribe(r.URL.Query()["scope"], parseLastSequence(r))
	defer subscription.Close()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if subscription.Resync {
		if err := writeSSEEvent(w, flusher, "resync_required", strconv.FormatInt(subscription.Current, 10), map[string]any{
			"reason":          "history_gap",
			"currentSequence": subscription.Current,
		}); err != nil {
			return
		}
	}

	for _, event := range subscription.Replay {
		if err := writeSSEEvent(w, flusher, "update", event.ID, event); err != nil {
			return
		}
	}

	if err := writeSSEEvent(w, flusher, "ready", strconv.FormatInt(subscription.Current, 10), map[string]any{
		"currentSequence": subscription.Current,
		"scopes":          r.URL.Query()["scope"],
	}); err != nil {
		return
	}

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-subscription.Events:
			if !ok {
				_ = writeSSEEvent(w, flusher, "resync_required", strconv.FormatInt(a.hub.CurrentSequence(), 10), map[string]any{
					"reason":          "subscriber_lagged",
					"currentSequence": a.hub.CurrentSequence(),
				})
				return
			}
			if err := writeSSEEvent(w, flusher, "update", event.ID, event); err != nil {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (a *API) publish(eventType string, scopes []string, payload map[string]any) {
	if a.hub == nil {
		return
	}
	a.hub.Publish(eventType, scopes, payload)
}

func (a *API) workspaceScope() string {
	return fmt.Sprintf("workspace:%s", a.store.WorkspaceID())
}

func (a *API) scopesForAction(req core.ActionRequest, resp core.ActionResponse) []string {
	scopes := map[string]struct{}{
		a.workspaceScope(): {},
	}

	addEntityScopes := func(entityType, entityID string) {
		entityID = strings.TrimSpace(entityID)
		if entityID == "" {
			return
		}

		switch entityType {
		case "workspace":
			scopes[a.workspaceScope()] = struct{}{}
		case "agent_session":
			scopes[a.workspaceScope()] = struct{}{}
		case "agent_turn":
			scopes[fmt.Sprintf("agent_turn:%s", entityID)] = struct{}{}
			if roomID, ok := a.store.RoomIDForAgentTurn(entityID); ok {
				scopes[fmt.Sprintf("room:%s", roomID)] = struct{}{}
			}
			if issueID, ok := a.store.IssueIDForAgentTurn(entityID); ok {
				scopes[fmt.Sprintf("issue:%s", issueID)] = struct{}{}
			}
		case "room":
			scopes[fmt.Sprintf("room:%s", entityID)] = struct{}{}
		case "issue":
			scopes[fmt.Sprintf("issue:%s", entityID)] = struct{}{}
		case "task":
			scopes["board:default"] = struct{}{}
			scopes[fmt.Sprintf("task:%s", entityID)] = struct{}{}
			if issueID, ok := a.store.IssueIDForTask(entityID); ok {
				scopes[fmt.Sprintf("issue:%s", issueID)] = struct{}{}
			}
		case "run":
			scopes["board:default"] = struct{}{}
			scopes["inbox:default"] = struct{}{}
			scopes[fmt.Sprintf("run:%s", entityID)] = struct{}{}
			if issueID, ok := a.store.IssueIDForRun(entityID); ok {
				scopes[fmt.Sprintf("issue:%s", issueID)] = struct{}{}
			}
		case "merge_attempt":
			scopes["board:default"] = struct{}{}
			scopes["inbox:default"] = struct{}{}
			scopes[fmt.Sprintf("merge:%s", entityID)] = struct{}{}
			if issueID, ok := a.store.IssueIDForMergeAttempt(entityID); ok {
				scopes[fmt.Sprintf("issue:%s", issueID)] = struct{}{}
			}
		case "delivery_pr", "integration_branch":
			scopes["board:default"] = struct{}{}
		case "runtime":
			scopes["runtime:all"] = struct{}{}
			scopes[fmt.Sprintf("runtime:%s", entityID)] = struct{}{}
		}
	}

	addEntityScopes(req.TargetType, req.TargetID)
	for _, entity := range resp.AffectedEntities {
		addEntityScopes(entity.Type, entity.ID)
	}

	result := make([]string, 0, len(scopes))
	for scope := range scopes {
		result = append(result, scope)
	}
	return result
}

func (a *API) issueIDForAction(req core.ActionRequest, resp core.ActionResponse) string {
	switch req.TargetType {
	case "issue":
		return req.TargetID
	case "task":
		if issueID, ok := a.store.IssueIDForTask(req.TargetID); ok {
			return issueID
		}
	case "run":
		if issueID, ok := a.store.IssueIDForRun(req.TargetID); ok {
			return issueID
		}
	}

	for _, entity := range resp.AffectedEntities {
		switch entity.Type {
		case "issue":
			return entity.ID
		case "task":
			if issueID, ok := a.store.IssueIDForTask(entity.ID); ok {
				return issueID
			}
		case "run":
			if issueID, ok := a.store.IssueIDForRun(entity.ID); ok {
				return issueID
			}
		case "merge_attempt":
			if issueID, ok := a.store.IssueIDForMergeAttempt(entity.ID); ok {
				return issueID
			}
		}
	}
	return ""
}

func parseLastSequence(r *http.Request) int64 {
	raw := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("lastEventId"))
	}
	if raw == "" {
		return 0
	}
	sequence, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || sequence < 0 {
		return 0
	}
	return sequence
}

func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, eventName, id string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if id != "" {
		if _, err := fmt.Fprintf(w, "id: %s\n", id); err != nil {
			return err
		}
	}
	if eventName != "" {
		if _, err := fmt.Fprintf(w, "event: %s\n", eventName); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Last-Event-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func writeJSON(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}
