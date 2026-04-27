package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type directWorktreeDaemonRoundTripper struct {
	t *testing.T
}

func (rt directWorktreeDaemonRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.t.Helper()

	if req.Method == http.MethodPost && req.URL.Path == "/v1/worktrees/ensure" {
		var payload WorktreeRequest
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			rt.t.Fatalf("decode daemon worktree ensure payload error = %v", err)
		}
		body, err := json.Marshal(WorktreeResponse{
			WorkspaceRoot: payload.WorkspaceRoot,
			Branch:        payload.Branch,
			WorktreeName:  payload.WorktreeName,
			Path:          filepath.Join(payload.WorkspaceRoot, payload.WorktreeName),
			Created:       true,
			BaseRef:       payload.BaseRef,
		})
		if err != nil {
			rt.t.Fatalf("marshal daemon worktree ensure response error = %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewReader(body)),
		}, nil
	}

	body, err := json.Marshal(map[string]string{
		"error": "unexpected daemon request: " + req.Method + " " + req.URL.Path,
	})
	if err != nil {
		rt.t.Fatalf("marshal daemon error response error = %v", err)
	}
	return &http.Response{
		StatusCode: http.StatusNotFound,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(bytes.NewReader(body)),
	}, nil
}

func newDirectContractHandler(t *testing.T, root string) (*store.Store, http.Handler, string) {
	t.Helper()

	statePath := filepath.Join(root, "data", "state.json")
	s, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New() error = %v", err)
	}
	mustLoginReadyOwner(t, s)

	client := &http.Client{Transport: directWorktreeDaemonRoundTripper{t: t}}
	server := New(s, client, Config{
		DaemonURL:     "http://127.0.0.1:8090",
		WorkspaceRoot: root,
	})
	token, _ := server.issueRequestAuthToken(s.Snapshot().Auth.Session)
	return s, server.Handler(), token
}

func serveJSONToHandler(t *testing.T, handler http.Handler, authToken, method, path string, body any) *http.Response {
	t.Helper()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("Marshal(%s %s) error = %v", method, path, err)
		}
		reader = bytes.NewReader(raw)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(authToken) != "" {
		req.Header.Set(authTokenHeaderName, authToken)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder.Result()
}

func findRequestedHandoffForRoom(
	mailbox []store.AgentHandoff,
	roomID string,
	fromAgent string,
	toAgent string,
) *store.AgentHandoff {
	for index := range mailbox {
		item := &mailbox[index]
		if item.RoomID == roomID &&
			item.Status == "requested" &&
			item.FromAgent == fromAgent &&
			item.ToAgent == toAgent {
			return item
		}
	}
	return nil
}

func TestWebsiteFourAgentDeliveryContractReplayWithoutListener(t *testing.T) {
	root := t.TempDir()
	_, handler, authToken := newDirectContractHandler(t, root)

	topologyResp := serveJSONToHandler(t, handler, authToken, http.MethodPatch, "/v1/workspace", map[string]any{
		"governance": map[string]any{
			"teamTopology": []map[string]string{
				{"id": "architect", "label": "Architect", "role": "网站信息架构与边界", "defaultAgent": "Codex Dockmaster", "lane": "scope / IA"},
				{"id": "developer", "label": "Developer", "role": "页面实现与交互收口", "defaultAgent": "Build Pilot", "lane": "build / polish"},
				{"id": "reviewer", "label": "Reviewer", "role": "exact-head 复核", "defaultAgent": "Claude Review Runner", "lane": "review / copy"},
				{"id": "qa", "label": "QA", "role": "跨端验证与演示确认", "defaultAgent": "Memory Clerk", "lane": "verify / demo"},
			},
		},
	})
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	var topologyPayload struct {
		Workspace store.WorkspaceSnapshot `json:"workspace"`
		State     store.State             `json:"state"`
	}
	decodeJSON(t, topologyResp, &topologyPayload)
	if len(topologyPayload.Workspace.Governance.TeamTopology) != 4 {
		t.Fatalf("workspace governance topology = %#v, want 4 lanes", topologyPayload.Workspace.Governance.TeamTopology)
	}
	if findGovernanceLane(topologyPayload.Workspace.Governance.TeamTopology, "developer") == nil {
		t.Fatalf("workspace governance topology = %#v, want developer lane", topologyPayload.Workspace.Governance.TeamTopology)
	}
	if !containsAgentID(topologyPayload.State.Agents, "agent-build-pilot") {
		t.Fatalf("state agents = %#v, want Build Pilot in live state", topologyPayload.State.Agents)
	}

	issueResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/issues", map[string]string{
		"title":    "Build website landing page",
		"summary":  "Ship a marketing website with a clear hero, pricing, FAQ, and a user-ready demo path.",
		"owner":    "Codex Dockmaster",
		"priority": "critical",
	})
	defer issueResp.Body.Close()
	if issueResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/issues status = %d, want %d", issueResp.StatusCode, http.StatusCreated)
	}

	var issuePayload struct {
		RoomID    string      `json:"roomId"`
		RunID     string      `json:"runId"`
		SessionID string      `json:"sessionId"`
		State     store.State `json:"state"`
	}
	decodeJSON(t, issueResp, &issuePayload)
	if issuePayload.RoomID == "" || issuePayload.RunID == "" || issuePayload.SessionID == "" {
		t.Fatalf("create issue payload = %#v, want roomId/runId/sessionId", issuePayload)
	}
	createdIssue := findIssueByRoomID(issuePayload.State, issuePayload.RoomID)
	if createdIssue == nil {
		t.Fatalf("state issues = %#v, want issue for room %q", issuePayload.State.Issues, issuePayload.RoomID)
	}
	createdSession := findSessionByID(issuePayload.State, issuePayload.SessionID)
	if createdSession == nil {
		t.Fatalf("state sessions = %#v, want session %q", issuePayload.State.Sessions, issuePayload.SessionID)
	}
	if strings.TrimSpace(createdSession.WorktreePath) == "" {
		t.Fatalf("created session = %#v, want attached worktree path", createdSession)
	}

	plannerQueueResp := serveJSONToHandler(t, handler, authToken, http.MethodGet, "/v1/planner/queue", nil)
	defer plannerQueueResp.Body.Close()
	if plannerQueueResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/planner/queue status = %d, want %d", plannerQueueResp.StatusCode, http.StatusOK)
	}
	var plannerQueue []store.PlannerQueueItem
	decodeJSON(t, plannerQueueResp, &plannerQueue)
	var queuedItem *store.PlannerQueueItem
	for index := range plannerQueue {
		if plannerQueue[index].SessionID == issuePayload.SessionID {
			queuedItem = &plannerQueue[index]
			break
		}
	}
	if queuedItem == nil {
		t.Fatalf("planner queue = %#v, want session %q", plannerQueue, issuePayload.SessionID)
	}

	assignmentResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/planner/sessions/"+issuePayload.SessionID+"/assignment", map[string]string{
		"agentId": "agent-codex-dockmaster",
	})
	defer assignmentResp.Body.Close()
	if assignmentResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/planner/sessions/:id/assignment status = %d, want %d", assignmentResp.StatusCode, http.StatusOK)
	}
	var assignmentPayload struct {
		Item  store.PlannerQueueItem `json:"item"`
		State store.State            `json:"state"`
	}
	decodeJSON(t, assignmentResp, &assignmentPayload)
	if assignmentPayload.Item.AgentID != "agent-codex-dockmaster" || assignmentPayload.Item.Owner != "Codex Dockmaster" {
		t.Fatalf("planner assignment payload = %#v, want Codex Dockmaster owner", assignmentPayload.Item)
	}

	architectHandoffResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox", map[string]string{
		"roomId":      issuePayload.RoomID,
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-build-pilot",
		"title":       "Architect handoff for website",
		"summary":     "信息架构、区块顺序和 CTA 边界已经收清，交给开发开始落页面。",
		"kind":        "governed",
	})
	defer architectHandoffResp.Body.Close()
	if architectHandoffResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", architectHandoffResp.StatusCode, http.StatusCreated)
	}
	var architectHandoffPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
		State   store.State        `json:"state"`
	}
	decodeJSON(t, architectHandoffResp, &architectHandoffPayload)
	if architectHandoffPayload.Handoff.FromAgent != "Codex Dockmaster" || architectHandoffPayload.Handoff.ToAgent != "Build Pilot" {
		t.Fatalf("architect handoff = %#v, want Codex Dockmaster -> Build Pilot", architectHandoffPayload.Handoff)
	}

	developerAckResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+architectHandoffPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-build-pilot",
	})
	defer developerAckResp.Body.Close()
	if developerAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST developer acknowledged status = %d, want %d", developerAckResp.StatusCode, http.StatusOK)
	}

	developerCompleteResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+architectHandoffPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-build-pilot",
		"note":                  "首屏、定价、FAQ 和 CTA 已落好，交给评审做 exact-head 复核。",
		"continueGovernedRoute": true,
	})
	defer developerCompleteResp.Body.Close()
	if developerCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST developer completed status = %d, want %d", developerCompleteResp.StatusCode, http.StatusOK)
	}
	var developerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, developerCompleteResp, &developerCompletePayload)
	reviewerHandoff := findRequestedHandoffForRoom(
		developerCompletePayload.State.Mailbox,
		issuePayload.RoomID,
		"Build Pilot",
		"Claude Review Runner",
	)
	if reviewerHandoff == nil {
		t.Fatalf("mailbox = %#v, want requested reviewer handoff", developerCompletePayload.State.Mailbox)
	}

	reviewerBlockedWithoutNoteResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+reviewerHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer reviewerBlockedWithoutNoteResp.Body.Close()
	if reviewerBlockedWithoutNoteResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST reviewer blocked without note status = %d, want %d", reviewerBlockedWithoutNoteResp.StatusCode, http.StatusBadRequest)
	}
	var blockedWithoutNotePayload map[string]string
	decodeJSON(t, reviewerBlockedWithoutNoteResp, &blockedWithoutNotePayload)
	if !strings.Contains(blockedWithoutNotePayload["error"], "note") {
		t.Fatalf("blocked without note payload = %#v, want note requirement", blockedWithoutNotePayload)
	}

	reviewerBlockedResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+reviewerHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "Hero 文案和 FAQ 顺序还要再收平。",
	})
	defer reviewerBlockedResp.Body.Close()
	if reviewerBlockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer blocked status = %d, want %d", reviewerBlockedResp.StatusCode, http.StatusOK)
	}
	var reviewerBlockedPayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, reviewerBlockedResp, &reviewerBlockedPayload)
	reviewerLane := findGovernanceLane(reviewerBlockedPayload.State.Workspace.Governance.TeamTopology, "reviewer")
	if reviewerLane == nil || reviewerLane.Status != "blocked" {
		t.Fatalf("reviewer lane = %#v, want blocked", reviewerBlockedPayload.State.Workspace.Governance.TeamTopology)
	}
	blockedRollup := findEscalationRoomRollupByRoomID(reviewerBlockedPayload.State.Workspace.Governance.EscalationSLA.Rollup, issuePayload.RoomID)
	if blockedRollup == nil || blockedRollup.Status != "blocked" {
		t.Fatalf("governance rollup = %#v, want blocked room rollup", reviewerBlockedPayload.State.Workspace.Governance.EscalationSLA.Rollup)
	}

	reviewerAckResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+reviewerHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer reviewerAckResp.Body.Close()
	if reviewerAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", reviewerAckResp.StatusCode, http.StatusOK)
	}

	reviewerCompleteResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+reviewerHandoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "视觉层级、CTA 文案和导航一致性已复核，可以交 QA 做最终验证。",
		"continueGovernedRoute": true,
	})
	defer reviewerCompleteResp.Body.Close()
	if reviewerCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed status = %d, want %d", reviewerCompleteResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, reviewerCompleteResp, &reviewerCompletePayload)
	qaHandoff := findRequestedHandoffForRoom(
		reviewerCompletePayload.State.Mailbox,
		issuePayload.RoomID,
		"Claude Review Runner",
		"Memory Clerk",
	)
	if qaHandoff == nil {
		t.Fatalf("mailbox = %#v, want requested QA handoff", reviewerCompletePayload.State.Mailbox)
	}

	qaAckResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer qaAckResp.Body.Close()
	if qaAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", qaAckResp.StatusCode, http.StatusOK)
	}

	qaCompleteResp := serveJSONToHandler(t, handler, authToken, http.MethodPost, "/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "桌面和移动主链验证已通过，网站可以给用户演示。",
	})
	defer qaCompleteResp.Body.Close()
	if qaCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", qaCompleteResp.StatusCode, http.StatusOK)
	}
	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, qaCompleteResp, &qaCompletePayload)

	finalState := qaCompletePayload.State
	if finalState.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "done" {
		t.Fatalf("governance suggestion = %#v, want done after QA closeout", finalState.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
	if !strings.Contains(finalState.Workspace.Governance.ResponseAggregation.FinalResponse, "桌面和移动主链验证已通过，网站可以给用户演示。") {
		t.Fatalf("response aggregation = %#v, want QA closeout note", finalState.Workspace.Governance.ResponseAggregation)
	}
	finalStep := findGovernanceWalkthroughStep(finalState.Workspace.Governance.Walkthrough, "final-response")
	if finalStep == nil || finalStep.Status != "ready" {
		t.Fatalf("walkthrough = %#v, want final-response ready", finalState.Workspace.Governance.Walkthrough)
	}
	if dangling := findRequestedGovernedHandoffForRoom(finalState.Mailbox, issuePayload.RoomID); dangling != nil {
		t.Fatalf("mailbox = %#v, want no remaining requested governed handoff for current room", finalState.Mailbox)
	}
}

func containsAgentID(agents []store.Agent, want string) bool {
	for _, agent := range agents {
		if agent.ID == want {
			return true
		}
	}
	return false
}

func findRequestedGovernedHandoffForRoom(mailbox []store.AgentHandoff, roomID string) *store.AgentHandoff {
	for index := range mailbox {
		item := &mailbox[index]
		if item.RoomID == roomID && item.Kind == "governed" && item.Status == "requested" {
			return item
		}
	}
	return nil
}
