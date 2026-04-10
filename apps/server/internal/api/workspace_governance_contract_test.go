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
	if state.Workspace.Governance.EscalationSLA.TimeoutMinutes == 0 || state.Workspace.Governance.NotificationPolicy.BrowserPush == "" {
		t.Fatalf("sla/notification = %#v / %#v, want governance SLA + notification truth", state.Workspace.Governance.EscalationSLA, state.Workspace.Governance.NotificationPolicy)
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

	createResp, handoff := mustCreateMailboxHandoff(t, server.URL)
	createResp.Body.Close()

	afterCreate := readStateSnapshot(t, server.URL)
	if afterCreate.Workspace.Governance.Stats.OpenHandoffs != 1 {
		t.Fatalf("governance stats after create = %#v, want 1 open handoff", afterCreate.Workspace.Governance.Stats)
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
	if afterComplete.Workspace.Governance.ResponseAggregation.Aggregator == "" ||
		len(afterComplete.Workspace.Governance.ResponseAggregation.AuditTrail) == 0 {
		t.Fatalf("response aggregation audit after complete = %#v, want aggregator + audit trail", afterComplete.Workspace.Governance.ResponseAggregation)
	}
	finalStep := findGovernanceWalkthroughStep(afterComplete.Workspace.Governance.Walkthrough, "final-response")
	if finalStep == nil || finalStep.Status != "ready" {
		t.Fatalf("final step after complete = %#v, want ready final response", finalStep)
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
