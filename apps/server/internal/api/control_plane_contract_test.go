package api

import (
	"net/http"
	"testing"
)

func TestControlPlaneCommandRoutesExposeWriteReplayAndRejectionReadModels(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	createResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/control-plane/commands",
		`{
			"kind":"issue.create",
			"idempotencyKey":"cp-issue-create-1",
			"payload":{
				"title":"Control Plane Issue",
				"summary":"verify write -> replay contract",
				"owner":"Codex Dockmaster",
				"priority":"high"
			}
		}`,
	)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/control-plane/commands status = %d, want %d", createResp.StatusCode, http.StatusOK)
	}

	var createPayload struct {
		Command struct {
			ID            string `json:"id"`
			Status        string `json:"status"`
			ReplayAnchor  string `json:"replayAnchor"`
			AggregateKind string `json:"aggregateKind"`
			AggregateID   string `json:"aggregateId"`
		} `json:"command"`
		Events []struct {
			Kind      string `json:"kind"`
			CommandID string `json:"commandId"`
			Cursor    int    `json:"cursor"`
		} `json:"events"`
		Deduped bool `json:"deduped"`
	}
	decodeJSON(t, createResp, &createPayload)
	if createPayload.Command.ID == "" || createPayload.Command.Status != "committed" {
		t.Fatalf("control-plane command = %#v, want committed command with id", createPayload.Command)
	}
	if createPayload.Command.AggregateKind != "issue" || createPayload.Command.AggregateID == "" {
		t.Fatalf("control-plane aggregate = %#v, want issue aggregate", createPayload.Command)
	}
	if len(createPayload.Events) != 1 || createPayload.Events[0].Kind != "issue.created" {
		t.Fatalf("control-plane events = %#v, want issue.created", createPayload.Events)
	}

	eventsResp, err := http.Get(server.URL + "/v1/control-plane/events?cursor=0&limit=10")
	if err != nil {
		t.Fatalf("GET /v1/control-plane/events error = %v", err)
	}
	defer eventsResp.Body.Close()
	if eventsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/control-plane/events status = %d, want %d", eventsResp.StatusCode, http.StatusOK)
	}
	var eventsPayload struct {
		Items []struct {
			CommandID string `json:"commandId"`
			Kind      string `json:"kind"`
			Cursor    int    `json:"cursor"`
		} `json:"items"`
		NextCursor int  `json:"nextCursor"`
		HasMore    bool `json:"hasMore"`
	}
	decodeJSON(t, eventsResp, &eventsPayload)
	if len(eventsPayload.Items) == 0 || eventsPayload.Items[0].CommandID != createPayload.Command.ID {
		t.Fatalf("events payload = %#v, want command event for %s", eventsPayload, createPayload.Command.ID)
	}
	if eventsPayload.NextCursor == 0 {
		t.Fatalf("events nextCursor = %#v, want non-zero cursor", eventsPayload)
	}

	debugResp, err := http.Get(server.URL + "/v1/control-plane/debug/commands/" + createPayload.Command.ID)
	if err != nil {
		t.Fatalf("GET /v1/control-plane/debug/commands/:id error = %v", err)
	}
	defer debugResp.Body.Close()
	if debugResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/control-plane/debug/commands/:id status = %d, want %d", debugResp.StatusCode, http.StatusOK)
	}
	var debugPayload struct {
		Command struct {
			ID           string `json:"id"`
			ReplayAnchor string `json:"replayAnchor"`
		} `json:"command"`
		Events []struct {
			Kind string `json:"kind"`
		} `json:"events"`
	}
	decodeJSON(t, debugResp, &debugPayload)
	if debugPayload.Command.ID != createPayload.Command.ID || debugPayload.Command.ReplayAnchor == "" {
		t.Fatalf("debug payload = %#v, want replay anchor for command", debugPayload)
	}
	if len(debugPayload.Events) != 1 || debugPayload.Events[0].Kind != "issue.created" {
		t.Fatalf("debug events = %#v, want issue.created", debugPayload.Events)
	}

	dedupedResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/control-plane/commands",
		`{
			"kind":"issue.create",
			"idempotencyKey":"cp-issue-create-1",
			"payload":{
				"title":"Control Plane Issue",
				"summary":"verify write -> replay contract",
				"owner":"Codex Dockmaster",
				"priority":"high"
			}
		}`,
	)
	defer dedupedResp.Body.Close()
	if dedupedResp.StatusCode != http.StatusOK {
		t.Fatalf("replay POST /v1/control-plane/commands status = %d, want %d", dedupedResp.StatusCode, http.StatusOK)
	}
	var dedupedPayload struct {
		Command struct {
			ID string `json:"id"`
		} `json:"command"`
		Deduped bool `json:"deduped"`
	}
	decodeJSON(t, dedupedResp, &dedupedPayload)
	if !dedupedPayload.Deduped || dedupedPayload.Command.ID != createPayload.Command.ID {
		t.Fatalf("deduped payload = %#v, want same command id marked deduped", dedupedPayload)
	}

	rejectResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/control-plane/commands",
		`{
			"kind":"run.control",
			"idempotencyKey":"cp-run-control-missing",
			"payload":{
				"runId":"run_missing",
				"action":"stop",
				"note":"expect a stable not_found family"
			}
		}`,
	)
	defer rejectResp.Body.Close()
	if rejectResp.StatusCode != http.StatusNotFound {
		t.Fatalf("rejected POST /v1/control-plane/commands status = %d, want %d", rejectResp.StatusCode, http.StatusNotFound)
	}
	var rejectPayload struct {
		Family  string `json:"family"`
		Error   string `json:"error"`
		Command struct {
			ID          string `json:"id"`
			Status      string `json:"status"`
			ErrorFamily string `json:"errorFamily"`
		} `json:"command"`
		Rejection *struct {
			CommandID string `json:"commandId"`
			Family    string `json:"family"`
		} `json:"rejection"`
	}
	decodeJSON(t, rejectResp, &rejectPayload)
	if rejectPayload.Family != "not_found" || rejectPayload.Command.Status != "rejected" || rejectPayload.Rejection == nil {
		t.Fatalf("rejected payload = %#v, want stable not_found rejection", rejectPayload)
	}

	rejectionsResp, err := http.Get(server.URL + "/v1/control-plane/debug/rejections?family=not_found&limit=10")
	if err != nil {
		t.Fatalf("GET /v1/control-plane/debug/rejections error = %v", err)
	}
	defer rejectionsResp.Body.Close()
	if rejectionsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/control-plane/debug/rejections status = %d, want %d", rejectionsResp.StatusCode, http.StatusOK)
	}
	var rejectionsPayload struct {
		Items []struct {
			CommandID string `json:"commandId"`
			Family    string `json:"family"`
		} `json:"items"`
	}
	decodeJSON(t, rejectionsResp, &rejectionsPayload)
	if len(rejectionsPayload.Items) == 0 || rejectionsPayload.Items[0].CommandID != rejectPayload.Command.ID {
		t.Fatalf("rejections payload = %#v, want persisted rejection for %s", rejectionsPayload, rejectPayload.Command.ID)
	}
}
