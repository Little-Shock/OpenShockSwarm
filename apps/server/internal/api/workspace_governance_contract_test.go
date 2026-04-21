package api

import (
	"net/http"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestStateRouteExposesGovernanceSnapshot(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var state store.State
	decodeJSON(t, resp, &state)

	if state.Workspace.Governance.TemplateID != "dev-team" || len(state.Workspace.Governance.TeamTopology) != 5 {
		t.Fatalf("workspace governance = %#v, want dev-team topology snapshot", state.Workspace.Governance)
	}
	if state.Workspace.Governance.HumanOverride.Status != "required" {
		t.Fatalf("human override = %#v, want required override gate", state.Workspace.Governance.HumanOverride)
	}
	if state.Workspace.Governance.RoutingPolicy.DefaultRoute == "" || len(state.Workspace.Governance.RoutingPolicy.Rules) == 0 {
		t.Fatalf("routing policy = %#v, want routing matrix in governance snapshot", state.Workspace.Governance.RoutingPolicy)
	}
	if state.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "ready" ||
		state.Workspace.Governance.RoutingPolicy.SuggestedHandoff.ToAgent != "Claude Review Runner" {
		t.Fatalf("suggested handoff = %#v, want ready Codex -> Claude governance suggestion", state.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
	if state.Workspace.Governance.EscalationSLA.TimeoutMinutes == 0 || state.Workspace.Governance.NotificationPolicy.BrowserPush == "" {
		t.Fatalf("sla/notification = %#v / %#v, want governance SLA + notification truth", state.Workspace.Governance.EscalationSLA, state.Workspace.Governance.NotificationPolicy)
	}
	if len(state.Workspace.Governance.EscalationSLA.Rollup) == 0 {
		t.Fatalf("escalation rollup = %#v, want existing workspace-level blocked room rollup", state.Workspace.Governance.EscalationSLA.Rollup)
	}
	baselineRollup := state.Workspace.Governance.EscalationSLA.Rollup[0]
	if baselineRollup.RoomID == "" || baselineRollup.Status != "blocked" {
		t.Fatalf("baseline escalation rollup = %#v, want blocked room-level rollup", state.Workspace.Governance.EscalationSLA.Rollup)
	}
	if baselineRollup.NextRouteSummary == "" || baselineRollup.NextRouteHref == "" {
		t.Fatalf("baseline escalation rollup routing = %#v, want next-route metadata for hot room", baselineRollup)
	}
	if baselineRollup.NextRouteHrefLabel == "" {
		t.Fatalf("baseline escalation rollup action label = %#v, want explicit next-route action label", baselineRollup)
	}
	if baselineRollup.HrefLabel == "" {
		t.Fatalf("baseline escalation rollup room link label = %#v, want explicit room-context action label", baselineRollup)
	}
	if state.Workspace.Governance.Stats.AggregationSources == 0 {
		t.Fatalf("governance stats = %#v, want aggregation source count", state.Workspace.Governance.Stats)
	}
	if len(state.Workspace.Governance.Walkthrough) != 5 {
		t.Fatalf("walkthrough = %#v, want issue->handoff->review->test->final-response chain", state.Workspace.Governance.Walkthrough)
	}
}

func TestMailboxLifecycleUpdatesGovernanceSnapshot(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()
	baselineState := readStateSnapshot(t, server.URL)
	secondRoomID := findAlternateGovernanceRoomID(baselineState, "room-runtime")
	if secondRoomID == "" {
		t.Fatalf("baseline rooms = %#v, want second room for cross-room governance rollup", baselineState.Rooms)
	}

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	createResp.Body.Close()

	afterCreate := readStateSnapshot(t, server.URL)
	if afterCreate.Workspace.Governance.Stats.OpenHandoffs != 1 {
		t.Fatalf("governance stats after create = %#v, want 1 open handoff", afterCreate.Workspace.Governance.Stats)
	}
	if len(afterCreate.Workspace.Governance.EscalationSLA.Queue) == 0 ||
		afterCreate.Workspace.Governance.EscalationSLA.Queue[0].Source != "交接" {
		t.Fatalf("escalation queue after create = %#v, want customer-facing handoff entry", afterCreate.Workspace.Governance.EscalationSLA)
	}
	if afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "active" ||
		afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HandoffID != handoff.ID {
		t.Fatalf("governed handoff after create = %#v, want active suggestion focused on current handoff", afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
	if afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HrefLabel != "收件箱定位" {
		t.Fatalf("governed handoff action label after create = %#v, want explicit active handoff CTA", afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
	handoffStep := findGovernanceWalkthroughStep(afterCreate.Workspace.Governance.Walkthrough, "handoff")
	if handoffStep == nil || handoffStep.Status != "active" {
		t.Fatalf("handoff step after create = %#v, want active handoff walkthrough", handoffStep)
	}

	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "等 reviewer evidence 先收平。",
	})
	blockedResp.Body.Close()

	afterBlocked := readStateSnapshot(t, server.URL)
	reviewerLane := findGovernanceLane(afterBlocked.Workspace.Governance.TeamTopology, "reviewer")
	if reviewerLane == nil || reviewerLane.Status != "blocked" {
		t.Fatalf("reviewer lane after block = %#v, want blocked reviewer lane", reviewerLane)
	}
	if afterBlocked.Workspace.Governance.Stats.BlockedEscalations == 0 {
		t.Fatalf("blocked governance stats = %#v, want blocked escalation count", afterBlocked.Workspace.Governance.Stats)
	}
	if findEscalationQueueEntryBySource(afterBlocked.Workspace.Governance.EscalationSLA.Queue, "收件箱") == nil {
		t.Fatalf("blocked escalation queue = %#v, want customer-facing inbox entry", afterBlocked.Workspace.Governance.EscalationSLA.Queue)
	}
	runtimeRollup := findEscalationRoomRollupByRoomID(afterBlocked.Workspace.Governance.EscalationSLA.Rollup, "room-runtime")
	if runtimeRollup == nil || runtimeRollup.Status != "blocked" || runtimeRollup.EscalationCount != 2 || runtimeRollup.BlockedCount != 2 {
		t.Fatalf("blocked escalation rollup = %#v, want blocked runtime room rollup", afterBlocked.Workspace.Governance.EscalationSLA.Rollup)
	}

	ackResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	ackResp.Body.Close()
	completeResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+handoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-claude-review-runner",
		"note":          "review / test evidence 已收平，可以回到最终响应。",
	})
	completeResp.Body.Close()

	afterComplete := readStateSnapshot(t, server.URL)
	if afterComplete.Workspace.Governance.ResponseAggregation.Status != "ready" ||
		!strings.Contains(afterComplete.Workspace.Governance.ResponseAggregation.FinalResponse, "最终响应") {
		t.Fatalf("response aggregation after complete = %#v, want ready closeout note", afterComplete.Workspace.Governance.ResponseAggregation)
	}
	if afterComplete.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "ready" ||
		afterComplete.Workspace.Governance.RoutingPolicy.SuggestedHandoff.ToLaneLabel != "QA" {
		t.Fatalf("governed handoff after complete = %#v, want ready reviewer -> QA next-route suggestion", afterComplete.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
	}
	if afterComplete.Workspace.Governance.ResponseAggregation.Aggregator == "" ||
		len(afterComplete.Workspace.Governance.ResponseAggregation.AuditTrail) == 0 {
		t.Fatalf("response aggregation audit after complete = %#v, want aggregator + audit trail", afterComplete.Workspace.Governance.ResponseAggregation)
	}
	finalStep := findGovernanceWalkthroughStep(afterComplete.Workspace.Governance.Walkthrough, "final-response")
	if finalStep == nil || finalStep.Status != "ready" {
		t.Fatalf("final step after complete = %#v, want ready final response", finalStep)
	}

	secondaryCreateResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      secondRoomID,
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-memory-clerk",
		"title":       "把第二个 room 也收进 escalation rollup",
		"summary":     "保持 requested，验证跨 room 治理 rollup。",
	})
	secondaryCreateResp.Body.Close()

	afterSecondRoom := readStateSnapshot(t, server.URL)
	secondaryRollup := findEscalationRoomRollupByRoomID(afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup, secondRoomID)
	if secondaryRollup == nil || secondaryRollup.Status != "active" || secondaryRollup.EscalationCount != 1 || secondaryRollup.BlockedCount != 0 {
		t.Fatalf("second room escalation rollup = %#v, want active second-room rollup", afterSecondRoom.Workspace.Governance.EscalationSLA.Rollup)
	}
	if secondaryRollup.CurrentOwner == "" || secondaryRollup.NextRouteStatus == "" || secondaryRollup.NextRouteSummary == "" {
		t.Fatalf("second room rollup routing = %#v, want room-level governance routing metadata", secondaryRollup)
	}
}

func TestGovernanceAggregationPrefersCurrentOwnerOverStaleCompletedHandoff(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	firstResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "先接住 review lane",
		"summary":     "请先把 review lane 接起来。",
		"kind":        "room-auto",
	})
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST first room-auto handoff status = %d, want %d", firstResp.StatusCode, http.StatusCreated)
	}
	var firstPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, firstResp, &firstPayload)
	if firstPayload.Handoff.Status != "acknowledged" {
		t.Fatalf("first handoff = %#v, want room-auto acknowledged", firstPayload.Handoff)
	}

	secondResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-claude-review-runner",
		"toAgentId":   "agent-memory-clerk",
		"title":       "把记忆与收口交给 Memory",
		"summary":     "请继续负责当前 room 的记忆与收口。",
		"kind":        "room-auto",
	})
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST second room-auto handoff status = %d, want %d", secondResp.StatusCode, http.StatusCreated)
	}
	var secondPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, secondResp, &secondPayload)
	if secondPayload.Handoff.Status != "acknowledged" {
		t.Fatalf("second handoff = %#v, want room-auto acknowledged", secondPayload.Handoff)
	}

	staleCompletionNote := "旧 reviewer closeout 不该覆盖当前 Memory Clerk 真相。"
	completeResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+firstPayload.Handoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-claude-review-runner",
		"note":          staleCompletionNote,
	})
	defer completeResp.Body.Close()
	if completeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST stale handoff complete status = %d, want %d", completeResp.StatusCode, http.StatusOK)
	}

	runResp, err := http.Get(server.URL + "/v1/runs/run_runtime_01/detail")
	if err != nil {
		t.Fatalf("GET run detail error = %v", err)
	}
	defer runResp.Body.Close()
	if runResp.StatusCode != http.StatusOK {
		t.Fatalf("GET run detail status = %d, want %d", runResp.StatusCode, http.StatusOK)
	}
	var detail store.RunDetail
	decodeJSON(t, runResp, &detail)
	if detail.Run.Owner != "Memory Clerk" || detail.Room.Topic.Owner != "Memory Clerk" {
		t.Fatalf("run detail owner truth = %#v / %#v, want Memory Clerk remain current owner", detail.Run, detail.Room.Topic)
	}
	if len(detail.History) == 0 || !detail.History[0].IsCurrent || detail.History[0].Run.ID != detail.Run.ID {
		t.Fatalf("run detail history = %#v, want current run first", detail.History)
	}

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	defer centerResp.Body.Close()
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}
	var center store.MemoryCenter
	decodeJSON(t, centerResp, &center)
	preview := findPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "Memory Clerk") {
		t.Fatalf("preview summary = %q, want current owner Memory Clerk", preview.PromptSummary)
	}
	if strings.Contains(preview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("preview summary = %q, should not fall back to stale reviewer prompt", preview.PromptSummary)
	}

	state := readStateSnapshot(t, server.URL)
	aggregation := state.Workspace.Governance.ResponseAggregation
	if aggregation.Aggregator != "Memory Clerk" {
		t.Fatalf("response aggregation aggregator = %#v, want current owner Memory Clerk", aggregation)
	}
	if !strings.Contains(aggregation.FinalResponse, "Memory Clerk") {
		t.Fatalf("response aggregation final response = %#v, want current owner closeout truth", aggregation)
	}
	if strings.Contains(aggregation.FinalResponse, staleCompletionNote) {
		t.Fatalf("response aggregation final response = %#v, should ignore stale completion note", aggregation)
	}
}

func TestGovernanceResponseAggregationTracksDeliveryDelegationLifecycle(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	topologyResp := doJSONRequest(t, http.DefaultClient, http.MethodPatch, server.URL+"/v1/workspace", `{
		"governance": {
			"teamTopology": [
				{"id":"pm","label":"PM","role":"目标与验收","defaultAgent":"Codex Dockmaster","lane":"scope / final response"},
				{"id":"architect","label":"Architect","role":"拆解与边界","defaultAgent":"Codex Dockmaster","lane":"shape / split"},
				{"id":"developer","label":"Developer","role":"实现与分支推进","defaultAgent":"Build Pilot","lane":"issue -> branch"},
				{"id":"reviewer","label":"Reviewer","role":"exact-head verdict","defaultAgent":"Claude Review Runner","lane":"review / blocker"},
				{"id":"qa","label":"QA","role":"verify / release evidence","defaultAgent":"Memory Clerk","lane":"test / release gate"}
			]
		}
	}`)
	defer topologyResp.Body.Close()
	if topologyResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", topologyResp.StatusCode, http.StatusOK)
	}

	createResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox", map[string]string{
		"roomId":      "room-runtime",
		"fromAgentId": "agent-codex-dockmaster",
		"toAgentId":   "agent-claude-review-runner",
		"title":       "把 developer lane 正式交给 reviewer",
		"summary":     "当前 exact-head context 已整理，交给 reviewer 接住下一棒。",
	})
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/mailbox status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}
	var createPayload struct {
		Handoff store.AgentHandoff `json:"handoff"`
	}
	decodeJSON(t, createResp, &createPayload)

	ackReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-claude-review-runner",
	})
	defer ackReviewerResp.Body.Close()
	if ackReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer acknowledged status = %d, want %d", ackReviewerResp.StatusCode, http.StatusOK)
	}

	completeReviewerResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+createPayload.Handoff.ID, map[string]any{
		"action":                "completed",
		"actingAgentId":         "agent-claude-review-runner",
		"note":                  "review 完成后直接续到 QA。",
		"continueGovernedRoute": true,
	})
	defer completeReviewerResp.Body.Close()
	if completeReviewerResp.StatusCode != http.StatusOK {
		t.Fatalf("POST reviewer completed status = %d, want %d", completeReviewerResp.StatusCode, http.StatusOK)
	}
	var reviewerCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeReviewerResp, &reviewerCompletePayload)
	qaHandoff := reviewerCompletePayload.State.Mailbox[0]

	ackQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": "agent-memory-clerk",
	})
	defer ackQAResp.Body.Close()
	if ackQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA acknowledged status = %d, want %d", ackQAResp.StatusCode, http.StatusOK)
	}

	completeQAResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+qaHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": "agent-memory-clerk",
		"note":          "QA 验证完成，可以进入 PR delivery closeout。",
	})
	defer completeQAResp.Body.Close()
	if completeQAResp.StatusCode != http.StatusOK {
		t.Fatalf("POST QA completed status = %d, want %d", completeQAResp.StatusCode, http.StatusOK)
	}
	var qaCompletePayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, completeQAResp, &qaCompletePayload)
	delegatedHandoff := qaCompletePayload.State.Mailbox[0]

	afterDelegationReady := readStateSnapshot(t, server.URL)
	readyAggregation := afterDelegationReady.Workspace.Governance.ResponseAggregation
	if readyAggregation.Aggregator != "Codex Dockmaster" ||
		!strings.Contains(readyAggregation.FinalResponse, "Codex Dockmaster") ||
		!strings.Contains(readyAggregation.FinalResponse, "formal delivery closeout handoff") {
		t.Fatalf("ready response aggregation = %#v, want delivery delegation handoff summary owned by Codex Dockmaster", readyAggregation)
	}
	readyAudit := findResponseAggregationAuditEntry(readyAggregation.AuditTrail, "交付收尾")
	if readyAudit == nil || readyAudit.Actor != "Codex Dockmaster" || !strings.Contains(readyAudit.Summary, "formal delivery closeout handoff") {
		t.Fatalf("ready response aggregation audit = %#v, want delivery closeout audit entry", readyAggregation.AuditTrail)
	}

	blockNote := "需要先确认最终 release 文案，再继续 closeout。"
	blockedResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "blocked",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          blockNote,
	})
	defer blockedResp.Body.Close()
	if blockedResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated blocked status = %d, want %d", blockedResp.StatusCode, http.StatusOK)
	}

	afterBlocked := readStateSnapshot(t, server.URL)
	blockedAggregation := afterBlocked.Workspace.Governance.ResponseAggregation
	if blockedAggregation.Aggregator != "Codex Dockmaster" ||
		!strings.Contains(blockedAggregation.FinalResponse, blockNote) ||
		!strings.Contains(blockedAggregation.FinalResponse, "unblock response") {
		t.Fatalf("blocked response aggregation = %#v, want blocked delivery delegation summary", blockedAggregation)
	}

	responseHandoffID := findDeliveryDelegationResponseHandoffID(afterBlocked.Mailbox, delegatedHandoff.ID)
	if responseHandoffID == "" {
		t.Fatalf("mailbox after blocked = %#v, want response handoff for delegated closeout", afterBlocked.Mailbox)
	}

	responseAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.FromAgentID,
	})
	defer responseAckResp.Body.Close()
	if responseAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response acknowledged status = %d, want %d", responseAckResp.StatusCode, http.StatusOK)
	}

	completeNote := "release receipt checklist 已补齐，请重新接住 delivery closeout。"
	responseCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+responseHandoffID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.FromAgentID,
		"note":          completeNote,
	})
	defer responseCompleteResp.Body.Close()
	if responseCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST response completed status = %d, want %d", responseCompleteResp.StatusCode, http.StatusOK)
	}

	afterResponseComplete := readStateSnapshot(t, server.URL)
	responseCompleteAggregation := afterResponseComplete.Workspace.Governance.ResponseAggregation
	if responseCompleteAggregation.Aggregator != "Codex Dockmaster" ||
		responseCompleteAggregation.Status != "blocked" ||
		!strings.Contains(responseCompleteAggregation.FinalResponse, blockNote) ||
		!strings.Contains(responseCompleteAggregation.FinalResponse, "已完成第 1 轮 unblock response") ||
		!strings.Contains(responseCompleteAggregation.FinalResponse, "等待 Codex Dockmaster 重新 acknowledge final delivery closeout") {
		t.Fatalf("response-complete aggregation = %#v, want blocked delivery delegation summary with response progress", responseCompleteAggregation)
	}
	responseCompleteAudit := findResponseAggregationAuditEntry(responseCompleteAggregation.AuditTrail, "交付收尾")
	if responseCompleteAudit == nil ||
		responseCompleteAudit.Actor != "Codex Dockmaster" ||
		responseCompleteAudit.Status != "blocked" ||
		responseCompleteAudit.Summary != responseCompleteAggregation.FinalResponse {
		t.Fatalf("response-complete aggregation audit = %#v, want blocked delivery closeout audit entry synced to final response", responseCompleteAggregation.AuditTrail)
	}
	if !containsExactString(responseCompleteAggregation.DecisionPath, "交付:blocked") {
		t.Fatalf("response-complete decision path = %#v, want customer-facing delivery marker", responseCompleteAggregation.DecisionPath)
	}

	reAckResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "acknowledged",
		"actingAgentId": delegatedHandoff.ToAgentID,
	})
	defer reAckResp.Body.Close()
	if reAckResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated re-ack status = %d, want %d", reAckResp.StatusCode, http.StatusOK)
	}

	afterReAck := readStateSnapshot(t, server.URL)
	reAckAggregation := afterReAck.Workspace.Governance.ResponseAggregation
	if reAckAggregation.Aggregator != "Codex Dockmaster" ||
		reAckAggregation.Status != "ready" ||
		!strings.Contains(reAckAggregation.FinalResponse, "第 1 轮") ||
		!strings.Contains(reAckAggregation.FinalResponse, "已重新 acknowledge final delivery closeout") ||
		strings.Contains(reAckAggregation.FinalResponse, blockNote) {
		t.Fatalf("re-ack response aggregation = %#v, want resumed delivery delegation summary", reAckAggregation)
	}
	reAckAudit := findResponseAggregationAuditEntry(reAckAggregation.AuditTrail, "交付收尾")
	if reAckAudit == nil ||
		reAckAudit.Actor != "Codex Dockmaster" ||
		reAckAudit.Status != "ready" ||
		reAckAudit.Summary != reAckAggregation.FinalResponse {
		t.Fatalf("re-ack response aggregation audit = %#v, want resumed delivery closeout audit entry synced to final response", reAckAggregation.AuditTrail)
	}
	if !containsExactString(reAckAggregation.DecisionPath, "交付:ready") {
		t.Fatalf("re-ack decision path = %#v, want customer-facing delivery marker", reAckAggregation.DecisionPath)
	}

	parentCompleteResp := doMailboxRouteRequest(t, server.URL+"/v1/mailbox/"+delegatedHandoff.ID, map[string]string{
		"action":        "completed",
		"actingAgentId": delegatedHandoff.ToAgentID,
		"note":          "最终 delivery closeout 已收口，等待 merge / release receipt。",
	})
	defer parentCompleteResp.Body.Close()
	if parentCompleteResp.StatusCode != http.StatusOK {
		t.Fatalf("POST delegated completed status = %d, want %d", parentCompleteResp.StatusCode, http.StatusOK)
	}

	afterParentComplete := readStateSnapshot(t, server.URL)
	completedAggregation := afterParentComplete.Workspace.Governance.ResponseAggregation
	if completedAggregation.Aggregator != "Codex Dockmaster" ||
		completedAggregation.Status != "ready" ||
		!strings.Contains(completedAggregation.FinalResponse, "第 1 轮") ||
		!strings.Contains(completedAggregation.FinalResponse, "也已完成 final delivery closeout") ||
		strings.Contains(completedAggregation.FinalResponse, blockNote) {
		t.Fatalf("completed response aggregation = %#v, want completed delivery delegation summary", completedAggregation)
	}
	completedAudit := findResponseAggregationAuditEntry(completedAggregation.AuditTrail, "交付收尾")
	if completedAudit == nil ||
		completedAudit.Actor != "Codex Dockmaster" ||
		completedAudit.Status != "done" ||
		completedAudit.Summary != completedAggregation.FinalResponse ||
		!strings.Contains(completedAudit.Summary, "也已完成 final delivery closeout") {
		t.Fatalf("completed response aggregation audit = %#v, want completed delivery closeout audit entry", completedAggregation.AuditTrail)
	}
	if !containsExactString(completedAggregation.DecisionPath, "交付:done") {
		t.Fatalf("completed decision path = %#v, want customer-facing delivery marker", completedAggregation.DecisionPath)
	}
}

func readStateSnapshot(t *testing.T, serverURL string) store.State {
	t.Helper()

	resp, err := http.Get(serverURL + "/v1/state")
	if err != nil {
		t.Fatalf("GET /v1/state error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/state status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var state store.State
	decodeJSON(t, resp, &state)
	return state
}

func findGovernanceLane(items []store.WorkspaceGovernanceLane, laneID string) *store.WorkspaceGovernanceLane {
	for index := range items {
		if items[index].ID == laneID {
			return &items[index]
		}
	}
	return nil
}

func findGovernanceWalkthroughStep(items []store.WorkspaceGovernanceWalkthrough, stepID string) *store.WorkspaceGovernanceWalkthrough {
	for index := range items {
		if items[index].ID == stepID {
			return &items[index]
		}
	}
	return nil
}

func findEscalationQueueEntryBySource(
	items []store.WorkspaceGovernanceEscalationQueueEntry,
	source string,
) *store.WorkspaceGovernanceEscalationQueueEntry {
	for index := range items {
		if items[index].Source == source {
			return &items[index]
		}
	}
	return nil
}

func findEscalationRoomRollupByRoomID(
	items []store.WorkspaceGovernanceEscalationRoomRollup,
	roomID string,
) *store.WorkspaceGovernanceEscalationRoomRollup {
	for index := range items {
		if items[index].RoomID == roomID {
			return &items[index]
		}
	}
	return nil
}

func findAlternateGovernanceRoomID(state store.State, exclude string) string {
	hotRoomIDs := map[string]bool{}
	for _, item := range state.Workspace.Governance.EscalationSLA.Rollup {
		hotRoomIDs[item.RoomID] = true
	}
	for _, room := range state.Rooms {
		if room.ID != exclude && !hotRoomIDs[room.ID] {
			return room.ID
		}
	}
	return ""
}

func findResponseAggregationAuditEntry(
	items []store.WorkspaceResponseAggregationAuditEntry,
	label string,
) *store.WorkspaceResponseAggregationAuditEntry {
	for index := range items {
		if items[index].Label == label {
			return &items[index]
		}
	}
	return nil
}

func findDeliveryDelegationResponseHandoffID(items []store.AgentHandoff, parentID string) string {
	for _, item := range items {
		if item.ParentHandoffID == parentID {
			return item.ID
		}
	}
	return ""
}

func containsExactString(items []string, needle string) bool {
	for _, item := range items {
		if item == needle {
			return true
		}
	}
	return false
}
