package api

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestWorkspaceConfigRoutePersistsDurableSnapshot(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	req, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace", bytes.NewReader([]byte(`{
		"browserPush":"全部 live 事件",
		"memoryMode":"governed-first / recovery ready",
		"sandbox":{
			"profile":"restricted",
			"allowedHosts":["github.com","api.github.com"],
			"allowedCommands":["git status"],
			"allowedTools":["read_file","search"]
		},
		"onboarding":{
			"status":"ready",
			"templateId":"research-team",
			"currentStep":"identity-proof",
			"completedSteps":["workspace-created","repo-bound","agent-profile"],
			"resumeUrl":"/setup?resume=tkt-37"
		},
		"governance":{
			"teamTopology":[
				{"id":"lead","label":"Research Lead","role":"方向与验收","defaultAgent":"Lead Operator","lane":"scope / final synthesis"},
				{"id":"collector","label":"Field Collector","role":"一线证据收集","defaultAgent":"Collector","lane":"intake -> evidence"},
				{"id":"synthesizer","label":"Synthesizer","role":"归纳与草案","defaultAgent":"Synthesizer","lane":"evidence -> synthesis"},
				{"id":"reviewer","label":"Peer Reviewer","role":"交叉复核","defaultAgent":"Review Runner","lane":"review / challenge"},
				{"id":"publisher","label":"Publisher","role":"发布与归档","defaultAgent":"Lead Operator","lane":"publish / closeout"}
			]
		}
	}`)))
	if err != nil {
		t.Fatalf("new PATCH /v1/workspace request error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH /v1/workspace error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /v1/workspace status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Workspace store.WorkspaceSnapshot `json:"workspace"`
		State     store.State             `json:"state"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Workspace.Onboarding.TemplateID != "research-team" || payload.Workspace.Onboarding.ResumeURL != "/setup?resume=tkt-37" {
		t.Fatalf("workspace payload = %#v, want persisted onboarding snapshot", payload.Workspace)
	}
	if payload.Workspace.Onboarding.Materialization.Label != "研究团队" || payload.Workspace.Onboarding.Materialization.NotificationPolicy == "" {
		t.Fatalf("workspace onboarding materialization = %#v, want derived research-team package", payload.Workspace.Onboarding.Materialization)
	}
	if payload.State.Workspace.MemoryMode != "governed-first / recovery ready" {
		t.Fatalf("state workspace = %#v, want updated memory mode", payload.State.Workspace)
	}
	if len(payload.Workspace.Governance.ConfiguredTopology) != 5 || payload.Workspace.Governance.ConfiguredTopology[1].Label != "Field Collector" {
		t.Fatalf("workspace governance configured topology = %#v, want persisted custom topology", payload.Workspace.Governance.ConfiguredTopology)
	}
	if len(payload.State.Workspace.Governance.TeamTopology) != 5 || payload.State.Workspace.Governance.TeamTopology[4].ID != "publisher" {
		t.Fatalf("state governance topology = %#v, want derived publisher lane", payload.State.Workspace.Governance.TeamTopology)
	}
	if payload.Workspace.Sandbox.Profile != "restricted" || len(payload.Workspace.Sandbox.AllowedTools) != 2 {
		t.Fatalf("workspace sandbox payload = %#v, want restricted sandbox policy", payload.Workspace.Sandbox)
	}

	getResp, err := http.Get(server.URL + "/v1/workspace")
	if err != nil {
		t.Fatalf("GET /v1/workspace error = %v", err)
	}
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/workspace status = %d, want %d", getResp.StatusCode, http.StatusOK)
	}

	var workspace store.WorkspaceSnapshot
	decodeJSON(t, getResp, &workspace)
	if workspace.Onboarding.Status != "ready" || workspace.BrowserPush != "全部 live 事件" {
		t.Fatalf("GET workspace = %#v, want persisted durable config", workspace)
	}
	if workspace.Plan == "" {
		t.Fatalf("GET workspace plan missing: %#v", workspace)
	}
	if workspace.Sandbox.Profile != "restricted" || len(workspace.Sandbox.AllowedHosts) != 2 {
		t.Fatalf("GET workspace sandbox = %#v, want persisted sandbox policy", workspace.Sandbox)
	}
	if workspace.Quota.Status == "" || workspace.Quota.Warning == "" {
		t.Fatalf("GET workspace quota truth = %#v, want status + warning", workspace.Quota)
	}
	if workspace.Quota.MessageHistoryDays == 0 || workspace.Quota.RunLogDays == 0 || workspace.Quota.MemoryDraftDays == 0 {
		t.Fatalf("GET workspace retention truth = %#v, want message/run/memory retention days", workspace.Quota)
	}
	if workspace.Usage.WindowLabel == "" || workspace.Usage.Warning == "" || workspace.Usage.RefreshedAt == "" {
		t.Fatalf("GET workspace usage truth = %#v, want window + warning + refreshedAt", workspace.Usage)
	}
	if workspace.Usage.TotalTokens == 0 || workspace.Usage.RunCount == 0 || workspace.Usage.MessageCount == 0 {
		t.Fatalf("GET workspace usage counters = %#v, want tokens + runs + messages", workspace.Usage)
	}
	if len(workspace.Onboarding.Materialization.Channels) != 3 || len(workspace.Onboarding.Materialization.Agents) == 0 {
		t.Fatalf("GET workspace onboarding materialization = %#v, want persisted template package", workspace.Onboarding.Materialization)
	}
	if len(workspace.Governance.ConfiguredTopology) != 5 || workspace.Governance.ConfiguredTopology[4].ID != "publisher" {
		t.Fatalf("GET workspace configured topology = %#v, want persisted publisher lane", workspace.Governance.ConfiguredTopology)
	}
	if len(workspace.Governance.TeamTopology) != 5 || workspace.Governance.TeamTopology[1].Label != "Field Collector" {
		t.Fatalf("GET workspace governance team topology = %#v, want derived custom lane labels", workspace.Governance.TeamTopology)
	}
}

func TestWorkspaceMemberPreferencesRouteAllowsSelfServiceButProtectsOtherMembers(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	loginResp, err := http.Post(server.URL+"/v1/auth/session", "application/json", bytes.NewReader([]byte(`{"email":"mina@openshock.dev"}`)))
	if err != nil {
		t.Fatalf("POST /v1/auth/session error = %v", err)
	}
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/auth/session status = %d, want %d", loginResp.StatusCode, http.StatusOK)
	}

	selfReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-mina/preferences", bytes.NewReader([]byte(`{
		"preferredAgentId":"agent-claude-review-runner",
		"startRoute":"/rooms",
		"githubHandle":"@mina"
	}`)))
	if err != nil {
		t.Fatalf("new PATCH self preferences request error = %v", err)
	}
	selfReq.Header.Set("Content-Type", "application/json")

	selfResp, err := http.DefaultClient.Do(selfReq)
	if err != nil {
		t.Fatalf("PATCH self preferences error = %v", err)
	}
	if selfResp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH self preferences status = %d, want %d", selfResp.StatusCode, http.StatusOK)
	}

	var selfPayload struct {
		Member store.WorkspaceMember `json:"member"`
		State  store.State           `json:"state"`
	}
	decodeJSON(t, selfResp, &selfPayload)
	if selfPayload.Member.Preferences.StartRoute != "/rooms" || selfPayload.Member.GitHubIdentity.Handle != "@mina" {
		t.Fatalf("self payload member = %#v, want /rooms + @mina", selfPayload.Member)
	}
	if selfPayload.State.Auth.Session.Preferences.StartRoute != "/rooms" || selfPayload.State.Auth.Session.GitHubIdentity.Handle != "@mina" {
		t.Fatalf("self payload session = %#v, want refreshed self-service session", selfPayload.State.Auth.Session)
	}

	otherReq, err := http.NewRequest(http.MethodPatch, server.URL+"/v1/workspace/members/member-larkspur/preferences", bytes.NewReader([]byte(`{"startRoute":"/settings"}`)))
	if err != nil {
		t.Fatalf("new PATCH other preferences request error = %v", err)
	}
	otherReq.Header.Set("Content-Type", "application/json")

	otherResp, err := http.DefaultClient.Do(otherReq)
	if err != nil {
		t.Fatalf("PATCH other preferences error = %v", err)
	}
	if otherResp.StatusCode != http.StatusForbidden {
		t.Fatalf("PATCH other preferences status = %d, want %d", otherResp.StatusCode, http.StatusForbidden)
	}
}
