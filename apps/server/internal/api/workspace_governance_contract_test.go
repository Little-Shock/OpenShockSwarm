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
		afterCreate.Workspace.Governance.EscalationSLA.Queue[0].Source != "mailbox handoff" {
		t.Fatalf("escalation queue after create = %#v, want mailbox handoff entry", afterCreate.Workspace.Governance.EscalationSLA)
	}
	if afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "active" ||
		afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff.HandoffID != handoff.ID {
		t.Fatalf("governed handoff after create = %#v, want active suggestion focused on current handoff", afterCreate.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
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
	if findEscalationQueueEntryBySource(afterBlocked.Workspace.Governance.EscalationSLA.Queue, "inbox blocker") == nil {
		t.Fatalf("blocked escalation queue = %#v, want inbox blocker entry", afterBlocked.Workspace.Governance.EscalationSLA.Queue)
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
	if afterComplete.Workspace.Governance.RoutingPolicy.SuggestedHandoff.Status != "blocked" ||
		afterComplete.Workspace.Governance.RoutingPolicy.SuggestedHandoff.ToLaneLabel != "QA" {
		t.Fatalf("governed handoff after complete = %#v, want blocked reviewer -> QA next-route suggestion", afterComplete.Workspace.Governance.RoutingPolicy.SuggestedHandoff)
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
